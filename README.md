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

The suggested keys are all under the left hand, so the right hand stays on the mouse or pen. Alt does a thing. Alt+Shift does the opposite, or the fill.

| Command | Suggested key |
|---|---|
| **Colour** | |
| Pen colour 1–8 (lines, arrows, text) | `Alt+1` … `Alt+8` |
| Fill colour 1–8 (inside of shapes) | `Alt+Shift+1` … `Alt+Shift+8` |
| Cycle fill style (hachure, cross-hatch, solid, none) | `Alt+F` |
| Reset to black with no fill | ``Ctrl+` `` |
| More see-through / More opaque | `Alt+X` / `Alt+Shift+X` |
| **Lines** | |
| Cycle line style (solid, dashed, dotted) | `Alt+D` |
| Cycle line width (thin, bold, extra bold) | `Alt+Q` |
| Line style or width, one by one | none |
| End / start arrowhead on or off | `Alt+E` / `Alt+Shift+E` |
| **Text** | |
| Cycle text align (left, centre, right) | `Alt+A` |
| Cycle font (hand-drawn, normal, code) | `Alt+T` |
| Font size up / down | `Alt+G` / `Alt+Shift+G` |
| Fit box to text | `Alt+B` |
| Align, font and font size, one by one | none |
| **Duplicate with an arrow** | |
| Up / left / down / right | `Alt+Shift+W` / `A` / `S` / `D` |
| **Size** | |
| Bigger / smaller (or thicker / thinner line) | `Alt+R` / `Alt+Shift+R` |
| Wider / narrower | `Alt+C` / `Alt+Shift+C` |
| Taller / shorter | `Alt+V` / `Alt+Shift+V` |
| **Zoom** | |
| Zoom preset 1–9 | `Ctrl+Alt+1` … `Ctrl+Alt+5` |
| Zoom out / in to the next preset | `Ctrl+Alt+Z` / `Ctrl+Alt+X` |
| **Other** | |
| Show my hotkeys | none |

Hold two arrow keys to move the selection on a diagonal. Hold Shift too for a bigger step. This one is not in the Hotkeys menu.

## Settings

- **Zoom presets**: type the percents, for example `25, 50, 100, 200, 400`. Preset 1 is the first number.
- **Zoom speed**: how long one zoom takes. 0 is instant.
- **Zoom on the selection**: with something selected, the zoom moves to it.
- **Pen colours** and **Fill colours**: 8 of each. Colour 1 is Excalidraw's own ink: white in dark mode, black in light mode. The square next to each colour shows how it looks in the drawing.
- **Copy keeps text** and **Copy keeps fill**: what a duplicate takes from its box.
- **Colours in the status bar**: show the stroke and fill colour at the bottom right.
- **Catch keys before Excalidraw**: keep this on. Excalidraw uses some of these keys for its own functions.

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
