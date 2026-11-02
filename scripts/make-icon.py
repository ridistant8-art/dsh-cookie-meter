"""生成市场卡片图标：深蓝底 + 环形百分表 + 61%（过半变红的示意）。"""
from PIL import Image, ImageDraw, ImageFont

S = 720  # 4x supersample of 180
BG = (11, 27, 58, 255)
TRACK = (38, 54, 92, 255)
COOL = (77, 107, 254, 255)
HOT = (255, 77, 94, 255)
WHITE = (232, 238, 255, 255)
MUTED = (120, 140, 180, 255)

FONT_BD = r"C:\Windows\Fonts\msyhbd.ttc"

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角底板
pad = 24
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=150, fill=BG)

# 表盘
cx = cy = S / 2
r = 208
w = 46
box = [cx - r, cy - r, cx + r, cy + r]
d.arc(box, start=135, end=405, fill=TRACK, width=w)

# 进度：61%（从 135° 顺时针 270° 的 61%）
start = 135
sweep = 270 * 0.61
d.arc(box, start=start, end=start + sweep, fill=COOL, width=w)
# 尾部一小段热色，暗示"会变红"
d.arc(box, start=start + sweep, end=start + sweep + 12, fill=HOT, width=w)

# 刻度小点
import math
for k in range(0, 11):
    a = math.radians(135 + 27 * k)
    x1 = cx + (r + w * 0.95) * math.cos(a)
    y1 = cy + (r + w * 0.95) * math.sin(a)
    rr = 5 if k % 5 else 7
    d.ellipse([x1 - rr, y1 - rr, x1 + rr, y1 + rr], fill=MUTED if k % 5 else (170, 190, 220, 255))

font_big = ImageFont.truetype(FONT_BD, 190)
font_pct = ImageFont.truetype(FONT_BD, 92)
font_small = ImageFont.truetype(FONT_BD, 54)

text = "61"
bbox = d.textbbox((0, 0), text, font=font_big)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text((cx - tw / 2 - bbox[0] - 34, cy - th / 2 - bbox[1] - 26), text, font=font_big, fill=WHITE)
pbbox = d.textbbox((0, 0), "%", font=font_pct)
pw = pbbox[2] - pbbox[0]
d.text((cx + tw / 2 - 34, cy - 34), "%", font=font_pct, fill=(150, 175, 235, 255))

label = "16K"
lbbox = d.textbbox((0, 0), label, font=font_small)
lw = lbbox[2] - lbbox[0]
d.text((cx - lw / 2, cy + 62), label, font=font_small, fill=MUTED)

out180 = img.resize((180, 180), Image.LANCZOS)
out180.save(r"D:\deepseek工作区\dsh-cookie-meter\assets\icon-180.png")
img.resize((512, 512), Image.LANCZOS).save(r"D:\deepseek工作区\dsh-cookie-meter\assets\icon-512.png")
print("saved", out180.size)
