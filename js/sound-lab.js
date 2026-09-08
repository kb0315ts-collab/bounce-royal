'use strict';

(function initSoundLab() {
  const byId = id => document.getElementById(id);
  const elements = {
    grid:byId('sound-grid'), filters:byId('category-filters'), search:byId('sound-search'),
    total:byId('total-count'), count:byId('visible-count'), empty:byId('empty-state'),
    status:byId('playback-status'), now:byId('now-title'), label:byId('playing-label'),
    visual:byId('live-visual'), playAll:byId('play-all'), stop:byId('stop-all'),
    volume:byId('volume'), volumeValue:byId('volume-value'), mute:byId('mute-toggle'),
  };
  const engine = window.BounceRoyalAudio;
  if (!engine || typeof engine.create !== 'function' || !Array.isArray(engine.catalog)) {
    elements.status.textContent = '효과음을 불러오지 못했어요. 페이지를 새로고침해 주세요.';
    elements.status.classList.add('is-error');
    elements.playAll.disabled = true;
    elements.mute.disabled = true;
    elements.volume.disabled = true;
    elements.total.textContent = '0';
    elements.count.textContent = '0';
    return;
  }

  const groups = [
    {name:'전체', color:'#7bd8ff'}, {name:'무기', color:'#79d8ff'},
    {name:'무기 스킬', color:'#b69cff'}, {name:'캐릭터 스킬', color:'#83ddc0'},
    {name:'증강', color:'#ffc58a'}, {name:'전투', color:'#ff9fa7'},
    {name:'인터페이스', color:'#87b9ff'},
  ];
  const catalog = engine.catalog.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string');
  const sounds = new Map(catalog.map(item => [item.id, item]));
  let savedVolume = 55;
  try {
    const saved = localStorage.getItem('bounce-royal-sound-room-volume');
    if (saved !== null && Number.isFinite(Number(saved))) savedVolume = Math.min(100, Math.max(0, Number(saved)));
  } catch (_) { /* Listening remains available when browser storage is disabled. */ }
  const audio = engine.create({volume:savedVolume / 100, muted:false});
  let selectedGroup = '전체';
  let generation = 0;
  let activeId = null;
  let sequenceIndex = -1;
  let sequenceTimer = null;
  let activeTimer = null;
  let busy = false;
  let muted = false;
  let previewQueue = Promise.resolve();

  const durationOf = item => Math.max(.1, Math.min(30, Number(item.duration) || .8));
  const groupColor = item => (groups.find(group => group.name === item.group) || groups[0]).color;
  const setStatus = (message, isError = false) => {
    elements.status.textContent = message;
    elements.status.classList.toggle('is-error', isError);
  };
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function updateVolume() {
    const value = Math.min(100, Math.max(0, Number(elements.volume.value) || 0));
    audio.volume = value / 100;
    audio.muted = muted;
    elements.volumeValue.value = value + '%';
    elements.mute.classList.toggle('is-muted', muted || value === 0);
    elements.mute.setAttribute('aria-pressed', String(muted || value === 0));
    elements.mute.setAttribute('aria-label', muted || value === 0 ? '효과음 음소거 해제' : '효과음 음소거');
    try { localStorage.setItem('bounce-royal-sound-room-volume', String(value)); } catch (_) {}
  }

  function showPlayback(id, isBusy = false) {
    activeId = id;
    busy = isBusy;
    const item = sounds.get(id);
    elements.now.textContent = item ? item.name : '어떤 소리부터 들어볼까요?';
    elements.label.textContent = isBusy ? 'LOADING SOUND' : item ? (sequenceIndex >= 0 ? `이어 듣기 ${sequenceIndex + 1} / ${catalog.length}` : item.group + ' · 재생 중') : 'READY TO PLAY';
    elements.visual.classList.toggle('is-playing', !!item && !isBusy);
    elements.stop.disabled = !item && sequenceIndex < 0;
    elements.playAll.querySelector('span:last-child').textContent = sequenceIndex >= 0 ? '처음부터 다시 듣기' : '전체 이어 듣기';
    for (const card of elements.grid.children) {
      const playing = card.dataset.soundId === id && !isBusy;
      card.classList.toggle('is-playing', playing);
      const button = card.querySelector('.sound-play');
      if (!button) continue;
      button.setAttribute('aria-pressed', String(playing));
      button.setAttribute('aria-label', `${sounds.get(card.dataset.soundId).name} ${playing ? '중지' : '재생'}`);
      button.querySelector('.play-label').textContent = playing ? '재생 중' : '들어보기';
      button.querySelector('.play-mark').className = 'play-mark ' + (playing ? 'stop-square' : 'play-triangle');
    }
  }

  function cancelPlayback() {
    generation += 1;
    clearTimeout(sequenceTimer);
    clearTimeout(activeTimer);
    sequenceTimer = null;
    activeTimer = null;
    sequenceIndex = -1;
    audio.stopAll();
    showPlayback(null);
    return generation;
  }

  function checkAudible() {
    if (muted || Number(elements.volume.value) === 0) {
      setStatus(muted ? '음소거 상태예요. 스피커 버튼을 눌러 해제해 주세요.' : '음량이 0%예요. 음량을 올린 뒤 재생해 주세요.');
      return false;
    }
    return true;
  }

  async function playOne(item, token, ready) {
    if (token !== generation || document.hidden) return false;
    showPlayback(item.id, true);
    try {
      const available = await ready;
      if (token !== generation || document.hidden) return false;
      if (!available) throw new Error('audio-unavailable');
      // Serialize asynchronous previews so a cancelled resume cannot stop a newer sound.
      const next = previewQueue.catch(() => false).then(async () => {
        if (token !== generation || document.hidden) return false;
        const played = await audio.preview(item.id);
        if (token !== generation || document.hidden) {
          audio.stopAll();
          return false;
        }
        return played;
      });
      previewQueue = next;
      const played = await next;
      if (token !== generation || document.hidden) return false;
      if (!played) throw new Error('playback-failed');
      showPlayback(item.id);
      const seqText = sequenceIndex >= 0 ? ` (${sequenceIndex + 1}/${catalog.length})` : '';
      setStatus(`${item.name}${seqText} · ${item.description || '효과음을 재생합니다.'}`);
      clearTimeout(activeTimer);
      activeTimer = setTimeout(() => {
        if (token !== generation) return;
        showPlayback(null);
        if (sequenceIndex < 0) setStatus(`${item.name} 재생이 끝났어요. 다시 눌러 비교해 보세요.`);
      }, durationOf(item) * 1000);
      return true;
    } catch (_) {
      if (token !== generation) return false;
      cancelPlayback();
      setStatus('소리를 재생하지 못했어요. 다시 눌러보거나, 브라우저의 오디오 재생 허용 여부를 확인해 주세요.', true);
      return false;
    }
  }

  function preview(item) {
    if (activeId === item.id && !busy) {
      cancelPlayback();
      setStatus('재생을 멈췄어요. 다른 소리도 들어보세요.');
      return;
    }
    const token = cancelPlayback();
    if (!checkAudible()) return;
    // Start audio permission/resume within the user's click.
    const ready = audio.ensure();
    void playOne(item, token, ready);
  }

  async function playSequence(index, token, ready) {
    if (token !== generation || document.hidden) return;
    if (index >= catalog.length) {
      cancelPlayback();
      setStatus(`${catalog.length}개의 효과음을 모두 들었어요.`);
      return;
    }
    sequenceIndex = index;
    if (!await playOne(catalog[index], token, ready)) return;
    if (token !== generation) return;
    sequenceTimer = setTimeout(() => {
      void playSequence(index + 1, token, Promise.resolve(true));
    }, durationOf(catalog[index]) * 1000 + 420);
  }

  function renderFilters() {
    elements.filters.replaceChildren();
    for (const group of groups) {
      const count = group.name === '전체' ? catalog.length : catalog.filter(item => item.group === group.name).length;
      if (!count && group.name !== '전체') continue;
      const button = make('button', 'filter-button' + (selectedGroup === group.name ? ' is-selected' : ''), group.name);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(selectedGroup === group.name));
      button.append(make('span', '', String(count)));
      button.addEventListener('click', () => {
        selectedGroup = group.name;
        renderFilters();
        renderCards();
        // Preserve focus when the filter buttons are rebuilt.
        Array.from(elements.filters.children).find(entry => entry.getAttribute('aria-pressed') === 'true')?.focus({preventScroll:true});
      });
      elements.filters.append(button);
    }
  }

  function renderCards() {
    const query = elements.search.value.trim().toLocaleLowerCase().replace(/\s+/g, '');
    const visible = catalog.filter(item => (selectedGroup === '전체' || item.group === selectedGroup) && (!query || `${item.name} ${item.description || ''} ${item.group || ''}`.toLocaleLowerCase().replace(/\s+/g, '').includes(query)));
    elements.grid.replaceChildren();
    elements.count.textContent = String(visible.length);
    elements.empty.hidden = visible.length > 0;
    for (const item of visible) {
      const card = make('article', 'sound-card');
      card.dataset.soundId = item.id;
      card.style.setProperty('--card-accent', groupColor(item));
      card.style.setProperty('--sound-duration', durationOf(item) + 's');
      const top = make('div', 'card-top');
      const icon = make('span', 'sound-icon');
      icon.setAttribute('aria-hidden', 'true');
      if (window.BRIcons && window.BRIcons.has(item.icon)) icon.innerHTML = window.BRIcons.markup(item.icon);
      else {
        const fallback = make('span', 'sound-icon-fallback');
        fallback.append(make('i'), make('i'), make('i'));
        icon.append(fallback);
      }
      top.append(icon, make('span', 'card-category', item.group || '효과음'));
      const title = make('h3', '', item.name);
      const description = make('p', 'sound-description', item.description || '재생 버튼을 눌러 효과음을 들어보세요.');
      const bottom = make('div', 'card-bottom');
      const meta = make('span', 'sound-meta');
      meta.append(make('span', 'sound-duration', durationOf(item).toFixed(1) + '초'));
      const source = {sample:'녹음 사운드', synth:'디자인 사운드', synthesized:'디자인 사운드', '합성 + CC0 샘플':'혼합 사운드', '절차 합성':'디자인 사운드'}[item.source];
      if (source) meta.append(make('span', 'meta-dot'), make('span', '', source));
      const play = make('button', 'sound-play');
      play.type = 'button';
      const mark = make('span', 'play-mark play-triangle');
      mark.setAttribute('aria-hidden', 'true');
      play.append(mark, make('span', 'play-label', '들어보기'));
      play.addEventListener('click', () => preview(item));
      bottom.append(meta, play);
      const progress = make('span', 'sound-progress');
      progress.setAttribute('aria-hidden', 'true');
      card.append(top, title, description, bottom, progress);
      elements.grid.append(card);
    }
    showPlayback(activeId, busy);
  }

  elements.search.addEventListener('input', renderCards);
  elements.playAll.addEventListener('click', () => {
    const token = cancelPlayback();
    if (!catalog.length || !checkAudible()) return;
    const ready = audio.ensure();
    void playSequence(0, token, ready);
  });
  elements.stop.addEventListener('click', () => {
    cancelPlayback();
    setStatus('모든 재생을 멈췄어요.');
  });
  elements.volume.addEventListener('input', () => {
    if (Number(elements.volume.value) > 0) muted = false;
    updateVolume();
    if (Number(elements.volume.value) === 0) {
      cancelPlayback();
      setStatus('음량이 0%예요. 음량을 올린 뒤 재생해 주세요.');
    } else if (!activeId) setStatus('원하는 효과음의 재생 버튼을 눌러주세요.');
  });
  elements.mute.addEventListener('click', () => {
    muted = !(muted || Number(elements.volume.value) === 0);
    if (!muted && Number(elements.volume.value) === 0) elements.volume.value = '55';
    updateVolume();
    if (muted) {
      cancelPlayback();
      setStatus('음소거했어요. 스피커 버튼을 다시 누르면 해제돼요.');
    } else setStatus('음소거를 해제했어요. 원하는 소리를 재생해 보세요.');
  });
  byId('reset-filters').addEventListener('click', () => {
    selectedGroup = '전체';
    elements.search.value = '';
    renderFilters();
    renderCards();
    elements.search.focus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelPlayback();
      setStatus('화면을 떠나 재생을 멈췄어요. 다시 눌러 들어보세요.');
    }
  });
  window.addEventListener('pagehide', cancelPlayback);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (activeId || sequenceIndex >= 0)) {
      cancelPlayback();
      setStatus('재생을 멈췄어요.');
    }
  });
  elements.volume.value = String(savedVolume);
  elements.total.textContent = String(catalog.length);
  elements.playAll.disabled = !catalog.length;
  updateVolume();
  renderFilters();
  renderCards();
})();
