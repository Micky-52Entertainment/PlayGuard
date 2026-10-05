# Changelog

## 1.1.0 — 5 October 2026

- PlayGuard as an installed app for macOS and Windows (`apps/desktop`): an installer with the browsers inside, no Node.js needed, a window of its own, keeps working for the team from the menu bar / tray, updates from GitHub Releases. Built by `.github/workflows/release.yml` on a `v*` tag.
- No playable sound from the computer during checks: WebKit (iPhone and iPad screens) is silenced inside the page after the sound is measured, as Chromium already was; a playthrough with the mouse and media started by the `autoplay` attribute are muted too. The phone keeps its sound.
- An interrupted check can be continued: when PlayGuard, the computer or the browser goes down mid-check, the screens already done are kept, and "Continue the check" (on the check step and under "Interrupted checks" on the first step) checks only the rest, into the same report. An archive finishes only its unfinished builds. Checks the AI played start again.
- Micky no longer stays a broken picture when one load of his image fails: it is tried again and hidden meanwhile.
- Replays follow the phone more closely:
  - Drags recorded on Pixi games and Unity UI now move in the replay. Before, each step of a drag was placed on the dragged object itself, so the object never moved.
  - Taps on Luna (Unity) builds whose camera has no `ScreenPointToRay` are tied to the game world again, so they land on the same spot on screens of another shape. Before, no position in the scene was recorded at all.
  - Invisible full-screen layers (Luna's flash effect) are no longer taken for the object that was tapped.
  - A gesture that starts late (after a screenshot or on a slow page) keeps its own speed instead of being sent all at once.
  - **Your phone** is replayed first, at the recording phone's exact size, pixel ratio and engine. Every other screen finds each touch in the picture that phone showed at that moment, at the scale the game is drawn at on that screen, so taps and drags land on the same objects on tablets and screens of other shapes. When the picture does not tell, the scale and offset measured from the other touches are used. The report says how each screen's touches were placed. `--no-own-phone` turns it off.
- The Mac app is signed ad hoc and no longer carries files that break its signature, so a downloaded copy opens with "Open Anyway" instead of being called damaged by macOS.
- Installing is documented for everyone: a download block at the top of the README, `docs/INSTALL.md` with requirements, first start, updates, removing and troubleshooting (the same in Russian in КАК-НАЧАТЬ.md), and `docs/RELEASING.md` for making a release. Every release page now says which file to download and how to open it the first time.
- The hub and runner can run outside the project folder (`PLAYGUARD_ROOT`, `PLAYGUARD_RUNNER_JS`); the share tunnel tool now lives in the data folder; ffmpeg lookup works on Windows.

- README explaining what PlayGuard does, with screenshots; the technical description moved to `docs/TECHNICAL.md`.
- Demo playable and an archive of builds for three networks in `samples/demo/`.
- GitHub templates for bug reports, ideas and pull requests.
- GitHub check that runs the typecheck and the tests on every change.

## 1.0 — 1 October 2026

First version for the team, under the name PlayGuard.

- A check in four steps: upload, playthrough (phone, mouse, AI or none), checks on every screen, verdict "Ready / Needs a look / Not ready".
- Rules of 27 ad networks: size, install button, internet requests, required calls.
- Checks for sound, memory, frame rate, text, translations and restricted browser features; idle, random-tap and rotate scenarios.
- iPhone and iPad screens on Safari's engine.
- Every network's build checked from one archive.
- AI tester on Claude or GPT, with low token spend.
- Results for a manager, a client and a developer; a printable release summary.
- The whole team works from one computer, with nothing to install for teammates.
- Interface and reports in Russian, English and French.
