'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const art = require('../js/augment-art.js');

function runtime() {
  let randomCalls = 0;
  const math = Object.create(Math);
  math.random = () => { randomCalls++; return .5; };
  const sandbox = {
    Math: math, console, performance: { now: () => 4300 },
    document: { getElementById: () => ({ clientWidth: 720, clientHeight: 1280 }) },
    Phaser: { Scene: class {}, Game: class {}, Scale: {}, WEBGL: 2 }, addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(['js/data.js', 'js/sim.js', 'js/render.js'].map(read).join('\n') +
    '\nglobalThis.api={drawFlameG,drawChainG,drawGroundFx,drawLoadoutPortrait};', sandbox);
  return { ...sandbox.api, randomCalls: () => randomCalls };
}

function recorder() {
  const calls = [], paths = [];
  let points = [], color, depth = 0;
  const g = new Proxy({}, { get: (_, name) => (...args) => {
    args.forEach(v => { if (typeof v === 'number') assert.ok(Number.isFinite(v), String(name)); });
    if (name === 'save') depth++;
    if (name === 'restore') assert.ok(--depth >= 0, 'balanced transforms');
    if (name === 'beginPath') points = [];
    if (name === 'moveTo' || name === 'lineTo') points.push(args);
    if (name === 'fillStyle') color = args[0];
    if (name === 'fillPath') paths.push({ color, points: points.slice() });
    calls.push([name, ...args]);
  } });
  return { g, calls, paths, depth: () => depth };
}

const freeze = v => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
};
const fighter = () => ({ x: 0, y: 0, radius: 22, weaponAngle: 0, flags: {}, timers: {}, color: '#84dcf0',
  flame: { on: true, fuel: 60 }, chainHeads: [{ x: 85, y: 8, nodes: [{ x: 18, y: -7 }, { x: 35, y: -17 }, { x: 54, y: -15 }, { x: 70, y: -7 }] }] });

test('new dedicated art uses real weapon silhouettes, not generic defence or satellites', () => {
  const d = id => art.descriptors['aug-' + id];
  for (const id of ['sh_magnet', 'sh_ricochet', 'sh_grip']) assert.equal(d(id).base, 'disc');
  assert.equal(d('sh_magnet').condition, 'magnet'); assert.equal(d('sh_grip').condition, 'grip');
  assert.equal(d('f_pressure').base, 'flameJet'); assert.equal(d('f_thrust').condition, 'recoil');
  assert.equal(d('f_ember').base, 'emberJet');
  assert.equal(d('c_long').base, 'weightedChain'); assert.equal(d('c_barbed').base, 'barbedChain');
  assert.equal(d('c_quake').base, 'quakeChain'); assert.equal(d('c_quake').condition, 'wall');
  const sandbox = {}; vm.runInNewContext(read('js/icons.js'), sandbox);
  for (const weapon of ['flame', 'chain', 'shield']) {
    assert.ok(sandbox.BRIcons.has('skill-' + weapon));
    assert.equal(sandbox.BRIcons.resolve('weapon-' + weapon), weapon);
    assert.notEqual(sandbox.BRIcons.markup('skill-' + weapon), sandbox.BRIcons.markup(weapon));
    assert.doesNotMatch(sandbox.BRIcons.markup('skill-' + weapon), /undefined|NaN|<image|<filter|<script/);
  }
  for (const id of ['f_pressure', 'f_ember', 'f_thrust']) {
    assert.doesNotMatch(sandbox.BRIcons.legacyMarkup('aug-' + id), /undefined/);
  }
});

test('flame paint follows center-based range and angle, and never shows a blocked or empty spray', () => {
  const api = runtime();
  for (const pressure of [false, true]) for (const scale of [.6, 1, 1.6]) {
    const f = fighter(); f.flags.flamePressure = pressure;
    freeze(f); const before = JSON.stringify(f), r = recorder();
    api.drawFlameG(r.g, f, scale);
    const flame = r.paths.filter(p => [0xff9850, 0xffd256, 0xfff6dc].includes(p.color));
    assert.equal(flame.length, 3, 'three readable flame tongues');
    const range = (pressure ? 140 : 114) * scale, half = pressure ? .26 : .35;
    for (const p of flame.flatMap(p => p.points)) {
      assert.ok(Math.hypot(...p) <= range + 1e-6, 'paint stays inside actual range');
      assert.ok(Math.abs(Math.atan2(p[1], p[0])) <= half + 1e-6, 'paint stays inside actual cone');
    }
    const reach = Math.max(...flame.flatMap(p => p.points).map(p => Math.hypot(...p)));
    assert.ok(reach > range * 0.9, `paint reaches the real range, not a shorter one (${reach.toFixed(1)} / ${range})`);
    assert.equal(r.depth(), 0); assert.equal(JSON.stringify(f), before);
  }
  for (const change of [f => f.flame.on = false, f => f.flame.fuel = 0, f => f.dead = true,
    f => f.mainDead = true, f => f.timers.stun = 1, f => f.timers.weaponLock = 1]) {
    const f = fighter(); change(f); const r = recorder(); api.drawFlameG(r.g, freeze(f), 1);
    assert.equal(r.paths.filter(p => p.color === 0xff9850).length, 0);
  }
  assert.equal(api.randomCalls(), 0);
});

test('long/barbed/twin chains and thrown discs render bounded geometry without simulation writes', () => {
  const api = runtime();
  for (const twin of [false, true]) for (const barbed of [false, true]) {
    const f = fighter(); f.flags.chainBarbed = barbed;
    if (twin) f.chainHeads.push({ x: -110, y: 0, nodes: [{ x: -22, y: 9 }, { x: -50, y: 16 }, { x: -85, y: 8 }] });
    freeze(f); const before = JSON.stringify(f), r = recorder();
    api.drawChainG(r.g, f, 1);
    const links = r.calls.filter(c => c[0] === 'fillEllipse');
    assert.ok(links.length > 5 && links.length <= 36, 'at most three links per real segment');
    const barbs = r.calls.filter(c => c[0] === 'fillTriangle');
    assert.equal(barbs.length > 0, barbed);
    assert.equal(r.depth(), 0); assert.equal(JSON.stringify(f), before);
  }
  for (const resting of [false, true]) {
    const b = freeze({ stickies: [], flames: [], mines: [], fighters: [
      { color: '#84dcf0', disc: { x: 100, y: 50, r: 15, resting } },
    ] });
    const r = recorder(); api.drawGroundFx(r.g, r.g, b); assert.equal(r.depth(), 0);
    assert.ok(r.calls.length > 25, 'held disc art and thrown disc art share complete details');
  }
  assert.equal(api.randomCalls(), 0);
});

test('chain portrait includes a visible, hanging weapon without initializing any physics', () => {
  const api = runtime(), r = recorder();
  const target = { clientWidth: 180, clientHeight: 130, getContext: () => r.g };
  api.drawLoadoutPortrait(target, 'cat', 'chain', '#84dcf0');
  assert.ok(r.calls.some(c => c[0] === 'translate' && c[1] > 110), 'the weight is drawn beside the player');
  assert.equal(r.depth(), 0); assert.equal(api.randomCalls(), 0);
});
