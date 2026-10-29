// 木虱鱼 · 服务端权威 v4 (duobi-v1)
// Bot 生态系统：多种性格/自动进房/跑路/换桌/举手/快速匹配/监控大盘
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const E = require('./engine.js');

const PORT = process.env.PORT || 3010;
const MY_TURN_SEC = 15, AI_TURN_SEC = 5;
const BOT_ROOM_COUNT = 3;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
// shanbox 反代按子域名整站转发，页面挂在 /musaiyu/ 子路径下；剥掉前缀让静态和 API 复用同一套路由
app.use((req, res, next) => {
  if (req.url === '/musaiyu') req.url = '/';
  else if (req.url.startsWith('/musaiyu/')) req.url = req.url.slice('/musaiyu'.length);
  res.set('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

/* ==================== 监控 API ==================== */
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
app.get('/api/stats', (req, res) => {
  const roomList = [];
  let totalOnline = 0, totalBots = 0, totalRounds = 0, totalTurnover = 0;
  for (const room of rooms.values()) {
    const realPlayers = room.players.filter(p => !p.isBot).length;
    totalOnline += room.players.length;
    totalBots += room.players.filter(p => p.isBot).length;
    totalRounds += room.round;
    totalTurnover += room.stats.turnover;
    roomList.push({
      roomId: room.id, phase: room.phase, round: room.round,
      online: room.players.length, real: realPlayers, bots: room.players.filter(p=>p.isBot).length,
      pot: room.pot, ante: room.ante, turnover: room.stats.turnover,
      betCount: room.stats.betCount,
    });
  }
  res.json({ rooms: roomList, totalRooms: rooms.size, totalOnline, totalBots, totalRounds, totalTurnover });
});
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'not found' });
  res.json({ roomId: room.id, phase: room.phase, round: room.round, pot: room.pot,
    players: room.players.map(p => ({ pid: p.pid, name: p.name, chips: p.chips, cards: p.cards, banker: p.banker, isBot: p.isBot })) });
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
    this.stats = { turnover: 0, betCount: 0, lastActivity: Date.now() };
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
  const order = room.actionOrder();
  for (let r = 0; r < E.PRESET.startCards; r++) {
    for (const p of order) {
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
    if (p.cards.length >= E.PRESET.maxCards) continue;
    p.inTurn = true;
    broadcast(room, 'decision_turn', { pid: p.pid, name: p.name, timeout: p.isBot ? AI_TURN_SEC : MY_TURN_SEC });
    broadcast(room, 'room_state', publicState(room));
    if (p.isBot) {
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
  const { ledger, pairs } = E.settleRound(room.players);
  for (const p of room.players) p.chips += ledger[p.id] || 0;
  room.lastSettle = { ledger, pairs };
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
  if (room.realPlayers.length >= 2) startRound(room);
  else { room.phase = 'waiting'; broadcast(room, 'phase', { phase: 'waiting' }); }
}

/* ==================== Bot 自嗨房间 ==================== */
function createBotRoom(ante) {
  const roomId = 'bot_' + Date.now().toString(36);
  const room = new Room(roomId, { ante, maxPlayers: 9 });
  room.phase = 'playing'; rooms.set(roomId, room);
  room.fillBots(5);
  runBotRound(room);
  return room;
}
async function runBotRound(room) {
  room.round++;
  room.deck = E.shuffle(E.buildDeck());
  room.decided = new Set(); room.raised = new Set();
  room.players.forEach(p => { p.banker = false; p.cards = []; p.inTurn = false; });
  room.bankerSeq++;
  room.players[room.bankerSeq % room.players.length].banker = true;
  broadcast(room, 'room_state', publicState(room));
  await sleep(2000);
  const order = room.actionOrder();
  for (const p of order) {
    if (p.cards.length >= E.PRESET.maxCards) continue;
    p.inTurn = true; broadcast(room, 'room_state', publicState(room));
    await sleep(800);
    const r = E.classifyHand(p.cards);
    const good = ["tianGong9","tianGong8","shuangGui","sanGui","zhenBaoZi","tongHuaShun","hunShun"].includes(r.type) || r.pts >= 7;
    if (!good && p.cards.length < E.PRESET.maxCards && Math.random() < 0.7) p.cards.push(room.deck.pop());
    p.inTurn = false;
    broadcast(room, 'room_state', publicState(room));
    await sleep(400);
  }
  broadcast(room, 'room_state', publicState(room));
  await sleep(1000);
  const { ledger } = E.settleRound(room.players);
  for (const p of room.players) p.chips += ledger[p.id] || 0;
  broadcast(room, 'room_state', publicState(room));
  await sleep(3000);
  if (rooms.has(room.id)) runBotRound(room);
}

/* ==================== Socket 事件 ==================== */
io.on('connection', (sock) => {
  sock.on('join_room', ({ roomId, name, face, botCount }) => {
    sock.join(roomId);
    let room = rooms.get(roomId);
    if (!room) { room = new Room(roomId, { ante: 200, maxPlayers: 9 }); rooms.set(roomId, room); }
    if (room.phase === 'waiting' && !room.isFull()) {
      const p = room.addPlayer(sock.id, name || '玩家', face);
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
    } else { room.spectators.add(sock.id); sock.emit('spectator', { roomId, state: publicState(room) }); }
  });
  sock.on('create_room', ({ name, face, botCount, ante, maxPlayers }) => {
    const roomId = 'R' + Date.now().toString(36);
    sock.join(roomId);
    const room = new Room(roomId, { ante, maxPlayers: maxPlayers || 9 });
    rooms.set(roomId, room);
    const p = room.addPlayer(sock.id, name || '房主', face);
    room.fillBots(botCount || 3);
    sock.emit('room_created', { roomId, pid: p.pid, state: publicState(room) });
    broadcast(room, 'room_state', publicState(room));
    room._startTimer = setTimeout(() => {
      const r = rooms.get(roomId);
      if (r && r.phase === 'waiting' && r.canStart()) { delete r._startTimer; startRound(r); }
    }, 3000);
  });
  sock.on('toggle_raise', ({ roomId, pid }) => {
    const room = rooms.get(roomId); if (!room) return;
    if (room.raised.has(pid)) room.raised.delete(pid); else room.raised.add(pid);
    broadcast(room, 'raise_update', { pid, raised: room.raised.has(pid) });
    broadcast(room, 'room_state', publicState(room));
  });
  sock.on('player_action', ({ roomId, pid, action }) => {
    const room = rooms.get(roomId); if (room) playerAction(room, pid, action, false);
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
    if (p) { p.sid = sock.id; sock.join(roomId); sock.emit('rejoined', { state: publicState(room) }); }
  });
});

/* ==================== Bot 自嗨启动 ==================== */
setTimeout(() => { for (let i = 0; i < BOT_ROOM_COUNT; i++) setTimeout(() => createBotRoom(200 + i * 100), i * 1500); }, 2000);

/* ==================== 启动 ==================== */
httpServer.listen(PORT, () => { console.log(`木虱鱼服务端已启动: http://0.0.0.0:${PORT}/  (socket.io 就绪)`); });
