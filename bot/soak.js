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

// 名字池：前缀×名字 组合出 ~200 个自然昵称，避免出现"阿鱿20807"这种编号味(v1.5.10)
const NAME_PRE = ["阿","小","老","大","细","肥","高","瘦"];
const NAME_CORE = ["豹","蟹","鲷","威","子","香","头","豚","眼","丽","麟","蛋","鲤","卷","鳖",
  "米","蚝","黄","鱿","贝","强","龙","敏","凯","芳","杰","宝","海","坤","白","柱","翠","福","花",
  "剩","妹","珠","妹","琴","弟","伯","叔","婶","哥","姐","仔","妹"];
const NAMES = NAME_PRE.flatMap(p => NAME_CORE.map(c => p + c));
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
  // 池耗尽后加"·序号"后缀，看起来像昵称而不是"阿鱿20807"这种机器编号
  const round = Math.floor(n / NAMES.length);
  return { name: NAMES[n % NAMES.length] + (round ? '·' + (round + 1) : ''), face: FACES[n % FACES.length] };
}

/* ============ 段位算法（用户要求：分级算法挂不同 bot，L3 均值应恒压 L2/L1，用于观测群体是否变聪明） ============ */
const GOOD = ["tianGong9","tianGong8","shuangGui","sanGui","zhenBaoZi","tongHuaShun","hunShun"];
const TIERS = {
  0: { name: 'L0随机',
       decide: () => Math.random() < 0.5 ? 'draw' : 'pass' },
  1: { name: 'L1基础',
       decide: (cards) => {
         const r = E.classifyHand(cards);
         const good = GOOD.includes(r.type) || r.pts >= 7;
         return good ? 'pass' : (Math.random() < 0.8 ? 'draw' : 'pass');
       } },
  2: { name: 'L2进阶',
       decide: (cards) => {
         const r = E.classifyHand(cards);
         if (GOOD.includes(r.type)) return 'pass';
         if (r.pts >= 8) return 'pass';
         if (r.pts >= 6) return Math.random() < 0.3 ? 'draw' : 'pass';   // 6-7 点小概率补
         return 'draw';
       } },
  3: { name: 'L3计数',
       decide: (cards) => {
         const jokers = cards.filter(c => c.joker).length;
         const r = E.classifyHand(cards);
         if (GOOD.includes(r.type)) return 'pass';                        // 特殊牌型已成,绝不重抽(v1.5.4: 此前漏判,会把顺子/豹子按距离公式抽掉)
         const jokersN = jokers;
         if (jokersN > 0) return r.pts >= 7 ? 'pass' : 'draw';            // 有鬼必改良,7 点以上停
         if (r.pts === 0) return 'draw';                                  // 0 点: 期望 4.5 优于 0,且 30% 概率抽成木虱
         if (r.pts >= 7) return 'pass';
         const gap = 9 - r.pts;                                          // 中段收敛(v1.5.4): 0.35+0.15g → 0.25+0.10g
         return Math.random() < Math.min(0.9, 0.25 + gap * 0.1) ? 'draw' : 'pass';
       } },
};
const TIER_KEYS = Object.keys(TIERS).map(Number);
/* 分段战绩（tierstats.json）：跨会话累计，供"群体是否变聪明"趋势观测 */
const TIERSTATS_FILE = path.join(__dirname, 'tierstats.json');
let tierStats = {};
try { tierStats = JSON.parse(fs.readFileSync(TIERSTATS_FILE, 'utf8')); } catch (e) {}
function tierRecord(tier) { return tierStats[tier] ||= { sessions: 0, netSum: 0, finalChipsSum: 0, bankrupts: 0 }; }
function saveTierStats() {
  try { fs.writeFileSync(TIERSTATS_FILE, JSON.stringify(tierStats, null, 1)); } catch (e) {}
}

const DBG = !!process.env.MUY_DBG;
const dlog = (...a) => { if (DBG) log('[dbg]', ...a); };
const fs = require('fs');
/* 行为轨迹：每 bot 一行 JSON（事件+时间点+筹码前后），审计器(bot/audit.js)回放对账 */
const TRAJ_DIR = process.env.MUY_TRAJ_DIR || path.join(__dirname, 'trajectories');
fs.mkdirSync(TRAJ_DIR, { recursive: true });
const trajFiles = new Map();
function track(idName, ev, data = {}) {
  try {
    let f = trajFiles.get(idName);
    if (!f) { f = path.join(TRAJ_DIR, `${idName}.jsonl`); trajFiles.set(idName, f); }
    fs.appendFileSync(f, JSON.stringify({ t: Date.now(), ev, ...data }) + '\n');
  } catch (e) {}
}
function idsess(s) { return `${s.identity.name}|${s.myPid || 'x'}|${Date.now() % 86400000}`; }

class Session {
  constructor(opts = {}) {
    this.identity = opts.identity || newIdentity();
    this.roomHint = opts.roomHint || null;   // {roomId, ante}
    this.tier = opts.tier ?? (seq % TIER_KEYS.length);   // 段位：新号均匀分布，晋升/降级沿会话传递
    this.speed = 0.6 + Math.random() * 0.6;  // 拟人节奏系数(上限1.2→最大延迟11.4s,给服务端15s超时留余量,审计v1.5.1)
    this.myPid = opts.pid || null;
    this.myCards = [];
    this.chips = null;
    this.startChips = null;
    this.done = false; this.seated = false;
    this.tid = `${this.identity.name}-${Date.now().toString(36)}-${Math.floor(Math.random()*999)}`;
    stats.active++;
    this.track('spawn', { room: this.roomHint?.roomId, pid: this.myPid, chips: this.chips, tier: this.tier });
    this.open();
  }

  track(ev, data = {}) {
    track(this.tid, ev, { name: this.identity.name, pid: this.myPid, room: this.room, chips: this.chips, ...data });
  }

  open() {
    // reconnection 必须关：硬断模拟 + 自动重连 = 围观→离场→重连死循环（yxx 同款配置）
    const s = io(SERVER, { path: PATH, transports: ['websocket'], reconnection: false });
    this.sock = s;
    s.on('connect', () => {
      // 服务重启/掉线重连：先试续座（保留筹码与 pid），不行再当新客进房
      if (this.myPid && this.room) {
        this.mode = 'rejoin';
        s.emit('reconnect_player', { roomId: this.room, pid: this.myPid, token: this.token });
        setTimeout(() => { if (this.mode === 'rejoin') this.join(this.room, this.ante); }, 2500);
      } else this.enter();
    });
    s.on('connect_error', () => { stats.connectErr++; });
    s.on('disconnect', () => { if (!this.done) { /* 非自愿断线（服务重启/硬断）按掉线离场，走统一善后 */ this.finish('abrupt'); } });
    s.on('rejoined', d => { this.mode = null; this.seated = true; stats.seated++; this.adopt(d.state); this.armDwell(); });
    s.on('joined', d => { dlog(`joined ${this.identity.name} pid=${d.pid} 房=${d.roomId}`); this.myPid = d.pid; this.room = d.roomId; this.seated = true; stats.seated++; this.adopt(d.state); this.track('joined', { tier: this.tier }); this.armDwell(); });
    s.on('spectator', () => { dlog(`spectator ${this.identity.name}`); this.track('spectator'); this.leave(true); });            // 房满了，换个地方
    s.on('room_rejected', d => { log(`拒入: ${d?.reason || ''}`); this.leave(true); });
    s.on('your_cards', d => { this.myCards = d.cards || []; });
    s.on('player_action', d => { if (d.pid === this.myPid && d.timeout) this.track('timeout_pass'); });   // 服务端托管代打(审计盲区补全, v1.5.1)
    s.on('decision_turn', d => { dlog(`decision_turn ${d.name} pid=${d.pid} 我=${this.myPid}`); if (d.pid === this.myPid) this.act(); });
    s.on('round_start', () => { this.myCards = []; if (Math.random() < 0.15) setTimeout(() => this.safeEmit('toggle_raise', { roomId: this.room, pid: this.myPid, token: this.token }), 300 + Math.random() * 1200); });
    s.on('room_state', st => { const me = st.players.find(p => p.pid === this.myPid); if (me && me.chips !== this.chips) { this.track('chips', { from: this.chips, to: me.chips }); this.chips = me.chips;
      // 破产即离场（审计v1.4.2: 原先只在 dwell 到期时查，0 筹码僵尸会陪跑多局）
      if (this.chips < BANKRUPT && !this.done) setTimeout(() => this.leave(), 800 + Math.random() * 1500);
    } });
    s.on('settle_result', d => { const net = (d.net || {})[this.myPid]; if (net !== undefined) this.track('settle', { net }); });
  }

  adopt(state) {
    const me = state.players.find(p => p.pid === this.myPid);
    if (me) {
      this.chips = me.chips;
      if (this.startChips === null) this.startChips = me.chips;   // 首次快照=本会话基准
    }
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
    this.safeEmit('join_room', { roomId, name: this.identity.name, face: this.identity.face, bot: true, ante, tier: this.tier, botSecret: process.env.MUY_BOT_SECRET || 'mu-bot-2026' });
  }

  safeEmit(ev, data) { try { this.sock.emit(ev, data); } catch (e) {} }

  /* 决策：按段位算法（myCards 由 your_cards 私发填充，v1.4.2 起有真手牌） */
  act() {
    let action = 'pass';
    const t = TIERS[this.tier] || TIERS[0];
    try {
      if (!E || !this.myCards.length) action = TIERS[0].decide();          // 无引擎/无牌退化随机
      else action = t.decide(this.myCards);
    } catch (e) { action = TIERS[0].decide(); }
    const delay = (1500 + Math.random() * 8000) * this.speed;
    setTimeout(() => {
      if (!this.sock.connected) return;
      dlog(`出牌 ${this.identity.name}[${t.name}] → ${action}`);
      this.track('action', { action, cards: this.myCards.length, tier: this.tier });
      this.safeEmit('player_action', { roomId: this.room, pid: this.myPid, action, token: this.token });
      stats.actions++;
    }, delay);
  }

  armDwell() {
    clearTimeout(this.dwellT);
    this.dwellT = setTimeout(() => this.leave(), rand(DWELL));
  }

  /* 统一善后：done 防重入；事件顺序 = bankrupt/tier_shift(结果分类) → leave(终态)，保证轨迹时序单调 */
  finish(kind) {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.dwellT);
    stats.active--; stats.exits++;
    if (kind === 'graceful') stats.graceful++; else stats.abrupt++;
    if (this.seated) { stats.seated--; this.seated = false; }
    const bankrupt = this.chips !== null && this.chips < BANKRUPT;
    if (bankrupt) { log(`${this.identity.name} 破产(筹码${this.chips}) → 换新号`); this.track('bankrupt'); }
    // 分段战绩累计 + 晋降级（赢≥1.5倍升段 / 破产降段）→ 群体向高级自发漂移
    const T = tierRecord(this.tier);
    T.sessions++; T.finalChipsSum += this.chips ?? 0;
    T.netSum += (this.chips ?? 0) - (this.startChips ?? 0);
    if (bankrupt) T.bankrupts++;
    saveTierStats();
    const promote = this.chips !== null && this.startChips !== null && this.chips >= this.startChips * 1.5 && this.tier < 3;
    const demote = bankrupt && this.tier > 0;
    const nextTier = promote ? this.tier + 1 : demote ? this.tier - 1 : this.tier;
    if (nextTier !== this.tier) { log(`${this.identity.name} ${TIERS[this.tier].name}→${TIERS[nextTier].name}(${promote ? '晋升' : '降级'})`); this.track('tier_shift', { from: this.tier, to: nextTier }); }
    this.track('leave', { kind });   // 终态事件最后写
    try {
      if (kind === 'abrupt' && this.sock.io.engine && this.sock.io.engine.close) this.sock.io.engine.close();
      else this.sock.disconnect();
    } catch (e) { try { this.sock.disconnect(); } catch (e2) {} }
    const gap = rand(REGAP);
    setTimeout(() => {
      stats.reentries++;
      if (!bankrupt && this.myPid && this.room && Math.random() < 0.6) {
        new Session({ identity: this.identity, roomHint: { roomId: this.room, ante: this.ante }, pid: this.myPid, tier: nextTier });
      } else new Session({ tier: nextTier });
    }, gap);
  }

  leave(immediate = false) {
    if (this.done) return;
    if (immediate) return this.finish('abrupt');
    if (Math.random() < 0.7) {
      this.safeEmit('leave_room', { roomId: this.room, pid: this.myPid, token: this.token });
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
  if (d) {
    log(`[巡检] 会话=${stats.active} 在座=${stats.seated} 房间=${d.totalRooms}(bot房${(d.rooms || []).filter(r => r.roomId.startsWith('bot_')).length}) 在线=${d.totalOnline} 退出=${stats.exits}(优雅${stats.graceful}/硬断${stats.abrupt}) 回归=${stats.reentries} 出牌=${stats.actions} 回收=${d.totalRecycled ?? 0} RSS=${(mem.rss / 1048576).toFixed(1)}M`);
    // 分段战绩快照（观测"L3 均值 > L2 > L1 > L0"是否成立/群体是否变聪明）
    const tiers = d.tiers || {};
    const line = TIER_KEYS.map(t => {
      const s = tierStats[t] || { sessions: 0, netSum: 0, bankrupts: 0 };
      const avgNet = s.sessions ? (s.netSum / s.sessions).toFixed(0) : '-';
      const live = tiers[t] ? `${tiers[t].players}人` : '0人';
      return `${TIERS[t].name}:场均${avgNet}(破产${s.bankrupts},${live})`;
    }).join(' | ');
    log(`[段位] ${line}`);
  } else log(`[巡检] 服务端不可达 connectErr=${stats.connectErr}`);
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
