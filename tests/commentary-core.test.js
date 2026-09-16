'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Director } = require('../js/commentary-core.js');
const weapons = { bow: { name: '활', skillName: '차지 샷' }, dagger: { name: '단검', skillName: '관통 돌진' },
  sword: { name: '검', skillName: '믹서기' }, staff: { name: '지팡이', skillName: '마력 폭주' } };
const characters = { soft: { name: '말랑이', skillName: '말랑 방어' } };
const makeDirector = () => new Director({ weapons, characters });
const fighter = (uid, name, weaponId = 'bow') => ({ uid, name, weaponId, charId: 'soft',
  color: uid === 1 ? '#55aaff' : '#ff5555', hp: 100, maxHp: 100, player: { streak: 0 } });
const battle = (id = 1) => ({ soundId: id, phase: 'count', simT: 0,
  fighters: [fighter(1, '민수'), fighter(2, '지훈', 'sword')], commentaryEvents: [], result: null });
const event = (b, source, type = 'hit', opts = {}) => {
  const e = { seq: b.commentaryEvents.length + 1, t: b.simT, type, actor: 1, target: type === 'hit' ? 2 : null,
    source, amount: type === 'hit' ? 10 : 0, ...opts };
  b.commentaryEvents.push(e); return e;
};
function running() {
  const d = makeDirector(), b = battle(); d.observe(b, 0); b.phase = 'fight';
  assert.equal(d.observe(b, 100).kind, 'intro'); b.simT = 4;
  return { d, b };
}

test('browser and CommonJS API expose the same pure director without using RNG', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/commentary-core.js'), 'utf8');
  const math = Object.create(Math); math.random = () => { throw new Error('gameplay RNG consumed'); };
  const ctx = { Math: math }; vm.runInNewContext(source, ctx);
  const d = new ctx.BounceRoyalCommentaryCore.Director({ weapons, characters }), b = battle();
  const unchanged = JSON.stringify(b); d.observe(b, 0); assert.equal(JSON.stringify(b), unchanged);
  b.phase = 'fight'; assert.match(d.observe(b, 100).text, /민수의 활/);
});

test('intro mentions an existing winning streak and never invents one', () => {
  const d = makeDirector(), b = battle(); b.fighters[1].player.streak = 3;
  d.observe(b, 0); b.phase = 'fight';
  const line = d.observe(b, 100); assert.match(line.text, /지훈, 3연승/); assert.equal(line.actor.uid, 2);
  assert.equal(d.observe(b, 5000), null);
});

test('damaging skill acceptance is silent until actual HP damage confirms its hit', () => {
  const { d, b } = running(); event(b, 'skill:bow', 'skill');
  assert.equal(d.observe(b, 4000), null);
  b.simT = 4.5; event(b, 'skill:bow', 'hit', { amount: 0 });
  assert.equal(d.observe(b, 4500), null);
  b.simT = 5; event(b, 'skill:bow');
  const line = d.observe(b, 5000); assert.equal(line.kind, 'skill-hit'); assert.match(line.text, /차지 샷.*적중/);
});

test('utility skills can announce activation but never claim a hit', () => {
  const { d, b } = running(); event(b, 'char:soft', 'skill');
  const line = d.observe(b, 4000); assert.equal(line.kind, 'skill-use'); assert.match(line.text, /말랑 방어.*발동/);
  assert.doesNotMatch(line.text, /적중/);
});

test('three discrete hits against one opponent make a combo, not simultaneous triple shot', () => {
  const { d, b } = running();
  event(b, 'weapon:bow'); event(b, 'weapon:bow'); event(b, 'weapon:bow');
  // 첫 유효타는 선제 타격으로 따로 알린다. 콤보로 세지 않는 것이 이 검사의 핵심.
  const opening = d.observe(b, 4000);
  assert.equal(opening && opening.kind, 'first-blood');
  b.simT = 4.2; event(b, 'weapon:bow'); assert.equal(d.observe(b, 4200), null);
  b.simT = 4.4; event(b, 'weapon:bow'); assert.equal(d.observe(b, 8000).kind, 'combo');
});

test('DOT, summoned balls, zero damage and attacks on different opponents cannot manufacture combos', () => {
  const { d, b } = running(); b.fighters.push(fighter(3, '세 번째 선수'));
  for (let i = 0; i < 8; i++) {
    b.simT += .1;
    for (const source of ['dot:bleed', 'dot:flame', 'augment:miniBall']) event(b, source);
    event(b, 'weapon:bow', 'hit', { amount: 0 });
    const line = d.observe(b, 4000 + i * 100);
    assert.notEqual(line && line.kind, 'combo', '지속 피해와 0 피해는 콤보가 아니다');
  }
  for (let i = 0; i < 3; i++) { b.simT += .2; event(b, 'weapon:bow', 'hit', { target: i % 2 ? 3 : 2 }); }
  const split = d.observe(b, 12000);
  assert.notEqual(split && split.kind, 'combo', '상대가 갈리면 콤보가 아니다');
});

test('skills outrank combos and specials in the same snapshot; no stale queue follows', () => {
  const { d, b } = running();
  for (let i = 0; i < 3; i++) { b.simT += .2; event(b, 'weapon:bow'); }
  event(b, 'augment:lightning'); event(b, 'skill:bow');
  assert.equal(d.observe(b, 5000).kind, 'skill-hit');
  assert.equal(d.observe(b, 10000), null);
});

test('announcements respect wall-clock cooldown and specials have a per-source cooldown', () => {
  const { d, b } = running(); event(b, 'augment:lightning');
  assert.equal(d.observe(b, 4000).kind, 'special-hit');
  b.simT += .1; event(b, 'skill:bow'); assert.equal(d.observe(b, 4500), null);
  b.simT += .1; event(b, 'augment:lightning'); assert.equal(d.observe(b, 8000), null);
  b.simT += .1; event(b, 'augment:lightning'); assert.equal(d.observe(b, 12500).kind, 'special-hit');
});

test('a hit dropped during the global cooldown does not start its source cooldown', () => {
  const { d, b } = running();
  b.simT = .5; event(b, 'skill:bow');
  assert.equal(d.observe(b, 500), null, 'intro is still on screen');
  assert.equal(d.battles.get('local:1').sourceTimes.has('1:skill:bow'), false);
  b.simT = 4; event(b, 'skill:bow');
  assert.equal(d.observe(b, 4000).kind, 'skill-hit', 'a new confirmed hit can now speak');
  assert.equal(d.battles.get('local:1').sourceTimes.get('1:skill:bow'), 4000);
  b.simT = 8; event(b, 'skill:bow');
  assert.equal(d.observe(b, 8000), null, 'the actually spoken line starts the source cooldown');
});

test('a lower-priority candidate does not consume its source cooldown or replay later', () => {
  const { d, b } = running();
  event(b, 'augment:lightning'); event(b, 'skill:bow');
  assert.equal(d.observe(b, 4000).kind, 'skill-hit');
  assert.equal(d.battles.get('local:1').sourceTimes.has('1:augment:lightning'), false);
  assert.equal(d.observe(b, 8000), null, 'unselected lines are still dropped, not queued');
  b.simT = 8; event(b, 'augment:lightning');
  assert.equal(d.observe(b, 8100).kind, 'special-hit', 'only this new hit is narrated');
});

test('a major HP lead is a threshold crossing after three seconds, not repeated narration', () => {
  const { d, b } = running(); b.fighters[1].hp = 60;
  assert.equal(d.observe(b, 4000).kind, 'lead'); assert.equal(d.observe(b, 9000), null);
  b.fighters[1].hp = 90; d.observe(b, 10000); b.fighters[1].hp = 50;
  assert.equal(d.observe(b, 11000).kind, 'lead');
});

test('new snapshots, duplicate sequences and packet rewind never replay announcements', () => {
  const { d, b } = running(); event(b, 'skill:bow');
  const old = JSON.parse(JSON.stringify(b)); assert.equal(d.observe(b, 4000).kind, 'skill-hit');
  assert.equal(d.observe(JSON.parse(JSON.stringify(b)), 9000), null);
  b.simT = 5; event(b, 'augment:shockwave'); assert.equal(d.observe(b, 10000).kind, 'special-hit');
  assert.equal(d.observe(old, 20000), null);
  assert.equal(d.observe(JSON.parse(JSON.stringify(b)), 21000), null);
});

test('interpolated clocks defer future snapshot events without consuming their sequence', () => {
  const { d, b } = running();
  b.simT = 4.1;
  event(b, 'skill:bow', 'hit', { t: 4.18 });
  event(b, 'augment:lightning', 'hit', { t: 4.19 });
  assert.equal(d.observe(b, 5000), null, 'new packet events are ahead of the displayed clock');
  assert.equal(d.battles.get('local:1').seq, 0, 'neither pending seq is consumed');
  b.simT = 4.2;
  const line = d.observe(b, 5100);
  assert.equal(line.kind, 'skill-hit');
  assert.match(line.text, /차지 샷.*적중/);
  assert.equal(d.battles.get('local:1').seq, 2);
  assert.equal(d.observe(b, 10000), null, 'the same packet cannot replay either event');
});

test('spectate and reconnect skip historical events and do not replay old round results', () => {
  const { d, b } = running(), other = battle(2); other.phase = 'fight'; other.simT = 8;
  event(other, 'skill:bow'); assert.equal(d.observe(other, 5000), null);
  other.simT += .2; event(other, 'augment:lightning'); assert.equal(d.observe(other, 5200).kind, 'special-hit');
  b.simT = 10; event(b, 'skill:bow'); assert.equal(d.observe(b, 10000), null);
  b.result = { winner: b.fighters[0], draw: false }; b.phase = 'ending';
  const line = d.observe(b, 10100);
  assert.equal(line.kind, 'round-end'); assert.equal(line.gg, false);
  d.observe(other, 15000); assert.equal(d.observe(b, 16000), null);
  d.observe(null, 17000); assert.equal(d.observe(b, 18000), null);
});

test('a finished battle joined for the first time is not a newly witnessed finish', () => {
  const d = makeDirector(), b = battle(); b.phase = 'ending'; b.simT = 30;
  b.result = { winner: b.fighters[0] }; assert.equal(d.observe(b, 4000), null);
});

test('FFA deaths are silent and round results interrupt cooldown once without GG', () => {
  const { d, b } = running(); b.fighters.push(fighter(3, '선수3'), fighter(4, '선수4'));
  event(b, 'skill:bow'); assert.equal(d.observe(b, 4000).kind, 'skill-hit');
  b.fighters[3].dead = true; b.fighters[3].hp = 0; assert.equal(d.observe(b, 4100), null);
  b.result = { winner: b.fighters[0], draw: false }; b.phase = 'ending';
  const line = d.observe(b, 4200);
  assert.equal(line.kind, 'round-end'); assert.equal(line.priority, 90); assert.equal(line.gg, false);
  assert.match(line.text, /민수/); assert.doesNotMatch(line.text, /GG/);
  assert.equal(d.observe(b, 9000), null);
});

test('a duel round announces its winner once, with no GG even if every other fighter died', () => {
  const { d, b } = running(); b.fighters[1].dead = true; b.fighters[1].hp = 0;
  assert.equal(d.observe(b, 4000), null);
  b.result = { winner: 1, draw: false }; b.phase = 'ending';
  const line = d.observe(b, 4200);
  assert.equal(line.kind, 'round-end'); assert.equal(line.gg, false);
  assert.match(line.text, /민수/); assert.doesNotMatch(line.text, /GG/);
  assert.equal(d.observe(b, 9000), null);
});

test('only an explicit full match finish with final ranks emits GG and names the champion', () => {
  const { d, b } = running();
  b.result = { winner: b.fighters[0], draw: false }; b.phase = 'ending';
  assert.equal(d.observe(b, 4200).gg, false);
  // The last round winner need not be the overall champion supplied by the match.
  const players = [
    { id: 1, name: '민수', color: '#55aaff', rank: 2 },
    { id: 2, name: '지훈', color: '#ff5555', rank: 1 },
    { id: 3, name: '선수3', rank: 4 },
    { id: 4, name: '선수4', rank: 3 },
  ];
  const unchanged = JSON.stringify(players);
  const line = d.finishMatch(players, 4300, 'online:match1');
  assert.equal(line.kind, 'gg'); assert.equal(line.priority, 100); assert.equal(line.gg, true);
  assert.equal(line.actor.uid, 2); assert.equal(line.actor.color, '#ff5555');
  assert.match(line.text, /GG~~! 지훈, 최종 우승/);
  assert.equal(JSON.stringify(players), unchanged, 'final rankings remain untouched');
  assert.equal(d.finishMatch(players, 9000, 'online:match1'), null);
  assert.equal(d.finishMatch(JSON.parse(JSON.stringify(players)), 9500, 'online:match1'), null,
    'a repeated terminal packet for the same session cannot replay GG');
  assert.equal(d.finishMatch(players, 10000, 'online:match2').gg, true,
    'the same players can finish a later match');
});

test('full match GG rejects incomplete or invalid rankings and can deduplicate a local roster', () => {
  const d = makeDirector();
  for (const players of [null, [], [{ rank: 0 }], [{ rank: 1 }, { rank: 0 }],
    [{ rank: 1 }, { rank: 1 }], [{ rank: 1 }, { rank: 3 }], [{ rank: 1 }, null],
    [{ rank: 1 }, { rank: 1.5 }]]) {
    assert.equal(d.finishMatch(players, 1000, 'local:game'), null);
  }
  const players = [{ name: '최종 승자', rank: 1 }, { name: '다른 선수', rank: 2 }];
  assert.equal(d.finishMatch(players, 1100).gg, true);
  assert.equal(d.finishMatch(players, 2000), null);
});

test('muted callers can consume lines without replaying them when unmuting', () => {
  const { d, b } = running(); event(b, 'skill:bow'); d.observe(b, 4000); // Caller intentionally hides this.
  assert.equal(d.observe(b, 10000), null);
  b.result = { winner: null, draw: true };
  const line = d.observe(b, 10100);
  assert.match(line.text, /무승부/); assert.equal(line.gg, false); assert.equal(line.kind, 'round-end');
  assert.equal(d.observe(b, 15000), null, 'a muted round result stays consumed');
});

test('names remain bounded plain text, and title demos never produce commentary', () => {
  const d = makeDirector(), b = battle(); b.fighters[0].name = '<img onerror=oops>' + '긴닉네임'.repeat(30);
  d.observe(b, 0); b.phase = 'fight'; const line = d.observe(b, 100);
  assert.ok(Array.from(line.actor.name).length <= 9); assert.equal(typeof line.text, 'string');
  assert.match(line.text, /<img one…/); assert.equal(line.html, undefined);
  b.demo = true; b.result = { winner: b.fighters[0] }; assert.equal(d.observe(b, 10000), null);
});

/* 같은 상황이라도 표현이 돌아가야 한다. 다만 난수는 절대 쓸 수 없고
 * (중계는 게임 RNG를 건드리지 않는다) 같은 경기를 다시 보면 같은 대사여야 한다. */
test('the same situation cycles through several phrasings, deterministically', () => {
  const say = seq => {
    const d = makeDirector(), b = battle(seq);
    d.observe(b, 0); b.phase = 'fight';
    const intro = d.observe(b, 100);
    b.simT = 4;
    for (let i = 0; i < seq; i++) event(b, 'weapon:bow', 'hit', { amount: 0 });
    event(b, 'skill:bow');
    return { intro: intro.text, hit: d.observe(b, 9000).text };
  };
  const runs = [1,2,3,4,5,6].map(say);
  assert.ok(new Set(runs.map(r => r.hit)).size >= 3, '스킬 적중 표현이 최소 3가지');
  for (const r of runs) assert.match(r.hit, /차지 샷.*적중/, '표현이 달라도 사실은 같다');
  // 같은 입력이면 같은 출력 — 난수가 아니라 사실에서 뽑는다
  assert.deepEqual(say(3), say(3));
  assert.deepEqual(say(5), say(5));
});

test('the caster calls first blood, danger and comebacks', () => {
  // 선제 타격
  {
    const { d, b } = running();
    event(b, 'weapon:bow');
    const line = d.observe(b, 4000);
    assert.equal(line.kind, 'first-blood');
    assert.match(line.text, /민수/);
    // 두 번째 유효타는 다시 선제 타격이 될 수 없다
    b.simT = 6; event(b, 'weapon:bow');
    const again = d.observe(b, 9000);
    assert.notEqual(again && again.kind, 'first-blood');
  }
  // 위기 — 25% 아래로 떨어진 순간 한 번, 회복 전에는 다시 알리지 않는다
  {
    const { d, b } = running();
    b.fighters[1].hp = 20;
    const line = d.observe(b, 4000);
    assert.equal(line.kind, 'low-hp');
    assert.equal(line.actor.uid, 2);
    b.fighters[1].hp = 18;
    assert.equal(d.observe(b, 9000), null, '바닥권에서 계속 떠들지 않는다');
    b.fighters[1].hp = 90;
    d.observe(b, 13000);                       // 회복한 상태를 한 번 봐야 다시 무장된다
    b.fighters[1].hp = 20;
    assert.equal(d.observe(b, 18000).kind, 'low-hp', '회복했다 다시 떨어지면 알린다');
  }
  // 역전 — 앞서던 선수가 바뀐다
  {
    const { d, b } = running();
    b.fighters[1].hp = 40;
    d.observe(b, 4000);
    b.fighters[0].hp = 20; b.fighters[1].hp = 80;
    const line = d.observe(b, 9000);
    assert.equal(line.kind, 'comeback');
    assert.equal(line.actor.uid, 2);
  }
});
