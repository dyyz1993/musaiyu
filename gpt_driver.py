#!/usr/bin/env python3
# 木塞鱼(潮汕扑克)调研: ChatGPT 网页版驱动, chrome-bridge 通道(配方: browser-panel-ops §5.5)
import json, subprocess, time, sys, os

OUT = os.path.expanduser("~/ZCodeProject/musaiyu")
os.makedirs(OUT, exist_ok=True)
LOG = os.path.join(OUT, "driver.log")

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")

TAB = None

def call(cmd, args, timeout=45):
    a = dict(args)
    if TAB is not None:
        a["tabId"] = TAB
    with open("/tmp/musaiyu_payload.json", "w") as f:
        f.write(json.dumps({"client": "last", "cmd": cmd, "args": a}))
    return subprocess.run(
        ["curl", "-s", "-m", str(timeout), "-X", "POST",
         "http://127.0.0.1:9347/exec", "-H", "Content-Type: application/json",
         "-d", "@/tmp/musaiyu_payload.json"],
        capture_output=True, text=True).stdout

def ev(expr, timeout=45):
    r = call("evaluate", {"expression": expr, "returnByValue": True}, timeout)
    try:
        return json.loads(r).get("data", {}).get("value")
    except Exception:
        return None

def click(x, y):
    for t, extra in (("mouseMoved", {"button": "none", "buttons": 0}),
                     ("mousePressed", {"button": "left", "buttons": 1, "clickCount": 1}),
                     ("mouseReleased", {"button": "left", "buttons": 0, "clickCount": 1})):
        call("cdp", {"method": "Input.dispatchMouseEvent",
                     "params": {"type": t, "x": x, "y": y, **extra}})
        time.sleep(0.12)

PROMPT = """请联网调研「木塞鱼」（也叫木虱/木虱鱼/木塞，中国潮汕地区的扑克牌游戏）。我要开发一个网页版木塞鱼游戏，需要三部分内容：
1【玩法规则】完整规则：几个人玩、发几张牌、牌点怎么算（A/2~10/J/Q/K 各算几点）、为什么9最大、大小王/鬼牌的百搭规则、特殊牌型（如木虱）和倍率翻倍规则、庄闲与下注流程、平局判定。
2【现成实现】在 GitHub 搜索开源实现或可参考项目：关键词 musaiyu、木虱、木塞、潮汕棋牌、Chaoshan card game；也找可借鉴的比点数纸牌游戏开源项目（炸金花、龙虎、百家乐类）。每个给：仓库名、链接、star 数、最近更新、一句话简介。
3【免费素材】找可直接下载使用的开源/可商用素材：整副扑克牌 PNG/SVG 素材包（GitHub 上的 svg playing cards 仓库、kenney.nl、opengameart.org、itch.io 免费棋牌素材）、绿绒棋牌桌面背景、筹码图、发牌/筹码音效；每项给名称+直链+许可证。若某类找不到合适的现成素材，直接写一段可用的 SVG 代码给我（如一张 A♠ 标准牌面模板，52 张可参数化生成）。
硬性要求：所有链接必须真实存在，不确定的要去搜索验证，严禁编造。最后把完整报告放进一个 ```report 围栏代码块里输出。"""

def main():
    global TAB
    if len(sys.argv) > 1:
        TAB = int(sys.argv[1])
        log(f"== phase1: 复用已有 tabId={TAB} ==")
    else:
        log("== phase1: navigate chatgpt.com ==")
        r = call("navigate", {"url": "https://chatgpt.com/"})
        try:
            TAB = json.loads(r)["data"]["tabId"]
        except Exception:
            log(f"navigate 失败: {r[:300]}"); sys.exit(2)
        log(f"tabId={TAB}")
        time.sleep(9)

    # 编辑器水合轮询等待(最长90s)
    ed = None
    for k in range(18):
        st = ev("JSON.stringify({editor:!!document.querySelector('.ProseMirror'), ready:document.readyState})")
        log(f"editor wait#{k}: {st}")
        if st and '"editor":true' in st:
            ed = True; break
        time.sleep(5)
    if not ed:
        log("FATAL: 90s 内 .ProseMirror 未出现"); sys.exit(3)

    u = ev("location.href") or ""
    path = ""
    try:
        path = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(u).path
    except Exception:
        path = u
    log(f"目标校验: url={u[:80]} path={path}")
    if path != "/":
        log("FATAL: 目标不是新聊天页(拒绝在 /dots/ 等错误对话框派单)"); sys.exit(8)

    call("cdp", {"method": "Page.bringToFront", "params": {}})
    time.sleep(1)
    ev("document.querySelector('.ProseMirror').focus()")
    time.sleep(0.5)
    call("cdp", {"method": "Input.insertText", "params": {"text": PROMPT}})
    time.sleep(1.5)
    ed_len = ev("(document.querySelector('.ProseMirror')?.textContent||'').length")
    log(f"编辑器字符数: {ed_len}")
    if not ed_len or ed_len < 100:
        log("FATAL: 文本未注入"); sys.exit(4)

    btn = ev("""(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>!b.disabled);
      const b=bs.find(x=>/发送|send/i.test(x.getAttribute('aria-label')||'')||x.getAttribute('data-testid')==='send-button');
      if(!b)return 'none';const r=b.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()""")
    if not btn or btn == "none":
        log(f"FATAL: 发送按钮未出现 btn={btn}"); sys.exit(5)
    p = json.loads(btn)
    log(f"点发送 @ {p}")
    click(p["x"], p["y"])
    time.sleep(4)
    sent = ev("""JSON.stringify({ed:(document.querySelector('.ProseMirror')?.textContent||'').length,
      thread:/木塞鱼/.test(document.body.innerText||'')})""")
    log(f"发送验证: {sent}")
    if not sent or '"ed":0' not in sent:
        time.sleep(5)
        sent = ev("""JSON.stringify({ed:(document.querySelector('.ProseMirror')?.textContent||'').length,
          thread:/木塞鱼/.test(document.body.innerText||'')})""")
        log(f"二次发送验证: {sent}")

    log("== phase2: 轮询完成 ==")
    last_len = -1; stable = 0
    for i in range(36):
        time.sleep(25)
        st = ev("""(()=>{const bs=[...document.querySelectorAll('button')];
          const stop=bs.find(b=>/停止|stop/i.test(b.getAttribute('aria-label')||''));
          return JSON.stringify({stop:!!stop,len:(document.body.innerText||'').length})})()""")
        try:
            d = json.loads(st)
        except Exception:
            log(f"轮询#{i} 异常: {str(st)[:120]}"); continue
        log(f"轮询#{i} stop={d.get('stop')} len={d.get('len')}")
        if not d.get("stop"):
            if d.get("len") == last_len: stable += 1
            else: stable = 0
            last_len = d.get("len")
            if stable >= 2 and (d.get("len") or 0) > 1500:
                log("完成: stop消失+文本连续两轮不变"); break
    else:
        log("FATAL: 15分钟未完成"); sys.exit(6)

    log("== phase3: 提取 ==")
    txt = ev("document.body.innerText", timeout=60) or ""
    with open(os.path.join(OUT, "thread_innerText.txt"), "w") as f:
        f.write(txt)
    rep = None
    i = txt.find("```report")
    if i >= 0:
        j = txt.find("```", i + 9)
        if j > i: rep = txt[i+9:j]
    if not rep:
        i = txt.find("请联网调研"); j = txt.find("ChatGPT 可能会出错")
        if i >= 0 and j > i: rep = txt[i:j]
    if not rep:
        log("FATAL: 未找到 report 围栏"); sys.exit(7)
    with open(os.path.join(OUT, "chatgpt-report.md"), "w") as f:
        f.write(rep)
    log(f"OK 报告落盘 {len(rep)} 字符 -> musaiyu/chatgpt-report.md")

main()
