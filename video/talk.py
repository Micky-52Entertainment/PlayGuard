# How loud Micky is talking, 15 times a second over the whole video: build/talk.json
# (After Effects bounces Micky with it).
import json
from pathlib import Path
import numpy as np
import soundfile as sf

root = Path(__file__).parent
tl = json.loads((root / "build/timeline.json").read_text())
RATE = 15
n = int(tl["total"] * RATE) + 1
level = np.zeros(n)
for s in tl["scenes"]:
    for l in s["lines"]:
        x, sr = sf.read(root / f"build/vo/{l['id']}.wav")
        if x.ndim > 1: x = x.mean(1)
        hop = sr // RATE
        for k in range(len(x) // hop):
            i = int(l["start"] * RATE) + k
            if i < n: level[i] = max(level[i], np.sqrt(np.mean(x[k*hop:(k+1)*hop] ** 2)))
level = np.clip(level / (np.percentile(level[level > 0], 95) + 1e-9), 0, 1)
(root / "build/talk.json").write_text(json.dumps({"rate": RATE, "v": [round(float(v), 2) for v in level]}))
print("talk keys", n)
