#!/usr/bin/env python3
"""Cluster saturated accent colors across all mockups."""
from PIL import Image
import colorsys
from collections import Counter

def clusters(path, label, sat_min=0.45, val_min=0.35):
    img = Image.open(path).convert("RGB")
    img = img.resize((img.size[0] // 2, img.size[1] // 2))
    c = Counter()
    for x in range(img.size[0]):
        for y in range(img.size[1]):
            r, g, b = img.getpixel((x, y))
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s >= sat_min and v >= val_min:
                # quantize hue into 24 bins, s/v into 4 bins
                hb = int(h * 24)
                c[hb] += 1
    total = sum(c.values())
    print(f"== {label} (saturated px: {total}) ==")
    for hb, n in c.most_common(8):
        h = hb / 24
        # representative color at full sat
        r, g, b = colorsys.hsv_to_rgb(h, 0.85, 1.0)
        deg = int(h * 360)
        print(f"  hue {deg:3d}° {n:6d}px  rep #{int(r*255):02X}{int(g*255):02X}{int(b*255):02X}")

base = "/home/z/my-project/upload/"
for f in ["01_dashboard", "02_market_intelligence", "05_risk_guardian", "06_strategy_lab", "07_performance_analytics", "08_halo_voice_command_center"]:
    clusters(base + f + ".png", f)
