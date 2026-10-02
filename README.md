# Clipboard Translate Overlay

Desktop app for macOS and Ubuntu that shows Google Translate for whatever text
you copy, in a compact always-on-top window. Copy text anywhere, and the
overlay updates by itself. The app never reads the translation back and never
writes to the clipboard.

## Features

- Watches the system clipboard (default every 300 ms, configurable 200–1000 ms)
  and reacts only to **new text**. Values are normalized (outer whitespace
  trimmed, line endings unified) before comparison.
- Checks MIME types before reading any content: only `text/plain` is used;
  `text/html` is converted to plain text only when enabled in settings and
  `text/plain` is missing. Images, files/directories (`text/uri-list`,
  `x-special/gnome-copied-files`, `public.file-url`, …), audio/video, binary and
  custom types are ignored. The Linux selection clipboard is ignored.
- Debounce (200 ms) with a re-check, so only the latest value is translated.
- Translator window: 520×420 by default, minimum 360×240, resizable,
  always on top, never steals focus on automatic updates, remembers its
  position and size, closing hides it.
- Tray menu: show/hide window, pause/resume, target language, settings, quit.
  The tray icon shows the state: green (active), amber (loading),
  grey (paused), red (load error / offline).
- Global hotkey to toggle the window (default `Ctrl+Shift+Y` / `Cmd+Shift+Y`).
- Settings: target language, show window on new text, always on top, hotkey,
  launch at login, poll interval, maximum text length, `text/html` fallback.
- Errors: one automatic retry, then an error page; new text starts a new
  attempt. Text over the limit is skipped with a quiet notification.

## Privacy and security

- Copied text lives in memory only: it is never stored in settings, history or
  logs. The translator window uses an in-memory session (no disk cache,
  cookies or storage).
- Text that was already in the clipboard at startup, or copied while
  monitoring is paused, is not sent to Google.
- The Google Translate window runs with `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`, no preload and no IPC. All
  permission requests are denied. Navigation outside `translate.google.com`
  (and Google's consent page) is blocked; links open in the system browser.
- Only the settings window has a preload. It exposes three IPC calls
  (`load`, `save`, `close`), and the main process validates the sender and all
  values.

## Requirements

- Node.js 20+ and npm
- macOS, or Ubuntu with X11/XWayland. On Linux the app forces
  `--ozone-platform=x11` because always-on-top and window placement do not
  work reliably on native Wayland. Set `CTO_ALLOW_WAYLAND=1` to try native
  Wayland (experimental).
- On Ubuntu GNOME, the tray icon needs the AppIndicator extension, which
  Ubuntu ships enabled by default.

## Development

```bash
npm install
npm start          # run the app
npm test           # unit tests (node:test)
```

`CTO_USER_DATA=/some/dir npm start` runs with a separate settings directory.

### End-to-end check (Linux/X11)

`scripts/e2e-linux.sh` starts the real app and drives it with `xclip`/`xdotool`
(needs `xclip`, `xdotool`, `xprop`, `xwininfo` and `xmessage`). It checks: new
text is translated; repeated, image, file, HTML-only and custom-type clipboard
content is ignored; the length limit; focus is not stolen; always on top;
close hides the window; geometry survives restarts; nothing is written to
disk or logs; and the single retry on load errors.

```bash
./scripts/e2e-linux.sh
```

## Packaging

```bash
npm run dist:linux   # dist/*.deb and dist/*.AppImage
npm run dist:mac     # dist/*.dmg and dist/*.zip (run on macOS)
```

On macOS the app runs as an agent app (`LSUIElement`): it has a menu bar icon
and no Dock icon.

## Project layout

```text
src/core/     platform-independent logic (watcher, MIME filter, URL, settings schema)
src/main/     Electron main process (app lifecycle, tray, translator window, settings store)
src/settings/ settings window (sandboxed renderer + preload)
src/pages/    local error page for the translator window
test/         unit tests
scripts/      end-to-end check for Linux
```
