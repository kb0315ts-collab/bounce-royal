'use strict';
/* ============================================================
 * 바운스 로얄 서버
 *
 * - WebSocket 하나로 대기열과 매치 진행을 모두 처리한다.
 * - 정적 파일도 같이 서빙하므로 이 서버만 띄우면 게임이 돈다.
 *   (클라이언트를 GitHub Pages에 두고 이 서버에는 WS만 붙여도 된다)
 *
 * 환경변수
 *   PORT           listen 포트 (기본 8080)
 *   BOT_JOIN_START 이 시간까지 사람이 안 모이면 봇을 붙이기 시작한다 (초, 기본 8)
 *   BOT_JOIN_END   늦어도 이때까지는 자리를 다 채운다 (초, 기본 17)
 *                  두 시각 사이 무작위 시점에 한 명씩 들어온다
 *   FILL_WITH_AI   0이면 사람 4명이 모일 때까지 시작하지 않는다 (기본 1)
 * ============================================================ */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { Room } = require('./room.js');
const core = require('./game-core.js');

const PORT = Number(process.env.PORT || 8080);
// 사람이 안 모이면 봇을 붙인다. 한 번에 자리를 다 채우면 대기가 끝났다는 게
// 티가 나므로, START~END 사이 무작위 시점에 한 명씩 들어오게 한다.
const BOT_JOIN_START = Number(process.env.BOT_JOIN_START || 8);
const BOT_JOIN_END = Number(process.env.BOT_JOIN_END || 17);
const FILL_WITH_AI = process.env.FILL_WITH_AI !== '0';
const ROOM_SIZE = 4;
const ROOT = path.resolve(__dirname, '..');

/* ---------------- 정적 파일 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  // 호스팅 헬스체크
  if ((req.url || "").split("?")[0] === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, queued: queue.length }));
    return;
  }
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || rel.startsWith('server/') || rel.startsWith('node_modules/')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

/* ---------------- 접속 ---------------- */
let connSeq = 0;
const wss = new WebSocketServer({ server });
const queue = [];          // 대기 중인 conn
/* 대기열에 합류한 것처럼 보이는 봇 자리. 사람이 새로 들어오면 그 자리를 내준다.
 * 대기가 시작될 때 봇들이 들어올 시각을 한 번에 뽑아 둔다. 전부 START~END
 * 사이라 8초 전에는 아무도 안 붙고, 늦어도 17초면 자리가 찬다. */
let pendingBots = 0;
let botJoinTimes = [];
const BOT_JOIN_GAP_MS = 800;   // 둘이 같은 순간에 들어오면 한꺼번에 찬 것으로 보인다
function planQueueFill(now) {
  const from = now + BOT_JOIN_START * 1000;
  const to = now + BOT_JOIN_END * 1000;
  botJoinTimes = [];
  for (let i = 0; i < ROOM_SIZE - 1; i++) {
    botJoinTimes.push(from + Math.random() * Math.max(0, to - from));
  }
  botJoinTimes.sort((a, b) => a - b);
  // 뒤에서부터 최소 간격을 확보한다. 마지막을 뒤로 밀지 않으므로
  // 총 대기는 BOT_JOIN_END를 넘지 않는다.
  for (let i = botJoinTimes.length - 2; i >= 0; i--) {
    botJoinTimes[i] = Math.max(from, Math.min(botJoinTimes[i], botJoinTimes[i + 1] - BOT_JOIN_GAP_MS));
  }
}
function resetQueueFill() { pendingBots = 0; botJoinTimes = []; }
const rooms = new Set();
const roomsByCode = new Map();   // 방 코드 → Room (친구끼리 코드로 입장)
const pendingRooms = new Map();  // 방 코드 → 아직 시작 안 한 대기실

function makeConn(ws) {
  const conn = {
    id: ++connSeq,
    token: crypto.randomUUID(),   // 재접속 식별자. 클라이언트가 보관했다가 되돌려준다
    ws,
    alive: true,
    room: null,
    name: '플레이어',
    charId: 'cat',
    queuedAt: 0,
    send(msg) {
      if (ws.readyState !== ws.OPEN) return;
      try { ws.send(JSON.stringify(msg)); } catch (err) { /* 끊긴 소켓은 무시 */ }
    },
  };
  return conn;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRoomCode() {
  let code;
  do {
    code = 'BR-';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (roomsByCode.has(code) || pendingRooms.has(code));
  return code;
}

function cleanName(value) {
  const s = String(value == null ? '' : value).replace(/[<>&"'`\x00-\x1f\x7f]/g, '').trim().slice(0, 12);
  return s || '플레이어';
}

function leaveQueue(conn) {
  const i = queue.indexOf(conn);
  if (i >= 0) queue.splice(i, 1);
}

function queueStatus() {
  const now = Date.now();
  const found = Math.min(ROOM_SIZE, queue.length + pendingBots);
  for (const conn of queue) {
    // 남은 시간을 세지 않는다. 언제 잡힐지 모르는 대기라 올라가는 편이 자연스럽다.
    const elapsed = Math.floor((now - conn.queuedAt) / 1000);
    conn.send({ t: 'queue', found, need: ROOM_SIZE, elapsed });
  }
}

function tryFormRoom() {
  // 사람이 4명 모이면 즉시 시작
  if (queue.length >= ROOM_SIZE) {
    resetQueueFill();
    startRoom(queue.splice(0, ROOM_SIZE));
    return;
  }
  if (!queue.length) { resetQueueFill(); return; }
  if (!FILL_WITH_AI) return;

  // 사람이 늘면 봇 자리를 먼저 내준다 (표시 인원은 그대로, 진짜 사람으로 바뀐다)
  if (queue.length + pendingBots > ROOM_SIZE) pendingBots = ROOM_SIZE - queue.length;

  const now = Date.now();
  if (!botJoinTimes.length) planQueueFill(queue[0].queuedAt);
  // 시각이 지난 봇 수만큼 채우되, 한 번에 한 명씩만 늘린다.
  // 뽑힌 시각이 몰려도 화면에서는 하나씩 들어오는 것으로 보여야 한다.
  const due = Math.min(botJoinTimes.filter(t => now >= t).length, ROOM_SIZE - queue.length);
  if (due > pendingBots) {
    pendingBots = due;
    queueStatus();                       // 새로 들어온 것을 바로 알린다
  }
  if (queue.length + pendingBots >= ROOM_SIZE) {
    const conns = queue.splice(0, queue.length);
    resetQueueFill();
    startRoom(conns);
  }
}

function startRoom(conns, code) {
  const names = core.shuffle(core.AI_NAMES).slice(0, ROOM_SIZE);
  const seats = [];
  conns.forEach(conn => seats.push({ conn, name: conn.name, charId: conn.charId }));
  while (seats.length < ROOM_SIZE) {
    seats.push({ conn: null, name: names[seats.length], charId: core.pick(Object.keys(core.CHARACTERS)) });
  }
  const room = new Room(seats, r => { rooms.delete(r); if (r.code) roomsByCode.delete(r.code); });
  room.code = code || makeRoomCode();
  rooms.add(room);
  roomsByCode.set(room.code, room);
  room.broadcast({
    t: 'match',
    roomId: room.id,
    you: null,
    players: room.publicPlayers(),
    humans: conns.length,
  });
  // 각자에게 자기 자리 번호를 알려준다. 반드시 첫 단계(weaponOffers)보다 먼저다.
  room.players.forEach(p => { if (p.conn) p.conn.send({ t: 'you', id: p.id, token: p.token, code: room.code }); });
  room.start();
  log(`room ${room.id} (${room.code}) 시작 · 사람 ${conns.length}명 + AI ${ROOM_SIZE - conns.length}명`);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

wss.on('connection', ws => {
  const conn = makeConn(ws);
  conn.send({ t: 'welcome', token: conn.token, roomSize: ROOM_SIZE });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (err) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const room = conn.room;
    const player = room ? room.players.find(p => p.conn === conn) : null;

    switch (msg.t) {
      case 'hello': {
        conn.name = cleanName(msg.name);
        if (core.CHARACTERS[msg.charId]) conn.charId = msg.charId;
        // 이전 세션 토큰을 들고 왔다면 그 자리로 복귀를 시도한다
        if (typeof msg.token === 'string' && msg.token) {
          conn.token = msg.token;
          for (const r of rooms) {
            if (r.reattach(conn)) { log(`재접속 · room ${r.id} (${r.code})`); break; }
          }
        }
        break;
      }

      /* ---- 방 코드로 친구와 함께 ---- */
      case 'createRoom': {
        if (conn.room) break;
        leaveQueue(conn);
        const code = makeRoomCode();
        pendingRooms.set(code, { code, conns: [conn], createdAt: Date.now() });
        conn.pendingCode = code;
        conn.send({ t: 'roomCreated', code, you: 0, players: [{ id: 0, name: conn.name }] });
        break;
      }
      case 'joinRoom': {
        if (conn.room) break;
        const lobby = pendingRooms.get(String(msg.code || '').toUpperCase());
        if (!lobby) { conn.send({ t: 'roomError', why: '없는 방 코드입니다' }); break; }
        if (lobby.conns.length >= ROOM_SIZE) { conn.send({ t: 'roomError', why: '방이 가득 찼습니다' }); break; }
        if (lobby.conns.includes(conn)) break;
        leaveQueue(conn);
        lobby.conns.push(conn);
        conn.pendingCode = lobby.code;
        for (const c of lobby.conns) {
          // you는 받는 사람마다 다르다. 없으면 클라이언트가 첫 자리를 자기로 착각한다.
          c.send({ t: 'roomJoined', code: lobby.code, you: lobby.conns.indexOf(c), players: lobby.conns.map((x, i) => ({ id: i, name: x.name })) });
        }
        break;
      }
      case 'startRoom': {
        const lobby = pendingRooms.get(conn.pendingCode);
        if (!lobby || lobby.conns[0] !== conn) break;   // 방장만 시작할 수 있다
        pendingRooms.delete(lobby.code);
        lobby.conns.forEach(c => { c.pendingCode = null; });
        startRoom(lobby.conns, lobby.code);
        break;
      }
      case 'leaveRoom': {
        const lobby = pendingRooms.get(conn.pendingCode);
        conn.pendingCode = null;
        if (!lobby) break;
        lobby.conns = lobby.conns.filter(c => c !== conn);
        if (!lobby.conns.length) pendingRooms.delete(lobby.code);
        else lobby.conns.forEach(c => c.send({ t: 'roomJoined', code: lobby.code, you: lobby.conns.indexOf(c), players: lobby.conns.map((x, i) => ({ id: i, name: x.name })) }));
        conn.send({ t: 'roomLeft' });
        break;
      }
      case 'queue':
        if (conn.room || queue.includes(conn)) break;
        conn.queuedAt = Date.now();
        queue.push(conn);
        queueStatus();
        tryFormRoom();
        break;
      case 'leave':
        leaveQueue(conn);
        conn.send({ t: 'queueLeft' });
        break;
      case 'weapon':   if (player) room.onWeapon(player, msg.id); break;
      case 'aim':      if (player) room.onAim(player, msg.ang); break;
      case 'skill':    if (player) room.onSkill(player, msg.slot); break;
      case 'spectate': if (player) room.onSpectate(player, typeof msg.i === 'number' ? msg.i : null); break;
      case 'augment':  if (player) room.onAugment(player, msg.id); break;
      case 'refresh':  if (player) room.onRefresh(player); break;
      case 'vote':     if (player) room.onVote(player, msg.id); break;
      case 'ping':     conn.send({ t: 'pong', at: msg.at }); break;
      default: break;
    }
  });

  ws.on('close', () => {
    conn.alive = false;
    leaveQueue(conn);
    const lobby = pendingRooms.get(conn.pendingCode);
    if (lobby) {
      lobby.conns = lobby.conns.filter(c => c !== conn);
      if (!lobby.conns.length) pendingRooms.delete(lobby.code);
      else lobby.conns.forEach(c => c.send({ t: 'roomJoined', code: lobby.code, you: lobby.conns.indexOf(c), players: lobby.conns.map((x, i) => ({ id: i, name: x.name })) }));
    }
    if (conn.room) {
      const player = conn.room.players.find(p => p.conn === conn);
      if (player) conn.room.onDisconnect(player);
    }
  });
  ws.on('error', () => { /* close 에서 정리된다 */ });
});

setInterval(() => { queueStatus(); tryFormRoom(); }, 500);

server.listen(PORT, () => {
  log(`바운스 로얄 서버 · 포트 ${PORT} · 봇 합류 ${BOT_JOIN_START}~${BOT_JOIN_END}초 · AI 채우기 ${FILL_WITH_AI ? 'ON' : 'OFF'}`);
});
