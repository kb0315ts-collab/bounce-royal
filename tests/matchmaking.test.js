'use strict';

const assert = require('node:assert/strict');
const Matchmaking = require('../js/matchmaking.js');

function seededRandom(seed = 123456789) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function keysOf(pairs) {
  return pairs.map(([a, b]) => Matchmaking.pairKey(a, b));
}

function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}

test('첫 3라운드에 4명의 모든 조합이 정확히 한 번씩 만난다', () => {
  const players = [0, 1, 2, 3].map(id => ({ id }));
  const state = {};
  const random = seededRandom(7);
  const allPairs = [];

  for (let round = 1; round <= 3; round++) {
    const pairs = Matchmaking.selectPairs(state, players, round, random);
    assert.equal(pairs.length, 2);
    assert.equal(new Set(pairs.flat()).size, 4, `라운드 ${round}에서 모든 선수가 한 번씩 출전해야 한다`);
    allPairs.push(...keysOf(pairs));
  }

  assert.equal(new Set(allPairs).size, 6);
  assert.deepEqual([...new Set(allPairs)].sort(), ['0|1', '0|2', '0|3', '1|2', '1|3', '2|3']);
});

test('4라운드부터는 가능한 한 직전 상대와 연속 재대결하지 않는다', () => {
  const players = [0, 1, 2, 3].map(id => ({ id }));
  const state = {};
  const random = seededRandom(19);
  let previous = new Set();

  for (let round = 1; round <= 30; round++) {
    const pairs = Matchmaking.selectPairs(state, players, round, random);
    const current = new Set(keysOf(pairs));
    if (round >= 4) {
      for (const key of current) assert.equal(previous.has(key), false, `${key} 대진이 연속으로 반복됐다`);
    }
    previous = current;
  }
});

test('3명 생존 시에도 직전 대진을 피하고 2명만 남으면 재대결을 허용한다', () => {
  const players = [0, 1, 2].map(id => ({ id }));
  const state = { lastPairKeys: new Set(['0|1']) };
  const next = Matchmaking.selectPairs(state, players, 8, () => 0);
  assert.notEqual(keysOf(next)[0], '0|1');

  const finalists = players.slice(0, 2);
  const unavoidable = Matchmaking.selectPairs(state, finalists, 9, () => 0);
  assert.deepEqual(keysOf(unavoidable), ['0|1']);
});

console.log('\n3개 대진 생성 테스트 통과');

