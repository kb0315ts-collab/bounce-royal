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

console.log('\n' + passed + '개 방 진행 테스트 통과');
