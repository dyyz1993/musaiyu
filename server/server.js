// 木虱鱼 · 服务端权威 v4 (duobi-v1)
// Bot 生态系统：多种性格/自动进房/跑路/换桌/举手/快速匹配/监控大盘
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const E = require('./engine.js');

const PORT = process.env.PORT || 3010;
const MY_TURN_SEC = 15, AI_TURN_SEC = 5;
const ROOM_CAP = +process.env.ROOM_CAP || 8;                 // 真人房上限（不含 bot 自嗨房与大厅）
const ROOM_EMPTY_MS = +process.env.ROOM_EMPTY_MS || 5*60*1000; // 最后一个真人走后多久销毁
const SWEEP_MS = +process.env.SWEEP_MS || 60*1000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  // shanbox 反代把全局 /socket.io/ 劫持给 yxx(3090)，musaiyu 必须走专属路径避开；
  // CORS 统一由 nginx add_header 出(重复 ACAO 头会被浏览器拒)，这里不配 cors
  path: '/musaiyu/socket.io/',
  // 对齐 yxx-server-clean：WebSocket 压缩，大帧(房间状态)实测可压 ~70%
  perMessageDeflate: { threshold: 512 },
});
// shanbox 反代按子域名整站转发，页面挂在 /musaiyu/ 子路径下；剥掉前缀让静态和 API 复用同一套路由
// CORS 头由 nginx 统一加，这里不能重复加(双 ACAO 浏览器判 CORS 失败)
app.use((req, res, next) => {
  if (req.url === '/musaiyu') req.url = '/';
  else if (req.url.startsWith('/musaiyu/')) req.url = req.url.slice('/musaiyu'.length);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

/* ==================== 监控 API ==================== */
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
app.get('/api/stats', (req, res) => {
  const roomList = [];
  let totalOnline = 0, totalBots = 0, totalRounds = 0, totalTurnover = 0, totalPaid = 0, totalNet = 0, totalChips = 0;
  for (const room of rooms.values()) {
    const realPlayers = room.players.filter(p => !p.isBot).length;
    totalOnline += room.players.length;
    totalBots += room.players.filter(p => p.isBot).length;
    totalRounds += room.round;
    totalTurnover += room.stats.turnover;
    totalPaid += room.stats.paid || 0;
    totalNet += room.stats.net || 0;
    room.players.forEach(p => { totalChips += p.chips; });
    roomList.push({
      roomId: room.id, phase: room.phase, round: room.round,
      online: room.players.length, real: realPlayers, bots: room.players.filter(p=>p.isBot).length,
      pot: room.pot, ante: room.ante, turnover: room.stats.turnover,
      paid: room.stats.paid || 0,
      betCount: room.stats.betCount,
    });
  }
  res.json({ rooms: roomList, totalRooms: rooms.size, totalOnline, totalBots, totalRounds, totalTurnover, totalPaid, totalNet, totalChips, totalRecycled: recycled });
});
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'not found' });
  res.json({ roomId: room.id, phase: room.phase, round: room.round, pot: room.pot,
    players: room.players.map(p => ({ pid: p.pid, name: p.name, chips: p.chips, cards: p.cards, banker: p.banker, isBot: p.isBot })) });
});

/* 对账端点：全场筹码恒等式 —— 结算净转移和恒为 0；任何偏差即资金 bug（须在 rooms 声明之后注册） */
app.get('/api/audit', (req, res) => {
  const list = [...rooms.values()].map(r => {
    const sum = r.players.reduce((s, p) => s + p.chips, 0);
    return { roomId: r.id, phase: r.phase, round: r.round, ante: r.ante,
      players: r.players.length, chips: sum, turnover: r.stats.turnover, paid: r.stats.paid, net: r.stats.net };
  });
  res.json({
    rooms: list,
    totalChips: list.reduce((s, r) => s + r.chips, 0),
    totalNet: list.reduce((s, r) => s + r.net, 0),           // 结算净转移和，恒等式要求 = 0
    totalTurnover: list.reduce((s, r) => s + r.turnover, 0),
    totalPaid: list.reduce((s, r) => s + r.paid, 0),
    mem: process.memoryUsage(), roomsCapacity: list.length,
    uptime: Math.round(process.uptime()),
  });
});

/* ==================== 常量 ==================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BOT_NAMES = ["阿强","阿龙","丽姐","小敏","阿凯","老王","阿芳","阿杰","阿宝","阿海","阿坤",
  "大白","铁柱","小翠","阿福","春花","狗剩","铁蛋"];
const BOT_FACES = ["assets/avatars/avatar-m1.png","assets/avatars/avatar-f1.png","assets/avatars/avatar-m2.png",
  "assets/avatars/avatar-f2.png","assets/avatars/avatar-m3.png","assets/avatars/avatar-f3.png",
  "assets/avatars/avatar-m1.png","assets/avatars/avatar-f1.png","assets/avatars/avatar-m2.png",
  "assets/avatars/avatar-f3.png","assets/avatars/avatar-f2.png","assets/avatars/avatar-m3.png",
  "assets/avatars/avatar-m1.png","assets/avatars/avatar-f1.png","assets/avatars/avatar-m2.png",
  "assets/avatars/avatar-f3.png","assets/avatars/avatar-f2.png","assets/avatars/avatar-m3.png"];
const BOT_PREFIX = "bot_";
const PERSONALITIES = {
  aggressive:   { drawBias: 0.85, speed: 0.6, leaveChance: 0.15, raiseChance: 0.3 },
  conservative: { drawBias: 0.15, speed: 1.4, leaveChance: 0.05, raiseChance: 0.1 },
  normal:       { drawBias: 0.5, speed: 1.0, leaveChance: 0.08, raiseChance: 0.2 },
  chaotic:      { drawBias: 0.6, speed: 0.5, leaveChance: 0.35, raiseChance: 0.5 },
};
const PERSONALITY_KEYS = Object.keys(PERSONALITIES);

/* ==================== 房间 ==================== */
const rooms = new Map();

class Room {
  constructor(id, cfg = {}) {
    this.id = id;
    this.ante = cfg.ante || 200;
    this.maxPlayers = cfg.maxPlayers || 9;
    this.phase = 'waiting';
    this.round = 0; this.pot = 0; this.bankerSeq = 0;
    this.players = []; this.deck = []; this.decided = new Set(); this.raised = new Set();
    this.timers = {}; this.spectators = new Set();
    this.stats = { turnover: 0, paid: 0, net: 0, betCount: 0, lastActivity: Date.now() };
  }
  get seated() { return this.players.length; }
  isFull() { return this.seated >= this.maxPlayers; }
  findPlayer(pid) { return this.players.find(p => p.pid === pid); }
  get realPlayers() { return this.players.filter(p => !p.isBot); }
  get botPlayers() { return this.players.filter(p => p.isBot); }
  addPlayer(sid, pid, name, face, isBot = false) {
    const p = { pid, id: pid, sid: sid || null, name, face: face || '', isBot,
      chips: isBot ? 3000 + Math.floor(Math.random() * 8000) : 12400,
      cards: [], stake: this.ante, banker: false, inTurn: false, folded: false };
    this.players.push(p); return p;
  }
  removePlayer(pid) { const i = this.players.findIndex(p => p.pid === pid); if (i >= 0) this.players.splice(i, 1); }
  canStart() { return this.seated >= 2; }
  addBot(name, face) {
    return this.addPlayer(null, BOT_PREFIX + (this._botSeq = (this._botSeq || 0) + 1), name, face, true);
  }
  fillBots(target) {
    while (this.players.length < target) {
      const i = this.players.length;
      const personality = PERSONALITY_KEYS[Math.floor(Math.random() * PERSONALITY_KEYS.length)];
      this.addBot(BOT_NAMES[i % BOT_NAMES.length], BOT_FACES[i % BOT_FACES.length]);
      this.players[this.players.length - 1].personality = personality;
    }
  }
  actionOrder() {
    const seq = this.players.slice();
    const bi = seq.findIndex(p => p.banker);
    if (bi < 0) return seq;
    return seq.slice(bi + 1).concat(seq.slice(0, bi + 1));
  }
}

/* ==================== 房间生命周期：上限 + 空房回收 ==================== */
function humanRoomCount() {
  return [...rooms.values()].filter(r => !r.id.startsWith('bot_') && r.id !== 'lobby').length;
}
function liveHumans(room) {
  return room.players.filter(p => !p.isBot && p.sid).length;
}
let recycled = 0;
function destroyRoom(room) {
  for (const t of Object.values(room.timers)) clearTimeout(t.timeout);
  if (room._startTimer) { clearTimeout(room._startTimer); delete room._startTimer; }
  rooms.delete(room.id);
  recycled++;
  console.log(`[room] 空房回收: ${room.id}`);
}
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (room.id === 'lobby') continue;   // 大厅永久保留
    const liveSockets = io.sockets.adapter.rooms.get(room.id)?.size || 0;
    const empty = liveHumans(room) === 0 && liveSockets === 0;
    if (!empty) { room.emptySince = 0; continue; }
    // bot_ 房给 30 分钟宽限（舰队重启重连期间不该被误杀），其余真人房按标准窗口
    const grace = room.id.startsWith('bot_') ? 30 * 60 * 1000 : ROOM_EMPTY_MS;
    if (!room.emptySince) room.emptySince = now;
    else if (now - room.emptySince >= grace) destroyRoom(room);
  }
}, SWEEP_MS).unref();

/* ==================== 广播 ==================== */
function broadcast(room, event, data) { io.to(room.id).emit(event, data); }
function publicState(room) {
  return {
    roomId: room.id, phase: room.phase, round: room.round, pot: room.pot,
    ante: room.ante, maxPlayers: room.maxPlayers,
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, face: p.face, chips: p.chips,
      cardCount: p.cards.length, banker: p.banker, inTurn: p.inTurn,
      folded: p.folded, isBot: p.isBot, raised: room.raised.has(p.pid),
      cards: (room.phase === 'reveal' || room.phase === 'settle') ? p.cards : p.cards.map(() => ({ hidden: true })),
    })),
    raised: [...room.raised],
  };
}

/* ==================== 游戏状态机 ==================== */
function startRound(room) {
  room.round++; room.phase = 'betting_confirm'; room.pot = 0;
  room.decided = new Set(); room.raised = new Set(); room.stats.lastActivity = Date.now();
  room.deck = E.shuffle(E.buildDeck());   // 每局重建 55 张牌堆
  if (room.round > 1) {
    room.players.forEach(p => { p.banker = false; p.cards = []; p.folded = false; p.inTurn = false; });
    room.bankerSeq++;
    room.players[room.bankerSeq % room.players.length].banker = true;
  }
  room.players.forEach(p => { p.cards = []; p.stake = Math.min(room.ante, Math.max(1, p.chips)); p.folded = false; });
  room.pot = room.players.reduce((s, p) => s + p.stake, 0);
  room.stats.turnover += room.pot;
  broadcast(room, 'round_start', { round: room.round, ante: room.ante, pot: room.pot });
  broadcast(room, 'room_state', publicState(room));
  setTimeout(() => dealCards(room), 600);
}

async function dealCards(room) {
  room.phase = 'dealing';
  broadcast(room, 'phase', { phase: 'dealing' });
  if (!room.deck || room.deck.length < room.players.length * E.PRESET.maxCards) room.deck = E.shuffle(E.buildDeck());
  const order = room.actionOrder();
  for (let r = 0; r < E.PRESET.startCards; r++) {
    for (const p of order) {
      if (p.isBot && !p.sid) continue;   // 空椅 bot 不发牌
      if (p.cards.length >= E.PRESET.startCards) continue;
      p.cards.push(room.deck.pop());
      broadcast(room, 'card_dealt', { pid: p.pid, count: p.cards.length });
      await sleep(300);
    }
  }
  for (const p of order) {
    if (p.cards.filter(c => c.joker).length === 1 && p.cards.length < E.PRESET.maxCards) {
      p.cards.push(room.deck.pop());
      broadcast(room, 'forced_draw', { pid: p.pid, name: p.name });
      broadcast(room, 'card_dealt', { pid: p.pid, count: p.cards.length });
      await sleep(300);
    }
  }
  startDecision(room);
}

async function startDecision(room) {
  room.phase = 'decision';
  broadcast(room, 'phase', { phase: 'decision' });
  const order = room.actionOrder();
  for (const p of order) {
    if (p.folded || p.cards.length >= E.PRESET.maxCards) continue;
    p.inTurn = true;
    broadcast(room, 'decision_turn', { pid: p.pid, name: p.name, timeout: MY_TURN_SEC });
    broadcast(room, 'room_state', publicState(room));
    if (p.isBot && !p.sid) {
      // 仅限真人房里代填的内置 bot（无 socket）；外部 ws bot 走 waitPlayerAction 自己出牌
      await sleep(AI_TURN_SEC * 1000 * 0.72);
      const r = E.classifyHand(p.cards);
      const good = ["tianGong9","tianGong8","shuangGui","sanGui","zhenBaoZi","tongHuaShun","hunShun"].includes(r.type) || r.pts >= 7;
      if (!good && p.cards.length < E.PRESET.maxCards && Math.random() < 0.8) {
        p.cards.push(room.deck.pop());
        broadcast(room, 'player_action', { pid: p.pid, name: p.name, action: 'draw' });
      } else {
        broadcast(room, 'player_action', { pid: p.pid, name: p.name, action: 'pass' });
      }
      p.inTurn = false;
      broadcast(room, 'room_state', publicState(room));
    } else {
      await waitPlayerAction(room, p);
    }
  }
  reveal(room);
}
async function waitPlayerAction(room, p) {
  return new Promise(res => {
    const timeout = setTimeout(() => { playerAction(room, p.pid, 'pass', true); res(); }, MY_TURN_SEC * 1000);
    room.timers[p.pid] = { timeout, resolve: res };
  });
}
function playerAction(room, pid, action, isTimeout = false) {
  const p = room.findPlayer(pid);
  if (!p || room.phase !== 'decision') return;
  const timer = room.timers[pid];
  if (timer) { clearTimeout(timer.timeout); timer.resolve(); delete room.timers[pid]; }
  room.decided.add(pid); p.inTurn = false;
  if (action === 'draw' && p.cards.length < E.PRESET.maxCards) p.cards.push(room.deck.pop());
  broadcast(room, 'player_action', { pid, name: p.name, action });
  broadcast(room, 'room_state', publicState(room));
}

function reveal(room) {
  room.phase = 'reveal';
  broadcast(room, 'phase', { phase: 'reveal' });
  broadcast(room, 'reveal_all', { hands: room.players.map(p => ({ pid: p.pid, name: p.name, cards: p.cards })) });
  const active = room.players.filter(p => p.cards.length > 0);   // 中途入座坐出者不参与结算
  const { ledger, pairs } = E.settleRound(active);
  for (const p of room.players) p.chips += ledger[p.id] || 0;
  const vals = Object.values(ledger);
  room.stats.paid += vals.reduce((s, v) => s + Math.max(0, v), 0);   // 出: 派彩
  room.stats.net  += vals.reduce((s, v) => s + v, 0);                // 零和校验
  scheduleSave();
  broadcast(room, 'settle_result', {
    ledger, pairs: pairs.map(pr => ({
      w: pr.w, mult: pr.mult, paid: pr.paid || 0, winType: pr.winType,
      p1: { id: pr.p1.id, name: pr.p1.name, cards: pr.p1.cards },
      p2: { id: pr.p2.id, name: pr.p2.name, cards: pr.p2.cards },
    })), net: ledger,
  });
  setTimeout(() => nextRound(room), 6000);
}

function nextRound(room) {
  // 局间清扫：离场 bot 的死座（isBot 且无连接）直接摘除，防幽灵座位累积
  room.players = room.players.filter(p => !p.isBot || p.sid);
  // 活座 = 真人（含暂断线）+ 在线 bot；全走光就回等人态等舰队回填
  const live = room.players.filter(p => !p.isBot || p.sid).length;
  if (live >= 2) startRound(room);
  else { room.phase = 'waiting'; broadcast(room, 'phase', { phase: 'waiting' }); }
}

/* ==================== Socket 事件 ==================== */
io.on('connection', (sock) => {
  sock.on('join_room', ({ roomId, name, face, botCount, bot, ante }) => {
    // 单连接单座：已在别的房坐着，先按离场处理（换桌语义）
    for (const r of rooms.values()) {
      const prev = r.players.find(x => x.sid === sock.id);
      if (prev) {
        if (r.phase === 'waiting') r.removePlayer(prev.pid);
        else { prev.folded = true; prev.stake = 0; prev.sid = null; }
        broadcast(r, 'room_state', publicState(r));
      }
    }
    sock.join(roomId);
    let room = rooms.get(roomId);
    if (!room) {
      if (roomId !== 'lobby' && humanRoomCount() >= ROOM_CAP) {
        sock.emit('room_rejected', { reason: `房间数已达上限（${ROOM_CAP} 间），请稍后再试` });
        return;
      }
      room = new Room(roomId, { ante: ante || 200, maxPlayers: 9 }); rooms.set(roomId, room);
    }
    if (room.phase === 'waiting' && !room.isFull()) {
      // 同名续档：同名字真人复用旧座位（页面刷新/服务重启后筹码不重开）
      let p = room.players.find(x => x.name === (name || '玩家') && x.isBot === !!bot);
      if (p) { p.sid = sock.id; if (face) p.face = face; }
      else { p = room.addPlayer(sock.id, 'p' + (room._pSeq = (room._pSeq || 0) + 1), name || '玩家', face, !!bot); scheduleSave(); }
      const target = Math.min(botCount || 0, room.maxPlayers - 1);
      if (target > 0) room.fillBots(room.players.length + target);
      sock.emit('joined', { pid: p.pid, roomId, state: publicState(room) });
      broadcast(room, 'room_state', publicState(room));
      if (room.canStart() && !room._startTimer) {
        room._startTimer = setTimeout(() => {
          const r = rooms.get(roomId);
          if (r && r.phase === 'waiting' && r.canStart()) { delete r._startTimer; startRound(r); }
        }, 2000);
      }
    } else if (bot && !room.isFull()) {
      // bot 中途入座：本轮坐出（folded、不出注），下一局自动参战
      let p = room.players.find(x => x.isBot && x.name === (name || ''));
      if (p) { p.sid = sock.id; }
      else {
        p = room.addPlayer(sock.id, 'p' + (room._pSeq = (room._pSeq || 0) + 1), name || '玩家', face, true);
        p.folded = true; p.stake = 0;
        scheduleSave();
      }
      sock.emit('joined', { pid: p.pid, roomId, state: publicState(room) });
      broadcast(room, 'room_state', publicState(room));
    } else { room.spectators.add(sock.id); sock.emit('spectator', { roomId, state: publicState(room) }); }
  });
  sock.on('create_room', ({ name, face, botCount, ante, maxPlayers }) => {
    if (humanRoomCount() >= ROOM_CAP) {
      sock.emit('room_rejected', { reason: `房间数已达上限（${ROOM_CAP} 间），请稍后再试` });
      return;
    }
    const roomId = 'R' + Date.now().toString(36);
    sock.join(roomId);
    const room = new Room(roomId, { ante, maxPlayers: maxPlayers || 9 });
    rooms.set(roomId, room);
    const p = room.addPlayer(sock.id, 'p' + (room._pSeq = (room._pSeq || 0) + 1), name || '房主', face);
    room.fillBots(botCount || 3);
    scheduleSave();
    sock.emit('room_created', { roomId, pid: p.pid, state: publicState(room) });
    broadcast(room, 'room_state', publicState(room));
    room._startTimer = setTimeout(() => {
      const r = rooms.get(roomId);
      if (r && r.phase === 'waiting' && r.canStart()) { delete r._startTimer; startRound(r); }
    }, 3000);
  });
  sock.on('toggle_raise', ({ roomId, pid }) => {
    const room = rooms.get(roomId); if (!room) return;
    const p = room.findPlayer(pid);
    if (!p || p.sid !== sock.id) return;   // 举手也只限本人
    if (room.raised.has(pid)) room.raised.delete(pid); else room.raised.add(pid);
    broadcast(room, 'raise_update', { pid, raised: room.raised.has(pid) });
    broadcast(room, 'room_state', publicState(room));
  });
  sock.on('player_action', ({ roomId, pid, action }) => {
    const room = rooms.get(roomId); if (!room) return;
    const p = room.findPlayer(pid);
    if (!p || p.sid !== sock.id) return;   // 只能动自己的牌（防替他人出牌）
    playerAction(room, pid, action, false);
  });
  sock.on('leave_room', ({ roomId, pid }) => {
    // 优雅离场：等待中直接摘座；局中标记坐出（不参决策/不结算），座位释放
    const room = rooms.get(roomId); if (!room) return;
    const p = room.findPlayer(pid);
    if (!p || p.sid !== sock.id) return;
    if (room.phase === 'waiting') room.removePlayer(pid);
    else { p.folded = true; p.stake = 0; p.sid = null; }
    broadcast(room, 'room_state', publicState(room));
  });
  sock.on('disconnect', () => {
    for (const room of rooms.values()) {
      const p = room.players.find(x => x.sid === sock.id);
      if (p) { p.sid = null; break; }
    }
  });
  sock.on('reconnect_player', ({ roomId, pid }) => {
    const room = rooms.get(roomId);
    const p = room && room.findPlayer(pid);
    if (!p) return;
    // 防劫持：座位已被其他活跃连接占着（pid 是别人的），拒绝认领
    if (p.sid && p.sid !== sock.id) return;
    // 单连接单座：该连接已坐在同房别的座位上，不能重复认领
    if (room.players.find(x => x !== p && x.sid === sock.id)) return;
    p.sid = sock.id; sock.join(roomId);
    // 完整恢复：座位上下文 + 私牌 + 阶段，客户端拿到即可无缝续玩
    sock.emit('rejoined', { state: publicState(room), pid, myCards: p.cards, phase: room.phase });
  });
});

/* ==================== 简单持久化（yxx store 模式：内存 + 防抖落盘 + 启动恢复） ==================== */
const fs = require('fs');
const DATA_DIR = path.join(__dirname, 'data');
const SNAP_FILE = path.join(DATA_DIR, 'state.json');

function serializeRooms() {
  return [...rooms.values()].map(r => ({
    id: r.id, ante: r.ante, maxPlayers: r.maxPlayers, round: r.round,
    bankerSeq: r.bankerSeq, _pSeq: r._pSeq || 0, _botSeq: r._botSeq || 0,
    stats: r.stats,
    players: r.players.map(p => ({
      pid: p.pid, name: p.name, face: p.face, isBot: p.isBot,
      chips: p.chips, personality: p.personality || null,
    })),
  }));
}

let snapTimer = null;
function scheduleSave() {
  if (snapTimer) return;
  snapTimer = setTimeout(() => {
    snapTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = SNAP_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(serializeRooms()));
      fs.renameSync(tmp, SNAP_FILE);
    } catch (e) { console.error('[store] 快照写入失败:', e.message); }
  }, 3000);
}

function flushSave() {
  if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAP_FILE, JSON.stringify(serializeRooms()));
  } catch (e) { console.error('[store] 退出落盘失败:', e.message); }
}

function restoreRooms() {
  try {
    if (!fs.existsSync(SNAP_FILE)) return 0;
    const saved = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'));
    let skippedBots = 0;
    for (const s of saved) {
      if (s.id.startsWith('bot_')) { skippedBots++; continue; }   // bot 房交给外部舰队重建
      const room = new Room(s.id, { ante: s.ante, maxPlayers: s.maxPlayers });
      room.round = s.round || 0; room.bankerSeq = s.bankerSeq || 0;
      room._pSeq = s._pSeq || 0; room._botSeq = s._botSeq || 0;
      if (s.stats) room.stats = { paid: 0, net: 0, betCount: 0, turnover: 0, lastActivity: 0, ...s.stats };
      for (const sp of (s.players || [])) {
        const p = room.addPlayer(null, sp.pid, sp.name, sp.face, !!sp.isBot);
        p.chips = sp.chips;
        if (sp.personality) p.personality = sp.personality;
      }
      room.phase = 'waiting';
      rooms.set(room.id, room);
      // 外部 bot 舰队重连后会自己 join_room 回房继续，服务端不再代跑
    }
    console.log(`[store] 已恢复 ${saved.length - skippedBots} 个真人房（bot 房 ${skippedBots} 间由舰队重建）`);
    return saved.length;
  } catch (e) { console.error('[store] 快照恢复失败:', e.message); return 0; }
}

/* ==================== 启动 ==================== */
restoreRooms();
setInterval(scheduleSave, 30000);
process.on('SIGTERM', () => { flushSave(); process.exit(0); });
process.on('SIGINT', () => { flushSave(); process.exit(0); });
// bot_ 房由外部舰队(bot/soak.js)负责建与填，服务端不再自建


httpServer.listen(PORT, () => { console.log(`木虱鱼服务端已启动: http://0.0.0.0:${PORT}/  (socket.io 就绪)`); });
