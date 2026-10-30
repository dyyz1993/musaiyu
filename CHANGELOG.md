# 木虱鱼 · 修正记录（审计驱动维护日志）

> 规则：审计/红队每抓到一个问题 → 修复后在此追加一条（版本号 + 日期 + 问题 + 修法 + commit）。
> 版本号 = MAJOR.MINOR.PATCH；PATCH = 审计修正，MINOR = 功能迭代，MAJOR = 架构变更。
> 当前版本：**1.4.2**（见最近一条）

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
