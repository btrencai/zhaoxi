#!/usr/bin/env python3
"""「朝夕」Logo 第二批概念稿：光感 / 立体 / 色彩 / 字形 6 个方向。

输出 preview2/logo-*.png（1024）+ preview2/logo-sheet2.png
依赖：Pillow；复用 logo-concepts.py 的基础设施。
"""
import importlib.util
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("logo_concepts", ROOT / "tools" / "logo-concepts.py")
lc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lc)

W, K, S = lc.W, lc.K, lc.S
p = lc.p
MASK = lc.MASK
compose = lc.compose
warm_dot = lc.warm_dot
cap_circles = lc.cap_circles
lerp = lc.lerp


def sample(stops, t):
    if t <= stops[0][0]:
        return stops[0][1]
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t0 <= t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return stops[-1][1]


def grad_full(stops):
    img = Image.new("RGBA", (W, W))
    d = ImageDraw.Draw(img)
    for y in range(W):
        d.line([(0, y), (W, y)], fill=sample(stops, y / (W - 1)) + (255,))
    return img


def grad_box(size, stops):
    img = Image.new("RGBA", size)
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        d.line([(0, y), (size[0], y)], fill=sample(stops, y / max(1, size[1] - 1)) + (255,))
    return img


def circle_mask(cx, cy, r):
    m = Image.new("L", (W, W), 0)
    ImageDraw.Draw(m).ellipse([p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]], fill=255)
    return m


# ── G · 晨昏天空（晚霞渐变 + 地平线 + 日轮）──
def concept_g():
    sky = grad_full(
        [
            (0.00, (0x39, 0x31, 0xB4)),
            (0.40, (0x6B, 0x5A, 0xEF)),
            (0.64, (0xB2, 0x6F, 0xF0)),
            (0.85, (0xFF, 0x9E, 0x6E)),
            (1.00, (0xFF, 0xC9, 0x94)),
        ]
    )
    icon = lc.base_icon(grad_img=sky, glow_amt=0.18)
    halo = circle_mask(512, 550, 170).filter(ImageFilter.GaussianBlur(46 * K)).point(lambda v: int(v * 0.5))
    halo = ImageChops.multiply(halo, MASK)
    warmc = Image.merge("RGBA", (Image.new("L", (W, W), 255), Image.new("L", (W, W), 214), Image.new("L", (W, W), 150), halo))
    icon = Image.alpha_composite(icon, warmc)
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    sr = 112
    d.ellipse([p(512 - sr, 552 - sr)[0], p(512 - sr, 552 - sr)[1], p(512 + sr, 552 + sr)[0], p(512 + sr, 552 + sr)[1]], fill=(255, 255, 255, 255))
    lw, lh, ly = 524, 30, 638
    d.rounded_rectangle(
        [p(512 - lw / 2, ly)[0], p(512 - lw / 2, ly)[1], p(512 + lw / 2, ly + lh)[0], p(512 + lw / 2, ly + lh)[1]],
        radius=int(lh / 2 * K),
        fill=(255, 255, 255, 245),
    )
    return compose(icon, layer, alpha=0.16, blur=8)


# ── H · 蚀·日冕新月（暖色日盘被蚀出新月）──
def concept_h():
    icon = lc.base_icon()
    snapshot = icon.copy()
    warm = grad_full(
        [
            (0.20, (0xFF, 0xE9, 0xC2)),
            (0.50, (0xFF, 0xB4, 0x70)),
            (0.82, (0xF2, 0x6D, 0x8C)),
        ]
    )
    cx, cy, R = 500, 516, 272
    disc = circle_mask(cx, cy, R)
    glow = disc.filter(ImageFilter.GaussianBlur(30 * K)).point(lambda v: int(v * 0.42))
    gl = Image.merge("RGBA", (Image.new("L", (W, W), 255), Image.new("L", (W, W), 178), Image.new("L", (W, W), 118), glow))
    icon = Image.alpha_composite(icon, gl)
    icon.paste(warm, (0, 0), disc)
    cover = circle_mask(cx + 96, cy - 62, R)
    icon.paste(snapshot, (0, 0), cover)
    crescent = ImageChops.subtract(disc, cover)
    edge = crescent.filter(ImageFilter.GaussianBlur(7 * K)).point(lambda v: int(v * 0.35))
    el = Image.merge("RGBA", (Image.new("L", (W, W), 255), Image.new("L", (W, W), 226), Image.new("L", (W, W), 176), edge))
    return Image.alpha_composite(icon, el)


# ── I · 晨光玻璃球（3D 球体 + 高光 + 地平线）──
def concept_i():
    icon = lc.base_icon()
    R = 212
    cx, cy = 512, 452
    bm = circle_mask(cx, cy, R)
    glow = bm.filter(ImageFilter.GaussianBlur(34 * K)).point(lambda v: int(v * 0.5))
    gl = Image.merge("RGBA", (Image.new("L", (W, W), 255), Image.new("L", (W, W), 186), Image.new("L", (W, W), 120), glow))
    icon = Image.alpha_composite(icon, gl)
    dia = int(2 * R * K)
    ball = grad_box((dia, dia), [(0.0, (0xFF, 0xEC, 0xCE)), (0.45, (0xFF, 0xB9, 0x78)), (1.0, (0xEF, 0x6F, 0x6A))])
    bx, by = int(p(cx - R, cy - R)[0]), int(p(cx - R, cy - R)[1])
    icon.paste(ball, (bx, by), bm.crop((bx, by, bx + dia, by + dia)))
    hl = Image.new("L", (W, W), 0)
    hx, hy, hr = cx - 72, cy - 86, 118
    ImageDraw.Draw(hl).ellipse([p(hx - hr, hy - hr)[0], p(hx - hr, hy - hr)[1], p(hx + hr, hy + hr)[0], p(hx + hr, hy + hr)[1]], fill=200)
    hl = hl.filter(ImageFilter.GaussianBlur(24 * K))
    hl = ImageChops.multiply(hl, bm)
    hlc = Image.merge("RGBA", (Image.new("L", (W, W), 255), Image.new("L", (W, W), 252), Image.new("L", (W, W), 240), hl))
    icon = Image.alpha_composite(icon, hlc)
    rim = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    bbox = [p(cx - R, cy - R)[0], p(cx - R, cy - R)[1], p(cx + R, cy + R)[0], p(cx + R, cy + R)[1]]
    rd.arc(bbox, 200, 340, fill=(255, 255, 255, 130), width=int(10 * K))
    rd.arc(bbox, 25, 155, fill=(255, 232, 190, 170), width=int(13 * K))
    icon = Image.alpha_composite(icon, rim)
    sh = Image.new("L", (W, W), 0)
    ImageDraw.Draw(sh).ellipse([p(cx - 150, 648)[0], p(cx - 150, 648)[1], p(cx + 150, 688)[0], p(cx + 150, 688)[1]], fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(18 * K)).point(lambda v: int(v * 0.45))
    shl = Image.merge("RGBA", (Image.new("L", (W, W), 24), Image.new("L", (W, W), 18), Image.new("L", (W, W), 70), sh))
    icon = Image.alpha_composite(icon, shl)
    line = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ld = ImageDraw.Draw(line)
    lw, lh, ly = 528, 20, 700
    ld.rounded_rectangle(
        [p(512 - lw / 2, ly)[0], p(512 - lw / 2, ly)[1], p(512 + lw / 2, ly + lh)[0], p(512 + lw / 2, ly + lh)[1]],
        radius=int(lh / 2 * K),
        fill=(255, 255, 255, 240),
    )
    return Image.alpha_composite(icon, line)


# ── J · 汉字「朝」（现代字形 + 晨光点）──
def concept_j(font_file="C:/Windows/Fonts/STZHONGS.TTF", size=456, dy=6):
    icon = lc.base_icon()
    font = ImageFont.truetype(font_file, int(size * K))
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text(p(512, 512 + dy), "朝", font=font, fill=(255, 255, 255, 255), anchor="mm", stroke_width=int(9 * K), stroke_fill=(255, 255, 255, 255))
    icon = compose(icon, layer, alpha=0.20, blur=10)
    return warm_dot(icon, 762, 288, 34)


# ── K · 朝夕之环（环形渐变：昼白 → 昏暖）──
def concept_k():
    icon = lc.base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, R, wd = 512, 512, 258, 88
    bbox = [p(cx - R, cy - R)[0], p(cx - R, cy - R)[1], p(cx + R, cy + R)[0], p(cx + R, cy + R)[1]]
    steps = 240
    wd_px = int(wd * K)

    def rel(ang):
        dd = abs((ang - 270) % 360)
        dd = min(dd, 360 - dd)
        return dd / 180.0

    for i in range(steps):
        a0 = i * 360.0 / steps
        a1 = (i + 1) * 360.0 / steps + 0.7
        t = rel((a0 + a1) / 2)
        tt = t * t * (3 - 2 * t)
        col = lc.lerp((255, 255, 255), (0xFF, 0xB4, 0x6B), tt)
        d.arc(bbox, a0, a1, fill=col + (255,), width=wd_px)
    return compose(icon, layer, alpha=0.20, blur=9)


# ── L · 立体叠卡（三张带光泽的悬浮卡片）──
def concept_l():
    icon = lc.base_icon()
    cw, ch, r = 446, 198, 60
    for cyc, rot, al in [(378, -3.4, 188), (492, 0.0, 224), (606, 3.4, 255)]:
        lay = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        top_y = (cyc - ch / 2) * K
        box = [p(512 - cw / 2, cyc - ch / 2)[0], p(512 - cw / 2, cyc - ch / 2)[1], p(512 + cw / 2, cyc + ch / 2)[0], p(512 + cw / 2, cyc + ch / 2)[1]]
        d.rounded_rectangle(box, radius=int(r * K), fill=(255, 255, 255, al))
        card_mask = Image.new("L", (W, W), 0)
        ImageDraw.Draw(card_mask).rounded_rectangle(box, radius=int(r * K), fill=255)
        band = int(ch * 0.60 * K)
        gloss = Image.new("L", (W, W), 0)
        gloss.paste(ImageOps.invert(Image.linear_gradient("L")).resize((W, band)), (0, int(top_y)))
        gloss = ImageChops.multiply(gloss, card_mask).point(lambda v: int(v * 0.20))
        lay = Image.alpha_composite(lay, Image.merge("RGBA", (Image.new("L", (W, W), 255), Image.new("L", (W, W), 255), Image.new("L", (W, W), 255), gloss)))
        bot = Image.new("L", (W, W), 0)
        band2 = int(ch * 0.40 * K)
        bot.paste(Image.linear_gradient("L").resize((W, band2)), (0, int(top_y) + int(ch * 0.60 * K)))
        bot = ImageChops.multiply(bot, card_mask).point(lambda v: int(v * 0.14))
        lay = Image.alpha_composite(lay, Image.merge("RGBA", (Image.new("L", (W, W), 26), Image.new("L", (W, W), 22), Image.new("L", (W, W), 74), bot)))
        lay = lay.rotate(rot, resample=Image.BICUBIC, center=p(512, cyc))
        sh = lay.filter(ImageFilter.GaussianBlur(13 * K))
        salpha = sh.split()[3].point(lambda v: int(v * 0.40))
        shl = Image.merge("RGBA", (Image.new("L", (W, W), 22), Image.new("L", (W, W), 16), Image.new("L", (W, W), 64), salpha))
        shl = ImageChops.offset(shl, 0, int(16 * K))
        shl = Image.composite(shl, Image.new("RGBA", (W, W), (0, 0, 0, 0)), MASK)
        icon = Image.alpha_composite(icon, shl)
        icon = Image.alpha_composite(icon, lay)
    return warm_dot(icon, 688, 552, 31)


CONCEPTS = [
    ("g", "方案 G · 晨昏天空", "晚霞渐变天空：日轮沉入地平线（氛围色彩）", concept_g),
    ("h", "方案 H · 蚀·日冕新月", "暖色日盘被蚀出新月，光晕弥散（负空间光感）", concept_h),
    ("i", "方案 I · 晨光玻璃球", "3D 球体：高光、反光缘、落影（立体质感）", concept_i),
    ("j", "方案 J · 汉字「朝」", "现代宋体大字 + 晨光点（东方字形）", concept_j),
    ("k", "方案 K · 朝夕之环", "白昼渐入黄昏的一枚环：环形渐变", concept_k),
    ("l", "方案 L · 立体叠卡", "三张带光泽的悬浮卡片（秩序感 · 3D）", concept_l),
]


def main():
    OUT = ROOT / "preview2"
    OUT.mkdir(exist_ok=True)
    rendered = []
    for key, name, desc, fn in CONCEPTS:
        icon = fn().resize((S, S), Image.LANCZOS)
        path = OUT / f"logo-{key}.png"
        icon.save(path)
        rendered.append((key, name, icon))
        print("written:", path)
    # 字体变体额外输出（供挑选）
    c2 = concept_j("C:/Windows/Fonts/Dengb.ttf", size=442, dy=8).resize((S, S), Image.LANCZOS)
    c2.save(OUT / "logo-j-dengb.png")
    print("written:", OUT / "logo-j-dengb.png")

    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 40)
    cell_w, cell_h = 800, 980
    cols, rows = 2, 3
    sheet = Image.new("RGB", (cell_w * cols, cell_h * rows), (244, 244, 247))
    sd = ImageDraw.Draw(sheet)
    for idx, (key, name, icon) in enumerate(rendered):
        cx = (idx % cols) * cell_w
        cy = (idx // cols) * cell_h
        big = icon.resize((640, 640), Image.LANCZOS)
        sheet.paste(big, (cx + (cell_w - 640) // 2, cy + 70), big)
        mini = icon.resize((96, 96), Image.LANCZOS)
        label_y = cy + 70 + 640 + 52
        sd.text((cx + 120, label_y + 18), name, fill=(29, 29, 31), font=font)
        sheet.paste(mini, (cx + 520, label_y), mini)
    sheet.save(OUT / "logo-sheet2.png")
    print("written:", OUT / "logo-sheet2.png")


if __name__ == "__main__":
    main()
