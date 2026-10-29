#!/usr/bin/env python3
# 组装 Figma 用 SVG 设计稿: 生图元素+复用素材 → 390x760 画板, 元素均为独立图层
from PIL import Image
import base64, io, os, math

M = "/Users/xuyingzhou/ZCodeProject/musaiyu"
F = os.path.join(M, "figma-elements")
PREP = os.path.join(F, "prepared")
os.makedirs(PREP, exist_ok=True)

def load(p): return Image.open(p).convert("RGBA")
def trim_alpha(im, pad=8):
    bb = im.getchannel("A").getbbox()
    if not bb: return im
    x0,y0,x1,y1 = bb
    return im.crop((max(0,x0-pad),max(0,y0-pad),min(im.width,x1+pad),min(im.height,y1+pad)))
def b64(im, fmt="PNG", q=88):
    buf = io.BytesIO()
    if fmt=="JPEG": im.convert("RGB").save(buf,"JPEG",quality=q)
    else: im.save(buf,"PNG")
    return base64.b64encode(buf.getvalue()).decode()

assets = {}
# 背景: 裁掉照片上下黑边再嵌入
tb = Image.open(os.path.join(M,"assets/ai-generated/web/table-bg.jpg")).convert("RGB")
tb = tb.crop((60, 80, 720, 480)).resize((780, int(400*780/660)))
assets["table"] = tb
for name, src, w in [
    ("banner", f"{F}/banner-wait.png", 440), ("btnstop", f"{F}/btn-stop.png", 360),
    ("btndraw", f"{F}/btn-draw.png", 360), ("badge", f"{F}/banker-badge.png", 52),
    ("topbar", f"{F}/topbar.png", 780)]:
    im = trim_alpha(load(src)); im = im.resize((w, int(im.height*w/im.width))); assets[name] = im
assets["cardback"] = load(os.path.join(M,"assets/ai-generated/card-back.png")).resize((52,78))
assets["cardAS"] = load(os.path.join(M,"ui-pack/elements/card-AS.png"))
assets["card8H"] = load(os.path.join(M,"ui-pack/elements/card-8H.png"))
assets["chip"] = load(os.path.join(M,"assets/chips/poker_chips_only_2d/PNGs/large/chip_red_top_large.png")).resize((28,28))
for n in ["avatar-m1","avatar-m2","avatar-m3","avatar-f1","avatar-f2","avatar-f3"]:
    assets[n] = load(os.path.join(M,f"ui-pack/elements/{n}.png"))

href = {}
for name, im in assets.items():
    im.save(os.path.join(PREP, name+".png"))
    href[name] = "data:image/png;base64," + b64(im, "JPEG" if name=="table" else "PNG", 82)

W,H = 390,760
CX, CY, R = 173, 289, 150
SEAT_MAP = {
 1: [90], 2: [150,30], 3: [160,90,20], 4: [170,115,65,10],
 5: [175,135,90,45,5], 6: [188,145,110,70,35,352],
 7: [90,160,20,190,350,218,322],
 8: [139,90,41,175,5,195,345,222],   # 9人局: 紧凑三顶+两斜+两侧+左下
}
NAMES  = ["阿强","老陈","阿玲","阿海","阿芳","阿坤","阿杰","阿宝"]
CHIPS  = ["6,200","18,400","3,150","1,980","9,560","4,720","880","15,300"]
AV     = ["avatar-m1","avatar-m3","avatar-f1","avatar-m2","avatar-f3","avatar-f2","avatar-m1","avatar-f1"]
FONT = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
BANNER_Y = 445  # 桌心下方空档, 避开两侧座位

def img(n, x, y, w, h, extra=""):
    return f'<image href="{href[n]}" x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" {extra}/>'
def txt(x, y, s, size=11, fill="#fff", weight=400, anchor="start"):
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" fill="{fill}" font-weight="{weight}" text-anchor="{anchor}">{s}</text>'

seats_svg = []
BANKER = 0
COMPACT = False
for i, ang in enumerate(SEAT_MAP[len(NAMES)]):
    a = math.radians(ang)
    x = CX + R*math.cos(a); y = CY - R*math.sin(a)
    vertical = abs(ang-90) <= 45
    left = ang > 90
    isB = (i == BANKER)
    if len(NAMES) == 8:
        COMPACT = True
        ar, mw, mh, cw, chh = 16, 32, 32, 20, 28
    else:
        ar, mw, mh, cw, chh = 20, 40, 40, 26, 37
    av = img(AV[i], x-ar, y-ar, mw, mh)
    badge = img("badge", x-ar-3, y+ar-12, 24, 24) if isB else ""
    if vertical:
        if COMPACT:
            g = [av,
                 txt(x, y+22, NAMES[i], 9.5, "#fff", 500, "middle"),
                 f'<g transform="translate({x-11:.1f},{y+27})"><image href="{href["chip"]}" width="10" height="10"/><text x="12" y="9" font-family="{FONT}" font-size="9" fill="#ffd97a">{CHIPS[i]}</text></g>',
                 img("cardback", x-21, y+41, 20, 28), img("cardback", x+1, y+41, 20, 28)]
        else:
            g = [av,
                 txt(x, y+36, NAMES[i], 11, "#fff", 500, "middle"),
                 f'<g transform="translate({x-14:.1f},{y+42})"><image href="{href["chip"]}" width="12" height="12"/><text x="15" y="11" font-family="{FONT}" font-size="10" fill="#ffd97a">{CHIPS[i]}</text></g>',
                 img("cardback", x-28, y+58, 26, 37), img("cardback", x+2, y+58, 26, 37)]
    else:
        if COMPACT:
            cw2, ch2, step = 20, 28, 24
        else:
            cw2, ch2, step = 24, 34, 26
        cy0 = y - ch2/2
        if left:
            g = [img(AV[i], x-ar, y-ar, mw, mh),
                 txt(x+ar+6, y-2, NAMES[i], 10 if COMPACT else 10.5, "#fff", 500),
                 f'<g transform="translate({x+ar+6:.1f},{y+6})"><image href="{href["chip"]}" width="{11 if COMPACT else 12}" height="{11 if COMPACT else 12}"/><text x="{14 if COMPACT else 15}" y="11" font-family="{FONT}" font-size="{9.5 if COMPACT else 10}" fill="#ffd97a">{CHIPS[i]}</text></g>',
                 img("cardback", x+ar+62, cy0, cw2, ch2), img("cardback", x+ar+62+step, cy0, cw2, ch2)]
        else:
            g = [img(AV[i], x-ar, y-ar, mw, mh),
                 txt(x-ar-6, y-2, NAMES[i], 10 if COMPACT else 10.5, "#fff", 500, "end"),
                 f'<g transform="translate({x-ar-17:.1f},{y+6})"><image href="{href["chip"]}" width="{11 if COMPACT else 12}" height="{11 if COMPACT else 12}"/><text x="{14 if COMPACT else 15}" y="11" font-family="{FONT}" font-size="{9.5 if COMPACT else 10}" fill="#ffd97a">{CHIPS[i]}</text></g>',
                 img("cardback", x-ar-62-step, cy0, cw2, ch2), img("cardback", x-ar-62, cy0, cw2, ch2)]
    seats_svg.append(f'<g>{"".join(g)}{badge}</g>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="#0a0a0c"/>
<rect x="0" y="0" width="{W}" height="44" fill="#000"/>
<text x="16" y="27" font-family="{FONT}" font-size="13" fill="#fff" font-weight="600">9:41</text>
<rect x="330" y="16" width="20" height="11" rx="2.5" fill="none" stroke="#fff"/><rect x="332" y="18" width="13" height="7" rx="1" fill="#fff"/>
{img("table", 0, 44, 390, 696, 'preserveAspectRatio="xMidYMid slice"')}
<rect x="0" y="44" width="{W}" height="696" fill="rgba(4,16,10,.36)"/>
{img("topbar", 14, 50, 362, 40)}
{txt(28, 76, "木虱鱼 · 闸坡厅", 13, "#fff", 700)}
{txt(138, 76, "房号 882010 · 第 8 局 · 底注 200 · 池底 800", 10.5, "rgba(255,255,255,.75)")}
<ellipse cx="{CX}" cy="{CY}" rx="150" ry="150" fill="none" stroke="rgba(217,180,92,.34)" stroke-width="1.5" stroke-dasharray="6 5"/>
{''.join(seats_svg)}
{img("banner", CX-110, BANNER_Y-32, 220, 64)}
<g>
  {img("avatar-m3", 23, 495, 40, 40)}
  {txt(70, 508, "阿洲（我 · 固定庄底位）", 13, "#fff", 600)}
  <g transform="translate(70,516)"><image href="{href["chip"]}" width="14" height="14"/><text x="17" y="12" font-family="{FONT}" font-size="12" fill="#ffd97a">12,400</text></g>
  {txt(376, 522, "当前 9 点 · 天公", 12, "#9fe6bf", 400, "end")}
  {txt(376, 538, "同花 ×2", 11, "#ffd97a", 600, "end")}
  {img("cardAS", 68, 548, 78, 106)}
  {img("card8H", 156, 548, 78, 106)}
  <rect x="244" y="548" width="78" height="106" rx="8" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.45)" stroke-width="1.5" stroke-dasharray="5 4"/>
  {txt(283, 600, "+", 22, "rgba(255,255,255,.6)", 400, "middle")}
  {txt(283, 622, "补牌位", 11, "rgba(255,255,255,.6)", 400, "middle")}
  {img("btnstop", 14, 668, 178, 46)}
  {img("btndraw", 198, 668, 178, 46)}
</g>
<rect x="135" y="746" width="120" height="5" rx="2.5" fill="#3a3a3e"/>
</svg>'''

open(os.path.join(M, "musaiyu-figma.svg"), "w").write(svg)
print("SVG written:", len(svg)//1024, "KB, banner_y =", BANNER_Y)
