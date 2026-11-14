# Excalidraw Hotkeys

An Obsidian plugin. It adds hotkeys for Excalidraw drawings.

Every action is an Obsidian command. Set the keys in **Settings → Hotkeys** (search "Excalidraw Hotkeys"). You can also map them from a vimrc with `obcommand excalidraw-hotkeys:<id>`.

## Commands and default keys

| Command | Default key |
|---|---|
| Fill colour 1–8 (text gets the stroke colour) | `Alt+1` … `Alt+8` |
| Stroke colour 1–8 (lines, arrows, text, box text) | `Alt+Shift+1` … `Alt+Shift+8` |
| Cycle fill style | `Alt+F` |
| Reset to black with no fill | `` Ctrl+` `` |
| Align text left / centre / right | `Ctrl+Shift+L` / `;` / `'` |
| Duplicate up / down / left / right with an arrow | `Ctrl+Arrow` |
| Grow / shrink width | `Shift+.` / `Shift+,` |
| Grow / shrink height | `Alt+.` / `Alt+,` |
| Grow / shrink size or line width | `Ctrl+Shift+.` / `Ctrl+Shift+,` |
| Fit box to text | `Ctrl+/` |

Hold two arrow keys to move the selection on a diagonal. Turn this on or off in the plugin settings.

The 8 colours, step sizes and gaps are set in the plugin settings.

Requires the Excalidraw plugin.

## Build

```
npm install
npm run build
```

Copy `main.js` and `manifest.json` to `<vault>/.obsidian/plugins/excalidraw-hotkeys/`.
