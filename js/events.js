'use strict';

/* ============================================================
 * 바운스 로얄 — 3라운드 종료 이벤트 투표
 * ============================================================ */
const GAME_EVENTS = Object.freeze([
  Object.freeze({ id:'nextFfa', ico:'⚔️', name:'전원 집결', desc:'다음 한 라운드는 4인 난투. 1등 코인 +1, 2등 변화 없음, 3·4등 코인 -1. 탈락자가 있으면 남은 전원이 참가합니다.' }),
  Object.freeze({ id:'powerSupply', ico:'🎁', name:'중앙 보급', desc:'앞으로 경기장 중앙에 일시적인 파워를 얻는 보급이 등장합니다.' }),
  Object.freeze({ id:'twoPillars', ico:'🗿', name:'쌍둥이 기둥', desc:'앞으로 경기장에 충돌과 투사체를 막는 장애물 기둥 2개가 생성됩니다.' }),
  Object.freeze({ id:'doubleAugments', ico:'✦', name:'두 배의 선택', desc:'앞으로 라운드마다 증강을 2개씩 선택합니다.' }),
  Object.freeze({ id:'coinRelief', ico:'🪙', name:'구호 자금', desc:'코인이 5개 미만인 생존자 모두가 코인 1개를 얻습니다.' }),
  Object.freeze({ id:'refreshTen', ico:'↻', name:'새로운 가능성', desc:'추가 새로고침을 10개 얻습니다.' }),
  Object.freeze({ id:'reverseCoins', ico:'🔄', name:'승자의 보상', desc:'다음 한 라운드에는 패배해도 코인을 잃지 않고, 승리하면 코인 1개를 얻습니다.' }),
  Object.freeze({ id:'lossAugment', ico:'🩹', name:'패배의 교훈', desc:'앞으로 패배할 때마다 그 라운드의 증강을 하나 더 선택합니다.' }),
  Object.freeze({ id:'globalDamage30', ico:'💥', name:'과격한 경기', desc:'앞으로 모든 플레이어의 모든 피해가 30% 증가합니다.' }),
  Object.freeze({ id:'noChange', ico:'☁️', name:'평온한 하루', desc:'이번 게임에는 아무 변화도 일어나지 않습니다.' }),
]);
const GAME_EVENT_BY_ID = Object.freeze(Object.fromEntries(GAME_EVENTS.map(event => [event.id, event])));

function rollGameEventOffers(random = Math.random) {
  const pool = GAME_EVENTS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

function resolveGameEventVote(players, offers, votes, random = Math.random) {
  if (!players.length || !offers.length) return null;
  const winnerIndex = Math.min(players.length - 1, Math.floor(random() * players.length));
  const winnerPlayer = players[winnerIndex];
  const rawVote = votes instanceof Map ? votes.get(winnerPlayer.id) : votes?.[winnerPlayer.id];
  const event = offers.find(candidate => candidate.id === rawVote) || offers[0];
  return { offers, players, votes, winnerIndex, winnerPlayer, winnerPlayerId:winnerPlayer.id, event, eventId:event.id };
}

function resetGameEventState(game) {
  game.eventVoteDone = false;
  game.eventOffers = [];
  game.eventVotes = new Map();
  game.activeEventId = null;
  game.eventForceFfaRound = 0;
  game.eventCoinReversalRound = 0;
  game.eventPowerSupply = false;
  game.eventTwoPillars = false;
  game.eventDoubleAugments = false;
  game.eventLossAugment = false;
  for (const player of game.players || []) {
    player.eventDamageMult = 1;
    player.eventLostLastRound = false;
  }
}

function applyGameEvent(game, eventOrId) {
  const event = typeof eventOrId === 'string' ? GAME_EVENT_BY_ID[eventOrId] : eventOrId;
  if (!event) return null;
  game.activeEventId = event.id;
  switch (event.id) {
    case 'nextFfa':
      game.eventForceFfaRound = game.round + 1;
      break;
    case 'powerSupply':
      game.eventPowerSupply = true;
      break;
    case 'twoPillars':
      game.eventTwoPillars = true;
      break;
    case 'doubleAugments':
      game.eventDoubleAugments = true;
      break;
    case 'coinRelief':
      for (const player of game.players) if (!player.eliminated) player.coins = Math.min(5, player.coins + 1);
      break;
    case 'refreshTen':
      game.refreshes += 10;
      break;
    case 'reverseCoins':
      game.eventCoinReversalRound = game.round + 1;
      break;
    case 'lossAugment':
      game.eventLossAugment = true;
      // 이 이벤트가 뽑히기 전에 끝난 3라운드의 패배는 소급하지 않는다.
      for (const player of game.players) player.eventLostLastRound = false;
      break;
    case 'globalDamage30':
      for (const player of game.players) player.eventDamageMult = 1.3;
      break;
    case 'noChange':
      break;
  }
  return event;
}

function eventAugmentPickCount(game, player) {
  if (game.eventDoubleAugments) return 2;
  if (game.eventLossAugment && player.eventLostLastRound) return 2;
  return 1;
}
