#!/usr/bin/env python3
"""L 方案改良终版：立体叠卡 + 晨光叙事。

- L2b：日出卡后（顶卡更透、日光软边、光在卡面弥散）
- L2c：晨点入卡（原布局优化）
输出 preview2/logo-l2b.png / l2c.png + logo-sheet-l2.png（含原版对照）
"""
import importlib.util
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

CARDS = [(366, -3.0, 196), (484, 0.0, 230), (602, 3.0, 255)]
CARDS_FROSTED = [(366, -3.0, 156), (484, 0.0, 226), (602, 3.0, 255)]


def draw_cards(icon, cards, cw=470, ch=212, radius=64):
    """三张玻璃感卡片：光泽 + 底部内阴影 + 细玻璃边缘 + 层间投影。"""
    for cyc, rot, al in cards:
        lay = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        top_y = (cyc - ch / 2) * K
        box = [
            p(512 - cw / 2, cyc - ch / 2)[0],
            p(512 - cw / 2, cyc - ch / 2)[1],
            p(512 + cw / 2, cyc + ch / 2)[0],
            p(512 + cw / 2, cyc + ch / 2)[1],
        ]
        rad = int(radius * K)
        d.rounded_rectangle(box, radius=rad, fill=(255, 255, 255, al))
        card_mask = Image.new("L", (W, W), 0)
        ImageDraw.Draw(card_mask).rounded_rectangle(box, radius=rad, fill=255)
        band = int(ch * 0.60 * K)
        gloss = Image.new("L", (W, W), 0)
        gloss.paste(ImageOps.invert(Image.linear_gradient("L")).resize((W, band)), (0, int(top_y)))
        gloss = ImageChops.multiply(gloss, card_mask).point(lambda v: int(v * 0.24))
        lay = Image.alpha_composite(lay, Image.merge("RGBA", (WHITE_L, WHITE_L, WHITE_L, gloss)))
        band2 = int(ch * 0.40 * K)
        bot = Image.new("L", (W, W), 0)
        bot.paste(Image.linear_gradient("L").resize((W, band2)), (0, int(top_y) + int(ch * 0.60 * K)))
        bot = ImageChops.multiply(bot, card_mask).point(lambda v: int(v * 0.14))
        lay = Image.alpha_composite(lay, Image.merge("RGBA", (Image.new("L", (W, W), 26), Image.new("L", (W, W), 22), Image.new("L", (W, W), 74), bot)))
        ImageDraw.Draw(lay).rounded_rectangle(box, radius=rad, outline=(255, 255, 255, 130), width=int(3 * K))
        lay = lay.rotate(rot, resample=Image.BICUBIC, center=p(512, cyc))
        sh = lay.filter(ImageFilter.GaussianBlur(11 * K))
        salpha = sh.split()[3].point(lambda v: int(v * 0.42))
        shl = Image.merge("RGBA", (Image.new("L", (W, W), 22), Image.new("L", (W, W), 16), Image.new("L", (W, W), 64), salpha))
        shl = ImageChops.offset(shl, 0, int(12 * K))
        shl = Image.composite(shl, Image.new("RGBA", (W, W), (0, 0, 0, 0)), MASK)
        icon = Image.alpha_composite(icon, shl)
        icon = Image.alpha_composite(icon, lay)
    return icon


def warm_diffuse(icon, cx, cy, r=96, amt=0.32):
    """暖光扩散：让晨光"透过"磨砂卡面向下弥散。"""
    m = Image.new("L", (W, W), 0)
    ImageDraw.Draw(m).ellipse([p(cx - r, cy - r)[0], p(cx - r, cy - r)[1], p(cx + r, cy + r)[0], p(cx + r, cy + r)[1]], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(28 * K)).point(lambda v: int(v * amt))
    m = ImageChops.multiply(m, MASK)
    c = Image.merge("RGBA", (Image.new("L", (W, W), 255), Image.new("L", (W, W), 208), Image.new("L", (W, W), 140), m))
    return Image.alpha_composite(icon, c)


def soft_sun(icon, cx, cy, r):
    """柔边暖阳：更大光晕 + 轻微模糊的圆边（避免"灯泡感"）。"""
    sx, sy, sr = cx * K, cy * K, r * K
    halo = Image.new("L", (W, W), 0)
    ImageDraw.Draw(halo).ellipse([sx - sr * 2.6, sy - sr * 2.6, sx + sr * 2.6, sy + sr * 2.6], fill=88)
    halo = halo.filter(ImageFilter.GaussianBlur(26 * K))
    halo = ImageChops.multiply(halo, MASK)
    warmc = Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 210), Image.new("L", (W, W), 142), halo))
    icon = Image.alpha_composite(icon, warmc)
    dot = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(dot).ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 228, 172, 255))
    dot = dot.filter(ImageFilter.GaussianBlur(2.5 * K))
    return Image.alpha_composite(icon, dot)


def l2b():
    """日出卡后 · 居中：顶卡更透 + 日光软边 + 光在卡面弥散。"""
    icon = lc.base_icon()
    icon = soft_sun(icon, 512, 258, 45)
    icon = draw_cards(icon, CARDS_FROSTED)
    icon = warm_diffuse(icon, 512, 300, r=100, amt=0.40)
    return warm_diffuse(icon, 512, 270, r=54, amt=0.45)


def l2c():
    """晨点入卡：晨光落在前卡上（原布局优化）。"""
    icon = lc.base_icon()
    icon = draw_cards(icon, CARDS)
    return warm_dot(icon, 702, 550, 35)


VARIANTS = [
    ("l2b", "L2b · 日出卡后（居中）", l2b),
    ("l2c", "L2c · 晨点入卡", l2c),
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

    old = Image.open(OUT / "logo-l.png").convert("RGBA")
    cells = [("原版 L（对照）", old)] + rendered
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 40)
    cell_w, cell_h = 800, 980
    sheet = Image.new("RGB", (cell_w * len(cells), cell_h), (244, 244, 247))
    sd = ImageDraw.Draw(sheet)
    for idx, (name, icon) in enumerate(cells):
        cx = idx * cell_w
        big = icon.resize((640, 640), Image.LANCZOS)
        sheet.paste(big, (cx + (cell_w - 640) // 2, 70), big)
        mini = icon.resize((96, 96), Image.LANCZOS)
        sd.text((cx + 96, 70 + 640 + 70), name, fill=(29, 29, 31), font=font)
        sheet.paste(mini, (cx + 556, 70 + 640 + 52), mini)
    sheet.save(OUT / "logo-sheet-l2.png")
    print("written:", OUT / "logo-sheet-l2.png")


if __name__ == "__main__":
    main()
