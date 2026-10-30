#!/usr/bin/env python3
"""Sample exact pixel colors from the HALO mockup screenshots."""
from PIL import Image

def hexat(img, x, y):
    r, g, b = img.getpixel((x, y))[:3]
    return f"#{r:02X}{g:02X}{b:02X}"

def region_avg(img, box):
    r = img.crop(box).resize((1, 1), Image.LANCZOS)
    px = r.getpixel((0, 0))[:3]
    return f"#{px[0]:02X}{px[1]:02X}{px[2]:02X}"

imgs = {}
for n in ["01_dashboard", "02_market_intelligence", "05_risk_guardian", "08_halo_voice_command_center"]:
    imgs[n] = Image.open(f"/home/z/my-project/upload/{n}.png").convert("RGB")

d = imgs["01_dashboard"]
print("== 01 dashboard ==", d.size)
W, H = d.size
sx, sy = W / 512.0, H / 320.0  # images rendered at 512x320 in my view; use ratios
def P(img, fx, fy):
    return hexat(img, int(fx * img.size[0]), int(fy * img.size[1]))

print("page bg (top gap):        ", P(d, 0.50, 0.015))
print("page bg (bottom):         ", P(d, 0.50, 0.985))
print("sidebar bg:               ", P(d, 0.045, 0.55))
print("sidebar active row bg:    ", P(d, 0.045, 0.115))
print("topbar bg:                ", P(d, 0.55, 0.062))
print("card bg (chart card):     ", P(d, 0.30, 0.42))
print("card bg (right col):      ", P(d, 0.78, 0.55))
print("card header band:         ", P(d, 0.30, 0.24))
print("card border top edge:     ", P(d, 0.30, 0.222))
print("logo gold:                ", P(d, 0.075, 0.062))
print("green price:              ", P(d, 0.83, 0.30))
print("greeting banner bg:       ", P(d, 0.28, 0.145))
m = imgs["02_market_intelligence"]
print("== 02 market intel ==")
print("bg:                       ", P(m, 0.50, 0.02))
print("sidebar active (cyan):    ", P(m, 0.045, 0.315))
print("card bg:                  ", P(m, 0.35, 0.55))
print("cyan accent (tabs):       ", P(m, 0.30, 0.42))
v = imgs["08_halo_voice_command_center"]
print("== 08 voice center ==")
print("bg:                       ", P(v, 0.5, 0.02))
print("orb core center:          ", P(v, 0.36, 0.52))
print("orb glow mid:             ", P(v, 0.36, 0.60))
print("sub-nav active bg:        ", P(v, 0.09, 0.30))
print("conversation panel bg:    ", P(v, 0.78, 0.55))
print("bottom bar bg:            ", P(v, 0.5, 0.965))
r = imgs["05_risk_guardian"]
print("== 05 risk guardian ==")
print("shield glow center:       ", P(r, 0.245, 0.52))
print("metrics card bg:          ", P(r, 0.65, 0.50))
print("healthy green:            ", P(r, 0.245, 0.72))
