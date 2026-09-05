'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = [
  fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'js', 'sim.js'), 'utf8'),
  `
const assert = __assert;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('✓ ' + name);
  } catch (err) {
    console.error('✗ ' + name);
    throw err;
  }
}

function makePlayer(overrides = {}) {
  return Object.assign({
    id: ++__playerId, name: '테스터', isAI: false, color: '#4da6ff',
    charId: 'cat', weaponId: 'sword', coins: 5, coinsLost: 0,
    augments: [], augmentBaselines: {}, copiedSkill: null, gamble: false,
    trollCondition: false, damageRewardMult: 1,
    wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
  }, overrides);
}

function makeBattle(a = {}, c = {}) {
  const b = new Battle('square', [makePlayer(a), makePlayer(Object.assign({ isAI: true, color: '#ff6b6b' }, c))]);
  b.phase = 'fight';
  b.simT = 0;
  return b;
}

test('캐릭터와 무기의 기본 밸런스 수치가 기획값과 일치한다', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CHARACTERS).map(([id, c]) => [id, [c.hp, c.move, c.size]])), {
    cat: [100, 172, 1], wak: [100, 166, 1], soft: [100, 156, 1.05],
    bomb: [100, 160, 0.95], bball: [100, 165, 1], balloon: [100, 162, 1.12],
  });
  assert.deepEqual(
    [WEAPONS.sword.dmg, WEAPONS.sword.reach, WEAPONS.sword.rot],
    [20, 60, 3],
  );
  assert.deepEqual(
    [WEAPONS.dagger.dmg, WEAPONS.dagger.reach, WEAPONS.dagger.rot],
    [18, 30, 5],
  );
  assert.deepEqual([WEAPONS.bow.dmg, WEAPONS.bow.interval, WEAPONS.bow.projSpeed], [8, 1.5, 300]);
  assert.deepEqual([WEAPONS.pistol.dmg, WEAPONS.pistol.burst, WEAPONS.pistol.shotGap, WEAPONS.pistol.reload], [3, 7, 0.12, 3]);
  assert.deepEqual([WEAPONS.staff.dmg, WEAPONS.staff.interval], [15, 2.5]);
  assert.deepEqual([WEAPONS.mine.dmg, WEAPONS.mine.interval, WEAPONS.mine.maxMines], [10, 3, 5]);
});

test('정리된 기획 증강 104종이 중복 ID 없이 등록되고 삭제 항목은 풀에서 빠진다', () => {
  assert.equal(AUGMENTS.length, 104);
  assert.equal(new Set(AUGMENTS.map(a => a.id)).size, 104);
  for (const id of ['rampage20', 'seasonedExp', 'trollCondition', 'sleepGas',
    'berserker', 'desperateSpin', 'brink', 'autoExpert']) assert.ok(AUG_BY_ID[id], id);
  for (const id of ['motionSickness',
    'crit', 'lateFocus', 'slowStart', 'bloodThirst', 'coinHeal', 'phoenix', 'hastePact',
    'equalTrade', 'rotFreak', 'tank', 'berserkEngine', 'collisionGuard', 'cycler', 'pushAug', 'stickyTrail',
    'sacrifice', 'deathBoom', 'revengeSpeed', 'multiSystem', 'overHeal', 'rotPower', 'w_guard', 'powerReward']) {
    assert.equal(AUG_BY_ID[id], undefined, id + '는 삭제되어야 한다');
  }
});

test('기본 이동·회전 수치와 메인 공 벽 반사가 정상이다', () => {
  const b = makeBattle({ charId: 'cat', weaponId: 'sword' });
  const f = b.fighters[0];
  computeStats(f);
  assert.equal(f.st.move, CHARACTERS.cat.move * WEAPONS.sword.moveMult);
  assert.equal(f.st.rot, WEAPONS.sword.rot);
  f.x = b.arena.H - f.radius - 1; f.y = 0; f.vx = 1; f.vy = 0;
  moveFighter(b, f, 0.1);
  assert.ok(f.vx < 0, '벽에서 진행 방향이 반사되어야 한다');
  assert.ok(f.x <= b.arena.H - f.radius + 1e-9, '본체가 경기장 안에 있어야 한다');
});

test('투사체가 메인 공의 radius를 사용해 실제 피해를 준다', () => {
  const b = makeBattle({ weaponId: 'pistol' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  const before = e.hp;
  spawnProj(b, f, { kind: 'bullet', x: e.x, y: e.y, ang: 0, spd: 0, dmg: 5, r: 4, life: 1, weapon: true });
  b.updateProjectiles(1 / 60);
  assert.ok(e.hp < before);
  assert.equal(b.projectiles.length, 0);
});

test('활 차지 샷은 1초 충전 후 두 번째 입력에만 횟수를 소비한다', () => {
  const b = makeBattle({ weaponId: 'bow' });
  const f = b.fighters[0];
  assert.equal(useSkill(b, f, 'weapon'), true);
  assert.equal(f.skillUses.weapon, 1);
  updateTimers(b, f, 0.99);
  assert.equal(useSkill(b, f, 'weapon'), false);
  assert.equal(f.skillUses.weapon, 1);
  updateTimers(b, f, 0.02);
  assert.equal(useSkill(b, f, 'weapon'), true);
  assert.equal(f.skillUses.weapon, 0);
  const charge = b.projectiles.find(p => p.kind === 'charge');
  assert.ok(charge);
  assert.equal(charge.dmg, 30);
  assert.equal(charge.pierce, true);
  assert.equal(charge.pierceObstacles, true);
  const obstacleArena = new Arena('obstacle');
  charge.x = obstacleArena.pillars[0].x;
  charge.y = obstacleArena.pillars[0].y;
  charge.vx = 1; charge.vy = 0;
  assert.equal(obstacleArena.reflectProj(charge), false, '차지 샷은 내부 장애물을 관통해야 한다');
});

test('시한폭발과 최후의 3초가 정확한 만료 전환에서 한 번 발동한다', () => {
  const b = makeBattle({ charId: 'bomb', augments: ['lastStand'] });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  e.x = f.x; e.y = f.y;
  const before = e.hp;
  assert.equal(useSkill(b, f, 'char'), true);
  updateTimers(b, f, 0.99);
  assert.equal(e.hp, before);
  updateTimers(b, f, 0.02);
  assert.ok(e.hp < before);
  dealDamage(b, e, f, f.maxHp * 10, { kind: 'weapon' });
  assert.equal(f.dead, false);
  assert.ok(f.timers.actingDead > 0);
  updateTimers(b, f, 2.99);
  assert.equal(f.dead, false);
  updateTimers(b, f, 0.02);
  assert.equal(f.dead, true);
});

test('권총 회전 난사는 1.5초간 돌면서 재장전 없이 난사한다', () => {
  const b = makeBattle({ weaponId: 'pistol' });
  const f = b.fighters[0];
  assert.equal(useSkill(b, f, 'weapon'), true);
  let guard = 0, turned = 0;
  while (f.timers.gunBarrage > 0 && guard++ < 300) {
    computeStats(f);
    const before = f.weaponAngle;
    updateTimers(b, f, 1 / 60);
    updateWeapon(b, f, 1 / 60);
    let step = f.weaponAngle - before;
    while (step > Math.PI) step -= Math.PI * 2;
    while (step < -Math.PI) step += Math.PI * 2;
    turned += Math.abs(step);
  }
  assert.ok(guard >= 89 && guard <= 91, '약 1.5초간 유지되어야 한다 (실제 ' + guard + '틱)');
  assert.ok(turned > Math.PI * 2 * 2.5,
    '난사 중 여러 바퀴 돌아야 한다 (실제 ' + (turned / (Math.PI * 2)).toFixed(1) + '바퀴)');
  const bullets = b.projectiles.filter(p => p.kind === 'bullet').length;
  assert.ok(bullets >= 10 && bullets <= 16, '재장전 없이 연속 발사해야 한다 (실제 ' + bullets + '발)');
});

test('출혈은 1초에 한 번, 그 시점의 중첩 수만큼 고정 피해를 준다', () => {
  const b = makeBattle({ weaponId: 'dagger', augments: ['d_bleed', 'atk15', 'dmg10'] });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  onWeaponHitEffects(b, f, e);
  const hp = e.hp;
  const fx = b.fx.length;
  updateTimers(b, e, 0.99);
  assert.equal(e.hp, hp, '첫 1초 전에는 출혈 피해가 없어야 한다');
  assert.equal(b.fx.length, fx, '매 프레임 피격 연출을 만들면 안 된다');
  updateTimers(b, e, 0.02);
  assert.ok(Math.abs(e.hp - (hp - 1)) < 1e-9, '공격력 A와 모든 피해 D를 제외하고 중첩당 고정 피해 1만 적용해야 한다');

  // 중첩을 쌓아도 초침은 그대로다. 다음 초에 늘어난 만큼 한 번에 들어간다.
  // 중첩마다 초침을 따로 돌리면 1 피해가 서로 어긋난 시점에 계속 흩뿌려진다.
  onWeaponHitEffects(b, f, e);
  const stackedHp = e.hp;
  updateTimers(b, e, 0.5);
  assert.equal(e.hp, stackedHp, '중첩을 쌓는 순간 즉시 피해가 들어가면 안 된다');
  updateTimers(b, e, 0.52);
  assert.ok(Math.abs(e.hp - (stackedHp - 2)) < 1e-9,
    '2중첩이면 다음 초에 2가 한 번에 들어가야 한다 (1이 두 번 어긋나게 들어오면 안 된다)');
  const twoHp = e.hp;
  onWeaponHitEffects(b, f, e);
  onWeaponHitEffects(b, f, e);
  updateTimers(b, e, 1.0);
  assert.ok(Math.abs(e.hp - (twoHp - 4)) < 1e-9, '4중첩이면 매초 4');

  const permanent = makeBattle({ weaponId: 'dagger', augments: ['d_bleed', 'dmg10'] });
  const [pf, pe] = permanent.fighters;
  computeStats(pf); computeStats(pe);
  pe.maxHp = pe.hp = 1000;
  for (let i = 0; i < 8; i++) onWeaponHitEffects(permanent, pf, pe);
  assert.equal(pe.bleed.n, 8, '출혈 중첩에는 상한이 없어야 한다');
  const permanentHp = pe.hp;
  updateTimers(permanent, pe, 3.99);
  assert.ok(Math.abs(pe.hp - (permanentHp - 8 * 3)) < 1e-9,
    '출혈은 3초가 지나도 사라지지 않아야 한다');
  updateTimers(permanent, pe, 0.02);
  assert.ok(Math.abs(pe.hp - (permanentHp - 8 * 4)) < 1e-9,
    '영구 중첩은 전투가 끝날 때까지 매초 피해를 계속 줘야 한다');
});

test('믹서기는 정확히 두 바퀴 돌며 검기 시너지를 두 번 발동한다', () => {
  const b = makeBattle({ weaponId: 'sword', augments: ['w_beam'] });
  const f = b.fighters[0];
  const start = f.weaponAngle;
  assert.equal(useSkill(b, f, 'weapon'), true);
  let guard = 0;
  while (f.spinRemaining > 0 && guard++ < 120) {
    computeStats(f);
    updateWeapon(b, f, 1 / 60);
  }
  assert.ok(guard >= 71 && guard <= 73, '두 바퀴는 약 1.2초여야 한다 (실제 ' + guard + '틱)');
  assert.ok(Math.abs(Math.atan2(Math.sin(f.weaponAngle - start), Math.cos(f.weaponAngle - start))) < 1e-9,
    '두 바퀴를 돌면 제자리로 돌아와야 한다');
  const beams = b.projectiles.filter(p => p.kind === 'beam');
  assert.equal(beams.length, 2, '한 바퀴마다 한 번씩 나가야 한다');
  assert.equal(beams[0].dmg, 15);
  assert.equal(beams[0].r, 12, '검기 판정이 좌우로 넓어져야 한다');
  assert.equal(beams[0].pierce, true);
});

test('마력 폭주는 3초간 기존·신규 마법 투사체 크기만 2배로 만든다', () => {
  const b = makeBattle({ weaponId: 'staff' });
  const f = b.fighters[0];
  const p = spawnProj(b, f, { kind: 'orb', x: 0, y: 0, ang: 0, spd: WEAPONS.staff.projSpeed, dmg: 1, r: 9, life: 5, bounces: 0, weapon: true });
  assert.equal(useSkill(b, f, 'weapon'), true);
  fireStaff(b, f);
  const fresh = b.projectiles.at(-1);
  b.updateProjectiles(0.1);
  assert.equal(p.r, 18);
  assert.equal(fresh.r, 18);
  assert.ok(Math.abs(p.x - WEAPONS.staff.projSpeed * 0.1) < 1e-9, '이동속도는 변하면 안 된다');
  updateTimers(b, f, 3.01);
  const x = p.x;
  b.updateProjectiles(0.01);
  assert.equal(p.r, 9);
  assert.equal(fresh.r, 9);
  assert.ok(Math.abs(p.x - x - WEAPONS.staff.projSpeed * 0.01) < 1e-9);
});

test('무기 스킬과 전용 증강의 지정 피해·크기 수치가 적용된다', () => {
  const giantBattle = makeBattle({ weaponId: 'sword', augments: ['w_giant'] });
  const [giant, giantTarget] = giantBattle.fighters;
  computeStats(giant); computeStats(giantTarget);
  assert.equal(weaponScale(giant), 1.5);
  assert.equal(giant.perm.atk, 1);
  assert.equal(giant.perm.move, WEAPONS.sword.moveMult);
  assert.equal(giant.perm.aspd, 1);
  assert.equal(weaponDamage(giantBattle, giant, giantTarget, WEAPONS.sword.dmg), 20);

  const dashBattle = makeBattle({ weaponId: 'dagger' });
  const [dasher, dashTarget] = dashBattle.fighters;
  computeStats(dasher); computeStats(dashTarget);
  dasher.dash = { kind: 'dash' }; dasher.timers.dashT = 1; dasher.dashHit = new Set();
  const beforeDash = dashTarget.hp;
  tryDashHit(dashBattle, dasher, dashTarget);
  assert.equal(beforeDash - dashTarget.hp, 40);

  const bayonetBattle = makeBattle({ weaponId: 'pistol', augments: ['p_bayonet'] });
  const [gunner, bayonetTarget] = bayonetBattle.fighters;
  computeStats(gunner); computeStats(bayonetTarget);
  gunner.x = gunner.y = 0; gunner.weaponAngle = 0; gunner.gun.reloadT = 1;
  bayonetTarget.x = 45; bayonetTarget.y = 0;
  const beforeBayonet = bayonetTarget.hp;
  updateWeapon(bayonetBattle, gunner, 1 / 60);
  assert.equal(beforeBayonet - bayonetTarget.hp, 15);

  const mineBattle = makeBattle({ weaponId: 'mine' });
  const [miner, mineTarget] = mineBattle.fighters;
  computeStats(miner); computeStats(mineTarget);
  miner.x = miner.y = 0; mineTarget.x = 90; mineTarget.y = 0;
  mineBattle.mines.push({ uid: ++UID, owner: miner, x: 0, y: 0, blast: 62, dmg: 10 });
  miner.timers.det = 0.01;
  const beforeMine = mineTarget.hp;
  updateTimers(mineBattle, miner, 0.02);
  assert.equal(beforeMine - mineTarget.hp, 18);
  assert.equal(mineBattle.mines.length, 0);

  const spreadBattle = makeBattle({ weaponId: 'bow', augments: ['b_triple'] });
  const archer = spreadBattle.fighters[0];
  fireBow(spreadBattle, archer);
  assert.equal(spreadBattle.projectiles.length, 3);
  assert.ok(spreadBattle.projectiles.every(p => p.dmg === WEAPONS.bow.dmg));
});

test('팽창은 권총탄·검기·지뢰의 외형과 판정을 함께 키운다', () => {
  const b = makeBattle({ charId: 'balloon', weaponId: 'pistol' });
  const f = b.fighters[0];
  useSkill(b, f, 'char');
  fireGun(b, f);
  assert.equal(b.projectiles.at(-1).r, 4 * 1.7);
  spawnProj(b, f, { kind: 'beam', x: 0, y: 0, ang: 0, spd: 1, dmg: 1, r: 6, life: 1, weapon: true });
  assert.equal(b.projectiles.at(-1).r, 6 * 1.7);

  const mb = makeBattle({ charId: 'balloon', weaponId: 'mine' });
  const mf = mb.fighters[0];
  useSkill(mb, mf, 'char');
  computeStats(mf); mf.cd.mine = 0;
  updateWeapon(mb, mf, 1 / 60);
  const mine = mb.mines[0];
  assert.ok(mine.r > 11);
  assert.equal(mine.trig, WEAPONS.mine.triggerR * 1.6);
  assert.equal(mine.blast, WEAPONS.mine.blastR * 1.6);
  assert.equal(mine.dmg, WEAPONS.mine.dmg);
});

test('핏빛 질주는 기존 연승을 포함하고 다른 성장 증강은 획득 후 기록만 센다', () => {
  const p = makePlayer({ wins: 3, losses: 2, streak: 3, rounds: 5, coinsLost: 2 });
  applyAugmentPick(p, AUG_BY_ID.winMomentum);
  applyAugmentPick(p, AUG_BY_ID.bloodRush);
  applyAugmentPick(p, AUG_BY_ID.seasonedExp);
  applyAugmentPick(p, AUG_BY_ID.fallenPower);
  let b = new Battle('square', [p, makePlayer({ isAI: true })]);
  let f = b.fighters[0];
  assert.ok(Math.abs(f.perm.atk - 1.18) < 1e-9, '기존 3연승을 즉시 포함해야 한다');
  assert.equal(f.perm.dmg, 1);
  p.wins++; p.streak++; p.rounds++; p.coinsLost++;
  b = new Battle('square', [p, makePlayer({ isAI: true })]);
  f = b.fighters[0];
  assert.ok(Math.abs(f.perm.atk - 1.04 * 1.24 * 1.03) < 1e-9);
  assert.equal(f.perm.dmg, 1.05);
  p.losses++; p.streak = 0;
  p.wins++; p.streak = 1;
  b = new Battle('square', [p, makePlayer({ isAI: true })]);
  f = b.fighters[0];
  assert.ok(Math.abs(f.perm.atk - 1.08 * 1.06 * 1.03) < 1e-9);
});

test('변경된 조건부 증강 수치와 코인 증강 상태가 정확히 적용된다', () => {
  const p = makePlayer({ coins: 2, augments: ['berserker', 'firstStrike', 'rampage20', 'brink'] });
  const b = new Battle('square', [p, makePlayer({ isAI: true })]);
  const f = b.fighters[0];
  f.hp = f.maxHp * 0.5; b.simT = 5; computeStats(f);
  assert.ok(Math.abs(f.st.atk - 1.25 * 1.3) < 1e-9, '체력 50%면 광전사 +25%, 첫 10초 선제공격 +30%');
  assert.equal(f.st.dmg, 1, '코인이 2개면 벼랑 끝이 발동하면 안 된다');
  b.simT = 15; computeStats(f);
  assert.ok(Math.abs(f.st.atk - 1.25) < 1e-9, '10초 이후 선제공격은 끝나야 한다');
  b.simT = 20; computeStats(f);
  assert.ok(Math.abs(f.st.atk - 1.25 * 1.2) < 1e-9, '20초부터 폭주 시간이 발동해야 한다');

  f.hp = f.maxHp * 0.02; computeStats(f);
  assert.ok(f.st.atk <= 1.5 * 1.2 + 1e-9, '광전사는 최대 +50%를 넘으면 안 된다');

  const brinkBattle = makeBattle({ coins: 1, augments: ['brink'] });
  assert.equal(brinkBattle.fighters[0].perm.dmg, 1.2);
  const devilBattle = makeBattle({ augments: ['devilDeal'] });
  assert.equal(devilBattle.fighters[0].perm.atk, 1.25);

  const troll = makePlayer({ coins: 3 });
  applyAugmentPick(troll, AUG_BY_ID.trollCondition);
  assert.equal(troll.trollCondition, true);
  assert.equal(augEligible(AUG_BY_ID.gamble, troll), false, '서로 충돌하는 다음 전투 계약은 동시에 얻지 못해야 한다');
});

test('트롤의 조건과 승부사 기질은 다음 전투 결과를 정확히 처리하고 숨김 증강을 만들지 않는다', () => {
  const trollLose = makePlayer({ coins: 3, streak: 2 });
  applyAugmentPick(trollLose, AUG_BY_ID.trollCondition);
  loseCoin(trollLose);
  assert.equal(trollLose.coins, 3);
  assert.equal(trollLose.damageRewardMult, 1.1);
  assert.equal(trollLose.trollCondition, false);
  assert.equal(trollLose.losses, 1);
  assert.equal(trollLose.streak, 0);

  const trollWin = makePlayer({ coins: 3 });
  applyAugmentPick(trollWin, AUG_BY_ID.trollCondition);
  winRound(trollWin);
  assert.equal(trollWin.coins, 2);
  assert.equal(trollWin.coinsLost, 1);
  assert.equal(trollWin.damageRewardMult, 1);
  assert.equal(trollWin.trollCondition, false);

  const gamblerWin = makePlayer({ coins: 3 });
  applyAugmentPick(gamblerWin, AUG_BY_ID.gamble);
  winRound(gamblerWin);
  assert.equal(gamblerWin.damageRewardMult, 1.2);
  assert.equal(gamblerWin.gamble, false);
  assert.equal(gamblerWin.augments.includes('powerReward'), false);

  const rewardBattle = new Battle('square', [gamblerWin, makePlayer({ isAI: true })]);
  assert.equal(rewardBattle.fighters[0].perm.dmg, 1.2);
});

test('수면 가스는 1초간 이동·무기·스킬을 막고 자동화 전문가는 쿨타임을 30% 줄인다', () => {
  const b = makeBattle({ augments: ['sleepGas', 'autoExpert'] });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  assert.equal(f.autoCdMult, 0.7);
  f.cd.gasT = 0;
  autoSystems(b, f, 1 / 60);
  assert.ok(e.timers.stun > 0);
  assert.equal(f.cd.gasT, 7);

  const x = e.x, y = e.y, ang = e.weaponAngle;
  moveFighter(b, e, 0.2);
  updateWeapon(b, e, 0.2);
  assert.equal(e.x, x); assert.equal(e.y, y); assert.equal(e.weaponAngle, ang);
  assert.equal(useSkill(b, e, 'char'), false);
  updateTimers(b, e, 1.01);
  assert.equal(e.timers.stun, 0);
});

test('자동 공격·소환수·유체화·반사 충전의 변경 수치가 적용된다', () => {
  const autoBattle = makeBattle({ augments: ['missile', 'flame'] });
  const auto = autoBattle.fighters[0];
  computeStats(auto); auto.cd.missile = 0; auto.cd.flame = 0;
  autoSystems(autoBattle, auto, 1 / 60);
  assert.equal(autoBattle.projectiles.filter(p => p.kind === 'missile').length, 2);
  assert.ok(autoBattle.projectiles.filter(p => p.kind === 'missile').every(p => p.dmg === 2));
  assert.equal(autoBattle.flames[0].life, 2);

  const legionBattle = makeBattle({ augments: ['miniBall', 'legion'] });
  const minion = legionBattle.fighters[0].summons[0];
  assert.equal(minion.maxHp, 39);
  assert.equal(minion.dmg, 13);
  assert.ok(Math.abs(minion.r - 16.9) < 1e-9);
  assert.equal(minion.spd, 205);

  const phaseBattle = makeBattle({ weaponId: 'dagger', augments: ['d_phase'] });
  const [phase, phaseTarget] = phaseBattle.fighters;
  computeStats(phase); computeStats(phaseTarget);
  weaponDamage(phaseBattle, phase, phaseTarget, 1);
  assert.equal(phase.timers.untouchable, 1);

  const reflectBattle = makeBattle({ augments: ['reflectCharge'] });
  const [charged, reflectTarget] = reflectBattle.fighters;
  computeStats(charged); computeStats(reflectTarget); charged.charged = true;
  const before = reflectTarget.hp;
  weaponDamage(reflectBattle, charged, reflectTarget, 10);
  assert.ok(Math.abs(before - reflectTarget.hp - 13) < 1e-9);
});

test('고양이 발바닥 카피는 1초 후 중앙에 피해 24를 준다', () => {
  const b = makeBattle({ copiedSkill: 'cat' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e); e.x = e.y = 0;
  const before = e.hp;
  assert.equal(useSkill(b, f, 'common'), true);
  assert.equal(f.timers.pawDrop, 1);
  updateTimers(b, f, 1.01);
  assert.equal(before - e.hp, 24);
});

test('파괴 폭주의 5초 후 약화는 전투가 끝날 때까지 유지된다', () => {
  const b = makeBattle({ charId: 'wak' });
  const f = b.fighters[0];
  useSkill(b, f, 'char');
  computeStats(f);
  assert.ok(f.st.atk > 1);
  updateTimers(b, f, 5.01);
  assert.equal(f.berserkPhase, 2);
  updateTimers(b, f, 20);
  computeStats(f);
  assert.equal(f.berserkPhase, 2);
  assert.ok(f.st.atk < 1);
});

test('같은 틱에 최후의 3초가 끝난 양측은 순서 편향 없이 무승부 처리된다', () => {
  const b = makeBattle({ augments: ['lastStand'] }, { augments: ['lastStand'] });
  const [a, c] = b.fighters;
  computeStats(a); computeStats(c);
  dealDamage(b, c, a, a.maxHp * 10, { kind: 'weapon' });
  dealDamage(b, a, c, c.maxHp * 10, { kind: 'weapon' });
  a.timers.actingDead = 0.01;
  c.timers.actingDead = 0.01;
  b.step(0.02);
  assert.equal(a.dead, true);
  assert.equal(c.dead, true);
  assert.equal(b.result.draw, true);
});

test('로켓 관통은 매우 빠르게 돌진하며 이동 경로의 적을 통과해 피해를 준다', () => {
  const b = makeBattle({ charId: 'cat', weaponId: 'sword', augments: ['rocketStart'] });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = -250; f.y = 0; f.vx = 1; f.vy = 0;
  e.x = -80; e.y = 0; e.vx = 0; e.vy = 1;

  const startX = f.x;
  const beforeHp = e.hp;
  const dt = 0.3;
  const ordinaryDistance = CHARACTERS.cat.move * WEAPONS.sword.moveMult * dt;
  moveFighter(b, f, dt);

  assert.ok(f.x - startX >= ordinaryDistance * 3.5, '로켓 돌진은 평상시 이동보다 훨씬 빨라야 한다');
  assert.ok(f.x > e.x + e.radius, '적에게 막히지 않고 반대편까지 관통해야 한다');
  assert.ok(e.hp < beforeHp, '한 프레임 사이에 지나친 적도 피해를 받아야 한다');
  assert.equal(f.rocketActive, true, '적을 관통해도 첫 벽 충돌 전까지 돌진은 유지되어야 한다');
});

test('꼬마볼은 적을 추적하지 않고 직진·벽 반사하며 우연히 부딪힌 적에게만 피해를 준다', () => {
  const b = makeBattle({ augments: ['miniBall'] });
  const [f, e] = b.fighters;
  const m = f.summons[0];
  computeStats(f); computeStats(e);

  m.x = 0; m.y = 0; m.vx = 1; m.vy = 0; m.spd = 200;
  e.x = 0; e.y = 250;
  b.updateMinions(0.2);
  assert.ok(Math.abs(m.vx - 1) < 1e-9 && Math.abs(m.vy) < 1e-9,
    '적이 옆에 있어도 이동 방향을 적 쪽으로 틀면 안 된다');

  m.x = b.arena.H - m.r - 1; m.y = 0; m.vx = 1; m.vy = 0;
  b.updateMinions(0.02);
  assert.ok(m.vx < 0, '벽에 닿으면 다른 공처럼 반사되어야 한다');
  assert.ok(m.x <= b.arena.H - m.r + 1e-9, '벽 밖으로 빠져나가면 안 된다');

  m.x = 0; m.y = 0; m.vx = 1; m.vy = 0; m.spd = 0; m.cd = 0;
  e.x = m.r + e.radius - 1; e.y = 0;
  const beforeHp = e.hp;
  b.updateMinions(1 / 1000);
  assert.ok(e.hp < beforeHp, '이동 중 우연히 적과 겹치면 몸통박치기 피해를 줘야 한다');
});

test('분열은 같은 캐릭터·무기·증강 빌드의 공 둘을 10% 체력과 절반 공격력으로 만든다', () => {
  const augments = ['split', 'atk15', 'p_dual', 'missile'];
  const b = makeBattle({ charId: 'balloon', weaponId: 'pistol', augments });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  const parentMaxHp = f.maxHp;
  const parentDamageStat = f.st.atk * f.st.dmg;

  dealDamage(b, e, f, f.maxHp * 10, { kind: 'weapon' });
  assert.equal(f.mainDead, true);
  assert.equal(f.splitBalls.length, 2, '정확히 두 개로 분열해야 한다');

  for (const clone of f.splitBalls) {
    assert.equal(clone.charId, f.charId, '캐릭터를 그대로 복제해야 한다');
    assert.equal(clone.weaponId, f.weaponId, '장착 무기를 그대로 복제해야 한다');
    assert.equal(clone.flags.dualPistol, f.flags.dualPistol, '무기 전용 증강을 그대로 복제해야 한다');
    assert.equal(clone.flags.missile, f.flags.missile, '자동 공격 증강을 그대로 복제해야 한다');
    assert.ok(Math.abs(clone.maxHp - parentMaxHp * 0.1) < 1e-9, '최대 체력은 본체의 10%여야 한다');
    assert.ok(Math.abs(clone.hp - clone.maxHp) < 1e-9, '분열 시 10% 체력으로 시작해야 한다');
    computeStats(clone);
    assert.ok(Math.abs(clone.st.atk * clone.st.dmg - parentDamageStat * 0.5) < 1e-9,
      '같은 빌드의 공격 피해 배율은 본체의 절반이어야 한다');
  }

  e.maxHp = e.hp = 10000;
  const parentDealt = weaponDamage(b, f, e, 10);
  const cloneDealt = weaponDamage(b, f.splitBalls[0], e, 10);
  assert.ok(Math.abs(cloneDealt - parentDealt * 0.5) < 1e-9,
    '분열체의 실제 무기 피해도 본체의 절반이어야 한다');

  const [firstClone, secondClone] = f.splitBalls;
  b.projectiles.length = 0;
  firstClone.gun.reloadT = 0;
  firstClone.gun.shotT = 0.001;
  firstClone.gun.burst = Math.max(1, firstClone.gun.burst);
  updateWeapon(b, firstClone, 0.01);
  assert.equal(b.projectiles.length, 2, '분열체도 실제 무기 업데이트로 쌍권총을 발사해야 한다');
  assert.ok(b.projectiles.every(p => p.owner === firstClone), '분열체가 만든 탄환은 분열체를 소유자로 기록해야 한다');

  e.x = 300; e.y = 300;
  const allyHp = secondClone.hp;
  for (const p of b.projectiles) {
    p.x = secondClone.x; p.y = secondClone.y; p.spd = 0;
  }
  b.updateProjectiles(1 / 1000);
  assert.equal(secondClone.hp, allyHp, '분열체 탄환은 같은 원본 팀의 형제 분열체를 공격하면 안 된다');

  b.projectiles.length = 0;
  firstClone.x = 0; firstClone.y = 0; firstClone.vx = 1; firstClone.vy = 0;
  secondClone.x = -250; secondClone.y = -250;
  e.x = firstClone.radius + e.radius - 8; e.y = 0; e.vx = -1; e.vy = 0;
  b.updateMinions(0);
  assert.ok(dist(firstClone.x, firstClone.y, e.x, e.y) >= firstClone.radius + e.radius - 1e-9,
    '분열체는 적 본체와 물리 충돌하고 서로 밀려나야 한다');

  dealDamage(b, e, firstClone, firstClone.hp * 100, { kind: 'weapon' });
  assert.equal(f.splitBalls.length, 1);
  assert.equal(f.dead, false, '분열체 하나가 남아 있으면 원본 팀은 생존해야 한다');
  assert.equal(b.fighterAlive(f), true);
  assert.equal(b.result, null);

  dealDamage(b, e, secondClone, secondClone.hp * 100, { kind: 'weapon' });
  assert.equal(f.splitBalls.length, 0);
  assert.equal(f.dead, true, '두 분열체가 모두 죽으면 원본도 최종 사망해야 한다');
  assert.equal(b.fighterAlive(f), false);
  assert.equal(b.result.winner, e, '마지막 분열체 사망 시 상대 승리로 전투가 끝나야 한다');
});

test('쌍권총은 같은 방향의 두 발이 아니라 정확히 서로 반대 방향으로 한 발씩 쏜다', () => {
  const b = makeBattle({ weaponId: 'pistol', augments: ['p_dual'] });
  const f = b.fighters[0];
  f.weaponAngle = 0.37;
  fireGun(b, f);

  assert.equal(b.projectiles.length, 2);
  assert.ok(b.projectiles.every(p => p.dmg === WEAPONS.pistol.dmg));
  const [front, back] = b.projectiles;
  const dot = front.vx * back.vx + front.vy * back.vy;
  assert.ok(Math.abs(dot + 1) < 1e-9, '두 탄환의 진행 방향은 180도 반대여야 한다');
  assert.ok(Math.abs((front.x - f.x) + (back.x - f.x)) < 1e-9);
  assert.ok(Math.abs((front.y - f.y) + (back.y - f.y)) < 1e-9);
});

test('지팡이 투사체와 지뢰는 같은 종류끼리도 소유자를 확실히 구분할 수 있다', () => {
  const staffBattle = makeBattle({ weaponId: 'staff' }, { weaponId: 'staff' });
  const [localStaff, enemyStaff] = staffBattle.fighters;
  fireStaff(staffBattle, localStaff);
  fireStaff(staffBattle, enemyStaff);
  const localOrb = staffBattle.projectiles.find(p => p.owner === localStaff);
  const enemyOrb = staffBattle.projectiles.find(p => p.owner === enemyStaff);
  assert.ok(localOrb && enemyOrb);
  assert.equal(localOrb.owner.pid, localStaff.player.id);
  assert.equal(enemyOrb.owner.pid, enemyStaff.player.id);
  assert.notEqual(localOrb.owner.pid, enemyOrb.owner.pid);

  const mineBattle = makeBattle({ weaponId: 'mine' }, { weaponId: 'mine' });
  const [localMiner, enemyMiner] = mineBattle.fighters;
  for (const fighter of mineBattle.fighters) {
    computeStats(fighter);
    fighter.cd.mine = 0;
    updateWeapon(mineBattle, fighter, 1 / 60);
  }
  const localMine = mineBattle.mines.find(m => m.owner === localMiner);
  const enemyMine = mineBattle.mines.find(m => m.owner === enemyMiner);
  assert.ok(localMine && enemyMine);
  assert.equal(localMine.owner.pid, localMiner.player.id);
  assert.equal(enemyMine.owner.pid, enemyMiner.player.id);
  assert.notEqual(localMine.owner.pid, enemyMine.owner.pid);
});

test('같은 공격자의 겹친 화염은 대상당 한 틱에 한 번만 피해를 준다', () => {
  const players = [
    makePlayer({ isAI: true, augments: ['flame'] }),
    makePlayer({ isAI: true, augments: ['flame'], color: '#6bd968' }),
    makePlayer({ isAI: true, color: '#ff6b6b' }),
  ];
  const b = new Battle('square', players);
  b.phase = 'fight'; b.simT = 0;
  const [a, c, target] = b.fighters;
  for (const f of b.fighters) computeStats(f);
  a.x = c.x = 250; a.y = c.y = 250;
  target.x = target.y = 0;

  b.flameTick = 0;
  b.flames = [
    { owner: a, x: 0, y: 0, r: 16, life: 3, dps: 1 },
    { owner: a, x: 0, y: 0, r: 16, life: 3, dps: 1 },
  ];
  const beforeOneOwner = target.hp;
  b.updateGroundFx(0.01);
  assert.ok(Math.abs(beforeOneOwner - target.hp - 1 * 0.25) < 1e-9,
    '같은 소유자의 화염 두 개가 겹쳐도 기본 한 틱 피해만 적용해야 한다');

  target.hp = target.maxHp;
  b.flameTick = 0;
  b.flames = [
    { owner: a, x: 0, y: 0, r: 16, life: 3, dps: 1 },
    { owner: c, x: 0, y: 0, r: 16, life: 3, dps: 1 },
  ];
  const beforeTwoOwners = target.hp;
  b.updateGroundFx(0.01);
  assert.ok(Math.abs(beforeTwoOwners - target.hp - 2 * 1 * 0.25) < 1e-9,
    '서로 다른 공격자의 화염은 각각 피해를 줘야 한다');
});

test('이벤트 전투 옵션은 원형 경기장에 보급·기둥과 피해 배율을 적용한다', () => {
  const b = new Battle('circle', [
    makePlayer({ eventDamageMult: 1.3, damageRewardMult: 1.2 }),
    makePlayer({ isAI: true }),
  ], { eventFfa: true, powerSupply: true, twoPillars: true });

  assert.equal(b.eventFfa, true);
  assert.equal(b.eventPowerSupply, true);
  assert.equal(b.eventTwoPillars, true);
  assert.ok(b.arena.cube);
  assert.equal(b.arena.cube.respT, 2.5);
  assert.equal(b.arena.pillars.length, 2);
  assert.ok(Math.abs(b.fighters[0].perm.dmg - 1.56) < 1e-9);

  const pillar = b.arena.pillars[0];
  const body = {
    kind: 'main', radius: 10,
    x: pillar.x - pillar.r - 9, y: pillar.y,
    vx: 1, vy: 0,
  };
  assert.equal(b.arena.collideBody(body), 1);
  assert.ok(body.vx < 0);

  const projectile = {
    r: 3,
    x: pillar.x - pillar.r - 2, y: pillar.y,
    vx: 1, vy: 0, ang: 0,
  };
  assert.equal(b.arena.reflectProj(projectile), true);
  assert.ok(projectile.vx < 0);

  const piercingProjectile = {
    r: 3,
    x: pillar.x - pillar.r - 2, y: pillar.y,
    vx: 1, vy: 0, ang: 0,
    pierceObstacles: true,
  };
  assert.equal(b.arena.reflectProj(piercingProjectile), false);
  assert.equal(piercingProjectile.vx, 1);
});

test('105개 증강 각각이 실제 전투에서 런타임 오류 없이 동작한다', () => {
  for (const a of AUGMENTS) {
    const weaponId = a.weapon || 'sword';
    const copiedSkill = a.cat === 'copy' ? a.charId : null;
    const b = makeBattle({ weaponId, augments: [a.id], copiedSkill, isAI: true }, { weaponId: 'bow', isAI: true });
    for (let i = 0; i < 60 * (BATTLE_TIME + OVERTIME + 10) && !b.finished; i++) b.update(1 / 60);
    assert.ok(b.result, a.id + ' 전투가 종료되어야 한다');
  }
});

test('무기 6×6 조합 전투가 멈추지 않고 피해와 정상 종료를 만든다', () => {
  const weapons = Object.keys(WEAPONS);
  const chars = Object.keys(CHARACTERS);
  let damaged = 0, knockouts = 0, timeouts = 0;
  for (let i = 0; i < weapons.length; i++) {
    for (let j = 0; j < weapons.length; j++) {
      const b = makeBattle(
        { charId: chars[i % chars.length], weaponId: weapons[i], isAI: true },
        { charId: chars[j % chars.length], weaponId: weapons[j], isAI: true },
      );
      for (let step = 0; step < 60 * (BATTLE_TIME + OVERTIME + 10) && !b.result; step++) b.update(1 / 60);
      assert.ok(b.result, weapons[i] + ' vs ' + weapons[j]);
      if (b.fighters.some(f => f.hp < f.maxHp || f.dead || f.mainDead)) damaged++;
      if (b.fighters.some(f => f.dead)) knockouts++;
      if (b.result.reason === '체력 비율 판정') timeouts++;
    }
  }
  console.log('  전투 지표: 피해 발생 ' + damaged + '/36 · KO ' + knockouts + '/36 · 체력 판정 ' + timeouts + '/36');
  assert.ok(damaged >= 32, '대부분의 무기 조합에서 실제 피해가 발생해야 한다');
  assert.ok(knockouts >= 1, '적어도 일부 전투는 HP 0 KO로 종료되어야 한다');
});

test('조준 예측선은 이벤트로 생긴 기둥을 실제 반사와 동일하게 계산한다', () => {
  const arena = new Arena('circle');
  const sx = -300, sy = -65, r = 22;
  const wallOnly = arena.castRay(sx, sy, 1, 0, r);
  // '쌍둥이 기둥' 이벤트가 원형 경기장에 심는 것과 같은 배치
  arena.pillars.push({ x: -145, y: -65, r: 42 }, { x: 145, y: 65, r: 42 });
  const hit = arena.castRay(sx, sy, 1, 0, r);
  assert.ok(wallOnly && hit, '두 경우 모두 충돌 지점을 찾아야 한다');
  assert.ok(hit.t < wallOnly.t, '기둥이 반대편 벽보다 먼저 맞아야 한다');

  const dot = hit.nx;
  const rx = 1 - 2 * dot * hit.nx, ry = -2 * dot * hit.ny;

  const body = { kind: 'main', x: sx, y: sy, vx: 1, vy: 0, radius: r };
  let bounced = false;
  for (let step = 0; step < 2000 && !bounced; step++) {
    body.x += body.vx; body.y += body.vy;
    bounced = arena.collideBody(body) > 0;
  }
  assert.ok(bounced, '실제 몸통도 기둥에 반사되어야 한다');
  assert.ok(Math.hypot(body.x - hit.x, body.y - hit.y) < 2, '예측 지점과 실제 반사 지점이 일치해야 한다');
  assert.ok(Math.hypot(body.vx - rx, body.vy - ry) < 1e-6, '예측 반사 방향이 실제와 일치해야 한다');
});

test('본전투 30초 뒤 연장전 10초는 1배속에서 5초에 걸쳐 2배속까지 가속한다', () => {
  assert.equal(BATTLE_TIME, 30, '본전투는 30초여야 한다');
  assert.equal(OVERTIME, 10, '연장전은 10초여야 한다');
  const b = makeBattle({ isAI: true }, { isAI: true });
  // 판정 전에 KO로 끝나지 않도록 체력만 크게 잡는다
  for (const f of b.fighters) { f.maxHp = 1e9; f.hp = 1e9; }
  const RDT = 1 / 60;
  const samples = new Map();
  let mainTicks = 0, otTicks = 0;
  for (let i = 0; i < 60 * 120 && !b.result; i++) {
    const phase = b.phase, wasOvertime = b.overtime;
    b.update(RDT);
    if (phase === 'fight') { if (wasOvertime) otTicks++; else mainTicks++; }
    if (b.overtime) {
      const elapsed = OVERTIME - b.otT;
      for (const mark of [0, 2.5, 5, 7.5]) {
        if (!samples.has(mark) && elapsed >= mark) samples.set(mark, b.timeScale);
      }
    }
  }
  assert.ok(b.result, '연장전이 끝나면 체력 비율 판정으로 종료되어야 한다');
  assert.ok(Math.abs(mainTicks * RDT - BATTLE_TIME) < 0.1, '본전투는 실시간 30초여야 한다');
  assert.ok(Math.abs(otTicks * RDT - OVERTIME) < 0.1, '연장전은 실시간 10초여야 한다');
  assert.ok(Math.abs(samples.get(0) - 1) < 0.02, '연장 진입 순간에는 아직 1배속이어야 한다');
  assert.ok(Math.abs(samples.get(2.5) - 1.5) < 0.02, '절반 지점에서는 1.5배속이어야 한다');
  assert.equal(samples.get(5), 2, '5초째에 정확히 2배속에 도달해야 한다');
  assert.equal(samples.get(7.5), 2, '5초 이후로는 2배속을 유지해야 한다');
});

// 표적을 칼날 앞에 고정한 채 공격자만 회전시켜 타격 횟수를 센다
function meleeTrial(weaponId, dist, seconds, opts = {}) {
  const b = makeBattle({ weaponId, augments: opts.augments || [] }, { isAI: true });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.weaponAngle = opts.startAngle === undefined ? -1.6 : opts.startAngle;
  e.maxHp = 1e9; e.hp = 1e9;
  let prev = e.hp, hits = 0, onBlade = 0, left = false;
  for (let i = 0; i < 60 * seconds; i++) {
    e.x = dist; e.y = 0;
    computeStats(f);
    if (opts.forcedFr !== undefined) f.st.fr = opts.forcedFr;
    updateCooldowns(b, f, 1 / 60);
    updateWeapon(b, f, 1 / 60);
    if (f.meleeContact.size > 0) onBlade++; else if (onBlade) left = true;
    if (e.hp < prev) { hits++; prev = e.hp; }
    if (opts.singlePass && left) break;
  }
  return { hits, onBlade, left };
}

test('근접 무기는 칼날에 머무는 내내가 아니라 새로 닿는 순간에만 한 번 맞힌다', () => {
  // 가까울수록 칼날 판정 안에 오래 머문다. 예전에는 그동안 2~3회 맞았다.
  for (const dist of [44, 55, 70, 82]) {
    const r = meleeTrial('sword', dist, 3, { singlePass: true });
    assert.ok(r.onBlade > 12, dist + '유닛에서는 칼날 판정에 12틱 이상 머물러야 한다');
    assert.equal(r.hits, 1, dist + '유닛에서 한 번 지나갈 때 정확히 1회만 맞아야 한다');
  }
  const dagger = meleeTrial('dagger', 44, 3, { singlePass: true });
  assert.equal(dagger.hits, 1, '단검도 한 번 지나갈 때 1회만 맞아야 한다');
});

test('칼날에서 벗어났다 다시 닿으면 재타격된다', () => {
  // 검은 3.0rad/s라 한 바퀴에 약 2.09초. 6초면 두세 바퀴를 돈다.
  const r = meleeTrial('sword', 55, 6, { startAngle: 0 });
  assert.ok(r.hits >= 2, '여러 바퀴를 돌면 그 횟수만큼 다시 맞아야 한다 (실제 ' + r.hits + '회)');
  assert.ok(r.hits <= 4, '한 바퀴에 한 번을 넘게 맞으면 안 된다 (실제 ' + r.hits + '회)');
});

test('공격속도 하나가 근접은 회전으로, 원거리·지뢰는 발사 빈도로 나타난다', () => {
  // 근접: 공격속도가 오른 만큼을 두 배로 받아 회전속도가 된다.
  // 조우가 짧아 회전이 조금 빨라져도 결국 한 번 스치고 끝나기 때문이다.
  for (const weaponId of ['sword', 'dagger']) {
    const base = makeBattle({ weaponId }).fighters[0];
    computeStats(base);
    const fast = makeBattle({ weaponId, augments: ['rot15', 'rot15'] }).fighters[0];
    computeStats(fast);
    assert.ok(Math.abs(fast.st.aspd - base.st.aspd * 1.15 * 1.15) < 1e-9, weaponId + ' 공격속도 배율');
    const expected = WEAPONS[weaponId].rot * (1 + (fast.st.aspd - 1) * 2);
    assert.ok(Math.abs(fast.st.rot - expected) < 1e-9,
      weaponId + '은 공격속도 증가분을 두 배로 받아야 한다 (기대 ' + expected.toFixed(3) + ' 실제 ' + fast.st.rot.toFixed(3) + ')');
    assert.ok(fast.st.rot > base.st.rot, weaponId + '은 공격속도가 오르면 더 빨리 회전해야 한다');

    // 한 단계만 올려도 눈에 띄어야 한다 (속사 하나 = 회전 +30%)
    const one = makeBattle({ weaponId, augments: ['rot15'] }).fighters[0];
    computeStats(one);
    assert.ok(Math.abs(one.st.rot - WEAPONS[weaponId].rot * 1.30) < 1e-9,
      weaponId + ': 속사 하나면 회전 +30%여야 한다');

    // 느려지는 쪽은 그대로다. 배로 깎으면 회전이 멈추거나 뒤집힌다.
    const slow = makeBattle({ weaponId }).fighters[0];
    slow.timers.freeze = 2;
    computeStats(slow);
    assert.ok(slow.st.rot > 0, weaponId + ': 빙결이어도 회전이 멈추거나 역회전하면 안 된다');
    assert.ok(Math.abs(slow.st.rot - WEAPONS[weaponId].rot * 0.3) < 1e-9,
      weaponId + ': 감속은 배율을 그대로 받아야 한다');
  }
  // 원거리·지뢰: 회전하지 않고, 공격속도가 발사 빈도가 된다
  for (const weaponId of ['bow', 'pistol', 'staff', 'mine']) {
    const f = makeBattle({ weaponId }).fighters[0];
    computeStats(f);
    assert.equal(f.st.rot, 0, weaponId + '은 평상시 회전하지 않아야 한다');
    const count = aspd => {
      const b = makeBattle({ weaponId }, { isAI: true });
      const g = b.fighters[0];
      let fired = 0;
      for (let i = 0; i < 60 * 6; i++) {
        computeStats(g); g.st.fr = aspd;
        updateCooldowns(b, g, 1 / 60); updateWeapon(b, g, 1 / 60);
        fired = Math.max(fired, b.projectiles.length + b.mines.length);
      }
      return fired;
    };
    assert.ok(count(3) > count(0.35), weaponId + '은 공격속도가 빠를수록 더 많이 나가야 한다');
  }
});

test('원거리 무기는 회전 대신 상대의 현재 위치를 겨눈다', () => {
  for (const weaponId of ['bow', 'pistol', 'staff']) {
    const b = makeBattle({ weaponId }, { isAI: true });
    const [f, e] = b.fighters;
    computeStats(f); computeStats(e);
    f.x = 0; f.y = 0; f.weaponAngle = Math.PI;      // 일부러 반대편을 보게 둔다
    for (const [ex, ey] of [[120, 0], [0, 150], [-90, -90]]) {
      e.x = ex; e.y = ey;
      updateWeapon(b, f, 1 / 60);
      const want = Math.atan2(ey - f.y, ex - f.x);
      let diff = f.weaponAngle - want;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      assert.ok(Math.abs(diff) < 1e-9, weaponId + '이 (' + ex + ',' + ey + ')를 겨눠야 한다');
    }
  }
});

test('권총 회전 난사는 1.5초 동안만 무기를 돌린다', () => {
  const b = makeBattle({ weaponId: 'pistol' }, { isAI: true });
  const f = b.fighters[0];
  computeStats(f);
  assert.equal(f.st.rot, 0, '평상시 권총은 돌지 않는다');
  assert.equal(useSkill(b, f, 'weapon'), true);
  assert.ok(Math.abs(f.timers.gunBarrage - 1.5) < 1e-9, '지속시간은 1.5초여야 한다');
  computeStats(f);
  assert.ok(f.st.rot > 0, '난사 중에는 회전해야 한다');
  updateTimers(b, f, 1.51);
  computeStats(f);
  assert.equal(f.st.rot, 0, '끝나면 다시 멈춰야 한다');
});

test('1대1은 좁은 경기장, 4인 난투는 기존 크기를 쓴다', () => {
  const duel = new Battle('diamond', [makePlayer({ isAI: true }), makePlayer({ isAI: true })]);
  assert.equal(duel.arena.L, 320);
  const ffa = new Battle('diamond', [1, 2, 3, 4].map(() => makePlayer({ isAI: true })));
  assert.equal(ffa.arena.L, 405);
  // 좁아진 만큼 스폰도 안쪽으로 들어와야 한다
  const limit = duel.arena.L - 22 * Math.SQRT2;
  for (const f of duel.fighters) assert.ok(Math.abs(f.x) + Math.abs(f.y) <= limit);
  assert.ok(Math.abs(duel.fighters[0].x) < 185, '1대1 스폰은 기존보다 안쪽이어야 한다');
});

test('쌍단검은 두 칼날이 각각 독립적으로 한 번씩 맞힌다', () => {
  const single = meleeTrial('dagger', 55, 6, { startAngle: 0 }).hits;
  const dual = meleeTrial('dagger', 55, 6, { startAngle: 0, augments: ['d_dual'] }).hits;
  assert.equal(dual, single * 2, '칼날이 둘이면 정확히 두 배로 맞아야 한다 (단일 ' + single + ' / 쌍 ' + dual + ')');
});

test('다이아 경기장은 조준 예측선과 실제 반사가 정확히 일치한다', () => {
  const arena = new Arena('diamond');
  const radius = 22;
  let worst = 0, checked = 0;
  for (let k = 0; k < 720; k++) {
    const ang = k * Math.PI * 2 / 720, dx = Math.cos(ang), dy = Math.sin(ang);
    const hit = arena.castRay(-120, 60, dx, dy, radius);
    assert.ok(hit, '경기장 안에서는 항상 벽을 만나야 한다');
    // 네 변의 법선은 (±1,±1)/√2 상수여야 한다
    assert.ok(Math.abs(Math.abs(hit.nx) - Math.SQRT1_2) < 1e-12, '법선 x성분이 축 고정이어야 한다');
    assert.ok(Math.abs(Math.abs(hit.ny) - Math.SQRT1_2) < 1e-12, '법선 y성분이 축 고정이어야 한다');
    const dot = dx * hit.nx + dy * hit.ny;
    const predicted = Math.atan2(dy - 2 * dot * hit.ny, dx - 2 * dot * hit.nx);
    const body = { kind:'main', x:-120, y:60, vx:dx, vy:dy, radius };
    let actual = null;
    for (let step = 0; step < 4000; step++) {
      body.x += body.vx * 160 / 60; body.y += body.vy * 160 / 60;
      if (arena.collideBody(body) > 0) { actual = Math.atan2(body.vy, body.vx); break; }
    }
    assert.ok(actual !== null, '실제 몸통도 벽에 반사되어야 한다');
    let diff = actual - predicted;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    worst = Math.max(worst, Math.abs(diff));
    checked++;
  }
  assert.equal(checked, 720);
  assert.ok(worst < 1e-9, '마름모는 법선이 상수라 오차가 없어야 한다 (실제 ' + worst + ')');
});

test('다이아 경기장은 어떤 궤도에서도 공을 밖으로 새게 하지 않는다', () => {
  const arena = new Arena('diamond');
  const radius = 22;
  const limit = arena.L - radius * Math.SQRT2;
  let worstSum = 0;
  for (let k = 0; k < 120; k++) {
    const ang = k * Math.PI * 2 / 120;
    const body = { kind:'main', x:0, y:0, vx:Math.cos(ang), vy:Math.sin(ang), radius };
    for (let step = 0; step < 60 * 30; step++) {
      body.x += body.vx * 300 / 60; body.y += body.vy * 300 / 60;
      arena.collideBody(body);
      worstSum = Math.max(worstSum, Math.abs(body.x) + Math.abs(body.y));
    }
  }
  // 한 스텝(5유닛) 만큼의 파고듦은 다음 틱에 되돌려지므로 꼭짓점을 넘지 않으면 된다
  assert.ok(worstSum < arena.L, '공 중심이 꼭짓점 밖으로 나가면 안 된다 (최대 ' + worstSum.toFixed(1) + ')');
  assert.ok(worstSum < limit + 10, '한 스텝 이상 파고들면 안 된다');
});

test('4인 난투 스폰 위치가 다이아 경기장 안에 들어간다', () => {
  const players = [1, 2, 3, 4].map(id => makePlayer({ id, isAI:true }));
  const b = new Battle('diamond', players);
  const limit = b.arena.L - 22 * Math.SQRT2;
  for (const f of b.fighters) {
    assert.ok(Math.abs(f.x) + Math.abs(f.y) <= limit,
      '스폰 (' + f.x + ',' + f.y + ')이 경기장 밖이면 안 된다');
  }
});


test('유도 미사일 발당 피해는 2다', () => {
  const b = makeBattle({ weaponId: 'sword', augments: ['missile'] });
  const f = b.fighters[0];
  let shot = null;
  for (let i = 0; i < 60 * 20 && !shot; i++) {
    b.update(1 / 60);
    shot = b.projectiles.find(p => p.kind === 'missile') || null;
  }
  assert.ok(shot, '미사일 증강이면 미사일이 나가야 한다');
  assert.equal(shot.dmg, 2, '발당 피해가 기획값과 달라졌다 (실제 ' + shot.dmg + ')');

  const up = makeBattle({ weaponId: 'sword', augments: ['missile', 'missileUp'] });
  let strong = null;
  for (let i = 0; i < 60 * 20 && !strong; i++) {
    up.update(1 / 60);
    strong = up.projectiles.find(p => p.kind === 'missile') || null;
  }
  assert.ok(strong && Math.abs(strong.dmg - 2 * 1.3) < 1e-9, '미사일 강화는 30% 증가여야 한다');
});

test('공격속도 증강은 근접 무기의 회전속도를 올리고, 회전 한 바퀴에 한 번 맞춘다', () => {
  const rotOf = (weaponId, augments) => {
    const b = makeBattle({ weaponId: weaponId, augments: augments });
    computeStats(b.fighters[0]);
    return b.fighters[0].st.rot;
  };
  for (const weaponId of ['sword', 'dagger']) {
    const base = rotOf(weaponId, []);
    // 근접은 공격속도 증가분을 두 배로 받는다: 1.15 -> 1.30, 1.3225 -> 1.645
    assert.ok(Math.abs(rotOf(weaponId, ['rot15']) - base * 1.30) < 1e-9,
      weaponId + ': 속사 하나면 회전속도 +30%여야 한다');
    assert.ok(Math.abs(rotOf(weaponId, ['rot15', 'rot15']) - base * (1 + (1.15 * 1.15 - 1) * 2)) < 1e-9,
      weaponId + ': 속사가 쌓이면 증가분도 함께 두 배로 커져야 한다');
  }

  // 붙어 있을 때 회전 한 바퀴에 정확히 한 번 맞는다 (빠를수록 그만큼 더 때린다)
  const sweep = augments => {
    const b = makeBattle({ weaponId: 'sword', augments: augments });
    const A = b.fighters[0], V = b.fighters[1];
    const gap = A.radius + V.radius + 6;
    let hits = 0, turns = 0, prevAng = A.weaponAngle, prevHp = 1e9;
    for (let i = 0; i < 60 * 12; i++) {
      A.x = 0; A.y = 0; A.vx = 0; A.vy = 0;
      V.x = gap; V.y = 0; V.vx = 0; V.vy = 0;
      A.maxHp = 1e9; A.hp = 1e9; V.maxHp = 1e9; V.hp = prevHp;
      b.simT = 0; b.result = null; b.phase = 'fight';
      b.update(1 / 60);
      let d = A.weaponAngle - prevAng;
      while (d < -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      turns += Math.abs(d) / (Math.PI * 2);
      prevAng = A.weaponAngle;
      if (V.hp < prevHp) { hits++; prevHp = V.hp; }
    }
    return { hits: hits, turns: turns };
  };
  const plain = sweep([]);
  const fast = sweep(['rot15', 'rot15', 'rot15', 'rot15']);
  assert.ok(Math.abs(plain.hits / plain.turns - 1) < 0.12,
    '한 바퀴에 한 번이어야 한다 (실제 ' + (plain.hits / plain.turns).toFixed(2) + ')');
  assert.ok(Math.abs(fast.hits / fast.turns - 1) < 0.12,
    '빨라져도 한 바퀴에 한 번이어야 한다 (실제 ' + (fast.hits / fast.turns).toFixed(2) + ')');
  assert.ok(fast.hits > plain.hits * 2,
    '회전이 150% 빨라지면 타격 수도 그만큼 늘어야 한다 (' + plain.hits + ' -> ' + fast.hits + ')');
});


test('좌하단 스탯판 자리가 경기장 밖 빈 공간에 들어간다', () => {
  // render.js의 drawStatPanel과 같은 비율. 마름모 안으로 들어가면 경기를 가린다.
  const WORLD_BOX = 840, REF = 405;
  for (const L of [405, 320]) {
    const padX = L * 0.024, padY = L * 0.022;
    const x = -L + padX, y = L * 0.62 + padY, rowH = L * 0.062, w = L * 0.532;
    const left = x - padX, right = x + w + padX;
    const top = y - padY, bottom = y + rowH * 5 + padY;
    const half = WORLD_BOX * (L / REF) / 2;
    const corners = [[left, top], [right, top], [left, bottom], [right, bottom]];
    for (const [px, py] of corners) {
      assert.ok(Math.abs(px) + Math.abs(py) > L,
        'L=' + L + ': 스탯판 모서리 (' + Math.round(px) + ',' + Math.round(py) + ')가 경기장 안으로 들어간다');
      assert.ok(Math.abs(px) <= half && Math.abs(py) <= half,
        'L=' + L + ': 스탯판 모서리가 화면 밖으로 나간다');
    }
  }
});


test('전투원의 st는 만들어진 순간부터 모양이 완전하다', () => {
  // 조준 단계에는 computeStats가 아직 안 돈다. 그 사이에도 화면이 st를 읽으므로
  // 키 하나라도 비어 있으면 게임 시작하자마자 그리기가 죽는다.
  const b = makeBattle({ weaponId: 'sword' }, { weaponId: 'bow' });
  const fresh = b.fighters[0];
  assert.equal(b.phase, 'fight', '이 헬퍼는 fight로 맞춰 준다');
  const raw = new Battle('diamond', [makePlayer({}), makePlayer({ isAI: true })]);
  assert.equal(raw.phase, 'count', '전투는 카운트다운에서 시작한다');
  for (const f of raw.fighters) {
    for (const key of ['atk', 'dmg', 'move', 'rot', 'fr', 'aspd', 'size']) {
      assert.equal(typeof f.st[key], 'number', 'st.' + key + '이 없으면 카운트다운에서 화면이 죽는다');
      assert.ok(isFinite(f.st[key]), 'st.' + key + '이 숫자가 아니다');
    }
  }
  // computeStats가 돈 뒤에도 키 구성이 같아야 한다
  computeStats(fresh);
  const before = Object.keys(raw.fighters[0].st).sort();
  const after = Object.keys(fresh.st).sort();
  assert.deepEqual(before, after, '초기 st와 계산된 st의 키가 달라지면 안 된다');
});

test('조향은 0.25초 램프업 후 초당 50도 이하로 방향만 휘고 속도는 보존한다', () => {
  const b = makeBattle({ weaponId: 'sword' });
  const f = b.fighters[0];
  f.vx = 0.37; f.vy = 0;
  const originalLen = Math.hypot(f.vx, f.vy);
  assert.equal(setSteerInput(f, Math.PI / 2, 1), true);

  for (let i = 0; i < 15; i++) applySteering(f, 1 / 60);
  const rampAngle = Math.atan2(f.vy, f.vx);
  assert.ok(rampAngle > 5 * Math.PI / 180 && rampAngle < 9 * Math.PI / 180,
    '첫 0.25초는 최대 조향력보다 약해야 한다: ' + rampAngle * 180 / Math.PI);

  for (let i = 0; i < 45; i++) applySteering(f, 1 / 60);
  const oneSecondAngle = Math.atan2(f.vy, f.vx);
  assert.ok(oneSecondAngle < STEER_MAX_RAD + 1e-9,
    '1초 동안 최대 50도를 넘어 즉시 방향을 덮어쓰면 안 된다');
  assert.ok(oneSecondAngle > 40 * Math.PI / 180,
    '램프업 뒤에는 실제로 강한 조향력이 나와야 한다');
  assert.ok(Math.abs(Math.hypot(f.vx, f.vy) - originalLen) < 1e-12,
    '조향은 속도 벡터의 길이를 바꾸면 안 된다');

  clearSteerInput(f);
  const released = Math.atan2(f.vy, f.vx);
  applySteering(f, 1);
  assert.ok(Math.abs(angleDelta(released, Math.atan2(f.vy, f.vx))) < 1e-12,
    '손을 놓으면 마지막 진행 방향을 그대로 유지해야 한다');
});

test('스틱 세기와 벽 반사 잠금이 조향에 정확히 반영된다', () => {
  const weak = makeBattle().fighters[0];
  weak.vx = 1; weak.vy = 0;
  setSteerInput(weak, Math.PI / 2, 0.5);
  weak.steer.power = 1;
  applySteering(weak, 1);
  assert.ok(Math.abs(Math.atan2(weak.vy, weak.vx) - 25 * Math.PI / 180) < 1e-9,
    '스틱 절반 입력은 조향속도도 정확히 절반이어야 한다');

  const b = makeBattle();
  const f = b.fighters[0];
  computeStats(f);
  f.x = b.arena.H - f.radius - 0.1; f.y = 0; f.vx = 1; f.vy = 0;
  setSteerInput(f, Math.PI / 2, 1);
  f.steer.power = 1;
  moveFighter(b, f, 1 / 60);
  assert.ok(f.vx < 0, '조향 중에도 벽의 물리 반사가 우선되어야 한다');
  assert.ok(f.steer.lock >= STEER_BOUNCE_LOCK - 1e-9, '반사 직후 조향 잠금이 걸려야 한다');
  const reflected = Math.atan2(f.vy, f.vx);
  for (let i = 0; i < 8; i++) moveFighter(b, f, 1 / 60);
  assert.ok(Math.abs(angleDelta(reflected, Math.atan2(f.vy, f.vx))) < 1e-9,
    '반사 직후 0.15초 동안 진행 방향을 다시 휘면 안 된다');
  for (let i = 0; i < 3; i++) moveFighter(b, f, 1 / 60);
  assert.ok(Math.abs(angleDelta(reflected, Math.atan2(f.vy, f.vx))) > 1e-5,
    '잠금이 끝난 뒤에는 누르고 있던 조향이 다시 적용되어야 한다');
});

test('로켓·돌진·스턴·속박 중에는 조향이 진행 방향에 개입하지 않는다', () => {
  const b = makeBattle();
  const f = b.fighters[0];
  setSteerInput(f, Math.PI / 2, 1);
  f.steer.power = 1;
  const blockedCases = [
    () => { f.rocketActive = true; },
    () => { f.timers.dashPrep = 1; },
    () => { f.timers.dashT = 1; f.dash = { dx: 1, dy: 0, spd: 690, kind: 'rush' }; },
    () => { f.timers.stun = 1; },
    () => { f.timers.bind = 1; },
  ];
  for (const setup of blockedCases) {
    f.rocketActive = false;
    f.timers.dashPrep = f.timers.dashT = f.timers.stun = f.timers.bind = 0;
    f.dash = null; f.vx = 1; f.vy = 0;
    setup();
    applySteering(f, 0.2);
    assert.ok(Math.abs(f.vy) < 1e-12, '강제 이동 또는 행동 불가 상태에서 방향이 바뀌었다');
  }
});

test('AI도 순간 방향전환 없이 0.4~0.7초마다 불완전한 조향 목표만 갱신한다', () => {
  const b = makeBattle({}, { weaponId: 'sword', isAI: true });
  const ai = b.fighters[1];
  assert.equal(ai.skillUses.common, 0, '카피 없는 AI에게 삭제된 방향전환 횟수가 남으면 안 된다');
  ai.vx = -1; ai.vy = 0; ai.aiSteerT = 0;
  const beforeX = ai.vx, beforeY = ai.vy;
  aiUpdate(b, ai, 1 / 60);
  assert.equal(ai.vx, beforeX);
  assert.equal(ai.vy, beforeY);
  assert.equal(ai.steer.active, true, 'AI가 조향 목표를 잡아야 한다');
  assert.ok(ai.steer.magnitude >= 0.72 && ai.steer.magnitude <= 0.96,
    'AI 조향은 항상 완벽한 최대 입력이면 안 된다');
  assert.ok(ai.aiSteerT >= 0.4 && ai.aiSteerT <= 0.7,
    'AI 조향 판단 간격은 0.4~0.7초여야 한다');
});

test('추가 배터리와 공용 스킬 횟수는 카피 스킬이 있을 때만 생긴다', () => {
  const noCopy = makePlayer({ augments: ['battery'] });
  assert.equal(augEligible(AUG_BY_ID.battery, noCopy), false);
  const copiedCandidate = makePlayer({ copiedSkill: 'cat' });
  assert.equal(augEligible(AUG_BY_ID.battery, copiedCandidate), true);
  const copied = makePlayer({ copiedSkill: 'cat', augments: ['battery'] });
  const b = new Battle('square', [noCopy, copied]);
  assert.equal(b.fighters[0].skillUses.common, 0);
  assert.equal(b.fighters[1].skillUses.common, 2);
});


test('AI 증강 선택은 실측 성향과 그 판의 사정을 함께 본다', () => {
  const pick = (ids, player) => {
    const offers = ids.map(id => AUG_BY_ID[id]);
    const counts = {};
    for (let i = 0; i < 3000; i++) {
      const got = aiPickAugment(offers, player);
      counts[got.id] = (counts[got.id] || 0) + 1;
    }
    return counts;
  };
  const base = { augments: [], coins: 5, coinsLost: 0, rounds: 1 };

  // 무기 전용은 실측 승률이 압도적이다. 나오면 대부분 집어야 한다.
  const w = pick(['w_giant', 'winMomentum', 'copy_cat'], { ...base, weaponId: 'sword' });
  assert.ok(w.w_giant > w.winMomentum * 2, '무기 전용을 확실히 선호해야 한다 (실제 ' + JSON.stringify(w) + ')');

  // 코인이 곧 목숨이다. 여유가 없으면 코인을 거는 증강을 피한다.
  const rich = pick(['devilDeal', 'hp15'], { ...base, coins: 5 });
  const poor = pick(['devilDeal', 'hp15'], { ...base, coins: 1 });
  assert.ok(poor.devilDeal < rich.devilDeal / 2,
    '코인이 없을 때 악마와의 거래를 덜 집어야 한다 (여유 ' + rich.devilDeal + ' → 위기 ' + poor.devilDeal + ')');
  // 반대로 벼랑 끝은 코인이 없을 때가 제철이다
  const brinkPoor = pick(['brink', 'hp15'], { ...base, coins: 1 });
  const brinkRich = pick(['brink', 'hp15'], { ...base, coins: 5 });
  assert.ok(brinkPoor.brink > brinkRich.brink, '벼랑 끝은 코인이 적을 때 값어치가 크다');

  // 조건이 붙은 것은 조건을 갖췄을 때만 집는다
  const noCd = pick(['autoExpert', 'hp15'], { ...base });
  const withCd = pick(['autoExpert', 'hp15'], { ...base, augments: ['missile', 'shuriken'] });
  assert.ok(withCd.autoExpert > noCd.autoExpert * 2,
    '쿨타임 증강이 없으면 자동화 전문가를 피해야 한다 (없을 때 ' + noCd.autoExpert + ' → 있을 때 ' + withCd.autoExpert + ')');

  // 누적형은 끝물에 집어봐야 쌓일 시간이 없다
  const early = pick(['winMomentum', 'hp15'], { ...base, rounds: 1 });
  const late = pick(['winMomentum', 'hp15'], { ...base, rounds: 7 });
  assert.ok(late.winMomentum < early.winMomentum, '끝물에는 누적형을 덜 집어야 한다');
});

console.log('\\n' + passed + '개 시뮬레이션 테스트 통과');
`,
].join('\n');

let playerId = 0;
const context = vm.createContext({ console, __assert: assert, __playerId: playerId });
vm.runInContext(source, context, { filename: 'bounce-royal-sim.test.bundle.js' });
