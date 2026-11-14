# Excalidraw Hotkeys

Keyboard control for [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) drawings in Obsidian. Colour, fill, line style, fonts, resize, duplicate with an arrow, and smooth zoom presets.

![Demo](docs/demo.gif)

Every action is an Obsidian command. You choose the keys in **Settings → Hotkeys**, like any other command. Each command also works from a vimrc (`exmap` + `obcommand excalidraw-hotkeys:<id>`).

## Start

1. Install and turn on the plugin. It needs the Excalidraw plugin.
2. Open **Settings → Excalidraw Hotkeys**.
3. Press **Use suggested keys**. This gives every command without a key the key in the table below. Keys you already set stay as they are. **Reset all keys to suggested** replaces them all.

Run **Show my hotkeys** at any time to see your keys. Press **Save as note** in that window to write the list to a note.

## Commands

The suggested keys are all under the left hand, so the right hand stays on the mouse or pen.

- **Alt + key** does a thing.
- **Alt + Shift + key** goes back one step on a cycle key (line style, line width, fill style, font, align, arrowheads). You can turn this off in Settings.
- Other keys use Shift for their own job: Alt+Shift+number is fill, and Ctrl+Shift+W/A/S/D duplicates.

| Command | Suggested key |
|---|---|
| **Colour** | |
| Pen colour 1–8 (lines, arrows, text) | `Alt+1` … `Alt+8` |
| Fill colour 1–8 (inside of shapes) | `Alt+Shift+1` … `Alt+Shift+8` |
| No line / No fill | `Alt+0` / `Alt+Shift+0` |
| Cycle fill style (none, hachure, cross-hatch, solid) | `Alt+F`, back `Alt+Shift+F` |
| Reset to black with no fill | ``Ctrl+` `` |
| More see-through / More opaque | `Alt+X` / `Alt+Shift+X` |
| **Lines** | |
| Cycle line style (solid, dashed, dotted) | `Alt+D`, back `Alt+Shift+D` |
| Cycle line width (thin, bold, extra bold) | `Alt+Q`, back `Alt+Shift+Q` |
| Cycle arrowheads (none, end, both, start) | `Alt+E`, back `Alt+Shift+E` |
| **Text** | |
| Cycle text align (left, centre, right) | `Alt+A`, back `Alt+Shift+A` |
| Cycle font (hand-drawn, normal, code) | `Alt+T`, back `Alt+Shift+T` |
| Font size up / down (small, medium, large, very large) | `Alt+G` / `Alt+Shift+G` |
| Fit box to text | `Alt+B` |
| **Duplicate with an arrow** | |
| Up / left / down / right | `Ctrl+Shift+W` / `A` / `S` / `D` |
| **Size** | |
| Bigger / smaller (or thicker / thinner line) | `Alt+R` / `Alt+Shift+R` |
| Wider / narrower | `Alt+C` / `Alt+Shift+C` |
| Taller / shorter | `Alt+V` / `Alt+Shift+V` |
| **Zoom** | |
| Zoom preset 1–9 | `Ctrl+Alt+1` … `Ctrl+Alt+5` |
| Zoom in / out to the next preset | `Ctrl+Alt+Z` / `Ctrl+Alt+Shift+Z` |
| **Other** | |
| Show my hotkeys | none |

A command for each single line style, line width, font, font size, align and arrowhead is hidden. Turn on **Show one-by-one commands** to list them too.

## How the keys work

Colour and style keys work on what you are using:

- **Something selected:** the key changes it. Your pen stays the same.
- **Nothing selected:** the key changes your pen, so the next thing you draw or write gets it. This works for colour, line width, line style, fill style, arrowheads, font, font size, align and opacity. A short popup says what changed.
- **Typing a text:** the colour keys colour that text.

Pen keys change lines, arrows and text. Fill keys change only the inside of boxes, circles and diamonds. Each colour key shows a short popup with the colour. The status bar at the bottom right shows your pen and fill colour while a drawing is open.

Hold two arrow keys to move the selection on a diagonal. Hold Shift too for a bigger step. This one is not in the Hotkeys menu.

## Settings

The first page has 5 parts:

- **Keys**: use or reset the suggested keys, Shift goes back, show one-by-one commands, catch keys before Excalidraw, and where the hotkey note goes.
- **Colours**: the 8 pen colours and 8 fill colours, and the status bar colours. Colour 1 is Excalidraw's own ink: white in dark mode, black in light mode. The square next to each colour shows how it looks in the drawing.
- **Zoom**: the presets, for example `25, 50, 100, 200, 400`, the zoom speed, and zoom on the selection.
- **Duplicate**: what a copy keeps, and the gap to it.
- **Moving and sizing**: diagonal move, resize step and fit padding.

Every edit is one undo step. `Ctrl+Z` undoes a duplicate with its arrow in one press.

## Install by hand

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Virus7976/excalidraw-hotkeys/releases/latest). Put them in `<vault>/.obsidian/plugins/excalidraw-hotkeys/`. Turn the plugin on in **Settings → Community plugins**.

## Build

```
npm install
npm run build
```

## License

MIT
