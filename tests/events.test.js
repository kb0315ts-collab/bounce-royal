'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'events.js'), 'utf8') + `
globalThis.__eventApi = {
  GAME_EVENTS, GAME_EVENT_BY_ID, rollGameEventOffers, resolveGameEventVote,
  resetGameEventState, applyGameEvent, eventAugmentPickCount,
};
`;
const context = vm.createContext({ console, Map, Math });
vm.runInContext(source, context, { filename: 'bounce-royal-events.test.bundle.js' });

const {
  GAME_EVENTS, GAME_EVENT_BY_ID, rollGameEventOffers, resolveGameEventVote,
  resetGameEventState, applyGameEvent, eventAugmentPickCount,
} = context.__eventApi;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('✓ ' + name);
  } catch (error) {
    console.error('✗ ' + name);
    throw error;
  }
}

function makePlayers() {
  return [
    { id:'p1', coins:0, eliminated:false, eventDamageMult:1, eventLostLastRound:false, augments:[] },
    { id:'p2', coins:4, eliminated:false, eventDamageMult:1, eventLostLastRound:false, augments:[] },
    { id:'p3', coins:5, eliminated:false, eventDamageMult:1, eventLostLastRound:false, augments:[] },
    { id:'p4', coins:2, eliminated:true, eventDamageMult:1, eventLostLastRound:false, augments:[] },
  ];
}

function makeGame(overrides = {}) {
  return Object.assign({
    round: 3,
    players: makePlayers(),
    refreshes: 2,
    eventVoteDone: false,
    eventOffers: [],
    eventVotes: new Map(),
    activeEventId: null,
    eventForceFfaRound: 0,
    eventCoinReversalRound: 0,
    eventPowerSupply: false,
    eventTwoPillars: false,
    eventDoubleAugments: false,
    eventLossAugment: false,
  }, overrides);
}

test('게임 이벤트는 정확히 10종이며 ID가 모두 고유하다', () => {
  const ids = Array.from(GAME_EVENTS, event => event.id);
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  assert.deepEqual(ids, [
    'nextFfa', 'powerSupply', 'twoPillars', 'doubleAugments', 'coinRelief',
    'refreshTen', 'reverseCoins', 'lossAugment', 'globalDamage30', 'noChange',
  ]);
  for (const id of ids) assert.equal(GAME_EVENT_BY_ID[id].id, id);
});

test('이벤트 후보는 결정적 셔플에서도 중복 없이 정확히 3개다', () => {
  const sequence = [0.91, 0.17, 0.74, 0.32, 0.58, 0.06, 0.43, 0.81];
  let cursor = 0;
  const offers = rollGameEventOffers(() => sequence[cursor++ % sequence.length]);
  const ids = Array.from(offers, event => event.id);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every(id => GAME_EVENT_BY_ID[id]));
});

test('투표 결과는 다수결이 아니라 무작위로 뽑힌 4명 중 한 명의 표만 따른다', () => {
  const players = makePlayers();
  const offers = [GAME_EVENT_BY_ID.nextFfa, GAME_EVENT_BY_ID.powerSupply, GAME_EVENT_BY_ID.noChange];
  const votes = new Map([
    ['p1', 'nextFfa'],
    ['p2', 'nextFfa'],
    ['p3', 'noChange'],
    ['p4', 'nextFfa'],
  ]);

  const result = resolveGameEventVote(players, offers, votes, () => 0.5);
  assert.equal(result.winnerIndex, 2);
  assert.equal(result.winnerPlayerId, 'p3');
  assert.equal(result.eventId, 'noChange', '다른 세 명의 다수표가 결과를 덮어쓰면 안 된다');
});

test('두 배의 선택은 코인을 건드리지 않고 증강만 2개씩 뽑게 한다', () => {
  const game = makeGame();
  applyGameEvent(game, 'doubleAugments');
  assert.equal(game.eventDoubleAugments, true);
  assert.deepEqual(game.players.map(player => player.coins), [0, 4, 5, 2], '코인은 그대로여야 한다');
  assert.equal(eventAugmentPickCount(game, game.players[0]), 2);
});

test('구호 자금은 생존자 중 코인 5개 미만에게만 코인 1개를 주고 증강 수는 그대로 둔다', () => {
  const game = makeGame();
  applyGameEvent(game, 'coinRelief');
  assert.deepEqual(game.players.map(player => player.coins), [1, 5, 5, 2], '5개인 생존자와 탈락자는 제외');
  assert.equal(game.eventDoubleAugments, false, '증강 2개 선택은 켜지지 않아야 한다');
  assert.equal(eventAugmentPickCount(game, game.players[0]), 1);
});

test('새로운 가능성은 현재 새로고침에 정확히 10개를 더한다', () => {
  const game = makeGame({ refreshes: 7 });
  applyGameEvent(game, 'refreshTen');
  assert.equal(game.refreshes, 17);
});

test('과격한 경기는 탈락 여부와 관계없이 모든 플레이어 피해 배율을 1.3으로 만든다', () => {
  const game = makeGame();
  applyGameEvent(game, 'globalDamage30');
  assert.deepEqual(game.players.map(player => player.eventDamageMult), [1.3, 1.3, 1.3, 1.3]);
});

test('4인 난투와 코인 역전은 다음 한 라운드 번호만 플래그로 기록한다', () => {
  const game = makeGame({ round: 6 });
  applyGameEvent(game, 'nextFfa');
  applyGameEvent(game, 'reverseCoins');
  assert.equal(game.eventForceFfaRound, 7);
  assert.equal(game.eventCoinReversalRound, 7);

  resetGameEventState(game);
  assert.equal(game.eventForceFfaRound, 0);
  assert.equal(game.eventCoinReversalRound, 0);
});

test('패배의 교훈은 직전 라운드 패자만 증강을 하나 더 선택하게 한다', () => {
  const game = makeGame();
  applyGameEvent(game, 'lossAugment');
  game.players[0].eventLostLastRound = true;
  game.players[1].eventLostLastRound = false;
  assert.equal(eventAugmentPickCount(game, game.players[0]), 2);
  assert.equal(eventAugmentPickCount(game, game.players[1]), 1);
});

console.log('\n' + passed + '개 이벤트 테스트 통과');
