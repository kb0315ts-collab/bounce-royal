'use strict';
/* A local presentation layer: confirmed facts in, balloons / toy babble out.
 * Audio and mouth cues share one short-lived UI animation clock, not sim time. */
(function (root) {
  const el = id => document.getElementById(id), host = el('commentator');
  if (!host || !root.BounceRoyalCommentaryCore) return;
  const button = el('caster-toggle'), bubble = el('caster-bubble');
  const copy = el('caster-copy'), label = el('caster-label'), badge = el('caster-badge');
  const storeKey = 'bounce-royal-caster-muted-v1';
  const director = new root.BounceRoyalCommentaryCore.Director({ weapons: WEAPONS, characters: CHARACTERS });
  let muted = false, until = 0, murmurUntil = 0, nextMurmur = 0, lastKey = null;
  let gg = false, finale = false, finalized = false, matchSerial = 0;
  let frame = 0, voiceUntil = 0, nextSyllable = 0, mouthUntil = 0, syllable = 0;
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
    host.classList.remove('is-murmuring', 'is-match-finale');
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
    if (voiceUntil && now < voiceUntil) {
      if (now >= nextSyllable) {
        if (!muted || gg) sound()?.chatterSyllable?.({ index:syllable, emphasis:gg });
        mouthUntil = now + 65 + (syllable % 3) * 15;
        nextSyllable = now + [125, 160, 115, 190, 145][syllable % 5];
        syllable++;
      }
      host.classList.toggle('is-syllable', now < mouthUntil);
    } else if (voiceUntil) stopVoice();
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
    if (at >= 0) {
      copy.append(document.createTextNode(text.slice(0, at)));
      const mark = document.createElement('strong'); mark.textContent = name;
      if (/^#[0-9a-f]{6}$/i.test(line.actor.color || '')) mark.style.setProperty('--player-color', line.actor.color);
      copy.append(mark, document.createTextNode(text.slice(at + name.length)));
    } else copy.textContent = text;
    bubble.hidden = false;
    host.classList.add('is-talking');
    host.classList.toggle('is-gg', gg);
    host.classList.toggle('is-burst', gg && muted);
    host.classList.remove('is-murmuring');
    until = now + (gg ? 2500 : Math.min(3300, Math.max(2500, text.length * 65)));
    // The cloth splits before the final voice starts.
    nextSyllable = now + (gg && muted ? 220 : 0);
    voiceUntil = now + (gg ? 1950 : Math.min(1750, 500 + text.length * 45));
    syllable = 0;
    wake();
  }
  function observe(b) {
    if (finale) return;
    const hud = el('hud');
    if (!b || b.demo || document.hidden || !hud || hud.classList.contains('hidden')) { hide(); return; }
    const now = performance.now();
    const key = (b.soundSource || 'local') + ':' + b.soundId + ':' + b.fighters.map(f => f.uid).join(',');
    if (key !== lastKey) { clearSpeech(); lastKey = key; }
    const line = director.observe(b, now);
    if (b.phase === 'count') { host.hidden = true; hud.classList.remove('with-commentator'); return; }
    host.hidden = false; hud.classList.add('with-commentator');
    if (!line) return;
    if (muted) { murmur(now); return; }
    speak(line, now);
  }
  function onScreen(id) {
    if (id === 'scr-intro' || id === 'scr-weapon') { finalized = false; matchSerial++; }
    if (id && id !== 'scr-over') hide();
  }
  function finishMatch(players) {
    if (finalized) return;
    const now = performance.now(), line = director.finishMatch(players, now, matchSerial);
    if (!line) return;
    finalized = true;
    if (document.hidden) return;
    hide();
    finale = true;
    el('app').appendChild(host);
    host.hidden = false; host.classList.add('is-match-finale');
    speak(line, now);
  }
  button.addEventListener('click', event => {
    event.stopPropagation(); muted = !muted;
    try { localStorage.setItem(storeKey, muted ? '1' : '0'); } catch (_) { /* Session-only fallback. */ }
    paintMute();
    if (gg) host.classList.toggle('is-burst', muted);
    if (!gg) clearSpeech();
    if (muted && !gg) { nextMurmur = 0; murmur(performance.now()); }
    if (!muted) host.classList.remove('is-murmuring', 'is-burst');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  paintMute();
  root.BounceRoyalCommentary = Object.freeze({ observe, hide, onScreen, finishMatch, get muted() { return muted; } });
})(globalThis);
