import {
	App,
	FileView,
	Hotkey,
	ItemView,
	MarkdownRenderer,
	Menu,
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
	ViewStateResult,
	WorkspaceLeaf,
	setIcon,
	moment,
	normalizePath,
} from "obsidian";
import { FILLER, match, rank, wordScore, words } from "./smart";
import CHANGELOG from "../CHANGELOG.md";

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
	/** Milliseconds for a move to glide into place. 0 jumps. */
	moveMs: number;
	/** Show the key when you click a button that has one. */
	keyCoach: boolean;
	/** How many times each command's key was shown. */
	coachSeen: Record<string, number>;
	/** Arrows this plugin laid are drawn again after a mouse drag. */
	followDrags: boolean;
	/** The bar: auto (one button on phones and tablets), button, or full. */
	touchBar: string;
	/** How new arrows look: curved (a soft S), straight, elbow, or like your pen. */
	arrowStyle: string;
	zoomOnSelection: boolean;
	notePath: string;
	/** The last colours you used, newest first. */
	recentColours: string[];
	/** Your own buttons on the preset bar: command ids. */
	barCommands: string[];
	stamps: Stamp[];
	macros: (Macro | null)[];
	/** The version the last "What's new" was for. Empty before the first start. */
	seenVersion: string;
	showWhatsNew: boolean;
}

/** A saved group of shapes, placed with one key. Positions start at 0, 0. */
interface Stamp {
	name: string;
	els: El[];
}

/** One recorded step: a command, a leader sequence or a style from search. */
type MacroStep = { t: "action"; id: string } | { t: "leader"; keys: string[] } | { t: "style"; style: Style; label: string };

interface Macro {
	name: string;
	steps: MacroStep[];
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
		"mind-child": "Tab",
		"mind-sibling": "Shift+Tab",
		"cycle-shape": "Shift+C",
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
	moveMs: 160,
	keyCoach: true,
	coachSeen: {},
	followDrags: true,
	touchBar: "auto",
	arrowStyle: "curved",
	zoomOnSelection: true,
	notePath: "Excalidraw Hotkeys.md",
	recentColours: [],
	barCommands: [],
	stamps: [],
	macros: Array<Macro | null>(9).fill(null),
	seenVersion: "",
	showWhatsNew: true,
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
	angle?: number;
	locked?: boolean;
	link?: string | null;
	frameId?: string | null;
	name?: string | null;
	roundness?: { type: number } | null;
	elbowed?: boolean;
	index?: string | null;
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
	scrollToContent?(): void;
	setActiveTool?(tool: { type: string }): void;
}

interface EA {
	elementsDict: Record<string, El>;
	style: { strokeColor: string; strokeWidth: number; roughness: number };
	getViewSelectedElements(): El[];
	getViewElements(): El[];
	copyViewElementsToEAforEditing(els: El[], copyImages?: boolean): void;
	clear?(): void;
	reset?(): void;
	create?(opts: { filename?: string; onNewPane?: boolean; silent?: boolean }): Promise<string>;
	addText(x: number, y: number, text: string, opts?: Record<string, unknown>): string;
	addArrow(points: [number, number][], opts?: { startArrowHead?: string | null; endArrowHead?: string | null }): string;
	addLine(points: [number, number][]): string;
	createPNG?(template?: string, scale?: number, settings?: unknown, loader?: unknown, theme?: string, padding?: number): Promise<unknown>;
	getElements(): El[];
	getElement(id: string): El;
	addElementsToView(repositionToCursor: boolean, save: boolean): Promise<boolean>;
	addFrame?(x: number, y: number, w: number, h: number, name?: string): string;
	addElementsToFrame?(frameId: string, ids: string[]): void;
	getViewLastPointerPosition?(): { x: number; y: number } | null;
	viewZoomToElements?(select: boolean, els: El[]): void;
	refreshTextElementSize?(id: string): void;
	getExcalidrawAPI?(): ExcalidrawAPI | null;
	connectObjects(
		a: string,
		ca: string | null,
		b: string,
		cb: string | null,
		formatting: { startArrowHead: string | null; endArrowHead: string | null; numberOfPoints: number; padding?: number },
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
	/** 0 clean (architect), 1 sketchy (artist), 2 very sketchy (cartoonist). */
	roughness?: number;
	/** Box and diamond corners. */
	edges?: string;
	/** Arrow shape: sharp is straight, round is curved, elbow has right-angle bends. */
	arrowType?: string;
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
	roughness: "currentItemRoughness",
	edges: "currentItemRoundness",
	arrowType: "currentItemArrowType",
};

const SKETCH: [string, number][] = [["clean", 0], ["sketchy", 1], ["very sketchy", 2]];
const ARROW_TYPES: [string, string][] = [["straight", "sharp"], ["curved", "round"], ["elbow", "elbow"]];

/** One step of a key sequence: a menu of keys, or a thing to do. */
interface LeaderNode {
	label: string;
	children?: Map<string, LeaderNode>;
	run?: (c: Ctx) => unknown;
	/** Not saved in a macro: the macro keys themselves. */
	noRecord?: boolean;
}

/** One thing the search can find: a style, several styles at once, or a command. */
interface SearchItem {
	label: string;
	hint: string;
	words: string[];
	kind: string;
	style?: Style;
	run?: (c: Ctx) => unknown;
	actionId?: string;
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
	["arrange", "Line up, spread and size", "L"],
	["sketch", "Sketchy and corners", "K"],
	["arrowtype", "Arrow shape", "R"],
	["shape", "Change shape", "B"],
	["mind", "Connect and mind map", "N"],
	["styleclip", "Copy, paste and export", "Y"],
	["similar", "Select similar", "M"],
	["turn", "Turn, flip and lock", "U"],
	["link", "Link to a note", "I"],
	["frames", "Frames", "G"],
	["stamps", "Stamps", "J"],
	["recent", "Recent colours", "D"],
	["macros", "Macros", "Q"],
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

/** A copy of an element with a new id, moved by ox, oy. Not tied to anything. */
function cloneEl(el: El, ox: number, oy: number): El {
	const copy = JSON.parse(JSON.stringify(el)) as El;
	copy.id = newId();
	copy.seed = newSeed();
	copy.versionNonce = newSeed();
	copy.version = 1;
	copy.x += ox;
	copy.y += oy;
	copy.boundElements = [];
	copy.groupIds = [];
	copy.index = null;
	return copy;
}

/**
 * Put everything the EA holds into the scene in one update, and select some of it.
 * One update means one Ctrl+Z takes it all back.
 */
async function commitEA(ea: EA, select: string[]) {
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
	const selectedElementIds = Object.fromEntries(select.map((id) => [id, true]));
	api.updateScene({ elements: merged, appState: { selectedElementIds }, captureUpdate: "IMMEDIATELY" });
}

/** Where this device remembers that it has a keyboard. */
const KEYBOARD_KEY = "excalidraw-hotkeys-keyboard";

/** The commands a phone or tablet without a keyboard gets. */
const TOUCH_COMMANDS = [
	"search", "mind-child", "mind-sibling", "connect", "tidy-map", "fold-branch",
	"layout-flow", "layout-timeline", "layout-kanban", "layout-matrix", "copy-image", "image-to-note",
	"align-left", "align-centre", "align-top", "align-middle", "spread-across", "spread-down", "tidy-grid",
];

/** The box a fold badge belongs to, if this is one. */
function foldBadgeOf(e: El): string | undefined {
	const v = (e as unknown as { customData?: { ekhFoldBadge?: unknown } }).customData?.ekhFoldBadge;
	return typeof v === "string" ? v : undefined;
}

/** Select these elements, and nothing else. */
function selectIds(c: Ctx, ids: string[]) {
	c.ea.getExcalidrawAPI?.()?.updateScene({ appState: { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])), selectedGroupIds: {} }, captureUpdate: "NEVER" });
}

/** Send a key to Excalidraw itself, for the things it already does well. */
function excalidrawKey(key: string, code: string, shift = false, ctrl = false) {
	const target = (activeDocument.activeElement as HTMLElement | null) ?? activeDocument.body;
	target.dispatchEvent(new KeyboardEvent("keydown", { key, code, shiftKey: shift, ctrlKey: ctrl, bubbles: true, cancelable: true }));
}

/** "#f80", "#ff8800" or "ff8800" as "#ff8800". Six letters without # need a digit, so words like "facade" stay words. */
function hexIn(text: string): string | null {
	const m = /(?:^|\s)#([0-9a-f]{6}|[0-9a-f]{3})(?=\s|$)/i.exec(text) ?? /(?:^|\s)((?=[a-f]*\d)[0-9a-f]{6})(?=\s|$)/i.exec(text);
	if (!m) return null;
	const h = m[1].toLowerCase();
	return `#${h.length === 3 ? [...h].map((x) => x + x).join("") : h}`;
}

/** Make an arrow straight, curved or elbow. An elbow arrow gets right-angle bends between its two ends. */
function setArrowType(el: El, type: string) {
	const pts = el.points ?? [[0, 0], [el.width, el.height]];
	const a = pts[0];
	const b = pts[pts.length - 1];
	const rec = el as unknown as Record<string, unknown>;
	if (type === "elbow") {
		el.elbowed = true;
		el.roundness = null;
		const wide = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
		const mid: [number, number][] = wide
			? [[(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]]]
			: [[a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2]];
		el.points = [a, ...mid, b];
		rec.fixedSegments = null;
		rec.startIsSpecial = false;
		rec.endIsSpecial = false;
		return;
	}
	if (el.elbowed) el.points = [a, b];
	el.elbowed = false;
	el.roundness = type === "round" ? { type: 2 } : null;
}

/**
 * A soft S from one end to the other, the way a person draws a connector between two boxes
 * that are not in line: out of one side, a smooth bend, into the facing side.
 * Excalidraw draws a curve through every point, so the S is a smooth curve sampled at a few
 * points. Fewer points make Excalidraw overshoot and loop.
 * Wide means it leaves sideways; else it leaves from the top or bottom.
 */
function sCurve(a: [number, number], b: [number, number], wide: boolean): [number, number][] {
	const mx = (a[0] + b[0]) / 2;
	const my = (a[1] + b[1]) / 2;
	const c1: [number, number] = wide ? [mx, a[1]] : [a[0], my];
	const c2: [number, number] = wide ? [mx, b[1]] : [b[0], my];
	const n = 8;
	return Array.from({ length: n + 1 }, (_, i): [number, number] => {
		const t = i / n;
		const u = 1 - t;
		const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
		return [k[0] * a[0] + k[1] * c1[0] + k[2] * c2[0] + k[3] * b[0], k[0] * a[1] + k[1] * c1[1] + k[2] * c2[1] + k[3] * b[1]];
	});
}

/** The way a nice arrow was drawn, kept on the arrow so a move can draw it fresh. */
const curveOf = (el: El): string | undefined => ((el as unknown as { customData?: { ekhCurve?: string } }).customData ?? {}).ekhCurve;

function markCurve(el: El, way: string | undefined) {
	const rec = el as unknown as { customData?: Record<string, unknown> };
	const data = { ...(rec.customData ?? {}) };
	if (way) data.ekhCurve = way;
	else delete data.ekhCurve;
	rec.customData = Object.keys(data).length ? data : undefined;
}

type Box = { x1: number; y1: number; x2: number; y2: number };

/**
 * Lay an arrow between two boxes the way a person would: out of the sides that face each
 * other, from the middle of each side, with a small gap, then straight, a soft S or bends.
 * Sets the arrow's place and points. Returns false when the boxes overlap and there is no clean way.
 */
function routeArrow(el: El, a: Box, b: Box, type: string, prefer?: string): boolean {
	const gx = Math.max(b.x1 - a.x2, a.x1 - b.x2);
	const gy = Math.max(b.y1 - a.y2, a.y1 - b.y2);
	if (gx < 4 && gy < 4) return false;
	// Keep the way the diagram flows (a map that grows right stays side to side), when there is room.
	const wide = prefer === "wide" && gx >= 4 ? true : prefer === "tall" && gy >= 4 ? false : gx >= gy;
	const gap = 8;
	const mid = (v: Box): [number, number] => [(v.x1 + v.x2) / 2, (v.y1 + v.y2) / 2];
	const [ax, ay] = mid(a);
	const [bx, by] = mid(b);
	let start: [number, number];
	let end: [number, number];
	if (wide) {
		const right = bx >= ax;
		start = [right ? a.x2 + gap : a.x1 - gap, ay];
		end = [right ? b.x1 - gap : b.x2 + gap, by];
	} else {
		const down = by >= ay;
		start = [ax, down ? a.y2 + gap : a.y1 - gap];
		end = [bx, down ? b.y1 - gap : b.y2 + gap];
	}
	el.x = start[0];
	el.y = start[1];
	el.angle = 0;
	shapeArrow(el, [0, 0], [end[0] - start[0], end[1] - start[1]], wide, type);
	// Tell Excalidraw the ends sit in the middle of each side, so its own redraws agree.
	if (el.startBinding) el.startBinding = { ...el.startBinding, focus: 0, gap } as El["startBinding"];
	if (el.endBinding) el.endBinding = { ...el.endBinding, focus: 0, gap } as El["endBinding"];
	return true;
}

/** Make a nice arrow line between two ends: straight when nearly in line, else the S (or bends for elbow). */
function shapeArrow(el: El, a: [number, number], b: [number, number], wide: boolean, type: string) {
	const off = wide ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]);
	if (type === "elbow") {
		const rec = el as unknown as Record<string, unknown>;
		el.elbowed = true;
		el.roundness = null;
		el.points =
			off < 2
				? [a, b]
				: wide
					? [a, [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], b]
					: [a, [a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2], b];
		rec.fixedSegments = null;
		rec.startIsSpecial = false;
		rec.endIsSpecial = false;
	} else if (type === "sharp" || off < 6) {
		el.points = [a, b];
		el.elbowed = false;
		el.roundness = type === "sharp" ? null : { type: 2 };
	} else {
		el.points = sCurve(a, b, wide);
		el.elbowed = false;
		el.roundness = { type: 2 };
	}
	// Remember the way, so it is drawn fresh when a shape at either end moves.
	markCurve(el, wide ? "wide" : "tall");
	const xs = (el.points ?? []).map((p) => p[0]);
	const ys = (el.points ?? []).map((p) => p[1]);
	el.width = Math.max(...xs) - Math.min(...xs);
	el.height = Math.max(...ys) - Math.min(...ys);
}

const sleepMs = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

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
	if (s.roughness !== undefined && s.roughness !== 1) parts.push(SKETCH.find((k) => k[1] === s.roughness)?.[0] ?? `sketch ${s.roughness}`);
	if (s.edges !== undefined && s.edges !== "round") parts.push("sharp corners");
	if (s.arrowType !== undefined && s.arrowType !== "round") parts.push(`${ARROW_TYPES.find((t) => t[1] === s.arrowType)?.[0] ?? s.arrowType} arrow`);
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
	/** The guide as Markdown. */
	guideMarkdown(): string {
		return guideMarkdown(this);
	}

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
			id: "guide",
			name: "Open the guide",
			callback: () => new GuideModal(this.app, this).open(),
		});

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
		this.registerDomEvent(window, "click", (e) => this.coach(e), { capture: true });
		this.registerDomEvent(window, "pointerdown", (e) => this.onDragStart(e), { capture: true });
		this.registerDomEvent(window, "pointerup", () => this.onDragEnd(), { capture: true });
		this.addCommand({
			id: "practice",
			name: "Practice the keys",
			callback: () => void this.practice(),
		});
		this.registerView(WHATS_NEW_VIEW, (leaf) => new WhatsNewView(leaf));
		this.addCommand({
			id: "whats-new",
			name: "What's new",
			callback: () => void this.openWhatsNew(),
		});
		this.app.workspace.onLayoutReady(() => {
			// A new install has never been welcomed: it gets the welcome, not a list of changes.
			const fresh = !this.settings.welcomed;
			this.welcome();
			void this.afterUpdate(fresh);
		});

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
	/**
	 * A keyboard on this device. Always on a computer. On a phone or tablet only when you turn it on,
	 * and that choice stays on that device (it is not synced to the others).
	 */
	keyboardHere(): boolean {
		return !Platform.isMobile || this.app.loadLocalStorage(KEYBOARD_KEY) === "1";
	}

	setKeyboardHere(on: boolean) {
		this.app.saveLocalStorage(KEYBOARD_KEY, on ? "1" : null);
		this.registerCommands();
		this.updateBar();
	}

	registerCommands() {
		const keys = this.keyboardHere();
		for (const a of this.actions) {
			// Without a keyboard, only the commands that make sense to tap.
			const want = keys ? (!a.oneByOne || this.settings.showOneByOne) && (!a.back || this.settings.shiftGoesBack) : TOUCH_COMMANDS.includes(a.id);
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
		this.fitBar();
		const el = this.statusEl;
		if (!el) return;
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		const st =
			this.settings.showStatusColours && view?.getViewType() === "excalidraw"
				? window.ExcalidrawAutomate?.getAPI(view).getExcalidrawAPI?.()?.getAppState()
				: null;
		const stroke = st?.currentItemStrokeColor ?? "";
		const fill = st?.currentItemBackgroundColor ?? "";
		const rec = !!this.recording;
		const key = st || rec ? `${stroke}|${fill}|${rec}` : "";
		if (key === this.statusKey) return;
		this.statusKey = key;
		el.empty();
		el.toggleClass("ekh-hidden", !st && !rec);
		if (rec) el.createSpan({ cls: "ekh-rec", text: "Recording", attr: { "aria-label": "Recording a macro. Run Record a macro again to stop.", "data-tooltip-position": "top" } });
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
		this.settings.recentColours = [...(saved.recentColours ?? [])];
		this.settings.barCommands = [...(saved.barCommands ?? [])];
		this.settings.stamps = (saved.stamps ?? []).map((s) => ({ ...s }));
		this.settings.macros = Array.from({ length: 9 }, (_, i) => saved.macros?.[i] ?? null);
		this.settings.coachSeen = { ...(saved.coachSeen ?? {}) };
		if (!["auto", "button", "full"].includes(this.settings.touchBar)) this.settings.touchBar = "auto";
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
	/** The commands each key set gives keys to. All: every suggested key. */
	private inKeySet(id: string, set: string): boolean {
		if (set === "leader") return id === "search";
		if (set === "basic") return ["stroke-colour-", "fill-colour-", "no-line", "no-fill", "search", "cycle-line-width", "cycle-line-style", "duplicate-"].some((p) => id.startsWith(p));
		return true;
	}

	async applySuggestedKeys(replace = false, set = "all"): Promise<number> {
		const hm = (this.app as AppInternals).hotkeyManager;
		if (!hm?.setHotkeys) return 0;
		// A suggested key that another command already uses is skipped, so nothing you rely on breaks.
		const mine = `${this.manifest.id}:`;
		const sig = (h: Hotkey) =>
			[...h.modifiers].map((m) => (m === "Mod" ? (Platform.isMacOS ? "Meta" : "Ctrl") : m)).sort().join("+") + "+" + h.key.toUpperCase();
		const taken = new Set<string>();
		for (const map of [hm.customKeys, hm.defaultKeys]) {
			for (const [id, keys] of Object.entries(map ?? {})) {
				// Replacing all: this plugin's own old keys do not count.
				if ((replace && id.startsWith(mine)) || !Array.isArray(keys)) continue;
				// A command's own setting replaces its default key.
				if (map === hm.defaultKeys && hm.customKeys && id in hm.customKeys) continue;
				for (const h of keys) taken.add(sig(h));
			}
		}
		const free = (keys: Hotkey[] | undefined, id = "") => (this.inKeySet(id, set) ? (keys ?? []) : []).filter((h) => !taken.has(sig(h)));
		let n = 0;
		for (const a of this.actions) {
			const full = `${this.manifest.id}:${a.id}`;
			if (replace) {
				hm.setHotkeys(full, free(a.keys, a.id));
				n++;
				continue;
			}
			const keys = free(a.keys, a.id);
			if (keys.length === 0 || (hm.customKeys?.[full] ?? []).length > 0) continue;
			hm.setHotkeys(full, keys);
			for (const h of keys) taken.add(sig(h));
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
		if (!this.keyboardHere()) return;
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
			if (k === "roughness") return !text && el.type !== "image";
			if (k === "edges") return el.type === "rectangle" || el.type === "diamond";
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
				else if (k === "edges") el.roundness = s.edges === "round" ? { type: el.type === "rectangle" ? 3 : 2 } : null;
				else if (k === "arrowType") setArrowType(el, s.arrowType ?? "sharp");
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
				if (shape.type !== "image") s.roughness = shape.roughness;
				if (shape.type === "rectangle" || shape.type === "diamond") s.edges = shape.roundness ? "round" : "sharp";
				if (shape.type === "arrow") {
					s.startArrowhead = shape.startArrowhead ?? null;
					s.endArrowhead = shape.endArrowhead ?? null;
					s.arrowType = shape.elbowed ? "elbow" : shape.roundness ? "round" : "sharp";
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
	/** The key panel has shown since the practice started. */
	sawWhichKey = false;
	/** The last tidy, line up or copy, for the practice. */
	lastDone = "";

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
		this.sawWhichKey = true;
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
	private leaderKeys: string[] = [];

	startLeader() {
		const c = this.context();
		if (!c || c.typing) return;
		this.stopWhichKey();
		this.leader = this.leaderTree();
		this.leaderPath = [];
		this.leaderKeys = [];
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
		const key = [...(node.children ?? new Map<string, LeaderNode>())].find(([k]) => k.toUpperCase() === combo.toUpperCase())?.[0] ?? combo;
		this.leaderKeys.push(key);
		if (next.children) {
			this.leader = next;
			this.leaderPath.push(next.label);
			this.showLeader();
			return;
		}
		this.endLeader();
		if (!next.noRecord) this.record({ t: "leader", keys: [...this.leaderKeys] });
		const run = next.run;
		void this.settle().then(() => {
			const c = this.context();
			if (c && run) void this.tracked(c, () => run(c));
		});
	}

	/** The menu behind the leader key. Letters are picked to be easy to remember, and can be changed in Settings. */
	leaderTree(withCustom = true): LeaderNode {
		const st = this.settings;
		const menu = (label: string, entries: [string, LeaderNode][]): LeaderNode => ({ label, children: new Map(entries) });
		const leaf = (label: string, run: (c: Ctx) => unknown): LeaderNode => ({ label, run });
		const style = (label: string, s: Style) => leaf(label, (c) => this.applyStyle(c, s, label));
		const digits = <T,>(list: T[], make: (t: T, i: number) => LeaderNode): [string, LeaderNode][] =>
			list.map((t, i) => [String(i + 1), make(t, i)]);
		/** Saved slots only, each on its own number. */
		const slots = <T,>(list: (T | null)[], make: (t: T, i: number) => LeaderNode): [string, LeaderNode][] =>
			list.flatMap((t, i): [string, LeaderNode][] => (t ? [[String(i + 1), make(t, i)]] : []));
		/** The first free slot, if there is one. */
		const free = <T,>(list: (T | null)[], make: (i: number) => LeaderNode): [string, LeaderNode][] => {
			const i = list.findIndex((t) => !t);
			return i < 0 ? [] : [[String(i + 1), make(i)]];
		};
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
			// Only saved presets show, plus one free slot to save into: no rows of empty slots.
			presets: menu("Pen presets", [
				...slots(st.presets, (p, i) => leaf(p.name, (c) => this.usePreset(c, i))),
				["S", menu("Save pen as preset", [
					...slots(st.presets, (p, i) => leaf(`Replace: ${p.name}`, (c) => this.savePreset(c, i))),
					...free(st.presets, (i) => leaf("New preset", (c) => this.savePreset(c, i))),
				])],
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
				["G", leaf("Tidy into a grid", (c) => this.tidyGrid(c))],
				["P", leaf("Swap two shapes", (c) => this.swap(c))],
				["L", menu("Layouts", [
					["F", leaf("Flowchart", (c) => this.layout(c, "flow"))],
					["T", leaf("Timeline", (c) => this.layout(c, "timeline"))],
					["K", leaf("Kanban board", (c) => this.layout(c, "kanban"))],
					["M", leaf("2×2 grid", (c) => this.layout(c, "matrix"))],
				])],
				["Z", menu("Same size", [
					["W", leaf("Same width", (c) => this.sameSize(c, "width"))],
					["H", leaf("Same height", (c) => this.sameSize(c, "height"))],
					["B", leaf("Same width and height", (c) => this.sameSize(c, "both"))],
				])],
			]),
			sketch: menu("Sketchy and corners", [
				...SKETCH.map(([name, r], i): [string, LeaderNode] => [String(i + 1), style(name[0].toUpperCase() + name.slice(1), { roughness: r })]),
				["R", style("Round corners", { edges: "round" })],
				["S", style("Sharp corners", { edges: "sharp" })],
			]),
			arrowtype: menu("Arrow shape", ARROW_TYPES.map(([name, t]): [string, LeaderNode] => [name[0].toUpperCase(), style(name[0].toUpperCase() + name.slice(1), { arrowType: t })])),
			shape: menu("Change shape", [
				["R", leaf("Box", (c) => this.setShape(c, "rectangle"))],
				["C", leaf("Circle", (c) => this.setShape(c, "ellipse"))],
				["D", leaf("Diamond", (c) => this.setShape(c, "diamond"))],
			]),
			mind: menu("Connect and mind map", [
				["N", leaf("New connected box", (c) => this.grow(c, false))],
				["B", leaf("New box beside", (c) => this.grow(c, true))],
				["C", leaf("Connect the selected shapes", (c) => this.connect(c))],
				["T", leaf("Tidy the mind map", (c) => this.tidyMap(c))],
				["F", leaf("Fold or open a branch", (c) => this.toggleFold(c))],
			]),
			styleclip: menu("Copy, paste and export", [
				["C", leaf("Copy style", (c) => this.copyStyle(c))],
				["V", leaf("Paste style", (c) => this.pasteStyle(c))],
				["I", leaf("Copy as an image", (c) => this.copyImage(c))],
				["N", leaf("Put as an image in a note", (c) => this.imageToNote(c))],
			]),
			similar: menu("Select similar", [
				["C", leaf("Same pen colour", (c) => this.selectSimilar(c, "colour"))],
				["F", leaf("Same fill", (c) => this.selectSimilar(c, "fill"))],
				["T", leaf("Same type", (c) => this.selectSimilar(c, "type"))],
				["S", leaf("Same style", (c) => this.selectSimilar(c, "style"))],
			]),
			turn: menu("Turn, flip and lock", [
				["E", leaf("Turn right 90°", (c) => this.turn(c, 90))],
				["Q", leaf("Turn left 90°", (c) => this.turn(c, -90))],
				["D", leaf("Turn right 15°", (c) => this.turn(c, 15))],
				["A", leaf("Turn left 15°", (c) => this.turn(c, -15))],
				["H", leaf("Flip left to right", (c) => this.flip(c, true))],
				["V", leaf("Flip top to bottom", (c) => this.flip(c, false))],
				["L", leaf("Lock", (c) => this.lock(c))],
				["U", leaf("Unlock all", (c) => this.unlockAll(c))],
			]),
			link: leaf("Link to a note", (c) => this.linkNote(c)),
			frames: menu("Frames", [
				["F", leaf("Put in a frame", (c) => this.wrapInFrame(c))],
				["N", leaf("Next frame", (c) => this.goFrame(c, 1))],
				["P", leaf("Previous frame", (c) => this.goFrame(c, -1))],
			]),
			stamps: menu("Stamps", [
				...digits(st.stamps.slice(0, 9), (s, i) => leaf(s.name, (c) => this.dropStamp(c, i))),
				["S", leaf("Save the selection as a stamp", (c) => this.saveStamp(c))],
				["Slash", leaf("Find a stamp", () => this.pickStamp())],
			]),
			recent: st.recentColours.length
				? menu("Recent colours", [
						...digits(st.recentColours.slice(0, 6), (col) => style(`${hueName(col)} pen`, { stroke: col })),
						["F", menu("Recent fill", digits(st.recentColours.slice(0, 6), (col) => style(`${hueName(col)} fill`, { fill: col })))],
					])
				: leaf("Recent colours (none yet)", () => showInfo("Use a colour, and it shows here")),
			macros: menu("Macros", [
				...slots(st.macros, (m, i) => leaf(m.name, () => this.playMacro(i))),
				["R", { label: this.recording ? "Stop recording" : "Record a macro", run: () => this.toggleRecord(), noRecord: true }],
			]),
			search: leaf("Search styles and commands", () => this.openSearch()),
		};
		const root = menu("Leader", []);
		for (const [id, , def] of LEADER_MENUS) {
			const key = st.leaderMenuKeys[id] ?? def;
			if (key) root.children?.set(key, menus[id]);
		}
		root.children?.set("Shift+Slash", { label: "Guide: how to use all this", run: () => new GuideModal(this.app, this).open(), noRecord: true });
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
		style("Sketchiness: clean", "sketch", { roughness: 0 }, "architect neat smooth rough");
		style("Sketchiness: sketchy", "sketch", { roughness: 1 }, "artist rough hand");
		style("Sketchiness: very sketchy", "sketch", { roughness: 2 }, "cartoonist messy rough loose");
		style("Corners: round", "edges", { edges: "round" }, "rounded soft edges");
		style("Corners: sharp", "edges", { edges: "sharp" }, "square pointed edges");
		style("Arrow shape: straight", "arrowtype", { arrowType: "sharp" }, "arrow direct");
		style("Arrow shape: curved", "arrowtype", { arrowType: "round" }, "arrow curve bend");
		style("Arrow shape: elbow", "arrowtype", { arrowType: "elbow" }, "arrow elbowed orthogonal right angle bent");
		st.presets.forEach((p, i) => {
			if (p) items.push({ label: `Preset ${i + 1}: ${p.name}`, hint: p.auto ? "" : describeStyle(p.style, st), kind: "preset", style: p.style, words: words(`preset ${i + 1} ${p.name} ${describeStyle(p.style, st)}`) });
		});
		for (const a of this.visibleActions()) {
			const keys = [...(st.toolKeys[a.id] ? [comboLabel(st.toolKeys[a.id])] : []), ...this.hotkeysFor(a.id).map(hotkeyLabel)];
			items.push({
				label: a.name,
				hint: keys.join(", "),
				kind: "command",
				actionId: a.id,
				run: (c) => (a.canRun(c) ? a.run(c) : showInfo(c.selected.length === 0 ? "Select something first" : "This does not change what is selected")),
				words: words(`${a.name} ${a.group} command`),
			});
		}
		return items;
	}

	/** Best matches first. Several style words at once ("blue dashed bold") give one combined result on top. */
	searchSuggestions(query: string, items: SearchItem[]): SearchItem[] {
		// A colour code, like #ff8800: the pen and the fill in that colour. "fill" first puts fill on top.
		const hex = hexIn(query);
		if (hex) {
			const name = hueName(hex).toLowerCase();
			const pen: SearchItem = { label: `Pen colour: ${hex}`, hint: name, kind: "pen", style: { stroke: hex }, words: [] };
			const fill: SearchItem = { label: `Fill colour: ${hex}`, hint: name, kind: "fill", style: { fill: hex }, words: [] };
			return words(query).includes("fill") ? [fill, pen] : [pen, fill];
		}
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
				const label = it.label.replace(/^(Preset \d+|[^:]*): /, "");
				if (it.style) this.record({ t: "style", style: it.style, label });
				else if (it.actionId) this.record({ t: "action", id: it.actionId });
				void this.tracked(now, () => (it.style ? this.applyStyle(now, it.style, label) : it.run?.(now)));
			}, 50);
		}).open();
	}

	/** After an update, open the list of changes once. */
	private async afterUpdate(fresh: boolean) {
		const was = this.settings.seenVersion;
		const now = this.manifest.version;
		if (was === now) return;
		this.settings.seenVersion = now;
		await this.saveSettings();
		if (!fresh && this.settings.showWhatsNew) await this.openWhatsNew(was || "0.7.1");
	}

	/** Open the "What's new" tab, or bring it to the front. since marks the versions after it as new. */
	async openWhatsNew(since = "") {
		const ws = this.app.workspace;
		const leaf = ws.getLeavesOfType(WHATS_NEW_VIEW)[0] ?? ws.getLeaf("tab");
		await leaf.setViewState({ type: WHATS_NEW_VIEW, active: true, state: { since } });
		await ws.revealLeaf(leaf);
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
		this.noteColours(style);
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
	private queue: Promise<void> = Promise.resolve();
	private waiting = 0;

	/**
	 * Keys run one after another, each from where the last one left things.
	 * A key pressed during a glide makes it finish at once.
	 */
	runAction(a: Action, given: Ctx): Promise<void> {
		if (this.playing) return this.runNow(a, given);
		this.waiting++;
		const job = this.queue.then(() => {
			this.waiting--;
			return this.runNow(a, given, true);
		});
		this.queue = job.catch(() => undefined);
		return job;
	}

	private async runNow(a: Action, given: Ctx, fresh = false): Promise<void> {
		await this.settle();
		// Read the drawing again: the key before this one may have changed it.
		const c = fresh ? (this.context() ?? given) : given;
		// The leader key and search save the step they lead to, not themselves.
		if (!["record-macro", "leader", "search"].includes(a.id)) this.record({ t: "action", id: a.id });
		if (a.id === "repeat") return void (await a.run(c));
		return this.tracked(c, () => a.run(c));
	}

	// -----------------------------------------------------------------------
	// Line up and spread out
	// -----------------------------------------------------------------------

	/** The outside box of one element as you see it. Lines use their points; a turned shape uses its turned corners. */
	private boxOf(e: El): { x1: number; y1: number; x2: number; y2: number } {
		let pts: [number, number][] =
			e.points && e.points.length > 0
				? e.points.map((p): [number, number] => [e.x + p[0], e.y + p[1]])
				: [[e.x, e.y], [e.x + e.width, e.y], [e.x + e.width, e.y + e.height], [e.x, e.y + e.height]];
		const a = e.angle ?? 0;
		if (Math.abs(a) > 1e-6) {
			// Excalidraw turns a shape around the middle of its own box.
			const cx = e.x + e.width / 2;
			const cy = e.y + e.height / 2;
			const cos = Math.cos(a);
			const sin = Math.sin(a);
			pts = pts.map(([x, y]): [number, number] => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
		}
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
	}

	private boxOfAll(els: El[]): { x1: number; y1: number; x2: number; y2: number } {
		const b = els.map((e) => this.boxOf(e));
		return { x1: Math.min(...b.map((v) => v.x1)), y1: Math.min(...b.map((v) => v.y1)), x2: Math.max(...b.map((v) => v.x2)), y2: Math.max(...b.map((v) => v.y2)) };
	}

	/**
	 * The selection as things that move together, the way you see them:
	 * - a group, a box with its label, and a frame with what is in it;
	 * - a loose text on or next to a drawing or shape goes with it, like a caption;
	 * - a caption you did not select comes along when it clearly belongs to a selected drawing.
	 * An arrow tied to a shape is left out; it follows its shape. Locked things never move.
	 * With together off, only groups, labels and frames join.
	 */
	units(c: Ctx, together = true): { els: El[]; box: { x1: number; y1: number; x2: number; y2: number } }[] {
		const live = c.all.filter((e) => !e.isDeleted);
		const byId = new Map(live.map((e) => [e.id, e]));
		const bound = (e: El) => (e.type === "arrow" || e.type === "line") && (e.startBinding || e.endBinding);
		const taken = new Set<string>();
		const groups: El[][] = [];
		// Excalidraw also lists what is inside a selected frame as selected. It all goes with the frame.
		const frames = new Set(c.selected.filter((e) => e.type === "frame").map((e) => e.id));
		const keyOf = (e: El): string => {
			const owner = e.type === "text" && e.containerId ? (byId.get(e.containerId) ?? e) : e;
			if (owner.frameId && frames.has(owner.frameId)) return owner.frameId;
			return owner.groupIds?.[owner.groupIds.length - 1] ?? owner.id;
		};
		const map = new Map<string, El[]>();
		for (const e of withBoundText(c)) {
			if (e.isDeleted || e.locked || bound(e)) continue;
			const k = keyOf(e);
			map.set(k, [...(map.get(k) ?? []), e]);
		}
		// A selected group member brings the whole group. A frame brings what is in it.
		for (const list of map.values()) {
			const gid = list[0].groupIds?.[list[0].groupIds.length - 1];
			const frames = list.filter((e) => e.type === "frame").map((e) => e.id);
			for (const e of live) {
				if (list.includes(e) || e.locked) continue;
				const inGroup = !!gid && keyOf(e) === gid;
				const inFrame = !!e.frameId && frames.includes(e.frameId);
				const label = e.type === "text" && !!e.containerId && list.some((x) => x.id === e.containerId);
				if (inGroup || inFrame || label) list.push(e);
			}
			groups.push(list);
		}
		// One thing in two lists (a framed shape that was also selected): keep it in the first.
		const units = groups
			.map((list) => list.filter((e) => (taken.has(e.id) ? false : (taken.add(e.id), true))))
			.filter((list) => list.length > 0)
			.map((els) => ({ els, box: this.boxOfAll(els) }));
		if (!together) return units;

		// Captions: a loose text that sits on a shape, or close beside it.
		const isCaption = (e: El) => e.type === "text" && !e.containerId && !(e.groupIds ?? []).length;
		const gapBetween = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) =>
			Math.hypot(Math.max(0, b.x1 - a.x2, a.x1 - b.x2), Math.max(0, b.y1 - a.y2, a.y1 - b.y2));
		const overlap = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) => {
			const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
			const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
			const area = Math.max(1, (a.x2 - a.x1) * (a.y2 - a.y1));
			return (w * h) / area;
		};
		const reach = (t: El) => Math.max(12, (t.fontSize || 20) * 0.75);
		/** The drawing or shape a text belongs to, from the ones given: the one it sits on, else the nearest within reach. */
		const ownerOf = <T extends { box: { x1: number; y1: number; x2: number; y2: number } }>(t: El, tb: T["box"], owners: T[]): T | null => {
			let best: T | null = null;
			let bestScore = Infinity;
			for (const o of owners) {
				const on = overlap(tb, o.box);
				const d = gapBetween(tb, o.box);
				if (on < 0.5 && d > reach(t)) continue;
				const score = on >= 0.5 ? -on : d;
				if (score < bestScore) {
					bestScore = score;
					best = o;
				}
			}
			return best;
		};
		const solo = (u: (typeof units)[number]) => u.els.length === 1 && isCaption(u.els[0]);
		const owners = units.filter((u) => !solo(u));
		// Every other shape in the drawing, so a caption that belongs to a neighbour stays with the neighbour.
		const others = live
			.filter((e) => !taken.has(e.id) && e.type !== "text" && !bound(e) && e.type !== "frame")
			.map((e) => ({ els: [e], box: this.boxOf(e) }));
		for (const u of units.filter(solo)) {
			const t = u.els[0];
			const o = ownerOf(t, u.box, [...owners, ...others]);
			if (!o || !owners.includes(o)) continue;
			o.els.push(t);
			o.box = this.boxOfAll(o.els);
			u.els = [];
		}
		// A caption you did not select, on or right next to a selected drawing.
		for (const t of live) {
			if (taken.has(t.id) || t.locked || !isCaption(t)) continue;
			const tb = this.boxOf(t);
			const o = ownerOf(t, tb, [...owners, ...others]);
			if (!o || !owners.includes(o)) continue;
			// Only when it is clearly that drawing's own text: on it, or within half a line of it.
			if (overlap(tb, o.box) < 0.5 && gapBetween(tb, o.box) > (t.fontSize || 20) * 0.5) continue;
			o.els.push(t);
			o.box = this.boxOfAll(o.els);
			taken.add(t.id);
		}
		return units.filter((u) => u.els.length > 0);
	}

	/**
	 * Move elements, gliding there. Each move is its end step, or a path over time (for turning).
	 * Arrows tied to a moved shape follow it. `extra` changes each moved element too, at time t.
	 * It all lands as one undo step.
	 */
	async applyMoves(
		c: Ctx,
		moves: Map<string, { dx: number; dy: number; at?: (t: number) => { dx: number; dy: number } }>,
		extra?: (el: El, t: number) => void,
	) {
		const step = (m: { dx: number; dy: number; at?: (t: number) => { dx: number; dy: number } } | undefined, t: number) =>
			m ? (m.at ? m.at(t) : { dx: m.dx * t, dy: m.dy * t }) : undefined;
		// Arrows tied to a moved shape: move the tied end with it.
		const arrows = new Map<string, { start?: string; end?: string }>();
		for (const e of c.all) {
			if (e.isDeleted || moves.has(e.id) || !e.points || e.points.length < 2) continue;
			const start = e.startBinding && moves.has(e.startBinding.elementId) ? e.startBinding.elementId : undefined;
			const end = e.endBinding && moves.has(e.endBinding.elementId) ? e.endBinding.elementId : undefined;
			if (start || end) arrows.set(e.id, { start, end });
		}
		const byId = new Map(c.all.map((x) => [x.id, x]));
		const place = (el: El, t: number) => {
			const m = moves.get(el.id);
			if (m) {
				const d = step(m, t) as { dx: number; dy: number };
				el.x += d.dx;
				el.y += d.dy;
				extra?.(el, t);
				return;
			}
			const a = arrows.get(el.id);
			if (!a || !el.points) return;
			const s = a.start ? step(moves.get(a.start), t) : undefined;
			const e = a.end ? step(moves.get(a.end), t) : undefined;
			const pts = el.points.map((p): [number, number] => [p[0], p[1]]);
			if (s && e && Math.abs(s.dx - e.dx) < 0.01 && Math.abs(s.dy - e.dy) < 0.01) {
				el.x += s.dx;
				el.y += s.dy;
				return;
			}
			const ds = s ?? { dx: 0, dy: 0 };
			const de = e ?? { dx: 0, dy: 0 };
			const way = curveOf(el);
			const ends = [el.startBinding?.elementId, el.endBinding?.elementId].map((id) => (id ? byId.get(id) : undefined));
			if (ends[0] && ends[1] && (way || pts.length === 2 || el.elbowed)) {
				const shifted = (x: El, d: { dx: number; dy: number } | undefined) => {
					const v = this.boxOf(x);
					return d ? { x1: v.x1 + d.dx, y1: v.y1 + d.dy, x2: v.x2 + d.dx, y2: v.y2 + d.dy } : v;
				};
				const type = el.elbowed ? "elbow" : el.roundness ? "round" : "sharp";
				if (routeArrow(el, shifted(ends[0], s), shifted(ends[1], e), type, way)) return;
			}
			const p0 = pts[0];
			const pn = pts[pts.length - 1];
			const vx = pn[0] - p0[0];
			const vy = pn[1] - p0[1];
			const len2 = vx * vx + vy * vy || 1;
			el.x += ds.dx;
			el.y += ds.dy;
			// Each point moves with the end it is nearer to, so a hand-drawn bend stretches instead of kinking.
			const moved = pts.map((p, i): [number, number] => {
				const t = i === 0 ? 0 : i === pts.length - 1 ? 1 : Math.min(1, Math.max(0, ((p[0] - p0[0]) * vx + (p[1] - p0[1]) * vy) / len2));
				return [p[0] + ds.dx * (1 - t) + de.dx * t - ds.dx, p[1] + ds.dy * (1 - t) + de.dy * t - ds.dy];
			});
			el.points = moved;
			if (el.elbowed) {
				// An elbow arrow keeps right-angle bends between its new ends.
				setArrowType(el, "elbow");
			} else if (way) {
				// A nice arrow is drawn fresh between the new ends: straight once they line up.
				shapeArrow(el, moved[0], moved[moved.length - 1], way === "wide", el.roundness ? "round" : "sharp");
			}
			const xs = (el.points ?? pts).map((p) => p[0]);
			const ys = (el.points ?? pts).map((p) => p[1]);
			el.width = Math.max(...xs) - Math.min(...xs);
			el.height = Math.max(...ys) - Math.min(...ys);
		};
		const ids = new Set([...moves.keys(), ...arrows.keys()]);
		const targets = c.all.filter((e) => ids.has(e.id));
		await this.busy(async () => {
			await this.glide(c, targets, place);
			await edit(c, targets, (el) => place(el, 1));
		});
	}

	private gliding: Promise<void> | null = null;
	private hurry = false;

	/** Run a gliding change. Only one at a time. */
	private async busy(fn: () => Promise<void>) {
		await this.settle();
		const p = fn();
		this.gliding = p;
		try {
			await p;
		} finally {
			if (this.gliding === p) this.gliding = null;
			this.hurry = false;
		}
	}

	/** Finish a running glide at once, so the next change starts from where things really are. */
	async settle() {
		if (!this.gliding) return;
		this.hurry = true;
		await this.gliding;
	}

	/** Change elements, gliding size and place to the new values. One undo step. */
	async editSmooth(c: Ctx, els: El[], fn: (el: El) => void) {
		const end = new Map(
			els.map((e) => {
				const y = JSON.parse(JSON.stringify(e)) as El;
				fn(y);
				return [e.id, y];
			}),
		);
		await this.busy(async () => {
			await this.glide(c, els, (el, t) => {
				const f = end.get(el.id);
				if (!f) return;
				for (const k of ["x", "y", "width", "height"] as const) el[k] = el[k] + (f[k] - el[k]) * t;
			});
			await edit(c, els, fn);
		});
	}

	/**
	 * Show elements moving to where they will end, over a short time, without touching undo.
	 * Then put them back, so the real change is one clean undo step.
	 */
	private async glide(c: Ctx, targets: El[], place: (el: El, t: number) => void) {
		const ms = activeDocument.hidden || c.typing ? 0 : this.settings.moveMs;
		const api = c.ea.getExcalidrawAPI?.();
		if (ms <= 0 || !api || targets.length === 0) return;
		const ids = new Set(targets.map((e) => e.id));
		const orig = new Map(targets.map((e) => [e.id, e]));
		const ease = (p: number) => 1 - Math.pow(1 - p, 3);
		const frameAt = (t: number) =>
			api.getSceneElementsIncludingDeleted().map((x: El) => {
				const o = orig.get(x.id);
				if (!o || !ids.has(x.id)) return x;
				const y = JSON.parse(JSON.stringify(o)) as El;
				if (t > 0) place(y, t);
				return { ...y, versionNonce: newSeed() };
			});
		const start = performance.now();
		let finished = false;
		await new Promise<void>((resolve) => {
			const done = () => {
				finished = true;
				resolve();
			};
			const tick = (now: number) => {
				if (finished) return;
				const p = this.hurry || this.waiting > 0 ? 1 : Math.min(1, (now - start) / ms);
				api.updateScene({ elements: frameAt(ease(p)), captureUpdate: "NEVER" });
				if (p < 1) window.requestAnimationFrame(tick);
				else done();
			};
			window.requestAnimationFrame(tick);
			// A window that gets no frames still finishes.
			window.setTimeout(done, ms + 400);
		});
		api.updateScene({ elements: frameAt(0), captureUpdate: "NEVER" });
	}

	/** Line up or spread out the selection. Arrows tied to a moved shape follow it. */
	async arrange(c: Ctx, mode: "left" | "right" | "top" | "bottom" | "centre" | "middle" | "across" | "down") {
		const spread = mode === "across" || mode === "down";
		const need = spread ? 3 : 2;
		// Captions go with their drawing. If that leaves too few things, line up each one on its own.
		let units = this.units(c);
		if (units.length < need) units = this.units(c, false);
		if (units.length < need) return showInfo(spread ? "Select 3 or more shapes to spread" : "Select 2 or more shapes to line up");
		this.lastDone = "arrange";
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
			if (gap >= 0) {
				let at = lo(first) + size(first) + gap;
				for (const u of sorted.slice(1, -1)) {
					const d = at - lo(u);
					move(u, across ? d : 0, across ? 0 : d);
					at += size(u) + gap;
				}
			} else {
				// Too big to fit with gaps between them: space their middles evenly instead.
				const mid = (u: (typeof units)[number]) => lo(u) + size(u) / 2;
				const m0 = mid(first);
				const step = (mid(last) - m0) / (sorted.length - 1);
				sorted.slice(1, -1).forEach((u, i) => {
					const d = m0 + step * (i + 1) - mid(u);
					move(u, across ? d : 0, across ? 0 : d);
				});
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

		await this.applyMoves(c, moves);
		const names = { left: "Lined up left", right: "Lined up right", top: "Lined up top", bottom: "Lined up bottom", centre: "Centred left to right", middle: "Centred top to bottom", across: "Spread across", down: "Spread down" };
		showInfo(names[mode]);
	}

	/** The main shape of each selected unit: a box instead of its label, a group's biggest shape. */
	private mains(c: Ctx): El[] {
		return this.units(c).map((u) => {
			const shapes = u.els.filter((e) => e.type !== "text" && !LINEAR.includes(e.type));
			const pool = shapes.length ? shapes : u.els;
			return pool.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
		});
	}

	/** Shapes in the order they sit: left to right when spread wide, else top to bottom. */
	private inLine(els: El[]): El[] {
		const xs = els.map((e) => this.centreOf(e).x);
		const ys = els.map((e) => this.centreOf(e).y);
		const wide = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
		return [...els].sort((a, b) => (wide ? this.centreOf(a).x - this.centreOf(b).x : this.centreOf(a).y - this.centreOf(b).y));
	}

	/** Units sorted like reading: top row first, left to right. Shapes less than half a height apart share a row. */
	private readingOrder<T extends { box: { x1: number; y1: number; x2: number; y2: number } }>(units: T[]): T[] {
		const byY = [...units].sort((a, b) => a.box.y1 - b.box.y1);
		const rows: T[][] = [];
		for (const u of byY) {
			const row = rows[rows.length - 1];
			const h = u.box.y2 - u.box.y1;
			if (row && Math.abs(row[0].box.y1 - u.box.y1) < h / 2) row.push(u);
			else rows.push([u]);
		}
		return rows.flatMap((r) => r.sort((a, b) => a.box.x1 - b.box.x1));
	}

	// -----------------------------------------------------------------------
	// Mind map and connect
	// -----------------------------------------------------------------------

	private parentOf(c: Ctx, el: El): El | null {
		const a = c.all.find((x) => x.type === "arrow" && !x.isDeleted && x.endBinding?.elementId === el.id && x.startBinding);
		return a ? (c.all.find((e) => e.id === a.startBinding?.elementId && !e.isDeleted) ?? null) : null;
	}

	private childrenOf(c: Ctx, el: El): El[] {
		return c.all
			.filter((x) => x.type === "arrow" && !x.isDeleted && x.startBinding?.elementId === el.id && x.endBinding)
			.map((a) => c.all.find((e) => e.id === a.endBinding?.elementId && !e.isDeleted))
			.filter((e): e is El => !!e);
	}

	/** Add a box tied to the selected one (a child), or next to it (a sibling), then type in it. */
	async grow(c: Ctx, sibling: boolean) {
		const cur = this.currentStop(c);
		if (!cur || !SHAPES.includes(cur.type)) return showInfo("Select a box first");
		const from = sibling ? this.parentOf(c, cur) : cur;
		const gap = this.settings.duplicateGap;
		// Room for a few words, even when the box it grows from is small.
		const w = Math.max(cur.width, 160);
		const h = Math.max(cur.height, 64);
		let x: number;
		let y: number;
		let flow = "wide";
		if (from) {
			// Grow away from the parent's own parent, or the way its children already go. Right by default.
			const gp = this.parentOf(c, from);
			const kids = this.childrenOf(c, from);
			const ref = gp ? { a: gp, b: from } : kids.length ? { a: from, b: kids[0] } : null;
			let dx = 1;
			let dy = 0;
			if (ref) {
				const vx = this.centreOf(ref.b).x - this.centreOf(ref.a).x;
				const vy = this.centreOf(ref.b).y - this.centreOf(ref.a).y;
				[dx, dy] = Math.abs(vx) >= Math.abs(vy) ? [Math.sign(vx) || 1, 0] : [0, Math.sign(vy) || 1];
			}
			flow = dx !== 0 ? "wide" : "tall";
			if (kids.length) {
				// Next in the row of children.
				if (dx !== 0) {
					x = kids[0].x;
					y = Math.max(...kids.map((k) => k.y + k.height)) + gap / 2;
				} else {
					y = kids[0].y;
					x = Math.max(...kids.map((k) => k.x + k.width)) + gap / 2;
				}
			} else {
				x = dx > 0 ? from.x + from.width + gap : dx < 0 ? from.x - gap - w : from.x + (from.width - w) / 2;
				y = dy > 0 ? from.y + from.height + gap : dy < 0 ? from.y - gap - h : from.y + (from.height - h) / 2;
			}
		} else {
			// A sibling with no parent: just below.
			x = cur.x;
			y = cur.y + cur.height + gap / 2;
		}
		const copy = cloneEl(cur, x - cur.x, y - cur.y);
		copy.width = w;
		copy.height = h;
		copy.link = null;
		// A new box, not a copy: it keeps the style but none of the old box's own data.
		(copy as unknown as Record<string, unknown>).customData = undefined;
		const ea = c.ea;
		ea.copyViewElementsToEAforEditing(from ? [from] : []);
		ea.elementsDict[copy.id] = copy;
		if (from) this.niceArrow(c, from, copy, flow);
		await commitEA(ea, [copy.id]);
		this.selectOnly(c, copy);
		// Enter on a selected box opens its label in Excalidraw, so you can type at once.
		await sleepMs(60);
		excalidrawKey("Enter", "Enter");
	}

	/**
	 * Tie a to b with an arrow placed the way a person would: out of the sides that face each
	 * other, a small gap at each end, straight when the two are in line, else a soft S.
	 * It follows your pen's arrow shape: straight, curved (the S) or elbow.
	 */
	private niceArrow(c: Ctx, a: El, b: El, prefer?: string): string {
		const ea = c.ea;
		// A very sketchy arrow wobbles and looks messy; arrows stay at sketchy at most.
		Object.assign(ea.style, { strokeColor: a.strokeColor, strokeWidth: Math.min(2, a.strokeWidth ?? 1), roughness: Math.min(1, a.roughness ?? ea.style.roughness) });
		// Excalidraw ties the ends to the shapes; the router then lays the line.
		const id = ea.connectObjects(a.id, null, b.id, null, { startArrowHead: null, endArrowHead: "arrow", numberOfPoints: 0, padding: 8 });
		const ar = ea.getElement(id);
		if (!routeArrow(ar, this.boxOf(a), this.boxOf(b), this.arrowType(c), prefer)) markCurve(ar, undefined);
		return id;
	}

	/** The arrow shape from Settings, Arrow style: sharp (straight), round (curved) or elbow. */
	arrowType(c: Ctx): string {
		const st = this.settings.arrowStyle;
		if (st === "straight") return "sharp";
		if (st === "elbow") return "elbow";
		if (st === "pen") {
			const pen = (c.ea.getExcalidrawAPI?.()?.getAppState() as unknown as Record<string, unknown> | undefined)?.currentItemArrowType;
			return typeof pen === "string" ? pen : "round";
		}
		return "round";
	}

	/** Tie the selected shapes together with arrows, in the order they sit. */
	async connect(c: Ctx) {
		const els = this.inLine(this.mains(c).filter((e) => e.type !== "text"));
		if (els.length < 2) return showInfo("Select 2 or more shapes to connect");
		const ea = c.ea;
		ea.copyViewElementsToEAforEditing(els);
		const xs = els.map((e) => this.centreOf(e).x);
		const ys = els.map((e) => this.centreOf(e).y);
		const flow = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? "wide" : "tall";
		for (let i = 0; i + 1 < els.length; i++) this.niceArrow(c, els[i], els[i + 1], flow);
		await commitEA(ea, els.map((e) => e.id));
		showInfo(els.length === 2 ? "Connected" : `Connected ${els.length} shapes`);
	}

	// -----------------------------------------------------------------------
	// Shapes: change type, sketchiness and corners
	// -----------------------------------------------------------------------

	/** Turn boxes into circles or diamonds. Null steps to the next shape. Text, style and arrows stay. */
	async setShape(c: Ctx, type: string | null) {
		const els = c.selected.filter((e) => SHAPES.includes(e.type));
		if (els.length === 0) return showInfo("Select a box, circle or diamond");
		const next = type ?? SHAPES[(SHAPES.indexOf(els[0].type) + 1) % SHAPES.length];
		await edit(c, els, (el) => {
			const round = !!el.roundness || el.type === "ellipse";
			el.type = next;
			el.roundness = next === "ellipse" || !round ? null : { type: next === "rectangle" ? 3 : 2 };
		});
		// Excalidraw places a label for the new shape once the label is touched.
		const labels = withBoundText(c).filter((e) => e.type === "text");
		if (labels.length) {
			c.ea.copyViewElementsToEAforEditing(labels);
			for (const t of c.ea.getElements()) c.ea.refreshTextElementSize?.(t.id);
			await c.ea.addElementsToView(false, false);
		}
		showInfo(`Shape: ${{ rectangle: "box", ellipse: "circle", diamond: "diamond" }[next] ?? next}`);
	}

	// -----------------------------------------------------------------------
	// Copy and paste a style
	// -----------------------------------------------------------------------

	private styleClip: Style | null = null;

	copyStyle(c: Ctx) {
		const s = this.currentStyle(c);
		this.styleClip = s;
		showInfo(`Copied style: ${describeStyle(s, this.settings)}`);
	}

	async pasteStyle(c: Ctx) {
		if (!this.styleClip) return showInfo("Copy a style first");
		await this.applyStyle(c, this.styleClip, "Pasted style");
	}

	// -----------------------------------------------------------------------
	// Select similar
	// -----------------------------------------------------------------------

	selectSimilar(c: Ctx, by: "colour" | "fill" | "type" | "style") {
		const cur = this.currentStop(c);
		if (!cur) return showInfo("Select one shape first");
		const lc = (v?: string) => (v ?? "").toLowerCase();
		const key = (e: El): string => {
			if (by === "colour") return lc(e.strokeColor);
			if (by === "fill") return lc(e.backgroundColor);
			if (by === "type") return e.type;
			return [e.type === "text" ? "text" : "shape", lc(e.strokeColor), lc(e.backgroundColor), e.strokeWidth, e.strokeStyle, e.fillStyle, e.roughness].join("|");
		};
		if (by === "fill" && lc(cur.backgroundColor) === "transparent") return showInfo("This shape has no fill");
		const want = key(cur);
		const hits = c.all.filter((e) => !e.isDeleted && !e.locked && !(e.type === "text" && e.containerId) && key(e) === want);
		selectIds(c, hits.map((e) => e.id));
		showInfo(`Selected ${hits.length} with the same ${by}`);
	}

	// -----------------------------------------------------------------------
	// Same size, grid, swap
	// -----------------------------------------------------------------------

	async sameSize(c: Ctx, mode: "width" | "height" | "both") {
		const els = c.selected.filter((e) => e.type !== "text" && !LINEAR.includes(e.type));
		if (els.length < 2) return showInfo("Select 2 or more shapes");
		const w = Math.max(...els.map((e) => e.width));
		const h = Math.max(...els.map((e) => e.height));
		await this.editSmooth(c, els, (el) => {
			if (mode !== "height") {
				el.x -= (w - el.width) / 2;
				el.width = w;
			}
			if (mode !== "width") {
				el.y -= (h - el.height) / 2;
				el.height = h;
			}
		});
		showInfo(mode === "both" ? "Same size" : `Same ${mode}`);
	}

	/** Put the selection into neat rows and columns, in reading order. */
	async tidyGrid(c: Ctx) {
		const first = this.units(c);
		const units = this.readingOrder(first.length >= 2 ? first : this.units(c, false));
		if (units.length < 2) return showInfo("Select 2 or more shapes");
		const cols = Math.ceil(Math.sqrt(units.length));
		const cw = Math.max(...units.map((u) => u.box.x2 - u.box.x1));
		const ch = Math.max(...units.map((u) => u.box.y2 - u.box.y1));
		const gap = Math.max(20, this.settings.duplicateGap / 2);
		const x0 = Math.min(...units.map((u) => u.box.x1));
		const y0 = Math.min(...units.map((u) => u.box.y1));
		const moves = new Map<string, { dx: number; dy: number }>();
		units.forEach((u, i) => {
			const cx = x0 + (i % cols) * (cw + gap) + cw / 2;
			const cy = y0 + Math.floor(i / cols) * (ch + gap) + ch / 2;
			const dx = cx - (u.box.x1 + u.box.x2) / 2;
			const dy = cy - (u.box.y1 + u.box.y2) / 2;
			if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) for (const e of u.els) moves.set(e.id, { dx, dy });
		});
		if (moves.size === 0) return showInfo("Already in a grid");
		await this.applyMoves(c, moves);
		showInfo(`Grid: ${cols} across`);
	}

	async swap(c: Ctx) {
		let units = this.units(c);
		if (units.length !== 2) units = this.units(c, false);
		if (units.length !== 2) return showInfo("Select 2 shapes to swap");
		const mid = (u: (typeof units)[number]) => ({ x: (u.box.x1 + u.box.x2) / 2, y: (u.box.y1 + u.box.y2) / 2 });
		const [a, b] = units;
		const ma = mid(a);
		const mb = mid(b);
		const moves = new Map<string, { dx: number; dy: number }>();
		for (const e of a.els) moves.set(e.id, { dx: mb.x - ma.x, dy: mb.y - ma.y });
		for (const e of b.els) moves.set(e.id, { dx: ma.x - mb.x, dy: ma.y - mb.y });
		await this.applyMoves(c, moves);
		showInfo("Swapped");
	}

	// -----------------------------------------------------------------------
	// Turn, flip and lock
	// -----------------------------------------------------------------------

	/** Turn the selection around its middle. Positive is clockwise. */
	async turn(c: Ctx, deg: number) {
		const units = this.units(c);
		if (units.length === 0) return showInfo("Select something first");
		const O = {
			x: (Math.min(...units.map((u) => u.box.x1)) + Math.max(...units.map((u) => u.box.x2))) / 2,
			y: (Math.min(...units.map((u) => u.box.y1)) + Math.max(...units.map((u) => u.box.y2))) / 2,
		};
		const r = (deg * Math.PI) / 180;
		const moves = new Map<string, { dx: number; dy: number; at?: (t: number) => { dx: number; dy: number } }>();
		for (const e of units.flatMap((u) => u.els)) {
			const p = this.centreOf(e);
			const vx = p.x - O.x;
			const vy = p.y - O.y;
			// Along the circle, so it swings round instead of cutting across.
			const at = (t: number) => ({ dx: O.x + vx * Math.cos(r * t) - vy * Math.sin(r * t) - p.x, dy: O.y + vx * Math.sin(r * t) + vy * Math.cos(r * t) - p.y });
			moves.set(e.id, { ...at(1), at });
		}
		const full = Math.PI * 2;
		await this.applyMoves(c, moves, (el, t) => (el.angle = ((((el.angle ?? 0) + r * t) % full) + full) % full));
		showInfo(`Turned ${Math.abs(deg)}° ${deg > 0 ? "right" : "left"}`);
	}

	flip(c: Ctx, across: boolean) {
		if (c.selected.length === 0) return showInfo("Select something first");
		excalidrawKey(across ? "H" : "V", across ? "KeyH" : "KeyV", true);
		showInfo(across ? "Flipped left to right" : "Flipped top to bottom");
	}

	async lock(c: Ctx) {
		const els = withBoundText(c);
		if (els.length === 0) return showInfo("Select something first");
		await edit(c, els, (el) => (el.locked = true));
		selectIds(c, []);
		showInfo(`Locked ${this.units(c).length || els.length}. Unlock all to undo.`);
	}

	async unlockAll(c: Ctx) {
		const els = c.all.filter((e) => e.locked && !e.isDeleted);
		if (els.length === 0) return showInfo("Nothing is locked");
		await edit(c, els, (el) => (el.locked = false));
		selectIds(c, els.filter((e) => !(e.type === "text" && e.containerId)).map((e) => e.id));
		showInfo(`Unlocked ${els.filter((e) => !(e.type === "text" && e.containerId)).length}`);
	}

	// -----------------------------------------------------------------------
	// Link a shape to a note
	// -----------------------------------------------------------------------

	linkNote(c: Ctx) {
		const els = this.mains(c);
		if (els.length === 0) return showInfo("Select a shape first");
		const ids = els.map((e) => e.id);
		const hasLink = els.some((e) => !!e.link);
		const from = this.app.workspace.getActiveFile()?.path ?? "";
		new NotePickerModal(this.app, hasLink, (file) => {
			window.setTimeout(() => {
				const now = this.context();
				if (!now) return;
				const link = file ? `[[${this.app.metadataCache.fileToLinktext(file, from)}]]` : null;
				void edit(now, now.all.filter((e) => ids.includes(e.id)), (el) => (el.link = link)).then(() =>
					showInfo(file ? `Linked to ${file.basename}` : "Link removed"),
				);
			}, 50);
		}).open();
	}

	// -----------------------------------------------------------------------
	// Mind map: tidy and fold
	// -----------------------------------------------------------------------

	/** The top of the map the box is in: follow arrows back until there is no parent. */
	private mapRoot(c: Ctx, el: El): El {
		let root = el;
		const seen = new Set([el.id]);
		for (let p = this.parentOf(c, root); p && !seen.has(p.id); p = this.parentOf(c, root)) {
			seen.add(p.id);
			root = p;
		}
		return root;
	}

	/** The box and the label inside it. */
	private withLabel(c: Ctx, el: El): El[] {
		return [el, ...c.all.filter((t) => !t.isDeleted && t.containerId === el.id)];
	}

	/** Space out the whole map the selected box is in, so no branch overlaps another. The top box stays put. */
	async tidyMap(c: Ctx) {
		const start = this.currentStop(c);
		if (!start || !SHAPES.includes(start.type)) return showInfo("Select a box in the mind map");
		const root = this.mapRoot(c, start);
		const kids = new Map<string, El[]>();
		const seen = new Set([root.id]);
		const walk = (n: El) => {
			const list = this.childrenOf(c, n).filter((k) => !seen.has(k.id) && SHAPES.includes(k.type));
			for (const k of list) seen.add(k.id);
			kids.set(n.id, list);
			for (const k of list) walk(k);
		};
		walk(root);
		if ((kids.get(root.id) ?? []).length === 0) return showInfo("This box has no connected boxes to tidy");
		// The way the map grows, from where its first branch sits now.
		const first = (kids.get(root.id) ?? [])[0];
		const v = { x: this.centreOf(first).x - this.centreOf(root).x, y: this.centreOf(first).y - this.centreOf(root).y };
		const wide = Math.abs(v.x) >= Math.abs(v.y);
		const gapOut = Math.max(60, this.settings.duplicateGap);
		const gapSide = 24;
		const along = (e: El) => (wide ? e.height : e.width);
		const across = (e: El) => (wide ? e.width : e.height);
		const span = new Map<string, number>();
		const size = (n: El): number => {
			const list = kids.get(n.id) ?? [];
			const inner = list.reduce((s, k) => s + size(k), 0) + gapSide * Math.max(0, list.length - 1);
			const v2 = Math.max(along(n), inner);
			span.set(n.id, v2);
			return v2;
		};
		// Where each box goes: its top-left corner.
		const goal = new Map<string, { x: number; y: number }>();
		const place = (n: El, at: { x: number; y: number }, side: number) => {
			goal.set(n.id, at);
			const list = [...(kids.get(n.id) ?? [])].sort((a, b) => (wide ? this.centreOf(a).y - this.centreOf(b).y : this.centreOf(a).x - this.centreOf(b).x));
			const total = list.reduce((s, k) => s + (span.get(k.id) ?? 0), 0) + gapSide * Math.max(0, list.length - 1);
			const mid = (wide ? at.y : at.x) + along(n) / 2;
			let pos = mid - total / 2;
			for (const k of list) {
				const sp = span.get(k.id) ?? along(k);
				const a = pos + (sp - along(k)) / 2;
				const out = side > 0 ? (wide ? at.x : at.y) + across(n) + gapOut : (wide ? at.x : at.y) - gapOut - across(k);
				place(k, wide ? { x: out, y: a } : { x: a, y: out }, side);
				pos += sp + gapSide;
			}
		};
		// Branches on both sides of the top box stay on their own side.
		const sideOf = (k: El) => Math.sign(wide ? this.centreOf(k).x - this.centreOf(root).x : this.centreOf(k).y - this.centreOf(root).y) || 1;
		goal.set(root.id, { x: root.x, y: root.y });
		for (const side of [1, -1]) {
			const branch = (kids.get(root.id) ?? []).filter((k) => sideOf(k) === side);
			if (!branch.length) continue;
			const saved = kids.get(root.id);
			kids.set(root.id, branch);
			size(root);
			place(root, { x: root.x, y: root.y }, side);
			kids.set(root.id, saved ?? []);
		}
		const moves = new Map<string, { dx: number; dy: number }>();
		for (const [id, at] of goal) {
			const n = c.all.find((e) => e.id === id);
			if (!n) continue;
			const dx = at.x - n.x;
			const dy = at.y - n.y;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
			for (const e of this.withLabel(c, n)) moves.set(e.id, { dx, dy });
			// A fold badge goes with its box.
			for (const b of c.all.filter((x) => !x.isDeleted && foldBadgeOf(x) === id)) moves.set(b.id, { dx, dy });
		}
		if (moves.size === 0) return showInfo("The map is already tidy");
		await this.applyMoves(c, moves);
		this.lastDone = "tidy";
		showInfo("Mind map tidied");
	}

	/** Hide the boxes that grow from the selected box, or show them again. */
	async toggleFold(c: Ctx) {
		const node = this.currentStop(c);
		if (!node || !SHAPES.includes(node.type)) return showInfo("Select a box in the mind map");
		const ea = c.ea;
		const data = (node as unknown as { customData?: Record<string, unknown> }).customData ?? {};
		const fold = data.ekhFold as { els: El[]; x: number; y: number } | undefined;
		if (fold) {
			// Open: put the hidden boxes back, moved as far as the box moved since.
			const dx = node.x - fold.x;
			const dy = node.y - fold.y;
			const badges = c.all.filter((x) => !x.isDeleted && foldBadgeOf(x) === node.id);
			ea.copyViewElementsToEAforEditing([node, ...badges]);
			const n = ea.getElement(node.id) as unknown as { customData?: Record<string, unknown> };
			const rest = { ...(n.customData ?? {}) };
			delete rest.ekhFold;
			n.customData = rest;
			for (const b of badges) ea.getElement(b.id).isDeleted = true;
			for (const e of fold.els) ea.elementsDict[e.id] = { ...e, x: e.x + dx, y: e.y + dy, isDeleted: false };
			await commitEA(ea, [node.id]);
			const shown = fold.els.filter((e) => SHAPES.includes(e.type)).length;
			showInfo(`Showing ${shown} hidden ${shown === 1 ? "box" : "boxes"}`);
			return;
		}
		// Fold: everything below this box, with the arrows between, and their labels.
		const boxes = new Set<string>();
		const walk = (n: El) => {
			for (const k of this.childrenOf(c, n)) {
				if (boxes.has(k.id) || k.id === node.id) continue;
				boxes.add(k.id);
				walk(k);
			}
		};
		walk(node);
		if (boxes.size === 0) return showInfo("This box has nothing to fold");
		const inside = (id: string | undefined) => !!id && (boxes.has(id) || id === node.id);
		const hide = c.all.filter(
			(e) =>
				!e.isDeleted &&
				(boxes.has(e.id) ||
					(!!e.containerId && boxes.has(e.containerId)) ||
					(e.type === "arrow" && inside(e.startBinding?.elementId) && inside(e.endBinding?.elementId)) ||
					foldBadgeOf(e) !== undefined && boxes.has(foldBadgeOf(e) ?? "")),
		);
		const saved = hide.map((e) => JSON.parse(JSON.stringify(e)) as El);
		ea.copyViewElementsToEAforEditing([node, ...hide]);
		for (const e of hide) ea.getElement(e.id).isDeleted = true;
		const n = ea.getElement(node.id) as unknown as { customData?: Record<string, unknown> };
		n.customData = { ...(n.customData ?? {}), ekhFold: { els: saved, x: node.x, y: node.y } };
		// A small "+3" beside the box says how many are hidden.
		Object.assign(ea.style, { strokeColor: "#868e96", fontSize: 16, roughness: 0 });
		const badge = ea.addText(node.x + node.width + 8, node.y + node.height / 2 - 10, `+${boxes.size}`);
		(ea.getElement(badge) as unknown as { customData?: Record<string, unknown> }).customData = { ekhFoldBadge: node.id };
		await commitEA(ea, [node.id]);
		showInfo(`Folded ${boxes.size} ${boxes.size === 1 ? "box" : "boxes"}. Same key to show ${boxes.size === 1 ? "it" : "them"}.`);
	}

	// -----------------------------------------------------------------------
	// Layouts
	// -----------------------------------------------------------------------

	/** Lay the selection out as a flowchart, timeline, kanban board or 2×2 grid. */
	async layout(c: Ctx, kind: "flow" | "timeline" | "kanban" | "matrix") {
		let units = this.readingOrder(this.units(c));
		if (units.length < 2) units = this.readingOrder(this.units(c, false));
		if (units.length < 2) return showInfo("Select 2 or more shapes first");
		const w = (u: (typeof units)[number]) => u.box.x2 - u.box.x1;
		const h = (u: (typeof units)[number]) => u.box.y2 - u.box.y1;
		const x0 = Math.min(...units.map((u) => u.box.x1));
		const y0 = Math.min(...units.map((u) => u.box.y1));
		const maxW = Math.max(...units.map(w));
		const maxH = Math.max(...units.map(h));
		const goal = new Map<(typeof units)[number], { x: number; y: number }>();
		const ea = c.ea;
		/** Things to draw once the shapes are in place, in the same undo step as the arrows. */
		let draw: (() => string[]) | null = null;
		if (kind === "flow" || kind === "timeline") {
			const gap = kind === "flow" ? Math.max(60, this.settings.duplicateGap) : 40;
			const axis = y0 + maxH / 2 + (kind === "timeline" ? maxH / 2 + 40 : 0);
			let x = x0;
			units.forEach((u, i) => {
				const up = kind === "timeline" && i % 2 === 1;
				const y = kind === "flow" ? axis - h(u) / 2 : up ? axis + 40 : axis - 40 - h(u);
				goal.set(u, { x, y });
				x += w(u) + gap;
			});
			const end = x - gap;
			if (kind === "timeline") {
				draw = () => {
					Object.assign(ea.style, { strokeColor: "#868e96", strokeWidth: 2, roughness: 0 });
					const ids = [ea.addArrow([[x0 - 30, axis], [end + 40, axis]], { endArrowHead: "arrow", startArrowHead: null })];
					units.forEach((u, i) => {
						const g = goal.get(u);
						if (!g) return;
						const cx = g.x + w(u) / 2;
						const edge = i % 2 === 1 ? g.y : g.y + h(u);
						ids.push(ea.addLine([[cx, edge], [cx, axis]]));
					});
					return ids;
				};
			}
		} else if (kind === "kanban") {
			const colW = maxW + 48;
			let y = y0 + 56;
			for (const u of units) {
				goal.set(u, { x: x0 + 24 + (maxW - w(u)) / 2, y });
				y += h(u) + 16;
			}
			const colH = Math.max(360, y - y0 + 40);
			draw = () => {
				const ids: string[] = [];
				["To do", "Doing", "Done"].forEach((name, i) => {
					const f = ea.addFrame?.(x0 + i * (colW + 24), y0, colW, colH, name);
					if (!f) return;
					ids.push(f);
					if (i === 0) ea.addElementsToFrame?.(f, units.flatMap((u) => u.els.map((e) => e.id)));
				});
				return ids;
			};
		} else {
			// Four boxes around a cross, filled in reading order.
			const cellW = maxW + 48;
			const cellH = maxH + 48;
			const cx = x0 + cellW;
			const cy = y0 + cellH;
			const counts = [0, 0, 0, 0];
			units.forEach((u, i) => {
				const q = i % 4;
				const col = q % 2;
				const row = Math.floor(q / 2);
				const k = counts[q]++;
				goal.set(u, { x: cx + (col ? 24 : -24 - w(u)), y: cy + (row ? 24 : -24 - h(u)) + (row ? 1 : -1) * k * (maxH + 16) });
			});
			const rows = Math.max(1, ...counts.map((n) => n));
			const reach = cellH + (rows - 1) * (maxH + 16);
			draw = () => {
				Object.assign(ea.style, { strokeColor: "#868e96", strokeWidth: 2, roughness: 0 });
				return [ea.addLine([[cx - cellW - 16, cy], [cx + cellW + 16, cy]]), ea.addLine([[cx, cy - reach - 16], [cx, cy + reach + 16]])];
			};
		}
		const moves = new Map<string, { dx: number; dy: number }>();
		for (const [u, g] of goal) {
			const dx = g.x - u.box.x1;
			const dy = g.y - u.box.y1;
			for (const e of u.els) moves.set(e.id, { dx, dy });
		}
		await this.applyMoves(c, moves);
		const now = this.context();
		if (!now) return;
		// Then the arrows of a flowchart, or the lines of a timeline, a board or a grid.
		ea.clear?.();
		ea.copyViewElementsToEAforEditing([]);
		const added: string[] = draw ? draw() : [];
		if (kind === "flow") {
			const mains = units.map((u) => {
				const ids = new Set(u.els.map((e) => e.id));
				return now.all.find((e) => ids.has(e.id) && e.type !== "text" && !LINEAR.includes(e.type)) ?? now.all.find((e) => ids.has(e.id));
			});
			for (let i = 0; i + 1 < mains.length; i++) {
				const a = mains[i];
				const b = mains[i + 1];
				if (!a || !b) continue;
				const tied = now.all.some((x) => x.type === "arrow" && !x.isDeleted && x.startBinding?.elementId === a.id && x.endBinding?.elementId === b.id);
				if (tied) continue;
				ea.copyViewElementsToEAforEditing([a, b]);
				added.push(this.niceArrow(c, a, b, "wide"));
			}
		}
		if (kind === "kanban") {
			ea.copyViewElementsToEAforEditing(now.all.filter((e) => units.some((u) => u.els.some((x) => x.id === e.id))));
			const frame = added[0];
			if (frame) ea.addElementsToFrame?.(frame, units.flatMap((u) => u.els.map((e) => e.id)));
		}
		if (ea.getElements().length) await commitEA(ea, units.flatMap((u) => u.els.map((e) => e.id)));
		showInfo({ flow: "Flowchart", timeline: "Timeline", kanban: "Kanban board", matrix: "2×2 grid" }[kind]);
	}

	// -----------------------------------------------------------------------
	// Copy as an image, put in a note
	// -----------------------------------------------------------------------

	/** A PNG of the selection, or of the whole drawing when nothing is selected. */
	private async pngOf(c: Ctx): Promise<Blob | null> {
		const els = c.selected.length ? withBoundText(c) : c.all.filter((e) => !e.isDeleted);
		if (els.length === 0) return null;
		const ea = c.ea;
		ea.clear?.();
		ea.copyViewElementsToEAforEditing(els, true);
		try {
			const png = await ea.createPNG?.(undefined, 2, undefined, undefined, undefined, 16);
			return png instanceof Blob ? png : null;
		} catch {
			return null;
		} finally {
			ea.clear?.();
		}
	}

	async copyImage(c: Ctx) {
		const png = await this.pngOf(c);
		if (!png) return showInfo("Nothing to copy");
		this.lastDone = "copy";
		try {
			await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
			showInfo(c.selected.length ? "Copied the selection as an image" : "Copied the drawing as an image");
		} catch {
			showInfo("This device does not let images go on the clipboard. Try: put it in a note.");
		}
	}

	imageToNote(c: Ctx) {
		const drawing = this.app.workspace.getActiveFile();
		void this.pngOf(c).then((png) => {
			if (!png) return showInfo("Nothing to put in a note");
			new NotePickerModal(this.app, false, (note) => {
				if (!note) return;
				void (async () => {
					const name = `${(drawing?.basename ?? "Drawing").replace(/\.excalidraw$/, "")} ${moment().format("YYYY-MM-DD HHmmss")}.png`;
					const path = await this.app.fileManager.getAvailablePathForAttachment(name, note.path);
					const file = await this.app.vault.createBinary(path, await png.arrayBuffer());
					const link = this.app.metadataCache.fileToLinktext(file, note.path);
					await this.app.vault.process(note, (text) => `${text.replace(/\s*$/, "")}\n\n![[${link}]]\n`);
					showInfo(`Put in ${note.basename}`);
				})();
			}, "Put the image at the end of which note?").open();
		});
	}

	// -----------------------------------------------------------------------
	// Arrows follow a mouse drag
	// -----------------------------------------------------------------------

	private dragStart: Map<string, string> | null = null;

	private boxKey(e: El): string {
		const b = this.boxOf(e);
		return `${Math.round(b.x1)},${Math.round(b.y1)},${Math.round(b.x2)},${Math.round(b.y2)}`;
	}

	private onDragStart(e: PointerEvent) {
		this.dragStart = null;
		if (!this.settings.followDrags || !(e.target as Node | null)?.instanceOf(HTMLCanvasElement)) return;
		const c = this.context();
		if (!c) return;
		this.dragStart = new Map(c.all.filter((x) => !x.isDeleted && !LINEAR.includes(x.type) && x.type !== "text").map((x) => [x.id, this.boxKey(x)]));
	}

	/** After you drag shapes with the mouse, the arrows this plugin laid are drawn again from the sides that now face each other. */
	private onDragEnd() {
		const before = this.dragStart;
		this.dragStart = null;
		if (!before) return;
		window.setTimeout(() => {
			const c = this.context();
			const api = c?.ea.getExcalidrawAPI?.();
			if (!c || !api) return;
			const byId = new Map(c.all.map((x) => [x.id, x]));
			const moved = (id: string | undefined) => {
				const el = id ? byId.get(id) : undefined;
				return !!el && before.has(el.id) && before.get(el.id) !== this.boxKey(el);
			};
			const fixed = new Map<string, El>();
			for (const ar of c.all) {
				if (ar.isDeleted || ar.type !== "arrow" || !curveOf(ar)) continue;
				const a = ar.startBinding ? byId.get(ar.startBinding.elementId) : undefined;
				const b = ar.endBinding ? byId.get(ar.endBinding.elementId) : undefined;
				if (!a || !b || !(moved(a.id) || moved(b.id))) continue;
				const copy = JSON.parse(JSON.stringify(ar)) as El;
				const type = copy.elbowed ? "elbow" : copy.roundness ? "round" : "sharp";
				if (routeArrow(copy, this.boxOf(a), this.boxOf(b), type, curveOf(ar))) fixed.set(ar.id, copy);
			}
			if (!fixed.size) return;
			const elements = api.getSceneElementsIncludingDeleted().map((x: El) => {
				const f = fixed.get(x.id);
				return f ? { ...f, version: (x.version ?? 1) + 1, versionNonce: newSeed() } : x;
			});
			// Part of the drag: one Ctrl+Z still undoes the drag and puts the arrows back.
			api.updateScene({ elements, captureUpdate: "NEVER" });
		}, 40);
	}

	// -----------------------------------------------------------------------
	// Key coach
	// -----------------------------------------------------------------------

	/** The keys for a command, as you press them: tool letters, Obsidian hotkeys, or the leader path. */
	keyLabels(id: string): string[] {
		if (id.startsWith("leader:")) {
			const menu = id.slice(7);
			const def = LEADER_MENUS.find((m) => m[0] === menu)?.[2] ?? "";
			const key = this.settings.leaderMenuKeys[menu] ?? def;
			const lead = this.settings.toolKeys.leader;
			return lead && key ? [`${comboLabel(lead)} then ${comboLabel(key)}`] : [];
		}
		const tool = this.settings.toolKeys[id];
		return [...(tool ? [comboLabel(tool)] : []), ...this.hotkeysFor(id).map(hotkeyLabel)];
	}

	/** Which of this plugin's commands does what the clicked button does. */
	private coachFor(t: Element): string | null {
		const tid = t.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
		const tools: Record<string, string> = {
			selection: "tool-select", rectangle: "tool-rectangle", diamond: "tool-diamond", ellipse: "tool-ellipse", arrow: "tool-arrow",
			line: "tool-line", freedraw: "tool-pen", text: "tool-text", eraser: "tool-eraser", frame: "tool-frame",
		};
		if (tid.startsWith("toolbar-")) return tools[tid.slice(8)] ?? null;
		if (tid.startsWith("color-top-pick-")) {
			const col = tid.slice(15).toLowerCase();
			const pick = t.closest("[data-testid]");
			// Excalidraw shows the line colours first, then the fill colours.
			const rows = Array.from(new Set(Array.from(pick?.closest(".excalidraw")?.querySelectorAll("[data-testid^='color-top-pick-']") ?? []).map((p) => p.parentElement)));
			const fill = rows.indexOf(pick?.parentElement ?? null) === 1;
			if (col === "transparent") return fill ? "no-fill" : "no-line";
			const list = (fill ? this.settings.fillColours : this.settings.strokeColours).map((x) => x.toLowerCase());
			const i = list.indexOf(col);
			return i < 0 ? `leader:${fill ? "fill" : "pen"}` : `${fill ? "fill" : "stroke"}-colour-${i + 1}`;
		}
		if (tid.startsWith("strokeWidth-")) return "cycle-line-width";
		if (tid === "opacity") return "leader:opacity";
		const input = t.closest("label")?.querySelector("input") ?? (t.instanceOf(HTMLInputElement) ? t : null);
		const byName: Record<string, string> = { strokeStyle: "cycle-line-style", sloppiness: "cycle-sketch", edges: "toggle-corners", fillStyle: "cycle-fill-style", fontFamily: "cycle-font", textAlign: "cycle-align" };
		if (input?.name && byName[input.name]) return byName[input.name];
		const title = t.closest("button")?.getAttribute("title") ?? t.closest("button")?.getAttribute("aria-label") ?? "";
		if (title === "Duplicate") return "duplicate-right";
		if (title === "Delete") return "delete";
		return null;
	}

	/** You clicked a button that has a key: show the key, a few times for each command. */
	private coach(e: MouseEvent) {
		const t = e.target as Node | null;
		// Often the click lands on the icon inside a button, which is not an HTML element.
		if (!this.settings.keyCoach || !t?.instanceOf(Element)) return;
		if ("pointerType" in e && e.pointerType === "touch") return;
		if (!t.closest(".excalidraw") || t.closest(".ekh-preset-bar")) return;
		const id = this.coachFor(t);
		if (!id) return;
		const keys = this.keyLabels(id);
		const seen = this.settings.coachSeen[id] ?? 0;
		if (!keys.length || seen >= 3) return;
		this.settings.coachSeen[id] = seen + 1;
		void this.saveSettings();
		const name = id.startsWith("leader:") ? (LEADER_MENUS.find((m) => m[0] === id.slice(7))?.[1] ?? "") : (this.actions.find((a) => a.id === id)?.name ?? "");
		window.setTimeout(() => {
			const f = createFragment((d) => {
				d.createSpan({ text: "Key for this: " });
				d.createEl("kbd", { text: keys[0] });
				if (name) d.createDiv({ cls: "ekh-coach-name", text: name });
			});
			new Notice(f, 2500);
		}, 30);
	}

	// -----------------------------------------------------------------------
	// Practice
	// -----------------------------------------------------------------------

	private practiceEl: HTMLElement | null = null;

	/** A short lesson in a new drawing: six steps, each checked as you do it. */
	async practice() {
		const ea = window.ExcalidrawAutomate?.getAPI(undefined);
		if (!ea?.create) return new Notice("Excalidraw is needed for this");
		ea.reset?.();
		Object.assign(ea.style, { strokeColor: "#1e1e1e", backgroundColor: "transparent", roughness: 1, strokeWidth: 2, fontSize: 20 });
		ea.addText(0, 0, "Start here", { box: "rectangle", width: 180, height: 70, textAlign: "center", textVerticalAlign: "middle" });
		ea.addText(260, 160, "Second box", { box: "rectangle", width: 180, height: 70, textAlign: "center", textVerticalAlign: "middle" });
		// A new tab, so the drawing you were in stays where it was.
		const made = await ea.create({ filename: `Excalidraw Hotkeys practice ${moment().format("YYYY-MM-DD HHmm")}`, silent: true });
		const file = this.app.vault.getFileByPath(made);
		if (!file) return;
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file, { active: true });
		await sleepMs(2500);
		const api = this.context()?.ea.getExcalidrawAPI?.();
		api?.updateScene({ appState: { zoom: { value: Platform.isPhone ? 0.8 : 1 } }, captureUpdate: "NEVER" });
		api?.scrollToContent?.();
		const st = this.settings;
		const shapes = (c: Ctx) => c.all.filter((e) => !e.isDeleted && SHAPES.includes(e.type));
		const touchSteps: { text: string; keys: string[]; done: (c: Ctx) => boolean }[] = [
			{
				text: "Tap the box that says Start here. Tap the ⚡ button at the top, then Search. Type red and pick it.",
				keys: [],
				done: (c) => shapes(c).some((e) => e.strokeColor !== "#1e1e1e"),
			},
			{
				text: "With a box selected, tap ⚡, then Connect and mind map, then New connected box.",
				keys: [],
				done: (c) => shapes(c).length >= 3,
			},
			{
				text: "Tap ⚡, then Connect and mind map, then Tidy the mind map.",
				keys: [],
				done: () => this.lastDone === "tidy",
			},
			{
				text: "Select two boxes: drag a box around them on an empty spot. Tap ⚡, then Line up and spread, then Left edges.",
				keys: [],
				done: () => this.lastDone === "arrange",
			},
			{
				text: "Tap ⚡, then Copy, paste and export, then Copy as an image. You can paste it in any app.",
				keys: [],
				done: () => this.lastDone === "copy",
			},
		];
		const keySteps: { text: string; keys: string[]; done: (c: Ctx) => boolean }[] = [
			{
				text: `Click the box that says Start here. Press this key to make its line ${hueName(st.strokeColours[1]).toLowerCase()}.`,
				keys: this.keyLabels("stroke-colour-2"),
				done: (c) => c.all.some((e) => !e.isDeleted && SHAPES.includes(e.type) && e.strokeColor === st.strokeColours[1]),
			},
			{
				text: "Hold Alt for a moment, without pressing another key. A panel shows what every Alt key does.",
				keys: ["Alt"],
				done: () => this.sawWhichKey,
			},
			{
				text: "With a box selected, press this key. A connected box appears. Type a word, then press Escape.",
				keys: this.keyLabels("mind-child"),
				done: (c) => c.all.filter((e) => !e.isDeleted && SHAPES.includes(e.type)).length >= 3,
			},
			{
				text: "Select two boxes (hold Shift and click). Press the leader key, then L, then A. Their left edges line up.",
				keys: this.keyLabels("leader:arrange").map((k) => `${k} then A`),
				done: (c) => {
					const xs = c.all.filter((e) => !e.isDeleted && SHAPES.includes(e.type)).map((e) => Math.round(e.x));
					return new Set(xs).size < xs.length;
				},
			},
			{
				text: "Select a box. Press this key and type: blue fill. Press Enter.",
				keys: this.keyLabels("search"),
				done: (c) => c.all.some((e) => !e.isDeleted && SHAPES.includes(e.type) && e.backgroundColor && e.backgroundColor !== "transparent"),
			},
			{
				text: "Select another box. Press this key to do your last change again.",
				keys: this.keyLabels("repeat"),
				done: (c) => {
					const fills = c.all.filter((e) => !e.isDeleted && SHAPES.includes(e.type) && e.backgroundColor && e.backgroundColor !== "transparent").map((e) => e.backgroundColor);
					return fills.length >= 2 && new Set(fills).size < fills.length;
				},
			},
		];
		const steps = this.compactBar() ? touchSteps : keySteps;
		this.sawWhichKey = false;
		this.lastDone = "";
		let i = 0;
		const view = leaf.view instanceof ItemView ? leaf.view : null;
		const show = () => {
			this.practiceEl?.remove();
			const host = view?.contentEl.querySelector<HTMLElement>(".excalidraw");
			if (!host) return;
			const card = host.createDiv({ cls: "Island ekh-practice" });
			card.addEventListener("pointerdown", (e) => e.preventDefault());
			this.practiceEl = card;
			if (i >= steps.length) {
				card.createDiv({ cls: "ekh-practice-step", text: "All done" });
				card.createDiv({ cls: "ekh-practice-text", text: steps === keySteps ? "You know the main keys now. The guide shows the rest." : "Everything is under ⚡. The guide shows the rest." });
				const row = card.createDiv({ cls: "ekh-practice-buttons" });
				row.createEl("button", { text: "Open the guide", cls: "mod-cta" }).addEventListener("click", () => {
					stop();
					new GuideModal(this.app, this).open();
				});
				row.createEl("button", { text: "Close" }).addEventListener("click", stop);
				return;
			}
			const s = steps[i];
			card.createDiv({ cls: "ekh-practice-step", text: `Step ${i + 1} of ${steps.length}` });
			card.createDiv({ cls: "ekh-practice-text", text: s.text });
			const k = card.createDiv({ cls: "ekh-practice-keys" });
			if (s.keys.length) k.createEl("kbd", { text: s.keys[0] });
			else if (steps === keySteps) k.createSpan({ cls: "ekh-none", text: "No key yet. Set one in Settings, Hotkeys." });
			else k.remove();
			const row = card.createDiv({ cls: "ekh-practice-buttons" });
			row.createEl("button", { text: "Skip" }).addEventListener("click", () => {
				i++;
				show();
			});
			row.createEl("button", { text: "Stop" }).addEventListener("click", stop);
		};
		const timer = window.setInterval(() => {
			// The practice drawing was closed, or another file opened in its tab: stop.
			if (!(leaf.view instanceof FileView) || leaf.view.file !== file) return stop();
			if (this.app.workspace.getActiveFile() !== file) return;
			const c = this.context();
			if (!c || i >= steps.length) return;
			if (steps[i].done(c)) {
				i++;
				show();
			}
		}, 300);
		const stop = () => {
			window.clearInterval(timer);
			this.practiceEl?.remove();
			this.practiceEl = null;
		};
		this.register(stop);
		show();
	}

	// -----------------------------------------------------------------------
	// Frames
	// -----------------------------------------------------------------------

	private frames(c: Ctx): El[] {
		const fr = c.all.filter((e) => e.type === "frame" && !e.isDeleted).map((e) => ({ e, box: this.boxOf(e) }));
		return this.readingOrder(fr).map((f) => f.e);
	}

	async wrapInFrame(c: Ctx) {
		const units = this.units(c).filter((u) => !u.els.some((e) => e.type === "frame"));
		if (units.length === 0) return showInfo("Select something first");
		const members = units.flatMap((u) => u.els);
		const ids = new Set(members.map((e) => e.id));
		// An arrow between two of them goes in too.
		for (const e of c.all) {
			if (!e.isDeleted && e.startBinding && e.endBinding && ids.has(e.startBinding.elementId) && ids.has(e.endBinding.elementId)) {
				members.push(e);
				ids.add(e.id);
			}
		}
		const pad = 30;
		const b = members.map((e) => this.boxOf(e));
		const x1 = Math.min(...b.map((v) => v.x1)) - pad;
		const y1 = Math.min(...b.map((v) => v.y1)) - pad;
		const x2 = Math.max(...b.map((v) => v.x2)) + pad;
		const y2 = Math.max(...b.map((v) => v.y2)) + pad;
		const ea = c.ea;
		if (!ea.addFrame || !ea.addElementsToFrame) return showInfo("Update Excalidraw to use frames");
		ea.copyViewElementsToEAforEditing(members);
		const name = `Frame ${this.frames(c).length + 1}`;
		const id = ea.addFrame(x1, y1, x2 - x1, y2 - y1, name);
		ea.addElementsToFrame(id, [...ids]);
		await commitEA(ea, [id]);
		showInfo(`Made ${name}`);
	}

	goFrame(c: Ctx, dir: 1 | -1) {
		const frames = this.frames(c);
		if (frames.length === 0) return showInfo("No frames yet. Select shapes and wrap them in a frame.");
		const cur = c.selected[0];
		const curId = cur ? (cur.type === "frame" ? cur.id : cur.frameId) : null;
		const i = frames.findIndex((f) => f.id === curId);
		const next = frames[i < 0 ? (dir > 0 ? 0 : frames.length - 1) : (((i + dir) % frames.length) + frames.length) % frames.length];
		selectIds(c, [next.id]);
		c.ea.viewZoomToElements?.(true, [next]);
		showInfo(`${next.name || "Frame"} (${frames.indexOf(next) + 1} of ${frames.length})`);
	}

	// -----------------------------------------------------------------------
	// Stamps: save shapes, place them again with a key
	// -----------------------------------------------------------------------

	async saveStamp(c: Ctx) {
		const units = this.units(c);
		if (units.length === 0) return showInfo("Select the shapes to save first");
		const members = units.flatMap((u) => u.els);
		const ids = new Set(members.map((e) => e.id));
		for (const e of c.all) {
			if (!e.isDeleted && !ids.has(e.id) && e.startBinding && e.endBinding && ids.has(e.startBinding.elementId) && ids.has(e.endBinding.elementId)) {
				members.push(e);
				ids.add(e.id);
			}
		}
		const b = members.map((e) => this.boxOf(e));
		const x0 = Math.min(...b.map((v) => v.x1));
		const y0 = Math.min(...b.map((v) => v.y1));
		const els = members.map((e) => {
			const copy = JSON.parse(JSON.stringify(e)) as El;
			copy.x -= x0;
			copy.y -= y0;
			copy.frameId = null;
			copy.locked = false;
			return copy;
		});
		const text = els.find((e) => e.type === "text")?.text?.trim().split("\n")[0];
		const name = text ? text.slice(0, 30) : `Stamp ${this.settings.stamps.length + 1}`;
		this.settings.stamps.push({ name, els });
		await this.saveSettings();
		showInfo(`Saved stamp ${this.settings.stamps.length}: ${name}`);
	}

	/** Place a stamp at the mouse, or in the middle of the view when the mouse is away. */
	dropStamp(c: Ctx, i: number) {
		const stamp = this.settings.stamps[i];
		if (!stamp) return showInfo(`Stamp ${i + 1} is empty. Select shapes and save a stamp first.`);
		const api = c.ea.getExcalidrawAPI?.();
		if (!api) return;
		const st = api.getAppState();
		const z = st.zoom.value;
		const view = { x1: -st.scrollX, y1: -st.scrollY, x2: st.width / z - st.scrollX, y2: st.height / z - st.scrollY };
		const p = c.ea.getViewLastPointerPosition?.();
		const at = p && p.x > view.x1 && p.x < view.x2 && p.y > view.y1 && p.y < view.y2 ? p : { x: (view.x1 + view.x2) / 2, y: (view.y1 + view.y2) / 2 };
		const w = Math.max(...stamp.els.map((e) => this.boxOf(e).x2));
		const h = Math.max(...stamp.els.map((e) => this.boxOf(e).y2));
		const ox = at.x - w / 2;
		const oy = at.y - h / 2;
		const idMap = new Map(stamp.els.map((e) => [e.id, newId()]));
		const groupMap = new Map<string, string>();
		const gid = (g: string): string => {
			const have = groupMap.get(g);
			if (have) return have;
			const made = newId();
			groupMap.set(g, made);
			return made;
		};
		const bind = (b: { elementId: string } | null | undefined) => (b && idMap.has(b.elementId) ? { ...b, elementId: idMap.get(b.elementId) as string } : null);
		const fresh = stamp.els.map((src) => {
			const e = JSON.parse(JSON.stringify(src)) as El;
			e.id = idMap.get(src.id) as string;
			e.x += ox;
			e.y += oy;
			e.seed = newSeed();
			e.version = 1;
			e.versionNonce = newSeed();
			e.index = null;
			e.isDeleted = false;
			e.groupIds = (e.groupIds ?? []).map(gid);
			if (e.containerId) e.containerId = idMap.get(e.containerId) ?? null;
			e.boundElements = (e.boundElements ?? []).filter((r) => idMap.has(r.id)).map((r) => ({ ...r, id: idMap.get(r.id) as string }));
			if (e.startBinding !== undefined) e.startBinding = bind(e.startBinding);
			if (e.endBinding !== undefined) e.endBinding = bind(e.endBinding);
			return e;
		});
		const select = fresh.filter((e) => !(e.type === "text" && e.containerId)).map((e) => e.id);
		api.updateScene({
			elements: [...api.getSceneElementsIncludingDeleted(), ...fresh],
			appState: { selectedElementIds: Object.fromEntries(select.map((id) => [id, true])) },
			captureUpdate: "IMMEDIATELY",
		});
		showInfo(`Stamp: ${stamp.name}`);
	}

	pickStamp() {
		if (this.settings.stamps.length === 0) return showInfo("No stamps yet. Select shapes and save a stamp first.");
		new ListPickerModal(this.app, "Find a stamp", this.settings.stamps.map((s, i) => ({ label: s.name, hint: i < 9 ? `Leader J ${i + 1}` : "", value: i })), (i) => {
			window.setTimeout(() => {
				const c = this.context();
				if (c) this.dropStamp(c, i);
			}, 50);
		}).open();
	}

	// -----------------------------------------------------------------------
	// Recent colours
	// -----------------------------------------------------------------------

	private noteColours(s: Style) {
		let changed = false;
		for (const col of [s.stroke, s.fill]) {
			if (!col || col === "transparent") continue;
			const list = this.settings.recentColours;
			if (list[0]?.toLowerCase() === col.toLowerCase()) continue;
			this.settings.recentColours = [col, ...list.filter((x) => x.toLowerCase() !== col.toLowerCase())].slice(0, 6);
			changed = true;
		}
		if (changed) {
			void this.saveSettings();
			this.updateBar();
		}
	}

	// -----------------------------------------------------------------------
	// Macros: record keys once, play them back with one key
	// -----------------------------------------------------------------------

	private recording: MacroStep[] | null = null;
	private playing = false;

	private record(step: MacroStep) {
		if (this.recording && !this.playing) this.recording.push(step);
	}

	stepLabel(step: MacroStep): string {
		if (step.t === "style") return step.label;
		if (step.t === "action") return shortName(this.actions.find((a) => a.id === step.id)?.name ?? step.id);
		let node: LeaderNode | undefined = this.leaderTree();
		const names: string[] = [];
		for (const k of step.keys) {
			node = [...(node?.children ?? new Map<string, LeaderNode>())].find(([key]) => key.toUpperCase() === k.toUpperCase())?.[1];
			if (!node) break;
			names.push(node.label);
		}
		return names.join(" › ") || step.keys.join(" ");
	}

	async toggleRecord() {
		if (!this.recording) {
			this.recording = [];
			this.statusKey = "";
			this.updateStatus();
			return showInfo("Recording a macro. Do the steps, then stop.");
		}
		const steps = this.recording;
		this.recording = null;
		this.statusKey = "";
		this.updateStatus();
		if (steps.length === 0) return showInfo("Nothing recorded");
		const i = this.settings.macros.findIndex((m) => !m);
		if (i < 0) return showInfo("All 9 macros are full. Delete one in Settings.");
		const name = steps.slice(0, 3).map((s) => this.stepLabel(s)).join(", ") + (steps.length > 3 ? ` and ${steps.length - 3} more` : "");
		this.settings.macros[i] = { name, steps };
		await this.saveSettings();
		showInfo(`Saved macro ${i + 1}: ${name}`);
	}

	async playMacro(i: number) {
		const m = this.settings.macros[i];
		if (!m) return showInfo(`Macro ${i + 1} is empty. Record one first.`);
		if (this.playing) return;
		this.playing = true;
		try {
			for (const step of m.steps) {
				const c = this.context();
				if (!c) break;
				if (step.t === "style") await this.tracked(c, () => this.applyStyle(c, step.style, step.label));
				else if (step.t === "action") {
					const a = this.actions.find((x) => x.id === step.id);
					if (a && (!c.typing || a.whileTyping) && a.canRun(c)) await this.runAction(a, c);
				} else {
					let node: LeaderNode | undefined = this.leaderTree();
					for (const k of step.keys) node = [...(node?.children ?? new Map<string, LeaderNode>())].find(([key]) => key.toUpperCase() === k.toUpperCase())?.[1];
					const run = node?.run;
					if (run) await this.tracked(c, () => run(c));
				}
				await sleepMs(60);
			}
		} finally {
			this.playing = false;
		}
	}

	// -----------------------------------------------------------------------
	// Share: presets, colours, stamps and macros in one file
	// -----------------------------------------------------------------------

	static SHARE_PATH = "Excalidraw Hotkeys presets.json";

	async exportShare() {
		const st = this.settings;
		const data = { app: "excalidraw-hotkeys", version: 1, presets: st.presets, strokeColours: st.strokeColours, fillColours: st.fillColours, stamps: st.stamps, macros: st.macros, barCommands: st.barCommands };
		const path = normalizePath(ExcalidrawHotkeys.SHARE_PATH);
		const text = JSON.stringify(data, null, 2);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.app.vault.modify(file, text);
		else await this.app.vault.create(path, text);
		new Notice(`Saved to ${path}. Copy it to another vault and press Import there.`);
	}

	importShare() {
		const files = this.app.vault.getFiles().filter((f) => f.extension === "json");
		if (files.length === 0) return new Notice(`No .json file in this vault. Put ${ExcalidrawHotkeys.SHARE_PATH} in it first.`);
		new ListPickerModal(this.app, "Find the presets file", files.map((f) => ({ label: f.path, hint: "", value: f })), (f) => void this.importFrom(f)).open();
	}

	private async importFrom(file: TFile) {
		let d: Partial<HotkeySettings> & { app?: string };
		try {
			d = JSON.parse(await this.app.vault.read(file)) as Partial<HotkeySettings> & { app?: string };
		} catch {
			new Notice("This file is not a presets file");
			return;
		}
		if (d.app !== "excalidraw-hotkeys") {
			new Notice("This file is not a presets file");
			return;
		}
		const st = this.settings;
		const isColours = (v: unknown): v is string[] => Array.isArray(v) && v.length === 8 && v.every((x) => typeof x === "string");
		if (Array.isArray(d.presets)) st.presets = Array.from({ length: 9 }, (_, i) => d.presets?.[i] ?? null);
		if (isColours(d.strokeColours)) st.strokeColours = [...d.strokeColours];
		if (isColours(d.fillColours)) st.fillColours = [...d.fillColours];
		const names = new Set(st.stamps.map((s) => s.name));
		const newStamps = (d.stamps ?? []).filter((s) => s && Array.isArray(s.els) && !names.has(s.name));
		st.stamps.push(...newStamps);
		let macros = 0;
		for (const m of d.macros ?? []) {
			const i = st.macros.findIndex((x) => !x);
			if (!m || i < 0 || st.macros.some((x) => x?.name === m.name)) continue;
			st.macros[i] = m;
			macros++;
		}
		for (const id of d.barCommands ?? []) if (!st.barCommands.includes(id)) st.barCommands.push(id);
		await this.saveSettings();
		this.barKey = "";
		this.updateBar();
		new Notice(`Imported presets and colours, ${newStamps.length} stamps and ${macros} macros`);
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
		if (this.compactBar()) {
			const drawing = view?.getViewType() === "excalidraw" ? view.contentEl.querySelector<HTMLElement>(".excalidraw") : null;
			if (drawing && this.mountMenuButton(drawing)) return;
			if (!drawing) {
				this.barEl?.remove();
				this.barEl = null;
				this.barKey = "";
				return;
			}
		}
		const on = this.settings.presetBar && view?.getViewType() === "excalidraw";
		// One more island in Excalidraw's own bottom row, so it looks and sits like the zoom and undo buttons.
		// Without that row, it floats at the bottom of the drawing.
		const root = on ? (view?.contentEl.querySelector<HTMLElement>(".excalidraw") ?? null) : null;
		const row = root?.querySelector<HTMLElement>(".App-bottom-bar") ?? root?.querySelector<HTMLElement>(".layer-ui__wrapper__footer-left .Stack_horizontal") ?? null;
		const host = row ?? root;
		const st = this.settings;
		const key = host ? `${st.presets.map((p) => (p ? `${p.name}|${p.style.stroke}|${p.style.fill}` : "")).join(";")}#${st.recentColours.join(",")}#${st.barCommands.join(",")}` : "";
		if (host && this.barEl?.parentElement === host && key === this.barKey) return;
		this.barEl?.remove();
		this.barEl = null;
		this.barKey = key;
		if (!host) return;
		const bar = host.createDiv({ cls: `Island ekh-preset-bar ${row ? "is-docked" : "is-floating"}` });
		// Keep the drawing's focus and selection when the bar is tapped.
		bar.addEventListener("pointerdown", (e) => e.preventDefault());
		// The island stays still; this strip inside it scrolls when there is more than fits.
		const strip = bar.createDiv({ cls: "ekh-bar-scroll" });
		bar.addEventListener("mousedown", (e) => e.preventDefault());
		this.settings.presets.forEach((p, i) => {
			if (!p) return;
			const b = strip.createEl("button", { cls: "ekh-preset", attr: { "aria-label": `Preset ${i + 1}: ${p.name}\nClick: use. Right-click: save over it.`, "data-tooltip-position": "top" } });
			const sw = b.createSpan({ cls: "ekh-swatch" });
			const stroke = p.style.stroke;
			if (stroke === undefined || stroke === "transparent") sw.addClass("is-none");
			else sw.setCssProps({ "--ekh-swatch": stroke });
			if (p.style.fill && p.style.fill !== "transparent") sw.setCssProps({ "--ekh-swatch-fill": p.style.fill });
			b.addEventListener("click", () => {
				this.record({ t: "action", id: `preset-${i + 1}` });
				this.fromBar((c) => this.usePreset(c, i));
			});
			b.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				this.fromBar((c) => this.savePreset(c, i));
			});
		});
		const add = strip.createEl("button", { cls: "ekh-preset ekh-preset-add", attr: { "aria-label": "Save the pen, or the selected shape's style, as a new preset", "data-tooltip-position": "top" } });
		setIcon(add, "plus");
		add.addEventListener("click", () =>
			this.fromBar((c) => {
				const i = this.settings.presets.findIndex((p) => !p);
				if (i < 0) return showInfo("All 9 presets are full. Right-click one to save over it.");
				return this.savePreset(c, i);
			}),
		);
		// The last colours you used. Click: pen colour. Right-click: fill.
		if (st.recentColours.length) {
			strip.createDiv({ cls: "ekh-bar-sep" });
			for (const col of st.recentColours.slice(0, 5)) {
				const b = strip.createEl("button", { cls: "ekh-preset ekh-recent", attr: { "aria-label": `${hueName(col)} ${col}\nClick: pen colour. Right-click: fill.`, "data-tooltip-position": "top" } });
				b.createSpan({ cls: "ekh-swatch" }).setCssProps({ "--ekh-swatch": col, "--ekh-swatch-fill": col });
				const use = (s: Style, label: string) => {
					this.record({ t: "style", style: s, label });
					this.fromBar((c) => this.applyStyle(c, s, label));
				};
				b.addEventListener("click", () => use({ stroke: col }, `${hueName(col)} pen`));
				b.addEventListener("contextmenu", (e) => {
					e.preventDefault();
					use({ fill: col }, `${hueName(col)} fill`);
				});
			}
		}
		// Your own buttons: any command.
		const cmds = (this.app as AppInternals).commands;
		const own = st.barCommands.filter((id) => cmds?.commands?.[id]);
		if (own.length) {
			strip.createDiv({ cls: "ekh-bar-sep" });
			for (const id of own) {
				const name = this.commandName(id).replace(/^Excalidraw Hotkeys: /, "");
				const b = strip.createEl("button", { cls: "ekh-preset ekh-bar-cmd", text: shortName(name), attr: { "aria-label": name, "data-tooltip-position": "top" } });
				// This plugin's commands record themselves in a macro when they run.
				b.addEventListener("click", () => cmds?.executeCommandById(id));
			}
		}
		strip.addEventListener("scroll", () => this.fitBar());
		// A mouse wheel scrolls the bar sideways when it has more than fits.
		strip.addEventListener("wheel", (e) => {
			if (strip.scrollWidth <= strip.clientWidth) return;
			e.preventDefault();
			strip.scrollLeft += e.deltaY + e.deltaX;
		}, { passive: false });
		this.barEl = bar;
		this.fitBar();
	}

	/**
	 * Keep the bar clear of Obsidian's status bar and the drawing's right edge.
	 * When it has more than fits, it scrolls sideways and fades at the edge.
	 */
fitBar() {
		const bar = this.barEl;
		if (!bar?.isConnected) return;
		const view = bar.closest(".excalidraw")?.getBoundingClientRect();
		const strip = bar.querySelector<HTMLElement>(".ekh-bar-scroll");
		if (!view || !strip) return;
		// Where the bar starts in Excalidraw's row: just after the last island before it.
		const prev = bar.previousElementSibling?.getBoundingClientRect();
		const row = bar.parentElement?.getBoundingClientRect();
		const left = bar.hasClass("is-docked") && prev ? prev.right + 4 : bar.getBoundingClientRect().left;
		const top = row && bar.hasClass("is-docked") ? row.bottom - 40 : bar.getBoundingClientRect().top;
		let right = view.right - 8;
		const sr = bar.doc.body.querySelector<HTMLElement>(".status-bar")?.getBoundingClientRect();
		// Obsidian's status bar floats over the bottom right of the drawing: stop before it.
		if (sr && sr.width > 0 && sr.top < top + 40 && sr.bottom > top) right = Math.min(right, sr.left - 8);
		const need = strip.scrollWidth + 8;
		const room = right - left;
		// No room beside the row: sit just above it instead, in the same style.
		const lift = bar.hasClass("is-docked") && room < Math.min(need, 160);
		bar.toggleClass("is-lifted", lift);
		const max = lift && row ? view.right - row.left - 8 : room;
		const want = `${Math.max(80, Math.floor(max))}px`;
		if (bar.style.getPropertyValue("--ekh-bar-max") !== want) bar.setCssProps({ "--ekh-bar-max": want });
		bar.toggleClass("is-clipped", strip.scrollWidth > strip.clientWidth + 1 && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
	}

	// -----------------------------------------------------------------------
	// One button for touch
	// -----------------------------------------------------------------------

	/** One button instead of the bar: on phones and tablets, unless Settings say otherwise. */
	compactBar(): boolean {
		const t = this.settings.touchBar;
		return t === "button" || (t === "auto" && Platform.isMobile);
	}

	/**
	 * Put one button in Excalidraw's own top row, beside the Obsidian tools,
	 * so it takes no room from the drawing. Tap it for every action.
	 */
	private mountMenuButton(root: HTMLElement): boolean {
		// Phone: the top row. Computer and tablet: the column of Obsidian tools on the right.
		const row = root.querySelector<HTMLElement>(".excalidraw-ui-top-right:not(.library-and-pen), .tray-misc-tools-container");
		if (!row) return false;
		if (this.barEl?.parentElement === row) return true;
		this.barEl?.remove();
		const like = row.querySelector<HTMLElement>("label.ToolIcon");
		const btn = row.createEl("label", { cls: `${like?.className ?? "ToolIcon ToolIcon_size_medium"} ekh-menu-button` });
		const icon = btn.createDiv({ cls: "ToolIcon__icon", attr: { "aria-label": "Excalidraw Hotkeys: all actions", role: "button" } });
		setIcon(icon, "zap");
		btn.addEventListener("pointerdown", (e) => e.preventDefault());
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			this.openActionMenu(e, this.leaderTree(), true);
		});
		this.barEl = btn;
		this.barKey = "button";
		return true;
	}

	/** The leader menu as a tap menu: every action, with the same names. Folders open the next menu. */
	openActionMenu(e: MouseEvent, node: LeaderNode, top = false) {
		const m = new Menu();
		const st = this.settings;
		if (top) {
			// The things you reach for most come first.
			m.addItem((i) => i.setTitle("Search styles and commands").setIcon("search").onClick(() => this.openSearch()));
			const saved = st.presets.map((p, n) => ({ p, n })).filter((x): x is { p: Preset; n: number } => !!x.p);
			if (saved.length) {
				m.addSeparator();
				for (const { p, n } of saved) {
					const title = createFragment((d) => {
						const sw = d.createSpan({ cls: "ekh-swatch ekh-menu-swatch" });
						if (p.style.stroke && p.style.stroke !== "transparent") sw.setCssProps({ "--ekh-swatch": p.style.stroke });
						if (p.style.fill && p.style.fill !== "transparent") sw.setCssProps({ "--ekh-swatch-fill": p.style.fill });
						d.appendText(p.name);
					});
					m.addItem((i) => i.setTitle(title).onClick(() => this.fromBar((c) => this.usePreset(c, n))));
				}
			}
			m.addSeparator();
		}
		const icons: Record<string, string> = {
			"Pen colour": "pen-line", "Fill colour": "paint-bucket", "Line width": "minus", "Line style": "more-horizontal", "Fill style": "grid-3x3",
			Font: "type", "Font size": "a-large-small", "Text align": "align-left", Arrowheads: "move-right", Opacity: "droplet", "Pen presets": "palette",
			Zoom: "zoom-in", "Line up and spread": "align-start-vertical", "Sketchy and corners": "pencil", "Arrow shape": "spline", "Change shape": "shapes",
			"Connect and mind map": "git-fork", "Copy, paste and export": "clipboard", "Select similar": "mouse-pointer-click", "Turn, flip and lock": "rotate-cw",
			"Link to a note": "link", Frames: "frame", Stamps: "stamp", "Recent colours": "history", Macros: "repeat", "Search styles and commands": "search",
		};
		const order = top ? ["Connect and mind map", "Line up and spread", "Recent colours", "Copy, paste and export", "Pen presets"] : [];
		// Excalidraw's own bar already has colours, line, font, text and zoom: those stay out of this menu.
		const theirs = ["Pen colour", "Fill colour", "Line width", "Line style", "Fill style", "Font", "Font size", "Text align", "Arrowheads", "Opacity", "Zoom", "Sketchy and corners", "Arrow shape"];
		const entries = [...(node.children ?? new Map<string, LeaderNode>()).values()].filter(
			(n) => !(top && (n.label.startsWith("Search") || theirs.includes(n.label))) && !n.label.startsWith("Guide"),
		);
		entries.sort((a, b) => {
			const x = order.indexOf(a.label);
			const y = order.indexOf(b.label);
			return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
		});
		for (const n of entries) {
			m.addItem((i) => {
				i.setTitle(n.children ? `${n.label} …` : n.label);
				if (icons[n.label]) i.setIcon(icons[n.label]);
				i.onClick(() => {
					if (n.children) window.setTimeout(() => this.openActionMenu(e, n), 50);
					else if (n.run) {
						const run = n.run;
						this.fromBar((c) => run(c));
					}
				});
			});
		}
		if (top) {
			m.addSeparator();
			m.addItem((i) => i.setTitle("Practice").setIcon("graduation-cap").onClick(() => void this.practice()));
			m.addItem((i) => i.setTitle("Guide").setIcon("book-open").onClick(() => new GuideModal(this.app, this).open()));
		}
		m.showAtMouseEvent(e);
	}

	private fromBar(fn: (c: Ctx) => unknown) {
		void this.settle().then(async () => {
			const c = this.context();
			if (!c) return;
			await this.tracked(c, () => fn(c));
			this.updateBar();
		});
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
		// A glide is running: finish it, and skip this one step so nothing reads a half-way place.
		if (this.gliding) {
			void this.settle();
			return true;
		}
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
				this.editSmooth(c, withText(c), (el) => {
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

						this.niceArrow(c, el, copy, dx !== 0 ? "wide" : "tall");
					}
					await commitEA(ea, newIds);
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
					this.editSmooth(c, resizable(c), (el) => {
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
					this.editSmooth(c, resizable(c), (el) => {
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
					await this.editSmooth(c, rest, (el) => {
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
		// These say what to select when the selection does not fit, so they always run.
		const add = (id: string, name: string, group: string, run: (c: Ctx) => unknown, keys?: Hotkey[], extra: Partial<Action> = {}) =>
			list.push({ id, name, group, keys, canRun: always, run: async (c) => void (await run(c)), ...extra });
		add("same-width", "Same width", "Arrange", (c) => this.sameSize(c, "width"));
		add("same-height", "Same height", "Arrange", (c) => this.sameSize(c, "height"));
		add("same-size", "Same width and height", "Arrange", (c) => this.sameSize(c, "both"));
		add("tidy-grid", "Tidy into a grid", "Arrange", (c) => this.tidyGrid(c));
		add("swap", "Swap two shapes", "Arrange", (c) => this.swap(c));

		// Shapes -----------------------------------------------------------------------
		const sketchable = (c: Ctx) => c.selected.filter((el) => el.type !== "text" && el.type !== "image");
		const cornered = (c: Ctx) => c.selected.filter((el) => el.type === "rectangle" || el.type === "diamond");
		pens["cycle-sketch"] = (c, dir) => {
			const v = penCycle(c, "currentItemRoughness", SKETCH.map((k) => k[1]), dir, 1);
			penSet(c, { currentItemRoughness: v }, SKETCH.find((k) => k[1] === v)?.[0] ?? String(v));
		};
		cycle("cycle-sketch", "Cycle sketchiness (clean, sketchy, very sketchy)", "Shapes", "S", (c) => sketchable(c).length > 0, (c, dir) => {
			const els = sketchable(c);
			const order = SKETCH.map((k) => k[1]);
			const next = order[wrap(Math.max(0, order.indexOf(els[0].roughness ?? 1)) + dir, order.length)];
			showInfo(SKETCH.find((k) => k[1] === next)?.[0] ?? "");
			return edit(c, els, (el) => (el.roughness = next));
		});
		list.push({
			id: "toggle-corners",
			name: "Round or sharp corners",
			group: "Shapes",
			keys: [hk(["Mod", "Alt"], "R")],
			canRun: (c) => c.selected.length === 0 || cornered(c).length > 0,
			run: (c) => {
				if (c.selected.length === 0) {
					const round = penGet(c, "currentItemRoundness") !== "sharp";
					return penSet(c, { currentItemRoundness: round ? "sharp" : "round" }, round ? "sharp corners" : "round corners");
				}
				const els = cornered(c);
				const round = !els[0].roundness;
				showInfo(round ? "Round corners" : "Sharp corners");
				return edit(c, els, (el) => (el.roundness = round ? { type: el.type === "rectangle" ? 3 : 2 } : null));
			},
		});
		add("cycle-shape", "Change shape (box, circle, diamond)", "Shapes", (c) => this.setShape(c, null));
		for (const [type, name] of [["rectangle", "box"], ["ellipse", "circle"], ["diamond", "diamond"]]) {
			add(`shape-${name}`, `Change shape to ${name}`, "Shapes", (c) => this.setShape(c, type), undefined, { oneByOne: true });
		}
		pens["cycle-arrow-type"] = (c, dir) => {
			const v = penCycle(c, "currentItemArrowType", ARROW_TYPES.map((t) => t[1]), dir, "round");
			penSet(c, { currentItemArrowType: v }, `${ARROW_TYPES.find((t) => t[1] === v)?.[0] ?? v} arrows`);
		};
		cycle("cycle-arrow-type", "Cycle arrow shape (straight, curved, elbow)", "Lines", "W", (c) => arrows(c).length > 0, (c, dir) => {
			const els = arrows(c);
			const now = els[0].elbowed ? "elbow" : els[0].roundness ? "round" : "sharp";
			const order = ARROW_TYPES.map((t) => t[1]);
			const next = order[wrap(order.indexOf(now) + dir, order.length)];
			showInfo(`${ARROW_TYPES.find((t) => t[1] === next)?.[0] ?? next} arrow`);
			return edit(c, els, (el) => setArrowType(el, next));
		});

		// Mind map and connect --------------------------------------------------------------
		add("mind-child", "New connected box (mind map)", "Mind map", (c) => this.grow(c, false));
		add("mind-sibling", "New box beside (mind map)", "Mind map", (c) => this.grow(c, true));
		add("connect", "Connect the selected shapes with arrows", "Mind map", (c) => this.connect(c), [hk(["Mod", "Alt"], "A")]);
		add("tidy-map", "Tidy the mind map", "Mind map", (c) => this.tidyMap(c));
		add("fold-branch", "Fold or open a branch (mind map)", "Mind map", (c) => this.toggleFold(c));
		add("layout-flow", "Lay out as a flowchart", "Arrange", (c) => this.layout(c, "flow"));
		add("layout-timeline", "Lay out as a timeline", "Arrange", (c) => this.layout(c, "timeline"));
		add("layout-kanban", "Lay out as a kanban board", "Arrange", (c) => this.layout(c, "kanban"));
		add("layout-matrix", "Lay out as a 2×2 grid", "Arrange", (c) => this.layout(c, "matrix"));
		add("copy-image", "Copy the selection as an image", "Export", (c) => this.copyImage(c));
		add("image-to-note", "Put the selection in a note as an image", "Export", (c) => this.imageToNote(c));

		// Style clipboard and select similar ------------------------------------------------
		add("copy-style", "Copy style", "Style", (c) => this.copyStyle(c), [hk(["Mod", "Alt"], "C")]);
		add("paste-style", "Paste style", "Style", (c) => this.pasteStyle(c), [hk(["Mod", "Alt"], "V")]);
		for (const [by, name] of [["colour", "pen colour"], ["fill", "fill"], ["type", "type"], ["style", "style"]] as const) {
			add(`select-same-${by}`, `Select all with the same ${name}`, "Select", (c) => this.selectSimilar(c, by));
		}

		// Turn, flip, lock --------------------------------------------------------------------
		add("turn-right", "Turn right 90°", "Turn", (c) => this.turn(c, 90));
		add("turn-left", "Turn left 90°", "Turn", (c) => this.turn(c, -90));
		add("turn-right-small", "Turn right 15°", "Turn", (c) => this.turn(c, 15));
		add("turn-left-small", "Turn left 15°", "Turn", (c) => this.turn(c, -15));
		add("flip-across", "Flip left to right", "Turn", (c) => this.flip(c, true));
		add("flip-down", "Flip top to bottom", "Turn", (c) => this.flip(c, false));
		add("lock", "Lock the selection", "Turn", (c) => this.lock(c));
		add("unlock-all", "Unlock all", "Turn", (c) => this.unlockAll(c));

		// Links, frames, stamps, macros ---------------------------------------------------------
		add("link-note", "Link the selection to a note", "Link", (c) => this.linkNote(c));
		add("wrap-frame", "Put the selection in a frame", "Frames", (c) => this.wrapInFrame(c));
		add("next-frame", "Go to the next frame", "Frames", (c) => this.goFrame(c, 1));
		add("previous-frame", "Go to the previous frame", "Frames", (c) => this.goFrame(c, -1));
		add("save-stamp", "Save the selection as a stamp", "Stamps", (c) => this.saveStamp(c));
		add("drop-stamp", "Place a stamp", "Stamps", () => this.pickStamp());
		add("record-macro", "Record a macro (run again to stop)", "Macros", () => this.toggleRecord());
		for (let i = 0; i < 9; i++) add(`play-macro-${i + 1}`, `Play macro ${i + 1}`, "Macros", () => this.playMacro(i));

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

type NumberKey = "moveMs" | "whichKeyDelay" | "nudgeStep" | "nudgeStepShift" | "resizePercent" | "duplicateGap" | "fitPadding" | "zoomMs";
type ToggleKey = "keyCoach" | "followDrags" | "showWhatsNew" | "presetBar" | "whichKey" | "catchKeysFirst" | "showStatusColours" | "showOneByOne" | "shiftGoesBack" | "diagonalNudge" | "copyText" | "copyFill" | "zoomOnSelection";

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
		const all: SettingDefinitionItem[] = [
			{
				type: "group",
				items: [
					{
						name: "Guide",
						desc: "How to use it all, with your own keys. Also: leader key, then ?.",
						action: () => new GuideModal(this.app, this.plugin).open(),
					},
					{
						name: this.plugin.keyboardHere() ? "Practice the keys" : "Practice",
						desc: "A short lesson in a new drawing, about two minutes.",
						action: () => void this.plugin.practice(),
					},
					{
						name: "What's new",
						desc: "What changed in each version.",
						action: () => void this.plugin.openWhatsNew(),
					},
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
									toggle("Show the key when you click a button", "Click a toolbar or style button that has a key, and a short note shows the key. Three times for each.", "keyCoach"),
									{
										name: "Use only the basic keys",
										desc: "Colours, line width and style, duplicate and search. Replaces this plugin's keys.",
										action: () => void this.plugin.applySuggestedKeys(true, "basic").then(() => new Notice("Basic keys set")),
									},
									{
										name: "Use the leader key only",
										desc: "Only search gets a key. Everything else is in the leader menu. Replaces this plugin's keys.",
										action: () => void this.plugin.applySuggestedKeys(true, "leader").then(() => new Notice("Leader key only")),
									},
									toggle("Show what's new after an update", "Open the list of changes in a new tab once after each update.", "showWhatsNew"),
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
								["Tools", ["Tools"]],
								["Move between shapes", ["Move"]],
								["Mind map and shapes", ["mind-child", "mind-sibling", "connect", "cycle-shape"]],
								["Repeat", ["Repeat"]],
								["Leader key", ["Leader"]],
							] as [string, string[]][]).map(
								([heading, groups]): SettingDefinitionItem => ({
									type: "group",
									heading,
									items: this.plugin.actions
										.filter((a) => (groups.includes(a.group) || groups.includes(a.id)) && a.id !== "search")
										.map(
											(a): SettingDefinition => ({
												name: a.name.replace(/^Tool: /, ""),
												desc:
													({
														delete: "Only with something selected.",
														leader: "Press it, then a short row of keys. A panel shows the choices.",
														"mind-child": "Adds a box with an arrow from the selected box. Type its label at once.",
														"mind-sibling": "Adds a box next to the selected one, from the same parent.",
													} as Record<string, string>)[a.id] ?? "",
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
									{
										name: "Bar or one button",
										desc: "One button in the drawing's top row opens every action, and leaves all the room for drawing.",
										control: { type: "dropdown", key: "touchBar", options: { auto: "One button on phones and tablets", button: "One button everywhere", full: "The full bar everywhere" } },
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
							{
								type: "group",
								heading: "Your buttons on the bar",
								items: [
									{
										name: "Add a button",
										desc: "Put any command on the preset bar. Good for a tablet with no keyboard.",
										action: () =>
											new CommandPickerModal(this.app, this.plugin, (id) => {
												if (!this.plugin.settings.barCommands.includes(id)) this.plugin.settings.barCommands.push(id);
												void this.plugin.saveSettings().then(() => {
													this.plugin.updateBar();
													this.update();
												});
											}).open(),
									},
									...this.plugin.settings.barCommands.map(
										(id, i): SettingDefinition => ({
											name: this.plugin.commandName(id),
											desc: "",
											aliases: ["bar", "button", "toolbar"],
											render: (setting) => {
												setting.addExtraButton((b) =>
													b
														.setIcon("x")
														.setTooltip("Remove")
														.onClick(() => {
															this.plugin.settings.barCommands.splice(i, 1);
															void this.plugin.saveSettings().then(() => {
																this.plugin.updateBar();
																this.update();
															});
														}),
												);
											},
										}),
									),
								],
							},
							{
								type: "group",
								heading: "Share",
								items: [
									{
										name: "Export",
										desc: `Save your presets, colours, stamps, macros and bar buttons to ${ExcalidrawHotkeys.SHARE_PATH}.`,
										action: () => void this.plugin.exportShare(),
									},
									{
										name: "Import",
										desc: "Load them from that file in this vault. Presets and colours are replaced. Stamps, macros and buttons are added.",
										action: () => {
											this.plugin.importShare();
										},
									},
								],
							},
						],
					},
					{
						type: "page",
						name: "Stamps and macros",
						desc: "Saved shapes to place again, and recorded steps to play again.",
						displayValue: () => `${this.plugin.settings.stamps.length} stamps, ${this.plugin.settings.macros.filter(Boolean).length} macros`,
						items: [
							{
								type: "group",
								heading: "Stamps",
								items: [
									{
										name: "Save a stamp",
										desc: "In a drawing, select shapes, then press the leader key, J and S. Place it with the leader key, J and its number. It lands at the mouse.",
									},
									...this.plugin.settings.stamps.map(
										(s, i): SettingDefinition => ({
											name: `Stamp ${i + 1}`,
											desc: `${s.els.filter((e) => !(e.type === "text" && e.containerId)).length} shapes`,
											aliases: ["stamp", "template", "snippet"],
											render: (setting) => {
												setting.addText((t) =>
													t.setValue(s.name).onChange((v) => {
														s.name = v.trim() || `Stamp ${i + 1}`;
														void this.plugin.saveSettings();
													}),
												);
												setting.addExtraButton((b) =>
													b
														.setIcon("x")
														.setTooltip("Delete stamp")
														.onClick(() => {
															this.plugin.settings.stamps.splice(i, 1);
															void this.plugin.saveSettings().then(() => this.update());
														}),
												);
											},
										}),
									),
								],
							},
							{
								type: "group",
								heading: "Macros",
								items: [
									{
										name: "Record a macro",
										desc: "In a drawing, press the leader key, Q and R. Do the steps. Press the leader key, Q and R again to stop. Play it with the leader key, Q and its number.",
									},
									...this.plugin.settings.macros.map(
										(m, i): SettingDefinition => ({
											name: `Macro ${i + 1}`,
											desc: m ? m.steps.map((s) => this.plugin.stepLabel(s)).join(" › ") : "Empty",
											aliases: ["macro", "record", "playback"],
											render: (setting) => {
												if (!m) return;
												setting.addText((t) =>
													t.setValue(m.name).onChange((v) => {
														m.name = v.trim() || `Macro ${i + 1}`;
														void this.plugin.saveSettings();
													}),
												);
												setting.addExtraButton((b) =>
													b
														.setIcon("x")
														.setTooltip("Delete macro")
														.onClick(() => {
															this.plugin.settings.macros[i] = null;
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
						desc: "Diagonal move, resize step, arrow style and move speed.",
						items: [
							{
								type: "group",
								items: [
									toggle("Diagonal move", "Hold two arrow keys to move the selection on a diagonal.", "diagonalNudge"),
									slider("Diagonal step", "Pixels per key press.", "nudgeStep", 1, 50),
									slider("Diagonal step with Shift", "Pixels per key press with Shift held.", "nudgeStepShift", 1, 100),
									slider("Resize step", "Percent per key press.", "resizePercent", 1, 50),
									slider("Fit padding", "Space around the text after Fit box to text.", "fitPadding", 0, 100),
									{
										name: "Arrow style",
										desc: "How the arrows this plugin draws look: mind map, connect and duplicate. They are drawn again the same way when a shape moves.",
										control: { type: "dropdown", key: "arrowStyle", options: { curved: "Curved, like a hand-drawn map", straight: "Straight", elbow: "Elbow, with right-angle bends", pen: "Like my pen" } },
									},
									toggle("Arrows follow a mouse drag", "When you drag a shape, the arrows this plugin laid are drawn again from the sides that face each other.", "followDrags"),
									slider("Move speed", "Milliseconds for line up, spread, grid, swap and turn to glide into place. 0 jumps.", "moveMs", 0, 600, 20),
								],
							},
						],
					},
				],
			},
		];
		const keyboard: SettingDefinitionItem = {
			type: "group",
			items: [
				{
					name: "I use a keyboard on this device",
					desc: "Turns on keys, the key panel and the leader key, on this phone or tablet only.",
					control: { type: "toggle", key: "keyboardHere" },
				},
			],
		};
		if (!Platform.isMobile) return all;
		if (this.plugin.keyboardHere()) return [keyboard, ...all];
		// No keyboard: guide, practice, the bar, arrows, presets, stamps and macros. Nothing about keys.
		const keep = ["Pen presets", "Stamps and macros", "Moving and sizing"];
		const drop = ["Show my hotkeys", "Change keys"];
		const lean = (items: SettingDefinitionItem[]): SettingDefinitionItem[] =>
			items.flatMap((it): SettingDefinitionItem[] => {
				const r = it as { type?: string; name?: string; items?: SettingDefinitionItem[] };
				if (r.type === "page") return keep.includes(r.name ?? "") ? [it] : [];
				if (r.type === "group") {
					const inner = lean(r.items ?? []);
					return inner.length ? [{ ...r, items: inner } as SettingDefinitionItem] : [];
				}
				return drop.includes(r.name ?? "") ? [] : [it];
			});
		return [...lean(all), keyboard];
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
		if (key === "keyboardHere") return this.plugin.keyboardHere();
		if (key === "zoomPresets") return this.plugin.settings.zoomPresets.join(", ");
		return this.plugin.settings[key as keyof HotkeySettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const st = this.plugin.settings;
		if (key === "keyboardHere") {
			// Kept on this device only, not in the synced settings.
			this.plugin.setKeyboardHere(value === true);
			this.update();
			return;
		}
		if (key === "zoomPresets") {
			const nums = parseZoomPresets(String(value));
			if (nums.length === 0) return;
			st.zoomPresets = nums;
		} else if (key === "arrowStyle") {
			st.arrowStyle = String(value);
		} else if (key === "touchBar") {
			st.touchBar = String(value);
		} else if (key === "notePath") {
			st.notePath = String(value).trim() || DEFAULT_SETTINGS.notePath;
		} else if (typeof value === "number") {
			st[key as NumberKey] = value;
		} else if (typeof value === "boolean") {
			st[key as ToggleKey] = value;
		}
		await this.plugin.saveSettings();
		if (key === "showOneByOne" || key === "shiftGoesBack") this.plugin.registerCommands();
		if (key === "presetBar" || key === "touchBar") this.plugin.updateBar();
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
		if (this.plugin.compactBar()) {
			contentEl.createEl("p", { text: "In a drawing, tap the ⚡ button in the top row. It has every action: mind map, line up, layouts, colours and more." });
			contentEl.createEl("p", { text: "It sits beside Excalidraw's own buttons, so the whole screen stays free for drawing." });
			const row = contentEl.createDiv({ cls: "modal-button-container" });
			row.createEl("button", { text: "Show me how", cls: "mod-cta" }).addEventListener("click", () => {
				this.close();
				void this.plugin.practice();
			});
			row.createEl("button", { text: "Use keys too" }).addEventListener("click", () => {
				void this.plugin.applySuggestedKeys(false, "all").then((n) => new Notice(`Set ${n} keys`));
				this.close();
			});
			row.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
			return;
		}
		contentEl.createEl("p", { text: "Use the suggested keys? They sit under the left hand, so the other hand stays on the mouse or pen." });
		contentEl.createEl("p", { text: "You can change any key later in Settings, Hotkeys." });
		const bar = contentEl.createDiv({ cls: "modal-button-container" });
		const yes = bar.createEl("button", { text: "Use suggested keys", cls: "mod-cta" });
		const few = bar.createEl("button", { text: "Only the basics" });
		const no = bar.createEl("button", { text: "Not now" });
		const pick = (set: string) => {
			void this.plugin.applySuggestedKeys(false, set).then((n) => new Notice(`Set ${n} keys`));
			this.close();
			new GuideModal(this.app, this.plugin).open();
		};
		yes.addEventListener("click", () => pick("all"));
		few.addEventListener("click", () => pick("basic"));
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

// ---------------------------------------------------------------------------
// Pick a note to link, with the smart search
// ---------------------------------------------------------------------------

class NotePickerModal extends SuggestModal<TFile | null> {
	constructor(
		app: App,
		private canRemove: boolean,
		private pick: (file: TFile | null) => void,
		placeholder = "Find a note to link",
	) {
		super(app);
		this.setPlaceholder(placeholder);
		this.limit = 60;
	}

	getSuggestions(query: string): (TFile | null)[] {
		const files = this.app.vault.getMarkdownFiles();
		const recent = this.app.workspace.getLastOpenFiles();
		const sorted = [...files].sort((a, b) => {
			const ra = recent.indexOf(a.path);
			const rb = recent.indexOf(b.path);
			return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb) || b.stat.mtime - a.stat.mtime;
		});
		const found = query.trim() ? rank(query, sorted, (f) => words(f.path.replace(/\.md$/, "")), (f) => f.basename) : sorted;
		return this.canRemove && !query.trim() ? [null, ...found] : found;
	}

	renderSuggestion(f: TFile | null, el: HTMLElement) {
		if (!f) {
			el.createDiv({ text: "Remove the link" });
			return;
		}
		el.addClass("ekh-suggestion");
		el.createDiv({ cls: "ekh-suggestion-main", text: f.basename });
		if (f.parent && f.parent.path !== "/") el.createDiv({ cls: "ekh-suggestion-hint", text: f.parent.path });
	}

	onChooseSuggestion(f: TFile | null) {
		this.pick(f);
	}
}

// ---------------------------------------------------------------------------
// Pick one thing from a short list, with the smart search
// ---------------------------------------------------------------------------

class ListPickerModal<T> extends SuggestModal<{ label: string; hint: string; value: T }> {
	constructor(
		app: App,
		placeholder: string,
		private items: { label: string; hint: string; value: T }[],
		private pick: (value: T) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): { label: string; hint: string; value: T }[] {
		return query.trim() ? rank(query, this.items, (i) => words(i.label), (i) => i.label) : this.items;
	}

	renderSuggestion(it: { label: string; hint: string; value: T }, el: HTMLElement) {
		el.addClass("ekh-suggestion");
		el.createDiv({ cls: "ekh-suggestion-main", text: it.label });
		if (it.hint) el.createDiv({ cls: "ekh-suggestion-hint", text: it.hint });
	}

	onChooseSuggestion(it: { label: string; hint: string; value: T }) {
		this.pick(it.value);
	}
}

// ---------------------------------------------------------------------------
// Guide: how to use it, built from your own keys so it is never out of date
// ---------------------------------------------------------------------------

/**
 * The guide as Markdown, from the same keys and menus the guide window shows.
 * Saved as a note from the guide, and used to make docs/guide.md for GitHub.
 */
function guideMarkdown(p: ExcalidrawHotkeys): string {
	const keys = (id: string) => {
		const tool = p.settings.toolKeys[id];
		const all = [...(tool ? [comboLabel(tool)] : []), ...p.hotkeysFor(id).map(hotkeyLabel)];
		return all.length ? all.map((k) => `\`${k}\``).join(" or ") : "no key yet";
	};
	const code = (k: string) => (k === "`" ? "`` ` ``" : `\`${k}\``);
	const lead = comboLabel(p.settings.toolKeys.leader || "");
	const out: string[] = [
		"# Excalidraw Hotkeys guide",
		"",
		"Keyboard control for Excalidraw drawings in Obsidian. In Obsidian, run **Open the guide**, or press the leader key and then `?`, to see this with your own keys.",
		"",
		"## Learn these first",
		"",
		"| Key | What it does |",
		"|---|---|",
		"| `Alt` | Hold it for a moment in a drawing. A panel shows every Alt key. Same for Ctrl and Shift. |",
		`| ${lead ? code(lead) : "no key yet"} | The leader key. Press it, and a panel shows a menu of plain letters. Follow the letters. You never need to remember them. |`,
		`| ${keys("search")} | Search for any style or command in your own words, like blue dashed thick. |`,
		"| `Alt+1` … `Alt+8` | Pen colours. Add Shift for fill colours. |",
		`| ${keys("repeat")} | Do your last change again, on the next shape. |`,
		`| ${keys("mind-child")} | On a box: add a connected box and type its label. Press again for the next one. |`,
		"",
		"## One rule for every style key",
		"",
		"- Something selected: the key changes it.",
		"- Nothing selected: the key changes your pen, for the next thing you draw.",
		"- Typing a text: the key changes that text.",
		"",
		"## The leader menu",
		"",
		lead ? `Press ${code(lead)}, then a letter, then the next. Esc cancels.` : "Give the leader key a key in Settings, Drawing keys.",
		"",
	];
	for (const [key, node] of p.leaderTree().children ?? new Map<string, LeaderNode>()) {
		if (!node.children) {
			out.push(`- ${code(comboLabel(key))} **${node.label}**`, "");
			continue;
		}
		out.push(`### ${code(comboLabel(key))} ${node.label}`, "");
		const row = (prefix: string, n: LeaderNode) => {
			for (const [k, c] of n.children ?? new Map<string, LeaderNode>()) {
				if (c.children) row(`${prefix}${comboLabel(k)} `, c);
				else out.push(`- ${code(prefix + comboLabel(k))} ${c.label}`);
			}
		};
		row("", node);
		out.push("");
	}
	out.push("## Keys that work only in a drawing", "", "| Key | What it does |", "|---|---|");
	for (const a of p.actions) {
		const key = p.settings.toolKeys[a.id];
		if (key && a.id !== "leader") out.push(`| ${code(comboLabel(key))} | ${shortName(a.name)} |`);
	}
	out.push(
		"",
		"## Good to know",
		"",
		"- Every change is one undo step. Ctrl+Z takes it back.",
		"- Line up and spread keep a caption with its drawing, and a label with its box.",
		"- Arrows leave from the sides that face each other, and curve like a hand-drawn map. Pick the arrow style in Settings, Moving and sizing.",
		"- The bar at the bottom: click a preset to use it, right-click to save over it, + to save a new one.",
		"- Record a macro: leader, Q, R. Do the steps. Leader, Q, R again to stop.",
		"",
		"All commands and their keys: run **Show my hotkeys**.",
		"",
	);
	return out.join("\n");
}

class GuideModal extends Modal {
	constructor(app: App, private plugin: ExcalidrawHotkeys) {
		super(app);
	}

	/** The keys for a command right now: its drawing key, then its hotkeys. */
	private keys(id: string): string[] {
		const p = this.plugin;
		const tool = p.settings.toolKeys[id];
		return [...(tool ? [comboLabel(tool)] : []), ...p.hotkeysFor(id).map(hotkeyLabel)];
	}

	private kbd(el: HTMLElement, keys: string[], fallback = "no key yet") {
		if (keys.length === 0) el.createSpan({ cls: "ekh-none", text: fallback });
		keys.forEach((k, i) => {
			if (i > 0) el.appendText(" or ");
			el.createEl("kbd", { text: k });
		});
	}

	onOpen() {
		const p = this.plugin;
		const { contentEl } = this;
		this.modalEl.addClass("ekh-guide-modal");
		this.titleEl.setText("Excalidraw Hotkeys guide");
		const lead = comboLabel(p.settings.toolKeys.leader || "");

		if (p.compactBar()) {
			contentEl.createEl("h3", { text: "On a phone or tablet" });
			const t = contentEl.createEl("ul");
			t.createEl("li", { text: "Tap ⚡ in the drawing's top row. It has every action, with the same names as below." });
			t.createEl("li", { text: "Menus with … open the next menu. Your presets are at the top." });
			t.createEl("li", { text: "Search finds any style or command in your own words, like blue dashed thick." });
			t.createEl("li", { text: "With a keyboard, all the keys below work too." });
		}
		contentEl.createEl("h3", { text: "Learn these first" });
		const first = contentEl.createDiv({ cls: "ekh-guide-grid" });
		const row = (keys: string[], what: string) => {
			const k = first.createDiv({ cls: "ekh-guide-keys" });
			this.kbd(k, keys);
			first.createDiv({ cls: "ekh-guide-what", text: what });
		};
		row(["Alt"], "Hold it for a moment in a drawing. A panel shows every Alt key. Same for Ctrl and Shift.");
		row(lead ? [lead] : [], "The leader key. Press it, and a panel shows a menu of plain letters. Follow the letters. You never need to remember them.");
		row(this.keys("search"), "Search for any style or command in your own words, like blue dashed thick.");
		row(["Alt+1 … 8"], "Pen colours. Add Shift for fill colours.");
		row(this.keys("repeat"), "Do your last change again, on the next shape.");
		row(this.keys("mind-child"), "On a box: add a connected box and type its label. Press again for the next one.");

		contentEl.createEl("h3", { text: "One rule for every style key" });
		const rule = contentEl.createEl("ul");
		rule.createEl("li", { text: "Something selected: the key changes it." });
		rule.createEl("li", { text: "Nothing selected: the key changes your pen, for the next thing you draw." });
		rule.createEl("li", { text: "Typing a text: the key changes that text." });

		contentEl.createEl("h3", { text: "The leader menu" });
		contentEl.createEl("p", { cls: "ekh-guide-note", text: lead ? `Press ${lead}, then a letter, then the next. Esc cancels.` : "Give the leader key a key in Settings, Drawing keys." });
		const map = contentEl.createDiv({ cls: "ekh-guide-map" });
		for (const [key, node] of p.leaderTree().children ?? new Map<string, LeaderNode>()) {
			const card = map.createDiv({ cls: "ekh-guide-card" });
			const head = card.createDiv({ cls: "ekh-guide-card-head" });
			head.createEl("kbd", { text: comboLabel(key) });
			head.createSpan({ text: node.label });
			if (!node.children) continue;
			const list = card.createDiv({ cls: "ekh-guide-card-list" });
			for (const [k, n] of node.children) {
				const item = list.createDiv();
				item.createEl("kbd", { text: comboLabel(k) });
				item.appendText(n.children ? ` ${n.label}…` : ` ${n.label}`);
			}
		}

		contentEl.createEl("h3", { text: "Keys that work only in a drawing" });
		const dk = contentEl.createDiv({ cls: "ekh-guide-grid" });
		for (const a of p.actions) {
			const key = p.settings.toolKeys[a.id];
			if (!key || a.id === "leader") continue;
			const k = dk.createDiv({ cls: "ekh-guide-keys" });
			this.kbd(k, [comboLabel(key)]);
			dk.createDiv({ cls: "ekh-guide-what", text: shortName(a.name) });
		}

		contentEl.createEl("h3", { text: "Good to know" });
		const tips = contentEl.createEl("ul");
		tips.createEl("li", { text: "Every change is one undo step. Ctrl+Z takes it back." });
		tips.createEl("li", { text: "Line up and spread keep a caption with its drawing, and a label with its box." });
		tips.createEl("li", { text: "The bar at the bottom: click a preset to use it, right-click to save over it, + to save a new one." });
		tips.createEl("li", { text: "Record a macro: leader, Q, R. Do the steps. Leader, Q, R again to stop." });

		const bar = contentEl.createDiv({ cls: "modal-button-container" });
		const note = bar.createEl("button", { text: "Save as note" });
		note.addEventListener("click", () => {
			void (async () => {
				const path = normalizePath("Excalidraw Hotkeys guide.md");
				const text = guideMarkdown(p);
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) await this.app.vault.modify(file, text);
				else await this.app.vault.create(path, text);
				new Notice(`Saved to ${path}`);
			})();
		});
		const all = bar.createEl("button", { text: "Show all my keys" });
		const settings = bar.createEl("button", { text: "Change keys", cls: "mod-cta" });
		all.addEventListener("click", () => {
			this.close();
			new HotkeyListModal(this.app, p).open();
		});
		settings.addEventListener("click", () => {
			this.close();
			const setting = (this.app as AppInternals).setting;
			setting?.open();
			setting?.openTabById(p.manifest.id);
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// What's new
// ---------------------------------------------------------------------------

const WHATS_NEW_VIEW = "excalidraw-hotkeys-whats-new";

/** -1, 0 or 1, comparing dotted version numbers. */
function compareVersions(a: string, b: string): number {
	const x = a.split(".").map(Number);
	const y = b.split(".").map(Number);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d) return Math.sign(d);
	}
	return 0;
}

/** The versions in CHANGELOG.md, newest first. */
function releases(): { version: string; body: string }[] {
	return CHANGELOG.split(/^## /m)
		.slice(1)
		.map((part) => ({ version: /^[0-9.]+/.exec(part)?.[0] ?? "", body: "## " + part.trim() }))
		.filter((r) => r.version);
}

/** A tab with the release notes. Versions newer than the one you had are marked New. */
class WhatsNewView extends ItemView {
	private since = "";

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return WHATS_NEW_VIEW;
	}

	getDisplayText() {
		return "What's new in Excalidraw Hotkeys";
	}

	getIcon() {
		return "sparkles";
	}

	async setState(state: unknown, result: ViewStateResult) {
		const since = (state as { since?: unknown } | null)?.since;
		this.since = typeof since === "string" ? since : "";
		await super.setState(state, result);
		await this.draw();
	}

	getState(): Record<string, unknown> {
		return { since: this.since };
	}

	async onOpen() {
		await this.draw();
	}

	private async draw() {
		const root = this.contentEl;
		root.empty();
		root.addClass("ekh-whats-new");
		const page = root.createDiv({ cls: "ekh-wn-page" });
		page.createEl("h1", { text: "What's new" });
		const list = releases();
		const latest = list[0]?.version ?? "";
		const fresh = list.filter((r) => this.since && compareVersions(r.version, this.since) > 0);
		page.createEl("p", {
			cls: "ekh-wn-lead",
			text: fresh.length ? `Excalidraw Hotkeys is now ${latest}. Here is what changed since ${this.since}.` : `Excalidraw Hotkeys ${latest}.`,
		});
		for (const r of list) {
			const isNew = fresh.includes(r);
			const box = page.createDiv({ cls: isNew ? "ekh-wn-release is-new" : "ekh-wn-release" });
			await MarkdownRenderer.render(this.app, r.body, box, "", this);
			if (isNew) box.querySelector("h2")?.createSpan({ cls: "ekh-wn-badge", text: "New" });
		}
		const foot = page.createDiv({ cls: "ekh-wn-foot" });
		const off = foot.createEl("button", { text: "Do not open this after updates" });
		const plugin = (this.app as unknown as { plugins: { plugins: Record<string, ExcalidrawHotkeys | undefined> } }).plugins.plugins["excalidraw-hotkeys"];
		if (!plugin?.settings.showWhatsNew) off.remove();
		off.addEventListener("click", () => {
			if (!plugin) return;
			plugin.settings.showWhatsNew = false;
			void plugin.saveSettings();
			off.remove();
			new Notice("Turn it on again in Settings, Keys");
		});
	}
}
