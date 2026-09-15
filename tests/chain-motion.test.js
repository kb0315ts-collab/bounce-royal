'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual browser/server physics, exposing only private helpers for
// deterministic carrier paths. No alternate test physics or runtime mutation.
function runtime() {
  const context = vm.createContext({ console, Math, performance });
  context.window = context;
  vm.runInContext(['js/data.js', 'js/sim.js'].map(file =>
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n')
    + '\nthis.testCore = { Battle, Arena, WEAPONS, GAME_SPEED, buildFighter, ensureChainHeads, updateChain, chainLen, chainSwap };', context);
  return context.testCore;
}
const T = runtime();
const player = id => ({ id, name: 'P' + id, charId: 'cat', weaponId: id ? 'sword' : 'chain',
  augments: [], color: '#4da6ff', isAI: false, coins: 5, wins: 0, losses: 0, streak: 0 });
function fixture({ arena = false, enemies = false, long = false, twin = false } = {}) {
  const b = new T.Battle('diamond', [player(0), player(1)]);
  b.phase = 'fight';
  if (!enemies) b.enemiesOf = () => [];
  if (!arena) b.arena = { reflectProj() {}, collideBody() {} };
  const [f, e] = b.fighters;
  f.x = f.y = 0; f.weaponAngle = Math.PI;
  f.flags.chainLong = long; f.flags.chainTwin = twin;
  f._chainAnchor = { x: 0, y: 0 };
  T.ensureChainHeads(f);
  return { b, f, e };
}
function setHead(f, x, y, vx, vy) {
  const h = f.chainHeads[0];
  Object.assign(h, { x, y, vx, vy });
  h.nodes.forEach((n, i) => {
    const t = (i + 1) / 5;
    Object.assign(n, { x: f.x + (x - f.x) * t, y: f.y + (y - f.y) * t, vx: vx * t, vy: vy * t });
  });
  return h;
}
function measure(f, metrics) {
  const length = T.chainLen(f);
  for (const h of f.chainHeads) {
    let previous = f;
    for (const q of h.nodes.concat(h)) {
      for (const key of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(q[key]), `finite ${key}`);
      const gap = Math.hypot(q.x - previous.x, q.y - previous.y);
      metrics.segmentError = Math.max(metrics.segmentError, gap - length / 5);
      metrics.velocity = Math.max(metrics.velocity, Math.hypot(q.vx, q.vy));
      previous = q;
    }
    metrics.reachError = Math.max(metrics.reachError, Math.hypot(h.x - f.x, h.y - f.y) - length);
    metrics.speed = Math.max(metrics.speed, Math.hypot(h.sx, h.sy));
  }
}
const metrics = () => ({ speed: 0, velocity: 0, segmentError: 0, reachError: 0 });

test('chain combat numbers and augmentation damage/range contracts remain unchanged', () => {
  assert.equal(T.WEAPONS.chain.dmg, 24);
  assert.equal(T.WEAPONS.chain.chainLen, 85);
  assert.equal(T.WEAPONS.chain.headR, 10);
  assert.equal(T.WEAPONS.chain.gate, 120);
  assert.equal(T.WEAPONS.chain.hitLock, 0.35);
  const { f } = fixture();
  assert.equal(T.chainLen(f), 85);
  f.flags.chainLong = true;
  assert.equal(T.chainLen(f), 130);
  f.timers.balloon = 2;
  assert.equal(T.chainLen(f), 130 * 1.6);
});

test('a turn retains inertia, carries the head past the carrier, and stays stable across frame rates', () => {
  const runs = [];
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 1 / 15]) {
    const { b, f } = fixture(), m = metrics();
    let afterTurn = null, crossed = false;
    for (let i = 0; i < Math.round(10 / dt); i++) {
      const time = i * dt, angle = time >= 4 ? Math.PI / 2 : 0;
      f.vx = Math.cos(angle); f.vy = Math.sin(angle);
      f.x += f.vx * f.st.move * T.GAME_SPEED * dt;
      f.y += f.vy * f.st.move * T.GAME_SPEED * dt;
      b.simT += dt; T.updateChain(b, f, dt); measure(f, m);
      const head = f.chainHeads[0];
      if (time >= 4 && afterTurn === null) afterTurn = head.x - f.x;
      if (time > 4 && head.x - f.x > 20) crossed = true;
    }
    assert.ok(afterTurn < -70, 'head keeps old momentum rather than rotating instantly');
    assert.ok(crossed, 'one intentional turn creates a usable swing');
    assert.ok(m.reachError < 1, 'rope stays within 1px solver tolerance of its defined range');
    assert.ok(m.segmentError < 0.5, 'rope joints converge without visible stretching');
    assert.ok(m.speed > 170 && m.speed < 240, 'a turn supplies a bounded attacking swing');
    runs.push(m.speed);
  }
  assert.ok(Math.max(...runs) - Math.min(...runs) < 5,
    `same turn must not depend on frame rate: ${runs.map(x => x.toFixed(2)).join(', ')}`);
});

test('completely collapsed stationary ropes open on their own without aiming at enemies', () => {
  const { b, f } = fixture(); f.weaponAngle = 0;
  const h = setHead(f, 0, 0, 0, 0);
  for (let i = 0; i < 240; i++) T.updateChain(b, f, 1 / 60);
  assert.ok(h.x > 65 && h.x <= 86, 'folded chain recovers useful reach');
  assert.ok(Math.abs(h.y) < 0.001, 'unfolding follows prior facing, not an external target');
  assert.ok(Math.hypot(h.vx, h.vy) < 60, 'recovery settles rather than becoming a runaway whip');
});

test('position swap retains old carrier velocity on the head and reflects the new carrier safely', () => {
  const { b, f } = fixture(); f.vx = 1; f.vy = 0;
  const oldSpeed = f.st.move, h = setHead(f, 50, 30, 0, 240);
  T.chainSwap(b, f);
  assert.equal(f.x, 50); assert.equal(f.y, 30);
  assert.equal(h.x, 0); assert.equal(h.y, 0);
  assert.equal(f.vx, 0); assert.equal(f.vy, 1);
  assert.equal(h.vx, oldSpeed); assert.equal(h.vy, 0, 'relaying must not overwrite exchanged momentum');
  assert.equal(f._chainAnchor.x, f.x); assert.equal(f._chainAnchor.y, f.y);
  const nearWall = fixture({ arena: true, twin: true });
  const nf = nearWall.f, nh = nf.chainHeads[0];
  nf.x = nearWall.b.arena.L - nf.radius * Math.SQRT2 - 12; nf.y = 0;
  nh.x = nearWall.b.arena.L - 10; nh.y = 0; nh.vx = 200; nh.vy = 0;
  T.chainSwap(nearWall.b, nf);
  assert.ok(Math.abs(nf.x) + Math.abs(nf.y) <= nearWall.b.arena.L - nf.radius * Math.SQRT2 + 0.001);
  assert.ok(nf.vx <= 0, 'swapped body receives the real wall reflection');
  for (const head of nf.chainHeads) assert.ok(Math.hypot(head.x - nf.x, head.y - nf.y) <= T.chainLen(nf) + 0.001);
});

test('teleport relaying never becomes sweep damage or an extreme impulse', () => {
  const { b, f, e } = fixture({ enemies: true });
  f.x = 220; f.y = 100;
  e.x = 150; e.y = 68; e._motionX = e.x; e._motionY = e.y;
  const hp = e.hp;
  T.updateChain(b, f, 1 / 60);
  const h = f.chainHeads[0];
  assert.equal(h._sweep.length, 0); assert.equal(h.sx, 0); assert.equal(h.sy, 0);
  assert.equal(e.hp, hp, 'cross-map repositioning cannot damage a victim');
  assert.ok(Math.hypot(h.x - f.x, h.y - f.y) <= T.chainLen(f) + 0.001);
  assert.ok(Math.hypot(h.vx, h.vy) <= f.st.move + 0.001);
});

test('fast whip sweep hits between render frames and honors the shared 0.35s target lock', () => {
  const { b, f, e } = fixture({ enemies: true });
  e.x = 40; e.y = 0; e._motionX = 40; e._motionY = 0;
  const h = setHead(f, 40, -40, 0, 1800), hp = e.hp;
  assert.ok(Math.hypot(h.x - e.x, h.y - e.y) > e.radius + T.WEAPONS.chain.headR);
  T.updateChain(b, f, 0.1);
  assert.ok(Math.hypot(h.x - e.x, h.y - e.y) > e.radius + T.WEAPONS.chain.headR);
  assert.equal(e.hp, hp - 24, 'crossing between clear endpoints still hits exactly once');
  assert.equal(f.chainHits.get(e.uid), 0.35);
  setHead(f, 40, -40, 0, 1800); b.simT = 0.1;
  T.updateChain(b, f, 0.1); assert.equal(e.hp, hp - 24);
  setHead(f, 40, -40, 0, 1800); b.simT = 0.35;
  T.updateChain(b, f, 0.1); assert.equal(e.hp, hp - 48);
});

test('twin heads keep 80 percent damage and do not double-hit one target on the same step', () => {
  const { b, f, e } = fixture({ enemies: true, twin: true });
  e.x = 40; e.y = 0; e._motionX = 40; e._motionY = 0;
  setHead(f, 40, -40, 0, 1800);
  f.chainHeads[1] = structuredClone(f.chainHeads[0]);
  const hp = e.hp; T.updateChain(b, f, 0.1);
  assert.ok(Math.abs((hp - e.hp) - 24 * 0.8) < 0.00001);
});

test('a stunned stationary victim does not fake attack speed from its nominal movement stat', () => {
  const { b, f, e } = fixture({ enemies: true });
  e.x = 70; e.y = 0; e.st.move = 600; e.vx = 1; e.vy = 0; e.timers.stun = 1;
  delete e._motionX; delete e._motionY;
  setHead(f, 70, 0, 0, 0);
  const hp = e.hp; T.updateChain(b, f, 1 / 60);
  assert.equal(e.hp, hp, 'static contact below speed gate is not an attack');
});

test('long and twin ropes stay finite, inside walls, and within range under sustained steering and slow frames', () => {
  for (const long of [false, true]) for (const twin of [false, true]) {
    const { b, f } = fixture({ arena: true, long, twin }), m = metrics();
    for (let i = 0; i < 2400; i++) {
      const dt = i % 120 === 0 ? 1 / 15 : 1 / 60;
      const angle = Math.atan2(f.vy, f.vx) + Math.sin(i / 53) * 1.1 * dt;
      f.vx = Math.cos(angle); f.vy = Math.sin(angle);
      f.x += f.vx * f.st.move * T.GAME_SPEED * dt;
      f.y += f.vy * f.st.move * T.GAME_SPEED * dt;
      b.arena.collideBody(f); b.simT += dt; T.updateChain(b, f, dt); measure(f, m);
      for (const h of f.chainHeads) for (const q of h.nodes.concat(h))
        assert.ok(Math.abs(q.x) + Math.abs(q.y) + q.r * Math.SQRT2 <= b.arena.L + 0.001, 'joint stays in arena');
    }
    assert.equal(f.chainHeads.length, twin ? 2 : 1);
    assert.ok(m.reachError < 1 && m.segmentError < 0.5, JSON.stringify({ long, twin, ...m }));
    assert.ok(m.velocity <= 2000.001 && m.speed < 450, 'no accumulating orbit energy');
  }
});
