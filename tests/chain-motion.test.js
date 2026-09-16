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
    + '\nthis.testCore = { Battle, Arena, WEAPONS, GAME_SPEED, buildFighter, ensureChainHeads, updateChain, chainLen, chainSwap, MELEE_ASPD_GAIN, ropeLen, chainAttach, CHAIN_MAX_STRETCH, CHAIN_WALL_BOUNCE, CHAIN_MAX_SPD, springChainRope };', context);
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
  assert.equal(T.WEAPONS.chain.dmg, 24);
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

test('a sharp turn still throws the spinning head with inertia, independent of frame rate', () => {
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

test('a collapsed rope on a still ball opens and spins on its own, never toward an enemy', () => {
  /* 가만히 있어도 천천히 돈다. 연결부 회전이 만드는 것이지 상대를 노리는 게 아니다 —
   * 적이 어디 있든 같은 궤적이어야 한다. */
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
  assert.ok(Math.hypot(h.vx, h.vy) < 400, '폭주하지 않고 일정하게 돈다');
  // 추가 이제 몸에 튕기므로, 끌림만 보려면 적을 추가 닿지 않는 거리에 둔다
  const withEnemy = trace({ x: -170, y: 0 });
  const drift = alone.out.reduce((mx, v, i) => Math.max(mx, Math.abs(v - withEnemy.out[i])), 0);
  assert.ok(drift < 1e-9, `적 위치가 회전을 끌어당기지 않는다 (최대 차이 ${drift})`);
});

test('the spin runs at the weapon rotation speed, in the same direction as melee weapons', () => {
  const { b, f } = fixture();
  const dt = 1 / 60;
  let prev = null, turned = 0, time = 0;
  for (let i = 0; i < 60 * 12; i++) {
    b.simT += dt; T.updateChain(b, f, dt);
    const hh = f.chainHeads[0], ang = Math.atan2(hh.y - f.y, hh.x - f.x);
    if (i * dt >= 4 && prev !== null) {
      let d = ang - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      turned += d; time += dt;
    }
    prev = ang;
  }
  const rate = turned / time, target = f.st.rot * T.GAME_SPEED;
  assert.ok(rate > 0, '근접 무기와 같은 방향(각도 증가)으로 돈다');
  // 공기 저항만큼 목표를 올려 잡아 두었다. 줄 구속에서 조금 더 잃는 몫만 남는다.
  assert.ok(Math.abs(rate / target - 1) < 0.08,
    `화면 회전속도가 설정값과 맞는다 (${rate.toFixed(3)} / ${target.toFixed(3)})`);
});

test('attack speed now means spin: faster rotation and a harder-hitting head', () => {
  const spinAt = aspd => {
    const { b, f } = fixture();
    f.st.rot = T.WEAPONS.chain.rot * (aspd > 1 ? 1 + (aspd - 1) * T.MELEE_ASPD_GAIN : aspd);
    const dt = 1 / 60;
    let prev = null, turned = 0, time = 0, speed = 0, n = 0;
    for (let i = 0; i < 60 * 12; i++) {
      b.simT += dt; T.updateChain(b, f, dt);
      const hh = f.chainHeads[0], ang = Math.atan2(hh.y - f.y, hh.x - f.x);
      if (i * dt >= 4) {
        if (prev !== null) {
          let d = ang - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          turned += d; time += dt;
        }
        speed += Math.hypot(hh.sx, hh.sy); n++;
      }
      prev = ang;
    }
    return { rate: turned / time, speed: speed / n };
  };
  const slow = spinAt(1), fast = spinAt(1.5);
  assert.ok(fast.rate > slow.rate * 1.5,
    `공격속도 +50%면 회전이 확실히 빨라진다 (${slow.rate.toFixed(2)} -> ${fast.rate.toFixed(2)})`);
  assert.ok(slow.speed > T.WEAPONS.chain.gate,
    `기본 회전만으로 관문을 넘는다 (추 ${slow.speed.toFixed(0)} > 관문 ${T.WEAPONS.chain.gate})`);
  assert.ok(fast.speed > slow.speed, '빨리 돌수록 추가 더 세게 지나간다');
});

const spinFor = aspd => T.WEAPONS.chain.rot * (aspd > 1 ? 1 + (aspd - 1) * T.MELEE_ASPD_GAIN : aspd);
const wrapAngle = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

test('the rope is tied to the ball surface and the tie point travels around it at the spin rate', () => {
  const { b, f } = fixture(), dt = 1 / 60, h = f.chainHeads[0];
  const start = h.attach;
  let turned = 0, prev = start;
  for (let i = 0; i < 180; i++) {
    b.simT += dt; T.updateChain(b, f, dt);
    assert.ok(Math.abs(Math.hypot(h._anchor.x - f.x, h._anchor.y - f.y) - f.radius) < 1e-6,
      '매인 자리는 공 가운데가 아니라 표면에 있다');
    turned += wrapAngle(h.attach - prev); prev = h.attach;
  }
  const expected = f.st.rot * T.GAME_SPEED * 3;
  assert.ok(Math.abs(turned / expected - 1) < 0.01, `매인 자리가 회전속도로 돈다 (${turned.toFixed(3)} / ${expected.toFixed(3)})`);
});

test('a surface tie hands spin to the chain far faster than a center tie did', () => {
  // 가운데에 매였을 때는 멈춘 추가 목표 회전의 90%에 닿기까지 1.8초였다.
  const { b, f } = fixture(), dt = 1 / 60, h = f.chainHeads[0];
  h.vx = h.vy = 0; for (const n of h.nodes) { n.vx = n.vy = 0; }
  const target = f.st.rot * T.GAME_SPEED;
  let prev = Math.atan2(h.y - f.y, h.x - f.x), reached = null;
  for (let i = 0; i < 360 && reached === null; i++) {
    b.simT += dt; T.updateChain(b, f, dt);
    const a = Math.atan2(h.y - f.y, h.x - f.x);
    if (wrapAngle(a - prev) / dt >= target * 0.9) reached = i * dt;
    prev = a;
  }
  assert.ok(reached !== null && reached < 1.2, `표면에 매면 회전이 빨리 실린다 (${reached}초)`);
});

test('the rope stretches with spin and springs back after a turn, but keeps its reach and limit', () => {
  const settle = aspd => {
    const { b, f } = fixture(), dt = 1 / 60, h = f.chainHeads[0];
    f.st.rot = spinFor(aspd);
    let stretch = 0, reach = 0, n = 0;
    for (let i = 0; i < 720; i++) {
      b.simT += dt; T.updateChain(b, f, dt);
      if (i >= 300) {
        stretch += Math.hypot(h.x - h._anchor.x, h.y - h._anchor.y) / T.ropeLen(f);
        reach += Math.hypot(h.x - f.x, h.y - f.y); n++;
      }
    }
    return { stretch: stretch / n, reach: reach / n, L: T.chainLen(f) };
  };
  const base = settle(1), fast = settle(2);
  assert.ok(base.stretch > 1.01 && base.stretch < 1.08, `기본 회전에서 살짝 늘어난다 (${base.stretch.toFixed(3)})`);
  assert.ok(fast.stretch > base.stretch + 0.03, '빨리 돌수록 더 팽팽하게 늘어난다');
  assert.ok(fast.stretch < T.CHAIN_MAX_STRETCH - 0.02, `공속 2배에서도 한계에 붙지 않는다 (${fast.stretch.toFixed(3)})`);
  // 표면에 매도 가운데에서 잰 사거리는 그대로다 — 늘어난 몫만 조금 더해진다
  assert.ok(base.reach > base.L * 0.98 && base.reach < base.L * 1.08,
    `사거리 유지 (${base.reach.toFixed(1)} / ${base.L})`);

  // 급선회 뒤 줄이 늘었다 줄었다를 여러 번 반복한다 — 탄력
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
  assert.ok(peaks >= 3, `선회 뒤 여러 번 튕긴다 (늘어남 봉우리 ${peaks}개)`);
});

test('the flail head bounces off a body instead of passing through, and still hits once', () => {
  const { b, f, e } = fixture({ enemies: true });
  e.x = 0; e.y = 95; e.vx = e.vy = 0; e.st.move = 0; e.hp = e.maxHp = 1e9;
  const h = f.chainHeads[0], dt = 1 / 60, headR = T.WEAPONS.chain.headR;
  let deepest = 0, hits = 0, hp = e.hp, reversed = false, prevToward = 0;
  for (let i = 0; i < 360; i++) {
    e._motionX = e.x; e._motionY = e.y;
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
  assert.equal(e.hp, hp - 24, 'crossing between clear endpoints still hits exactly once');
  assert.equal(f.chainHits.get(e.uid), 0.35);
  setHead(f, 40, -40, 0, 1800); b.simT = 0.1;
  T.updateChain(b, f, 0.1); assert.equal(e.hp, hp - 24);
  setHead(f, 40, -40, 0, 1800); b.simT = 0.35;
  T.updateChain(b, f, 0.1); assert.equal(e.hp, hp - 48);
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
