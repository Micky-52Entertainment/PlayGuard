# Synthesized sound effects and a music bed (no samples, no copyright): build/media/*.wav
import sys
from pathlib import Path
import numpy as np
import soundfile as sf

SR = 48000
out = Path(__file__).parent / "build/media"; out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(3)
T = lambda d: np.arange(int(SR * d)) / SR

def save(name, x, gain=0.8):
    x = x / (np.abs(x).max() + 1e-9) * gain
    sf.write(out / f"{name}.wav", np.stack([x, x], 1).astype(np.float32), SR)

def lowpass(x, a):  # one-pole
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc += a * (v - acc); y[i] = acc
    return y

t = T(0.5); env = np.sin(np.pi * t / 0.5) ** 2
save("whoosh", lowpass(rng.uniform(-1, 1, t.size), 0.08) * env, 0.6)
t = T(0.18); save("pop", np.sin(2*np.pi*(300 + 900*np.exp(-t*40))*t) * np.exp(-t*25))
t = T(0.9); save("ding", (np.sin(2*np.pi*1318*t) + 0.5*np.sin(2*np.pi*1976*t)) * np.exp(-t*5), 0.5)
t = T(0.06); save("click", rng.uniform(-1, 1, t.size) * np.exp(-t*120), 0.5)
t = T(0.6); save("stamp", (np.sin(2*np.pi*(60 + 120*np.exp(-t*25))*t) + 0.4*lowpass(rng.uniform(-1, 1, t.size), 0.2)) * np.exp(-t*8))
t = T(0.45); save("error", np.sign(np.sin(2*np.pi*140*t)) * 0.5 * np.exp(-t*4) * (np.sin(2*np.pi*12*t) > -0.3), 0.45)
t = T(0.35); n = np.sin(2*np.pi*880*t)*(t < .12) + np.sin(2*np.pi*660*t)*(t >= .15)
save("notify", n * np.exp(-(t % .15)*14), 0.5)
t = T(0.8); save("crack", lowpass(rng.uniform(-1, 1, t.size), 0.5) * np.exp(-t*9) * (rng.uniform(0, 1, t.size) > 0.6), 0.7)

# Music bed: C G Am F at 112 bpm, marimba, bass, soft drums; intro tension then the main groove.
total = float(sys.argv[1]) if len(sys.argv) > 1 else 140
BEAT = 60 / 112
N = int(SR * total); mix = np.zeros(N)
midi = lambda n: 440 * 2 ** ((n - 69) / 12)
def put(t0, x, g):
    i = int(t0 * SR); j = min(N, i + x.size)
    if i < N: mix[i:j] += x[: j - i] * g
prog = [(48, [60, 64, 67]), (43, [59, 62, 67]), (45, [60, 64, 69]), (41, [60, 65, 69])]
mel = [72, 76, 79, 76, 74, 71, 74, 79, 76, 72, 76, 81, 77, 76, 74, 72]
groove_from = float(sys.argv[2]) if len(sys.argv) > 2 else 32.0  # main groove starts with Micky
bar, t0 = 0, 0.0
while t0 < total:
    b, chord = prog[bar % 4]
    tb = T(4 * BEAT)
    for n in chord:
        put(t0, np.sin(2*np.pi*midi(n)*tb) * np.minimum(1, tb*3) * np.exp(-tb*0.3), 0.035)
    full = t0 >= groove_from
    for k in range(4):
        tk = t0 + k * BEAT; tt = T(BEAT * 0.95)
        f = midi(b if k % 2 == 0 else b + 12)
        put(tk, np.tanh(2*np.sin(2*np.pi*f*tt)) * np.exp(-tt*4), 0.13 if full else 0.06)
        if full:
            tt = T(0.35); put(tk, np.sin(2*np.pi*(50 + 90*np.exp(-tt*30))*tt) * np.exp(-tt*9), 0.45 if k % 2 == 0 else 0)
            tt = T(0.25); put(tk, (rng.uniform(-1, 1, tt.size)*0.7 + 0.3*np.sin(2*np.pi*190*tt)) * np.exp(-tt*18), 0.18 if k % 2 else 0)
            tt = T(0.08); put(tk + BEAT/2, rng.uniform(-1, 1, tt.size) * np.exp(-tt*60), 0.06)
    if full:
        for k in range(2):
            tt = T(0.6)
            for off, idx, g in ((0.5, (bar*2+k) % 16, 0.16), (1.5, (bar*2+k+5) % 16, 0.1)):
                f = midi(mel[idx])
                put(t0 + k*2*BEAT + off*BEAT, (np.sin(2*np.pi*f*tt) + 0.3*np.sin(2*np.pi*4*f*tt)*np.exp(-tt*30)) * np.exp(-tt*9), g)
    bar += 1; t0 += 4 * BEAT
fade = np.ones(N); fl = int(SR * 4); fade[-fl:] = np.linspace(1, 0, fl); fade[:int(SR*1.5)] = np.linspace(0, 1, int(SR*1.5))
save("music", mix * fade, 0.7)
