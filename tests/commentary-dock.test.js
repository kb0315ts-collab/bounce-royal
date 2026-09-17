'use strict';
/* ============================================================
 * 선인장 해설자의 자리
 *
 * 증강·이벤트 화면은 선인장을 그 화면 칸으로 데려간다. 다음 라운드는
 * showScreen(null)로 시작해 선인장을 돌려보내는 hide()를 거치지 않았고,
 * 선인장은 숨은 증강 화면에 남은 채 전투 내내 목소리만 냈다.
 * commentary.js를 가짜 DOM 위에 올려 자리와 목소리를 확인한다.
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const byId = new Map();
function fakeEl(id, parent = null) {
  const set = new Set();
  const e = {
    id, children: [], parentNode: null, hidden: false, textContent: '', className: '', title: '',
    style: { setProperty() {} }, attrs: {}, listeners: {},
    classList: {
      add(...c) { c.forEach(x => set.add(x)); },
      remove(...c) { c.forEach(x => set.delete(x)); },
      toggle(x, on) { if (on === undefined) on = !set.has(x); if (on) set.add(x); else set.delete(x); return on; },
      contains(x) { return set.has(x); },
    },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    appendChild(c) {
      if (c.parentNode) c.parentNode.children = c.parentNode.children.filter(x => x !== c);
      c.parentNode = this; this.children.push(c); return c;
    },
    append(...cs) { this.children.push(...cs); },
    replaceChildren() { this.children = []; },
    lastChild: { textContent: '' },
    // 자기나 조상 중 하나라도 숨어 있으면 그려지지 않는다
    getClientRects() {
      for (let n = this; n; n = n.parentNode) if (n.hidden || n.classList.contains('hidden')) return [];
      return [{}];
    },
  };
  if (id) byId.set(id, e);
  if (parent) parent.appendChild(e);
  return e;
}
const app = fakeEl('app');
const hud = fakeEl('hud', app);
const commentator = fakeEl('commentator', hud);
commentator.hidden = true;
for (const id of ['caster-toggle', 'caster-bubble', 'caster-copy', 'caster-label', 'caster-badge']) fakeEl(id, commentator);
const augment = fakeEl('scr-augment', app);
fakeEl('augment-caster-dock', augment);
const eventScreen = fakeEl('scr-event', app);
fakeEl('event-caster-dock', eventScreen);

let now = 1000, rafCb = null;
const syllables = [];
const sandbox = {
  console, Map, Set, Math, Date, JSON,
  performance: { now: () => now },
  requestAnimationFrame(fn) { rafCb = fn; return 1; },
  cancelAnimationFrame() { rafCb = null; },
  setTimeout() { return 0; }, clearTimeout() {},
  localStorage: { getItem() { return null; }, setItem() {} },
  SFX: { chatterSyllable(o) { syllables.push(o); }, stopChatter() {} },
  document: {
    hidden: false,
    getElementById: id => byId.get(id) || null,
    createElement: tag => fakeEl(null),
    createTextNode: text => ({ textContent: text }),
    addEventListener() {},
  },
};
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext([
  read('js/data.js'), read('js/sim.js'), read('js/commentary-core.js'), read('js/broadcast-core.js'), read('js/commentary.js'),
  'globalThis.__api = { Battle, Commentary: globalThis.BounceRoyalCommentary };',
].join('\n'), context, { filename: 'bounce-royal-commentary-dock.test.bundle.js' });
const { Battle, Commentary } = context.__api;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('O ' + name); }
  catch (err) { console.error('X ' + name); throw err; }
}
const player = (id, isAI) => ({ id, name: 'P' + id, isAI, color: '#4da6ff', charId: 'cat', weaponId: 'sword',
  coins: 5, coinsLost: 0, augments: [], augmentBaselines: {}, wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0 });
// 화면 전환: showScreen과 같게 해당 화면만 보이고 해설자에게 알린다
function showScreen(id) {
  Commentary.onScreen(id);
  for (const s of [augment, eventScreen]) s.classList.toggle('hidden', s.id !== id);
}
const frame = ms => { now += ms; const fn = rafCb; rafCb = null; if (fn) fn(now); };

test('증강 화면을 지나 다음 라운드가 시작되면 선인장이 전투 화면으로 돌아온다', () => {
  for (const [screenId, dockId] of [['scr-augment', 'augment-caster-dock'], ['scr-event', 'event-caster-dock']]) {
    showScreen(screenId);
    assert.equal(commentator.parentNode.id, dockId, screenId + '에서는 그 화면 칸에 있다');
    // 다음 라운드: 화면을 모두 닫고 전투를 그린다
    showScreen(null);
    const battle = new Battle('diamond', [player(1, false), player(2, true)]);
    Commentary.observe(battle);
    assert.equal(commentator.parentNode, hud, screenId + '를 지난 전투에서도 선인장은 전투 화면에 있다');
    assert.equal(commentator.hidden, false);
    assert.equal(commentator.getClientRects().length, 1, '실제로 그려진다');
    assert.equal(commentator.classList.contains('is-studio'), false, '증강 화면용 작은 모양이 남지 않는다');
  }
});

test('화면에 그려지지 않는 선인장은 목소리를 내지 않는다', () => {
  // 증강 화면 칸에 있는데 그 화면이 닫혀 있다
  showScreen('scr-augment');
  augment.classList.add('hidden');
  syllables.length = 0;
  Commentary.studioLines(['선인장이 몰래 떠들어요'], '테스트', 'augment-caster-dock');
  for (let i = 0; i < 40; i++) frame(50);
  assert.equal(syllables.length, 0, '안 보이는데 소리가 났다');
  // 화면이 보이면 말한다
  augment.classList.remove('hidden');
  Commentary.studioLines(['이제는 보여요'], '테스트', 'augment-caster-dock');
  for (let i = 0; i < 40; i++) frame(50);
  assert.ok(syllables.length > 0, '보이는 선인장은 말한다');
});

console.log('');
console.log(passed + '개 해설자 자리 테스트 통과');
