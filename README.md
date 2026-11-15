# Excalidraw Hotkeys

Keyboard control for [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) drawings in Obsidian. Colour, fill, line style, fonts, resize, duplicate with an arrow, smooth zoom, pen presets, a leader key, moving between shapes with keys, and a smart search.

![Demo](docs/demo.gif)

Every action is an Obsidian command. You choose the keys in **Settings → Hotkeys**, like any other command. Each command also works from a vimrc (`exmap` + `obcommand excalidraw-hotkeys:<id>`).

## Start

1. Install and turn on the plugin. It needs the Excalidraw plugin.
2. On first start, a popup asks if you want the suggested keys. Press **Use suggested keys**.
3. Or later: open **Settings → Excalidraw Hotkeys → Keys** and press **Use suggested keys**. This gives every command without a key the key in the table below. Keys you already set stay as they are. **Reset all keys to suggested** replaces them all.

Hold Alt, Ctrl or Shift for a moment in a drawing. A panel shows what each key does with it. Let go to hide it.

Run **Show my hotkeys** at any time to see your keys. Its search understands what you mean, like `thicker line`. Press **Save as note** in that window to write the list to a note.

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
| **Pen presets** | |
| Use pen preset 1–9 | `Ctrl+Shift+1` … `Ctrl+Shift+5` |
| Save pen as preset 1–9 | none (or the leader key, then P, S and a number) |
| **Search** | |
| Search styles and commands | `Alt+Z` |
| **Line up and spread** (leader, then L) | |
| Line up left / right / top / bottom edges | `` ` L A `` / `D` / `W` / `S` |
| Centre left to right / top to bottom | `` ` L C `` / `` ` L X `` |
| Spread out evenly across / down | `` ` L H `` / `` ` L V `` |
| **Drawing keys** (set in Settings → Drawing keys) | |
| Select / Rectangle / Diamond / Arrow / Text / Eraser / Frame | `V` / `R` / `D` / `A` / `T` / `E` / `F` |
| Ellipse (C for circle) / Line (S for straight) / Pen (W for write) | `C` / `S` / `W` |
| Delete the selection | `X` |
| Select the shape above / left / below / right | `Shift+W` / `A` / `S` / `D` |
| Follow the arrow out of / back into the selected shape | `Shift+F` / `Shift+R` |
| Leader key | `` ` `` (the key left of 1) |
| Repeat the last change | `G` |
| **Other** | |
| Show my hotkeys | none |

Drawing keys work only inside a drawing, and never while you type. To change one, open Settings → Drawing keys, click its key, then press any key or combo, like `W` or `Alt+P`. They are not in Obsidian's Hotkeys list, because a plain letter there would stop that letter from typing in every note. Each tool is also a command, so you can give it a Ctrl or Alt key in Settings → Hotkeys.

A command for each single line style, line width, font, font size, align and arrowhead is hidden. Turn on **Show one-by-one commands** to list them too.

## How the keys work

Colour and style keys work on what you are using:

- **Something selected:** the key changes it. Your pen stays the same.
- **Nothing selected:** the key changes your pen, so the next thing you draw or write gets it. This works for colour, line width, line style, fill style, arrowheads, font, font size, align and opacity. A key that has nothing to change says so, and does nothing else. A short popup says what changed.
- **Typing a text:** colour, font, font size and align keys change that text.

Pen keys change lines, arrows and text. Fill keys change only the inside of boxes, circles and diamonds. Each colour key shows a short popup with the colour. The status bar at the bottom right shows your pen and fill colour while a drawing is open.

### Repeat

`G` does your last change again, like `.` in vim. Make one box red, dashed and bold. Then select the next box and press `G`. All the changes you made to one thing count as one change. With nothing selected, `G` puts the change on your pen.

### Pen presets

A preset is a saved pen: colour, fill, fill style, line width, line style, font, size, align, arrowheads and opacity. **Save pen as preset N** saves the selected shape's style, or your pen if nothing is selected. **Use pen preset N** works like every other key: on the selection, on your pen, or on the text you type. Rename or delete presets in Settings → Pen presets.

The **preset bar** at the bottom of a drawing shows your presets. Click one to use it. Right-click one to save over it. `+` saves a new one. You can turn the bar off in Settings → Pen presets.

### Line up and spread

Select 2 or more shapes, press the leader key, then `L`. `A`, `D`, `W` and `S` line up the left, right, top or bottom edges. `C` and `X` centre them. With 3 or more shapes, `H` spreads them out evenly across and `V` spreads them down. A group, and a box with its label, move as one. Arrows tied to a shape follow it. Each one is also a command, so you can give it a key in Settings → Hotkeys.

### Leader key

Press the leader key (`` ` ``), then a short row of plain keys. A panel shows the choices at each step. Examples:

- `` ` C 3 ``: pen colour 3. `` ` F 0 ``: no fill.
- `` ` W 2 ``: bold line. `` ` S D ``: dashed. `` ` H X ``: cross-hatch fill.
- `` ` P 1 ``: use preset 1. `` ` P S 1 ``: save preset 1.
- `` ` V 3 ``: zoom preset 3. `` ` L A ``: line up left edges. `` ` ` `` or `` ` / ``: search.

Escape or a click cancels.

Change the menu letters in Settings → Leader menu. There you can also add your own sequences for any Obsidian command, like `` ` G G `` for one you use a lot. Settings tells you when a sequence replaces a built-in key.

### Move between shapes

`Shift+W/A/S/D` selects the nearest shape above, left, below or right. With nothing selected, it selects the shape nearest the middle of the screen. `Shift+F` follows an arrow out of the selected shape. `Shift+R` follows it back.

### Search

`Alt+Z` opens a search for styles and commands. It knows other words (circle, thicker, copy, see-through) and small typos. Type several styles at once, like `blu dashd thik`. The top result then sets all of them in one step.

### Diagonal move

Hold two arrow keys to move the selection on a diagonal. Hold Shift too for a bigger step. This one is not in the Hotkeys menu.

## Settings

The first page has 8 parts:

- **Keys**: use or reset the suggested keys, the key panel and its wait time, Shift goes back, show one-by-one commands, catch keys before Excalidraw, and where the hotkey note goes.
- **Drawing keys**: a key for each tool, for moving between shapes, repeat, and the leader key. Click a key and press any key or combo. The × button removes it.
- **Leader menu**: the letter for each menu, and your own sequences for any command.
- **Pen presets**: the preset bar, and rename or delete your presets.
- **Colours**: the 8 pen colours and 8 fill colours, and the status bar colours. Colour 1 is Excalidraw's own ink: white in dark mode, black in light mode. If you change a colour, its name follows the new colour. The square next to each colour shows how it looks in the drawing.
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
