'use strict';
/* ============================================================
 * 랜덤 매칭 대기열 테스트
 *
 * 대기 화면은 게임의 첫인상이다. 남은 시간을 세어 내려가면 "곧 봇이
 * 붙는다"는 게 드러나고, 빈 자리가 한꺼번에 차도 마찬가지다.
 * 시간은 올라가고, 자리는 한 명씩 차야 한다.
 *
 * 실제 소켓을 붙여 확인한다. 합류 시각만 앞당기고 규칙은 그대로다.
 * ============================================================ */
process.env.PORT = '8199';
process.env.BOT_JOIN_START = '2';
process.env.BOT_JOIN_END = '5';
process.env.FILL_WITH_AI = '1';

const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'server/index.js'));
const WebSocket = require(path.join(root, 'server/node_modules/ws'));

function client(label) {
  const ws = new WebSocket('ws://127.0.0.1:8199');
  const c = { label, ws, queue: [], matched: null };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: label, charId: 'cat' })));
  ws.on('message', raw => {
    const m = JSON.parse(String(raw));
    if (m.t === 'queue') c.queue.push(Object.assign({ at: Date.now() }, m));
    if (m.t === 'match') c.matched = m;
  });
  return c;
}
const send = (c, o) => c.ws.send(JSON.stringify(o));
const wait = ms => new Promise(r => setTimeout(r, ms));

let passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push('✓ ' + name); }
  catch (err) { results.push('✗ ' + name); throw err; }
}

(async () => {
  try {
    await test('대기 시간은 내려가지 않고 올라간다', async () => {
      const A = client('철수');
      await wait(300);
      send(A, { t: 'queue' });
      await wait(2500);
      assert.ok(A.queue.length >= 2, '대기 상태를 주기적으로 보내야 한다');
      assert.ok(A.queue.every(q => q.left === undefined), '남은 시간을 세어 보내면 안 된다');
      const els = A.queue.map(q => q.elapsed);
      assert.ok(els.every(v => typeof v === 'number'), '경과 시간을 보내야 한다');
      assert.ok(els.every((v, i) => i === 0 || v >= els[i - 1]), '경과 시간이 줄어들면 안 된다');
      assert.ok(els[els.length - 1] > els[0], '경과 시간이 올라가야 한다 (' + els[0] + ' → ' + els[els.length - 1] + ')');
      A.ws.close();
      await wait(200);
    });

    await test('빈 자리는 한꺼번에 차지 않고 한 명씩 찬다', async () => {
      const A = client('영희');
      await wait(300);
      send(A, { t: 'queue' });
      await wait(9000);
      const steps = [];
      let last = -1;
      for (const q of A.queue) { if (q.found !== last) { steps.push(q.found); last = q.found; } }
      assert.ok(steps.length >= 3, '인원이 여러 번 나눠 늘어야 한다 (실제 ' + JSON.stringify(steps) + ')');
      assert.equal(steps[0], 1, '처음에는 나 혼자여야 한다');
      for (let i = 1; i < steps.length; i++) {
        assert.equal(steps[i] - steps[i - 1], 1, '한 번에 한 명씩 늘어야 한다 (실제 ' + JSON.stringify(steps) + ')');
      }
      assert.equal(steps[steps.length - 1], 4, '결국 네 자리가 다 차야 한다');
      assert.ok(A.matched, '자리가 다 차면 매칭이 되어야 한다');
      assert.equal(A.matched.humans, 1, '혼자였으므로 사람은 하나');
      A.ws.close();
      await wait(200);
    });

    await test('기다리는 중 사람이 들어와도 표시 인원이 줄지 않는다', async () => {
      const A = client('민수'), B = client('지연');
      await wait(300);
      send(A, { t: 'queue' });
      await wait(3000);                       // 봇 하나쯤 붙은 시점
      const before = A.queue[A.queue.length - 1].found;
      send(B, { t: 'queue' });
      await wait(400);
      const after = A.queue[A.queue.length - 1].found;
      assert.ok(after >= before, '사람이 들어왔는데 인원이 줄면 안 된다 (' + before + ' → ' + after + ')');
      assert.ok(after <= 4, '자리 수를 넘으면 안 된다');
      await wait(6000);
      assert.ok(A.matched && B.matched, '둘 다 매칭되어야 한다');
      assert.equal(A.matched.humans, 2, '두 사람이 같은 방에 들어가야 한다');
      A.ws.close(); B.ws.close();
      await wait(200);
    });

    await test('사람이 넷 모이면 봇을 기다리지 않고 바로 시작한다', async () => {
      const cs = ['가', '나', '다', '라'].map(client);
      await wait(300);
      for (const c of cs) send(c, { t: 'queue' });
      await wait(700);                        // 봇 합류(최소 1초)보다 빠르게
      assert.ok(cs.every(c => c.matched), '네 명이면 즉시 시작해야 한다');
      assert.ok(cs.every(c => c.matched.humans === 4), '전원 사람이어야 한다');
      for (const c of cs) c.ws.close();
      await wait(200);
    });

    await test('봇은 START 전에는 붙지 않고 END 안에 자리를 다 채운다', async () => {
      const A = client('하늘');
      await wait(300);
      send(A, { t: 'queue' });
      const t0 = Date.now();
      await wait(7000);
      const first = A.queue.find(q => q.found > 1);
      assert.ok(first, 'END(5초) 안에 봇이 붙어야 한다');
      assert.ok((first.at - t0) / 1000 >= 1.8, 'START(2초) 전에는 아무도 붙으면 안 된다 (실제 ' + ((first.at - t0) / 1000).toFixed(1) + '초)');
      const full = A.queue.find(q => q.found >= 4);
      assert.ok(full, 'END 안에 자리가 다 차야 한다');
      const fullAt = (full.at - t0) / 1000;
      assert.ok(fullAt <= 5.6, '총 대기가 END(5초)를 넘으면 안 된다 (실제 ' + fullAt.toFixed(1) + '초)');
      A.ws.close();
      await wait(200);
    });

    results.forEach(r => console.log(r));
    console.log('\n' + passed + '개 대기열 테스트 통과');
    process.exit(0);
  } catch (err) {
    results.forEach(r => console.log(r));
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
})();
