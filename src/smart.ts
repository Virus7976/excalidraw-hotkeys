// Smart matching for search boxes: synonyms, word starts, small typos and
// several words at once. "thicker blue dash" finds bold, blue and dashed.

// Words that mean the same thing. The first word of each group is the one used.
const GROUPS: string[][] = [
	["colour", "color", "colours", "colors", "coloured", "colored"],
	["grey", "gray"],
	["purple", "violet", "magenta"],
	["teal", "cyan", "turquoise", "aqua"],
	["pink", "rose"],
	["centre", "center", "middle", "centred", "centered"],
	["ellipse", "circle", "oval", "round", "ellipses", "circles"],
	["rectangle", "square", "box", "rect", "boxes", "squares", "rectangles"],
	["diamond", "rhombus"],
	["pen", "pencil", "marker", "freehand", "draw", "drawing", "write", "writing", "freedraw", "ink", "stroke", "outline", "border"],
	["eraser", "erase", "rubber"],
	["delete", "remove", "trash", "del", "bin"],
	["duplicate", "copy", "clone", "dupe"],
	["dashed", "dash", "dashes"],
	["dotted", "dot", "dots"],
	["solid", "continuous", "plain"],
	["bold", "thick", "thicker", "heavy", "fat", "bolder", "heavier"],
	["thin", "thinner", "fine", "hairline", "light", "lighter"],
	["bigger", "larger", "grow", "increase", "enlarge", "big", "large"],
	["smaller", "shrink", "decrease", "reduce", "small", "little"],
	["wider", "widen", "width"],
	["taller", "height", "higher"],
	["opacity", "transparent", "transparency", "seethrough", "translucent", "faded", "fade"],
	["arrowhead", "arrowheads", "head", "heads", "tip", "tips"],
	["font", "fonts", "typeface", "letters", "lettering"],
	["handdrawn", "handwritten", "hand", "sketchy", "virgil", "excalifont"],
	["code", "mono", "monospace", "monospaced"],
	["fill", "background", "bg", "inside", "filled", "fills"],
	["text", "words", "label", "labels", "type", "typing"],
	["zoom", "magnify"],
	["select", "selection", "pointer", "cursor"],
	["move", "pan", "navigate", "jump", "go"],
	["preset", "presets", "brush", "brushes", "saved"],
	["none", "no", "off", "nothing", "clear"],
	["arrow", "arrows", "connector", "connectors"],
	["line", "lines", "straight"],
	["align", "alignment", "justify"],
	["lineup", "arrange", "tidy"],
	["spread", "distribute", "even", "evenly", "space", "spacing", "spaced"],
	["repeat", "again", "redo", "same"],
	["reset", "default", "defaults"],
];
const CANON = new Map<string, string>();
for (const g of GROUPS) for (const w of g) CANON.set(w, g[0]);
/** Every word of a group, by its main word. A typo is checked against all of them. */
const MEMBERS = new Map(GROUPS.map((g) => [g[0], g]));

/** One word, made plain and turned into its group's main word. */
export function norm(word: string): string {
	const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (CANON.has(w)) return CANON.get(w) as string;
	if (w.length > 3 && w.endsWith("s") && CANON.has(w.slice(0, -1))) return CANON.get(w.slice(0, -1)) as string;
	return w;
}

/** All words of a text, made plain. "Hand-drawn" counts as one word. */
export function words(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/hand-drawn/g, "handdrawn")
		.replace(/line[\s-]+up/g, "lineup")
		.replace(/see[\s-]*through/g, "seethrough")
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.map(norm);
}

function distance(a: string, b: string): number {
	if (Math.abs(a.length - b.length) > 2) return 3;
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++) {
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
	return d[a.length][b.length];
}

/** How well one search word fits one item word: 3 same, 2 start, 1.5 or 1 typo, 0 none. */
/** True when w is q with one letter added. */
function missedOne(q: string, w: string): boolean {
	let i = 0;
	while (i < q.length && q[i] === w[i]) i++;
	return q.slice(i) === w.slice(i + 1);
}

export function wordScore(q: string, w: string): number {
	let best = plainScore(q, w);
	if (best < 2) for (const s of MEMBERS.get(w) ?? []) best = Math.max(best, Math.min(plainScore(q, s), 1.75));
	return best;
}

function plainScore(q: string, w: string): number {
	if (q === w) return 3;
	if (q.length >= 2 && w.startsWith(q)) return 2;
	if (/^\d+$/.test(q) || /^\d+$/.test(w)) return 0;
	// A missed letter is the most common typo, so it beats a wrong letter: "thik" is "thick", not "thin".
	if (q.length >= 3 && w.length === q.length + 1 && missedOne(q, w)) return 1.75;
	if (q.length >= 4 && distance(q, w) <= 1) return 1.5;
	// Short forms leave letters out but keep the order: "grn" is green, "dotd" is dotted.
	if (q.length >= 3 && q[0] === w[0] && w.length - q.length <= 3 && inOrder(q, w)) return 1.5;
	if (q.length >= 7 && distance(q, w) <= 2) return 1;
	return 0;
}

/** True when every letter of q is in w, in the same order. */
function inOrder(q: string, w: string): boolean {
	let i = 0;
	for (const ch of w) if (ch === q[i]) i++;
	return i === q.length;
}

export interface Match {
	score: number;
	missed: number;
}

/** How well a search fits an item's words. Fewer missed words is better, then a higher score. */
export function match(query: string[], item: string[]): Match {
	let score = 0;
	let missed = 0;
	for (const q of query) {
		let best = 0;
		for (const w of item) best = Math.max(best, wordScore(q, w));
		if (best === 0) missed++;
		score += best;
	}
	return { score, missed };
}

/** Sort items by how well they fit, best first. Items that miss every word are dropped. */
export function rank<T>(query: string, items: T[], wordsOf: (t: T) => string[], label: (t: T) => string): T[] {
	const q = words(query);
	if (q.length === 0) return items;
	return items
		.map((t) => ({ t, m: match(q, wordsOf(t)) }))
		.filter((x) => x.m.missed < q.length)
		.sort((a, b) => a.m.missed - b.m.missed || b.m.score - a.m.score || label(a.t).length - label(b.t).length)
		.map((x) => x.t);
}

/** Words in a search that only say where a style goes, not which one. */
export const FILLER = new Set(["pen", "colour", "line", "the", "and", "with", "a", "an", "to", "make", "it", "style", "set", "use", "of", "in", "on"]);
