'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { snapshot } = require('../server/snapshot.js');

function runtime() {
  let seed = 617, randomCalls = 0, forcedRandom = null, pid = 0;
  const math = Object.create(Math);
  math.random = () => {
    randomCalls++;
    seed = (1664525 * seed + 1013904223) >>> 0;
    return forcedRandom == null ? seed / 4294967296 : forcedRandom;
  };
  const ctx = vm.createContext({ console, Math: math, performance, Map, Set });
  const names = ['Battle', 'battleCommentary', 'pruneBattleCommentary', 'spawnProj', 'projectileHit',
    'useSkill', 'updateTimers', 'updateWeapon', 'moveFighter', 'tryDashHit', 'weaponDamage',
    'fireGun', 'fireStaff', 'dealDamage', 'onWallBounce', 'spawnBolt', 'explodeMine',
    'netBattleView', 'lerpSnapshot'];
  vm.runInContext(['js/data.js', 'js/sim.js', 'js/net.js'].map(file =>
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n')
    + '\nglobalThis.api = {' + names.join(',') + '};', ctx);
  const player = opts => Object.assign({ id: ++pid, name: '검사' + pid, isAI: false,
    color: '#4da6ff', charId: 'cat', weaponId: 'sword', coins: 5, coinsLost: 0,
    augments: [], augmentBaselines: {}, wins: 0, losses: 0, streak: 0,
    rounds: 0, totalDmg: 0, damageRewardMult: 1 }, opts);
  const battle = (a = {}, b = {}, opts = {}) => new ctx.api.Battle('circle', [player(a), player(b)], opts);
  return { ...ctx.api, battle, randomCalls: () => randomCalls, forceRandom: n => { forcedRandom = n; } };
}

const hits = b => Array.from(b.commentaryEvents).filter(e => e.type === 'hit');
const json = x => JSON.parse(JSON.stringify(x));

test('면역·유체화·보호막으로 막힌 공격은 적중 해설을 만들지 않는다', () => {
  const r = runtime(), b = r.battle(), [a, e] = b.fighters;
  b.phase = 'fight';
  e.timers.immune = 1;
  r.weaponDamage(b, a, e, 12);
  e.timers.immune = 0; e.timers.untouchable = 1;
  r.weaponDamage(b, a, e, 12);
  e.timers.untouchable = 0; e.shield = 20;
  r.weaponDamage(b, a, e, 12);
  assert.equal(hits(b).length, 0);
  assert.equal(e.hp, e.maxHp);
  r.weaponDamage(b, a, e, 12);
  assert.equal(hits(b).length, 1);
  assert.equal(hits(b)[0].amount, 4, '남은 보호막 8을 제외한 체력 피해');
  assert.equal(hits(b)[0].source, 'weapon:sword');
  e.hp = 3; r.weaponDamage(b, a, e, 100);
  assert.equal(hits(b).at(-1).amount, 3, '과잉 피해를 실제 체력 손실로 부풀리지 않는다');
});

test('차지 샷은 충전 접수와 실제 적중을 구분하고 실패 입력·빗나감은 적중으로 세지 않는다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow' }), [a, e] = b.fighters;
  assert.equal(r.useSkill(b, a, 'weapon'), false, '카운트다운 중에는 거절');
  b.phase = 'fight';
  assert.equal(r.useSkill(b, a, 'weapon'), true);
  assert.equal(r.useSkill(b, a, 'weapon'), false, '너무 이른 발사 거절');
  assert.equal(b.commentaryEvents.length, 1);
  assert.equal(b.commentaryEvents[0].type, 'skill');
  assert.equal(b.commentaryEvents[0].source, 'skill:bow');
  r.updateTimers(b, a, 0.25); r.useSkill(b, a, 'weapon');
  assert.equal(hits(b).length, 0, '발사는 적중이 아니다');
  const charge = b.projectiles.find(p => p.kind === 'charge');
  r.projectileHit(b, charge, e);
  assert.equal(hits(b)[0].source, 'skill:bow');
  assert.equal(hits(b)[0].amount, charge.dmg);   // 차지 샷 피해 (data.js chargeDmg)
  assert.equal(hits(b)[0].actor, a.uid);
  assert.equal(hits(b)[0].target, e.uid);
});

test('단검 돌진과 농구공 돌진은 관통 경로·접촉 두 경로에서 출처가 보존된다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'dagger', charId: 'bball' }), [a, e] = b.fighters;
  b.phase = 'fight'; a.x = 0; a.y = 0; a.vx = 1; a.vy = 0; e.x = 55; e.y = 0;
  r.useSkill(b, a, 'weapon'); r.updateTimers(b, a, 1.01);
  r.moveFighter(b, a, 0.05);
  assert.equal(hits(b)[0].source, 'skill:dagger');
  assert.equal(hits(b)[0].amount, 22);   // 관통 돌진 피해 (data.js dashDmg)
  r.tryDashHit(b, a, e);
  assert.equal(hits(b).length, 1, '같은 돌진을 중복 적중으로 세지 않는다');
  a.dash = { kind: 'rush' }; a.dashHit = new Set(); a.timers.dashT = 1;
  r.tryDashHit(b, a, e);
  assert.equal(hits(b).at(-1).source, 'char:bball');
  assert.equal(hits(b).at(-1).amount, 26);
});

test('믹서기 마지막 회전 프레임의 실제 접촉도 검 스킬로 기록한다', () => {
  const r = runtime(), b = r.battle(), [a, e] = b.fighters;
  b.phase = 'fight'; a.x = 0; a.y = 0; a.weaponAngle = -0.01;
  a.spinRemaining = 0.01; e.x = 60; e.y = 0;
  r.updateWeapon(b, a, 0.01);
  assert.equal(a.spinRemaining, 0);
  assert.equal(hits(b)[0].source, 'skill:sword');
});

test('난사 탄환의 발사 출처와 마력 폭주의 실제 확대 적중을 구분한다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'pistol' }), [a, e] = b.fighters;
  b.phase = 'fight'; r.useSkill(b, a, 'weapon'); r.fireGun(b, a);
  a.timers.gunBarrage = 0;
  r.projectileHit(b, b.projectiles[0], e);
  assert.equal(hits(b)[0].source, 'skill:pistol');
  const staff = r.battle({ weaponId: 'staff' }), [s, victim] = staff.fighters;
  staff.phase = 'fight'; r.fireStaff(staff, s);
  s.timers.rampage = 3; r.projectileHit(staff, staff.projectiles[0], victim);
  s.timers.rampage = 0; r.projectileHit(staff, staff.projectiles[0], victim);
  assert.deepEqual(hits(staff).map(e => e.source), ['skill:staff', 'weapon:staff']);
});

test('폭탄·원격 지뢰 스킬과 일반 지뢰 폭발의 피해 출처가 구분된다', () => {
  const r = runtime(), b = r.battle({ charId: 'bomb', weaponId: 'mine' }), [a, e] = b.fighters;
  b.phase = 'fight'; a.x = 0; a.y = 0; e.x = 50; e.y = 0;
  r.useSkill(b, a, 'char'); r.updateTimers(b, a, 1.01);
  assert.equal(hits(b)[0].source, 'char:bomb');
  const mine = { owner: a, x: e.x, y: e.y, blast: 62, dmg: 10 };
  r.explodeMine(b, mine);
  b.mines.push(mine); r.useSkill(b, a, 'weapon'); r.updateTimers(b, a, 1.01);
  assert.deepEqual(hits(b).map(e => e.source), ['char:bomb', 'weapon:mine', 'skill:mine']);
});

test('번개·연쇄 번개·충격파는 실제 맞은 경우에만 증강 출처로 기록한다', () => {
  const r = runtime(), b = r.battle({ augments: ['shockwave'] }), [a, e] = b.fighters;
  b.phase = 'fight'; a.x = 0; a.y = 0; e.x = 300; e.y = 0;
  r.onWallBounce(b, a, 1);
  assert.equal(hits(b).length, 0, '멀리서 터진 충격파는 적중이 아니다');
  e.x = 60; r.onWallBounce(b, a, 1);
  assert.equal(hits(b)[0].source, 'augment:shockwave');
  r.forceRandom(0.5); a.flags.chainBolt = 1; r.spawnBolt(b, a);
  assert.deepEqual(hits(b).slice(1).map(e => e.source), ['augment:lightning', 'augment:chainBolt', 'augment:chainBolt']);
});

test('지속 피해는 dot 출처로 분리하고 소환수 피격은 제외하며 분열체는 참가자에게 귀속한다', () => {
  const r = runtime(), b = r.battle(), [a, e] = b.fighters;
  b.phase = 'fight';
  r.dealDamage(b, a, e, 1, { kind: 'auto', autoType: 'bleed' });
  r.dealDamage(b, a, e, 0.25, { kind: 'auto', autoType: 'flame' });
  assert.deepEqual(hits(b).map(e => e.source), ['dot:bleed', 'dot:flame']);
  b.spawnSummon(e); r.weaponDamage(b, a, e.summons[0], 3);
  assert.equal(hits(b).length, 2);
  b.spawnSplits(a); b.spawnSplits(e);
  r.weaponDamage(b, a.splitBalls[0], e.splitBalls[0], 2);
  assert.equal(hits(b).at(-1).actor, a.uid);
  assert.equal(hits(b).at(-1).target, e.uid);
});

test('보조 공격 투사체와 검기는 장착 무기 평타와 구분된다', () => {
  const r = runtime(), b = r.battle(), [a, e] = b.fighters;
  b.phase = 'fight';
  for (const kind of ['missile', 'shuriken', 'beam']) {
    const p = r.spawnProj(b, a, { kind, x: 0, y: 0, ang: 0, r: 5, dmg: 1, weapon: kind === 'beam' });
    r.projectileHit(b, p, e);
  }
  assert.deepEqual(hits(b).map(e => e.source), ['augment:missile', 'augment:shuriken', 'augment:swordBeam']);
});

test('이벤트는 전투당 독립 순번·96개·2초 범위이며 난수·엔티티 UID를 소비하지 않는다', () => {
  const r = runtime(), b = r.battle(), [a, e] = b.fighters;
  const proj = () => r.spawnProj(b, a, { kind: 'test', x: 0, y: 0, ang: 0, r: 1 });
  const before = proj(), calls = r.randomCalls();
  for (let i = 0; i < 140; i++) r.battleCommentary(b, 'hit', a, e, 'weapon:sword', 1);
  assert.equal(r.randomCalls(), calls);
  assert.equal(proj().uid, before.uid + 1);
  assert.equal(b.commentaryEvents.length, 96);
  assert.equal(b.commentaryEvents[0].seq, 45);
  b.simT = 2.01; r.pruneBattleCommentary(b);
  assert.equal(b.commentaryEvents.length, 0);
  r.battleCommentary(b, 'skill', a, null, 'char:cat');
  assert.equal(b.commentaryEvents[0].seq, 141);
  const other = r.battle(); r.battleCommentary(other, 'skill', other.fighters[0], null, 'char:cat');
  assert.equal(other.commentaryEvents[0].seq, 1);
});

test('타이틀 demo는 해설 기록을 만들지 않는다', () => {
  const r = runtime(), b = r.battle({}, {}, { demo: true }), [a, e] = b.fighters;
  b.phase = 'fight'; r.useSkill(b, a, 'char'); r.weaponDamage(b, a, e, 1);
  assert.equal(b.commentaryEvents.length, 0);
  assert.equal(b.commentarySeq, 0);
});

test('이벤트가 스냅샷·보간·전투 뷰를 통과하며 구형 서버도 호환된다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow', streak: 3 }), [a, e] = b.fighters;
  const previous = snapshot(b);
  b.phase = 'fight'; b.simT = 0.2;
  r.weaponDamage(b, a, e, 12);
  const current = json(snapshot(b));
  const interpolated = r.lerpSnapshot(previous, current, 0.5, 50);
  const view = r.netBattleView(interpolated, b.fighters.map(f => f.player), a.pid);
  assert.deepEqual(json(view.commentaryEvents), json(b.commentaryEvents));
  assert.equal(view.soundId, b.soundId);
  assert.equal(view.fighters.find(f => f.uid === view.commentaryEvents[0].actor).name, a.name);
  assert.equal(view.fighters.find(f => f.uid === a.uid).player.streak, 3,
    '서버가 공개한 연승 기록을 온라인 해설까지 전달한다');
  delete current.ce;
  assert.equal(r.netBattleView(current, [], 0).commentaryEvents, undefined);
  assert.equal(r.netBattleView(current, [], 0).fighters[0].player.streak, 0,
    '구형 서버나 없는 선수 메타데이터에 연승을 만들어 넣지 않는다');
});

/* 해설이 쓰는 새 사실들: 막아냄 · 벽 활용 · 스쳐 간 투사체 · 생존 증강 발동 */
const kinds = (b, type) => Array.from(b.commentaryEvents).filter(e => e.type === type);

test('막아낸 직접 공격은 guard로 알리고, 지속 피해나 뚫고 들어간 공격은 막은 것이 아니다', () => {
  const r = runtime(), b = r.battle(), [a, e] = b.fighters;
  b.phase = 'fight';
  e.timers.immune = 1;
  r.weaponDamage(b, a, e, 12);
  r.dealDamage(b, a, e, 3, { kind: 'auto', autoType: 'flame' });
  assert.deepEqual(kinds(b, 'guard').map(g => [g.actor, g.target, g.source]), [[e.uid, a.uid, 'weapon:sword']]);
  e.timers.immune = 0; e.shield = 50;
  r.weaponDamage(b, a, e, 12);
  assert.equal(kinds(b, 'guard').length, 2, '보호막이 통째로 막았다');
  e.shield = 2; r.weaponDamage(b, a, e, 12);
  assert.equal(kinds(b, 'guard').length, 2, '뚫고 들어간 공격은 막은 게 아니다');
  assert.equal(hits(b).length, 1);
});

test('벽에 튕긴 직후의 공격과 벽에 튕긴 투사체의 적중만 벽 활용으로 알린다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow' }), [a, e] = b.fighters;
  b.phase = 'fight'; b.simT = 5;
  r.weaponDamage(b, a, e, 2);
  assert.equal(kinds(b, 'wall-hit').length, 0, '벽과 상관없는 공격');
  r.onWallBounce(b, a, 1);
  b.simT = 5.4; r.weaponDamage(b, a, e, 2);
  assert.equal(kinds(b, 'wall-hit').length, 1);
  assert.equal(kinds(b, 'wall-hit')[0].actor, a.uid);
  b.simT = 6.2; r.weaponDamage(b, a, e, 2);
  assert.equal(kinds(b, 'wall-hit').length, 1, '0.6초가 지나면 벽 덕이 아니다');
  // 투사체는 쏜 사람이 아니라 투사체가 벽에 튕겼는지를 본다
  r.onWallBounce(b, a, 1);
  const straight = r.spawnProj(b, a, { kind: 'arrow', x: 0, y: 0, ang: 0, r: 4, dmg: 2, spd: 600, weapon: true });
  r.projectileHit(b, straight, e);
  assert.equal(kinds(b, 'wall-hit').length, 1, '쏜 사람이 방금 튕겼어도 곧게 날아간 화살은 아니다');
  const banked = r.spawnProj(b, a, { kind: 'arrow', x: 0, y: 0, ang: 0, r: 4, dmg: 2, spd: 600, weapon: true });
  banked.reflected = true;
  r.projectileHit(b, banked, e);
  assert.equal(kinds(b, 'wall-hit').length, 2);
  // 실제로 벽에 튕기면 표시가 붙는다
  const bounce = r.spawnProj(b, a, { kind: 'arrow', x: b.arena.R - 3, y: 0, ang: 0, r: 4, dmg: 2, spd: 600, weapon: true, bounces: 1 });
  a.x = -150; a.y = 0; e.x = -150; e.y = 120;
  for (let i = 0; i < 6 && !bounce.reflected; i++) b.updateProjectiles(1 / 60);
  assert.equal(bounce.reflected, true);
});

test('무기 투사체가 몸 가까이 왔다가 안 맞고 사라지면 dodge, 맞은 상대에게는 없다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow' }), [a, e] = b.fighters;
  b.phase = 'fight';
  a.x = -250; a.y = 0; e.x = 0; e.y = 0;
  const shoot = y => r.spawnProj(b, a, { kind: 'arrow', x: -80, y, ang: 0, r: 4, dmg: 2, spd: 600, weapon: true, life: .3 });
  const fly = p => { for (let i = 0; i < 120 && b.projectiles.includes(p); i++) b.updateProjectiles(1 / 60); };
  const near = shoot(e.radius + 4 + 8); fly(near);
  assert.equal(b.projectiles.includes(near), false);
  assert.deepEqual(kinds(b, 'dodge').map(x => [x.actor, x.target, x.source]), [[e.uid, a.uid, 'weapon:bow']]);
  fly(shoot(e.radius + 4 + 40));
  assert.equal(kinds(b, 'dodge').length, 1, '멀리 지나간 화살은 피한 게 아니다');
  const hp = e.hp; fly(shoot(0));
  assert.ok(e.hp < hp, '곧게 쏜 화살은 맞았다');
  assert.equal(kinds(b, 'dodge').length, 1, '맞은 상대에게는 피했다고 하지 않는다');
});

test('마지막 저항·최후의 3초·분열 발동을 해설에 알린다', () => {
  const r = runtime();
  for (const [flag, type, source] of [['lastResistance', 'last-stand', 'augment:lastResistance'],
    ['lastStand', 'last-stand', 'augment:lastStand'], ['split', 'split', 'augment:split']]) {
    const b = r.battle(), [a, e] = b.fighters;
    b.phase = 'fight';
    e.flags[flag] = 1;
    r.dealDamage(b, a, e, e.hp + 50, { kind: 'weapon' });
    assert.deepEqual(kinds(b, type).map(x => [x.actor, x.source]), [[e.uid, source]], flag);
  }
});
