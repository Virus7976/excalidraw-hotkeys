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
	Scope,
	Setting,
	SettingDefinition,
	SettingDefinitionItem,
	SuggestModal,
	TFile,
	normalizePath,
} from "obsidian";
import { FILLER, match, rank, wordScore, words } from "./smart";

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
	welcomed: boolean;
	whichKey: boolean;
	whichKeyDelay: number;
	presets: (Preset | null)[];
	presetBar: boolean;
	/** The letter for each built-in leader menu, by menu id. Empty turns a menu off. */
	leaderMenuKeys: Record<string, string>;
	leaderCustom: LeaderCustom[];
	/** Plain letter per tool command id, used only inside a drawing. */
	toolKeys: Record<string, string>;
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
	welcomed: false,
	whichKey: true,
	whichKeyDelay: 500,
	presets: Array<Preset | null>(9).fill(null),
	presetBar: true,
	leaderMenuKeys: {},
	leaderCustom: [],
	toolKeys: {
		"tool-select": "V",
		"tool-rectangle": "R",
		"tool-diamond": "D",
		"tool-ellipse": "C",
		"tool-arrow": "A",
		"tool-line": "S",
		"tool-pen": "W",
		"tool-text": "T",
		"tool-eraser": "E",
		"tool-frame": "F",
		delete: "X",
		"nav-up": "Shift+W",
		"nav-left": "Shift+A",
		"nav-down": "Shift+S",
		"nav-right": "Shift+D",
		"follow-arrow": "Shift+F",
		"follow-arrow-back": "Shift+R",
		leader: "Backquote",
		repeat: "G",
	},
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
	startBinding?: { elementId: string } | null;
	endBinding?: { elementId: string } | null;
	points?: [number, number][];
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
	setActiveTool?(tool: { type: string }): void;
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
interface CommandsApi {
	commands?: Record<string, { id: string; name: string }>;
	executeCommandById(id: string): boolean;
	listCommands?(): { id: string; name: string }[];
}

type AppInternals = App & { hotkeyManager?: HotkeyManager; setting?: SettingWindow; commands?: CommandsApi };

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

/** A set of style values. Values left out stay as they are. */
interface Style {
	stroke?: string;
	fill?: string;
	fillStyle?: string;
	strokeWidth?: number;
	strokeStyle?: string;
	opacity?: number;
	fontFamily?: number;
	fontSize?: number;
	textAlign?: string;
	startArrowhead?: string | null;
	endArrowhead?: string | null;
}

interface Preset {
	name: string;
	style: Style;
	/** True while the name is made from the style; a name the user typed stays. */
	auto?: boolean;
}

/** Where each style value lives on the pen, in Excalidraw's app state. */
const PEN_KEYS: Record<keyof Style, string> = {
	stroke: "currentItemStrokeColor",
	fill: "currentItemBackgroundColor",
	fillStyle: "currentItemFillStyle",
	strokeWidth: "currentItemStrokeWidth",
	strokeStyle: "currentItemStrokeStyle",
	opacity: "currentItemOpacity",
	fontFamily: "currentItemFontFamily",
	fontSize: "currentItemFontSize",
	textAlign: "currentItemTextAlign",
	startArrowhead: "currentItemStartArrowhead",
	endArrowhead: "currentItemEndArrowhead",
};

/** One step of a key sequence: a menu of keys, or a thing to do. */
interface LeaderNode {
	label: string;
	children?: Map<string, LeaderNode>;
	run?: (c: Ctx) => unknown;
}

/** One thing the search can find: a style, several styles at once, or a command. */
interface SearchItem {
	label: string;
	hint: string;
	words: string[];
	kind: string;
	style?: Style;
	run?: (c: Ctx) => unknown;
}

/** A key sequence of your own after the leader key, for any command. */
interface LeaderCustom {
	keys: string;
	command: string;
}

/** The built-in leader menus: id, name and suggested letter. */
const LEADER_MENUS: [string, string, string][] = [
	["pen", "Pen colour", "C"],
	["fill", "Fill colour", "F"],
	["width", "Line width", "W"],
	["linestyle", "Line style", "S"],
	["fillstyle", "Fill style", "H"],
	["font", "Font", "T"],
	["size", "Font size", "Z"],
	["align", "Text align", "A"],
	["heads", "Arrowheads", "E"],
	["opacity", "Opacity", "O"],
	["presets", "Pen presets", "P"],
	["zoom", "Zoom", "V"],
	["arrange", "Line up and spread", "L"],
	["search", "Search", "Slash"],
];

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
	const api = c.ea.getExcalidrawAPI?.();
	if (c.typing && api) {
		// The text editor is open: change the scene directly so the editor keeps going.
		const ids = new Set(els.map((x) => x.id));
		const elements = api.getSceneElementsIncludingDeleted().map((x: El) => {
			if (!ids.has(x.id)) return x;
			const y = { ...x };
			fn(y);
			return { ...y, version: (x.version ?? 1) + 1, versionNonce: newSeed() };
		});
		api.updateScene({ elements, captureUpdate: "IMMEDIATELY" });
		return;
	}
	c.ea.copyViewElementsToEAforEditing(els);
	for (const el of c.ea.getElements()) fn(el);
	await c.ea.addElementsToView(false, true);
}

let colourNotice: Notice | null = null;
/** Stops the tool key button that is waiting for a key, if any. */
let stopRecording: (() => void) | null = null;
let statusRefresh: (() => void) | null = null;

/** A short popup with a colour square and its name. Replaces the last one. */
function showColour(label: string, colour: string) {
	colourNotice?.hide();
	const frag = activeDocument.createDocumentFragment();
	const row = frag.createDiv({ cls: "ekh-colour-notice" });
	const sw = row.createSpan({ cls: "ekh-swatch" });
	if (colour === "transparent") sw.addClass("is-none");
	else sw.setCssProps({ "--ekh-swatch": colour });
	row.createSpan({ text: label });
	colourNotice = new Notice(frag, 1200);
}

/** A short popup with text only. Replaces the last one. */
function showInfo(label: string) {
	colourNotice?.hide();
	colourNotice = new Notice(label, 1200);
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

/** A key press as text, like "Alt+Shift+W". Empty for a modifier on its own. */
function comboOf(e: KeyboardEvent): string {
	if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(e.code)) return "";
	const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
	const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && (Platform.isMacOS ? "Cmd" : "Win")].filter(Boolean);
	return [...mods, key].join("+");
}

const COMBO_LABEL: Record<string, string> = {
	Backquote: "`", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
	BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backslash: "\\",
	ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};

/** A saved combo as people read it: "Backquote" shows as "`". */
function comboLabel(combo: string): string {
	return combo
		.split("+")
		.map((p) => COMBO_LABEL[p] ?? p)
		.join("+");
}

const isModifierCode = (code: string) => /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code);

/** The modifier names held, from the physical keys down right now. */
/** The modifiers held during a key event. Read from the event, so a lost key-up can never leave one stuck. */
function modsOf(e: KeyboardEvent): string[] {
	const out: string[] = [];
	if (e.ctrlKey) out.push("Ctrl");
	if (e.altKey) out.push("Alt");
	if (e.shiftKey) out.push("Shift");
	if (e.metaKey) out.push("Meta");
	return out;
}

/** A command name without the part in brackets, for the small key panels. */
const shortName = (name: string) => name.replace(/\s*\([^)]*\)/g, "").replace(/^Tool: /, "");

/** A plain name for any colour, from its hue. */
function hueName(hex: string): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return hex;
	const n = parseInt(m[1], 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
	if (sat < 0.15 || max - min < 0.08) return l < 0.2 ? "Black" : l > 0.85 ? "White" : "Grey";
	let h = 0;
	if (max === r) h = ((g - b) / (max - min) + 6) % 6;
	else if (max === g) h = (b - r) / (max - min) + 2;
	else h = (r - g) / (max - min) + 4;
	h *= 60;
	const name = h < 15 ? "Red" : h < 33 ? "Orange" : h < 65 ? "Yellow" : h < 165 ? "Green" : h < 200 ? "Teal" : h < 255 ? "Blue" : h < 290 ? "Purple" : h < 340 ? "Pink" : "Red";
	return name;
}

/** The name of colour slot i: its usual name, or a name from its hue once you change it. */
function slotName(kind: "stroke" | "fill", i: number, colour: string): string {
	const defaults = kind === "stroke" ? DEFAULT_SETTINGS.strokeColours : DEFAULT_SETTINGS.fillColours;
	if ((defaults[i] ?? "").toLowerCase() === colour.toLowerCase()) return COLOUR_NAMES[i];
	return hueName(colour);
}

function colourName(kind: "stroke" | "fill", list: string[], value: string | undefined): string {
	if (value === undefined) return "";
	if (value === "transparent") return "none";
	const i = list.findIndex((c) => c.toLowerCase() === value.toLowerCase());
	if (i < 0) return hueName(value).toLowerCase();
	return slotName(kind, i, value).toLowerCase();
}

/** A style in a few words, like "blue pen, bold, dashed". */
function describeStyle(s: Style, st: HotkeySettings): string {
	const parts: string[] = [];
	if (s.stroke !== undefined) parts.push(s.stroke === "transparent" ? "no line" : `${colourName("stroke", st.strokeColours, s.stroke)} pen`);
	if (s.fill !== undefined) parts.push(s.fill === "transparent" ? "no fill" : `${colourName("fill", st.fillColours, s.fill)} fill`);
	if (s.fillStyle !== undefined && s.fill !== "transparent") parts.push(s.fillStyle);
	if (s.strokeWidth !== undefined) parts.push(LINE_WIDTHS.find((w) => w[2] === s.strokeWidth)?.[1].toLowerCase() ?? `width ${s.strokeWidth}`);
	if (s.strokeStyle !== undefined && s.strokeStyle !== "solid") parts.push(s.strokeStyle);
	if (s.opacity !== undefined && s.opacity !== 100) parts.push(`${s.opacity}% opacity`);
	// Older drawings use older font numbers: 1 is hand-drawn, 2 normal and 3 code.
	const font = s.fontFamily === undefined ? undefined : ({ 1: "hand-drawn", 2: "normal", 3: "code" } as Record<number, string>)[s.fontFamily] ?? FONTS.find((f) => f[2] === s.fontFamily)?.[1].toLowerCase();
	if (font) parts.push(`${font} font`);
	if (s.fontSize !== undefined) parts.push(FONT_SIZES.some((f) => f[1] === s.fontSize) ? `${FONT_SIZES.find((f) => f[1] === s.fontSize)?.[0]} text` : `text size ${s.fontSize}`);
	if (s.textAlign !== undefined && s.textAlign !== "left") parts.push(`align ${s.textAlign === "center" ? "centre" : s.textAlign}`);
	if (s.startArrowhead !== undefined || s.endArrowhead !== undefined) {
		const a = !!s.startArrowhead;
		const b = !!s.endArrowhead;
		parts.push(a && b ? "both arrowheads" : a ? "start arrowhead" : b ? "end arrowhead" : "no arrowheads");
	}
	return parts.join(", ") || "empty";
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
		this.registerDomEvent(window, "keyup", (e) => this.onKeyUp(e), { capture: true });
		this.registerDomEvent(window, "blur", () => {
			this.pressed.clear();
			this.stopWhichKey();
			this.endLeader();
		});
		this.registerDomEvent(window, "mousedown", () => this.endLeader(), { capture: true });
		this.app.workspace.onLayoutReady(() => this.welcome());

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
							void this.runAction(a, c);
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
		this.updateBar();
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
		swatch("Pen", stroke);
		swatch("Fill", fill);
	}

	onunload() {
		statusRefresh = null;
		stopRecording?.();
		window.clearTimeout(this.whichTimer);
		this.hidePanel();
		this.barEl?.remove();
		window.cancelAnimationFrame(this.zoomFrame);
	}

	async loadSettings() {
		const saved = ((await this.loadData()) ?? {}) as Partial<HotkeySettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.settings.fillColours = [...(saved.fillColours ?? DEFAULT_SETTINGS.fillColours)];
		this.settings.strokeColours = [...(saved.strokeColours ?? DEFAULT_SETTINGS.strokeColours)];
		this.settings.zoomPresets = [...(saved.zoomPresets ?? DEFAULT_SETTINGS.zoomPresets)];
		this.settings.toolKeys = { ...DEFAULT_SETTINGS.toolKeys, ...(saved.toolKeys ?? {}) };
		// A new drawing key steps aside when you already use its key for something else.
		const used = new Set(Object.values(saved.toolKeys ?? {}).map((k) => k.toUpperCase()));
		for (const [id, key] of Object.entries(DEFAULT_SETTINGS.toolKeys)) {
			if (saved.toolKeys && !(id in saved.toolKeys) && used.has(key.toUpperCase())) this.settings.toolKeys[id] = "";
		}
		this.settings.leaderMenuKeys = { ...(saved.leaderMenuKeys ?? {}) };
		this.settings.leaderCustom = (saved.leaderCustom ?? []).map((s) => ({ ...s }));
		this.settings.presets = Array.from({ length: 9 }, (_, i) => saved.presets?.[i] ?? null);
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
			if (!a.keys || (hm.customKeys?.[full] ?? []).length > 0) continue;
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
		if (this.leader) return this.onLeaderKey(e);
		if (isModifierCode(e.code)) {
			if (!e.repeat) this.armWhichKey(e);
		} else this.stopWhichKey();

		if (this.settings.diagonalNudge && this.tryDiagonalNudge(e)) return;
		if (this.tryToolKey(e)) return;
		if (!this.settings.catchKeysFirst) return;

		for (const a of this.visibleActions()) {
			if (!this.hotkeysFor(a.id).some((h) => matches(h, e))) continue;
			const c = this.context();
			if (this.justRan === a.id) return;
			if (!c || (c.typing && !a.whileTyping)) continue;
			if (!a.canRun(c)) {
				// Our key, nothing to change. Keep it from Excalidraw unless another command uses it.
				if (c.typing || this.otherCommandUses(e)) continue;
				e.preventDefault();
				e.stopImmediatePropagation();
				showInfo(c.selected.length === 0 ? "Select something first" : "This key does not change what is selected");
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			this.markRan(a.id);
			void this.runAction(a, c);
			return;
		}
	}

	// -----------------------------------------------------------------------
	// Style engine: one rule for every style key
	// -----------------------------------------------------------------------

	/** The text being typed, read fresh from the scene. */
	private liveTyped(c: Ctx): El | null {
		if (!c.typing) return null;
		const id = c.typing.id;
		return c.ea.getExcalidrawAPI?.()?.getSceneElementsIncludingDeleted().find((x: El) => x.id === id) ?? null;
	}

	/**
	 * Something selected: change it. Nothing selected: change the pen.
	 * Typing a text: change that text. False when nothing could change.
	 */
	async applyStyle(c: Ctx, s: Style, label: string): Promise<boolean> {
		const api = c.ea.getExcalidrawAPI?.();
		if (!api) return false;
		const keys = Object.keys(s) as (keyof Style)[];
		const fits = (el: El, k: keyof Style): boolean => {
			const text = el.type === "text";
			if (k === "stroke" || k === "opacity") return true;
			if (k === "fill") return !text && !LINEAR.includes(el.type);
			if (k === "fillStyle") return SHAPES.includes(el.type);
			if (k === "strokeWidth" || k === "strokeStyle") return !text && el.type !== "image";
			if (k === "fontFamily" || k === "fontSize" || k === "textAlign") return text;
			return el.type === "arrow";
		};
		// A fill style on a shape with no fill would show nothing, so give it a fill too.
		const autoFill = s.fillStyle !== undefined && s.fill === undefined;
		const penFill = api.getAppState().currentItemBackgroundColor;
		const fillColour = penFill && penFill !== "transparent" ? penFill : this.settings.fillColours[2];
		const put = (el: El) => {
			for (const k of keys) {
				if (!fits(el, k)) continue;
				if (k === "stroke") el.strokeColor = s.stroke as string;
				else if (k === "fill") el.backgroundColor = s.fill as string;
				else (el as unknown as Record<string, unknown>)[k] = s[k];
			}
			if (autoFill && SHAPES.includes(el.type) && el.backgroundColor === "transparent") el.backgroundColor = fillColour;
		};

		if (c.typing) {
			const t = this.liveTyped(c);
			if (!t || !keys.some((k) => fits(t, k))) return false;
			await edit(c, [t], put);
			this.say(label, s);
			return true;
		}
		if (c.selected.length > 0) {
			const els = withBoundText(c).filter((el) => keys.some((k) => fits(el, k)));
			if (els.length === 0) {
				showInfo("This does not change what is selected");
				return false;
			}
			c.ea.copyViewElementsToEAforEditing(els);
			for (const el of c.ea.getElements()) {
				put(el);
				if (el.type === "text") c.ea.refreshTextElementSize?.(el.id);
			}
			await c.ea.addElementsToView(false, true);
			this.say(label, s);
			return true;
		}
		const patch: Record<string, unknown> = {};
		for (const k of keys) patch[PEN_KEYS[k]] = s[k];
		if (autoFill && api.getAppState().currentItemBackgroundColor === "transparent") patch[PEN_KEYS.fill] = fillColour;
		api.updateScene({ appState: patch, captureUpdate: "NEVER" });
		statusRefresh?.();
		this.say(`Pen: ${label}`, s);
		return true;
	}

	private say(label: string, s: Style) {
		const keys = Object.keys(s);
		const colour = keys.length === 1 ? (s.stroke ?? s.fill) : undefined;
		if (colour !== undefined) showColour(label, colour);
		else showInfo(label);
	}

	/** The style of the selection (the shape and its text), or of the pen. */
	currentStyle(c: Ctx): Style {
		const s: Style = {};
		if (c.selected.length > 0) {
			const els = withBoundText(c);
			const shape = els.find((e) => e.type !== "text");
			const text = els.find((e) => e.type === "text");
			const base = shape ?? text;
			if (base) {
				s.stroke = base.strokeColor;
				s.opacity = base.opacity ?? 100;
			}
			if (shape) {
				if (!LINEAR.includes(shape.type)) s.fill = shape.backgroundColor;
				if (SHAPES.includes(shape.type)) s.fillStyle = shape.fillStyle;
				s.strokeWidth = shape.strokeWidth;
				s.strokeStyle = shape.strokeStyle;
				if (shape.type === "arrow") {
					s.startArrowhead = shape.startArrowhead ?? null;
					s.endArrowhead = shape.endArrowhead ?? null;
				}
			}
			if (text) {
				s.fontFamily = text.fontFamily;
				s.fontSize = text.fontSize;
				s.textAlign = text.textAlign;
			}
		} else {
			const st = c.ea.getExcalidrawAPI?.()?.getAppState() as unknown as Record<string, unknown> | undefined;
			for (const k of Object.keys(PEN_KEYS) as (keyof Style)[]) {
				const v = st?.[PEN_KEYS[k]];
				if (v !== undefined) (s as Record<string, unknown>)[k] = v;
			}
		}
		return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
	}

	async savePreset(c: Ctx, i: number) {
		const style = this.currentStyle(c);
		const old = this.settings.presets[i];
		const keepName = old && !old.auto;
		const name = keepName ? old.name : describeStyle(style, this.settings);
		this.settings.presets[i] = { name, style, auto: !keepName };
		await this.saveSettings();
		showInfo(`Saved preset ${i + 1}: ${name}`);
	}

	async usePreset(c: Ctx, i: number) {
		const p = this.settings.presets[i];
		if (!p) {
			showInfo(`Preset ${i + 1} is empty. Save one first.`);
			return;
		}
		await this.applyStyle(c, p.style, p.name);
	}

	// -----------------------------------------------------------------------
	// Key panel: the which-key helper and the leader menu share it
	// -----------------------------------------------------------------------

	private panelEl: HTMLElement | null = null;

	private showPanel(title: string, rows: [string, string][], footer: string) {
		this.hidePanel();
		const doc = activeDocument;
		const el = doc.body.createDiv({ cls: "ekh-panel" });
		el.createDiv({ cls: "ekh-panel-title", text: title });
		const grid = el.createDiv({ cls: "ekh-panel-grid" });
		if (rows.length === 0) grid.createDiv({ cls: "ekh-none", text: "No keys here yet." });
		for (const [key, label] of rows) {
			const row = grid.createDiv({ cls: "ekh-panel-row" });
			row.createEl("kbd", { text: key });
			row.createSpan({ text: label });
		}
		if (footer) el.createDiv({ cls: "ekh-panel-footer", text: footer });
		this.panelEl = el;
	}

	private hidePanel() {
		this.panelEl?.remove();
		this.panelEl = null;
	}

	// Which-key: hold modifiers for a moment to see every key that uses them.
	private whichTimer = 0;
	private whichMods = "";

	private armWhichKey(e: KeyboardEvent) {
		window.clearTimeout(this.whichTimer);
		if (!this.settings.whichKey || this.leader) return;
		const c = this.context();
		if (!c || c.typing) return;
		// The panel is up already: switch it to the new modifiers at once.
		const wait = this.whichMods ? 0 : this.settings.whichKeyDelay;
		// A key other than a modifier stops this timer, in onKeyDown.
		const mods = modsOf(e);
		this.whichTimer = window.setTimeout(() => {
			if (mods.length > 0) this.showWhichKey(mods);
		}, wait);
	}

	private stopWhichKey() {
		window.clearTimeout(this.whichTimer);
		if (this.whichMods && !this.leader) this.hidePanel();
		this.whichMods = "";
	}

	/** Rows for one set of modifiers: the Obsidian hotkeys and the drawing keys that use exactly them. */
	/** A command name for the panel. Colour keys say which colour: "Pen colour 3: Blue". */
	private panelName(a: Action): string {
		const m = /^(stroke|fill)-colour-(\d)$/.exec(a.id);
		if (!m) return shortName(a.name);
		const kind = m[1] as "stroke" | "fill";
		const i = Number(m[2]) - 1;
		const col = (kind === "stroke" ? this.settings.strokeColours : this.settings.fillColours)[i];
		return col ? `${kind === "stroke" ? "Pen" : "Fill"} colour ${i + 1}: ${slotName(kind, i, col)}` : shortName(a.name);
	}

	keysWithMods(mods: string[]): [string, string][] {
		const want = [...mods].sort().join("+");
		const rows: [string, string][] = [];
		const norm = (m: string) => (m === "Mod" ? (Platform.isMacOS ? "Meta" : "Ctrl") : m);
		for (const a of this.visibleActions()) {
			for (const h of this.hotkeysFor(a.id)) {
				if ([...h.modifiers].map(norm).sort().join("+") !== want) continue;
				rows.push([KEY_LABEL[h.key] ?? h.key.toUpperCase(), this.panelName(a)]);
			}
		}
		for (const [id, combo] of Object.entries(this.settings.toolKeys)) {
			if (!combo) continue;
			const parts = combo.split("+");
			const key = parts.pop() as string;
			const m = parts.map((p) => (p === "Win" || p === "Cmd" ? "Meta" : p));
			if ([...m].sort().join("+") !== want) continue;
			const a = this.actions.find((x) => x.id === id);
			if (a) rows.push([comboLabel(key), shortName(a.name)]);
		}
		return rows.sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }));
	}

	private showWhichKey(mods: string[]) {
		const label = mods.map((m) => (m === "Meta" ? (Platform.isMacOS ? "Cmd" : "Win") : m === "Alt" && Platform.isMacOS ? "Option" : m)).join("+");
		this.whichMods = label;
		this.showPanel(`${label} +`, this.keysWithMods(mods), "Let go to hide.");
	}

	private onKeyUp(e: KeyboardEvent) {
		this.pressed.delete(e.code);
		if (!isModifierCode(e.code)) return;
		const mods = modsOf(e);
		if (mods.length === 0) this.stopWhichKey();
		else if (this.whichMods) this.showWhichKey(mods);
	}

	// -----------------------------------------------------------------------
	// Leader key: press it, then a short sequence of plain keys
	// -----------------------------------------------------------------------

	private leader: LeaderNode | null = null;
	private leaderPath: string[] = [];

	startLeader() {
		const c = this.context();
		if (!c || c.typing) return;
		this.stopWhichKey();
		this.leader = this.leaderTree();
		this.leaderPath = [];
		this.showLeader();
	}

	endLeader() {
		if (!this.leader) return;
		this.leader = null;
		this.hidePanel();
	}

	private showLeader() {
		const node = this.leader;
		if (!node) return;
		const rows: [string, string][] = [...(node.children ?? new Map<string, LeaderNode>())].map(([k, n]) => [
			comboLabel(k),
			n.children ? `${n.label}...` : n.label,
		]);
		const path = ["Leader", ...this.leaderPath].join(" › ");
		const lead = comboLabel(this.settings.toolKeys.leader || "");
		const footer = this.leaderPath.length === 0 && lead ? `${lead} again: search. Esc: cancel.` : "Esc: cancel.";
		this.showPanel(path, rows, footer);
	}

	private onLeaderKey(e: KeyboardEvent) {
		if (isModifierCode(e.code)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		const node = this.leader;
		if (!node) return;
		const combo = comboOf(e);
		if (e.key === "Escape") return this.endLeader();
		if (this.leaderPath.length === 0 && combo.toUpperCase() === (this.settings.toolKeys.leader || "").toUpperCase()) {
			this.endLeader();
			this.openSearch();
			return;
		}
		const next = [...(node.children ?? new Map<string, LeaderNode>())].find(([k]) => k.toUpperCase() === combo.toUpperCase())?.[1];
		if (!next) {
			this.endLeader();
			showInfo(`No key ${comboLabel(combo)} here`);
			return;
		}
		if (next.children) {
			this.leader = next;
			this.leaderPath.push(next.label);
			this.showLeader();
			return;
		}
		this.endLeader();
		const c = this.context();
		if (c && next.run) void this.tracked(c, () => next.run?.(c));
	}

	/** The menu behind the leader key. Letters are picked to be easy to remember, and can be changed in Settings. */
	leaderTree(withCustom = true): LeaderNode {
		const st = this.settings;
		const menu = (label: string, entries: [string, LeaderNode][]): LeaderNode => ({ label, children: new Map(entries) });
		const leaf = (label: string, run: (c: Ctx) => unknown): LeaderNode => ({ label, run });
		const style = (label: string, s: Style) => leaf(label, (c) => this.applyStyle(c, s, label));
		const digits = <T,>(list: T[], make: (t: T, i: number) => LeaderNode): [string, LeaderNode][] =>
			list.map((t, i) => [String(i + 1), make(t, i)]);
		const lineUp = (label: string, mode: Parameters<ExcalidrawHotkeys["arrange"]>[1]) => leaf(label, (c) => this.arrange(c, mode));

		const menus: Record<string, LeaderNode> = {
			pen: menu("Pen colour", [["0", style("No line", { stroke: "transparent" })], ...digits(st.strokeColours, (col, i) => style(slotName("stroke", i, col), { stroke: col }))]),
			fill: menu("Fill colour", [["0", style("No fill", { fill: "transparent" })], ...digits(st.fillColours, (col, i) => style(slotName("fill", i, col), { fill: col }))]),
			width: menu("Line width", digits(LINE_WIDTHS, (w) => style(w[1], { strokeWidth: w[2] }))),
			linestyle: menu("Line style", [["S", style("Solid", { strokeStyle: "solid" })], ["D", style("Dashed", { strokeStyle: "dashed" })], ["O", style("Dotted", { strokeStyle: "dotted" })]]),
			fillstyle: menu("Fill style", [["N", style("No fill", { fill: "transparent" })], ["H", style("Hachure", { fillStyle: "hachure" })], ["X", style("Cross-hatch", { fillStyle: "cross-hatch" })], ["S", style("Solid", { fillStyle: "solid" })]]),
			font: menu("Font", FONTS.map((f): [string, LeaderNode] => [f[0][0].toUpperCase(), style(f[1], { fontFamily: f[2] })])),
			size: menu("Font size", [["S", style("Small", { fontSize: 16 })], ["M", style("Medium", { fontSize: 20 })], ["L", style("Large", { fontSize: 28 })], ["X", style("Very large", { fontSize: 36 })]]),
			align: menu("Text align", [["L", style("Left", { textAlign: "left" })], ["C", style("Centre", { textAlign: "center" })], ["R", style("Right", { textAlign: "right" })]]),
			heads: menu("Arrowheads", [
				["N", style("None", { startArrowhead: null, endArrowhead: null })],
				["E", style("End", { startArrowhead: null, endArrowhead: "arrow" })],
				["B", style("Both", { startArrowhead: "arrow", endArrowhead: "arrow" })],
				["S", style("Start", { startArrowhead: "arrow", endArrowhead: null })],
			]),
			opacity: menu("Opacity", [["0", style("100%", { opacity: 100 })], ...digits([1, 2, 3, 4, 5, 6, 7, 8, 9], (n) => style(`${n * 10}%`, { opacity: n * 10 }))]),
			presets: menu("Pen presets", [
				...digits(st.presets, (p, i) => leaf(p ? p.name : `Preset ${i + 1} (empty)`, (c) => this.usePreset(c, i))),
				["S", menu("Save pen as preset", digits(st.presets, (p, i) => leaf(p ? `Replace: ${p.name}` : `Preset ${i + 1} (empty)`, (c) => this.savePreset(c, i))))],
			]),
			zoom: menu("Zoom", digits(st.zoomPresets, (z, i) => leaf(`${z}%`, (c) => this.actions.find((a) => a.id === `zoom-preset-${i + 1}`)?.run(c)))),
			arrange: menu("Line up and spread", [
				["A", lineUp("Left edges", "left")],
				["D", lineUp("Right edges", "right")],
				["W", lineUp("Top edges", "top")],
				["S", lineUp("Bottom edges", "bottom")],
				["C", lineUp("Centre left to right", "centre")],
				["X", lineUp("Centre top to bottom", "middle")],
				["H", lineUp("Spread across", "across")],
				["V", lineUp("Spread down", "down")],
			]),
			search: leaf("Search styles and commands", () => this.openSearch()),
		};
		const root = menu("Leader", []);
		for (const [id, , def] of LEADER_MENUS) {
			const key = st.leaderMenuKeys[id] ?? def;
			if (key) root.children?.set(key, menus[id]);
		}
		if (withCustom) this.addCustom(root);
		return root;
	}

	// -----------------------------------------------------------------------
	// Move between shapes
	// -----------------------------------------------------------------------

	private centreOf(e: El) {
		return { x: e.x + e.width / 2, y: e.y + e.height / 2 };
	}

	/** Shapes you can move to: not arrows or lines, and a box instead of its label. */
	private stops(c: Ctx): El[] {
		return c.all.filter((e) => !e.isDeleted && e.type !== "arrow" && e.type !== "line" && !(e.type === "text" && e.containerId));
	}

	private currentStop(c: Ctx): El | null {
		const first = c.selected[0];
		if (!first) return null;
		if (first.type === "text" && first.containerId) return c.all.find((e) => e.id === first.containerId) ?? first;
		return first;
	}

	private selectOnly(c: Ctx, el: El) {
		const api = c.ea.getExcalidrawAPI?.();
		if (!api) return;
		api.updateScene({ appState: { selectedElementIds: { [el.id]: true } }, captureUpdate: "NEVER" });
		// Scroll it into view when it is near or past the edge.
		const st = api.getAppState();
		const z = st.zoom.value;
		const p = this.centreOf(el);
		const sx = (p.x + st.scrollX) * z;
		const sy = (p.y + st.scrollY) * z;
		const m = 60;
		if (sx < m || sy < m || sx > st.width - m || sy > st.height - m) {
			api.updateScene({ appState: { scrollX: st.width / 2 / z - p.x, scrollY: st.height / 2 / z - p.y }, captureUpdate: "NEVER" });
		}
	}

	/** Select the nearest shape in a direction. With nothing selected, the shape nearest the middle of the view. */
	moveSelection(c: Ctx, dx: number, dy: number) {
		const stops = this.stops(c);
		const cur = this.currentStop(c);
		if (!cur) {
			const api = c.ea.getExcalidrawAPI?.();
			const st = api?.getAppState();
			if (!st || stops.length === 0) return showInfo("Nothing to select");
			const mid = { x: st.width / 2 / st.zoom.value - st.scrollX, y: st.height / 2 / st.zoom.value - st.scrollY };
			const near = stops.reduce((a, b) => (Math.hypot(this.centreOf(a).x - mid.x, this.centreOf(a).y - mid.y) <= Math.hypot(this.centreOf(b).x - mid.x, this.centreOf(b).y - mid.y) ? a : b));
			return this.selectOnly(c, near);
		}
		const from = this.centreOf(cur);
		let best: El | null = null;
		let bestScore = Infinity;
		for (const e of stops) {
			if (e.id === cur.id) continue;
			const p = this.centreOf(e);
			const vx = p.x - from.x;
			const vy = p.y - from.y;
			const along = vx * dx + vy * dy;
			if (along <= 1) continue;
			const across = Math.abs(vx * dy - vy * dx);
			if (across > along) continue;
			const score = along + across * 2;
			if (score < bestScore) {
				bestScore = score;
				best = e;
			}
		}
		if (!best) return showInfo("No shape that way");
		this.selectOnly(c, best);
	}

	/** Select the shape at the other end of an arrow from the selected shape. */
	followArrow(c: Ctx, forward: boolean) {
		const cur = this.currentStop(c);
		if (!cur) return showInfo("Select something first");
		const targets = c.all
			.filter((a) => a.type === "arrow" && !a.isDeleted && (forward ? a.startBinding?.elementId : a.endBinding?.elementId) === cur.id)
			.map((a) => (forward ? a.endBinding?.elementId : a.startBinding?.elementId))
			.map((id) => c.all.find((e) => e.id === id && !e.isDeleted))
			.filter((e): e is El => !!e);
		if (targets.length === 0) return showInfo(forward ? "No arrow goes out of this shape" : "No arrow comes into this shape");
		// More than one: take them in reading order, top to bottom, then left to right.
		targets.sort((a, b) => a.y - b.y || a.x - b.x);
		this.selectOnly(c, targets[0]);
		if (targets.length > 1) showInfo(`${targets.length} arrows. Took the top one.`);
	}

	// -----------------------------------------------------------------------
	// Search: styles and commands, with smart matching
	// -----------------------------------------------------------------------

	searchItems(): SearchItem[] {
		const st = this.settings;
		const items: SearchItem[] = [];
		const style = (label: string, kind: string, s: Style, extra = "") =>
			items.push({ label, hint: "", kind, style: s, words: words(`${label} ${extra}`) });
		st.strokeColours.forEach((col, i) => style(`Pen colour ${i + 1}: ${slotName("stroke", i, col)}`, "pen", { stroke: col }, i === 0 ? "black ink default" : ""));
		style("No line", "pen", { stroke: "transparent" }, "none invisible outline");
		st.fillColours.forEach((col, i) => style(`Fill colour ${i + 1}: ${slotName("fill", i, col)}`, "fill", { fill: col }, i === 0 ? "black ink" : ""));
		style("No fill", "fill", { fill: "transparent" }, "none empty hollow");
		for (const [, name, w] of LINE_WIDTHS) style(`Line width: ${name}`, "width", { strokeWidth: w }, name === "Extra bold" ? "thickest heaviest" : "");
		for (const ls of LINE_STYLES) style(`Line style: ${ls}`, "linestyle", { strokeStyle: ls });
		for (const fs of ["hachure", "cross-hatch", "solid"]) style(`Fill style: ${fs}`, "fillstyle", { fillStyle: fs }, fs === "hachure" ? "hatch hatched lines" : fs === "cross-hatch" ? "crosshatch" : "full");
		for (const [, name, fam] of FONTS) style(`Font: ${name}`, "font", { fontFamily: fam });
		for (const [name, size] of FONT_SIZES) style(`Font size: ${name}`, "size", { fontSize: size }, "text");
		for (const al of ["left", "center", "right"]) style(`Text align: ${al === "center" ? "centre" : al}`, "align", { textAlign: al }, "text");
		style("Arrowheads: none", "heads", { startArrowhead: null, endArrowhead: null }, "arrow");
		style("Arrowheads: end", "heads", { startArrowhead: null, endArrowhead: "arrow" }, "arrow one");
		style("Arrowheads: both", "heads", { startArrowhead: "arrow", endArrowhead: "arrow" }, "arrow two double");
		style("Arrowheads: start", "heads", { startArrowhead: "arrow", endArrowhead: null }, "arrow back");
		for (let n = 1; n <= 10; n++) style(`Opacity: ${n * 10}%`, "opacity", { opacity: n * 10 }, `${n * 10}`);
		st.presets.forEach((p, i) => {
			if (p) items.push({ label: `Preset ${i + 1}: ${p.name}`, hint: p.auto ? "" : describeStyle(p.style, st), kind: "preset", style: p.style, words: words(`preset ${i + 1} ${p.name} ${describeStyle(p.style, st)}`) });
		});
		for (const a of this.visibleActions()) {
			const keys = [...(st.toolKeys[a.id] ? [comboLabel(st.toolKeys[a.id])] : []), ...this.hotkeysFor(a.id).map(hotkeyLabel)];
			items.push({
				label: a.name,
				hint: keys.join(", "),
				kind: "command",
				run: (c) => (a.canRun(c) ? a.run(c) : showInfo(c.selected.length === 0 ? "Select something first" : "This does not change what is selected")),
				words: words(`${a.name} ${a.group} command`),
			});
		}
		return items;
	}

	/** Best matches first. Several style words at once ("blue dashed bold") give one combined result on top. */
	searchSuggestions(query: string, items: SearchItem[]): SearchItem[] {
		const ranked = rank(query, items, (t) => t.words, (t) => t.label).slice(0, 60);
		const tokens = words(query);
		const fillMode = tokens.includes("fill");
		const meaningful = tokens.filter((t) => !FILLER.has(t) && t !== "fill");
		const styles = items.filter((t) => t.style && t.kind !== "preset" && t.kind !== (fillMode ? "pen" : "fill"));
		// Each word goes to the kind of style it fits best.
		const byKind = new Map<string, string[]>();
		for (const t of meaningful) {
			let best = 0;
			let kind = "";
			for (const it of styles) {
				const sc = Math.max(0, ...it.words.map((w) => wordScore(t, w)));
				if (sc > best) {
					best = sc;
					kind = it.kind;
				}
			}
			if (best < 1.5) return ranked;
			byKind.set(kind, [...(byKind.get(kind) ?? []), t]);
		}
		if (byKind.size < 2) return ranked;
		const parts: SearchItem[] = [];
		for (const [kind, toks] of byKind) {
			const pick = rank(toks.join(" "), styles.filter((s) => s.kind === kind), (t) => t.words, (t) => t.label)[0];
			if (!pick || match(toks, pick.words).missed > 0) return ranked;
			parts.push(pick);
		}
		const combo: SearchItem = {
			label: parts.map((p) => p.label.replace(/^[^:]*: /, "")).join(" + "),
			hint: "All at once",
			kind: "combo",
			style: Object.assign({}, ...parts.map((p) => p.style)) as Style,
			words: [],
		};
		return [combo, ...ranked];
	}

	openSearch() {
		const c = this.context();
		if (!c || c.typing) return;
		new StyleSearchModal(this.app, this, this.searchItems(), (it) => {
			// Run after the search box closes and the drawing has focus again.
			window.setTimeout(() => {
				const now = this.context();
				if (!now) return;
				void this.tracked(now, () => (it.style ? this.applyStyle(now, it.style, it.label.replace(/^(Preset \d+|[^:]*): /, "")) : it.run?.(now)));
			}, 50);
		}).open();
	}

	/** On first start, offer the suggested keys, unless this plugin's keys are already set. */
	private welcome() {
		if (this.settings.welcomed) return;
		const hm = (this.app as AppInternals).hotkeyManager;
		const hasKeys = this.actions.some((a) => (hm?.customKeys?.[`${this.manifest.id}:${a.id}`] ?? []).length > 0);
		if (hasKeys) {
			this.settings.welcomed = true;
			void this.saveSettings();
			return;
		}
		new WelcomeModal(this.app, this).open();
	}

	// -----------------------------------------------------------------------
	// Repeat: do the last change again on something new
	// -----------------------------------------------------------------------

	/** The style changes made to one selection (or the pen), for the repeat key. */
	private change: { sig: string; style: Style } | null = null;

	/** Which thing a change went to: the selected ids, or "pen". */
	private sigOf(c: Ctx): string {
		if (c.typing) return "";
		return c.selected.length > 0
			? withBoundText(c)
					.map((e) => e.id)
					.sort()
					.join(",")
			: "pen";
	}

	/** Run a change and remember the style values it changed. Changes to the same thing add up. */
	async tracked(c: Ctx, fn: () => unknown): Promise<void> {
		if (c.typing) {
			await fn();
			return;
		}
		const sig = this.sigOf(c);
		const before = this.currentStyle(c);
		await fn();
		await new Promise((r) => window.setTimeout(r, 30));
		const now = this.context();
		if (!now || this.sigOf(now) !== sig) return;
		const after = this.currentStyle(now);
		const diff: Record<string, unknown> = {};
		for (const k of Object.keys(after) as (keyof Style)[]) if (after[k] !== before[k]) diff[k] = after[k];
		if (Object.keys(diff).length === 0) return;
		const style = diff as Style;
		this.change = this.change?.sig === sig ? { sig, style: { ...this.change.style, ...style } } : { sig, style };
	}

	/** Do the last change again: on the selection, or on the pen. */
	async repeat(c: Ctx) {
		const ch = this.change;
		if (!ch) return showInfo("Nothing to repeat yet. Change a style first.");
		if (this.sigOf(c) === ch.sig) return showInfo("Select something else, then repeat");
		const ok = await this.applyStyle(c, ch.style, `Again: ${describeStyle(ch.style, this.settings)}`);
		const now = this.context();
		if (ok && now) this.change = { sig: this.sigOf(now), style: ch.style };
	}

	/** Run a command and remember what it changed. */
	runAction(a: Action, c: Ctx): Promise<void> | void {
		if (a.id === "repeat") return a.run(c);
		return this.tracked(c, () => a.run(c));
	}

	// -----------------------------------------------------------------------
	// Line up and spread out
	// -----------------------------------------------------------------------

	/** The outside box of one element. Lines and arrows use their points. */
	private boxOf(e: El): { x1: number; y1: number; x2: number; y2: number } {
		if (e.points && e.points.length > 0) {
			const xs = e.points.map((p) => e.x + p[0]);
			const ys = e.points.map((p) => e.y + p[1]);
			return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
		}
		return { x1: e.x, y1: e.y, x2: e.x + e.width, y2: e.y + e.height };
	}

	/**
	 * The selection as things that move together: a group, or a box with its label.
	 * An arrow tied to a shape is left out; it follows its shape.
	 */
	units(c: Ctx): { els: El[]; box: { x1: number; y1: number; x2: number; y2: number } }[] {
		const els = withBoundText(c).filter((e) => !e.isDeleted);
		const byId = new Map(c.all.map((e) => [e.id, e]));
		const keyOf = (e: El): string => {
			const owner = e.type === "text" && e.containerId ? byId.get(e.containerId) ?? e : e;
			return owner.groupIds?.[owner.groupIds.length - 1] ?? owner.id;
		};
		const map = new Map<string, El[]>();
		for (const e of els) {
			if ((e.type === "arrow" || e.type === "line") && (e.startBinding || e.endBinding)) continue;
			const k = keyOf(e);
			map.set(k, [...(map.get(k) ?? []), e]);
		}
		// A selected group member brings the whole group.
		for (const e of c.all) {
			if (e.isDeleted) continue;
			const k = e.groupIds?.[e.groupIds.length - 1];
			if (k && map.has(k) && !map.get(k)?.includes(e)) map.get(k)?.push(e);
		}
		return [...map.values()].map((list) => {
			const boxes = list.map((e) => this.boxOf(e));
			return {
				els: list,
				box: {
					x1: Math.min(...boxes.map((b) => b.x1)),
					y1: Math.min(...boxes.map((b) => b.y1)),
					x2: Math.max(...boxes.map((b) => b.x2)),
					y2: Math.max(...boxes.map((b) => b.y2)),
				},
			};
		});
	}

	/** Line up or spread out the selection. Arrows tied to a moved shape follow it. */
	async arrange(c: Ctx, mode: "left" | "right" | "top" | "bottom" | "centre" | "middle" | "across" | "down") {
		const units = this.units(c);
		const spread = mode === "across" || mode === "down";
		if (units.length < (spread ? 3 : 2)) return showInfo(spread ? "Select 3 or more shapes to spread" : "Select 2 or more shapes to line up");
		const all = {
			x1: Math.min(...units.map((u) => u.box.x1)),
			y1: Math.min(...units.map((u) => u.box.y1)),
			x2: Math.max(...units.map((u) => u.box.x2)),
			y2: Math.max(...units.map((u) => u.box.y2)),
		};
		const moves = new Map<string, { dx: number; dy: number }>();
		const move = (u: (typeof units)[number], dx: number, dy: number) => {
			if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
			for (const e of u.els) moves.set(e.id, { dx, dy });
		};
		if (spread) {
			const across = mode === "across";
			const lo = (u: (typeof units)[number]) => (across ? u.box.x1 : u.box.y1);
			const size = (u: (typeof units)[number]) => (across ? u.box.x2 - u.box.x1 : u.box.y2 - u.box.y1);
			const sorted = [...units].sort((a, b) => lo(a) + size(a) / 2 - (lo(b) + size(b) / 2));
			const first = sorted[0];
			const last = sorted[sorted.length - 1];
			const span = lo(last) + size(last) - lo(first);
			const gap = (span - sorted.reduce((s, u) => s + size(u), 0)) / (sorted.length - 1);
			let at = lo(first) + size(first) + gap;
			for (const u of sorted.slice(1, -1)) {
				const d = at - lo(u);
				move(u, across ? d : 0, across ? 0 : d);
				at += size(u) + gap;
			}
		} else {
			for (const u of units) {
				const b = u.box;
				if (mode === "left") move(u, all.x1 - b.x1, 0);
				else if (mode === "right") move(u, all.x2 - b.x2, 0);
				else if (mode === "top") move(u, 0, all.y1 - b.y1);
				else if (mode === "bottom") move(u, 0, all.y2 - b.y2);
				else if (mode === "centre") move(u, (all.x1 + all.x2) / 2 - (b.x1 + b.x2) / 2, 0);
				else move(u, 0, (all.y1 + all.y2) / 2 - (b.y1 + b.y2) / 2);
			}
		}
		if (moves.size === 0) return showInfo("Already lined up");

		// Arrows tied to a moved shape: move the tied end with it.
		const arrows = new Map<string, { start?: { dx: number; dy: number }; end?: { dx: number; dy: number } }>();
		for (const e of c.all) {
			if (e.isDeleted || moves.has(e.id) || !e.points || e.points.length < 2) continue;
			const start = e.startBinding ? moves.get(e.startBinding.elementId) : undefined;
			const end = e.endBinding ? moves.get(e.endBinding.elementId) : undefined;
			if (start || end) arrows.set(e.id, { start, end });
		}
		const ids = new Set([...moves.keys(), ...arrows.keys()]);
		await edit(
			c,
			c.all.filter((e) => ids.has(e.id)),
			(el) => {
				const m = moves.get(el.id);
				if (m) {
					el.x += m.dx;
					el.y += m.dy;
					return;
				}
				const a = arrows.get(el.id);
				if (!a || !el.points) return;
				const pts = el.points.map((p): [number, number] => [p[0], p[1]]);
				if (a.start && a.end && a.start.dx === a.end.dx && a.start.dy === a.end.dy) {
					el.x += a.start.dx;
					el.y += a.start.dy;
				} else {
					if (a.start) {
						el.x += a.start.dx;
						el.y += a.start.dy;
						for (let i = 1; i < pts.length; i++) pts[i] = [pts[i][0] - a.start.dx, pts[i][1] - a.start.dy];
					}
					if (a.end) {
						const i = pts.length - 1;
						pts[i] = [pts[i][0] + a.end.dx, pts[i][1] + a.end.dy];
					}
					el.points = pts;
					el.width = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
					el.height = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
				}
			},
		);
		const names = { left: "Lined up left", right: "Lined up right", top: "Lined up top", bottom: "Lined up bottom", centre: "Centred left to right", middle: "Centred top to bottom", across: "Spread across", down: "Spread down" };
		showInfo(names[mode]);
	}

	// -----------------------------------------------------------------------
	// Your own leader sequences
	// -----------------------------------------------------------------------

	/** "g g" or "gg" as key names: ["G", "G"]. */
	leaderSteps(keys: string): string[] {
		const names: Record<string, string> = { "/": "Slash", ".": "Period", ",": "Comma", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "-": "Minus", "=": "Equal" };
		return [...keys.replace(/\s+/g, "").toUpperCase()].map((ch) => names[ch] ?? ch);
	}

	/** The name of any Obsidian command. */
	commandName(id: string): string {
		return (this.app as AppInternals).commands?.commands?.[id]?.name ?? id;
	}

	/** What a sequence would replace in the built-in leader menu, if anything. */
	leaderClash(keys: string): string {
		let node: LeaderNode | undefined = this.leaderTree(false);
		const path: string[] = [];
		for (const step of this.leaderSteps(keys)) {
			node = node?.children?.get(step);
			if (!node) return "";
			path.push(node.label);
			if (!node.children) return path.join(" › ");
		}
		return path.length ? `${path.join(" › ")} menu` : "";
	}

	/** Put the user's own sequences into the menu. Theirs win over a built-in key. */
	private addCustom(root: LeaderNode) {
		for (const s of this.settings.leaderCustom) {
			const steps = this.leaderSteps(s.keys);
			if (steps.length === 0 || !s.command) continue;
			let node = root;
			for (const [i, step] of steps.entries()) {
				const kids = node.children ?? new Map<string, LeaderNode>();
				node.children = kids;
				if (i === steps.length - 1) {
					const id = s.command;
					kids.set(step, { label: shortName(this.commandName(id).replace(/^Excalidraw Hotkeys: /, "")), run: () => (this.app as AppInternals).commands?.executeCommandById(id) });
				} else {
					let next = kids.get(step);
					if (!next?.children) {
						next = { label: "Your keys", children: new Map() };
						kids.set(step, next);
					}
					node = next;
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Preset bar: tap a preset with the pen or mouse
	// -----------------------------------------------------------------------

	private barEl: HTMLElement | null = null;
	private barKey = "";

	/** Show the preset bar in the open drawing, or hide it. */
	updateBar() {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		const on = this.settings.presetBar && view?.getViewType() === "excalidraw";
		// Inside the drawing, so the bar takes the drawing's own light or dark colours.
		const host = on ? (view?.contentEl.querySelector<HTMLElement>(".excalidraw") ?? null) : null;
		const key = host ? `${this.settings.presets.map((p) => (p ? `${p.name}|${p.style.stroke}|${p.style.fill}` : "")).join(";")}` : "";
		if (host && this.barEl?.parentElement === host && key === this.barKey) return;
		this.barEl?.remove();
		this.barEl = null;
		this.barKey = key;
		if (!host) return;
		const bar = host.createDiv({ cls: "ekh-preset-bar" });
		// Keep the drawing's focus and selection when the bar is tapped.
		bar.addEventListener("pointerdown", (e) => e.preventDefault());
		bar.addEventListener("mousedown", (e) => e.preventDefault());
		this.settings.presets.forEach((p, i) => {
			if (!p) return;
			const b = bar.createEl("button", { cls: "ekh-preset", attr: { "aria-label": `${p.name}\nClick: use. Right-click: save over it.`, "data-tooltip-position": "top" } });
			const sw = b.createSpan({ cls: "ekh-swatch" });
			const stroke = p.style.stroke;
			if (stroke === undefined || stroke === "transparent") sw.addClass("is-none");
			else sw.setCssProps({ "--ekh-swatch": stroke });
			if (p.style.fill && p.style.fill !== "transparent") sw.setCssProps({ "--ekh-swatch-fill": p.style.fill });
			b.createSpan({ cls: "ekh-preset-num", text: String(i + 1) });
			b.addEventListener("click", () => this.fromBar((c) => this.usePreset(c, i)));
			b.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				this.fromBar((c) => this.savePreset(c, i));
			});
		});
		const add = bar.createEl("button", { cls: "ekh-preset ekh-preset-add", text: "+", attr: { "aria-label": "Save the pen, or the selected shape's style, as a new preset", "data-tooltip-position": "top" } });
		add.addEventListener("click", () =>
			this.fromBar((c) => {
				const i = this.settings.presets.findIndex((p) => !p);
				if (i < 0) return showInfo("All 9 presets are full. Right-click one to save over it.");
				return this.savePreset(c, i);
			}),
		);
		this.barEl = bar;
	}

	private fromBar(fn: (c: Ctx) => unknown) {
		const c = this.context();
		if (!c) return;
		void this.tracked(c, () => fn(c)).then(() => this.updateBar());
	}

	/** The tool command whose letter this key is, if any. */
	toolForKey(e: KeyboardEvent): Action | undefined {
		const combo = comboOf(e).toUpperCase();
		if (!combo) return undefined;
		const id = Object.keys(this.settings.toolKeys).find((k) => this.settings.toolKeys[k]?.toUpperCase() === combo);
		return id ? this.actions.find((a) => a.id === id) : undefined;
	}

	// A tool key: only inside a drawing, and never while typing.
	private tryToolKey(e: KeyboardEvent): boolean {
		if (e.repeat) return false;
		const a = this.toolForKey(e);
		if (!a) return false;
		const c = this.context();
		if (!c || c.typing) return false;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (!a.canRun(c)) showInfo("Select something first");
		else void this.runAction(a, c);
		return true;
	}

	/** True when a command from outside this plugin has this key. */
	private otherCommandUses(e: KeyboardEvent): boolean {
		const hm = (this.app as AppInternals).hotkeyManager;
		const mine = `${this.manifest.id}:`;
		for (const map of [hm?.customKeys, hm?.defaultKeys]) {
			for (const [id, keys] of Object.entries(map ?? {})) {
				if (id.startsWith(mine) || !Array.isArray(keys)) continue;
				if (keys.some((h) => matches(h, e))) return true;
			}
		}
		return false;
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
		// These also change the text you are typing.
		const TYPING_CYCLES = ["cycle-align", "cycle-font"];
		const cycle = (
			id: string,
			name: string,
			group: string,
			key: string,
			canRun: (c: Ctx) => boolean,
			step: (c: Ctx, dir: 1 | -1) => Promise<void> | void,
		) => {
			// Nothing selected: change the pen instead.
			const pen = pens[id] as ((c: Ctx, dir: 1 | -1) => void) | undefined;
			const usePen = (c: Ctx) => !!pen && !c.typing && c.selected.length === 0;
			const can = (c: Ctx) => usePen(c) || canRun(c);
			const go = (c: Ctx, dir: 1 | -1) => (usePen(c) && pen ? pen(c, dir) : step(c, dir));
			const whileTyping = TYPING_CYCLES.includes(id);
			list.push({ id, name, group, keys: [hk(["Alt"], key)], whileTyping, canRun: can, run: (c) => go(c, 1) });
			list.push({ id: `${id}-back`, name: `${name}, back`, group, keys: [hk(["Alt", "Shift"], key)], back: true, whileTyping, canRun: can, run: (c) => go(c, -1) });
		};

		// The pen: what the next drawn thing gets. Read and set in Excalidraw's app state.
		const penGet = (c: Ctx, key: string): unknown =>
			(c.ea.getExcalidrawAPI?.()?.getAppState() as unknown as Record<string, unknown> | undefined)?.[key];
		const penSet = (c: Ctx, patch: Record<string, unknown>, label: string) => {
			c.ea.getExcalidrawAPI?.()?.updateScene({ appState: patch, captureUpdate: "NEVER" });
			statusRefresh?.();
			showInfo(`Pen: ${label}`);
		};
		/** Step a pen value through a list, forward or back. */
		const penCycle = <T,>(c: Ctx, key: string, values: T[], dir: 1 | -1, fallback: T) => {
			const i = values.indexOf((penGet(c, key) as T) ?? fallback);
			return values[wrap((i < 0 ? 0 : i) + dir, values.length)];
		};
		const pens: Record<string, (c: Ctx, dir: 1 | -1) => void> = {
			"cycle-line-style": (c, dir) => {
				const v = penCycle(c, "currentItemStrokeStyle", LINE_STYLES, dir, "solid");
				penSet(c, { currentItemStrokeStyle: v }, `${v} line`);
			},
			"cycle-line-width": (c, dir) => {
				const widths = LINE_WIDTHS.map((w) => w[2]);
				const v = penCycle(c, "currentItemStrokeWidth", widths, dir, 1);
				const name = LINE_WIDTHS.find((w) => w[2] === v)?.[1].toLowerCase() ?? String(v);
				penSet(c, { currentItemStrokeWidth: v }, `${name} line`);
			},
			"cycle-fill-style": (c, dir) => {
				const now = penGet(c, "currentItemBackgroundColor") === "transparent" ? "none" : ((penGet(c, "currentItemFillStyle") as string) ?? "hachure");
				const fills = ["none", "hachure", "cross-hatch", "solid"];
				const v = fills[wrap(fills.indexOf(now) + dir, fills.length)];
				if (v === "none") return penSet(c, { currentItemBackgroundColor: "transparent" }, "no fill");
				const patch: Record<string, unknown> = { currentItemFillStyle: v };
				if (now === "none") patch.currentItemBackgroundColor = this.settings.fillColours[2];
				penSet(c, patch, `${v} fill`);
			},
			"cycle-arrowheads": (c, dir) => {
				const heads: [string | null, string | null, string][] = [
					[null, null, "no arrowheads"],
					[null, "arrow", "end arrowhead"],
					["arrow", "arrow", "both arrowheads"],
					["arrow", null, "start arrowhead"],
				];
				const s0 = !!penGet(c, "currentItemStartArrowhead");
				const e0 = !!penGet(c, "currentItemEndArrowhead");
				const i = Math.max(0, heads.findIndex(([a, b]) => !!a === s0 && !!b === e0));
				const [start, end, label] = heads[wrap(i + dir, heads.length)];
				penSet(c, { currentItemStartArrowhead: start, currentItemEndArrowhead: end }, label);
			},
			"cycle-align": (c, dir) => {
				const v = penCycle(c, "currentItemTextAlign", ["left", "center", "right"], dir, "left");
				penSet(c, { currentItemTextAlign: v }, `align ${v === "center" ? "centre" : v}`);
			},
			"cycle-font": (c, dir) => {
				const v = penCycle(c, "currentItemFontFamily", FONTS.map((x) => x[2]), dir, 5);
				penSet(c, { currentItemFontFamily: v }, `${FONTS.find((x) => x[2] === v)?.[1].toLowerCase() ?? v} font`);
			},
		};

		// Colour ----------------------------------------------------------------
		// Things with an inside to fill, and things with a line.
		const fillable = (c: Ctx) => c.selected.filter((el) => el.type !== "text" && !LINEAR.includes(el.type));
		const lined = (c: Ctx) => c.selected.filter((el) => el.type !== "text");

		for (let i = 0; i < 8; i++) {
			const n = i + 1;
			list.push({
				id: `stroke-colour-${n}`,
				name: `Pen colour ${n}`,
				group: "Colour",
				keys: [hk(["Alt"], String(n))],
				canRun: always,
				whileTyping: true,
				run: async (c) => {
					const col = s().strokeColours[i];
					setPen(c, { strokeColor: col }, { currentItemStrokeColor: col }, `Pen colour ${n}`, col);
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
				canRun: (c) => c.selected.length === 0 || fillable(c).length > 0,
				run: async (c) => {
					const fill = s().fillColours[i];
					// Fill only ever changes the inside of a shape, never the pen or text colour.
					setPen(c, {}, { currentItemBackgroundColor: fill }, `Fill colour ${n}`, fill);
					await edit(c, fillable(c), (el) => (el.backgroundColor = fill));
				},
			});
		}

		// 0 means nothing: Alt+0 is no line, Alt+Shift+0 is no fill.
		list.push({
			id: "no-line",
			name: "No line (pen colour 0)",
			group: "Colour",
			keys: [hk(["Alt"], "0")],
			canRun: (c) => c.selected.length === 0 || lined(c).length > 0,
			run: async (c) => {
				setPen(c, {}, { currentItemStrokeColor: "transparent" }, "No line", "transparent");
				// Text with no line would vanish, so text keeps its colour.
				await edit(c, lined(c), (el) => (el.strokeColor = "transparent"));
			},
		});
		list.push({
			id: "no-fill",
			name: "No fill (fill colour 0)",
			group: "Colour",
			keys: [hk(["Alt", "Shift"], "0")],
			canRun: (c) => c.selected.length === 0 || fillable(c).length > 0,
			run: async (c) => {
				setPen(c, {}, { currentItemBackgroundColor: "transparent" }, "No fill", "transparent");
				await edit(c, fillable(c), (el) => (el.backgroundColor = "transparent"));
			},
		});

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
			name: "Reset colours (pen colour 1, no fill)",
			group: "Colour",
			keys: [hk(["Mod"], "`")],
			canRun: always,
			run: (c) => {
				const ink = s().strokeColours[0];
				setPen(c, {}, { currentItemStrokeColor: ink, currentItemBackgroundColor: "transparent" }, "Pen colour 1, no fill", ink);
				return edit(c, withBoundText(c), (el) => {
					el.strokeColor = ink;
					el.backgroundColor = "transparent";
					if (el.type === "text") {
						el.text = stripBlockRef(el.text);
						el.rawText = stripBlockRef(el.rawText);
						el.originalText = stripBlockRef(el.originalText);
					}
				});
			},
		});

		const opacityStep = (up: boolean): Action => ({
			id: up ? "opacity-up" : "opacity-down",
			name: up ? "More opaque" : "More see-through",
			group: "Colour",
			keys: [up ? hk(["Alt", "Shift"], "X") : hk(["Alt"], "X")],
			canRun: always,
			run: (c) => {
				const step = (o: number) => clamp(Math.round((o + (up ? 10 : -10)) / 10) * 10, 10, 100);
				if (c.selected.length === 0) {
					const v = step((penGet(c, "currentItemOpacity") as number) ?? 100);
					return penSet(c, { currentItemOpacity: v }, `opacity ${v}%`);
				}
				return edit(c, withBoundText(c), (el) => (el.opacity = step(el.opacity ?? 100)));
			},
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
		const texts = (c: Ctx): El[] => {
			if (c.typing) {
				const id = c.typing.id;
				const live = c.ea.getExcalidrawAPI?.()?.getSceneElementsIncludingDeleted().find((x: El) => x.id === id);
				return live ? [live] : [];
			}
			return withBoundText(c).filter((el) => el.type === "text");
		};
		const editText = async (c: Ctx, fn: (el: El) => void) => {
			const els = texts(c);
			if (els.length === 0) return;
			if (c.typing) return edit(c, els, fn);
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
				whileTyping: true,
				canRun: (c) => c.selected.length === 0 || texts(c).length > 0,
				// Step through the 4 sizes. Past the ends, grow or shrink by a quarter.
				run: (c) => {
					const sizes = FONT_SIZES.map((f) => f[1]);
					const stepFrom = (now: number) =>
						up
							? (sizes.find((x) => x > now) ?? Math.round(now * 1.25))
							: ([...sizes].reverse().find((x) => x < now) ?? Math.max(8, Math.round(now * 0.8)));
					if (c.selected.length === 0 && !c.typing) {
						const v = stepFrom((penGet(c, "currentItemFontSize") as number) ?? 20);
						const name = FONT_SIZES.find((x) => x[1] === v)?.[0] ?? String(v);
						return penSet(c, { currentItemFontSize: v }, `font size ${name}`);
					}
					const next = stepFrom(texts(c)[0].fontSize);
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
				canRun: hasSelection,
				run: async (c) => {
					// Loose text: the next font size. A text in a box grows with its box.
					const sizes = FONT_SIZES.map((x) => x[1]);
					const nextSize = (now: number) =>
						grow
							? (sizes.find((x) => x > now) ?? Math.round(now * 1.25))
							: ([...sizes].reverse().find((x) => x < now) ?? Math.max(8, Math.round(now * 0.8)));
					const loose = c.selected.filter((el) => el.type === "text");
					if (loose.length > 0) {
						c.ea.copyViewElementsToEAforEditing(loose);
						for (const el of c.ea.getElements()) {
							el.fontSize = nextSize(el.fontSize);
							c.ea.refreshTextElementSize?.(el.id);
						}
						await c.ea.addElementsToView(false, true);
					}
					const rest = c.selected.filter((el) => el.type !== "text");
					if (rest.length === 0) return;
					await edit(c, rest, (el) => {
						if (LINEAR.includes(el.type)) {
							el.strokeWidth = Math.max(1, (el.strokeWidth ?? 1) + (grow ? 1 : -1));
						} else {
							const f = factor(grow);
							const w = el.width * f;
							const h = el.height * f;
							el.x -= (w - el.width) / 2;
							el.y -= (h - el.height) / 2;
							el.width = w;
							el.height = h;
						}
					});
				},
			});
		}

		// Tools -------------------------------------------------------------------
		// Their plain letters live in Settings, Tool keys, not in Obsidian's Hotkeys.
		const TOOLS: [string, string, string][] = [
			["selection", "select", "Select"],
			["hand", "hand", "Hand (move the view)"],
			["rectangle", "rectangle", "Rectangle"],
			["diamond", "diamond", "Diamond"],
			["ellipse", "ellipse", "Ellipse"],
			["arrow", "arrow", "Arrow"],
			["line", "line", "Line"],
			["freedraw", "pen", "Pen"],
			["text", "text", "Text"],
			["eraser", "eraser", "Eraser"],
			["laser", "laser", "Laser pointer"],
			["frame", "frame", "Frame"],
		];
		for (const [type, id, name] of TOOLS) {
			list.push({
				id: `tool-${id}`,
				name: `Tool: ${name}`,
				group: "Tools",
				canRun: always,
				run: (c) => c.ea.getExcalidrawAPI?.()?.setActiveTool?.({ type }),
			});
		}
		list.push({
			id: "delete",
			name: "Delete the selection",
			group: "Tools",
			canRun: hasSelection,
			run: () => {
				// Let Excalidraw run its own Delete, so bound text and arrows go too.
				const target = (activeDocument.activeElement as HTMLElement | null) ?? activeDocument.body;
				target.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true, cancelable: true }));
			},
		});

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


		// Pen presets ---------------------------------------------------------------
		for (let i = 0; i < 9; i++) {
			const n = i + 1;
			list.push({
				id: `preset-${n}`,
				name: `Use pen preset ${n}`,
				group: "Presets",
				keys: n <= 5 ? [hk(["Mod", "Shift"], String(n))] : undefined,
				canRun: always,
				whileTyping: true,
				run: (c) => this.usePreset(c, i),
			});
			list.push({
				id: `save-preset-${n}`,
				name: `Save pen as preset ${n}`,
				group: "Presets",
				canRun: always,
				run: (c) => this.savePreset(c, i),
			});
		}

		// Move between shapes ------------------------------------------------------
		// Their keys live in Settings, Drawing keys: Shift with a letter would block typing everywhere.
		const moves: [string, string, number, number][] = [
			["up", "Select the shape above", 0, -1],
			["down", "Select the shape below", 0, 1],
			["left", "Select the shape to the left", -1, 0],
			["right", "Select the shape to the right", 1, 0],
		];
		for (const [id, name, dx, dy] of moves) {
			list.push({ id: `nav-${id}`, name, group: "Move", canRun: always, run: (c) => this.moveSelection(c, dx, dy) });
		}
		list.push({ id: "follow-arrow", name: "Follow the arrow out of the selected shape", group: "Move", canRun: hasSelection, run: (c) => this.followArrow(c, true) });
		list.push({ id: "follow-arrow-back", name: "Follow the arrow back into the selected shape", group: "Move", canRun: hasSelection, run: (c) => this.followArrow(c, false) });

		// Leader key and search -----------------------------------------------------
		list.push({ id: "leader", name: "Start a key sequence (leader key)", group: "Leader", canRun: always, run: () => this.startLeader() });
		list.push({ id: "search", name: "Search styles and commands", group: "Leader", keys: [hk(["Alt"], "Z")], canRun: always, run: () => this.openSearch() });


		// Repeat ---------------------------------------------------------------------
		// Its key lives in Settings, Drawing keys: a plain letter would block typing everywhere.
		list.push({ id: "repeat", name: "Repeat the last change", group: "Repeat", canRun: always, run: (c) => this.repeat(c) });

		// Line up and spread out ------------------------------------------------------
		const arrange: [string, string, Parameters<ExcalidrawHotkeys["arrange"]>[1]][] = [
			["align-left", "Line up left edges", "left"],
			["align-right", "Line up right edges", "right"],
			["align-top", "Line up top edges", "top"],
			["align-bottom", "Line up bottom edges", "bottom"],
			["align-centre", "Centre left to right", "centre"],
			["align-middle", "Centre top to bottom", "middle"],
			["spread-across", "Spread out evenly across", "across"],
			["spread-down", "Spread out evenly down", "down"],
		];
		for (const [id, name, mode] of arrange) {
			list.push({ id, name, group: "Arrange", canRun: hasSelection, run: (c) => this.arrange(c, mode) });
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
	return all.map((r) => {
		const letter = plugin.settings.toolKeys[r.id];
		return { ...r, keys: [...(letter ? [comboLabel(letter)] : []), ...plugin.hotkeysFor(r.id).map(hotkeyLabel)] };
	});
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
		const search = bar.createEl("input", { type: "search", placeholder: "Search, like: thicker line" });
		const changeBtn = bar.createEl("button", { text: "Change keys" });
		const saveBtn = bar.createEl("button", { text: "Save as note", cls: "mod-cta" });

		const table = contentEl.createEl("table", { cls: "ekh-table" });
		const body = table.createEl("tbody");
		const render = (q: string) => {
			body.empty();
			let group = "";
			for (const r of rows) {
				if (q && match(words(q), words(`${r.name} ${r.keys.join(" ")} ${r.group}`)).missed > 0) continue;
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

type NumberKey = "whichKeyDelay" | "nudgeStep" | "nudgeStepShift" | "resizePercent" | "duplicateGap" | "fitPadding" | "zoomMs";
type ToggleKey = "presetBar" | "whichKey" | "catchKeysFirst" | "showStatusColours" | "showOneByOne" | "shiftGoesBack" | "diagonalNudge" | "copyText" | "copyFill" | "zoomOnSelection";

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
									toggle("Show keys while you hold a modifier", "Hold Alt, Ctrl or Shift for a moment in a drawing to see what each key does.", "whichKey"),
									slider("Wait before showing keys", "Milliseconds to hold before the panel shows.", "whichKeyDelay", 100, 1500, 50),
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
						name: "Drawing keys",
						desc: "Keys that work only in a drawing: tools, moving between shapes and the leader key. Click a key, then press any key or combo.",
						displayValue: () =>
							Object.values(this.plugin.settings.toolKeys)
								.filter(Boolean)
								.map(comboLabel)
								.join(", "),
						items: [
							{
								type: "group",
								items: [
									{
										name: "Reset drawing keys",
										desc: "Put back the suggested keys.",
										action: () => {
											this.plugin.settings.toolKeys = { ...DEFAULT_SETTINGS.toolKeys };
											void this.plugin.saveSettings().then(() => this.update());
										},
									},
								],
							},
							...([
								["Tools", "Tools"],
								["Move between shapes", "Move"],
								["Repeat", "Repeat"],
								["Leader key", "Leader"],
							] as const).map(
								([heading, group]): SettingDefinitionItem => ({
									type: "group",
									heading,
									items: this.plugin.actions
										.filter((a) => a.group === group && a.id !== "search")
										.map(
											(a): SettingDefinition => ({
												name: a.name.replace(/^Tool: /, ""),
												desc:
													a.id === "delete"
														? "Only with something selected."
														: a.id === "leader"
															? "Press it, then a short row of keys. A panel shows the choices."
															: "",
												aliases: ["tool", "letter", "key", "drawing"],
												render: (setting) => this.renderToolKey(setting, a),
											}),
										),
								}),
							),
						],
					},
					{
						type: "page",
						name: "Leader menu",
						desc: "The letters after the leader key, and your own key sequences for any command.",
						displayValue: () => `${this.plugin.settings.leaderCustom.length} of your own`,
						items: [
							{
								type: "group",
								heading: "Menus",
								items: [
									{
										name: "Reset menu letters",
										desc: "Put back the suggested letters.",
										action: () => {
											this.plugin.settings.leaderMenuKeys = {};
											void this.plugin.saveSettings().then(() => this.update());
										},
									},
									...LEADER_MENUS.map(
										([id, label, def]): SettingDefinition => ({
											name: label,
											desc: `Suggested: ${comboLabel(def)}. Leave empty to turn it off.`,
											aliases: ["leader", "sequence", "menu", "letter"],
											render: (setting) => {
												const now = () => this.plugin.settings.leaderMenuKeys[id] ?? def;
												setting.addText((t) => {
													t.inputEl.addClass("ekh-letter");
													t.setValue(comboLabel(now())).onChange((raw) => {
														const v = raw.trim().slice(-1);
														const step = v ? this.plugin.leaderSteps(v)[0] : "";
														const other = LEADER_MENUS.find(([o, , d]) => o !== id && (this.plugin.settings.leaderMenuKeys[o] ?? d) === step && step);
														if (other) {
															new Notice(`${comboLabel(step)} is already used by ${other[1]}`);
															t.setValue(comboLabel(now()));
															return;
														}
														this.plugin.settings.leaderMenuKeys[id] = step;
														t.setValue(comboLabel(step));
														void this.plugin.saveSettings();
													});
												});
											},
										}),
									),
								],
							},
							{
								type: "group",
								heading: "Your own sequences",
								items: [
									{
										name: "Add a sequence",
										desc: "Pick any Obsidian command, then type its keys, like G G.",
										action: () =>
											new CommandPickerModal(this.app, this.plugin, (id) => {
												this.plugin.settings.leaderCustom.push({ keys: "", command: id });
												void this.plugin.saveSettings().then(() => this.update());
											}).open(),
									},
									...this.plugin.settings.leaderCustom.map(
										(s, i): SettingDefinition => ({
											name: this.plugin.commandName(s.command),
											desc: s.keys ? (this.plugin.leaderClash(s.keys) ? `Replaces ${this.plugin.leaderClash(s.keys)}` : "") : "Type its keys.",
											aliases: ["leader", "sequence", "custom"],
											render: (setting) => {
												setting.addText((t) =>
													t
														.setPlaceholder("Keys, like G G")
														.setValue(s.keys)
														.onChange((v) => {
															s.keys = v.toUpperCase();
															const clash = this.plugin.leaderClash(s.keys);
															setting.setDesc(clash ? `Replaces ${clash}` : "");
															void this.plugin.saveSettings();
														}),
												);
												setting.addExtraButton((b) =>
													b
														.setIcon("search")
														.setTooltip("Pick another command")
														.onClick(() =>
															new CommandPickerModal(this.app, this.plugin, (id) => {
																s.command = id;
																void this.plugin.saveSettings().then(() => this.update());
															}).open(),
														),
												);
												setting.addExtraButton((b) =>
													b
														.setIcon("x")
														.setTooltip("Remove")
														.onClick(() => {
															this.plugin.settings.leaderCustom.splice(i, 1);
															void this.plugin.saveSettings().then(() => this.update());
														}),
												);
											},
										}),
									),
								],
							},
						],
					},
					{
						type: "page",
						name: "Pen presets",
						desc: "Saved pens: colour, fill, line, font and more in one key.",
						displayValue: () => `${this.plugin.settings.presets.filter(Boolean).length} saved`,
						items: [
							{
								type: "group",
								items: [
									{
										name: "Save a preset",
										desc: "In a drawing, run Save pen as preset 1 to 9, or press the leader key, then P, S and a number. It saves the selected shape's style, or your pen.",
									},
									toggle("Show preset bar", "A row of your presets at the bottom of a drawing. Click one to use it. Right-click one to save over it. + saves a new one.", "presetBar"),
								],
							},
							{
								type: "group",
								heading: "Presets",
								items: this.plugin.settings.presets.map(
									(p, i): SettingDefinition => ({
										name: `Preset ${i + 1}`,
										desc: p ? describeStyle(p.style, this.plugin.settings) : "Empty",
										aliases: ["preset", "brush", "saved pen"],
										render: (setting) => {
											if (!p) return;
											setting.addText((t) =>
												t
													.setPlaceholder("Name")
													.setValue(p.name)
													.onChange((v) => {
														p.name = v.trim() || describeStyle(p.style, this.plugin.settings);
														p.auto = !v.trim();
														void this.plugin.saveSettings();
													}),
											);
											setting.addExtraButton((b) =>
												b
													.setIcon("x")
													.setTooltip("Delete preset")
													.onClick(() => {
														this.plugin.settings.presets[i] = null;
														void this.plugin.saveSettings().then(() => this.update());
													}),
											);
										},
									}),
								),
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

	/** A button that shows the tool's key; click it, then press a key or combo. */
	private renderToolKey(setting: Setting, a: Action) {
		const keys = this.plugin.settings.toolKeys;
		let show = () => {};
		setting.addButton((b) => {
			show = () => b.setButtonText(keys[a.id] ? comboLabel(keys[a.id]) : "None");
			show();
			b.onClick(() => {
				// Only one button waits for a key at a time.
				stopRecording?.();
				b.setButtonText("Press a key...");
				const win = b.buttonEl.win;
				// Obsidian's own keyboard scope, so Escape cancels here instead of leaving the page.
				const scope = new Scope();
				scope.register(null, null, (e) => {
					onKey(e);
					return false;
				});
				const finish = () => {
					this.app.keymap.popScope(scope);
					win.removeEventListener("mousedown", onMouse, true);
					win.removeEventListener("blur", finish);
					if (stopRecording === finish) stopRecording = null;
					if (b.buttonEl.isConnected) show();
				};
				const onKey = (e: KeyboardEvent) => {
					// The page was redrawn: this button is gone, so stop listening.
					if (!b.buttonEl.isConnected) return finish();
					if (e.key === "Escape") return finish();
					const combo = comboOf(e);
					if (!combo) return;
					const other = this.plugin.actions.find((x) => x.id !== a.id && keys[x.id]?.toUpperCase() === combo.toUpperCase());
					if (other) {
						new Notice(`${comboLabel(combo)} is already used by ${shortName(other.name)}`);
						return finish();
					}
					keys[a.id] = combo;
					void this.plugin.saveSettings();
					finish();
				};
				// A click anywhere else stops the waiting.
				const onMouse = (e: MouseEvent) => {
					if (e.target !== b.buttonEl) finish();
				};
				stopRecording = finish;
				this.app.keymap.pushScope(scope);
				win.addEventListener("mousedown", onMouse, true);
				win.addEventListener("blur", finish);
			});
		});
		setting.addExtraButton((x) =>
			x
				.setIcon("x")
				.setTooltip("No key")
				.onClick(() => {
					stopRecording?.();
					keys[a.id] = "";
					void this.plugin.saveSettings();
					show();
				}),
		);
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
					(_, i): SettingDefinition => ({
						name: `${i + 1}. ${slotName(kind, i, list()[i])}`,
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
		if (key === "presetBar") this.plugin.updateBar();
	}
}

// ---------------------------------------------------------------------------
// First start
// ---------------------------------------------------------------------------

class WelcomeModal extends Modal {
	constructor(app: App, private plugin: ExcalidrawHotkeys) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Excalidraw Hotkeys");
		const { contentEl } = this;
		contentEl.createEl("p", { text: "Use the suggested keys? They sit under the left hand, so the other hand stays on the mouse or pen." });
		contentEl.createEl("p", { text: "You can change any key later in Settings, Hotkeys." });
		const bar = contentEl.createDiv({ cls: "modal-button-container" });
		const yes = bar.createEl("button", { text: "Use suggested keys", cls: "mod-cta" });
		const no = bar.createEl("button", { text: "Not now" });
		yes.addEventListener("click", () => {
			void this.plugin.applySuggestedKeys().then((n) => new Notice(`Set ${n} keys`));
			this.close();
		});
		no.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
		this.plugin.settings.welcomed = true;
		void this.plugin.saveSettings();
	}
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

class StyleSearchModal extends SuggestModal<SearchItem> {
	constructor(
		app: App,
		private plugin: ExcalidrawHotkeys,
		private items: SearchItem[],
		private pick: (it: SearchItem) => void,
	) {
		super(app);
		this.setPlaceholder("Search styles and commands, like: blue dashed thick");
		this.limit = 60;
	}

	getSuggestions(query: string): SearchItem[] {
		return this.plugin.searchSuggestions(query, this.items);
	}

	renderSuggestion(it: SearchItem, el: HTMLElement) {
		el.addClass("ekh-suggestion");
		const main = el.createDiv({ cls: "ekh-suggestion-main" });
		if (it.style?.stroke !== undefined || it.style?.fill !== undefined) {
			const colour = it.style.stroke ?? it.style.fill ?? "";
			const sw = main.createSpan({ cls: "ekh-swatch" });
			if (colour === "transparent") sw.addClass("is-none");
			else sw.setCssProps({ "--ekh-swatch": colour });
		}
		main.createSpan({ text: it.label });
		if (it.hint) el.createDiv({ cls: "ekh-suggestion-hint", text: it.hint });
	}

	onChooseSuggestion(it: SearchItem) {
		this.pick(it);
	}
}

// ---------------------------------------------------------------------------
// Pick any command, with the smart search
// ---------------------------------------------------------------------------

class CommandPickerModal extends SuggestModal<{ id: string; name: string }> {
	constructor(
		app: App,
		private plugin: ExcalidrawHotkeys,
		private pick: (id: string) => void,
	) {
		super(app);
		this.setPlaceholder("Find a command, like: thicker line");
		this.limit = 80;
	}

	getSuggestions(query: string): { id: string; name: string }[] {
		const all = (this.app as AppInternals).commands?.listCommands?.() ?? [];
		const list = all.map((c) => ({ id: c.id, name: c.name }));
		return query.trim() ? rank(query, list, (c) => words(c.name), (c) => c.name) : list;
	}

	renderSuggestion(it: { id: string; name: string }, el: HTMLElement) {
		el.createDiv({ text: it.name });
	}

	onChooseSuggestion(it: { id: string; name: string }) {
		this.pick(it.id);
	}
}
