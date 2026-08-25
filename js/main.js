'use strict';
/* ============================================================
 * 바운스 로얄 — 게임 흐름 / 입력 / 오디오
 * ============================================================ */

/* ---------------- 로컬 프로필 ---------------- */
const PROFILE_KEY = 'bounce-royale-profile-v2';
const PROFILE_DEFAULTS = Object.freeze({
  nickname: '바운서',
  rating: 1000,
  equippedChar: 'cat',
  vibration: true,
  sound: { muted: false, volume: 0.8 },
});

function cleanNickname(value) {
  const cleaned = String(value == null ? '' : value)
    .replace(/[<>&"'`\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 12);
  return cleaned || PROFILE_DEFAULTS.nickname;
}

const Profile = {
  data: null,
  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { /* 메모리 폴백 */ }
    const rawSound = saved && typeof saved.sound === 'object' ? saved.sound : {};
    const equippedChar = saved && CHARACTERS[saved.equippedChar] ? saved.equippedChar : PROFILE_DEFAULTS.equippedChar;
    const savedRating = saved ? Number(saved.rating) : NaN;
    this.data = {
      nickname: cleanNickname(saved && saved.nickname),
      rating: Math.max(0, Math.round(Number.isFinite(savedRating) ? savedRating : PROFILE_DEFAULTS.rating)),
      equippedChar,
      vibration: saved && typeof saved.vibration === 'boolean' ? saved.vibration : PROFILE_DEFAULTS.vibration,
      sound: {
        muted: typeof rawSound.muted === 'boolean' ? rawSound.muted : PROFILE_DEFAULTS.sound.muted,
        volume: Math.max(0, Math.min(1, Number.isFinite(Number(rawSound.volume)) ? Number(rawSound.volume) : PROFILE_DEFAULTS.sound.volume)),
      },
    };
    return this.data;
  },
  save() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.data)); } catch (e) { /* 메모리 폴백 */ }
    return this.data;
  },
  patch(next) {
    Object.assign(this.data, next);
    return this.save();
  },
};
Profile.load();

function ratingTier(rating) {
  if (rating >= 1800) return '마스터';
  if (rating >= 1500) return '다이아몬드';
  if (rating >= 1300) return '플래티넘';
  if (rating >= 1150) return '골드';
  if (rating >= 1000) return '실버';
  return '브론즈';
}

/* ---------------- 사운드 (WebAudio 신스) ---------------- */
const SFX = {
  ctx: null,
  muted: Profile.data.sound.muted,
  volume: Profile.data.sound.volume,
  ensure() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { /* 오디오 불가 환경 */ }
  },
  tone(freq, dur, type = 'square', vol = 0.12, slide = 0, delay = 0) {
    if (this.muted || !this.ctx) return;
    try {
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol * this.volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { }
  },
  ui() { this.tone(700, 0.06, 'triangle', 0.1); },
  hit() { if (chance(0.5)) this.tone(180 + Math.random() * 70, 0.06, 'square', 0.08); },
  bounce() { this.tone(130, 0.05, 'sine', 0.07); },
  boom() { this.tone(90, 0.3, 'sawtooth', 0.16, -55); },
  shoot() { this.tone(540, 0.05, 'triangle', 0.05, -140); },
  skill() { this.tone(420, 0.16, 'sine', 0.11, 260); },
  coin() { this.tone(880, 0.08, 'triangle', 0.1); this.tone(1320, 0.1, 'triangle', 0.08, 0, 0.07); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, 0, i * 0.12)); },
  lose() { [400, 330, 262].forEach((f, i) => this.tone(f, 0.2, 'sawtooth', 0.08, 0, i * 0.14)); },
};

/* ============================================================
 * 공용 라운드 로직 (UI 없는 시뮬레이션과 게임이 동일 경로를 사용)
 * ============================================================ */
function aliveOf(state) { return state.players.filter(p => !p.eliminated && p.coins > 0); }

// 현재 라이브 매치에서는 원형 경기장만 사용한다. 다른 경기장 정의와
// 시뮬레이션 코드는 이후 재사용할 수 있도록 data.js/sim.js에 보존한다.
const ACTIVE_MAP_IDS = ['circle'];

function makeBattlesFor(state) {
  const alive = aliveOf(state);
  const mapId = pick(ACTIVE_MAP_IDS);
  // 4인 난투는 더 이상 임의로 발생하지 않는다. 3라운드 이벤트 투표에서
  // '전원 집결'이 뽑힌 바로 다음 라운드에만 한 번 열린다.
  const ffa = alive.length >= 2 && state.eventForceFfaRound === state.round;
  const battleOptions = {
    eventFfa: ffa,
    powerSupply: !!state.eventPowerSupply,
    twoPillars: !!state.eventTwoPillars,
  };
  let battles;
  if (ffa) battles = [new Battle(mapId, alive, battleOptions)];
  else {
    const pairs = BounceRoyalMatchmaking.selectPairs(state, alive, state.round);
    battles = pairs.map(pair => new Battle(mapId, pair, battleOptions));
  }
  return { battles, mapId, ffa };
}

function applyEventAwareLoss(state, player) {
  const protectCoins = state.eventCoinReversalRound === state.round;
  const coinsBefore = player.coins;
  const coinsLostBefore = player.coinsLost || 0;
  loseCoin(player);
  if (protectCoins) {
    player.coins = coinsBefore;
    player.coinsLost = coinsLostBefore;
  }
  player.eventLostLastRound = true;
  return protectCoins;
}

function lossResultBits(player, protectedByEvent) {
  const bits = [];
  if (protectedByEvent) bits.push('이벤트 · 코인 보호');
  if (player.trollLossProtected) bits.push('트롤의 조건 · 모든 피해 +10%');
  else if (!protectedByEvent) bits.push('🪙 -1');
  if (player.gambleExtra) bits.push(protectedByEvent ? '승부사 기질 소모' : '승부사 기질 🪙 -1');
  return bits;
}

function ffaPlacements(battle) {
  const winner = battle.result && battle.result.winner;
  return battle.fighters.slice().sort((a, b) => {
    if (a === winner) return -1;
    if (b === winner) return 1;
    const aAlive = !a.dead && !a.mainDead;
    const bAlive = !b.dead && !b.mainDead;
    if (aAlive !== bAlive) return aAlive ? -1 : 1;
    if (aAlive) {
      const hpDiff = battle.hpRatio(b) - battle.hpRatio(a);
      if (Math.abs(hpDiff) > 1e-6) return hpDiff;
    } else if (Math.abs((b.deathAt || 0) - (a.deathAt || 0)) > 1e-6) {
      return (b.deathAt || 0) - (a.deathAt || 0);
    }
    return String(a.player.id).localeCompare(String(b.player.id));
  });
}

function applyResultsFor(state, battles) {
  const lines = [];
  for (const player of state.players) player.eventLostLastRound = false;
  const fmt = f => {
    const ch = CHARACTERS[f.player.charId], wp = WEAPONS[f.player.weaponId];
    return `<span style="color:${f.color}">${f.name}</span> <span style="opacity:.6;font-size:13px">${ch.ico}${wp.ico}</span>`;
  };
  for (const b of battles) {
    const r = b.result;
    if (!r) continue;
    if (b.eventFfa) {
      const placed = ffaPlacements(b);
      if (placed[0]) {
        winRound(placed[0].player);
        placed[0].player.coins++;
      }
      const placementNotes = [];
      if (placed[0]) {
        placementNotes[0] = ['🪙 +1'];
        if (placed[0].player.trollWinCost) placementNotes[0].push('트롤의 조건 🪙 -1');
        if (placed[0].player.gambleRewarded) placementNotes[0].push('승부사 기질 · 모든 피해 +20%');
      }
      placementNotes[1] = ['변화 없음'];
      for (let index = 2; index < placed.length; index++) {
        const protectedByEvent = applyEventAwareLoss(state, placed[index].player);
        placementNotes[index] = lossResultBits(placed[index].player, protectedByEvent);
      }
      const rows = placed.map((fighter, index) => {
        const reward = (placementNotes[index] || []).join(' · ');
        return `<b>${index + 1}위</b> ${fmt(fighter)} <span class="coinloss">${reward}</span>`;
      });
      lines.push({ html: `⚔️ <span class="win">${placed.length}인 난투 결과</span><br>${rows.join('<br>')}` });
    } else if (r.draw) {
      const protectedCount = b.fighters.reduce((count, f) => count + (applyEventAwareLoss(state, f.player) ? 1 : 0), 0);
      const coinNote = protectedCount === b.fighters.length ? '이벤트로 코인 보호' : '양측 🪙 -1';
      lines.push({ html: `🤝 무승부 — ${b.fighters.map(fmt).join(' vs ')} <span class="coinloss">${coinNote}</span>` });
    } else {
      winRound(r.winner.player);
      const winnerBits = [];
      if (state.eventCoinReversalRound === state.round) {
        r.winner.player.coins++;
        winnerBits.push('이벤트 🪙 +1');
      }
      if (r.winner.player.trollWinCost) winnerBits.push('트롤의 조건 🪙 -1');
      if (r.winner.player.gambleRewarded) winnerBits.push('승부사 기질 · 모든 피해 +20%');
      const loserHtml = r.losers.map(f => {
        const protectedByEvent = applyEventAwareLoss(state, f.player);
        const bits = lossResultBits(f.player, protectedByEvent);
        return `${fmt(f)} <span class="coinloss">${bits.join(' · ')}</span>`;
      }).join('');
      const winnerNote = winnerBits.length ? ` <span class="coinloss">${winnerBits.join(' · ')}</span>` : '';
      lines.push({ html: `🏆 <span class="win">${fmt(r.winner)} 승리!</span>${winnerNote}<br>${loserHtml}` });
      if (r.reason === '체력 비율 판정') lines.push({ html: `<span style="color:#8b94b3;font-size:13px">…연장전 종료, 체력 비율 판정</span>` });
    }
    for (const f of b.fighters) f.player.rounds++;
  }
  if (state.eventForceFfaRound === state.round) state.eventForceFfaRound = 0;
  if (state.eventCoinReversalRound === state.round) state.eventCoinReversalRound = 0;
  // 자동 관전 대상(부전승) 라운드 카운트
  const fought = new Set();
  battles.forEach(b => b.fighters.forEach(f => fought.add(f.player)));
  for (const p of aliveOf(state)) if (!fought.has(p)) p.rounds++;
  // 탈락 처리
  for (const p of state.players) {
    if (!p.eliminated && p.coins <= 0) {
      p.eliminated = true;
      p.elimOrder = state.elimCounter++;
      lines.push({ html: `💀 <b>${p.name}</b> 탈락 — 코인 소진`, elim: true });
    }
  }
  return lines;
}

const EVENT_VOTE_STAGGER_MS = 550;

function eventVoteOfferId(offers, random = Math.random) {
  if (!offers.length) return null;
  const raw = Number(random());
  const unit = Number.isFinite(raw) ? Math.max(0, Math.min(0.9999999999999999, raw)) : 0;
  return offers[Math.floor(unit * offers.length)].id;
}

function fillAutomaticEventVotes(players, offers, initialVotes = new Map(), random = Math.random) {
  const votes = new Map(initialVotes);
  for (const player of players) {
    if (!votes.has(player.id)) votes.set(player.id, eventVoteOfferId(offers, random));
  }
  return votes;
}

function automaticEventVotePlan(players, human, offers, random = Math.random) {
  return players
    .filter(player => player !== human)
    .map((player, index) => ({
      player,
      playerId: player.id,
      eventId: eventVoteOfferId(offers, random),
      delay: EVENT_VOTE_STAGGER_MS * (index + 1),
    }));
}

function stageEventVote(state, offers, votes, random = Math.random) {
  const result = resolveGameEventVote(state.players, offers, votes, random);
  if (!result) return null;
  state.eventOffers = offers.slice();
  state.eventVotes = new Map(votes);
  return result;
}

function commitEventVoteResult(state, result) {
  if (!result) return null;
  state.eventOffers = result.offers.slice();
  state.eventVotes = new Map(result.votes);
  if (state.eventVoteDone) return result;
  state.eventVoteDone = true;
  applyGameEvent(state, result.event);
  return result;
}

function finalizeEventVote(state, offers, votes, random = Math.random) {
  return commitEventVoteResult(state, stageEventVote(state, offers, votes, random));
}

function autoResolveEventVote(state, random = Math.random) {
  if (state.eventVoteDone) return null;
  const offers = rollGameEventOffers(random);
  const votes = fillAutomaticEventVotes(state.players, offers, new Map(), random);
  return finalizeEventVote(state, offers, votes, random);
}

function cancelEventVoteTimers(state) {
  for (const timer of state.eventVoteTimers || []) clearTimeout(timer);
  state.eventVoteTimers = [];
  state.eventVoteSession = (state.eventVoteSession || 0) + 1;
  return state.eventVoteSession;
}

function applyAiAugmentChoices(state) {
  for (const player of aliveOf(state)) {
    if (!player.isAI) continue;
    const pickCount = eventAugmentPickCount(state, player);
    for (let pickIndex = 0; pickIndex < pickCount && player.coins > 0; pickIndex++) {
      const offers = rollAugmentOffers(player);
      if (offers.length) applyAugmentPick(player, aiPickAugment(offers));
    }
  }
}

function eliminateCoinlessPlayers(state) {
  for (const player of state.players) {
    if (!player.eliminated && player.coins <= 0) {
      player.eliminated = true;
      player.elimOrder = state.elimCounter++;
    }
  }
}

/* ============================================================
 * 매치 / 친선방 데이터 헬퍼
 * ============================================================ */
const PLAYER_COLORS = ['#4da6ff', '#ff6b6b', '#6bd968', '#b97bff'];

function makePlayer(spec, index, weaponId) {
  return {
    id: spec.id == null ? index : spec.id,
    name: cleanNickname(spec.name || (index === 0 ? Profile.data.nickname : pick(AI_NAMES))),
    // 현재 브라우저가 조작하는 플레이어는 슬롯 0 하나뿐이다. 원격 슬롯은
    // 네트워크 입력 어댑터가 연결되기 전까지 AI가 대리 조작한다.
    isAI: index !== 0,
    remote: !!spec.remote,
    color: spec.color || PLAYER_COLORS[index % PLAYER_COLORS.length],
    charId: CHARACTERS[spec.charId] ? spec.charId : pick(Object.keys(CHARACTERS)),
    weaponId: WEAPONS[spec.weaponId] ? spec.weaponId : (index === 0 ? weaponId : pick(Object.keys(WEAPONS))),
    rating: Math.max(0, Math.round(Number(spec.rating) || 1000)),
    coins: 5,
    coinsLost: 0,
    augments: [],
    augmentBaselines: {},
    copiedSkill: null,
    gamble: false,
    trollCondition: false,
    damageRewardMult: 1,
    wins: 0,
    losses: 0,
    streak: 0,
    rounds: 0,
    eliminated: false,
    totalDmg: 0,
    rank: 0,
  };
}

function rankedRoster() {
  const names = shuffle(AI_NAMES).slice(0, 3);
  const roster = [{
    id: 0,
    name: Profile.data.nickname,
    isAI: false,
    charId: Profile.data.equippedChar,
    rating: Profile.data.rating,
    color: PLAYER_COLORS[0],
  }];
  for (let i = 0; i < 3; i++) {
    roster.push({
      id: i + 1,
      name: names[i],
      isAI: true,
      charId: pick(Object.keys(CHARACTERS)),
      weaponId: pick(Object.keys(WEAPONS)),
      rating: Math.max(0, Profile.data.rating + Math.round((Math.random() - 0.5) * 240)),
      color: PLAYER_COLORS[i + 1],
    });
  }
  return roster;
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'BR-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createFriendlyRoom() {
  return {
    code: makeRoomCode(),
    maxPlayers: 4,
    slots: [{
      id: 0,
      name: Profile.data.nickname,
      isAI: false,
      local: true,
      ready: true,
      charId: Profile.data.equippedChar,
      color: PLAYER_COLORS[0],
    }, null, null, null],
  };
}

function roomRoster(room) {
  return room.slots.filter(Boolean).map((slot, index) => ({ ...slot, id: index }));
}

function setWatchOtherButton(visible, onClick, label = '다른 전투 보기') {
  if (typeof showViewOtherBattle === 'function') {
    showViewOtherBattle(visible, onClick, label);
    return;
  }
  const button = $('btn-watch-other') || $('btn-view-other');
  if (!button) return;
  button.hidden = !visible;
  button.classList.toggle('hidden', !visible);
  button.classList.toggle('watch-other-on', !!visible);
  button.textContent = label;
  button.onclick = visible && onClick ? onClick : null;
}

function setRefreshButton(count, onRefresh) {
  if (typeof setAugmentRefresh === 'function') {
    setAugmentRefresh(count, onRefresh);
    return;
  }
  const button = $('btn-refresh') || $('btn-aug-refresh');
  const countEl = $('refresh-count') || $('aug-refresh-count');
  if (countEl) countEl.textContent = String(count);
  if (!button) return;
  button.disabled = count <= 0 || typeof onRefresh !== 'function';
  button.onclick = button.disabled ? null : onRefresh;
}

// 'video'를 'live'로 바꾸면 기존 실시간 타이틀 전투로 즉시 복귀한다.
const TITLE_DEMO_MODE = 'video';
const TITLE_DEMO_CLIPS = Array.from({ length: 6 }, (_, i) =>
  `assets/title-demos/title-demo-${String(i + 1).padStart(2, '0')}.mp4`);
const TitleDemo = {
  video: $('title-demo-video'), active: false, failed: false, clipIndex: -1,
  init() {
    if (!this.video) { this.failed = true; return; }
    this.video.addEventListener('ended', () => {
      this.active = false;
      if (this.shouldShow()) this.playNext();
    });
    this.video.addEventListener('error', () => this.useLiveFallback());
  },
  shouldShow() {
    const title = $('scr-title');
    return Game.state === 'title' && !!title && !title.classList.contains('hidden');
  },
  shouldRunLive() { return this.shouldShow() && (TITLE_DEMO_MODE === 'live' || this.failed); },
  sync() {
    if (TITLE_DEMO_MODE === 'live' || this.failed) {
      this.stopVideo();
      if (this.shouldShow() && (!Game.demo || Game.demo.finished)) Game.newDemo();
      return;
    }
    if (this.shouldShow()) {
      if (!this.active) this.playNext();
    } else if (this.active) this.stopVideo();
  },
  playNext() {
    if (!this.video || !TITLE_DEMO_CLIPS.length) return this.useLiveFallback();
    let next = Math.floor(Math.random() * TITLE_DEMO_CLIPS.length);
    if (next === this.clipIndex) next = (next + 1) % TITLE_DEMO_CLIPS.length;
    this.clipIndex = next;
    this.active = true;
    this.video.src = TITLE_DEMO_CLIPS[next];
    this.video.classList.remove('hidden');
    canvas.classList.add('title-video-active');
    const play = this.video.play();
    if (play && typeof play.catch === 'function') play.catch(() => this.useLiveFallback());
  },
  stopVideo() {
    if (this.video) { this.video.pause(); this.video.classList.add('hidden'); }
    canvas.classList.remove('title-video-active');
    this.active = false;
  },
  useLiveFallback() {
    if (this.failed) return;
    this.failed = true;
    this.stopVideo();
    if (!Game.demo || Game.demo.finished) Game.newDemo();
  },
};

/* ============================================================
 * 게임 상태 머신
 * ============================================================ */
const Game = {
  state: 'title', players: [], human: null,
  round: 0, battles: null, focus: null, ownBattle: null, spectating: false,
  resolving: false, elimCounter: 1, demo: null,
  matchMode: null, refreshes: 0, room: null, ratingAwarded: false,
  rankedSearchTimer: null, otherBattleOffered: false,
  eventVoteTimers: [], eventVoteSession: 0,

  newDemo() {
    const players = [];
    const colors = ['#ff6b6b', '#6bd968', '#b97bff', '#ffd24d'];
    for (let i = 0; i < 4; i++) {
      players.push({
        id: 100 + i, name: pick(AI_NAMES), isAI: true, color: colors[i],
        charId: pick(Object.keys(CHARACTERS)), weaponId: pick(Object.keys(WEAPONS)),
        coins: 5, coinsLost: 0, augments: [], augmentBaselines: {}, copiedSkill: null,
        wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
      });
    }
    this.demo = new Battle(pick(ACTIVE_MAP_IDS), players, { demo: true });
  },

  newMatch(charId, weaponId, options = {}) {
    cancelEventVoteTimers(this);
    const roster = options.roster && options.roster.length === 4 ? options.roster : rankedRoster();
    roster[0] = {
      ...roster[0],
      id: 0,
      name: Profile.data.nickname,
      isAI: false,
      charId: CHARACTERS[charId] ? charId : Profile.data.equippedChar,
      weaponId,
      rating: Profile.data.rating,
      color: PLAYER_COLORS[0],
    };
    this.players = roster.map((spec, index) => makePlayer(spec, index, weaponId));
    this.human = this.players[0];
    this.matchMode = options.mode || 'ranked';
    this.refreshes = 0;
    this.ratingAwarded = false;
    this.round = 0; this.elimCounter = 1;
    this.battles = null; this.focus = null; this.resolving = false;
    this.openingPairingSchedule = null; this.lastPairKeys = new Set();
    resetGameEventState(this);
  },

  beginMatch(mode, roster) {
    const equippedChar = Profile.data.equippedChar;
    const participants = (roster && roster.length === 4 ? roster : rankedRoster()).map((spec, index) => ({
      ...spec,
      id: index,
      name: index === 0 ? Profile.data.nickname : cleanNickname(spec.name),
      isAI: index !== 0,
      charId: index === 0 ? equippedChar : spec.charId,
      color: spec.color || PLAYER_COLORS[index],
    }));
    this.state = 'intro';
    hudVisible(false);
    showScreen(null);
    const chooseWeapon = () => {
      if (this.state !== 'intro') return;
      this.state = 'weaponSelect';
      showScreen('scr-weapon');
      const offers = shuffle(Object.keys(WEAPONS)).slice(0, 3);
      buildWeaponSelect(offers, weaponId => {
        if (this.state !== 'weaponSelect') return;
        this.newMatch(equippedChar, weaponId, { mode, roster: participants });
        this.startRound();
      });
    };
    if (typeof showMatchIntro === 'function') showMatchIntro(participants, 3000, chooseWeapon);
    else setTimeout(chooseWeapon, 3000);
  },

  startRankedSearch() {
    if (this.rankedSearchTimer) return;
    if (typeof setRankedSearchState === 'function') setRankedSearchState('비슷한 레이팅의 상대를 찾는 중…', true);
    else if ($('ranked-search-status')) $('ranked-search-status').textContent = '비슷한 레이팅의 상대를 찾는 중…';
    this.rankedSearchTimer = setTimeout(() => {
      this.rankedSearchTimer = null;
      if (typeof setRankedSearchState === 'function') setRankedSearchState('매칭 완료!', false);
      else if ($('ranked-search-status')) $('ranked-search-status').textContent = '매칭 완료!';
      this.beginMatch('ranked', rankedRoster());
    }, 700);
  },

  cancelRankedSearch() {
    if (this.rankedSearchTimer) clearTimeout(this.rankedSearchTimer);
    this.rankedSearchTimer = null;
    if (typeof setRankedSearchState === 'function') setRankedSearchState('', false);
    else if ($('ranked-search-status')) $('ranked-search-status').textContent = '';
  },

  returnToTitle() {
    this.cancelRankedSearch();
    cancelEventVoteTimers(this);
    this.state = 'title';
    this.players = [];
    this.human = null;
    this.battles = null;
    this.focus = null;
    this.spectating = false;
    this.resolving = false;
    this.matchMode = null;
    this.refreshes = 0;
    hudVisible(false);
    setWatchOtherButton(false);
    specTag(null);
    setHint(null);
    if (typeof closePlayerDetail === 'function') closePlayerDetail();
    if (TITLE_DEMO_MODE === 'live' && (!this.demo || this.demo.finished)) this.newDemo();
    updateTitleProfile();
    showScreen('scr-title');
  },

  startRound() {
    if (typeof closePlayerDetail === 'function') closePlayerDetail();
    this.round++;
    const { battles, mapId, ffa } = makeBattlesFor(this);
    this.battles = battles; this.mapId = mapId; this.ffa = ffa;
    this.ownBattle = battles.find(b => b.human()) || null;
    this.focus = this.ownBattle;
    this.spectating = false; this.resolving = false; this.otherBattleOffered = false;
    this.state = 'battle';
    showScreen(null); hudVisible(true);
    updatePlayersPanel(this);
    setWatchOtherButton(false);
    banner(`ROUND ${this.round}`, MAPS[mapId].name + (ffa ? ' · 전원 집결!' : ''), 1500);
    SFX.coin();
  },

  offerOtherBattle() {
    const other = this.battles && this.battles.find(b => b !== this.ownBattle && !b.result);
    const ownDone = !this.ownBattle || !!this.ownBattle.result;
    const canView = !!(ownDone && other && !this.spectating);
    if (canView === this.otherBattleOffered) return;
    this.otherBattleOffered = canView;
    setWatchOtherButton(canView, () => this.viewOtherBattle(), '다른 전투 보기');
  },

  viewOtherBattle() {
    const other = this.battles && this.battles.find(b => b !== this.ownBattle && !b.result);
    if (!other) return;
    this.focus = other;
    this.spectating = true;
    this.otherBattleOffered = false;
    setWatchOtherButton(false);
    specTag(`관전 중 · ${other.fighters.map(f => f.name).join(' vs ')}`);
  },

  update(dt) {
    if (this.state === 'battle' && this.battles) {
      for (const b of this.battles) b.update(dt);
      const fb = this.focus;
      if (fb) {
        if (fb._lastPhase !== fb.phase) {
          if (fb.phase === 'count') banner('READY…', '', 500);
          if (fb.phase === 'fight') { banner('FIGHT!', '', 650); SFX.shoot(); }
          fb._lastPhase = fb.phase;
        }
        if (fb.overtime && !fb._otShown) { fb._otShown = true; banner('연장전!', '5초에 걸쳐 2배속까지 가속', 900); }
        if (fb.result && !fb._endShown) {
          fb._endShown = true;
          const h = fb.human();
          if (h) {
            const won = fb.result.winner === h;
            banner(won ? '승리!' : (fb.result.draw ? '무승부' : '패배…'), fb.result.reason || '', 1100);
            if (won) SFX.win(); else SFX.lose();
          }
        }
        // 내 전투가 끝나도 화면을 자동 전환하지 않는다. 사용자가 원할 때만
        // 하단의 '다른 전투 보기' 버튼으로 아직 진행 중인 매치를 연다.
        this.offerOtherBattle();
      }
      if (this.focus) {
        renderBattle(this.focus);
        this.updateHUD(this.focus);
      } else {
        renderBattle(null);
        this.updateByeHUD();
        this.offerOtherBattle();
      }
      if (!this.resolving && this.battles.every(b => b.result)) {
        this.resolving = true;
        this.otherBattleOffered = false;
        setWatchOtherButton(false);
        setTimeout(() => this.resolveRound(), 700);
      }
    } else if (this.demo && TitleDemo.shouldRunLive()) {
      this.demo.update(dt);
      if (this.demo.finished) this.newDemo();
      renderBattle(this.demo);
    }
  },

  updateHUD(fb) {
    if (!fb) return;
    $('hud-timer').classList.remove('waiting');
    $('hud-round').textContent = `ROUND ${this.round}` +
      (this.ffa ? ' · 전원 집결' : '') + (this.spectating ? ' · 관전' : '');
    $('hud-map').textContent = fb.arena.name;
    const timerEl = $('hud-timer'), tag = $('ot-tag');
    if (fb.phase === 'fight') {
      if (fb.overtime) {
        timerEl.textContent = Math.max(0, fb.otT).toFixed(1);
        timerEl.classList.add('ot'); tag.classList.add('on');
      } else {
        timerEl.textContent = Math.max(0, BATTLE_TIME - fb.simT).toFixed(1);
        timerEl.classList.remove('ot'); tag.classList.remove('on');
      }
    } else {
      timerEl.textContent = BATTLE_TIME.toFixed(1);
      timerEl.classList.remove('ot'); tag.classList.remove('on');
    }
    updateSkillbar(fb);
    if (typeof updatePlayerStatuses === 'function') updatePlayerStatuses(this);
    specTag(this.spectating ? `관전 중 · ${fb.fighters.map(f => f.name).join(' vs ')}` : null);
    const h = fb.human();
    if (fb.phase === 'aim' && h && !h.aimLocked) setHint('드래그로 조준 → 손을 떼면 전투 시작');
    else if (fb.phase === 'fight' && h && !h.dead && !h.mainDead && !h.player.copiedSkill && h.skillUses.common > 0)
      setHint(`드래그 = 방향 전환 (남은 ${h.skillUses.common}회)`);
    else if (fb.phase === 'fight' && h && h.pendingAim) setHint('지금 드래그해서 방향 지정!');
    else setHint(null);
  },

  updateByeHUD() {
    $('hud-round').textContent = `ROUND ${this.round} · 부전승`;
    $('hud-map').textContent = MAPS[this.mapId]?.name || '경기 대기';
    const timer = $('hud-timer');
    timer.textContent = 'BYE'; timer.classList.remove('ot'); timer.classList.add('waiting');
    $('ot-tag').classList.remove('on');
    specTag(null);
    updateSkillbar(null);
    if (typeof updatePlayerStatuses === 'function') updatePlayerStatuses(this);
    setHint('이번 라운드는 부전승 · 다른 전투 보기는 선택 사항입니다');
  },

  resolveRound() {
    if (typeof closePlayerDetail === 'function') closePlayerDetail();
    setWatchOtherButton(false);
    const lines = applyResultsFor(this, this.battles);
    this.battles = this.battles; // 유지 (렌더용)
    updatePlayersPanel(this);
    const aliveN = aliveOf(this).length;
    if (aliveN <= 1) { this.gameOver(); return; }
    const eventVotePending = this.round === 3 && !this.eventVoteDone;
    if (this.human.eliminated && !eventVotePending) {
      applyAiAugmentChoices(this);
      eliminateCoinlessPlayers(this);
      banner('탈락…', '남은 전투 시뮬레이션 중', 1300);
      this.fastSim();
      return;
    }
    this.state = 'roundResult';
    showResult(
      `라운드 ${this.round} 결과`,
      lines,
      eventVotePending ? '이벤트 투표 →' : '증강 선택 →',
      () => eventVotePending ? this.eventVotePhase() : this.augmentPhase(),
    );
  },

  eventVotePhase() {
    if (this.eventVoteDone) { this.augmentPhase(); return; }
    const session = cancelEventVoteTimers(this);
    const offers = rollGameEventOffers();
    const votes = new Map();
    const uiAvailable = typeof showEventVote === 'function';
    let voteClosed = false;

    const isCurrentVote = () => this.eventVoteSession === session && this.state === 'eventVote';
    const publishVotes = (voterId = null) => {
      this.eventOffers = offers.slice();
      this.eventVotes = new Map(votes);
      if (typeof updateEventVote === 'function') {
        updateEventVote(new Map(votes), {
          offers,
          players: this.players,
          voterId,
          complete: this.players.every(player => votes.has(player.id)),
        });
      }
    };

    const closeVote = () => {
      if (voteClosed || !isCurrentVote()) return;
      if (!this.players.every(player => votes.has(player.id))) return;
      voteClosed = true;
      for (const timer of this.eventVoteTimers) clearTimeout(timer);
      this.eventVoteTimers = [];
      const result = stageEventVote(this, offers, votes);
      if (!result) { this.augmentPhase(); return; }
      this.state = 'eventVoteResult';

      const commitAndContinue = () => {
        if (this.eventVoteSession !== session || this.state !== 'eventVoteResult') return;
        commitEventVoteResult(this, result);
        updatePlayersPanel(this);
        this.augmentPhase();
      };
      if (typeof showEventVoteResult === 'function') showEventVoteResult(result, commitAndContinue);
      else commitAndContinue();
    };

    const recordVote = (player, choice) => {
      if (!player || voteClosed || !isCurrentVote() || votes.has(player.id)) return false;
      const eventId = typeof choice === 'string' ? choice : choice && choice.id;
      if (!offers.some(event => event.id === eventId)) return false;
      votes.set(player.id, eventId);
      publishVotes(player.id);
      closeVote();
      return true;
    };

    const submitHumanVote = choice => {
      recordVote(this.human, choice);
    };

    this.state = 'eventVote';
    if (!uiAvailable) {
      const completedVotes = fillAutomaticEventVotes(this.players, offers);
      const result = stageEventVote(this, offers, completedVotes);
      this.state = 'eventVoteResult';
      commitEventVoteResult(this, result);
      this.augmentPhase();
      return;
    }

    showEventVote(offers, this.players, submitHumanVote);
    publishVotes();
    const plan = automaticEventVotePlan(this.players, this.human, offers);
    this.eventVoteTimers = plan.map(entry => setTimeout(() => {
      recordVote(entry.player, entry.eventId);
    }, entry.delay));
  },

  augmentPhase() {
    // AI 증강 선택
    applyAiAugmentChoices(this);
    // 코인 거래로 자멸한 AI 처리
    eliminateCoinlessPlayers(this);
    if (this.human.eliminated) { this.fastSim(); return; }
    this.state = 'augment';
    this.refreshes++;
    const totalPicks = eventAugmentPickCount(this, this.human);
    let remainingPicks = totalPicks;
    let offers = rollAugmentOffers(this.human);
    showScreen('scr-augment');
    const finishRoundSelection = () => {
      if (this.human.coins <= 0) {
        this.human.eliminated = true; this.human.elimOrder = this.elimCounter++;
        this.fastSim(); return;
      }
      this.startRound();
    };
    let pickLocked = false;
    const pickOffer = aug => {
      if (pickLocked || this.state !== 'augment') return;
      pickLocked = true;
      applyAugmentPick(this.human, aug);
      SFX.coin();
      remainingPicks--;
      if (this.human.coins <= 0) { finishRoundSelection(); return; }
      if (remainingPicks <= 0) { finishRoundSelection(); return; }
      offers = rollAugmentOffers(this.human);
      renderOffers();
    };
    const renderOffers = () => {
      pickLocked = false;
      const onRefresh = () => {
        if (this.state !== 'augment' || this.refreshes <= 0) return;
        this.refreshes--;
        const previous = offers.map(a => a.id).join('|');
        let attempts = 0;
        do { offers = rollAugmentOffers(this.human); } while (attempts++ < 5 && offers.map(a => a.id).join('|') === previous);
        SFX.ui();
        renderOffers();
      };
      const pickNumber = totalPicks - remainingPicks + 1;
      const subtitle = totalPicks > 1
        ? `이벤트 효과 · ${pickNumber}/${totalPicks}번째 증강을 선택합니다.`
        : null;
      buildAugmentSelect(offers, this.human, pickOffer, subtitle, {
        refreshes: this.refreshes,
        onRefresh,
      });
      setRefreshButton(this.refreshes, onRefresh);
    };
    renderOffers();
  },

  fastSim() {
    let guard = 0;
    while (aliveOf(this).length > 1 && guard++ < 80) {
      this.round++;
      const { battles } = makeBattlesFor(this);
      for (const b of battles) {
        let steps = 0;
        while (!b.result && steps++ < 60 * (BATTLE_TIME + OVERTIME + 10)) b.update(1 / 60);
        if (!b.result) b.finish(b.fighters[0], '강제 종료');
      }
      applyResultsFor(this, battles);
      if (this.round === 3 && !this.eventVoteDone) autoResolveEventVote(this);
      if (aliveOf(this).length <= 1) break;
      applyAiAugmentChoices(this);
      eliminateCoinlessPlayers(this);
    }
    this.gameOver();
  },

  gameOver() {
    const alive = aliveOf(this);
    const champion = alive.length ? alive.sort((a, b) => b.coins - a.coins || b.wins - a.wins)[0] : this.players[0];
    for (const p of this.players) if (p !== champion && !p.eliminated) { p.eliminated = true; p.elimOrder = this.elimCounter++; }
    champion.rank = 1;
    const rest = this.players.filter(p => p !== champion).sort((a, b) => b.elimOrder - a.elimOrder);
    rest.forEach((p, i) => p.rank = i + 2);
    if (this.matchMode === 'ranked' && !this.ratingAwarded) {
      const placementDelta = { 1: 30, 2: 10, 3: -10, 4: -25 };
      const opponents = this.players.filter(p => p !== this.human);
      const opponentAverage = opponents.reduce((sum, p) => sum + (p.rating || Profile.data.rating), 0) / Math.max(1, opponents.length);
      const difficulty = Math.max(-7, Math.min(7, Math.round((opponentAverage - Profile.data.rating) / 45)));
      const before = Profile.data.rating;
      const delta = (placementDelta[this.human.rank] || 0) + difficulty;
      Profile.patch({ rating: Math.max(0, before + delta) });
      this.human.ratingBefore = before;
      this.human.ratingDelta = Profile.data.rating - before;
      this.human.ratingAfter = Profile.data.rating;
      this.ratingAwarded = true;
    } else if (this.matchMode !== 'ranked') {
      this.human.ratingDelta = 0;
    }
    this.state = 'over';
    hudVisible(false); specTag(null); setHint(null);
    setWatchOtherButton(false);
    showGameOver(this.players, this.human, () => this.returnToTitle());
    const ratingLine = $('over-rating');
    if (ratingLine) {
      if (this.matchMode === 'ranked') {
        const sign = this.human.ratingDelta > 0 ? '+' : '';
        ratingLine.textContent = `레이팅 ${sign}${this.human.ratingDelta} · ${this.human.ratingAfter} RP`;
      } else ratingLine.textContent = '친선전 · 레이팅 변동 없음';
    }
    if (champion === this.human) SFX.win(); else SFX.lose();
  },

  /* ---------------- 입력 ---------------- */
  onPointerDown(w) {
    if (this.state !== 'battle' || !this.focus) return;
    const b = this.focus, h = b.human();
    if (!h || h.dead || h.mainDead) return;
    const ang = Math.atan2(w.y - h.y, w.x - h.x);
    if (b.phase === 'aim' && !h.aimLocked) {
      this.drag = { mode: 'aim' };
      b.humanAim = { active: true, ang };
    } else if (b.phase === 'fight' && !h.player.copiedSkill && h.skillUses.common > 0) {
      this.drag = { mode: 'common' };
      b.humanAim = { active: true, ang };
    }
  },
  onPointerMove(w) {
    if (this.state !== 'battle' || !this.focus || !this.drag) return;
    const b = this.focus, h = b.human();
    if (!h || !b.humanAim) return;
    b.humanAim.ang = Math.atan2(w.y - h.y, w.x - h.x);
  },
  onPointerUp() {
    if (!this.drag) return;
    const b = this.focus, h = b ? b.human() : null;
    if (b && h && b.humanAim) {
      const ang = b.humanAim.ang;
      if (this.drag.mode === 'aim' && b.phase === 'aim' && !h.aimLocked) {
        b.setDir(h, ang); h.aimLocked = true; SFX.bounce();
      } else if (this.drag.mode === 'common' && b.phase === 'fight') {
        if (applyCommonAim(b, h, ang)) SFX.skill();
      }
    }
    if (b) b.humanAim = null;
    this.drag = null;
  },

  pressSkill(slot) {
    if (this.state !== 'battle' || !this.focus) return;
    const b = this.focus, h = b.human();
    if (!h) return;
    const r = useSkill(b, h, slot);
    if (r === 'aim') { setHint('지금 드래그해서 방향 지정!'); SFX.ui(); }
  },
};

/* ============================================================
 * 타이틀 배경 영상 제작용 고정 스텝 녹화 모드
 * ?recordTitle=1에서만 활성화되며 일반 게임 실행에는 관여하지 않는다.
 * ============================================================ */
const TITLE_RECORDING_MODE = new URLSearchParams(location.search).get('recordTitle') === '1';
const TITLE_RECORDING_SCENARIOS = [
  [['cat','sword',['s_beam','s_giant']],['wak','dagger',['d_dual','d_bleed']],['soft','pistol',['p_dual','p_mag']],['bomb','staff',['s_triple','s_bounce']]],
  [['balloon','bow',['b_triple','b_homing']],['bball','mine',['m_big','m_freeze']],['cat','staff',['s_triple','s_steal']],['wak','pistol',['p_dual','p_bayonet']]],
  [['bomb','mine',['m_big','missile','missilePlus']],['soft','bow',['b_triple','shuriken']],['balloon','sword',['s_beam','satellite']],['bball','staff',['s_triple','lightning']]],
  [['wak','pistol',['p_dual','p_mag','flame']],['cat','bow',['b_triple','b_homing']],['bomb','dagger',['d_dual','d_phase']],['soft','mine',['m_big','m_heal']]],
  [['bball','sword',['s_beam','desperateSpin']],['balloon','staff',['s_triple','s_bounce']],['wak','mine',['m_big','missile']],['cat','pistol',['p_dual','satellite']]],
  [['soft','dagger',['d_dual','d_bleed']],['bomb','bow',['b_triple','b_kb']],['bball','pistol',['p_dual','p_bayonet']],['balloon','mine',['m_big','flame']]],
];

function setupTitleRecording() {
  let scenarioIndex = 0;
  const colors = ['#4da6ff', '#ff6879', '#6bd968', '#ffd24d'];
  document.body.classList.add('title-recording');
  const style = document.createElement('style');
  style.textContent = '.title-recording .screen,.title-recording #hud,.title-recording #banner{display:none!important}' +
    '#title-recording-controls{position:fixed;left:4px;top:4px;z-index:999;opacity:.02}' +
    '#title-recording-controls button{width:38px;height:38px}';
  document.head.appendChild(style);
  const controls = document.createElement('div');
  controls.id = 'title-recording-controls';
  controls.innerHTML = '<button id="title-recording-next" type="button">N</button><button id="title-recording-step" type="button">S</button>';
  document.body.appendChild(controls);
  $('title-recording-next').onclick = () => {
    const scenario = TITLE_RECORDING_SCENARIOS[scenarioIndex++ % TITLE_RECORDING_SCENARIOS.length];
    const players = scenario.map(([charId, weaponId, augments], i) => ({
      id: 900 + i, name: `DEMO ${i + 1}`, isAI: true, color: colors[i], charId, weaponId,
      coins: 5, coinsLost: 0, augments: augments.slice(), augmentBaselines: {}, copiedSkill: null,
      gamble: false, trollCondition: false, damageRewardMult: 1,
      wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
    }));
    Game.demo = new Battle('circle', players, { demo: true });
    Game.demo.phase = 'fight';
    Game.demo.simT = 0;
    renderBattle(Game.demo);
  };
  $('title-recording-step').onclick = () => {
    if (!Game.demo || Game.demo.result) return;
    Game.demo.update(1 / 30);
    renderBattle(Game.demo);
  };
  $('title-recording-next').click();
}

/* ============================================================
 * 입력 바인딩
 * ============================================================ */
function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  return { x: (px - VIEW.ox) / VIEW.s - 420, y: (py - VIEW.oy) / VIEW.s - 420 };
}
let activePointerId = null;
canvas.addEventListener('pointerdown', e => {
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 일부 WebView 미지원 */ }
  SFX.ensure();
  Game.onPointerDown(toWorld(e));
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== activePointerId) return;
  Game.onPointerMove(toWorld(e));
});
function finishPointer(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  Game.onPointerUp();
  try {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  } catch (err) { /* 일부 WebView 미지원 */ }
}
canvas.addEventListener('pointerup', finishPointer);
canvas.addEventListener('pointercancel', finishPointer);
canvas.addEventListener('lostpointercapture', e => {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  Game.onPointerUp();
});

function bindClick(ids, handler) {
  const list = Array.isArray(ids) ? ids : [ids];
  for (const id of list) {
    const el = $(id);
    if (el) el.onclick = handler;
  }
}

bindClick('sk-char', () => Game.pressSkill('char'));
bindClick('sk-weapon', () => Game.pressSkill('weapon'));
bindClick('sk-common', () => Game.pressSkill('common'));
window.addEventListener('keydown', e => {
  if (e.key === '1') Game.pressSkill('char');
  if (e.key === '2') Game.pressSkill('weapon');
  if (e.key === '3') Game.pressSkill('common');
});

function syncSoundUI() {
  const muteBtn = $('btn-mute');
  if (muteBtn) muteBtn.textContent = SFX.muted ? '🔇 음소거' : '🔊 소리';
  const volume = $('settings-volume');
  if (volume) volume.value = String(Math.round(SFX.volume * 100));
  const settingMute = $('settings-mute');
  if (settingMute) {
    if (settingMute.type === 'checkbox') settingMute.checked = SFX.muted;
    else if (settingMute.classList.contains('toggle')) {
      settingMute.classList.toggle('on', !SFX.muted);
      settingMute.setAttribute('aria-checked', String(!SFX.muted));
      settingMute.textContent = '';
    } else settingMute.textContent = SFX.muted ? '🔇 음소거 해제' : '🔊 음소거';
  }
  const volumeValue = $('settings-volume-value');
  if (volumeValue) volumeValue.textContent = `${Math.round(SFX.volume * 100)}%`;
  const vibration = $('settings-vibration');
  if (vibration) {
    vibration.classList.toggle('on', Profile.data.vibration !== false);
    vibration.setAttribute('aria-checked', String(Profile.data.vibration !== false));
  }
}

function saveSound() {
  Profile.data.sound = { muted: SFX.muted, volume: SFX.volume };
  Profile.save();
  syncSoundUI();
}

bindClick('btn-mute', () => {
  SFX.ensure();
  SFX.muted = !SFX.muted;
  saveSound();
});

/* ============================================================
 * 모바일 허브 / 메타 흐름
 * ============================================================ */
function updateRankedScreen() {
  const rating = $('ranked-rating');
  const tier = $('ranked-tier');
  if (rating) rating.textContent = `${Profile.data.rating} RP`;
  if (tier) tier.textContent = ratingTier(Profile.data.rating);
  if (typeof setRankedSearchState === 'function') setRankedSearchState('현재 빌드 · 로컬 AI 매칭', false);
  else if ($('ranked-search-status')) $('ranked-search-status').textContent = '현재 빌드 · 로컬 AI 매칭';
}

function updateTitleProfile() {
  const nickname = $('title-nickname');
  const tier = $('title-tier');
  const rating = $('title-rating');
  const equipped = $('title-equipped');
  const avatar = document.querySelector('#scr-title .mini-avatar');
  if (nickname) nickname.textContent = Profile.data.nickname;
  if (tier) tier.textContent = ratingTier(Profile.data.rating);
  if (rating) rating.textContent = `${Profile.data.rating} RP`;
  if (equipped) {
    const ch = CHARACTERS[Profile.data.equippedChar];
    equipped.textContent = `${ch.ico} ${ch.name}`;
  }
  if (avatar) avatar.textContent = CHARACTERS[Profile.data.equippedChar].ico;
}

function openRanked() {
  SFX.ensure(); SFX.ui();
  updateRankedScreen();
  const screenId = $('scr-matchmaking') ? 'scr-matchmaking' : ($('scr-ranked') ? 'scr-ranked' : null);
  if (screenId) showScreen(screenId);
  else Game.startRankedSearch();
}

function syncFriendlyRoom() {
  if (!Game.room) Game.room = createFriendlyRoom();
  const local = Game.room.slots[0];
  local.name = Profile.data.nickname;
  local.charId = Profile.data.equippedChar;
  const callbacks = {
    onAddAI: () => addFriendlyAI(),
    onRemoveSlot: index => removeFriendlySlot(index),
    onToggleReady: index => toggleFriendlyReady(index),
  };
  if (typeof buildFriendlySlots === 'function') buildFriendlySlots(Game.room, callbacks);
  const code = $('room-code');
  if (code) code.textContent = Game.room.code;
  const roomNote = document.querySelector('.room-code-wrap small');
  if (roomNote) roomNote.textContent = '오프라인 방 코드 · 온라인 서버 연결 준비됨';
  const full = Game.room.slots.every(Boolean);
  const ready = full && Game.room.slots.every(slot => slot.ready);
  const start = $('btn-room-start');
  if (start) {
    start.disabled = !ready;
    start.textContent = ready ? '친선전 시작' : (full ? '준비 대기 중' : `참가자 ${Game.room.slots.filter(Boolean).length}/4`);
  }
  const aiButton = $('btn-room-ai');
  if (aiButton) aiButton.textContent = full && Game.room.slots.some((s, i) => i > 0 && s && s.isAI) ? 'AI 한 명 빼기' : 'AI 추가';
}

function addFriendlyAI() {
  if (!Game.room) Game.room = createFriendlyRoom();
  const empty = Game.room.slots.findIndex((slot, index) => index > 0 && !slot);
  if (empty < 0) {
    const lastAI = Game.room.slots.map((slot, index) => ({ slot, index })).reverse()
      .find(entry => entry.index > 0 && entry.slot && entry.slot.isAI);
    if (lastAI) Game.room.slots[lastAI.index] = null;
    syncFriendlyRoom();
    return;
  }
  const usedNames = new Set(Game.room.slots.filter(Boolean).map(slot => slot.name));
  const name = shuffle(AI_NAMES).find(candidate => !usedNames.has(candidate)) || `AI ${empty}`;
  Game.room.slots[empty] = {
    id: empty,
    name,
    isAI: true,
    ready: true,
    charId: pick(Object.keys(CHARACTERS)),
    weaponId: pick(Object.keys(WEAPONS)),
    color: PLAYER_COLORS[empty],
  };
  SFX.ui();
  syncFriendlyRoom();
}

function removeFriendlySlot(index) {
  const slotIndex = Number(index);
  if (!Game.room || slotIndex <= 0 || slotIndex >= Game.room.slots.length) return;
  Game.room.slots[slotIndex] = null;
  SFX.ui();
  syncFriendlyRoom();
}

function toggleFriendlyReady(index) {
  const slot = Game.room && Game.room.slots[Number(index)];
  if (!slot || slot.local || slot.isAI) return;
  slot.ready = !slot.ready;
  syncFriendlyRoom();
}

function openFriendly() {
  SFX.ensure(); SFX.ui();
  Game.room = createFriendlyRoom();
  showScreen('scr-friendly');
  syncFriendlyRoom();
}

function startFriendly() {
  if (!Game.room || !Game.room.slots.every(Boolean)) {
    banner('4명이 필요해요', '친구 또는 AI로 빈 슬롯을 채워주세요', 1200);
    return;
  }
  if (Game.room.slots.some(slot => !slot.ready)) {
    banner('준비 중인 참가자', '모두 준비되면 시작할 수 있어요', 1200);
    return;
  }
  Game.beginMatch('friendly', roomRoster(Game.room));
}

async function copyFriendlyCode() {
  if (!Game.room) return;
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(Game.room.code);
    banner('방 코드 복사 완료', Game.room.code, 900);
  } catch (e) {
    banner('방 코드', Game.room.code, 1400);
  }
}

function openBag() {
  SFX.ensure(); SFX.ui();
  showScreen('scr-bag');
  const render = () => {
    if (typeof buildBag !== 'function') return;
    buildBag(Profile.data.equippedChar, id => {
      if (!CHARACTERS[id]) return;
      Profile.patch({ equippedChar: id });
      SFX.ui();
      updateTitleProfile();
      render();
    });
  };
  render();
}

function openCodex(tab = 'characters') {
  SFX.ensure(); SFX.ui();
  showScreen('scr-codex');
  if (typeof buildCodex === 'function') buildCodex(tab);
}

function openSettings() {
  SFX.ensure(); SFX.ui();
  showScreen('scr-settings');
  const nickname = $('settings-nickname');
  if (nickname) nickname.value = Profile.data.nickname;
  syncSoundUI();
}

function saveSettings() {
  const nickname = $('settings-nickname');
  const volume = $('settings-volume');
  Profile.data.nickname = cleanNickname(nickname ? nickname.value : Profile.data.nickname);
  if (volume) SFX.volume = Math.max(0, Math.min(1, Number(volume.value) / 100));
  const settingMute = $('settings-mute');
  if (settingMute && settingMute.type === 'checkbox') SFX.muted = settingMute.checked;
  const settingVibration = $('settings-vibration');
  Profile.data.vibration = !settingVibration || settingVibration.classList.contains('on');
  Profile.data.sound = { muted: SFX.muted, volume: SFX.volume };
  Profile.save();
  syncSoundUI();
  Game.returnToTitle();
}

function cancelSettings() {
  SFX.muted = Profile.data.sound.muted;
  SFX.volume = Profile.data.sound.volume;
  syncSoundUI();
  Game.returnToTitle();
}

bindClick(['btn-ranked', 'btn-start'], openRanked);
bindClick('btn-friendly', openFriendly);
bindClick('btn-bag', openBag);
bindClick('btn-codex', () => openCodex('characters'));
bindClick('btn-settings', openSettings);
bindClick('btn-title-settings', openSettings);
bindClick(['btn-ranked-match', 'btn-matchmaking-start'], () => { SFX.ensure(); SFX.ui(); Game.startRankedSearch(); });
bindClick(['btn-back-matchmaking', 'btn-ranked-back'], () => Game.returnToTitle());
bindClick('btn-room-ai', addFriendlyAI);
bindClick('btn-room-start', startFriendly);
bindClick('btn-copy-room', copyFriendlyCode);
bindClick(['btn-back-friendly', 'btn-friendly-back'], () => Game.returnToTitle());
bindClick(['btn-back-bag', 'btn-bag-back'], () => Game.returnToTitle());
bindClick(['btn-back-codex', 'btn-codex-back'], () => Game.returnToTitle());
bindClick(['btn-back-settings', 'btn-settings-back'], cancelSettings);
bindClick('btn-settings-save', saveSettings);

const settingsVolume = $('settings-volume');
if (settingsVolume) settingsVolume.oninput = () => {
  SFX.volume = Math.max(0, Math.min(1, Number(settingsVolume.value) / 100));
  const value = $('settings-volume-value');
  if (value) value.textContent = `${Math.round(SFX.volume * 100)}%`;
};
const settingsMute = $('settings-mute');
if (settingsMute && settingsMute.type !== 'checkbox') settingsMute.onclick = () => {
  SFX.muted = !SFX.muted;
  syncSoundUI();
};
const settingsVibration = $('settings-vibration');
if (settingsVibration) settingsVibration.onclick = () => {
  const enabled = !settingsVibration.classList.contains('on');
  settingsVibration.classList.toggle('on', enabled);
  settingsVibration.setAttribute('aria-checked', String(enabled));
  if (enabled && navigator.vibrate) navigator.vibrate(18);
};

const codexTabs = $('codex-tabs');
if (codexTabs) codexTabs.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) openCodex(tab.dataset.tab);
});

// 친선방의 실제 네트워크 계층이 붙을 때 사용할 최소 어댑터다. 현재는
// 원격 친구 슬롯을 AI가 대리 조작하지만, 방/준비 상태 UI 구조는 그대로 쓴다.
window.BounceRoyalRoom = {
  snapshot: () => Game.room,
  addAI: addFriendlyAI,
  removeSlot: removeFriendlySlot,
  setRemoteSlot(index, participant) {
    const slotIndex = Number(index);
    if (!Game.room || slotIndex <= 0 || slotIndex > 3 || !participant) return false;
    Game.room.slots[slotIndex] = {
      id: slotIndex,
      name: cleanNickname(participant.name || `친구 ${slotIndex}`),
      isAI: false,
      remote: true,
      ready: !!participant.ready,
      charId: CHARACTERS[participant.charId] ? participant.charId : 'cat',
      weaponId: WEAPONS[participant.weaponId] ? participant.weaponId : pick(Object.keys(WEAPONS)),
      color: PLAYER_COLORS[slotIndex],
    };
    syncFriendlyRoom();
    return true;
  },
  setReady(index, ready) {
    const slot = Game.room && Game.room.slots[Number(index)];
    if (!slot) return false;
    slot.ready = !!ready;
    syncFriendlyRoom();
    return true;
  },
};

syncSoundUI();
updateTitleProfile();

/* ============================================================
 * 헤드리스 자동 테스트: AI 4인 풀게임 N번 시뮬레이션
 * ============================================================ */
window.__autotest = function (n = 10) {
  const t0 = performance.now();
  let roundsTotal = 0, draws = 0, timeouts = 0, errors = 0;
  const winners = {};
  for (let g = 0; g < n; g++) {
    try {
      const state = { players: [], round: 0, elimCounter: 1, refreshes: 0 };
      const names = shuffle(AI_NAMES).slice(0, 4);
      for (let i = 0; i < 4; i++) {
        state.players.push({
          id: i, name: names[i], isAI: true, color: AI_COLORS[i % 3],
          charId: pick(Object.keys(CHARACTERS)), weaponId: pick(Object.keys(WEAPONS)),
          coins: 5, coinsLost: 0, augments: [], augmentBaselines: {}, copiedSkill: null,
          gamble: false, trollCondition: false, damageRewardMult: 1,
          wins: 0, losses: 0, streak: 0, rounds: 0, eliminated: false, totalDmg: 0,
        });
      }
      resetGameEventState(state);
      let guard = 0;
      while (aliveOf(state).length > 1 && guard++ < 80) {
        state.round++;
        const { battles } = makeBattlesFor(state);
        for (const b of battles) {
          b.update(0.016); // aim/count 진행용
          let steps = 0;
          while (!b.result && steps++ < 60 * (BATTLE_TIME + OVERTIME + 10)) b.update(1 / 60);
          if (!b.result) b.finish(b.fighters[0], '강제 종료');
          if (b.result.reason === '체력 비율 판정') timeouts++;
          if (b.result.draw) draws++;
        }
        applyResultsFor(state, battles);
        if (state.round === 3 && !state.eventVoteDone) autoResolveEventVote(state);
        applyAiAugmentChoices(state);
        eliminateCoinlessPlayers(state);
      }
      const champ = aliveOf(state)[0] || state.players[0];
      winners[champ.weaponId] = (winners[champ.weaponId] || 0) + 1;
      roundsTotal += state.round;
    } catch (err) { errors++; console.error('[autotest]', err); }
  }
  const dt = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`__autotest 완료: ${n}게임 / ${dt}초 / 평균 ${roundsTotal / n}라운드 / 무승부 ${draws} / 시간종료 ${timeouts} / 오류 ${errors}`, winners);
  return { games: n, errors, avgRounds: roundsTotal / n, winners };
};

/* ============================================================
 * 메인 루프
 * ============================================================ */
TitleDemo.init();
if (TITLE_RECORDING_MODE) setupTitleRecording();
else if (TITLE_DEMO_MODE === 'live') Game.newDemo();
let lastT = performance.now();
let accumulator = 0;
const FIXED_DT = 1 / 60;
function loop(t) {
  if (TITLE_RECORDING_MODE) { requestAnimationFrame(loop); return; }
  TitleDemo.sync();
  const frameDt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  accumulator += frameDt;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < 6) {
    Game.update(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === 6 && accumulator >= FIXED_DT) accumulator = 0;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
