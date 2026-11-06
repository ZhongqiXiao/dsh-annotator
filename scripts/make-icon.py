from PIL import Image, ImageDraw
import math, os

S = 4
N = 180
W = N * S
def sc(v): return int(round(v * S))

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

grad = Image.new("RGB", (1, W))
top, bot = (30, 41, 59), (11, 18, 32)
for y in range(W):
    t = y / (W - 1)
    grad.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
grad = grad.resize((W, W))
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=sc(40), fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)

# page card
card = [sc(40), sc(26), sc(140), sc(154)]
d.rounded_rectangle([card[0] + sc(2), card[1] + sc(5), card[2] + sc(2), card[3] + sc(5)], radius=sc(12), fill=(2, 6, 16, 120))
d.rounded_rectangle(card, radius=sc(12), fill=(248, 250, 252, 255))

# header bar + two text lines above the selection
d.rounded_rectangle([sc(50), sc(36), sc(130), sc(45)], radius=sc(4), fill=(203, 213, 225, 255))
d.rounded_rectangle([sc(50), sc(55), sc(112), sc(62)], radius=sc(3), fill=(226, 232, 240, 255))
d.rounded_rectangle([sc(50), sc(69), sc(100), sc(76)], radius=sc(3), fill=(226, 232, 240, 255))

# selection region: faint tint + dashed marquee
sel = [sc(46), sc(84), sc(134), sc(124)]
d.rounded_rectangle(sel, radius=sc(2), fill=(8, 145, 178, 26))
dash, gap, lw = sc(15), sc(9), sc(3)
def dashed(p0, p1):
    x0, y0 = p0; x1, y1 = p1
    total = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / total, (y1 - y0) / total
    pos = 0.0
    while pos < total:
        e = min(pos + dash, total)
        d.line([x0 + ux * pos, y0 + uy * pos, x0 + ux * e, y0 + uy * e], fill=(8, 145, 178, 255), width=lw)
        pos = e + gap
dashed((sel[0], sel[1]), (sel[2], sel[1]))
dashed((sel[2], sel[1]), (sel[2], sel[3]))
dashed((sel[2], sel[3]), (sel[0], sel[3]))
dashed((sel[0], sel[3]), (sel[0], sel[1]))
h = sc(5)
for cx, cy in [(sel[0], sel[1]), (sel[2], sel[1]), (sel[0], sel[3]), (sel[2], sel[3])]:
    d.rounded_rectangle([cx - h, cy - h, cx + h, cy + h], radius=sc(2), fill=(255, 255, 255, 255), outline=(8, 145, 178, 255), width=sc(2))

# text under selection
d.rounded_rectangle([sc(50), sc(136), sc(104), sc(143)], radius=sc(3), fill=(226, 232, 240, 255))

# comment bubble bottom-right
bub = [sc(96), sc(118), sc(166), sc(160)]
d.rounded_rectangle(bub, radius=sc(15), fill=(245, 158, 11, 255))
d.polygon([(sc(112), sc(150)), (sc(101), sc(168)), (sc(126), sc(154))], fill=(245, 158, 11, 255))
for i in range(3):
    cx = sc(118) + i * sc(16)
    d.ellipse([cx - sc(4), sc(136) - sc(4), cx + sc(4), sc(136) + sc(4)], fill=(255, 251, 235, 255))

img = img.resize((N, N), Image.LANCZOS)
img.save("assets/icon-180.png", optimize=True)
print("saved", os.path.getsize("assets/icon-180.png"))
