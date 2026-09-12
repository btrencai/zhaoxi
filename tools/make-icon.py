#!/usr/bin/env python3
"""生成「朝夕」应用图标（P1 · 晨昏环）：超椭圆渐变底 + 环形渐变（昼白 → 昏暖）。

输出：tools/icon-1024.png（供 `npx tauri icon` 生成全套图标）。
依赖：Pillow
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = 1024
SS = 3  # 超采样倍数
W = S * SS

TOP = (0x7D, 0x6E, 0xFB)  # 亮靛紫
MID = (0x63, 0x5B, 0xE8)  # 中段
BOT = (0x4F, 0x45, 0xD0)  # 深靛
WARM = (0xFF, 0xB4, 0x6B)  # 昏暖
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# ── 1) 垂直三段渐变 ──
grad = Image.new("RGBA", (W, W))
gd = ImageDraw.Draw(grad)
for y in range(W):
    t = y / (W - 1)
    c = lerp(TOP, MID, t / 0.5) if t < 0.5 else lerp(MID, BOT, (t - 0.5) / 0.5)
    gd.line([(0, y), (W, y)], fill=c + (255,))


# ── 2) 超椭圆遮罩（n≈4.6，接近 iOS squircle）──
def superellipse(scale, steps=1400, n=4.6):
    pts = []
    for i in range(steps):
        ang = 2 * 3.141592653589793 * i / steps
        from math import copysign, cos, sin

        cx = copysign(abs(cos(ang)) ** (2 / n), cos(ang))
        cy = copysign(abs(sin(ang)) ** (2 / n), sin(ang))
        pts.append(((0.5 + cx * 0.5 * scale) * W, (0.5 + cy * 0.5 * scale) * W))
    return pts


mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).polygon(superellipse(1.0), fill=255)

icon = Image.new("RGBA", (W, W), (0, 0, 0, 0))
icon.paste(grad, (0, 0), mask)

# ── 3) 左上「晨光」高光 ──
glow = Image.new("L", (W, W), 0)
rad = Image.radial_gradient("L").resize((int(W * 1.7), int(W * 1.7)), Image.LANCZOS)
glow.paste(rad, (int(-W * 0.55), int(-W * 0.75)))
glow = glow.point(lambda v: int(v * 0.30))
glow = ImageChops.multiply(glow, mask)
light = Image.new("RGBA", (W, W), (255, 255, 255, 255))
icon = Image.alpha_composite(icon, Image.merge("RGBA", (light.split()[0], light.split()[1], light.split()[2], glow)))

# ── 4) 内描边（玻璃感）──
inner_mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(inner_mask).polygon(superellipse(0.992), fill=255)
stroke = ImageChops.subtract(mask, inner_mask).point(lambda v: int(v * 0.30))
edge = Image.new("RGBA", (W, W), (255, 255, 255, 255))
icon = Image.alpha_composite(icon, Image.merge("RGBA", (edge.split()[0], edge.split()[1], edge.split()[2], stroke)))

# ── 5) 晨昏环：环形渐变（顶部昼白 → 底部昏暖，平滑过渡，中空）──
K = W / 1024.0
ring_layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
rd = ImageDraw.Draw(ring_layer)
CX = CY = 512
R = 256
WD = 70
bbox = [(CX - R) * K, (CY - R) * K, (CX + R) * K, (CY + R) * K]


def rel(ang):
    """角距离顶部的相对值：顶部 0（白），底部 1（暖）。"""
    dd = abs((ang - 270) % 360)
    dd = min(dd, 360 - dd)
    return dd / 180.0


steps = 240
for i in range(steps):
    a0 = i * 360.0 / steps
    a1 = (i + 1) * 360.0 / steps + 0.7
    t = rel((a0 + a1) / 2)
    tt = t * t * (3 - 2 * t)  # smoothstep
    col = lerp(WHITE, WARM, tt)
    rd.arc(bbox, a0, a1, fill=col + (255,), width=int(WD * K))

shadow = ring_layer.filter(ImageFilter.GaussianBlur(9 * K))
alpha = shadow.split()[3].point(lambda v: int(v * 0.20))
black = Image.new("L", (W, W), 0)
shadow = Image.merge("RGBA", (black, black, black, alpha))
shadow = ImageChops.offset(shadow, int(4 * K), int(9 * K))
shadow = Image.composite(shadow, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask)
icon = Image.alpha_composite(icon, shadow)
icon = Image.alpha_composite(icon, ring_layer)

out = ROOT / "tools" / "icon-1024.png"
icon.resize((1024, 1024), Image.LANCZOS).save(out)
print("icon written:", out)
