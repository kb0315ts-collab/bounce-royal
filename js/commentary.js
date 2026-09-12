'use strict';
/* Presentation only. No voice, gameplay RNG, timers, inputs or balance changes.
 * Only renderBattle's currently watched arena is observed, even online. */
(function (root) {
  const el = id => document.getElementById(id);
  const host = el('commentator');
  if (!host || !root.BounceRoyalCommentaryCore) return;
  const button = el('caster-toggle'), bubble = el('caster-bubble');
  const copy = el('caster-copy'), label = el('caster-label'), badge = el('caster-badge');
  const storeKey = 'bounce-royal-caster-muted-v1';
  const director = new root.BounceRoyalCommentaryCore.Director({ weapons: WEAPONS, characters: CHARACTERS });
  let muted = false, until = 0, murmurUntil = 0, nextMurmur = 0, gg = false, lastKey = null;
  try { muted = localStorage.getItem(storeKey) === '1'; } catch (_) { /* Private browsing still works. */ }

  function paintMute() {
    host.classList.toggle('is-muted', muted);
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? '해설자 입마개 벗기기' : '해설자 입마개 씌우기. 마지막 GG 연출은 유지됩니다.');
    button.title = muted ? '누르면 다시 해설해요' : '누르면 조용히! 마지막 GG는 참지 못해요';
    badge.lastChild.textContent = muted ? ' 조용히!' : ' ON AIR';
  }
  function clearSpeech() {
    until = 0; gg = false;
    bubble.hidden = true;
    host.classList.remove('is-talking', 'is-gg', 'is-burst');
  }
  function hide() {
    director.observe(null, performance.now());
    clearSpeech();
    host.hidden = true;
    host.classList.remove('is-murmuring');
    el('hud')?.classList.remove('with-commentator');
    lastKey = null;
  }
  function murmur(now) {
    if (now < nextMurmur) return;
    nextMurmur = now + 9000;
    murmurUntil = now + 950;
    host.classList.add('is-murmuring');
  }
  function speak(line, now) {
    clearSpeech();
    gg = !!line.gg;
    label.textContent = line.label || 'COSMIC LIVE';
    copy.replaceChildren();
    // Nicknames are untrusted text, never HTML. Highlight the first exact name.
    const text = gg ? String(line.text || '').replace(/^GG~~!\s*/, '') : String(line.text || '');
    const name = line.actor && String(line.actor.name || '');
    const at = name ? text.indexOf(name) : -1;
    if (at >= 0) {
      copy.append(document.createTextNode(text.slice(0, at)));
      const mark = document.createElement('strong');
      mark.textContent = name;
      const color = line.actor.color;
      if (/^#[0-9a-f]{6}$/i.test(color || '')) mark.style.setProperty('--player-color', color);
      copy.append(mark, document.createTextNode(text.slice(at + name.length)));
    } else copy.textContent = text;
    bubble.hidden = false;
    host.classList.add('is-talking');
    host.classList.toggle('is-gg', gg);
    host.classList.toggle('is-burst', gg && muted);
    host.classList.remove('is-murmuring');
    // Ending lasts 1.5 seconds in the game. This is UI time, not GAME_SPEED.
    until = now + (gg ? 1400 : Math.min(3300, Math.max(2500, text.length * 65)));
  }
  function observe(b) {
    const hud = el('hud');
    if (!b || b.demo || document.hidden || !hud || hud.classList.contains('hidden')) { hide(); return; }
    const now = performance.now();
    const key = (b.soundSource || 'local') + ':' + b.soundId + ':' + b.fighters.map(f => f.uid).join(',');
    if (key !== lastKey) { clearSpeech(); lastKey = key; }
    // Still consume countdown state, which lets the director identify the start.
    const line = director.observe(b, now);
    if (b.phase === 'count') { host.hidden = true; hud.classList.remove('with-commentator'); return; }
    host.hidden = false;
    hud.classList.add('with-commentator');
    const art = el('caster-art');
    if (!art.getAttribute('src')) art.src = art.dataset.src;
    if (until && now >= until) clearSpeech();
    if (now >= murmurUntil) host.classList.remove('is-murmuring');
    if (!line) return;
    // Consume all events while gagged: removing the gag never replays old lines.
    if (muted && !line.gg) { murmur(now); return; }
    speak(line, now);
  }
  button.addEventListener('click', event => {
    event.stopPropagation();
    muted = !muted;
    try { localStorage.setItem(storeKey, muted ? '1' : '0'); } catch (_) { /* Session-only preference. */ }
    paintMute();
    if (!gg) clearSpeech();
    if (muted && !gg) { nextMurmur = 0; murmur(performance.now()); }
    if (!muted) host.classList.remove('is-murmuring', 'is-burst');
  });
  // Changing focus/tab cannot leave a stale animated bubble on a menu.
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  paintMute();
  root.BounceRoyalCommentary = Object.freeze({ observe, hide, get muted() { return muted; } });
})(globalThis);
