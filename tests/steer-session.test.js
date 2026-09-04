'use strict';
/* ============================================================
 * 이동 조이스틱 세션
 *
 * 라운드가 시작되는 순간 조작이 '조준'에서 '조향'으로 바뀐다. 예전에는
 * 그때 포인터 세션을 통째로 끊었다. 손가락은 그대로 조이스틱을 당기고
 * 있는데 저 혼자 놓아진 것처럼 보였다. 손을 떼기 전에는 세션이 살아
 * 있어야 하고, 당기고 있던 방향 그대로 조향이 이어져야 한다.
 *
 * main.js를 가짜 DOM 위에 올려 진짜 포인터 이벤트로 확인한다.
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

/* ---------------- 조이스틱 세 조각만 가짜로 만든다 ---------------- */
function fakeEl(id, width) {
  const handlers = {};
  return {
    id,
    style: {},
    classList: {
      set: new Set(),
      add(...c) { c.forEach(x => this.set.add(x)); },
      remove(...c) { c.forEach(x => this.set.delete(x)); },
      toggle(x, on) { if (on) this.set.add(x); else this.set.delete(x); },
      contains(x) { return this.set.has(x); },
    },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width, height: width }; },
    querySelector() { return { style: {} }; },
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
    fire(type, ev) { for (const fn of (handlers[type] || [])) fn(ev); },
  };
}
const control = fakeEl('steer-control', 100);
const base = fakeEl('steer-base', 100);       // 조작 반지름: (100 - 40) / 2 = 30
const knob = fakeEl('steer-knob', 40);
const JOY = { 'steer-control': control, 'steer-base': base, 'steer-knob': knob };

/* 프레임은 내가 돌린다 */
let rafCb = null;
const step = time => { const fn = rafCb; rafCb = null; if (fn) fn(time); };

const stubClassList = { add() {}, remove() {}, toggle() {}, contains() { return true; } };
const canvas = {
  classList: stubClassList,
  addEventListener() {},
  getBoundingClientRect() { return { left: 0, top: 0, width: 840, height: 840 }; },
  setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
};
const sandbox = {
  console, Map, Set, Math, Date, URLSearchParams, performance,
  location: { search: '' },
  setTimeout, clearTimeout,
  addEventListener() {},
  requestAnimationFrame(fn) { rafCb = fn; return 1; },
  cancelAnimationFrame() { rafCb = null; },
  localStorage: { getItem() { return null; }, setItem() {} },
  navigator: {},
  canvas,
  VIEW: { ox: 0, oy: 0, s: 1 },
  $(id) { return JOY[id] || null; },      // 조이스틱만 실물, 나머지는 없는 셈 친다
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
  read('js/events.js'), read('js/main.js'),
  'globalThis.__api = { Game, Battle };',
].join('\n'), context, { filename: 'bounce-royal-steer.test.bundle.js' });
const { Game, Battle } = context.__api;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('O ' + name); }
  catch (err) { console.error('X ' + name); throw err; }
}

let pid = 0;
const mkPlayer = isAI => ({
  id: ++pid, name: 'P' + pid, isAI, color: '#4da6ff', charId: 'cat', weaponId: 'sword',
  coins: 5, coinsLost: 0, augments: [], augmentBaselines: {}, copiedSkill: null,
  gamble: false, trollCondition: false, damageRewardMult: 1,
  wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
});

function fresh() {
  control.classList.set.clear();
  const battle = new Battle('diamond', [mkPlayer(false), mkPlayer(true)]);
  Game.mode = 'single';
  Game.state = 'battle';
  Game.focus = battle;
  return { battle, fighter: battle.human() };
}
const pointer = (x, y) => ({ pointerId: 7, clientX: x, clientY: y, isPrimary: true, preventDefault() {} });
const CENTER = 50;

/* 라운드가 시작될 때까지 손을 댄 채로 돌린다 */
function runToFight(battle, from = 2000) {
  let frames = 0;
  for (let i = 0; i < 60 * 12 && battle.phase !== 'fight'; i++) {
    battle.update(1 / 60);
    step(from + i * 16);
    frames++;
  }
  step(from + frames * 16 + 200);
  return frames;
}

test('당긴 채로 라운드가 시작돼도 조이스틱이 놓아지지 않는다', () => {
  const { battle, fighter } = fresh();
  assert.equal(battle.phase, 'aim', '전투는 조준 단계에서 시작한다');

  control.fire('pointerdown', pointer(CENTER, CENTER));
  control.fire('pointermove', pointer(CENTER + 25, CENTER));    // 오른쪽으로 당긴다
  assert.equal(fighter.aimTouched, true, '당기는 동안 방향이 잡혀야 한다');
  assert.ok(Math.abs(Math.atan2(fighter.vy, fighter.vx)) < 1e-9, '당긴 쪽을 향해야 한다');

  const frames = runToFight(battle);
  assert.equal(battle.phase, 'fight', '라운드가 시작되어야 한다 (' + frames + '프레임)');

  assert.ok(control.classList.contains('active'),
    '손을 떼지 않았는데 조이스틱이 놓아졌다 — 라운드 시작에서 세션이 끊긴다');
  assert.equal(fighter.steer.active, true,
    '조향으로 이어지지 않았다 — 당기고 있던 입력이 사라졌다');
  assert.ok(Math.abs(fighter.steer.angle) < 1e-9,
    '당기고 있던 방향 그대로 조향해야 한다 (실제 ' + fighter.steer.angle + ')');
  control.fire('pointerup', pointer(CENTER + 25, CENTER));
});

test('손을 떼면 그때 조향이 풀린다', () => {
  const { battle, fighter } = fresh();
  control.fire('pointerdown', pointer(CENTER, CENTER));
  control.fire('pointermove', pointer(CENTER, CENTER + 25));
  runToFight(battle);
  assert.equal(fighter.steer.active, true, '떼기 전에는 조향 중이어야 한다');

  control.fire('pointerup', pointer(CENTER, CENTER + 25));
  assert.equal(fighter.steer.active, false, '떼면 조향이 풀려야 한다');
  assert.equal(control.classList.contains('active'), false);
});

test('조준 중에 마음을 바꾸면 마지막 방향으로 출발한다', () => {
  const { battle, fighter } = fresh();
  control.fire('pointerdown', pointer(CENTER, CENTER));
  control.fire('pointermove', pointer(CENTER + 25, CENTER));         // 오른쪽
  control.fire('pointermove', pointer(CENTER - 25, CENTER));         // 마음을 바꿔 왼쪽
  assert.ok(Math.abs(Math.abs(Math.atan2(fighter.vy, fighter.vx)) - Math.PI) < 1e-9,
    '확정 개념이 없으니 마지막으로 가리킨 쪽이어야 한다');

  runToFight(battle);
  assert.ok(Math.abs(Math.abs(fighter.steer.angle) - Math.PI) < 1e-9,
    '출발도 그 방향이어야 한다 (실제 ' + fighter.steer.angle + ')');
  control.fire('pointerup', pointer(CENTER - 25, CENTER));
});

test('당긴 채로 두면 조준 제한시간을 다 기다리지 않는다', () => {
  const { battle } = fresh();
  control.fire('pointerdown', pointer(CENTER, CENTER));
  control.fire('pointermove', pointer(CENTER + 25, CENTER));
  let secs = 0;
  for (let i = 0; i < 60 * 12 && battle.phase === 'aim'; i++) {
    battle.update(1 / 60); step(2000 + i * 16); secs += 1 / 60;
  }
  assert.notEqual(battle.phase, 'aim');
  assert.ok(secs < 3,
    '방향이 잡혔는데도 제한시간을 다 기다린다 (' + secs.toFixed(2) + '초) — 따로 확정해야만 넘어가는 셈이다');
  control.fire('pointerup', pointer(CENTER + 25, CENTER));
});

console.log('');
console.log(passed + '개 조이스틱 세션 테스트 통과');
