# PlayGuard

Checks playable ads: one playthrough (phone, mouse or AI) is replayed on many screen sizes in real browsers, checked against ad-network rules, and turned into a report with a verdict. npm workspaces, TypeScript, Node 22 (`.nvmrc`). Package names are `@playable-lab/*`.

## Where things are

- `apps/hub` — Express server on :8787. Uploads, QR/phone session, fans phone touches out to every screen, history, sharing. Entry `src/index.ts`.
- `apps/lab-console` — React + Vite UI (the wizard, reports, settings). Served by the hub after build; dev on :5173.
- `apps/playwright-runner` — replays a trace on every device, runs checks, AI tester (`ai.ts`, `pilot.ts`), stress, writes the report (`report.ts`, `summary.ts`). Entry `src/index.ts`.
- `apps/desktop` — Electron app: bundles hub + console + browsers into installers. Not in the root workspaces; has its own `package-lock.json`.
- `apps/mobile` — optional Expo scanner app, rarely touched.
- `packages/*` — shared code: `checks` (network rules, static/runtime/perf checks), `device-catalog`, `input-mapper`, `playable-host` (script injected into the playable), `protocol` (shared types), `recorder`, `orientation-guard`, `test-chain`, `zip`, `adapters`, `plugin-sdk`.
- `samples/` — demo playable and builds; `samples/playable/index.html` is the built-in sample the hub and runner load.
- `docs/` — `INSTALL.md` (users), `TECHNICAL.md` (internals, every check), `RELEASING.md`.
- Runtime data, not in git, never read: `reports/`, `traces/`, `batches/`, `playables/`, `.playable-lab/`. The hub finds them via `PLAYGUARD_DATA` (default: repo root).

## Commands

- `npm start` — hub + console, opens the browser.
- `npm test` — node test runner via tsx over `packages/*/src/*.test.ts` and `apps/*/src/*.test.ts`.
- `npm run typecheck` — must pass; CI (`.github/workflows/check.yml`) runs typecheck + test.
- `npm run test:site` — builds the console and runs `tests/site.e2e.ts`; run when the UI changes.
- Desktop: `npm run typecheck --prefix apps/desktop`, `npm start --prefix apps/desktop`.

## Rules

- UI text lives in `apps/lab-console/src/i18n.tsx` (~2400 lines: `en` from line ~11, `ru` ~774, `fr` ~1535). Every new key must exist in all three. Don't read the whole file: grep for the key and read around it.
- Report text is English in the runner and translated in `apps/playwright-runner/src/report-i18n.ts` (regex → ru, fr). A changed English message needs its pattern updated there.
- Big files — read by range, not whole: `playwright-runner/src/index.ts` (~2500), `lab-console/src/HomeView.tsx`, `RecordView.tsx`, `hub/src/index.ts`.
- User-visible changes go under `## Unreleased` in `CHANGELOG.md`, in plain words for non-developers.
- Docs and commit messages are in English; `КАК-НАЧАТЬ.md` is the Russian install guide and must stay at the repo root (release notes link to it).
- Write in the style of the surrounding code: small functions, few comments, no new dependencies without a reason.
