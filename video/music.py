# Music bed written to the timeline (no samples, no copyright): build/media/music.wav
# Tense intro until Micky appears, a riser into his entrance, the full groove after it,
# a crash on every scene change, a final chord on the logo, and the music ducked under the voice.
import json
from pathlib import Path
import numpy as np
import soundfile as sf

root = Path(__file__).parent
tl = json.loads((root / "build/timeline.json").read_text())
SR = 48000
BEAT = 60 / tl["bpm"]
total = tl["total"]
N = int(SR * total)
mix = np.zeros(N)
rng = np.random.default_rng(5)
T = lambda d: np.arange(int(SR * d)) / SR
midi = lambda n: 440 * 2 ** ((n - 69) / 12)
SC = {s["id"]: s for s in tl["scenes"]}
LINES = {l["id"]: l for s in tl["scenes"] for l in s["lines"]}

def put(t0, x, g):
    i = int(t0 * SR); j = min(N, i + x.size)
    if 0 <= i < N: mix[i:j] += x[: j - i] * g

def lowpass(x, a):  # a may be a number or one coefficient per sample
    a = np.broadcast_to(a, x.shape); y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc += a[i] * (v - acc); y[i] = acc
    return y

kick = lambda: (lambda t: np.sin(2*np.pi*(50 + 90*np.exp(-t*30))*t) * np.exp(-t*9))(T(0.35))
snare = lambda: (lambda t: (rng.uniform(-1, 1, t.size)*0.7 + 0.3*np.sin(2*np.pi*190*t)) * np.exp(-t*18))(T(0.25))
hat = lambda: (lambda t: rng.uniform(-1, 1, t.size) * np.exp(-t*60))(T(0.08))
crash = lambda: (lambda t: lowpass(rng.uniform(-1, 1, t.size), 0.6) * np.exp(-t*2.2))(T(2.0))
def marimba(f, d=0.6):
    t = T(d); return (np.sin(2*np.pi*f*t) + 0.3*np.sin(2*np.pi*4*f*t)*np.exp(-t*30)) * np.exp(-t*9)
def bass(f, d):
    t = T(d); return np.tanh(2*np.sin(2*np.pi*f*t)) * np.exp(-t*4)
def pad(notes, d, bright=1.0):
    t = T(d); x = sum(np.sin(2*np.pi*midi(n)*t) + 0.4*np.sin(2*np.pi*midi(n)*1.004*t) for n in notes)
    return x * np.minimum(1, t*2) * np.minimum(1, (d - t)*4) * bright

drop = SC["intro"]["start"]
logo = LINES["a5_02"]["start"]
PROG_DARK = [(45, [57, 60, 64]), (41, [57, 60, 65]), (48, [55, 60, 64]), (43, [55, 59, 62])]   # Am F C G
PROG = [(48, [60, 64, 67]), (43, [59, 62, 67]), (45, [60, 64, 69]), (41, [60, 65, 69])]        # C G Am F
MEL = [72, 76, 79, 76, 74, 71, 74, 79, 76, 72, 76, 81, 77, 76, 74, 72]

bar, t0 = 0, 0.0
while t0 < logo - 1e-6:
    full = t0 >= drop - 1e-6
    b, chord = (PROG if full else PROG_DARK)[bar % 4]
    put(t0, pad(chord, 4 * BEAT), 0.03 if full else 0.045)
    for k in range(4):
        tk = t0 + k * BEAT
        if full:
            put(tk, bass(midi(b if k % 2 == 0 else b + 12), BEAT * 0.95), 0.13)
            put(tk, kick(), 0.45 if k % 2 == 0 else 0.0)
            put(tk, snare(), 0.18 if k % 2 else 0.0)
            put(tk + BEAT / 2, hat(), 0.06); put(tk, hat(), 0.035)
        else:
            put(tk, bass(midi(b), BEAT * 0.9), 0.07 if k == 0 else 0.03)
            put(tk + BEAT / 2, hat(), 0.03)
    if full:
        for k in range(2):
            put(t0 + k*2*BEAT + 0.5*BEAT, marimba(midi(MEL[(bar*2+k) % 16])), 0.15)
            put(t0 + k*2*BEAT + 1.5*BEAT, marimba(midi(MEL[(bar*2+k+5) % 16])), 0.09)
    bar += 1; t0 += 4 * BEAT

# riser into Micky's entrance, then the drop
rd = 4 * BEAT; t = T(rd)
riser = lowpass(rng.uniform(-1, 1, t.size), 0.02 + 0.3 * (t / rd) ** 2) * (t / rd) ** 2
put(drop - rd, riser, 0.9)
put(drop, crash(), 0.25)
# a crash on every later scene change
for s in tl["scenes"]:
    if s["start"] > drop + 1: put(s["start"], crash(), 0.12)
# the logo: a final chord that rings out
put(logo, crash(), 0.3); put(logo, kick(), 0.6)
put(logo, pad([48, 60, 64, 67, 72], total - logo, 1.0), 0.06)
put(logo, bass(midi(36), 2.5), 0.2)
for i, n in enumerate([72, 76, 79, 84]): put(logo + i * BEAT / 2, marimba(midi(n), 1.2), 0.14)

# duck under the voice: -7 dB with a short attack and a slow release
duck = np.ones(N)
for l in LINES.values():
    a, b = int(l["start"] * SR), int((l["start"] + l["dur"]) * SR)
    duck[max(0, a - int(0.12*SR)):b] = 0.45
k = np.ones(int(0.25 * SR)); k /= k.size
duck = np.convolve(duck, k, mode="same")
fade = np.ones(N); fl = int(SR * 1.5); fade[-fl:] = np.linspace(1, 0, fl); fade[:int(SR*0.5)] = np.linspace(0, 1, int(SR*0.5))
out = mix * duck * fade
out = out / np.abs(out).max() * 0.8
sf.write(root / "build/media/music.wav", np.stack([out, out], 1).astype(np.float32), SR)
print("music", round(total, 2), "s")
