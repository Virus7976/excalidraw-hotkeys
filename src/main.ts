import { App, Hotkey, ItemView, Modifier, Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface HotkeySettings {
	fillColours: string[];
	strokeColours: string[];
	catchKeysFirst: boolean;
	diagonalNudge: boolean;
	nudgeStep: number;
	nudgeStepShift: number;
	duplicateGap: number;
	resizePercent: number;
	fitPadding: number;
}

const COLOUR_NAMES = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Grey"];

const DEFAULT_SETTINGS: HotkeySettings = {
	fillColours: ["#ffc9c9", "#ffe8cc", "#fff3bf", "#d8f5a2", "#a5d8ff", "#d0bfff", "#fcc2d7", "#e9ecef"],
	strokeColours: ["#c92a2a", "#e67700", "#f59f00", "#2b8a3e", "#1864ab", "#6741d9", "#a61e4d", "#495057"],
	catchKeysFirst: true,
	diagonalNudge: true,
	nudgeStep: 12,
	nudgeStepShift: 20,
	duplicateGap: 80,
	resizePercent: 10,
	fitPadding: 30,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ExcalidrawAutomate and its elements are untyped here on purpose: the
// Excalidraw plugin does not ship types we can depend on.
/* eslint-disable @typescript-eslint/no-explicit-any */
type EA = any;
type El = any;

interface Ctx {
	ea: EA;
	selected: El[];
	all: El[];
}

interface Action {
	id: string;
	name: string;
	hotkeys?: Hotkey[];
	/** Return false to let the key fall through to Excalidraw. */
	canRun: (c: Ctx) => boolean;
	run: (c: Ctx) => Promise<void>;
}

const SHAPES = ["rectangle", "ellipse", "diamond"];
const BOXES = ["rectangle", "ellipse", "diamond", "image", "embeddable", "frame"];
const LINEAR = ["arrow", "line", "freedraw"];

const hk = (modifiers: Modifier[], key: string): Hotkey => ({ modifiers, key });

const newId = () =>
	Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// Text inside a box carries its own colour and alignment, so "the selection"
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
	await c.ea.addElementsToView(false, false);
}

// Remove an Obsidian block reference ("... ^abc123") from the end of a text.
const stripBlockRef = (s?: string) => (s ? s.replace(/\s*\^[\w-]+$/, "") : s);

// ---------------------------------------------------------------------------
// Key matching
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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class ExcalidrawHotkeys extends Plugin {
	settings: HotkeySettings = DEFAULT_SETTINGS;
	private actions: Action[] = [];
	private pressed = new Set<string>();
	// The keydown that already ran a command. Obsidian's hotkey handler and our
	// own capture listener can both see one key press; this stops a double run.
	private handled: Event | null = null;

	async onload() {
		await this.loadSettings();
		this.actions = this.buildActions();

		for (const a of this.actions) {
			this.addCommand({
				id: a.id,
				name: a.name,
				hotkeys: a.hotkeys,
				checkCallback: (checking) => {
					const ev = (window as any).event as Event | undefined;
					if (ev && ev === this.handled) return true;
					const c = this.context();
					if (!c || !a.canRun(c)) return false;
					if (!checking) {
						this.handled = ev ?? null;
						void a.run(c);
					}
					return true;
				},
			});
		}

		this.registerDomEvent(window, "keydown", (e) => this.onKeyDown(e), { capture: true });
		this.registerDomEvent(window, "keyup", (e) => this.pressed.delete(e.code), { capture: true });
		this.registerDomEvent(window, "blur", () => this.pressed.clear());

		this.addSettingTab(new HotkeySettingTab(this.app, this));
	}

	async loadSettings() {
		const saved = (await this.loadData()) ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.settings.fillColours = [...(saved.fillColours ?? DEFAULT_SETTINGS.fillColours)];
		this.settings.strokeColours = [...(saved.strokeColours ?? DEFAULT_SETTINGS.strokeColours)];
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Null unless an Excalidraw drawing is active and no text is being typed. */
	private context(): Ctx | null {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		if (!view || view.getViewType() !== "excalidraw") return null;

		const active = document.activeElement as HTMLElement | null;
		if (
			active &&
			(active.tagName === "TEXTAREA" ||
				active.tagName === "INPUT" ||
				active.isContentEditable ||
				active.closest(".excalidraw-textEditorContainer"))
		)
			return null;

		const EAglobal = (window as any).ExcalidrawAutomate;
		if (!EAglobal?.getAPI) return null;
		const ea = EAglobal.getAPI(view);
		return { ea, selected: ea.getViewSelectedElements() ?? [], all: ea.getViewElements() ?? [] };
	}

	/** The keys set in Settings, Hotkeys; the defaults if never changed. */
	private hotkeysFor(a: Action): Hotkey[] {
		const hm = (this.app as any).hotkeyManager;
		const full = `${this.manifest.id}:${a.id}`;
		const custom = hm?.customKeys?.[full];
		if (Array.isArray(custom)) return custom;
		const def = hm?.defaultKeys?.[full];
		if (Array.isArray(def)) return def;
		return a.hotkeys ?? [];
	}

	private onKeyDown(e: KeyboardEvent) {
		this.pressed.add(e.code);
		if (e === this.handled) return;

		if (this.settings.diagonalNudge && this.tryDiagonalNudge(e)) return;
		if (!this.settings.catchKeysFirst) return;

		for (const a of this.actions) {
			if (!this.hotkeysFor(a).some((h) => matches(h, e))) continue;
			const c = this.context();
			if (!c || !a.canRun(c)) continue;
			e.preventDefault();
			e.stopImmediatePropagation();
			this.handled = e;
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
		this.handled = e;
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
	// Actions
	// -----------------------------------------------------------------------

	private buildActions(): Action[] {
		const s = () => this.settings;
		const any = (c: Ctx) => c.selected.length > 0;
		const list: Action[] = [];

		// Fill and stroke colours ------------------------------------------------
		for (let i = 0; i < 8; i++) {
			const n = i + 1;
			list.push({
				id: `fill-colour-${n}`,
				name: `Fill colour ${n}`,
				hotkeys: [hk(["Alt"], String(n))],
				canRun: any,
				run: (c) =>
					edit(c, c.selected, (el) => {
						if (el.type === "text") el.strokeColor = s().strokeColours[i];
						else if (!LINEAR.includes(el.type)) el.backgroundColor = s().fillColours[i];
					}),
			});
			list.push({
				id: `stroke-colour-${n}`,
				name: `Stroke colour ${n}`,
				hotkeys: [hk(["Alt", "Shift"], String(n))],
				canRun: any,
				run: (c) =>
					edit(c, withBoundText(c), (el) => {
						el.strokeColor = s().strokeColours[i];
					}),
			});
		}

		list.push({
			id: "cycle-fill-style",
			name: "Cycle fill style",
			hotkeys: [hk(["Alt"], "F")],
			canRun: (c) => c.selected.some((el) => SHAPES.includes(el.type)),
			run: (c) =>
				edit(c, c.selected, (el) => {
					if (!SHAPES.includes(el.type)) return;
					if (el.backgroundColor === "transparent") {
						el.backgroundColor = s().fillColours[2];
						el.fillStyle = "hachure";
					} else if (el.fillStyle === "hachure") el.fillStyle = "cross-hatch";
					else if (el.fillStyle === "cross-hatch") el.fillStyle = "solid";
					else {
						el.backgroundColor = "transparent";
						el.fillStyle = "hachure";
					}
				}),
		});

		list.push({
			id: "reset-colours",
			name: "Reset to black with no fill",
			hotkeys: [hk(["Mod"], "`")],
			canRun: any,
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

		// Text alignment ----------------------------------------------------------
		const aligns: [string, string, string][] = [
			["left", "Align text left", "L"],
			["center", "Align text centre", ";"],
			["right", "Align text right", "'"],
		];
		for (const [value, name, key] of aligns) {
			list.push({
				id: `align-text-${value}`,
				name,
				hotkeys: [hk(["Mod", "Shift"], key)],
				canRun: (c) => withBoundText(c).some((el) => el.type === "text"),
				run: (c) =>
					edit(
						c,
						withBoundText(c).filter((el) => el.type === "text"),
						(el) => {
							el.textAlign = value;
						},
					),
			});
		}

		// Duplicate with an arrow ---------------------------------------------------
		const dirs: [string, string, number, number][] = [
			["up", "ArrowUp", 0, -1],
			["down", "ArrowDown", 0, 1],
			["left", "ArrowLeft", -1, 0],
			["right", "ArrowRight", 1, 0],
		];
		const dupSources = (c: Ctx) =>
			c.selected.filter(
				(el) =>
					(BOXES.includes(el.type) || el.type === "text") &&
					!(el.type === "text" && el.containerId && c.selected.some((s) => s.id === el.containerId)),
			);
		for (const [name, key, dx, dy] of dirs) {
			list.push({
				id: `duplicate-${name}`,
				name: `Duplicate ${name} with an arrow`,
				hotkeys: [hk(["Mod"], key)],
				canRun: (c) => dupSources(c).length > 0,
				run: async (c) => {
					const sources = dupSources(c);
					const ea = c.ea;
					ea.copyViewElementsToEAforEditing(sources);
					const newIds: string[] = [];
					for (const src of sources) {
						const el = ea.getElement(src.id);
						const copy = JSON.parse(JSON.stringify(el));
						copy.id = newId();
						copy.seed = newSeed();
						copy.versionNonce = newSeed();
						copy.version = 1;
						copy.x += dx * (el.width + s().duplicateGap);
						copy.y += dy * (el.height + s().duplicateGap);
						copy.boundElements = [];
						copy.groupIds = [];
						copy.backgroundColor = "transparent";
						if (copy.type === "text") copy.containerId = null;
						ea.elementsDict[copy.id] = copy;
						newIds.push(copy.id);

						ea.style.strokeColor = el.strokeColor;
						ea.style.strokeWidth = 1;
						ea.style.roughness = el.roughness ?? ea.style.roughness;
						ea.connectObjects(el.id, null, copy.id, null, {
							startArrowHead: null,
							endArrowHead: "arrow",
							numberOfPoints: 0,
						});
					}
					await ea.addElementsToView(false, false);
					ea.selectElementsInView(ea.getViewElements().filter((el: El) => newIds.includes(el.id)));
				},
			});
		}

		// Resize ------------------------------------------------------------------
		const resizable = (c: Ctx) => c.selected.filter((el) => el.type !== "text" && !LINEAR.includes(el.type));
		const factor = (grow: boolean) => 1 + ((grow ? 1 : -1) * s().resizePercent) / 100;

		for (const grow of [true, false]) {
			const word = grow ? "Grow" : "Shrink";
			const key = grow ? "." : ",";

			list.push({
				id: `${word.toLowerCase()}-width`,
				name: `${word} width`,
				hotkeys: [hk(["Shift"], key)],
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
				hotkeys: [hk(["Alt"], key)],
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
				hotkeys: [hk(["Mod", "Shift"], key)],
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

		// Fit box to text -----------------------------------------------------------
		const withText = (c: Ctx) =>
			c.selected.filter((el) => (el.boundElements ?? []).some((b: El) => b.type === "text"));
		list.push({
			id: "fit-box-to-text",
			name: "Fit box to text",
			hotkeys: [hk(["Mod"], "/")],
			canRun: (c) => withText(c).length > 0,
			run: (c) => {
				const boxes = withText(c);
				return edit(c, boxes, (el) => {
					const t = c.all.find((x) => x.type === "text" && x.containerId === el.id);
					if (!t) return;
					const w = t.width + s().fitPadding;
					const h = t.height + s().fitPadding;
					el.x += (el.width - w) / 2;
					el.y += (el.height - h) / 2;
					el.width = w;
					el.height = h;
				});
			},
		});

		return list;
	}
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class HotkeySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ExcalidrawHotkeys) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const st = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl)
			.setName("Hotkeys")
			.setDesc("Set the keys for every command.")
			.addButton((b) =>
				b.setButtonText("Open hotkeys").onClick(() => {
					const setting = (this.app as any).setting;
					setting.openTabById("hotkeys");
					const tab = setting.activeTab;
					try {
						tab.searchComponent.setValue("Excalidraw Hotkeys");
						tab.updateHotkeyVisibility();
					} catch {
						new Notice("Search for Excalidraw Hotkeys");
					}
				}),
			);

		new Setting(containerEl)
			.setName("Catch keys before Excalidraw")
			.setDesc("Run these hotkeys before Excalidraw's own keys can use them.")
			.addToggle((t) =>
				t.setValue(st.catchKeysFirst).onChange(async (v) => {
					st.catchKeysFirst = v;
					await save();
				}),
			);

		new Setting(containerEl).setName("Colours").setHeading();
		for (let i = 0; i < 8; i++) {
			new Setting(containerEl)
				.setName(`${i + 1}. ${COLOUR_NAMES[i]}`)
				.setDesc("Fill, then stroke and text.")
				.addColorPicker((p) =>
					p.setValue(st.fillColours[i]).onChange(async (v) => {
						st.fillColours[i] = v;
						await save();
					}),
				)
				.addColorPicker((p) =>
					p.setValue(st.strokeColours[i]).onChange(async (v) => {
						st.strokeColours[i] = v;
						await save();
					}),
				)
				.addExtraButton((b) =>
					b
						.setIcon("rotate-ccw")
						.setTooltip("Reset")
						.onClick(async () => {
							st.fillColours[i] = DEFAULT_SETTINGS.fillColours[i];
							st.strokeColours[i] = DEFAULT_SETTINGS.strokeColours[i];
							await save();
							this.display();
						}),
				);
		}

		new Setting(containerEl).setName("Moving").setHeading();
		new Setting(containerEl)
			.setName("Diagonal move")
			.setDesc("Hold two arrow keys to move the selection on a diagonal.")
			.addToggle((t) =>
				t.setValue(st.diagonalNudge).onChange(async (v) => {
					st.diagonalNudge = v;
					await save();
				}),
			);
		this.slider(containerEl, "Diagonal step", "Pixels per key press.", 1, 50, "nudgeStep");
		this.slider(containerEl, "Diagonal step with Shift", "Pixels per key press with Shift held.", 1, 100, "nudgeStepShift");

		new Setting(containerEl).setName("Sizes").setHeading();
		this.slider(containerEl, "Resize step", "Percent per key press.", 1, 50, "resizePercent");
		this.slider(containerEl, "Duplicate gap", "Space between a box and its copy.", 10, 300, "duplicateGap");
		this.slider(containerEl, "Fit padding", "Space around the text after Fit box to text.", 0, 100, "fitPadding");
	}

	private slider(
		el: HTMLElement,
		name: string,
		desc: string,
		min: number,
		max: number,
		key: "nudgeStep" | "nudgeStepShift" | "resizePercent" | "duplicateGap" | "fitPadding",
	) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addSlider((s) =>
				s
					.setLimits(min, max, 1)
					.setValue(this.plugin.settings[key])
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings[key] = v;
						await this.plugin.saveSettings();
					}),
			);
	}
}
