#!/usr/bin/env python3
"""一圈不重叠的卡片 + 中间太阳团（4/6/8 卡）。

输出 preview2/logo-x1/2/3.png + logo-sheet-ring2.png
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


def card(w, h, radius=None, alpha=232, gloss=0.18):
    rw, rh = int(w * K), int(h * K)
    rr = int((radius if radius is not None else h * 0.26) * K)
    img = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=(255, 255, 255, alpha))
    mask = Image.new("L", (rw, rh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=255)
    gl = Image.new("L", (rw, rh), 0)
    gl.paste(ImageOps.invert(Image.linear_gradient("L")).resize((rw, int(rh * 0.55))), (0, 0))
    gl = ImageChops.multiply(gl, mask).point(lambda v: int(v * gloss))
    wo = Image.new("L", (rw, rh), 255)
    img = Image.alpha_composite(img, Image.merge("RGBA", (wo, wo, wo, gl)))
    bt = Image.new("L", (rw, rh), 0)
    bt.paste(Image.linear_gradient("L").resize((rw, int(rh * 0.35))), (0, int(rh * 0.65)))
    bt = ImageChops.multiply(bt, mask).point(lambda v: int(v * 0.10))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 26), Image.new("L", (rw, rh), 22), Image.new("L", (rw, rh), 74), bt)))
    return img


def place(icon, card_img, cx, cy, rot, shadow=0.28):
    rot_img = card_img.rotate(rot, resample=Image.BICUBIC, expand=True)
    px, py = int(cx * K - rot_img.size[0] / 2), int(cy * K - rot_img.size[1] / 2)
    region = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sh_canvas = Image.new("L", (W, W), 0)
    blurred = rot_img.filter(ImageFilter.GaussianBlur(7 * K))
    sh_canvas.paste(blurred.split()[3], (px, py))
    salpha = sh_canvas.point(lambda v: int(v * shadow))
    shl = Image.merge("RGBA", (Image.new("L", (W, W), 20), Image.new("L", (W, W), 15), Image.new("L", (W, W), 58), salpha))
    shl = ImageChops.offset(shl, 0, int(7 * K))
    shl = Image.composite(shl, Image.new("RGBA", (W, W), (0, 0, 0, 0)), MASK)
    region = Image.alpha_composite(region, shl)
    region.paste(rot_img, (px, py), rot_img)
    return Image.alpha_composite(icon, region)


def sun_ball(icon, r):
    cx = cy = 512
    halo = Image.new("L", (W, W), 0)
    ImageDraw.Draw(halo).ellipse([p(cx - r * 1.75, cy - r * 1.75)[0], p(cx - r * 1.75, cy - r * 1.75)[1], p(cx + r * 1.75, cy + r * 1.75)[0], p(cx + r * 1.75, cy + r * 1.75)[1]], fill=86)
    halo = halo.filter(ImageFilter.GaussianBlur(36 * K))
    halo = ImageChops.multiply(halo, MASK)
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 198), Image.new("L", (W, W), 130), halo)))
    dia = int(2 * r * K)
    core = grad_box((dia, dia), [(0.0, (0xFF, 0xEC, 0xCE)), (0.45, (0xFF, 0xB9, 0x78)), (1.0, (0xEF, 0x6F, 0x6A))])
    cm = Image.new("L", (W, W), 0)
    ImageDraw.Draw(cm).ellipse([p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]], fill=255)
    bx, by = int(p(cx - r, cy - r)[0]), int(p(cx - r, cy - r)[1])
    icon.paste(core, (bx, by), cm.crop((bx, by, bx + dia, by + dia)))
    hl = Image.new("L", (W, W), 0)
    hx, hy, hr = cx - r * 0.38, cy - r * 0.44, r * 0.5
    ImageDraw.Draw(hl).ellipse([p(hx - hr, hy - hr)[0], p(hx - hr, hy - hr)[1], p(hx + hr, hy + hr)[0], p(hx + hr, hy + hr)[1]], fill=185)
    hl = hl.filter(ImageFilter.GaussianBlur(20 * K))
    hl = ImageChops.multiply(hl, cm)
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 252), Image.new("L", (W, W), 240), hl)))
    rim = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    bbox = [p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]]
    rd.arc(bbox, 25, 155, fill=(255, 232, 190, 160), width=int(10 * K))
    return Image.alpha_composite(icon, rim)


def ring_of(n, cw, ch, dist, sun_r, radius=None):
    icon = lc.base_icon()
    c = card(cw, ch, radius=radius)
    for k in range(n):
        a = k * 360.0 / n
        px = 512 + sin(radians(a)) * dist
        py = 512 - cos(radians(a)) * dist
        icon = place(icon, c, px, py, -a)
    return sun_ball(icon, sun_r)


def x1():
    return ring_of(6, 156, 104, 296, 142)


def x2():
    return ring_of(8, 132, 90, 306, 150)


def x3():
    return ring_of(4, 184, 120, 288, 158)


VARIANTS = [
    ("x1", "X1 · 六卡环日", x1),
    ("x2", "X2 · 八卡环日", x2),
    ("x3", "X3 · 四卡环日", x3),
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
        sd.text((cx + 170, 70 + 640 + 70), name, fill=(29, 29, 31), font=font)
        sheet.paste(mini, (cx + 560, 70 + 640 + 52), mini)
    sheet.save(OUT / "logo-sheet-ring2.png")
    print("written:", OUT / "logo-sheet-ring2.png")


if __name__ == "__main__":
    main()
