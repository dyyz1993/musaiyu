// 木虱鱼 · 服务端权威 (duobi-v1)
// socket.io 房间管理 + 游戏状态机 + 服务端机器人
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const E = require('./engine.js');

const PORT = process.env.PORT || 3010;
const MY_TURN_SEC = 15, AI_TURN_SEC = 5, RAISE_CHECK_SEC = 5, NEXT_ROUND_SEC = 8;
const INTERMISSION_SEC = 8, RECONNECT_SEC = 30;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));

/* ==================== 房间管理 ==================== */
const rooms = new Map();   // roomId -> Room

class Room {
  constructor(id, cfg = {}) {
    this.id = id;
    this.ante = cfg.ante || 200;
    this.maxPlayers = cfg.maxPlayers || 9;
    this.rule = cfg.rule || 'duobi-v1';
    this.phase = 'waiting';         // waiting | dealing | myturn_* | decision | reveal | settle | intermission
    this.round = 0;
    this.pot = 0;
    this.bankerSeq = 0;
    this.players = [];              // {sid, pid, name, face, isBot, chips, cards, stake, banker, inTurn, folded}
    this.deck = [];
    this.decided = new Set();
    this.raised = new Set();
    this.timers = {};
    this.spectators = new Set();
  }
  get seated() { return this.players.length; }
  isFull() { return this.seated >= this.maxPlayers; }
  findPlayer(pid) { return this.players.find(p => p.pid === pid); }
  banker() { return this.players.find(p => p.banker); }

  addPlayer(sid, name, face, isBot = false) {
    const pid = 'p' + (this._pidSeq = (this._pidSeq || 0) + 1);
    const p = { pid, sid, name, face: face || '', isBot, chips: 12400,
      cards: [], stake: this.ante, banker: false, inTurn: false, folded: false };
    this.players.push(p);
    return p;
  }
  removePlayer(pid) {
    const i = this.players.findIndex(p => p.pid === pid);
    if (i >= 0) this.players.splice(i, 1);
  }
  canStart() { return this.seated >= 2; }

  /* ---- 发牌顺序: 庄家下一家先, 庄家最后 ---- */
  actionOrder() {
    const seq = this.players.slice();   // 底部玩家已在末尾(和前端 tableOrder 一致)
    const bi = seq.findIndex(p => p.banker);
    if (bi < 0) return seq;
    return seq.slice(bi + 1).concat(seq.slice(0, bi + 1));
  }
}

/* ==================== 游戏状态机 ==================== */
function broadcast(room, event, data) { io.to(room.id).emit(event, data); }
function toPlayer(room, pid, event, data) {
  const p = room.findPlayer(pid);
  if (p && p.sid) io.to(p.sid).emit(event, data);
}
function publicState(room) {
  return {
    roomId: room.id, phase: room.phase, round: room.round, pot: room.pot,
    ante: room.ante, maxPlayers: room.maxPlayers,
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, face: p.face, chips: p.chips,
      cardCount: p.cards.length, banker: p.banker, inTurn: p.inTurn,
      folded: p.folded, isBot: p.isBot,
      cards: (p.cards && room.phase !== 'decision' && room.phase !== 'dealing') ? p.cards : p.cards.map(() => ({ hidden: true })),
    })),
    raised: [...room.raised],
  };
}

/* ---- 开局 ---- */
function startRound(room) {
  room.round++;
  room.phase = 'betting_confirm';
  room.pot = 0;
  room.deck = E.shuffle(E.buildDeck());
  room.decided = new Set();
  room.raised = new Set();
  // 轮庄
  if (room.round > 1) {
    room.players.forEach(p => { p.banker = false; p.cards = []; p.folded = false; p.inTurn = false; });
    room.bankerSeq++;
    room.players[room.bankerSeq % room.players.length].banker = true;
  }
  room.players.forEach(p => { p.cards = []; p.stake = Math.min(room.ante, Math.max(1, p.chips)); p.folded = false; });
  room.pot = room.players.reduce((s, p) => s + p.stake, 0);
  broadcast(room, 'round_start', { round: room.round, ante: room.ante, pot: room.pot, phase: room.phase });
  broadcast(room, 'room_state', publicState(room));
  setTimeout(() => dealCards(room), 800);
}

/* ---- 发牌(逐张, 顺时针, 庄家最后) ---- */
async function dealCards(room) {
  room.phase = 'dealing';
  broadcast(room, 'phase', { phase: 'dealing' });
  const order = room.actionOrder();
  const PER = E.PRESET.startCards;
  for (let r = 0; r < PER; r++) {
    for (const p of order) {
      p.cards.push(room.deck.pop());
      broadcast(room, 'card_dealt', { pid: p.pid, count: p.cards.length });
      await sleep(300);
    }
  }
  // 单鬼强制补
  for (const p of order) {
    if (p.cards.filter(c => c.joker).length === 1 && p.cards.length < E.PRESET.maxCards) {
      p.cards.push(room.deck.pop());
      broadcast(room, 'forced_draw', { pid: p.pid, name: p.name });
      broadcast(room, 'card_dealt', { pid: p.pid, count: p.cards.length });
      await sleep(300);
    }
  }
  // 私发真实牌面
  for (const p of room.players) {
    toPlayer(room, p.pid, 'your_cards', { cards: p.cards });
  }
  broadcast(room, 'room_state', publicState(room));
  startDecision(room);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---- 决策轮 ---- */
function startDecision(room) {
  room.phase = 'decision';
  broadcast(room, 'phase', { phase: 'decision' });
  askNext(room);
}
function askNext(room) {
  const undecided = room.actionOrder().filter(p =>
    p.cards.length < E.PRESET.maxCards && !room.decided.has(p.pid));
  if (!undecided.length) { reveal(room); return; }
  const p = undecided[0];
  p.inTurn = true;
  broadcast(room, 'decision_turn', { pid: p.pid, name: p.name, timeout: MY_TURN_SEC });
  startPlayerTimer(room, p);
}
function startPlayerTimer(room, p) {
  const isBot = p.isBot;
  const sec = isBot ? 3 : MY_TURN_SEC;
  room.timers[p.pid] = setTimeout(() => {
    // 超时自动过
    playerAction(room, p.pid, 'pass', true);
  }, sec * 1000);
  // 机器人: 延迟后自动决策
  if (isBot) {
    setTimeout(() => {
      if (!room.decided.has(p.pid)) playerAction(room, p.pid, Math.random() < 0.7 ? 'pass' : 'draw', false);
    }, (1 + Math.random() * 2) * 1000);
  }
}
function playerAction(room, pid, action, isTimeout = false) {
  const p = room.findPlayer(pid);
  if (!p || room.decided.has(pid) || room.phase !== 'decision') return;
  clearTimeout(room.timers[pid]);
  room.decided.add(pid);
  p.inTurn = false;
  if (action === 'draw' && p.cards.length < E.PRESET.maxCards) {
    p.cards.push(room.deck.pop());
  }
  broadcast(room, 'player_action', { pid, name: p.name, action, timeout: isTimeout });
  broadcast(room, 'room_state', publicState(room));
  setTimeout(() => askNext(room), 400);
}

/* ---- 摊牌 ---- */
function reveal(room) {
  room.phase = 'reveal';
  broadcast(room, 'phase', { phase: 'reveal' });
  broadcast(room, 'reveal_all', {
    hands: room.players.map(p => ({ pid: p.pid, name: p.name, cards: p.cards })),
  });
  const { ledger, pairs } = E.settleRound(room.players);
  for (const p of room.players) p.chips += ledger[p.id] || 0;
  room.lastSettle = { ledger, pairs };
  broadcast(room, 'settle_result', {
    ledger, pairs: pairs.map(pr => ({
      w: pr.w, mult: pr.mult, paid: pr.paid || 0, winType: pr.winType,
      p1: { id: pr.p1.id, name: pr.p1.name, cards: pr.p1.cards },
      p2: { id: pr.p2.id, name: pr.p2.name, cards: pr.p2.cards },
    })),
    net: ledger,
  });
  setTimeout(() => nextRound(room), 6000);
}

/* ---- 下一局 ---- */
function nextRound(room) {
  if (room.players.filter(p => !p.isBot).length >= 2) {
    startRound(room);
  } else {
    room.phase = 'waiting';
    broadcast(room, 'phase', { phase: 'waiting' });
  }
}

/* ==================== Socket 事件 ==================== */
io.on('connection', (sock) => {
  sock.on('join_room', ({ roomId, name, face }) => {
    sock.join(roomId);
    let room = rooms.get(roomId);
    if (!room) { room = new Room(roomId, { ante: 200, maxPlayers: 9 }); rooms.set(roomId, room); }
    if (room.phase === 'waiting' && !room.isFull()) {
      const p = room.addPlayer(sock.id, name || '玩家', face);
      sock.emit('joined', { pid: p.pid, roomId, state: publicState(room) });
      broadcast(room, 'room_state', publicState(room));
      if (room.canStart() && !room._autoStarted) {
        room._autoStarted = true;
        setTimeout(() => { if (rooms.get(roomId) === room) startRound(room); }, 2000);
      }
    } else {
      // 房满或对局中 → 旁观
      room.spectators.add(sock.id);
      sock.emit('spectator', { roomId, state: publicState(room) });
    }
  });
  sock.on('player_action', ({ roomId, pid, action }) => {
    const room = rooms.get(roomId);
    if (room) playerAction(room, pid, action, false);
  });
  sock.on('disconnect', () => {
    // 断线处理: 标记重连窗口, 超时移除
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

/* ==================== 启动 ==================== */
httpServer.listen(PORT, () => {
  console.log(`木虱鱼服务端已启动: http://0.0.0.0:${PORT}/  (socket.io 就绪)`);
});
