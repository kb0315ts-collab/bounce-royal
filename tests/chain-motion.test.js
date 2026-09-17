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
    + '\nthis.testCore = { Battle, Arena, WEAPONS, GAME_SPEED, buildFighter, ensureChainHeads, updateChain, chainLen, chainSwap, MELEE_ASPD_GAIN, ropeLen, chainAttach, CHAIN_MAX_STRETCH, CHAIN_WALL_BOUNCE, CHAIN_BODY_BOUNCE, CHAIN_REHIT_GAP, CHAIN_MAX_SPD, springChainRope, setSteerInput };', context);
  return context.testCore;
}
const T = runtime();
const player = id => ({ id, name: 'P' + id, charId: 'cat', weaponId: id ? 'sword' : 'chain',
  augments: [], color: '#4da6ff', isAI: false, coins: 5, wins: 0, losses: 0, streak: 0 });
function fixture({ arena = false, enemies = false, long = false } = {}) {
  const b = new T.Battle('diamond', [player(0), player(1)]);
  b.phase = 'fight';
  if (!enemies) b.enemiesOf = () => [];
  if (!arena) b.arena = { reflectProj() {}, collideBody() {} };
  const [f, e] = b.fighters;
  f.x = f.y = 0; f.weaponAngle = Math.PI;
  f.flags.chainLong = long;
  f._chainAnchor = { x: 0, y: 0 };
  T.ensureChainHeads(f);
  return { b, f, e };
}
// 줄은 공 표면에 매여 있다. 추를 옮기면 매인 자리도 추 쪽 표면으로 두고
// 마디를 그 사이에 깐다 — 가운데에서 깔면 있을 수 없는 줄이 되어 한 틱에 튕겨 나간다.
function setHead(f, x, y, vx, vy) {
  const h = f.chainHeads[0];
  Object.assign(h, { x, y, vx, vy });
  h.attach = Math.hypot(x - f.x, y - f.y) > 1e-6 ? Math.atan2(y - f.y, x - f.x) : (h.attach || 0);
  const at = T.chainAttach(f, h);
  h.nodes.forEach((n, i) => {
    const t = (i + 1) / 5;
    Object.assign(n, { x: at.x + (x - at.x) * t, y: at.y + (y - at.y) * t, vx: vx * t, vy: vy * t });
  });
  return h;
}
// 줄은 탄성이 있어 제 길이보다 늘어날 수 있다. 오차는 '최대 늘어남'을 넘은 만큼으로 잰다.
function measure(f, metrics) {
  const rope = T.ropeLen(f), stretch = T.CHAIN_MAX_STRETCH;
  for (const h of f.chainHeads) {
    let previous = T.chainAttach(f, h);
    for (const q of h.nodes.concat(h)) {
      for (const key of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(q[key]), `finite ${key}`);
      const gap = Math.hypot(q.x - previous.x, q.y - previous.y);
      metrics.segmentError = Math.max(metrics.segmentError, gap - rope / 5 * stretch);
      metrics.velocity = Math.max(metrics.velocity, Math.hypot(q.vx, q.vy));
      previous = q;
    }
    metrics.reachError = Math.max(metrics.reachError,
      Math.hypot(h.x - f.x, h.y - f.y) - ((f.radius || 0) + rope * stretch));
    metrics.speed = Math.max(metrics.speed, Math.hypot(h.sx, h.sy));
  }
}
const metrics = () => ({ speed: 0, velocity: 0, segmentError: 0, reachError: 0 });

test('chain combat numbers and augmentation damage/range contracts remain unchanged', () => {
  assert.equal(T.WEAPONS.chain.dmg, 12);
  assert.equal(T.WEAPONS.chain.chainLen, 85);
  assert.equal(T.WEAPONS.chain.headR, 10);
  // 연결부가 검처럼 돈다. 검(2.6)보다 살짝 느리게.
  assert.equal(T.WEAPONS.chain.rot, 2.3);
  assert.ok(T.WEAPONS.chain.rot < T.WEAPONS.sword.rot, '검보다 살짝 느리다');
  // 기본 회전만으로도 맞아야 한다. 화면 추 속도가 약 109인데 관문이 120이면
  // 돌고 있는 사슬이 닿아도 피해가 없다 — 그게 '맞히기 어렵다'의 정체였다.
  assert.equal(T.WEAPONS.chain.gate, 80);
  assert.equal(T.WEAPONS.chain.hitLock, 0.35);
  const { f } = fixture();
  assert.equal(T.chainLen(f), 85);
  f.flags.chainLong = true;
  assert.equal(T.chainLen(f), 130);
  f.timers.balloon = 2;
  assert.equal(T.chainLen(f), 130 * 1.6);
});

test('a sharp turn still throws the head with inertia, independent of frame rate', () => {
  /* 회전이 붙어도 물리 느낌은 남아야 한다. 선회 한 번이 추를 얼마나 가속하는지는
   * 그 순간 추가 회전의 어느 위상에 있었느냐에 따라 뒤집히므로, 선회 시점을
   * 여러 번 바꿔 평균으로 본다. 한 시점만 재면 같은 코드에서도 1.0 ~ 2.1이 나왔다. */
  const runs = [];
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 1 / 15]) {
    let amp = 0, count = 0;
    const m = metrics();
    for (let k = 0; k < 12; k++) {
      const { b, f } = fixture(), turnAt = 5 + k * (2.73 / 12);
      let before = 0, n = 0, peak = 0;
      for (let i = 0; i < Math.round((turnAt + 1.6) / dt); i++) {
        const time = i * dt, angle = time >= turnAt ? Math.PI : 0;
        f.vx = Math.cos(angle); f.vy = Math.sin(angle);
        f.x += f.vx * f.st.move * T.GAME_SPEED * dt;
        f.y += f.vy * f.st.move * T.GAME_SPEED * dt;
        b.simT += dt; T.updateChain(b, f, dt); measure(f, m);
        const sp = Math.hypot(f.chainHeads[0].sx, f.chainHeads[0].sy);
        if (time >= turnAt - 2 && time < turnAt) { before += sp; n++; }
        if (time >= turnAt) peak = Math.max(peak, sp);
      }
      amp += peak / (before / n); count++;
    }
    const mean = amp / count;
    assert.ok(mean > 1.4, `선회가 추를 확실히 가속한다 (평균 ${mean.toFixed(2)}배)`);
    assert.ok(m.reachError < 1, 'rope stays within 1px solver tolerance of its defined range');
    assert.ok(m.segmentError < 0.5, 'rope joints converge without visible stretching');
    runs.push(mean);
  }
  assert.ok(Math.max(...runs) - Math.min(...runs) < 0.05,
    `same turn must not depend on frame rate: ${runs.map(x => x.toFixed(3)).join(', ')}`);
});

const spinFor = aspd => T.WEAPONS.chain.rot * (aspd > 1 ? 1 + (aspd - 1) * T.MELEE_ASPD_GAIN : aspd);
const wrapAngle = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
// 공은 제자리, 조이스틱만 돌린다 (초당 w 라디안)
const circleStick = (f, i, dt, w) => T.setSteerInput(f, w * i * dt, 1);

test('without the stick a collapsed rope just opens and settles: no spin of its own, never toward an enemy', () => {
  const trace = enemyAt => {
    const { b, f, e } = fixture({ enemies: !!enemyAt });
    if (enemyAt) { e.x = enemyAt.x; e.y = enemyAt.y; e.hp = e.maxHp = 1e9; }
    f.weaponAngle = 0;
    setHead(f, 0, 0, 0, 0);
    const out = [];
    for (let i = 0; i < 600; i++) {
      b.simT += 1 / 60; T.updateChain(b, f, 1 / 60);
      out.push(f.chainHeads[0].x, f.chainHeads[0].y);
    }
    return { f, out };
  };
  const alone = trace(null);
  const h = alone.f.chainHeads[0], L = T.chainLen(alone.f);
  assert.ok(Math.hypot(h.x, h.y) > L * 0.95, '접힌 줄이 제 길이를 되찾는다');
  assert.ok(Math.hypot(h.vx, h.vy) * T.GAME_SPEED < 5, '조이스틱을 안 대면 저절로 돌지 않고 가라앉는다');
  const withEnemy = trace({ x: -170, y: 0 });
  const drift = alone.out.reduce((mx, v, i) => Math.max(mx, Math.abs(v - withEnemy.out[i])), 0);
  assert.ok(drift < 1e-9, `적 위치가 추를 끌어당기지 않는다 (최대 차이 ${drift})`);
});

test('turning the stick in a circle drags the weight around at the stick rate, either way', () => {
  const follow = (w, aspd = 1) => {
    const { b, f } = fixture(), dt = 1 / 60;
    f.st.rot = spinFor(aspd);
    let prev = null, turned = 0, time = 0;
    for (let i = 0; i < 600; i++) {
      circleStick(f, i, dt, w);
      b.simT += dt; T.updateChain(b, f, dt);
      const hh = f.chainHeads[0], ang = Math.atan2(hh.y - f.y, hh.x - f.x);
      if (i >= 180 && prev !== null) { turned += wrapAngle(ang - prev); time += dt; }
      prev = ang;
    }
    return turned / time;
  };
  for (const w of [1.5, 2, -2]) {
    const rate = follow(w);
    assert.ok(Math.abs(rate / w - 1) < 0.1, `스틱을 초당 ${w}라디안 돌리면 추도 그만큼 돈다 (${rate.toFixed(2)})`);
  }
  /* 힘에는 한계가 있다. 기본 공격속도로는 초당 3라디안을 못 따라와 추가 뒤처지고,
   * 공격속도가 높으면 미는 힘이 세져 따라온다 — 공격속도가 곧 다루기 쉬움이다. */
  const slow = follow(3), quick = follow(3, 1.5);
  assert.ok(slow < 3 * 0.7, `기본 힘으로는 너무 빠른 스틱을 못 따라온다 (${slow.toFixed(2)})`);
  assert.ok(Math.abs(quick / 3 - 1) < 0.1, `공격속도가 높으면 따라온다 (${quick.toFixed(2)})`);
  // 돌리는 동안 추는 피해 관문을 넉넉히 넘는 속도로 지나간다
  const { b, f } = fixture(), dt = 1 / 60;
  let speed = 0, n = 0;
  for (let i = 0; i < 600; i++) {
    circleStick(f, i, dt, 2);
    b.simT += dt; T.updateChain(b, f, dt);
    if (i >= 180) { speed += Math.hypot(f.chainHeads[0].vx, f.chainHeads[0].vy) * T.GAME_SPEED; n++; }
  }
  assert.ok(speed / n > T.WEAPONS.chain.gate * 2, `스틱을 돌리면 세게 휘두른다 (${(speed / n).toFixed(0)})`);
});

test('the stick pushes the weight sideways, harder with attack speed and a fuller stick, and not while stunned', () => {
  // 줄이 오른쪽으로 곧게 뻗은 멈춘 추를 위(+y)로 민다. 첫 0.1초의 옆 속도를 잰다.
  const push = ({ aspd = 1, mag = 1, stun = false, angle = Math.PI / 2 } = {}) => {
    const { b, f } = fixture(), dt = 1 / 120;
    f.st.rot = spinFor(aspd);
    if (stun) f.timers.stun = 5;
    const h = setHead(f, f.radius + T.ropeLen(f), 0, 0, 0);
    for (let i = 0; i < 12; i++) {
      T.setSteerInput(f, angle, mag);
      b.simT += dt; T.updateChain(b, f, dt);
    }
    return { side: h.vy, out: h.vx };
  };
  const base = push();
  assert.ok(base.side > 20, `스틱 쪽으로 밀린다 (${base.side.toFixed(1)})`);
  const fast = push({ aspd: 1.5 });
  assert.ok(Math.abs(fast.side / base.side - spinFor(1.5) / spinFor(1)) < 0.15,
    `공격속도만큼 세게 민다 (${(fast.side / base.side).toFixed(2)}배)`);
  const half = push({ mag: .5 });
  assert.ok(Math.abs(half.side / base.side - .5) < 0.08, `스틱을 반만 당기면 절반 (${(half.side / base.side).toFixed(2)}배)`);
  assert.ok(Math.abs(push({ stun: true }).side) < 1e-9, '기절하면 조이스틱이 추를 밀지 못한다');
  // 줄 방향(바깥)으로 당기는 몫은 줄을 늘리기만 하므로 버린다
  const outward = push({ angle: 0 });
  assert.ok(outward.out < 1, `줄 방향으로는 밀지 않는다 (${outward.out.toFixed(2)})`);
});

test('the rope is tied to the ball surface and the tie slides to where the rope leaves', () => {
  const { b, f } = fixture(), dt = 1 / 60, h = f.chainHeads[0];
  let worst = 0;
  for (let i = 0; i < 360; i++) {
    circleStick(f, i, dt, 2);
    b.simT += dt; T.updateChain(b, f, dt);
    assert.ok(Math.abs(Math.hypot(h._anchor.x - f.x, h._anchor.y - f.y) - f.radius) < 1e-6,
      '매인 자리는 공 가운데가 아니라 표면에 있다');
    if (i > 60) worst = Math.max(worst, Math.abs(wrapAngle(h.attach - Math.atan2(h.nodes[0].y - f.y, h.nodes[0].x - f.x))));
  }
  assert.ok(worst < 0.1, `줄이 나가는 쪽 표면에 매여 있다 (최대 어긋남 ${worst.toFixed(3)}rad)`);
});

test('the rope keeps its length under a steady stick, stretches only when swung fast, and springs back after a turn', () => {
  const settle = (w, aspd = 1) => {
    const { b, f } = fixture(), dt = 1 / 60, h = f.chainHeads[0];
    f.st.rot = spinFor(aspd);
    let stretch = 0, reach = 0, n = 0;
    for (let i = 0; i < 720; i++) {
      T.setSteerInput(f, w * i * dt + 1, 1);
      b.simT += dt; T.updateChain(b, f, dt);
      if (i >= 300) {
        stretch += Math.hypot(h.x - h._anchor.x, h.y - h._anchor.y) / T.ropeLen(f);
        reach += Math.hypot(h.x - f.x, h.y - f.y); n++;
      }
    }
    return { stretch: stretch / n, reach: reach / n, L: T.chainLen(f) };
  };
  const still = settle(0), slow = settle(2), fast = settle(4, 2);
  assert.ok(still.stretch < 1.03, `스틱을 대고만 있으면 줄이 늘어나지 않는다 (${still.stretch.toFixed(3)})`);
  assert.ok(fast.stretch > slow.stretch + 0.03, `빨리 휘두를수록 원심력으로 늘어난다 (${slow.stretch.toFixed(3)} -> ${fast.stretch.toFixed(3)})`);
  assert.ok(fast.stretch < T.CHAIN_MAX_STRETCH - 0.02, `세게 휘둘러도 한계에 붙지 않는다 (${fast.stretch.toFixed(3)})`);
  assert.ok(slow.reach > slow.L * 0.98 && slow.reach < slow.L * 1.1, `사거리 유지 (${slow.reach.toFixed(1)} / ${slow.L})`);

  // 급선회 뒤 줄이 늘었다 줄었다를 되풀이한다 — 탄력
  const { b, f } = fixture(), dt = 1 / 60, h = f.chainHeads[0], series = [];
  for (let i = 0; i < 480; i++) {
    const t = i * dt, ang = t >= 4 ? Math.PI : 0;
    f.vx = Math.cos(ang); f.vy = Math.sin(ang);
    f.x += f.vx * f.st.move * T.GAME_SPEED * dt; f.y += f.vy * f.st.move * T.GAME_SPEED * dt;
    b.simT += dt; T.updateChain(b, f, dt);
    if (t >= 4) {
      let prev = T.chainAttach(f, h), len = 0;
      for (const q of h.nodes.concat(h)) { len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
      series.push(len / T.ropeLen(f));
    }
  }
  let peaks = 0;
  for (let i = 1; i < series.length - 1; i++) if (series[i] > series[i - 1] && series[i] > series[i + 1] && series[i] > 1.03) peaks++;
  assert.ok(peaks >= 2, `선회 뒤 늘었다 줄었다 한다 (늘어남 봉우리 ${peaks}개)`);
});

test('while the ball runs and turns under the stick, the rope stays spread instead of folding into the ball', () => {
  /* 공이 앞서 달려 뒤에 끌려오던 추를 덮치면 줄이 느슨해진다. 스틱 힘의 바깥 몫이
   * 느슨한 줄을 다시 편다. 이게 없으면 추가 공 한가운데까지 접혀 들어왔다.
   * 힘을 600으로 줄인 뒤로는 달리며 꺾을 때 줄이 조금 더 느슨해진다 (중앙 0.95 -> 0.88).
   * 바깥 몫을 버리면 0.76까지 접힌다. */
  const { b, f } = fixture({ arena: true });
  b.update = b.update.bind(b);
  const dt = 1 / 60, L = T.chainLen(f), reach = [];
  f.x = 0; f.y = 0; f.vx = 1; f.vy = 0;
  for (let i = 0; i < 60 * 16; i++) {
    T.setSteerInput(f, Math.sin(i * dt * 0.7) * 2.5, 1);
    f.hp = f.maxHp;
    b.update(dt);
    const h = f.chainHeads[0];
    if (i > 120) reach.push(Math.hypot(h.x - f.x, h.y - f.y) / L);
  }
  reach.sort((a, c) => a - c);
  const p10 = reach[Math.floor(reach.length * .1)], mid = reach[reach.length >> 1];
  assert.ok(mid > 0.84, `대부분 제 길이로 펼쳐져 있다 (중앙 ${mid.toFixed(2)})`);
  assert.ok(p10 > 0.35, `공 쪽으로 접혀 들어오는 순간이 드물다 (하위 10% ${p10.toFixed(2)})`);
});

test('the flail head bounces off a body instead of passing through, and still hits once', () => {
  const { b, f, e } = fixture({ enemies: true });
  e.x = 0; e.y = 95; e.vx = e.vy = 0; e.st.move = 0; e.hp = e.maxHp = 1e9;
  const h = f.chainHeads[0], dt = 1 / 60, headR = T.WEAPONS.chain.headR;
  let deepest = 0, hits = 0, hp = e.hp, reversed = false, prevToward = 0;
  for (let i = 0; i < 360; i++) {
    e._motionX = e.x; e._motionY = e.y;
    circleStick(f, i, dt, 3);                  // 조이스틱을 돌려 추를 휘두른다
    b.simT += dt; T.updateChain(b, f, dt);
    deepest = Math.max(deepest, headR + e.radius - Math.hypot(h.x - e.x, h.y - e.y));
    if (e.hp < hp - 1e-9) { hits++; hp = e.hp; }
    const nx = e.x - h.x, ny = e.y - h.y, d = Math.hypot(nx, ny) || 1;
    const toward = (h.vx * nx + h.vy * ny) / d;
    if (prevToward > 60 && toward < -20 && d < headR + e.radius + 6) reversed = true;
    prevToward = toward;
  }
  assert.ok(deepest < 3, `몸을 뚫고 들어가지 않는다 (최대 ${deepest.toFixed(1)}px)`);
  assert.ok(reversed, '부딪히면 되돌아 튕겨 나온다');
  assert.ok(hits >= 1, '튕기면서도 맞힌다');
});

test('the flail head rebounds off a body almost as fast as it came in', () => {
  /* 줄이 느슨한 채 추를 멈춰 선 상대에게 곧장 던진다. 부딪힌 스텝에서 법선 속도가
   * 거의 그대로(CHAIN_BODY_BOUNCE) 뒤집혀야 상대에 붙어 비비지 않고 확실히 떨어진다. */
  const { b, f, e } = fixture({ enemies: true });
  e.x = 0; e.y = 90; e.vx = e.vy = 0; e.st.move = 0; e.hp = e.maxHp = 1e9;
  f.st.rot = 0;
  const h = setHead(f, 0, 40, 0, 900);
  let ratio = null;
  for (let i = 0; i < 60 && ratio === null; i++) {
    const vy = h.vy;
    b.simT += 1 / 120; T.updateChain(b, f, 1 / 120);
    if (vy > 200 && h.vy < 0) ratio = -h.vy / vy;
  }
  assert.ok(T.CHAIN_BODY_BOUNCE >= 0.85, '몸에서도 벽처럼 거의 그대로 튕긴다');
  assert.ok(ratio !== null, '상대에 닿으면 반대 방향으로 튕겨 나온다');
  assert.ok(Math.abs(ratio - T.CHAIN_BODY_BOUNCE) < 0.05, `튕기는 비율 ${ratio && ratio.toFixed(2)}`);
});

test('the flail hits the same enemy again only after the head has come away from it', () => {
  /* 추가 상대에 붙은 채로는 시간 잠금(0.35초)이 풀려도 다시 맞지 않는다.
   * CHAIN_REHIT_GAP만큼 떨어졌다가 다시 부딪혀야 다음 한 대다. */
  const { b, f, e } = fixture({ enemies: true });
  e.x = 40; e.y = 0; e._motionX = 40; e._motionY = 0; e.st.move = 0;
  const dmg = T.WEAPONS.chain.dmg, hp = e.hp, dt = 1 / 120;
  const clear = e.radius + T.WEAPONS.chain.headR + T.CHAIN_REHIT_GAP;
  const strike = () => { setHead(f, 40, -38, 0, 1800); T.updateChain(b, f, dt); };
  const gap = () => Math.hypot(f.chainHeads[0].x - e.x, f.chainHeads[0].y - e.y);
  strike();
  assert.equal(e.hp, hp - dmg, '처음 부딪히면 맞는다');
  assert.ok(gap() < clear, `튕겨도 아직 떨어지지 않았다 (${gap().toFixed(1)} < ${clear})`);
  b.simT = 1;
  strike();
  assert.equal(e.hp, hp - dmg, '잠금이 풀려도 떨어지지 않고 다시 부딪히면 맞지 않는다');
  setHead(f, 40, -70, 0, 0); b.simT = 1.1; T.updateChain(b, f, dt);
  assert.ok(gap() > clear, '추를 상대에게서 떼어 놓는다');
  assert.equal(e.hp, hp - dmg, '떨어지기만 해서는 맞지 않는다');
  b.simT = 1.2;
  strike();
  assert.equal(e.hp, hp - dmg * 2, '떨어졌다가 다시 부딪히면 맞는다');
});

test('the flail head rebounds off a wall instead of sliding along it', () => {
  const { b, f } = fixture({ arena: true });
  const L = b.arena.L;
  f.x = L - 90; f.y = 0; f._chainAnchor = { x: f.x, y: 0 }; f.st.rot = 0;
  f.chainHeads = []; f.weaponAngle = 0; T.ensureChainHeads(f);
  const h = f.chainHeads[0];
  for (const q of h.nodes.concat(h)) { q.vx = 900; q.vy = 0; }
  let ratio = null;
  for (let i = 0; i < 120 && ratio === null; i++) {
    const vx = h.vx;
    T.updateChain(b, f, 1 / 120);
    const atWall = Math.abs(h.x) + Math.abs(h.y) + h.r * Math.SQRT2 >= L - 1.5;
    if (atWall && vx > 200 && h.vx < 0) ratio = -h.vx / vx;
  }
  assert.ok(ratio !== null, '벽에 닿으면 반대 방향으로 튕겨 나온다');
  assert.ok(Math.abs(ratio - T.CHAIN_WALL_BOUNCE) < 0.05, `튕기는 비율 ${ratio && ratio.toFixed(2)}`);
});

/* 벽 강타(c_quake) — 오른쪽 위 벽(x+y=L) 한가운데로 추를 던진다.
 * 적은 벽 가까이 서 있지만 추가 지나는 길에서는 비켜서 있어 추에 직접 맞지 않는다. */
function slamWall({ quake = true, speed = 900 } = {}) {
  const { b, f, e } = fixture({ arena: true, enemies: true });
  const L = b.arena.L, n = Math.SQRT1_2;
  f.x = f.y = L / 2 - n * 100; f.vx = f.vy = 0; f.st.rot = 0;
  f.flags.chainQuake = quake; f._chainAnchor = { x: f.x, y: f.y };
  f.chainHeads = []; f.weaponAngle = Math.PI / 4; T.ensureChainHeads(f);
  e.x = L / 2 - n * 30 + n * 48; e.y = L / 2 - n * 30 - n * 48;
  e.vx = e.vy = 0; e.st.move = 0; e.hp = e.maxHp = 1000;
  const h = f.chainHeads[0], joints = h.nodes.concat(h), laid = joints.map(q => ({ x: q.x, y: q.y }));
  // 처음 자리로 되돌려 다시 던진다 (추의 재발동 기록은 그대로 둔다)
  const hurl = () => joints.forEach((q, i) => Object.assign(q, laid[i], { vx: n * speed, vy: n * speed }));
  const run = steps => { for (let i = 0; i < steps; i++) { b.simT += 1 / 120; T.updateChain(b, f, 1 / 120); } };
  hurl();
  return { b, f, e, h, hurl, run };
}

test('the wall-strike flail bursts a shockwave where the head hits the wall and hurts an enemy nearby', () => {
  const wp = T.WEAPONS.chain;
  assert.equal(wp.quakeDmg, 12); assert.equal(wp.quakeR, 75); assert.equal(wp.quakeCd, 0.5);   // 반경은 공의 충격파 증강과 같다
  const s = slamWall();
  let hurtAt = null;
  for (let i = 0; i < 30 && hurtAt === null; i++) { s.run(1); if (s.e.hp < 1000) hurtAt = { x: s.h.x, y: s.h.y }; }
  assert.ok(hurtAt, '벽에 부딪힌 순간 충격파가 터진다');
  assert.ok(Math.abs(hurtAt.x) + Math.abs(hurtAt.y) + s.h.r * Math.SQRT2 >= s.b.arena.L - 6, '터진 자리는 벽이다');
  assert.ok(Math.hypot(s.h.x - s.e.x, s.h.y - s.e.y) > s.e.radius + wp.headR, '추에 직접 맞은 피해가 아니다');
  s.run(30);
  assert.equal(1000 - s.e.hp, wp.quakeDmg * s.f.st.dmg, '한 번 부딪히면 한 번만 터진다');
  // 증강이 없으면 같은 충돌에 아무 일도 없다
  const plain = slamWall({ quake: false }); plain.run(60);
  assert.equal(plain.e.hp, 1000);
  // 반경 밖의 적은 맞지 않는다
  const far = slamWall(); far.e.x += 110 * Math.SQRT1_2; far.e.y -= 110 * Math.SQRT1_2; far.run(60);
  assert.equal(far.e.hp, 1000);
});

test('the wall strike needs a hard hit, waits out its cooldown, and stays quiet while stunned or locked', () => {
  const wp = T.WEAPONS.chain;
  // 화면 속도로 벽을 향한 성분이 약 63 — 벽에 닿기는 하지만 피해 관문(80) 아래다
  const soft = slamWall({ speed: 110 });
  let touched = false;
  for (let i = 0; i < 90; i++) {
    soft.run(1);
    if (Math.abs(soft.h.x) + Math.abs(soft.h.y) + soft.h.r * Math.SQRT2 >= soft.b.arena.L - 0.5) touched = true;
  }
  assert.ok(touched, '추가 벽에 닿았다');
  assert.equal(soft.e.hp, 1000, '살살 닿으면 터지지 않는다');
  const firm = slamWall({ speed: 160 }); firm.run(90);                // 약 92 — 관문을 넘는다
  assert.equal(1000 - firm.e.hp, wp.quakeDmg * firm.f.st.dmg, '관문을 넘게 부딪히면 터진다');
  const s = slamWall(), dmg = wp.quakeDmg * s.f.st.dmg;
  s.run(12); assert.equal(1000 - s.e.hp, dmg);
  s.hurl(); s.run(12);
  assert.ok(s.b.simT < wp.quakeCd, '아직 재발동 간격 안이다');
  assert.equal(1000 - s.e.hp, dmg, '재발동 간격 안에 다시 부딪혀도 터지지 않는다');
  s.run(Math.ceil(wp.quakeCd * 120)); s.hurl(); s.run(12);
  assert.equal(1000 - s.e.hp, 2 * dmg, '간격이 지나면 다시 터진다');
  for (const timer of ['stun', 'weaponLock']) {
    const t = slamWall(); t.f.timers[timer] = 5; t.run(60);
    assert.equal(t.e.hp, 1000, timer + ' 중에는 터지지 않는다');
  }
});

test('a rope that starts a step far past its stretch limit does not fling the head', () => {
  /* 넉백으로 공이 순간이동 판정(60px)에 못 미치게 크게 밀리면 줄이 한계를 훨씬 넘은
   * 채 한 틱이 시작된다. 스프링이 늘어난 만큼 제곱으로 뻣뻣해지면 여기서 속도가
   * 백만 단위로 튀고, 추가 경기장 밖까지 날아갔다가 벽 튕김이 그 속도를 되돌려 준다.
   * 벽이 있어야 드러나는 문제라 실제 경기장을 쓴다. */
  const { b, f } = fixture({ arena: true });
  const L = b.arena.L;
  f.x = L - 120; f.y = 0; f._chainAnchor = { x: f.x, y: 0 };
  f.chainHeads = []; f.weaponAngle = 0; T.ensureChainHeads(f);
  for (let i = 0; i < 60; i++) T.updateChain(b, f, 1 / 60);
  f.x -= 50;                                   // 순간이동 판정 아래로 크게 밀림
  let fastest = 0;
  for (let i = 0; i < 30; i++) {
    T.updateChain(b, f, 1 / 60);
    for (const h of f.chainHeads) for (const q of h.nodes.concat(h)) {
      assert.ok(Number.isFinite(q.x) && Number.isFinite(q.vx), '좌표와 속도가 유한하다');
      fastest = Math.max(fastest, Math.hypot(q.vx, q.vy));
      assert.ok(Math.abs(q.x) + Math.abs(q.y) <= L + 1, '경기장 밖으로 날아가지 않는다');
    }
  }
  // 줄이 크게 되감길 때 속도 상한 근처까지 가는 것은 원래 있는 일이다. 막는 것은 백만 단위 폭주다.
  assert.ok(fastest < T.CHAIN_MAX_SPD * 1.5, `속도가 폭주하지 않는다 (${Math.round(fastest)})`);
});

test('the rope spring never pulls harder than it does at its own stretch limit', () => {
  /* 늘어날수록 뻣뻣해지는 항이 한계를 넘어서도 계속 커지면, 한계를 크게 넘은 채
   * 시작한 서브스텝에서 당기는 힘이 수천 배가 되어 속도가 백만 단위로 튄다.
   * 한계를 넘은 몫은 딱딱한 구속이 맡아야 한다. */
  const { f } = fixture();
  const h = f.chainHeads[0], at = T.chainAttach(f, h), seg = T.ropeLen(f) / 5;
  h.nodes.forEach((n, i) => Object.assign(n, { x: at.x + seg * (i + 1), y: at.y, vx: 0, vy: 0 }));
  const last = h.nodes[h.nodes.length - 1];
  const pull = extra => {
    h.nodes.forEach(n => { n.vx = 0; n.vy = 0; });
    Object.assign(h, { x: last.x + seg + extra, y: at.y, vx: 0, vy: 0 });
    T.springChainRope(at, { x: 0, y: 0 }, h, seg, T.GAME_SPEED / 120);
    return Math.hypot(h.vx, h.vy);
  };
  const atLimit = pull(seg * (T.CHAIN_MAX_STRETCH - 1));
  const farPast = pull(60);
  assert.ok(atLimit > 0, '한계까지 늘어나면 당긴다');
  assert.ok(farPast <= atLimit * 1.0001, `한계를 넘어도 한계에서보다 세게 당기지 않는다 (${farPast.toFixed(0)} / ${atLimit.toFixed(0)})`);
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
  const nearWall = fixture({ arena: true });
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
  const dmg = T.WEAPONS.chain.dmg;
  assert.equal(e.hp, hp - dmg, 'crossing between clear endpoints still hits exactly once');
  assert.equal(f.chainHits.get(e.uid), 0.35);
  // 여기서는 시간 잠금만 본다 — 추가 떨어졌다 다시 온 것으로 친다 (접촉 규칙은 따로 본다)
  f.chainHeld.clear();
  setHead(f, 40, -40, 0, 1800); b.simT = 0.1;
  T.updateChain(b, f, 0.1); assert.equal(e.hp, hp - dmg);
  f.chainHeld.clear();
  setHead(f, 40, -40, 0, 1800); b.simT = 0.35;
  T.updateChain(b, f, 0.1); assert.equal(e.hp, hp - dmg * 2);
});

test('a stunned stationary victim does not fake attack speed from its nominal movement stat', () => {
  const { b, f, e } = fixture({ enemies: true });
  e.x = 70; e.y = 0; e.st.move = 600; e.vx = 1; e.vy = 0; e.timers.stun = 1;
  delete e._motionX; delete e._motionY;
  setHead(f, 70, 0, 0, 0);
  const hp = e.hp; T.updateChain(b, f, 1 / 60);
  assert.equal(e.hp, hp, 'static contact below speed gate is not an attack');
});

test('normal and long ropes stay finite, inside walls, and within range under sustained steering and slow frames', () => {
  for (const long of [false, true]) {
    const { b, f } = fixture({ arena: true, long }), m = metrics();
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
    assert.equal(f.chainHeads.length, 1);
    assert.ok(m.reachError < 1 && m.segmentError < 0.5, JSON.stringify({ long, ...m }));
    assert.ok(m.velocity <= 2000.001 && m.speed < 450, 'no accumulating orbit energy');
  }
});
