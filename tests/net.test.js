'use strict';
/* ============================================================
 * 스냅샷 보간 테스트
 * 서버 권위형에서 클라이언트가 상태를 잘못 섞으면 화면에서만 어긋난다.
 * 테스트로 잡기 어려운 종류라 여기에 못박아 둔다.
 * ============================================================ */
const assert = require('node:assert/strict');
const { lerpSnapshot, netBattleView, Net } = require('../js/net.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (err) { console.error('✗ ' + name); throw err; }
}

const fighter = () => ({
  u: 1, p: 0, x: 0, y: 0, r: 22, a: 0, h: 100, m: 100, s: 0,
  d: 0, md: 0, fl: 0, ti: {}, ch: 0, gf: 0, fg: 0, rl: 0,
  vx: 1, vy: 0, lk: 1, su: [1, 1, 1], sx: [1, 1, 1], cp: null, sm: [], sp: [], sa: [],
});
const snap = pr => ({
  ph: 'fight', t: 1, ot: null, sh: 0, L: 320, pil: [], cube: null,
  f: [fighter()], pr, mn: [], fm: [], sk: [], px: [], fx: [], res: null,
});
const arrow = (u, x) => ({ u, k: 'arrow', x, y: 0, a: 0, r: 5, o: 0 });

test('투사체는 배열 위치가 아니라 uid로 짝지어 보간한다', () => {
  // 맨 앞 화살이 사라져 배열이 한 칸 밀리는 순간을 재현한다.
  const before = snap([arrow(10, -200), arrow(11, 0), arrow(12, 200)]);
  const after = snap([arrow(11, 20), arrow(12, 220)]);
  const mid = lerpSnapshot(before, after, 0.5);

  assert.equal(mid.pr.length, 2);
  assert.deepEqual(mid.pr.map(p => p.u), [11, 12]);
  // uid로 맞추면 각자 자기 이전 위치와만 섞인다
  assert.ok(Math.abs(mid.pr[0].x - 10) < 1e-9, 'u11은 0→20의 중간이어야 한다 (실제 ' + mid.pr[0].x + ')');
  assert.ok(Math.abs(mid.pr[1].x - 210) < 1e-9, 'u12는 200→220의 중간이어야 한다 (실제 ' + mid.pr[1].x + ')');
  // 인덱스로 맞췄다면 u11이 -200→20 사이인 -90으로 순간이동한다
  assert.ok(Math.abs(mid.pr[0].x - (-90)) > 1, '인덱스 매칭으로 되돌아가면 안 된다');
});

test('처음 보는 투사체는 보간 없이 그대로 쓴다', () => {
  const before = snap([arrow(10, 0)]);
  const after = snap([arrow(10, 30), arrow(99, -300)]);
  const mid = lerpSnapshot(before, after, 0.5);
  assert.ok(Math.abs(mid.pr[0].x - 15) < 1e-9, '기존 투사체는 섞는다');
  assert.equal(mid.pr[1].x, -300, '새로 나타난 투사체는 최신 위치를 그대로 쓴다');
});

test('전투원도 uid로 짝지어 위치와 각도를 섞는다', () => {
  const a = snap([]); const b = snap([]);
  a.f[0].x = 0; a.f[0].a = 0;
  b.f[0].x = 100; b.f[0].a = 1;
  const mid = lerpSnapshot(a, b, 0.25);
  assert.ok(Math.abs(mid.f[0].x - 25) < 1e-9);
  assert.ok(Math.abs(mid.f[0].a - 0.25) < 1e-9);
});

test('각도는 짧은 쪽으로 감아 돈다', () => {
  const a = snap([]); const b = snap([]);
  a.f[0].a = 3.0;
  b.f[0].a = -3.0;          // +3.0 → -3.0 은 짧게 보면 +0.283 만큼 돈다
  const mid = lerpSnapshot(a, b, 0.5);
  // 단순 보간이면 0 근처가 되지만, 짧은 쪽으로 감으면 ±3.14 근처가 된다
  assert.ok(Math.abs(mid.f[0].a) > 3, '반대편으로 크게 돌아가면 안 된다 (실제 ' + mid.f[0].a + ')');
});


/* ---- 순간이동은 섞지 않는다 (고양이 되돌아가기) ----
 * 스냅샷 사이 이동거리가 물리적으로 불가능하면 목적지를 그대로 그려야 한다.
 * 섞으면 경기장을 가로질러 미끄러지는 것처럼 보인다. */
test('순간이동한 전투원은 보간하지 않고 목적지에 그린다', () => {
  const a = snap([]); const b = snap([]);
  a.f[0].x = -200; a.f[0].y = 0;
  b.f[0].x = 200; b.f[0].y = 0;        // 400px 이동 = 50ms 안에 불가능
  const mid = lerpSnapshot(a, b, 0.5, 50);
  assert.equal(mid.f[0].x, 200, '순간이동은 즉시 반영되어야 한다 (실제 ' + mid.f[0].x + ')');
});

test('정상 속도의 이동은 순간이동으로 오인하지 않는다', () => {
  const a = snap([]); const b = snap([]);
  a.f[0].x = 0; b.f[0].x = 60;         // 50ms에 60px = 1200px/s. 연장전 최고속 안쪽
  const mid = lerpSnapshot(a, b, 0.5, 50);
  assert.ok(Math.abs(mid.f[0].x - 30) < 1e-9, '정상 이동은 섞어야 한다 (실제 ' + mid.f[0].x + ')');
});

test('스냅샷 간격이 벌어지면 허용 이동거리도 함께 늘어난다', () => {
  const a = snap([]); const b = snap([]);
  a.f[0].x = 0; b.f[0].x = 150;        // 패킷 하나를 잃어 100ms가 벌어진 경우
  assert.equal(lerpSnapshot(a, b, 0.5, 50).f[0].x, 150, '50ms 기준으로는 순간이동');
  assert.ok(Math.abs(lerpSnapshot(a, b, 0.5, 100).f[0].x - 75) < 1e-9, '100ms 기준으로는 정상 이동');
});

/* ---- 소환수와 분열체도 uid로 짝짓는다 ----
 * 하나가 죽어 배열이 밀리면 인덱스 매칭은 엉뚱한 개체끼리 섞는다. */
test('소환수와 분열체는 배열 위치가 아니라 uid로 짝지어 보간한다', () => {
  const orb = (u, x) => ({ u, x, y: 0, r: 9 });
  const a = snap([]); const b = snap([]);
  a.f[0].sm = [orb(1, -300), orb(2, 0)];
  b.f[0].sm = [orb(2, 20)];              // uid 1이 죽어 배열이 한 칸 밀렸다
  a.f[0].sp = [orb(5, -300), orb(6, 0)];
  b.f[0].sp = [orb(6, 20)];
  const mid = lerpSnapshot(a, b, 0.5, 50);
  assert.ok(Math.abs(mid.f[0].sm[0].x - 10) < 1e-9, '소환수 u2는 0에서 20의 중간 (실제 ' + mid.f[0].sm[0].x + ')');
  assert.ok(Math.abs(mid.f[0].sp[0].x - 10) < 1e-9, '분열체 u6는 0에서 20의 중간 (실제 ' + mid.f[0].sp[0].x + ')');
});

/* ---- 위성 각도 이름 맞춤 ----
 * 스냅샷은 a로 싣고 렌더러는 ang을 읽는다. 이름이 어긋나면 위성이 화면에서 사라진다. */
test('위성 증강의 각도가 렌더러가 읽는 이름(ang)으로 전달된다', () => {
  const s = snap([]);
  s.f[0].sa = [{ a: 1.25 }, { a: -2.5 }];
  const view = netBattleView(s, [{ id: 0, name: 'P', color: '#4da6ff', charId: 'cat', weaponId: 'sword' }], 0);
  assert.equal(view.fighters[0].satellites.length, 2);
  assert.equal(view.fighters[0].satellites[0].ang, 1.25, '위성 각도가 ang으로 와야 한다');
  assert.equal(view.fighters[0].satellites[1].ang, -2.5);
});

/* ---- 타격 연출은 정확히 한 번만 재생된다 ----
 * 팝업은 0.9초 살아 있어 20Hz면 같은 uid가 18번쯤 다시 온다.
 * uid로 걸러내지 않으면 피해 숫자가 겹쳐 찍히고 타격음이 도배된다. */
test('여러 스냅샷에 걸쳐 반복 전송된 타격 연출도 한 번만 재생한다', () => {
  Net.clearFx();
  const hit = { u: 42, x: 10, y: 20, s: '7', c: '#ffffff', b: 0 };
  const ring = { u: 43, k: 'r', x: 0, y: 0, a: 4, b: 40, c: '#ffd24d', d: 0.3 };
  for (let i = 0; i < 18; i++) {
    const s = snap([]); s.px = [hit]; s.fx = [ring];
    Net.pushSnapshot(s);
  }
  assert.equal(Net.localPopups.length, 1, '피해 숫자가 겹쳐 찍히면 안 된다 (실제 ' + Net.localPopups.length + ')');
  assert.equal(Net.localFx.length, 1, '충격파가 겹쳐 그려지면 안 된다 (실제 ' + Net.localFx.length + ')');
  Net.clearFx();
});

test('스냅샷 한 번에만 실린 짧은 연출도 유실되지 않는다', () => {
  Net.clearFx();
  Net.pushSnapshot(snap([]));
  const s = snap([]);
  s.px = [{ u: 77, x: 0, y: 0, s: '치명타', c: '#ffd24d', b: 1 }];
  s.fx = [{ u: 78, k: 'b', c: '#9ad8ff', d: 0.25, g: [[0, 0], [10, 10]] }];
  Net.pushSnapshot(s);
  Net.pushSnapshot(snap([]));
  assert.equal(Net.localPopups.length, 1, '한 스냅샷에만 실린 팝업이 유실되면 안 된다');
  assert.equal(Net.localFx.length, 1, '한 스냅샷에만 실린 번개가 유실되면 안 된다');
  Net.clearFx();
});

/* ---- 이산 상태는 보간하지 않는다 ----
 * 사망이나 기절을 섞으면 켜지지도 꺼지지도 않은 상태가 그려진다. */
test('사망 플래그와 상태 타이머는 섞지 않고 최신값을 쓴다', () => {
  const a = snap([]); const b = snap([]);
  a.f[0].d = 0; a.f[0].ti = { im: 0, st: 0 };
  b.f[0].d = 1; b.f[0].ti = { im: 2, st: 1.5 };
  const mid = lerpSnapshot(a, b, 0.5, 50);
  assert.equal(mid.f[0].d, 1, '사망은 중간값이 없다');
  assert.equal(mid.f[0].ti.im, 2, '무적 타이머는 최신값 그대로');
  assert.equal(mid.f[0].ti.st, 1.5, '기절 타이머는 최신값 그대로');
});

console.log('\n' + passed + '개 스냅샷 보간 테스트 통과');
