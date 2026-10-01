# Speaks one line with Kokoro and writes a WAV: tts.py <voice> <speed> <out.wav> <text>
import sys
from pathlib import Path
import soundfile as sf
from kokoro_onnx import Kokoro

here = Path(__file__).parent / "models"
voice, speed, out, text = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
kokoro = Kokoro(str(here / "kokoro-v1.0.int8.onnx"), str(here / "voices-v1.0.bin"))
samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
sf.write(out, samples, rate)
