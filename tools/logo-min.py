#!/usr/bin/env python3
"""极简卡片系：做减法后的三个方向。

W1 叠卡轻扇（3 张卡轻扇 + 晨点）/ W2 四卡环阳（4 张卡环绕 + 中央暖阳）/ W3 半扇极简（5 卡扇 + 微光）
输出 preview2/logo-w1/2/3.png + logo-sheet-min.png
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
warm_dot = lc.warm_dot

WHITE_L = Image.new("L", (W, W), 255)


def card(w, h, radius=None, alpha=228, gloss=0.20):
    """极简卡面：无内容线，仅光泽 + 微内影。"""
    rw, rh = int(w * K), int(h * K)
    rr = int((radius if radius is not None else h * 0.30) * K)
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


def place(icon, card_img, cx, cy, rot, shadow=0.30):
    rot_img = card_img.rotate(rot, resample=Image.BICUBIC, expand=True)
    px, py = int(cx * K - rot_img.size[0] / 2), int(cy * K - rot_img.size[1] / 2)
    region = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sh_canvas = Image.new("L", (W, W), 0)
    blurred = rot_img.filter(ImageFilter.GaussianBlur(8 * K))
    sh_canvas.paste(blurred.split()[3], (px, py))
    salpha = sh_canvas.point(lambda v: int(v * shadow))
    shl = Image.merge("RGBA", (Image.new("L", (W, W), 20), Image.new("L", (W, W), 15), Image.new("L", (W, W), 58), salpha))
    shl = ImageChops.offset(shl, 0, int(8 * K))
    shl = Image.composite(shl, Image.new("RGBA", (W, W), (0, 0, 0, 0)), MASK)
    region = Image.alpha_composite(region, shl)
    region.paste(rot_img, (px, py), rot_img)
    return Image.alpha_composite(icon, region)


def w1():
    """叠卡轻扇：L 的 3 张卡轻扇开 + 晨点。"""
    icon = lc.base_icon()
    c = card(452, 204, radius=60)
    for cyc, rot in [(378, -7.0), (492, 0.0), (606, 7.0)]:
        icon = place(icon, c, 512, cyc, rot)
    return warm_dot(icon, 700, 552, 35)


def w2():
    """四卡环阳：4 张卡环绕、中央透出暖阳。"""
    icon = lc.base_icon()
    c = card(420, 180, radius=54)
    d = 150
    for pos, rot in [(0, 0), (90, 90), (180, 0), (270, 90)]:
        a = radians(pos)
        px = 512 + sin(a) * d
        py = 512 - cos(a) * d
        icon = place(icon, c, px, py, rot)
    return warm_dot(icon, 512, 512, 72)


def w3():
    """半扇极简：5 卡扇开 120°，微光。"""
    icon = lc.base_icon()
    m = Image.new("L", (W, W), 0)
    ImageDraw.Draw(m).ellipse([p(512 - 230, 540 - 230)[0], p(512 - 230, 540 - 230)[1], p(512 + 230, 540 + 230)[0], p(512 + 230, 540 + 230)[1]], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(38 * K)).point(lambda v: int(v * 0.30))
    m = ImageChops.multiply(m, MASK)
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 190), Image.new("L", (W, W), 112), m)))
    c = card(200, 330, radius=28)
    for k in range(5):
        a = -60 + k * 30
        px = 512 + sin(radians(a)) * 176
        py = 712 - cos(radians(a)) * 176
        icon = place(icon, c, px, py, -a, shadow=0.26)
    return icon


VARIANTS = [
    ("w1", "W1 · 叠卡轻扇", w1),
    ("w2", "W2 · 四卡环阳", w2),
    ("w3", "W3 · 半扇极简", w3),
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
    sheet.save(OUT / "logo-sheet-min.png")
    print("written:", OUT / "logo-sheet-min.png")


if __name__ == "__main__":
    main()
