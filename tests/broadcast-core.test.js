'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { snapshot } = require('../server/snapshot.js');
const { voiceDuration, sourceName, recapLines, eventIntro, eventWinner,
  ReplayBuffer, paintFrame, playbackFrame } = require('../js/broadcast-core.js');

const json = value => JSON.parse(JSON.stringify(value));
const weapons = { sword: { name: '검', skillName: '믹서기' },
  bow: { name: '활', skillName: '차지 샷' } };
const characters = { cat: { skillName: '고양이 발바닥' } };

function runtime() {
  let seed = 931, randomCalls = 0, pid = 0;
  const math = Object.create(Math);
  math.random = () => {
    randomCalls++;
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const ctx = vm.createContext({ console, Math: math, performance, Map, Set });
  const names = ['Battle', 'battleCommentary', 'recordRoundFact', 'pruneBattleCommentary',
    'spawnProj', 'projectileHit', 'useSkill', 'updateTimers', 'weaponDamage', 'dealDamage',
    'healFighter', 'netBattleView', 'lerpSnapshot', 'updateWeapon'];
  vm.runInContext(['js/data.js', 'js/sim.js', 'js/net.js'].map(file =>
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n')
    + '\nglobalThis.api = {' + names.join(',') + '};', ctx);
  const player = opts => Object.assign({ id: ++pid, name: '선수' + pid, isAI: false,
    color: '#4da6ff', charId: 'cat', weaponId: 'sword', coins: 5, coinsLost: 0,
    augments: [], augmentBaselines: {}, wins: 0, losses: 0, streak: 0,
    rounds: 0, totalDmg: 0, damageRewardMult: 1 }, opts);
  const battle = (a = {}, b = {}, opts = {}) => new ctx.api.Battle('circle', [player(a), player(b)], opts);
  return { ...ctx.api, battle, randomCalls: () => randomCalls };
}

test('라운드 피해 리포트는 보호막·면역·과잉 피해를 제외한 실제 HP 손실만 누적한다', () => {
  const r = runtime(), b = r.battle(), [a, target] = b.fighters;
  b.phase = 'fight';
  target.timers.immune = 1;
  r.weaponDamage(b, a, target, 20);
  target.timers.immune = 0; target.timers.untouchable = 1;
  r.weaponDamage(b, a, target, 20);
  target.timers.untouchable = 0; target.shield = 15;
  r.weaponDamage(b, a, target, 10);
  assert.deepEqual(json(b.roundReport[a.pid].damage), {});
  r.weaponDamage(b, a, target, 10);
  assert.equal(b.roundReport[a.pid].damage['weapon:sword'], 5);
  target.hp = 3;
  r.weaponDamage(b, a, target, 100);
  assert.equal(b.roundReport[a.pid].damage['weapon:sword'], 8);
  assert.equal(b.roundReport[a.pid].id, a.pid);
});

test('회복 리포트는 최대 체력을 넘기지 않으며 전투 흡수와 흡혈 폭주를 실제 출처별로 합산한다', () => {
  const r = runtime(), b = r.battle(), [a, target] = b.fighters;
  b.phase = 'fight';
  a.hp = a.maxHp - 20; a.flags.lifesteal = 0.5; a.flags.vampiric = 1;
  r.weaponDamage(b, a, target, 10);
  assert.equal(b.roundReport[a.pid].healing.lifesteal, 5);
  assert.equal(b.roundReport[a.pid].healing.vampiric, a.maxHp * 0.05);
  a.hp = a.maxHp - 2;
  r.weaponDamage(b, a, target, 10);
  assert.equal(b.roundReport[a.pid].healing.lifesteal, 7, '남은 체력 2만 회복으로 기록');
  assert.equal(b.roundReport[a.pid].healing.vampiric, a.maxHp * 0.05,
    '같은 공격의 후속 회복은 이미 최대 체력이면 0');
  r.healFighter(b, a, 500, true, 'lifesteal');
  r.healFighter(b, a, -1, true, 'lifesteal');
  assert.equal(b.roundReport[a.pid].healing.lifesteal, 7);
  a.hp = a.maxHp - 3;
  r.healFighter(b, a, 20, true);
  assert.equal(b.roundReport[a.pid].healing.heal, 3, '일반 회복은 흡혈과 구분');
  const lines = recapLines(b.roundReport[a.pid], weapons, characters);
  assert.ok(lines.some(line => line.includes('흡혈') && line.includes('12')));
});

test('누적 기록은 짧은 해설 이벤트가 잘려도 보존되고 다음 전투와 demo에 섞이지 않는다', () => {
  const r = runtime(), b = r.battle(), [a, target] = b.fighters;
  b.phase = 'fight';
  for (let i = 0; i < 140; i++) r.battleCommentary(b, 'hit', a, target, 'augment:shuriken', 0.5);
  assert.equal(b.commentaryEvents.length, 96);
  assert.equal(b.roundReport[a.pid].damage['augment:shuriken'], 70);
  b.simT = 3; r.pruneBattleCommentary(b);
  assert.equal(b.commentaryEvents.length, 0);
  assert.equal(b.roundReport[a.pid].damage['augment:shuriken'], 70);
  assert.ok(Object.values(r.battle().roundReport).every(row=>Object.keys(row.damage).length===0));
  const demo = r.battle({}, {}, { demo: true });
  r.battleCommentary(demo, 'hit', demo.fighters[0], demo.fighters[1], 'weapon:sword', 10);
  demo.fighters[0].hp -= 5;
  r.healFighter(demo, demo.fighters[0], 5, true, 'lifesteal');
  assert.equal(demo.roundReport, undefined);
});

test('소환수에 준 피해는 제외하고 분열체의 피해·회복은 원래 선수에게 귀속한다', () => {
  const r = runtime(), b = r.battle(), [a, target] = b.fighters;
  b.phase = 'fight'; b.spawnSummon(target);
  r.weaponDamage(b, a, target.summons[0], 3);
  assert.deepEqual(json(b.roundReport[a.pid].damage), {});
  b.spawnSplits(a); b.spawnSplits(target);
  const split = a.splitBalls[0];
  r.weaponDamage(b, split, target.splitBalls[0], 2);
  const actual = b.commentaryEvents.at(-1).amount;
  assert.equal(b.roundReport[a.pid].damage['weapon:sword'], actual);
  split.hp -= 1;
  r.healFighter(b, split, 5, true, 'lifesteal');
  assert.equal(b.roundReport[a.pid].healing.lifesteal, 1);
  assert.deepEqual(Object.keys(b.roundReport), [String(a.pid),String(target.pid)]);
  assert.deepEqual(json(b.roundReport[target.pid].damage), {});
});

test('차지 시작만 한 경우 빗나감이라 하지 않으며 실제 발사와 유효 적중을 구분한다', () => {
  const r = runtime(), b = r.battle({ weaponId: 'bow' }), [a, target] = b.fighters;
  b.phase = 'fight';
  assert.equal(r.useSkill(b, a, 'weapon'), true);
  assert.equal(b.roundReport[a.pid].skills['skill:bow'], 1);
  assert.equal(b.roundReport[a.pid].releases['skill:bow'], undefined);
  assert.equal(r.useSkill(b, a, 'weapon'), false);
  assert.ok(recapLines(b.roundReport[a.pid], weapons, characters).every(line => !line.includes('발사했지만')));
  r.updateTimers(b, a, 0.25);
  assert.equal(r.useSkill(b, a, 'weapon'), true);
  assert.equal(b.roundReport[a.pid].releases['skill:bow'], 1);
  let lines = recapLines(b.roundReport[a.pid], weapons, characters);
  assert.match(lines[0], /발사했지만 체력 피해로 이어지지/);
  const charge = b.projectiles.find(p => p.kind === 'charge');
  target.shield = 30; r.projectileHit(b, charge, target);
  assert.equal(b.roundReport[a.pid].damage['skill:bow'], undefined);
  lines = recapLines(b.roundReport[a.pid], weapons, characters);
  assert.ok(lines.every(line => !line.includes('빗나')),
    '보호막 적중과 진짜 빗나감을 구분할 수 없으면 피해로 이어지지 않았다고만 말한다');
  r.projectileHit(b, charge, target);
  assert.equal(b.roundReport[a.pid].damage['skill:bow'], 30);
  lines = recapLines(b.roundReport[a.pid], weapons, characters);
  assert.ok(lines.some(line => line.includes('차지 샷') && line.includes('30')));
  assert.ok(lines.every(line => !line.includes('발사했지만')));
});

test('완료된 라운드의 리포트가 스냅샷·보간·온라인 뷰를 통과하고 구형 서버도 호환된다', () => {
  const r = runtime(), b = r.battle(), [a, target] = b.fighters;
  b.phase = 'fight'; r.dealDamage(b, a, target, 5, { kind: 'auto', autoType: 'shuriken' });
  const before = json(snapshot(b));
  assert.equal(before.rr, undefined, '전투 중에는 매 스냅샷마다 누적 기록을 보내지 않는다');
  b.finish(a, '격파');
  const done = json(snapshot(b));
  assert.deepEqual(done.rr, json(b.roundReport));
  const mixed = r.lerpSnapshot(before, done, 0.5, 50);
  const view = r.netBattleView(mixed, b.fighters.map(f => f.player), a.pid);
  assert.deepEqual(json(view.roundReport), done.rr);
  delete done.rr;
  assert.equal(r.netBattleView(done, [], 0).roundReport, undefined);
});

test('리포트 문구는 알려진 출처와 실제 수치를 쓰고 보조 공격·흡혈을 짧게 안내한다', () => {
  const row = { damage: { 'weapon:sword': 90, 'augment:shuriken': 18.26,
    'skill:bow': 30, 'damage:unknown': 1000 }, healing: { lifesteal: 3.5, vampiric: 2 }, releases: {} };
  const before = json(row), lines = recapLines(row, weapons, characters);
  assert.match(lines[0], /표창.*18.3/);
  assert.ok(lines.some(line => line.includes('흡혈') && line.includes('5.5')));
  assert.ok(lines.some(line => line.includes('차지 샷') && line.includes('30')));
  assert.ok(lines.every(line => !line.includes('1000')));
  assert.ok(lines.length <= 4);
  assert.deepEqual(row, before);
  assert.match(recapLines(null, weapons, characters)[0], /기록을 받지 못했/);
  assert.equal(sourceName('weapon:sword', weapons, characters), '검');
  assert.equal(sourceName('skill:bow', weapons, characters), '차지 샷');
  assert.equal(sourceName('char:cat', weapons, characters), '고양이 발바닥');
  assert.equal(sourceName('not:known', weapons, characters), null);
});

test('선인장 웅얼거림은 빈 대사부터 긴 대사까지 0.5~1.5초이며 대사 길이에 따라 증가한다', () => {
  assert.equal(voiceDuration(''), 500);
  assert.equal(voiceDuration(null), 500);
  assert.equal(voiceDuration('가'.repeat(1000)), 1500);
  let previous = 0;
  for (let n = 0; n < 100; n++) {
    const duration = voiceDuration('가'.repeat(n));
    assert.ok(duration >= 500 && duration <= 1500);
    assert.ok(duration >= previous);
    previous = duration;
  }
  assert.equal(voiceDuration('🌵'.repeat(10)), voiceDuration('가'.repeat(10)),
    '이모지는 UTF-16 코드 단위 두 개가 아니라 한 글자로 계산');
});

test('이벤트 해설은 투표 방식과 당첨된 선수·이벤트의 설명을 그대로 안내한다', () => {
  assert.match(eventIntro().join(' '), /세 선택지/);
  assert.match(eventIntro().join(' '), /네 명 중 한 명/);
  const event = { name: '4인 난투', desc: '다음 라운드는 네 명이 함께 싸웁니다.' };
  const lines = eventWinner(event, { name: '선인장팬' });
  assert.ok(lines[0].includes('선인장팬'));
  assert.ok(lines[0].includes(event.name));
  assert.ok(lines[0].includes(event.desc));
  assert.deepEqual(eventWinner(null, null), []);
});

test('리플레이는 실제 렌더 상태의 복사본이며 원본 게임·난수·엔티티 UID를 바꾸지 않는다', () => {
  const r = runtime(), b = r.battle(), [a] = b.fighters;
  b.phase = 'fight';
  const proj = () => r.spawnProj(b, a, { kind: 'arrow', x: 13, y: 17, ang: 0.3, r: 5 });
  const projectile = proj();
  b.flames.push({owner:a,x:1,y:2,r:3,life:2});
  b.stickies.push({owner:a,x:3,y:4,r:5,life:2});
  const before = json(snapshot(b)), randomBefore = r.randomCalls(), eventsBefore = json(b.commentaryEvents);
  const frame = paintFrame(b);
  const buffer = new ReplayBuffer();
  buffer.capture(b, 0, 1);
  for (let i = 1; i < 12; i++) buffer.capture(b, i * 80, 1);
  buffer.clips();
  assert.equal(r.randomCalls(), randomBefore);
  assert.deepEqual(json(snapshot(b)), before);
  assert.deepEqual(json(b.commentaryEvents), eventsBefore);
  assert.equal(frame.isReplay, true);
  assert.equal(frame.fighters[0].x, a.x);
  assert.equal(frame.projectiles[0].x, projectile.x);
  assert.equal(frame.projectiles[0].owner, frame.fighters[0]);
  assert.notEqual(frame.projectiles[0].owner, a);
  assert.equal(proj().uid, projectile.uid + 1);
  frame.fighters[0].x = 900; frame.fighters[0].timers.stun = 99;
  frame.arena.L = -1; frame.projectiles[0].x = -1;
  assert.notEqual(a.x, 900); assert.notEqual(a.timers.stun, 99);
  assert.notEqual(b.arena.L, -1); assert.notEqual(projectile.x, -1);
  assert.equal(frame.flames[0].owner,undefined,'cyclic owner references are never copied');
});

test('리플레이 버퍼는 80ms 간격·100프레임으로 제한하고 demo·카운트다운·재생 화면은 녹화하지 않는다', () => {
  const r = runtime(), b = r.battle(), buffer = new ReplayBuffer();
  buffer.capture(b, 0, 1);
  assert.equal(buffer.frames.length, 0);
  b.phase = 'fight'; b.demo = true; buffer.capture(b, 0, 1);
  b.demo = false; b.isReplay = true; buffer.capture(b, 0, 1);
  assert.equal(buffer.frames.length, 0);
  delete b.isReplay;
  buffer.capture(b, 0, 1); buffer.capture(b, 79, 1);
  assert.equal(buffer.frames.length, 1);
  for (let i = 1; i <= 150; i++) {
    b.simT = i * 0.08; b.fighters[0].x = i;
    buffer.capture(b, i * 80, 1);
  }
  assert.equal(buffer.frames.length, 100);
  assert.equal(buffer.frames[0].paint.fighters[0].x, 51);
  assert.equal(buffer.frames.at(-1).paint.fighters[0].x, 150);
  assert.ok(buffer.frames.every((frame, i, all) => !i || frame.at - all[i - 1].at >= 80));
});

test('결정타·짧은 폭딜·무기 스킬 주요 장면은 실제 프레임만 보관하고 같은 장면을 중복 선정하지 않는다', () => {
  const r = runtime(), b = r.battle(), [a, target] = b.fighters, buffer = new ReplayBuffer();
  b.phase = 'fight';
  const sourceFrames = new Map();
  for (let i = 0; i <= 105; i++) {
    const at = i * 80;
    b.simT = at / 1000; a.x = i; target.x = -i;
    if (i === 20) r.battleCommentary(b, 'skill', a, null, 'skill:sword');
    if (i === 55 || i === 56) r.battleCommentary(b, 'hit', a, target, 'weapon:sword', 20);
    if (i === 90) { b.finish(a, '격파'); b.matchConclusion = { id: a.pid }; }
    sourceFrames.set(at, { x: a.x, phase: b.phase });
    buffer.capture(b, at, 4);
  }
  const clips = buffer.clips();
  assert.deepEqual(clips.map(clip => clip.kind), ['skill', 'burst', 'final']);
  assert.equal(clips.find(clip => clip.kind === 'burst').amount, 40,
    '유지되는 이벤트 배열을 매 프레임 다시 합산하지 않는다');
  assert.equal(clips.at(-1).decisive, true);
  for (const clip of clips) {
    assert.ok(clip.frames.length >= 5 && clip.frames.length <= 34);
    assert.equal(clip.round, 4);
    for (const frame of clip.frames) {
      assert.equal(frame.paint.fighters[0].x, sourceFrames.get(frame.at).x);
      assert.equal(frame.paint.phase, sourceFrames.get(frame.at).phase);
      assert.ok(frame.at >= clip.at - 1600 && frame.at <= clip.at + 1000);
    }
  }
  assert.deepEqual(buffer.clips(), clips, '반복 조회는 새 클립을 만들지 않는다');

  const close = new ReplayBuffer(), other = r.battle(); other.phase = 'fight';
  for (let i = 0; i <= 30; i++) {
    other.simT = i * 0.08;
    if (i === 20) {
      const [actor, victim] = other.fighters;
      r.battleCommentary(other, 'skill', actor, null, 'skill:sword');
      r.battleCommentary(other, 'hit', actor, victim, 'weapon:sword', 35);
      other.finish(actor, '격파');
    }
    close.capture(other, i * 80, 1);
  }
  assert.deepEqual(close.clips().map(clip => clip.kind), ['final'],
    '결정타와 같은 순간의 폭딜·스킬은 같은 장면으로 세 번 재생하지 않는다');
});

test('전투가 바뀌면 장면을 섞지 않으며 reset은 모든 이전 경기 기록을 지운다', () => {
  const r = runtime(), first = r.battle(), second = r.battle(), buffer = new ReplayBuffer();
  first.phase = second.phase = 'fight';
  for (let i = 0; i < 12; i++) {
    first.simT = i * 0.08;
    if (i === 7) first.finish(first.fighters[0], '격파');
    buffer.capture(first, i * 80, 1);
  }
  for (let i = 0; i < 12; i++) {
    second.simT = i * 0.08;
    buffer.capture(second, 1000 + i * 80, 2);
  }
  assert.ok(buffer.frames.every(frame => frame.paint.fighters[0].uid === second.fighters[0].uid));
  assert.equal(buffer.clips()[0].round, 1, '지난 라운드의 완성된 하이라이트는 보존');
  assert.ok(buffer.clips()[0].frames.every(frame => frame.paint.fighters[0].uid === first.fighters[0].uid));
  buffer.reset();
  assert.deepEqual(buffer.clips(), []);
  assert.deepEqual(buffer.frames, []);
  assert.deepEqual(buffer.hits, []);
  assert.deepEqual(buffer.best, {});
  assert.deepEqual(buffer.pending, {});
  assert.equal(buffer.seq, 0);
  assert.equal(buffer.key, null);
  buffer.capture(second, 0, 1);
  assert.equal(buffer.frames.length, 1, '새 경기는 이전 시계나 순번에 막히지 않는다');
});

test('재생 보간은 실제 UID와 짧은 회전각을 쓰며 원본 프레임이나 체력 판정을 수정하지 않는다', () => {
  const r = runtime(), b = r.battle(), [a] = b.fighters;
  b.phase = 'fight'; a.x = 0; a.y = 10; a.weaponAngle = Math.PI - 0.1;
  const p = r.spawnProj(b, a, { kind: 'arrow', x: 0, y: 0, ang: Math.PI - 0.1, r: 5 });
  const before = paintFrame(b);
  a.x = 100; a.y = 50; a.hp -= 5; a.weaponAngle = -Math.PI + 0.1;
  p.x = 80; p.y = 40; p.ang = -Math.PI + 0.1;
  const after = paintFrame(b), saved = json([before, after]);
  const view = playbackFrame(before, after, 0.5);
  assert.equal(view.fighters[0].x, 50); assert.equal(view.fighters[0].y, 30);
  assert.equal(view.fighters[0].weaponAngle, Math.PI);
  assert.equal(view.projectiles[0].x, 40); assert.equal(view.projectiles[0].y, 20);
  assert.equal(view.projectiles[0].ang, Math.PI);
  assert.equal(view.fighters[0].hp, before.fighters[0].hp, '체력은 재계산하지 않는다');
  assert.equal(view.human(), view.fighters[0]);
  assert.equal(view.isReplay, true);
  assert.deepEqual(json([before, after]), saved);
});

test('신무기 리플레이는 전체 사슬·분열체·화염·방패를 순환 참조 없이 보존하고 보간한다', () => {
  const r = runtime(), b = r.battle({weaponId:'chain'}, {weaponId:'shield'}), [a, shield] = b.fighters;
  b.phase = 'fight';
  r.updateWeapon(b,a,1/60); r.useSkill(b,shield,'weapon');
  b.spawnSplits(a);
  for(const s of a.splitBalls) r.updateWeapon(b,s,1/60);
  a.flame = {on:true,firing:true,fuel:40}; shield.gripT=3;
  const before = paintFrame(b);
  assert.equal(before.fighters[1].disc.owner,undefined);
  assert.equal(before.fighters[1].disc.contact,undefined);
  assert.equal(before.fighters[1].gripT,3);
  assert.deepEqual(before.fighters[0].flame,{on:true,firing:true,fuel:40});
  assert.equal(before.fighters[0].chainHeads[0].nodes.length,4);
  assert.equal(before.fighters[0].chainHeads[0]._sweep,undefined);
  for(const body of [a,...a.splitBalls]) {
    body.x+=20;
    for(const head of body.chainHeads) {
      head.x+=20; for(const node of head.nodes) node.x+=20;
    }
  }
  shield.disc.x+=40;
  const after=paintFrame(b), saved=json([before,after]);
  const mid=playbackFrame(before,after,.5);
  assert.equal(mid.fighters[0].chainHeads[0].x,before.fighters[0].chainHeads[0].x+10);
  assert.equal(mid.fighters[0].chainHeads[0].nodes[0].x,before.fighters[0].chainHeads[0].nodes[0].x+10);
  assert.equal(mid.fighters[0].splitBalls[0].chainHeads[0].x,before.fighters[0].splitBalls[0].chainHeads[0].x+10);
  assert.equal(mid.fighters[1].disc.x,before.fighters[1].disc.x+20);
  assert.deepEqual(json([before,after]),saved);
});

test('짧은 쇠사슬 위치 교환도 리플레이에서 추와 공이 서로 미끄러져 지나가지 않는다', () => {
  const r=runtime(), b=r.battle({weaponId:'chain'}), a=b.fighters[0];
  b.phase='fight'; r.updateWeapon(b,a,1/60);
  const before=paintFrame(b);
  assert.equal(r.useSkill(b,a,'weapon'),true);
  const after=paintFrame(b), mid=playbackFrame(before,after,.5);
  assert.equal(mid.fighters[0].x,after.fighters[0].x);
  assert.deepEqual(mid.fighters[0].chainHeads,after.fighters[0].chainHeads);
});
