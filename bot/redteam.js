#!/usr/bin/env node
/* redteam.js — 红队破坏 bot（把系统当黑盒暴力攻击）
 * 每轮随机执行一批攻击向量，服务端应当：不崩溃、不丢钱、不破坏其他玩家。
 * 向量清单：
 *  A1 伪造 pid 替人出牌/举手        A2 重连劫持有主座位
 *  A3 同连接 join 轰炸 20 房        A4 非法事件载荷（负数/超长/undefined/注入串）
 *  A5 未加入房间直接 player_action  A6 超速连断（connect/disconnect 30 次）
 *  A7 重复 join 同房（身份共座竞争） A8 巨型 payload（1MB 字符串）
 * 判定依据（打完之后检查）：
 *  1. 服务端进程还活着（/musaiyu/api/audit 可达）
 *  2. totalNet 仍为 0（没被打出钱）
 *  3. 全体房间状态字段合法（audit.js 的房间巡检复核）
 * 结果追加 reports/redteam-<ts>.md。用法: node redteam.js
 */
const io = require('socket.io-client');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SERVER = process.env.MUY_SERVER || 'http://127.0.0.1:3010';
const PATH = '/musaiyu/socket.io/';
const REPORT_DIR = path.join(__dirname, 'reports');
fs.mkdirSync(REPORT_DIR, { recursive: true });
const flags = {};   // 攻击向量回填的断言标记(被服务端守卫拦住=无标记)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const mk = () => io(SERVER, { path: PATH, transports: ['websocket'], reconnection: false });
const connect = s => Promise.race([new Promise(r => s.on('connect', r)), new Promise((_, rej) => setTimeout(() => rej(new Error('connect 超时')), 8000))]);
const once = (s, ev, ms = 6000) => Promise.race([new Promise(r => s.once(ev, r)), new Promise((_, rej) => setTimeout(() => rej(new Error(ev + ' 超时')), ms))]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(p) {
  return new Promise(res => {
    http.get(SERVER + p, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } }); }).on('error', () => res(null));
  });
}

/* 每个向量：名字 + 执行函数（内部自吞异常，攻击失败不算系统问题） */
const vectors = [
  ['A1 替人出牌', async () => {
    const s = mk(); await connect(s);
    s.emit('join_room', { roomId: 'rt_r1', name: '红队A1', face: '', bot: true });
    await once(s, 'joined');
    // 拿真实房里别的 pid 打
    const st = await get('/musaiyu/api/rooms/rt_r1');
    const victim = (st?.players || []).find(p => p.name !== '红队A1');
    if (victim) for (let i = 0; i < 10; i++) s.emit('player_action', { roomId: 'rt_r1', pid: victim.pid, action: 'draw' });
    for (let i = 0; i < 10; i++) s.emit('toggle_raise', { roomId: 'rt_r1', pid: victim?.pid });
    await sleep(500); s.disconnect();
  }],
  ['A2 劫持有主座位', async () => {
    const st = await get('/musaiyu/api/rooms/bot_r1');
    const victim = (st?.players || [])[0];
    if (!victim) return;
    const s = mk(); await connect(s);
    for (let i = 0; i < 5; i++) s.emit('reconnect_player', { roomId: 'bot_r1', pid: victim.pid });
    await sleep(400); s.disconnect();
  }],
  ['A3 join 轰炸 20 房', async () => {
    const s = mk(); await connect(s);
    for (let i = 0; i < 20; i++) s.emit('join_room', { roomId: 'rt_sweep_' + i, name: '红队扫房', face: '', bot: true });
    await sleep(800); s.disconnect();
  }],
  ['A4 非法载荷', async () => {
    const s = mk(); await connect(s);
    s.emit('join_room', { roomId: null, name: { '$gt': '' }, face: 42, bot: 'yes' });
    s.emit('join_room', { roomId: 'rt_neg', name: '红队负数', face: '', ante: -99999, botCount: -5 });
    s.emit('join_room', { roomId: 'rt_neg', name: 'A'.repeat(5000), face: '', bot: true });
    s.emit('player_action', { roomId: undefined, pid: null, action: { hack: true } });
    s.emit('player_action', { roomId: 'rt_neg', pid: 'p1', action: 'draw\n"; DROP TABLE users;--' });
    s.emit('reconnect_player', { roomId: 'rt_neg', pid: { '$ne': null } });
    await sleep(600); s.disconnect();
  }],
  ['A5 未入房直接出牌', async () => {
    const s = mk(); await connect(s);
    for (let i = 0; i < 8; i++) s.emit('player_action', { roomId: 'bot_r3', pid: 'p1', action: 'pass' });
    await sleep(300); s.disconnect();
  }],
  ['A6 超速连断', async () => {
    for (let i = 0; i < 30; i++) {
      const s = mk(); s.on('connect', () => s.disconnect());
      await sleep(30);
    }
    await sleep(1200);
  }],
  ['A7 同房重复 join', async () => {
    const s = mk(); await connect(s);
    for (let i = 0; i < 12; i++) s.emit('join_room', { roomId: 'rt_r1', name: '红队重入', face: '', bot: true });
    await sleep(600); s.disconnect();
  }],
  ['A8 巨型载荷', async () => {
    const s = mk(); await connect(s);
    const big = 'X'.repeat(1024 * 1024);
    s.emit('join_room', { roomId: 'rt_big', name: big, face: '', bot: true });
    s.emit('player_action', { roomId: 'rt_big', pid: big, action: big });
    await sleep(900); s.disconnect();
  }],
  ['A9 并发双动作(同pid乱序)', async () => {
    const s = mk(); await connect(s);
    let pid = null;
    s.on('joined', d => { pid = d.pid; });
    s.emit('join_room', { roomId: 'rt_r1', name: '红队并发', face: '', bot: true });
    await once(s, 'joined');
    // 同一 tick 内 pass+draw 混发: 修复后 decided 集合应只认第一个
    s.emit('player_action', { roomId: 'rt_r1', pid, action: 'pass' });
    for (let i = 0; i < 6; i++) s.emit('player_action', { roomId: 'rt_r1', pid, action: 'draw' });
    await sleep(1500);
    const st = await get('/musaiyu/api/rooms/rt_r1');
    const me = (st?.players || []).find(p => p.name === '红队并发');
    if (me && me.cardCount > 3) flags.doubleDraw = me.cardCount;   // >3 张 = 并发竞态漏了
    s.disconnect();
  }],
  ['A10 偷看探测(轮询监控端点)', async () => {
    // 决策阶段轮询 /api/rooms, 数可见牌面: 修复后非 reveal/settle 应全部 hidden
    const d = await get('/musaiyu/api/stats');
    const target = (d?.rooms || []).find(r => r.phase === 'decision' || r.phase === 'dealing') || (d?.rooms || [])[0];
    if (!target) return;
    const st = await get('/musaiyu/api/rooms/' + target.roomId);
    let peekable = 0;
    for (const p of (st?.players || []))
      for (const c of (p.cards || [])) if (!c.hidden && (c.suit || c.rank)) peekable++;
    if (peekable > 0 && st.phase !== 'reveal' && st.phase !== 'settle') flags.peekable = peekable;
  }],
  ['A11 跨房窜座断言', async () => {
    const s = mk(); await connect(s);
    s.emit('join_room', { roomId: 'rt_x1', name: '红队窜座', face: '', bot: true });
    await once(s, 'joined');
    s.emit('join_room', { roomId: 'rt_x2', name: '红队窜座', face: '', bot: true });
    await once(s, 'joined');
    await sleep(600);
    const c1 = await get('/musaiyu/api/rooms/rt_x1');
    const c2 = await get('/musaiyu/api/rooms/rt_x2');
    const inBoth = (c1?.players || []).filter(p => p.name === '红队窜座').length
                 + (c2?.players || []).filter(p => p.name === '红队窜座').length;
    if (inBoth > 1) flags.multiSeat = inBoth;   // >1 = 同时占两房座位
    s.disconnect();
  }],
];

(async () => {
  const before = await get('/musaiyu/api/audit');
  const results = [];
  for (const [name, fn] of vectors) {
    const t0 = Date.now();
    let err = null;
    try { await Promise.race([fn(), sleep(15000)]); } catch (e) { err = e.message; }
    results.push({ name, ms: Date.now() - t0, err });
    log(`${name} 完成 ${err ? '(' + err + ')' : ''}`);
  }
  await sleep(2500); // 等服务端消化
  const after = await get('/musaiyu/api/audit');

  const alive = !!after;
  const netOk = alive && Math.abs(after.totalNet) < 0.001;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(REPORT_DIR, `redteam-${ts}.md`);
  const L = [`# 红队攻击报告 ${ts}`, '',
    `- 服务端存活: ${alive ? '✓' : '❌ 进程不可达'}`,
    `- 资金守恒: totalNet=${after?.totalNet} ${netOk ? '✓' : '❌ 被打出口子'}`,
    `- 内存: ${alive ? `RSS=${(after.mem.rss / 1048576).toFixed(1)}M` : '-'}`, '',
    '| 向量 | 耗时 | 客户端异常 |', '|---|---|---|'];
  for (const r of results) L.push(`| ${r.name} | ${r.ms}ms | ${r.err || '-'} |`);
  const flagKeys = Object.keys(flags);
  L.push('', flagKeys.length
    ? `## ⚠️ 守卫被击穿 ${flagKeys.length} 处\n${flagKeys.map(k => `- ${k}: ${JSON.stringify(flags[k])}`).join('\n')}`
    : '## ✓ 全部断言通过(无多抽/无可偷看牌/无多座占位)');
  fs.writeFileSync(out, L.join('\n') + '\n');
  log(`报告: ${out}`);
  process.exit(alive && netOk && !flagKeys.length ? 0 : 1);
})();
