#!/usr/bin/env python3
# 把 musaiyu 仓库交给 ChatGPT 会话评审并让它直接产出优化/实现
import json, subprocess, time, sys, os

OUT = os.path.expanduser("~/ZCodeProject/musaiyu")
LOG = os.path.join(OUT, "review.log")
TAB = 885246686

def log(m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    open(LOG, "a").write(line + "\n")

def call(cmd, args, timeout=45):
    a = dict(args); a["tabId"] = TAB
    open("/tmp/musaiyu_pr.json","w").write(json.dumps({"client":"last","cmd":cmd,"args":a}))
    return subprocess.run(["curl","-s","-m",str(timeout),"-X","POST","http://127.0.0.1:9347/exec",
        "-H","Content-Type: application/json","-d","@/tmp/musaiyu_pr.json"],capture_output=True,text=True).stdout

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

PROMPT = """项目代码已经推到 GitHub 公开仓库了：
https://github.com/dyyz1993/musaiyu

这是我们目前的全部成果：调研报告（chatgpt-report.md）、开发规格（SPEC-竖屏与工程规格.md，含三套规则版本对照矩阵和 15 条判定 case）、竖屏布局交互稿、Figma 组装脚本（build_figma_svg.py / figma_assemble.js）、全部素材（assets/ 和 ui-pack/）。仓库里还有木塞参考源码 assets/rules-reference/（MusaiProbability 的 4 个 C# 文件）。

请你做三件事：
1【评审】联网打开这个仓库把文件过一遍，评估当前做得怎么样：规则研究是否扎实、SPEC 有没有漏洞、素材和布局还缺什么，直接说问题和短板。
2【优化清单】给出具体要优化/补齐的点，按优先级排序。
3【直接动手】按 SPEC 写出「可玩的网页版第一版」：单文件 HTML5（内联 CSS/JS，竖屏 390×760 布局），要求——
· 规则引擎独立成模块：classifyHand / compareHands / payoutMultiplier / settleRound 四个函数分离，木虱克双鬼必须双向判定，用 SPEC 的 duobi-v1 规则预设（三鬼15倍、双鬼10倍、天公9/8、同花顺8、豹子10/假6、顺子4、木虱反克10）
· 支持 2~4 人（我 + 1~3 个简单 AI），我固定底部，AI 沿桌沿环形摆放
· 完整流程：下注→发两张→停牌/补一张决策（起手单鬼强制补）→摊牌→两两比较结算→筹码变动
· 素材先用 CSS/内联 SVG 画牌面（不依赖外部图片），绿色绒布底
把完整代码放进一个 ```report 围栏里输出（围栏内不要再用三反引号，代码缩进即可）。"""

def main():
    log("== 校验目标会话 ==")
    u = ev("location.pathname") or ""
    if not u.startswith("/c/6ae2ffb0-25ec-83e8-bd16-353eea9bf083"):
        log(f"FATAL: 不在目标会话 path={u}"); sys.exit(8)
    if not ev("!!document.querySelector('.ProseMirror')"):
        log("FATAL: 编辑器未水合"); sys.exit(3)

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
      thread:/github.com\\/dyyz1993\\/musaiyu/.test(document.body.innerText||'')})""")
    log(f"发送验证: {sent}")

    log("== 轮询完成 ==")
    last = -1; stable = 0
    for i in range(60):  # 最多 25 分钟
        time.sleep(25)
        st = ev("""(()=>{const bs=[...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||'');
          const stop=bs.find(l=>/停止|stop/i.test(l));
          return JSON.stringify({stop:!!stop,len:(document.body.innerText||'').length})})()""")
        try: d = json.loads(st)
        except Exception:
            log(f"poll#{i} 解析失败"); continue
        log(f"poll#{i} stop={d.get('stop')} len={d.get('len')}")
        if not d.get("stop"):
            if d.get("len") == last: stable += 1
            else: stable = 0
            last = d.get("len")
            if stable >= 2 and (d.get("len") or 0) > 3000:
                log("完成信号"); break
    else:
        log("FATAL 超时未完成"); sys.exit(6)

    log("== 提取 ==")
    t = ev("document.body.innerText", timeout=90) or ""
    open(os.path.join(OUT,"review-thread.txt"),"w").write(t)
    i = t.find("项目代码已经推到 GitHub")
    j = t.find("ChatGPT 可能会出错")
    rep = t[i:j] if (i>=0 and j>i) else None
    if not rep:
        k = t.find("```report")
        if k >= 0:
            e = t.find("```", k+9)
            if e > k: rep = t[k+9:e]
    if not rep:
        log("FATAL 未提取到回复"); sys.exit(7)
    open(os.path.join(OUT,"chatgpt-review.md"),"w").write(rep)
    log(f"OK 提取 {len(rep)} 字符 -> chatgpt-review.md")

main()
