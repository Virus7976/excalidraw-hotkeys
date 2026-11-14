import {
	App,
	Hotkey,
	ItemView,
	Modal,
	Modifier,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	SettingDefinition,
	SettingDefinitionItem,
	TFile,
	normalizePath,
} from "obsidian";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface HotkeySettings {
	fillColours: string[];
	strokeColours: string[];
	catchKeysFirst: boolean;
	showStatusColours: boolean;
	showOneByOne: boolean;
	shiftGoesBack: boolean;
	diagonalNudge: boolean;
	nudgeStep: number;
	nudgeStepShift: number;
	duplicateGap: number;
	copyText: boolean;
	copyFill: boolean;
	resizePercent: number;
	fitPadding: number;
	zoomPresets: number[];
	zoomMs: number;
	zoomOnSelection: boolean;
	notePath: string;
}

// Colour 1 is Excalidraw's own ink. It looks white in dark mode and black in light mode.
const COLOUR_NAMES = ["White", "Red", "Blue", "Green", "Yellow", "Orange", "Purple", "Grey"];
const ZOOM_SLOTS = 9;

const DEFAULT_SETTINGS: HotkeySettings = {
	fillColours: ["#1e1e1e", "#ffc9c9", "#a5d8ff", "#b2f2bb", "#ffec99", "#ffd8a8", "#eebefa", "#e9ecef"],
	strokeColours: ["#1e1e1e", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#e8590c", "#9c36b5", "#868e96"],
	catchKeysFirst: true,
	showStatusColours: true,
	showOneByOne: false,
	shiftGoesBack: true,
	diagonalNudge: true,
	nudgeStep: 12,
	nudgeStepShift: 20,
	duplicateGap: 80,
	copyText: true,
	copyFill: true,
	resizePercent: 10,
	fitPadding: 30,
	zoomPresets: [25, 50, 100, 200, 400],
	zoomMs: 350,
	zoomOnSelection: true,
	notePath: "Excalidraw Hotkeys.md",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The Excalidraw plugin ships no types we can depend on, so these describe
// only the parts of its API that this plugin uses.

interface BoundRef {
	id: string;
	type: string;
}

interface El {
	id: string;
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	strokeColor: string;
	backgroundColor: string;
	fillStyle?: string;
	strokeStyle?: string;
	strokeWidth?: number;
	opacity?: number;
	roughness?: number;
	textAlign?: string;
	text?: string;
	rawText?: string;
	originalText?: string;
	fontSize: number;
	fontFamily: number;
	containerId?: string | null;
	boundElements?: BoundRef[] | null;
	groupIds?: string[];
	seed?: number;
	version?: number;
	versionNonce?: number;
	isDeleted?: boolean;
	startArrowhead?: string | null;
	endArrowhead?: string | null;
}

interface AppState {
	zoom: { value: number };
	scrollX: number;
	scrollY: number;
	width: number;
	height: number;
	editingTextElement?: El | null;
	editingElement?: El | null;
	currentItemStrokeColor?: string;
	currentItemBackgroundColor?: string;
}

interface ExcalidrawAPI {
	getAppState(): AppState;
	getSceneElementsIncludingDeleted(): El[];
	updateScene(scene: { elements?: El[]; appState?: Record<string, unknown>; captureUpdate?: string }): void;
}

interface EA {
	elementsDict: Record<string, El>;
	style: { strokeColor: string; strokeWidth: number; roughness: number };
	getViewSelectedElements(): El[];
	getViewElements(): El[];
	copyViewElementsToEAforEditing(els: El[]): void;
	getElements(): El[];
	getElement(id: string): El;
	addElementsToView(repositionToCursor: boolean, save: boolean): Promise<boolean>;
	refreshTextElementSize?(id: string): void;
	getExcalidrawAPI?(): ExcalidrawAPI | null;
	connectObjects(
		a: string,
		ca: string | null,
		b: string,
		cb: string | null,
		formatting: { startArrowHead: string | null; endArrowHead: string | null; numberOfPoints: number },
	): string;
}

interface HotkeyManager {
	customKeys?: Record<string, Hotkey[]>;
	defaultKeys?: Record<string, Hotkey[]>;
	setHotkeys?(id: string, keys: Hotkey[]): void;
	save?(): Promise<void> | void;
	bake?(): void;
}

interface SettingWindow {
	open(): void;
	openTabById(id: string): void;
	activeTab?: { searchComponent?: { setValue(v: string): void }; updateHotkeyVisibility?(): void };
}

/** Internal parts of App that Obsidian does not type. */
type AppInternals = App & { hotkeyManager?: HotkeyManager; setting?: SettingWindow };

declare global {
	interface Window {
		ExcalidrawAutomate?: { getAPI(view: unknown): EA };
	}
}

interface Ctx {
	ea: EA;
	selected: El[];
	all: El[];
	/** The text being typed right now, if any. */
	typing: El | null;
}

interface Action {
	id: string;
	name: string;
	group: string;
	/** Suggested keys. Applied only when the user presses "Use suggested keys". */
	keys?: Hotkey[];
	/** Return false to let the key fall through to Excalidraw. */
	canRun: (c: Ctx) => boolean;
	/** Also runs while a text is being typed. */
	whileTyping?: boolean;
	/** A one-by-one command that a cycle command also covers. Hidden unless turned on. */
	oneByOne?: boolean;
	/** The "back" half of a cycle. Hidden when Shift goes back is off. */
	back?: boolean;
	run: (c: Ctx) => Promise<void> | void;
}

const SHAPES = ["rectangle", "ellipse", "diamond"];
const BOXES = ["rectangle", "ellipse", "diamond", "image", "embeddable", "frame"];
const LINEAR = ["arrow", "line", "freedraw"];
const FONT_SIZES: [string, number][] = [["small", 16], ["medium", 20], ["large", 28], ["very large", 36]];
const FONTS: [string, string, number][] = [
	["hand-drawn", "Hand-drawn", 5],
	["normal", "Normal", 6],
	["code", "Code", 8],
];
const LINE_STYLES = ["solid", "dashed", "dotted"];
const LINE_WIDTHS: [string, string, number][] = [
	["thin", "Thin", 1],
	["bold", "Bold", 2],
	["extra-bold", "Extra bold", 4],
];

const hk = (modifiers: Modifier[], key: string): Hotkey => ({ modifiers, key });

const newId = () =>
	Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Text inside a box carries its own colour and font, so "the selection"
// means the selected elements plus the text bound to them.
function withBoundText(c: Ctx): El[] {
	const ids = new Set<string>();
	for (const el of c.selected) {
		ids.add(el.id);
		for (const b of el.boundElements ?? []) if (b.type === "text") ids.add(b.id);
	}
	return c.all.filter((el) => ids.has(el.id));
}

async function edit(c: Ctx, els: El[], fn: (el: El) => void) {
	if (els.length === 0) return;
	c.ea.copyViewElementsToEAforEditing(els);
	for (const el of c.ea.getElements()) fn(el);
	await c.ea.addElementsToView(false, true);
}

let colourNotice: Notice | null = null;
let statusRefresh: (() => void) | null = null;

/** A short popup with a colour square and its name. Replaces the last one. */
function showColour(label: string, colour: string) {
	colourNotice?.hide();
	const frag = activeDocument.createDocumentFragment();
	const row = frag.createDiv({ cls: "ekh-colour-notice" });
	row.createSpan({ cls: "ekh-swatch" }).setCssProps({ "--ekh-swatch": colour });
	row.createSpan({ text: label });
	colourNotice = new Notice(frag, 1200);
}

/**
 * Typing a text: colour that text. Nothing selected: set the pen colour for
 * the next thing drawn. Something selected: the caller colours it, and the pen
 * stays as it is.
 */
function setPen(c: Ctx, typed: Partial<El>, pen: Record<string, string>, label: string, colour: string) {
	showColour(label, colour);
	const api = c.ea.getExcalidrawAPI?.();
	if (!api) return;
	if (c.typing) {
		const id = c.typing.id;
		const elements = api.getSceneElementsIncludingDeleted().map((x: El) =>
			x.id === id ? { ...x, ...typed, version: (x.version ?? 1) + 1, versionNonce: newSeed() } : x,
		);
		api.updateScene({ elements, captureUpdate: "IMMEDIATELY" });
		return;
	}
	if (c.selected.length > 0) return;
	api.updateScene({ appState: pen, captureUpdate: "NEVER" });
	statusRefresh?.();
}

// Remove an Obsidian block reference ("... ^abc123") from the end of a text.
const stripBlockRef = (s?: string) => (s ? s.replace(/\s*\^[\w-]+$/, "") : s);

// ---------------------------------------------------------------------------
// Key matching and display
// ---------------------------------------------------------------------------

const CODE_TO_KEY: Record<string, string> = {
	Comma: ",", Period: ".", Slash: "/", Backquote: "`", Semicolon: ";", Quote: "'",
	BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Space: " ",
};

// Obsidian stores a hotkey as a key name. With Shift held, e.key changes
// ("1" becomes "!"), so also compare against the physical key.
function keyNames(e: KeyboardEvent): Set<string> {
	const out = new Set<string>([e.key.toUpperCase()]);
	const code = e.code;
	if (code.startsWith("Key")) out.add(code.slice(3));
	else if (code.startsWith("Digit")) out.add(code.slice(5));
	else if (CODE_TO_KEY[code]) out.add(CODE_TO_KEY[code]);
	else out.add(code.toUpperCase());
	return out;
}

function matches(h: Hotkey, e: KeyboardEvent): boolean {
	const mods = new Set<string>(h.modifiers.map((m) => (m === "Mod" ? (Platform.isMacOS ? "Meta" : "Ctrl") : m)));
	if (mods.has("Ctrl") !== e.ctrlKey) return false;
	if (mods.has("Meta") !== e.metaKey) return false;
	if (mods.has("Alt") !== e.altKey) return false;
	if (mods.has("Shift") !== e.shiftKey) return false;
	return keyNames(e).has(h.key.toUpperCase());
}

const KEY_LABEL: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", " ": "Space" };

function hotkeyLabel(h: Hotkey): string {
	const order: Modifier[] = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];
	const name = (m: Modifier) =>
		m === "Mod" ? (Platform.isMacOS ? "Cmd" : "Ctrl") : m === "Meta" ? (Platform.isMacOS ? "Cmd" : "Win") : m === "Alt" && Platform.isMacOS ? "Option" : m;
	const mods = order.filter((m) => h.modifiers.includes(m)).map(name);
	const key = KEY_LABEL[h.key] ?? (h.key.length === 1 ? h.key.toUpperCase() : h.key);
	return [...mods, key].join("+");
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class ExcalidrawHotkeys extends Plugin {
	settings: HotkeySettings = DEFAULT_SETTINGS;
	actions: Action[] = [];
	private pressed = new Set<string>();
	// The command that just ran. Obsidian's hotkey handler and our own capture
	// listener can both see one key press; this stops a double run. It clears
	// once the key event is done.
	private justRan: string | null = null;
	private zoomFrame = 0;
	private zoomGoal: number | null = null;
	private statusEl: HTMLElement | null = null;
	private statusKey = "";

	async onload() {
		await this.loadSettings();
		this.actions = this.buildActions();

		this.registerCommands();

		this.addCommand({
			id: "show-hotkeys",
			name: "Show my hotkeys",
			callback: () => new HotkeyListModal(this.app, this).open(),
		});

		this.registerDomEvent(window, "keydown", (e) => this.onKeyDown(e), { capture: true });
		this.registerDomEvent(window, "keyup", (e) => this.pressed.delete(e.code), { capture: true });
		this.registerDomEvent(window, "blur", () => this.pressed.clear());

		this.addSettingTab(new HotkeySettingTab(this.app, this));

		// The pen colours, at the bottom right, only while a drawing is open.
		statusRefresh = () => this.updateStatus();
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("ekh-status");
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatus()));
		this.registerInterval(window.setInterval(() => this.updateStatus(), 400));
		this.updateStatus();
	}

	private registered = new Set<string>();

	/** Add every command, and add or remove the one-by-one ones to match the setting. */
	registerCommands() {
		for (const a of this.actions) {
			const want = (!a.oneByOne || this.settings.showOneByOne) && (!a.back || this.settings.shiftGoesBack);
			if (want && !this.registered.has(a.id)) {
				this.addCommand({
					id: a.id,
					name: a.name,
					checkCallback: (checking) => {
						if (this.justRan === a.id) return true;
						const c = this.context();
						if (!c || (c.typing && !a.whileTyping) || !a.canRun(c)) return false;
						if (!checking) {
							this.markRan(a.id);
							void a.run(c);
						}
						return true;
					},
				});
				this.registered.add(a.id);
			} else if (!want && this.registered.has(a.id)) {
				this.removeCommand(a.id);
				this.registered.delete(a.id);
			}
		}
	}

	/** The commands the user can see. */
	visibleActions(): Action[] {
		return this.actions.filter((a) => this.registered.has(a.id));
	}

	/** Show the stroke and fill colour that the next drawn thing gets. */
	updateStatus() {
		const el = this.statusEl;
		if (!el) return;
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		const st =
			this.settings.showStatusColours && view?.getViewType() === "excalidraw"
				? window.ExcalidrawAutomate?.getAPI(view).getExcalidrawAPI?.()?.getAppState()
				: null;
		const stroke = st?.currentItemStrokeColor ?? "";
		const fill = st?.currentItemBackgroundColor ?? "";
		const key = st ? `${stroke}|${fill}` : "";
		if (key === this.statusKey) return;
		this.statusKey = key;
		el.empty();
		el.toggleClass("ekh-hidden", !st);
		if (!st) return;
		const swatch = (label: string, colour: string) => {
			const s = el.createSpan({ cls: "ekh-swatch", attr: { "aria-label": `${label}: ${colour}`, "data-tooltip-position": "top" } });
			if (!colour || colour === "transparent") s.addClass("is-none");
			else s.setCssProps({ "--ekh-swatch": colour });
		};
		swatch("Stroke", stroke);
		swatch("Fill", fill);
	}

	onunload() {
		statusRefresh = null;
		window.cancelAnimationFrame(this.zoomFrame);
	}

	async loadSettings() {
		const saved = ((await this.loadData()) ?? {}) as Partial<HotkeySettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.settings.fillColours = [...(saved.fillColours ?? DEFAULT_SETTINGS.fillColours)];
		this.settings.strokeColours = [...(saved.strokeColours ?? DEFAULT_SETTINGS.strokeColours)];
		this.settings.zoomPresets = [...(saved.zoomPresets ?? DEFAULT_SETTINGS.zoomPresets)];
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Null unless an Excalidraw drawing is active and no text is being typed. */
	private context(): Ctx | null {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		if (!view || view.getViewType() !== "excalidraw") return null;

		const EAglobal = window.ExcalidrawAutomate;
		if (!EAglobal?.getAPI) return null;

		const active = activeDocument.activeElement as HTMLElement | null;
		if (active?.closest(".excalidraw-textEditorContainer") || active?.classList.contains("excalidraw-wysiwyg")) {
			const ea = EAglobal.getAPI(view);
			const st = ea.getExcalidrawAPI?.()?.getAppState();
			const typing = st?.editingTextElement ?? st?.editingElement ?? null;
			if (!typing || typing.type !== "text") return null;
			return { ea, selected: [], all: ea.getViewElements() ?? [], typing };
		}
		if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable))
			return null;

		const ea = EAglobal.getAPI(view);
		return { ea, selected: ea.getViewSelectedElements() ?? [], all: ea.getViewElements() ?? [], typing: null };
	}

	/** The keys set in Settings, Hotkeys. */
	hotkeysFor(id: string): Hotkey[] {
		const hm = (this.app as AppInternals).hotkeyManager;
		const full = `${this.manifest.id}:${id}`;
		const custom = hm?.customKeys?.[full];
		if (Array.isArray(custom)) return custom;
		const def = hm?.defaultKeys?.[full];
		if (Array.isArray(def)) return def;
		return [];
	}

	/** Give each command its suggested key. Without replace, keys the user set stay. */
	async applySuggestedKeys(replace = false): Promise<number> {
		const hm = (this.app as AppInternals).hotkeyManager;
		if (!hm?.setHotkeys) return 0;
		let n = 0;
		for (const a of this.actions) {
			const full = `${this.manifest.id}:${a.id}`;
			if (replace) {
				hm.setHotkeys(full, a.keys ?? []);
				n++;
				continue;
			}
			if (!a.keys || Array.isArray(hm.customKeys?.[full])) continue;
			hm.setHotkeys(full, a.keys);
			n++;
		}
		await hm.save?.();
		hm.bake?.();
		return n;
	}

	private markRan(id: string) {
		this.justRan = id;
		window.setTimeout(() => (this.justRan = null), 0);
	}

	private onKeyDown(e: KeyboardEvent) {
		this.pressed.add(e.code);

		if (this.settings.diagonalNudge && this.tryDiagonalNudge(e)) return;
		if (!this.settings.catchKeysFirst) return;

		for (const a of this.visibleActions()) {
			if (!this.hotkeysFor(a.id).some((h) => matches(h, e))) continue;
			const c = this.context();
			if (this.justRan === a.id) return;
			if (!c || (c.typing && !a.whileTyping) || !a.canRun(c)) continue;
			e.preventDefault();
			e.stopImmediatePropagation();
			this.markRan(a.id);
			void a.run(c);
			return;
		}
	}

	// Two arrow keys held at once move the selection on a diagonal. Obsidian
	// hotkeys are one key each, so this lives outside the Hotkeys menu.
	private tryDiagonalNudge(e: KeyboardEvent): boolean {
		if (!e.code.startsWith("Arrow") || e.ctrlKey || e.metaKey || e.altKey) return false;
		const held = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].filter((k) => this.pressed.has(k));
		if (held.length < 2) return false;
		const c = this.context();
		if (!c || c.selected.length === 0) return false;

		e.preventDefault();
		e.stopImmediatePropagation();
		const d = e.shiftKey ? this.settings.nudgeStepShift : this.settings.nudgeStep;
		let dx = 0;
		let dy = 0;
		if (this.pressed.has("ArrowUp")) dy -= d;
		if (this.pressed.has("ArrowDown")) dy += d;
		if (this.pressed.has("ArrowLeft")) dx -= d;
		if (this.pressed.has("ArrowRight")) dx += d;
		void edit(c, withBoundText(c), (el) => {
			el.x += dx;
			el.y += dy;
		});
		return true;
	}

	// -----------------------------------------------------------------------
	// Smooth zoom
	// -----------------------------------------------------------------------

	private zoomTo(c: Ctx, goal: number) {
		const api = c.ea.getExcalidrawAPI?.();
		if (!api) return;
		const st = api.getAppState();
		const z0: number = st.zoom.value;
		const w: number = st.width;
		const h: number = st.height;
		goal = clamp(goal, 0.1, 30);

		// The scene point now in the middle of the screen, and the one to end on.
		const from = { x: w / 2 / z0 - st.scrollX, y: h / 2 / z0 - st.scrollY };
		let to = from;
		if (this.settings.zoomOnSelection && c.selected.length > 0) {
			const xs = c.selected.flatMap((el) => [el.x, el.x + el.width]);
			const ys = c.selected.flatMap((el) => [el.y, el.y + el.height]);
			to = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
		}

		window.cancelAnimationFrame(this.zoomFrame);
		this.zoomGoal = goal;
		// A hidden window gets no animation frames, so jump straight there.
		const ms = activeDocument.hidden ? 0 : this.settings.zoomMs;
		const start = performance.now();
		const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

		const frame = (now: number) => {
			const p = ms <= 0 ? 1 : Math.min(1, (now - start) / ms);
			const k = ease(p);
			// Zoom on a log scale so 25% to 400% feels even all the way.
			const z = Math.exp(Math.log(z0) + (Math.log(goal) - Math.log(z0)) * k);
			const cx = from.x + (to.x - from.x) * k;
			const cy = from.y + (to.y - from.y) * k;
			api.updateScene({ appState: { zoom: { value: z }, scrollX: w / 2 / z - cx, scrollY: h / 2 / z - cy } });
			if (p < 1) this.zoomFrame = window.requestAnimationFrame(frame);
			else this.zoomGoal = null;
		};
		if (ms <= 0) frame(start);
		else this.zoomFrame = window.requestAnimationFrame(frame);
	}

	private currentZoom(c: Ctx): number {
		return this.zoomGoal ?? c.ea.getExcalidrawAPI?.()?.getAppState().zoom.value ?? 1;
	}

	private sortedPresets(): number[] {
		return [...this.settings.zoomPresets].filter((p) => p > 0).sort((a, b) => a - b).map((p) => p / 100);
	}

	// -----------------------------------------------------------------------
	// Actions
	// -----------------------------------------------------------------------

	private buildActions(): Action[] {
		const s = () => this.settings;
		const hasSelection = (c: Ctx) => c.selected.length > 0;
		const always = () => true;
		const list: Action[] = [];
		// A cycle gets two commands: Alt+key goes forward, Alt+Shift+key goes back.
		const wrap = (i: number, n: number) => ((i % n) + n) % n;
		const cycle = (
			id: string,
			name: string,
			group: string,
			key: string,
			canRun: (c: Ctx) => boolean,
			step: (c: Ctx, dir: 1 | -1) => Promise<void> | void,
		) => {
			list.push({ id, name, group, keys: [hk(["Alt"], key)], canRun, run: (c) => step(c, 1) });
			list.push({ id: `${id}-back`, name: `${name}, back`, group, keys: [hk(["Alt", "Shift"], key)], back: true, canRun, run: (c) => step(c, -1) });
		};

		// Colour ----------------------------------------------------------------
		for (let i = 0; i < 8; i++) {
			const n = i + 1;
			list.push({
				id: `stroke-colour-${n}`,
				name: `Stroke colour ${n}`,
				group: "Colour",
				keys: [hk(["Alt"], String(n))],
				canRun: always,
				whileTyping: true,
				run: async (c) => {
					const col = s().strokeColours[i];
					setPen(c, { strokeColor: col }, { currentItemStrokeColor: col }, `Stroke colour ${n}`, col);
					if (!c.typing) await edit(c, withBoundText(c), (el) => (el.strokeColor = col));
				},
			});
		}
		for (let i = 0; i < 8; i++) {
			const n = i + 1;
			list.push({
				id: `fill-colour-${n}`,
				name: `Fill colour ${n}`,
				group: "Colour",
				keys: [hk(["Alt", "Shift"], String(n))],
				canRun: always,
				whileTyping: true,
				run: async (c) => {
					const fill = s().fillColours[i];
					// Fill only ever changes the inside of a shape, never the pen or text colour.
					setPen(c, {}, { currentItemBackgroundColor: fill }, `Fill colour ${n}`, fill);
					if (c.typing) return;
					await edit(c, c.selected, (el) => {
						if (el.type !== "text" && !LINEAR.includes(el.type)) el.backgroundColor = fill;
					});
				},
			});
		}

		const FILLS = ["none", "hachure", "cross-hatch", "solid"];
		cycle(
			"cycle-fill-style",
			"Cycle fill style (none, hachure, cross-hatch, solid)",
			"Colour",
			"F",
			(c) => c.selected.some((el) => SHAPES.includes(el.type)),
			(c, dir) => {
				const first = c.selected.find((el) => SHAPES.includes(el.type));
				const now = !first || first.backgroundColor === "transparent" ? "none" : (first.fillStyle ?? "hachure");
				const next = FILLS[wrap(FILLS.indexOf(now) + dir, FILLS.length)];
				const pen = c.ea.getExcalidrawAPI?.()?.getAppState().currentItemBackgroundColor;
				const colour = pen && pen !== "transparent" ? pen : s().fillColours[2];
				return edit(c, c.selected, (el) => {
					if (!SHAPES.includes(el.type)) return;
					if (next === "none") {
						el.backgroundColor = "transparent";
						return;
					}
					if (el.backgroundColor === "transparent") el.backgroundColor = colour;
					el.fillStyle = next;
				});
			},
		);

		list.push({
			id: "reset-colours",
			name: "Reset to black with no fill",
			group: "Colour",
			keys: [hk(["Mod"], "`")],
			canRun: hasSelection,
			run: (c) =>
				edit(c, withBoundText(c), (el) => {
					el.strokeColor = "#000000";
					el.backgroundColor = "transparent";
					if (el.type === "text") {
						el.text = stripBlockRef(el.text);
						el.rawText = stripBlockRef(el.rawText);
						el.originalText = stripBlockRef(el.originalText);
					}
				}),
		});

		const opacityStep = (up: boolean): Action => ({
			id: up ? "opacity-up" : "opacity-down",
			name: up ? "More opaque" : "More see-through",
			group: "Colour",
			keys: [up ? hk(["Alt", "Shift"], "X") : hk(["Alt"], "X")],
			canRun: hasSelection,
			run: (c) =>
				edit(c, withBoundText(c), (el) => {
					el.opacity = clamp(Math.round(((el.opacity ?? 100) + (up ? 10 : -10)) / 10) * 10, 10, 100);
				}),
		});
		list.push(opacityStep(false), opacityStep(true));

		// Lines -------------------------------------------------------------------
		const lineTargets = (c: Ctx) => c.selected.filter((el) => el.type !== "text" && el.type !== "image");
		const arrows = (c: Ctx) => c.selected.filter((el) => el.type === "arrow");

		for (const style of LINE_STYLES) {
			list.push({
				id: `line-style-${style}`,
				name: `Line style ${style}`,
				group: "Lines",
				oneByOne: true,
				canRun: (c) => lineTargets(c).length > 0,
				run: (c) => edit(c, lineTargets(c), (el) => (el.strokeStyle = style)),
			});
		}
		cycle("cycle-line-style", "Cycle line style (solid, dashed, dotted)", "Lines", "D", (c) => lineTargets(c).length > 0, (c, dir) => {
			const els = lineTargets(c);
			const next = LINE_STYLES[wrap(LINE_STYLES.indexOf(els[0].strokeStyle ?? "solid") + dir, LINE_STYLES.length)];
			return edit(c, els, (el) => (el.strokeStyle = next));
		});

		for (const [id, name, width] of LINE_WIDTHS) {
			list.push({
				id: `line-width-${id}`,
				name: `Line width ${name.toLowerCase()}`,
				group: "Lines",
				oneByOne: true,
				canRun: (c) => lineTargets(c).length > 0,
				run: (c) => edit(c, lineTargets(c), (el) => (el.strokeWidth = width)),
			});
		}
		cycle("cycle-line-width", "Cycle line width (thin, bold, extra bold)", "Lines", "Q", (c) => lineTargets(c).length > 0, (c, dir) => {
			const els = lineTargets(c);
			const widths = LINE_WIDTHS.map((w) => w[2]);
			const i = Math.max(0, widths.indexOf(els[0].strokeWidth ?? 1));
			const next = widths[wrap(i + dir, widths.length)];
			return edit(c, els, (el) => (el.strokeWidth = next));
		});

		// Arrowheads: none, end, both, start.
		const HEADS: [string | null, string | null][] = [
			[null, null],
			[null, "arrow"],
			["arrow", "arrow"],
			["arrow", null],
		];
		cycle("cycle-arrowheads", "Cycle arrowheads (none, end, both, start)", "Lines", "E", (c) => arrows(c).length > 0, (c, dir) => {
			const els = arrows(c);
			const a = els[0];
			const i = Math.max(0, HEADS.findIndex(([s0, e0]) => !!s0 === !!a.startArrowhead && !!e0 === !!a.endArrowhead));
			const [start, end] = HEADS[wrap(i + dir, HEADS.length)];
			return edit(c, els, (el) => {
				el.startArrowhead = start;
				el.endArrowhead = end;
			});
		});

		for (const end of ["start", "end"] as const) {
			const prop = end === "start" ? "startArrowhead" : "endArrowhead";
			list.push({
				id: `toggle-${end}-arrowhead`,
				name: `Turn ${end} arrowhead on or off`,
				group: "Lines",
				oneByOne: true,
				canRun: (c) => arrows(c).length > 0,
				run: (c) => {
					const els = arrows(c);
					const next = els[0][prop] ? null : "arrow";
					return edit(c, els, (el) => (el[prop] = next));
				},
			});
		}

		// Text --------------------------------------------------------------------
		const texts = (c: Ctx) => withBoundText(c).filter((el) => el.type === "text");
		const editText = async (c: Ctx, fn: (el: El) => void) => {
			const els = texts(c);
			if (els.length === 0) return;
			c.ea.copyViewElementsToEAforEditing(els);
			for (const el of c.ea.getElements()) {
				fn(el);
				c.ea.refreshTextElementSize?.(el.id);
			}
			await c.ea.addElementsToView(false, true);
		};

		const aligns: [string, string][] = [
			["left", "Align text left"],
			["center", "Align text centre"],
			["right", "Align text right"],
		];
		cycle("cycle-align", "Cycle text align (left, centre, right)", "Text", "A", (c) => texts(c).length > 0, (c, dir) => {
			const order = aligns.map((a) => a[0]);
			const next = order[wrap(order.indexOf(texts(c)[0].textAlign ?? "left") + dir, order.length)];
			return edit(c, texts(c), (el) => (el.textAlign = next));
		});
		for (const [value, name] of aligns) {
			list.push({
				id: `align-text-${value}`,
				name,
				group: "Text",
				oneByOne: true,
				canRun: (c) => texts(c).length > 0,
				run: (c) => edit(c, texts(c), (el) => (el.textAlign = value)),
			});
		}

		for (const [label, size] of FONT_SIZES) {
			list.push({
				id: `font-size-${label.replace(" ", "-")}`,
				name: `Font size ${label}`,
				group: "Text",
				oneByOne: true,
				canRun: (c) => texts(c).length > 0,
				run: (c) => editText(c, (el) => (el.fontSize = size)),
			});
		}
		for (const up of [true, false]) {
			list.push({
				id: up ? "font-size-up" : "font-size-down",
				name: up ? "Font size up (small, medium, large, very large)" : "Font size down",
				group: "Text",
				keys: [up ? hk(["Alt"], "G") : hk(["Alt", "Shift"], "G")],
				canRun: (c) => texts(c).length > 0,
				// Step through the 4 sizes. Past the ends, grow or shrink by a quarter.
				run: (c) => {
					const sizes = FONT_SIZES.map((f) => f[1]);
					const now = texts(c)[0].fontSize;
					const next = up
						? (sizes.find((x) => x > now) ?? Math.round(now * 1.25))
						: ([...sizes].reverse().find((x) => x < now) ?? Math.max(8, Math.round(now * 0.8)));
					return editText(c, (el) => (el.fontSize = next));
				},
			});
		}
		for (const [id, name, family] of FONTS) {
			list.push({
				id: `font-${id}`,
				name: `Font ${name.toLowerCase()}`,
				group: "Text",
				oneByOne: true,
				canRun: (c) => texts(c).length > 0,
				run: (c) => editText(c, (el) => (el.fontFamily = family)),
			});
		}
		cycle("cycle-font", "Cycle font (hand-drawn, normal, code)", "Text", "T", (c) => texts(c).length > 0, (c, dir) => {
			const families = FONTS.map((f) => f[2]);
			const i = Math.max(0, families.indexOf(texts(c)[0].fontFamily));
			const next = families[wrap(i + dir, families.length)];
			return editText(c, (el) => (el.fontFamily = next));
		});

		const withText = (c: Ctx) =>
			c.selected.filter((el) => (el.boundElements ?? []).some((b) => b.type === "text"));
		list.push({
			id: "fit-box-to-text",
			name: "Fit box to text",
			group: "Text",
			keys: [hk(["Alt"], "B")],
			canRun: (c) => withText(c).length > 0,
			run: (c) =>
				edit(c, withText(c), (el) => {
					const t = c.all.find((x) => x.type === "text" && x.containerId === el.id);
					if (!t) return;
					const w = t.width + s().fitPadding;
					const h = t.height + s().fitPadding;
					el.x += (el.width - w) / 2;
					el.y += (el.height - h) / 2;
					el.width = w;
					el.height = h;
				}),
		});

		// Duplicate with an arrow ---------------------------------------------------
		// W A S D, like the arrow keys under the left hand.
		const dirs: [string, string, number, number][] = [
			["up", "W", 0, -1],
			["down", "S", 0, 1],
			["left", "A", -1, 0],
			["right", "D", 1, 0],
		];
		const dupSources = (c: Ctx) =>
			c.selected.filter(
				(el) =>
					(BOXES.includes(el.type) || el.type === "text") &&
					!(el.type === "text" && el.containerId && c.selected.some((x) => x.id === el.containerId)),
			);
		const cloneEl = (el: El, ox: number, oy: number): El => {
			const copy = JSON.parse(JSON.stringify(el)) as El;
			copy.id = newId();
			copy.seed = newSeed();
			copy.versionNonce = newSeed();
			copy.version = 1;
			copy.x += ox;
			copy.y += oy;
			copy.boundElements = [];
			copy.groupIds = [];
			return copy;
		};
		for (const [name, key, dx, dy] of dirs) {
			list.push({
				id: `duplicate-${name}`,
				name: `Duplicate ${name} with an arrow`,
				group: "Duplicate",
				keys: [hk(["Mod", "Shift"], key)],
				canRun: (c) => dupSources(c).length > 0,
				run: async (c) => {
					const sources = dupSources(c);
					const ea = c.ea;
					ea.copyViewElementsToEAforEditing(sources);
					const newIds: string[] = [];
					for (const src of sources) {
						const el = ea.getElement(src.id);
						const ox = dx * (el.width + s().duplicateGap);
						const oy = dy * (el.height + s().duplicateGap);
						const copy = cloneEl(el, ox, oy);
						if (!s().copyFill) copy.backgroundColor = "transparent";
						if (copy.type === "text") copy.containerId = null;
						ea.elementsDict[copy.id] = copy;
						newIds.push(copy.id);

						const label = c.all.find((t) => t.type === "text" && t.containerId === el.id);
						if (s().copyText && label && copy.type !== "text") {
							const t = cloneEl(label, ox, oy);
							t.containerId = copy.id;
							ea.elementsDict[t.id] = t;
							copy.boundElements = [{ type: "text", id: t.id }];
						}

						Object.assign(ea.style, {
							strokeColor: el.strokeColor,
							strokeWidth: 1,
							roughness: el.roughness ?? ea.style.roughness,
						});
						ea.connectObjects(el.id, null, copy.id, null, {
							startArrowHead: null,
							endArrowHead: "arrow",
							numberOfPoints: 0,
						});
					}
					// One scene update with the copies, arrows and new selection, so one
					// Ctrl+Z removes the whole duplicate.
					const api = ea.getExcalidrawAPI?.();
					if (!api) {
						await ea.addElementsToView(false, true);
						return;
					}
					const changed = new Map<string, El>(ea.getElements().map((x: El) => [x.id, x]));
					const merged = api.getSceneElementsIncludingDeleted().map((x: El) => {
						const n = changed.get(x.id);
						if (!n) return x;
						changed.delete(x.id);
						return { ...n, version: (x.version ?? 1) + 1, versionNonce: newSeed() };
					});
					merged.push(...changed.values());
					const selectedElementIds = Object.fromEntries(newIds.map((id) => [id, true]));
					api.updateScene({ elements: merged, appState: { selectedElementIds }, captureUpdate: "IMMEDIATELY" });
				},
			});
		}

		// Size --------------------------------------------------------------------
		const resizable = (c: Ctx) => c.selected.filter((el) => el.type !== "text" && !LINEAR.includes(el.type));
		const factor = (grow: boolean) => 1 + ((grow ? 1 : -1) * s().resizePercent) / 100;

		for (const grow of [true, false]) {
			const word = grow ? "Grow" : "Shrink";
			const mods: Modifier[] = grow ? ["Alt"] : ["Alt", "Shift"];

			list.push({
				id: `${word.toLowerCase()}-width`,
				name: `${word} width`,
				group: "Size",
				keys: [hk(mods, "C")],
				canRun: (c) => resizable(c).length > 0,
				run: (c) =>
					edit(c, resizable(c), (el) => {
						const w = el.width * factor(grow);
						el.x -= (w - el.width) / 2;
						el.width = w;
					}),
			});
			list.push({
				id: `${word.toLowerCase()}-height`,
				name: `${word} height`,
				group: "Size",
				keys: [hk(mods, "V")],
				canRun: (c) => resizable(c).length > 0,
				run: (c) =>
					edit(c, resizable(c), (el) => {
						const h = el.height * factor(grow);
						el.y -= (h - el.height) / 2;
						el.height = h;
					}),
			});
			list.push({
				id: `${word.toLowerCase()}-size`,
				name: `${word} size or line width`,
				group: "Size",
				keys: [hk(mods, "R")],
				// All text selected: let Excalidraw change the font size instead.
				canRun: (c) => c.selected.some((el) => el.type !== "text"),
				run: (c) =>
					edit(c, c.selected, (el) => {
						if (el.type === "arrow" || el.type === "line") {
							el.strokeWidth = Math.max(1, (el.strokeWidth ?? 1) + (grow ? 1 : -1));
						} else if (el.type !== "text" && el.type !== "freedraw") {
							const f = factor(grow);
							const w = el.width * f;
							const h = el.height * f;
							el.x -= (w - el.width) / 2;
							el.y -= (h - el.height) / 2;
							el.width = w;
							el.height = h;
						}
					}),
			});
		}

		// Zoom --------------------------------------------------------------------
		for (let i = 0; i < ZOOM_SLOTS; i++) {
			list.push({
				id: `zoom-preset-${i + 1}`,
				name: `Zoom preset ${i + 1}`,
				group: "Zoom",
				keys: i < 5 ? [hk(["Mod", "Alt"], String(i + 1))] : undefined,
				canRun: () => i < s().zoomPresets.length,
				run: (c) => this.zoomTo(c, s().zoomPresets[i] / 100),
			});
		}
		for (const inward of [true, false]) {
			list.push({
				id: inward ? "zoom-in" : "zoom-out",
				name: inward ? "Zoom in to the next preset" : "Zoom out to the next preset",
				group: "Zoom",
				keys: [inward ? hk(["Mod", "Alt"], "Z") : hk(["Mod", "Alt", "Shift"], "Z")],
				canRun: always,
				run: (c) => {
					const z = this.currentZoom(c);
					const presets = this.sortedPresets();
					const next = inward ? presets.find((p) => p > z * 1.001) : [...presets].reverse().find((p) => p < z / 1.001);
					if (next !== undefined) this.zoomTo(c, next);
				},
			});
		}

		return list;
	}
}

// ---------------------------------------------------------------------------
// Hotkey list
// ---------------------------------------------------------------------------

function openHotkeySettings(app: App) {
	const setting = (app as AppInternals).setting;
	if (!setting) return;
	setting.open();
	setting.openTabById("hotkeys");
	const tab = setting.activeTab;
	if (tab?.searchComponent && tab.updateHotkeyVisibility) {
		tab.searchComponent.setValue("Excalidraw Hotkeys");
		tab.updateHotkeyVisibility();
	} else {
		new Notice("Search for Excalidraw Hotkeys");
	}
}

function hotkeyRows(plugin: ExcalidrawHotkeys) {
	const all = [
		...plugin.visibleActions().map((a) => ({ id: a.id, name: a.name, group: a.group })),
		{ id: "show-hotkeys", name: "Show my hotkeys", group: "Other" },
	];
	return all.map((r) => ({ ...r, keys: plugin.hotkeysFor(r.id).map(hotkeyLabel) }));
}

function hotkeyMarkdown(plugin: ExcalidrawHotkeys): string {
	const rows = hotkeyRows(plugin);
	const groups = [...new Set(rows.map((r) => r.group))];
	const out = [
		"# Excalidraw Hotkeys",
		"",
		"Your keys right now. Change them in Settings → Hotkeys. Run **Show my hotkeys** and press **Save as note** to update this note.",
		"",
	];
	for (const g of groups) {
		out.push(`## ${g}`, "", "| Command | Key | ID |", "|---|---|---|");
		for (const r of rows.filter((x) => x.group === g)) {
			const keys = r.keys.length ? r.keys.map((k) => `\`${k}\``).join(", ") : "none";
			out.push(`| ${r.name} | ${keys} | \`excalidraw-hotkeys:${r.id}\` |`);
		}
		out.push("");
	}
	out.push(
		"## Not in the Hotkeys menu",
		"",
		"- Hold two arrow keys to move on a diagonal. Hold Shift too for a bigger step.",
		`- Zoom presets now: ${plugin.settings.zoomPresets.map((p) => `${p}%`).join(", ")}.`,
		"",
	);
	return out.join("\n");
}

class HotkeyListModal extends Modal {
	constructor(app: App, private plugin: ExcalidrawHotkeys) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText("My hotkeys");
		const rows = hotkeyRows(this.plugin);

		const bar = contentEl.createDiv({ cls: "ekh-bar" });
		const search = bar.createEl("input", { type: "search", placeholder: "Filter" });
		const changeBtn = bar.createEl("button", { text: "Change keys" });
		const saveBtn = bar.createEl("button", { text: "Save as note", cls: "mod-cta" });

		const table = contentEl.createEl("table", { cls: "ekh-table" });
		const body = table.createEl("tbody");
		const render = (q: string) => {
			body.empty();
			let group = "";
			for (const r of rows) {
				const hay = `${r.name} ${r.keys.join(" ")} ${r.group}`.toLowerCase();
				if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
				if (r.group !== group) {
					group = r.group;
					body.createEl("tr").createEl("th", { text: group, attr: { colspan: "2" } });
				}
				const tr = body.createEl("tr");
				tr.createEl("td", { text: r.name });
				const keyCell = tr.createEl("td");
				if (r.keys.length === 0) keyCell.createSpan({ text: "none", cls: "ekh-none" });
				for (const k of r.keys) keyCell.createEl("kbd", { text: k });
			}
		};
		render("");
		search.addEventListener("input", () => render(search.value.toLowerCase().trim()));
		search.focus();

		changeBtn.addEventListener("click", () => {
			this.close();
			openHotkeySettings(this.app);
		});
		const saveNote = async () => {
			const path = normalizePath(this.plugin.settings.notePath || DEFAULT_SETTINGS.notePath);
			const text = hotkeyMarkdown(this.plugin);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) await this.app.vault.modify(file, text);
			else await this.app.vault.create(path, text);
			new Notice(`Saved to ${path}`);
		};
		saveBtn.addEventListener("click", () => void saveNote());
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

type NumberKey = "nudgeStep" | "nudgeStepShift" | "resizePercent" | "duplicateGap" | "fitPadding" | "zoomMs";
type ToggleKey = "catchKeysFirst" | "showStatusColours" | "showOneByOne" | "shiftGoesBack" | "diagonalNudge" | "copyText" | "copyFill" | "zoomOnSelection";

function parseZoomPresets(v: string): number[] {
	return v
		.split(/[,\s]+/)
		.map((x) => parseFloat(x))
		.filter((x) => Number.isFinite(x) && x >= 10 && x <= 3000)
		.slice(0, ZOOM_SLOTS);
}

class HotkeySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ExcalidrawHotkeys) {
		super(app, plugin);
	}

	// Declared settings, so they show in settings search.
	getSettingDefinitions(): SettingDefinitionItem[] {
		const slider = (name: string, desc: string, key: NumberKey, min: number, max: number, step = 1): SettingDefinition => ({
			name,
			desc,
			control: { type: "slider", key, min, max, step },
		});
		const toggle = (name: string, desc: string, key: ToggleKey): SettingDefinition => ({
			name,
			desc,
			control: { type: "toggle", key },
		});

		const st = this.plugin.settings;
		return [
			{
				type: "group",
				items: [
					{
						name: "Show my hotkeys",
						desc: "See the key for every command.",
						action: () => new HotkeyListModal(this.app, this.plugin).open(),
					},
					{
						name: "Change keys",
						desc: "Open Settings, Hotkeys for this plugin.",
						action: () => openHotkeySettings(this.app),
					},
				],
			},
			{
				type: "group",
				items: [
					{
						type: "page",
						name: "Keys",
						desc: "Suggested keys, hidden commands and the hotkey note.",
						items: [
							{
								type: "group",
								items: [
									{
										name: "Use suggested keys",
										desc: "Give each command without a key its suggested key.",
										action: () => {
											void this.plugin.applySuggestedKeys().then((n) => {
												new Notice(n === 0 ? "Every command already has a key" : `Set ${n} keys`);
											});
										},
									},
									{
										name: "Reset all keys to suggested",
										desc: "Replace every key of this plugin with its suggested key.",
										action: () => {
											void this.plugin.applySuggestedKeys(true).then((n) => new Notice(`Reset ${n} keys`));
										},
									},
									toggle("Shift goes back", "Alt+Shift with a cycle key goes back one step, for line style, line width, fill style, font, align and arrowheads. Turn off to free those keys.", "shiftGoesBack"),
									toggle("Show one-by-one commands", "Also list a command for each line style, line width, font, font size, align and arrowhead.", "showOneByOne"),
									toggle("Catch keys before Excalidraw", "Run these hotkeys before Excalidraw's own keys can use them.", "catchKeysFirst"),
									{
										name: "Hotkey note",
										desc: "Where Save as note writes the list.",
										control: { type: "text", key: "notePath", placeholder: DEFAULT_SETTINGS.notePath },
									},
								],
							},
						],
					},
					{
						type: "page",
						name: "Colours",
						desc: "The 8 pen colours and 8 fill colours.",
						items: [
							{
								type: "group",
								items: [
									{ name: "Change a colour", desc: "Click its circle. The square next to it shows how it looks in the drawing." },
									toggle("Colours in the status bar", "Show the pen and fill colour at the bottom right while a drawing is open.", "showStatusColours"),
								],
							},
							this.colourGroup("Pen colours: lines, arrows and text", "stroke"),
							this.colourGroup("Fill colours: inside of shapes", "fill"),
						],
					},
					{
						type: "page",
						name: "Zoom",
						desc: "Zoom presets and speed.",
						displayValue: () => st.zoomPresets.map((z) => `${z}%`).join(", "),
						items: [
							{
								type: "group",
								items: [
									{
										name: "Zoom presets",
										desc: `Percent, separated by commas. Up to ${ZOOM_SLOTS}. Preset 1 is the first number.`,
										control: {
											type: "text",
											key: "zoomPresets",
											placeholder: "25, 50, 100, 200, 400",
											validate: (v) => (parseZoomPresets(v).length === 0 ? "Type at least one percent from 10 to 3000" : undefined),
										},
									},
									slider("Zoom speed", "Milliseconds for one zoom. 0 is instant.", "zoomMs", 0, 1500, 50),
									toggle("Zoom on the selection", "With something selected, zoom moves to it.", "zoomOnSelection"),
								],
							},
						],
					},
					{
						type: "page",
						name: "Duplicate",
						desc: "What a copy keeps, and the gap to it.",
						items: [
							{
								type: "group",
								items: [
									toggle("Copy keeps text", "The copy gets the same label as the box.", "copyText"),
									toggle("Copy keeps fill", "The copy gets the same fill as the box.", "copyFill"),
									slider("Duplicate gap", "Space between a box and its copy.", "duplicateGap", 10, 300),
								],
							},
						],
					},
					{
						type: "page",
						name: "Moving and sizing",
						desc: "Diagonal move, resize step and fit padding.",
						items: [
							{
								type: "group",
								items: [
									toggle("Diagonal move", "Hold two arrow keys to move the selection on a diagonal.", "diagonalNudge"),
									slider("Diagonal step", "Pixels per key press.", "nudgeStep", 1, 50),
									slider("Diagonal step with Shift", "Pixels per key press with Shift held.", "nudgeStepShift", 1, 100),
									slider("Resize step", "Percent per key press.", "resizePercent", 1, 50),
									slider("Fit padding", "Space around the text after Fit box to text.", "fitPadding", 0, 100),
								],
							},
						],
					},
				],
			},
		];
	}

	/** One row per colour: its key, how it looks in the drawing, a picker and a reset. */
	private colourGroup(heading: string, kind: "stroke" | "fill"): SettingDefinitionItem {
		const st = this.plugin.settings;
		const list = () => (kind === "stroke" ? st.strokeColours : st.fillColours);
		const defaults = kind === "stroke" ? DEFAULT_SETTINGS.strokeColours : DEFAULT_SETTINGS.fillColours;
		const id = (i: number) => `${kind === "stroke" ? "stroke" : "fill"}-colour-${i + 1}`;
		return {
			type: "group",
			heading,
			items: [
				...COLOUR_NAMES.map(
					(colour, i): SettingDefinition => ({
						name: `${i + 1}. ${colour}`,
						desc: this.plugin.hotkeysFor(id(i)).map(hotkeyLabel).join(", ") || "No key",
						aliases: ["colour", "color", kind, kind === "stroke" ? "pen" : "fill"],
						render: (setting) => {
							const preview = setting.controlEl.createSpan({
								cls: "ekh-swatch ekh-preview",
								attr: { "aria-label": "How it looks in the drawing" },
							});
							const show = (v: string) => preview.setCssProps({ "--ekh-swatch": v });
							show(list()[i]);
							setting
								.addColorPicker((p) =>
									p.setValue(list()[i]).onChange(async (v) => {
										list()[i] = v;
										show(v);
										await this.plugin.saveSettings();
									}),
								)
								.addExtraButton((b) =>
									b
										.setIcon("rotate-ccw")
										.setTooltip("Reset")
										.onClick(async () => {
											list()[i] = defaults[i];
											await this.plugin.saveSettings();
											this.update();
										}),
								);
						},
					}),
				),
			],
		};
	}

	getControlValue(key: string): unknown {
		if (key === "zoomPresets") return this.plugin.settings.zoomPresets.join(", ");
		return this.plugin.settings[key as keyof HotkeySettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const st = this.plugin.settings;
		if (key === "zoomPresets") {
			const nums = parseZoomPresets(String(value));
			if (nums.length === 0) return;
			st.zoomPresets = nums;
		} else if (key === "notePath") {
			st.notePath = String(value).trim() || DEFAULT_SETTINGS.notePath;
		} else if (typeof value === "number") {
			st[key as NumberKey] = value;
		} else if (typeof value === "boolean") {
			st[key as ToggleKey] = value;
		}
		await this.plugin.saveSettings();
		if (key === "showOneByOne" || key === "shiftGoesBack") this.plugin.registerCommands();
	}
}
