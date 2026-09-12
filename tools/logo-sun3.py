#!/usr/bin/env python3
"""「层叠卡片·太阳」：卡片按圆形交叠层压环绕 + 中央暖阳核心。

U1 六卡环 / U2 七卡紧叠 / U3 八卡放射（卡片长轴沿半径）
输出 preview2/logo-u1/2/3.png + logo-sheet-sun3.png
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


def card(w, h, radius=None, alpha=205, gloss=0.26, bar=True):
    """一张卡片：圆角卡面 + 顶部光泽 + 底部内阴影 + 内文条。"""
    rw, rh = int(w * K), int(h * K)
    rr = int((radius if radius is not None else h * 0.38) * K)
    img = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=(255, 255, 255, alpha))
    mask = Image.new("L", (rw, rh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, rw - 1, rh - 1], radius=rr, fill=255)
    gl = Image.new("L", (rw, rh), 0)
    gl.paste(ImageOps.invert(Image.linear_gradient("L")).resize((rw, int(rh * 0.58))), (0, 0))
    gl = ImageChops.multiply(gl, mask).point(lambda v: int(v * gloss))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 255), Image.new("L", (rw, rh), 255), gl)))
    bt = Image.new("L", (rw, rh), 0)
    bt.paste(Image.linear_gradient("L").resize((rw, int(rh * 0.42))), (0, int(rh * 0.58)))
    bt = ImageChops.multiply(bt, mask).point(lambda v: int(v * 0.13))
    img = Image.alpha_composite(img, Image.merge("RGBA", (Image.new("L", (rw, rh), 26), Image.new("L", (rw, rh), 22), Image.new("L", (rw, rh), 74), bt)))
    if bar:
        bw2, bh2 = int(rw * 0.40), max(2, int(rh * 0.075))
        bx = int(rw * 0.12)
        by = int(rh * 0.60)
        ImageDraw.Draw(img).rounded_rectangle([bx, by, bx + bw2, by + bh2], radius=bh2 // 2, fill=(64, 58, 120, 58))
    return img


def place_card(icon, card_img, cx, cy, rot):
    """把卡片旋转后贴到 (cx, cy)，并先投影（层压阴影）。"""
    rot_img = card_img.rotate(rot, resample=Image.BICUBIC, expand=True)
    px, py = int(cx * K - rot_img.size[0] / 2), int(cy * K - rot_img.size[1] / 2)
    region = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sh_canvas = Image.new("L", (W, W), 0)
    blurred = rot_img.filter(ImageFilter.GaussianBlur(10 * K))
    sh_canvas.paste(blurred.split()[3], (px, py))
    salpha = sh_canvas.point(lambda v: int(v * 0.40))
    shl = Image.merge(
        "RGBA",
        (Image.new("L", (W, W), 20), Image.new("L", (W, W), 15), Image.new("L", (W, W), 58), salpha),
    )
    shl = ImageChops.offset(shl, 0, int(10 * K))
    shl = Image.composite(shl, Image.new("RGBA", (W, W), (0, 0, 0, 0)), MASK)
    region = Image.alpha_composite(region, shl)
    region.paste(rot_img, (px, py), rot_img)
    return Image.alpha_composite(icon, region)


def warm_core(icon, r=118):
    cx = cy = 512
    halo = Image.new("L", (W, W), 0)
    ImageDraw.Draw(halo).ellipse([p(cx - r * 1.9, cy - r * 1.9)[0], p(cx - r * 1.9, cy - r * 1.9)[1], p(cx + r * 1.9, cy + r * 1.9)[0], p(cx + r * 1.9, cy + r * 1.9)[1]], fill=92)
    halo = halo.filter(ImageFilter.GaussianBlur(38 * K))
    halo = ImageChops.multiply(halo, MASK)
    icon = Image.alpha_composite(icon, Image.merge("RGBA", (WHITE_L, Image.new("L", (W, W), 198), Image.new("L", (W, W), 130), halo)))
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


def ring(icon, n, cw, ch, dist, phase=0.0, bar=True):
    """卡片按圆形排布、切向朝向、依次层压。"""
    c = card(cw, ch, bar=bar)
    for k in range(n):
        a = phase + k * 360.0 / n
        px = 512 + sin(radians(a)) * dist
        py = 512 - cos(radians(a)) * dist
        icon = place_card(icon, c, px, py, -a)
    return icon


def radial(icon, n, cw, ch, dist, phase=0.0, bar=True):
    """卡片长轴沿半径向外（放射状排布），依次层压。"""
    c = card(cw, ch, bar=bar)
    for k in range(n):
        a = phase + k * 360.0 / n
        px = 512 + sin(radians(a)) * dist
        py = 512 - cos(radians(a)) * dist
        icon = place_card(icon, c, px, py, -a + 90)
    return icon


def u1():
    icon = lc.base_icon()
    icon = ring(icon, 6, 322, 170, 258)
    return warm_core(icon, 124)


def u2():
    icon = lc.base_icon()
    icon = ring(icon, 8, 262, 142, 258)
    return warm_core(icon, 112)


def u3():
    icon = lc.base_icon()
    icon = radial(icon, 8, 270, 168, 198)
    return warm_core(icon, 112)


VARIANTS = [
    ("u1", "U1 · 六卡环（切向交叠）", u1),
    ("u2", "U2 · 八卡环（切向）", u2),
    ("u3", "U3 · 八卡放射", u3),
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
    sheet.save(OUT / "logo-sheet-sun3.png")
    print("written:", OUT / "logo-sheet-sun3.png")


if __name__ == "__main__":
    main()
