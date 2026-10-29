#!/usr/bin/env python3
# 让网页版 ChatGPT 画竖屏布局设计图: 发送→等出图→点下载→收图
import json, subprocess, time, sys, os, glob

OUT = os.path.expanduser("~/ZCodeProject/musaiyu")
LOG = os.path.join(OUT, "draw.log")
DL = os.path.expanduser("~/Downloads")

def log(m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    open(LOG, "a").write(line + "\n")

TAB = None
def call(cmd, args, timeout=45):
    a = dict(args)
    if TAB is not None: a["tabId"] = TAB
    open("/tmp/musaiyu_payload2.json","w").write(json.dumps({"client":"last","cmd":cmd,"args":a}))
    return subprocess.run(["curl","-s","-m",str(timeout),"-X","POST","http://127.0.0.1:9347/exec",
        "-H","Content-Type: application/json","-d","@/tmp/musaiyu_payload2.json"],capture_output=True,text=True).stdout

def ev(expr, timeout=45):
    r = call("evaluate", {"expression": expr, "returnByValue": True}, timeout)
    try: return json.loads(r).get("data",{}).get("value")
    except Exception: return None

def click(x, y):
    for t, extra in (("mouseMoved",{"button":"none","buttons":0}),
                     ("mousePressed",{"button":"left","buttons":1,"clickCount":1}),
                     ("mouseReleased",{"button":"left","buttons":0,"clickCount":1})):
        call("cdp", {"method":"Input.dispatchMouseEvent","params":{"type":t,"x":x,"y":y,**extra}})
        time.sleep(0.12)

PROMPT = """帮我画一张网页版「木塞鱼」（潮汕扑克牌戏）手机竖屏游戏界面的高保真设计图，竖屏 9:16。具体要求：
- 背景：深绿绒布椭圆赌场牌桌俯视，暗色房间氛围，金色+墨绿高级赌场风
- 顶部一条窄深色信息栏：房名「木虱鱼·闸坡厅」、房号、局数、底注、池底
- 8 个对手玩家沿椭圆桌沿围一圈（环形分布）：正上方和斜上方共 3-4 个座位竖着排（圆形金边头像在最外侧，往下是昵称、筹码数、两张红色牌背）；左右两侧座位横着排、头像贴屏幕左右边缘；左下角也有座位
- 庄家的头像左下角压一个红底金字「庄」小圆章
- 桌中央一条金色提示横幅
- 底部是玩家自己：两张大扑克牌（黑桃A、红桃8）+ 一个虚线空牌位 + 金边头像和筹码
- 最底部两个圆角按钮：深色「停 牌」、金色「补一张」
所有文字用简体中文，界面要精致、可开发落地，不要画成插画海报。直接把这张 UI 设计图画出来。"""

def main():
    global TAB
    log("== navigate chatgpt.com ==")
    r = call("navigate", {"url": "https://chatgpt.com/"})
    try: TAB = json.loads(r)["data"]["tabId"]
    except Exception:
        log(f"navigate 失败: {r[:200]}"); sys.exit(2)
    log(f"tabId={TAB}")

    ed = False
    for k in range(24):
        time.sleep(5)
        st = ev("JSON.stringify({editor:!!document.querySelector('.ProseMirror'),ready:document.readyState,url:location.href.slice(0,60)})")
        log(f"editor wait#{k}: {st}")
        if st and '"editor":true' in st: ed = True; break
        if st and k == 10:
            ev("location.reload(); 'reloading'"); log("卡住, 触发 reload")
    if not ed:
        log("FATAL: 编辑器未出现"); sys.exit(3)

    u = ev("location.href") or ""
    log(f"URL 校验: {u[:70]}")
    call("cdp", {"method":"Page.bringToFront","params":{}}); time.sleep(1)
    ev("document.querySelector('.ProseMirror').focus()"); time.sleep(0.5)
    call("cdp", {"method":"Input.insertText","params":{"text":PROMPT}}); time.sleep(1.5)
    n = ev("(document.querySelector('.ProseMirror')?.textContent||'').length")
    log(f"注入字符数: {n}")
    if not n or n < 100: log("FATAL 注入失败"); sys.exit(4)

    btn = ev("""(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>!b.disabled);
      const b=bs.find(x=>/发送|send/i.test(x.getAttribute('aria-label')||'')||x.getAttribute('data-testid')==='send-button');
      if(!b)return 'none';const r=b.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()""")
    if not btn or btn == "none": log("FATAL 无发送按钮"); sys.exit(5)
    p = json.loads(btn); log(f"点发送 @ {p}")
    click(p["x"], p["y"]); time.sleep(4)
    sent = ev("""JSON.stringify({ed:(document.querySelector('.ProseMirror')?.textContent||'').length,
      thread:/木塞鱼/.test(document.body.innerText||'')})""")
    log(f"发送验证: {sent}")

    # 等出图: 生成中通常有停止按钮; 完成标志=出现 oaiusercontent 图片且 stop 消失
    log("== 等出图 ==")
    img_url = None
    for i in range(40):  # 40*15s = 10min
        time.sleep(15)
        st = ev("""(()=>{const imgs=[...document.querySelectorAll('img')].map(im=>im.src).filter(s=>/oaiusercontent|azureedge|openaiobjects/.test(s));
          const bs=[...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||'');
          return JSON.stringify({n:imgs.length,src:imgs.length?imgs[imgs.length-1].slice(0,150):null,
            stop:bs.find(l=>/停止|stop/i.test(l))||null,len:(document.body.innerText||'').length})})()""")
        log(f"poll#{i}: {str(st)[:160]}")
        try: d = json.loads(st)
        except Exception: continue
        if d.get("n") and not d.get("stop"):
            img_url = d.get("src"); break
    if not img_url:
        log("FATAL 未等到图片"); sys.exit(6)

    # 取完整 src
    full = ev("""(()=>{const imgs=[...document.querySelectorAll('img')].map(im=>im.src).filter(s=>/oaiusercontent|azureedge|openaiobjects/.test(s));
      return imgs.length?imgs[imgs.length-1]:''})()""")
    log(f"图片URL: {str(full)[:160]}")

    # 方式A: 找下载按钮点它
    before = set(glob.glob(os.path.join(DL, "*")))
    call("cdp", {"method":"Page.bringToFront","params":{}}); time.sleep(1)
    db = ev("""(()=>{const cands=[...document.querySelectorAll('button,a')].filter(e=>/下载|download/i.test(e.getAttribute('aria-label')||'')||/下载|download/i.test(e.textContent||''));
      if(!cands.length)return 'none';const c=cands[cands.length-1];const r=c.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),label:c.getAttribute('aria-label')})})()""")
    log(f"下载按钮: {str(db)[:120]}")
    if db and db != "none":
        d = json.loads(db); click(d["x"], d["y"])
        for i in range(12):
            time.sleep(5)
            newf = [f for f in glob.glob(os.path.join(DL,"*")) if f not in before and not f.endswith((".crdownload",".tmp"))]
            if newf:
                src = max(newf, key=os.path.getmtime)
                size = os.path.getsize(src)
                if size > 20000:
                    log(f"下载成功: {src} ({size}B)")
                    dest = os.path.join(OUT, "chatgpt-layout" + os.path.splitext(src)[1])
                    subprocess.run(["cp", src, dest]); log(f"已入库: {dest}")
                    open(os.path.join(OUT, "layout_image_url.txt"),"w").write(full or "")
                    return
    # 方式B: curl 直下签名URL
    log("下载按钮路径未收到文件, 尝试 curl 直下")
    if full:
        rr = subprocess.run(["curl","-sL","-m","60","-A","Mozilla/5.0","-o",os.path.join(OUT,"chatgpt-layout.img"),full],capture_output=True,text=True)
        sz = os.path.getsize(os.path.join(OUT,"chatgpt-layout.img")) if os.path.exists(os.path.join(OUT,"chatgpt-layout.img")) else 0
        log(f"curl 结果: {sz}B, {rr.stderr[:80]}")
        if sz > 20000:
            open(os.path.join(OUT,"layout_image_url.txt"),"w").write(full); log("OK curl 入库"); return
    log("FATAL 图未入库"); sys.exit(7)

main()
