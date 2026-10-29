# xbrowser bug #1
- 命令: `xbrowser --session <s> network "https://host/page.html" --listen --duration 12000 [--filter socket --ws true --console true]`（位置参数与 --url 两种传法都试过）
- 严重度: P1 功能异常

## 复现
1. 先 open 一个页面建立 session
2. 执行 `network "<url>" --listen --duration 12000`（无论是否带 filter/--ws/--console/--format json）
3. 输出恒为 `captures: (empty list) / console: (empty list) / total: 0`，期间页面内明明有 socket.io WS 帧和轮询流量（已用页内 eval 原生 WebSocket 探针证实帧双向流动）

## 预期 vs 实际
- 预期：listen 模式捕获期间该页所有 response/WS 帧
- 实际：恒空。且对用户有误导——传了 URL 以为会"导航并捕获加载期流量"，实际什么都没发生也无提示

## 源码定位（只读分析，不改代码）
- 文件: `src/commands/network.ts:253-283`（listen 分支）
- 根因: listen 分支只对 `ctx.page` 挂 `page.on('response'|'console'|'websocket')` 然后 `waitForTimeout(duration)`；**从不 goto p.url**（goto 只存在于非 listen 的临时上下文路径 network.ts:338）。session 页面空闲时无流量 → 捕获为空。
- 建议方向: listen 模式收到 url 时先 `page.goto(url)` 再挂监听（或挂监听后立即 reload），否则输出提示 "listen mode ignores url; capturing current idle page"。

## 关联语义问题（建议同修或补文档）
`console` 命令同样只向前采集 duration 毫秒（默认 5000），不含历史 buffer。测试"页面加载期错误"必须在导航前先启动采集，但 console/network 都没有"先挂监听→再 goto"的组合能力，导致加载期错误基本抓不到。
