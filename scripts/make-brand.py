"""Builds every brand image from brand/logo-source.png (needs Pillow + numpy). Not required for deploys.
   python3 scripts/make-brand.py"""
import glob, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = Image.open('brand/logo-source.png').convert('RGB')
A = np.asarray(SRC).astype(int)
MARK = (305, 539, 1542, 1000)       # the three B's
FULL = (305, 539, 2442, 1000)       # three B's + wordmark
BG = (5, 7, 11)
AMBER, PINK, CYAN = (255, 176, 32), (255, 92, 122), (80, 220, 255)

def cut(box, pad=6, height=None):
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    rgb = A[y0:y1, x0:x1]
    alpha = np.clip((rgb.max(axis=2) - 6) * 255 / 26, 0, 255).astype(np.uint8)
    im = Image.fromarray(rgb.astype(np.uint8)).convert('RGBA'); im.putalpha(Image.fromarray(alpha))
    if height: im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
    return im

def font(sz, bold=True):
    for p in glob.glob('/usr/share/fonts/**/DejaVuSans%s.ttf' % ('-Bold' if bold else ''), recursive=True):
        return ImageFont.truetype(p, sz)
    return ImageFont.load_default(size=sz)

def icon(size, maskable=False):
    S = size * 4
    img = Image.new('RGBA', (S, S), BG + (255,))
    mark = cut(MARK, height=None)
    target_w = S * (.68 if maskable else .8)
    mark = mark.resize((round(target_w), round(mark.height * target_w / mark.width)), Image.LANCZOS)
    img.alpha_composite(mark, ((S - mark.width) // 2, (S - mark.height) // 2))
    out = img.resize((size, size), Image.LANCZOS)
    if not maskable:
        m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, S, S], radius=S * .22, fill=255)
        out.putalpha(m.resize((size, size), Image.LANCZOS))
    return out

def og():
    W, H = 2400, 1260
    img = Image.new('RGBA', (W, H), BG + (255,)); d = ImageDraw.Draw(img)
    for x in range(0, W, 120): d.line([(x, 0), (x, H)], fill=(14, 17, 22), width=2)
    for y in range(0, H, 120): d.line([(0, y), (W, y)], fill=(14, 17, 22), width=2)
    # candles + line along the bottom
    random.seed(5)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
    n, x0, x1, base, amp = 46, 130, W - 130, H - 130, 250
    v, pts = .5, []
    for i in range(n):
        o = v; v = min(.95, max(.08, v + random.uniform(-.17, .2) * .8 + .004)); c = v
        hi = max(o, c) + random.uniform(.02, .08); lo = min(o, c) - random.uniform(.02, .08)
        cx = x0 + (x1 - x0) * (i + .5) / n; sl = (x1 - x0) / n
        col = AMBER if c >= o else PINK
        Y = lambda q: base - q * amp
        ld.line([(cx, Y(hi)), (cx, Y(lo))], fill=col + (200,), width=3)
        ld.rounded_rectangle([cx - sl * .28, Y(max(o, c)), cx + sl * .28, max(Y(min(o, c)), Y(max(o, c)) + 4)], radius=3, fill=col + (200,))
        pts.append((cx, Y(c)))
    g = layer.filter(ImageFilter.GaussianBlur(12)); img.alpha_composite(g); img.alpha_composite(layer)
    ln = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(ln).line(pts, fill=CYAN + (235,), width=7, joint='curve')
    g = ln.filter(ImageFilter.GaussianBlur(10)); img.alpha_composite(g); img.alpha_composite(ln)
    # lockup + tagline
    logo = cut(FULL); w = 1700; logo = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
    img.alpha_composite(logo, ((W - w) // 2, 260))
    d = ImageDraw.Draw(img)
    t = 'See your music as a market.'
    d.text(((W - d.textlength(t, font=font(70, False))) // 2, 260 + logo.height + 70), t, font=font(70, False), fill=(190, 198, 210))
    img.convert('RGB').resize((1200, 630), Image.LANCZOS).save('public/og.png', optimize=True)

if __name__ == '__main__':
    cut(MARK, height=90).save('public/brand/mark.png', optimize=True)
    icon(512).save('public/icons/icon-512.png', optimize=True)
    icon(192).save('public/icons/icon-192.png', optimize=True)
    icon(512, True).convert('RGB').save('public/icons/maskable-512.png', optimize=True)
    icon(180, True).convert('RGB').save('public/icons/apple-touch-icon.png', optimize=True)
    icon(32).save('public/icons/favicon-32.png', optimize=True)
    icon(256).save('public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    og()
    # brand colours, sampled from the artwork
    for name, (x, y) in {'bear': (330, 760), 'bull': (760, 760), 'beats': (1190, 920)}.items():
        r = A[y - 20:y + 20, x - 20:x + 20].reshape(-1, 3).mean(axis=0).astype(int)
        print(name, '#%02x%02x%02x' % tuple(r))
