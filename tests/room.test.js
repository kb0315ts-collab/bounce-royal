'use strict';
/* ============================================================
 * 방(Room) 진행 순서 테스트
 *
 * 클라이언트는 "내가 몇 번 자리인가"를 you 메시지로 안다. 그보다 먼저
 * 참가자 목록이 실린 화면(무기 선택 등)이 도착하면 누가 나인지 모른 채
 * 그리게 되고, 1번 이후 자리 사람은 남의 이름·색을 자기 것으로 본다.
 * ============================================================ */
const assert = require('node:assert/strict');
const { Room } = require('../server/room.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (err) { console.error('✗ ' + name); throw err; }
}

function fakeConn(label) {
  return { alive: true, token: 'tok-' + label, name: label, send(msg) { this.log.push(msg.t); }, log: [] };
}
function makeRoom() {
  const a = fakeConn('A'), b = fakeConn('B');
  const seats = [
    { conn: a, name: 'A', charId: 'cat' },
    { conn: b, name: 'B', charId: 'wak' },
    { conn: null, name: 'AI1', charId: 'soft' },
    { conn: null, name: 'AI2', charId: 'bomb' },
  ];
  const room = new Room(seats, () => {});
  return { room, a, b };
}

test('방을 만드는 것만으로는 무기 선택을 보내지 않는다', () => {
  const { room, a, b } = makeRoom();
  try {
    assert.ok(!a.log.includes('weaponOffers'), 'you보다 먼저 도착하면 자리를 모른 채 화면을 그린다');
    assert.ok(!b.log.includes('weaponOffers'));
  } finally { clearInterval(room.tickTimer); }
});

test('start()를 불러야 무기 선택이 나간다', () => {
  const { room, a, b } = makeRoom();
  try {
    room.start();
    assert.ok(a.log.includes('weaponOffers'), 'start 후에는 무기 후보가 가야 한다');
    assert.ok(b.log.includes('weaponOffers'));
  } finally { clearInterval(room.tickTimer); }
});

test('자리마다 다른 색이 배정된다', () => {
  const { room } = makeRoom();
  try {
    const colors = room.publicPlayers().map(p => p.color);
    assert.equal(new Set(colors).size, colors.length, '두 사람이 같은 색이면 서로를 구분할 수 없다');
    assert.deepEqual(room.publicPlayers().map(p => p.id), [0, 1, 2, 3]);
  } finally { clearInterval(room.tickTimer); }
});

test('사람 자리는 서로 다른 토큰을 갖는다', () => {
  const { room } = makeRoom();
  try {
    const tokens = room.players.filter(p => p.token).map(p => p.token);
    assert.equal(new Set(tokens).size, tokens.length, '토큰이 겹치면 재접속 때 남의 자리로 들어간다');
  } finally { clearInterval(room.tickTimer); }
});


/* ---- 다른 전투 관전 ----
 * 관전은 "서버가 어느 전투의 스냅샷을 보내는가"를 바꾸는 일이다.
 * 클라이언트가 표시만 바꾸면 계속 자기 (이미 끝난) 전투만 보게 된다. */
function roomInBattle() {
  const { room } = makeRoom();
  room.start();
  for (const p of room.players) p.weaponId = 'sword';
  room.startRound();
  return room;
}

test('전투가 아직 진행 중이면 관전 요청을 거부한다', () => {
  const room = roomInBattle();
  try {
    assert.equal(room.battles.length, 2, '4명이면 전투가 둘로 갈린다');
    const p = room.players[0];
    const mine = room.battles.findIndex(b => b.fighters.some(f => f.player.id === p.id));
    const other = mine === 0 ? 1 : 0;
    room.onSpectate(p, other);
    assert.equal(p.spectate, null, '내 전투가 안 끝났는데 남의 판을 미리 보면 안 된다');
  } finally { clearInterval(room.tickTimer); }
});

test('내 전투가 끝나면 다른 전투를 관전할 수 있다', () => {
  const room = roomInBattle();
  try {
    const p = room.players[0];
    const mine = room.battles.findIndex(b => b.fighters.some(f => f.player.id === p.id));
    const other = mine === 0 ? 1 : 0;
    room.battles[mine].result = { winner: room.battles[mine].fighters[0], reason: 'kill', draw: false };
    p.conn.log.length = 0;
    room.onSpectate(p, other);
    assert.equal(p.spectate, other, '관전 대상이 서버에 기록되어야 한다');
    assert.ok(p.conn.log.includes('spectating'), '관전이 시작됐음을 알려야 한다');
  } finally { clearInterval(room.tickTimer); }
});

test('관전 중에는 그 전투의 스냅샷을 받는다', () => {
  const room = roomInBattle();
  try {
    const p = room.players[0];
    const mine = room.battles.findIndex(b => b.fighters.some(f => f.player.id === p.id));
    const other = mine === 0 ? 1 : 0;
    room.battles[mine].result = { winner: room.battles[mine].fighters[0], reason: 'kill', draw: false };
    room.onSpectate(p, other);
    // tick 안의 전송 대상 선택과 같은 규칙
    const own = room.battleOf(p);
    const watching = own && own.result && p.spectate != null ? room.battles[p.spectate] : null;
    assert.equal(watching, room.battles[other], '관전 대상 전투를 보내야 한다');
    const mySeats = room.battles[mine].fighters.map(f => f.player.id).sort();
    const seenSeats = watching.fighters.map(f => f.player.id).sort();
    assert.notDeepEqual(seenSeats, mySeats, '내 전투와 다른 참가자여야 한다');
  } finally { clearInterval(room.tickTimer); }
});

test('라운드가 새로 시작하면 관전이 풀린다', () => {
  const room = roomInBattle();
  try {
    const p = room.players[0];
    const mine = room.battles.findIndex(b => b.fighters.some(f => f.player.id === p.id));
    room.battles[mine].result = { winner: room.battles[mine].fighters[0], reason: 'kill', draw: false };
    room.onSpectate(p, mine === 0 ? 1 : 0);
    assert.notEqual(p.spectate, null);
    room.startRound();
    assert.equal(p.spectate, null, '새 라운드에서는 자기 전투를 봐야 한다');
  } finally { clearInterval(room.tickTimer); }
});

console.log('\n' + passed + '개 방 진행 테스트 통과');
