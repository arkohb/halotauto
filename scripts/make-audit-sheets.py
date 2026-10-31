#!/usr/bin/env python3
"""Segment tall audit screenshots into contact sheets for visual inspection."""
from PIL import Image
import os, sys

SRC = "/home/z/my-project/scripts/audit-shots"
OUT = "/home/z/my-project/scripts/audit-shots/sheets"
os.makedirs(OUT, exist_ok=True)

def sheet(files, out, seg_h=2200, cell_w=450, cols=3, top_only=None):
    cells = []
    for f in files:
        p = os.path.join(SRC, f)
        im = Image.open(p)
        if top_only:  # only inspect the top N px of very long pages
            im = im.crop((0, 0, im.width, min(im.height, top_only)))
        n_seg = max(1, (im.height + seg_h - 1) // seg_h)
        for i in range(n_seg):
            seg = im.crop((0, i * seg_h, im.width, min((i + 1) * seg_h, im.height)))
            scale = cell_w / seg.width
            seg = seg.resize((cell_w, max(1, int(seg.height * scale))), Image.LANCZOS)
            cells.append((f, i, seg))
    rows = (len(cells) + cols - 1) // cols
    cell_h = max(c[2].height for c in cells)
    sheet_im = Image.new("RGB", (cols * cell_w + (cols + 1) * 6, rows * (cell_h + 22) + 6), (24, 24, 28))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet_im)
    for idx, (f, i, seg) in enumerate(cells):
        r, c = divmod(idx, cols)
        x = 6 + c * (cell_w + 6)
        y = 6 + r * (cell_h + 22)
        sheet_im.paste(seg, (x, y))
        d.text((x, y + cell_h + 4), f"{f} seg{i+1}", fill=(180, 220, 255))
    sheet_im.save(os.path.join(OUT, out), quality=82)
    print(out, sheet_im.size, f"({len(cells)} cells)")

# Mobile suspects — worst findings
sheet(["mobile-settings.png", "mobile-scanner.png"], "s1-settings-scanner.jpg", seg_h=2600, cols=2)
sheet(["mobile-brokers.png"], "s2-brokers.jpg", seg_h=5200, cols=2, top_only=21000)
sheet(["mobile-voice.png", "mobile-scanner-bot.png", "mobile-history.png"], "s3-voice-scbot-history.jpg", seg_h=2600, cols=3)
sheet(["mobile-dashboard.png", "mobile-activity.png", "mobile-performance.png"], "s4-dash-act-perf.jpg", seg_h=2600, cols=3)
sheet(["mobile-app-root.png", "mobile-intel.png", "mobile-risk.png"], "s5-root-intel-risk.jpg", seg_h=2600, cols=3)
sheet(["mobile-lab.png", "mobile-studio.png", "mobile-briefing.png", "mobile-learning.png", "mobile-alerts.png", "pub-mobile-login.png"], "s6-rest.jpg", seg_h=2600, cols=3)
# Desktop suspects
sheet(["desktop-intel.png", "desktop-scanner-bot.png", "desktop-history.png"], "s7-d-intel-scbot-hist.jpg", seg_h=1700, cols=3)
sheet(["desktop-settings.png", "desktop-brokers.png", "desktop-voice.png", "desktop-alerts.png", "desktop-performance.png", "desktop-lab.png"], "s8-d-rest.jpg", seg_h=1900, cols=3, top_only=5600)
print("done")
