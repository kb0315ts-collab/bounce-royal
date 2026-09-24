'use strict';
/* 솔로 로그라이크 규칙 — 기획서의 약속을 헤드리스로 확인한다.
 * 20웨이브 구성 · 보상 · 라이벌 성장 · 기믹(흡착·복제) · 저장 · 소리 · 선인장 해설. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// vm 안에서 만든 배열·객체는 프로토타입이 달라 deepStrictEqual 전에 평범한 값으로 옮긴다
const plain = value => JSON.parse(JSON.stringify(value));

// 같은 씨앗이면 같은 전투 — 실패가 재현되도록 Math.random을 고정한다
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function load(seed = 7) {
  const ctx = { console, Date, JSON, Map, Set, WeakMap, performance };
  ctx.Math = Object.create(Math); ctx.Math.random = seeded(seed);
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(['js/data.js', 'js/sim.js', 'js/rogue-data.js', 'js/rogue-sim.js', 'js/commentary-core.js'].map(read).join('\n')
    + '\nglobalThis.__g = { CHARACTERS, WEAPONS, AUGMENTS, AUG_BY_ID, aiPickAugment, Battle, BATTLE_TIME,'
    + ' ROGUE_WAVES, ROGUE_MONSTERS, ROGUE_EXCLUDED_AUGMENTS, ROGUE_RIVAL_MEETS, ROGUE_WAVE_COUNT };',
  ctx, { filename: 'rogue-bundle.js' });
  return Object.assign(ctx.__g, { R: ctx.BounceRoyalRogueSim, Core: ctx.BounceRoyalCommentaryCore });
}

test('20웨이브가 기획서의 순서대로 짜여 있다', () => {
  const { ROGUE_WAVES, ROGUE_MONSTERS, ROGUE_WAVE_COUNT } = load();
  assert.equal(ROGUE_WAVE_COUNT, 20);
  assert.deepEqual(plain(ROGUE_WAVES.map(w => w.n)), Array.from({ length: 20 }, (_, i) => i + 1));
  const kinds = { rival: [1, 7, 13, 19], choice: [3, 6, 9, 12, 15, 18], boss: [10, 20] };
  for (const w of ROGUE_WAVES) {
    const expected = Object.keys(kinds).find(k => kinds[k].includes(w.n)) || 'normal';
    assert.equal(w.kind, expected, 'W' + w.n);
    if (w.kind === 'rival') assert.equal(w.meet, kinds.rival.indexOf(w.n) + 1);
    if (w.kind === 'choice') for (const tier of ['weak', 'normal', 'strong']) assert.ok(w.options[tier].spawns.length, 'W' + w.n + tier);
    const lists = w.kind === 'choice' ? Object.values(w.options).map(o => o.spawns) : w.spawns ? [w.spawns] : [];
    for (const spawns of lists) for (const [type, n] of spawns) {
      assert.ok(ROGUE_MONSTERS[type], type);
      assert.ok(n >= 1);
    }
  }
  assert.equal(ROGUE_WAVES[9].boss, 'former');
  assert.equal(ROGUE_WAVES[19].boss, 'current');
  assert.ok(ROGUE_WAVES[15].late && !ROGUE_WAVES[15].hard);
  assert.ok(ROGUE_WAVES[16].late && ROGUE_WAVES[16].hard);
  // 몬스터 13종 + 보스 2종, 이름과 설명이 있다
  const types = ['club', 'slime', 'giant', 'hammer', 'mage', 'volt', 'suction', 'boom', 'drill', 'gel', 'horn', 'spark', 'medic', 'former', 'current'];
  for (const t of types) assert.ok(ROGUE_MONSTERS[t] && ROGUE_MONSTERS[t].name && ROGUE_MONSTERS[t].desc, t);
});

test('아레나 전용 증강 11종은 로그라이크 보상과 라이벌 빌드에 나오지 않는다', () => {
  const { R, AUG_BY_ID, ROGUE_EXCLUDED_AUGMENTS } = load(11);
  assert.equal(ROGUE_EXCLUDED_AUGMENTS.length, 11);
  // 몰락한 강자(fallenPower)는 아레나에서도 이미 삭제돼 기획서 목록에만 남는다
  for (const id of ROGUE_EXCLUDED_AUGMENTS) if (id !== 'fallenPower') assert.ok(AUG_BY_ID[id], id);
  const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
  for (let i = 0; i < 300; i++) for (const aug of R.rollOffers(run)) assert.ok(!ROGUE_EXCLUDED_AUGMENTS.includes(aug.id), aug.id);
  for (let meet = 1; meet <= 4; meet++) R.growRival(run, meet);
  for (const id of run.rival.augments) assert.ok(!ROGUE_EXCLUDED_AUGMENTS.includes(id), id);
});

test('라이벌은 캐릭터·무기가 런 내내 같고, 만날 때마다 1 → 9 → 16 → 25개로 자란다', () => {
  const { R, AUG_BY_ID, ROGUE_RIVAL_MEETS } = load(3);
  assert.deepEqual(plain(ROGUE_RIVAL_MEETS.map(m => [m.augments, m.weaponAugments])), [[1, 0], [9, 1], [16, 2], [25, 3]]);
  for (let seed = 0; seed < 6; seed++) {
    const run = R.newRun({ charId: 'cat', weaponId: 'bow' });
    const { charId, weaponId } = run.rival;
    for (let meet = 1; meet <= 4; meet++) {
      const before = run.rival.augments.slice();
      R.growRival(run, meet);
      const rv = run.rival;
      assert.equal(rv.charId, charId); assert.equal(rv.weaponId, weaponId);
      assert.equal(rv.augments.length, ROGUE_RIVAL_MEETS[meet - 1].augments);
      assert.deepEqual(plain(rv.augments.slice(0, before.length)), plain(before), '지난 빌드는 그대로 두고 더한다');
      const weaponAugs = rv.augments.filter(id => AUG_BY_ID[id].weapon);
      assert.ok(weaponAugs.every(id => AUG_BY_ID[id].weapon === weaponId), '무기 증강은 자기 무기 것');
      // 아레나처럼 겹쳐 받을 수 있는 스탯 증강(stackable)만 두 번 이상 나온다
      const once = rv.augments.filter(id => !AUG_BY_ID[id].stackable);
      assert.equal(new Set(once).size, once.length, '겹칠 수 없는 증강을 두 번 받지 않는다');
      if (meet > 1) assert.equal(weaponAugs.length, Math.min(ROGUE_RIVAL_MEETS[meet - 1].weaponAugments,
        run.rival.weaponAugOrder.length + weaponAugs.length));
    }
  }
});

test('보상: 약함은 스탯 10%, 보통은 증강 1회, 강함은 증강 2회, 그 밖의 웨이브는 증강 1회', () => {
  const { R } = load(5);
  const fakeBattle = (run, tier, won = true) => {
    const b = R.createWaveBattle(run, { tier });
    b.result = { winner: won ? b.rogueHero : b.fighters[1], reason: 'test' };
    return b;
  };
  const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
  let res = R.finishWave(run, fakeBattle(run));
  assert.deepEqual(plain(res.reward), { kind: 'augment', picks: 1 });
  R.advance(run); R.advance(run);
  assert.equal(run.wave, 3);
  for (const [tier, reward] of [['weak', { kind: 'stat' }], ['normal', { kind: 'augment', picks: 1 }], ['strong', { kind: 'augment', picks: 2 }]]) {
    res = R.finishWave(run, fakeBattle(run, tier));
    assert.deepEqual(plain(res.reward), reward, tier);
    assert.equal(run.pendingReward.wave, 3);
  }
  assert.equal(R.applyStatReward(run, 'atk'), true);
  assert.equal(run.player.bonusAtk, 1.1);
  R.applyStatReward(run, 'atk');
  assert.equal(run.player.bonusAtk, 1.21);
  // 스탯 보너스가 실제 전투 능력치에 들어간다
  const b = R.createWaveBattle(run, { tier: 'weak' });
  assert.ok(Math.abs(b.rogueHero.perm.atk - 1.21) < 1e-9);
  // 지면 런이 끝난다
  res = R.finishWave(run, fakeBattle(run, 'normal', false));
  assert.equal(res.won, false); assert.equal(run.status, 'dead');
});

test('저장한 런은 그대로 되살아나고, 깨진 저장본은 버린다', () => {
  const { R } = load(9);
  const run = R.newRun({ charId: 'bomb', weaponId: 'staff' });
  R.fastForward(run, 8);
  R.applyStatReward(run, 'move');
  run.pendingReward = { kind: 'augment', picks: 2, left: 1, wave: 7 };
  const back = R.restoreRun(JSON.parse(JSON.stringify(run)));
  assert.equal(back.wave, 8);
  assert.deepEqual(plain(back.player.augments), plain(run.player.augments));
  assert.equal(back.player.bonusMove, run.player.bonusMove);
  assert.deepEqual(plain(back.rival.augments), plain(run.rival.augments));
  assert.equal(back.rival.meets, run.rival.meets);
  assert.deepEqual(plain(back.pendingReward), plain(run.pendingReward));
  assert.equal(R.restoreRun({ ...JSON.parse(JSON.stringify(run)), v: 99 }), null);
  assert.equal(R.restoreRun({ ...JSON.parse(JSON.stringify(run)), wave: 40 }), null);
  assert.equal(R.restoreRun({ ...JSON.parse(JSON.stringify(run)), status: 'dead' }), null);
  assert.equal(R.restoreRun(null), null);
});

test('흡착볼은 약하게 스치면 붙어 있고, 벽에 세게 부딪혀야 떨어진다', () => {
  const { R, ROGUE_MONSTERS } = load(13);
  const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
  R.fastForward(run, 2);
  const b = R.createWaveBattle(run, {});
  const hero = b.rogueHero;
  const s = R.addMonster(b, 'suction', hero.x + 40, hero.y, {});
  s.attached = { target: hero, ang: 0 }; s.phased = true;
  const limit = ROGUE_MONSTERS.suction.impact;
  b.rogue.afterMove(b, hero, 1 / 60, 1, true, limit * 0.5);
  assert.ok(s.attached, '약한 충돌로는 안 떨어진다');
  b.rogue.afterMove(b, hero, 1 / 60, 0, false, limit * 3);
  assert.ok(s.attached, '벽에 닿지 않았으면 안 떨어진다');
  b.rogue.afterMove(b, hero, 1 / 60, 1, true, limit * 1.2);
  assert.equal(s.attached, null);
  assert.equal(s.phased, false);
  assert.ok(s.hp < s.maxHp, '벽과 공 사이에 끼어 피해를 입는다');
  assert.ok(b.rogueEvents.some(e => e.type === 'SUCTIONBALL_DETACHED'));
});

test('멀티젤 한 가족은 8마리(1 → 2 → 4 → 8)를 넘게 태어나지 않는다', () => {
  const { R } = load(17);
  const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
  R.fastForward(run, 2);
  const b = R.createWaveBattle(run, {});
  for (const f of b.fighters) if (f !== b.rogueHero) f.dead = true;
  const hero = b.rogueHero;
  hero.phased = true;                          // 영웅은 구경만 한다
  hero.timers.stun = 999;
  const gel = R.addMonster(b, 'gel', 0, 0, {});
  b.phase = 'fight';
  const born = new Set([gel.uid]);
  for (let i = 0; i < 60 * 70; i++) {
    b.update(1 / 60);
    for (const f of b.fighters) if (f.mtype === 'gel') born.add(f.uid);
  }
  assert.equal(born.size, 8);
  assert.equal(gel.ai.family.born, 8);
  assert.ok(b.rogueEvents.some(e => e.type === 'MULTIGEL_DUPLICATED'));
});

test('일반 몬스터는 예고 없이 무기를 돌린다 — 닿을 때 맞고, 떨어졌다 다시 닿아야 또 맞는다', () => {
  const { R, ROGUE_MONSTERS } = load(53);
  const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
  R.fastForward(run, 2);
  const b = R.createWaveBattle(run, {});
  b.phase = 'fight';
  for (const f of b.fighters) if (f.monster) f.dead = true;
  const def = ROGUE_MONSTERS.club;
  const club = R.addMonster(b, 'club', 0, 0, {});
  club.ai.hold = true;                       // 제자리에서 무기만 돌린다
  club.maxHp = club.hp = 99999;
  const hero = b.rogueHero;
  b.setPos(hero, club.radius + def.reach * 0.75, 0, 0);
  const startAngle = club.weaponAngle;
  let hits = 0, hp = hero.hp;
  for (let i = 0; i < 60 * 9; i++) {
    hero.vx = 0; hero.vy = 0;                // 주인공은 가만히 서서 맞아 준다
    hero.timers.stun = 9;                    // 제 무기로 몽둥이를 치지 않게
    b.setPos(hero, club.radius + def.reach * 0.75, 0, 0);
    b.update(1 / 60);
    if (hero.hp < hp) { hits++; hp = hero.hp; }
  }
  assert.notEqual(club.weaponAngle, startAngle, '무기는 늘 돌고 있다');
  assert.equal(b.rogueHazards.length, 0, '일반 몬스터는 바닥에 예고를 깔지 않는다');
  /* 한 바퀴에 한 번꼴로 맞는다 — 닿는 순간 한 번 맞고, 무기가 지나갔다 돌아와야 또 맞는다.
   * (9초 · 초당 rot * GAME_SPEED 라디안이면 두세 바퀴다.) */
  const turns = def.rot * 0.583 * 9 / (Math.PI * 2);
  assert.ok(hits >= 1 && hits <= Math.ceil(turns) + 1, `${hits}대 (예상 ${turns.toFixed(1)}바퀴)`);
  assert.ok(hero.hp < hero.maxHp);
});

test('20웨이브 모두 오류 없이 끝나고(교착 없음) 이기면 적이 하나도 남지 않는다', () => {
  const { R } = load(21);
  for (let n = 1; n <= 20; n++) {
    const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
    R.fastForward(run, n);
    const wave = R.waveDef(n);
    const res = R.simulateWave(run, { heroSkill: 0.8, tier: wave.kind === 'choice' ? 'normal' : null, cap: 200 });
    const b = res.battle;
    assert.equal(res.stalled, false, 'W' + n + ' 교착');
    assert.ok(b.result, 'W' + n);
    if (res.won) assert.equal(R.aliveMonsters(b).length, 0, 'W' + n);
    // 제한 시간이 없다: 45초가 지나도 판정으로 끝나지 않는다
    assert.notEqual(b.result.reason, '체력 비율 판정', 'W' + n);
    // 이긴 뒤에는 남은 예고가 터지지 않는다
    if (res.won) assert.ok(b.rogueHazards.every(h => h.kind === 'puddle'), 'W' + n);
  }
});

test('보스전은 등장 이벤트를 내고, 모든 광역 공격은 예고(warn) 뒤에 터진다', () => {
  const { R } = load(31);
  for (const n of [10, 20]) {
    const run = R.newRun({ charId: 'cat', weaponId: 'bow' });
    R.fastForward(run, n);
    const b = R.createWaveBattle(run, { autoplay: true, heroSkill: 0.8 });
    assert.ok(b.rogueEvents.some(e => e.type === (n === 10 ? 'FORMER_CHAMPION_APPEAR' : 'CURRENT_CHAMPION_APPEAR')));
    const seen = new Set();
    for (let i = 0; i < 60 * 40 && !b.result; i++) {
      b.update(1 / 60);
      for (const h of b.rogueHazards) {
        if (seen.has(h) || h.kind === 'puddle' || !(h.dmg > 0)) continue;
        seen.add(h);
        // 벽 충격파(해머가 벽에 닿는 순간의 수동 효과)만 예고 없이 벽에서 번진다
        if (h.source === 'monster:former-shock') continue;
        assert.ok(h.warn >= 0.45, `W${n} ${h.kind}/${h.theme} 예고 ${h.warn}`);
      }
    }
    assert.ok(seen.size > 0, 'W' + n + ' 보스가 패턴을 썼다');
  }
});

test('전시관 훅: 볼트윈은 짝과 함께 서고, 보스는 지정한 패턴을 바로 쓴다', () => {
  const { R } = load(61);
  const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
  R.fastForward(run, 2);
  const b = R.createWaveBattle(run, { autoplay: true });
  b.phase = 'fight'; b.simT = 0;                 // 전시관처럼 카운트다운 없이 곧장 시작한다
  for (const f of b.fighters) if (f.monster) f.dead = true;
  // 짝이 있는 종류는 한 번에 둘이 서고 둘 사이에 줄이 이어진다
  const pair = R.spawnMonster(b, 'volt', 40, 0, {});
  assert.equal(pair.length, 2);
  assert.equal(pair[0].ai.partner, pair[1]);
  assert.equal(pair[0].ai.link, pair[1].ai.link);
  assert.equal(R.spawnMonster(b, 'club', -40, 0, {}).length, 1);

  // 보스에게 패턴을 지정하면 다음 고를 때 그 패턴이 나온다
  const boss = R.spawnMonster(b, 'former', 0, -80, {})[0];
  R.forcePattern(boss, 'leap');
  Object.assign(boss.ai, { state: 'walk', t: 0 });
  let leaped = false;
  for (let i = 0; i < 60 * 3 && !leaped; i++) {
    b.update(1 / 60);
    if (boss.ai.state === 'crouch' || boss.ai.state === 'air') leaped = true;
  }
  assert.equal(leaped, true, '지정한 도약 패턴이 나왔다');
  assert.equal(boss.ai.force, null, '지정은 한 번만 쓰인다');
});

test('일반 전투(PvP)는 로그라이크 훅이 없으면 예전 그대로다', () => {
  const { Battle, BATTLE_TIME } = load(1);
  const p = (id, isAI) => ({ id, name: 'p' + id, isAI, color: '#4da6ff', charId: 'cat', weaponId: 'sword', coins: 5, coinsLost: 0,
    augments: [], augmentBaselines: {}, wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0, gamble: false, trollCondition: false, damageRewardMult: 1 });
  const b = new Battle('square', [p(1, true), p(2, true)]);
  assert.equal(b.noTimeLimit, false);
  assert.equal(b.rogue, null);
  for (let i = 0; i < 60 * (BATTLE_TIME + 6) && !b.result; i++) b.update(1 / 60);
  assert.ok(b.result, '제한 시간 안에 끝난다');
  assert.ok(b.fighters.every(f => !f.brain && !f.monster));
});

test('로그라이크가 내는 소리는 모두 사운드 카탈로그에 있고 8겹을 넘지 않는다', () => {
  const { catalog } = require('../js/audio.js');
  const byId = new Map(catalog.map(item => [item.id, item]));
  const used = new Set();
  for (const file of ['js/rogue-sim.js', 'js/rogue.js']) {
    for (const m of read(file).matchAll(/'((?:monster|boss|rogue)\.[a-z]+(?:\.[a-z]+)*)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 40, String(used.size));
  for (const id of used) {
    assert.ok(byId.has(id), id);
    assert.equal(byId.get(id).group, '로그라이크', id);
  }
  // 새 소리는 청음실 '캐주얼 리뉴얼' 목록(59개)에 끼지 않는다
  assert.ok([...used].every(id => !byId.get(id).revised));
});

test('선인장: 첫 만남엔 라이벌이라 부르지 않고, 두 번째부터 관계를 이어서 말한다', () => {
  const { R, Core, WEAPONS, CHARACTERS } = load(41);
  const lines = n => {
    const run = R.newRun({ charId: 'cat', weaponId: 'sword' });
    R.fastForward(run, [1, 7, 13, 19][n - 1]);
    const b = R.createWaveBattle(run, { autoplay: true });
    const d = new Core.Director({ weapons: WEAPONS, characters: CHARACTERS });
    const out = [];
    let now = 1000;
    for (let i = 0; i < 60 * 9; i++) {
      b.update(1 / 60); now += 1000 / 60;
      const line = d.observe(b, now);
      if (line && line.kind === 'rg-intro') out.push(line);
    }
    return { out, rival: run.rival.name };
  };
  const first = lines(1);
  assert.ok(first.out.length >= 2);
  assert.ok(first.out.every(l => !l.text.includes('라이벌') && l.label !== '라이벌'), first.out.map(l => l.text).join(' / '));
  const second = lines(2);
  assert.ok(second.out[0].text.includes(second.rival), second.out[0].text);
  const final = lines(4);
  assert.ok(final.out.some(l => /챔피언|마지막|네 번째|여기까지/.test(l.text)));
});

test('선인장: 처음 본 기믹은 우선해서 말하고, 평범한 반복은 한도 뒤로 조용해진다', () => {
  const { Core, WEAPONS, CHARACTERS } = load(43);
  const d = new Core.Director({ weapons: WEAPONS, characters: CHARACTERS });
  const hero = { uid: 1, name: '바운서', hp: 100, maxHp: 100, x: 0, y: 0, radius: 22 };
  const battle = { soundId: 900, soundSource: 'rogue', phase: 'fight', simT: 20, fighters: [hero], commentaryEvents: [],
    rogueHero: hero, rogueEvents: [], result: null,
    rogueWave: { n: 11, kind: 'normal', runId: 'run-x', meet: 0, rivalName: '녹스', rivalAugments: 0 } };
  let seq = 0, now = 60000;
  const say = type => {
    battle.rogueEvents.push({ seq: ++seq, t: battle.simT, type, actor: 0, target: 0, data: null });
    now += 30000; battle.simT += 30;
    for (const e of battle.rogueEvents) e.t = battle.simT;
    return d.observe(battle, now);
  };
  // 소개 한 줄은 먼저 흘려 보낸다
  battle.simT = 20; d.observe(battle, now); now += 9000;
  const first = say('SUCTIONBALL_ATTACHED');
  assert.equal(first.priority, 90);
  assert.equal(first.text, '흡착볼이 붙었습니다.');
  now += 9000;
  const tip = d.observe(battle, now);
  assert.equal(tip.text, '벽에 강하게 부딪히면 떨어질 겁니다.');
  const again = [say('SUCTIONBALL_ATTACHED'), say('SUCTIONBALL_ATTACHED'), say('SUCTIONBALL_ATTACHED'), say('SUCTIONBALL_ATTACHED')];
  assert.equal(again.filter(Boolean).length, 2, '평범한 반복은 두 번까지');
  assert.ok(again[0].priority < 60);
  // 강한 위험은 반복돼도 계속 말한다
  const heal = [say('MEDICBALL_BIG_HEAL'), say('MEDICBALL_BIG_HEAL'), say('MEDICBALL_BIG_HEAL')];
  assert.equal(heal[0].priority, 90);
  assert.ok(heal.slice(1).every(l => l && l.priority === 64));
});
