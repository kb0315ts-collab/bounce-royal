'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { snapshot } = require('../server/snapshot.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// 시뮬레이션과 실제 렌더 진입 함수를 함께 실행한다. Phaser는 화면 생성만
// 대체하고 오디오 판단/스냅샷 복원 코드는 제품 코드 그대로 사용한다.
function runtime() {
  const played = [];
  let randomCalls = 0, seed = 412;
  const math = Object.create(Math);
  math.random = () => { randomCalls++; seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const sandbox = {
    console, Math: math, performance, Map, Set,
    document: { getElementById: () => ({ clientWidth: 720, clientHeight: 914 }) },
    Phaser: { Scene: class {}, Game: class {}, Scale: {}, WEBGL: 2 },
    SFX: {
      play: id => played.push(id),
      hit: () => played.push('legacy.hit'), boom: () => played.push('legacy.boom'),
      bounce: () => played.push('legacy.bounce'), skill: () => played.push('legacy.skill'),
      slash: kind => played.push('legacy.slash.' + kind), fire: kind => played.push('legacy.fire.' + kind),
    },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const names = ['Battle', 'battleSound', 'pruneBattleSounds', 'renderBattle', 'Net', 'netBattleView',
    'useSkill', 'releaseCharge', 'updateTimers', 'updateWeapon', 'onWallBounce', 'spawnProj',
    'projectileHit', 'meleeHits', 'autoSystems', 'fireBow', 'fireGun', 'fireStaff', 'fireShotgun', 'dealDamage',
    'healFighter', 'explodeMine', 'setFlameInput', 'updateFlame', 'throwDisc', 'updateDisc',
    'ensureChainHeads', 'updateChain'];
  vm.runInContext(['js/data.js', 'js/sim.js', 'js/render.js', 'js/net.js'].map(read).join('\n')
    + '\nglobalThis.api = { ' + names.join(', ') + ' };', ctx);
  let playerId = 0;
  const player = opts => Object.assign({
    id: ++playerId, name: '오디오 검사', isAI: false, color: '#4da6ff',
    charId: 'cat', weaponId: 'sword', coins: 5, coinsLost: 0, augments: [],
    augmentBaselines: {}, copiedSkill: null, gamble: false, trollCondition: false,
    damageRewardMult: 1, wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
  }, opts);
  const battle = (a = {}, b = {}, opts = {}) => new ctx.api.Battle('circle', [player(a), player(b)], opts);
  return { ...ctx.api, played, battle, randomCalls: () => randomCalls };
}
const ids = b => Array.from(b.soundEvents, e => e.id);

test('배경에서 계산하는 전투는 무음이고 보이는 전투만 이벤트를 한 번 소비한다', () => {
  const r = runtime(), a = r.battle(), b = r.battle();
  r.renderBattle(a);
  a.phase = b.phase = 'fight';
  r.fireBow(a, a.fighters[0]); r.fireStaff(b, b.fighters[0]);
  assert.deepEqual(r.played, []);
  r.renderBattle(a); r.renderBattle(a);
  assert.deepEqual(r.played, ['weapon.bow.fire']);
  assert.ok(ids(b).includes('weapon.staff.fire'));
});

test('count부터 본 로켓과 첫 발은 유실되지 않으며 꼬마볼은 소환음 없이 등장한다', () => {
  const r = runtime(), b = r.battle({ augments: ['rocketStart', 'miniBall'] });
  // 목록 ID와 별개로 현재 적용된 전투 상태를 확인해 발동시킨다.
  b.fighters[0].rocketActive = true;
  if (!b.fighters[0].summons.length) b.spawnSummon(b.fighters[0]);
  r.renderBattle(b);
  b.update(3.1);
  r.fireBow(b, b.fighters[0]);
  r.renderBattle(b);
  assert.equal(r.played.filter(id => id === 'augment.rocket').length, 1);
  assert.equal(r.played.filter(id => id === 'augment.summon').length, 0);
  assert.ok(b.fighters[0].summons.length > 0);
  b.spawnSummon(b.fighters[0]);
  assert.ok(!ids(b).includes('augment.summon'),'전투 중 추가 소환도 무음');
  assert.equal(r.played.filter(id => id === 'weapon.bow.fire').length, 1);
});

test('스냅샷 사이에 사라진 투사체도 발사음이 남고 온라인 렌더에서 한 번 재생된다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow' });
  r.renderBattle(r.netBattleView(snapshot(b), [], 0));
  b.phase = 'fight'; b.simT = 0.2;
  r.fireBow(b, b.fighters[0]);
  b.projectiles.length = 0;
  const snap = snapshot(b);
  assert.equal(snap.pr.length, 0);
  assert.equal(snap.se[0].id, 'weapon.bow.fire');
  assert.equal(snap.sd, b.soundId);
  r.Net.clearFx(); r.Net.buffer.length = 0; r.Net.lastSeq = 0;
  r.Net.pushSnapshot(snap, 1);
  assert.deepEqual(r.played, [], '수신은 소리를 내지 않는다');
  r.renderBattle(r.netBattleView(snap, [], 0));
  r.renderBattle(r.netBattleView(JSON.parse(JSON.stringify(snap)), [], 0));
  assert.deepEqual(r.played, ['weapon.bow.fire']);
});

test('신규 오디오 스냅샷은 기존 숫자·폭발·누적횟수 소리와 겹치지 않는다', () => {
  const r = runtime(), b = r.battle();
  const a = snapshot(b), s = snapshot(b);
  r.Net.clearFx(); r.Net.lastSeq = 0;
  r.Net.pushSnapshot(a, 1);
  s.f[0].bc = 2; s.f[0].sc = 1; s.f[0].ml = 1;
  s.px = [{ u: 912, x: 0, y: 0, s: '20', c: '#fff', b: 0 }];
  s.fx = [{ u: 913, k: 'r', x: 0, y: 0, a: 5, b: 60, c: '#fff', d: 0.3, m: 1 }];
  r.Net.pushSnapshot(s, 2);
  assert.deepEqual(r.played, []);
  assert.equal(r.Net.localPopups.length, 1, '화면 타격 연출은 유지한다');
  assert.equal(r.Net.localFx.length, 1);
});

test('관전 전환은 과거음을 건너뛰고 이후 사건만 재생하며 늦은 패킷은 되감지 않는다', () => {
  const r = runtime(), a = r.battle(), b = r.battle();
  a.phase = b.phase = 'fight'; a.simT = b.simT = 5;
  r.fireBow(a, a.fighters[0]); r.fireStaff(b, b.fighters[0]);
  r.renderBattle(r.netBattleView(snapshot(a), [], 0));
  r.renderBattle(r.netBattleView(snapshot(b), [], 0));
  assert.deepEqual(r.played, []);
  const old = snapshot(b);
  b.simT = 5.1; r.fireStaff(b, b.fighters[0]);
  const current = snapshot(b);
  r.renderBattle(r.netBattleView(current, [], 0));
  r.renderBattle(r.netBattleView(old, [], 0));
  r.renderBattle(r.netBattleView(current, [], 0));
  assert.deepEqual(r.played, ['weapon.staff.fire']);
  r.Net.buffer.length = 0; r.Net.lastSeq = 0;
  r.Net.pushSnapshot(current, 2); r.Net.pushSnapshot(old, 1);
  assert.equal(r.Net.buffer.length, 1);
  assert.equal(r.Net.buffer[0].snap, current);
});

test('중복 seq와 오래된 사건은 재생하지 않고 다음 새 사건은 재생한다', () => {
  const r = runtime(), b = r.battle();
  r.renderBattle(b); b.phase = 'fight'; b.simT = 0.1;
  r.fireBow(b, b.fighters[0]);
  b.soundEvents.push({ ...b.soundEvents[0] });
  r.renderBattle(b);
  b.simT = 0.2; r.fireStaff(b, b.fighters[0]);
  b.simT = 1; r.renderBattle(b);
  r.fireGun(b, b.fighters[0]); r.renderBattle(b);
  assert.deepEqual(r.played, ['weapon.bow.fire', 'weapon.pistol.fire']);
});

test('이벤트는 96개·1.2초 범위를 지키며 난수나 게임 UID를 소비하지 않는다', () => {
  const r = runtime(), b = r.battle(), f = b.fighters[0];
  const proj = () => r.spawnProj(b, f, { kind: 'test', x: 0, y: 0, ang: 0, r: 1 });
  const before = proj(), randomCount = r.randomCalls();
  for (let i = 0; i < 140; i++) r.battleSound(b, 'battle.hit', f);
  assert.equal(r.randomCalls(), randomCount);
  const after = proj();
  assert.equal(after.uid, before.uid + 1);
  assert.equal(b.soundEvents.length, 96);
  assert.equal(b.soundEvents[0].seq, 45);
  assert.equal(b.soundEvents[95].seq, 140);
  b.simT = 1.21; r.pruneBattleSounds(b);
  assert.equal(b.soundEvents.length, 0);
  r.battleSound(b, 'battle.hit', f);
  assert.equal(b.soundEvents[0].seq, 141);
});

test('타이틀 demo는 이벤트도 재생도 만들지 않는다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow' }, {}, { demo: true });
  b.phase = 'fight';
  r.fireBow(b, b.fighters[0]); r.useSkill(b, b.fighters[0], 'char');
  r.renderBattle(b);
  assert.equal(b.soundEvents.length, 0);
  assert.deepEqual(r.played, []);
});

test('활 차지는 시작·수동 발사·자동 발사 순간이 구분되고 실패 입력은 무음이다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow' }), f = b.fighters[0];
  b.phase = 'fight';
  assert.equal(r.useSkill(b, f, 'weapon'), true);
  assert.deepEqual(ids(b), ['skill.bow.charge']);
  assert.equal(r.useSkill(b, f, 'weapon'), false);
  assert.deepEqual(ids(b), ['skill.bow.charge']);
  r.updateTimers(b, f, 0.21);
  assert.equal(r.useSkill(b, f, 'weapon'), true);
  assert.deepEqual(ids(b), ['skill.bow.charge', 'skill.bow.release']);
  const auto = r.battle({ weaponId: 'bow' }), g = auto.fighters[0]; auto.phase = 'fight';
  r.useSkill(auto, g, 'weapon'); g.charging.t = 4; g.charging.spin = Math.PI * 4;
  r.updateWeapon(auto, g, 0);
  assert.equal(ids(auto).filter(id => id === 'skill.bow.release').length, 1);
});

test('단검 준비·농구 추적·폭탄 점화는 실제 돌진·폭발 시점과 다른 큐다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'dagger', charId: 'bball' }), f = b.fighters[0];
  b.phase = 'fight';
  r.useSkill(b, f, 'weapon');
  assert.deepEqual(ids(b), ['skill.dagger.prepare']);
  r.updateTimers(b, f, 0.99);
  assert.ok(!ids(b).includes('skill.dagger.dash'));
  r.updateTimers(b, f, 0.02);
  assert.equal(ids(b).filter(id => id === 'skill.dagger.dash').length, 1);
  r.updateTimers(b, f, 0.01);
  assert.equal(ids(b).filter(id => id === 'skill.dagger.dash').length, 1);
  r.useSkill(b, f, 'char');
  r.onWallBounce(b, f, 2);
  assert.ok(!ids(b).includes('skill.basketball.rush'));
  r.onWallBounce(b, f, 1);
  assert.equal(ids(b).filter(id => id === 'skill.basketball.rush').length, 1);
  const bomb = r.battle({ charId: 'bomb' }), g = bomb.fighters[0]; bomb.phase = 'fight';
  r.useSkill(bomb, g, 'char');
  assert.deepEqual(ids(bomb), ['skill.bomb.arm']);
  r.updateTimers(bomb, g, 0.99);
  assert.ok(!ids(bomb).includes('skill.bomb.explode'));
  r.updateTimers(bomb, g, 0.02);
  assert.equal(ids(bomb).filter(id => id === 'skill.bomb.explode').length, 1);
});

test('검기는 칼날 접촉음과 별개이며 샷건·다중 투사체는 일제사격 한 번이다', () => {
  const r = runtime(), b = r.battle(), f = b.fighters[0], e = b.fighters[1];
  b.phase = 'fight'; f.x = 0; f.y = 0; f.weaponAngle = 0; e.x = 60; e.y = 0; e.hp = 1000;
  const beam = r.spawnProj(b, f, { kind: 'beam', x: 0, y: 0, ang: 0, r: 12, dmg: 15, weapon: true });
  r.projectileHit(b, beam, e);
  assert.ok(ids(b).includes('augment.beam'));
  assert.ok(!ids(b).includes('weapon.sword.hit'));
  r.meleeHits(b, f, 0.01);
  assert.equal(ids(b).filter(id => id === 'weapon.sword.hit').length, 1);
  r.meleeHits(b, f, 0.01);
  assert.equal(ids(b).filter(id => id === 'weapon.sword.hit').length, 1);
  r.fireShotgun(b, f, 5);
  assert.equal(ids(b).filter(id => id === 'weapon.shotgun.fire').length, 1);
  assert.ok(!ids(b).includes('weapon.pistol.fire'));
  f.flags.triple = true; r.fireBow(b, f);
  assert.equal(ids(b).filter(id => id === 'weapon.bow.fire').length, 1);
});

test('화염은 점화음 없이 생성되고 팽창·폭주의 종료음은 한 번만 난다', () => {
  const r = runtime(), b = r.battle({ charId: 'balloon' }), f = b.fighters[0];
  b.phase = 'fight'; f.flags.flame = 1; f.cd.flame = 0;
  for (let i = 0; i < 5; i++) { b.simT = i * 0.18; r.autoSystems(b, f, 0.18); }
  assert.equal(b.flames.length, 5);
  assert.equal(ids(b).filter(id => id === 'augment.flame').length, 0);
  r.useSkill(b, f, 'char'); r.updateTimers(b, f, 5.01); r.updateTimers(b, f, 0.1);
  assert.equal(ids(b).filter(id => id === 'skill.balloon.deflate').length, 1);
  const wak = r.battle({ charId: 'wak' }), w = wak.fighters[0]; wak.phase = 'fight';
  r.useSkill(wak, w, 'char'); r.updateTimers(wak, w, 5.01); r.updateTimers(wak, w, 0.1);
  assert.equal(ids(wak).filter(id => id === 'skill.rampage.end').length, 1);
});

test('치료음은 유지하고 빙결지뢰·무기강탈은 전용 소리 없이 효과가 적용된다', () => {
  const r = runtime(), b = r.battle(), f = b.fighters[0], e = b.fighters[1];
  b.phase = 'fight';
  r.healFighter(b, f, 5);
  assert.equal(ids(b).length, 0, '최대 체력에서는 치료음이 없다');
  f.hp -= 20; r.healFighter(b, f, 5); r.healFighter(b, f, 5);
  assert.equal(ids(b).filter(id => id === 'augment.heal').length, 1);
  b.simT = 0.8; r.healFighter(b, f, 5);
  assert.equal(ids(b).filter(id => id === 'augment.heal').length, 2);
  f.flags.freezeMine = 1;
  const mine = { owner:f, x:e.x, y:e.y, blast:62, dmg:1 };
  r.explodeMine(b, mine); r.explodeMine(b, mine);
  assert.equal(ids(b).filter(id => id === 'augment.freeze' || id === 'augment.frost').length, 0);
  assert.equal(e.timers.freeze, 2);
  assert.equal(ids(b).filter(id => id === 'weapon.mine.explode').length, 2,'일반 지뢰 폭발음은 유지');
  f.flags.steal = 1;
  const orb = r.spawnProj(b, f, { kind:'orb', x:e.x, y:e.y, r:9, ang:0, dmg:1, weapon:true });
  r.projectileHit(b, orb, e); r.projectileHit(b, orb, e);
  assert.equal(ids(b).filter(id => id === 'augment.steal').length, 0);
  assert.equal(e.timers.weaponLock, 1);
  f.flags.frost = 1;
  r.projectileHit(b, orb, e);
  assert.equal(ids(b).filter(id => id === 'augment.frost').length, 1,'별개의 냉기 적중음은 유지');
});

test('회전 난사는 실제 발사한 탄환만 전용 발사음으로 연결하고 종료 후 평타음으로 돌아간다', () => {
  const r=runtime(),b=r.battle({weaponId:'pistol'}),f=b.fighters[0];
  r.renderBattle(b);b.phase='fight';
  assert.equal(r.useSkill(b,f,'weapon'),true);
  assert.deepEqual(ids(b),['skill.pistol.barrage']);
  r.updateWeapon(b,f,.25);
  const shots=b.projectiles.filter(p=>p.kind==='bullet').length;
  assert.ok(shots>=2);
  assert.equal(ids(b).filter(id=>id==='weapon.pistol.barrage-shot').length,shots);
  assert.equal(ids(b).filter(id=>id==='weapon.pistol.fire').length,0);
  r.renderBattle(r.netBattleView(snapshot(b),[],0));
  assert.equal(r.played.filter(id=>id==='weapon.pistol.barrage-shot').length,shots);
  f.timers.gunBarrage=0;r.fireGun(b,f);
  assert.equal(ids(b).filter(id=>id==='weapon.pistol.fire').length,1);
});

test('화염방사 점화는 실제 분사 전이에만 나고 유지·기절·연료 고갈 중에는 반복하지 않는다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'flame' }), f = b.fighters[0];
  b.phase = 'fight'; f.x = 0; f.y = 0; f.vx = 1; f.vy = 0;
  b.fighters[1].x = -300; b.fighters[1].y = 150;
  const tick = t => { b.simT = t; r.updateFlame(b, f, .01); };
  const count = id => ids(b).filter(x => x === id).length;
  r.setFlameInput(f, true); f.timers.stun = 1;
  tick(0);
  assert.equal(count('weapon.flame.ignite'), 0, '차단된 버튼 입력은 점화 아님');
  assert.equal(count('weapon.flame.spray'), 0);
  f.timers.stun = 0; tick(.05);
  assert.equal(count('weapon.flame.ignite'), 1);
  assert.equal(count('weapon.flame.spray'), 1);
  for (let i = 1; i <= 20; i++) tick(.05 + i * .01);
  assert.equal(count('weapon.flame.ignite'), 1, '꾹 누르는 매 틱마다 점화하지 않음');
  f.timers.weaponLock = 1; tick(.30);
  assert.equal(f.flame.firing, false);
  const stoppedCount = b.soundEvents.length;
  tick(.40);
  assert.equal(b.soundEvents.length, stoppedCount, '무기 봉쇄 동안 분사음도 없음');
  f.timers.weaponLock = 0; tick(.60);
  assert.equal(count('weapon.flame.ignite'), 2, '실제 분사가 재개되면 새 점화');
  r.setFlameInput(f, false); tick(.62);
  f.flame.fuel = 0; f.flame.idle = 0; r.setFlameInput(f, true); tick(.90);
  assert.equal(f.flame.firing, false);
  assert.equal(count('weapon.flame.ignite'), 2, '연료 없는 누르기는 무음');
  f.flame.fuel = 10; tick(1);
  assert.equal(count('weapon.flame.ignite'), 3);
  assert.ok(snapshot(b).se.some(e => e.id === 'weapon.flame.ignite'), '온라인에서도 같은 사건 전달');
});

test('방패는 든 채 적중·실제 원판 벽 반사·회수를 각각 다른 큐로 전달한다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'shield' }), f = b.fighters[0], e = b.fighters[1];
  b.phase = 'fight'; f.x = 0; f.y = 0; f.weaponAngle = 0;
  e.x = 60; e.y = 0; e.hp = e.maxHp = 1000;
  r.meleeHits(b, f, .01); r.meleeHits(b, f, .01);
  assert.equal(ids(b).filter(id => id === 'weapon.shield.hit').length, 1, '지속 접촉은 한 타격');
  assert.ok(!ids(b).includes('weapon.sword.hit') && !ids(b).includes('weapon.dagger.hit'));
  e.x = -280; e.y = 140;
  assert.equal(r.throwDisc(b, f), true);
  const d = f.disc;
  d.x = b.arena.R - d.r - 1; d.y = 0; d.vx = 1; d.vy = 0;
  b.simT = .1; r.updateDisc(b, f, .01);
  assert.equal(d.bounces, 1); assert.ok(d.vx < 0);
  assert.equal(ids(b).filter(id => id === 'weapon.shield.bounce').length, 1);
  b.simT = .12; r.updateDisc(b, f, .01);
  assert.equal(ids(b).filter(id => id === 'weapon.shield.bounce').length, 1, '벽에서 떨어진 다음 틱에는 반사음 없음');
  d.armed = true; d.resting = true; d.x = f.x; d.y = f.y;
  b.simT = .2; r.updateDisc(b, f, .01); r.updateDisc(b, f, .01);
  assert.equal(f.disc, null);
  assert.equal(ids(b).filter(id => id === 'weapon.shield.catch').length, 1);
  assert.deepEqual(Array.from(snapshot(b).se.filter(x => x.id.startsWith('weapon.shield.')), x => x.id),
    ['weapon.shield.hit', 'weapon.shield.throw', 'weapon.shield.bounce', 'weapon.shield.catch']);
});

test('쇠사슬은 아무리 빨리 휘둘러도 휘두름 소리를 내지 않는다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'chain' }), f = b.fighters[0];
  b.phase = 'fight'; f.x = 0; f.y = 0; f.vx = 0; f.vy = 0; f.weaponAngle = 0;
  b.fighters[1].x = -300; b.fighters[1].y = 150;
  f._chainAnchor = { x: 0, y: 0 }; r.ensureChainHeads(f);
  for (let i = 0; i < 8; i++) { b.simT = i / 60; r.updateChain(b, f, 1 / 60); }
  assert.ok(!ids(b).includes('weapon.chain.swing'), '매달려 있는 추에는 상시 휘두름 소리 없음');
  // Identical free tangential momentum for each fixture, with the real rope
  // integrator producing displacement. No manual sound events or fake speeds.
  const swingAt = t => {
    f.chainHeads = []; f.weaponAngle = 0; f._chainAnchor = { x: f.x, y: f.y };
    r.ensureChainHeads(f);
    for (const h of f.chainHeads) for (const q of h.nodes.concat(h)) { q.vx = 0; q.vy = 600; }
    b.simT = t; r.updateChain(b, f, 1 / 60);
    assert.ok(f.chainHeads.some(h => Math.hypot(h.sx, h.sy) > 150), '실제로 빠르게 움직이는 추');
  };
  const count = () => ids(b).filter(id => id === 'weapon.chain.swing').length;
  for (const t of [.20, .21, .57, .59, .99, 1.10, 1.20]) swingAt(t);
  assert.equal(count(), 0, '빠르게 휘둘러도 휙휙 소리는 없다 — 맞을 때만 소리 난다');
});

test('모든 전투 이벤트 ID가 공용 효과음 카탈로그의 실제 재생 항목과 대응한다', () => {
  const { catalog } = require('../js/audio.js');
  const known = new Set(catalog.map(item => item.id));
  const referenced = new Set(Array.from(read('js/sim.js').matchAll(/['"]((?:weapon|skill|augment|battle)\.[a-z.-]+)['"]/g), m => m[1]));
  assert.ok(referenced.size >= 45, '주요 전투 효과가 모두 전용 큐로 연결되어야 한다');
  assert.deepEqual([...referenced].filter(id => !known.has(id)), []);
});
