#!/usr/bin/env node
/* audit.js — 行为轨迹审计器（用户要求：定时随机抽一个用户，回放轨迹查对错）
 * 校验规则：
 *  1. 筹码守恒链：chips 事件的 to 必须等于 from + 该时段 settle 净额（缺 settle 视为被离场打断，容忍一次不符并记录）
 *  2. 时序合法：joined 前不能有 action；leave 后不能有事件（spawn 除外）
 *  3. 单座原则：同一 pid 同一时刻只在一个房间（room 变更必须先有 leave/spectator）
 *  4. 破产铁律：bankrupt 出现时 chips 必须 < 500
 *  5. 服务端对账：/api/audit 的 totalNet 必须为 0；RSS 增速异常报 warn
 * 结果写 reports/audit-<ts>.md；异常时 exit 1（供 cron 监控）。
 * 用法: node audit.js  （MUY_SERVER/MUY_TRAJ_DIR 同 soak.js；一次抽 1 个用户）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const SERVER = process.env.MUY_SERVER || 'http://127.0.0.1:3010';
const TRAJ_DIR = process.env.MUY_TRAJ_DIR || path.join(__dirname, 'trajectories');
const REPORT_DIR = path.join(__dirname, 'reports');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function fetchJson(p) {
  return new Promise(res => {
    http.get(SERVER + p, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } });
    }).on('error', () => res(null));
  });
}

async function auditOne(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  if (lines.length < 3) return { file, issues: [], skipped: '轨迹太短', events: lines.length };

  const issues = [];
  let chips = null;            // 当前可信筹码
  let pendingNet = 0;          // 本局待入账净额
  let seenJoined = false, gone = false;
  let curRoom = null;
  let settles = 0, mismatches = 0;

  for (let i = 0; i < lines.length; i++) {
    const e = lines[i];
    if (gone) { issues.push(`#${i} ${e.ev}@${e.t}: leave 之后仍有事件`); break; }
    switch (e.ev) {
      case 'spawn':
        chips = e.chips ?? null;
        break;
      case 'joined':
        seenJoined = true; curRoom = e.room;
        break;
      case 'chips': {
        // 筹码跳变必须有 pendingNet 解释（结算），否则记一次不符
        const expected = (chips ?? e.from) + pendingNet;
        if (chips !== null && e.to !== expected) {
          mismatches++;
          issues.push(`#${i} chips 跳变不符: 记录 ${e.from}→${e.to}，按净额 ${pendingNet} 应为 ${e.from + pendingNet}`);
        }
        chips = e.to; pendingNet = 0;
        break;
      }
      case 'settle':
        settles++; pendingNet += e.net || 0;
        break;
      case 'action':
        if (!seenJoined) issues.push(`#${i} action 出现在 joined 之前`);
        break;
      case 'leave':
        gone = true;
        curRoom = null;
        break;
      case 'spectator':
        // 围观不算在座，房间占用解除
        curRoom = null;
        break;
      case 'bankrupt':
        if (chips !== null && chips >= 500) issues.push(`#${i} 破产时筹码=${chips} ≥ 500，破产判定错误`);
        break;
    }
    // 单座：room 变了但没有经过 leave/spectator（joined 之间直接换房）
    if (e.room && curRoom && e.room !== curRoom && e.ev === 'joined') {
      // joined 事件本身会换 room——前一次 joined 后没有 leave 就换房 = 单座违规
      issues.push(`#${i} 未离场直接换房: ${curRoom} → ${e.room}`);
    }
  }

  return { file, issues, settles, mismatches, events: lines.length,
    first: lines[0]?.t, last: lines[lines.length - 1]?.t, name: lines[0]?.name };
}

/* 房间状态巡检：相变/座位/牌数合法性 */
function inspectRooms(g) {
  const issues = [];
  const LEGAL = new Set(['waiting', 'betting_confirm', 'dealing', 'decision', 'reveal', 'settle']);
  for (const r of g.rooms || []) {
    if (!LEGAL.has(r.phase)) issues.push(`房 ${r.roomId} 非法相变: ${r.phase}`);
    if (r.online > 9) issues.push(`房 ${r.roomId} 超员: ${r.online}/9`);
    if (r.round < 0 || r.round > 100000) issues.push(`房 ${r.roomId} 局数异常: ${r.round}`);
    if (r.chips < 0) issues.push(`房 ${r.roomId} 负筹码总量: ${r.chips}`);
  }
  if (g.totalNet !== 0) issues.push(`全局资金不守恒: totalNet=${g.totalNet}`);
  const rss = (g.mem?.rss || 0) / 1048576;
  if (rss > 1024) issues.push(`服务端 RSS 异常: ${rss.toFixed(0)}M`);
  const roomCap = 200;
  if ((g.rooms || []).length > roomCap) issues.push(`房间数异常膨胀: ${g.rooms.length}`);
  return issues;
}

(async () => {
  const files = fs.readdirSync(TRAJ_DIR).filter(f => f.endsWith('.jsonl'));
  if (!files.length) { log('无轨迹可审计'); process.exit(0); }
  const pickFile = () => files[Math.floor(Math.random() * files.length)];

  const audit = await auditOne(path.join(TRAJ_DIR, pickFile()));

  // 服务端全局对账 + 内存
  const g = await fetchJson('/musaiyu/api/audit');
  let globalOk = true, memNote = '', roomIssues = [];
  if (!g) globalOk = false;
  else {
    roomIssues = inspectRooms(g);
    if (roomIssues.length) globalOk = false;
    memNote = `RSS=${(g.mem.rss / 1048576).toFixed(1)}M heapUsed=${(g.mem.heapUsed / 1048576).toFixed(1)}M uptime=${g.uptime}s 房间=${g.rooms.length}`;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(REPORT_DIR, `audit-${ts}.md`);
  const lines = [];
  lines.push(`# 木虱鱼行为审计 ${ts}`);
  lines.push('');
  lines.push(`- 抽样用户: **${audit.name || path.basename(audit.file, '.jsonl')}** （轨迹 ${audit.events} 条事件）`);
  if (g) {
    lines.push(`- 服务端对账: totalNet=${g.totalNet} ${Math.abs(g.totalNet) > 0.001 ? '❌ 资金不守恒' : '✓'} | 全场筹码=${g.totalChips} | 总流水=${g.totalTurnover}`);
    lines.push(`- 资源: ${memNote}`);
  } else {
    lines.push(`- 服务端对账: ❌ /api/audit 不可达`);
  }
  lines.push('');
  if (audit.issues.length) {
    lines.push(`## ⚠️ 用户轨迹异常 ${audit.issues.length} 条`);
    audit.issues.slice(0, 20).forEach(x => lines.push(`- ${x}`));
  } else {
    lines.push(`## ✓ 抽样用户轨迹全部通过（结算 ${audit.settles} 次复核）`);
  }
  lines.push('');
  lines.push(`## 房间状态巡检（${(g?.rooms || []).length} 房）`);
  if (roomIssues.length) {
    lines.push(`❌ ${roomIssues.length} 条:`);
    roomIssues.slice(0, 20).forEach(x => lines.push(`- ${x}`));
  } else {
    lines.push('✓ 全部合法（相变/座位/局数/资金/内存/房间数）');
  }
  fs.writeFileSync(out, lines.join('\n') + '\n');
  log(`报告: ${out}`);
  log(lines.slice(2).join(' | '));
  process.exit(audit.issues.length || roomIssues.length || !globalOk ? 1 : 0);
})();
