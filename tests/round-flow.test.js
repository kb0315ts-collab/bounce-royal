'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function dummyClassList() {
  return { add() {}, remove() {}, toggle() {}, contains() { return true; } };
}

const canvas = {
  classList: dummyClassList(),
  addEventListener() {},
  getBoundingClientRect() { return { left:0, top:0, width:840, height:840 }; },
  setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
};
const sandbox = {
  console,
  Map,
  Set,
  Math,
  Date,
  URLSearchParams,
  location: { search:'' },
  performance,
  setTimeout,
  clearTimeout,
  addEventListener() {},
  requestAnimationFrame() { return 0; },
  cancelAnimationFrame() {},
  localStorage: { getItem() { return null; }, setItem() {} },
  navigator: {},
  canvas,
  VIEW: { ox:0, oy:0, s:1 },
  $() { return null; },
  updatePlayersPanel() {},
  showResult() {},
  document: {
    body: { classList:dummyClassList(), appendChild() {} },
    head: { appendChild() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { classList:dummyClassList(), appendChild() {}, addEventListener() {} }; },
  },
};
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
const source = [
  read('js/data.js'),
  read('js/sim.js'),
  read('js/matchmaking.js'),
  read('js/events.js'),
  read('js/main.js'),
  `globalThis.__roundFlowApi = {
    Game, aliveOf, makeBattlesFor, applyResultsFor, ffaPlacements, resetGameEventState,
    GAME_EVENT_BY_ID, fillAutomaticEventVotes, automaticEventVotePlan,
    stageEventVote, commitEventVoteResult,
  };`,
].join('\n');
vm.runInContext(source, context, { filename:'bounce-royal-round-flow.test.bundle.js' });

const {
  Game, makeBattlesFor, applyResultsFor, resetGameEventState,
  GAME_EVENT_BY_ID, fillAutomaticEventVotes, automaticEventVotePlan,
  stageEventVote, commitEventVoteResult,
} = context.__roundFlowApi;
const realFastSim = Game.fastSim;

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

function makePlayer(id, coins = 5) {
  return {
    id, name:`P${id}`, isAI:true, color:'#4da6ff', charId:'cat', weaponId:'sword',
    coins, coinsLost:0, augments:[], augmentBaselines:{}, copiedSkill:null,
    gamble:false, trollCondition:false, damageRewardMult:1, eventDamageMult:1,
    wins:0, losses:0, streak:0, rounds:0, eliminated:false, totalDmg:0,
    eventLostLastRound:false,
  };
}

function makeFighter(player, { dead = false, deathAt = 0 } = {}) {
  return {
    uid:player.id, kind:'main', player, name:player.name, color:player.color,
    dead, mainDead:false, deathAt, hp:dead ? 0 : 100, maxHp:100, radius:22,
  };
}

function makeState(players, overrides = {}) {
  const state = Object.assign({
    players, round:1, elimCounter:1, refreshes:0,
    eventVoteDone:true, eventForceFfaRound:0, eventCoinReversalRound:0,
    eventPowerSupply:false, eventTwoPillars:false,
    eventDoubleAugments:false, eventLossAugment:false,
  }, overrides);
  return state;
}

test('이벤트 자동 표는 탈락자를 포함한 나머지 세 명에게 시간차로 배정된다', () => {
  const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4, 0)];
  players[3].eliminated = true;
  const offers = [
    GAME_EVENT_BY_ID.nextFfa,
    GAME_EVENT_BY_ID.powerSupply,
    GAME_EVENT_BY_ID.noChange,
  ];
  const sequence = [0, 0.4, 0.99];
  let cursor = 0;

  const plan = automaticEventVotePlan(players, players[0], offers, () => sequence[cursor++]);

  assert.deepEqual(Array.from(plan, entry => entry.playerId), [2, 3, 4]);
  assert.deepEqual(Array.from(plan, entry => entry.eventId), ['nextFfa', 'powerSupply', 'noChange']);
  assert.deepEqual(Array.from(plan, entry => entry.delay), [550, 1100, 1650]);
});

test('자동 투표 채우기는 이미 제출한 인간의 표를 보존하고 공통 후보 밖을 선택하지 않는다', () => {
  const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4)];
  const offers = [
    GAME_EVENT_BY_ID.nextFfa,
    GAME_EVENT_BY_ID.powerSupply,
    GAME_EVENT_BY_ID.noChange,
  ];
  const votes = fillAutomaticEventVotes(players, offers, new Map([[1, 'powerSupply']]), () => 0.99);

  assert.equal(votes.size, 4);
  assert.equal(votes.get(1), 'powerSupply');
  assert.deepEqual(Array.from(votes.values()), ['powerSupply', 'noChange', 'noChange', 'noChange']);
});

test('이벤트 결과는 개표 중에는 적용되지 않고 공개 후 확정할 때 한 번 적용된다', () => {
  const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4)];
  const state = makeState(players, { eventVoteDone:false, activeEventId:null });
  const offers = [
    GAME_EVENT_BY_ID.nextFfa,
    GAME_EVENT_BY_ID.noChange,
    GAME_EVENT_BY_ID.globalDamage30,
  ];
  const votes = new Map([
    [1, 'nextFfa'], [2, 'noChange'], [3, 'nextFfa'], [4, 'globalDamage30'],
  ]);

  const result = stageEventVote(state, offers, votes, () => 0.99);

  assert.equal(result.winnerPlayerId, 4);
  assert.equal(result.eventId, 'globalDamage30');
  assert.equal(state.eventVoteDone, false);
  assert.equal(state.activeEventId, null);
  assert.deepEqual(players.map(player => player.eventDamageMult), [1, 1, 1, 1]);

  commitEventVoteResult(state, result);
  assert.equal(state.eventVoteDone, true);
  assert.equal(state.activeEventId, 'globalDamage30');
  assert.deepEqual(players.map(player => player.eventDamageMult), [1.3, 1.3, 1.3, 1.3]);
});

test('실제 이벤트 투표 흐름은 네 표를 차례로 공개하고 개표 연출 콜백 전에는 적용하지 않는다', () => {
  const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4)];
  players[0].isAI = false;
  const scheduled = [];
  const updates = [];
  let submitHumanVote = null;
  let shownOffers = null;
  let shownResult = null;
  let revealContinue = null;
  let augmentCalled = false;
  const realSetTimeout = context.setTimeout;
  const realClearTimeout = context.clearTimeout;
  const realShowEventVote = context.showEventVote;
  const realUpdateEventVote = context.updateEventVote;
  const realShowEventVoteResult = context.showEventVoteResult;
  const realAugmentPhase = Game.augmentPhase;

  context.setTimeout = (fn, delay) => {
    const timer = { fn, delay, cancelled:false };
    scheduled.push(timer);
    return timer;
  };
  context.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  context.showEventVote = (offers, roster, onVote) => {
    shownOffers = offers;
    submitHumanVote = onVote;
    assert.equal(roster.length, 4);
  };
  context.updateEventVote = (votes, options) => updates.push({ votes:new Map(votes), options });
  context.showEventVoteResult = (result, onContinue) => {
    shownResult = result;
    revealContinue = onContinue;
  };

  try {
    Object.assign(Game, makeState(players, {
      round:3, eventVoteDone:false, activeEventId:null,
      eventOffers:[], eventVotes:new Map(), eventVoteTimers:[], eventVoteSession:0,
    }), {
      human:players[0], state:'roundResult',
      augmentPhase() { augmentCalled = true; },
    });

    Game.eventVotePhase();
    assert.equal(Game.state, 'eventVote');
    assert.equal(shownOffers.length, 3);
    assert.deepEqual(updates.map(update => update.votes.size), [0]);

    submitHumanVote(shownOffers[0]);
    assert.equal(updates.at(-1).votes.size, 1);
    assert.equal(shownResult, null);

    scheduled.sort((a, b) => a.delay - b.delay);
    while (scheduled.length) {
      const timer = scheduled.shift();
      if (!timer.cancelled) timer.fn();
    }

    assert.deepEqual(updates.map(update => update.votes.size), [0, 1, 2, 3, 4]);
    assert.equal(updates.at(-1).options.complete, true);
    assert.ok(shownResult);
    assert.equal(shownResult.players.length, 4);
    assert.equal(shownResult.votes.size, 4);
    assert.equal(Game.state, 'eventVoteResult');
    assert.equal(Game.eventVoteDone, false);
    assert.equal(Game.activeEventId, null);
    assert.equal(augmentCalled, false);

    revealContinue();
    assert.equal(Game.eventVoteDone, true);
    assert.equal(Game.activeEventId, shownResult.eventId);
    assert.equal(augmentCalled, true);
  } finally {
    context.setTimeout = realSetTimeout;
    context.clearTimeout = realClearTimeout;
    context.showEventVote = realShowEventVote;
    context.updateEventVote = realUpdateEventVote;
    context.showEventVoteResult = realShowEventVoteResult;
    Game.augmentPhase = realAugmentPhase;
  }
});

test('전원 집결 라운드에 3명만 살아 있어도 셋 모두 한 난투에 참가한다', () => {
  const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4, 0)];
  players[3].eliminated = true;
  const state = makeState(players, { round:4, eventForceFfaRound:4 });

  const created = makeBattlesFor(state);

  assert.equal(created.ffa, true);
  assert.equal(created.battles.length, 1);
  assert.equal(created.battles[0].eventFfa, true);
  assert.equal(created.battles[0].fighters.length, 3);
  assert.deepEqual(Array.from(created.battles[0].fighters, fighter => fighter.player.id), [1, 2, 3]);
  assert.equal(state.eventForceFfaRound, 4,
    '난투 생성 단계에서 플래그를 버리지 말고 실제 결과 정산 때까지 유지해야 한다');
});

test('4인 난투는 1등 +1, 2등 변화 없음, 3·4등 패배로 정산한다', () => {
  const players = [1, 2, 3, 4].map(id => makePlayer(id));
  const fighters = [
    makeFighter(players[0]),
    makeFighter(players[1], { dead:true, deathAt:30 }),
    makeFighter(players[2], { dead:true, deathAt:20 }),
    makeFighter(players[3], { dead:true, deathAt:10 }),
  ];
  const battle = {
    eventFfa:true,
    fighters,
    hpRatio:fighter => Math.max(0, fighter.hp) / fighter.maxHp,
    result:{ winner:fighters[0], losers:fighters.slice(1), draw:false, reason:'격파' },
  };
  const state = makeState(players, { round:4, eventForceFfaRound:4 });

  applyResultsFor(state, [battle]);

  assert.deepEqual(players.map(player => player.coins), [6, 5, 4, 4]);
  assert.deepEqual(players.map(player => player.wins), [1, 0, 0, 0]);
  assert.deepEqual(players.map(player => player.losses), [0, 0, 1, 1]);
  assert.deepEqual(players.map(player => player.eventLostLastRound), [false, false, true, true]);
  assert.equal(state.eventForceFfaRound, 0, '해당 난투 라운드 정산 직후 일회성 플래그를 소비해야 한다');
});

test('코인 역전은 승자 +1·패자 코인 보존과 승패 통계를 함께 적용한다', () => {
  const winner = makePlayer(1, 4);
  const loser = makePlayer(2, 3);
  loser.coinsLost = 2;
  loser.streak = 4;
  const winnerFighter = makeFighter(winner);
  const loserFighter = makeFighter(loser, { dead:true, deathAt:12 });
  const battle = {
    eventFfa:false,
    fighters:[winnerFighter, loserFighter],
    result:{ winner:winnerFighter, losers:[loserFighter], draw:false, reason:'격파' },
  };
  const state = makeState([winner, loser], { round:7, eventCoinReversalRound:7 });

  applyResultsFor(state, [battle]);

  assert.equal(winner.coins, 5);
  assert.equal(winner.wins, 1);
  assert.equal(winner.streak, 1);
  assert.equal(loser.coins, 3, '패자의 코인은 정산 전 값으로 복구되어야 한다');
  assert.equal(loser.coinsLost, 2, '보호된 패배는 누적 코인 손실도 늘리면 안 된다');
  assert.equal(loser.losses, 1, '코인을 보호해도 패배 통계는 갱신해야 한다');
  assert.equal(loser.streak, 0);
  assert.equal(loser.eventLostLastRound, true);
  assert.equal(state.eventCoinReversalRound, 0, '해당 역전 라운드 정산 직후 일회성 플래그를 소비해야 한다');
});

test('3라운드에 인간이 탈락해도 결과 화면에서 이벤트 투표로 진행할 수 있다', () => {
  const human = makePlayer(1, 0);
  human.isAI = false;
  human.eliminated = true;
  const players = [human, makePlayer(2), makePlayer(3), makePlayer(4)];
  let shown = null;
  let eventPhaseCalled = false;
  context.showResult = (title, lines, buttonLabel, onContinue) => {
    shown = { title, lines, buttonLabel, onContinue };
  };
  Object.assign(Game, makeState(players, { round:3, eventVoteDone:false }), {
    human,
    battles:[],
    state:'battle',
    eventVotePhase() { eventPhaseCalled = true; },
    augmentPhase() { throw new Error('3라운드 미투표 상태에서 증강 선택으로 건너뛰면 안 된다'); },
    fastSim() { throw new Error('이벤트 투표 전에 빠른 시뮬레이션으로 넘어가면 안 된다'); },
    gameOver() { throw new Error('AI가 3명 생존 중이므로 게임 종료가 아니다'); },
  });

  Game.resolveRound();

  assert.equal(Game.state, 'roundResult');
  assert.ok(shown);
  assert.equal(shown.title, '라운드 3 결과');
  assert.equal(shown.buttonLabel, '이벤트 투표 →');
  assert.equal(typeof shown.onContinue, 'function');
  shown.onContinue();
  assert.equal(eventPhaseCalled, true, '결과 화면 버튼은 이벤트 투표 단계에 연결되어야 한다');
});

test('실제 fastSim 경로는 전투를 만들기 전에 라운드를 증가시킨다', () => {
  const players = [makePlayer(1, 1), makePlayer(2, 1)];
  Object.assign(Game, makeState(players, { round:10 }), {
    human:null,
    _gameOverCalled:false,
    fastSim:realFastSim,
    gameOver() { this._gameOverCalled = true; },
  });
  resetGameEventState(Game);
  Game.eventVoteDone = true;

  Game.fastSim();

  assert.equal(Game.round, 11, '한 번의 빠른 시뮬레이션 라운드가 10에서 11로 증가해야 한다');
  assert.equal(Game._gameOverCalled, true);
});

console.log('\n' + passed + '개 이벤트 라운드 통합 테스트 통과');
