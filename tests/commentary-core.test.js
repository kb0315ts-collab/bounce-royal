'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Director, displayMs } = require('../js/commentary-core.js');
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
/* 전투가 막 시작돼 인트로를 말한 상태. 인트로 말풍선은 늦어도 3.4초에 끝나므로
 * 일반 해설은 now 6500부터, 중요 해설은 곧바로 말할 수 있다. 경기 시각은 4초. */
function running(id = 1) {
  const d = makeDirector(), b = battle(id); d.observe(b, 0); b.phase = 'fight';
  assert.equal(d.observe(b, 100).kind, 'intro'); b.simT = 4;
  return { d, b };
}
const GENERAL_OK = 6500;

test('browser and CommonJS API expose the same pure director without using RNG', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/commentary-core.js'), 'utf8');
  const math = Object.create(Math); math.random = () => { throw new Error('gameplay RNG consumed'); };
  const ctx = { Math: math }; vm.runInNewContext(source, ctx);
  const d = new ctx.BounceRoyalCommentaryCore.Director({ weapons, characters }), b = battle();
  const unchanged = JSON.stringify(b); d.observe(b, 0); assert.equal(JSON.stringify(b), unchanged);
  b.phase = 'fight';
  const intro = d.observe(b, 100);
  assert.equal(intro.kind, 'intro'); assert.ok(intro.text.length > 0);
  assert.equal(typeof ctx.BounceRoyalCommentaryCore.displayMs, 'function');
});

test('the opener names a player only when it talks about one, and never invents a streak', () => {
  let named = 0, generic = 0;
  for (let id = 1; id <= 40; id++) {
    const d = makeDirector(), b = battle(id); d.observe(b, 0); b.phase = 'fight';
    const line = d.observe(b, 100);
    assert.equal(line.kind, 'intro');
    assert.doesNotMatch(line.text, /연승/, '연승이 없으면 연승을 말하지 않는다');
    const mentions = /민수|지훈/.test(line.text);
    assert.equal(line.actor.uid != null, mentions, '이름표는 선수를 말할 때만 붙는다: ' + line.text);
    if (mentions) named++; else generic++;
  }
  assert.ok(named > 0 && generic > 0, '선수를 짚는 인트로와 전체 인트로가 섞인다');
  const d = makeDirector(), b = battle(); b.fighters[1].player.streak = 3;
  d.observe(b, 0); b.phase = 'fight';
  const line = d.observe(b, 100);
  assert.match(line.text, /지훈/); assert.match(line.text, /3연승/); assert.equal(line.actor.uid, 2);
  assert.equal(d.observe(b, 5000), null);
});

test('damaging skill acceptance is silent until actual HP damage confirms its hit', () => {
  const { d, b } = running(); event(b, 'skill:bow', 'skill');
  assert.equal(d.observe(b, 4000), null);
  b.simT = 4.5; event(b, 'skill:bow', 'hit', { amount: 0 });
  assert.equal(d.observe(b, 4500), null);
  b.simT = 5; event(b, 'skill:bow');
  const line = d.observe(b, 5000); assert.equal(line.kind, 'skill-hit'); assert.match(line.text, /차지 샷/);
  assert.ok(line.priority >= 60, '스킬 적중은 중요 해설');
});

test('utility skills can announce activation but never claim a hit', () => {
  const { d, b } = running(); event(b, 'char:soft', 'skill');
  const line = d.observe(b, GENERAL_OK); assert.equal(line.kind, 'skill-use'); assert.match(line.text, /말랑 방어/);
  assert.doesNotMatch(line.text, /적중|맞혔|명중/);
});

test('three discrete hits against one opponent make a combo, not simultaneous triple shot', () => {
  const { d, b } = running();
  event(b, 'weapon:bow'); event(b, 'weapon:bow'); event(b, 'weapon:bow');
  // 첫 유효타는 선제 타격으로 따로 알린다. 콤보로 세지 않는 것이 이 검사의 핵심.
  const opening = d.observe(b, GENERAL_OK);
  assert.equal(opening && opening.kind, 'first-blood');
  b.simT = 4.2; event(b, 'weapon:bow'); assert.equal(d.observe(b, GENERAL_OK + 100), null);
  b.simT = 4.4; event(b, 'weapon:bow');
  assert.equal(d.observe(b, GENERAL_OK + displayMs(opening.text) + 3100).kind, 'combo');
});

test('DOT, summoned balls, zero damage and attacks on different opponents cannot manufacture combos', () => {
  const { d, b } = running(); b.fighters.push(fighter(3, '세 번째 선수'));
  for (let i = 0; i < 8; i++) {
    b.simT += .1;
    for (const source of ['dot:bleed', 'dot:flame', 'augment:miniBall']) event(b, source);
    event(b, 'weapon:bow', 'hit', { amount: 0 });
    const line = d.observe(b, 4000 + i * 4000);
    assert.notEqual(line && line.kind, 'combo', '지속 피해와 0 피해는 콤보가 아니다');
  }
  for (let i = 0; i < 3; i++) { b.simT += .2; event(b, 'weapon:bow', 'hit', { target: i % 2 ? 3 : 2 }); }
  const split = d.observe(b, 60000);
  assert.notEqual(split && split.kind, 'combo', '상대가 갈리면 콤보가 아니다');
});

test('important lines cut into general chatter at once; general lines wait for the bubble plus a gap', () => {
  const { d, b } = running();
  event(b, 'weapon:bow');
  const first = d.observe(b, GENERAL_OK); assert.equal(first.kind, 'first-blood');
  b.simT = 4.3; event(b, 'weapon:bow', 'hit', { amount: 15 });
  assert.equal(d.observe(b, GENERAL_OK + 400), null, '일반 해설은 앞 말풍선이 끝나고 쉬는 틈을 기다린다');
  b.simT = 4.4; event(b, 'skill:bow');
  const cut = d.observe(b, GENERAL_OK + 500);
  assert.equal(cut.kind, 'skill-hit', '스킬 적중은 일반 해설을 끊고 바로 나온다');
  const end = GENERAL_OK + 500 + displayMs(cut.text);
  b.simT = 4.6; event(b, 'weapon:bow', 'hit', { target: 2 });
  assert.equal(d.observe(b, end + 2900), null, '말풍선이 끝나고 3초가 안 됐다');
  b.simT = 4.8; event(b, 'weapon:bow', 'hit', { target: 2 });
  assert.equal(d.observe(b, end + 3100).kind, 'hit', '틈이 지나면 다시 말한다');
});

test('between important lines: higher priority at once, same rank after a second, lower or same kind waits briefly then drops', () => {
  // 더 중요한 일(탈락)은 스킬 적중 말풍선을 바로 넘긴다
  {
    const { d, b } = running(); b.fighters.push(fighter(3, '셋째'), fighter(4, '넷째'));
    event(b, 'skill:bow'); assert.equal(d.observe(b, 5000).kind, 'skill-hit');
    b.fighters[3].dead = true; b.fighters[3].hp = 0;
    const ko = d.observe(b, 5200);
    assert.equal(ko.kind, 'knockout'); assert.match(ko.text, /넷째/);
  }
  // 같은 종류는 말풍선이 끝나기를 1.5초까지만 기다리고 버린다
  {
    const { d, b } = running();
    event(b, 'skill:bow'); const first = d.observe(b, 5000);
    b.simT = 4.2; event(b, 'skill:sword', 'hit', { actor: 2, target: 1 });
    assert.equal(d.observe(b, 5300), null);
    assert.equal(d.observe(b, 6100), null, '1초가 지나도 같은 종류는 앞 말풍선을 끊지 않는다');
    assert.equal(d.observe(b, 5000 + displayMs(first.text) + 100), null, '기다리던 줄은 유통기한이 지나 버려졌다');
  }
  // 덜 중요한 특수 공격도 스킬 적중 말풍선을 끊지 않는다
  {
    const { d, b } = running();
    event(b, 'skill:bow'); d.observe(b, 5000);
    b.simT = 4.2; event(b, 'augment:lightning', 'hit', { actor: 2, target: 1 });
    assert.equal(d.observe(b, 6200), null);
  }
  // 같은 급의 다른 일(마지막 저항 -> 분열)은 1초 보여 준 뒤 넘긴다. 그동안은 잠깐 기다린다.
  {
    const { d, b } = running();
    event(b, 'augment:lastResistance', 'last-stand');
    const stand = d.observe(b, 5000); assert.equal(stand.kind, 'last-stand'); assert.equal(stand.label, '마지막 저항');
    b.simT = 4.2; event(b, 'augment:split', 'split', { actor: 2 });
    assert.equal(d.observe(b, 5500), null);
    const split = d.observe(b, 6100);
    assert.equal(split.kind, 'split'); assert.equal(split.actor.uid, 2);
  }
});

test('skill hits cool down per player, specials per source, and only a spoken line starts a cooldown', () => {
  const { d, b } = running();
  event(b, 'augment:lightning'); event(b, 'skill:bow');
  assert.equal(d.observe(b, 5000).kind, 'skill-hit');
  assert.equal(d.battles.get('local:1').sourceTimes.has('1:augment:lightning'), false, '뽑히지 않은 줄은 쿨타임을 걸지 않는다');
  b.simT = 5; event(b, 'augment:lightning');
  assert.equal(d.observe(b, 9000).kind, 'special-hit');
  b.simT = 6; event(b, 'skill:sword');
  assert.equal(d.observe(b, 13000), null, '같은 선수의 스킬 적중은 10초에 한 번');
  b.simT = 7; event(b, 'augment:lightning');
  assert.equal(d.observe(b, 13100), null, '같은 특수 공격은 8초에 한 번');
  b.simT = 8; event(b, 'skill:sword');
  assert.equal(d.observe(b, 15100).kind, 'skill-hit');
  b.simT = 9; event(b, 'augment:lightning');
  assert.equal(d.observe(b, 19000).kind, 'special-hit');
});

test('a major HP lead is a threshold crossing, and a huge one gets its own line', () => {
  const { d, b } = running(); b.fighters[1].hp = 60;
  assert.equal(d.observe(b, GENERAL_OK).kind, 'lead'); assert.equal(d.observe(b, 12000), null);
  b.fighters[1].hp = 95; d.observe(b, 13000); b.fighters[1].hp = 55;
  assert.equal(d.observe(b, 19000).kind, 'lead', '격차가 줄었다 다시 벌어지면 다시 말한다');
  b.fighters[1].hp = 30;
  assert.equal(d.observe(b, 26000).kind, 'big-lead');
});

test('new snapshots, duplicate sequences and packet rewind never replay announcements', () => {
  const { d, b } = running(); event(b, 'skill:bow');
  const old = JSON.parse(JSON.stringify(b)); assert.equal(d.observe(b, 5000).kind, 'skill-hit');
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
  assert.match(line.text, /차지 샷/);
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
  // 이미 쓰러져 있던 선수도 새로 본 탈락이 아니다
  const e = makeDirector(), c = battle(3); c.fighters.push(fighter(3, '셋째'), fighter(4, '넷째'));
  c.phase = 'fight'; c.simT = 12; c.fighters[3].dead = true;
  assert.equal(e.observe(c, 4000), null);
});

test('FFA knockouts are announced once as important news; round results come once without GG', () => {
  const { d, b } = running(); b.fighters.push(fighter(3, '선수3'), fighter(4, '선수4'));
  event(b, 'skill:bow'); assert.equal(d.observe(b, 5000).kind, 'skill-hit');
  b.fighters[3].dead = true; b.fighters[3].hp = 0;
  const ko = d.observe(b, 5100);
  assert.equal(ko.kind, 'knockout'); assert.equal(ko.actor.uid, 4); assert.equal(ko.label, '탈락');
  assert.equal(d.observe(b, 9000), null, '한 번만');
  b.result = { winner: b.fighters[0], draw: false }; b.phase = 'ending';
  const line = d.observe(b, 9200);
  assert.equal(line.kind, 'round-end'); assert.equal(line.priority, 90); assert.equal(line.gg, false);
  assert.match(line.text, /민수/); assert.doesNotMatch(line.text, /GG/);
  assert.equal(d.observe(b, 9000), null);
});

test('a duel round announces its winner once, with no GG and no separate knockout line', () => {
  const { d, b } = running(); b.fighters[1].dead = true; b.fighters[1].hp = 0;
  assert.equal(d.observe(b, 5000), null);
  b.result = { winner: 1, draw: false }; b.phase = 'ending';
  const line = d.observe(b, 5200);
  assert.equal(line.kind, 'round-end'); assert.equal(line.gg, false);
  assert.match(line.text, /민수/); assert.doesNotMatch(line.text, /GG/);
  assert.equal(d.observe(b, 9000), null);
});

test('a time-up win is called a decision, a squeaker is called close', () => {
  const judged = running();
  judged.b.fighters[0].hp = 60; judged.b.fighters[1].hp = 40;
  judged.b.result = { winner: judged.b.fighters[0], draw: false, reason: '체력 비율 판정' };
  const decision = judged.d.observe(judged.b, 9000);
  assert.equal(decision.label, '판정'); assert.match(decision.text, /민수/);
  const tight = running(2);
  tight.b.fighters[0].hp = 15; tight.b.fighters[1].hp = 0; tight.b.fighters[1].dead = true;
  tight.b.result = { winner: tight.b.fighters[0], draw: false, reason: '격파' };
  const close = tight.d.observe(tight.b, 9000);
  assert.equal(close.label, '라운드 종료'); assert.match(close.text, /민수/);
  assert.match(close.text, /팽팽|접전|쉽지 않은|박빙|집중력/, '박빙으로 부른다');
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
  assert.match(line.text, /^GG~~! /); assert.match(line.text, /지훈/);
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
  const { d, b } = running(); event(b, 'skill:bow'); d.observe(b, 5000); // Caller intentionally hides this.
  assert.equal(d.observe(b, 10000), null);
  b.result = { winner: null, draw: true };
  const line = d.observe(b, 10100);
  assert.match(line.text, /무승부/); assert.equal(line.gg, false); assert.equal(line.kind, 'round-end');
  assert.equal(d.observe(b, 15000), null, 'a muted round result stays consumed');
});

test('names remain bounded plain text, and title demos never produce commentary', () => {
  const d = makeDirector(), b = battle(); b.fighters[0].name = '<img onerror=oops>' + '긴닉네임'.repeat(30);
  d.observe(b, 0); b.phase = 'fight'; d.observe(b, 100);
  b.simT = 5; b.result = { winner: b.fighters[0], draw: false };
  const line = d.observe(b, 9000);
  assert.ok(Array.from(line.actor.name).length <= 9); assert.equal(typeof line.text, 'string');
  assert.match(line.text, /<img one…/); assert.equal(line.html, undefined);
  const demo = battle(7); demo.demo = true; demo.phase = 'fight'; demo.result = { winner: demo.fighters[0] };
  assert.equal(d.observe(demo, 10000), null);
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
  for (const r of runs) assert.match(r.hit, /차지 샷/, '표현이 달라도 사실은 같다');
  // 같은 입력이면 같은 출력 — 난수가 아니라 사실에서 뽑는다
  assert.deepEqual(say(3), say(3));
  assert.deepEqual(say(5), say(5));
});

test('the caster calls first blood, danger and comebacks', () => {
  // 선제 타격
  {
    const { d, b } = running();
    event(b, 'weapon:bow');
    const line = d.observe(b, GENERAL_OK);
    assert.equal(line.kind, 'first-blood');
    assert.match(line.text, /민수/);
    b.simT = 6; event(b, 'weapon:bow');
    const again = d.observe(b, 20000);
    assert.notEqual(again && again.kind, 'first-blood', '두 번째 유효타는 선제 타격이 아니다');
  }
  // 위기 — 25% 아래로 떨어진 순간 한 번, 회복 전에는 다시 알리지 않는다
  {
    const { d, b } = running();
    b.fighters[1].hp = 20;
    const line = d.observe(b, GENERAL_OK);
    assert.equal(line.kind, 'low-hp');
    assert.equal(line.actor.uid, 2);
    b.fighters[1].hp = 18;
    assert.equal(d.observe(b, 12000), null, '바닥권에서 계속 떠들지 않는다');
    b.fighters[1].hp = 90;
    d.observe(b, 13000);                       // 회복한 상태를 한 번 봐야 다시 무장된다
    b.fighters[1].hp = 20;
    assert.equal(d.observe(b, 25000).kind, 'low-hp', '회복했다 다시 떨어지면 알린다');
    b.fighters[1].hp = 8;
    assert.equal(d.observe(b, 40000).kind, 'very-low', '10% 밑은 한 단계 더');
  }
  // 역전 — 앞서던 선수가 바뀌면 일반 해설 중에도 끊고 나온다
  {
    const { d, b } = running();
    b.fighters[1].hp = 40;
    assert.equal(d.observe(b, GENERAL_OK).kind, 'big-lead');
    b.fighters[0].hp = 20; b.fighters[1].hp = 80;
    const line = d.observe(b, GENERAL_OK + 300);
    assert.equal(line.kind, 'comeback');
    assert.equal(line.actor.uid, 2);
  }
});

test('hit weight sets the tone: a huge blow is important, a heavy one and a light one are chatter', () => {
  const big = running();
  event(big.b, 'weapon:bow', 'hit', { amount: 35 });
  assert.equal(big.d.observe(big.b, 5000).kind, 'big-blow');
  const tone = amount => {
    const { d, b } = running();
    event(b, 'weapon:bow');
    d.observe(b, GENERAL_OK);                    // 선제 타격을 먼저 소비한다
    b.simT = 4.5; event(b, 'weapon:bow', 'hit', { amount });
    return d.observe(b, 20000);
  };
  assert.equal(tone(15).kind, 'heavy-hit');
  assert.equal(tone(5).kind, 'hit');
  assert.ok(tone(15).priority < 60 && tone(5).priority < 60);
});

test('wall plays, blocks, near misses and a missed charge shot each get their own line', () => {
  const after = (type, source, opts) => {
    const { d, b } = running();
    event(b, 'weapon:bow'); d.observe(b, GENERAL_OK);   // 선제 타격 소비
    b.simT = 4.5;
    if (type === 'wall-hit') event(b, source, 'hit', opts);
    event(b, source, type, opts);
    return d.observe(b, 20000);
  };
  const wall = after('wall-hit', 'weapon:bow', { target: 2, amount: 10 });
  assert.equal(wall.kind, 'wall-hit'); assert.equal(wall.label, '벽 활용');
  const guard = after('guard', 'weapon:sword', { actor: 2, target: 1, amount: 12 });
  assert.equal(guard.kind, 'guard'); assert.equal(guard.actor.uid, 2);
  const dodge = after('dodge', 'weapon:sword', { actor: 2, target: 1 });
  assert.equal(dodge.kind, 'dodge'); assert.equal(dodge.actor.uid, 2);
  // 차지 샷을 쏘고 1.2초 안에 안 맞으면 빗나감
  {
    const { d, b } = running();
    event(b, 'skill:bow', 'release');
    assert.equal(d.observe(b, GENERAL_OK), null);
    b.simT = 5.3;
    const miss = d.observe(b, GENERAL_OK + 100);
    assert.equal(miss.kind, 'charge-miss'); assert.equal(miss.label, '빗나감');
  }
  {
    const { d, b } = running();
    event(b, 'skill:bow', 'release');
    b.simT = 4.6; event(b, 'skill:bow');
    assert.equal(d.observe(b, 5000).kind, 'skill-hit');
    b.simT = 6; assert.notEqual((d.observe(b, 20000) || {}).kind, 'charge-miss', '맞았으면 빗나감이 아니다');
  }
});

test('the ten-second warning comes once when time is running out', () => {
  const { d, b } = running();
  b.simT = 30;
  const line = d.observe(b, 5000);
  assert.equal(line.kind, 'time'); assert.equal(line.actor.uid, null);
  b.simT = 31;
  assert.notEqual((d.observe(b, 30000) || {}).kind, 'time');
});

test('two balls glued together for a while get a close-quarters line', () => {
  const { d, b } = running();
  Object.assign(b.fighters[0], { x: 0, y: 0, radius: 22 });
  Object.assign(b.fighters[1], { x: 60, y: 0, radius: 22 });
  assert.equal(d.observe(b, GENERAL_OK), null, '붙자마자는 아니다');
  b.simT = 6.6;
  const line = d.observe(b, GENERAL_OK + 100);
  assert.equal(line.kind, 'close'); assert.equal(line.label, '근접전');
  b.fighters[1].x = 300; b.simT = 6.8; d.observe(b, 30000);
  b.fighters[1].x = 60; b.simT = 7; assert.notEqual((d.observe(b, 30100) || {}).kind, 'close', '떨어졌다 다시 붙으면 처음부터 센다');
});

test('long silences get three tiers of lines, and lull lines never pretend nobody was hit', () => {
  const firstOnly = new Set(['아직 유효타는 없습니다.', '서로 첫 타를 못 만들고 있네요.', '아직 체력 변화가 없어요.',
    '첫 피해가 조금 늦게 나오네요.', '아직 서로 멀쩡합니다.', '첫 교전이 쉽게 안 나오네요.', '아직도 첫 유효타가 안 나왔어요.',
    '서로 굉장히 건강합니다.', '아직 치료가 필요할 선수는 없겠습니다.', '이렇게 오래 멀쩡할 줄은 몰랐습니다.',
    '아직 누구도 상대 체력바에 손을 못 댔어요.', '먼저 맞는 쪽이 조금 민망해질 타이밍입니다.']);
  const { d, b } = running();
  b.simT = 6.5; assert.equal(d.observe(b, GENERAL_OK), null, '7초 전에는 조용히 본다');
  b.simT = 7.2;
  const one = d.observe(b, GENERAL_OK + 100);
  assert.equal(one.kind, 'quiet'); assert.equal(one.actor.uid, null);
  b.simT = 9; assert.equal(d.observe(b, 13000), null, '1단계는 한 번');
  b.simT = 12.5; assert.equal(d.observe(b, 13100), null, '같은 종류는 12초 안에 다시 말하지 않는다');
  const two = d.observe(b, 18700); assert.equal(two && two.kind, 'quiet');
  b.simT = 16.5; assert.equal(d.observe(b, 25000), null);
  const three = d.observe(b, 30800); assert.equal(three && three.kind, 'quiet');
  assert.equal(new Set([one.text, two.text, three.text]).size, 3, '단계마다 다른 말');
  // 한 번이라도 맞은 판의 소강에서는 '첫 타가 없다'는 말을 하지 않는다
  let lulls = 0;
  for (let id = 1; id <= 30; id++) {
    const r = running(id);
    event(r.b, 'weapon:bow'); r.d.observe(r.b, GENERAL_OK);
    for (const [t, now] of [[11.5, 20000], [16.5, 40000], [21, 60000]]) {
      r.b.simT = t;
      const line = r.d.observe(r.b, now);
      if (line && line.kind === 'quiet') {
        lulls++;
        assert.ok(!firstOnly.has(line.text), '소강인데 첫 타가 없다고 했다: ' + line.text);
      }
    }
  }
  assert.ok(lulls >= 30, '소강 해설이 실제로 나왔다 (' + lulls + ')');
});
