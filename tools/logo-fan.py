#!/usr/bin/env python3
"""「扇形卡片 · 日出」：一手牌扇形展开，轮廓即一轮升起的太阳。

V1 七卡扇形 / V2 五卡扇形 / V3 九卡扇形
输出 preview2/logo-v1/2/3.png + logo-sheet-fan.png
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

WHITE_L = Image.new("L", (W, W), 255)


def fan_card(w=200, h=330, radius=None, alpha=222, gloss=0.24):
    """一张扇形手牌（竖向）：卡面 + 光泽 + 内文条 + 底部内阴影。"""
    rw, rh = int(w * K), int(h * K)
    rr = int((radius if radius is not None else w * 0.14) * K)
    img = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=(255, 255, 255, alpha))
    mask = Image.new("L", (rw, rh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=255)
    gl = Image.new("L", (rw, rh), 0)
    gl.paste(ImageOps.invert(Image.linear_gradient("L")).resize((rw, int(rh * 0.55))), (0, 0))
    gl = ImageChops.multiply(gl, mask).point(lambda v: int(v * gloss))
    white_lo = Image.new("L", (rw, rh), 255)
    img = Image.alpha_composite(img, Image.merge("RGBA", (white_lo, white_lo, white_lo, gl)))
    bt = Image.new("L", (rw, rh), 0)
    bt.paste(Image.linear_gradient("L").resize((rw, int(rh * 0.40))), (0, int(rh * 0.60)))
    bt = ImageChops.multiply(bt, mask).point(lambda v: int(v * 0.12))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 26), Image.new("L", (rw, rh), 22), Image.new("L", (rw, rh), 74), bt)))
    # 内文条：两条（更像"内容卡片"）
    bw1 = int(rw * 0.52)
    bh2 = max(2, int(rh * 0.035))
    bx = int(rw * 0.16)
    by = int(rh * 0.30)
    ImageDraw.Draw(img).rounded_rectangle([bx, by, bx + bw1, by + bh2], radius=bh2 // 2, fill=(64, 58, 120, 54))
    return img


def place(icon, card_img, cx, cy, rot):
    rot_img = card_img.rotate(rot, resample=Image.BICUBIC, expand=True)
    px, py = int(cx * K - rot_img.size[0] / 2), int(cy * K - rot_img.size[1] / 2)
    region = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sh_canvas = Image.new("L", (W, W), 0)
    blurred = rot_img.filter(ImageFilter.GaussianBlur(9 * K))
    sh_canvas.paste(blurred.split()[3], (px, py))
    salpha = sh_canvas.point(lambda v: int(v * 0.33))
    shl = Image.merge("RGBA", (Image.new("L", (W, W), 20), Image.new("L", (W, W), 15), Image.new("L", (W, W), 58), salpha))
    shl = ImageChops.offset(shl, 0, int(9 * K))
    shl = Image.composite(shl, Image.new("RGBA", (W, W), (0, 0, 0, 0)), MASK)
    region = Image.alpha_composite(region, shl)
    region.paste(rot_img, (px, py), rot_img)
    return Image.alpha_composite(icon, region)


def warm_glow(icon, cx, cy, r, amt=0.34):
    m = Image.new("L", (W, W), 0)
    ImageDraw.Draw(m).ellipse([p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(36 * K)).point(lambda v: int(v * amt))
    m = ImageChops.multiply(m, MASK)
    c = Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 170), Image.new("L", (W, W), 80), m))
    return Image.alpha_composite(icon, c)


def horizon(icon, lw=470, lh=13, ly=747, amax=218):
    lw_px, lh_px = int(lw * K), int(lh * K)
    m = Image.new("L", (lw_px, lh_px), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, lw_px - 1, lh_px - 1], radius=lh_px // 2, fill=255)
    fade = Image.new("L", (lw_px, 1), 0)
    fp = fade.load()
    for x in range(lw_px):
        t = x / (lw_px - 1)
        w = 1.0 - abs(t - 0.5) * 2
        fp[x, 0] = int(255 * (w ** 0.7))
    fade = fade.resize((lw_px, lh_px))
    m = ImageChops.multiply(m, fade).point(lambda v: int(v * amax / 255))
    line_img = Image.new("RGBA", (lw_px, lh_px), (255, 255, 255, 255))
    line_img.putalpha(m)
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    layer.paste(line_img, (int(512 * K - lw_px / 2), int(ly * K)))
    return Image.alpha_composite(icon, layer)


def fan(n, step, cw, ch, pivot_y, dist):
    icon = lc.base_icon()
    icon = warm_glow(icon, 512, 540, 238, amt=0.52)
    icon = warm_glow(icon, 512, 528, 128, amt=0.45)  # 晨光从卡后透出
    c = fan_card(cw, ch)
    a0 = -(n - 1) * step / 2.0
    for k in range(n):
        a = a0 + k * step
        px = 512 + sin(radians(a)) * dist
        py = pivot_y - cos(radians(a)) * dist
        icon = place(icon, c, px, py, -a)
    return horizon(icon)


def v1():
    return fan(7, 30, 200, 330, 712, 176)


def v2():
    return fan(5, 34, 216, 330, 712, 180)


def v3():
    return fan(9, 21, 188, 326, 712, 172)


VARIANTS = [
    ("v1", "V1 · 七卡扇形", v1),
    ("v2", "V2 · 五卡扇形", v2),
    ("v3", "V3 · 九卡扇形", v3),
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
    sheet.save(OUT / "logo-sheet-fan.png")
    print("written:", OUT / "logo-sheet-fan.png")


if __name__ == "__main__":
    main()
