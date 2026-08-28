'use strict';
/* ============================================================
 * 스냅샷 보간 테스트
 * 서버 권위형에서 클라이언트가 상태를 잘못 섞으면 화면에서만 어긋난다.
 * 테스트로 잡기 어려운 종류라 여기에 못박아 둔다.
 * ============================================================ */
const assert = require('node:assert/strict');
const { lerpSnapshot } = require('../js/net.js');

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

console.log('\n' + passed + '개 스냅샷 보간 테스트 통과');
