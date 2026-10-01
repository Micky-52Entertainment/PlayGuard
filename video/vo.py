# Speaks every line of script.json in Micky's voice: build/vo/<id>.wav plus build/vo.json with durations.
import json, subprocess
from pathlib import Path
import soundfile as sf
from kokoro_onnx import Kokoro

root = Path(__file__).parent
script = json.loads((root / "script.json").read_text())
out = root / "build" / "vo"; out.mkdir(parents=True, exist_ok=True)
kokoro = Kokoro(str(root / "models/kokoro-v1.0.int8.onnx"), str(root / "models/voices-v1.0.bin"))
pitch = script["pitch"]
# raise the pitch, then stretch back so the pace stays natural
chain = (f"aresample=48000,asetrate=48000*{pitch},aresample=48000,atempo={1 / pitch * 1.04:.3f},"
         "highpass=f=90,acompressor=threshold=-18dB:ratio=3,loudnorm=I=-16:TP=-1.5")

info = []
for line in script["lines"]:
    raw = out / f"{line['id']}_raw.wav"
    samples, rate = kokoro.create(line["text"], voice=script["voice"], speed=script["speed"], lang="en-us")
    sf.write(raw, samples, rate)
    wav = out / f"{line['id']}.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-af", chain, str(wav)], check=True)
    raw.unlink()
    info.append({**line, "dur": round(sf.info(str(wav)).duration, 2)})
    print(line["id"], info[-1]["dur"])

(root / "build" / "vo.json").write_text(json.dumps(info, indent=1))
