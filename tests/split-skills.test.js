'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../server/game-core.js');

/* 분열한 뒤에는 살아 있는 분열체 모두가 본체다. 조이스틱이 둘을 함께 움직이듯
 * 스킬 버튼도 한 번에 둘 다 쓴다. 횟수와 쿨타임은 한 벌을 나눠 쓰므로 한 번만 줄어든다. */
const player = (id, weaponId, charId = 'cat', isAI = false) => ({ id, name: 'P' + id, charId, weaponId,
  color: '#4da6ff', isAI, coins: 5, augments: [], wins: 0, losses: 0, streak: 0 });

function splitBattle(weaponId, charId = 'cat', isAI = false) {
  const b = new core.Battle('diamond', [player(0, weaponId, charId, isAI), player(1, 'sword')]);
  b.phase = 'fight';
  const f = b.fighters[0];
  f.mainDead = true;
  b.spawnSplits(f);
  return { b, f, splits: f.splitBalls };
}

test('one press casts the weapon skill on every living split and spends the shared cooldown once', () => {
  const { b, f, splits } = splitBattle('sword');
  assert.equal(splits.length, 2);
  const spin0 = splits.map(s => s.spinRemaining);
  assert.equal(core.useSkill(b, f, 'weapon'), true);
  splits.forEach((s, i) => assert.ok(s.spinRemaining > spin0[i] + 12, `분열체 ${i + 1}도 믹서기를 쓴다`));
  assert.equal(splits[0].skillUses, splits[1].skillUses, '횟수·쿨타임은 한 벌이다');
  assert.equal(f.skillUses.cd, 8, '쿨타임은 한 번만 걸린다');
  const spin1 = splits.map(s => s.spinRemaining);
  assert.equal(core.useSkill(b, f, 'weapon'), false, '쿨타임 중에는 둘 다 못 쓴다');
  assert.deepEqual(splits.map(s => s.spinRemaining), spin1);
});

test('one press casts the character skill on both splits and uses one charge', () => {
  const { b, f, splits } = splitBattle('sword', 'balloon');
  assert.equal(f.skillUses.char, 1);
  assert.equal(core.useSkill(b, f, 'char'), true);
  for (const s of splits) assert.equal(s.timers.balloon, 5, '두 분열체 모두 팽창한다');
  assert.equal(f.skillUses.char, 0, '횟수는 하나만 줄어든다');
  assert.equal(core.useSkill(b, f, 'char'), false);
});

test('a flail split swaps with its own head, and a stunned or dead split sits the cast out', () => {
  const { b, f, splits } = splitBattle('chain');
  b.update(1 / 60);                             // 추가 생긴다
  for (const s of splits) { s.chainHeads[0].x = s.x + 60; s.chainHeads[0].y = s.y; }
  const heads = splits.map(s => ({ x: s.chainHeads[0].x, y: s.chainHeads[0].y }));
  assert.equal(core.useSkill(b, f, 'weapon'), true);
  splits.forEach((s, i) => {
    assert.ok(Math.hypot(s.x - heads[i].x, s.y - heads[i].y) < 1, `분열체 ${i + 1}은 제 추와 자리를 바꾼다`);
  });

  const again = splitBattle('sword');
  again.splits[0].timers.stun = 1;
  const spin = again.splits.map(s => s.spinRemaining);
  assert.equal(core.useSkill(again.b, again.f, 'weapon'), true, '하나라도 쓰면 성공이다');
  assert.equal(again.splits[0].spinRemaining, spin[0], '기절한 분열체는 쓰지 않는다');
  assert.ok(again.splits[1].spinRemaining > spin[1], '나머지는 쓴다');
  assert.equal(again.f.skillUses.cd, 8);
  // 마지막 분열체가 못 써도 앞 분열체가 쓴 소비는 남는다
  const tail = splitBattle('sword', 'balloon');
  tail.splits[1].timers.stun = 1;
  assert.equal(core.useSkill(tail.b, tail.f, 'char'), true);
  assert.equal(tail.splits[0].timers.balloon, 5); assert.ok(!(tail.splits[1].timers.balloon > 0));
  assert.equal(tail.f.skillUses.char, 0, '횟수가 되살아나지 않는다');
  assert.equal(core.useSkill(tail.b, tail.f, 'weapon'), true);
  assert.equal(tail.f.skillUses.cd, 8, '쿨타임도 되살아나지 않는다');

  const lone = splitBattle('sword');
  lone.splits[1].dead = true;
  assert.equal(core.useSkill(lone.b, lone.f, 'weapon'), true);
  assert.ok(lone.splits[0].spinRemaining > 12);
  for (const s of lone.splits) s.dead = true;
  lone.f.skillUses.cd = 0;
  assert.equal(core.useSkill(lone.b, lone.f, 'weapon'), false, '살아 있는 분열체가 없으면 쓸 수 없다');
});

test('a bow split pair charges together and fires together on the second press', () => {
  const { b, f, splits } = splitBattle('bow');
  assert.equal(core.useSkill(b, f, 'weapon'), true);
  for (const s of splits) assert.ok(s.charging, '둘 다 모은다');
  assert.equal(f.skillUses.cd, 0, '모으는 동안에는 쿨타임이 없다');
  for (const s of splits) s.charging.t = 1;
  b.projectiles.length = 0;
  assert.equal(core.useSkill(b, f, 'weapon'), true);
  for (const s of splits) assert.equal(s.charging, null, '둘 다 쏜다');
  const owners = new Set(b.projectiles.map(p => p.owner));
  for (const s of splits) assert.ok(owners.has(s), '각 분열체가 제 화살을 쏜다');
  assert.equal(f.skillUses.cd, 15);
});

test('an AI split decides for the pair, so both AI splits cast in the same frame', () => {
  const { b, f, splits } = splitBattle('sword', 'balloon', true);
  b.simT = 4;                                   // 팽창 휴리스틱: 3초가 지나면 쓴다
  // AI 첫 판단은 늦으면 1초 넘게 걸리고 이후 0.2~0.4초마다 본다. 한 분열체가 쓰기로 한 그 프레임에 둘 다 쓴다.
  for (let i = 0; i < 240 && f.skillUses.char > 0; i++) b.update(1 / 60);
  assert.equal(f.skillUses.char, 0, 'AI가 팽창을 썼다');
  for (const s of splits) assert.ok(s.timers.balloon > 5 - 1 / 60 - 1e-9, '같은 프레임에 둘 다 팽창했다');
});
