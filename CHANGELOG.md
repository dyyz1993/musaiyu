# 木虱鱼 · 修正记录（审计驱动维护日志）

> 规则：审计/红队每抓到一个问题 → 修复后在此追加一条（版本号 + 日期 + 问题 + 修法 + commit）。
> 版本号 = MAJOR.MINOR.PATCH；PATCH = 审计修正，MINOR = 功能迭代，MAJOR = 架构变更。
> 当前版本：**1.5.13**（见最近一条）

## [1.5.13] 2026-10-30 · 审计轮抓到 v1.5.12 双回归：fleet 动作 100% 被拒 + 全员误标真人
- **来源**：审计抽样「大豹」——每条 action 后必跟 timeout_pass（7/7=100%），bot 决策全部失效。深挖出 v1.5.12 的两个回归：
- **回归① waiting 分支漏 bot 受信**：v1.5.12 只在中途入座分支加了 secret 校验，waiting 分支 addPlayer 硬编码 false——服务重启后 fleet 重进空房全变 isBot=false「真人」。
- **回归② mid-game 复用重生成 token**：同名复用座位时无条件 `p.token=randomBytes`——churn 下同身份双会话，B 重挂座即作废 A 的 token，A 全部动作被 v1.5.12 凭证校验拒绝 → 超时托管 → 再入场风暴（会话堆积 2600+）。
- **修法**：waiting 分支补 secret 校验+trusted 贯穿；mid-game 复用保留原 token（仅新座位签发）；fleet join_room 补 botSecret（v1.5.12 的 fleet 补丁中途断言失败致 join_room 行漏发，本次补上）。服务端加临时 [trust-debug] 日志观察。
- **验证**：trust-debug 日志 match=true；10 房 × 8 bot = 80 isBot=true 0 误标；fleet 80 会话满座出牌正常；净差 0。
- commit: (本次)
- **教训**：多分支同一语义的改动必须逐分支核对（本次三处入座路径只改了一处）；部署后必须立即验证核心身份标记（/api/stats bots 计数）而非等下一轮审计。
- **追加（同日）**：部署后仍 302 次 token-mismatch——对照日志（seat=xx got=none）实锤 fleet 发出的 token 是 undefined：v1.5.12 的 fleet 补丁分两次打，第一次中途 assert 失败整文件未写入，第二次只补了三个发射点、**漏了 joined 处理器的 `this.token = d.token` 存储行**——fleet 从未存过 token。一行修复后拒绝数零增长、出牌正常。教训：**补丁脚本中途失败 = 整个文件未写入，"部分生效"是错觉；修复合并在另一个补丁里重打时必须逐行核对覆盖面**。

## [1.5.12] 2026-10-30 · ChatGPT 分诊表服务端安全三件套落地
- **P0-1 会话凭证**：入座即签发 16 字节随机 token（每次入座刷新，旧凭证作废）；player_action/toggle_raise/leave_room/reconnect_player 四入口校验；同名续档必须持座位 token（堵昵称冒领）；**bot 身份受信**：自报 bot:true 必须带共享密钥（MUY_BOT_SECRET，服务端与 fleet 同默认 mu-bot-2026），无 secret 降级普通玩家——堵"自报 bot+同名覆盖在线者 sid 拿私牌"两条复现路径。fleet 全发射点接入 token。
- **P1-5 换房污染**：join_room 换桌语义补 `sock.leave(旧房)`——退出旧广播组，旧房发牌/阶段/结算不再推给新桌连接；所有游戏事件自动携带 roomId（broadcast 一处统一注入）。
- **P1-6 离席结算排除**：reveal 的 active 过滤加 `!p.folded`——明确离席(坐出)玩家不再参与结算。
- **配套**：/api/rooms/:roomId 增加 raised 数组（可观测举手）；快照持久化 token（重启后 fleet 凭证续座不断）。
- **验证**：探针三段实测（正确 token 举手生效 ['p6'] / 伪造 token 被拒状态不变 / 正确撤销 []）；fleet 重启后 80 座满员带 token 正常出牌（巡检出牌=78 递增）。
- commit: dd7c367

## [1.5.11] 2026-10-30 · ChatGPT 审查分诊表前两项落地：出牌回合校验 + XSS
- **来源**：chatgpt-code-review2.md 分诊表 1/2 项（小改高优先）。
- **P1-4 出牌回合校验**：playerAction 增加 `!p.inTurn || p.folded` 拒绝 + 动作枚举（draw/pass）——非当前行动者提交 draw 可提前消耗牌堆（ChatGPT 本地复现）。
- **P0-3 XSS**：昵称/头像拼 innerHTML 无转义。修=新增 `esc()`（五字符转义）全量用于座位/排行/对阵 name；新增 `safeFace()` 白名单（仅 assets/avatars/*.png，默认兜底头像），style 注入点全部接入。
- **备注**：剩余分诊项（P0-1 会话凭证+bot 受信、P1-5 换房 sock.leave+事件 roomId 过滤、P1-6 离席结算、UI 三项）留待下一轮。
- commit: 05f5b73

## [1.5.10] 2026-10-30 · 单机/联机并排对比后发现的 5 个新问题
- **来源**：按用户要求做同视口 390×844 双版并排截图对比，视觉对齐的同时暴露新问题。
- **① lobby 被残留账号打牌 27 局**：探针账号(让座测试员/让座测试员2)留在 lobby，lobby 达 2 真人即 startRound。修=lobby 永不开局/不续局（nextRound 也拦）。
- **② 自己座位丢失后幽灵显示**：我的 pid 已不在 players 里，客户端仍显示底部信息、"等待 阿洲 决策"实际是等另一个同名玩家。修=applyState 检测 myPid 不在桌上 → 清座位 + 自动重新匹配（1.2s 防重入）。
- **③ 单机版自己头像是空金圈**：#meavatar 有 background-size:cover 但从未设 background-image。修=CSS 默认 avatar-m3.png。
- **④ bot 昵称带机器编号**（阿鱿20807）：名字池只 20 个，429k 会话后全变编号。修=前缀×名字 8×47=**376 个自然昵称池**，耗尽后加"·序号"像昵称。
- **⑤ 中途入座本轮无牌却无提示**：玩家以为卡了。修=底部显示「本局坐出 · 下局参战」。
- **另**：联机版自己名字加「（我）」；座位名 overflow 加 min-width:0/flex-shrink 防与筹码重叠。
- **交付**：并排对比图（内嵌双版实拍 + 14 项差异表 + 11 条修复清单）。
- commit: (本次)

## [1.5.9] 2026-10-30 · 用户实测两项：举手自动补牌内化 + 结算页可读性
- **需求①**（用户）："提前举手了，轮到我时不需要再点补牌，会自动补——这个要内化进程序"。旧版 UI 重写时只搬了横幅文案、丢了自动执行。修=decision_turn 轮到自己且已举手时，900ms 后自动 emit draw（横幅"已举手，自动补牌"），零点击。ui-tester 实测：横幅出现→第 3 张牌 898ms 落地（与 setTimeout 900 精确吻合）、drawClicks=0、复现两局（第二局自动补出木虱 ×10）。
- **需求②**（用户）："结算页根本看不清楚"。结算矩阵字号 9.5~10px/迷你牌 16×22 太小。放大一档：矩阵 12.5px/格子 54×36/迷你牌 20×28/行样式 lbrow、mmrow、srow 全部 13.5px。ui-tester 实测：三视图截图肉眼清晰、行 font-size 13.5px、对阵表可横向滚动到"我"列完整可见（顺带修复 v1.5.7 找茬#3 的裁切问题）。
- commit: (本次)

## [1.5.8] 2026-10-30 · 审计采样卡死：轨迹目录膨胀 42.9 万文件/1.7GB（无上限增长）
- **来源**：定时审计 ssh 采样超时 3 分钟+——`for f in *.jsonl` 逐文件 wc 在巨目录上不可行，且 `ls` 已爆 Argument list too long。
- **根因**：fleet 每会话一份轨迹文件、无清理；凌晨 churn 风暴（40 万次退出）期间每个残片会话都落盘，累计 429,352 个文件 1.7GB。
- **修法**：一次性清理（保留最新 5000 个/20MB）；cron 加每日 05:00 清理 24h 前轨迹（`/etc/cron.d/musaiyu-audit`）；审计采样改 `find -mmin -120 | shuf`（时间窗过滤，免全目录展开）。
- commit: (本次)

## [1.5.7] 2026-10-30 · 联机版 UI 统一到单机版豪华视觉 + 真人实测四硬伤修复
- **需求**（用户实测+截图）：进游戏没头像/手牌白板/倒计时环崩溃/筹码 0，"单机版和联机版 UI 为什么有差别？应该只差 socket"。
- **UI 统一**：online.html（499 行简陋壳）以 index.html（1039 行打磨版）为皮重写——豪桌布/椭圆座位/素材按钮/结算三视图/举手双语义全部对齐，socket 层 15 事件+5 发射逐一核对移植，self 头像默认 avatar-m3.png。ui-tester 全流程试玩 7/7 PASS。
- **修复①筹码 0**：同名续档会继承测试期破产的 0 筹码死座（实测用户进桌 0 筹码）。收紧=同名复用须 `!sid && chips>0`（两处分支）。
- **修复②startRing 崩溃**（截图 console 实锤）：倒计时环对缺失容器 querySelector of null。加守卫。
- **修复③HTML 缓存**：用户浏览器滞留旧 JS 反复踩已修 bug。express static 对 .html 加 no-cache。
- **修复④真人匹配困局**：bot 房涨满 9/9 后真人 quickJoin 全落空大厅，且 lobby 不触发匹配。修=join_room 对人类落 lobby/目标满时**从 bot 房腾座**（弃牌优先→筹码最低者让位），真人必有座位；探针实测 lobby join → bot 房在座 12400 筹码。
- **修复⑤看门狗误伤**：50s 无事件强制重连会误杀安静等人的房间（制造 churn）。收敛=仅活跃对局相位且 60s 无事件才触发。
- **运维**：多轮重启的再入场风暴至会话堆积 2617/退出 40 万次（Rss 477M），服务端+舰队双重启清场后 3 分钟恢复 10 房 80 座。
- commit: (本次)

## [1.5.6] 2026-10-30 · 用户进门无人+自己手牌白板——快速匹配与手牌渲染三连修
- **需求**（用户实测反馈）："进去之后没人进来""应该给他们安排头像和名称"。
- **问题①进空大厅**：online.html 进门固定 join lobby，而 bot 舰队全在 bot_r1~r10，大厅永远没人。修=**进门快速匹配**：拉 /api/stats 自动坐进人最多的 bot 房（舰队每房留 1 空座），大厅只作兜底。
- **问题②人类中途进桌被围观**：join_room 的中途入座分支只认 bot:true，人类在对局中进 bot 房会被归为 spectator 永远上不了桌。修=中途入座人/bot 通用：同名刷新者接回原座位（补发 your_cards 私牌），新座位本轮坐出（folded）、下一局正式参战。
- **问题③自己手牌白板（img src="null"）**：三个叠加根因——a) room_state 广播的 hidden 掩码覆盖 your_cards 私发真牌（applyState 增加真牌保留守卫）；b) card_dealt/player_action/forced_draw 三个广播处理器给"自己"也推 hidden 占位（服务端已私发真牌，一律跳过自己）；c) cardFaceSrc 对 hidden 返回 null（回退牌背 B-1.png）。
- **问题④结算面板挡按钮**：面板存续到下一局发牌期，轮到自己时盖住过/补按钮导致回合超时。修=decision_turn 轮到自己时自动收起面板。
- **验收**：ui-tester 三轮递进——快速匹配 4/4 PASS（进 bot_r8、8 个有名有头像 bot、发牌结算推进）；补牌终验 2/2 PASS（点击补一张后 2→3 张全真牌面 H-2/S-5/D-5、无牌背；轮到你时面板自动收起）。
- commit: (本次)

## [1.5.5] 2026-10-30 · 用户点名场景补红队：偷看牌/并发双动作/跨房窜座 + 红队反钓出 ROOM_CAP 饿死环
- **需求**（用户）：红队要覆盖"不合适时机触发/偷看牌/乱窜房间/并发破坏平衡"。
- **新漏洞①偷看牌**：`/api/rooms/:roomId` 监控端点明文返回所有玩家手牌，轮询即可作弊。修=非摊牌阶段只回 `hidden` 牌+cardCount（dashboard 只用 chips，不受影响）。
- **新漏洞②并发双动作**：`playerAction` 无 decided 查重——同 pid 同 tick 发 pass+draw×6，pass 后仍能 draw 多抽。修=入口 `room.decided.has(pid)` 拒绝二次。
- **红队扩容**：A9 并发双动作（cardCount≤3 断言）/ A10 偷看探测（决策期数可见牌面，应为 0）/ A11 跨房窜座断言；报告新增"守卫被击穿"节，flags 非空即 exit 1。
- **红队反钓出真 bug③**：A3 的 20 间 rt_sweep 垃圾房把 ROOM_CAP=8 占满 → 服务重启后舰队重建 bot_r2~r10 全被 room_rejected → 离场→重试→再拒多米诺（会话堆积 109、硬断 +216/分钟）。修=**房上限只数有真人在座的房**（纯 bot 房/空垃圾房不计入，后者本就会被回收）。部署后 3 分钟舰队回填 9 房 70+ 在座，循环解除。
- commit: (本次)

## [1.5.4] 2026-10-30 · ROI 倒挂两轮→挖出 L3 算法真 bug：拿着同花顺去赌 9 点
- **来源**：ROI 观测 L3 连续两轮低于 L2（+28.5→+13.6 vs L2 +53.6→+51.8，差距扩到 38pp），触发"连续两轮才修"协议。
- **根因**：L3 决策缺 `GOOD.includes→pass` 前置判断（L2 有）——特殊牌型 pts 恰好偏低（同花顺 pts=2、顺子 pts=4），距离公式 `0.35+gap×0.15` 对 pts=2 给出 93% 补牌率 → **L3 会把已成的同花顺/豹子按点数公式抽掉**，真牌对照实测：♠3♠4♠5(tongHuaShun) 旧逻辑 93% 重抽。
- **修法**：L3 加特殊牌型前置停牌；有鬼阈值 8→7；中段补牌公式收敛 0.35+0.15g → 0.25+0.10g。真牌单元验证：新 L3 对同花顺停牌率 100%（对照旧版 93% 抽牌）。
- commit: (本次)

## [1.5.3] 2026-10-30 · 兜底审计抓到轨迹时序反转：bankrupt/tier_shift 出现在 leave 之后
- **来源**：本轮兜底 audit exit=1——抽样「春丽5」轨迹 `#12 bankrupt: leave 之后仍有事件`。（主抽样本「海豚71」48 事件为 v1.4.2 前旧样本，账目 20 步逐分吻合，正常。）
- **根因**：soak.js `finish()` 里 `track('leave')` 写在破产检查与晋降级之前 → 破产离场/换段位的会话轨迹顺序为 leave→bankrupt(/tier_shift)，违反审计时序规则（leave 必须是终态）。
- **修法**：重排 finish()——先 track bankrupt → tier_shift（结果分类事件），leave 最后写（终态），断线放最尾。仅舰队侧改动，服务端不动。
- commit: (本次)

## [1.5.2] 2026-10-30 · 大盘段位收益比实时曲线（用户点名 roi 而非命中率）
- **需求**（用户）：监控画面画各段位当前资产+收益比（不是命中率——高赔率策略命中率无意义），一张曲线图看实时变化，平均值即可。
- **实现**：服务端 reveal 结算时按段位累计 tierAgg{net,stake}（内存态，重启重新累计），`/api/stats.tiers` 输出 `roi = net/stake×100%`；大盘新增「段位收益比实时曲线」折线图——L0~L3 四条彩线、5 秒一采样、90 点滚动窗、y 轴 % 刻度。
- **验收**：ui-tester 3/3 PASS（4 线图例/曲线延伸 7→9 点/% 刻度），截图 /tmp/roi-chart*.png。首轮读数 L0 +54.8% / L2 +14.2% / L3 -18.6% / L1 -52.9%（小样本互有胜负，长期看趋势）。
- commit: (本次)

## [1.5.1] 2026-10-30 · AI 审读第二轮：超时代打可归因 + 决策余量加宽
- **来源**：抽样「蟹黄62」26 事件——入房 54 秒后无任何 action 却 -6600（6×底注），全场 9 个 action 的 cards 恒 0。
- **排查**：①cards:0 定性为虚惊——该会话横跨 v1.4.2 部署瞬间（旧进程尾巴）；v1.5.0 后生产 159/159 条 action cards=2，盲打修复生效确认。②"未行动先吃结算"定性为**服务端 15s 超时托管**在自动代过（守卫正确行为），但轨迹只记客户端主动出牌→审计无法归因；且客户端最大决策延迟 13.3s 贴着 15s 上限（余量 1.7s），近 40 会话 17% 撞过超时。
- **修法**：①player_action 广播带 `timeout: isTimeout`，soak.js 收到自己 pid 的托管代打记 `timeout_pass` 轨迹事件（盲区补全）；②speed 系数 0.6~1.4 收窄到 0.6~1.2（最大延迟 11.4s，余量 3.6s），降低误伤率。
- commit: (本次)

## [1.5.0] 2026-10-30 · 段位算法系统（观测"群体是否变聪明"）
- **需求**（用户）：bot 分四套算法挂不同用户——L0随机/L1基础/L2进阶/L3计数，高段位均值应恒压低段位；以此做尺子观测整体棋力是否竞争提升。
- **实现**：soak.js `TIERS` 四档决策函数（L0=五五开随机；L1=牌力阈值（好牌停/烂牌 80% 补）；L2=8 点以上停+6-7 点低概率补；L3=有鬼冲天公/0 点赌翻盘/按离 9 的距离补牌概率递增）。段位随 join_room 上报服务端（p.tier），轨迹 spawn/action 全带 tier 字段。
- **统计**：bot 侧 `tierstats.json` 跨会话累计（sessions/netSum/finalChipsSum/bankrupts）；服务端 `/api/stats` 新增 `tiers` 分段在线与场均筹码；巡检日志每分钟打一行 `[段位] L0场均X | L1场均X | ...`。
- **晋升/降级**：单会话筹码 ≥1.5 倍起步升段（上限 L3）、破产降段（下限 L0）——群体自发向高级漂移，漂移速度本身就是"整体变聪明"的可观测量。
- **连带修复**：中途入座分支（`else if (bot && !isFull)`）addPlayer 漏带 tier → /api/stats tiers 恒空的 bug（本地 120s 复验 4 段数据齐）。
- **趋势基线（150s 小样本，仅供起步参考）**：L2 场均 +1000 > L1 -160 > L0 -725（L3 样本 7 场 -40 待放量）；长期趋势由 ZCode 审读任务按小时观测 tierstats.json。
- commit: (本次)

## [1.4.2] 2026-10-30 · AI 审读抓到两真问题：bot 盲打 + 破产僵尸
- **来源**：新流程——ZCode 定时任务随机抽用户原始轨迹给 AI 逐条读（不再只跑写死的校验）。首轮抽中「鱼蛋5」42 事件。
- **问题①**：42 条 action 的 cards 字段全部为 0——服务端发牌从未私发 `your_cards`（单机版有、服务端版丢失），bot 的 myCards 恒空 → engine.js 牌力决策分支从未生效，**80 bot 全程纯随机出牌**。
- **修法①**：服务端三处补私发——dealCards 起手、单鬼强制补、playerAction 补牌，均 `io.sockets.sockets.get(p.sid).emit('your_cards',{cards})`。本地验证：修复前 cards 恒 0 → 修复后 22/22 条 action cards=2。
- **问题②**：破产 bot（chips<500）要等 dwell 到期才离场，期间以 0 筹码陪跑 8 局空转（net 全 0/±1）。
- **修法②**：soak.js 在 room_state 检测到 chips<BANKRUPT 时 0.8~2.3s 内立即触发离场（保留优雅/硬断 70/30 分布）。
- commit: (本次)

## [1.4.1] 2026-10-30 · 红队抓到真 bug：销毁房间被定时器复活 + 快照无限还魂
- **问题**（生产红队压测抓到）：红队 A3/A4 制造的 rt_ 垃圾房在服务端日志显示"已回收"（计数+1），但 API 永远查得到。根因两条链：①`reveal` 尾部的 `setTimeout(nextRound, 6000)` 不看房间死活，sweep 删除后又把 `phase='waiting'` 写回并重建局面（僵尸复活）；②被删房间在闭包定时器里继续 `scheduleSave()`，快照里写回 rt_ 房 → 服务重启 `restoreRooms` 再恢复 → 再回收 → 再写回，无限还魂。
- **修法**：`destroyRoom` 打 `destroyed` 标记；`startRound`/`nextRound` 入口见标记（或 `!rooms.has(id)`）直接 return（定时器尾巴到此为止）；`serializeRooms` 过滤 destroyed；`restoreRooms` 跳过空壳真人房（round=0 且 players 空）。本地复现红队场景：回收后 0 残留、重启不带回。
- commit: (本次)

## [1.4.0] 2026-10-30 · 混沌测试体系上线（红队 + 房间巡检）
- **新增** `bot/redteam.js`：8 类攻击向量（替出牌/座位劫持/join 轰炸/非法载荷/未入房出牌/超速连断/重入竞争/巨型载荷），本地全绿——服务端不崩、net=0、垃圾房自动回收、守卫 5/5 不破。
- **新增** audit.js 房间状态巡检：相变合法性/超员/负筹码/局数越界/RSS>1G/房间数>200。
- **新增** shanbox cron：`*/10` 审计抽样、`*/30` 红队压测（/etc/cron.d/musaiyu-audit）。
- commit: (本次)

## [1.3.1] 2026-10-30 · 审计端点 TDZ 500
- **问题**（audit.js 首跑抓到）：`GET /api/audit` 500——端点内 `const rooms = [...rooms.values()]` 遮蔽外层 `rooms`，自己引用自己触发 TDZ。
- **修法**：局部变量改名 `list`。
- commit: f9412ca

## [1.3.0] 2026-10-30 · 监控审计体系（守卫 + 轨迹 + 定时抽查）
- **新增** 服务端守卫：player_action/toggle_raise 身份校验（防替出牌）、reconnect_player 拒认领有主座位+单连接单座（防劫持，守卫测试 5/5）、join_room 换桌自动释放旧座、rejoined 完整恢复（state+pid+myCards+phase）。
- **新增** `/api/audit` 对账端点（全场筹码恒等式 totalNet≡0 + RSS）。
- **新增** soak.js JSONL 行为轨迹（spawn/joined/chips/settle/action/leave/bankrupt）；audit.js 抽样回放对账；shanbox cron `*/10`。
- commit: f9412ca

## [1.2.1] 2026-10-30 · 舰队重连死循环 + 身份共座
- **问题**（浸泡压测抓到）：①硬断模拟 + `reconnection:true` = 围观→离场→重连死循环（实测 2.1 万次退出、RSS 761M）；②`seq` 未自增 → 80 bot 全叫"阿豹"，服务端同名续档把全部连接并到一个座位。
- **修法**：`reconnection:false` + 断线统一走 finish() 善后；`newIdentity()` 内 `seq++`。
- commit: dcd63dd

## [1.2.0] 2026-10-30 · 机器人改外部 socket.io 客户端舰队
- **架构**（用户拍板"必须真 WS 网络玩家"）：删服务端内置自嗨机，新建 `bot/soak.js`（对标 yxx soak_lifecycle）：80 bot=10 房×8 人，随机停留/优雅离场 70%/硬断 30%/回归续座/加权选房留真人空座/破产换号/金丝雀/巡检。
- **连带修复 P0**：`startRound` 从未构建牌堆（deck 恒空，发牌必 pop undefined）——此前被内置自嗨机自带的洗牌掩盖，真人房第一局就会崩。每局 `E.shuffle(E.buildDeck())`。
- **新增** 服务端中途入座坐出（folded，下轮参战，reveal 只结算有牌者）、leave_room 优雅离场、局间死座清扫。
- commit: dcd63dd

## [1.1.0] 2026-10-30 · 房间生命周期
- 真人房上限 8（ROOM_CAP env 可调）、空房 5 分钟自动回收（ROOM_EMPTY_MS）、room_rejected 拒入事件；快照持久化（3s 防抖+SIGTERM+启动恢复+同名续档）。
- commit: 403d471 / 4fe0366

## [1.0.0] 2026-10-30 · 联机版上线（socket.io v4 服务端 + 双通道部署）
- shanbox:3010 supervisord 托管 + musaiyu.pages.dev；专属路径 /musaiyu/socket.io/（全局 /socket.io/ 被 yxx 劫持）；CORS 收敛 nginx 单头；大盘扇形版（状态占比 + 资金入出/零和守恒 + 事件流）。
- commit: 9517080..aa7e207
