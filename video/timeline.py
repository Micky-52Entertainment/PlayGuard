# Lays the voice lines out in time: build/timeline.json with scene and line start times.
import json, math
from pathlib import Path

root = Path(__file__).parent
vo = {l["id"]: l for l in json.loads((root / "build/vo.json").read_text())}

# scene id, lines, pause before the first line, pause between lines, pause after the last line
SCENES = [
    ("hook",    ["a1_01", "a1_02"],                            1.5, 1.2, 1.6),
    ("grid",    ["a1_03", "a1_04", "a1_05", "a1_06"],          0.6, 1.1, 0.8),
    ("numbers", ["a1_07", "a1_08", "a1_09", "a1_10"],          0.4, 0.6, 1.2),
    ("pain",    ["a1_11", "a1_12"],                            0.4, 0.7, 0.8),
    ("intro",   ["a1_13"],                                     1.6, 0.0, 1.9),
    ("magic",   ["a2_01", "a2_02", "a2_03", "a2_04", "a2_05"], 0.5, 1.1, 1.0),
    ("upload",  ["a3_01", "a3_02", "a3_03", "a3_04", "a3_04b"], 0.6, 0.9, 1.2),
    ("play",    ["a3_05", "a3_06", "a3_07"],                   0.5, 1.2, 1.0),
    ("checks",  ["a3_08", "a3_09", "a3_10", "a3_11"],          0.5, 1.1, 1.0),
    ("result",  ["a3_12", "a3_13", "a3_14", "a3_15"],          0.5, 1.1, 1.2),
    ("team",    ["a4_01", "a4_02", "a4_03", "a4_04"],          0.5, 1.0, 1.2),
    ("finale",  ["a5_01", "a5_02", "a5_03"],                   0.6, 1.4, 3.2),
]

# The music runs at 112 bpm: scenes start on a beat and lines on a half beat, so the
# hits keyed to them (pops, stamps, cuts) land on the music.
BEAT = 60 / 112
snap = lambda x, grid: math.ceil(x / grid - 1e-6) * grid

t, scenes = 0.0, []
for sid, ids, lead, gap, tail in SCENES:
    t = snap(t, BEAT)
    start = t
    t += lead
    lines = []
    for i, lid in enumerate(ids):
        if i: t += gap
        t = snap(t, BEAT / 2)
        lines.append({"id": lid, "text": vo[lid]["text"], "start": round(t, 3), "dur": vo[lid]["dur"]})
        t += vo[lid]["dur"]
    t += tail
    scenes.append({"id": sid, "start": round(start, 3), "end": round(t, 2), "lines": lines})

out = {"fps": 30, "bpm": 112, "total": round(snap(t, BEAT * 4), 3), "scenes": scenes}
(root / "build/timeline.json").write_text(json.dumps(out, indent=1))
for s in scenes: print(f"{s['id']:8} {s['start']:6.1f} -> {s['end']:6.1f}")
print("total", out["total"])
