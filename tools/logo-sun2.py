#!/usr/bin/env python3
"""「卡片太阳」增强版：更像卡片的圆角卡片光芒（内容线/材质/长短错落）。

输出 preview2/logo-t1/2/3.png + logo-sheet-sun2.png
"""
import importlib.util
from math import radians, sin, cos
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


def ray_card2(w=56, h=172, radius=None, alpha=214, gloss=0.26, warm_tip=0.0):
    """一张"卡片光芒"：圆角卡面 + 顶部光泽 + 底部内阴影 + 内文条（+外端暖色）。"""
    rw, rh = int(w * K), int(h * K)
    rr = int((radius if radius is not None else w * 0.42) * K)
    img = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=(255, 255, 255, alpha))
    mask = Image.new("L", (rw, rh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=255)
    # 顶部光泽
    gl = Image.new("L", (rw, rh), 0)
    gl.paste(ImageOps.invert(Image.linear_gradient("L")).resize((rw, int(rh * 0.55))), (0, 0))
    gl = ImageChops.multiply(gl, mask).point(lambda v: int(v * gloss))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 255), gl)))
    # 底部内阴影
    bt = Image.new("L", (rw, rh), 0)
    bt.paste(Image.linear_gradient("L").resize((rw, int(rh * 0.45))), (0, int(rh * 0.55)))
    bt = ImageChops.multiply(bt, mask).point(lambda v: int(v * 0.12))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 26), Image.new("L", (rw, rh), 22), Image.new("L", (rw, rh), 74), bt)))
    # 内文条（卡片内容）
    bw2, bh2 = int(rw * 0.46), int(rh * 0.055)
    bx = (rw - bw2) // 2
    by = int(rh * 0.56)
    ImageDraw.Draw(img).rounded_rectangle([bx, by, bx + bw2, by + bh2], radius=bh2 // 2, fill=(64, 58, 120, 64))
    # 外端暖色
    if warm_tip > 0:
        warm = Image.new("L", (rw, rh), 0)
        warm.paste(ImageOps.invert(Image.linear_gradient("L")).resize((rw, int(rh * 0.45))), (0, 0))
        warm = ImageChops.multiply(warm, mask).point(lambda v: int(v * warm_tip))
        col = Image.merge("RGBA", (Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 178), Image.new("L", (rw, rh), 104), warm))
        img = Image.alpha_composite(img, col)
    return img


def sun_rays2(icon, specs, tip_warm=0.0):
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    for ang, w, h, dist in specs:
        ray = ray_card2(w=w, h=h, warm_tip=tip_warm)
        rot = ray.rotate(-ang, resample=Image.BICUBIC, expand=True)
        dx, dy = sin(radians(ang)), -cos(radians(ang))
        cx = 512 + dx * dist
        cy = 512 + dy * dist
        layer.paste(rot, (int(cx * K - rot.size[0] / 2), int(cy * K - rot.size[1] / 2)), rot)
    return compose(icon, layer, alpha=0.22, blur=9)


def warm_core(icon, r=130):
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
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 252), Image.new("L", (W, W), 240), hl)))
    rim = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    bbox = [p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]]
    rd.arc(bbox, 25, 155, fill=(255, 232, 190, 165), width=int(11 * K))
    return Image.alpha_composite(icon, rim)


SPECS8 = [  # 4 长（正方向）+ 4 短（对角）
    (0, 56, 176, 270),
    (45, 52, 146, 252),
    (90, 56, 176, 270),
    (135, 52, 146, 252),
    (180, 56, 176, 270),
    (225, 52, 146, 252),
    (270, 56, 176, 270),
    (315, 52, 146, 252),
]

SPECS6 = [(k * 60, 64, 182, 274) for k in range(6)]


def t1():
    icon = lc.base_icon()
    icon = sun_rays2(icon, SPECS8)
    return warm_core(icon, 128)


def t2():
    icon = lc.base_icon()
    icon = sun_rays2(icon, SPECS6)
    return warm_core(icon, 122)


def t3():
    icon = lc.base_icon()
    icon = sun_rays2(icon, SPECS8, tip_warm=0.62)
    return warm_core(icon, 128)


VARIANTS = [
    ("t1", "T1 · 八卡朝阳（4长4短）", t1),
    ("t2", "T2 · 六卡环绕", t2),
    ("t3", "T3 · 八卡暖芒", t3),
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
        sd.text((cx + 130, 70 + 640 + 70), name, fill=(29, 29, 31), font=font)
        sheet.paste(mini, (cx + 560, 70 + 640 + 52), mini)
    sheet.save(OUT / "logo-sheet-sun2.png")
    print("written:", OUT / "logo-sheet-sun2.png")


if __name__ == "__main__":
    main()
