'use strict';
/* ============================================================
 * 선택 화면 UI 테스트
 *
 * ui.js는 DOM을 만지므로 최소한의 가짜 DOM 위에서 돌린다.
 * 여기서 보는 것은 화면 모양이 아니라 "눌렀다는 표시가 남는가",
 * "타이머 눈금이 단계 전체 길이 기준인가" 같은 동작 규칙이다.
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

/* ---------------- 아주 작은 DOM ---------------- */
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], dataset: {}, style: {}, disabled: false,
    _classes: new Set(), textContent: '', innerHTML: '', type: '', onclick: null,
    classList: {
      add(...c) { c.forEach(x => el._classes.add(x)); },
      remove(...c) { c.forEach(x => el._classes.delete(x)); },
      toggle(x, on) { if (on === undefined) { el._classes.has(x) ? el._classes.delete(x) : el._classes.add(x); } else if (on) el._classes.add(x); else el._classes.delete(x); },
      contains(x) { return el._classes.has(x); },
    },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    remove() { const p = el.parentNode; if (!p) return; const i = p.children.indexOf(el); if (i >= 0) p.children.splice(i, 1); el.parentNode = null; },
    replaceChildren() { el.children.length = 0; },
    insertAdjacentElement(_, c) { el.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector(sel) { return el._find(sel)[0] || null; },
    querySelectorAll(sel) { return el._find(sel); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    getContext() { return null; },
    _find(sel) {
      const want = String(sel).replace(/^[.#]/, '').split(/[ >]/).pop().replace(/^[.#]/, '');
      const out = [];
      const walk = node => {
        for (const c of node.children || []) {
          if (c._classes.has(want) || c.tagName === want || c.id === want) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
  };
  // ui.js는 className에 문자열을 그대로 대입한다. classList와 같은 곳을 보게 묶어준다.
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._classes).join(' '); },
    set(v) { el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  return el;
}

const byId = new Map();
function ensure(id) {
  if (!byId.has(id)) { const el = makeEl('div'); el.id = id; byId.set(id, el); }
  return byId.get(id);
}
// ui.js가 찾는 요소들을 미리 만들어 둔다
for (const id of ['aug-cards', 'aug-sub', 'aug-round-label', 'aug-myinfo', 'aug-owned',
  'aug-timer', 'event-timer', 'weapon-timer', 'weapon-cards', 'btn-refresh', 'refresh-count',
  'event-cards', 'event-status', 'scr-weapon', 'scr-augment', 'scr-event']) ensure(id);
for (const id of ['scr-weapon', 'scr-augment', 'scr-event']) {
  const head = makeEl('div'); head._classes.add('screen-head');
  ensure(id).appendChild(head);
}
// 타이머 막대에는 i(채움)와 b(숫자)가 있다
for (const id of ['aug-timer', 'event-timer', 'weapon-timer']) {
  const fill = makeEl('i'); fill._classes.add('i');
  const label = makeEl('b'); label._classes.add('b');
  ensure(id).appendChild(fill); ensure(id).appendChild(label);
}

let intervalId = 0;
const sandbox = {
  console, Map, Set, Math, Date, JSON, performance,
  setTimeout, clearTimeout,
  setInterval() { return ++intervalId; },
  clearInterval() {},
  requestAnimationFrame() { return 0; },
  addEventListener() {},
  navigator: {},
  document: {
    body: { classList: makeEl('div').classList, appendChild() {} },
    head: { appendChild() {} },
    createElement: makeEl,
    getElementById: id => (byId.has(id) ? byId.get(id) : null),
    querySelector() { return null; },
    querySelectorAll(sel) {
      const want = String(sel).split(/[ >]/).pop().replace(/^[.#]/, '');
      const out = [];
      for (const el of byId.values()) out.push(...el._find(want));
      return out;
    },
    addEventListener() {},
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext([
  read('js/data.js'),
  read('js/ui.js'),
  'globalThis.__uiApi = { buildAugmentSelect, buildWeaponSelect, startPhaseTimer, stopPhaseTimer, selectionPlayers };',
].join('\n'), context, { filename: 'bounce-royal-ui.test.bundle.js' });

const { buildAugmentSelect, buildWeaponSelect, startPhaseTimer, stopPhaseTimer } = context.__uiApi;
const $ = id => byId.get(id);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (err) { console.error('✗ ' + name); throw err; }
}

const offers = [
  { id: 'hp15', cat: 'stat', name: '단단한 몸', desc: '최대 체력 +15%' },
  { id: 'atk15', cat: 'stat', name: '무기 강화', desc: '공격력 +15%' },
  { id: 'move15', cat: 'stat', name: '가벼운 몸', desc: '이동속도 +15%' },
];
const me = { id: 0, name: '나', charId: 'cat', weaponId: 'sword', coins: 3, augments: [] };
const cards = () => $('aug-cards').children;

test('증강을 고르면 그 카드에 표시가 남는다', () => {
  let picked = null;
  buildAugmentSelect(offers, me, aug => { picked = aug; }, null, null);
  assert.equal(cards().length, 3);
  assert.ok(!cards().some(c => c.classList.contains('picked')), '처음엔 아무것도 눌리지 않은 상태');
  cards()[1].onclick();
  assert.equal(picked && picked.id, 'atk15', '고른 증강이 서버로 가야 한다');
  assert.ok(cards()[1].classList.contains('picked'), '누른 카드에 표시가 남아야 한다');
  assert.ok(!cards()[0].classList.contains('picked'));
  assert.ok(cards().every(c => c.disabled), '고른 뒤에는 더 못 누른다');
});

test('한 번 고른 뒤 다른 카드를 눌러도 바뀌지 않는다', () => {
  let count = 0;
  buildAugmentSelect(offers, me, () => { count++; }, null, null);
  cards()[0].onclick();
  cards()[2].onclick();
  assert.equal(count, 1, '두 번 보내면 서버가 두 번 처리한다');
  assert.ok(cards()[0].classList.contains('picked'));
  assert.ok(!cards()[2].classList.contains('picked'));
});

test('새 후보가 오면 다시 고를 수 있다', () => {
  let count = 0;
  buildAugmentSelect(offers, me, () => { count++; }, null, null);
  cards()[0].onclick();
  buildAugmentSelect(offers, me, () => { count++; }, null, null);   // 새로고침 / 다음 차례
  assert.ok(!cards().some(c => c.classList.contains('picked')), '표시가 초기화되어야 한다');
  cards()[1].onclick();
  assert.equal(count, 2);
});

test('증강 화면의 코인은 넘겨받은 최신 목록을 쓴다', () => {
  const players = [
    { id: 0, name: '나', charId: 'cat', weaponId: 'sword', coins: 2, augments: [], local: true },
    { id: 1, name: '친구', charId: 'wak', weaponId: 'bow', coins: 4, augments: [] },
  ];
  buildAugmentSelect(offers, players[0], () => {}, null, { players });
  const roster = $('scr-augment')._find('prow');
  assert.ok(roster.length >= 2, '참가자 줄이 그려져야 한다');
  const text = roster.map(el => el.innerHTML).join(' ');
  assert.ok(text.includes('🪙2') && text.includes('🪙4'), '코인이 전원 5개로 굳어 보이면 안 된다 (실제: ' + text + ')');
});

test('타이머 눈금은 단계 전체 길이 기준이다', () => {
  // 15초 단계에서 7초 남은 시점에 다시 부르는 경우 (증강 새로고침)
  startPhaseTimer('aug-timer', 7, null, 15);
  const fill = $('aug-timer').children[0];
  const pct = parseFloat(fill.style.width);
  assert.ok(pct > 44 && pct < 50, '7/15 = 47% 근처여야 한다 (실제 ' + fill.style.width + ')');
  stopPhaseTimer();
});

test('전체 길이를 안 주면 예전처럼 남은 시간 기준이다', () => {
  startPhaseTimer('aug-timer', 12, null);
  const fill = $('aug-timer').children[0];
  assert.ok(parseFloat(fill.style.width) > 99, '싱글 경로는 그대로여야 한다');
  stopPhaseTimer();
});


const wCards = () => $('weapon-cards').children;

test('무기를 고르면 그 카드에 표시가 남는다', () => {
  let picked = null;
  buildWeaponSelect(['sword', 'bow', 'mine'], id => { picked = id; });
  assert.equal(wCards().length, 3);
  assert.ok(!wCards().some(c => c.classList.contains('picked')), '처음엔 아무것도 눌리지 않은 상태');
  wCards()[1].onclick();
  assert.equal(picked, 'bow', '고른 무기가 서버로 가야 한다');
  assert.ok(wCards()[1].classList.contains('picked'), '누른 카드에 표시가 남아야 한다');
  assert.ok(wCards().every(c => c.disabled), '고른 뒤에는 더 못 누른다');
});

test('무기를 한 번 고른 뒤 다른 카드를 눌러도 바뀌지 않는다', () => {
  let count = 0;
  buildWeaponSelect(['sword', 'bow', 'mine'], () => { count++; });
  wCards()[0].onclick();
  wCards()[2].onclick();
  assert.equal(count, 1);
  assert.ok(wCards()[0].classList.contains('picked'));
  assert.ok(!wCards()[2].classList.contains('picked'));
});

test('무기 선택 화면에도 제한시간 막대가 뜬다', () => {
  startPhaseTimer('weapon-timer', 15, null, 15);
  const bar = $('weapon-timer');
  assert.ok(!bar.classList.contains('hidden'), '막대가 보여야 한다');
  assert.ok(parseFloat(bar.children[0].style.width) > 99, '15초 전체에서 시작해야 한다');
  assert.ok(parseFloat(bar.children[1].textContent) > 14, '남은 시간을 숫자로 보여야 한다');
  stopPhaseTimer();
  assert.ok(bar.classList.contains('hidden'), '단계가 끝나면 감춰야 한다');
});

console.log('\n' + passed + '개 선택 화면 테스트 통과');
