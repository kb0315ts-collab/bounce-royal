'use strict';
/* Presentation-only preview of the EXISTING round settlement. No coins, ranks,
 * timers or inputs on the real match are changed, and no RNG is consumed. */
(function (root) {
  const checked = new WeakSet();
  function annotate(state, settle) {
    const battles = state && state.battles;
    if (!Array.isArray(battles) || !battles.length || checked.has(battles)
      || battles.some(b => b.demo || !b.result)) return null;
    checked.add(battles);
    const players = state.players.map(p => ({ ...p }));
    const byId = new Map(players.map(p => [p.id, p]));
    const copyBody = f => ({ ...f, player: byId.get(f.player.id), steer: { ...f.steer },
      splitBalls: (f.splitBalls || []).map(s => ({ ...s, steer: { ...s.steer } })) });
    const copies = battles.map(b => {
      const fighters = b.fighters.map(copyBody);
      const byUid = new Map(fighters.map(f => [f.uid, f]));
      return { ...b, hpRatio: b.hpRatio, fighters, result: { ...b.result,
        winner: b.result.winner ? byUid.get(b.result.winner.uid) : null,
        losers: b.result.losers.map(f => byUid.get(f.uid)) } };
    });
    const preview = Object.assign(Object.create(Object.getPrototypeOf(state)), state, {
      players, battles: copies,
      // Server settlement normally publishes roundEnd and schedules the next
      // phase. Those side effects must never escape this preview.
      setPhase() {}, broadcast() {},
    });
    settle(preview);
    const alive = players.filter(p => !p.eliminated && p.coins > 0);
    if (alive.length > 1) return null;
    // Same final champion tie-break as Game.gameOver / Room.gameOver.
    const champion = alive.length ? alive.sort((a, b) => b.coins - a.coins || b.wins - a.wins)[0] : players[0];
    if (!champion) return null;
    const conclusion = Object.freeze({ id: champion.id, name: champion.name, color: champion.color });
    for (const b of battles) b.matchConclusion = conclusion;
    return conclusion;
  }
  const api = Object.freeze({ annotate });
  root.BounceRoyalMatchConclusion = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
