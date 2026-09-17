'use strict';
/* ============================================================
 * 키보드 스킬: Q(또는 1) 캐릭터, E(또는 2) 무기
 *
 * 버튼과 똑같이 누를 때 쓰고 뗄 때 뗀다. 활 차지는 누르고 있다 떼면
 * 나가고, 화염방사기는 누르는 동안만 뿜는다. main.js를 가짜 창 위에
 * 올리고 진짜 keydown/keyup 이벤트를 보내 확인한다.
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const windowHandlers = {};
const stubClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const sandbox = {
  console, Map, Set, Math, Date, URLSearchParams, performance,
  location: { search: '' },
  setTimeout, clearTimeout,
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {},
  localStorage: { getItem() { return null; }, setItem() {} },
  navigator: {},
  canvas: { classList: stubClassList, addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 840, height: 840 }; } },
  VIEW: { ox: 0, oy: 0, s: 1 },
  $() { return null; },
  updatePlayersPanel() {}, showResult() {},
  document: {
    body: { classList: stubClassList, appendChild() {} },
    head: { appendChild() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { classList: stubClassList, appendChild() {}, addEventListener() {} }; },
    addEventListener() {},
  },
};
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext([
  read('js/data.js'), read('js/sim.js'), read('js/matchmaking.js'),
  read('js/events.js'), read('js/audio-design.js'), read('js/audio.js'), read('js/main.js'),
  'globalThis.__api = { Game, Battle };',
].join('\n'), context, { filename: 'bounce-royal-skill-keys.test.bundle.js' });
const { Game, Battle } = context.__api;

const fire = (type, ev) => { for (const fn of windowHandlers[type] || []) fn(ev); };
const key = (code, extra = {}) => Object.assign({ code, key: code.replace(/^Key|^Digit/, '').toLowerCase(), repeat: false, target: null }, extra);
const down = (code, extra) => fire('keydown', key(code, extra));
const up = (code, extra) => fire('keyup', key(code, extra));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('O ' + name); }
  catch (err) { console.error('X ' + name); throw err; }
}

let pid = 0;
const mkPlayer = (isAI, o = {}) => Object.assign({
  id: ++pid, name: 'P' + pid, isAI, color: '#4da6ff', charId: 'soft', weaponId: 'sword',
  coins: 5, coinsLost: 0, augments: [], augmentBaselines: {}, copiedSkill: null,
  gamble: false, trollCondition: false, damageRewardMult: 1,
  wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
}, o);
function fresh(weaponId = 'sword') {
  fire('blur', {});          // 앞 테스트에서 누르고 있던 키를 비운다
  const battle = new Battle('diamond', [mkPlayer(false, { weaponId }), mkPlayer(true)]);
  battle.phase = 'fight';
  Game.mode = 'single';
  Game.state = 'battle';
  Game.focus = battle;
  return { battle, fighter: battle.human() };
}

test('Q는 캐릭터 스킬, E는 무기 스킬을 쓴다', () => {
  let { fighter } = fresh('sword');
  down('KeyQ'); up('KeyQ');
  assert.equal(fighter.skillUses.char, 0, 'Q로 캐릭터 스킬(말랑 방어)을 썼다');
  assert.ok(fighter.timers.immune > 0);
  ({ fighter } = fresh('sword'));
  down('KeyE'); up('KeyE');
  assert.ok(fighter.spinRemaining > 0, 'E로 무기 스킬(믹서기)을 썼다');
  assert.equal(fighter.skillUses.char, 1, 'E는 캐릭터 스킬을 건드리지 않는다');
});

test('한글 입력 상태에서도 자판 위치로 받고, 1·2도 그대로 된다', () => {
  let { fighter } = fresh('sword');
  down('KeyQ', { key: 'ㅂ' }); up('KeyQ', { key: 'ㅂ' });
  assert.equal(fighter.skillUses.char, 0, "key가 'ㅂ'이어도 Q 자리면 캐릭터 스킬");
  // 자판 배열이 달라도(AZERTY에서 Q 자리는 'a') 위치로 받고, 다른 자리에 찍힌 'q'는 받지 않는다
  ({ fighter } = fresh('sword'));
  down('KeyA', { key: 'q' }); up('KeyA', { key: 'q' });
  assert.equal(fighter.skillUses.char, 1, "Q 자리가 아닌 곳의 'q'는 받지 않는다");
  down('KeyQ', { key: 'a' }); up('KeyQ', { key: 'a' });
  assert.equal(fighter.skillUses.char, 0, "Q 자리면 글자가 'a'여도 캐릭터 스킬");
  ({ fighter } = fresh('sword'));
  fire('keydown', { key: 'ㄷ', repeat: false }); fire('keyup', { key: 'ㄷ' });
  assert.ok(fighter.spinRemaining > 0, 'code가 없는 오래된 브라우저에서도 ㄷ은 무기 스킬');
  ({ fighter } = fresh('sword'));
  down('Digit1'); up('Digit1'); down('Digit2'); up('Digit2');
  assert.equal(fighter.skillUses.char, 0, '1은 캐릭터 스킬');
  assert.ok(fighter.spinRemaining > 0, '2는 무기 스킬');
});

test('활: E를 누르고 있으면 모으고, 꾹 눌러 반복 입력이 들어와도 안 나가며, 떼면 나간다', () => {
  const { battle, fighter } = fresh('bow');
  down('KeyE');
  assert.ok(fighter.charging, '누르면 모으기 시작한다');
  fighter.charging.t = 0.5;                  // 0.5초 모았다 — 이제 누르면 나갈 수 있는 상태
  for (let i = 0; i < 20; i++) down('KeyE', { repeat: true });
  down('KeyE');                              // 반복 표시가 빠진 중복 keydown도
  assert.ok(fighter.charging, '꾹 누르는 동안 들어오는 입력으로는 발사되지 않는다');
  const before = battle.projectiles.length;
  up('KeyE');
  assert.equal(fighter.charging, null, '떼면 나간다');
  assert.equal(battle.projectiles.length, before + 1, '차지 화살 한 발');
  assert.ok(fighter.skillUses.cd > 0, '쿨타임이 돈다');
});

test('화염방사기: E를 누르는 동안만 뿜고, 떼거나 창을 벗어나면 멈춘다', () => {
  const { fighter } = fresh('flame');
  down('KeyE');
  assert.equal(fighter.flame.on, true, '누르면 뿜는다');
  up('KeyE');
  assert.equal(fighter.flame.on, false, '떼면 멈춘다');
  down('KeyE');
  assert.equal(fighter.flame.on, true);
  fire('blur', {});
  assert.equal(fighter.flame.on, false, '누른 채 창을 벗어나면 멈춘다');
  // E와 2를 같이 누르고 있다가 하나만 떼면 계속 뿜는다
  down('KeyE'); down('Digit2');
  up('Digit2');
  assert.equal(fighter.flame.on, true, '다른 무기 키가 아직 눌려 있다');
  up('KeyE');
  assert.equal(fighter.flame.on, false);
});

test('글을 쓰는 칸이나 Ctrl·Alt·Cmd 조합에서는 가로채지 않는다', () => {
  const { fighter } = fresh('sword');
  down('KeyQ', { target: { tagName: 'INPUT' } }); up('KeyQ');
  down('KeyE', { target: { tagName: 'TEXTAREA' } }); up('KeyE');
  down('KeyE', { target: { isContentEditable: true, tagName: 'DIV' } }); up('KeyE');
  down('KeyE', { ctrlKey: true }); up('KeyE');
  down('KeyQ', { metaKey: true }); up('KeyQ');
  down('KeyQ', { altKey: true }); up('KeyQ');
  assert.equal(fighter.skillUses.char, 1, '캐릭터 스킬이 나가지 않았다');
  assert.ok(!(fighter.spinRemaining > 0), '무기 스킬이 나가지 않았다');
});

console.log('');
console.log(passed + '개 키보드 스킬 테스트 통과');
