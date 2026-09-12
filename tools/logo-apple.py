#!/usr/bin/env python3
"""Apple 式极简方案：晨昏环 / 太团 / 日出穹顶 / 汉字。

输出 preview2/logo-p1..p4.png + logo-sheet-apple.png
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
lerp = lc.lerp
compose = lc.compose
warm_dot = lc.warm_dot

WHITE_L = Image.new("L", (W, W), 255)


def grad_box(size, stops):
    def sample(stops, t):
        if t <= stops[0][0]:
            return stops[0][1]
        for i in range(len(stops) - 1):
            t0, c0 = stops[i]
            t1, c1 = stops[i + 1]
            if t0 <= t <= t1:
                return lerp(c0, c1, (t - t0) / (t1 - t0))
        return stops[-1][1]

    img = Image.new("RGBA", size)
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        d.line([(0, y), (size[0], y)], fill=sample(stops, y / max(1, size[1] - 1)) + (255,))
    return img


def p1():
    """晨昏环：一圈环形渐变（昼白 → 昏暖），单一元素。"""
    icon = lc.base_icon()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = cy = 512
    R, wd = 256, 70
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
        col = lerp((255, 255, 255), (0xFF, 0xB4, 0x6B), tt)
        d.arc(bbox, a0, a1, fill=col + (255,), width=wd_px)
    return compose(icon, layer, alpha=0.20, blur=9)


def p2():
    """太团：一颗暖阳圆球，别无他物。"""
    icon = lc.base_icon()
    r = 272
    cx = cy = 512
    halo = Image.new("L", (W, W), 0)
    ImageDraw.Draw(halo).ellipse([p(cx - r * 1.6, cy - r * 1.6)[0], p(cx - r * 1.6, cy - r * 1.6)[1], p(cx + r * 1.6, cy + r * 1.6)[0], p(cx + r * 1.6, cy + r * 1.6)[1]], fill=80)
    halo = halo.filter(ImageFilter.GaussianBlur(40 * K))
    halo = ImageChops.multiply(halo, MASK)
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 196), Image.new("L", (W, W), 128), halo)))
    dia = int(2 * r * K)
    core = grad_box((dia, dia), [(0.0, (0xFF, 0xEE, 0xD2)), (0.42, (0xFF, 0xBA, 0x7A)), (1.0, (0xEE, 0x6C, 0x62))])
    cm = Image.new("L", (W, W), 0)
    ImageDraw.Draw(cm).ellipse([p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]], fill=255)
    bx, by = int(p(cx - r, cy - r)[0]), int(p(cx - r, cy - r)[1])
    icon.paste(core, (bx, by), cm.crop((bx, by, bx + dia, by + dia)))
    hl = Image.new("L", (W, W), 0)
    hx, hy, hr = cx - r * 0.36, cy - r * 0.42, r * 0.5
    ImageDraw.Draw(hl).ellipse([p(hx - hr, hy - hr)[0], p(hx - hr, hy - hr)[1], p(hx + hr, hy + hr)[0], p(hx + hr, hy + hr)[1]], fill=160)
    hl = hl.filter(ImageFilter.GaussianBlur(30 * K))
    hl = ImageChops.multiply(hl, cm)
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 252), Image.new("L", (W, W), 242), hl)))
    sh = Image.new("L", (W, W), 0)
    ImageDraw.Draw(sh).ellipse([p(cx - 200, 748)[0], p(cx - 200, 748)[1], p(cx + 200, 796)[0], p(cx + 200, 796)[1]], fill=100)
    sh = sh.filter(ImageFilter.GaussianBlur(22 * K)).point(lambda v: int(v * 0.4))
    shl = Image.merge("RGBA", (Image.new("L", (W, W), 24), Image.new("L", (W, W), 18), Image.new("L", (W, W), 70), sh))
    return Image.alpha_composite(icon, shl)


def p3():
    """日出穹顶：暖色半轮 + 一线地平线。"""
    icon = lc.base_icon()
    r = 238
    cy = 620
    halo = Image.new("L", (W, W), 0)
    ImageDraw.Draw(halo).ellipse([p(512 - r * 1.5, cy - r * 1.5)[0], p(512 - r * 1.5, cy - r * 1.5)[1], p(512 + r * 1.5, cy + r * 1.5)[0], p(512 + r * 1.5, cy + r * 1.5)[1]], fill=84)
    halo = halo.filter(ImageFilter.GaussianBlur(42 * K))
    halo = ImageChops.multiply(halo, MASK)
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 196), Image.new("L", (W, W), 128), halo)))
    dia = int(2 * r * K)
    core = grad_box((dia, dia), [(0.0, (0xFF, 0xEE, 0xD2)), (0.5, (0xFF, 0xBA, 0x7A)), (1.0, (0xF0, 0x74, 0x64))])
    dome = Image.new("L", (W, W), 0)
    ImageDraw.Draw(dome).pieslice([p(512 - r, cy - r)[0], p(512 - r, cy - r)[1], p(512 + r, cy + r)[0], p(512 + r, cy + r)[1]], 180, 360, fill=255)
    bx, by = int(p(512 - r, cy - r)[0]), int(p(512 - r, cy - r)[1])
    icon.paste(core, (bx, by), dome.crop((bx, by, bx + dia, by + dia)))
    line = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    lw, lh = 520, 22
    ImageDraw.Draw(line).rounded_rectangle(
        [p(512 - lw / 2, cy + 30)[0], p(512 - lw / 2, cy + 30)[1], p(512 + lw / 2, cy + 30 + lh)[0], p(512 + lw / 2, cy + 30 + lh)[1]],
        radius=int(lh / 2 * K),
        fill=(255, 255, 255, 240),
    )
    return Image.alpha_composite(icon, line)


def p4():
    """汉字「朝」：现代宋体 + 晨光点。"""
    icon = lc.base_icon()
    font = ImageFont.truetype("C:/Windows/Fonts/STZHONGS.TTF", int(456 * K))
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text(p(512, 518), "朝", font=font, fill=(255, 255, 255, 255), anchor="mm", stroke_width=int(9 * K), stroke_fill=(255, 255, 255, 255))
    icon = compose(icon, layer, alpha=0.20, blur=10)
    return warm_dot(icon, 762, 288, 34)


VARIANTS = [
    ("p1", "P1 · 晨昏环", p1),
    ("p2", "P2 · 太团（单圆）", p2),
    ("p3", "P3 · 日出穹顶", p3),
    ("p4", "P4 · 汉字「朝」", p4),
]


def main():
    OUT = ROOT / "preview2"
    OUT.mkdir(exist_ok=True)
    rendered = []
    for key, name, fn in VARIANTS:
        icon = fn().resize((S, S), Image.LANCZOS)
        icon.save(OUT / f"logo-{key}.png")
        rendered.append((name, icon))
        print("written:", OUT / f"logo-{key}.png")

    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 40)
    cell_w, cell_h = 800, 980
    cols = 2
    rows = 2
    sheet = Image.new("RGB", (cell_w * cols, cell_h * rows), (244, 244, 247))
    sd = ImageDraw.Draw(sheet)
    for idx, (name, icon) in enumerate(rendered):
        cx = (idx % cols) * cell_w
        cy = (idx // cols) * cell_h
        big = icon.resize((640, 640), Image.LANCZOS)
        sheet.paste(big, (cx + (cell_w - 640) // 2, cy + 70), big)
        mini = icon.resize((96, 96), Image.LANCZOS)
        sd.text((cx + 170, cy + 70 + 640 + 70), name, fill=(29, 29, 31), font=font)
        sheet.paste(mini, (cx + 560, cy + 70 + 640 + 52), mini)
    sheet.save(OUT / "logo-sheet-apple.png")
    print("written:", OUT / "logo-sheet-apple.png")


if __name__ == "__main__":
    main()
