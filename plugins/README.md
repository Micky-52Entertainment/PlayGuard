# Plugin slots

These directories are reserved. The hub already calls `LabPlugin`
hooks from `@playable-lab/plugin-sdk` when you register an implementation.

| Slot | Purpose |
| --- | --- |
| `e2e/` | Scripted journeys beyond a recorded tap trace |
| `smoke/` | Load, CTA, no-white-screen checks |
| `heatmap/` | Aggregate `nx,ny` samples onto device frames |
| `performance/` | FPS, long tasks, memory while replaying |
| `network/` | Offline / 3G / blocked CDN while replaying |

Do not put live/record logic here. Plugins observe traces; they do not own input.
