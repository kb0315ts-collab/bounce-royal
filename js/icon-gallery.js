'use strict';
(function () {
  const grid = document.getElementById('icon-grid');
  const search = document.getElementById('icon-search');
  const category = document.getElementById('icon-category');
  const dialog = document.getElementById('icon-dialog');
  const legend = document.getElementById('icon-legend');
  if (legend) {
    for (const [id, label] of [['atk15','공격력'],['hp15','체력'],['rot15','공격속도'],['seasonedExp','라운드 성장'],['winMomentum','승리'],['vengeance','패배'],['bloodRush','연승']]) {
      const item = document.createElement('div');
      item.innerHTML = BRIcons.markup('aug-' + id);
      const caption = document.createElement('span'); caption.textContent = label;
      item.appendChild(caption); legend.appendChild(item);
    }
  }
  let manifest = null;
  const creditReady = fetch('assets/icons/game-icons/manifest.json').then(response => {
    if (!response.ok) throw Error('Credit manifest unavailable');
    return response.json();
  }).then(value => { manifest = value; }).catch(() => {});
  for (const key of Object.keys(CAT_TAGS)) {
    if (!AUGMENTS.some(item => item.cat === key)) continue;
    const option = document.createElement('option'); option.value = key; option.textContent = CAT_TAGS[key]; category.appendChild(option);
  }
  function text(id, value) { document.getElementById(id).textContent = value; }
  async function show(item) {
    document.getElementById('dialog-art').innerHTML = BRIcons.markup('aug-' + item.id);
    document.getElementById('dialog-small').innerHTML = BRIcons.markup('aug-' + item.id);
    text('dialog-name', item.name); text('dialog-desc', item.desc);
    text('dialog-category', CAT_TAGS[item.cat] + (item.weapon ? ' · ' + WEAPONS[item.weapon].name : ''));
    const source = document.getElementById('dialog-source');
    source.removeAttribute('href'); source.textContent = '이전 에셋 출처 불러오는 중…';
    const art = window.BRAugmentArt;
    const composition = art && (art.descriptors[item.id] || art.descriptors['aug-' + item.id]);
    text('dialog-reason', composition ? composition.reason : '실제 전투 도형과 공통 스탯·조건 부품으로 만든 아이콘');
    text('dialog-changes', '현재: 바운스로얄 오리지널 SVG · 아래 링크는 비교용으로 보존한 이전 에셋입니다.');
    dialog.dataset.item = item.id;
    dialog.showModal();
    await creditReady;
    if (dialog.dataset.item !== item.id) return;
    const credit = manifest && manifest[item.id];
    if (!credit) { source.href = 'assets/icons/game-icons/manifest.json'; source.textContent = '전체 출처 기록 보기 ↗'; return; }
    source.textContent = '이전 에셋: ' + credit.source.split('/')[1] + ' · ' + credit.author + ' ↗';
    source.href = credit.sourceUrl;
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const items = AUGMENTS.filter(item => (category.value === 'all' || item.cat === category.value) && (!query || [item.name, item.desc, CAT_TAGS[item.cat], item.weapon && WEAPONS[item.weapon].name].join(' ').toLocaleLowerCase().includes(query)));
    grid.replaceChildren();
    for (const item of items) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'icon-card'; card.dataset.augment = item.id;
      card.setAttribute('aria-label', item.name + ' 상세 보기');
      const previous = document.body.classList.contains('comparing') ? '<div class="icon-art old-art">' + BRIcons.archivedMarkup('aug-' + item.id) + '<span class="art-label">이전 에셋</span></div>' : '';
      card.innerHTML = '<div class="art-pair">' + previous + '<div class="icon-art new-art">' + BRIcons.markup('aug-' + item.id) + '<span class="art-label">게임 아트</span></div></div>';
      const name = document.createElement('h3'); name.textContent = item.name; card.appendChild(name);
      const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = item.weapon ? WEAPONS[item.weapon].name + ' 전용' : CAT_TAGS[item.cat]; card.appendChild(kind);
      card.addEventListener('click', () => show(item)); grid.appendChild(card);
    }
    text('icon-count', items.length + ' / ' + AUGMENTS.length);
    document.getElementById('empty').hidden = items.length > 0;
  }
  search.addEventListener('input', render); category.addEventListener('change', render);
  document.getElementById('compare').addEventListener('click', event => {
    const on = document.body.classList.toggle('comparing'); event.currentTarget.setAttribute('aria-pressed', String(on));
    render();
  });
  document.getElementById('dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
  render();
})();
