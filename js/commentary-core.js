'use strict';

/* Client-only sports commentary. Reads confirmed battle facts; never runs gameplay,
 * consumes the simulation RNG, or keeps a queue of already expired announcements. */
(function (root) {
  const COOLDOWN_MS = 3500;
  const EVENT_MAX_AGE = 1.25;
  const COMBO_WINDOW = 2;
  const UTILITY_SKILLS = new Set(['skill:sword', 'skill:pistol', 'skill:staff',
    'char:cat', 'char:wak', 'char:soft', 'char:balloon']);
  const SPECIALS = { 'augment:lightning': '번개', 'augment:shockwave': '충격파',
    'augment:chainBolt': '연쇄 번개' };
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const nameOf = value => {
    const letters = Array.from(String(value == null ? '선수' : value)
      .replace(/[\u0000-\u001f\u007f]/g, '').trim() || '선수');
    return letters.length > 9 ? letters.slice(0, 8).join('') + '…' : letters.join('');
  };
  const actorOf = fighter => ({ uid: fighter ? fighter.uid ?? fighter.id ?? null : null,
    name: fighter ? nameOf(fighter.name) : '', color: fighter && typeof fighter.color === 'string'
      ? fighter.color : '#ffe18a' });
  const ratio = fighter => Math.max(0, Math.min(1, finite(fighter.hp) / Math.max(1, finite(fighter.maxHp, 1))));
  const entry = (data, id) => Object.prototype.hasOwnProperty.call(data, id) ? data[id] : null;

  class Director {
    constructor({ weapons = {}, characters = {} } = {}) {
      this.weapons = weapons;
      this.characters = characters;
      this.battles = new Map();
      this.objectKeys = new WeakMap();
      this.nextKey = 0;
      this.activeKey = null;
      this.lastSpoken = -Infinity;
      this.finishedMatches = new Set();
    }

    battleKey(battle) {
      if (battle.soundId != null) return String(battle.soundSource || 'local') + ':' + battle.soundId;
      if (!this.objectKeys.has(battle)) this.objectKeys.set(battle, 'object:' + (++this.nextKey));
      return this.objectKeys.get(battle);
    }

    line(kind, priority, fighter, text, label, gg = false) {
      return { kind, priority, actor: actorOf(fighter), text, label, gg };
    }

    // Only the match-over UI may call this, after authoritative final ranks arrive.
    // A fighter dying (including the last fighter of a FFA round) is not match-over.
    // Pass a stable session key when reconnects may recreate the players array.
    finishMatch(players, nowMilliseconds, matchKey = players) {
      if (!Array.isArray(players) || !players.length || matchKey == null) return null;
      const ranks = new Set(players.map(player => player && player.rank));
      if (ranks.size !== players.length || players.some(player => !player ||
        !Number.isInteger(player.rank) || player.rank < 1 || player.rank > players.length)) return null;
      if (this.finishedMatches.has(matchKey)) return null;
      this.finishedMatches.add(matchKey);
      if (this.finishedMatches.size > 64) this.finishedMatches.delete(this.finishedMatches.values().next().value);
      const champion = players.find(player => player.rank === 1);
      this.lastSpoken = finite(nowMilliseconds);
      return this.line('gg', 100, champion,
        'GG~~! ' + nameOf(champion.name) + ', 최종 우승입니다!', '최종 결과', true);
    }

    lead(battle) {
      const alive = (battle.fighters || []).filter(f => !f.dead && !f.mainDead && f.hp > 0)
        .map(f => ({ fighter: f, ratio: ratio(f) })).sort((a, b) => b.ratio - a.ratio);
      return alive.length > 1 ? { fighter: alive[0].fighter, gap: alive[0].ratio - alive[1].ratio }
        : { fighter: null, gap: 0 };
    }

    baseline(battle, state, events, time) {
      for (const event of events) state.seq = Math.max(state.seq, finite(event.seq));
      state.simT = Math.max(state.simT, time);
      state.hits.clear();
      state.leadArmed = this.lead(battle).gap <= .2;
      // A finished battle discovered by switching is not a newly witnessed finish.
      if (battle.result) state.resultDone = true;
    }

    skillName(source) {
      const [category, id] = source.split(':');
      const def = entry(category === 'char' ? this.characters : this.weapons, id);
      return def && def.skillName ? String(def.skillName) : '스킬';
    }

    observe(battle, nowMilliseconds) {
      if (!battle || battle.demo) { this.activeKey = null; return null; }
      const now = finite(nowMilliseconds);
      const time = finite(battle.simT);
      const events = Array.isArray(battle.commentaryEvents) ? battle.commentaryEvents : [];
      const key = this.battleKey(battle);
      let state = this.battles.get(key);
      const fresh = !state;
      if (fresh) {
        state = { seq: 0, simT: -Infinity, phase: battle.phase, introDone: false,
          resultDone: false, hits: new Map(), sourceTimes: new Map(), leadArmed: true };
        this.battles.set(key, state);
        // A normal session is much smaller; keep spectator/reconnect history bounded.
        if (this.battles.size > 64) this.battles.delete(this.battles.keys().next().value);
      }
      const switched = this.activeKey !== key;
      this.activeKey = key;
      if (time + .001 < state.simT) return null; // A late snapshot cannot rewind the director.
      const starting = battle.phase === 'fight' && !state.introDone &&
        ((state.phase === 'count' && !fresh) || (fresh && time <= .15));
      if (switched) {
        this.baseline(battle, state, events, time);
        if (!starting && battle.phase !== 'count') state.introDone = true;
      }

      state.simT = Math.max(state.simT, time);
      state.phase = battle.phase;
      if (battle.result && !state.resultDone) {
        state.resultDone = true;
        for (const event of events) state.seq = Math.max(state.seq, finite(event.seq));
        const winner = battle.result.winner;
        const fighter = winner && typeof winner === 'object' ? winner
          : (battle.fighters || []).find(f => f.uid === winner) || null;
        this.lastSpoken = now;
        return this.line('round-end', 90, fighter, fighter && !battle.result.draw
          ? nameOf(fighter.name) + ', 이번 라운드를 가져갑니다!'
          : battle.result.draw ? '끝까지 팽팽했습니다! 이번 라운드는 무승부!'
            : '이번 라운드가 끝났습니다!', '라운드 종료');
      }
      if (battle.phase !== 'fight' || battle.result) return null;

      const candidates = [];
      const fighters = new Map((battle.fighters || []).map(f => [f.uid, f]));
      if (starting) {
        state.introDone = true;
        const active = (battle.fighters || []).filter(f => !f.dead);
        const streak = active.find(f => finite(f.player && f.player.streak) >= 2);
        const fighter = streak || active[0];
        if (fighter) {
          const weapon = entry(this.weapons, fighter.weaponId);
          candidates.push(this.line('intro', 20, fighter, streak
            ? nameOf(fighter.name) + ', ' + Math.floor(fighter.player.streak) + '연승의 기세!'
            : nameOf(fighter.name) + '의 ' + (weapon ? weapon.name : '무기') + '! '
              + '대결 시작합니다!', 'ON AIR'));
        }
      }

      // Duplicate entries can share the same seq; sort a copy, never mutate snapshots.
      const incoming = events.filter(event => finite(event.seq) > state.seq)
        .slice().sort((a, b) => a.seq - b.seq);
      for (const event of incoming) {
        if (event.seq <= state.seq) continue;
        const eventTime = finite(event.t, -Infinity);
        // Interpolation uses the newest packet's events with a slightly older
        // presentation clock. Keep a future fact pending until that clock catches
        // up; consuming its seq here would permanently lose a confirmed hit.
        if (eventTime > time + .05) break;
        state.seq = Math.max(state.seq, finite(event.seq));
        if (time - eventTime > EVENT_MAX_AGE) continue;
        const fighter = fighters.get(event.actor);
        if (!fighter) continue;
        const source = typeof event.source === 'string' ? event.source : '';
        const name = nameOf(fighter.name);
        if (event.type === 'skill') {
          // Charge, dash and detonation acceptance do not prove an impact.
          if (UTILITY_SKILLS.has(source)) candidates.push(this.line('skill-use', 55, fighter,
            name + '의 ' + this.skillName(source) + ', 발동!', '스킬 발동'));
          continue;
        }
        if (event.type !== 'hit' || !(event.amount > 0) || !fighters.has(event.target) || event.target === event.actor) continue;
        const skillHit = source.startsWith('skill:') || source === 'char:bomb' || source === 'char:bball';
        if (skillHit) {
          const sourceKey = event.actor + ':' + source;
          if (now - (state.sourceTimes.get(sourceKey) ?? -Infinity) >= 8000) {
            candidates.push({ ...this.line('skill-hit', 80, fighter,
              name + '의 ' + this.skillName(source) + '! 적중합니다!', '스킬 적중'), cooldownKey: sourceKey });
          }
        }
        if (Object.prototype.hasOwnProperty.call(SPECIALS, source)) {
          const sourceKey = event.actor + ':' + source;
          if (now - (state.sourceTimes.get(sourceKey) ?? -Infinity) >= 8000) {
            const end = event.seq % 2 ? '까지 꽂힙니다!' : ', 제대로 들어갔습니다!';
            candidates.push({ ...this.line('special-hit', 60, fighter,
              name + '의 ' + SPECIALS[source] + end, '특수 공격'), cooldownKey: sourceKey });
          }
        }
        // Periodic damage, summons and passive systems must not look like a weapon combo.
        if (!source.startsWith('weapon:') && !source.startsWith('skill:')) continue;
        const pair = event.actor + '>' + event.target;
        let hits = (state.hits.get(pair) || []).filter(t => eventTime - t <= COMBO_WINDOW);
        if (!hits.length || eventTime - hits[hits.length - 1] >= .08 - 1e-6) hits.push(eventTime);
        state.hits.set(pair, hits);
        if (hits.length >= 3) {
          state.hits.set(pair, []);
          const sourceKey = 'combo:' + pair;
          if (now - (state.sourceTimes.get(sourceKey) ?? -Infinity) >= 8000) {
            candidates.push({ ...this.line('combo', 70, fighter, event.seq % 2
              ? name + ', 세 번 연속 적중! 몰아붙입니다!'
              : name + '의 연속타! 빈틈을 놓치지 않습니다!', '연속 적중'), cooldownKey: sourceKey });
          }
        }
      }
      const lead = this.lead(battle);
      if (lead.gap <= .2) state.leadArmed = true;
      if (time >= 3 && lead.fighter && lead.gap >= .35 && state.leadArmed) {
        state.leadArmed = false;
        candidates.push(this.line('lead', 50, lead.fighter,
          nameOf(lead.fighter.name) + ', 체력 차이를 크게 벌립니다!', '체력 우세'));
      }
      for (const [pair, hits] of state.hits) {
        const recent = hits.filter(t => time - t <= COMBO_WINDOW);
        if (recent.length) state.hits.set(pair, recent); else state.hits.delete(pair);
      }
      if (!candidates.length || now - this.lastSpoken < COOLDOWN_MS) return null;
      candidates.sort((a, b) => b.priority - a.priority);
      this.lastSpoken = now;
      const { cooldownKey, ...chosen } = candidates[0];
      // Dropped facts are not queued, but they must not silence a genuinely new
      // hit later. The per-source cooldown begins only for the line we select.
      if (cooldownKey) state.sourceTimes.set(cooldownKey, now);
      return chosen;
    }
  }

  const api = { Director };
  root.BounceRoyalCommentaryCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
