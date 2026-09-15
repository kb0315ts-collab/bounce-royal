'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime() {
  let randomCalls = 0;
  const math = Object.create(Math);
  math.random = () => { randomCalls++; return 0.5; };
  const sandbox = {
    console, Math: math, performance: { now: () => 4300 },
    document: { getElementById: () => ({ clientWidth: 720, clientHeight: 1280 }) },
    Phaser: { Scene: class {}, Game: class {}, Scale: {}, WEBGL: 2 },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = ['js/data.js', 'js/sim.js', 'js/render.js']
    .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  vm.runInContext(source + '\nglobalThis.api = {CHARACTERS, WEAPONS, graphicsForCanvas, drawBall, drawBallG, drawWeapon, drawWeaponG, drawFighterAura, drawArena, drawGroundFx, drawProjectiles, drawFx, drawLoadoutPortrait, drawUnits, drawUnitUI};', sandbox);
  return { ...sandbox.api, randomCalls: () => randomCalls };
}

function recordingContext() {
  const calls = [], state = { depth: 0 };
  const context = new Proxy({}, {
    set(target, key, value) { calls.push(['set', key, value]); target[key] = value; return true; },
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), key + ' has finite coordinates');
        if (key === 'save') state.depth++;
        if (key === 'restore') { state.depth--; assert.ok(state.depth >= 0, 'balanced restore'); }
        calls.push([key, ...args]);
      };
    },
  });
  return { context, calls, state };
}

test('canvas grid paint stays inside the active arena, even when unused dimensions differ', () => {
  const api = runtime();
  for (const type of ['diamond', 'circle', 'square']) {
    const recorder = recordingContext(), g = api.graphicsForCanvas(recorder.context);
    const arena = {type, L:280, R:378, H:300, pillars:[], cube:null};
    api.drawArena(g, g, {arena});
    let width = 0, points = 0;
    for (const call of recorder.calls) {
      if (call[0] === 'set' && call[1] === 'lineWidth') width = call[2];
      if (width !== 1.6 || !['moveTo','lineTo'].includes(call[0])) continue;
      const [,x,y] = call;
      const inside = type === 'diamond' ? Math.abs(x)+Math.abs(y)<=arena.L : type === 'circle' ? Math.hypot(x,y)<=arena.R : Math.max(Math.abs(x),Math.abs(y))<=arena.H;
      assert.ok(inside, type + ' grid is decoration inside the ring, never stars outside');
      points++;
    }
    assert.equal(points,28,'All seven pairs of grid lines were checked');
  }
});

function fighter(charId = 'cat', weaponId = 'sword') {
  return {
    charId, weaponId, color: '#4da6ff', x: 21, y: -35, radius: 22,
    vx: 0.6, vy: 0.8, weaponAngle: 1.2, flash: 0.07, gunFlash: 0.08,
    charging: { t: 1.1 }, rocketActive: true, spinRemaining: 3,
    flags: {}, gun: { reloadT: 0 },
    timers: { balloon: 0, rampage: 0, immune: 0, untouchable: 0, freeze: 0, actingDead: 0 },
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

test('six faceless characters × six weapons use identical Canvas and Phaser geometry without mutating fighters', () => {
  const r = runtime();
  for (const charId of Object.keys(r.CHARACTERS)) {
    for (const weaponId of Object.keys(r.WEAPONS)) {
      const f = deepFreeze(fighter(charId, weaponId)), before = JSON.stringify(f);
      const a = recordingContext(), b = recordingContext();
      const ga = r.graphicsForCanvas(a.context);
      r.drawBallG(ga, f, f.x, f.y, f.radius, { spin: 1.2 });
      r.drawWeaponG(ga, f);
      r.drawBall(b.context, f, f.x, f.y, f.radius, { spin: 1.2 });
      r.drawWeapon(b.context, f);
      assert.deepEqual(a.calls, b.calls, charId + '/' + weaponId);
      assert.equal(a.state.depth, 0); assert.equal(b.state.depth, 0);
      assert.equal(JSON.stringify(f), before);
      assert.ok(a.calls.length > 20);
    }
  }
  assert.equal(r.randomCalls(), 0, 'drawing does not consume simulation randomness');
});

test('powered-up, frozen, immune and enlarged weapon variants stay finite with balanced transforms', () => {
  const r = runtime(), c = recordingContext(), g = r.graphicsForCanvas(c.context);
  for (const weaponId of Object.keys(r.WEAPONS)) {
    const f = fighter('bomb', weaponId);
    f.flags = { giantBlade: true, dualDagger: true, shotgun: true };
    Object.assign(f.timers, { balloon: 2, rampage: 2, immune: 1, freeze: 1, actingDead: 1, berserk: 1, fuse: 0.5, dashPrep: 0.5 });
    deepFreeze(f);
    r.drawFighterAura(g, f, f.x, f.y, f.radius);
    r.drawBallG(g, f, f.x, f.y, f.radius);
    r.drawWeaponG(g, f);
  }
  const reload = fighter('cat', 'pistol'); reload.flags.bayonet = true; reload.gun.reloadT = 1;
  r.drawWeaponG(g, deepFreeze(reload));
  assert.equal(c.state.depth, 0);
  assert.equal(r.randomCalls(), 0);
});

test('every retained arena, projectile and comic effect draws without writes or glow dependencies', () => {
  const r = runtime(), c = recordingContext(), g = r.graphicsForCanvas(c.context);
  for (const type of ['diamond', 'circle', 'square']) {
    r.drawArena(g, g, deepFreeze({ arena: { type, L: 405, R: 340, H: 330,
      pillars: [{ x: 50, y: 30, r: 24 }], cube: { x: 0, y: 0, spin: 0.4, active: true } } }));
  }
  const owner = { color: '#ff6879' };
  r.drawGroundFx(g, g, deepFreeze({ stickies: [{ x: 0, y: 0, r: 14, life: 1 }],
    flames: [{ x: 4, y: 8, r: 12, life: 1 }], mines: [{ x: 9, y: 5, r: 11, arm: 0, owner }],
    // 던져 둔 방패는 날 때와 멈췄을 때가 다르게 그려진다 — 둘 다 태운다.
    fighters: [{ color: '#ff6879', disc: { x: 30, y: 12, r: 15, resting: false } },
      { color: '#59c6ff', disc: { x: -40, y: 20, r: 15, resting: true } },
      { color: '#ffd24d', disc: null }] }));
  const kinds = ['arrow', 'charge', 'bullet', 'orb', 'missile', 'shuriken', 'beam'];
  r.drawProjectiles(g, g, deepFreeze({ projectiles: kinds.map((kind, i) => ({ kind, x: i * 20, y: 0, r: 8, ang: 0.4, owner })) }));
  const sc = { useText() { return { setAlpha() {} }; } };
  r.drawFx(g, g, deepFreeze({
    fx: [{ type: 'ring', x: 0, y: 0, r0: 8, r1: 60, t: 0.1, dur: 0.5, color: '#ffcc55', boom: true },
      { type: 'bolt', t: 0.1, color: '#ffcc55', segs: [{ x: 0, y: 0 }, { x: 20, y: 20 }] },
      { type: 'shatter', x: 0, y: 0, r: 22, t: 0.1 }],
    particles: [{ x: 0, y: 0, vx: 30, vy: 40, t: 0.1, life: 1, size: 4, color: '#ffcc55' },
      { x: 0, y: 0, t: 0.1, life: 1, size: 4, color: '#ffcc55', shard: true, ang: 0.2, spin: 0.3 }],
    popups: [{ x: 0, y: 0, txt: '24', big: true, color: '#ffcc55', t: 0.4 }],
  }), sc);
  assert.equal(c.state.depth, 0);
  assert.equal(r.randomCalls(), 0);
});

test('loadout portrait reuses the same art and respects the shared mobile pixel budget', () => {
  const r = runtime(), c = recordingContext();
  const target = { clientWidth: 180, clientHeight: 130, getContext: () => c.context };
  r.drawLoadoutPortrait(target, 'bomb', 'staff', '#ff6879');
  assert.equal(target.width, 180); assert.equal(target.height, 130);
  assert.equal(c.state.depth, 0);
  assert.equal(r.graphicsForCanvas(c.context), r.graphicsForCanvas(c.context), 'adapter is cached per canvas');
});

/* 분열체는 본체가 죽은 뒤 몸을 대신한다. 체력바도 무기도 없이 굴러다니면
 * 남은 체력도 무슨 무기인지도 읽을 수가 없다. 둘 다 그려져야 한다. */
test('split balls carry their own health bar and hold the weapon', () => {
  const r = runtime();
  const split = (x, hp, weaponAngle) => ({ dead: false, x, y: 0, r: 11, radius: 11,
    hp, maxHp: 40, shield: 0, flash: 0, weaponAngle, charging: null,
    gun: { reloadT: 0, focus: false }, chainHeads: null, flame: null, disc: null });
  const base = {
    uid: 1, pid: 1, name: '분열', color: '#ff6879', charId: 'cat',
    x: 0, y: 0, radius: 16, weaponAngle: 0, hp: 0, maxHp: 400, shield: 0,
    mainDead: true, dead: false, flash: 0, vx: 1, vy: 0,
    flags: {}, timers: { stun: 0, immune: 0, untouchable: 0, freeze: 0, actingDead: 0,
      balloon: 0, rampage: 0, gunBarrage: 0, berserk: 0, dashPrep: 0, dashT: 0 },
    summons: [], satellites: [], charging: null, gun: null, chainHeads: null,
    flame: null, disc: null, gunFlash: 0,
    splitBalls: [split(-40, 40, 0.5), split(40, 10, 2.1)],
  };
  for (const weaponId of Object.keys(r.WEAPONS)) {
    const c = recordingContext(), g = r.graphicsForCanvas(c.context);
    const b = { fighters: [{ ...base, weaponId }] };
    r.drawUnits(g, b);
    assert.equal(c.state.depth, 0, weaponId + ' balances save/restore');
    // 두 분열체가 서로 다른 각도로 무기를 든다 — 본체 각도를 빌려 쓰지 않는다.
    const spins = c.calls.filter(k => k[0] === 'rotate').map(k => k[1]);
    if (!['chain', 'flame'].includes(weaponId)) {
      assert.ok(spins.includes(0.5) && spins.includes(2.1), weaponId + ' uses each split angle');
    }
    const ui = recordingContext(), gu = r.graphicsForCanvas(ui.context);
    r.drawUnitUI(gu, b, { useText: () => ({ setAlpha() {} }) });
    // 체력이 다르면 체력바 너비도 달라야 한다. 하나만 그렸으면 걸린다.
    const bars = ui.calls.filter(k => k[0] === 'fillRect').map(k => k[3]);
    assert.ok(bars.includes(28) && bars.includes(7), weaponId + ' draws a bar per split');
  }
});
