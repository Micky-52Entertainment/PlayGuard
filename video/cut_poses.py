# Cuts 4x4 transparent sprite sheets into separate PNGs trimmed to the character.
# cut_poses.py <out_dir> <sheet>...
import sys
from pathlib import Path
import numpy as np
from PIL import Image

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for s, sheet in enumerate(sys.argv[2:], 1):
    img = Image.open(sheet).convert("RGBA")
    w, h = img.size
    for r in range(4):
        for c in range(4):
            cell = img.crop((c*w//4, r*h//4, (c+1)*w//4, (r+1)*h//4))
            # rows/columns with only a few opaque pixels are crumbs of the next pose
            a = np.asarray(cell.getchannel("A")) > 24
            def span(counts):
                # the longest run of filled lines; crumbs are cut off by a gap
                idx = np.where(counts > max(6, counts.max() * 0.12))[0]
                if not len(idx): return None
                runs = np.split(idx, np.where(np.diff(idx) > 3)[0] + 1)
                r = max(runs, key=len)
                return r[0], r[-1] + 1
            cs, rs = span(a.sum(0)), span(a.sum(1))
            box = (cs[0], rs[0], cs[1], rs[1]) if cs and rs else None
            if box:
                cell = cell.crop((max(box[0]-4, 0), max(box[1]-4, 0), min(box[2]+4, cell.width), min(box[3]+4, cell.height)))
            cell.save(out / f"s{s}_{r}{c}.png")
