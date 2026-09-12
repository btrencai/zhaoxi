#!/usr/bin/env python3
"""「朝夕」Logo 多方案概念稿：超椭圆品牌底 + 6 个元素方向。

输出 preview/logo-a..f.png（1024）+ preview/logo-sheet.png（对比图）。
依赖：Pillow
"""
from math import cos, radians, sin
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
S, SS = 1024, 3
W = S * SS
K = W / 1024.0

TOP = (0x7D, 0x6E, 0xFB)
MID = (0x63, 0x5B, 0xE8)
BOT = (0x4F, 0x45, 0xD0)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def superellipse(scale, steps=1400, n=4.6):
    pts = []
    for i in range(steps):
        ang = 2 * 3.141592653589793 * i / steps
        from math import copysign

        cx = copysign(abs(cos(ang)) ** (2 / n), cos(ang))
        cy = copysign(abs(sin(ang)) ** (2 / n), sin(ang))
        pts.append(((0.5 + cx * 0.5 * scale) * W, (0.5 + cy * 0.5 * scale) * W))
    return pts


MASK = Image.new("L", (W, W), 0)
ImageDraw.Draw(MASK).polygon(superellipse(1.0), fill=255)
INNER = Image.new("L", (W, W), 0)
ImageDraw.Draw(INNER).polygon(superellipse(0.992), fill=255)

GRAD = Image.new("RGBA", (W, W))
_gd = ImageDraw.Draw(GRAD)
for y in range(W):
    t = y / (W - 1)
    c = lerp(TOP, MID, t / 0.5) if t < 0.5 else lerp(MID, BOT, (t - 0.5) / 0.5)
    _gd.line([(0, y), (W, y)], fill=c + (255,))


def base_icon(grad_img=None, glow_amt=0.30):
    icon = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    icon.paste(grad_img if grad_img is not None else GRAD, (0, 0), MASK)
    glow = Image.new("L", (W, W), 0)
    rad = Image.radial_gradient("L").resize((int(W * 1.7), int(W * 1.7)), Image.LANCZOS)
    glow.paste(rad, (int(-W * 0.55), int(-W * 0.75)))
    glow = glow.point(lambda v: int(v * glow_amt))
    glow = ImageChops.multiply(glow, MASK)
    light = Image.new("RGBA", (W, W), (255, 255, 255, 255))
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (light.split()[0], light.split()[1], light.split()[2], glow)))
    stroke = ImageChops.subtract(MASK, INNER).point(lambda v: int(v * 0.30))
    edge = Image.new("RGBA", (W, W), (255, 255, 255, 255))
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (edge.split()[0], edge.split()[1], edge.split()[2], stroke)))
    return icon


def p(x, y):  # 1024 坐标 → 超采样坐标
    return (x * K, y * K)


def compose(icon, layer, alpha=0.20, blur=8, off=(5, 10)):
    shadow = layer.filter(ImageFilter.GaussianBlur(blur * K))
    a = shadow.split()[3].point(lambda v: int(v * alpha))
    black = Image.new("L", (W, W), 0)
    sh = Image.merge("RGBA", (black, black, black, a))
    sh = ImageChops.offset(sh, int(off[0] * K), int(off[1] * K))
    sh = Image.composite(sh, Image.new("RGBA", (W, W), (0, 0, 0, 0)), MASK)
    icon = Image.alpha_composite(icon, sh)
    return Image.alpha_composite(icon, layer)


def warm_dot(icon, cx, cy, r):
    sx, sy, sr = cx * K, cy * K, r * K
    halo = Image.new("L", (W, W), 0)
    ImageDraw.Draw(halo).ellipse([sx - sr * 2.0, sy - sr * 2.0, sx + sr * 2.0, sy + sr * 2.0], fill=96)
    halo = halo.filter(ImageFilter.GaussianBlur(20 * K))
    halo = ImageChops.multiply(halo, MASK)
    warmc = Image.merge(
        "RGBA",
        (Image.new("L", (W, W), 255), Image.new("L", (W, W), 210), Image.new("L", (W, W), 142), halo),
    )
    icon = Image.alpha_composite(icon, warmc)
    dot = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(dot).ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 228, 172, 255))
    return Image.alpha_composite(icon, dot)


def cap_circles(d, cx, cy, r, ang_deg, width, fill):
    """圆头端帽：全部参数按 1024 坐标系传入（内部乘 K）。"""
    for ang in ang_deg:
        x = (cx + r * cos(radians(ang))) * K
        y = (cy + r * sin(radians(ang))) * K
        rr = width * K / 2
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=fill)


# ── A · 夕弧与晨点（新月弧环抱晨星）──
def concept_a():
    icon = base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, R, wd = 524, 524, 300, 104
    bbox = [p(cx - R, cy - R)[0], p(cx - R, cy - R)[1], p(cx + R, cy + R)[0], p(cx + R, cy + R)[1]]
    d.arc(bbox, 336, 246, fill=(255, 255, 255, 255), width=int(wd * K))
    cap_circles(d, cx, cy, R, [336, 246], wd, (255, 255, 255, 255))
    icon = compose(icon, layer, alpha=0.22, blur=9)
    return warm_dot(icon, 646, 332, 38)


# ── B · 日出东方（圆日悬于地平线之上）──
def concept_b():
    icon = base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, R = 512, 446, 186
    d.ellipse([p(cx - R, cy - R)[0], p(cx - R, cy - R)[1], p(cx + R, cy + R)[0], p(cx + R, cy + R)[1]], fill=(255, 255, 255, 255))
    bw, bh = 608, 76
    d.rounded_rectangle(
        [p(cx - bw / 2, 664)[0], p(cx - bw / 2, 664)[1], p(cx + bw / 2, 664 + bh)[0], p(cx + bw / 2, 664 + bh)[1]],
        radius=int(bh / 2 * K),
        fill=(255, 255, 255, 255),
    )
    return compose(icon, layer, alpha=0.22, blur=9)


# ── C · 精炼对勾（品牌延续）──
def concept_c():
    icon = base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pts = [p(296, 552), p(462, 718), p(742, 326)]
    d.line([pts[0], pts[1], pts[2]], fill=(255, 255, 255, 255), width=int(86 * K), joint="curve")
    r = int(86 * K) // 2
    for px, py in (pts[0], pts[-1]):
        d.ellipse([px - r, py - r, px + r, py + r], fill=(255, 255, 255, 255))
    icon = compose(icon, layer, alpha=0.22, blur=9)
    return warm_dot(icon, 744, 232, 34)


# ── D · 山与朝日（地平线 + 圆丘 + 初升暖阳）──
def concept_d():
    icon = base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 地平线：细长圆角条
    lw, lh, ly = 560, 34, 588
    d.rounded_rectangle(
        [p(512 - lw / 2, ly)[0], p(512 - lw / 2, ly)[1], p(512 + lw / 2, ly + lh)[0], p(512 + lw / 2, ly + lh)[1]],
        radius=int(lh / 2 * K),
        fill=(255, 255, 255, 255),
    )
    # 圆丘（坐在地平线上的半圆）
    r = 152
    cx = 416
    d.pieslice([p(cx - r, ly - r)[0], p(cx - r, ly - r)[1], p(cx + r, ly + r)[0], p(cx + r, ly + r)[1]], 180, 360, fill=(255, 255, 255, 255))
    icon = compose(icon, layer, alpha=0.22, blur=9)
    return warm_dot(icon, 700, 592, 30)


# ── E · 层叠工作台（三张卡片）──
def concept_e():
    icon = base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cw, ch, r = 448, 212, 64
    cx = 512
    items = [(312, 118), (416, 196), (520, 255)]
    for y, a in items:
        d.rounded_rectangle(
            [p(cx - cw / 2, y)[0], p(cx - cw / 2, y)[1], p(cx + cw / 2, y + ch)[0], p(cx + cw / 2, y + ch)[1]],
            radius=int(r * K),
            fill=(255, 255, 255, a),
        )
    return compose(icon, layer, alpha=0.22, blur=9)


# ── F · 拾级而上（三阶 + 顶光）──
def concept_f():
    icon = base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bw = 160
    gap = 108
    base = 796
    heights = [336, 472, 608]
    start = (1024 - (bw * 3 + gap * 2)) / 2
    for i, h in enumerate(heights):
        x = start + i * (bw + gap)
        d.rounded_rectangle(
            [p(x, base - h)[0], p(x, base - h)[1], p(x + bw, base)[0], p(x + bw, base)[1]],
            radius=int(bw / 2 * K),
            fill=(255, 255, 255, 255),
        )
    icon = compose(icon, layer, alpha=0.22, blur=9)
    tipx = start + 2 * (bw + gap) + bw / 2
    return warm_dot(icon, tipx, base - 608 - 62, 31)


CONCEPTS = [
    ("a", "方案 A · 夕弧与晨点", "新月弧线环抱一枚晨光点：夕与朝的对话", concept_a),
    ("b", "方案 B · 日出东方", "圆日悬于地平线之上：极简几何", concept_b),
    ("c", "方案 C · 精炼对勾", "品牌延续：更轻更舒展的对勾 + 晨光点", concept_c),
    ("d", "方案 D · 山与朝日", "地平线之上圆丘起伏，一枚初升的暖阳", concept_d),
    ("e", "方案 E · 层叠工作台", "三张悬浮卡片：秩序与沉淀", concept_e),
    ("f", "方案 F · 拾级而上", "三阶渐高 + 顶上暖光：朝有所为，夕有所成", concept_f),
]

def main():
    OUT = ROOT / "preview"
    OUT.mkdir(exist_ok=True)
    rendered = []
    for key, name, desc, fn in CONCEPTS:
        icon = fn().resize((S, S), Image.LANCZOS)
        path = OUT / f"logo-{key}.png"
        icon.save(path)
        rendered.append((key, name, icon))
        print("written:", path)

    # ── 对比图（浅底 + 名称 + 小尺寸检视）──
    font_path = "C:/Windows/Fonts/msyh.ttc"
    try:
        font = ImageFont.truetype(font_path, 40)
    except Exception:
        font = ImageFont.load_default()

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
    sheet_path = OUT / "logo-sheet.png"
    sheet.save(sheet_path)
    print("written:", sheet_path)


if __name__ == "__main__":
    main()
