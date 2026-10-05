# Playable Testing Lab

Lab for playable ads: one recorded gameplay on a phone, remapped onto many
screen sizes, then replayed with Playwright. Works with Luna Playworks,
Cocos Creator web-mobile, and clear JS / vanilla HTML5.

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
   trace on other viewports without the phone, runs the checks on every
   screen and writes an HTML report.

```
Phone (source)
    │  WebSocket: PointerSample { nx, ny, t, phase }
    ▼
Hub  ── fan-out ──► Lab Console screens (slave iframes, per-device size)
    │
    └── SessionTrace.json ──► Playwright Chromium (device matrix)
                                  └── checks ──► reports/<run>/index.html
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
| `playable-host` | Injected bridge (Luna / Cocos / vanilla) and the ad-SDK mock |
| `adapters` | Detect engine from HTML |
| `checks` | Ad-network profiles, file checks, replay checks |
| `plugin-sdk` | Future E2E, smoke, heatmap, perf, network |

## Run

```bash
npm start
```

One command builds the console, starts the hub, and opens the console in the
browser (`http://localhost:8787`). The hub serves the console itself, so
teammates on the same network open the address printed on start (also in
Settings → Team) and install nothing. A short guide for the team, in Russian,
is in [`КАК-НАЧАТЬ.md`](../КАК-НАЧАТЬ.md); the console has a Help section. On macOS `PlayGuard.command`, and on
Windows `PlayGuard.bat`, do the same on a double click. The first start
installs the dependencies. `npm run hub` and `npm run console` still start the
two parts separately, with the console reloading on every change, for work on
the lab itself; `HUB_PORT` and `CONSOLE_PORT` move them.

The console is a four-step wizard (**Check**):

1. **Upload** — drop one playable HTML, or a zip with the builds for several
   networks. "Checked before" lists every playable with its latest verdict and
   its earlier runs.
2. **Playthrough** — pick who plays it once: a phone through the QR (same
   Wi-Fi), the mouse in a phone-sized window on this computer, an AI tester, or
   nobody (a quick load-only check). While waiting for the phone the console
   shows whether it opened the page, and what to try when it does not connect.
3. **Checks** — the recording is replayed on every screen; the console shows
   how many screens are done and about how long is left.
4. **Result** — one verdict (ready / needs a look / not ready) with the report
   under it. **Download as one file** packs the report into a zip to send on.

**Builds** and **Reports** keep the full tables for whoever wants them
(the separate Recordings tab is turned off: the wizard keeps recordings by itself). **Settings** holds the language (Russian / English / French, also the
language of new reports' summary), the AI tester's API keys, and what is
installed on this computer, with one button to install the browser the checks
and the report videos need. Keys are written to `.playable-lab/settings.json`
(git-ignored, readable by the owner only), are passed to the runner and are
never sent back to the page; the settings and run endpoints answer only to this
computer.

Interface texts live in `apps/lab-console/src/i18n.tsx`; problems are explained
in plain words in `errors.tsx`, with the technical text folded under them.

## What a check covers beyond the replay

- **Sound.** Every screen measures what the playable sends to the speakers:
  it must be silent until the first touch, and go quiet when the ad is hidden
  (`sound-start`, `sound-hidden`). The runner's browser lets sound start
  without a touch, as an ad container does, so a playable cannot hide behind
  the browser's own block.
- **Safari's engine.** iPhone and iPad screens run in WebKit when it is
  installed; otherwise they run in Chromium and say so. Taps go through
  Playwright's touchscreen, drags are dispatched inside the page. The AI
  tester and the stress scenarios always use Chromium. `--no-webkit` turns it
  off.
- **Memory.** The idle scenario measures script memory before and after the
  wait; steady growth while nothing happens is reported. Settings can stretch
  the wait to 2 or 5 minutes.
- **Stress scenarios** (`--stress`, on by default from the console), each on
  one phone screen: `idle` (left without a touch: no crash, no blank screen,
  no store opened by itself), `monkey` (40 seeded random taps and swipes),
  `rotate` (turned on its side and back: the picture must still fit the
  screen). `--stress idle,rotate` picks some, `--idle <ms>` sets the wait.
- **Download time.** The file size as seconds on slow 3G and on 4G.
- **What the file is made of.** Images, sound, code and packed data as shares
  of the file, with the heaviest items listed: the first thing to read when a
  network rejects the size. Assets are recognised whether they are embedded as
  base64 or in the denser base122 that Luna exports use.
- **Restricted browser features.** Every screen counts calls to what an ad
  may not use: asking for the location, the camera or notifications, and
  browser dialogs fail the check; vibration, the clipboard, the share sheet
  and writes to browser storage (localStorage, sessionStorage, IndexedDB,
  cookies) are warnings, since only some networks forbid them. Nothing is
  blocked: the playable runs as it would, the calls are only counted.
- **Install link.** With the app's store links entered at step 2 of the wizard
  (or `--store-ios`, `--store-android`), every screen checks that the install
  button opens the store of that device and the right app, and the file is
  searched for links to another app. Without them the link is only shown. A
  network call that carries no address, or a tracking link, cannot be compared
  and says so.

Settings → "Depth of the checks" turns the stress scenarios and the Safari
engine on and off for every check the console starts.

**For the manager** (the result of a check, and Reports) downloads one
self-contained HTML file: the verdict, the video of the playthrough embedded
in the page, the numbers, and the answers in plain words.

**Pack for the client** (the result of a check, Reports, Builds) is a ZIP
with a page that opens offline: the video of the playthrough per orientation
(converted to MP4 when ffmpeg is on the computer, otherwise WebM), the last
frame of every screen as a JPEG, the ad networks with their status, and what
was checked. For an archive of builds it adds each network's frame and the
release summary.

**Release summary** (Builds, and the result of an archive in the wizard) is
one printable page for a creative: every network's build against every
question, the remarks in plain words, and lines for signatures. It is built
from the reports in the language of the console; print it or save it as PDF.

When something has to be downloaded (the browser for the checks, the video
recorder, WebKit), the console says what and how much and asks once, before
any check; the download starts only after the answer and shows its progress.

## Team use

- **Access.** Everything a teammate does — uploads, checks, AI runs, the app
  links at step 2 — works from their browser. AI keys, the depth of the checks,
  installing components, the iPhone simulator and deleting history are done on
  the computer that runs the lab; requests from other sites are refused.
- **Names.** The console asks each person for a name once; it goes with every
  recording, check and archive and is shown in the history.
- **Uploads.** One HTML, a ZIP, several files at once or a folder (picked or
  dropped). Anything but a single file is packed into one archive in the
  browser, and the hub finds the builds in it. RAR and 7z are refused with a
  plain explanation.
- **Handing over.** Above every report: to a manager (one page), to a client
  (ZIP), to a developer (the full report).
- **What to check.** Settings → What to check turns kinds of device
  (Android phones, iPhones, tablets, foldables), orientations and ad networks
  on and off for every check. Screens of a platform turned off are left out
  (`--platforms`), an orientation turned off is skipped in checks without a
  recording, and an archive's builds for a network turned off are marked
  "skipped" instead of tested.
- **History.** Settings → Storage shows what the history takes and deletes
  checks older than 30 days, or everything; a single report, archive or
  recording is deleted in its own section, after a confirmation. Running checks
  are never deleted.

## AI autoplay

In the console: step 2 of the wizard, "AI plays it". It shows the tokens spent
while it runs. From a terminal:

```bash
export ANTHROPIC_API_KEY=...        # or OPENAI_API_KEY for --ai gpt
npm run autoplay -- --playable path/to/playable.html --network applovin
npm run autoplay -- --playable path/to/playable.html --ai gpt --model gpt-5-mini --lang ru
npm run autoplay -- --playable path/to/playable.html --ai monkey   # random taps: no model, no tokens
```

An AI tester plays the playable to the install button, in portrait and then
in landscape, and reports what it sees: cut-off or overlapping UI, stretched
art, a game that does not react or cannot be finished, a missing install
button. It plays in a visible browser window, with a pink marker on every
touch, and prints each turn to the terminal. The video and the turn list are
in the report.

Tokens are kept low by design:

- One small screenshot per turn (JPEG, 640 px on the long side) and a few
  lines of text. Earlier screenshots are never resent; earlier turns are one
  line each.
- The model answers with up to five inputs at a time (`tap 50 80`,
  `drag 20 50 80 50`, `hold`, `wait`), so a playthrough is about ten calls,
  not one per tap. It stops as soon as the store opens, after
  `--max-turns` (14), or after three turns that changed nothing.
- The AI plays on one screen per orientation (`--ai-devices`, default
  Pixel 7). Its inputs are saved as a trace (`reports/<run>/ai-*.trace.json`)
  and replayed on the rest of the format set without the model. Each
  replayed screen then gets one call: the first and last frame, "does the
  layout hold here?" (`--no-review` to skip).
- `--budget` (80 000 tokens) caps the whole run; the terminal and the
  report show what was used. Low effort is requested from the model.

A default run is about 40 calls. `--ai-devices pixel-7,ipad-10` makes the
AI play a phone and a tablet itself; `all` plays every screen and costs the
most. Replayed taps are approximate on screens of another shape, so a
missed install button there is a warning, not a failure.

## Testing every network's build at once

Open **Builds** in the console and drop a zip. It can hold bare HTML files,
zipped builds and folders with an `index.html` and its assets, in any folder
structure. Every build is matched to its network (from its path, else from
the install API it calls), checked as a file, and loaded on every screen
shape in both orientations. The table answers "which networks work": one row
per build, one column per question (size, packaging, loads, JS errors,
renders, requests, CTA).

A load-only run cannot press the CTA. To cover it, press **Play it** on one
build and play it once — on the phone through the QR, or on this computer
with **Or play on this computer** — then **Replay on all builds**. The same
recording is replayed on every build of the archive, and the CTA is judged
against each network's own API.

Uploads are kept under `batches/`.

## Replay, checks, report

```bash
npm run replay -- --trace traces/<sessionId>.json --network applovin
npm run check  -- --playable path/to/playable.html --network unity
npx playwright install chromium ffmpeg   # once; without it Google Chrome is used and video is off
```

`replay` runs the trace on the screens that were mirrored while recording
(`--devices a,b` or `--devices all` to override). `check` needs no trace: it
only loads the playable, in both orientations, on the format set.

The **format set** is the default in the console too: one screen per shape
— 21:9, 20:9 and 16:9 phones, a 16:10 and a 4:3 tablet, a 6:5 unfolded
foldable — instead of four near-identical phones. Neither
needs the hub. `npm run replay -- --help` lists every option.

Each run writes `reports/<run>/index.html` (screens × checks matrix,
screenshots after taps, video, console, requests, ad API calls) and
`report.json`. The exit code is 1 when any check fails.

The report opens with a plain-language summary for people who do not read
check names: one verdict (ready / works but needs a look / not ready), one
line per orientation, then questions with answers — "Does the install button
open the store?", "Does it work without the internet?" — grouped into needs
fixing, worth checking, not tested and fine, each with the screens it is
about. `--lang ru` writes it in Russian, `--lang fr` in French (`PLAYABLE_LAB_LANG`
sets the default). The same summary is printed at the end of the run and saved as
`summary` in `report.json`.

Checks on every screen:

| Check | Fails when |
| --- | --- |
| Loads | `load` never fires |
| No JavaScript errors | an exception is uncaught (`console.error` only warns) |
| Renders something | the final frame is one flat colour |
| Reacts to input | warns when the frame is the same before and after the input |
| No network requests | the playable asks for a file outside the HTML, or another host on a network that forbids it. Such requests get an empty local answer unless `--allow-external` |
| CTA opens the store | the store call uses an API the network does not provide, fires before any input, or is missing with `--require-cta` / a recording that had one |
| AI tester | autoplay only: fails on an issue that stops the player, warns on a clearly broken layout or a game the AI could not finish |
| Lifecycle calls | Mintegral: `gameReady` never called |

File checks (also shown in the console): size against the network limit,
external and separate local files, the CTA call and required tags in source.

### Ad networks

`packages/checks/src/networks.ts` holds one profile per network. AppLovin,
Unity Ads, Meta, Mintegral, Google Ads and TikTok / Pangle are described from
the networks' own specs. ironSource, Vungle, Liftoff, Moloco, AdColony, Aarki,
Appreciate, Snapchat, InMobi, Chartboost, Tapjoy, myTarget, Bigo, Kwai,
Smadex, Adikteev, BigaBid, Kayzen, Remerge, Tencent and YouAppi come from
exporter documentation: format and size limit, and an install call only
where one is documented. Limits change over time; re-check before relying on
a verdict.

A build for a network with no profile is shown under the name its file
carries and gets the general checks. Requests to the build tool's own
analytics (`collector.lunalabs.io`) are listed but not counted against the
build.

The injected mock stands in for what networks add at serve time: `mraid`,
`FbPlayableAd`, `window.install` / `gameReady` / `gameEnd`, `ExitApi`,
`playableSDK`, `parent.postMessage('download')` and `window.open`. Calls are
recorded as `adEvents` in the trace instead of leaving the page.

## Interrupted checks

The runner writes `run.json` (`argv`, `startedAt`, `name`, planned `total`)
into the report folder as soon as it starts, prints `@@dir <folder>`, and
saves each finished screen's result as `<screen>/result.json`. A folder with
`run.json` but no `report.json`, that no runner of this hub is writing, is an
interrupted check (`GET /api/interrupted`). `--resume <folder>` (added to the
saved `argv`) loads the saved screens, deletes what a screen left half done,
checks the rest and writes the report into the same folder; language runs are
compared again with the saved ones. `POST /api/interrupted/:dir/resume`
starts that as a run (`/api/runs/:id`); `DELETE /api/interrupted/:dir`
(this computer only) drops it. An archive's builds remember their folder
(`runDir`), and `POST /api/batches/:id/resume` continues only the
interrupted ones. AI checks are not continued: they start again.

## Desktop app

`apps/desktop` packs the same hub and console into an installed app (Electron):
a `.dmg` per Mac chip and an NSIS installer for Windows. It is not a
workspace: it has its own `package.json` and lock, so `npm ci` at the root
does not download Electron.

```bash
cd apps/desktop
npm install
npm start        # bundle and open the app from stage/ (uses Playwright's usual browser cache)
npm run dist     # bundle, download the browsers, build the installer into release/
```

- `scripts/bundle.mjs` builds `stage/`, the folder that becomes the app: the
  hub and the runner bundled by esbuild into `out/hub.mjs` and
  `out/runner.mjs` (Playwright stays a real package in `node_modules`), the
  built console, and the files the hub reads, at their repo paths.
- `scripts/fetch-browsers.mjs` downloads Chromium, WebKit and ffmpeg into
  `browsers/`, shipped as `Resources/browsers`. They are per platform and
  chip, so each installer is built on its own kind of machine.
- `src/main.ts` starts the hub in a utility process and loads
  `http://localhost:8787/` in the window (the hub's local-only endpoints check
  for a localhost origin). Closing the window hides it; the hub keeps serving
  phones and teammates until Quit in the tray / menu bar, which stops the hub
  and the runners it started. A second launch focuses the window; if another
  hub already answers on the port, the app asks to close it.
- `src/updater.ts`: electron-updater against GitHub Releases. Windows
  downloads and installs on quit; the unsigned Mac app only announces the
  version and opens the release page (macOS installs updates into signed apps
  only).

The hub and runner learn they are inside the app from these variables (unset
in a checkout, where nothing changes):

| Variable | Meaning |
| --- | --- |
| `PLAYGUARD_DESKTOP=1` | `/api/meta` reports `desktop: true`; the console hides the browser install and the service worker |
| `PLAYGUARD_ROOT` | Where the console build, the favicon and `samples/` are (instead of the repo root) |
| `PLAYGUARD_DATA` | The user's data folder (`userData`) |
| `PLAYGUARD_RUNNER_JS`, `PLAYGUARD_NODE` | Run the built runner, and Playwright's installer, on the app binary with `ELECTRON_RUN_AS_NODE=1` instead of `tsx` |
| `PLAYWRIGHT_BROWSERS_PATH` | The browsers inside the app |
| `PLAYGUARD_SMOKE=1` | Start, check `/api/meta` and `/api/health`, print them and exit 0 / 1 (used by CI) |

**Release:** set `version` in `apps/desktop/package.json`, then push the tag
`v<version>`. `.github/workflows/release.yml` builds and smoke-tests the app
on macOS (arm64 and Intel) and Windows and uploads the installers into a draft
release; publishing the draft makes installed apps see the update. Signing is
off (`mac.identity: null`); to turn it on, add the certificate secrets
listed in `electron-builder.yml`.

## Development

```bash
npm test
npm run typecheck
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

## Live sync

When the phone starts loading the playable, every mirror starts loading
with it, so the game clocks stay close. Input is mirrored at once; a mirror
that is a few frames behind the phone's game time waits those frames (120 ms
at most) to land on the same moment. Every instance gets the same
`Math.random` seed, stored in the trace and reused by the replay. Mirrors
are muted: only the phone plays sound.

The phone page opens with a **Tap to start** button: the tap takes the page
fullscreen (browser bars would make it shorter than a real placement) and
locks the orientation, and only then loads the playable. In a browser that
cannot go fullscreen (iPhone Safari) the page keeps its shorter shape.

### Touches on other shapes

A touch is "on the launcher" or "on that bubble", not "at 50% / 80% of the
screen": another shape puts those things elsewhere. Where the engine's scene
is reachable the bridge records a **scene anchor** with every sample and
each screen (mirror or replay) resolves it in its own layout:

| Engine | Found through | A touch becomes |
| --- | --- | --- |
| PixiJS | `window.__PIXI_APP__` | a point in the local space of the object group under the finger |
| Unity / Luna | `window.UnityEngine` | the world point on the gameplay plane, or a point inside the UI control it hit |

Anything else falls back to the fraction of the screen, and the console says
so under the mirror ("taps approximate").

**In the replay** (`apps/playwright-runner/src/locate.ts`), the recording phone
itself is the first screen: **Your phone**, at the exact CSS size, pixel
ratio and engine (WebKit for an iPhone) the trace was recorded with. Its touches
land where the player's did. Just before each finger lands it keeps a picture of
the screen. Every other screen takes a picture at the same moment of its own
playthrough and places the finger, in this order:

1. the **scene anchor**, when the engine is reachable (exact on any shape);
2. the **picture**: the neighbourhood of the touch on the recording phone is
   looked for on this screen at every size the game could be drawn at
   (normalised cross-correlation, coarse then fine). The spot found is the
   touch, and the size found is the game's scale on this screen;
3. the **layout**: the scale and offset fitted (least squares) to the touches
   found so far, else the fit of the first picture (stretch, fit width or fit
   height);
4. the fraction of the game area.

After landing, a finger travels the distance it travelled on the phone, times
that scale. Each screen's report notes which method placed its touches
(`touches placed by: picture 12, layout (fit-height) 1`). `--no-own-phone`
turns the reference screen off (and with it the picture and layout steps).

The console adds a **phone replica** mirror with the phone's exact viewport:
that one is a true copy. Other screens receive the same normalised gesture,
but a playable that lays itself out differently per aspect ratio can read it
differently (a drag that starts above the launcher on the phone may start on
it on a shorter screen). The console marks such mirrors "other shape · taps
approximate". Record each chain step on a phone of that group, fullscreen,
and the mirrors of the same shape follow exactly.

## Phone FPS

The phone reports its frame rate once a second from page start to the end of
the session. The console charts it live over three zones (green 50+, yellow
30–50, red under 30) with the average, minimum and share of time per zone.
The samples are saved in the trace (`perf`) and the replay report repeats
the chart and adds a frame-rate check.

## Timing

Every sample carries `rt`: milliseconds since the playable's `load` event on
the phone. Replay dispatches at the same offset from its own `load`, with
real touch events (multi-touch included). Traces without `rt` are timed from
their first event, `--lead-in` ms after load.

## Orientation rule

A session has `orientationLock: portrait | landscape`. Resize / rotate that
breaks the lock aborts with `ORIENTATION_CHANGED` and a replay reason.
To cover both orientations, use two chain steps.

## Future plugins

See [`plugins/README.md`](../plugins/README.md). They subscribe to traces; they do not own input.
