项目代码已经推到 GitHub 公开仓库了：

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
把完整代码放进一个 ```report 围栏里输出（围栏内不要再用三反引号，代码缩进即可）。

…
显示更多
思考了 3m 48s
ChatGPT 说：
木塞鱼网页版第一版：仓库评审与实现方案

我已经读取了公开仓库的开发规格、调研报告、素材清单，以及 MusaiProbability 的四份 C# 参考源码。评审会以你仓库里的实际文件为依据，而不是只根据之前的 UI 设计图判断。

项目地址：dyyz1993/musaiyu

一、评审结论

规则研究：有扎实基础，但不能直接当作最终规则

已经对照多套规则来源与 C# 源码，并识别了木虱反克双鬼的单向判定缺陷。

SPEC：结构完整，但仍有规则冲突需要冻结

已经覆盖座位布局、15 条判定 case、状态机与断线恢复；牌型优先级、鬼牌组合和部分赔率口径还需要统一。

素材与 UI：原型资产丰富，工程整合仍有欠缺

已经准备了 SVG 牌面、牌背、筹码、桌面、头像、Figma 组装脚本；缺少把它们连接到真实游戏状态的完整实现与自动化回归。

1. 规则研究的主要问题

规则版本不能混用。 SPEC-竖屏与工程规格.md 已经正确区分 R2、R3 与作者源码版，但第一版必须明确只执行 duobi-v1。

特殊牌型不是普通大小排序。 木虱、双鬼、天公之间存在循环克制关系，不能把牌型简单映射为一个分数，再对所有玩家排序。

有一个必须修复的源码缺陷。 Judger.cs 对木虱克双鬼只处理了一个参数方向，反向比较可能得出相反的错误结果。

鬼牌身份不能丢失。 真豹子和假豹子需要区别；含鬼的手牌也不能直接当成天然天公。

2. SPEC 的具体漏洞

优先级

	

问题

	

影响




P0

	

三鬼与天公的克制关系，必须与其他特殊牌型优先级分别定义

	

同一局可能出现不同结算结果




P0

	

双鬼加一张普通牌的牌型与倍率没有在 duobi-v1 中最终冻结

	

三张牌摊牌后无法确定唯一结果




P0

	

牌型倍率、比较胜负、平局与筹码转移必须独立

	

容易把倍率误当成牌型大小




P1

	

普通三张牌的点数、对子、同花与顺子的判定顺序

	

可能错误识别木虱或普通牌




P1

	

下注本金、净输赢、余额不足时的处理需要形成明确约定

	

多人两两结算可能产生筹码异常




P1

	

15 条判定 case 还需要转换为可重复执行的自动化测试

	

后续改规则容易回归出错

其中有一点需要特别说明：规格矩阵明确写了三鬼输天公，但又列出了不同来源的牌型顺序。实现时不能把源码的 enum 顺序直接当成 duobi-v1 的最终比较表。

3. 素材和布局的短板

现有的素材体系已经足够支撑首版，不建议再花时间重新画一整副牌。真正缺少的是：

游戏状态与牌桌组件的连接，包括发牌、补牌、摊牌、筹码变化。

2、3、4 人时的座位布局回归，特别是左右玩家的牌背与玩家手牌区不能互相遮挡。

牌面、牌背、庄家标记和操作按钮的统一组件规范。

独立规则测试、随机牌局测试，以及移动端实际尺寸测试。

另外，build_figma_svg.py 和 figma_assemble.js 目前包含本机绝对路径、固定资源 ID 等环境依赖。它们适合作为当前设计组装工具，但还需要增加配置化路径、资源检查和可重复运行的验证。

二、优化清单：按优先级实施
P0

先冻结规则，再实现规则引擎

明确特殊牌型比较表、双鬼加普通牌、三鬼对天公、平局及倍率口径。第一版先固定 duobi-v1，其他规则版本不混入。

P0

完成可玩的单机闭环

实现下注、发牌、强制补牌、停牌、AI 决策、摊牌、逐对比较、筹码结算和下一局。

P1

将 SPEC 的 15 条判定 case 转为自动化测试

优先测试木虱反克双鬼的双向判定、天公与三鬼、天然与含鬼牌型、平局，以及牌数不足的非法状态。

P1

补齐工程化验证

测试不同人数下的座位分布、极窄屏幕、重复开局、筹码边界、牌堆耗尽和连续多局状态重置。

P2

复用现有素材并增强体验

后续接入仓库里的 CC0 SVG 牌面、筹码与音效，增加发牌动画、逐对结算记录和庄家轮转。

三、可玩的网页版第一版

下面给出一个可以保存为 playable.html 的独立 HTML5 原型。CSS 和 JavaScript 全部内联，不依赖图片、框架、后端或 CDN，页面以 390 × 760 的手机竖屏为设计基准。

先说明两个实现约定：

牌组： 52 张普通牌加大王、小王、万能鬼，共 55 张，与参考源码的牌组规模一致。

规则边界： 仓库 SPEC 中有尚未完全冻结的规则，因此代码将明确的 duobi-v1 赔率与特殊克制单独实现。双鬼加普通牌暂按双鬼类别处理；含鬼同花顺按 8 倍、含鬼豹子按假豹子 6 倍处理。这些属于首版工程约定，不代表已经核实的唯一传统规则。

以下代码包含四个独立规则函数：classifyHand、compareHands、payoutMultiplier、settleRound。木虱与双鬼采用双向显式比较，不依赖牌型总分排序。

HTML

<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>木虱鱼 · 闸坡厅</title>
<style>
:root{--gold:#f2ce78;--felt:#06452f;--dark:#04150f;--red:#bd3035}
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#020806;color:#fff5dc;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
button,select{font:inherit}
button{cursor:pointer}
.game{position:relative;width:min(100vw,390px);height:min(100dvh,760px);min-height:600px;margin:auto;overflow:hidden;background:radial-gradient(ellipse at 50% 44%,#08734a,#06452f 50%,#03251a 80%,#03130e);border:1px solid #947039}
.game:before{content:"";position:absolute;inset:54px 7px 180px;border:7px solid #50391c;border-radius:48%/22%;box-shadow:inset 0 0 0 2px #d7b65d,inset 0 0 0 5px #103d2a,0 0 0 2px #a98139}
.top{position:absolute;z-index:5;inset:0 0 auto;height:47px;display:flex;align-items:center;justify-content:space-around;padding:0 5px;gap:4px;background:linear-gradient(#141711,#050806);border-bottom:1px solid #b18a42;white-space:nowrap}
.brand{font-size:12px;font-weight:900;color:#ffe0a0}
.meta{font-size:9px;color:#f0dbab}
.sep{height:17px;border-left:1px solid #876d40}
.controls{position:absolute;z-index:7;right:6px;top:53px;display:flex;gap:4px}
select,.small{height:24px;border:1px solid #b89953;border-radius:5px;background:#061a12;color:#f7dfa0;font-size:10px;padding:0 4px}
.pot{position:absolute;z-index:1;top:83px;left:50%;transform:translateX(-50%);padding:4px 10px;border:1px solid #b89550;border-radius:12px;background:#04180fc9;color:#ffe4a3;font-size:10px;white-space:nowrap}
.seats{position:absolute;z-index:2;inset:55px 0 190px;pointer-events:none}
.seat{position:absolute;transform:translate(-50%,-50%);width:88px;padding:4px 3px;text-align:center;border:1px solid #c6a15b77;border-radius:9px;background:#04160fe8;box-shadow:0 3px 8px #0005;font-size:10px}
.seat.side{width:112px;display:flex;align-items:center;gap:4px}
.seat.left{flex-direction:row}
.seat.right{flex-direction:row-reverse;text-align:right}
.avwrap{position:relative;flex:none}
.avatar{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;border:2px solid var(--gold);background:linear-gradient(140deg,#fbe5a4,#94642b);color:#30200a;font-weight:900}
.banker{position:absolute;left:-5px;bottom:-3px;width:16px;height:16px;display:grid;place-items:center;border-radius:50%;background:#a51e27;border:1px solid #ffe39c;color:#ffe6a0;font-size:9px;font-weight:900}
.name{color:#fff0c9;font-weight:800;white-space:nowrap}
.chips{color:var(--gold);font-size:10px;white-space:nowrap}
.backrow{display:flex;justify-content:center;gap:3px;margin-top:3px}
.back{width:17px;height:24px;border-radius:3px;border:1px solid
