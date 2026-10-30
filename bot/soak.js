#!/usr/bin/env node
/* soak.js — 木虱鱼外部 bot 舰队（对标 yxx soak_lifecycle.js）
 * 真实网络玩家：socket.io-client 走 WS 连服务端，和服务端内置逻辑零耦合。
 * 行为：随机停留 → 70% 优雅退 / 30% 模拟掉线硬断 → 0.5~3 分钟回归
 *      （60% 老身份先试 reconnect_player 续座 / 40% 换新号），加权选房；
 *      筹码跌破 500 破产换新号；金丝雀定期建空房验证销毁路径；60s 巡检日志。
 * 用法: MUY_SERVER=... MUY_ROOMS=10 MUY_PER=8 node soak.js   （MUY_FAST=1 快跑模式）
 */
const io = require('socket.io-client');
const http = require('http');
const path = require('path');

const SERVER = process.env.MUY_SERVER || 'http://127.0.0.1:3010';
const PATH = '/musaiyu/socket.io/';
const ROOMS = +process.env.MUY_ROOMS || 10;
const PER = +process.env.MUY_PER || 8;
const FAST = !!process.env.MUY_FAST;
const DWELL = FAST ? [30e3, 60e3] : [5 * 60e3, 15 * 60e3];   // 停留须明显长于一局(~30s)，否则永远凑不齐开局
const REGAP = FAST ? [2e3, 6e3] : [30e3, 180e3];
const CANARY_EVERY = FAST ? 60e3 : 10 * 60e3;
const CANARY_SIT = FAST ? 5e3 : 45e3;
const PATROL = FAST ? 15e3 : 60e3;
const ANTE = i => 200 + i * 100;
const BANKRUPT = 500;

let E = null;
try { E = require(path.join(__dirname, 'engine.js')); } catch (e) { /* 没带 engine 就纯随机决策 */ }

const NAMES = ["阿豹","小蟹","老鲷","阿威","丸子","阿香","石头","海豚","大眼","春丽",
  "阿麟","鱼蛋","阿鲤","花卷","老鳖","虾米","阿蚝","蟹黄","阿鱿","贝贝"];
const FACES = ["assets/avatars/avatar-m1.png","assets/avatars/avatar-f1.png","assets/avatars/avatar-m2.png",
  "assets/avatars/avatar-f2.png","assets/avatars/avatar-m3.png","assets/avatars/avatar-f3.png"];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const rand = ([a, b]) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const stats = { active: 0, seated: 0, exits: 0, graceful: 0, abrupt: 0, reentries: 0, actions: 0, raises: 0, connectErr: 0 };
let seq = 0;

function fetchStats() {
  return new Promise(res => {
    http.get(SERVER + '/musaiyu/api/stats', r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } });
    }).on('error', () => res(null));
  });
}

/* 加权选房：优先人多的 bot_ 房，但只进 ≤PER-1 的房（给真人留 1 个空座） */
async function pickRoom(exclude) {
  const d = await fetchStats();
  const rooms = (d?.rooms || []).filter(r => r.roomId.startsWith('bot_') && r.roomId !== exclude && r.online < PER);
  if (!rooms.length) return null;
  const total = rooms.reduce((a, r) => a + r.online + 1, 0);
  let x = Math.random() * total;
  for (const r of rooms) { x -= r.online + 1; if (x <= 0) return { roomId: r.roomId, ante: r.ante }; }
  const r = rooms[rooms.length - 1];
  return { roomId: r.roomId, ante: r.ante };
}

function newIdentity() {
  const n = seq++;   // 每个身份唯一序号（漏了自增会让全体 bot 同名共座）
  return { name: NAMES[n % NAMES.length] + (n >= NAMES.length ? String(Math.floor(n / NAMES.length) + 1) : ''), face: FACES[n % FACES.length] };
}

const DBG = !!process.env.MUY_DBG;
const dlog = (...a) => { if (DBG) log('[dbg]', ...a); };

class Session {
  constructor(opts = {}) {
    this.identity = opts.identity || newIdentity();
    this.roomHint = opts.roomHint || null;   // {roomId, ante}
    this.speed = 0.6 + Math.random() * 0.8;  // 拟人节奏系数
    this.myPid = opts.pid || null;
    this.myCards = [];
    this.chips = null;
    this.done = false; this.seated = false;
    stats.active++;
    this.open();
  }

  open() {
    // reconnection 必须关：硬断模拟 + 自动重连 = 围观→离场→重连死循环（yxx 同款配置）
    const s = io(SERVER, { path: PATH, transports: ['websocket'], reconnection: false });
    this.sock = s;
    s.on('connect', () => {
      // 服务重启/掉线重连：先试续座（保留筹码与 pid），不行再当新客进房
      if (this.myPid && this.room) {
        this.mode = 'rejoin';
        s.emit('reconnect_player', { roomId: this.room, pid: this.myPid });
        setTimeout(() => { if (this.mode === 'rejoin') this.join(this.room, this.ante); }, 2500);
      } else this.enter();
    });
    s.on('connect_error', () => { stats.connectErr++; });
    s.on('disconnect', () => { if (!this.done) { /* 非自愿断线（服务重启/硬断）按掉线离场，走统一善后 */ this.finish('abrupt'); } });
    s.on('rejoined', d => { this.mode = null; this.seated = true; stats.seated++; this.adopt(d.state); this.armDwell(); });
    s.on('joined', d => { dlog(`joined ${this.identity.name} pid=${d.pid} 房=${d.roomId}`); this.myPid = d.pid; this.room = d.roomId; this.seated = true; stats.seated++; this.adopt(d.state); this.armDwell(); });
    s.on('spectator', () => { dlog(`spectator ${this.identity.name}`); this.leave(true); });            // 房满了，换个地方
    s.on('room_rejected', d => { log(`拒入: ${d?.reason || ''}`); this.leave(true); });
    s.on('your_cards', d => { this.myCards = d.cards || []; });
    s.on('decision_turn', d => { dlog(`decision_turn ${d.name} pid=${d.pid} 我=${this.myPid}`); if (d.pid === this.myPid) this.act(); });
    s.on('round_start', () => { this.myCards = []; if (Math.random() < 0.15) setTimeout(() => this.safeEmit('toggle_raise', { roomId: this.room, pid: this.myPid }), 300 + Math.random() * 1200); });
    s.on('room_state', st => { const me = st.players.find(p => p.pid === this.myPid); if (me) this.chips = me.chips; });
  }

  adopt(state) {
    const me = state.players.find(p => p.pid === this.myPid);
    if (me) this.chips = me.chips;
  }

  async enter() {
    if (this.roomHint) this.join(this.roomHint.roomId, this.roomHint.ante);
    else {
      // 全满就等一会再挑（满房在 churn 下会腾出位置），最多等 5 轮
      for (let i = 0; i < 5 && !this.done; i++) {
        const r = await pickRoom();
        if (r) return this.join(r.roomId, r.ante);
        await new Promise(res => setTimeout(res, 8000));
      }
      if (!this.done) this.join('bot_r1', 200);
    }
  }

  join(roomId, ante) {
    this.room = roomId; this.ante = ante;
    this.safeEmit('join_room', { roomId, name: this.identity.name, face: this.identity.face, bot: true, ante });
  }

  safeEmit(ev, data) { try { this.sock.emit(ev, data); } catch (e) {} }

  /* 决策：有 engine 按牌力（好牌停牌/差牌 80% 要牌），否则随机；延迟 1.5~9.5s × 节奏 */
  act() {
    let action = Math.random() < 0.7 ? 'draw' : 'pass';
    if (E && this.myCards.length) {
      try {
        const r = E.classifyHand(this.myCards);
        const good = ["tianGong9","tianGong8","shuangGui","sanGui","zhenBaoZi","tongHuaShun","hunShun"].includes(r.type) || r.pts >= 7;
        action = good ? 'pass' : (Math.random() < 0.8 ? 'draw' : 'pass');
      } catch (e) {}
    }
    const delay = (1500 + Math.random() * 8000) * this.speed;
    setTimeout(() => {
      if (!this.sock.connected) return;
      dlog(`出牌 ${this.identity.name} → ${action}`);
      this.safeEmit('player_action', { roomId: this.room, pid: this.myPid, action });
      stats.actions++;
    }, delay);
  }

  armDwell() {
    clearTimeout(this.dwellT);
    this.dwellT = setTimeout(() => this.leave(), rand(DWELL));
  }

  /* 统一善后：done 防重入；graceful 发 leave_room 释放座位，abrupt 硬断模拟掉线 */
  finish(kind) {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.dwellT);
    stats.active--; stats.exits++;
    if (kind === 'graceful') stats.graceful++; else stats.abrupt++;
    if (this.seated) { stats.seated--; this.seated = false; }
    try {
      if (kind === 'abrupt' && this.sock.io.engine && this.sock.io.engine.close) this.sock.io.engine.close();
      else this.sock.disconnect();
    } catch (e) { try { this.sock.disconnect(); } catch (e2) {} }
    const bankrupt = this.chips !== null && this.chips < BANKRUPT;
    if (bankrupt) log(`${this.identity.name} 破产(筹码${this.chips}) → 换新号`);
    const gap = rand(REGAP);
    setTimeout(() => {
      stats.reentries++;
      if (!bankrupt && this.myPid && this.room && Math.random() < 0.6) {
        new Session({ identity: this.identity, roomHint: { roomId: this.room, ante: this.ante }, pid: this.myPid });
      } else new Session({});
    }, gap);
  }

  leave(immediate = false) {
    if (this.done) return;
    if (immediate) return this.finish('abrupt');
    if (Math.random() < 0.7) {
      this.safeEmit('leave_room', { roomId: this.room, pid: this.myPid });
      setTimeout(() => this.finish('graceful'), 300);
    } else this.finish('abrupt');
  }
}

/* 金丝雀：定期建一间真人空房坐一会儿就走，验证空房销毁路径（服务端 5 分钟回收） */
let canaryN = 0;
function canary() {
  const roomId = 'canary_' + Date.now().toString(36);
  const s = io(SERVER, { path: PATH, transports: ['websocket'], reconnection: false });
  s.on('connect', () => {
    s.emit('join_room', { roomId, name: '金丝雀' + (++canaryN), face: FACES[0] });
    log(`金丝雀进房 ${roomId}，${CANARY_SIT / 1000}s 后离开（应在空窗期后被回收）`);
    setTimeout(() => { try { s.disconnect(); } catch (e) {} }, CANARY_SIT);
  });
  s.on('connect_error', () => s.close());
}

/* 巡检：自己舰队 + 服务端房间/回收 + 内存 */
async function patrol() {
  const d = await fetchStats();
  const mem = process.memoryUsage();
  if (d) log(`[巡检] 会话=${stats.active} 在座=${stats.seated} 房间=${d.totalRooms}(bot房${(d.rooms || []).filter(r => r.roomId.startsWith('bot_')).length}) 在线=${d.totalOnline} 退出=${stats.exits}(优雅${stats.graceful}/硬断${stats.abrupt}) 回归=${stats.reentries} 出牌=${stats.actions} 回收=${d.totalRecycled ?? 0} RSS=${(mem.rss / 1048576).toFixed(1)}M`);
  else log(`[巡检] 服务端不可达 connectErr=${stats.connectErr}`);
  // 缺口补员：在座数低于编制就补（覆盖服务端重启导致的全军覆没）
  const deficit = ROOMS * PER - stats.seated;
  for (let i = 0; i < deficit; i++) setTimeout(() => new Session({}), i * 300);
}

(async () => {
  log(`舰队启动: ${ROOMS} 房 × ${PER} 人=${ROOMS * PER} bot | ${FAST ? '快跑模式' : '生产节奏'} | server=${SERVER}`);
  // 首轮：轮转填满各房
  for (let j = 0; j < ROOMS * PER; j++) {
    const ri = j % ROOMS;
    new Session({ roomHint: { roomId: 'bot_r' + (ri + 1), ante: ANTE(ri) } });
    await new Promise(r => setTimeout(r, 150));
  }
  setInterval(patrol, PATROL); patrol();
  setInterval(canary, CANARY_EVERY);
  // 兜底补员：某房人数跌破 2（对局停摆）就补一个
  setInterval(async () => {
    const d = await fetchStats();
    for (const r of (d?.rooms || [])) {
      if (r.roomId.startsWith('bot_') && r.online < 2) {
        log(`补员 → ${r.roomId}（当前 ${r.online} 人）`);
        new Session({ roomHint: { roomId: r.roomId, ante: r.ante } });
      }
    }
  }, PATROL);
})();
