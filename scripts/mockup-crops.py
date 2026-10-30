#!/usr/bin/env python3
"""Crop key regions at 3x zoom for visual inspection."""
from PIL import Image

d = Image.open("/home/z/my-project/upload/01_dashboard.png").convert("RGB")
W, H = d.size  # 505x345

def crop(img, box, name, scale=3):
    c = img.crop(box)
    c = c.resize((c.size[0] * scale, c.size[1] * scale), Image.LANCZOS)
    c.save(f"/home/z/my-project/scripts/crop_{name}.png")

# header bar
crop(d, (0, 0, W, int(0.11 * H)), "header")
# right column: orb + market overview
crop(d, (int(0.58 * W), int(0.12 * H), W, int(0.62 * H)), "rightcol")
# bottom row: latest signal / monitoring / recent trades
crop(d, (int(0.02 * W), int(0.70 * H), W, H), "bottomrow")
# greeting + sidebar
crop(d, (0, int(0.11 * H), int(0.60 * W), int(0.25 * H)), "greeting")
