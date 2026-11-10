from PIL import Image, ImageDraw, ImageFilter
import math, os

# dsh-annotator storefront icon
# Brand colors come from the plugin UI (lib/overlay.js):
#   accent  #ff7a45  (marquee box, labels, HUD)
#   card    #261d18 -> #191210 dark-brown gradient
#   surface #f8f1e8  warm paper for the mini "web page"

ACC   = (255, 122, 69, 255)      # --vp-acc #ff7a45
ACC_D = (214, 88, 34, 255)       # darker accent edge
TINT  = (255, 122, 69, 34)       # faint selection tint
PAPER = (248, 241, 232, 255)     # warm page card
LINE  = (229, 216, 202, 255)     # skeleton text lines
INK   = (26, 18, 12, 255)        # cursor outline

S = 4
N = 180
W = N * S
def sc(v): return int(round(v * S))

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# dark-brown brand gradient behind a rounded square
grad = Image.new("RGB", (1, W))
top, bot = (45, 33, 23), (20, 13, 9)
for y in range(W):
    t = y / (W - 1)
    grad.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
grad = grad.resize((W, W))
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=sc(40), fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)

# soft accent glow top-left for depth
glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse([-sc(40), -sc(40), sc(80), sc(80)], fill=(255, 122, 69, 46))
glow = glow.filter(ImageFilter.GaussianBlur(sc(18)))
img = Image.alpha_composite(img, glow)
d = ImageDraw.Draw(img)

# mini web page card with drop shadow
card = [sc(36), sc(26), sc(138), sc(142)]
sh = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle(
    [card[0] + sc(3), card[1] + sc(7), card[2] + sc(3), card[3] + sc(7)],
    radius=sc(12), fill=(0, 0, 0, 110))
sh = sh.filter(ImageFilter.GaussianBlur(sc(3)))
img = Image.alpha_composite(img, sh)
d = ImageDraw.Draw(img)
d.rounded_rectangle(card, radius=sc(12), fill=PAPER)

# page skeleton: header + two body lines
d.rounded_rectangle([sc(46), sc(36), sc(128), sc(46)], radius=sc(4), fill=LINE)
d.rounded_rectangle([sc(46), sc(56), sc(106), sc(63)], radius=sc(3), fill=(238, 228, 216, 255))
d.rounded_rectangle([sc(46), sc(70), sc(92), sc(77)], radius=sc(3), fill=(238, 228, 216, 255))

# the element being picked: a little orange button
d.rounded_rectangle([sc(46), sc(88), sc(98), sc(108)], radius=sc(6), fill=(255, 122, 69, 70))
d.rounded_rectangle([sc(53), sc(94), sc(91), sc(102)], radius=sc(3), fill=(255, 146, 96, 255))

d.rounded_rectangle([sc(46), sc(120), sc(100), sc(127)], radius=sc(3), fill=(238, 228, 216, 255))

# dashed marquee over the picked element (the plugin signature)
sel = [sc(42), sc(84), sc(102), sc(112)]
dash, gap, lw = sc(12), sc(7), sc(3)
def dashed(p0, p1):
    x0, y0 = p0; x1, y1 = p1
    total = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / total, (y1 - y0) / total
    pos = 0.0
    while pos < total:
        e = min(pos + dash, total)
        d.line([x0 + ux * pos, y0 + uy * pos, x0 + ux * e, y0 + uy * e], fill=ACC, width=lw)
        pos = e + gap
dashed((sel[0], sel[1]), (sel[2], sel[1]))
dashed((sel[2], sel[1]), (sel[2], sel[3]))
dashed((sel[2], sel[3]), (sel[0], sel[3]))
dashed((sel[0], sel[3]), (sel[0], sel[1]))
h = sc(5)
for cx, cy in [(sel[0], sel[1]), (sel[2], sel[1]), (sel[0], sel[3]), (sel[2], sel[3])]:
    d.rounded_rectangle([cx - h, cy - h, cx + h, cy + h], radius=sc(2),
                        fill=(255, 255, 255, 255), outline=ACC_D, width=sc(2))

# pointer cursor aiming at the picked element (classic arrow, scaled)
def arrow_pts(x0, y0, k):
    raw = [(0, 0), (0, 12.2), (3.4, 9.2), (5.6, 14.2), (8.2, 13.0), (6.1, 8.2), (11.0, 7.6)]
    return [(x0 + px * k, y0 + py * k) for px, py in raw]
ox, oy, k = sc(64), sc(95), 2.6
cur = Image.new("RGBA", (W, W), (0, 0, 0, 0))
cd = ImageDraw.Draw(cur)
pts = arrow_pts(ox, oy, k)
for w, fill in [(sc(3.2), INK), (sc(1.6), (255, 255, 255, 255))]:
    cd.polygon(pts, fill=fill, outline=fill, width=w)
cur = cur.rotate(-12, resample=Image.BICUBIC, center=(ox + 5 * k, oy + 6 * k))
img = Image.alpha_composite(img, cur)
d = ImageDraw.Draw(img)

# comment bubble with tail, bottom-right, brand orange
bub = [sc(96), sc(112), sc(168), sc(156)]
bsh = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(bsh).rounded_rectangle(
    [bub[0] + sc(2), bub[1] + sc(6), bub[2] + sc(2), bub[3] + sc(6)],
    radius=sc(15), fill=(0, 0, 0, 110))
bsh = bsh.filter(ImageFilter.GaussianBlur(sc(3)))
img = Image.alpha_composite(img, bsh)
d = ImageDraw.Draw(img)
d.rounded_rectangle(bub, radius=sc(15), fill=ACC)
d.polygon([(sc(114), sc(146)), (sc(102), sc(166)), (sc(130), sc(150))], fill=ACC)
for i in range(3):
    cx = sc(119) + i * sc(17)
    d.ellipse([cx - sc(4.5), sc(131) - sc(4.5), cx + sc(4.5), sc(131) + sc(4.5)],
              fill=(255, 246, 238, 255))

# re-clip to the rounded square: glow and shadows may spill past the corner
final_mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(final_mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=sc(40), fill=255)
img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (W, W), 0), final_mask))

img = img.resize((N, N), Image.LANCZOS)
img.save("assets/icon-180.png", optimize=True)
print("saved", os.path.getsize("assets/icon-180.png"))