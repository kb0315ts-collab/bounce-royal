'use strict';
/* ============================================================
 * 바운스 로얄 — 멀티플레이 진행 컨트롤러
 *
 * 서버 메시지를 받아 기존 UI 함수들을 그대로 호출한다.
 * 싱글플레이 경로(Game의 로컬 sim)는 전혀 건드리지 않는다.
 *
 * 멀티에서 클라이언트가 하는 일은 딱 둘뿐이다.
 *   1) 입력을 서버로 보낸다
 *   2) 서버 스냅샷을 보간해 그린다
 * 전투 판정·라운드 진행·승패는 모두 서버 값을 따른다.
 * ============================================================ */

const Multi = {
  active: false,
  phase: null,
  lastRound: 0,
  view: null,          // 이번 프레임에 그릴 전투 뷰
  humanAim: null,      // 조이스틱 드래그 중 표시용
  spectating: false,
  myGroup: null,       // 내가 속한 전투의 자리 번호들
  groups: [],
  bound: false,

  /* ---------------- 진입 ---------------- */
  async start(kind, code) {
    try {
      setRankedSearchState('서버에 연결 중…', true);
      await BounceRoyalNet.connect();
    } catch (err) {
      setRankedSearchState('서버에 연결하지 못했습니다. 서버가 깨어나는 중이거나 점검 중일 수 있습니다.', false);
      // 이때만 완전 로컬 AI전을 대안으로 제시한다
      $('btn-offline-practice')?.classList.remove('hidden');
      return false;
    }
    $('btn-offline-practice')?.classList.add('hidden');
    this.bind();
    this.active = true;
    Game.mode = 'multi';
    Game.state = 'multi';
    if (kind === 'queue') BounceRoyalNet.queue();
    else if (kind === 'create') BounceRoyalNet.createRoom();
    else if (kind === 'join') BounceRoyalNet.joinRoom(code);
    return true;
  },

  stop() {
    this.active = false;
    this.view = null;
    this.humanAim = null;
    Game.mode = 'single';
    BounceRoyalNet.disconnect();
    if (typeof stopPhaseTimer === 'function') stopPhaseTimer();
    hudVisible(false);
    setWatchOtherButton(false);
    specTag(null);
    setHint(null);
  },

  /* ---------------- 서버 메시지 ---------------- */
  bind() {
    if (this.bound) return;
    this.bound = true;
    const net = BounceRoyalNet;

    net.on('queue', m => {
      setRankedSearchState(`플레이어를 찾는 중… ${m.left}초 · ${m.found}/${m.need}명`, true);
    });

    net.on('roomCreated', m => this.showLobby(m));
    net.on('roomJoined', m => this.showLobby(m));
    net.on('roomError', m => banner('입장 실패', m.why, 1600));

    net.on('match', m => {
      banner('매칭 완료!', `사람 ${m.humans}명`, 1200);
      updatePlayersPanel(this.panelState());
    });

    net.on('weaponOffers', m => {
      Game.state = 'weaponSelect';
      hudVisible(false);
      showScreen('scr-weapon');
      if (typeof selectionPlayers === 'function') selectionPlayers(this.withLocal(m.players));
      buildWeaponSelect(m.ids, id => {
        net.pickWeapon(id);
        setHint('다른 플레이어를 기다리는 중…');
      });
      startPhaseTimer('aug-timer', m.seconds, null);
    });

    net.on('intro', m => {
      stopPhaseTimer();
      Game.state = 'intro';
      showMatchIntro(this.withLocal(m.players), m.seconds * 1000, null);
    });

    net.on('round', m => {
      stopPhaseTimer();
      this.groups = m.groups || [];
      this.myGroup = this.groups.find(g => g.includes(net.seat)) || this.groups[0] || [];
      this.spectating = false;
      Game.state = 'battle';
      showScreen(null);
      hudVisible(true);
      updatePlayersPanel(this.panelState());
      banner(`ROUND ${m.n}`, m.ffa ? '전원 집결!' : '다이아 경기장', 1400);
      SFX.coin();
    });

    net.on('roundEnd', m => {
      const me = m.players.find(p => p.id === net.seat);
      for (const line of m.lines || []) {
        if (line.kind === 'win' && line.winner === net.seat) { banner('승리!', line.why || '', 1200); SFX.win(); }
        else if (line.kind === 'win' && (line.losers || []).includes(net.seat)) { banner('패배…', '', 1200); SFX.lose(); }
        else if (line.kind === 'elim' && line.id === net.seat) banner('탈락…', '코인 소진', 1400);
      }
      updatePlayersPanel(this.panelState());
    });

    net.on('eventOffers', m => {
      Game.state = 'eventVote';
      hudVisible(false);
      showEventVote(m.offers, this.withLocal(m.players), choice => net.vote(choice && choice.id ? choice.id : choice));
      startPhaseTimer('event-timer', m.seconds, null);
    });

    net.on('voteCast', m => {
      const votes = new Map(this.votes || []);
      votes.set(m.id, m.eventId);
      this.votes = Array.from(votes.entries());
      if (typeof updateEventVote === 'function') {
        updateEventVote(votes, { offers: BounceRoyalNet.eventOffers, players: net.players, voterId: m.id });
      }
    });

    net.on('eventResult', m => {
      stopPhaseTimer();
      Game.state = 'eventVoteResult';
      const votes = new Map(m.votes);
      showEventVoteResult(
        { votes, players: this.withLocal(m.players), offers: [m.event], winnerPlayerId: m.winnerId, event: m.event },
        null,
      );
    });

    net.on('augmentOffers', m => {
      Game.state = 'augment';
      hudVisible(false);
      showScreen('scr-augment');
      const me = net.players.find(p => p.id === net.seat) || { augments: [] };
      buildAugmentSelect(m.offers, me, aug => net.pickAugment(aug.id),
        m.total > 1 ? `${m.total - m.left + 1}/${m.total}번째 증강` : null,
        { refreshes: m.refreshes, onRefresh: () => net.refresh() });
      setRefreshButton(m.refreshes, () => net.refresh());
      startPhaseTimer('aug-timer', m.seconds, null);
    });

    net.on('gameOver', m => {
      stopPhaseTimer();
      Game.state = 'over';
      hudVisible(false);
      const me = m.players.find(p => p.id === net.seat);
      showGameOver(this.withLocal(m.players).map(p => ({ ...p, rank: p.rank })), me, () => {
        this.stop();
        Game.returnToTitle();
      });
      const line = $('over-rating');
      if (line) line.textContent = '온라인 대전 · 레이팅 변동 없음';
    });

    net.on('left', m => {
      const who = m.players.find(p => p.id === m.id);
      if (who) banner(`${who.name} 접속 끊김`, 'AI가 대신 진행합니다', 1400);
      updatePlayersPanel(this.panelState());
    });
    net.on('rejoined', m => {
      const who = m.players.find(p => p.id === m.id);
      if (who) banner(`${who.name} 복귀!`, '', 1200);
      updatePlayersPanel(this.panelState());
    });
    net.on('resumed', m => {
      banner('다시 연결됨', `라운드 ${m.round}`, 1400);
      Game.mode = 'multi';
      this.active = true;
      if (m.phase === 'battle') { Game.state = 'battle'; showScreen(null); hudVisible(true); }
      updatePlayersPanel(this.panelState());
    });

    net.on('close', () => {
      if (!this.active) return;
      banner('서버 연결 끊김', '다시 접속을 시도하세요', 2000);
    });
  },

  showLobby(m) {
    Game.state = 'lobby';
    showScreen('scr-friendly');
    const code = $('room-code');
    if (code) code.textContent = m.code;
    const note = document.querySelector('.room-code-wrap small');
    if (note) note.textContent = '🌐 온라인 방 · 이 코드를 친구에게 알려주세요';
    if (typeof buildFriendlySlots === 'function') {
      buildFriendlySlots(
        { code: m.code, maxPlayers: 4, slots: [0, 1, 2, 3].map(i => (m.players[i] ? { ...m.players[i], ready: true, local: i === m.you } : null)) },
        { onAddAI: null, onRemoveSlot: null, onToggleReady: null },
      );
    }
    $('room-local-actions')?.classList.add('hidden');   // 서버가 빈 자리를 AI로 채운다
    const start = $('btn-room-start');
    if (start) {
      start.disabled = false;
      start.textContent = m.players.length >= 4
        ? '4명으로 시작'
        : `${m.players.length}명으로 시작 (남은 ${4 - m.players.length}자리 AI)`;
    }
  },

  /* 서버 목록에 "나"를 표시해서 넘긴다.
   * UI는 local 표시가 없으면 첫 번째를 나로 친다(싱글에서는 늘 맞는 가정).
   * 멀티에서는 자리가 1~3번이면 남의 이름·색을 자기 것으로 보게 된다. */
  withLocal(list) {
    const seat = BounceRoyalNet.seat;
    return (list || []).map(p => (p && p.id === seat ? Object.assign({}, p, { local: true }) : p));
  },

  /* 서버가 준 참가자 목록을 UI가 아는 모양으로 바꾼다 */
  panelState() {
    return {
      players: BounceRoyalNet.players.map(p => ({
        id: p.id, name: p.name, color: p.color, coins: p.coins,
        charId: p.charId, weaponId: p.weaponId,
        eliminated: p.eliminated, augments: p.augments || [],
        isAI: p.isAI, disconnected: p.disconnected,
        local: p.id === BounceRoyalNet.seat,
      })),
      human: BounceRoyalNet.players.find(p => p.id === BounceRoyalNet.seat) || null,
      round: BounceRoyalNet.round,
    };
  },

  /* ---------------- 입력 ---------------- */
  canAim() {
    const v = this.view, me = v && v.human();
    if (!v || !me || me.dead || me.mainDead) return null;
    if (v.phase === 'aim' && !me.aimLocked) return 'aim';
    if (v.phase === 'fight' && !me.player.copiedSkill && me.skillUses.common > 0) return 'common';
    return null;
  },
  sendAim(ang) { BounceRoyalNet.aim(ang); },
  sendSkill(slot) { BounceRoyalNet.skill(slot); },

  /* ---------------- 매 프레임 ---------------- */
  update(dt) {
    if (!this.active) return;
    BounceRoyalNet.advanceFx(dt || 1 / 60);
    const snap = BounceRoyalNet.viewState();
    if (!snap) { renderBattle(null); return; }
    this.view = netBattleView(snap, BounceRoyalNet.players, BounceRoyalNet.seat, this.humanAim);
    renderBattle(this.view);
    if (Game.state === 'battle') this.updateHUD();
  },

  updateHUD() {
    const v = this.view;
    if (!v) return;
    $('hud-round').textContent = `ROUND ${BounceRoyalNet.round}` + (this.spectating ? ' · 관전' : '');
    $('hud-map').textContent = v.arena.name;
    const timer = $('hud-timer'), tag = $('ot-tag');
    timer.classList.remove('waiting');
    if (v.phase === 'fight') {
      if (v.overtime) { timer.textContent = Math.max(0, v.otT).toFixed(1); timer.classList.add('ot'); tag.classList.add('on'); }
      else { timer.textContent = Math.max(0, BATTLE_TIME - v.simT).toFixed(1); timer.classList.remove('ot'); tag.classList.remove('on'); }
      timer.classList.remove('urgent');
    } else if (v.phase === 'aim') {
      timer.textContent = '조준';
      timer.classList.remove('ot'); tag.classList.remove('on');
    } else {
      timer.textContent = BATTLE_TIME.toFixed(1);
      timer.classList.remove('ot', 'urgent'); tag.classList.remove('on');
    }
    updateSkillbar(v);
    if (typeof updatePlayerStatuses === 'function') updatePlayerStatuses(this.panelState());
    const me = v.human();
    if (v.phase === 'aim' && me && !me.aimLocked) setHint('🧭 버튼을 끌어 방향 조준');
    else if (v.phase === 'fight' && me && me.skillUses.common > 0 && !me.player.copiedSkill) setHint(`🧭 버튼을 끌어 방향 전환 (남은 ${me.skillUses.common}회)`);
    else setHint(null);
    // 다른 전투 관전 전환
    this.offerSpectate();
  },

  offerSpectate() {
    const v = this.view;
    const myDone = v && v.result;
    const hasOther = this.groups.length > 1;
    setWatchOtherButton(!!(myDone && hasOther && !this.spectating), () => {
      this.spectating = true;
      specTag('관전 중');
      setWatchOtherButton(false);
    }, '다른 전투 보기');
  },
};

/* 페이지를 새로고침해도 같은 탭이면 sessionStorage에 토큰이 남아 있다.
 * 서버에 아직 내 자리가 살아 있으면 자동으로 그 방에 복귀한다. */
Multi.autoResume = async function () {
  let token = null;
  try { token = sessionStorage.getItem('bounce-royale-session-v1'); } catch (e) { return false; }
  if (!token) return false;
  try { await BounceRoyalNet.connect(); } catch (e) { return false; }
  this.bind();
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; resolve(ok); };
    BounceRoyalNet.on('resumed', () => { this.active = true; Game.mode = 'multi'; finish(true); });
    setTimeout(() => { if (!done) { BounceRoyalNet.disconnect(); finish(false); } }, 2500);
  });
};

if (typeof window !== 'undefined') {
  window.BounceRoyalMulti = Multi;
  // 로드 직후 복귀를 시도한다. 실패하면 아무 일도 일어나지 않는다.
  window.addEventListener('load', () => { Multi.autoResume().catch(() => {}); });
}
