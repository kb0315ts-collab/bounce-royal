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
    [20, 60, 2.6],
  );
  // 방패는 검보다 빨리 돈다 — 던질 방향을 잡을 기회가 그만큼 자주 온다
  assert.deepEqual([WEAPONS.shield.dmg, WEAPONS.shield.reach, WEAPONS.shield.rot], [15, 42, 3.3]);
  assert.deepEqual(
    [WEAPONS.dagger.dmg, WEAPONS.dagger.reach, WEAPONS.dagger.rot],
    [18, 30, 5.8],
  );
  assert.deepEqual([WEAPONS.bow.dmg, WEAPONS.bow.interval, WEAPONS.bow.projSpeed], [8, 1.5, 300]);
  assert.deepEqual([WEAPONS.pistol.dmg, WEAPONS.pistol.burst, WEAPONS.pistol.shotGap, WEAPONS.pistol.reload], [3, 6, 0.12, 3]);
  // 확장 탄창은 +3발
  assert.equal(makeBattle({ weaponId: 'pistol' }).fighters[0].gun.mag, 6);
  assert.equal(makeBattle({ weaponId: 'pistol', augments: ['p_mag'] }).fighters[0].gun.mag, 9);
  assert.deepEqual([WEAPONS.staff.dmg, WEAPONS.staff.interval], [12, 2.5]);
  assert.deepEqual([WEAPONS.mine.dmg, WEAPONS.mine.interval], [10, 3.5]);
  assert.equal(WEAPONS.mine.maxMines, undefined, '지뢰 설치 개수 제한은 없앴다');
});

test('기획 증강 96종이 중복 ID 없이 등록되고 삭제 항목은 풀에서 빠진다', () => {
  assert.equal(AUGMENTS.length, 103, '신규 무기 3종의 전용 증강 9개가 더해져 102, 몰락한 강자를 빼 101, 반발심·가시목줄을 더해 103이다');
  assert.equal(new Set(AUGMENTS.map(a => a.id)).size, 103);
  // 새로 들어온 것과 이름이 바뀐 것
  for (const id of ['p_shotgun', 's_double']) assert.ok(AUG_BY_ID[id], id);
  for (const id of ['rampage20', 'seasonedExp', 'trollCondition', 'sleepGas',
    'berserker', 'desperateSpin', 'brink', 'autoExpert']) assert.ok(AUG_BY_ID[id], id);
  for (const id of ['motionSickness',
    // 스킬 슬롯을 둘로 고정하며 카피 계열과 사용 횟수 증강을 통째로 뺐다
    'copy_cat', 'copy_wak', 'copy_soft', 'copy_bomb', 'copy_bball', 'copy_balloon',
    'battery', 'weaponMastery', 'talent',
    'p_dual', 's_triple', 'pinball', 'winAccel',
    'crit', 'lateFocus', 'slowStart', 'bloodThirst', 'coinHeal', 'phoenix', 'hastePact',
    'equalTrade', 'rotFreak', 'tank', 'berserkEngine', 'collisionGuard', 'cycler', 'pushAug', 'stickyTrail',
    'sacrifice', 'deathBoom', 'revengeSpeed', 'multiSystem', 'overHeal', 'rotPower', 'w_guard', 'powerReward',
    'fallenPower']) {
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

/* 누르면 모으고 떼면 나간다. 최소 0.2초는 모아야 발사된다 —
 * 그 전에 떼면 아무 일도 없고 횟수도 그대로다. */
test('활 차지 샷은 0.2초를 모아야 나가고 그때 쿨타임이 돈다', () => {
  const b = makeBattle({ weaponId: 'bow' });
  const f = b.fighters[0];
  assert.equal(useSkill(b, f, 'weapon'), true, '누르면 충전이 시작된다');
  assert.equal(f.skillUses.cd, 0, '충전만으로는 쿨타임이 돌지 않는다');
  updateTimers(b, f, 0.19);
  assert.equal(useSkill(b, f, 'weapon'), false, '0.2초를 못 모으고 떼면 안 나간다');
  assert.equal(f.skillUses.cd, 0);
  updateTimers(b, f, 0.02);
  assert.equal(useSkill(b, f, 'weapon'), true);
  assert.equal(f.skillUses.cd, WEAPON_SKILL_CD.bow, '쏜 순간부터 쿨타임이 돈다');
  const charge = b.projectiles.find(p => p.kind === 'charge');
  assert.ok(charge);
  assert.equal(charge.dmg, WEAPONS.bow.chargeDmg);
  assert.equal(WEAPONS.bow.chargeDmg, 15);
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
  // 회전은 GAME_SPEED만큼 느리고 지속시간(1.5초)은 실시간이라, 바퀴 수는
  // '초당 2바퀴 x 1.5초 x 경기 진행 속도'가 기준이 된다.
  const expectRev = 2 * 1.5 * GAME_SPEED;
  assert.ok(turned > Math.PI * 2 * expectRev * 0.85,
    '난사 중 여러 바퀴 돌아야 한다 (기대 ' + expectRev.toFixed(1) +
    '바퀴 안팎, 실제 ' + (turned / (Math.PI * 2)).toFixed(1) + '바퀴)');
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
  // 두 바퀴라는 '회전량'은 그대로고, 회전이 GAME_SPEED만큼 느리니 걸리는
  // 시간만 그만큼 늘어난다.
  const expectTicks = 60 / GAME_SPEED;
  assert.ok(guard >= expectTicks - 2 && guard <= expectTicks + 3,
    '두 바퀴는 약 ' + expectTicks.toFixed(0) + '틱이어야 한다 (실제 ' + guard + '틱)');
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
  // 스킬이 속도를 건드리지 않는다는 확인이다. 실제 날아가는 속도에는
  // 경기 진행 속도(GAME_SPEED)가 곱해진다.
  assert.ok(Math.abs(p.x - WEAPONS.staff.projSpeed * GAME_SPEED * 0.1) < 1e-9,
    '이동속도는 변하면 안 된다');
  updateTimers(b, f, 3.01);
  const x = p.x;
  b.updateProjectiles(0.01);
  assert.equal(p.r, 9);
  assert.equal(fresh.r, 9);
  assert.ok(Math.abs(p.x - x - WEAPONS.staff.projSpeed * GAME_SPEED * 0.01) < 1e-9,
    '폭주가 끝나도 속도는 그대로다');
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
  assert.equal(beforeDash - dashTarget.hp, WEAPONS.dagger.dashDmg);
  assert.equal(WEAPONS.dagger.dashDmg, 22);

  const bayonetBattle = makeBattle({ weaponId: 'pistol', augments: ['p_bayonet'] });
  const [gunner, bayonetTarget] = bayonetBattle.fighters;
  computeStats(gunner); computeStats(bayonetTarget);
  gunner.x = gunner.y = 0; gunner.weaponAngle = 0; gunner.gun.reloadT = 1;
  bayonetTarget.x = 45; bayonetTarget.y = 0;
  const beforeBayonet = bayonetTarget.hp;
  updateWeapon(bayonetBattle, gunner, 1 / 60);
  assert.equal(beforeBayonet - bayonetTarget.hp, 10);

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
  assert.ok(spreadBattle.projectiles.every(p => p.dmg === WEAPONS.bow.dmg * 0.5),
    '트리플 샷은 갈래가 셋인 대신 발당 피해가 절반이다');
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

/* 연승만 소급이다. '지금 몇 연승 중인가'가 곧 그 증강의 값이라 늦게 집었다고
 * 진행 중인 연승을 못 본 척할 수 없다. 반대로 단순 누적형까지 소급해 주면
 * 늦게 집을수록 공짜로 세지므로, 그쪽은 집은 뒤로 쌓은 것만 센다. */
test('연승 증강만 진행 중인 연승을 받고 나머지 누적형은 집은 뒤부터 센다', () => {
  const p = makePlayer({ wins: 3, losses: 2, streak: 3, rounds: 5, coinsLost: 2 });
  applyAugmentPick(p, AUG_BY_ID.bloodRush);     // 연승마다 +6% — 소급
  applyAugmentPick(p, AUG_BY_ID.winMomentum);   // 승리마다 +4% — 집은 뒤부터
  applyAugmentPick(p, AUG_BY_ID.seasonedExp);   // 라운드마다 +3% — 집은 뒤부터
  let b = new Battle('square', [p, makePlayer({ isAI: true })]);
  let f = b.fighters[0];
  assert.ok(Math.abs(f.perm.atk - 1.18) < 1e-9,
    '진행 중인 3연승만 즉시 반영된다 (실제 ' + f.perm.atk + ')');

  p.wins++; p.streak++; p.rounds++; p.coinsLost++;
  b = new Battle('square', [p, makePlayer({ isAI: true })]);
  f = b.fighters[0];
  assert.ok(Math.abs(f.perm.atk - 1.24 * 1.04 * 1.03) < 1e-9,
    '연승은 4연승 전체, 나머지는 집은 뒤로 1씩 (실제 ' + f.perm.atk + ')');

  // 패배하면 연승은 끊기고, 집은 뒤로 쌓은 승수는 남는다
  p.losses++; p.streak = 0;
  p.wins++; p.streak = 1;
  b = new Battle('square', [p, makePlayer({ isAI: true })]);
  f = b.fighters[0];
  assert.ok(Math.abs(f.perm.atk - 1.06 * 1.08 * 1.03) < 1e-9,
    '연승은 1로 끊기고 집은 뒤 승수는 2로 남는다 (실제 ' + f.perm.atk + ')');
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
  assert.ok(Math.abs(f.cd.gasT - 12 * 0.7) < 1e-9, '12초에서 30% 줄어든 8.4초');
  // 자동화 전문가가 없으면 첫 발동도, 다음 발동도 12초
  const plain = makeBattle({ augments: ['sleepGas'] });
  const [g] = plain.fighters;
  computeStats(g);
  assert.equal(g.cd.gasT, 12, '전투 시작 12초 뒤 첫 발동');
  g.cd.gasT = 0;
  autoSystems(plain, g, 1 / 60);
  assert.equal(g.cd.gasT, 12, '그 뒤 12초마다');

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
  assert.equal(auto.cd.missile, 4, '유도 미사일은 4초마다');
  assert.equal(makeBattle({ augments: ['missile'] }).fighters[0].cd.missile, 4, '첫 발사도 4초 뒤');
  assert.equal(autoBattle.flames[0].life, 2);

  const legionBattle = makeBattle({ augments: ['miniBall', 'legion'] });
  const minion = legionBattle.fighters[0].summons[0];
  // 군단: 소환수 체력·피해·크기 +50%
  assert.equal(minion.maxHp, 45);
  assert.equal(minion.dmg, 15);
  assert.ok(Math.abs(minion.r - 19.5) < 1e-9);
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
  // 경기 진행 속도만큼 느리게 나아가므로, 같은 거리를 보려면 시간을 그만큼 준다.
  const dt = 0.3 / GAME_SPEED;
  const ordinaryDistance = CHARACTERS.cat.move * WEAPONS.sword.moveMult * GAME_SPEED * dt;
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
  const augments = ['split', 'atk15', 'p_shotgun', 'missile'];
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
  firstClone.gun.burst = 2;                     // 샷건은 남은 탄창을 한 번에 뿌린다
  updateWeapon(b, firstClone, 0.01);
  assert.equal(b.projectiles.length, 2, '분열체도 실제 무기 업데이트로 샷건을 뿌려야 한다');
  assert.ok(b.projectiles.every(p => p.owner === firstClone), '분열체가 만든 탄환은 분열체를 소유자로 기록해야 한다');

  // 분열 직후 잠깐 무적은 아래 따로 본다. 여기서는 빌드 복제와 사망 처리를 본다.
  for (const clone of f.splitBalls) clone.timers.immune = 0;
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

/* 흡혈 폭주·출혈·서리·연격 가속 같은 '무기 적중' 효과는 weaponDamage를 거쳐야 붙는다.
 * 화염방사기만 그 길을 건너뛰어 하나도 안 터지고 있었다. 무기마다 실제 공격 경로로
 * 한 대 때려, 빠지는 무기가 없는지 본다. */
function weaponHit(weaponId, augments) {
  const b = makeBattle({ weaponId, augments }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0; f.weaponAngle = 0;
  e.x = 40; e.y = 0; e.vx = 0; e.vy = 0; e.st.move = 0; e.maxHp = e.hp = 1e6;
  e._motionX = e.x; e._motionY = e.y;
  f.maxHp = 200; f.hp = 100;
  const shoot = () => {
    for (let i = 0; i < 240 && !b.projectiles.length; i++) updateWeapon(b, f, 1 / 60);
    assert.ok(b.projectiles.length, weaponId + ': 발사되지 않았다');
    for (const p of b.projectiles) { p.x = e.x; p.y = e.y; p.spd = 0; }
    b.updateProjectiles(1 / 120);
  };
  const attacks = {
    sword: () => meleeHits(b, f, 1 / 60),
    dagger: () => meleeHits(b, f, 1 / 60),
    shield: () => meleeHits(b, f, 1 / 60),
    bow: shoot, pistol: shoot, staff: shoot,
    flame: () => {
      f.steer = { active: true, angle: 0, magnitude: 1 }; f.flame.aim = 0; f.flame.fuel = 100;
      setFlameInput(f, true);
      updateFlame(b, f, 1 / 60);
    },
    mine: () => {
      for (let i = 0; i < 300 && !b.mines.length; i++) updateWeapon(b, f, 1 / 60);
      assert.ok(b.mines.length, '지뢰가 놓이지 않았다');
      const m = b.mines[0];
      m.arm = 0; m.x = e.x; m.y = e.y;
      b.updateMines(1 / 60);
    },
    chain: () => {
      ensureChainHeads(f);
      const h = f.chainHeads[0], at = { x: e.x, y: e.y - 60 };
      h.attach = Math.atan2(at.y - f.y, at.x - f.x);
      const a0 = chainAttach(f, h);
      Object.assign(h, { x: at.x, y: at.y, vx: 0, vy: 1800 });
      h.nodes.forEach((n, i) => {
        const t = (i + 1) / 5;
        Object.assign(n, { x: a0.x + (at.x - a0.x) * t, y: a0.y + (at.y - a0.y) * t, vx: 0, vy: 1800 * t });
      });
      updateChain(b, f, 0.1);
    },
  };
  const before = { hp: f.hp, enemy: e.hp };
  attacks[weaponId]();
  return { b, f, e, healed: f.hp - before.hp, dealt: before.enemy - e.hp };
}

test('흡혈 폭주와 출혈은 모든 무기의 기본 공격에서 터진다 — 화염방사기만 빠져 있었다', () => {
  for (const weaponId of ['sword', 'dagger', 'shield', 'bow', 'pistol', 'staff', 'mine', 'chain', 'flame']) {
    const { f, e, healed, dealt } = weaponHit(weaponId, ['vampiric', 'd_bleed']);
    assert.ok(dealt > 0, weaponId + ': 맞히지 못했다');
    assert.ok(Math.abs(healed - f.maxHp * 0.04) < 1e-9, weaponId + ': 흡혈 폭주가 안 터졌다 (회복 ' + healed + ')');
    assert.ok(e.bleed.n > 0, weaponId + ': 출혈이 안 묻었다');
  }
});

test('분열시킨 그 공격은 갓 태어난 분열체를 곧장 잡지 못한다', () => {
  const b = makeBattle({ augments: ['split'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; e.x = 40; e.y = 0; e.weaponAngle = Math.PI; e.meleeContact = new Set();
  // 칼날을 댄 채로 본체를 잡는다 — 분열체는 그 칼날 위에서 태어난다
  weaponDamage(b, e, f, f.maxHp * 10);
  assert.equal(f.mainDead, true);
  assert.equal(f.splitBalls.length, 2);
  for (const clone of f.splitBalls) {
    assert.ok(Math.abs(clone.timers.immune - 0.6) < 1e-9, '0.6초 무적으로 태어난다');
    clone.x = 0; clone.y = 0;                  // 칼날 한가운데에 그대로 둔다
  }
  const hp = f.splitBalls.map(c => c.hp);
  for (let i = 0; i < 30; i++) { meleeHits(b, e, 1 / 60); e.meleeContact.clear(); }
  assert.deepEqual(f.splitBalls.map(c => c.hp), hp, '분열 직후 0.5초 동안은 그 칼날에 안 맞는다');
  assert.equal(f.splitBalls.length, 2, '둘 다 살아 있다');
  // 무적이 끝나면 평소대로 맞는다
  for (const clone of f.splitBalls) updateTimers(b, clone, 0.7);
  meleeHits(b, e, 1 / 60);
  assert.ok(f.splitBalls.length < 2 || f.splitBalls.some(c => c.hp < hp[0]), '무적이 끝나면 맞는다');
});

/* 샷건 — 쫓아가며 한 발씩 맞히는 대신 남은 탄창을 한순간에 건다.
 * 빗나가면 통째로 빗나간다. */
test('샷건은 남은 탄창을 부채꼴로 한 번에 뿌리고 곧바로 재장전한다', () => {
  const b = makeBattle({ weaponId: 'pistol', augments: ['p_shotgun'] });
  const f = b.fighters[0];
  computeStats(f);
  f.weaponAngle = 0.37;
  f.gun.reloadT = 0; f.gun.burst = 5; f.gun.shotT = 0.001;
  updateWeapon(b, f, 0.01);

  assert.equal(b.projectiles.length, 5, '남은 탄창 수만큼 한 번에 나가야 한다');
  assert.equal(f.gun.burst, 0, '한 번에 다 썼으니 탄창이 비어야 한다');
  assert.ok(f.gun.reloadT > 0, '쏘자마자 재장전에 들어가야 한다');
  assert.ok(b.projectiles.every(p => p.dmg === WEAPONS.pistol.dmg), '발당 피해는 그대로다');

  const offs = b.projectiles.map(p => {
    let d = Math.atan2(p.vy, p.vx) - f.weaponAngle;
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    return d;
  });
  assert.ok(Math.min(...offs) < -0.15 && Math.max(...offs) > 0.15,
    '겨눈 방향을 가운데 두고 좌우로 갈라져야 한다 (실제 ' + offs.map(o => o.toFixed(2)).join(', ') + ')');
  assert.ok(offs.every(o => Math.abs(o) < 0.35), '부채꼴이 지나치게 벌어지면 안 된다');
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
  assert.deepEqual(b.arena.pillars.map(p => p.r), [21, 21], '쌍둥이 기둥은 예전(42)의 절반 굵기');
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
    for (let i = 0; i < 60 * (BATTLE_TIME + 10) && !b.finished; i++) b.update(1 / 60);
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
      for (let step = 0; step < 60 * (BATTLE_TIME + 10) && !b.result; step++) b.update(1 / 60);
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

test('전투는 연장전 없이 실시간 45초 동안 1배속으로 진행되고 끝나면 체력 비율로 판정한다', () => {
  assert.equal(BATTLE_TIME, 45, '전투는 45초여야 한다');
  const b = makeBattle({ isAI: true }, { isAI: true });
  // 판정 전에 KO로 끝나지 않도록 체력만 크게 잡는다
  for (const f of b.fighters) { f.maxHp = 1e9; f.hp = 1e9; }
  const RDT = 1 / 60;
  let fightTicks = 0, clockOk = true;
  for (let i = 0; i < 60 * 120 && !b.result; i++) {
    const phase = b.phase, before = b.simT;
    b.update(RDT);
    if (phase === 'fight') {
      fightTicks++;
      if (!b.result && Math.abs(b.simT - before - RDT) > 1e-9) clockOk = false;
    }
  }
  assert.ok(b.result, '시간이 다 되면 전투가 끝나야 한다');
  assert.equal(b.result.reason, '체력 비율 판정');
  assert.ok(Math.abs(fightTicks * RDT - BATTLE_TIME) < 0.1, '전투는 실시간 45초여야 한다 (' + (fightTicks * RDT).toFixed(2) + ')');
  assert.ok(clockOk, '끝날 때까지 시계가 가속 없이 1배속으로 흐른다');
  assert.equal(b.overtime, undefined, '연장전 상태가 없다');
});

test('장기전 체질은 전투 30초에 잃은 체력의 절반을 한 번 회복한다', () => {
  const b = makeBattle({ isAI: true, augments: ['marathoner'] }, { isAI: true });
  const [f] = b.fighters;
  for (const x of b.fighters) { x.maxHp = 1e9; x.hp = 1e9; }
  f.hp = f.maxHp * 0.4;
  const RDT = 1 / 60;
  b.phase = 'fight'; b.simT = MARATHON_TIME - 0.5;
  // 회복 직전에는 그대로
  for (let i = 0; i < 20; i++) { b.update(RDT); for (const x of b.fighters) { x.vx = 0; x.vy = 0; } }
  const early = f.hp;
  assert.ok(Math.abs(early - f.maxHp * 0.4) < f.maxHp * 0.001, '30초 전에는 회복하지 않는다');
  for (let i = 0; i < 20; i++) b.update(RDT);
  assert.ok(Math.abs(f.hp - f.maxHp * 0.7) < f.maxHp * 0.01, '30초에 잃은 체력(60%)의 절반을 회복한다: ' + (f.hp / f.maxHp).toFixed(3));
  const after = f.hp;
  f.hp = f.maxHp * 0.5;
  for (let i = 0; i < 60; i++) b.update(RDT);
  assert.ok(f.hp <= f.maxHp * 0.5 + f.maxHp * 0.001, '한 번만 회복한다');
  assert.ok(after > early);
});

// 표적을 칼날 앞에 고정한 채 공격자만 회전시켜 타격 횟수를 센다
function meleeTrial(weaponId, dist, seconds, opts = {}) {
  const b = makeBattle({ weaponId, augments: opts.augments || [] }, { isAI: true });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.weaponAngle = opts.startAngle === undefined ? -1.6 : opts.startAngle;
  e.maxHp = 1e9; e.hp = 1e9;
  let prev = e.hp, hits = 0, onBlade = 0, left = false;
  // 이 시험들은 '몇 바퀴 도는 동안'을 보는 것이지 벽시계를 보는 게 아니다.
  // 회전이 GAME_SPEED만큼 느려졌으니 창도 그만큼 늘려야 같은 바퀴 수가 돈다.
  const ticks = Math.round(60 * seconds / GAME_SPEED);
  for (let i = 0; i < ticks; i++) {
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
  // 근접: 공격속도가 오른 만큼을 1.5배로 받아 회전속도가 된다.
  // 조우가 짧아 회전이 조금 빨라져도 결국 한 번 스치고 끝나기 때문이다.
  // 예전에는 2배였는데, 속사를 겹칠수록 근접만 과하게 올라가서 낮췄다.
  for (const weaponId of ['sword', 'dagger']) {
    const base = makeBattle({ weaponId }).fighters[0];
    computeStats(base);
    const fast = makeBattle({ weaponId, augments: ['rot15', 'rot15'] }).fighters[0];
    computeStats(fast);
    assert.ok(Math.abs(fast.st.aspd - base.st.aspd * 1.15 * 1.15) < 1e-9, weaponId + ' 공격속도 배율');
    const expected = WEAPONS[weaponId].rot * (1 + (fast.st.aspd - 1) * MELEE_ASPD_GAIN);
    assert.ok(Math.abs(fast.st.rot - expected) < 1e-9,
      weaponId + '은 공격속도 증가분을 배로 얹어 받아야 한다 (기대 ' + expected.toFixed(3) + ' 실제 ' + fast.st.rot.toFixed(3) + ')');
    assert.ok(fast.st.rot > base.st.rot, weaponId + '은 공격속도가 오르면 더 빨리 회전해야 한다');

    // 한 단계만 올려도 눈에 띄어야 한다 (속사 하나 = 회전 +22.5%)
    const one = makeBattle({ weaponId, augments: ['rot15'] }).fighters[0];
    computeStats(one);
    assert.ok(Math.abs(one.st.rot - WEAPONS[weaponId].rot * (1 + 0.15 * MELEE_ASPD_GAIN)) < 1e-9,
      weaponId + ': 속사 하나면 회전 +22.5%여야 한다');

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
    // 근접은 공격속도 증가분을 MELEE_ASPD_GAIN(1.5)배로 받는다: 1.15 -> 1.225
    assert.ok(Math.abs(rotOf(weaponId, ['rot15']) - base * (1 + 0.15 * MELEE_ASPD_GAIN)) < 1e-9,
      weaponId + ': 속사 하나면 회전속도 +22.5%여야 한다');
    assert.ok(Math.abs(rotOf(weaponId, ['rot15', 'rot15']) - base * (1 + (1.15 * 1.15 - 1) * MELEE_ASPD_GAIN)) < 1e-9,
      weaponId + ': 속사가 쌓이면 증가분도 함께 배로 커져야 한다');
  }

  // 붙어 있을 때 회전 한 바퀴에 정확히 한 번 맞는다 (빠를수록 그만큼 더 때린다)
  const sweep = augments => {
    const b = makeBattle({ weaponId: 'sword', augments: augments });
    const A = b.fighters[0], V = b.fighters[1];
    const gap = A.radius + V.radius + 6;
    A.weaponAngle = 0;                       // 무작위 시작 각도를 고정한다
    let hits = 0, turns = 0, prevAng = A.weaponAngle, prevHp = 1e9;
    for (let i = 0; i < 60 * 40; i++) {      // 5.7바퀴로는 앞뒤 반 바퀴가 통계를 흔든다
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

test('이동속도가 오른 만큼 조향도 1:1로 오르고, 느려지거나 원래 빠른 무기는 그대로다', () => {
  // 1초 동안 스틱을 90도 쪽으로 끝까지 당겼을 때 꺾인 각도(도)
  const turned = (setup, simT = 0) => {
    const b = makeBattle(setup);
    b.simT = simT;
    const f = b.fighters[0];
    computeStats(f);
    f.vx = 1; f.vy = 0;
    setSteerInput(f, Math.PI / 2, 1);
    f.steer.power = 1;
    applySteering(f, 1);
    return { deg: Math.atan2(f.vy, f.vx) * 180 / Math.PI, f };
  };
  assert.ok(Math.abs(turned({}).deg - 50) < 1e-9, '기본은 초당 50도');
  assert.ok(Math.abs(turned({ augments: ['move15'] }).deg - 57.5) < 1e-9, '가벼운 몸(+15%)이면 57.5도');
  assert.ok(Math.abs(turned({ augments: ['move15', 'move15'] }).deg - 50 * 1.15 * 1.15) < 1e-9, '두 번 먹으면 곱으로');
  assert.ok(Math.abs(turned({ augments: ['speedster'] }, 10).deg - 55) < 1e-9, '속도광 10초(+10%)면 55도');
  assert.ok(Math.abs(turned({ weaponId: 'dagger' }).deg - 50) < 1e-9, '원래 빠른 무기(단검)는 더 돌지 않는다');
  const frozen = makeBattle({ augments: ['move15'] }).fighters[0];
  frozen.timers.freeze = 1; computeStats(frozen);
  frozen.vx = 1; frozen.vy = 0; setSteerInput(frozen, Math.PI / 2, 1); frozen.steer.power = 1;
  applySteering(frozen, 1);
  assert.ok(Math.abs(Math.atan2(frozen.vy, frozen.vx) * 180 / Math.PI - 50) < 1e-9, '느려져도 조향은 줄지 않는다');
});

test('전투 흡수 25%, 예열·가속 5초마다 +3%, 속도광 5초마다 +5%', () => {
  const b = makeBattle({ augments: ['lifesteal'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  e.maxHp = e.hp = 1e6; f.hp = f.maxHp - 50;
  const before = f.hp, eBefore = e.hp;
  dealDamage(b, f, e, 20, { kind: 'weapon' });
  assert.ok(Math.abs((f.hp - before) - (eBefore - e.hp) * 0.25) < 1e-9, '가한 피해의 25% 회복 (' + (f.hp - before) + ')');

  const t = makeBattle({ augments: ['warmup', 'accelRot', 'speedster'] });
  const g = t.fighters[0];
  const base = CHARACTERS[g.charId].move * WEAPONS[g.weaponId].moveMult;
  t.simT = 4.9; computeStats(g);
  assert.deepEqual([g.st.atk, g.st.aspd], [1, 1], '5초 전에는 그대로');
  t.simT = 15; computeStats(g);   // 3번 쌓임
  assert.ok(Math.abs(g.st.atk - 1.09) < 1e-9, '예열 +9% (' + g.st.atk + ')');
  assert.ok(Math.abs(g.st.aspd - 1.09) < 1e-9, '가속 +9% (' + g.st.aspd + ')');
  assert.ok(Math.abs(g.st.move / base - 1.15) < 1e-9, '속도광 +15% (' + g.st.move / base + ')');
});

test('농구공 3바운드: 세 번째로 튕긴 그 자리에서 상대에게 돌진해 26을 준다', () => {
  const b = makeBattle({ charId: 'bball' }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  e.x = 0; e.y = 0; e.maxHp = e.hp = 1e6; e.vx = e.vy = 0;
  f.maxHp = f.hp = 1e6;
  assert.equal(useSkill(b, f, 'char'), true);
  f.tracking.bounces = 2;
  // 오른쪽 벽 바로 앞에서 벽으로 달린다 — 이번 프레임에 세 번째로 튕긴다
  f.x = b.arena.H - f.radius - 0.5; f.y = 0; f.vx = 1; f.vy = 0;
  moveFighter(b, f, 1 / 60);
  assert.equal(f.tracking, null, '세 번째 튕김으로 추적이 끝난다');
  assert.ok(f.timers.dashT > 0 && f.dash && f.dash.kind === 'rush', '튕긴 그 프레임에 돌진이 살아 있다');
  const hp = e.hp, startX = f.x;
  for (let i = 0; i < 60 && e.hp === hp; i++) { b.simT += 1 / 60; updateTimers(b, f, 1 / 60); moveFighter(b, f, 1 / 60); }
  assert.ok(f.x < startX - 50, '상대 쪽으로 달려간다');
  assert.ok(Math.abs((hp - e.hp) - 26 * f.st.dmg) < 1e-6, '돌진에 맞으면 26 (' + (hp - e.hp) + ')');

  // 이미 돌진 중에 벽에 부딪히면 그 돌진은 끝난다 (단검 돌진도 같다)
  const d = makeBattle({ weaponId: 'dagger' }).fighters[0];
  const db = d.b;
  computeStats(d);
  d.x = db.arena.H - d.radius - 0.5; d.y = 0; d.vx = 1; d.vy = 0;
  d.dash = { dx: 1, dy: 0, spd: 690, kind: 'dash' }; d.timers.dashT = 0.5; d.dashHit = new Set();
  moveFighter(db, d, 1 / 60);
  assert.equal(d.timers.dashT, 0, '벽에 막힌 돌진은 끝난다');
  assert.equal(d.dash, null);
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
  assert.equal(ai.skillUses.common, undefined, '스킬 칸은 캐릭터·무기 둘뿐이다');
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

/* ---- AI를 사람처럼 ----
 * 투사체를 거의 다 피하고, 차지 샷은 80%를 맞히고, 방패는 아무 데나 던지고,
 * 스킬은 돌아오자마자 쓰던 봇을 사람 같은 실수와 뜸이 있게 바꿨다. */
function aiDuel(mine, theirs) {
  const b = makeBattle({ weaponId: mine, isAI: true }, { weaponId: theirs, isAI: true });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.ai = aiProfile(f);
  return { b, f, e, ai: f.ai };
}

test('AI는 날아오는 투사체마다 한 번만 정한다 — 못 보기로 한 것은 끝까지 안 피하고, 보더라도 늦게 반응한다', () => {
  const { b, f, ai } = aiDuel('sword', 'bow');
  const real = Math.random;
  try {
    const missed = { p: { uid: 900001 }, angle: 1, t: 0.5 };
    Math.random = () => 0;                 // 첫 결정: 못 본다
    assert.equal(aiDodgeDecision(b, f, ai, missed), null);
    Math.random = () => 0.999;             // 뒤로는 무엇을 굴려도
    for (let i = 0; i < 30; i++) {
      b.simT += 0.1;
      assert.equal(aiDodgeDecision(b, f, ai, missed), null, '다시 굴려서 결국 보게 되는 일이 없다');
    }
    const seen = { p: { uid: 900002 }, angle: 1, t: 0.5 };
    b.simT = 10;
    assert.equal(aiDodgeDecision(b, f, ai, seen), null, '보자마자 비키지는 않는다');
    b.simT = 10.1;
    assert.equal(aiDodgeDecision(b, f, ai, seen), null, '반응 시간 안이다');
    b.simT = 11;
    const d = aiDodgeDecision(b, f, ai, seen);
    assert.ok(d && Number.isFinite(d.angle) && d.magnitude > 0, '반응 시간이 지나면 비킨다');
  } finally { Math.random = real; }
  // 솜씨가 낮을수록 더 많이 못 본다
  const missRate = skill => {
    const x = aiDuel('sword', 'bow');
    x.ai.skill = skill;
    let miss = 0;
    for (let i = 0; i < 3000; i++) {
      aiDodgeDecision(x.b, x.f, x.ai, { p: { uid: 5e6 + i }, angle: 0, t: 0.5 });
      if (x.ai.seen.get(5e6 + i).miss) miss++;
    }
    return miss / 3000;
  };
  const clumsy = missRate(AI_SKILL_MIN), sharp = missRate(AI_SKILL_MAX);
  assert.ok(clumsy > 0.4 && clumsy < 0.53, '서툰 봇은 절반쯤 못 본다 (' + clumsy.toFixed(2) + ')');
  assert.ok(sharp > 0.2 && sharp < 0.32, '능숙한 봇도 넷에 하나는 못 본다 (' + sharp.toFixed(2) + ')');
});

test('AI는 무기 스킬이 돌아와도 바로 쓰지 않고 무기마다 뜸을 들인다', () => {
  const times = [];
  for (let k = 0; k < 24; k++) {
    const { b, f, e, ai } = aiDuel('sword', 'bow');
    ai.fumble = 0;
    f.skillUses.cd = 0; f.aiT = 0;
    let usedAt = null;
    for (let i = 0; i < 60 * 5 && usedAt === null; i++) {
      f.x = 0; f.y = 0; e.x = 60; e.y = 0;     // 믹서기를 쓸 만한 거리
      aiUpdate(b, f, 1 / 60);
      if (f.spinRemaining > 0) usedAt = b.simT;
      b.simT += 1 / 60;
    }
    assert.ok(usedAt !== null, '조건이 맞으면 결국 쓴다');
    times.push(usedAt);
  }
  const [lo, hi] = AI_SKILL_WAIT.sword;
  assert.ok(Math.min(...times) >= lo - 1e-9, '돌아오자마자 쓰지 않는다 (가장 빨리 ' + Math.min(...times).toFixed(2) + '초)');
  assert.ok(Math.max(...times) <= hi + 0.45, '뜸이 끝나면 곧 쓴다 (가장 늦게 ' + Math.max(...times).toFixed(2) + '초)');
  assert.ok(Math.max(...times) - Math.min(...times) > 0.5, '뜸은 매번 다르다');
});

test('AI 방패는 방패가 상대 쪽을 볼 때 던진다', () => {
  const offs = [];
  for (let k = 0; k < 24; k++) {
    const { b, f, e, ai } = aiDuel('shield', 'bow');
    ai.skillAt = -1;                          // 뜸은 끝났다고 친다
    f.weaponAngle = rand(-Math.PI, Math.PI);
    for (let i = 0; i < 60 * 8 && !f.disc; i++) {
      f.x = 0; f.y = 0; e.x = 200; e.y = 0; e.vx = 0; e.vy = 0;
      const facing = f.weaponAngle;
      aiUpdate(b, f, 1 / 60);
      if (f.disc) offs.push(Math.abs(angleDelta(facing, 0)));
      f.weaponAngle += 0.02;                  // 방패가 돈다
      b.simT += 1 / 60;
    }
  }
  assert.ok(offs.length >= 20, '대부분 결국 던진다 (' + offs.length + ')');
  offs.sort((a, c) => a - c);
  assert.ok(offs[offs.length >> 1] < 0.6, '대체로 상대 쪽으로 던진다 (중앙 ' + offs[offs.length >> 1].toFixed(2) + 'rad)');
  assert.ok(offs[offs.length - 1] < 1.2, '엉뚱한 쪽으로는 던지지 않는다 (최대 ' + offs[offs.length - 1].toFixed(2) + 'rad)');
});

test('AI 차지 샷은 매번 조금씩 다르게 겨눠 완벽하지 않다', () => {
  const offs = [];
  for (let k = 0; k < 40; k++) {
    const { b, f, e, ai } = aiDuel('bow', 'sword');
    f.x = 0; f.y = 0; e.x = 300; e.y = 0; e.vx = 0; e.vy = 0;
    // 상대 가까이에서 돌리기 시작한다 — 멀리서 돌리면 겨누기 전에 조급해져 놓아 버려
    // 오차가 아니라 조급함을 재게 된다.
    f.weaponAngle = -0.4;
    for (let i = 0; i < 60 * 8; i++) {
      if (aiAimRelease(b, f, ai, e, 580, 0.1)) { offs.push(Math.abs(angleDelta(f.weaponAngle, 0))); break; }
      f.weaponAngle += 0.01; b.simT += 1 / 60;
    }
  }
  assert.equal(offs.length, 40);
  // 300px 앞 상대는 몸통+화살 반지름이 약 0.1rad다
  assert.ok(offs.filter(o => o > 0.1).length >= 10, '여럿은 몸통을 벗어나게 겨눈다 (' + offs.filter(o => o > 0.1).length + '/40)');
  offs.sort((a, c) => a - c);
  assert.ok(offs[offs.length >> 1] < 0.35, '그래도 대체로 상대 쪽이다');
});

test('AI 화염방사기는 사거리 안에서 뿜고, 가끔은 닿지 않는 거리에서도 일단 뿜어 본다', () => {
  const run = gap => {
    const { b, f, e } = aiDuel('flame', 'sword');
    const reach = f.radius + WEAPONS.flame.range * weaponScale(f);
    let on = 0, ticks = 0;
    // 일단 뿜어 보기는 판단 한 번에 3%라 40초로는 한 번도 안 나올 확률이 2%쯤 된다. 120초 본다.
    for (let i = 0; i < 60 * 120; i++) {
      f.x = 0; f.y = 0; e.x = reach * gap; e.y = 0; f.flame.fuel = 100;
      aiUpdate(b, f, 1 / 60);
      if (f.flame.on) on++;
      ticks++;
      b.simT += 1 / 60;
    }
    return on / ticks;
  };
  assert.ok(run(0.6) > 0.85, '사거리 안이면 거의 내내 뿜는다');
  const far = run(1.4);
  assert.ok(far > 0.01 && far < 0.25, '닿지 않는 거리에서도 가끔 뿜어 본다 (' + far.toFixed(3) + ')');
  assert.equal(run(2.2), 0, '너무 멀면 뿜지 않는다');
});

test('AI 단검은 가던 방향 앞에 상대가 있을 때만 돌진한다', () => {
  const dashed = heading => {
    const { b, f, e, ai } = aiDuel('dagger', 'sword');
    ai.fumble = 0; ai.skillAt = -1; f.skillUses.cd = 0; f.aiT = 0;
    for (let i = 0; i < 60 * 3; i++) {
      f.x = 0; f.y = 0; f.vx = Math.cos(heading); f.vy = Math.sin(heading);
      e.x = 200; e.y = 0;
      aiUpdate(b, f, 1 / 60);
      if (f.timers.dashPrep > 0) return true;
      b.simT += 1 / 60;
    }
    return false;
  };
  assert.equal(dashed(0), true, '상대 쪽으로 가는 중이면 돌진한다');
  assert.equal(dashed(Math.PI / 2), false, '옆으로 가는 중이면 돌진하지 않는다');
  assert.equal(dashed(Math.PI), false, '등지고 가면 돌진하지 않는다');
});

/* 카피 계열과 사용 횟수 증강을 통째로 걷어냈다.
 * 칸은 캐릭터·무기 둘뿐이다. 캐릭터는 라운드당 1회, 무기는 쿨타임으로 돈다. */
test('스킬 칸은 캐릭터·무기 둘뿐이고 무기는 쿨타임으로 돈다', () => {
  const p = makePlayer({ augments: ['hp15', 'atk15'] });
  const b = new Battle('square', [p, makePlayer({ isAI: true })]);
  b.phase = 'fight';
  const f = b.fighters[0];
  assert.deepEqual(Object.keys(f.skillUses).sort(), ['cd', 'char', 'weapon']);
  assert.equal(f.skillUses.char, 1);
  assert.equal(f.skillUses.cd, 0, '전투 시작 시 무기 스킬은 바로 쓸 수 있다');
  assert.equal(f.skillUses.weapon, 1, 'weapon은 쿨타임을 0/1로 비춘 값이다');
  assert.equal(useSkill(b, f, 'common'), false, '없는 칸은 눌러도 아무 일이 없어야 한다');
  assert.equal(f.skillUses.weapon, 1, '없는 칸이 무기 스킬을 대신 써 버리면 안 된다');
  assert.equal(b.projectiles.length, 0);
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
  const w = pick(['w_giant', 'winMomentum', 'battleExp'], { ...base, weaponId: 'sword' });
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

/* ---- 승패가 갈리는 순간 ----
 * 진 공이 조각나 부서지고 화면이 느려져야, 누가 졌는지 눈으로 확인할
 * 시간이 생긴다. 예전에는 결판이 나자마자 넘어가 볼 틈이 없었다. */
test('진 공은 조각나 부서지고 마무리는 느리게 흐른다', () => {
  let shards = 0, ends = [], base = 0;
  for (let attempt = 0; attempt < 15 && !shards; attempt++) {
    const b = makeBattle({ isAI: true }, {});
    // 죽은 쪽은 멈추므로 살아남은 쪽의 이동량으로 재야 한다.
    // 누가 이길지는 끝나 봐야 아니 둘 다 기록해 두고 나중에 고른다.
    const track = b.fighters.map(() => ({ before: [], after: [] }));
    for (let i = 0; i < 60 * 80; i++) {
      const was = b.fighters.map(f => ({ x: f.x, y: f.y }));
      const had = !!b.result;
      b.update(1 / 60);
      b.fighters.forEach((f, k) => {
        const d = Math.hypot(f.x - was[k].x, f.y - was[k].y);
        track[k][had ? 'after' : 'before'].push(d);
      });
      if (!had && b.result) shards = b.particles.filter(p => p.shard).length;
      if (b.finished) break;
    }
    const win = b.result && b.result.winner ? b.fighters.indexOf(b.result.winner) : -1;
    if (win < 0 || !shards) { shards = 0; continue; }
    base = track[win].before[track[win].before.length - 1];   // 죽기 직전 프레임 = 1.0x 기준
    ends = track[win].after;
  }
  assert.ok(shards >= 8, '진 공이 조각나야 한다 (조각 ' + shards + '개)');
  assert.ok(base > 0 && ends.length >= 60,
    '마무리를 최소 1초는 보여줘야 한다 (실제 ' + (ends.length / 60).toFixed(2) + '초)');
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const n = Math.floor(ends.length / 3);
  const 처음 = avg(ends.slice(0, n)) / base, 나중 = avg(ends.slice(-n)) / base;
  assert.ok(처음 < 0.25, '결판 직후에는 거의 멈춘 듯 느려져야 한다 (실제 ' + 처음.toFixed(3) + 'x)');
  assert.ok(나중 > 처음 * 1.8,
    '느렸다가 서서히 풀려야 한다 (' + 처음.toFixed(3) + 'x → ' + 나중.toFixed(3) + 'x)');
});

/* ---- 타격감 ----
 * 피격 진동이 3딜이든 40딜이든 똑같이 +2였다. 0.08초 만에 사그라들어
 * 20Hz 스냅샷은 봉우리를 대부분 놓쳤고, 멀티에서는 거의 안 흔들렸다. */
test('맞을 때 진동은 피해량에 비례하고 스냅샷에 실릴 만큼 남는다', () => {
  const hit = raw => {
    const b = makeBattle({}, {});
    const [a, t] = b.fighters;
    t.timers.immune = 0; t.timers.untouchable = 0;
    b.shake = 0;
    dealDamage(b, a, t, raw, {});
    return b.shake;
  };
  const 약 = hit(3), 중 = hit(20), 강 = hit(40);
  assert.ok(중 > 약 * 1.5,
    '세게 맞으면 더 크게 흔들려야 한다 (' + 약.toFixed(1) + ' → ' + 중.toFixed(1) + ')');
  assert.ok(강 > 중, '더 세게 맞으면 더 크게 (' + 중.toFixed(1) + ' → ' + 강.toFixed(1) + ')');
  // 감쇠는 초당 26. 스냅샷 한 칸(0.05초)이 지나도 남아 있어야 멀티에서도 보인다
  assert.ok(중 - 26 * 0.05 > 3,
    '한 번에 사그라들면 멀티에서는 안 흔들린다 (0.05초 뒤 ' + (중 - 26 * 0.05).toFixed(1) + ')');

  // 폭발처럼 이미 크게 흔들리는 중에 잔챙이 피격이 와도 줄어들면 안 된다
  const b = makeBattle({}, {});
  const [a, t] = b.fighters;
  t.timers.immune = 0; t.timers.untouchable = 0;
  b.shake = 14;
  dealDamage(b, a, t, 3, {});
  assert.ok(b.shake >= 14,
    '작은 피격이 큰 흔들림을 깎으면 안 된다 (실제 ' + b.shake.toFixed(1) + ')');
});

test('괴력은 공격력 +25%에 공격속도 -15%, 연격 가속은 4스택까지만 쌓인다', () => {
  const b = makeBattle({ augments: ['brute'] });
  const [f] = b.fighters;
  computeStats(f);
  assert.ok(Math.abs(f.st.atk - 1.25) < 1e-9);
  assert.ok(Math.abs(f.st.aspd - 0.85) < 1e-9, '공격속도 -15% (실제 ' + f.st.aspd + ')');

  const r = makeBattle({ augments: ['rotMomentum'] }, { weaponId: 'sword' });
  const [g, e] = r.fighters;
  computeStats(g); computeStats(e);
  e.maxHp = e.hp = 1e6;
  for (let i = 0; i < 10; i++) weaponDamage(r, g, e, 5);
  assert.equal(g.rotStacks, 4, '4스택에서 멈춘다');
  computeStats(g);
  assert.ok(Math.abs(g.st.aspd - (1 + 0.06 * 4)) < 1e-9, '스택마다 +6%');
});

/* 이중 마법 — 정면을 비우고 양옆으로 갈라진다./* 이중 마법 — 정면을 비우고 양옆으로 갈라진다. 똑바로 굴러오는 상대는
 * 두 발 다 비껴갈 수 있다는 게 이 증강의 값이자 위험이다. */
test('이중 마법은 정면을 비우고 양옆 두 갈래로 나간다', () => {
  const b = makeBattle({ weaponId: 'staff', augments: ['s_double'] });
  const f = b.fighters[0];
  f.weaponAngle = 0.4;
  fireStaff(b, f);
  assert.equal(b.projectiles.length, 2, '두 갈래여야 한다');
  const offs = b.projectiles.map(p => {
    let d = Math.atan2(p.vy, p.vx) - f.weaponAngle;
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    return d;
  }).sort((x, y) => x - y);
  assert.ok(offs[0] < -0.1 && offs[1] > 0.1,
    '좌우로 갈라져야 한다 (실제 ' + offs.map(o => o.toFixed(2)).join(', ') + ')');
  assert.ok(!offs.some(o => Math.abs(o) < 1e-6), '정면으로 곧장 가는 발이 있으면 안 된다');
  assert.ok(b.projectiles.every(p => p.dmg === WEAPONS.staff.dmg * 0.5), '두 갈래인 대신 발당 피해는 절반이다');
  // 증강이 없으면 한 발에 온전한 피해
  const plain = makeBattle({ weaponId: 'staff' });
  fireStaff(plain, plain.fighters[0]);
  assert.equal(plain.projectiles.length, 1);
  assert.equal(plain.projectiles[0].dmg, WEAPONS.staff.dmg);
});

/* 몇 연승·연패 중인지 화면에 띄우려면 셈이 있어야 한다.
 * 핏빛 질주가 지금 연승에 그대로 걸리므로 이 숫자가 곧 그 증강의 세기다. */
test('연승과 연패를 따로 센다', () => {
  const p = makePlayer({});
  winRound(p); winRound(p);
  assert.equal(p.streak, 2);
  assert.equal(p.lossStreak, 0);
  loseCoin(p);
  assert.equal(p.streak, 0, '지면 연승이 끊긴다');
  assert.equal(p.lossStreak, 1);
  loseCoin(p);
  assert.equal(p.lossStreak, 2, '연패가 쌓여야 한다');
  winRound(p);
  assert.equal(p.streak, 1);
  assert.equal(p.lossStreak, 0, '이기면 연패가 끊긴다');
});

/* 유도 화살은 상대 가까이 갔을 때만 살짝 휜다. 멀리서도 따라붙으면
 * 조준이 필요 없어지고(승률 71% -> 93%), 트리플 샷의 부채꼴도 총구 앞에서
 * 접혀 세 발이 한 줄로 날아간다. */
test('던진 방패는 상대에 한 번 맞고 한 대만 준다', () => {
  const b = makeBattle({ weaponId: 'shield' }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  // 상대를 한 자리에 고정해 두고 방패를 그 위로 통과시킨다
  e.x = 160; e.y = 0; e.vx = 0; e.vy = 0; e.maxHp = e.hp = 1e9;
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0; f.weaponAngle = 0;
  throwDisc(b, f);
  const d = f.disc;
  let hits = 0, hpWas = e.hp;
  // 상대 위를 완전히 지나갈 때까지
  for (let n = 0; n < 240 && d.x < 320; n++) {
    e.x = 160; e.y = 0;                     // 밀려나도 제자리로
    updateDisc(b, f, 1 / 60);
    if (e.hp < hpWas - 1e-9) { hits++; hpWas = e.hp; }
    if (!f.disc) break;                     // 주웠으면 끝
  }
  assert.equal(hits, 1, '한 번 지나가면 한 대다 (실제 ' + hits + '대)');
  // 판정에서 완전히 벗어났다가 다시 들어오면 그때는 맞는다
  if (f.disc) {
    e.x = Math.round(d.x); e.y = Math.round(d.y);
    updateDisc(b, f, 1 / 60);
    assert.ok(e.hp < hpWas - 1e-9, '벗어났다 다시 닿으면 또 맞아야 한다');
  }
});

test('던진 방패는 상대를 관통하지 않고 튕겨 나온다', () => {
  const b = makeBattle({ weaponId: 'shield' }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  e.maxHp = e.hp = 1e9; e.st.move = 0; e.vx = 0; e.vy = 0;
  f.x = 0; f.y = 0; f.weaponAngle = 0;
  e.x = 120; e.y = 0;
  throwDisc(b, f);
  const d = f.disc;
  let deepest = 0, reversed = false, hp = e.hp, hits = 0;
  for (let i = 0; i < 90 && f.disc; i++) {
    e.x = 120; e.y = 0;
    updateDisc(b, f, 1 / 60);
    if (e.hp < hp - 1e-9) { hits++; hp = e.hp; }
    deepest = Math.min(deepest, Math.hypot(d.x - e.x, d.y - e.y) - d.r - bodyRadius(e));
    if (d.vx < -0.5) reversed = true;
  }
  assert.equal(hits, 1, '맞으면 한 대');
  assert.ok(reversed, '정면으로 맞으면 되돌아 나온다');
  assert.ok(deepest > -1, '몸에 박히지 않는다 (최대 ' + deepest.toFixed(2) + 'px 파고듦)');
});

test('벽에 붙은 상대와 벽 사이에 낀 방패가 탁구처럼 계속 때리지 않는다', () => {
  /* 몸에 부딪힐 때 법선 속도를 다 돌려주면 벽과 상대 사이를 오가며
   * 초당 31대까지 맞았다. 부딪힐 때마다 일부를 잃어 몇 번 만에 멈춘다. */
  // 실제 경기는 다이아 맵뿐이다. 벽 위치 계산도 다이아 기준이다.
  const b = new Battle('diamond', [makePlayer({ weaponId: 'shield' }),
    makePlayer({ isAI: true, color: '#ff6b6b', weaponId: 'sword' })]);
  b.phase = 'fight'; b.simT = 0;
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  e.maxHp = e.hp = 1e9; e.st.move = 0; e.vx = 0; e.vy = 0;
  const L = b.arena.L;
  e.x = L - 62; e.y = 0;
  f.x = -L + 80; f.y = 0; f.weaponAngle = 0;
  throwDisc(b, f);
  const d = f.disc;
  Object.assign(d, { x: e.x + bodyRadius(e) + d.r + 2, y: 0, vx: 1, vy: 0,
    spd: WEAPONS.shield.throwSpd, armed: true });
  d.contact = new Set();
  let hits = 0, hp = e.hp;
  for (let i = 0; i < 60 * 6 && f.disc; i++) {
    e.x = L - 62; e.y = 0;
    updateDisc(b, f, 1 / 60);
    if (e.hp < hp - 1e-9) { hits++; hp = e.hp; }
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y), '좌표가 유한하다');
  }
  assert.ok(hits <= 6, '끼여도 몇 대 안에 멈춘다 (실제 ' + hits + '대)');
  assert.ok(d.resting, '결국 멈춘다');
  assert.ok(Math.abs(d.x) + Math.abs(d.y) <= L + 1, '경기장 밖으로 밀려나지 않는다');
});

test('벽에 튕긴 방패는 붙어 있던 상대를 다시 맞힌다', () => {
  const b = makeBattle({ weaponId: 'shield' }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0; f.weaponAngle = 0;
  throwDisc(b, f);
  const d = f.disc;
  e.maxHp = e.hp = 1e9;
  // 상대를 원반 위에 겹쳐 두고 한 대 맞힌다
  e.x = d.x; e.y = d.y; e.vx = 0; e.vy = 0;
  updateDisc(b, f, 1 / 60);
  const afterFirst = e.hp;
  assert.ok(afterFirst < 1e9, '겹쳐 있으면 한 대는 맞는다');
  // 붙어 있는 채로는 더 안 맞는다
  e.x = d.x; e.y = d.y;
  updateDisc(b, f, 1 / 60);
  assert.equal(e.hp, afterFirst, '벗어나기 전에는 다시 안 맞는다');
  // 벽 반사를 흉내 내면 접촉 기록이 풀려 다시 맞는다
  d.contact.clear();
  e.x = d.x; e.y = d.y;
  updateDisc(b, f, 1 / 60);
  assert.ok(e.hp < afterFirst - 1e-9, '튕긴 뒤에는 다시 맞아야 한다');
});

test('방패 피해: 휘두르면 15, 던진 방패는 8', () => {
  assert.equal(WEAPONS.shield.dmg, 15);
  assert.equal(WEAPONS.shield.throwDmg, 8);
  // 겹쳐 둔 상대에게 던진 방패 한 대는 같은 조건의 무기 피해 8과 같다
  const b = makeBattle({ weaponId: 'shield' }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0; f.weaponAngle = 0;
  throwDisc(b, f);
  e.maxHp = e.hp = 1e9; e.x = f.disc.x; e.y = f.disc.y; e.vx = 0; e.vy = 0;
  updateDisc(b, f, 1 / 60);
  const thrown = 1e9 - e.hp;
  const b2 = makeBattle({ weaponId: 'shield' }, { weaponId: 'sword' });
  const [f2, e2] = b2.fighters;
  computeStats(f2); computeStats(e2);
  e2.maxHp = e2.hp = 1e9;
  assert.ok(Math.abs(thrown - weaponDamage(b2, f2, e2, 8)) < 1e-6, '던진 방패 한 대 ' + thrown);
});

/* 화염방사기는 불길 안의 상대에게 0.5초마다 3씩. 간격은 공격속도와 상관없고,
 * 공격속도는 연료 회복으로만 들어간다. */
function flameDuel({ aspd = 1, gap = 60, seconds = 1.2, pulse = false } = {}) {
  const b = makeBattle({ weaponId: 'flame' }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.st.aspd = aspd;
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0;
  e.x = gap; e.y = 0; e.vx = 0; e.vy = 0; e.maxHp = e.hp = 1e9;
  f.steer = { active: true, angle: 0, magnitude: 1 };
  f.flame.aim = 0; f.flame.fuel = 100;
  const hits = [];
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    // pulse: 매 프레임 버튼을 뗐다 누른다 (연타로 틱을 당길 수 없어야 한다)
    setFlameInput(f, pulse ? i % 2 === 0 : true);
    const before = e.hp;
    updateFlame(b, f, dt);
    if (e.hp < before) hits.push({ t: b.simT, dmg: before - e.hp });
    b.simT += dt;
  }
  return { f, e, hits };
}

test('화염방사기는 불길 안의 상대에게 0.2초마다 2씩, 공격속도와 상관없이', () => {
  assert.equal(WEAPONS.flame.tickDmg, 2);
  assert.equal(WEAPONS.flame.tickT, 0.2);
  const every = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const { f, hits } = flameDuel();
  assert.deepEqual(hits.map(h => Math.round(h.t * 100) / 100), every, '닿자마자 한 대, 그 뒤 0.2초마다');
  assert.ok(hits.every(h => Math.abs(h.dmg - 2 * f.st.atk * f.st.dmg) < 1e-9), '한 대에 2');
  const fast = flameDuel({ aspd: 2 });
  assert.deepEqual(fast.hits.map(h => Math.round(h.t * 100) / 100), every, '공격속도가 높아도 간격은 0.2초');
  const pulse = flameDuel({ pulse: true });
  assert.equal(pulse.hits.length, every.length, '버튼을 뗐다 눌러도 더 자주 맞지 않는다');
});

test('화염방사기는 몸 가장자리만 불길에 걸려도 맞힌다', () => {
  // 불길 옆 경계(반각) 바깥에 몸 한가운데가 있지만 몸 가장자리는 불길 안에 들어온 상대
  const hitAt = offset => {
    const b = makeBattle({ weaponId: 'flame' }, { weaponId: 'sword' });
    const [f, e] = b.fighters;
    computeStats(f); computeStats(e);
    f.x = 0; f.y = 0; f.vx = 1; f.vy = 0;
    f.steer = { active: true, angle: 0, magnitude: 1 }; f.flame.aim = 0; f.flame.fuel = 100;
    const d = 80, edge = Math.asin(bodyRadius(e) / d), ang = WEAPONS.flame.halfArc + edge * offset;
    e.x = Math.cos(ang) * d; e.y = Math.sin(ang) * d; e.maxHp = e.hp = 1e6;
    setFlameInput(f, true);
    updateFlame(b, f, 1 / 60);
    return e.hp < 1e6;
  };
  assert.equal(hitAt(0.8), true, '가장자리가 불길 안이면 맞는다');
  assert.equal(hitAt(1.2), false, '몸 전체가 불길 밖이면 안 맞는다');
});

test('잔불은 불길을 뿜은 방향을 따라 가까운 곳·가운데·끝에 깔리고, 벽 밖에는 남지 않는다', () => {
  const b = makeBattle({ weaponId: 'flame', augments: ['f_ember'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  e.x = 300; e.y = 300;
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0;
  const aim = 0.6;
  f.steer = { active: true, angle: aim, magnitude: 1 }; f.flame.aim = aim; f.flame.fuel = 100;
  setFlameInput(f, true);
  updateFlame(b, f, 1 / 60);
  const range = WEAPONS.flame.range * weaponScale(f);
  const mine = b.flames.filter(fl => fl.owner === f);
  assert.equal(mine.length, 3, '한 번에 세 자리');
  for (const [i, fl] of mine.entries()) {
    const r = Math.hypot(fl.x - f.x, fl.y - f.y), a = Math.atan2(fl.y - f.y, fl.x - f.x);
    assert.ok(Math.abs(angleDelta(a, aim)) < 1e-9, '뿜은 방향 위에 깔린다');
    assert.ok(Math.abs(r - range * [0.35, 0.65, 0.92][i]) < 1e-6, '가까운 곳·가운데·끝');
    assert.ok(fl.r >= 11 && fl.r <= 30);
  }
  // 벽에 붙어 벽 쪽으로 뿜으면 벽 밖 자리는 건너뛴다
  b.flames.length = 0;
  const L = b.arena.H;
  f.x = L - 40; f.y = 0; f.flame.aim = 0; f.steer.angle = 0; f.cd.ember = 0;
  updateFlame(b, f, 1 / 60);
  for (const fl of b.flames) assert.ok(Math.max(Math.abs(fl.x), Math.abs(fl.y)) + fl.r <= L + 1e-9, '벽 밖에 남지 않는다');
  assert.ok(b.flames.length < 3, '벽 너머 자리는 없다');
});

test('반발심: 충전되면 반경 130 안의 적을 나에게서 멀어지는 쪽으로 보내고, 8초 뒤 다시 충전된다', () => {
  const b = makeBattle({ augments: ['repulse'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  assert.equal(REPULSE_CD, 8);
  assert.equal(REPULSE_R, 130);
  f.x = 0; f.y = 0;
  e.x = 300; e.y = 0; e.vx = -1; e.vy = 0;       // 멀리서 다가온다
  f.cd.repelT = 0;
  autoSystems(b, f, 1 / 60);
  assert.equal(e.vx, -1, '반경 밖이면 터지지 않고 기다린다');
  assert.equal(f.cd.repelT, 0);
  e.x = 100; e.y = 30;
  autoSystems(b, f, 1 / 60);
  const away = Math.atan2(30, 100);
  assert.ok(Math.abs(angleDelta(Math.atan2(e.vy, e.vx), away)) < 1e-9, '나에게서 멀어지는 쪽으로 방향이 바뀐다');
  assert.ok(Math.abs(f.cd.repelT - 8) < 1e-9, '8초 뒤에 다시 쓸 수 있다');
  e.vx = -1; e.vy = 0;
  autoSystems(b, f, 1);
  assert.equal(e.vx, -1, '충전 중에는 다시 밀지 않는다');
});

test('가시목줄: 꼬마볼과 내 공 사이 줄에 닿은 상대는 4씩, 같은 상대는 0.5초에 한 번', () => {
  const b = makeBattle({ augments: ['miniBall', 'thornLeash'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  assert.equal(AUG_BY_ID.thornLeash.req, 'miniBall');
  const m = f.summons[0];
  const hold = () => { f.x = 0; f.y = 0; m.x = 200; m.y = 0; m.vx = 0; m.vy = 1; m.spd = 0; e.x = 100; e.y = 10; e.vx = e.vy = 0; };
  e.maxHp = e.hp = 1e6;
  hold(); b.simT = 1; b.updateMinions(1 / 60);
  assert.ok(Math.abs((1e6 - e.hp) - 4 * f.st.dmg) < 1e-9, '줄에 닿으면 4');
  hold(); b.simT = 1.2; b.updateMinions(1 / 60);
  assert.ok(Math.abs((1e6 - e.hp) - 4 * f.st.dmg) < 1e-9, '0.5초 안에는 다시 안 찌른다');
  hold(); b.simT = 1.6; b.updateMinions(1 / 60);
  assert.ok(Math.abs((1e6 - e.hp) - 8 * f.st.dmg) < 1e-9, '0.5초 뒤에 다시 찌른다');
  // 줄에서 떨어져 있으면 안 다친다
  const b2 = makeBattle({ augments: ['miniBall', 'thornLeash'] }, { weaponId: 'sword' });
  const [f2, e2] = b2.fighters;
  computeStats(f2); computeStats(e2);
  const m2 = f2.summons[0];
  f2.x = 0; f2.y = 0; m2.x = 200; m2.y = 0; m2.spd = 0; e2.x = 100; e2.y = 60; e2.maxHp = e2.hp = 1e6;
  b2.simT = 1; b2.updateMinions(1 / 60);
  assert.equal(e2.hp, 1e6, '줄에서 떨어진 상대는 안 다친다');
  // 꼬마볼만 있고 가시목줄이 없으면 줄도 없다
  const b3 = makeBattle({ augments: ['miniBall'] }, { weaponId: 'sword' });
  const [f3, e3] = b3.fighters;
  computeStats(f3); computeStats(e3);
  const m3 = f3.summons[0];
  f3.x = 0; f3.y = 0; m3.x = 200; m3.y = 0; m3.spd = 0; e3.x = 100; e3.y = 10; e3.maxHp = e3.hp = 1e6;
  b3.simT = 1; b3.updateMinions(1 / 60);
  assert.equal(e3.hp, 1e6);
});

test('거인의 날: 모두의 공·무기·투사체가 30% 커진다', () => {
  const normal = new Battle('square', [makePlayer({ weaponId: 'sword' }), makePlayer({ isAI: true, weaponId: 'bow' })]);
  const giant = new Battle('square', [makePlayer({ weaponId: 'sword' }), makePlayer({ isAI: true, weaponId: 'bow' })], { giant: true });
  for (const x of [...normal.fighters, ...giant.fighters]) computeStats(x);
  for (let i = 0; i < 2; i++) {
    const a = normal.fighters[i], g = giant.fighters[i];
    assert.ok(Math.abs(g.radius / a.radius - 1.3) < 1e-9, '공 크기');
    assert.ok(Math.abs(weaponScale(g) / weaponScale(a) - 1.3) < 1e-9, '무기 크기');
    assert.equal(g.flags.eventGiant, 1, '온라인 화면도 알 수 있게 표식을 단다');
  }
  const pa = spawnProj(normal, normal.fighters[1], { kind: 'arrow', x: 0, y: 0, ang: 0, spd: 300, dmg: 8, r: 4, weapon: true });
  const pg = spawnProj(giant, giant.fighters[1], { kind: 'arrow', x: 0, y: 0, ang: 0, spd: 300, dmg: 8, r: 4, weapon: true });
  assert.ok(Math.abs(pg.r / pa.r - 1.3) < 1e-9, '투사체 크기');
});

test('무기강화소: 다음 증강 선택지 3개가 내 무기 전용 증강이고, 이미 가진 것 자리는 다른 증강이다', () => {
  const p = makePlayer({ weaponId: 'shield' });
  const shieldAugs = AUGMENTS.filter(a => a.weapon === 'shield').map(a => a.id).sort();
  assert.equal(shieldAugs.length, 3);
  for (let k = 0; k < 10; k++) {
    const offers = rollAugmentOffers(p, 3, { weaponForge: true });
    assert.deepEqual(offers.map(a => a.id).sort(), shieldAugs, '셋 다 방패 전용');
  }
  p.augments.push('sh_grip');
  for (let k = 0; k < 10; k++) {
    const ids = rollAugmentOffers(p, 3, { weaponForge: true }).map(a => a.id);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3, '겹치지 않는다');
    assert.ok(!ids.includes('sh_grip'), '이미 가진 것은 빠진다');
    assert.ok(ids.includes('sh_magnet') && ids.includes('sh_ricochet'), '남은 무기 증강은 모두 나온다');
    assert.equal(ids.filter(id => AUG_BY_ID[id].weapon).length, 2, '나머지 한 칸은 다른 증강');
  }
  // 이벤트가 없으면 평소대로 섞인다
  const plain = makePlayer({ weaponId: 'shield' });
  let allWeapon = 0;
  for (let k = 0; k < 40; k++) if (rollAugmentOffers(plain).every(a => a.weapon)) allWeapon++;
  assert.ok(allWeapon < 5, '평소에는 무기 증강만 나오는 일이 드물다');
});

test('명상은 5초마다 체력 3%를 회복한다', () => {
  const b = makeBattle({ augments: ['meditate'] }, { weaponId: 'sword' });
  const [f] = b.fighters;
  computeStats(f);
  f.hp = f.maxHp * 0.5; f.cd.medT = 0;
  const before = f.hp;
  updateTimers(b, f, 1 / 60);
  assert.ok(Math.abs((f.hp - before) - f.maxHp * 0.03) < 1e-9, '3% (' + ((f.hp - before) / f.maxHp) + ')');
});

test('화염방사기 사거리는 114, 기본 연료 회복은 초당 15에 공격속도가 곱해진다', () => {
  assert.equal(WEAPONS.flame.range, 114);
  assert.equal(WEAPONS.flame.refillRate, 15);
  // 예전 사거리(95)로는 닿지 않던 상대가 이제 닿는다
  const e0 = flameDuel({ seconds: 0.1 }).e;
  const gap = e0.radius + 95 + 10;
  assert.ok(gap < e0.radius + 114);
  assert.equal(flameDuel({ gap, seconds: 0.1 }).hits.length, 1, '늘어난 사거리 안');
  assert.equal(flameDuel({ gap: e0.radius + 114 + 4, seconds: 0.1 }).hits.length, 0, '사거리 밖');
  const refill = aspd => {
    const b = makeBattle({ weaponId: 'flame' }, { weaponId: 'sword' });
    const [f] = b.fighters;
    computeStats(f); f.st.aspd = aspd;
    f.flame.fuel = 0; f.flame.idle = WEAPONS.flame.refillDelay;
    setFlameInput(f, false);
    updateFlame(b, f, 1);
    return f.flame.fuel;
  };
  assert.ok(Math.abs(refill(1) - 15) < 1e-9, '기본 초당 15 (' + refill(1) + ')');
  assert.ok(Math.abs(refill(1.5) - 22.5) < 1e-9, '공격속도 1.5면 22.5');
});

test('충격파 증강은 벽에 튕길 때 반경 112 안의 적에게 피해 7', () => {
  assert.equal(SHOCKWAVE_R, 112);
  const hurt = distance => {
    const b = makeBattle({ augments: ['shockwave'] }, { weaponId: 'sword' });
    const [f, e] = b.fighters;
    computeStats(f); computeStats(e);
    f.x = 0; f.y = 0; e.x = distance; e.y = 0; e.maxHp = e.hp = 1e9;
    onWallBounce(b, f, 1);
    return 1e9 - e.hp;
  };
  // 예전 반경(75)이면 몸(22)까지 97 안만 맞았다
  assert.ok(Math.abs(hurt(120) - 7) < 1e-9, '예전 반경 밖, 지금 반경 안 (' + hurt(120) + ')');
  assert.equal(hurt(112 + 22 + 3), 0, '반경 밖은 맞지 않는다');
});

test('위성체는 공 중심에서 반지름+41(기본 63)을 돌고, 그 자리에서 맞힌다', () => {
  const b = makeBattle({ augments: ['satellite'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  assert.equal(f.satellites.length, 1);
  assert.equal(f.radius, 22);
  assert.equal(satelliteOrbit(f), 63);
  f.x = 0; f.y = 0; e.maxHp = e.hp = 1e9; e.vx = e.vy = 0;
  const s = f.satellites[0];
  // 위성체가 orbit 거리에 있다고 치고, 그 안쪽(side -1)이나 바깥쪽(+1)에 닿기 직전(0.2px 겹침)으로
  // 상대를 세운다. 양쪽 다 맞으면 실제 궤도는 63±0.2다 (예전 판정 64면 안쪽이 안 맞는다).
  const probe = (orbit, side) => {
    s.ang = 0; s.cd = 0; e.hp = 1e9;
    const next = 2.7 * GAME_SPEED / 60, at = orbit + side * (9 + e.radius - 0.2);
    e.x = Math.cos(next) * at; e.y = Math.sin(next) * at;
    updateSatellites(b, f, 1 / 60);
    return e.hp < 1e9;
  };
  assert.ok(probe(63, -1) && probe(63, 1), '63을 도는 위성체에 닿은 상대는 맞는다');
  assert.ok(Math.abs((1e9 - e.hp) - 5 * f.st.dmg) < 1e-9, '스치면 피해 5 (' + (1e9 - e.hp) + ')');
  assert.equal(probe(62, -1), false, '1px 더 안쪽에 선 상대는 닿지 않는다 — 판정이 넉넉해서 통과한 게 아니다');
  f.radius = 30;
  assert.equal(satelliteOrbit(f), 71, '공이 커지면 같이 멀어진다');
});

/* 단단한 손 — 방패를 들고 있으면 방패가 향한 정면에서 오는 공격을 막는다. */
function guardDuel({ grip = true, attacker = 'bow', facing = 0 } = {}) {
  const b = makeBattle({ weaponId: 'shield', augments: grip ? ['sh_grip'] : [] }, { weaponId: attacker });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0; f.weaponAngle = facing;   // 0이면 방패가 +x를 본다
  f.maxHp = f.hp = 1000;
  return { b, f, e };
}
// f에서 본 방향 ang 쪽에서 날아와 f에 닿은 화살
function arrowFrom(d, ang) {
  const { b, f, e } = d;
  const p = spawnProj(b, e, { kind: 'arrow', x: f.x + Math.cos(ang) * 24, y: f.y + Math.sin(ang) * 24,
    ang: ang + Math.PI, spd: 300, dmg: 8, r: 4, weapon: true });
  const hp = f.hp;
  projectileHit(b, p, f);
  return hp - f.hp;
}

test('단단한 손: 방패가 향한 정면(좌우 45°)에서 오는 투사체는 막고, 옆·뒤에서 오면 맞는다', () => {
  const d = guardDuel();
  assert.equal(arrowFrom(d, 0), 0, '정면에서 온 화살을 막는다');
  assert.ok(d.f.gripT > 0, '막으면 막았다는 표시가 뜬다');
  assert.equal(arrowFrom(d, 0.7), 0, '40° 옆에서 온 것도 막는다');
  assert.ok(arrowFrom(d, 0.87) > 0, '50° 옆에서 온 것은 못 막는다');
  assert.ok(arrowFrom(d, Math.PI) > 0, '등 뒤는 못 지킨다');
  assert.ok(arrowFrom(guardDuel({ grip: false }), 0) > 0, '증강이 없으면 막지 않는다');
  const thrown = guardDuel();
  thrown.f.disc = { x: 300, y: 0, r: 15 };
  assert.ok(arrowFrom(thrown, 0) > 0, '방패를 던져 두었으면 막지 못한다');
  // 증강 투사체(표창)도 막는다
  const star = guardDuel();
  const shuriken = spawnProj(star.b, star.e, { kind: 'shuriken', x: 24, y: 0, ang: Math.PI, spd: 260, dmg: 6, r: 6 });
  const starHp = star.f.hp;
  projectileHit(star.b, shuriken, star.f);
  assert.equal(star.f.hp, starHp, '정면에서 온 표창도 막는다');
  // 날아오는 상대 방패도 막는다
  const disc = facing => {
    const d = guardDuel({ attacker: 'shield', facing });
    d.e.x = 200; d.e.y = 0; d.e.weaponAngle = Math.PI;
    throwDisc(d.b, d.e);
    Object.assign(d.e.disc, { x: 40, y: 0, vx: -1, vy: 0, armed: true });
    const hp = d.f.hp;
    updateDisc(d.b, d.e, 1 / 60);
    return hp - d.f.hp;
  };
  assert.equal(disc(0), 0, '정면으로 날아온 방패를 막는다');
  assert.ok(disc(Math.PI) > 0, '등 뒤로 날아온 방패는 맞는다');
  // 방향이 없는 폭발은 막지 않는다
  const boom = guardDuel();
  const hp = boom.f.hp;
  explodeAt(boom.b, boom.e, 30, 0, 60, 10, 'auto', true);
  assert.ok(boom.f.hp < hp, '폭발은 막지 않는다');
});

test('단단한 손: 검 칼날·단검 돌진·농구공 돌진·화염도 방패 쪽에서 오면 막는다', () => {
  const sword = facing => {
    const { b, f, e } = guardDuel({ attacker: 'sword', facing });
    e.x = 95; e.y = 0; e.weaponAngle = Math.PI; e.meleeContact = new Set();   // 칼끝이 오른쪽에서 들어온다
    const hp = f.hp;
    meleeHits(b, e, 1 / 60);
    return hp - f.hp;
  };
  assert.equal(sword(0), 0, '칼날이 들어오는 쪽을 방패가 보면 막는다');
  assert.ok(sword(Math.PI) > 0, '방패가 반대쪽이면 맞는다');
  const dash = (facing, kind) => {
    const { b, f, e } = guardDuel({ attacker: 'dagger', facing });
    e.x = 40; e.y = 0; e.dash = { kind, dx: -1, dy: 0, spd: 690 }; e.timers.dashT = 0.5; e.dashHit = new Set();
    const hp = f.hp;
    tryDashHit(b, e, f);
    return hp - f.hp;
  };
  assert.equal(dash(0, 'dash'), 0, '단검 돌진');
  assert.ok(dash(Math.PI, 'dash') > 0);
  assert.equal(dash(0, 'rush'), 0, '농구공 3바운드 돌진');
  assert.ok(dash(Math.PI, 'rush') > 0);
  const flame = facing => {
    const { b, f, e } = guardDuel({ attacker: 'flame', facing });
    e.x = 80; e.y = 0; e.steer = { active: true, angle: Math.PI, magnitude: 1 }; e.flame.aim = Math.PI; e.flame.fuel = 100;
    setFlameInput(e, true);
    const hp = f.hp;
    updateFlame(b, e, 1 / 60);
    return hp - f.hp;
  };
  assert.equal(flame(0), 0, '화염을 뿜는 쪽을 방패가 보면 막는다');
  assert.ok(flame(Math.PI) > 0);
});

test('방패를 주우면 방패가 있던 쪽을 보고 손에 들어와, 그 선 위의 상대에게 바로 던져 맞힐 수 있다', () => {
  const b = makeBattle({ weaponId: 'shield' }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0; f.weaponAngle = 2.5;
  assert.equal(throwDisc(b, f), true);
  // 방패가 아래쪽(+y)에 멈춰 있고, 그 너머에 상대가 서 있다
  Object.assign(f.disc, { x: 0, y: f.radius + 20, spd: 0, resting: true, armed: true });
  e.x = 0; e.y = 220; e.vx = e.vy = 0; e.st.move = 0; e.maxHp = e.hp = 1e6;
  updateDisc(b, f, 1 / 60);
  assert.equal(f.disc, null, '주웠다');
  assert.ok(Math.abs(angleDelta(f.weaponAngle, Math.PI / 2)) < 1e-9, '방패가 있던 쪽(아래)을 보며 손에 들어온다 (' + f.weaponAngle.toFixed(3) + ')');
  assert.equal(useSkill(b, f, 'weapon'), true, '곧바로 다시 던진다');
  assert.ok(Math.abs(f.disc.vx) < 1e-9 && Math.abs(f.disc.vy - 1) < 1e-9, '상대 쪽으로 날아간다');
  const hp = e.hp;
  for (let i = 0; i < 120 && e.hp === hp && f.disc; i++) { e.x = 0; e.y = 220; updateDisc(b, f, 1 / 60); }
  assert.ok(e.hp < hp, '줍자마자 던진 방패가 상대를 맞힌다');
});

test('자기 방패: 던지면 8초 쿨타임이 돌고, 그 전에 주우면 바로 초기화된다', () => {
  const b = makeBattle({ weaponId: 'shield', augments: ['sh_magnet'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  e.x = 300; e.y = 300;
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0; f.weaponAngle = 0;
  assert.equal(WEAPONS.shield.recallCd, 8);
  assert.equal(useSkill(b, f, 'weapon'), true, '던진다');
  assert.ok(f.disc);
  assert.equal(f.skillUses.cd, 8, '던지면 8초 쿨타임');
  assert.equal(useSkill(b, f, 'weapon'), false, '쿨타임 중에는 불러올 수 없다');
  // 주인 발밑까지 굴러온 방패를 줍는다
  Object.assign(f.disc, { x: f.x + 5, y: f.y, spd: 0, resting: true, armed: true });
  updateDisc(b, f, 1 / 60);
  assert.equal(f.disc, null, '주웠다');
  assert.equal(f.skillUses.cd, 0, '주우면 쿨타임이 바로 풀린다');
  assert.equal(useSkill(b, f, 'weapon'), true, '곧바로 다시 던진다');
  // 자기 방패가 없으면 예전처럼 쿨타임도 불러오기도 없다
  const plain = makeBattle({ weaponId: 'shield' }, { weaponId: 'sword' });
  const g = plain.fighters[0];
  computeStats(g); g.weaponAngle = 0;
  assert.equal(useSkill(plain, g, 'weapon'), true);
  assert.equal(g.skillUses.cd, 0);
  updateCooldowns(plain, g, 9);
  assert.equal(useSkill(plain, g, 'weapon'), false, '던져 둔 방패는 주워야 한다');
  assert.equal(!!(g.disc && g.disc.returning), false);
});

test('자기 방패: 8초 뒤 스킬로 불러오면 적을 관통하며 한 번씩 때리고 손에 돌아온다', () => {
  const b = makeBattle({ weaponId: 'shield', augments: ['sh_magnet'] }, { weaponId: 'sword' });
  const [f, e] = b.fighters;
  computeStats(f); computeStats(e);
  f.x = 0; f.y = 0; f.vx = 0; f.vy = 0; f.weaponAngle = 0; f.st.move = 0;
  assert.equal(useSkill(b, f, 'weapon'), true);
  const d = f.disc;
  // 방패는 멀리 멈춰 있고, 주인과 방패 사이 길목에 상대가 서 있다
  Object.assign(d, { x: 240, y: 0, spd: 0, resting: true, armed: true });
  e.x = 120; e.y = 0; e.vx = 0; e.vy = 0; e.maxHp = e.hp = 1e9; e.st.move = 0;
  updateCooldowns(b, f, 7.5);
  assert.equal(useSkill(b, f, 'weapon'), false, '8초 전에는 부를 수 없다');
  updateCooldowns(b, f, 0.6);
  assert.equal(f.skillUses.cd, 0);
  assert.equal(useSkill(b, f, 'weapon'), true, '8초가 지나면 스킬로 불러온다');
  assert.equal(d.returning, true);
  assert.equal(f.skillUses.cd, 0, '불러오는 데에는 쿨타임을 쓰지 않는다');
  assert.equal(useSkill(b, f, 'weapon'), false, '날아오는 중에는 다시 누를 수 없다');
  let hits = 0, hp = e.hp, frames = 0, lastX = d.x, backward = false;
  while (f.disc && frames++ < 600) {
    e.x = 120; e.y = 0;
    updateDisc(b, f, 1 / 60);
    if (e.hp < hp - 1e-9) { hits++; hp = e.hp; }
    if (d.x > lastX + 1e-9) backward = true;
    lastX = d.x;
  }
  assert.equal(f.disc, null, '주인 손에 돌아왔다');
  assert.equal(hits, 1, '길목의 상대는 한 번 맞는다 (실제 ' + hits + '대)');
  assert.equal(backward, false, '맞아도 튕기지 않고 관통해 곧장 온다');
  assert.ok(frames < 90, '빠르게 돌아온다 (' + frames + '프레임)');
  assert.equal(useSkill(b, f, 'weapon'), true, '손에 들어오면 바로 다시 던진다');
});

test('유도 화살은 가까울 때만 휘고 멀리서는 거의 직진한다', () => {
  const turnPerFrame = gap => {
    const b = makeBattle({ weaponId: 'bow', augments: ['b_homing'] });
    const [f, e] = b.fighters;
    computeStats(f); computeStats(e);
    f.x = 0; f.y = 0; f.vx = 1; f.vy = 0;
    e.x = gap; e.y = 0; e.maxHp = e.hp = 1e9;
    f.weaponAngle = 0.6;                    // 일부러 빗나가게 겨눈다
    b.projectiles.length = 0;
    fireBow(b, f);
    const p = b.projectiles[0];
    const before = p.ang;
    b.updateProjectiles(1 / 60);
    return Math.abs(p.ang - before);
  };
  const far = turnPerFrame(300), near = turnPerFrame(60);
  assert.ok(far < 1e-9,
    '멀리서는 휘면 안 된다 (실제 한 프레임에 ' + far.toFixed(6) + ' rad)');
  assert.ok(near > 0.004,
    '가까이서는 확실히 휘어야 한다 (실제 ' + near.toFixed(4) + ' rad)');

  // 유도 미사일은 이 제한을 받지 않는다 — 유도가 그 증강의 정체성이다
  const mb = makeBattle({ weaponId: 'bow', augments: ['missile'] });
  assert.equal(mb.fighters[0].flags.missile, 1);
});

console.log('\\n' + passed + '개 시뮬레이션 테스트 통과');
`,
].join('\n');

let playerId = 0;
const context = vm.createContext({ console, __assert: assert, __playerId: playerId });
vm.runInContext(source, context, { filename: 'bounce-royal-sim.test.bundle.js' });
