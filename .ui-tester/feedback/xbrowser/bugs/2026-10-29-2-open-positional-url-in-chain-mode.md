# xbrowser bug #2
- 命令: `xbrowser --session <s> -e 'open "https://example.com"'` 及链式 `"set-viewport 390 844 && open https://example.com && ..."`
- 严重度: P1 功能异常（help 文本与实际行为不符）

## 复现
```
xbrowser --session s1 "open https://example.com"          # FAIL
xbrowser --session s1 -e 'open "https://example.com"'     # FAIL
xbrowser --session s1 open https://example.com            # OK（单命令模式）
xbrowser --session s1 "goto https://example.com"          # OK（链式也 OK）
```
前两条报 `Invalid parameters: url: Required`；help 文本却写 `open <url>`。

## 预期 vs 实际
- 预期：链式/-e 模式下 open 与 goto 行为一致（都是位置参数）
- 实际：链式模式下 open 不接受位置参数

## 源码定位（只读分析，不改代码）
- 文件: `src/chain-parser.ts:141` — 只注册了 `registerCommandDefinition('goto', ['url'])`，**没有 `open`**
- `src/cli/browser-routes.ts:219-234` — 单命令模式的 switch 同时处理 goto/open 并手工映射 args[0]→url，所以单命令模式 open 正常
- 建议方向: chain-parser.ts 加 `registerCommandDefinition('open', ['url'])`（或 open 直接 alias 到 goto 定义）
