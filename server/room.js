'use strict';
/* ============================================================
 * 매치 룸 — 서버 권위형 진행
 *
 * 전투와 메타(라운드·증강·이벤트 투표)를 전부 서버가 돌린다.
 * 클라이언트는 입력만 보내고 스냅샷을 받아 그린다.
 *
 * 진행 흐름
 *   weapon → intro → (round: aim → count → fight) → roundEnd
 *          → [3라운드 뒤 event] → augment → 다음 round … → over
 * 각 선택 단계에는 제한시간이 있고, 넘기면 자동 처리한다.
 * ============================================================ */
const core = require('./game-core.js');
const { snapshot } = require('./snapshot.js');

const TICK_HZ = 60;
const SNAP_HZ = 20;
const WEAPON_TIME = 12;
const AUGMENT_TIME = 12;
const EVENT_VOTE_TIME = 12;
const INTRO_TIME = 3;
const ROUND_END_TIME = 3;
const PLAYER_COLORS = ['#4da6ff', '#ff6b6b', '#6bd968', '#b97bff'];
const RECONNECT_GRACE = 90;    // 끊긴 자리를 비워두는 시간(초). 이 안에 돌아오면 그대로 이어간다
const ACTIVE_MAP = 'diamond';

let roomSeq = 0;

class Room {
  constructor(seats, onClosed) {
    this.id = 'R' + (++roomSeq);
    this.onClosed = onClosed;
    this.closed = false;
    this.round = 0;
    this.elimCounter = 1;
    this.refreshes = 0;
    this.battles = null;
    this.phase = 'weapon';
    this.deadline = 0;
    this.pending = new Map();      // pid -> 이번 단계에서 받은 선택
    this.eventOffers = [];
    this.eventVotes = new Map();
    this.openingPairingSchedule = null;
    this.lastPairKeys = new Set();

    // seats: { conn|null, name, charId, isAI }
    this.players = seats.map((seat, index) => ({
      id: index,
      conn: seat.conn || null,
      token: seat.conn ? seat.conn.token : null,   // 재접속 식별자
      human: !!seat.conn,                          // 원래 사람 자리인가
      droppedAt: 0,                                // 끊긴 시각 (0이면 접속 중)
      name: seat.name,
      isAI: !seat.conn,
      color: PLAYER_COLORS[index],
      charId: core.CHARACTERS[seat.charId] ? seat.charId : core.pick(Object.keys(core.CHARACTERS)),
      weaponId: null,
      coins: 5, coinsLost: 0,
      augments: [], augmentBaselines: {}, copiedSkill: null,
      gamble: false, trollCondition: false, damageRewardMult: 1,
      wins: 0, losses: 0, streak: 0, rounds: 0,
      eliminated: false, elimOrder: 0, rank: 0, totalDmg: 0,
    }));
    core.resetGameEventState(this);

    for (const p of this.players) if (p.conn) p.conn.room = this;

    this.tickTimer = setInterval(() => this.tick(), 1000 / TICK_HZ);
    this.snapAcc = 0;
    this.snapSeq = 0;    // 스냅샷 순번. 지터로 순서가 뒤바뀌어 도착한 것을 클라이언트가 버릴 수 있게 한다
  }

  /* 첫 단계 시작. 생성자에서 바로 하지 않는 이유는, 클라이언트가 자기 자리(you)를
   * 알기 전에 weaponOffers가 도착하면 "누가 나인지" 모른 채 화면을 그리기 때문이다. */
  start() { this.startWeaponPhase(); }

  /* ---------------- 통신 ---------------- */
  send(player, msg) {
    if (player.conn && player.conn.alive) player.conn.send(msg);
  }
  broadcast(msg) {
    for (const p of this.players) this.send(p, msg);
  }
  humanCount() { return this.players.filter(p => !p.isAI && p.conn && p.conn.alive).length; }

  publicPlayers() {
    return this.players.map(p => ({
      id: p.id, name: p.name, isAI: p.isAI, color: p.color,
      charId: p.charId, weaponId: p.weaponId, coins: p.coins,
      eliminated: p.eliminated, augments: p.augments.slice(),
      human: p.human, disconnected: !!p.droppedAt,
    }));
  }

  setPhase(phase, seconds) {
    this.phase = phase;
    this.deadline = seconds ? Date.now() + seconds * 1000 : 0;
    this.pending.clear();
  }
  timeLeft() { return this.deadline ? Math.max(0, (this.deadline - Date.now()) / 1000) : 0; }

  /* ---------------- 무기 선택 ---------------- */
  startWeaponPhase() {
    this.setPhase('weapon', WEAPON_TIME);
    this.offers = new Map();
    for (const p of this.players) {
      const ids = core.shuffle(Object.keys(core.WEAPONS)).slice(0, 3);
      this.offers.set(p.id, ids);
      if (p.isAI) {
        p.weaponId = core.pick(ids);
      } else {
        this.send(p, { t: 'weaponOffers', ids, seconds: WEAPON_TIME, players: this.publicPlayers() });
      }
    }
  }
  onWeapon(player, weaponId) {
    if (this.phase !== 'weapon' || player.weaponId) return;
    const ids = this.offers.get(player.id) || [];
    if (!ids.includes(weaponId)) return;
    player.weaponId = weaponId;
    if (this.players.every(p => p.weaponId)) this.startIntro();
  }
  finishWeaponPhase() {
    for (const p of this.players) if (!p.weaponId) p.weaponId = core.pick(this.offers.get(p.id));
    this.startIntro();
  }

  /* ---------------- 참가자 소개 ---------------- */
  startIntro() {
    this.setPhase('intro', INTRO_TIME);
    this.broadcast({ t: 'intro', players: this.publicPlayers(), seconds: INTRO_TIME });
  }

  /* ---------------- 라운드 ---------------- */
  aliveOf() { return this.players.filter(p => !p.eliminated && p.coins > 0); }

  startRound() {
    this.round++;
    const alive = this.aliveOf();
    const ffa = alive.length >= 2 && this.eventForceFfaRound === this.round;
    const options = {
      eventFfa: ffa,
      powerSupply: !!this.eventPowerSupply,
      twoPillars: !!this.eventTwoPillars,
    };
    let groups;
    if (ffa) groups = [alive];
    else groups = core.BounceRoyalMatchmaking.selectPairs(this, alive, this.round).map(pair => pair.slice());

    this.battles = groups.map(group => {
      const battle = new core.Battle(ACTIVE_MAP, group, options);
      // 서버가 조준을 통제한다. AI는 기존 로직이 알아서 잠근다.
      for (const f of battle.fighters) if (!f.player.isAI) f.isAI = false;
      return battle;
    });
    this.setPhase('battle', 0);
    this.broadcast({
      t: 'round', n: this.round, ffa, players: this.publicPlayers(),
      groups: this.battles.map(b => b.fighters.map(f => f.player.id)),
      aimSeconds: core.AIM_TIME,
    });
  }

  battleOf(player) {
    if (!this.battles) return null;
    return this.battles.find(b => b.fighters.some(f => f.player.id === player.id)) || null;
  }
  fighterOf(player) {
    const b = this.battleOf(player);
    return b ? b.fighters.find(f => f.player.id === player.id) : null;
  }

  onAim(player, ang) {
    const b = this.battleOf(player), f = this.fighterOf(player);
    if (!b || !f || typeof ang !== 'number' || !isFinite(ang)) return;
    if (b.phase === 'aim' && !f.aimLocked) { b.setDir(f, ang); f.aimLocked = true; }
    else if (b.phase === 'fight') core.applyCommonAim(b, f, ang);
  }
  onSkill(player, slot) {
    const b = this.battleOf(player), f = this.fighterOf(player);
    if (!b || !f || !['char', 'weapon', 'common'].includes(slot)) return;
    core.useSkill(b, f, slot);
  }

  /* ---------------- 라운드 정산 ---------------- */
  resolveRound() {
    const lines = [];
    for (const p of this.players) p.eventLostLastRound = false;
    for (const b of this.battles) {
      const r = b.result;
      if (!r) continue;
      if (b.eventFfa) {
        const placed = b.fighters.slice().sort((a, c) => {
          if (a === r.winner) return -1;
          if (c === r.winner) return 1;
          const aAlive = !a.dead && !a.mainDead, cAlive = !c.dead && !c.mainDead;
          if (aAlive !== cAlive) return aAlive ? -1 : 1;
          if (aAlive) return b.hpRatio(c) - b.hpRatio(a);
          return (c.deathAt || 0) - (a.deathAt || 0);
        });
        if (placed[0]) { core.winRound(placed[0].player); placed[0].player.coins++; }
        for (let i = 2; i < placed.length; i++) this.applyLoss(placed[i].player);
        lines.push({ kind: 'ffa', order: placed.map(f => f.player.id) });
      } else if (r.draw) {
        for (const f of b.fighters) this.applyLoss(f.player);
        lines.push({ kind: 'draw', ids: b.fighters.map(f => f.player.id) });
      } else {
        core.winRound(r.winner.player);
        if (this.eventCoinReversalRound === this.round) r.winner.player.coins++;
        for (const f of r.losers) this.applyLoss(f.player);
        lines.push({ kind: 'win', winner: r.winner.player.id, losers: r.losers.map(f => f.player.id), why: r.reason });
      }
      for (const f of b.fighters) f.player.rounds++;
    }
    if (this.eventForceFfaRound === this.round) this.eventForceFfaRound = 0;
    if (this.eventCoinReversalRound === this.round) this.eventCoinReversalRound = 0;

    const fought = new Set();
    this.battles.forEach(b => b.fighters.forEach(f => fought.add(f.player)));
    for (const p of this.aliveOf()) if (!fought.has(p)) p.rounds++;

    for (const p of this.players) {
      if (!p.eliminated && p.coins <= 0) {
        p.eliminated = true; p.elimOrder = this.elimCounter++;
        lines.push({ kind: 'elim', id: p.id });
      }
    }

    this.setPhase('roundEnd', ROUND_END_TIME);
    this.broadcast({ t: 'roundEnd', lines, players: this.publicPlayers(), seconds: ROUND_END_TIME });
  }

  applyLoss(player) {
    const protect = this.eventCoinReversalRound === this.round;
    const before = player.coins, lostBefore = player.coinsLost || 0;
    core.loseCoin(player);
    if (protect) { player.coins = before; player.coinsLost = lostBefore; }
    player.eventLostLastRound = true;
  }

  afterRoundEnd() {
    if (this.aliveOf().length <= 1) return this.gameOver();
    if (this.round === 3 && !this.eventVoteDone) return this.startEventVote();
    this.startAugmentPhase();
  }

  /* ---------------- 이벤트 투표 ---------------- */
  startEventVote() {
    this.setPhase('event', EVENT_VOTE_TIME);
    this.eventOffers = core.rollGameEventOffers();
    // 테스트용: FORCE_EVENT로 특정 이벤트를 후보 맨 앞에 강제로 넣는다
    const forced = process.env.FORCE_EVENT && core.GAME_EVENT_BY_ID[process.env.FORCE_EVENT];
    if (forced) this.eventOffers = [forced, ...this.eventOffers.filter(e => e.id !== forced.id)].slice(0, 3);
    this.eventVotes = new Map();
    for (const p of this.players) {
      if (p.isAI) this.eventVotes.set(p.id, core.pick(this.eventOffers).id);
    }
    this.broadcast({ t: 'eventOffers', offers: this.eventOffers, seconds: EVENT_VOTE_TIME, players: this.publicPlayers() });
  }
  onVote(player, eventId) {
    if (this.phase !== 'event' || this.eventVotes.has(player.id)) return;
    if (!this.eventOffers.some(e => e.id === eventId)) return;
    this.eventVotes.set(player.id, eventId);
    this.broadcast({ t: 'voteCast', id: player.id, eventId });
    if (this.players.every(p => this.eventVotes.has(p.id))) this.finishEventVote();
  }
  finishEventVote() {
    // 테스트용 강제 이벤트가 있으면 전원 그것에 투표시킨다
    const forcedId = process.env.FORCE_EVENT && core.GAME_EVENT_BY_ID[process.env.FORCE_EVENT] ? process.env.FORCE_EVENT : null;
    for (const p of this.players) if (!this.eventVotes.has(p.id)) this.eventVotes.set(p.id, forcedId || core.pick(this.eventOffers).id);
    if (forcedId) for (const p of this.players) this.eventVotes.set(p.id, forcedId);
    const result = core.resolveGameEventVote(this.players, this.eventOffers, this.eventVotes);
    this.eventVoteDone = true;
    core.applyGameEvent(this, result.event);
    this.setPhase('eventResult', ROUND_END_TIME);
    this.broadcast({
      t: 'eventResult',
      votes: Array.from(this.eventVotes.entries()),
      winnerId: result.winnerPlayer.id,
      event: result.event,
      players: this.publicPlayers(),
      seconds: ROUND_END_TIME,
    });
  }

  /* ---------------- 증강 선택 ---------------- */
  startAugmentPhase() {
    // AI 먼저 처리
    for (const p of this.players) {
      if (!p.isAI || p.eliminated) continue;
      const picks = core.eventAugmentPickCount(this, p);
      for (let i = 0; i < picks; i++) core.applyAugmentPick(p, core.aiPickAugment(core.rollAugmentOffers(p)));
    }
    for (const p of this.players) {
      if (!p.eliminated && p.coins <= 0) { p.eliminated = true; p.elimOrder = this.elimCounter++; }
    }
    if (this.aliveOf().length <= 1) return this.gameOver();

    this.refreshes++;
    this.augmentState = new Map();
    const humans = this.players.filter(p => !p.isAI && !p.eliminated);
    if (!humans.length) { this.startRound(); return; }
    this.setPhase('augment', AUGMENT_TIME);
    for (const p of humans) {
      const total = core.eventAugmentPickCount(this, p);
      const offers = core.rollAugmentOffers(p);
      this.augmentState.set(p.id, { left: total, total, offers });
      this.send(p, { t: 'augmentOffers', offers, left: total, total, refreshes: this.refreshes, seconds: AUGMENT_TIME });
    }
  }
  onAugment(player, augId) {
    if (this.phase !== 'augment') return;
    const st = this.augmentState.get(player.id);
    if (!st || st.left <= 0) return;
    const aug = st.offers.find(a => a.id === augId);
    if (!aug) return;
    core.applyAugmentPick(player, aug);
    st.left--;
    if (st.left > 0 && player.coins > 0) {
      st.offers = core.rollAugmentOffers(player);
      this.send(player, { t: 'augmentOffers', offers: st.offers, left: st.left, total: st.total, refreshes: this.refreshes, seconds: this.timeLeft() });
    }
    this.maybeFinishAugment();
  }
  onRefresh(player) {
    if (this.phase !== 'augment' || this.refreshes <= 0) return;
    const st = this.augmentState.get(player.id);
    if (!st || st.left <= 0) return;
    this.refreshes--;
    st.offers = core.rollAugmentOffers(player);
    this.send(player, { t: 'augmentOffers', offers: st.offers, left: st.left, total: st.total, refreshes: this.refreshes, seconds: this.timeLeft() });
  }
  maybeFinishAugment() {
    const done = Array.from(this.augmentState.values()).every(st => st.left <= 0);
    if (done) this.finishAugmentPhase();
  }
  finishAugmentPhase() {
    for (const [pid, st] of this.augmentState) {
      const player = this.players[pid];
      while (st.left > 0) {
        core.applyAugmentPick(player, core.aiPickAugment(st.offers));
        st.left--;
        if (st.left > 0) st.offers = core.rollAugmentOffers(player);
      }
    }
    for (const p of this.players) {
      if (!p.eliminated && p.coins <= 0) { p.eliminated = true; p.elimOrder = this.elimCounter++; }
    }
    if (this.aliveOf().length <= 1) return this.gameOver();
    this.startRound();
  }

  /* ---------------- 종료 ---------------- */
  gameOver() {
    const alive = this.aliveOf();
    const champion = alive.length
      ? alive.slice().sort((a, b) => b.coins - a.coins || b.wins - a.wins)[0]
      : this.players[0];
    for (const p of this.players) if (p !== champion && !p.eliminated) { p.eliminated = true; p.elimOrder = this.elimCounter++; }
    champion.rank = 1;
    this.players.filter(p => p !== champion)
      .sort((a, b) => b.elimOrder - a.elimOrder)
      .forEach((p, i) => { p.rank = i + 2; });
    this.setPhase('over', 0);
    this.broadcast({ t: 'gameOver', players: this.publicPlayers().map(p => ({ ...p, rank: this.players[p.id].rank })) });
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.tickTimer);
    for (const p of this.players) if (p.conn) p.conn.room = null;
    this.onClosed?.(this);
  }

  /* ---------------- 메인 루프 ---------------- */
  tick() {
    if (this.closed) return;
    this.sweepDropped();
    if (this.closed) return;
    const dt = 1 / TICK_HZ;

    if (this.phase === 'battle' && this.battles) {
      for (const b of this.battles) b.update(dt);
      this.snapAcc += dt;
      if (this.snapAcc >= 1 / SNAP_HZ) {
        this.snapAcc = 0;
        const seq = ++this.snapSeq;   // 한 번의 전송 배치는 모두 같은 순번
        for (const p of this.players) {
          const b = this.battleOf(p) || this.battles[0];
          if (b) this.send(p, { t: 's', q: seq, b: snapshot(b) });
        }
      }
      if (this.battles.every(b => b.result)) this.resolveRound();
      return;
    }

    if (!this.deadline) return;
    if (Date.now() < this.deadline) return;

    switch (this.phase) {
      case 'weapon': this.finishWeaponPhase(); break;
      case 'intro': this.startRound(); break;
      case 'roundEnd': this.afterRoundEnd(); break;
      case 'event': this.finishEventVote(); break;
      case 'eventResult': this.startAugmentPhase(); break;
      case 'augment': this.finishAugmentPhase(); break;
      default: break;
    }
  }

  /* ---------------- 접속 종료 ---------------- */
  /* 끊기면 그 자리를 AI가 대행한다. RECONNECT_GRACE 안에 같은 토큰으로
   * 돌아오면 원래 자리에 그대로 다시 앉는다. */
  onDisconnect(player) {
    player.isAI = true;
    player.conn = null;
    player.droppedAt = Date.now();
    const f = this.fighterOf(player);
    if (f) f.isAI = true;
    this.broadcast({ t: 'left', id: player.id, players: this.publicPlayers() });
  }

  reattach(conn) {
    const player = this.players.find(p => p.token && p.token === conn.token && p.droppedAt);
    if (!player) return null;
    if (Date.now() - player.droppedAt > RECONNECT_GRACE * 1000) return null;
    player.conn = conn;
    player.isAI = false;
    player.droppedAt = 0;
    conn.room = this;
    const f = this.fighterOf(player);
    if (f) f.isAI = false;
    this.send(player, {
      t: 'resumed', id: player.id, phase: this.phase, round: this.round,
      seconds: this.timeLeft(), players: this.publicPlayers(),
    });
    // 진행 중이던 선택 단계를 다시 안내한다
    if (this.phase === 'weapon' && !player.weaponId) {
      this.send(player, { t: 'weaponOffers', ids: this.offers.get(player.id), seconds: this.timeLeft(), players: this.publicPlayers() });
    } else if (this.phase === 'augment' && this.augmentState) {
      const st = this.augmentState.get(player.id);
      if (st && st.left > 0) this.send(player, { t: 'augmentOffers', offers: st.offers, left: st.left, total: st.total, refreshes: this.refreshes, seconds: this.timeLeft() });
    } else if (this.phase === 'event' && !this.eventVotes.has(player.id)) {
      this.send(player, { t: 'eventOffers', offers: this.eventOffers, seconds: this.timeLeft(), players: this.publicPlayers() });
    }
    this.broadcast({ t: 'rejoined', id: player.id, players: this.publicPlayers() });
    return player;
  }

  /* 유예가 끝난 자리는 완전히 AI로 확정하고, 기다릴 사람이 없으면 방을 닫는다 */
  sweepDropped() {
    const now = Date.now();
    let waiting = false;
    for (const p of this.players) {
      if (!p.droppedAt) continue;
      if (now - p.droppedAt > RECONNECT_GRACE * 1000) { p.droppedAt = 0; p.human = false; p.token = null; }
      else waiting = true;
    }
    if (this.humanCount() === 0 && !waiting) this.close();
  }
}

module.exports = { Room, WEAPON_TIME, AUGMENT_TIME, EVENT_VOTE_TIME, RECONNECT_GRACE };
