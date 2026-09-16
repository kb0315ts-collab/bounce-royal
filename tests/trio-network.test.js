'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../server/game-core.js');
const { snapshot } = require('../server/snapshot.js');
const { lerpSnapshot, netBattleView } = require('../js/net.js');

const names = ['giantBlade', 'dualDagger', 'shotgun', 'bayonet', 'chainLong', 'chainBarbed', 'chainTwin',
  'flamePressure', 'flameEmber', 'flameThrust', 'discGrip', 'discMagnet', 'discRicochet'];
const player = (id, weaponId = 'chain') => ({ id, name: 'P' + id, charId: 'cat', weaponId,
  color: '#4da6ff', isAI: false, coins: 5, augments: [], wins: 0, losses: 0, streak: 0 });
function fixture(weaponId = 'chain') {
  const players = [player(0, weaponId), player(1, 'sword')];
  const b = new core.Battle('diamond', players);
  b.spawnSplits(b.fighters[0]);
  return { b, f: b.fighters[0], split: b.fighters[0].splitBalls[0], players };
}
function rope(x = 0, y = 0) {
  return { x: x + 80, y: y + 4, vx: 140, vy: 20,
    nodes: Array.from({ length: 4 }, (_, i) => ({ x: x + i * 16, y: y + i * 8, vx: 10, vy: 3 })) };
}
const body = (id = 1) => ({ u: id, p: id, x: 0, y: 0, a: 0, r: 22, h: 100, m: 100,
  s: 0, d: 0, md: 0, fl: 0, sm: [], sp: [], sa: [], ti: {}, su: [1, 0] });
const snap = () => ({ ph: 'fight', t: 2, sh: 0, L: 320, pil: [], f: [body()], pr: [], ce: [] });
const points = (offset = 0) => Array.from({ length: 10 }, (_, i) => i * 2 + offset);
const near = (a, b) => assert.ok(Math.abs(a - b) <= 0.051, `${a} differs from ${b}`);

test('all nine new visual flags round-trip independently while original bits remain stable', () => {
  const { b, f, split, players } = fixture();
  for (let i = 0; i < names.length; i++) {
    f.flags = { [names[i]]: 1 }; split.flags = { [names[i]]: 1 };
    const wire = snapshot(b), view = netBattleView(wire, players, 0).fighters[0];
    assert.equal(wire.f[0].fg, 1 << i);
    assert.equal(wire.f[0].sp[0].fg, 1 << i);
    for (const name of names) {
      assert.equal(view.flags[name], name === names[i]);
      assert.equal(view.splitBalls[0].flags[name], name === names[i]);
    }
    assert.deepEqual(wire.f[0].su, [f.skillUses.char, 0]);
  }
});

test('main and split twin ropes retain every node, owner, and head through snapshots', () => {
  const { b, f, split, players } = fixture();
  f.chainHeads = [rope(1.12, 2.32), rope(30, 40)];
  split.chainHeads = [rope(90.16, 30.73), rope(-20, -40)];
  const wire = snapshot(b), view = netBattleView(wire, players, 0).fighters[0];
  assert.equal(wire.f[0].cn.length, 20);
  assert.equal(wire.f[0].sp[0].cn.length, 20);
  assert.equal(view.splitBalls[0].uid, split.uid);
  for (const [actual, restored] of [[f, view], [split, view.splitBalls[0]]]) {
    assert.equal(restored.chainHeads.length, 2);
    restored.chainHeads.forEach((head, i) => {
      near(head.x, actual.chainHeads[i].x); near(head.y, actual.chainHeads[i].y);
      assert.equal(head.nodes.length, 4);
      head.nodes.forEach((n, j) => {
        near(n.x, actual.chainHeads[i].nodes[j].x); near(n.y, actual.chainHeads[i].nodes[j].y);
      });
    });
  }
});

test('actual flame firing excludes held input while blocked, dead, or empty on mains and splits', () => {
  const { b, f, split } = fixture('flame');
  const conditions = [null, 'stun', 'weaponLock', 'mainDead', 'dead', 'fuel', 'released'];
  for (const condition of conditions) {
    for (const x of [f, split]) {
      x.flame = { on: condition !== 'released', fuel: condition === 'fuel' ? 0 : 70, idle: 0 };
      x.timers.stun = condition === 'stun' ? 1 : 0;
      x.timers.weaponLock = condition === 'weaponLock' ? 1 : 0;
      x.mainDead = condition === 'mainDead'; x.dead = condition === 'dead';
    }
    const wire = snapshot(b).f[0];
    assert.equal(wire.fo, condition ? 0 : 1, condition || 'active');
    if (condition !== 'dead') assert.equal(wire.sp[0].fo, condition ? 0 : 1);
    else assert.ok(!wire.sp.some(s => s.u === split.uid), 'dead split is not painted');
  }
});

test('chain and thrown shield geometry interpolate for mains and uid-matched split bodies', () => {
  const a = snap(), b = snap();
  a.f[0].cn = points(); b.f[0].cn = points(20);
  a.f[0].dc = [10, 20, 15, 0]; b.f[0].dc = [30, 40, 18, 1];
  a.f[0].sp = [{ ...body(8), cn: points(10), dc: [40, 50, 12, 0] }, body(9)];
  b.f[0].sp = [body(9), { ...body(8), x: 10, cn: points(30), dc: [60, 70, 13, 1] }];
  const original = JSON.stringify([a, b]), mid = lerpSnapshot(a, b, 0.5, 50);
  assert.deepEqual(mid.f[0].cn, points(10));
  assert.deepEqual(mid.f[0].dc, [20, 30, 18, 1]);
  assert.equal(mid.f[0].sp[1].x, 5);
  assert.deepEqual(mid.f[0].sp[1].cn, points(20));
  assert.deepEqual(mid.f[0].sp[1].dc, [50, 60, 13, 1]);
  assert.equal(JSON.stringify([a, b]), original, 'interpolation must not change wire records');
});

test('new, removed, resized and teleported weapon geometry never blends with an unrelated object', () => {
  const a = snap(), b = snap();
  a.f[0].cn = points(); b.f[0].cn = points().concat(points(20));
  a.f[0].dc = [0, 0, 15, 0]; b.f[0].dc = [300, 20, 15, 0];
  let mid = lerpSnapshot(a, b, 0.5, 50);
  assert.deepEqual(mid.f[0].cn, b.f[0].cn);
  assert.deepEqual(mid.f[0].dc, b.f[0].dc);
  b.f[0].cn = points(400); b.f[0].x = 400;
  mid = lerpSnapshot(a, b, 0.5, 50);
  assert.equal(mid.f[0].x, 400);
  assert.deepEqual(mid.f[0].cn, points(400));
  delete b.f[0].cn; delete b.f[0].dc; b.f[0].x = 0;
  mid = lerpSnapshot(a, b, 0.5, 50);
  assert.ok(!('cn' in mid.f[0]) && !('dc' in mid.f[0]));
  delete a.f[0].cn; b.f[0].cn = points(50);
  assert.deepEqual(lerpSnapshot(a, b, 0.5, 50).f[0].cn, points(50));
});

test('short chain swaps snap the parent and its splits once, then ordinary movement resumes', () => {
  const a = snap(), b = snap();
  a.f[0].cn = points(); b.f[0].cn = points(40); b.f[0].x = 40;
  a.f[0].sp = [{ ...body(8), cn: points() }];
  b.f[0].sp = [{ ...body(8), x: 40, cn: points(40) }];
  b.ce = [{ seq: 17, type: 'skill', source: 'skill:chain', actor: 1 }];
  const swap = lerpSnapshot(a, b, 0.5, 50);
  assert.equal(swap.f[0].x, 40); assert.equal(swap.f[0].sp[0].x, 40);
  assert.deepEqual(swap.f[0].cn, points(40));
  a.ce = b.ce;
  const normal = lerpSnapshot(a, b, 0.5, 50);
  assert.equal(normal.f[0].x, 20); assert.equal(normal.f[0].sp[0].x, 20);
});

test('grip duration round-trips without adding inactive fields and older snapshot defaults remain safe', () => {
  const { b, f, split, players } = fixture('shield');
  f.gripT = 0.016; split.gripT = 2.24;
  let wire = snapshot(b), view = netBattleView(wire, players, 0).fighters[0];
  assert.equal(wire.f[0].gt, 0.1); assert.equal(view.gripT, 0.1);
  assert.equal(view.splitBalls[0].gripT, 2.2);
  f.gripT = 0; split.gripT = 0; wire = snapshot(b);
  assert.ok(!('gt' in wire.f[0])); assert.ok(!('gt' in wire.f[0].sp[0]));
  wire.f[0].fg = 8; delete wire.f[0].sp[0].fg;
  wire.f[0].sp[0].cn = [20, 30, 40, 50];
  view = netBattleView(wire, players, 0).fighters[0];
  assert.equal(view.gripT, 0); assert.equal(view.splitBalls[0].gripT, 0);
  assert.equal(view.flags.bayonet, true); assert.equal(view.flags.chainLong, false);
  assert.equal(view.splitBalls[0].flags.bayonet, true);
  assert.equal(view.splitBalls[0].chainHeads.length, 2, 'legacy head-only ropes remain visible');
});

test('the rope tie angle crosses the network so twin ropes draw from opposite sides', () => {
  const players = [player(0, 'chain'), player(1, 'sword')];
  const b = new core.Battle('diamond', players);
  const f = b.fighters[0];
  f.flags.chainTwin = 1;
  b.phase = 'fight';
  for (let i = 0; i < 90; i++) b.update(1 / 60);
  const wire = snapshot(b), view = netBattleView(wire, players, 0).fighters[0];
  assert.ok(Number.isFinite(wire.f[0].ca), '매인 자리 각도를 싣는다');
  assert.equal(view.chainHeads.length, 2);
  const wrap = d => Math.atan2(Math.sin(d), Math.cos(d));
  for (let i = 0; i < 2; i++) near(wrap(view.chainHeads[i].attach - f.chainHeads[i].attach), 0);
  near(Math.abs(wrap(view.chainHeads[1].attach - view.chainHeads[0].attach)), Math.PI);
  // 스냅샷 사이에서도 각도가 섞인다
  const later = snapshot(b); later.f[0].ca = wire.f[0].ca + 0.4;
  const mid = lerpSnapshot(wire, later, 0.5, 50);
  near(mid.f[0].ca, wire.f[0].ca + 0.2);
});
