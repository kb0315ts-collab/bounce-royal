'use strict';
/* ============================================================
 * 바운스 로얄 — 솔로 로그라이크 화면 흐름
 *
 * 로비 → 무기 선택 → 곧장 W1 전투 → 보상(증강 1~2회 또는 기본 스탯) → 다음 웨이브 …
 * → W20 챔피언을 쓰러뜨리면 클리어. 한 번이라도 지면 런이 끝난다.
 *
 * 다음에 무엇이 나오는지는 미리 알려 주지 않는다 — 웨이브 목록도, 적 구성도 보여 주지 않고
 * 들어가서 만난다. 선택형 웨이브에서만 약한/보통/강한 적 중 무엇과 겨룰지 고른다.
 * 웨이브 사이에서 저장되어 이어할 수 있다.
 *
 * 규칙은 js/rogue-sim.js, 그림은 js/rogue-render.js. 여기서는 DOM과 진행만 맡는다.
 * 전투 루프는 main.js의 Game.update가 mode === 'rogue'일 때 이리로 넘긴다.
 * ============================================================ */
(function (root) {
  const R = root.BounceRoyalRogueSim;
  if (!R) return;
  const RUN_KEY = 'bounce-royale-rogue-run-v1';
  const RECORD_KEY = 'bounce-royale-rogue-record-v1';
  const DEV = /[?&](rogueDev|dev)=1\b/.test(location.search);
  const $$ = id => document.getElementById(id);
  const KIND_LABEL = ROGUE_WAVE_KIND_LABEL;
  const MEET_LABEL = ['1차전', '2차전', '3차전', '최종전'];

  /* ---------------- 저장 ---------------- */
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 저장 불가 환경 */ } },
    del(key) { try { localStorage.removeItem(key); } catch (_) { /* 무시 */ } },
  };
  function record() {
    const r = store.get(RECORD_KEY) || {};
    return { best: Math.max(0, Number(r.best) || 0), clears: Math.max(0, Number(r.clears) || 0), runs: Math.max(0, Number(r.runs) || 0) };
  }
  function saveRecord(patch) { store.set(RECORD_KEY, { ...record(), ...patch }); }

  /* ---------------- 작은 그림 ---------------- */
  const PAUSE_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="8" y="7" width="5.5" height="18" rx="1.6" fill="currentColor"/><rect x="18.5" y="7" width="5.5" height="18" rx="1.6" fill="currentColor"/></svg>';
  const chipCanvas = (cls = '') => `<canvas class="rogue-face ${cls}" aria-hidden="true"></canvas>`;

  function statLine(p) {
    const pct = v => Math.round(((v || 1) - 1) * 100);
    const bits = [];
    if (pct(p.bonusAtk)) bits.push(`공격력 +${pct(p.bonusAtk)}%`);
    if (pct(p.bonusAspd)) bits.push(`공격속도 +${pct(p.bonusAspd)}%`);
    if (pct(p.bonusMove)) bits.push(`이동속도 +${pct(p.bonusMove)}%`);
    return bits.join(' · ');
  }

  /* ═══════════ 컨트롤러 ═══════════ */
  const Rogue = {
    run: null, battle: null, paused: false, ending: false, lastFoeKey: '', resultShown: false,

    /* ---------- 로비 ---------- */
    openLobby() {
      SFX.ensure(); SFX.ui();
      this.stopBattle();
      Game.mode = 'single'; Game.state = 'rogue';
      showScreen('scr-rogue');
      const saved = R.restoreRun(store.get(RUN_KEY));
      const rec = record();
      $$('rogue-best').textContent = rec.best ? (rec.clears ? `클리어 ${rec.clears}회` : `최고 W${rec.best}`) : '';
      const ch = CHARACTERS[Profile.data.equippedChar];
      const hero = $$('rogue-lobby-hero');
      hero.innerHTML = `<div class="rogue-hero-portrait">${chipCanvas('big')}</div><div class="rogue-hero-copy"><span class="eyebrow">출전 캐릭터</span><h3>${esc(ch.name)}</h3><p><b>${esc(ch.skillName)}</b> · ${esc(ch.skillDesc)}</p><small>가방에서 바꿀 수 있어요. 무기는 출발할 때 셋 중 하나를 고릅니다.</small></div>`;
      paintPortrait(hero.querySelector('canvas'), Profile.data.equippedChar, null, '#4da6ff');
      const cont = $$('btn-rogue-continue');
      cont.classList.toggle('hidden', !saved);
      if (saved) cont.innerHTML = `이어하기 <small>W${saved.wave} · ${esc(CHARACTERS[saved.player.charId].name)} · ${esc(WEAPONS[saved.player.weaponId].name)}</small>`;
      $$('btn-rogue-new').textContent = saved ? '새 런 시작 (진행 중인 런은 사라짐)' : '새 런 시작';
      const dev = $$('rogue-dev');
      dev.classList.toggle('hidden', !DEV);
      if (DEV && !dev.dataset.ready) {
        dev.dataset.ready = '1';
        const sel = $$('rogue-dev-wave');
        sel.innerHTML = ROGUE_WAVES.map(w => `<option value="${w.n}">W${w.n} · ${esc(w.title)}</option>`).join('');
      }
    },

    startNew(devWave = 0) {
      SFX.ui();
      store.del(RUN_KEY);
      Game.state = 'rogue';
      showScreen('scr-weapon');
      stopPhaseTimer();
      const offers = shuffle(Object.keys(WEAPONS)).slice(0, 3);
      buildWeaponSelect(offers, weaponId => {
        const run = R.newRun({ name: Profile.data.nickname, charId: Profile.data.equippedChar, weaponId, color: '#4da6ff' });
        if (devWave > 1) R.fastForward(run, devWave);
        this.run = run;
        saveRecord({ runs: record().runs + 1 });
        this.save();
        setTimeout(() => this.nextWave(), 250);
      });
      selectionPlayers([]);
      const sub = document.querySelector('#scr-weapon .subt');
      if (sub) sub.textContent = '이번 런 내내 쓸 무기입니다. 무기 전용 증강도 이 무기에 맞춰 나옵니다.';
    },

    continueRun() {
      const run = R.restoreRun(store.get(RUN_KEY));
      if (!run) { this.openLobby(); return; }
      SFX.ui();
      this.run = run;
      if (run.pendingReward) this.giveReward(run.pendingReward);
      else this.nextWave();
    },

    save() { if (this.run && this.run.status === 'active') store.set(RUN_KEY, this.run); },

    /* ---------- 다음 웨이브 ---------- */
    /* 선택형이면 난이도만 고르게 하고, 나머지는 곧바로 전투로 들어간다.
     * 어떤 적이 기다리는지는 들어가서 본다 — 그게 이 모드의 재미다. */
    nextWave() {
      const run = this.run;
      if (!run) return this.openLobby();
      this.save();
      if (R.waveDef(run.wave).kind === 'choice') { this.showChoice(); return; }
      run.choice = null;
      this.startWave();
    },

    showChoice() {
      const run = this.run;
      const wave = R.waveDef(run.wave);
      this.stopBattle();
      Game.mode = 'single'; Game.state = 'rogue';
      run.choice = null;
      showScreen('scr-rogue-map');
      $$('rogue-map-title').textContent = `WAVE ${wave.n}`;
      $$('rogue-map-extra').textContent = `증강 ${run.player.augments.length}`;
      const box = $$('rogue-choices');
      box.replaceChildren();
      for (const [i, tier] of ROGUE_CHOICE_ORDER.entries()) {
        const meta = ROGUE_CHOICE_TIERS[tier];
        const card = document.createElement('button');
        card.type = 'button'; card.className = `card rogue-choice ${tier}`;
        // 증강 선택과 같은 카드 모양 — 위험도 점 · 이름 · 분류 · 보상
        card.innerHTML = `<div class="art"><span class="rogue-pips">${'●'.repeat(i + 1)}</span></div>`
          + `<div class="head"><span class="nm">${esc(meta.label)}</span></div>`
          + `<span class="tag">${esc(meta.risk)}</span>`
          + `<div class="desc">${esc(meta.reward)}</div>`;
        card.onclick = () => {
          if (run.choice) return;
          playUI();
          run.choice = tier;
          box.querySelectorAll('.rogue-choice').forEach(el => el.classList.toggle('picked', el === card));
          this.save();
          setTimeout(() => this.startWave(), 220);
        };
        box.appendChild(card);
      }
      this.save();
      if (typeof BounceRoyalCommentary !== 'undefined') {
        BounceRoyalCommentary.studioLines(['세 갈래 중 하나를 고르세요. 강할수록 보상이 큽니다.',
          '약한 쪽은 기본 스탯, 보통은 증강 하나, 강한 쪽은 증강 둘입니다.'], '갈림길', 'rogue-caster-dock');
      }
    },

    /* ---------- 전투 ---------- */
    startWave() {
      const run = this.run;
      if (!run) return;
      const wave = R.waveDef(run.wave);
      if (wave.kind === 'choice' && !run.choice) return;
      SFX.ensure(); SFX.coin();
      this.battle = R.createWaveBattle(run, { tier: run.choice });
      this.paused = false; this.ending = false; this.resultShown = false; this.lastFoeKey = '';
      this.startedAt = performance.now();
      Game.mode = 'rogue'; Game.state = 'rogueBattle'; Game.focus = this.battle; Game.battles = null;
      showScreen(null);
      hudVisible(true);
      $$('hud')?.classList.add('rogue-mode');
      $$('rogue-hud')?.classList.remove('hidden');
      const kind = wave.kind === 'rival' ? `라이벌전 · ${MEET_LABEL[wave.meet - 1]}` : wave.kind === 'choice' ? `선택형 · ${ROGUE_CHOICE_TIERS[run.choice].label}` : KIND_LABEL[wave.kind];
      $$('rogue-hud-wave').textContent = `WAVE ${wave.n}`;
      $$('rogue-hud-kind').textContent = kind;
      $$('hud-round').textContent = `WAVE ${wave.n} / ${ROGUE_WAVE_COUNT}`;
      $$('hud-map').textContent = kind;
      $$('hud-timer').classList.add('waiting');
      const boss = this.battle.fighters.find(f => f.boss);
      $$('rogue-bossbar').classList.toggle('hidden', !boss);
      $$('hud')?.classList.toggle('rogue-boss', !!boss);
      if (boss) {
        $$('rogue-boss-name').textContent = boss.monster.name;
        $$('rogue-bossbar').classList.toggle('current', boss.mtype === 'current');
      }
      setWatchOtherButton(false); specTag(null); setHint(null);
      const title = wave.kind === 'rival' ? `VS ${run.rival.name}` : wave.kind === 'boss' ? ROGUE_MONSTERS[wave.boss].short : `WAVE ${wave.n}`;
      banner(title, wave.kind === 'choice' ? wave.options[run.choice].title : wave.title.replace(/^.*— /, ''), 1500);
      SFX.play && SFX.play('rogue.wave.start');
      this.save();
    },

    stopBattle() {
      if (this.battle) { this.battle = null; }
      this.paused = false;
      $$('rogue-pause')?.classList.add('hidden');
      $$('hud')?.classList.remove('rogue-mode', 'rogue-boss');
      $$('rogue-hud')?.classList.add('hidden');
      $$('rogue-bossbar')?.classList.add('hidden');
      $$('hud-timer')?.classList.remove('waiting');
      if (Game.mode === 'rogue') { Game.mode = 'single'; Game.focus = null; }
      if (typeof window.BounceRoyalClearSteerInput === 'function') window.BounceRoyalClearSteerInput();
    },

    update(dt) {
      const b = this.battle;
      if (!b) { renderBattle(null); return; }
      // 멈춘 동안에는 장면이 마지막 판을 계속 그린다. renderBattle을 건너뛰어 선인장도 같이 멈춘다.
      if (!this.paused) { b.update(dt); renderBattle(b); }
      this.paintHud(b);
      updateSkillbar(this.paused ? null : b);
      updateCountdown(b);
      if (b.phase === 'fight' && !this.bannerFight) { this.bannerFight = true; banner('FIGHT!', '', 650); }
      if (b.phase === 'count') this.bannerFight = false;
      if (b.result && !this.resultShown) {
        this.resultShown = true;
        const won = b.result.winner === b.rogueHero;
        const wave = b.rogueWave;
        if (won) {
          banner(wave.n >= ROGUE_WAVE_COUNT ? '챔피언 격파!' : wave.kind === 'boss' ? '보스 격파!' : wave.kind === 'rival' ? (wave.meet === 1 ? '첫 대결 승리!' : '라이벌 격파!') : `WAVE ${wave.n} 클리어`, '', 1500);
          SFX.play && SFX.play(wave.n >= ROGUE_WAVE_COUNT ? 'rogue.run.clear' : 'rogue.wave.clear');
        } else {
          banner('쓰러졌습니다…', `WAVE ${wave.n}`, 1600);
          SFX.play && SFX.play('rogue.run.fail');
        }
      }
      if (b.finished && !this.ending) {
        this.ending = true;
        setTimeout(() => { if (this.battle === b) this.endWave(); }, 650);
      }
    },

    paintHud(b) {
      const foes = b.fighters.filter(f => f !== b.rogueHero);
      const alive = foes.filter(f => b.fighterAlive(f));
      $$('hud-timer').textContent = `남은 적 ${alive.length}`;
      // 남은 적 칩은 종류·수가 바뀔 때만 다시 그린다
      const counts = new Map();
      for (const f of alive) {
        const key = f.monster ? f.mtype : 'rival';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const key = [...counts].map(([k, n]) => k + n).join('|');
      if (key !== this.lastFoeKey) {
        this.lastFoeKey = key;
        const box = $$('rogue-hud-foes');
        box.replaceChildren();
        for (const [type, n] of counts) {
          const chip = document.createElement('span');
          chip.className = 'rogue-foe-chip';
          chip.innerHTML = `${chipCanvas()}<b>${n > 1 ? '×' + n : ''}</b>`;
          box.appendChild(chip);
          const canvas = chip.querySelector('canvas');
          if (type === 'rival') { const rv = this.run.rival; paintPortrait(canvas, rv.charId, rv.weaponId, rv.color); }
          else paintMonsterPortrait(canvas, type);
        }
      }
      const boss = foes.find(f => f.boss);
      if (boss) {
        const ratio = Math.max(0, boss.hp / boss.maxHp);
        $$('rogue-boss-fill').style.width = (ratio * 100).toFixed(2) + '%';
        $$('rogue-bossbar').classList.toggle('phase2', boss.ai.phase === 2);
      }
    },

    pause(on = !this.paused) {
      if (!this.battle || this.battle.result) return;
      this.paused = !!on;
      $$('rogue-pause').classList.toggle('hidden', !this.paused);
      if (this.paused) {
        if (typeof window.BounceRoyalClearSteerInput === 'function') window.BounceRoyalClearSteerInput();
        const h = this.battle.human && this.battle.human();
        if (h) setFlameInput(h, false);
        const w = this.battle.rogueWave;
        const left = this.battle.fighters.filter(f => f !== this.battle.rogueHero && this.battle.fighterAlive(f)).length;
        $$('rogue-pause-info').textContent = `WAVE ${w.n} · 남은 적 ${left}`;
      }
      SFX.ui();
    },

    giveUp() {
      if (!this.run) return;
      const b = this.battle;
      this.paused = false;
      $$('rogue-pause').classList.add('hidden');
      if (b && !b.result) b.finish(b.fighters.find(f => f !== b.rogueHero) || null, '포기');
      else if (!b) { this.run.status = 'dead'; this.run.history.push({ wave: this.run.wave, kind: R.waveDef(this.run.wave).kind, won: false, time: 0, hpLeft: 0, kills: 0, gaveUp: true }); this.showOver(); }
    },

    endWave() {
      const b = this.battle, run = this.run;
      if (!b || !run) return;
      const res = R.finishWave(run, b);
      if (typeof BounceRoyalCommentary !== 'undefined') BounceRoyalCommentary.rememberReport(b.roundReport || {}, run.player.id);
      this.stopBattle();
      hudVisible(false);
      if (!res.won || res.cleared) { this.showOver(); return; }
      run.refreshes++;
      this.save();
      this.giveReward(run.pendingReward);
    },

    /* ---------- 보상 ---------- */
    giveReward(reward) {
      const run = this.run;
      Game.state = 'rogue';
      if (!reward) { R.advance(run); this.save(); this.nextWave(); return; }
      if (reward.kind === 'stat') { this.statReward(); return; }
      const left = reward.left || 1, total = reward.picks || 1;
      const offers = R.rollOffers(run);
      const header = document.querySelector('#scr-augment .screen-head h2');
      if (header) header.textContent = '증강 선택';
      showScreen('scr-augment');
      const finishPick = aug => {
        R.pickAugment(run, aug);
        SFX.coin();
        run.pendingReward.left = left - 1;
        if (run.pendingReward.left > 0) { this.save(); setTimeout(() => this.giveReward(run.pendingReward), 160); return; }
        R.advance(run); this.save();
        setTimeout(() => this.nextWave(), 200);
      };
      const refresh = () => {
        if (run.refreshes <= 0) return;
        run.refreshes--;
        this.save();
        SFX.ui();
        this.paintAugments(R.rollOffers(run), left, total, finishPick, refresh);
      };
      this.paintAugments(offers, left, total, finishPick, refresh);
      if (left === total) this.caster(this.rewardLines('augment'));
    },
    paintAugments(offers, left, total, onPick, onRefresh) {
      const run = this.run;
      const n = total - left + 1;
      const sub = total > 1 ? `강한 적 보상 · ${n}/${total}번째 증강을 고릅니다.` : `WAVE ${run.history[run.history.length - 1].wave} 클리어 · 새로운 증강 하나를 획득합니다.`;
      buildAugmentSelect(offers, run.player, onPick, sub, { refreshes: run.refreshes, onRefresh, players: [] });
      selectionPlayers([]);
      stopPhaseTimer();
      $$('aug-round-label').textContent = `WAVE ${run.history[run.history.length - 1].wave}`;
      const p = run.player;
      $$('aug-myinfo').innerHTML = `<span>${esc(CHARACTERS[p.charId].name)}</span><i>·</i><span>${esc(WEAPONS[p.weaponId].name)}</span><i>·</i><span>다음 W${Math.min(ROGUE_WAVE_COUNT, run.wave + 1)}</span>`;
      document.querySelector('#scr-augment #aug-meta')?.classList.remove('hidden');
    },
    statReward() {
      const run = this.run;
      const header = document.querySelector('#scr-augment .screen-head h2');
      if (header) header.textContent = '기본 스탯 선택';
      showScreen('scr-augment');
      const icons = { atk: 'atk15', aspd: 'rot15', move: 'move15' };
      const items = ROGUE_STAT_REWARDS.map(r => ({ id: icons[r.id], statId: r.id, cat: 'stat', name: r.name, desc: r.desc }));
      buildAugmentSelect(items, run.player, item => {
        R.applyStatReward(run, item.statId);
        SFX.coin();
        R.advance(run); this.save();
        if (header) setTimeout(() => { header.textContent = '증강 선택'; }, 400);
        setTimeout(() => this.nextWave(), 200);
      }, `약한 적 보상 · 기본 스탯 하나를 10% 올립니다. ${statLine(run.player) ? '지금 ' + statLine(run.player) : ''}`, { refreshes: 0, onRefresh: null, players: [] });
      selectionPlayers([]);
      stopPhaseTimer();
      $$('aug-round-label').textContent = `WAVE ${run.history[run.history.length - 1].wave}`;
      setAugmentRefresh(0, null);
      document.querySelector('#scr-augment #aug-meta')?.classList.add('hidden');
      this.caster(this.rewardLines('stat'));
    },

    // 보상 화면의 선인장 — 아레나의 '지난 전투 돌아보기' 대신 방금 웨이브와 다음 웨이브를 한 줄씩 말한다
    caster(lines) {
      if (typeof BounceRoyalCommentary !== 'undefined') BounceRoyalCommentary.studioLines(lines, '보상 시간', 'augment-caster-dock');
    },
    rewardLines(kind) {
      const run = this.run, rv = run.rival;
      const last = run.history[run.history.length - 1];
      const done = R.waveDef(last.wave), next = R.waveDef(Math.min(ROGUE_WAVE_COUNT, last.wave + 1));
      let first;
      if (done.kind === 'rival') first = done.meet === 1 ? `첫 대결은 가져왔습니다. ${rv.name} 선수, 또 보게 될 것 같네요.` : `${rv.name} 선수를 또 넘었습니다.`;
      else if (done.kind === 'boss') first = '노장을 넘었습니다. 이제 후반전이에요.';
      else if (kind === 'stat') first = '약한 쪽을 골랐으니 기본기를 챙기죠. 하나를 10% 올립니다.';
      else if (last.tier === 'strong') first = '강한 쪽을 넘긴 보상, 증강을 두 번 고릅니다.';
      else first = last.hpLeft >= 70 ? '여유 있게 정리했네요.' : last.hpLeft <= 25 ? '아슬아슬했습니다. 버티는 증강도 괜찮겠어요.' : '웨이브 정리 끝. 증강을 고를 시간입니다.';
      // 다음 상대가 누구인지는 말하지 않는다. 갈림길만 미리 일러 준다.
      const then = next.kind === 'choice' ? '다음은 갈림길입니다. 누구와 겨룰지 고르세요.'
        : `골랐으면 바로 W${next.n}으로 들어갑니다.`;
      return [first, then];
    },

    /* ---------- 끝 ---------- */
    showOver() {
      const run = this.run;
      if (!run) return this.openLobby();
      store.del(RUN_KEY);
      Game.mode = 'single'; Game.state = 'rogue';
      const cleared = run.status === 'cleared';
      const last = run.history[run.history.length - 1] || { wave: run.wave };
      const reached = cleared ? ROGUE_WAVE_COUNT + 1 : last.wave;
      const rec = record();
      saveRecord({ best: Math.max(rec.best, reached), clears: rec.clears + (cleared ? 1 : 0) });
      showScreen('scr-rogue-over');
      $$('rogue-over-title').textContent = cleared ? '챔피언 등극!' : '런 종료';
      const p = run.player;
      const lastWave = R.waveDef(last.wave);
      const cause = cleared ? '20웨이브를 모두 넘었습니다. 새로운 아레나 챔피언입니다!'
        : last.gaveUp ? `WAVE ${last.wave}에서 런을 포기했습니다.`
          : lastWave.kind === 'rival' ? `WAVE ${last.wave}, ${lastWave.meet > 1 ? '라이벌 ' : ''}${run.rival.name}에게 졌습니다.`
            : lastWave.kind === 'boss' ? `WAVE ${last.wave}, ${ROGUE_MONSTERS[lastWave.boss].name}에게 졌습니다.`
              : `WAVE ${last.wave}에서 쓰러졌습니다.`;
      const hero = $$('rogue-over-hero');
      hero.className = 'rogue-over-hero' + (cleared ? ' cleared' : '');
      hero.innerHTML = `${chipCanvas('big')}<div><strong>${cleared ? 'CLEAR' : `W${last.wave}`}</strong><span>${esc(cause)}</span><em>${esc(CHARACTERS[p.charId].name)} · ${esc(WEAPONS[p.weaponId].name)} · 증강 ${p.augments.length}개${statLine(p) ? ' · ' + esc(statLine(p)) : ''}</em></div>`;
      paintPortrait(hero.querySelector('canvas'), p.charId, p.weaponId, p.color);
      const played = run.history.filter(h => !h.skipped);
      const kills = played.reduce((s, h) => s + (h.kills || 0), 0);
      const time = played.reduce((s, h) => s + (h.time || 0), 0);
      const best = Math.max(record().best, reached);
      $$('rogue-over-stats').innerHTML = `<div><b>${cleared ? 20 : Math.max(0, last.wave - 1)}</b><span>넘은 웨이브</span></div><div><b>${kills}</b><span>쓰러뜨린 적</span></div><div><b>${Math.floor(time / 60)}:${String(Math.round(time % 60)).padStart(2, '0')}</b><span>전투 시간</span></div><div><b>${best > ROGUE_WAVE_COUNT ? 'CLEAR' : 'W' + best}</b><span>최고 기록</span></div>`;
      if (cleared) {
        SFX.win();
        if (typeof BounceRoyalCommentary !== 'undefined' && BounceRoyalCommentary.rogueFinale) BounceRoyalCommentary.rogueFinale(p);
      } else SFX.lose();
      this.run = null;
    },

    close() { this.stopBattle(); this.run = null; Game.returnToTitle(); },
  };

  /* ---------------- 버튼 ---------------- */
  const on = (id, fn) => { const el = $$(id); if (el) el.onclick = fn; };
  on('btn-rogue', () => Rogue.openLobby());
  on('btn-rogue-back', () => { SFX.ui(); Rogue.close(); });
  on('btn-rogue-new', () => Rogue.startNew());
  on('btn-rogue-continue', () => Rogue.continueRun());
  on('btn-rogue-dev', () => Rogue.startNew(Number($$('rogue-dev-wave').value) || 1));
  /* 되돌릴 수 없는 버튼은 두 번 눌러야 한다. 브라우저 confirm 창 대신 버튼 글자가 바뀌고 3초 뒤 돌아온다. */
  function twoTap(id, sure, act) {
    const btn = $$(id);
    if (!btn) return;
    let armed = 0, label = btn.textContent;
    const reset = () => { armed = 0; btn.textContent = label; btn.classList.remove('armed'); };
    btn.addEventListener('click', () => {
      SFX.ui();
      if (armed) { clearTimeout(armed); reset(); act(); return; }
      label = btn.textContent;
      btn.textContent = sure; btn.classList.add('armed');
      armed = setTimeout(reset, 3000);
    });
  }
  on('btn-rogue-map-home', () => { SFX.ui(); Rogue.save(); Rogue.close(); });
  on('btn-rogue-again', () => { SFX.ui(); Rogue.openLobby(); });
  on('btn-rogue-title', () => { SFX.ui(); Rogue.close(); });
  on('btn-rogue-pause', () => Rogue.pause(true));
  on('btn-rogue-resume', () => Rogue.pause(false));
  twoTap('btn-rogue-giveup', '한 번 더 누르면 포기', () => Rogue.giveUp());
  const pauseBtn = $$('btn-rogue-pause');
  if (pauseBtn) pauseBtn.innerHTML = PAUSE_ICON;
  window.addEventListener('keydown', e => {
    if (Game.state !== 'rogueBattle') return;
    if (e.key === 'Escape' || e.code === 'KeyP') { e.preventDefault(); Rogue.pause(); }
  });
  // 탭을 숨기면 전투를 멈춘다 — 돌아와서 계속을 누른다
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Game.state === 'rogueBattle' && Rogue.battle && !Rogue.battle.result && !Rogue.paused) Rogue.pause(true);
  });

  root.BounceRoyalRogue = Rogue;
})(globalThis);
