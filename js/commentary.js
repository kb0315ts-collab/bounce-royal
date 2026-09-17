'use strict';
/* A local presentation layer: confirmed facts in, balloons / toy babble out.
 * Audio and mouth cues share one short-lived UI animation clock, not sim time. */
(function (root) {
  const el = id => document.getElementById(id), host = el('commentator');
  if (!host || !root.BounceRoyalCommentaryCore) return;
  const button = el('caster-toggle'), bubble = el('caster-bubble');
  const copy = el('caster-copy'), label = el('caster-label'), badge = el('caster-badge');
  const storeKey = 'bounce-royal-caster-muted-v1';
  const director = new root.BounceRoyalCommentaryCore.Director({ weapons: WEAPONS, characters: CHARACTERS,
    battleTime: typeof BATTLE_TIME !== 'undefined' ? BATTLE_TIME : 40 });
  let muted = false, until = 0, murmurUntil = 0, nextMurmur = 0, lastKey = null;
  let gg = false, finale = false, finalized = false, matchSerial = 0;
  let frame = 0, voiceUntil = 0, nextSyllable = 0, mouthUntil = 0, syllable = 0, script = [];
  let studio = null, studioTimer = 0, report = null, screenId = null;
  try { muted = localStorage.getItem(storeKey) === '1'; } catch (_) { /* Session-only fallback. */ }
  const sound = () => typeof SFX !== 'undefined' ? SFX : null;
  function paintMute() {
    host.classList.toggle('is-muted', muted);
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? '선인장 해설자 입마개 벗기기' : '선인장 해설자 입마개 씌우기. 전체 게임 종료 GG는 유지됩니다.');
    button.title = muted ? '누르면 다시 조잘조잘!' : '누르면 조용히! 최종 GG는 참지 못해요';
    badge.lastChild.textContent = muted ? ' 조용히!' : ' ON AIR';
  }
  function stopVoice() {
    voiceUntil = 0; mouthUntil = 0;
    sound()?.stopChatter?.();
    host.classList.remove('is-syllable', 'is-talking');
  }
  function clearSpeech() {
    until = 0; gg = false;
    stopVoice();
    bubble.hidden = true;
    host.classList.remove('is-gg', 'is-burst');
  }
  function hide() {
    director.observe(null, performance.now());
    clearSpeech();
    cancelAnimationFrame(frame); frame = 0;
    murmurUntil = 0; finale = false;
    host.hidden = true;
    host.classList.remove('is-murmuring', 'is-match-finale', 'is-arena-finale', 'is-studio');
    const hud = el('hud');
    hud?.classList.remove('with-commentator');
    if (hud && host.parentNode !== hud) hud.appendChild(host);
    lastKey = null;
  }
  function animate(now) {
    frame = 0;
    if (document.hidden || host.hidden) { hide(); return; }
    if (until && now >= until) {
      if (finale) { hide(); return; }
      clearSpeech();
    }
    if (now >= murmurUntil) host.classList.remove('is-murmuring');
    // 대사 악보대로 글자마다 한 음절. 마지막 음절은 끝까지 울리게 둔다.
    if (voiceUntil && now < voiceUntil && (syllable < script.length || now < nextSyllable)) {
      if (syllable < script.length && now >= nextSyllable) {
        const step = script[syllable];
        // 화면에 그려지지 않는 선인장은 소리를 내지 않는다 (숨은 화면에 남아 목소리만 들리던 일)
        const shown = typeof host.getClientRects !== 'function' || host.getClientRects().length > 0;
        if ((!muted || gg) && shown) sound()?.chatterSyllable?.({ index:syllable, emphasis:gg,
          vowel:step.vowel, onset:step.onset, tilt:step.tilt });
        mouthUntil = now + 45;
        nextSyllable = now + step.wait;
        syllable++;
      }
      host.classList.toggle('is-syllable', now < mouthUntil);
    } else if (voiceUntil && now >= voiceUntil) stopVoice();
    else if (voiceUntil) { voiceUntil = 0; mouthUntil = 0; host.classList.remove('is-syllable', 'is-talking'); }
    if (until || now < murmurUntil) frame = requestAnimationFrame(animate);
  }
  function wake() { if (!frame) frame = requestAnimationFrame(animate); }
  function murmur(now) {
    if (now < nextMurmur) return;
    nextMurmur = now + 9000; murmurUntil = now + 950;
    host.classList.add('is-murmuring');
    // This visual joke stays silent: clicking the gag is an audio opt-out.
    wake();
  }
  function speak(line, now) {
    clearSpeech();
    gg = !!line.gg;
    label.textContent = line.label || 'COSMIC LIVE';
    copy.replaceChildren();
    const text = gg ? String(line.text || '').replace(/^GG~~!\s*/, '') : String(line.text || '');
    const name = line.actor && String(line.actor.name || ''), at = name ? text.indexOf(name) : -1;
    const mark = document.createElement('strong'); mark.textContent = name;
    if (name && /^#[0-9a-f]{6}$/i.test(line.actor.color || '')) mark.style.setProperty('--player-color', line.actor.color);
    if (at >= 0) {
      copy.append(document.createTextNode(text.slice(0, at)));
      copy.append(mark, document.createTextNode(text.slice(at + name.length)));
    } else if (name && !gg) {
      // 이름이 없는 짧은 대사('정확히 들어갔어요.')도 누구 이야기인지 보이게 이름표를 단다
      mark.className = 'caster-who';
      copy.append(mark, document.createTextNode(text));
    } else copy.textContent = text;
    bubble.hidden = false;
    host.classList.add('is-talking');
    host.classList.toggle('is-gg', gg);
    host.classList.toggle('is-burst', gg && muted);
    host.classList.remove('is-murmuring');
    until = now + root.BounceRoyalCommentaryCore.displayMs(text, gg);
    // The cloth splits before the final voice starts.
    nextSyllable = now + (gg && muted ? 220 : 0);
    script = root.BounceRoyalBroadcastCore.voiceScript(text);
    voiceUntil = nextSyllable + root.BounceRoyalBroadcastCore.voiceDuration(text);
    syllable = 0;
    wake();
  }
  function observe(b) {
    if (studio || b?.isReplay) return;
    if (finale) return;
    const hud = el('hud');
    if (!b || b.demo || document.hidden || !hud || hud.classList.contains('hidden')) { hide(); return; }
    /* 증강·이벤트 화면은 선인장을 그 화면 칸으로 데려간다. 다음 라운드는 showScreen(null)로
     * 시작해 hide()를 거치지 않아서, 선인장이 숨은 증강 화면에 남은 채 말만 했다.
     * 전투를 해설하는 동안에는 늘 전투 화면에 있게 한다. */
    if (host.parentNode !== hud) hide();
    const now = performance.now();
    if (b.result && b.matchConclusion) {
      if (!finalized) showFinale(director.decideMatch(b.matchConclusion, now, matchSerial), now, true);
      return;
    }
    const key = (b.soundSource || 'local') + ':' + b.soundId + ':' + b.fighters.map(f => f.uid).join(',');
    if (key !== lastKey) { clearSpeech(); lastKey = key; }
    const line = director.observe(b, now);
    // 카운트다운부터 자리를 지킨다. 대사는 전투가 시작돼야 나온다(감독이 count에서는 말하지 않는다).
    host.hidden = false; hud.classList.add('with-commentator');
    if (!line) return;
    if (muted) { murmur(now); return; }
    speak(line, now);
  }
  function onScreen(id) {
    if (id === screenId && (id === 'scr-augment' || id === 'scr-event')) return;
    screenId = id;
    clearTimeout(studioTimer); studioTimer = 0; studio = null;
    if (id === 'scr-intro' || id === 'scr-weapon') {
      finalized = false; matchSerial++; report = null;
      root.BounceRoyalHighlights?.reset();
    }
    if (id === 'scr-title') { report = null; root.BounceRoyalHighlights?.reset(); }
    if (id === 'scr-over') host.classList.remove('is-arena-finale');
    if (id === 'scr-replay' && finale) return;
    if (id && id !== 'scr-over') hide();
    if (id === 'scr-augment') studioLines(root.BounceRoyalBroadcastCore.recapLines(report, WEAPONS, CHARACTERS), '지난 전투 돌아보기', 'augment-caster-dock');
    if (id === 'scr-event') studioLines(root.BounceRoyalBroadcastCore.eventIntro(root.Game?.round || 0), '이벤트 투표 타임', 'event-caster-dock');
  }
  function rememberReport(rows, playerId) {
    report = rows && Object.prototype.hasOwnProperty.call(rows, playerId) ? rows[playerId] : null;
  }
  function studioLines(lines, title, dockId, silentFirst = false) {
    clearTimeout(studioTimer); hide();
    studio = { lines, title, dockId, index:0 };
    const dock = el(dockId);
    if (!dock) { studio=null; return; }
    dock.appendChild(host); host.hidden=false; host.classList.add('is-studio');
    const next = () => {
      if (!studio || document.hidden) return;
      const text = studio.lines[studio.index++];
      if (text && !muted) {
        speak({text,label:studio.title},performance.now());
        if (silentFirst) { stopVoice(); silentFirst = false; }
        // Keep the text readable after the short babble has stopped.
        until = performance.now()+Math.min(6500,Math.max(4000,text.length*75));
      } else if (muted) murmur(performance.now());
      if(studio.index<studio.lines.length)studioTimer=setTimeout(next,6800);
    };
    next();
  }
  function eventResult(event, player) {
    studioLines(root.BounceRoyalBroadcastCore.eventWinner(event,player), '이번 게임의 이벤트', 'event-caster-dock');
  }
  function finishMatch(players) {
    if (finalized) return;
    const now = performance.now(), line = director.finishMatch(players, now, matchSerial);
    showFinale(line, now);
  }
  function showFinale(line, now, arena = false) {
    if (!line) return;
    finalized = true;
    if (document.hidden) return;
    hide();
    finale = true;
    el('app').appendChild(host);
    host.hidden = false; host.classList.add('is-match-finale');
    host.classList.toggle('is-arena-finale', arena);
    speak(line, now);
  }
  function hideForHud() { if (!finale && !studio) hide(); }
  button.addEventListener('click', event => {
    event.stopPropagation(); muted = !muted;
    try { localStorage.setItem(storeKey, muted ? '1' : '0'); } catch (_) { /* Session-only fallback. */ }
    paintMute();
    if (gg) host.classList.toggle('is-burst', muted);
    if (!gg) clearSpeech();
    if (muted && !gg) { nextMurmur = 0; murmur(performance.now()); }
    if (!muted) host.classList.remove('is-murmuring', 'is-burst');
    if (!muted && studio) {
      const current=studio;
      studioLines(current.lines.slice(Math.max(0,current.index-1)),current.title,current.dockId);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(studioTimer); hide(); }
    else if (studio) {
      const current=studio;
      studioLines(current.lines.slice(Math.max(0,current.index-1)),current.title,current.dockId,true);
    }
  });
  paintMute();
  root.BounceRoyalCommentary = Object.freeze({ observe, hide, hideForHud, onScreen, finishMatch, rememberReport,
    eventResult, studioLines, remainingFinale:()=>finale?Math.max(0,until-performance.now()):0,
    get muted() { return muted; } });
})(globalThis);
