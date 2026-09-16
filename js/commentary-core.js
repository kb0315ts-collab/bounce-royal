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
    'augment:chainBolt': '연쇄 번개', 'augment:chainQuake': '벽 강타' };
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

  /* 같은 상황이라도 표현이 돌아가게 한다. 난수는 쓸 수 없다 — 중계는 게임
   * RNG를 절대 건드리지 않는다 — 그래서 이미 확정된 사실(이벤트 seq, uid,
   * 경기 시각)에서 뽑은 정수로 고른다. 같은 경기를 다시 봐도 같은 대사가 나온다. */
  const pick = (list, n) => list[((Math.trunc(finite(n)) % list.length) + list.length) % list.length];
  /* 문자열에서 고르게 퍼지는 정수를 만든다. 사실을 그냥 더하면 배수가 겹쳐
   * 늘 같은 항목만 나온다 (실제로 12n+11 꼴이 되어 한 가지만 뽑혔다). */
  const spin = value => {
    let h = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 8;
  };
  /* 한국어 조사. 받침이 있으면 앞쪽, 없으면 뒤쪽을 쓴다.
   * 이게 없으면 '지훈가 앞섭니다', '방어을 발동' 같은 말이 나간다. */
  const hasJong = word => {
    const text = String(word || '');
    const code = text.charCodeAt(text.length - 1);
    return code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 !== 0 : false;
  };
  const josa = (word, withJong, without) => String(word) + (hasJong(word) ? withJong : without);
  // 으로/로는 ㄹ 받침도 '로'를 쓴다
  const ro = word => {
    const text = String(word || '');
    const code = text.charCodeAt(text.length - 1);
    const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
    return text + (jong === 0 || jong === 8 ? '로' : '으로');
  };

  /* 대사 사전. 각 항목은 사실(이름·스킬명 등)을 반드시 담고, 달라지는 것은
   * 그 주변의 말투뿐이다. 그래야 표현이 바뀌어도 전달되는 정보는 같다. */
  const LINES = {
    intro: (who, weapon) => [
      `${who}의 ${weapon}! 대결 시작합니다!`,
      `${who}의 ${weapon}, 오늘은 어떤 그림이 나올까요!`,
      `자, ${who}의 ${weapon}! 첫 합을 노립니다!`,
      `${ro(weapon)} 출발합니다. ${who}, 시작!`,
      `${who}의 ${weapon}! 준비됐습니다, 갑니다!`,
    ],
    streak: (who, n) => [
      `${who}, ${n}연승의 기세!`,
      `${who}, ${n}연승 중입니다. 막을 사람 있습니까!`,
      `${who}, ${n}연승! 오늘 감이 아주 좋습니다!`,
      `${who}, ${n}연승을 달리고 있습니다. 계속 갈까요?`,
    ],
    skillUse: (who, skill) => [
      `${who}의 ${skill}, 발동!`,
      `${who}, ${skill} 발동합니다!`,
      `나왔습니다, ${who}의 ${skill} 발동!`,
      `${josa(who,'이','가')} ${josa(skill,'을','를')} 발동했습니다!`,
    ],
    skillHit: (who, skill) => [
      `${who}의 ${skill}! 적중합니다!`,
      `${who}의 ${skill}, 그대로 적중!`,
      `${who}의 ${skill}이 적중했습니다! 좋았어요!`,
      `${who}의 ${skill}! 정확히 적중입니다!`,
    ],
    special: (who, what) => [
      `${who}의 ${what}, 제대로 들어갔습니다!`,
      `${who}의 ${what}까지 꽂힙니다!`,
      `${who}의 ${what}! 이건 아프겠는데요!`,
      `${who}의 ${what}, 정통으로 맞았습니다!`,
    ],
    combo: who => [
      `${who}, 세 번 연속 적중! 몰아붙입니다!`,
      `${who}의 연속타! 빈틈을 놓치지 않습니다!`,
      `${who}, 쉬지 않고 들어갑니다! 연속 적중!`,
      `${who}의 몰아치기! 상대가 버티질 못하네요!`,
    ],
    lead: who => [
      `${who}, 체력 차이를 크게 벌립니다!`,
      `${josa(who,'이','가')} 앞서 나갑니다! 격차가 큽니다!`,
      `${who}, 확실히 우세를 잡았습니다!`,
      `${josa(who,'이','가')} 주도권을 가져갔습니다!`,
    ],
    firstBlood: who => [
      `${who}, 선제 타격 성공!`,
      `첫 피해는 ${who}입니다!`,
      `${josa(who,'이','가')} 먼저 때렸습니다! 기선 제압!`,
      `${who}, 오늘의 첫 유효타를 만듭니다!`,
    ],
    lowHp: who => [
      `${who}, 체력이 얼마 남지 않았습니다!`,
      `${who} 위험합니다! 한 방이면 끝나요!`,
      `${who}, 아슬아슬합니다. 버틸 수 있을까요!`,
      `${who}의 체력이 바닥을 보입니다!`,
    ],
    comeback: who => [
      `${who}, 뒤집었습니다! 역전입니다!`,
      `분위기가 바뀝니다! ${josa(who,'이','가')} 앞섭니다!`,
      `${who}의 역전! 이거 모르겠는데요!`,
      `${josa(who,'이','가')} 순위를 뒤집어 놓았습니다!`,
    ],
    overtime: () => [
      '연장전 돌입! 이제 진짜 승부입니다!',
      '시간이 다 됐습니다. 연장전으로 갑니다!',
      '승부를 못 냈습니다! 연장전 시작!',
      '연장전입니다. 여기서 갈립니다!',
    ],
    roundWin: who => [
      `${who}, 이번 라운드를 가져갑니다!`,
      `이번 라운드는 ${who}의 것입니다!`,
      `${who}, 깔끔하게 마무리했습니다!`,
      `${josa(who,'이','가')} 이번 라운드를 잡았습니다!`,
    ],
    draw: () => [
      '끝까지 팽팽했습니다! 이번 라운드는 무승부!',
      '승부를 가리지 못했습니다. 무승부입니다!',
      '누구도 물러서지 않았네요. 무승부!',
    ],
    gg: who => [
      `GG~~! ${who}, 최종 우승입니다!`,
      `GG~~! ${who}, 최종 우승을 차지합니다!`,
      `GG~~! ${who}, 최종 우승! 오늘의 주인공입니다!`,
    ],
  };

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

    // Authoritative match decision, not just the winner of one battle.
    decideMatch(champion, nowMilliseconds, matchKey) {
      if (!champion || champion.id == null || matchKey == null || this.finishedMatches.has(matchKey)) return null;
      this.finishedMatches.add(matchKey);
      if (this.finishedMatches.size > 64) this.finishedMatches.delete(this.finishedMatches.values().next().value);
      this.lastSpoken = finite(nowMilliseconds);
      return this.line('gg', 100, champion,
        pick(LINES.gg(nameOf(champion.name)), spin(champion.id + ':' + champion.name)), '최종 승부', true);
    }

    // Result-screen fallback for reconnects, old servers or offscreen fast-sim.
    finishMatch(players, nowMilliseconds, matchKey = players) {
      if (!Array.isArray(players) || !players.length || matchKey == null) return null;
      const ranks = new Set(players.map(player => player && player.rank));
      if (ranks.size !== players.length || players.some(player => !player ||
        !Number.isInteger(player.rank) || player.rank < 1 || player.rank > players.length)) return null;
      const champion = players.find(player => player.rank === 1);
      return this.decideMatch({ ...champion, id: champion.id ?? champion.uid ?? 0 }, nowMilliseconds, matchKey);
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
          resultDone: false, hits: new Map(), sourceTimes: new Map(), leadArmed: true,
          // 새로 잡는 상황들: 선제 타격 · 위기 · 역전 · 연장전
          firstHitDone: false, otDone: false, leaderUid: null, lowArmed: new Set() };
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
        const turn = spin(state.seq + ':' + finite(fighter && fighter.uid));
        return this.line('round-end', 90, fighter, fighter && !battle.result.draw
          ? pick(LINES.roundWin(nameOf(fighter.name)), turn)
          : battle.result.draw ? pick(LINES.draw(), turn)
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
          const who = nameOf(fighter.name);
          const turn = spin(finite(fighter.uid) + ':' + who + ':'
            + finite(fighter.player && fighter.player.rounds) + ':' + finite(battle.soundId));
          candidates.push(this.line('intro', 20, fighter, streak
            ? pick(LINES.streak(who, Math.floor(fighter.player.streak)), turn)
            : pick(LINES.intro(who, weapon ? weapon.name : '무기'), turn), 'ON AIR'));
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
            pick(LINES.skillUse(name, this.skillName(source)), spin(event.seq + source)), '스킬 발동'));
          continue;
        }
        if (event.type !== 'hit' || !(event.amount > 0) || !fighters.has(event.target) || event.target === event.actor) continue;
        const skillHit = source.startsWith('skill:') || source === 'char:bomb' || source === 'char:bball';
        if (skillHit) {
          const sourceKey = event.actor + ':' + source;
          if (now - (state.sourceTimes.get(sourceKey) ?? -Infinity) >= 8000) {
            candidates.push({ ...this.line('skill-hit', 80, fighter,
              pick(LINES.skillHit(name, this.skillName(source)), spin(event.seq + source)), '스킬 적중'), cooldownKey: sourceKey });
          }
        }
        if (Object.prototype.hasOwnProperty.call(SPECIALS, source)) {
          const sourceKey = event.actor + ':' + source;
          if (now - (state.sourceTimes.get(sourceKey) ?? -Infinity) >= 8000) {
            candidates.push({ ...this.line('special-hit', 60, fighter,
              pick(LINES.special(name, SPECIALS[source]), spin(event.seq + source)), '특수 공격'), cooldownKey: sourceKey });
          }
        }
        // Periodic damage, summons and passive systems must not look like a weapon combo.
        if (!source.startsWith('weapon:') && !source.startsWith('skill:')) continue;
        // 오늘의 첫 유효타. 지속 피해나 소환수가 아니라 직접 때린 것만 센다.
        if (!state.firstHitDone) {
          state.firstHitDone = true;
          candidates.push(this.line('first-blood', 65, fighter,
            pick(LINES.firstBlood(name), spin(event.seq + name)), '선제 타격'));
        }
        const pair = event.actor + '>' + event.target;
        let hits = (state.hits.get(pair) || []).filter(t => eventTime - t <= COMBO_WINDOW);
        if (!hits.length || eventTime - hits[hits.length - 1] >= .08 - 1e-6) hits.push(eventTime);
        state.hits.set(pair, hits);
        if (hits.length >= 3) {
          state.hits.set(pair, []);
          const sourceKey = 'combo:' + pair;
          if (now - (state.sourceTimes.get(sourceKey) ?? -Infinity) >= 8000) {
            candidates.push({ ...this.line('combo', 70, fighter,
              pick(LINES.combo(name), spin(event.seq + pair)), '연속 적중'), cooldownKey: sourceKey });
          }
        }
      }
      // 연장전 돌입. 한 번만 알린다.
      if (battle.overtime && !state.otDone) {
        state.otDone = true;
        candidates.push(this.line('overtime', 88, null,
          pick(LINES.overtime(), spin(state.seq + ':' + (battle.fighters || []).length)), '연장 돌입'));
      }
      /* 위기 — 체력이 25% 밑으로 떨어진 순간. 한 번 알린 선수는 35% 위로
       * 회복해야 다시 알린다. 안 그러면 바닥권에서 계속 떠든다. */
      for (const f of (battle.fighters || [])) {
        if (f.dead || f.mainDead) { state.lowArmed.delete(f.uid); continue; }
        const r = ratio(f);
        if (r > .35) { state.lowArmed.delete(f.uid); continue; }
        if (r > 0 && r <= .25 && !state.lowArmed.has(f.uid)) {
          state.lowArmed.add(f.uid);
          candidates.push(this.line('low-hp', 52, f,
            pick(LINES.lowHp(nameOf(f.name)), spin(state.seq + ':' + f.uid)), '위기'));
        }
      }
      const lead = this.lead(battle);
      /* 역전 — 앞서던 선수가 바뀌었다. 첫 관측은 기준만 잡고 넘어간다.
       * 체력이 붙어 있을 때 엎치락뒤치락하는 것까지 역전이라 부르지는 않는다. */
      if (lead.fighter) {
        const uid = lead.fighter.uid;
        if (state.leaderUid == null) state.leaderUid = uid;
        else if (state.leaderUid !== uid) {
          state.leaderUid = uid;
          if (time >= 4 && lead.gap >= .12) candidates.push(this.line('comeback', 75, lead.fighter,
            pick(LINES.comeback(nameOf(lead.fighter.name)), spin(state.seq + ':' + uid)), '역전'));
        }
      }
      if (lead.gap <= .2) state.leadArmed = true;
      if (time >= 3 && lead.fighter && lead.gap >= .35 && state.leadArmed) {
        state.leadArmed = false;
        candidates.push(this.line('lead', 50, lead.fighter,
          pick(LINES.lead(nameOf(lead.fighter.name)), spin(state.seq + ':' + lead.fighter.uid)), '체력 우세'));
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
