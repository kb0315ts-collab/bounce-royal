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
    _attrs: {},
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
    setAttribute(name, value) { el._attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(el._attrs, name) ? el._attrs[name] : null; },
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
  'event-cards', 'event-status', 'scr-weapon', 'scr-augment', 'scr-event',
  'steer-control', 'steer-label', 'hud-count', 'sk-char', 'sk-weapon']) ensure(id);
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
for (const id of ['sk-char', 'sk-weapon']) {
  for (const cls of ['lbl', 'ico', 'uses', 'cdoverlay']) {
    const child = makeEl('span'); child._classes.add(cls); ensure(id).appendChild(child);
  }
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
  'globalThis.__uiApi = { buildAugmentSelect, buildWeaponSelect, startPhaseTimer, stopPhaseTimer, selectionPlayers, updateSkillbar, updateCountdown, paintPortrait };',
].join('\n'), context, { filename: 'bounce-royal-ui.test.bundle.js' });

const { buildAugmentSelect, buildWeaponSelect, startPhaseTimer, stopPhaseTimer, updateSkillbar, updateCountdown, paintPortrait } = context.__uiApi;
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

test('스킬은 캐릭터·무기 두 칸으로 고정이다', () => {
  const fighter = {
    dead:false, mainDead:false, splitBalls:[], charId:'cat', weaponId:'sword',
    timers:{ stun:0, bind:0, dashPrep:0, dashT:0 }, flags:{},
    player:{}, skillUses:{ char:1, weapon:1 },
  };
  const battle = { phase:'fight', result:null, human:() => fighter };
  updateSkillbar(battle);
  assert.ok(!$('sk-common'), '셋째 스킬 칸은 없어져야 한다');
  assert.equal($('steer-control').style.display, '', '이동 조이스틱은 전투 중 보여야 한다');
  assert.equal($('steer-control').getAttribute('aria-disabled'), 'false');
  assert.equal($('steer-label').textContent, '꾹 눌러 천천히 조향');
});

test('두 칸 모두 자기 스킬 이름과 남은 횟수를 보여준다', () => {
  const fighter = {
    dead:false, mainDead:false, splitBalls:[], charId:'soft', weaponId:'bow',
    timers:{ stun:0, bind:0, dashPrep:0, dashT:0 }, flags:{},
    player:{}, skillUses:{ char:1, weapon:0 },
  };
  updateSkillbar({ phase:'fight', result:null, human:() => fighter });
  assert.equal($('sk-char').querySelector('.lbl').textContent, '말랑 방어');
  assert.equal($('sk-char').querySelector('.uses').textContent, '●');
  assert.equal($('sk-weapon').querySelector('.lbl').textContent, '차지 샷');
  assert.equal($('sk-weapon').querySelector('.uses').textContent, '○', '다 쓰면 빈 동그라미');
  assert.equal($('steer-control').getAttribute('aria-disabled'), 'false', '스킬과 조향은 함께 유지되어야 한다');
});

test('관전·강제 이동 상태에서는 조이스틱을 숨기거나 비활성화한다', () => {
  updateSkillbar(null);
  assert.equal($('steer-control').style.display, 'none', '내 전투가 없으면 조이스틱을 숨겨야 한다');

  const fighter = {
    dead:false, mainDead:false, splitBalls:[], charId:'cat', weaponId:'sword',
    timers:{ stun:0, bind:0, dashPrep:0, dashT:1 }, flags:{},
    player:{ copiedSkill:null }, skillUses:{ char:1, weapon:1, common:0 },
  };
  updateSkillbar({ phase:'fight', result:null, human:() => fighter });
  assert.equal($('steer-control').style.display, '');
  assert.equal($('steer-control').getAttribute('aria-disabled'), 'true');
  assert.equal($('steer-label').textContent, '강제 이동 · 조향 불가');
});


test('라운드 시작 카운트다운은 3 · 2 · 1을 한가운데에 띄운다', () => {
  const el = $('hud-count');
  updateCountdown(null);
  const seen = [];
  for (const left of [3.0, 2.6, 2.0, 1.4, 1.0, 0.3]) {
    updateCountdown({ phase: 'count', countT: left, result: null });
    if (el.textContent !== seen[seen.length - 1]) seen.push(el.textContent);
  }
  assert.deepEqual(seen, ['3', '2', '1'], '3 · 2 · 1 순서여야 한다 (실제 ' + seen.join(',') + ')');
  assert.ok(el.classList.contains('on'), '세는 동안에는 보여야 한다');

  updateCountdown({ phase: 'fight', countT: 0, result: null });
  assert.equal(el.classList.contains('on'), false, '전투가 시작되면 숫자를 치워야 한다');
  assert.equal(el.textContent, '');
});

/* 초상화 캔버스가 칸보다 큰 크기로 그려지면, 브라우저가 칸에 맞춰
 * 눌러 넣으면서 공이 찌그러진다. 상단 참가자 탭이 실제로 그랬다 —
 * 칸은 8cqw(약 32px)인데 하한 72로 그려 세로가 44%로 눌렸다. */
test('초상화는 칸 비율 그대로 그려진다 (눌리지 않는다)', () => {
  const fakeCtx = () => ({
    setTransform() {}, clearRect() {}, fillRect() {}, fillText() {},
    createRadialGradient() { return { addColorStop() {} }; },
  });
  const measure = (w, h) => {
    const el = makeEl('canvas');
    el.isConnected = true;
    el.clientWidth = w; el.clientHeight = h;
    el.getContext = fakeCtx;
    paintPortrait(el, 'cat', null, '#4da6ff');
    return el;
  };
  for (const [w, h] of [[91, 32], [91, 52], [167, 58], [200, 200]]) {
    const el = measure(w, h);
    const want = w / h, got = el.width / el.height;
    assert.ok(Math.abs(got - want) < 0.02,
      w + 'x' + h + ' 칸인데 캔버스는 ' + el.width + 'x' + el.height
      + ' — 화면에서 ' + (got < want ? '위아래로' : '좌우로') + ' 눌린다');
  }
  // 아직 화면에 없어 크기를 모를 때만 기본값으로 그린다
  const hidden = measure(0, 0);
  assert.ok(hidden.width > 0 && hidden.height > 0, '크기를 모를 때도 그리긴 해야 한다');
});

/* ============================================================
 * HUD 바닥 배치
 *
 * 조이스틱 쪽은 위로 스탯판, 반대편으로 스킬 버튼, 그 위로 경기장
 * 아래 꼭짓점에 둘러싸여 있다. 크기나 좌우를 손볼 때 어느 하나를
 * 덮으면 그 버튼이 통째로 안 눌린다. 실제로 두 번 그랬다.
 *
 * 좌우가 바뀔 수 있으므로 자리를 박아 두지 않고 index.html에 적힌
 * left/right·padding·justify-content를 그대로 읽어 상자를 세운다.
 * 좌표는 모두 cqw, 원점은 화면 왼쪽 아래.
 * ============================================================ */
{
  const html = read('index.html');
  const rule = sel => {
    const at = html.indexOf(sel + '{');
    if (at < 0) throw new Error(sel + ' 규칙을 찾지 못했다');
    return html.slice(at + sel.length + 1, html.indexOf('}', at));
  };
  const pick = (sel, prop) => {
    for (const decl of rule(sel).split(';')) {
      const c = decl.indexOf(':');
      if (decl.slice(0, c).trim() === prop) return decl.slice(c + 1).trim();
    }
    return null;
  };
  const num = (sel, prop, unit) => {
    const v = pick(sel, prop);
    if (v === null) throw new Error(sel + ' 의 ' + prop + '을 찾지 못했다');
    if (!v.endsWith(unit || 'cqw')) throw new Error(sel + ' 의 ' + prop + ' 단위가 바뀌었다: ' + v);
    return parseFloat(v);
  };

  const APP_H = 1280 / 7.2;                    // 720×1280 화면의 세로 = 177.78cqw
  const WORLD = (720 / 840) / 7.2;             // 월드 1유닛이 몇 cqw인가
  const L = 405, CX = 50, CY = APP_H / 2;      // 경기장 중심
  const HALF = L * WORLD;                      // 마름모 반대각선의 절반

  // 조이스틱 — 세로 flex(flex-start)라 원판이 상자 위쪽에 붙는다
  const jw = num('#steer-control', 'width'), jh = num('#steer-control', 'height');
  const jb = num('#steer-control', 'bottom'), D = num('#steer-base', 'width');
  const jLeft = pick('#steer-control', 'left');
  const jx = jLeft !== null ? parseFloat(jLeft) : 100 - num('#steer-control', 'right') - jw;
  const box = { x0: jx, x1: jx + jw, y0: jb, y1: jb + jh };
  const disc = { x: jx + jw / 2, y: jb + jh - D / 2, r: D / 2 };

  // 스킬 버튼 — 복사 스킬을 먹어 셋이 되는 때가 가장 빠듯하다
  const pad = pick('#skillbar', 'padding').split(/ +/).map(parseFloat);   // 위 오른 아래 왼
  const gap = num('#skillbar', 'gap'), size = num('.skillbtn', 'width');
  const span3 = size * 2 + gap;
  const toRight = pick('#skillbar', 'justify-content') === 'flex-end';
  const btn3 = toRight
    ? { x0: 100 - pad[1] - span3, x1: 100 - pad[1] }
    : { x0: pad[3], x1: pad[3] + span3 };
  btn3.y0 = pad[2]; btn3.y1 = pad[2] + size;

  // 좌하단 스탯판 — render.js drawStatPanel과 같은 식으로 다시 센다
  const padY = L * 0.022;
  const panel = {
    x0: CX + (-L) * WORLD,
    x1: CX + (-L + L * 0.532 + L * 0.024 * 2) * WORLD,
    y0: CY - (L * 0.62 + L * 0.062 * 5 + padY * 2) * WORLD,   // 아래끝
  };
  const covers = (a, b) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;

  test('조이스틱과 스킬 버튼이 서로 반대편에 있다', () => {
    const joyRight = disc.x > CX;
    assert.equal(toRight, !joyRight,
      '둘이 같은 쪽으로 몰렸다 (조이스틱 중심 ' + disc.x.toFixed(1) + 'cqw, 스킬 버튼 '
      + (toRight ? '오른쪽' : '왼쪽') + ') — 한 손으로 둘 다 눌러야 한다');
  });

  test('조이스틱이 스킬 버튼을 덮지 않는다', () => {
    assert.ok(!covers(box, btn3), '조이스틱 상자(x ' + box.x0.toFixed(1) + '~' + box.x1.toFixed(1)
      + ')가 스킬 버튼(x ' + btn3.x0.toFixed(1) + '~' + btn3.x1.toFixed(1)
      + ')을 덮는다 — 그 버튼은 눌리지 않는다');
  });

  test('조이스틱도 스킬 버튼도 좌하단 스탯판을 가리지 않는다', () => {
    const p = { x0: panel.x0, x1: panel.x1, y0: panel.y0, y1: Infinity };
    assert.ok(!covers(box, p), '조이스틱 위끝 ' + box.y1.toFixed(1)
      + 'cqw 가 스탯판 아래끝 ' + panel.y0.toFixed(1) + 'cqw 를 넘었다');
    assert.ok(!covers(btn3, p), '스킬 버튼 위끝 ' + btn3.y1.toFixed(1)
      + 'cqw 가 스탯판 아래끝 ' + panel.y0.toFixed(1) + 'cqw 를 넘었다');
  });

  test('조이스틱 원판이 경기장 안으로 들어오지 않는다', () => {
    let worst = -Infinity;
    for (let a = 0; a < 360; a += 2) {
      const px = disc.x + Math.cos(a * Math.PI / 180) * disc.r;
      const py = disc.y + Math.sin(a * Math.PI / 180) * disc.r;
      worst = Math.max(worst, HALF - (Math.abs(px - CX) + Math.abs(py - CY)));
    }
    assert.ok(worst < 0, '조이스틱이 경기장을 ' + worst.toFixed(1) + 'cqw 파고든다');
  });

  test('시작 방향 문구 띠가 조이스틱·라운드 정보와 겹치지 않는다', () => {
    const hintRight = 100 - num('#hud-hint', 'right');
    const top = parseFloat(pick('#hud-hint', 'top')) / 100 * APP_H;   // 화면 위에서
    const HINT_H = 7;                          // 한 줄 + 여백을 넉넉히 잡은 값
    const roundBox = 100 - 2.5 - 21;           // #hud-top: right 2.5cqw, min-width 21cqw
    assert.ok(hintRight <= roundBox, '문구 오른끝 ' + hintRight.toFixed(1)
      + 'cqw 가 라운드 정보 ' + roundBox.toFixed(1) + 'cqw 를 침범한다');
    assert.ok(top >= 0.152 * APP_H, '문구가 참가자 패널 밑으로 내려와야 한다');
    assert.ok(top + HINT_H <= CY - HALF, '문구가 경기장 위 꼭짓점을 덮는다');
    assert.ok(box.y1 <= APP_H - (top + HINT_H),
      '문구가 조이스틱과 겹친다 — 조향 중에 손가락 자리를 가린다');
  });
}

console.log('');
console.log(passed + '개 선택 화면 테스트 통과');
