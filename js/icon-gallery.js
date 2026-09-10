'use strict';
(function () {
  const grid = document.getElementById('icon-grid');
  const search = document.getElementById('icon-search');
  const category = document.getElementById('icon-category');
  const dialog = document.getElementById('icon-dialog');
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
    source.removeAttribute('href'); source.textContent = '출처 불러오는 중…';
    text('dialog-reason', ''); text('dialog-changes', '');
    dialog.dataset.item = item.id;
    dialog.showModal();
    await creditReady;
    if (dialog.dataset.item !== item.id) return;
    const credit = manifest && manifest[item.id];
    if (!credit) { source.href = 'assets/icons/game-icons/manifest.json'; source.textContent = '전체 출처 기록 보기 ↗'; return; }
    text('dialog-reason', credit.reason);
    source.textContent = credit.source.split('/')[1] + ' · ' + credit.author + ' ↗';
    source.href = credit.sourceUrl;
    text('dialog-changes', '게임용 변경: ' + credit.modifications);
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const items = AUGMENTS.filter(item => (category.value === 'all' || item.cat === category.value) && (!query || [item.name, item.desc, CAT_TAGS[item.cat], item.weapon && WEAPONS[item.weapon].name].join(' ').toLocaleLowerCase().includes(query)));
    grid.replaceChildren();
    for (const item of items) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'icon-card'; card.dataset.augment = item.id;
      card.setAttribute('aria-label', item.name + ' 상세 보기');
      card.innerHTML = '<div class="art-pair"><div class="icon-art old-art">' + BRIcons.legacyMarkup('aug-' + item.id) + '<span class="art-label">이전</span></div><div class="icon-art new-art">' + BRIcons.markup('aug-' + item.id) + '<span class="art-label">적용 중</span></div></div>';
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
  });
  document.getElementById('dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
  render();
})();
