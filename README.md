# Playable Testing Lab

Lab for playable ads: one recorded gameplay on a phone, remapped onto many
screen sizes, then replayed with Playwright. Works with Luna Playworks,
Cocos Creator web-mobile, and clear JS / vanilla HTML5.

Previous Audit Pro iframes live in `legacy/audit-pro/`.

## How a session runs

1. Operator picks a **test chain step**. Each step is one group and **one**
   orientation: Android portrait, then Android landscape, then iOS, then
   tablets. Portrait and landscape never share a session.
2. Lab Console starts a session. The Hub prints a QR (Unity Ad Tester style).
3. Phone scans the QR (Camera / the Expo app). The playable opens full-screen.
4. Pointer events leave the phone as **normalized** `nx, ny` (0..1 of the
   playable content rect). The Hub fans them to every selected PC viewport.
   Each iframe has that device's CSS size, so the same tap lands on a
   different pixel on iPhone SE and iPad Pro.
5. If the phone rotates, or portrait and landscape both appear in one
   session, the Hub **aborts** and tells you to replay that step.
6. End session writes `traces/<sessionId>.json`. Playwright replays the
   trace on other viewports without the phone.

```
Phone (source)
    │  WebSocket: PointerSample { nx, ny, t, phase }
    ▼
Hub  ── fan-out ──► Lab Console screens (slave iframes, per-device size)
    │
    └── SessionTrace.json ──► Playwright Chromium (device matrix)
```

## Packages

| Package | Role |
| --- | --- |
| `protocol` | Shared types: events, traces, QR payload, chain |
| `input-mapper` | `nx,ny` → CSS pixels per viewport / letterbox |
| `orientation-guard` | Abort if orientation changes mid-session |
| `device-catalog` | Android / iOS / tablet CSS sizes |
| `test-chain` | Default Android → iOS → tablets sequence |
| `recorder` | Append-only trace writer |
| `playable-host` | Injected bridge (Luna / Cocos / vanilla) |
| `adapters` | Detect engine from HTML |
| `plugin-sdk` | Future E2E, smoke, heatmap, perf, network |

## Run

Phone and PC must be on the same Wi-Fi. The QR uses the PC LAN address.

```bash
npm install
npm run hub
npm run console
```

Console: `http://127.0.0.1:5173`

1. Upload a playable HTML (or keep Sample Tap Target).
2. Select a chain step (orientation is locked by the step).
3. Start session, scan QR on the phone, play.
4. Save trace.

Replay:

```bash
npm run replay -- --trace traces/<sessionId>.json --devices pixel-7,iphone-14,ipad-pro-11
npx playwright install chromium   # once
```

Native scanner (optional): `cd apps/mobile && npx expo start`.
Without it, the phone Camera app opening the QR URL is enough.

## Engines

The host iframe does not patch game code. It injects a capture/replay
bridge and serves the build same-origin (upload) or with `<base href>`
for a remote Luna URL later.

| Engine | What to drop on the console |
| --- | --- |
| Luna Playworks | Exported HTML (or later a preview URL) |
| Cocos Creator | `web-mobile` `index.html` |
| Clear JS | Any `index.html` |

## Orientation rule

A session has `orientationLock: portrait | landscape`. Resize / rotate that
breaks the lock aborts with `ORIENTATION_CHANGED` and a replay reason.
To cover both orientations, use two chain steps.

## Future plugins

See `plugins/README.md`. They subscribe to traces; they do not own input.
