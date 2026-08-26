'use strict';
/* ============================================================
 * 바운스 로얄 — 720×1280 모바일 DOM UI
 * ============================================================ */
const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[ch]));
}
function playUI() { if (typeof SFX !== 'undefined' && SFX && typeof SFX.ui === 'function') SFX.ui(); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.add('hidden'));
  const target = id ? $(id) : null;
  if (target) target.classList.remove('hidden');
  closePlayerDetail();
  hideHoldTooltip();
}
function hudVisible(visible) { $('hud')?.classList.toggle('hidden', !visible); }

/* ---------------- 배너 ---------------- */
let bannerTimer = null;
function banner(main, sub = '', duration = 1400) {
  const el = $('banner');
  if (!el) return;
  $('banner-main').textContent = main;
  $('banner-sub').textContent = sub;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('show', 'pop');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ---------------- 공통 렌더 유틸 ---------------- */
const CAT_ICONS = {
  stat:'💪', time:'⏱️', tempo:'🚀', hpcond:'❤️‍🔥', streak:'📈', coin:'🪙', trade:'⚖️',
  physics:'💥', cc:'🧊', auto:'⚙️', summon:'🔵', death:'☠️', onhit:'🎯', skill:'⚡',
  link:'🔗', weapon:'🛠️', copy:'🧬',
};

function bar(label, value) {
  const pct = Math.max(5, Math.min(100, Math.round(Number(value || 0) * 100)));
  return `<div class="sbar"><span class="bt">${esc(label)}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
}

function paintPortrait(canvasEl, charId, weaponId, color = '#4da6ff') {
  if (!canvasEl || !CHARACTERS[charId]) return;
  const paint = () => {
    if (!canvasEl.isConnected) return;
    if (WEAPONS[weaponId] && typeof drawLoadoutPortrait === 'function') {
      drawLoadoutPortrait(canvasEl, charId, weaponId, color);
      return;
    }
    const c = canvasEl.getContext('2d');
    const dpr = window.BounceRoyalDisplay?.pixelRatio?.() || Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(96, canvasEl.clientWidth || 150);
    const h = Math.max(72, canvasEl.clientHeight || 100);
    canvasEl.width = Math.round(w * dpr); canvasEl.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const glow = c.createRadialGradient(w * .5, h * .53, 2, w * .5, h * .53, Math.max(w, h) * .55);
    glow.addColorStop(0, 'rgba(77,166,255,.25)'); glow.addColorStop(1, 'rgba(7,10,20,0)');
    c.fillStyle = glow; c.fillRect(0, 0, w, h);
    if (typeof drawBall === 'function') {
      const r = Math.min(w, h) * .28;
      const f = { charId, color, vx:1, vy:0, flash:0, timers:{ immune:0, untouchable:0, freeze:0, actingDead:0 } };
      drawBall(c, f, w * .5, h * .55, r);
    } else {
      c.font = `${Math.min(w, h) * .45}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(CHARACTERS[charId].ico, w / 2, h / 2);
    }
  };
  paint();
  requestAnimationFrame(paint);
}

function playerSource(player) { return player?.player || player || {}; }
function playerStatus(player, game) {
  const p = playerSource(player);
  if (p.eliminated || p.coins <= 0) return '탈락';
  let fighter = null, battle = null;
  for (const candidate of game?.battles || []) {
    const found = candidate.fighters?.find(f => f.player === p || f.player?.id === p.id);
    if (found) { fighter = found; battle = candidate; break; }
  }
  if (fighter && battle?.result) {
    if (!battle.result.draw && battle.result.winner?.player === p) return '생존';
    return '전투 종료';
  }
  const liveSplit = fighter?.splitBalls?.some(split => !split.dead && split.hp > 0);
  if (fighter?.dead || (fighter?.mainDead && !liveSplit)) return '전투 종료';
  if (fighter) return '전투 중';
  return game?.state === 'battle' ? '부전승' : '생존';
}

function playerStatusIcon(status) {
  if (status === '전투 중') return '⚔️';
  if (status === '전투 종료') return '🏁';
  if (status === '탈락') return '💀';
  if (status === '부전승') return '⭐';
  return '●';
}

/* ---------------- 길게 누르기 상세 ---------------- */
let tooltipTimer = null;
function showHoldTooltip(item) {
  const tip = $('hold-tooltip');
  if (!tip || !item) return;
  const category = item.cat ? (CAT_TAGS[item.cat] || item.cat) : (item.kind || '상세 정보');
  const icon = item.ico || CAT_ICONS[item.cat] || '◆';
  tip.innerHTML = `<div class="tooltip-title">${esc(icon)} ${esc(item.name || '정보')}</div><span class="tag tooltip-tag">${esc(category)}</span><div class="tooltip-desc">${esc(item.desc || item.skillDesc || '설명이 없습니다.')}</div>`;
  tip.classList.remove('hidden');
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideHoldTooltip, 3600);
}
function hideHoldTooltip() {
  clearTimeout(tooltipTimer);
  $('hold-tooltip')?.classList.add('hidden');
}
function bindLongPress(element, item, delay = 480) {
  if (!element) return;
  let timer = null, startX = 0, startY = 0, suppressClick = false, activePointer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const finish = event => {
    if (activePointer === null || event.pointerId !== activePointer) return;
    cancel();
    try {
      if (element.hasPointerCapture?.(activePointer)) element.releasePointerCapture(activePointer);
    } catch (error) { /* 일부 WebView 미지원 */ }
    activePointer = null;
  };
  element.addEventListener('pointerdown', event => {
    if (event.button != null && event.button !== 0) return;
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    try { element.setPointerCapture(event.pointerId); } catch (error) { /* 일부 WebView 미지원 */ }
    startX = event.clientX; startY = event.clientY; suppressClick = false;
    cancel();
    timer = setTimeout(() => {
      timer = null; suppressClick = true;
      showHoldTooltip(typeof item === 'function' ? item() : item);
      const vibrationEnabled = typeof Profile === 'undefined' || Profile.data?.vibration !== false;
      if (vibrationEnabled && navigator.vibrate) navigator.vibrate(28);
    }, delay);
  });
  element.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 12) cancel();
  });
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', event => {
    if (event.pointerId !== activePointer) return;
    cancel(); activePointer = null;
  });
  element.addEventListener('contextmenu', event => event.preventDefault());
  element.addEventListener('click', event => {
    if (!suppressClick) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
  }, true);
}

/* ---------------- 선택 화면 참가자 바 ---------------- */
let lastIntroPlayers = [];
function selectionPlayers(players) {
  const list = (players || []).filter(Boolean).slice(0, 4);
  document.querySelectorAll('.selection-roster').forEach(el => el.remove());
  if (!list.length) return;
  for (const screenId of ['scr-weapon', 'scr-augment', 'scr-event']) {
    const screen = $(screenId), head = screen?.querySelector('.screen-head');
    if (!screen || !head) continue;
    const roster = document.createElement('div');
    roster.className = 'selection-roster';
    roster.style.cssText = 'height:13cqw;min-height:13cqw;display:grid;grid-template-columns:repeat(4,1fr);gap:1cqw;padding:0 2cqw 1cqw;background:#070c18;';
    list.forEach((raw, rank) => {
      const p = playerSource(raw), ch = CHARACTERS[p.charId];
      const el = document.createElement('button');
      el.type = 'button'; el.className = `prow${p.eliminated ? ' dead eliminated' : ''}`;
      el.innerHTML = `<div class="portrait"><span class="coin-rank">${rank + 1}</span><canvas aria-hidden="true"></canvas></div><div class="hud-name"><span>${esc(p.name || `플레이어 ${rank + 1}`)}</span>${p.coins != null ? `<span class="hud-coins">🪙${Math.max(0, p.coins)}</span>` : ''}</div>`;
      el.onclick = () => showPlayerDetail(p);
      roster.appendChild(el);
      paintPortrait(el.querySelector('canvas'), p.charId, p.weaponId, p.color);
    });
    head.insertAdjacentElement('afterend', roster);
  }
}

/* ---------------- 캐릭터 / 무기 선택 ---------------- */
function buildCharSelect(onPick) {
  const box = $('char-cards');
  if (!box) return;
  box.replaceChildren();
  Object.entries(CHARACTERS).forEach(([id, ch]) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'card character-card';
    el.innerHTML = `<div class="art"><span>${esc(ch.ico)}</span></div><div class="head"><span class="nm">${esc(ch.name)}</span></div><div class="stats">${bar('체력', ch.hp / 130)}${bar('이동', (ch.move - 130) / 70)}</div><div class="desc"><b style="color:#ffd24d">${esc(ch.skillName)}</b><br>${esc(ch.skillDesc)}</div>`;
    el.onclick = () => { playUI(); onPick?.(id); };
    bindLongPress(el, { name:ch.skillName, ico:ch.ico, kind:ch.name, desc:ch.skillDesc });
    box.appendChild(el);
  });
}

function buildWeaponSelect(offers, onPick) {
  selectionPlayers(lastIntroPlayers.length ? lastIntroPlayers : (typeof Game !== 'undefined' ? Game.players : []));
  const box = $('weapon-cards');
  if (!box) return;
  box.replaceChildren();
  (offers || []).forEach(id => {
    const wp = WEAPONS[id]; if (!wp) return;
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'card weapon-card';
    el.innerHTML = `<div class="art">${esc(wp.ico)}</div><div class="head"><span class="nm">${esc(wp.name)}</span></div><span class="tag">${wp.type === 'melee' ? '근접' : wp.type === 'mine' ? '설치' : '원거리'}</span><div class="stats">${bar('공격', wp.stat?.atk)}${bar('속도', wp.stat?.spd)}${bar('사거리', wp.stat?.rng)}${bar('기동', wp.stat?.mob)}</div><div class="desc">${esc(wp.desc)}</div><div class="foot"><b style="color:#ffd24d">${esc(wp.skillName)}</b><br>${esc(wp.skillDesc)}</div>`;
    el.onclick = () => { playUI(); onPick?.(id); };
    bindLongPress(el, { ...wp, kind:'무기' });
    box.appendChild(el);
  });
}

function buildAugmentSelect(offers, player, onPick, subtitle, refreshOptions = null) {
  const currentPlayers = typeof Game !== 'undefined' && Game.players?.length ? Game.players : lastIntroPlayers;
  selectionPlayers(currentPlayers);
  const round = typeof Game !== 'undefined' ? Game.round : '';
  if ($('aug-round-label')) $('aug-round-label').textContent = round ? `ROUND ${round}` : 'AUGMENT';
  if ($('aug-sub')) $('aug-sub').textContent = subtitle || `라운드 ${round || 1} · 새로운 증강 하나를 획득합니다.`;
  const box = $('aug-cards');
  if (!box) return;
  box.replaceChildren();
  (offers || []).forEach(augment => {
    if (!augment) return;
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'card augment-card';
    const icon = CAT_ICONS[augment.cat] || '◆';
    el.innerHTML = `<div class="art">${esc(icon)}</div><div class="head"><span class="nm">${esc(augment.name)}</span></div><span class="tag">${esc(CAT_TAGS[augment.cat] || augment.cat)}</span><div class="desc">${esc(augment.desc)}</div>`;
    el.onclick = () => { playUI(); onPick?.(augment); };
    bindLongPress(el, augment);
    box.appendChild(el);
  });
  const p = playerSource(player), ch = CHARACTERS[p.charId], wp = WEAPONS[p.weaponId];
  if ($('aug-myinfo')) $('aug-myinfo').textContent = `${ch?.ico || ''} ${ch?.name || ''} · ${wp?.ico || ''} ${wp?.name || ''} · 🪙 ${Math.max(0, p.coins || 0)}개`;
  const owned = $('aug-owned');
  if (owned) {
    owned.replaceChildren();
    const counts = new Map(); (p.augments || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    if (!counts.size) {
      const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = '보유 증강 없음'; owned.appendChild(chip);
    } else counts.forEach((count, id) => {
      const augment = AUG_BY_ID[id]; if (!augment) return;
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'chip'; chip.textContent = `${augment.name}${count > 1 ? ` ×${count}` : ''}`;
      bindLongPress(chip, augment); owned.appendChild(chip);
    });
  }
  if (refreshOptions) setAugmentRefresh(refreshOptions.refreshes || 0, refreshOptions.onRefresh);
}

function setAugmentRefresh(count, onRefresh) {
  const amount = Math.max(0, Number(count) || 0), button = $('btn-refresh'), countEl = $('refresh-count');
  if (countEl) countEl.textContent = String(amount);
  if (!button) return;
  button.disabled = amount <= 0 || typeof onRefresh !== 'function';
  button.onclick = button.disabled ? null : event => { event.preventDefault(); onRefresh(); };
}

/* ---------------- 3라운드 종료 이벤트 투표 ---------------- */
let eventVoteView = { offers: [], players: [], keys: [], votes: new Map(), locked: false, selectedKey: null, onVote: null };
let eventVoteRevealSession = 0;
const eventVoteRevealTimers = new Set();
// 당첨자를 공개한 뒤 증강 선택으로 자동 전환하기까지의 대기 시간
const EVENT_RESULT_HOLD_MS = 1000;

function cancelEventVoteReveal() {
  eventVoteRevealSession++;
  eventVoteRevealTimers.forEach(timer => clearTimeout(timer));
  eventVoteRevealTimers.clear();
  document.querySelectorAll('.event-card-voter.spotlight').forEach(el => el.classList.remove('spotlight'));
}

function eventVoteTimer(callback, delay, session) {
  const timer = setTimeout(() => {
    eventVoteRevealTimers.delete(timer);
    if (session === eventVoteRevealSession) callback();
  }, delay);
  eventVoteRevealTimers.add(timer);
}

function eventChoiceKey(choice, index = -1) {
  const value = choice?.id ?? choice?.eventId ?? choice?.key;
  return String(value ?? `event-${index}`);
}

function eventPlayerKey(rawPlayer, index = -1) {
  const player = playerSource(rawPlayer);
  return String(player.id ?? player.playerId ?? `player-${index}`);
}

function eventChoiceCopy(choice) {
  return {
    name: String(choice?.name ?? choice?.title ?? '이름 없는 이벤트'),
    desc: String(choice?.desc ?? choice?.description ?? choice?.effect ?? '이벤트 설명이 없습니다.'),
    icon: String(choice?.ico ?? choice?.icon ?? choice?.emoji ?? '✦'),
  };
}

function eventKeyFromVote(value, offers = eventVoteView.offers) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (value.event != null) return eventKeyFromVote(value.event, offers);
    value = value.eventId ?? value.choiceId ?? value.id ?? value.key;
  }
  if (value == null) return null;
  const rawKey = String(value);
  const index = offers.findIndex((choice, choiceIndex) => eventChoiceKey(choice, choiceIndex) === rawKey);
  return index >= 0 ? eventChoiceKey(offers[index], index) : rawKey;
}

function normalizeEventVotes(votes, players) {
  const normalized = new Map();
  const put = (rawPlayerKey, rawEvent, fallbackIndex = -1) => {
    let playerKey = rawPlayerKey;
    if (typeof rawPlayerKey === 'object' && rawPlayerKey != null) playerKey = eventPlayerKey(rawPlayerKey, fallbackIndex);
    if (playerKey == null && players[fallbackIndex]) playerKey = eventPlayerKey(players[fallbackIndex], fallbackIndex);
    const eventKey = eventKeyFromVote(rawEvent);
    if (playerKey != null && eventKey != null) normalized.set(String(playerKey), eventKey);
  };
  if (votes instanceof Map) {
    votes.forEach((eventValue, playerValue) => put(playerValue, eventValue));
  } else if (Array.isArray(votes)) {
    votes.forEach((entry, index) => {
      if (entry && typeof entry === 'object' && (
        entry.playerId != null || entry.player != null || entry.eventId != null || entry.event != null || entry.choiceId != null
      )) {
        const rawPlayer = entry.player ?? entry.playerId ?? players[index];
        const rawEvent = entry.event ?? entry.eventId ?? entry.choiceId ?? entry.choice;
        put(rawPlayer, rawEvent, index);
      } else put(players[index], entry, index);
    });
  } else if (votes && typeof votes === 'object') {
    Object.entries(votes).forEach(([playerKey, eventValue]) => put(playerKey, eventValue));
  }
  return normalized;
}

function eventVotePortrait(rawPlayer, index, arrived = false) {
  const player = playerSource(rawPlayer), playerKey = eventPlayerKey(rawPlayer, index);
  const el = document.createElement('span');
  el.className = `event-card-voter${arrived ? ' arrived' : ''}`;
  el.dataset.playerId = playerKey;
  el.style.setProperty('--voter-color', typeof player.color === 'string' ? player.color : '#7082ad');
  const character = typeof CHARACTERS !== 'undefined' ? CHARACTERS[player.charId] : null;
  const weapon = typeof WEAPONS !== 'undefined' ? WEAPONS[player.weaponId] : null;
  el.title = `${player.name || `플레이어 ${index + 1}`} · ${character?.name || '캐릭터'} + ${weapon?.name || '무기'}`;
  el.setAttribute('aria-label', el.title);
  const fallback = document.createElement('span'); fallback.className = 'event-card-voter-fallback'; fallback.textContent = character?.ico || '●';
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
  el.append(fallback, canvas);
  requestAnimationFrame(() => paintPortrait(canvas, player.charId, player.weaponId, player.color));
  return el;
}

function renderEventCardVoters(previousVotes = new Map(), arrivingPlayerId = null) {
  const cards = new Map();
  document.querySelectorAll('#event-cards .event-card').forEach(card => {
    cards.set(card.dataset.eventId, card);
    card.querySelector('.event-card-voters')?.replaceChildren();
  });
  eventVoteView.players.forEach((rawPlayer, index) => {
    const playerKey = eventPlayerKey(rawPlayer, index), choiceKey = eventVoteView.votes.get(playerKey);
    const card = cards.get(choiceKey), strip = card?.querySelector('.event-card-voters');
    if (!strip) return;
    const arrived = String(arrivingPlayerId ?? '') === playerKey || previousVotes.get(playerKey) !== choiceKey;
    strip.appendChild(eventVotePortrait(rawPlayer, index, arrived));
  });
  cards.forEach((card, key) => {
    let count = 0; eventVoteView.votes.forEach(value => { if (value === key) count++; });
    card.classList.toggle('has-votes', count > 0);
    const badge = card.querySelector('.event-vote-count'); if (badge) badge.textContent = `${count}표`;
  });
}

/** 실시간 표를 누적 상태로 반영한다. Map/객체/배열과 단일 {playerId,eventId}를 허용한다. */
function updateEventVote(votes, options = {}) {
  if (Array.isArray(options.offers) && options.offers.length) {
    eventVoteView.offers = options.offers.filter(Boolean).slice(0, 3);
    eventVoteView.keys = eventVoteView.offers.map(eventChoiceKey);
  }
  if (Array.isArray(options.players) && options.players.length) eventVoteView.players = options.players.filter(Boolean).slice(0, 4);
  const direct = votes && !(votes instanceof Map) && !Array.isArray(votes) && typeof votes === 'object'
    && (votes.playerId != null || votes.player != null) && (votes.eventId != null || votes.event != null || votes.choiceId != null);
  const incoming = normalizeEventVotes(direct ? [votes] : votes, eventVoteView.players);
  const previous = new Map(eventVoteView.votes);
  if (options.replace !== false && !direct) eventVoteView.votes = new Map();
  incoming.forEach((eventKey, playerKey) => {
    if (eventVoteView.keys.includes(eventKey)) eventVoteView.votes.set(playerKey, eventKey);
  });
  renderEventCardVoters(previous, options.voterId);
  const status = $('event-status'), total = eventVoteView.players.length || 4, count = eventVoteView.votes.size;
  if (status && !options.silent) {
    status.textContent = options.complete ? `투표 마감 · ${count}/${total}명 선택 완료` : `${count}/${total}명 투표 완료 · 선택은 즉시 공개됩니다.`;
    status.classList.toggle('locked', !!options.complete);
  }
  return new Map(eventVoteView.votes);
}

function renderEventVoteCards() {
  const box = $('event-cards');
  if (!box) return;
  box.replaceChildren();
  eventVoteView.offers.forEach((choice, index) => {
    const key = eventVoteView.keys[index], copy = eventChoiceCopy(choice);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'event-card';
    button.dataset.eventId = key;
    button.setAttribute('aria-pressed', 'false');

    const art = document.createElement('span'); art.className = 'event-art'; art.textContent = copy.icon;
    const name = document.createElement('span'); name.className = 'event-name'; name.textContent = copy.name;
    const desc = document.createElement('span'); desc.className = 'event-desc'; desc.textContent = copy.desc;
    const voters = document.createElement('span'); voters.className = 'event-card-voters';
    const count = document.createElement('span'); count.className = 'event-vote-count'; count.textContent = '0표';
    button.append(art, name, desc, voters, count);

    button.onclick = () => {
      if (eventVoteView.locked) return;
      eventVoteView.locked = true;
      eventVoteView.selectedKey = key;
      box.querySelectorAll('.event-card').forEach(card => {
        const selected = card.dataset.eventId === key;
        card.disabled = true;
        card.classList.toggle('selected', selected);
        card.setAttribute('aria-pressed', String(selected));
      });
      const status = $('event-status');
      if (status) {
        status.textContent = `내 투표: ${copy.name} · 다른 플레이어의 선택을 기다리는 중…`;
        status.classList.add('locked');
      }
      playUI();
      const humanIndex = Math.max(0, eventVoteView.players.findIndex(raw => playerSource(raw).isAI === false || playerSource(raw).local));
      const human = eventVoteView.players[humanIndex];
      if (human) updateEventVote({ player:human, eventId:key }, { voterId:eventPlayerKey(human, humanIndex) });
      eventVoteView.onVote?.(choice, index);
    };
    box.appendChild(button);
  });
}

/**
 * 세 개의 공통 이벤트 선택지를 표시한다. 클릭 콜백은 최초 한 번만 호출된다.
 * @param {Array<object>} offers `{ id, name, desc, ico? }` 형태의 이벤트 세 개
 * @param {Array<object>} players 투표에 참여하는 플레이어 네 명
 * @param {Function} onVote `(event, offerIndex) => void`
 */
function showEventVote(offers, players, onVote) {
  cancelEventVoteReveal();
  const normalizedOffers = Array.isArray(offers) ? offers.filter(Boolean).slice(0, 3) : [];
  eventVoteView = {
    offers: normalizedOffers,
    players: Array.isArray(players) ? players.filter(Boolean).slice(0, 4) : [],
    keys: normalizedOffers.map(eventChoiceKey),
    votes: new Map(),
    locked: false,
    selectedKey: null,
    onVote: typeof onVote === 'function' ? onVote : null,
  };
  selectionPlayers(eventVoteView.players);
  showScreen('scr-event');
  renderEventVoteCards();

  const sub = $('event-sub'), status = $('event-status'), result = $('event-result');
  if (sub) sub.textContent = '10개 중 무작위로 정해진 세 이벤트입니다. 이번 게임에 적용할 하나를 선택하세요.';
  if (status) {
    status.textContent = '네 명이 각각 한 표를 행사합니다. 새로고침은 없습니다.';
    status.classList.remove('locked');
  }
  result?.classList.add('hidden');
  $('event-votes')?.replaceChildren();
  if ($('event-winning-name')) $('event-winning-name').textContent = '';
  if ($('event-winning-desc')) $('event-winning-desc').textContent = '';
  const continueButton = $('btn-event-continue');
  if (continueButton) { continueButton.disabled = true; continueButton.onclick = null; }
  return normalizedOffers.length;
}

/**
 * 네 명의 표, 무작위 당첨자, 최종 이벤트를 공개한다.
 * result는 winnerPlayerId/winnerPlayer/winnerIndex 및 eventId/event/winningEvent를 모두 허용한다.
 * @param {object} result `{ votes, winnerPlayerId?, winnerPlayer?, winnerIndex?, eventId?, event? }`
 * @param {Function} onContinue `(event, winnerPlayer) => void`
 */
function showEventVoteResult(result = {}, onContinue) {
  cancelEventVoteReveal();
  const revealSession = eventVoteRevealSession;
  const offers = Array.isArray(result.offers) && result.offers.length
    ? result.offers.filter(Boolean).slice(0, 3) : eventVoteView.offers;
  const players = Array.isArray(result.players) && result.players.length
    ? result.players.filter(Boolean).slice(0, 4) : eventVoteView.players;
  if (offers !== eventVoteView.offers) {
    eventVoteView.offers = offers;
    eventVoteView.keys = offers.map(eventChoiceKey);
    renderEventVoteCards();
  }
  eventVoteView.locked = true;
  showScreen('scr-event');

  const votes = normalizeEventVotes(result.votes, players);
  let winnerPlayer = result.winnerPlayer ?? result.winner ?? null;
  let winnerKey = result.winnerPlayerId ?? result.winningPlayerId ?? null;
  if (winnerPlayer != null) winnerKey = eventPlayerKey(winnerPlayer);
  if (winnerKey == null && Number.isInteger(result.winnerIndex) && players[result.winnerIndex]) {
    winnerPlayer = players[result.winnerIndex];
    winnerKey = eventPlayerKey(winnerPlayer, result.winnerIndex);
  }
  if (winnerKey != null) winnerKey = String(winnerKey);
  if (!winnerPlayer && winnerKey != null) {
    winnerPlayer = players.find((player, index) => eventPlayerKey(player, index) === winnerKey) || null;
  }

  const rawWinningEvent = result.event ?? result.winningEvent ?? result.selectedEvent ?? null;
  let winningKey = eventKeyFromVote(result.eventId ?? result.winningEventId ?? rawWinningEvent, offers);
  if (winningKey == null && winnerKey != null) winningKey = votes.get(winnerKey) ?? null;
  let winningEvent = rawWinningEvent && typeof rawWinningEvent === 'object' ? rawWinningEvent : null;
  if (!winningEvent && winningKey != null) {
    winningEvent = offers.find((choice, index) => eventChoiceKey(choice, index) === winningKey) || null;
  }

  updateEventVote(votes, { replace:true, offers, players, complete:true, silent:true });

  const counts = new Map();
  votes.forEach(eventKey => counts.set(eventKey, (counts.get(eventKey) || 0) + 1));
  document.querySelectorAll('#event-cards .event-card').forEach(card => {
    const count = counts.get(card.dataset.eventId) || 0;
    const selected = card.dataset.eventId === eventVoteView.selectedKey;
    card.disabled = true;
    card.classList.toggle('selected', selected);
    card.classList.remove('winning');
    card.classList.toggle('has-votes', count > 0);
    card.setAttribute('aria-pressed', String(selected));
    const countElement = card.querySelector('.event-vote-count');
    if (countElement) countElement.textContent = `${count}표`;
  });

  const voteList = $('event-votes');
  if (voteList) {
    voteList.replaceChildren();
    const voters = players.length ? players : Array.from(votes.keys()).slice(0, 4).map((id, index) => ({ id, name:`플레이어 ${index + 1}` }));
    voters.slice(0, 4).forEach((rawPlayer, index) => {
      const player = playerSource(rawPlayer), playerKey = eventPlayerKey(rawPlayer, index);
      const choiceKey = votes.get(playerKey), choice = offers.find((item, itemIndex) => eventChoiceKey(item, itemIndex) === choiceKey);
      const row = document.createElement('div');
      row.className = `event-vote-row${playerKey === winnerKey ? ' winner' : ''}`;

      const voter = document.createElement('div'); voter.className = 'event-voter';
      const dot = document.createElement('span'); dot.className = 'event-player-dot';
      if (typeof player.color === 'string') dot.style.backgroundColor = player.color;
      const name = document.createElement('span'); name.className = 'event-player-name'; name.textContent = player.name || `플레이어 ${index + 1}`;
      voter.append(dot, name);
      if (playerKey === winnerKey) {
        const tag = document.createElement('span'); tag.className = 'event-winner-tag'; tag.textContent = '★ 당첨'; voter.appendChild(tag);
      }
      const voted = document.createElement('div'); voted.className = 'event-voted-name';
      voted.textContent = choice ? `선택 · ${eventChoiceCopy(choice).name}` : '선택 정보 없음';
      row.append(voter, voted); voteList.appendChild(row);
    });
  }

  const winningCopy = eventChoiceCopy(winningEvent);
  if ($('event-winning-name')) $('event-winning-name').textContent = winningEvent ? winningCopy.name : '이벤트 결과 없음';
  if ($('event-winning-desc')) $('event-winning-desc').textContent = winningEvent ? winningCopy.desc : '최종 이벤트 정보를 확인할 수 없습니다.';
  const winnerName = playerSource(winnerPlayer).name || '당첨자';
  const status = $('event-status');
  if (status) status.classList.add('locked');
  // 룰렛 연출과 별도 결과 패널 없이, 당첨자를 곧바로 비추고
  // EVENT_RESULT_HOLD_MS 뒤에 증강 선택으로 자동 전환한다.
  $('event-result')?.classList.add('hidden');
  const continueButton = $('btn-event-continue');
  if (continueButton) { continueButton.disabled = true; continueButton.onclick = null; }

  const portraitOrder = players.map((rawPlayer, index) => {
    const key = eventPlayerKey(rawPlayer, index);
    return Array.from(document.querySelectorAll('.event-card-voter')).find(el => el.dataset.playerId === key) || null;
  }).filter(Boolean);
  let winnerIndex = players.findIndex((rawPlayer, index) => eventPlayerKey(rawPlayer, index) === winnerKey);
  if (winnerIndex < 0) winnerIndex = Number.isInteger(result.winnerIndex) ? result.winnerIndex : 0;
  const finalPortrait = portraitOrder[winnerIndex] || portraitOrder[0] || null;
  let continued = false;
  const revealFinal = () => {
    if (revealSession !== eventVoteRevealSession) return;
    portraitOrder.forEach(el => el.classList.remove('spotlight'));
    finalPortrait?.classList.add('winner');
    document.querySelectorAll('#event-cards .event-card').forEach(card => card.classList.toggle('winning', card.dataset.eventId === winningKey));
    if (status) status.textContent = `${winnerName}님의 표가 당첨되어 최종 이벤트가 결정되었습니다.`;
    if (typeof SFX !== 'undefined' && SFX && typeof SFX.tone === 'function') {
      SFX.tone(1040, .16, 'triangle', .13, 260); SFX.tone(1320, .13, 'triangle', .1, 0, .11);
    }
    const vibrationEnabled = typeof Profile === 'undefined' || Profile.data?.vibration !== false;
    if (vibrationEnabled && navigator.vibrate) navigator.vibrate([35, 45, 70]);
    if (typeof onContinue !== 'function') return;
    eventVoteTimer(() => {
      if (continued) return;
      continued = true;
      onContinue(winningEvent, winnerPlayer);
    }, EVENT_RESULT_HOLD_MS, revealSession);
  };
  revealFinal();
  return { event: winningEvent, winnerPlayer, votes, revealSession };
}

/* ---------------- 랭크 / 친선 / 가방 / 도감 ---------------- */
function setRankedSearchState(text = '', searching = false) {
  const status = $('ranked-search-status'), button = $('btn-ranked-match');
  if (status) {
    status.textContent = text || '매칭을 시작할 준비가 되었습니다.';
    status.classList.toggle('searching', !!searching);
  }
  if (button) { button.disabled = !!searching; button.textContent = searching ? '상대 찾는 중…' : '랜덤 매칭'; }
}

function buildFriendlySlots(room, callbacks = {}) {
  const box = $('room-slots'); if (!box) return;
  if ($('room-code')) $('room-code').textContent = room?.code || 'BR-0000';
  box.replaceChildren();
  const max = Math.max(4, room?.maxPlayers || 4), slots = room?.slots || [];
  for (let index = 0; index < max; index++) {
    const slot = slots[index], el = document.createElement('div');
    if (!slot) {
      el.className = 'room-slot empty'; el.innerHTML = `<span>＋ 빈 자리 ${index + 1}</span>`;
      if (callbacks.onAddAI) { el.style.cursor = 'pointer'; el.onclick = () => callbacks.onAddAI(index); }
      box.appendChild(el); continue;
    }
    const ch = CHARACTERS[slot.charId];
    el.className = 'room-slot';
    el.innerHTML = `<div class="slot-avatar"><canvas aria-hidden="true"></canvas></div><div class="slot-info"><div class="slot-name">${esc(slot.name || `플레이어 ${index + 1}`)}${slot.local ? ' <span style="color:#67baff">(나)</span>' : ''}</div><div class="slot-meta">${esc(ch?.name || '캐릭터 미정')} · ${slot.isAI ? 'AI' : '플레이어'}</div></div><button class="ready-pill${slot.ready ? ' on' : ''}" type="button">${slot.ready ? '준비 완료' : '준비 중'}</button>${index > 0 && slot.isAI ? '<button class="slot-remove" type="button" aria-label="참가자 제거">×</button>' : ''}`;
    const ready = el.querySelector('.ready-pill');
    ready.onclick = () => callbacks.onToggleReady?.(index);
    el.querySelector('.slot-remove')?.addEventListener('click', () => callbacks.onRemoveSlot?.(index));
    box.appendChild(el);
    paintPortrait(el.querySelector('canvas'), slot.charId, slot.weaponId, slot.color);
  }
}

function buildBag(selectedCharId, onEquip) {
  const selected = CHARACTERS[selectedCharId] ? selectedCharId : Object.keys(CHARACTERS)[0];
  const ch = CHARACTERS[selected], equipped = $('bag-equipped'), box = $('bag-cards');
  if (equipped) {
    equipped.innerHTML = `<div class="equipped-card"><div class="equipped-portrait"><canvas class="portrait-canvas" aria-hidden="true"></canvas></div><div class="equipped-info"><span class="eyebrow">현재 장착</span><h3>${esc(ch.name)}</h3><p><b style="color:#ffd24d">${esc(ch.skillName)}</b><br>${esc(ch.skillDesc)}</p></div></div>`;
    paintPortrait(equipped.querySelector('canvas'), selected, null, ch.color);
  }
  if (!box) return;
  box.replaceChildren();
  Object.entries(CHARACTERS).forEach(([id, character]) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = `bag-card${id === selected ? ' equipped' : ''}`;
    el.innerHTML = `${id === selected ? '<span class="equip-badge">장착 중</span>' : ''}<canvas aria-hidden="true"></canvas><strong>${esc(character.name)}</strong><small>${esc(character.skillName)}</small>`;
    el.onclick = () => { if (id !== selected) onEquip?.(id); };
    bindLongPress(el, { name:character.name, ico:character.ico, kind:'캐릭터', desc:`${character.skillName} · ${character.skillDesc}` });
    box.appendChild(el); paintPortrait(el.querySelector('canvas'), id, null, character.color);
  });
}

function buildCodex(tab = 'characters') {
  const validTab = ['characters','weapons','augments'].includes(tab) ? tab : 'characters';
  document.querySelectorAll('#codex-tabs .tabbtn').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === validTab);
    button.onclick = () => { playUI(); buildCodex(button.dataset.tab); };
  });
  const box = $('codex-list'); if (!box) return;
  box.replaceChildren();
  let entries;
  if (validTab === 'characters') entries = Object.entries(CHARACTERS).map(([id, v]) => ({ ...v, id, kind:'캐릭터', desc:`${v.skillName} · ${v.skillDesc}` }));
  else if (validTab === 'weapons') entries = Object.entries(WEAPONS).map(([id, v]) => ({ ...v, id, kind:'무기' }));
  else entries = AUGMENTS.filter(a => !a.hidden).map(v => ({ ...v, kind:CAT_TAGS[v.cat] || '증강' }));
  if ($('codex-count')) $('codex-count').textContent = `${entries.length}개`;
  entries.forEach(item => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'codex-card';
    const icon = item.ico || CAT_ICONS[item.cat] || '◆';
    el.innerHTML = `<span class="tag">${esc(item.kind)}</span><div class="codex-ico">${esc(icon)}</div><h3>${esc(item.name)}</h3><p>${esc(item.desc || item.skillDesc || '')}</p>`;
    el.onclick = () => showHoldTooltip(item);
    bindLongPress(el, item);
    box.appendChild(el);
  });
}

/* ---------------- 4인 매치 인트로 ---------------- */
let introInterval = null, introFinishTimer = null;
function showMatchIntro(players, duration = 3000, onDone) {
  clearInterval(introInterval); clearTimeout(introFinishTimer);
  lastIntroPlayers = (players || []).filter(Boolean).slice(0, 4);
  const screen = $('scr-intro'), box = $('intro-players'), count = $('intro-countdown');
  if (!screen || !box) { setTimeout(() => onDone?.(), duration); return; }
  showScreen('scr-intro'); box.replaceChildren();
  lastIntroPlayers.forEach((raw, index) => {
    const p = playerSource(raw), ch = CHARACTERS[p.charId], wp = WEAPONS[p.weaponId];
    const el = document.createElement('div'); el.className = `intro-player${index === 0 || p.local ? ' me' : ''}`; el.style.animationDelay = `${index * 80}ms`;
    el.innerHTML = `<canvas aria-hidden="true"></canvas><div class="intro-info"><strong style="color:${esc(p.color || '#eef3ff')}">${esc(p.name || `플레이어 ${index + 1}`)}${index === 0 ? ' · 나' : ''}</strong><small>${esc(ch?.name || '캐릭터 미정')}${wp ? ` · ${esc(wp.name)}` : ''}</small></div><span>${p.isAI ? 'AI' : 'PLAYER'}</span>`;
    box.appendChild(el); paintPortrait(el.querySelector('canvas'), p.charId, p.weaponId, p.color);
  });
  const seconds = Math.max(1, Math.ceil(duration / 1000)); let remaining = seconds;
  if (count) count.textContent = String(remaining);
  introInterval = setInterval(() => { remaining--; if (count && remaining > 0) count.textContent = String(remaining); }, 1000);
  introFinishTimer = setTimeout(() => {
    clearInterval(introInterval); introInterval = null;
    screen.classList.add('hidden'); onDone?.();
  }, duration);
}

/* ---------------- 플레이어 상세 ---------------- */
function showPlayerDetail(rawPlayer) {
  const p = playerSource(rawPlayer), modal = $('player-modal'), content = $('player-modal-content');
  if (!modal || !content) return;
  const ch = CHARACTERS[p.charId], wp = WEAPONS[p.weaponId];
  const augments = (p.augments || []).map(id => AUG_BY_ID[id]).filter(Boolean);
  $('player-modal-title').textContent = `${p.name || '플레이어'}의 장비`;
  content.innerHTML = `<div class="detail-hero"><canvas aria-hidden="true"></canvas><div><h4 style="color:${esc(p.color || '#eef3ff')}">${esc(p.name || '플레이어')}</h4><p>🪙 ${Math.max(0, p.coins || 0)} · ${p.eliminated ? '탈락' : '생존'}</p></div></div><div class="detail-section"><strong>캐릭터와 무기</strong><div class="detail-item" data-kind="character"><span class="item-ico">${esc(ch?.ico || '●')}</span><span class="item-name">${esc(ch?.name || '미정')}</span><small>${esc(ch?.skillName || '')}</small></div><div class="detail-item" data-kind="weapon"><span class="item-ico">${esc(wp?.ico || '—')}</span><span class="item-name">${esc(wp?.name || '무기 선택 전')}</span><small>${esc(wp?.skillName || '')}</small></div></div><div class="detail-section"><strong>증강 ${augments.length}개 · 길게 눌러 설명 보기</strong><div id="detail-augments">${augments.length ? '' : '<div class="detail-item"><span class="item-name">아직 획득한 증강이 없습니다.</span></div>'}</div></div>`;
  paintPortrait(content.querySelector('canvas'), p.charId, p.weaponId, p.color);
  const characterItem = content.querySelector('[data-kind="character"]');
  if (ch) bindLongPress(characterItem, { name:ch.name, ico:ch.ico, kind:'캐릭터 스킬', desc:`${ch.skillName} · ${ch.skillDesc}` });
  const weaponItem = content.querySelector('[data-kind="weapon"]'); if (wp) bindLongPress(weaponItem, { ...wp, kind:'무기' });
  const augBox = content.querySelector('#detail-augments');
  augments.forEach(augment => {
    const el = document.createElement('div'); el.className = 'detail-item';
    const icon = CAT_ICONS[augment.cat] || '◆';
    el.innerHTML = `<span class="item-ico">${esc(icon)}</span><span class="item-name">${esc(augment.name)}</span><small>${esc(CAT_TAGS[augment.cat] || '')}</small>`;
    bindLongPress(el, augment); augBox.appendChild(el);
  });
  modal.classList.remove('hidden');
}
function closePlayerDetail() { $('player-modal')?.classList.add('hidden'); }

/* ---------------- 결과 / 게임 종료 ---------------- */
function showResult(title, lines, buttonText, onDone) {
  showScreen('scr-result');
  $('result-title').textContent = title;
  const box = $('result-lines'); box.replaceChildren();
  (lines || []).forEach(line => {
    const el = document.createElement('div'); el.className = `rline${line.elim ? ' elim' : ''}`;
    // 전투 결과 HTML은 게임 내부 포매터에서 만들어진 제한된 마크업이다.
    el.innerHTML = line.html || '';
    box.appendChild(el);
  });
  const button = $('btn-next'); button.textContent = buttonText; button.onclick = () => { playUI(); onDone?.(); };
}

function showGameOver(players, human, onRestart) {
  showScreen('scr-over');
  const myRank = human?.rank || 4, champion = myRank === 1;
  $('over-rank').textContent = champion ? '🏆 1위!' : `${myRank}위`;
  $('over-rank').style.color = champion ? '#ffd24d' : '#eef3ff';
  const rating = $('over-rating'), delta = Number(human?.ratingDelta || 0);
  if (rating) rating.textContent = human?.ratingAfter != null ? `레이팅 ${human.ratingAfter} RP  ${delta >= 0 ? '+' : ''}${delta}` : '';
  const box = $('over-content'); box.replaceChildren();
  (players || []).slice().sort((a,b) => (a.rank || 99) - (b.rank || 99)).forEach(p => {
    const ch = CHARACTERS[p.charId], wp = WEAPONS[p.weaponId], el = document.createElement('button');
    el.type = 'button'; el.className = `rankline${p.rank === 1 ? ' first' : ''}${p.eliminated ? ' dead' : ''}`;
    el.innerHTML = `<span class="pos">${p.rank || '-'}위</span><span style="color:${esc(p.color || '#eef3ff')}">${esc(p.name)}${p === human ? ' (나)' : ''}</span><span style="margin-left:auto;color:#8995b6">${esc(ch?.ico || '')}${esc(wp?.ico || '')} · 증강 ${(p.augments || []).length}</span>`;
    el.onclick = () => showPlayerDetail(p); box.appendChild(el);
  });
  $('btn-restart').onclick = () => { playUI(); onRestart?.(); };
}

/* ---------------- 전투 HUD ---------------- */
function updatePlayersPanel(game) {
  const box = $('hud-players'); if (!box) return;
  box.replaceChildren();
  const sorted = (game?.players || []).slice().sort((a,b) => (b.coins || 0) - (a.coins || 0) || (b.wins || 0) - (a.wins || 0) || (a.id || 0) - (b.id || 0));
  sorted.forEach((p, index) => {
    const status = playerStatus(p, game), el = document.createElement('button');
    el.type = 'button'; el.className = `prow${p === game.human ? ' me' : ''}${p.eliminated ? ' dead eliminated' : ''}`;
    el.dataset.playerId = String(p.id);
    el.title = status;
    el.innerHTML = `<div class="portrait"><span class="coin-rank">${index + 1}</span><span class="hud-status">${playerStatusIcon(status)}</span><canvas aria-hidden="true"></canvas></div><div class="hud-name"><span>${esc(p.name)}${p === game.human ? ' · 나' : ''}</span><span class="hud-coins">🪙${Math.max(0,p.coins || 0)}</span></div>`;
    el.onclick = () => showPlayerDetail(p); box.appendChild(el);
    paintPortrait(el.querySelector('canvas'), p.charId, p.weaponId, p.color);
  });
}

function updatePlayerStatuses(game) {
  const rows = Array.from(document.querySelectorAll('#hud-players .prow'));
  for (const p of game?.players || []) {
    const el = rows.find(row => row.dataset.playerId === String(p.id));
    if (!el) continue;
    const status = playerStatus(p, game);
    const icon = el.querySelector('.hud-status');
    if (icon) icon.textContent = playerStatusIcon(status);
    el.title = status;
    el.classList.toggle('dead', status === '탈락' || status === '전투 종료');
    el.classList.toggle('eliminated', status === '탈락');
  }
}

function setHint(text) {
  const el = $('hud-hint'); if (!el) return;
  el.textContent = text || ''; el.classList.toggle('on', !!text);
}
function specTag(text) {
  const el = $('hud-spec'); if (!el) return;
  el.textContent = text || ''; el.classList.toggle('on', !!text);
}
function showViewOtherBattle(visible, onClick, label = '👁 다른 전투 보기') {
  const button = $('btn-watch-other'); if (!button) return;
  button.textContent = label;
  button.classList.toggle('watch-other-on', !!visible);
  button.hidden = !visible;
  button.onclick = visible && typeof onClick === 'function' ? event => { event.preventDefault(); playUI(); onClick(); } : null;
}

function skillSlotInfo(fighter, slot) {
  if (!fighter) return null;
  const weapon = WEAPONS[fighter.weaponId];
  let name, icon, uses = fighter.skillUses?.[slot] || 0, max = 1;
  if (slot === 'char') {
    name = CHARACTERS[fighter.charId]?.skillName || '캐릭터 스킬'; icon = SKILL_ICONS[fighter.charId];
    max += fighter.flags?.talent ? 1 : 0;
  } else if (slot === 'weapon') {
    name = weapon?.skillName || '무기 스킬'; icon = SKILL_ICONS[fighter.weaponId];
    max += fighter.flags?.weaponMastery ? 1 : 0;
  } else {
    const copied = fighter.player?.copiedSkill;
    name = copied ? CHARACTERS[copied]?.skillName : '방향 전환'; icon = copied ? SKILL_ICONS[copied] : SKILL_ICONS.direction;
    max += fighter.flags?.battery ? 1 : 0;
  }
  return { name, icon:icon || '◆', uses, max };
}
function updateSkillbar(battle) {
  const fighter = battle?.human?.() || null;
  const usable = fighter && !fighter.dead && !fighter.mainDead && !(fighter.timers?.stun > 0);
  const canAct = usable && battle.phase === 'fight';
  // 공용 스킬 버튼은 라운드 시작 조준에도 쓰이므로 조준 단계에서도 활성으로 보인다.
  const canAim = usable && battle.phase === 'aim' && !fighter.aimLocked;
  [['char','sk-char'],['weapon','sk-weapon'],['common','sk-common']].forEach(([slot,id]) => {
    const el = $(id); if (!el) return;
    if (!fighter) { el.style.display = 'none'; return; }
    el.style.display = '';
    const info = skillSlotInfo(fighter, slot), charging = slot === 'weapon' && fighter.charging;
    el.querySelector('.lbl').textContent = info.name; el.querySelector('.ico').textContent = info.icon;
    el.querySelector('.uses').textContent = '●'.repeat(Math.max(0, info.uses)) + '○'.repeat(Math.max(0, info.max - info.uses));
    const slotReady = slot === 'common' ? (canAim || (canAct && info.uses > 0)) : (canAct && info.uses > 0);
    el.classList.toggle('charging', !!charging); el.classList.toggle('used', info.uses <= 0 && !canAim); el.classList.toggle('ready', !!(slotReady && !charging));
    if (charging) el.querySelector('.cdoverlay').textContent = fighter.charging.t >= 1 ? '발사 준비!' : '충전 중…';
  });
}

/* ---------------- 정적 UI 이벤트 ---------------- */
$('btn-player-modal-close')?.addEventListener('click', closePlayerDetail);
$('player-modal')?.addEventListener('click', event => { if (event.target === $('player-modal')) closePlayerDetail(); });
$('hold-tooltip')?.addEventListener('pointerdown', hideHoldTooltip);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closePlayerDetail(); hideHoldTooltip(); } });

// classic script 전역 API를 명시해 테스트와 게임 흐름 양쪽에서 안정적으로 사용한다.
Object.assign(window, {
  showScreen, hudVisible, banner, buildCharSelect, buildWeaponSelect, buildAugmentSelect,
  showResult, showGameOver, updatePlayersPanel, setHint, specTag, updateSkillbar,
  updatePlayerStatuses,
  setRankedSearchState, buildFriendlySlots, buildBag, buildCodex, showMatchIntro,
  showPlayerDetail, closePlayerDetail, bindLongPress, showHoldTooltip,
  showViewOtherBattle, setAugmentRefresh, selectionPlayers,
  showEventVote, updateEventVote, showEventVoteResult,
});
