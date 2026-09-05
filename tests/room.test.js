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
const core = require('../server/game-core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (err) { console.error('✗ ' + name); throw err; }
}

function fakeConn(label) {
  // 보낸 메시지를 통째로 남긴다. 종류뿐 아니라 내용도 검사해야 한다.
  return { alive: true, token: 'tok-' + label, name: label, send(msg) { this.log.push(msg); }, log: [],
    types() { return this.log.map(m => m.t); } };
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
    assert.ok(!a.types().includes('weaponOffers'), 'you보다 먼저 도착하면 자리를 모른 채 화면을 그린다');
    assert.ok(!b.types().includes('weaponOffers'));
  } finally { clearInterval(room.tickTimer); }
});

test('start()를 불러야 무기 선택이 나간다', () => {
  const { room, a, b } = makeRoom();
  try {
    room.start();
    assert.ok(a.types().includes('weaponOffers'), 'start 후에는 무기 후보가 가야 한다');
    assert.ok(b.types().includes('weaponOffers'));
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
    assert.ok(p.conn.types().includes('spectating'), '관전이 시작됐음을 알려야 한다');
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

/* ---- 서버 권위 조향 입력 ---- */
function steerRoom() {
  const room = roomInBattle();
  const player = room.players[0];
  const battle = room.battleOf(player);
  battle.phase = 'fight';
  return { room, player, battle, fighter: room.fighterOf(player) };
}

test('정상 조향 입력은 각도를 정규화하고 세기를 0..1로 제한한다', () => {
  const { room, player, fighter } = steerRoom();
  try {
    assert.equal(room.onSteer(player, Math.PI * 4 + 0.4, 7, true), true);
    assert.equal(fighter.steer.active, true);
    assert.ok(Math.abs(fighter.steer.angle - 0.4) < 1e-9,
      '각도는 -π..π로 정규화되어야 한다 (실제 ' + fighter.steer.angle + ')');
    assert.equal(fighter.steer.magnitude, 1, '1보다 큰 입력은 1로 제한해야 한다');

    assert.equal(room.onSteer(player, -0.2, -3, true), true);
    assert.equal(fighter.steer.active, false, '0보다 작은 입력은 0으로 제한되어 조향을 해제한다');
  } finally { clearInterval(room.tickTimer); }
});

test('NaN·Infinity·잘못된 타입의 조향 패킷은 상태를 바꾸지 않는다', () => {
  const { room, player, fighter } = steerRoom();
  try {
    room.onSteer(player, 0.75, 0.6, true);
    const before = { angle: fighter.steer.angle, magnitude: fighter.steer.magnitude, active: fighter.steer.active };
    assert.equal(room.onSteer(player, NaN, 1, true), false);
    assert.equal(room.onSteer(player, Infinity, 1, true), false);
    assert.equal(room.onSteer(player, 0, NaN, true), false);
    assert.equal(room.onSteer(player, '0', 1, true), false);
    assert.equal(room.onSteer(player, 0, 1, 'true'), false);
    assert.deepEqual(
      { angle: fighter.steer.angle, magnitude: fighter.steer.magnitude, active: fighter.steer.active },
      before,
      '악성 입력 뒤에도 마지막 정상 상태가 유지되어야 한다',
    );
    assert.equal(room.onSteer(player, NaN, Infinity, false), true,
      'release는 좌표 없이도 즉시 받아야 한다');
    assert.equal(fighter.steer.active, false);
  } finally { clearInterval(room.tickTimer); }
});

test('aim 패킷은 전투 시작 조준에만 쓰이고 fight 중 즉시 방향전환을 만들지 않는다', () => {
  const { room, player, fighter } = steerRoom();
  try {
    fighter.vx = 1; fighter.vy = 0;
    room.onAim(player, Math.PI / 2);
    assert.equal(fighter.vx, 1);
    assert.equal(fighter.vy, 0);
  } finally { clearInterval(room.tickTimer); }
});

test('조향 패킷은 fight 전에 미리 예약할 수 없다', () => {
  const room = roomInBattle();
  try {
    const player = room.players[0], fighter = room.fighterOf(player);
    assert.equal(room.battleOf(player).phase, 'count');
    assert.equal(room.onSteer(player, 1, 1, true), false);
    assert.equal(fighter.steer.active, false);
  } finally { clearInterval(room.tickTimer); }
});

test('접속 종료 시 사람의 잔류 조향을 지우고 AI에게 넘긴다', () => {
  const { room, player, fighter } = steerRoom();
  try {
    room.onSteer(player, 1.2, 1, true);
    assert.equal(fighter.steer.active, true);
    room.onDisconnect(player);
    assert.equal(fighter.steer.active, false);
    assert.equal(fighter.isAI, true);
  } finally { clearInterval(room.tickTimer); }
});


/* ---- 이벤트 당첨 효과 ----
 * 투표에서 당첨된 이벤트가 실제로 다음 라운드에 반영되는지 본다.
 * 여기서는 상태를 손으로 넣지 않고 onVote부터 태워 실제 경로를 지난다. */
function roomAtEventVote(eventId) {
  const { room } = makeRoom();
  room.start();
  for (const p of room.players) p.weaponId = 'sword';
  room.round = 3;
  room.startEventVote();
  const ev = core.GAME_EVENT_BY_ID[eventId];
  assert.ok(ev, '없는 이벤트: ' + eventId);
  room.eventOffers = [ev, ...room.eventOffers.filter(e => e.id !== eventId)].slice(0, 3);
  // AI 표까지 같은 것으로 모아 당첨을 확정한다
  for (const p of room.players) if (p.isAI) room.eventVotes.set(p.id, eventId);
  for (const p of room.players) if (!p.isAI) room.onVote(p, eventId);
  return room;
}

test('전원 집결이 당첨되면 다음 라운드가 4인 난투가 된다', () => {
  const room = roomAtEventVote('nextFfa');
  try {
    assert.equal(room.activeEventId, 'nextFfa', '서버가 당첨 이벤트를 적용해야 한다');
    assert.equal(room.eventForceFfaRound, room.round + 1);
    room.startRound();
    assert.equal(room.battles.length, 1, '난투는 전투가 하나여야 한다 (실제 ' + room.battles.length + '개)');
    assert.equal(room.battles[0].fighters.length, 4, '남은 전원이 한 판에 들어가야 한다');
  } finally { clearInterval(room.tickTimer); }
});

test('클라이언트가 받는 당첨 이벤트가 서버가 적용한 것과 같다', () => {
  for (const id of ['nextFfa', 'twoPillars', 'globalDamage30', 'doubleAugments']) {
    const room = roomAtEventVote(id);
    try {
      const msg = room.players[0].conn.log.filter(m => m.t === 'eventResult').pop();
      assert.ok(msg, id + ': 결과를 보내야 한다');
      assert.equal(msg.event.id, room.activeEventId, id + ': 화면에 뜬 이벤트와 실제 적용이 달라지면 안 된다');
      assert.equal(msg.event.id, id);
    } finally { clearInterval(room.tickTimer); }
  }
});

test('경기장을 바꾸는 이벤트가 실제 전투에 반영된다', () => {
  const pillars = roomAtEventVote('twoPillars');
  try {
    pillars.startRound();
    assert.equal(pillars.battles[0].arena.pillars.length, 2, '기둥 2개가 생겨야 한다');
  } finally { clearInterval(pillars.tickTimer); }

  const power = roomAtEventVote('powerSupply');
  try {
    power.startRound();
    assert.ok(power.battles[0].arena.cube, '중앙 보급 큐브가 생겨야 한다');
  } finally { clearInterval(power.tickTimer); }
});

test('증강 수를 바꾸는 이벤트가 실제 선택 횟수에 반영된다', () => {
  const dbl = roomAtEventVote('doubleAugments');
  try {
    dbl.startAugmentPhase();
    const st = dbl.augmentState.get(dbl.players[0].id);
    assert.equal(st.total, 2, '두 배의 선택이면 증강을 2개 골라야 한다');
  } finally { clearInterval(dbl.tickTimer); }

  const loss = roomAtEventVote('lossAugment');
  try {
    loss.players[0].eventLostLastRound = true;
    assert.equal(core.eventAugmentPickCount(loss, loss.players[0]), 2, '패배자는 하나 더 골라야 한다');
    assert.equal(core.eventAugmentPickCount(loss, loss.players[1]), 1, '이긴 쪽은 그대로여야 한다');
  } finally { clearInterval(loss.tickTimer); }
});

test('피해·코인 이벤트가 실제 수치에 반영된다', () => {
  const dmg = roomAtEventVote('globalDamage30');
  try {
    dmg.startRound();
    assert.ok(dmg.players.every(p => p.eventDamageMult === 1.3), '전원 피해 배율이 올라야 한다');
    assert.ok(Math.abs(dmg.battles[0].fighters[0].perm.dmg - 1.3) < 1e-9, '전투원에게도 실려야 한다');
  } finally { clearInterval(dmg.tickTimer); }

  const relief = roomAtEventVote('refreshTen');
  try {
    assert.ok(relief.refreshes >= 10, '새로고침이 10개 늘어야 한다');
  } finally { clearInterval(relief.tickTimer); }

  const rev = roomAtEventVote('reverseCoins');
  try {
    assert.equal(rev.eventCoinReversalRound, rev.round + 1, '다음 라운드에 예약되어야 한다');
  } finally { clearInterval(rev.tickTimer); }
});


/* ---- 이벤트 결과를 읽을 시간 ----
 * 클라이언트는 표가 갈렸으면 최대 4.1초짜리 추첨 룰렛을 돌린 뒤 당첨자를
 * 공개한다. 서버가 그보다 먼저 다음 단계로 넘기면 당첨자가 보이기도 전에
 * 화면이 바뀐다. 예전에 3초로 고정돼 있어 실제로 그랬다. */
function roomAfterVote(sameVote) {
  const { room } = makeRoom();
  room.start();
  for (const p of room.players) p.weaponId = 'sword';
  room.round = 3;
  room.startEventVote();
  const ids = room.eventOffers.map(e => e.id);
  room.eventVotes = new Map();
  room.players.forEach((p, i) => room.eventVotes.set(p.id, sameVote ? ids[0] : ids[i % ids.length]));
  room.finishEventVote();
  return room;
}

test('표가 갈리면 룰렛이 끝나고도 결과를 읽을 시간이 남는다', () => {
  const room = roomAfterVote(false);
  try {
    const msg = room.players[0].conn.log.filter(m => m.t === 'eventResult').pop();
    assert.ok(msg, '결과를 보내야 한다');
    assert.ok(msg.seconds >= 4.1 + 2,
      '룰렛(4.1초)이 끝난 뒤 2초는 남아야 한다 (실제 ' + msg.seconds + '초)');
    const left = (room.deadline - Date.now()) / 1000;
    assert.ok(left > 4.1, '단계 마감도 같이 늘어야 한다 (실제 ' + left.toFixed(1) + '초)');
  } finally { clearInterval(room.tickTimer); }
});

test('표가 하나로 모이면 룰렛을 건너뛰므로 더 짧다', () => {
  const room = roomAfterVote(true);
  try {
    const msg = room.players[0].conn.log.filter(m => m.t === 'eventResult').pop();
    assert.ok(msg.seconds >= 2, '그래도 읽을 2초는 줘야 한다 (실제 ' + msg.seconds + '초)');
    assert.ok(msg.seconds < 4, '룰렛을 안 도는데 기다릴 이유가 없다 (실제 ' + msg.seconds + '초)');
  } finally { clearInterval(room.tickTimer); }
});


/* ---- 출발 방향 ----
 * 라운드는 3초 카운트다운으로 시작한다. 그 3초 동안
 *   안 건드리면       아무 방향으로나
 *   당기고 있으면     그 방향으로
 *   건드렸다 뗐으면   마지막으로 잡았던 방향으로
 * 나간다. 확정이라는 단계는 없다. */
function aimRoom() {
  const { room } = makeRoom();
  room.start();
  for (const p of room.players) p.weaponId = 'sword';
  room.startRound();
  const player = room.players[0];
  return { room, player, battle: room.battleOf(player), fighter: room.fighterOf(player) };
}
const dirOf = f => Math.atan2(f.vy, f.vx);
const runCountdown = battle => {
  let secs = 0;
  for (let i = 0; i < 60 * 8 && battle.phase === 'count'; i++) { battle.update(1 / 60); secs += 1 / 60; }
  return secs;
};

test('라운드는 3초 카운트다운으로 시작한다', () => {
  const { room, battle } = aimRoom();
  try {
    assert.equal(battle.phase, 'count', '조준 단계 없이 곧바로 카운트다운이다');
    const secs = runCountdown(battle);
    assert.equal(battle.phase, 'fight');
    assert.ok(Math.abs(secs - 3) < 0.05, '3초여야 한다 (실제 ' + secs.toFixed(2) + '초)');
  } finally { clearInterval(room.tickTimer); }
});

test('방향을 잡아도 굳지 않는다', () => {
  const { room, player, fighter } = aimRoom();
  try {
    assert.equal(room.onAim(player, Math.PI / 2), true);
    assert.ok(Math.abs(dirOf(fighter) - Math.PI / 2) < 1e-9, '방향은 즉시 반영되어야 한다');
    assert.equal(room.onAim(player, -1.2), true, '한 번 잡았다고 굳어 버리면 안 된다');
    assert.ok(Math.abs(dirOf(fighter) - (-1.2)) < 1e-9);
    assert.equal(fighter.aimTouched, true);
  } finally { clearInterval(room.tickTimer); }
});

test('당기고 있으면 그 방향으로 나간다', () => {
  const { room, player, battle, fighter } = aimRoom();
  try {
    room.onAim(player, 0.3);
    for (let i = 0; i < 90; i++) battle.update(1 / 60);        // 1.5초쯤 흘려보낸다
    assert.equal(battle.phase, 'count', '아직 세는 중이어야 한다');
    room.onAim(player, 2.1);                                   // 손가락을 옮긴다
    assert.ok(Math.abs(dirOf(fighter) - 2.1) < 1e-9, '즉시 반영되어야 한다');
    runCountdown(battle);
    assert.equal(battle.phase, 'fight');
    assert.ok(Math.abs(dirOf(fighter) - 2.1) < 1e-9,
      '당기던 방향 그대로 출발해야 한다 (실제 ' + dirOf(fighter) + ')');
  } finally { clearInterval(room.tickTimer); }
});

test('건드렸다 뗐으면 마지막으로 잡았던 방향으로 나간다', () => {
  const { room, player, battle, fighter } = aimRoom();
  try {
    room.onAim(player, -1.1);                                  // 잡았다가
    for (let i = 0; i < 60; i++) battle.update(1 / 60);        // 뗀 채로 1초
    runCountdown(battle);
    assert.ok(Math.abs(dirOf(fighter) - (-1.1)) < 1e-9,
      '떼기 전 마지막 방향이어야 한다 (실제 ' + dirOf(fighter) + ')');
  } finally { clearInterval(room.tickTimer); }
});

test('아무것도 안 건드리면 아무 방향으로나 나간다', () => {
  const dirs = new Set();
  for (let k = 0; k < 6; k++) {
    const { room, battle, fighter } = aimRoom();
    try {
      runCountdown(battle);
      assert.equal(fighter.aimTouched, false);
      dirs.add(dirOf(fighter).toFixed(3));
    } finally { clearInterval(room.tickTimer); }
  }
  assert.ok(dirs.size > 1, '건드리지 않았으면 방향이 무작위여야 한다');
});

/* 결판이 나자마자 넘어가면 누가 졌는지 볼 틈이 없다.
 * 공이 깨지고 화면이 느려지는 연출이 끝날 때까지 붙잡아 둔다. */
test('승패가 갈려도 최소 1초는 붙잡아 둔다', () => {
  const { room } = aimRoom();
  try {
    for (const b of room.battles) if (!b.result) b.finish(b.fighters[0], '격파');
    room.tick();
    assert.equal(room.phase, 'battle', '결판 나자마자 넘어가면 누가 졌는지 못 본다');
    assert.ok(room.roundOverAt > 0, '멈춘 시각을 기억해야 다음 판단을 할 수 있다');

    room.roundOverAt = Date.now() - 999;      // 아직 1초가 안 됐다
    room.tick();
    assert.equal(room.phase, 'battle', '1초도 안 됐는데 넘어가면 안 된다');

    room.roundOverAt = Date.now() - 5000;     // 충분히 기다렸다
    room.tick();
    assert.notEqual(room.phase, 'battle', '연출이 끝났으면 넘어가야 한다');
  } finally { clearInterval(room.tickTimer); }
});

test('전투가 시작된 뒤에는 조준 패킷을 받지 않는다', () => {
  const { room, player, battle, fighter } = aimRoom();
  try {
    room.onAim(player, 0.7, true);
    for (let i = 0; i < 60 * 8 && battle.phase !== 'fight'; i++) battle.update(1 / 60);
    assert.equal(battle.phase, 'fight');
    assert.equal(room.onAim(player, 3.0, true), false, '전투 중에는 조향만 쓴다');
    assert.ok(Math.abs(Math.atan2(fighter.vy, fighter.vx) - 0.7) < 1e-9);
  } finally { clearInterval(room.tickTimer); }
});

console.log('\n' + passed + '개 방 진행 테스트 통과');
