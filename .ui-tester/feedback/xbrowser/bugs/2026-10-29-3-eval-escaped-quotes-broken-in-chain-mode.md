# xbrowser bug #3
- 命令: `xbrowser --session <s> -e 'eval "(()=>{const x=document.querySelectorAll(\"script\");...})()"'`
- 严重度: P2 不符预期

## 复现
链式/-e 里执行含转义双引号的 eval JS：
```
xbrowser --session s1 -e 'eval "(()=>{document.querySelectorAll(\"script\").length})()"'
```
报 `SyntaxError: Invalid or unexpected token`，浏览器收到的是带字面量反斜杠的坏 JS。shell 外层单引号内 `\"` 原样传给 xbrowser，chain parser 未对 `\"` 做 JS 字符串反转义。

## 预期 vs 实际
- 预期：JS 内的 `\"` 在传给页面 eval 前被解析为 `"`（或至少报错信息指明是转义问题）
- 实际：SyntaxError 无任何指向性提示；同一条 eval 单独（非链式）执行则成功，行为不一致极难排查

## 当前 workaround（已验证有效）
JS 先存 bash 变量 → base64 → `xbrowser eval "eval(atob('BASE64'))"`，完全绕开引号层。

## 源码定位（只读分析）
- 文件: `src/chain-parser.ts`（命令串按行/&&切分与引号剥离处，未见对 JS 参数做反转义）
- 建议方向: 对 eval/snapshot 等 JS 参数统一做一次 shell 层反转义，或在 SyntaxError 时追加提示"检测到 \" 转义残留，请改用单引号包 JS 或 base64 方案"
