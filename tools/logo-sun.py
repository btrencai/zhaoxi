#!/usr/bin/env python3
"""「卡片太阳」概念：白色卡片化作放射光芒 + 暖色核心。

输出 preview2/logo-s1/2/3.png + logo-sheet-sun.png
"""
import importlib.util
from math import cos, radians, sin
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("logo_concepts", ROOT / "tools" / "logo-concepts.py")
lc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lc)

W, K, S = lc.W, lc.K, lc.S
p = lc.p
MASK = lc.MASK
compose = lc.compose
lerp = lc.lerp

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


def ray_card(w=44, h=150, radius=22, alpha=232, tip_warm=False):
    """一根"卡片光芒"：圆角胶囊 + 顶部光泽 + 底部内阴影（+可选外端暖色）。"""
    rw, rh = int(w * K), int(h * K)
    rr = int(radius * K)
    img = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=(255, 255, 255, alpha))
    mask = Image.new("L", (rw, rh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=255)
    gloss = Image.new("L", (rw, rh), 0)
    gloss.paste(ImageOps.invert(Image.linear_gradient("L")).resize((rw, int(rh * 0.55))), (0, 0))
    gloss = ImageChops.multiply(gloss, mask).point(lambda v: int(v * 0.20))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 255), gloss)))
    bot = Image.new("L", (rw, rh), 0)
    bot.paste(Image.linear_gradient("L").resize((rw, int(rh * 0.45))), (0, int(rh * 0.55)))
    bot = ImageChops.multiply(bot, mask).point(lambda v: int(v * 0.12))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 26), Image.new("L", (rw, rh), 22), Image.new("L", (rw, rh), 74), bot)))
    if tip_warm:
        warm = Image.new("L", (rw, rh), 0)
        warm.paste(ImageOps.invert(Image.linear_gradient("L")).resize((rw, int(rh * 0.55))), (0, 0))
        warm = ImageChops.multiply(warm, mask).point(lambda v: int(v * 0.80))
        col = Image.merge("RGBA", (Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 178), Image.new("L", (rw, rh), 104), warm))
        img = Image.alpha_composite(img, col)
    return img


def sun_rays(icon, count, w, h, dist, tip_warm=False):
    ray = ray_card(w=w, h=h, tip_warm=tip_warm)
    rw, rh = ray.size
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    for k in range(count):
        a = k * 360.0 / count
        rot = ray.rotate(-a, resample=Image.BICUBIC, expand=True)
        dx, dy = sin(radians(a)), -cos(radians(a))
        cx = 512 + dx * dist
        cy = 512 + dy * dist
        layer.paste(rot, (int(cx * K - rot.size[0] / 2), int(cy * K - rot.size[1] / 2)), rot)
    icon = compose(icon, layer, alpha=0.22, blur=9)
    return icon


def warm_core(icon, r=132):
    cx = cy = 512
    halo = Image.new("L", (W, W), 0)
    ImageDraw.Draw(halo).ellipse([p(cx - r * 1.9, cy - r * 1.9)[0], p(cx - r * 1.9, cy - r * 1.9)[1], p(cx + r * 1.9, cy + r * 1.9)[0], p(cx + r * 1.9, cy + r * 1.9)[1]], fill=90)
    halo = halo.filter(ImageFilter.GaussianBlur(40 * K))
    halo = ImageChops.multiply(halo, MASK)
    hlc = Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 196), Image.new("L", (W, W), 128), halo))
    icon = Image.alpha_composite(icon, hlc)
    dia = int(2 * r * K)
    core = grad_box((dia, dia), [(0.0, (0xFF, 0xEC, 0xCE)), (0.45, (0xFF, 0xB9, 0x78)), (1.0, (0xEF, 0x6F, 0x6A))])
    cm = Image.new("L", (W, W), 0)
    ImageDraw.Draw(cm).ellipse([p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]], fill=255)
    bx, by = int(p(cx - r, cy - r)[0]), int(p(cx - r, cy - r)[1])
    icon.paste(core, (bx, by), cm.crop((bx, by, bx + dia, by + dia)))
    hl = Image.new("L", (W, W), 0)
    hx, hy, hr = cx - r * 0.38, cy - r * 0.44, r * 0.52
    ImageDraw.Draw(hl).ellipse([p(hx - hr, hy - hr)[0], p(hx - hr, hy - hr)[1], p(hx + hr, hy + hr)[0], p(hx + hr, hy + hr)[1]], fill=190)
    hl = hl.filter(ImageFilter.GaussianBlur(22 * K))
    hl = ImageChops.multiply(hl, cm)
    hlc2 = Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 252), Image.new("L", (W, W), 240), hl))
    icon = Image.alpha_composite(icon, hlc2)
    rim = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    bbox = [p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]]
    rd.arc(bbox, 25, 155, fill=(255, 232, 190, 165), width=int(11 * K))
    return Image.alpha_composite(icon, rim)


def s1():
    icon = lc.base_icon()
    icon = sun_rays(icon, 8, 44, 150, 272)
    return warm_core(icon, 132)


def s2():
    icon = lc.base_icon()
    icon = sun_rays(icon, 12, 34, 126, 252)
    return warm_core(icon, 112)


def s3():
    icon = lc.base_icon()
    icon = sun_rays(icon, 8, 44, 150, 272, tip_warm=True)
    return warm_core(icon, 132)


VARIANTS = [
    ("s1", "S1 · 八芒朝阳", s1),
    ("s2", "S2 · 十二芒（细密）", s2),
    ("s3", "S3 · 暖芒（光芒带晨色）", s3),
]


def main():
    from PIL import ImageFont

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
    sheet = Image.new("RGB", (cell_w * len(rendered), cell_h), (244, 244, 247))
    sd = ImageDraw.Draw(sheet)
    for idx, (name, icon) in enumerate(rendered):
        cx = idx * cell_w
        big = icon.resize((640, 640), Image.LANCZOS)
        sheet.paste(big, (cx + (cell_w - 640) // 2, 70), big)
        mini = icon.resize((96, 96), Image.LANCZOS)
        sd.text((cx + 150, 70 + 640 + 70), name, fill=(29, 29, 31), font=font)
        sheet.paste(mini, (cx + 560, 70 + 640 + 52), mini)
    sheet.save(OUT / "logo-sheet-sun.png")
    print("written:", OUT / "logo-sheet-sun.png")


if __name__ == "__main__":
    main()
