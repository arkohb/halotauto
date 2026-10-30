#!/usr/bin/env python3
"""Precise accent sampling from mockups."""
from PIL import Image

def P(img, fx, fy):
    r, g, b = img.getpixel((int(fx * img.size[0]), int(fy * img.size[1])))[:3]
    return f"#{r:02X}{g:02X}{b:02X}"

def brightest(img, box, label):
    """Brightest pixel in region = glow/accent color."""
    crop = img.crop(box)
    best, bp = -1, None
    for x in range(0, crop.size[0], 2):
        for y in range(0, crop.size[1], 2):
            r, g, b = crop.getpixel((x, y))[:3]
            s = r + g + b
            if s > best:
                best, bp = s, (r, g, b)
    print(f"{label:28s} #{bp[0]:02X}{bp[1]:02X}{bp[2]:02X}")

d = Image.open("/home/z/my-project/upload/01_dashboard.png").convert("RGB")
m = Image.open("/home/z/my-project/upload/02_market_intelligence.png").convert("RGB")
t = Image.open("/home/z/my-project/upload/03_trading_activity_open_positions.png").convert("RGB")
h = Image.open("/home/z/my-project/upload/04_trade_history.png").convert("RGB")
k = Image.open("/home/z/my-project/upload/06_strategy_lab.png").convert("RGB")
p = Image.open("/home/z/my-project/upload/07_performance_analytics.png").convert("RGB")
v = Image.open("/home/z/my-project/upload/08_halo_voice_command_center.png").convert("RGB")

# BUY badge (green) dashboard ~ (0.085,0.26); sell red in recent trades
brightest(d, (int(0.075*d.size[0]), int(0.245*d.size[1]), int(0.105*d.size[0]), int(0.27*d.size[1])), "BUY badge green")
brightest(d, (int(0.70*d.size[0]), int(0.90*d.size[1]), int(0.99*d.size[0]), int(0.99*d.size[1])), "recent trades red pnl")
brightest(d, (int(0.62*d.size[0]), int(0.06*d.size[1]), int(0.72*d.size[0]), int(0.09*d.size[1])), "Live pill green")
brightest(d, (int(0.60*d.size[0]), int(0.13*d.size[1]), int(0.80*d.size[0]), int(0.30*d.size[1])), "orb bright cyan")
brightest(d, (int(0.62*d.size[0]), int(0.35*d.size[1]), int(0.99*d.size[0]), int(0.42*d.size[1])), "market overview rows")
brightest(k, (int(0.60*d.size[0]), int(0.86*d.size[1]), int(0.72*d.size[0]), int(0.93*d.size[1])), "View Details button (06)")
brightest(v, (int(0.60*d.size[0]), int(0.93*d.size[1]), int(0.68*d.size[0]), int(0.99*d.size[1])), "mic button ring (08)")
# red in trade history table
brightest(h, (int(0.70*h.size[0]), int(0.44*h.size[1]), int(0.80*h.size[0]), int(0.50*h.size[1])), "trade hist red pnl (04)")
brightest(h, (int(0.70*h.size[0]), int(0.36*h.size[1]), int(0.80*h.size[0]), int(0.42*h.size[1])), "trade hist green pnl (04)")
# performance total pnl green
brightest(p, (int(0.72*p.size[0]), int(0.24*p.size[1]), int(0.99*p.size[0]), int(0.34*p.size[1])), "perf total pnl (07)")
# card borders — scan a horizontal line across card top
brightest(p, (int(0.05*p.size[0]), int(0.185*p.size[1]), int(0.60*p.size[0]), int(0.20*p.size[1])), "card top border glow (07)")
# gold logo
brightest(d, (int(0.03*d.size[0]), int(0.05*d.size[1]), int(0.13*d.size[0]), int(0.085*d.size[1])), "logo gold text")
# cyan time text
brightest(v, (int(0.75*v.size[0]), int(0.05*v.size[1]), int(0.99*v.size[0]), int(0.09*v.size[1])), "voice date cyan")
