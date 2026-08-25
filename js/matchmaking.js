'use strict';

/* ============================================================
 * 바운스 로얄 — 라운드 대진 생성
 * 첫 3라운드는 4인 풀리그, 이후에는 직전 1대1 재대결을 우선 회피한다.
 * ============================================================ */
(function exposeMatchmaking(root) {
  function shuffled(items, random = Math.random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function pairKey(a, b) {
    return [String(a.id), String(b.id)].sort().join('|');
  }

  function openingSchedule(players, random = Math.random) {
    const [a, b, c, d] = shuffled(players, random);
    return [
      [[a, b], [c, d]],
      [[a, c], [b, d]],
      [[a, d], [b, c]],
    ];
  }

  function pairingOptions(players) {
    if (players.length === 4) {
      const [a, b, c, d] = players;
      return [
        [[a, b], [c, d]],
        [[a, c], [b, d]],
        [[a, d], [b, c]],
      ];
    }
    if (players.length === 3) {
      const [a, b, c] = players;
      return [[[a, b]], [[a, c]], [[b, c]]];
    }
    if (players.length === 2) return [[[players[0], players[1]]]];
    return [];
  }

  function selectPairs(state, alive, round, random = Math.random) {
    let pairs = null;

    if (alive.length === 4 && round <= 3) {
      if (!state.openingPairingSchedule) {
        state.openingPairingSchedule = openingSchedule(alive, random);
      }
      const scheduled = state.openingPairingSchedule[round - 1];
      const current = new Set(alive);
      if (scheduled && scheduled.every(pair => pair.every(player => current.has(player)))) {
        pairs = scheduled.map(pair => pair.slice());
      }
    }

    if (!pairs) {
      const options = pairingOptions(alive);
      const previous = state.lastPairKeys instanceof Set ? state.lastPairKeys : new Set();
      const withoutImmediateRematch = options.filter(option =>
        option.every(([a, b]) => !previous.has(pairKey(a, b))));
      const pool = withoutImmediateRematch.length ? withoutImmediateRematch : options;
      pairs = pool.length ? pool[Math.floor(random() * pool.length)].map(pair => pair.slice()) : [];
    }

    state.lastPairKeys = new Set(pairs.map(([a, b]) => pairKey(a, b)));
    return pairs;
  }

  const api = Object.freeze({ pairKey, openingSchedule, pairingOptions, selectPairs });
  root.BounceRoyalMatchmaking = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

