'use strict';
/* ============================================================
 * 바운스 로얄 — 솔로 로그라이크 규칙
 *
 *  - 몬스터·보스의 두뇌(brain: stats · move · act · down). sim.js는 brain이 있는
 *    전투원의 스탯·이동·공격·쓰러짐을 여기에 넘긴다.
 *  - 위험지역: 표시 → 충분한 예고 → 발동. 공은 즉시 꺾을 수 없으므로 광역 공격은
 *    모두 예고를 거친다 (기획서 14절).
 *  - 넉백과 벽꽝, 흡착, 점액, 전기줄 같은 웨이브 규칙 (sim.js의 rogue 훅).
 *  - 웨이브 전투 만들기, 라이벌 성장, 런 진행. DOM이 없어 테스트가 그대로 돌린다.
 *
 * 해설자는 추측하지 않는다. 기믹이 실제로 일어난 순간마다 rogueEvent를 남기고,
 * 해설(commentary-core.js)은 그 사실만 읽는다 (기획서 22절).
 * 이 파일은 클라이언트 전용이다 — 서버는 불러오지 않으므로 PvP와 무관하다.
 * ============================================================ */
(function (root) {
  const M = ROGUE_MONSTERS;
  const BRAINS = {};          // 몬스터 종류 -> 두뇌. 아래에서 종류마다 채운다

  /* ---------------- 이벤트 · 소리 ---------------- */
  const EVENT_TTL = 3, EVENT_CAP = 80;
  function rogueEvent(b, type, actor, target, data) {
    if (!b || !Array.isArray(b.rogueEvents)) return;
    b.rogueEvents.push({ seq: ++b.rogueSeq, t: b.simT || 0, type,
      actor: actor ? actor.uid : 0, target: target ? target.uid : 0, data: data || null });
    const cutoff = (b.simT || 0) - EVENT_TTL;
    while (b.rogueEvents.length && (b.rogueEvents[0].t < cutoff || b.rogueEvents.length > EVENT_CAP)) b.rogueEvents.shift();
  }
  const sound = (b, id, at, cooldown = 0) => battleSound(b, id, at, cooldown);

  /* ---------------- 기하 ---------------- */
  // 경기장 안쪽으로 끌어들인다 (몸 반지름 margin만큼 벽에서 띄운다)
  function clampInside(arena, x, y, margin = 0) {
    if (arena.type === 'diamond') {
      const lim = arena.L - margin * Math.SQRT2, sum = Math.abs(x) + Math.abs(y);
      if (sum > lim && sum > 0) { const k = lim / sum; return { x: x * k, y: y * k }; }
      return { x, y };
    }
    if (arena.type === 'circle') {
      const d = Math.hypot(x, y), lim = arena.R - margin;
      return d > lim ? { x: x / d * lim, y: y / d * lim } : { x, y };
    }
    const H = arena.H - margin;
    return { x: clamp(x, -H, H), y: clamp(y, -H, H) };
  }
  /* 마름모 벽 둘레를 0~4로 편다. 변 i는 꼭짓점 i에서 i+1로 간다.
   * 반지름 r인 몸이 벽에 붙어 있을 때의 중심 자리를 돌려준다. */
  const DIAMOND_V = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  function wallPoint(arena, s, r = 0) {
    const L = arena.L - r * Math.SQRT2;
    const k = ((s % 4) + 4) % 4, i = Math.floor(k), u = k - i;
    const a = DIAMOND_V[i], c = DIAMOND_V[(i + 1) % 4];
    const x = (a[0] + (c[0] - a[0]) * u) * L, y = (a[1] + (c[1] - a[1]) * u) * L;
    // 안쪽을 향하는 법선
    const nx = -Math.sign(a[0] + c[0]) * Math.SQRT1_2, ny = -Math.sign(a[1] + c[1]) * Math.SQRT1_2;
    return { x, y, nx, ny };
  }
  // 점에서 가장 가까운 벽 둘레 위치(0~4)
  function wallParam(arena, x, y) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < 4; i++) {
      const a = DIAMOND_V[i], c = DIAMOND_V[(i + 1) % 4];
      const ax = a[0] * arena.L, ay = a[1] * arena.L, cx = c[0] * arena.L, cy = c[1] * arena.L;
      const ex = cx - ax, ey = cy - ay;
      const u = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0, 1);
      const d = Math.hypot(x - (ax + ex * u), y - (ay + ey * u));
      if (d < bestD) { bestD = d; best = i + u; }
    }
    return best;
  }
  function turnToward(f, ang, rate, dt) {
    const cur = Math.atan2(f.vy, f.vx);
    const next = cur + clamp(angleDelta(cur, ang), -rate * dt, rate * dt);
    f.vx = Math.cos(next); f.vy = Math.sin(next);
  }
  // 상대가 lead초 뒤에 있을 자리 (몸 이동은 GAME_SPEED로 느려진다)
  function predict(target, lead) {
    const s = (target.st ? target.st.move : 160) * GAME_SPEED * lead;
    return { x: target.x + (target.vx || 0) * s, y: target.y + (target.vy || 0) * s };
  }
  const angTo = (a, bx, by) => Math.atan2(by - a.y, bx - a.x);

  /* ---------------- 편 가르기 ---------------- */
  const isMonster = f => !!(f && f.team === 'monster');
  // 몬스터가 칠 수 있는 몸: 영웅의 본체·분열체·소환수
  function heroBodies(b) {
    const out = [];
    for (const f of b.fighters) {
      if (isMonster(f)) continue;
      for (const body of b.bodiesOf(f)) out.push(body);
    }
    return out;
  }
  function heroFighters(b) { return heroBodies(b).filter(isFighterBody); }
  function monsterBodies(b) { return b.fighters.filter(f => isMonster(f) && !f.dead && !f.phased); }
  function aliveMonsters(b) { return b.fighters.filter(f => isMonster(f) && !f.dead); }

  /* ---------------- 피해 · 넉백 ---------------- */
  /* 몬스터가 영웅을 친다. from(맞은 자리)이 있으면 단단한 손(방패 정면 막기)이 막을 수 있다.
   * 피해는 그 웨이브의 피해 배율(st.dmg)을 곱한다. */
  function monsterHit(b, src, body, dmg, from, source) {
    if (!body || body.hp <= 0) return 0;
    const tag = source || 'monster:' + (src && src.mtype || 'hazard');
    if (from && shieldGuards(b, src, body, from, tag, dmg)) return 0;
    const mult = src && src.st ? src.st.dmg : 1;
    return dealDamage(b, src, body, dmg * mult, { kind: 'monster', commentarySource: tag, from });
  }
  /* 넉백 — 거리(distance, 화면 px)를 time초 동안 줄어드는 속도로 날아간다.
   * 날아가는 중 벽에 부딪히면 slam {dmg, stun}만큼 추가 피해와 기절이 걸린다. */
  function knockHero(b, src, body, dx, dy, distance, slam, time = 0.5) {
    if (!isFighterBody(body) || body.dead || body.mainDead) return;
    if (body.timers.immune > 0 || body.timers.untouchable > 0) return;
    const n = normDir(dx, dy);
    const v0 = (2 * distance / time) / GAME_SPEED;
    body.knock = { vx: n.x * v0, vy: n.y * v0, v0x: n.x * v0, v0y: n.y * v0, age: 0, T: time, src, slam: slam || null };
  }
  function wallSlam(b, f, k) {
    const src = k.src;
    const dmg = k.slam ? k.slam.dmg : 0;
    if (dmg > 0) dealDamage(b, src, f, dmg * (src && src.st ? src.st.dmg : 1), { kind: 'monster', commentarySource: 'monster:wall-slam' });
    if (k.slam && k.slam.stun && !f.dead) f.timers.stun = Math.max(f.timers.stun, k.slam.stun);
    comicBurst(b, f.x, f.y, f.radius);
    b.shake = Math.min(15, b.shake + 7);
    sound(b, 'monster.wall.slam', f, 0.2);
    popup(b, f.x, f.y - f.radius - 26, '벽꽝!', '#ffd24d', true);
    rogueEvent(b, 'WALL_SLAM', src, f, { stun: k.slam ? k.slam.stun : 0 });
  }
  function comicBurst(b, x, y, r) {
    addFx(b, { type: 'ring', x, y, r0: r * 0.6, r1: r * 2.4, color: '#ffe38a', dur: 0.32, boom: true });
    sparks(b, x, y, 12, '#fff2b0', 240);
  }

  /* ---------------- 위험지역 ----------------
   * kind circle(원) · ring(퍼지는 고리) · line(가로지르는 줄) · puddle(점액 웅덩이) · mark(표시만)
   * theme은 그림의 재질이다: fire(마법사) earth(해머) arcane(챔피언) boom(붐볼) slime drill aim */
  function addHazard(b, o) {
    const h = Object.assign({ uid: ++UID, t: 0, warn: 1, fade: 0.35, dmg: 0, hit: new Set(), fired: false,
      done: false, theme: 'fire', hurtsMonsters: false, dmgMonster: 0 }, o);
    b.rogueHazards.push(h);
    return h;
  }
  function hazardTargets(b, h) {
    const out = heroBodies(b);
    if (h.hurtsMonsters) for (const m of monsterBodies(b)) if (m !== h.owner) out.push(m);
    return out;
  }
  function hazardHit(b, h, body, fromX, fromY) {
    if (h.hit.has(body.uid)) return;
    h.hit.add(body.uid);
    if (isMonster(body)) {
      if (h.dmgMonster > 0) dealDamage(b, h.owner, body, h.dmgMonster, { kind: 'auto', commentarySource: 'rogue:' + h.theme });
      if (h.onMonster) h.onMonster(b, h, body);
      return;
    }
    const dealt = h.dmg > 0 ? monsterHit(b, h.owner, body, h.dmg, null, h.source) : 0;
    if (h.knock && isFighterBody(body)) {
      const dx = body.x - fromX, dy = body.y - fromY;
      knockHero(b, h.owner, body, Math.hypot(dx, dy) > 1 ? dx : 1, dy, h.knock, h.slam, 0.5);
    }
    if (h.slime && isFighterBody(body)) body.timers.slime = Math.max(body.timers.slime || 0, h.slime);
    if (h.onHero) h.onHero(b, h, body, dealt);
  }
  function updateHazards(b, dt) {
    const list = b.rogueHazards;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      h.t += dt;
      if (h.kind === 'puddle') {
        for (const body of heroFighters(b)) {
          if (dist(h.x, h.y, body.x, body.y) < h.r + bodyRadius(body) * 0.6) body.timers.slime = Math.max(body.timers.slime || 0, 0.6);
        }
        if (h.t >= h.life) list.splice(i, 1);
        continue;
      }
      if (h.kind === 'mark') { if (h.t >= h.warn + h.fade) list.splice(i, 1); continue; }
      if (!h.fired && h.t >= h.warn) {
        h.fired = true;
        if (h.onFire) h.onFire(b, h);
        if (h.kind === 'circle') {
          for (const body of hazardTargets(b, h)) {
            if (dist(h.x, h.y, body.x, body.y) < h.r + bodyRadius(body)) hazardHit(b, h, body, h.x, h.y);
          }
        }
      }
      if (h.fired && h.kind === 'ring') {
        const p = clamp((h.t - h.warn) / h.dur, 0, 1), radius = h.r0 + (h.r1 - h.r0) * p;
        h.cur = radius;
        if (p < 1) for (const body of hazardTargets(b, h)) {
          if (Math.abs(dist(h.x, h.y, body.x, body.y) - radius) < h.width / 2 + bodyRadius(body)) hazardHit(b, h, body, h.x, h.y);
        }
      }
      if (h.fired && h.kind === 'line' && h.t < h.warn + h.active) {
        for (const body of hazardTargets(b, h)) {
          if (segDist(body.x, body.y, h.x, h.y, h.x2, h.y2) < h.w / 2 + bodyRadius(body)) {
            const u = clamp(((body.x - h.x) * (h.x2 - h.x) + (body.y - h.y) * (h.y2 - h.y)) / ((h.x2 - h.x) ** 2 + (h.y2 - h.y) ** 2 || 1), 0, 1);
            hazardHit(b, h, body, h.x + (h.x2 - h.x) * u, h.y + (h.y2 - h.y) * u);
          }
        }
      }
      const end = h.warn + (h.kind === 'ring' ? h.dur : h.kind === 'line' ? h.active : 0) + h.fade;
      if (h.t >= end) list.splice(i, 1);
    }
  }

  /* ---------------- 몬스터 만들기 ---------------- */
  function makeMonster(b, type, x, y, scale = {}) {
    const def = M[type];
    const hpMul = scale.hp || 1, dmgMul = scale.dmg || 1;
    const maxHp = Math.max(1, Math.round(def.hp * hpMul));
    const ang = Math.atan2(-y, -x);
    const m = {
      uid: ++UID, kind: 'main', b, team: 'monster', monster: def, mtype: type, boss: !!def.boss,
      name: def.name, isAI: true, color: def.color, player: null, pid: null,
      charId: null, weaponId: null,
      perm: { atk: 1, dmg: dmgMul, hp: 1, move: 1, aspd: 1, size: 1, dmgTaken: 1 },
      flags: {}, x, y, vx: Math.cos(ang), vy: Math.sin(ang), hp: maxHp, maxHp, shield: 0,
      radius: def.r * (def.boss ? 1 : ROGUE_BODY_SCALE), r: def.r * (def.boss ? 1 : ROGUE_BODY_SCALE),
      weaponAngle: ang, spinAcc: 0, spinRemaining: 0,
      timers: {
        immune: 0, untouchable: 0, freeze: 0, bind: 0, stun: 0, weaponLock: 0, chase: 0, revSpeed: 0,
        rampage: 0, balloon: 0, fuse: 0, det: 0, gunBarrage: 0, dashPrep: 0, dashT: 0, actingDead: 0,
        atkBuff: 0, spdBuff: 0, berserk: 0, elastic: 0, slime: 0,
      },
      st: { atk: 1, dmg: dmgMul, move: def.speed, rot: 0, fr: 1, aspd: 1, size: 1 },
      warmStacks: 0, rotStacks: 0, hitChargeStacks: 0, collisionStacks: 0,
      cd: {}, meleeContact: new Set(), markHits: new Map(),
      bleed: { n: 0, stacks: [] }, frost: { n: 0, t: 0 }, hist: [], histT: 0,
      skillUses: { char: 0, weapon: 0, cd: 0 }, summons: [], splitBalls: [], satellites: [],
      mainDead: false, dead: false, deathAt: 0, downPending: false,
      flash: 0, staticCd: 0, collisionCd: 0, aimTouched: true,
      steer: { active: false, angle: 0, magnitude: 0, power: 0, lock: 0 },
      mass: def.mass || 1, shakeScale: def.boss ? 0.55 : 0.3,
      sizeMul: def.boss ? 1 : ROGUE_BODY_SCALE,   // 보스 말고는 조금 작게 (경기장에 자리를 낸다)
      brain: BRAINS[type], waveHp: hpMul,
      ai: { state: 'idle', t: rand(0.2, 0.9), cd: rand(0.4, 1.2), hitSet: new Set(), born: 0 },
      spawnX: x, spawnY: y,
    };
    if (m.brain.init) m.brain.init(b, m);
    return m;
  }
  function addMonster(b, type, x, y, scale) {
    const m = makeMonster(b, type, x, y, scale);
    b.fighters.push(m);
    return m;
  }
  /* 한 자리에 세운다. 볼트윈처럼 짝이 있는 종류는 짝까지 세우고 둘 사이에 줄을 잇는다.
   * 세운 몸을 모두 돌려준다 (웨이브 구성과 전시관이 같은 길을 쓴다). */
  function spawnMonster(b, type, x, y, scale = {}) {
    const def = M[type];
    const out = [addMonster(b, type, x, y, scale)];
    if (def.pair) {
      const q = clampInside(b.arena, x + rand(-40, 40), y + (y > 0 ? -1 : 1) * def.spread * 0.9, def.r);
      const mate = addMonster(b, type, q.x, q.y, scale);
      const link = { active: false, charge: 0, axis: rand(0, TAU) };
      out[0].ai.partner = mate; mate.ai.partner = out[0];
      out[0].ai.lead = true; out[0].ai.link = link; mate.ai.link = link;
      out.push(mate);
    }
    return out;
  }
  // 보스에게 다음 패턴을 지정한다 (전시관 전용)
  function forcePattern(f, id) { if (f && f.ai) f.ai.force = id; }

  /* ---------------- 공용 두뇌 부품 ---------------- */
  function monsterStats(b, f) {
    if (f.dead) return;
    const def = f.monster, T = f.timers;
    let move = def.speed * f.perm.move * (f.ai.speedMul == null ? 1 : f.ai.speedMul), aspd = 1;
    if (T.freeze > 0) { move *= 0.3; aspd *= 0.3; }
    if (f.frost.n > 0) move *= 1 - 0.1 * Math.min(3, f.frost.n);
    f.st = { atk: 1, dmg: f.perm.dmg, move, rot: 0, fr: aspd, aspd, size: 1 };
    f.radius = f.r = def.r * (f.sizeMul || 1);
  }
  // 움직일 수 있는가: 기절·무기 강탈·빙결 중에는 공격을 멈춘다
  const disabled = f => f.dead || f.timers.stun > 0;
  const disarmed = f => f.timers.weaponLock > 0;
  function monsterMove(b, f, dt) {
    if (f.dead || f.phased || f.timers.stun > 0 || f.ai.hold) return 0;
    const sp = f.st.move * GAME_SPEED * dt;
    f.x += f.vx * sp; f.y += f.vy * sp;
    const n = b.arena.collideBody(f);
    if (n > 0 && f.brain.onWall) f.brain.onWall(b, f, n);
    return n;
  }
  function tickSpawn(f, dt) { if (f.ai.born > 0) f.ai.born = Math.max(0, f.ai.born - dt); }
  function monsterDown(b, f, src, opts = {}) {
    if (f.dead) return;
    f.hp = 0; f.dead = true; f.deathAt = b.simT; f.phased = false;
    const col = f.monster.palette.body;
    if (opts.fx !== false) {
      shatterFx(b, f.x, f.y, f.radius, col);
      sparks(b, f.x, f.y, 8, '#fff2c8', 200);
    }
    sound(b, f.boss ? 'boss.down' : 'monster.pop', f, 0.03);
    if (b.rogueStats) b.rogueStats.kills++;
    rogueEvent(b, 'MONSTER_DOWN', src, f, { type: f.mtype });
    const left = aliveMonsters(b).length;
    if (left === 1 && b.rogueStats && b.rogueStats.spawned >= 3 && !b.rogueFlags.lastOne) {
      b.rogueFlags.lastOne = true;
      rogueEvent(b, 'LAST_MONSTER', aliveMonsters(b)[0], null);
    }
    b.checkEnd();
  }
  const basicDown = (b, f, src) => monsterDown(b, f, src);

  /* 쫓아가기: 목표 쪽으로 제 조향 한도만큼 튼다. side는 옆으로 비껴 붙는 정도(rad). */
  function chase(b, f, dt, target, lead = 0.4, side = 0) {
    if (!target) return;
    const p = predict(target, lead * clamp(dist(f.x, f.y, target.x, target.y) / 300, 0, 1));
    turnToward(f, angTo(f, p.x, p.y) + side, f.monster.turn, dt);
  }
  /* 요격: 상대가 지금 속도로 계속 간다고 보고 만날 자리로 튼다. 느린 몬스터일수록 더 앞을
   * 질러가야 한다 — 뒤꽁무니만 쫓으면 나보다 빠른 공은 영영 못 잡는다. */
  function intercept(b, f, dt, target, max = 1.3, side = 0) {
    if (!target) return;
    const speed = Math.max(40, f.st.move) * GAME_SPEED;
    const lead = clamp(dist(f.x, f.y, target.x, target.y) / speed, 0, max);
    const p = predict(target, lead);
    const at = clampInside(b.arena, p.x, p.y, f.radius);
    turnToward(f, angTo(f, at.x, at.y) + side, f.monster.turn, dt);
  }
  /* 도망: 상대 반대쪽으로 튼다. 등 뒤가 벽이면 벽을 따라 옆으로 빠진다(구석에 몰리지 않게). */
  function flee(b, f, dt, target, turnMul = 1.3) {
    if (!target) return;
    let away = angTo(target, f.x, f.y);
    const back = { x: f.x + Math.cos(away) * 130, y: f.y + Math.sin(away) * 130 };
    if (wallGap(b.arena, back.x, back.y, f.radius) < 16) {
      if (!f.ai.fleeSide) f.ai.fleeSide = chance(0.5) ? 1 : -1;
      away += f.ai.fleeSide * 1.45;
    }
    turnToward(f, away, f.monster.turn * turnMul, dt);
  }
  /* 거리 두기: 원하는 거리보다 가까우면 물러나고 멀면 다가가며, 그 사이에서는 옆으로 돈다. */
  function keepDistance(b, f, dt, target, want) {
    if (!target) return;
    const d = dist(f.x, f.y, target.x, target.y), toward = angTo(f, target.x, target.y);
    let ang;
    if (d < want * 0.75) ang = toward + Math.PI;
    else if (d > want * 1.3) ang = toward;
    else ang = toward + (f.ai.side || 1) * 1.35;
    if (chance(0.004)) f.ai.side = -(f.ai.side || 1);
    turnToward(f, ang, f.monster.turn, dt);
  }

  /* ═══════════ 고블린볼 ═══════════ */
  /* 몸에 달린 무기가 돈다 — 아레나의 검·단검과 같은 방식이다. 예고도 휘두르는 동작도 없고,
   * 닿으면 맞는다. 한 번 닿은 상대는 무기에서 떨어졌다 다시 닿아야 또 맞는다(아레나의 접촉 규칙).
   * 예고하고 치는 것은 보스와 러시혼처럼 특별한 몬스터만 한다. */
  function spinWeapon(b, f, dt) {
    const def = f.monster;
    if (f.timers.stun > 0 || f.dead) { f.meleeContact.clear(); return; }
    if (!disarmed(f)) {
      const applied = def.rot * GAME_SPEED * dt;
      f.weaponAngle = (f.weaponAngle + applied) % TAU;
      // 무거운 무기는 한 바퀴에 한 번 바람 소리를 낸다
      if (def.whoosh) {
        f.ai.spin = (f.ai.spin || 0) + applied;
        if (f.ai.spin >= TAU) {
          f.ai.spin -= TAU;
          sound(b, f.mtype === 'hammer' ? 'monster.hammer.smash' : 'monster.giant.swing', f, 0.25);
        }
      }
    }
    const scale = f.sizeMul || 1;
    const ang = f.weaponAngle, tip = f.radius + def.reach * scale;
    const ax = f.x + Math.cos(ang) * f.radius * 0.4, ay = f.y + Math.sin(ang) * f.radius * 0.4;
    const bx = f.x + Math.cos(ang) * tip, by = f.y + Math.sin(ang) * tip;
    const contact = new Set();
    for (const body of heroBodies(b)) {
      if (segDist(body.x, body.y, ax, ay, bx, by) >= bodyRadius(body) + def.tip * scale) continue;
      if (f.meleeContact.has(body.uid)) { contact.add(body.uid); continue; }
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const u = len2 > 0 ? clamp(((body.x - ax) * (bx - ax) + (body.y - ay) * (by - ay)) / len2, 0, 1) : 0;
      const from = { x: ax + (bx - ax) * u, y: ay + (by - ay) * u };
      // 무적·보호막으로 피해가 0이면 접촉으로 치지 않고 다음 프레임에 다시 본다
      if (monsterHit(b, f, body, def.dmg, from) <= 0) continue;
      contact.add(body.uid);
      sound(b, def.knock ? 'monster.hammer.smash' : 'monster.club.hit', body, 0.05);
      sparks(b, from.x, from.y, 4, '#ffe38a', 120);
      /* 밀어내기는 쿨다운이 있다. 무기가 계속 도는 만큼, 닿을 때마다 날리면
       * 벽꽝이 연달아 터져 손쓸 틈이 없었다. */
      if (def.knock && isFighterBody(body) && b.simT >= (f.ai.knockAt || 0)) {
        f.ai.knockAt = b.simT + (def.knockCd || 1);
        knockHero(b, f, body, body.x - f.x, body.y - f.y, def.knock,
          def.slamDmg ? { dmg: def.slamDmg, stun: def.slamStun } : null, def.knock > 150 ? 0.5 : 0.3);
      }
    }
    f.meleeContact = contact;
  }
  /* 몽둥이·거인·해머 정예: 쫓아오면서 무기를 돌린다. */
  function meleeBrain() {
    return {
      stats: monsterStats, down: basicDown,
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        if (!disabled(f)) intercept(b, f, dt, b.nearestEnemyMain(f), 1.3);
        spinWeapon(b, f, dt);
      },
    };
  }

  /* 점액: 거리를 두고 점액탄을 뱉는다. 맞으면 둔화, 빗나가면 떨어진 자리에 웅덩이. */
  function slimeBrain() {
    return {
      stats: monsterStats, down: basicDown,
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const target = b.nearestEnemyMain(f);
        ai.cd = Math.max(0, ai.cd - dt);
        if (disabled(f)) { ai.state = 'idle'; ai.speedMul = 1; return; }
        if (target) f.weaponAngle = angTo(f, target.x, target.y);
        const near = target ? dist(f.x, f.y, target.x, target.y) : 1e9;
        if (ai.state === 'idle') {
          ai.speedMul = 1;
          // 원거리는 붙으면 진다. 가까우면 물러나고, 적당한 거리에서는 옆으로 돌며 뱉는다.
          if (near < def.keep * 0.62) flee(b, f, dt, target);
          else keepDistance(b, f, dt, target, def.keep);
          if (target && ai.cd <= 0 && !disarmed(f) && near < def.keep * 1.6) {
            ai.state = 'windup'; ai.t = def.windup; ai.speedMul = 0.55;
          }
        } else if (ai.state === 'windup') {
          ai.t -= dt;
          // 뱉는 동안에도 멈춰 서지 않는다 (서 있으면 그대로 받아친다)
          if (near < def.keep * 0.8) flee(b, f, dt, target, 0.9);
          if (ai.t <= 0) {
            ai.state = 'idle'; ai.cd = def.cd + rand(-0.3, 0.4); ai.speedMul = 1;
            if (target) spitSlime(b, f, target);
          }
        }
      },
    };
  }
  function spitSlime(b, f, target) {
    const def = f.monster;
    const flight = dist(f.x, f.y, target.x, target.y) / (def.shotSpd * GAME_SPEED);
    const aim = predict(target, Math.min(1.1, flight) * rand(0.55, 1.0));
    const a = angTo(f, aim.x, aim.y) + rand(-0.08, 0.08);
    sound(b, 'monster.slime.spit', f, 0.1);
    spawnProj(b, f, {
      kind: 'slime', x: f.x + Math.cos(a) * (f.radius + 6), y: f.y + Math.sin(a) * (f.radius + 6),
      ang: a, spd: def.shotSpd, dmg: def.dmg, r: def.shotR, life: def.shotLife,
      onHit(bb, p, body, dealt) {
        sound(bb, 'monster.slime.splat', body, 0.08);
        sparks(bb, p.x, p.y, 6, '#b4e35a', 120);
        if (isFighterBody(body) && dealt > 0) {
          body.timers.slime = Math.max(body.timers.slime || 0, def.slowT);
          popup(bb, body.x, body.y - bodyRadius(body) - 22, '점액!', '#b4e35a');
        }
      },
      onExpire(bb, p) {
        // 빗나간 점액은 떨어진 자리에 웅덩이로 남는다
        const at = clampInside(bb.arena, p.x, p.y, def.puddleR * 0.6);
        addHazard(bb, { kind: 'puddle', theme: 'slime', x: at.x, y: at.y, r: def.puddleR, life: def.puddleT, owner: p.owner });
        sound(bb, 'monster.slime.splat', at, 0.08);
      },
    });
  }

  /* 마법사: 거리를 두다가 멈춰 주문을 외고, 바닥에 위험지역을 표시한 뒤 화염을 떨어뜨린다. */
  function mageBrain() {
    return {
      stats: monsterStats, down: basicDown,
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const target = b.nearestEnemyMain(f);
        ai.cd = Math.max(0, ai.cd - dt);
        if (disabled(f)) { ai.state = 'idle'; ai.speedMul = 1; return; }
        if (target) f.weaponAngle = angTo(f, target.x, target.y);
        const near = target ? dist(f.x, f.y, target.x, target.y) : 1e9;
        if (ai.state === 'idle') {
          ai.speedMul = 1;
          /* 마법사는 멀리서만 힘을 쓴다. 공이 파고들면 주문을 접고 전력으로 물러났다가,
           * 다시 거리를 벌린 뒤에야 표식을 깐다. */
          if (near < def.keep * 0.6) { flee(b, f, dt, target); ai.speedMul = 1.3; }   // 쫓기면 전력으로
          else keepDistance(b, f, dt, target, def.keep);
          if (target && ai.cd <= 0 && !disarmed(f) && near > def.keep * 0.55) {
            ai.state = 'cast'; ai.t = def.castT; ai.speedMul = 0.35; sound(b, 'monster.mage.cast', f, 0.2);
          }
        } else if (ai.state === 'cast') {
          if (near < def.keep * 0.75) flee(b, f, dt, target, 0.8);
          ai.t -= dt;
          if (ai.t <= 0) {
            ai.state = 'idle'; ai.cd = def.cd + rand(-0.4, 0.5); ai.speedMul = 1;
            if (target) castFireMarks(b, f, target, (b.rogueWave && b.rogueWave.n >= 12) ? 2 : def.marks);
          }
        }
      },
    };
  }
  function castFireMarks(b, f, target, count) {
    const def = f.monster;
    // 앞지르는 폭은 예고 시간의 절반쯤까지만 — 조향이 느려서 더 앞을 찍으면 궤도를 틀어도 못 빠진다
    const spots = [predict(target, def.warn * rand(0.3, 0.6))];
    for (let i = 1; i < count; i++) spots.push({ x: target.x + rand(-120, 120), y: target.y + rand(-120, 120) });
    for (const s of spots) {
      const at = clampInside(b.arena, s.x, s.y, def.blastR * 0.4);
      addHazard(b, { kind: 'circle', theme: 'fire', x: at.x, y: at.y, r: def.blastR, warn: def.warn, fade: 0.45,
        dmg: def.dmg, owner: f, source: 'monster:mage',
        onFire(bb, h) { explodeFx(bb, h.x, h.y, h.r, '#ff8a3c', null); sound(bb, 'monster.mage.blast', h, 0.05); } });
    }
  }

  BRAINS.club = meleeBrain(); BRAINS.giant = meleeBrain(); BRAINS.hammer = meleeBrain();
  BRAINS.slime = slimeBrain(); BRAINS.mage = mageBrain();

  /* ═══════════ 기믹 몬스터 ═══════════
   * 한 마리에 한 가지 강한 특징만 준다. 어려움은 여러 종류를 섞을 때 생긴다 (기획서 10절). */

  /* 볼트윈 — 두 마리가 한 세트. 둘이 경기장을 가로질러 움직이며 그 사이의 전기줄이
   * 움직이는 장벽이 된다. 둘이 나를 사이에 두려고 축을 천천히 돌린다. */
  function voltBrain() {
    return {
      stats: monsterStats, down: basicDown,
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai, mate = ai.partner && !ai.partner.dead ? ai.partner : null;
        const target = b.nearestEnemyMain(f);
        const link = ai.link;
        if (ai.lead || !mate) {
          /* 줄은 선이라 방향이 둘(±π)이다. 상대가 가는 길을 가로지르는 쪽으로 천천히 돌린다 —
           * 그래야 지나가다 줄에 걸린다. 상대가 멈춰 있으면 그냥 제자리에서 돈다. */
          const moving = target && Math.hypot(target.vx, target.vy) > 0.2;
          const want = moving ? Math.atan2(target.vy, target.vx) + Math.PI / 2 : null;
          if (want == null) link.axis = (link.axis || 0) + def.spin * dt;
          else {
            const cur = link.axis || 0;
            const near = Math.abs(angleDelta(cur, want)) <= Math.abs(angleDelta(cur, want + Math.PI)) ? want : want + Math.PI;
            link.axis = cur + clamp(angleDelta(cur, near), -def.spin * 2.2 * dt, def.spin * 2.2 * dt);
          }
        }
        if (!disabled(f) && target) {
          if (mate) {
            // 축의 양 끝으로 간다. 둘 다 자리에 닿으면 줄이 나를 지나간다.
            const side = ai.lead ? 1 : -1;
            const gx = target.x + Math.cos(link.axis) * def.spread * side, gy = target.y + Math.sin(link.axis) * def.spread * side;
            const at = clampInside(b.arena, gx, gy, f.radius + 8);
            turnToward(f, angTo(f, at.x, at.y), def.turn, dt);
          } else chase(b, f, dt, target, 0.3, (ai.side || 1) * 0.5);
        }
        if (!ai.lead && mate) return;     // 줄은 한 마리(리더)가 맡는다
        const both = mate && !f.phased && !mate.phased && !disabled(f) && !disabled(mate);
        if (!both || dist(f.x, f.y, mate.x, mate.y) > def.linkMax) { link.active = false; link.charge = 0; return; }
        link.charge += dt;
        if (!link.active && link.charge >= def.linkCharge) {
          link.active = true;
          sound(b, 'monster.volt.link', f, 0.5);
          rogueEvent(b, 'VOLTTWIN_LINK_CREATED', f, mate);
        }
        if (!link.active) return;
        const hits = ai.linkHits || (ai.linkHits = new Map());
        for (const body of heroBodies(b)) {
          if (segDist(body.x, body.y, f.x, f.y, mate.x, mate.y) >= def.lineW + bodyRadius(body)) continue;
          if (b.simT < (hits.get(body.uid) || 0)) continue;
          hits.set(body.uid, b.simT + def.lock);
          const dealt = monsterHit(b, f, body, def.dmg, null, 'monster:volt');
          if (dealt > 0) {
            sparks(b, body.x, body.y, 8, '#fff58a', 180);
            boltFx(b, f.x, f.y, body.x, body.y);
            sound(b, 'monster.volt.zap', body, 0.12);
            if (isFighterBody(body)) rogueEvent(b, 'VOLTTWIN_LINK_HIT', f, body);
          }
        }
        if (hits.size > 16) hits.clear();
      },
    };
  }

  /* 흡착볼 — 부딪히면 달라붙어 움직임과 공격을 늦춘다. 시간이 지나도 안 떨어진다.
   * 벽에 정면으로 세게 부딪혀야 떨어진다 (afterMove가 본다). 붙어 있는 동안은 칠 수 없다. */
  function suctionBrain() {
    return {
      stats: monsterStats, down: basicDown,
      move(b, f, dt) {
        const at = f.attached;
        if (at) {
          const t = at.target;
          if (!t || t.dead || t.mainDead || t.hp <= 0) { detachSuction(b, f, false); return; }
          const R = bodyRadius(t) + f.radius * 0.45;
          f.x = t.x + Math.cos(at.ang) * R; f.y = t.y + Math.sin(at.ang) * R;
          return;
        }
        monsterMove(b, f, dt);
      },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        ai.reattach = Math.max(0, (ai.reattach || 0) - dt);
        if (f.attached) {
          f.attached.ang += 0.25 * dt;          // 표면을 따라 조금씩 미끄러진다
          ai.drain = (ai.drain == null ? def.drainT : ai.drain) - dt;
          if (ai.drain <= 0) {
            ai.drain = def.drainT;
            dealDamage(b, f, f.attached.target, def.drain * f.st.dmg, { kind: 'monster', commentarySource: 'monster:suction' });
          }
          return;
        }
        if (disabled(f)) return;
        const target = b.nearestEnemyMain(f);
        if (!target) return;
        intercept(b, f, dt, target, 1.5);
        if (ai.reattach > 0 || !isFighterBody(target) || target.dead) return;
        if (dist(f.x, f.y, target.x, target.y) < f.radius + bodyRadius(target) + 2) {
          f.attached = { target, ang: angTo(target, f.x, f.y) };
          f.phased = true;
          sound(b, 'monster.suction.attach', target, 0.1);
          popup(b, target.x, target.y - bodyRadius(target) - 24, '흡착!', '#e7a6ff');
          const first = !b.rogueRun || !b.rogueRun.seen.suctionTip;
          if (b.rogueRun) b.rogueRun.seen.suctionTip = true;
          rogueEvent(b, 'SUCTIONBALL_ATTACHED', f, target, { first });
        }
      },
    };
  }
  function detachSuction(b, s, squish, hero) {
    const at = s.attached;
    if (!at) return;
    const t = at.target;
    s.attached = null; s.phased = false;
    const R = bodyRadius(t || s) + s.radius + 4;
    if (t) { s.x = t.x + Math.cos(at.ang) * R; s.y = t.y + Math.sin(at.ang) * R; }
    const pos = clampInside(b.arena, s.x, s.y, s.radius);
    s.x = pos.x; s.y = pos.y;
    s.vx = Math.cos(at.ang); s.vy = Math.sin(at.ang);
    s.ai.reattach = s.monster.reattach;
    if (squish) {
      s.timers.stun = Math.max(s.timers.stun, 1.1);
      sparks(b, s.x, s.y, 8, '#f2c2ff', 160);
      dealDamage(b, hero || t, s, s.monster.squish, { kind: 'auto', commentarySource: 'rogue:squish' });
    }
  }
  function attachedTo(b, body) {
    const out = [];
    for (const f of b.fighters) if (f.mtype === 'suction' && !f.dead && f.attached && f.attached.target === body) out.push(f);
    return out;
  }

  /* 붐볼 — 다가와 카운트다운 후 폭발한다. 폭발은 다른 몬스터에게 더 아프다.
   * 카운트다운 중에도 따라오므로 무리 쪽으로 끌고 가 같이 터뜨릴 수 있다. 연쇄도 된다.
   * 카운트다운 전에 쓰러뜨리면 그냥 터져 없어지고, 카운트다운 중에 쓰러뜨리면 그 자리에서 폭발한다. */
  function boomBrain() {
    return {
      stats: monsterStats,
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const target = b.nearestEnemyMain(f);
        if (ai.fuse > 0) {
          ai.fuse -= dt;
          ai.tick = (ai.tick || 0) - dt;
          if (ai.tick <= 0) { ai.tick = Math.max(0.12, ai.fuse * 0.3); sound(b, 'monster.boom.tick', f, 0.05); }
          if (!disabled(f) && target) intercept(b, f, dt, target, 1.2);
          if (ai.fuse <= 0) boomExplode(b, f);
          return;
        }
        if (disabled(f) || !target) return;
        ai.speedMul = 1;
        intercept(b, f, dt, target, 1.4);
        if (dist(f.x, f.y, target.x, target.y) < def.trigger + bodyRadius(target)) boomArm(b, f, def.fuse);
      },
      down(b, f, src) {
        if (f.ai.fuse > 0 && !f.ai.exploded) { boomExplode(b, f); return; }
        monsterDown(b, f, src);
      },
    };
  }
  function boomArm(b, f, fuse) {
    const ai = f.ai;
    if (ai.exploded) return;
    if (ai.fuse > 0) { ai.fuse = Math.min(ai.fuse, fuse); return; }
    ai.fuse = fuse; ai.fuseMax = fuse; ai.tick = 0; ai.speedMul = f.monster.chaseMul;
    rogueEvent(b, 'BOOMBALL_COUNTDOWN', f, null, { chain: fuse < 0.5 });
  }
  function boomExplode(b, f) {
    const def = f.monster, ai = f.ai;
    if (ai.exploded) return;
    ai.exploded = true; ai.fuse = 0;
    explodeFx(b, f.x, f.y, def.blastR, '#ff8a3c', 'monster.boom.blast');
    b.shake = Math.min(16, b.shake + 6);
    for (const body of heroBodies(b)) {
      if (dist(f.x, f.y, body.x, body.y) >= def.blastR + bodyRadius(body)) continue;
      monsterHit(b, f, body, def.dmgHero, null, 'monster:boom');
      if (isFighterBody(body)) knockHero(b, f, body, body.x - f.x, body.y - f.y, 60, null, 0.3);
    }
    let caught = 0;
    for (const m of monsterBodies(b)) {
      if (m === f || dist(f.x, f.y, m.x, m.y) >= def.blastR + bodyRadius(m)) continue;
      caught++;
      if (m.mtype === 'boom' && !m.ai.exploded) { boomArm(b, m, 0.18); continue; }
      dealDamage(b, f, m, def.dmgMonster * (f.waveHp || 1), { kind: 'auto', commentarySource: 'rogue:boom' });
    }
    if (caught) rogueEvent(b, 'BOOMBALL_CHAIN', f, null, { count: caught });
    monsterDown(b, f, null, { fx: false });
  }

  /* 드릴볼 — 벽 속으로 파고들어 벽을 따라 이동한 뒤 다른 벽에서 튀어나온다.
   * 튀어나올 자리에는 미리 금이 가고 화살표가 안쪽을 가리킨다. 벽 속에서는 칠 수 없다. */
  function drillBrain() {
    return {
      stats: monsterStats, down: basicDown,
      init(b, f) { f.ai.state = 'surface'; f.ai.t = rand(f.monster.surface[0], f.monster.surface[1]) * 0.7; },
      move(b, f, dt) {
        if (f.ai.state === 'tunnel' || f.ai.state === 'warn') return;   // 자리는 act가 벽을 따라 옮긴다
        monsterMove(b, f, dt);
      },
      onWall(b, f) {
        if (f.ai.state === 'dive') drillBurrow(b, f);
        else if (f.ai.state === 'burst') { f.ai.state = 'surface'; f.ai.t = rand(...f.monster.surface); f.ai.speedMul = 1; }
      },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const target = b.nearestEnemyMain(f);
        if (ai.state === 'tunnel') {
          const edge = b.arena.L * Math.SQRT2;
          const step = def.tunnelSpd * GAME_SPEED * dt / edge;
          const gap = ai.goal - ai.s;
          ai.s += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
          const p = wallPoint(b.arena, ai.s, f.radius);
          f.x = p.x; f.y = p.y; ai.nx = p.nx; ai.ny = p.ny;
          if (Math.abs(ai.goal - ai.s) < 1e-6) {
            ai.state = 'warn'; ai.t = def.warn;
            addHazard(b, { kind: 'mark', theme: 'drill', x: p.x, y: p.y, r: f.radius + 10, nx: p.nx, ny: p.ny, warn: def.warn, fade: 0.2, owner: f });
            sound(b, 'monster.drill.dig', f, 0.3);
            rogueEvent(b, 'DRILLBALL_EMERGE', f, target);
          }
          return;
        }
        if (ai.state === 'warn') {
          ai.t -= dt;
          if (ai.t <= 0) {
            ai.state = 'burst'; ai.t = def.burstT; f.phased = false; ai.hitSet.clear();
            // 안쪽을 향하되 나를 겨눈다. 벽을 따라 미끄러지는 각도로는 나가지 않는다.
            const inward = Math.atan2(ai.ny, ai.nx);
            const want = target ? angTo(f, target.x, target.y) : inward;
            const a = inward + clamp(angleDelta(inward, want), -1.25, 1.25);
            f.vx = Math.cos(a); f.vy = Math.sin(a);
            ai.speedMul = def.burst / def.speed;
            sound(b, 'monster.drill.emerge', f, 0.2);
            comicBurst(b, f.x, f.y, f.radius);
            b.shake = Math.min(12, b.shake + 3);
          }
          return;
        }
        if (disabled(f)) return;
        if (ai.state === 'burst') {
          ai.t -= dt;
          for (const body of heroBodies(b)) {
            if (ai.hitSet.has(body.uid) || dist(f.x, f.y, body.x, body.y) > f.radius + bodyRadius(body) + 3) continue;
            ai.hitSet.add(body.uid);
            if (monsterHit(b, f, body, def.dmg, { x: f.x, y: f.y }) > 0 && isFighterBody(body)) knockHero(b, f, body, f.vx, f.vy, 70, null, 0.3);
          }
          if (ai.t <= 0) { ai.state = 'surface'; ai.t = rand(def.surface[0], def.surface[1]); ai.speedMul = 1; }
          return;
        }
        if (ai.state === 'surface') {
          ai.speedMul = 1;
          if (target) chase(b, f, dt, target, 0.4);
          drillContact(b, f);
          ai.t -= dt;
          if (ai.t <= 0) {
            // 가던 쪽의 가까운 벽으로 파고든다
            ai.state = 'dive'; ai.t = 1.4; ai.speedMul = 1.35;
            ai.s = wallParam(b.arena, f.x + f.vx * 90, f.y + f.vy * 90);
            const p = wallPoint(b.arena, ai.s, f.radius);
            ai.diveX = p.x; ai.diveY = p.y;
          }
          return;
        }
        if (ai.state === 'dive') {
          turnToward(f, angTo(f, ai.diveX, ai.diveY), 6, dt);
          ai.t -= dt;
          if (dist(f.x, f.y, ai.diveX, ai.diveY) < 8 || ai.t <= 0) drillBurrow(b, f);
        }
      },
    };
  }
  function drillContact(b, f) {
    const hits = f.ai.contact || (f.ai.contact = new Map());
    for (const body of heroBodies(b)) {
      if (dist(f.x, f.y, body.x, body.y) > f.radius + bodyRadius(body) + 2) continue;
      if (b.simT < (hits.get(body.uid) || 0)) continue;
      hits.set(body.uid, b.simT + 0.9);
      monsterHit(b, f, body, f.monster.contactDmg, { x: f.x, y: f.y });
    }
  }
  function drillBurrow(b, f) {
    const ai = f.ai, def = f.monster;
    ai.state = 'tunnel'; f.phased = true; ai.speedMul = 1;
    ai.s = wallParam(b.arena, f.x, f.y);
    const p = wallPoint(b.arena, ai.s, f.radius);
    f.x = p.x; f.y = p.y; ai.nx = p.nx; ai.ny = p.ny;
    // 나올 자리: 내가 곧 있을 곳에서 가장 가까운 벽, 조금 옆으로 비껴서
    const hero = b.nearestEnemyMain(f) || b.rogueHero;
    const aim = hero ? predict(hero, 1.1) : { x: 0, y: 0 };
    let goal = wallParam(b.arena, aim.x, aim.y) + rand(-0.22, 0.22);
    // 둘레는 고리다. 짧은 쪽으로 돈다.
    while (goal - ai.s > 2) goal -= 4;
    while (goal - ai.s < -2) goal += 4;
    // 제자리에서 바로 튀어나오지 않게 최소한은 이동한다
    if (Math.abs(goal - ai.s) < 0.35) goal = ai.s + (goal >= ai.s ? 0.35 : -0.35);
    ai.goal = goal;
    sparks(b, f.x, f.y, 10, '#c9a26b', 150);
    sound(b, 'monster.drill.dig', f, 0.2);
    rogueEvent(b, 'DRILLBALL_BURROW', f, null);
    void def;
  }

  /* 멀티젤 — 일정 시간 안에 쓰러뜨리지 않으면 자신을 복제한다. 복제 직전에는 몸이 늘어난다.
   * 한 마리에서 나온 가족은 모두 합쳐 family(8)마리까지만 태어난다 (1 → 2 → 4 → 8).
   * 상한이 '살아 있는 수'뿐이면 죽이는 만큼 다시 태어나 웨이브가 끝나지 않았다 (실측 교착). */
  const GEL_FAMILY = 8;
  function gelBrain() {
    return {
      stats: monsterStats, down: basicDown,
      init(b, f) { f.ai.dup = f.monster.dupT + rand(0, 0.8); f.ai.family = { born: 1 }; },
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const target = b.nearestEnemyMain(f);
        if (!disabled(f) && target) {
          intercept(b, f, dt, target, 1.6);   // 느린 젤리는 한참 앞을 보고 질러가야 닿는다
          const hits = ai.contact || (ai.contact = new Map());
          for (const body of heroBodies(b)) {
            if (dist(f.x, f.y, body.x, body.y) > f.radius + bodyRadius(body) + 2) continue;
            if (b.simT < (hits.get(body.uid) || 0)) continue;
            hits.set(body.uid, b.simT + def.lock);
            monsterHit(b, f, body, def.contactDmg, { x: f.x, y: f.y });
          }
        }
        if (disabled(f)) return;           // 기절한 젤리는 복제도 멈춘다
        ai.dup -= dt;
        if (ai.dup > 0) return;
        ai.dup = def.dupT + rand(0, 0.6);
        const gels = aliveMonsters(b).filter(m => m.mtype === 'gel');
        if (gels.length >= def.cap || ai.family.born >= GEL_FAMILY) return;
        ai.family.born++;
        const side = Math.atan2(f.vy, f.vx) + Math.PI / 2;
        const off = f.radius * 1.15;
        const pos = clampInside(b.arena, f.x + Math.cos(side) * off, f.y + Math.sin(side) * off, f.radius);
        f.x -= Math.cos(side) * off * 0.5; f.y -= Math.sin(side) * off * 0.5;
        const child = addMonster(b, 'gel', pos.x, pos.y, { hp: f.waveHp, dmg: f.perm.dmg });
        child.vx = Math.cos(side); child.vy = Math.sin(side);
        child.ai.dup = def.dupT + rand(0.4, 1.1); child.ai.family = ai.family;
        if (b.rogueStats) b.rogueStats.spawned++;
        sound(b, 'monster.gel.split', f, 0.1);
        popup(b, f.x, f.y - f.radius - 18, '복제!', '#7df2e3');
        const count = gels.length + 1;
        rogueEvent(b, 'MULTIGEL_DUPLICATED', f, child, { count });
        if (count >= 6 && !b.rogueFlags.gelSwarm) { b.rogueFlags.gelSwarm = true; rogueEvent(b, 'MULTIGEL_SWARM', f, null, { count }); }
      },
    };
  }

  /* 러시혼 — 나를 겨눠 예고한 뒤(돌진선이 벽까지 그려진다) 직선으로 돌진한다.
   * 마지막 0.3초는 방향이 고정된다. 벽에 박히면 잠시 멍해지고 그동안 더 아프게 맞는다. */
  function hornBrain() {
    return {
      stats: monsterStats, down: basicDown,
      init(b, f) { f.ai.state = 'roam'; f.ai.t = rand(...f.monster.roam) * 0.6; },
      move(b, f, dt) { monsterMove(b, f, dt); },
      onWall(b, f) {
        const ai = f.ai, def = f.monster;
        if (ai.state !== 'charge') return;
        ai.state = 'daze'; ai.t = def.daze; ai.speedMul = 0;
        f.perm.dmgTaken = def.dazeTaken;
        comicBurst(b, f.x, f.y, f.radius);
        b.shake = Math.min(15, b.shake + 6);
        sound(b, 'monster.horn.crash', f, 0.2);
        popup(b, f.x, f.y - f.radius - 22, '쾅!', '#ffd24d', true);
        rogueEvent(b, 'RUSHHORN_WALL_CRASH', f, null);
      },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const target = b.nearestEnemyMain(f);
        if (disabled(f) && ai.state !== 'daze') {
          if (ai.state === 'aim' || ai.state === 'charge') { ai.state = 'roam'; ai.t = 1; ai.speedMul = 1; }
          return;
        }
        if (ai.state === 'roam') {
          ai.speedMul = 1;
          if (target) chase(b, f, dt, target, 0.3, (ai.side || 1) * 0.3);
          ai.t -= dt;
          if (ai.t <= 0 && target && !disarmed(f)) {
            ai.state = 'aim'; ai.t = def.aim; ai.dur = def.aim; ai.speedMul = 0;
            ai.aimAng = angTo(f, target.x, target.y);
            sound(b, 'monster.horn.snort', f, 0.3);
            rogueEvent(b, 'RUSHHORN_CHARGE', f, target);
          }
        } else if (ai.state === 'aim') {
          ai.t -= dt;
          if (target && ai.t > def.lockAt) {
            const p = predict(target, 0.35);
            ai.aimAng += clamp(angleDelta(ai.aimAng, angTo(f, p.x, p.y)), -2.6 * dt, 2.6 * dt);
          }
          f.weaponAngle = ai.aimAng;
          f.vx = Math.cos(ai.aimAng); f.vy = Math.sin(ai.aimAng);
          if (ai.t <= 0) {
            ai.state = 'charge'; ai.t = 3; ai.speedMul = def.charge / def.speed; ai.hitSet.clear();
            sound(b, 'monster.horn.charge', f, 0.2);
          }
        } else if (ai.state === 'charge') {
          ai.t -= dt;
          f.vx = Math.cos(ai.aimAng); f.vy = Math.sin(ai.aimAng);   // 부딪혀도 방향을 잃지 않는다
          for (const body of heroBodies(b)) {
            if (ai.hitSet.has(body.uid) || dist(f.x, f.y, body.x, body.y) > f.radius + bodyRadius(body) + 4) continue;
            ai.hitSet.add(body.uid);
            if (monsterHit(b, f, body, def.dmg, { x: f.x, y: f.y }) > 0 && isFighterBody(body)) {
              knockHero(b, f, body, f.vx, f.vy, 160, { dmg: def.slamDmg, stun: def.slamStun }, 0.5);
              b.shake = Math.min(14, b.shake + 5);
            }
          }
          if (ai.t <= 0) { ai.state = 'roam'; ai.t = rand(...def.roam); ai.speedMul = 1; }
        } else if (ai.state === 'daze') {
          ai.t -= dt;
          if (ai.t <= 0) { ai.state = 'roam'; ai.t = rand(...def.roam); ai.speedMul = 1; f.perm.dmgTaken = 1; }
        }
      },
    };
  }

  /* 스파크젤 — 전기 없음 → 발동 예고 → 전기 영역 ON → OFF 를 되풀이한다.
   * 영역은 커지거나 작아지지 않는다. 켜져 있을 때만 위험하다. */
  function sparkBrain() {
    return {
      stats: monsterStats, down: basicDown,
      init(b, f) { f.ai.field = 'off'; f.ai.t = f.monster.off * rand(0.35, 1); },
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const target = b.nearestEnemyMain(f);
        if (disabled(f)) {
          if (ai.field !== 'off') { ai.field = 'off'; ai.t = def.off * 0.5; }
          return;
        }
        // 전기장이 켜져 있을 때는 길목을 막고, 꺼져 있으면 슬슬 따라붙는다
        if (target) intercept(b, f, dt, target, ai.field === 'on' ? 1.8 : 1.0,
          ai.field === 'on' ? 0 : Math.sin(b.simT * 0.8 + f.uid) * 0.4);
        ai.t -= dt;
        if (ai.field === 'off' && ai.t <= 0) { ai.field = 'warn'; ai.t = def.warn; }
        else if (ai.field === 'warn' && ai.t <= 0) {
          ai.field = 'on'; ai.t = def.on; ai.tick = 0;
          sound(b, 'monster.spark.on', f, 0.3);
          rogueEvent(b, 'SPARKGEL_FIELD_ON', f, null);
        } else if (ai.field === 'on') {
          ai.tick -= dt;
          if (ai.tick <= 0) {
            ai.tick = def.tick;
            for (const body of heroBodies(b)) {
              if (dist(f.x, f.y, body.x, body.y) >= def.fieldR + bodyRadius(body)) continue;
              if (monsterHit(b, f, body, def.dmg, null, 'monster:spark') > 0) {
                sparks(b, body.x, body.y, 5, '#aef3ff', 150);
                sound(b, 'monster.volt.zap', body, 0.15);
              }
            }
          }
          if (ai.t <= 0) { ai.field = 'off'; ai.t = def.off; rogueEvent(b, 'SPARKGEL_FIELD_OFF', f, null); }
        }
      },
    };
  }

  /* 메딕볼 — 동료들 뒤에 숨어 주기적으로 주변 몬스터를 회복시킨다. 다친 동료가 없으면 기다린다. */
  function medicBrain() {
    return {
      stats: monsterStats, down: basicDown,
      init(b, f) { f.ai.heal = f.monster.healT * 0.7; },
      move(b, f, dt) { monsterMove(b, f, dt); },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        ai.pulse = Math.max(0, (ai.pulse || 0) - dt);
        const target = b.nearestEnemyMain(f);
        if (disabled(f)) return;
        const allies = monsterBodies(b).filter(m => m !== f);
        if (allies.length && target) {
          let cx = 0, cy = 0;
          for (const m of allies) { cx += m.x; cy += m.y; }
          cx /= allies.length; cy /= allies.length;
          const away = normDir(cx - target.x, cy - target.y);
          const goal = clampInside(b.arena, cx + away.x * 70, cy + away.y * 70, f.radius + 10);
          /* 회복이 일이지 싸움이 아니다. 공이 다가오면 무리 뒤로 물러나고,
           * 그렇지 않으면 동료 무리의 뒤쪽(상대 반대편)에 선다. */
          const chased = dist(f.x, f.y, target.x, target.y) < def.keep;
          ai.speedMul = chased ? 1.2 : 1;
          if (chased) flee(b, f, dt, target, 1.15);
          else turnToward(f, angTo(f, goal.x, goal.y), def.turn, dt);
        } else if (target && dist(f.x, f.y, target.x, target.y) < def.keep) { ai.speedMul = 1.2; flee(b, f, dt, target, 1.15); }
        else { ai.speedMul = 1; keepDistance(b, f, dt, target, def.keep + 60); }
        ai.heal -= dt;
        if (ai.heal > 0 || disarmed(f)) return;
        const hurt = allies.filter(m => m.hp < m.maxHp - 1 && dist(f.x, f.y, m.x, m.y) < def.healR + bodyRadius(m));
        if (!hurt.length) { ai.heal = 0.5; return; }
        ai.heal = def.healT; ai.pulse = 0.55;
        let total = 0;
        for (const m of hurt) {
          const before = m.hp;
          const amount = Math.min(def.healMax * (m.waveHp || 1), Math.max(def.healMin, m.maxHp * def.healPct));
          m.hp = Math.min(m.maxHp, m.hp + amount);
          const got = m.hp - before;
          total += got;
          popup(b, m.x, m.y - m.radius - 8, '+' + Math.round(got), '#7dffa8');
          addFx(b, { type: 'ring', x: m.x, y: m.y, r0: m.radius + 2, r1: m.radius + 14, color: '#7dffa8', dur: 0.35 });
        }
        (ai.beams = hurt.map(m => m.uid));
        addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 8, r1: def.healR * 0.6, color: '#9dffc0', dur: 0.45 });
        sound(b, 'monster.medic.heal', f, 0.4);
        rogueEvent(b, 'MEDICBALL_HEAL', f, null, { total: Math.round(total), count: hurt.length });
        if (total >= 30) rogueEvent(b, 'MEDICBALL_BIG_HEAL', f, null, { total: Math.round(total) });
      },
    };
  }

  BRAINS.volt = voltBrain(); BRAINS.suction = suctionBrain(); BRAINS.boom = boomBrain();
  BRAINS.drill = drillBrain(); BRAINS.gel = gelBrain(); BRAINS.horn = hornBrain();
  BRAINS.spark = sparkBrain(); BRAINS.medic = medicBrain();

  /* ═══════════ 보스 공통 ═══════════ */
  // 벽까지의 거리 (마름모)
  const wallGap = (arena, x, y, r = 0) => (arena.L - (Math.abs(x) + Math.abs(y))) / Math.SQRT2 - r;
  // 가장 가까운 벽 위의 점과 안쪽 법선
  function nearestWall(arena, x, y) {
    const p = wallPoint(arena, wallParam(arena, x, y), 0);
    return p;
  }
  // 무게를 둔 무작위 선택. 방금 쓴 패턴은 덜 고른다.
  function pickPattern(ai, options) {
    // 전시관에서 특정 패턴을 지정해 볼 수 있다 (forcePattern). 게임 중에는 비어 있다.
    if (ai.force) {
      const id = ai.force; ai.force = null;
      if (options.some(o => o.id === id)) return id;
    }
    const list = options.filter(o => o.w > 0).map(o => ({ ...o, w: o.id === ai.last ? o.w * 0.3 : o.w }));
    let total = 0; for (const o of list) total += o.w;
    let r = Math.random() * total;
    for (const o of list) { r -= o.w; if (r <= 0) return o.id; }
    return list.length ? list[list.length - 1].id : null;
  }
  function bossPhase(b, f) {
    const ai = f.ai;
    if (ai.phase === 1 && f.hp <= f.maxHp * 0.5) {
      ai.phase = 2;
      addFx(b, { type: 'ring', x: f.x, y: f.y, r0: f.radius, r1: f.radius * 4.2, color: f.monster.palette.accent, dur: 0.6, boom: true });
      b.shake = Math.min(16, b.shake + 8);
      sound(b, 'boss.phase', f, 1);
      popup(b, f.x, f.y - f.radius - 30, f.mtype === 'former' ? '노장의 분노!' : '진심 모드!', '#ffd24d', true);
      rogueEvent(b, 'BOSS_PHASE2', f, null, { boss: f.mtype });
    }
    return ai.phase === 2 ? 0.85 : 1;      // 2페이즈는 예고가 조금 짧다 (그래도 피할 수 있게 둔다)
  }
  function bossDown(b, f, src) {
    if (f.dead) return;
    explodeFx(b, f.x, f.y, f.radius * 3.2, f.monster.palette.accent, null);
    comicBurst(b, f.x, f.y, f.radius);
    shatterFx(b, f.x, f.y, f.radius, f.monster.palette.body);
    b.shake = 18;
    // 쓰러진 뒤에 남은 예고가 터지지 않게 보스가 깐 것은 모두 거둔다
    b.rogueHazards = b.rogueHazards.filter(h => h.owner !== f);
    b.projectiles = b.projectiles.filter(p => p.owner !== f);
    rogueEvent(b, 'BOSS_DOWN', src, f, { boss: f.mtype });
    monsterDown(b, f, src, { fx: false });
  }
  // 부채꼴 판정: face를 가운데로 arc(전체 각)만큼 벌어진 반지름 r 안의 영웅
  function sectorHits(b, f, face, r, arc, cb) {
    for (const body of heroBodies(b)) {
      const d = dist(f.x, f.y, body.x, body.y);
      if (d > r + bodyRadius(body)) continue;
      if (d > f.radius && Math.abs(angleDelta(face, angTo(f, body.x, body.y))) > arc / 2 + Math.asin(Math.min(1, bodyRadius(body) / d))) continue;
      cb(body);
    }
  }
  // 해머 머리가 벽에 부딪힌 자리에서 퍼지는 충격파 (전 챔피언의 수동 효과)
  function wallShockwave(b, f, x, y, cfg, big = false) {
    const ai = f.ai;
    if (!big && b.simT < (ai.wallShockAt || 0)) return;
    ai.wallShockAt = b.simT + (cfg.cd || 0.9);
    const w = nearestWall(b.arena, x, y);
    addHazard(b, { kind: 'ring', theme: 'earth', x: w.x, y: w.y, r0: 12, r1: cfg.ringR, dur: cfg.ringT, width: cfg.width,
      warn: 0, fade: 0.25, dmg: cfg.dmg, owner: f, source: 'monster:former-shock' });
    comicBurst(b, w.x, w.y, 16);
    b.shake = Math.min(16, b.shake + (big ? 7 : 4));
    sound(b, 'boss.shockwave', w, 0.2);
    rogueEvent(b, 'HAMMER_SHOCKWAVE', f, null, { big });
  }

  /* ═══════════ W10 늙은 전 챔피언 ═══════════
   * 느리고 묵직하지만 해머 한 방으로 경기장을 크게 장악한다.
   * 모든 광역 공격은 자리를 표시하고 충분히 예고한다. 그 사이에 궤도를 바꾸면 피할 수 있다. */
  function formerBrain() {
    return {
      stats: monsterStats, down: bossDown,
      init(b, f) { Object.assign(f.ai, { state: 'walk', t: 1.4, phase: 1, last: null, spinAng: 0 }); },
      move(b, f, dt) {
        if (f.ai.state === 'air') return;
        monsterMove(b, f, dt);
      },
      onWall(b, f) {
        const ai = f.ai, def = f.monster;
        // 돌진하다 벽을 들이받으면 해머가 벽을 친다 — 휘두르기 대신 충격파
        if (ai.state === 'charge') {
          wallShockwave(b, f, f.x, f.y, def.wall, true);
          ai.state = 'recover'; ai.t = 0.7; ai.speedMul = 0;
        }
      },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const k = bossPhase(b, f);
        const hero = b.nearestEnemyMain(f);
        if (disabled(f)) { if (ai.state !== 'air') { ai.speedMul = 0; } return; }
        const toHero = hero ? angTo(f, hero.x, hero.y) : Math.atan2(f.vy, f.vx);
        const d = hero ? dist(f.x, f.y, hero.x, hero.y) : 999;
        switch (ai.state) {
          case 'walk': {
            ai.speedMul = 1;
            if (hero) turnToward(f, toHero, def.turn, dt);
            f.weaponAngle += clamp(angleDelta(f.weaponAngle, toHero), -2 * dt, 2 * dt);
            ai.t -= dt;
            if (ai.t > 0 || !hero || disarmed(f)) break;
            const nearWall = wallGap(b.arena, f.x, f.y, f.radius) < 110;
            const next = pickPattern(ai, [
              { id: 'slam', w: d < 280 ? 3 : 0.6 },
              { id: 'sweep', w: d > 150 ? 3 : 1 },
              { id: 'wall', w: nearWall ? 2.4 : 0 },
              { id: 'leap', w: 2 },
              { id: 'spin', w: ai.phase === 2 ? 3.5 : 1.8 },
            ]);
            ai.last = next;
            if (next === 'slam') {
              ai.state = 'slam'; ai.t = def.slam.warn * k; ai.speedMul = 0; ai.face = toHero;
              const hx = f.x + Math.cos(ai.face) * def.slam.dist, hy = f.y + Math.sin(ai.face) * def.slam.dist;
              const at = clampInside(b.arena, hx, hy, 0);
              ai.slamX = at.x; ai.slamY = at.y;
              addHazard(b, { kind: 'circle', theme: 'earth', x: at.x, y: at.y, r: def.slam.r, warn: ai.t, fade: 0.4,
                dmg: def.slam.dmg, knock: def.slam.knock * 0.4, slam: { dmg: def.slamDmg, stun: def.slamStun }, owner: f, source: 'monster:former-slam',
                onFire(bb, h) {
                  explodeFx(bb, h.x, h.y, h.r, '#d9b279', null);
                  sound(bb, 'boss.hammer.slam', h, 0.1);
                  bb.shake = Math.min(18, bb.shake + 9);
                  rogueEvent(bb, 'HAMMER_SLAM', f, null);
                  // 찍은 자리가 벽에 닿으면 벽에서 충격파가 번진다
                  if (wallGap(bb.arena, h.x, h.y, 0) < h.r * 0.75) wallShockwave(bb, f, h.x, h.y, def.wallShock);
                } });
              sound(b, 'boss.hammer.raise', f, 0.3);
              rogueEvent(b, 'HAMMER_RAISE', f, hero);
            } else if (next === 'sweep') {
              ai.state = 'aim'; ai.t = def.sweep.aim * k; ai.speedMul = 0; ai.face = toHero;
              sound(b, 'monster.horn.snort', f, 0.3);
            } else if (next === 'wall') {
              const w = nearestWall(b.arena, f.x, f.y);
              ai.state = 'wallUp'; ai.t = def.wall.warn * k; ai.speedMul = 0;
              ai.face = Math.atan2(-w.ny, -w.nx);
              addHazard(b, { kind: 'mark', theme: 'crack', x: w.x, y: w.y, r: 30, nx: w.nx, ny: w.ny, warn: ai.t, fade: 0.15, owner: f });
              sound(b, 'boss.hammer.raise', f, 0.3);
            } else if (next === 'leap') {
              ai.state = 'crouch'; ai.t = def.leap.crouch; ai.speedMul = 0;
              sound(b, 'boss.leap', f, 0.3);
            } else {
              ai.state = 'spinUp'; ai.t = def.spin.warm * k; ai.dur = ai.t; ai.speedMul = 0; ai.spinAng = f.weaponAngle;
              sound(b, 'boss.hammer.spin', f, 0.5);
              rogueEvent(b, 'HAMMER_SPIN', f, hero);
            }
            break;
          }
          case 'slam':
            ai.t -= dt;
            f.weaponAngle = ai.face;
            if (ai.t <= 0) { ai.state = 'recover'; ai.t = 0.65; }
            break;
          case 'aim': {
            // 돌진 방향을 겨눈다. 마지막 0.3초는 방향이 고정된다.
            ai.t -= dt;
            if (hero && ai.t > 0.3) ai.face += clamp(angleDelta(ai.face, toHero), -1.8 * dt, 1.8 * dt);
            f.weaponAngle = ai.face; f.vx = Math.cos(ai.face); f.vy = Math.sin(ai.face);
            if (ai.t <= 0) {
              ai.state = 'charge'; ai.t = def.sweep.dur; ai.speedMul = def.sweep.speed / def.speed;
              sound(b, 'monster.horn.charge', f, 0.3);
            }
            break;
          }
          case 'charge':
            ai.t -= dt;
            f.vx = Math.cos(ai.face); f.vy = Math.sin(ai.face);
            if (ai.t <= 0 || d < 120) {
              ai.state = 'sweepWarn'; ai.t = def.sweep.warn * k; ai.speedMul = 0;
              ai.face = toHero;
              addHazard(b, { kind: 'mark', theme: 'sector', x: f.x, y: f.y, r: def.sweep.r, ang: ai.face, arc: def.sweep.arc,
                warn: ai.t, fade: 0.25, owner: f, follow: f });
              rogueEvent(b, 'HAMMER_SWEEP', f, hero);
            }
            break;
          case 'sweepWarn':
            ai.t -= dt;
            f.weaponAngle = ai.face - def.sweep.arc / 2;
            if (ai.t <= 0) {
              ai.state = 'recover'; ai.t = 0.6; ai.sweepFx = 0.3;
              f.weaponAngle = ai.face + def.sweep.arc / 2;
              sound(b, 'boss.hammer.sweep', f, 0.2);
              b.shake = Math.min(16, b.shake + 6);
              sectorHits(b, f, ai.face, def.sweep.r, def.sweep.arc, body => {
                if (monsterHit(b, f, body, def.sweep.dmg, { x: f.x, y: f.y }) > 0 || isFighterBody(body)) {
                  knockHero(b, f, body, body.x - f.x, body.y - f.y, def.sweep.knock * 0.4, { dmg: def.slamDmg, stun: def.slamStun }, 0.55);
                }
              });
              // 휘두른 해머 끝이 벽에 닿으면 충격파
              const tip = { x: f.x + Math.cos(ai.face) * def.sweep.r, y: f.y + Math.sin(ai.face) * def.sweep.r };
              if (wallGap(b.arena, tip.x, tip.y, 0) < 10) wallShockwave(b, f, tip.x, tip.y, def.wallShock);
            }
            break;
          case 'wallUp':
            ai.t -= dt;
            f.weaponAngle = ai.face;
            if (ai.t <= 0) {
              wallShockwave(b, f, f.x + Math.cos(ai.face) * 200, f.y + Math.sin(ai.face) * 200, def.wall, true);
              ai.state = 'recover'; ai.t = 0.6;
            }
            break;
          case 'crouch':
            ai.t -= dt;
            if (ai.t <= 0) {
              /* 뛰어오른다. 떨어질 자리는 뛰는 순간 내가 있던 곳이고, 그림자가 커지며 예고한다.
               * 앞질러 겨누면 안 된다 — 조향이 초당 50도라 체공 시간 안에 옆으로 100px도 못 빠진다.
               * 지금 자리를 찍으면 그대로 달리기만 해도 빠져나가고, 머뭇거리면(벽에 튕겨 되돌아오면) 맞는다. */
              const air = def.leap.air * k;
              const aim = hero ? { x: hero.x, y: hero.y } : { x: 0, y: 0 };
              const at = clampInside(b.arena, aim.x, aim.y, f.radius + 4);
              Object.assign(ai, { state: 'air', t: air, dur: air, fromX: f.x, fromY: f.y, toX: at.x, toY: at.y });
              f.phased = true;
              addHazard(b, { kind: 'circle', theme: 'earth', x: at.x, y: at.y, r: def.leap.r, warn: air, fade: 0.45,
                dmg: def.leap.dmg, knock: def.leap.knock * 0.4, slam: { dmg: def.slamDmg, stun: def.slamStun }, owner: f, source: 'monster:former-leap', shadow: true });
              rogueEvent(b, 'HAMMER_LEAP', f, hero);
            }
            break;
          case 'air': {
            ai.t -= dt;
            const p = clamp(1 - ai.t / ai.dur, 0, 1);
            f.x = ai.fromX + (ai.toX - ai.fromX) * p; f.y = ai.fromY + (ai.toY - ai.fromY) * p;
            if (ai.t <= 0) {
              f.phased = false; f.x = ai.toX; f.y = ai.toY;
              explodeFx(b, f.x, f.y, def.leap.r, '#d9b279', null);
              sound(b, 'boss.land', f, 0.2);
              b.shake = 18;
              ai.state = 'recover'; ai.t = 0.85;
              if (wallGap(b.arena, f.x, f.y, f.radius) < 40) wallShockwave(b, f, f.x, f.y, def.wallShock);
            }
            break;
          }
          case 'spinUp':
            ai.t -= dt;
            ai.spinAng += def.spin.rate * (1 - ai.t / ai.dur) * 0.5 * dt;
            f.weaponAngle = ai.spinAng;
            if (ai.t <= 0) { ai.state = 'spin'; ai.t = def.spin.dur; ai.speedMul = def.spin.speed / def.speed; ai.spinHits = new Map(); }
            break;
          case 'spin': {
            ai.t -= dt;
            ai.spinAng += def.spin.rate * dt;
            f.weaponAngle = ai.spinAng;
            if (hero) turnToward(f, toHero, 1.6, dt);
            const hx = f.x + Math.cos(ai.spinAng) * def.hammerReach, hy = f.y + Math.sin(ai.spinAng) * def.hammerReach;
            for (const body of heroBodies(b)) {
              if (dist(hx, hy, body.x, body.y) > def.hammerHeadR + bodyRadius(body)) continue;
              if (b.simT < (ai.spinHits.get(body.uid) || 0)) continue;
              ai.spinHits.set(body.uid, b.simT + def.spin.lock);
              const tang = ai.spinAng + Math.PI / 2;
              if (monsterHit(b, f, body, def.spin.dmg, { x: hx, y: hy }) > 0 && isFighterBody(body)) {
                knockHero(b, f, body, Math.cos(tang) + (body.x - f.x) / 100, Math.sin(tang) + (body.y - f.y) / 100, def.spin.knock * 0.4, { dmg: def.slamDmg, stun: def.slamStun }, 0.5);
                sound(b, 'monster.club.hit', body, 0.1);
              }
            }
            if (wallGap(b.arena, hx, hy, def.hammerHeadR) < 0) wallShockwave(b, f, hx, hy, def.wallShock);
            if (ai.t <= 0) { ai.state = 'recover'; ai.t = 0.9; ai.speedMul = 0; }
            break;
          }
          case 'recover':
            ai.t -= dt;
            ai.sweepFx = Math.max(0, (ai.sweepFx || 0) - dt);
            if (ai.t <= 0) { ai.state = 'walk'; ai.t = rand(1.0, 1.7) * (ai.phase === 2 ? 0.7 : 1); }
            break;
        }
      },
    };
  }

  /* ═══════════ W20 아레나 챔피언 ═══════════
   * 날렵한 움직임 + 화려한 패턴 마법. 서서 주문만 외지 않는다 — 빠르게 움직이고
   * 위치를 바꾸면서 경기장 곳곳에 마법 패턴을 깐다. 모든 패턴은 자리를 먼저 보여 준다. */
  function currentBrain() {
    return {
      stats: monsterStats, down: bossDown,
      init(b, f) { Object.assign(f.ai, { state: 'move', t: 1.6, phase: 1, last: null, bolt: 1.2, side: 1, novaAt: 0 }); },
      move(b, f, dt) { monsterMove(b, f, dt); },
      onWall(b, f) { if (f.ai.state === 'trail') f.ai.t = 0; },
      act(b, f, dt) {
        if (f.dead) return;
        tickSpawn(f, dt);
        const def = f.monster, ai = f.ai;
        const k = bossPhase(b, f);
        const hero = b.nearestEnemyMain(f);
        if (disabled(f)) { ai.speedMul = 0; return; }
        const toHero = hero ? angTo(f, hero.x, hero.y) : 0;
        f.weaponAngle = toHero;
        switch (ai.state) {
          case 'move': {
            ai.speedMul = 1;
            if (hero) {
              // 적당한 거리를 두고 옆으로 빠르게 돈다
              const d = dist(f.x, f.y, hero.x, hero.y);
              const ang = d < 170 ? toHero + Math.PI : d > 300 ? toHero : toHero + ai.side * 1.35;
              if (chance(0.006)) ai.side = -ai.side;
              turnToward(f, ang, def.turn, dt);
              ai.bolt -= dt;
              if (ai.bolt <= 0 && !disarmed(f)) { ai.bolt = def.bolt.cd * (ai.phase === 2 ? 0.75 : 1); championBolts(b, f, hero); }
            }
            ai.t -= dt;
            if (ai.t > 0 || !hero || disarmed(f)) break;
            const next = pickPattern(ai, [
              { id: 'blink', w: 3 }, { id: 'trail', w: 2.5 }, { id: 'circles', w: 2.5 }, { id: 'beams', w: 2.2 },
              { id: 'nova', w: b.simT - ai.novaAt > 14 ? 1.6 : 0 },
            ]);
            ai.last = next;
            if (next === 'blink') startBlink(b, f, hero, k);
            else if (next === 'trail') {
              const far = clampInside(b.arena, hero.x + (hero.x - f.x) * 0.9, hero.y + (hero.y - f.y) * 0.9, f.radius + 10);
              Object.assign(ai, { state: 'trailAim', t: 0.5 * k, speedMul: 0, goalX: far.x, goalY: far.y });
              addHazard(b, { kind: 'mark', theme: 'aim', x: f.x, y: f.y, x2: far.x, y2: far.y, w: 30, warn: ai.t, fade: 0.1, owner: f, color: 'arcane' });
              sound(b, 'boss.magic.charge', f, 0.3);
            } else if (next === 'circles') {
              Object.assign(ai, { state: 'cast', t: 0.5 * k, speedMul: 0.2, cast: 'circles' });
              sound(b, 'boss.magic.charge', f, 0.3);
            } else if (next === 'beams') {
              Object.assign(ai, { state: 'cast', t: 0.35 * k, speedMul: 0.2, cast: 'beams' });
              sound(b, 'boss.magic.charge', f, 0.3);
            } else {
              // 가운데로 순간이동해 힘을 모은 뒤 경기장 전체에 유성을 떨어뜨린다
              ai.novaAt = b.simT;
              startBlink(b, f, hero, k, { x: 0, y: 0, nova: true });
            }
            break;
          }
          case 'blinkWarn':
            ai.t -= dt;
            if (ai.t <= 0) finishBlink(b, f, hero, k);
            break;
          case 'trailAim':
            ai.t -= dt;
            if (ai.t <= 0) {
              const a = angTo(f, ai.goalX, ai.goalY);
              Object.assign(ai, { state: 'trail', t: 1.6, face: a, speedMul: def.trail.speed / def.speed, dropped: 0, lastDropX: f.x, lastDropY: f.y });
              f.vx = Math.cos(a); f.vy = Math.sin(a);
              sound(b, 'boss.magic.blink', f, 0.2);
              rogueEvent(b, 'CHAMPION_TRAIL', f, hero);
            }
            break;
          case 'trail': {
            ai.t -= dt;
            f.vx = Math.cos(ai.face); f.vy = Math.sin(ai.face);
            if (dist(f.x, f.y, ai.lastDropX, ai.lastDropY) >= def.trail.gap) {
              ai.lastDropX = f.x; ai.lastDropY = f.y; ai.dropped++;
              addHazard(b, { kind: 'circle', theme: 'arcane', x: f.x, y: f.y, r: def.trail.r, warn: def.trail.delay * k, fade: 0.3,
                dmg: def.trail.dmg, owner: f, source: 'monster:champion-trail',
                onFire(bb, h) { addFx(bb, { type: 'ring', x: h.x, y: h.y, r0: 6, r1: h.r, color: '#b89bff', dur: 0.3, boom: true }); sound(bb, 'boss.magic.rune', h, 0.08); } });
            }
            if (ai.t <= 0 || dist(f.x, f.y, ai.goalX, ai.goalY) < 20) { ai.state = 'move'; ai.t = rand(1.1, 1.8) * (ai.phase === 2 ? 0.7 : 1); ai.speedMul = 1; }
            break;
          }
          case 'cast':
            ai.t -= dt;
            if (ai.t <= 0) {
              if (ai.cast === 'circles') castCircles(b, f, hero, k);
              else castBeams(b, f, hero, k);
              ai.state = 'move'; ai.t = rand(1.3, 2.1) * (ai.phase === 2 ? 0.72 : 1); ai.speedMul = 1;
            }
            break;
          case 'novaCharge':
            ai.t -= dt;
            ai.speedMul = 0;
            if (ai.t <= 0) {
              castNova(b, f, hero, k);
              ai.state = 'move'; ai.t = rand(2.2, 2.8); ai.speedMul = 1;
            }
            break;
        }
      },
    };
  }
  function championBolts(b, f, hero) {
    const def = f.monster.bolt;
    const n = f.ai.phase === 2 ? def.n + 2 : def.n;
    const base = angTo(f, hero.x, hero.y);
    sound(b, 'boss.magic.bolt', f, 0.1);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * def.spread;
      spawnProj(b, f, { kind: 'mbolt', x: f.x + Math.cos(a) * (f.radius + 6), y: f.y + Math.sin(a) * (f.radius + 6),
        ang: a, spd: def.spd, dmg: def.dmg, r: def.r, life: 2.6, homing: 1.1, homeNear: 150 });
    }
  }
  function startBlink(b, f, hero, k, fixed) {
    const def = f.monster.blink, ai = f.ai;
    let dest = fixed;
    if (!dest) {
      // 나에게서 적당히 떨어진 옆이나 뒤로
      const base = hero ? angTo(hero, f.x, f.y) + rand(-2.2, 2.2) : rand(0, TAU);
      const r = rand(210, 290);
      dest = clampInside(b.arena, (hero ? hero.x : 0) + Math.cos(base) * r, (hero ? hero.y : 0) + Math.sin(base) * r, f.radius + 16);
    }
    Object.assign(ai, { state: 'blinkWarn', t: def.warn * k, speedMul: 0, destX: dest.x, destY: dest.y, nova: !!(fixed && fixed.nova) });
    addHazard(b, { kind: 'mark', theme: 'blink', x: dest.x, y: dest.y, r: f.radius + 8, warn: ai.t, fade: 0.1, owner: f });
    sound(b, 'boss.magic.charge', f, 0.3);
  }
  function finishBlink(b, f, hero, k) {
    const def = f.monster, ai = f.ai;
    const ox = f.x, oy = f.y;
    // 떠난 자리에 불안정한 룬이 남아 곧 터진다
    addHazard(b, { kind: 'circle', theme: 'arcane', x: ox, y: oy, r: def.blink.runeR, warn: def.blink.runeWarn * k, fade: 0.35,
      dmg: def.blink.dmg, owner: f, source: 'monster:champion-rune',
      onFire(bb, h) { addFx(bb, { type: 'ring', x: h.x, y: h.y, r0: 8, r1: h.r, color: '#b89bff', dur: 0.35, boom: true }); sound(bb, 'boss.magic.rune', h, 0.08); } });
    addFx(b, { type: 'ring', x: ox, y: oy, r0: f.radius * 1.6, r1: 4, color: '#c9b5ff', dur: 0.25 });
    f.x = ai.destX; f.y = ai.destY;
    addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 4, r1: f.radius * 2.2, color: '#c9b5ff', dur: 0.3 });
    sparks(b, f.x, f.y, 14, '#e2d8ff', 220);
    sound(b, 'boss.magic.blink', f, 0.15);
    rogueEvent(b, 'CHAMPION_BLINK', f, hero);
    if (ai.nova) { ai.state = 'novaCharge'; ai.t = def.nova.charge * k; ai.speedMul = 0; sound(b, 'boss.magic.charge', f, 0.3); rogueEvent(b, 'CHAMPION_NOVA', f, hero); return; }
    // 2페이즈는 옮기자마자 광선을 잇는다
    if (ai.phase === 2 && chance(0.45)) { Object.assign(ai, { state: 'cast', t: 0.25, cast: 'beams', speedMul: 0.2 }); return; }
    ai.state = 'move'; ai.t = rand(0.9, 1.5) * (ai.phase === 2 ? 0.7 : 1); ai.speedMul = 1;
  }
  function castCircles(b, f, hero, k) {
    const def = f.monster.circles;
    const n = def.n + (f.ai.phase === 2 ? 2 : 0);
    const spots = [];
    /* 첫 번째는 지금 내 자리(그대로 달리면 빠진다), 두 번째는 한참 앞(궤도를 틀어야 빠진다).
     * 둘 다 한 번에 만족할 수 있다 — 달리면서 트는 것. 나머지는 경기장 곳곳이다. */
    if (hero) { spots.push({ x: hero.x, y: hero.y }); spots.push(predict(hero, 1.6)); }
    let guard = 0;
    while (spots.length < n && guard++ < 200) {
      const p = clampInside(b.arena, rand(-b.arena.L, b.arena.L), rand(-b.arena.L, b.arena.L), def.r * 0.6);
      if (spots.every(s => dist(s.x, s.y, p.x, p.y) > def.r * 1.3)) spots.push(p);
    }
    spots.forEach((s, i) => {
      const at = clampInside(b.arena, s.x, s.y, def.r * 0.5);
      addHazard(b, { kind: 'circle', theme: 'arcane', x: at.x, y: at.y, r: def.r, warn: (def.warn + i * def.step) * k, fade: 0.35,
        dmg: def.dmg, owner: f, source: 'monster:champion-circle', order: i + 1,
        onFire(bb, h) { addFx(bb, { type: 'ring', x: h.x, y: h.y, r0: 8, r1: h.r, color: '#9f86ff', dur: 0.35, boom: true }); sound(bb, 'boss.magic.rune', h, 0.06); } });
    });
    sound(b, 'boss.magic.charge', f, 0.2);
    rogueEvent(b, 'CHAMPION_CIRCLES', f, hero, { count: spots.length });
  }
  function castBeams(b, f, hero, k) {
    const def = f.monster.beams, L = b.arena.L;
    const n = def.n + (f.ai.phase === 2 ? 1 : 0);
    const aim = hero ? predict(hero, def.warn * 0.7) : { x: 0, y: 0 };
    const lines = [];
    const vertical = chance(0.5);
    // 하나는 나를 지나고, 나머지는 반대 축이나 옆으로 비껴 깐다 — 가로와 세로가 섞인다
    lines.push({ v: vertical, c: vertical ? aim.x : aim.y });
    for (let i = 1; i < n; i++) {
      const v = i % 2 === 1 ? !vertical : vertical;
      const base = v ? aim.x : aim.y;
      lines.push({ v, c: clamp(base + (i % 2 === 1 ? rand(-40, 40) : (chance(0.5) ? 1 : -1) * rand(120, 170)), -L * 0.8, L * 0.8) });
    }
    for (const ln of lines) {
      const span = L - Math.abs(ln.c);
      const x = ln.v ? ln.c : -span, y = ln.v ? -span : ln.c, x2 = ln.v ? ln.c : span, y2 = ln.v ? span : ln.c;
      addHazard(b, { kind: 'line', theme: 'arcane', x, y, x2, y2, w: def.width, warn: def.warn * k, active: def.active, fade: 0.25,
        dmg: def.dmg, owner: f, source: 'monster:champion-beam',
        onFire(bb, h) { sound(bb, 'boss.magic.beam', { x: (h.x + h.x2) / 2, y: (h.y + h.y2) / 2 }, 0.05); bb.shake = Math.min(14, bb.shake + 3); } });
    }
    sound(b, 'boss.magic.charge', f, 0.2);
    rogueEvent(b, 'CHAMPION_BEAMS', f, hero, { count: lines.length });
  }
  function castNova(b, f, hero, k) {
    const def = f.monster.nova;
    const spots = [];
    if (hero) { spots.push(predict(hero, 1.2)); spots.push({ x: hero.x, y: hero.y }); }
    let guard = 0;
    while (spots.length < def.n + (f.ai.phase === 2 ? 3 : 0) && guard++ < 300) {
      const p = clampInside(b.arena, rand(-b.arena.L, b.arena.L), rand(-b.arena.L, b.arena.L), def.r * 0.5);
      if (spots.every(s => dist(s.x, s.y, p.x, p.y) > def.r * 1.25)) spots.push(p);
    }
    spots.forEach((s, i) => {
      const at = clampInside(b.arena, s.x, s.y, def.r * 0.4);
      addHazard(b, { kind: 'circle', theme: 'star', x: at.x, y: at.y, r: def.r, warn: rand(def.warn[0], def.warn[1]) * k + (i < 2 ? 0.2 : 0), fade: 0.4,
        dmg: def.dmg, owner: f, source: 'monster:champion-nova',
        onFire(bb, h) { explodeFx(bb, h.x, h.y, h.r, '#ffd76a', null); sound(bb, 'boss.magic.nova', h, 0.07); } });
    });
    b.shake = Math.min(16, b.shake + 6);
    sound(b, 'boss.magic.nova', f, 0.2);
  }

  BRAINS.former = formerBrain(); BRAINS.current = currentBrain();

  /* ═══════════ 웨이브 규칙 (sim.js의 rogue 훅) ═══════════ */
  /* 헤드리스 자동 진행(autoplay) 주인공 전용: 바닥 예고를 보고 궤도를 튼다.
   * 사람이 예고를 보고 조이스틱을 꺾는 것을 흉내 낸다 — 늦게 보거나 못 보는 때도 있다.
   * 아레나 봇은 바닥 예고를 읽지 않아서, 이게 없으면 보스 밸런스를 잴 수 없다.
   * 실제 플레이의 주인공은 isAI가 아니라 여기를 지나가지 않는다. */
  function autoplayDodge(b, dt) {
    const hero = b.rogueHero;
    if (!hero || !hero.isAI || hero.dead || hero.mainDead || steeringBlocked(hero)) return;
    const skill = hero.ai && Number.isFinite(hero.ai.skill) ? hero.ai.skill : 0.7;
    const pad = hero.radius + 12;
    let ax = 0, ay = 0;
    for (const h of b.rogueHazards) {
      if (h.fired || h.kind === 'puddle' || h.kind === 'ring') continue;
      const sector = h.kind === 'mark' && h.theme === 'sector', aim = h.kind === 'mark' && h.theme === 'aim';
      if (h.kind === 'mark' && !sector && !aim) continue;
      if (!h.react) h.react = { miss: chance(0.45 - 0.35 * skill), at: h.t + rand(0.18, 0.4) * (1.3 - 0.5 * skill) };
      if (h.react.miss || h.t < h.react.at) continue;
      if (h.kind === 'circle' || sector) {
        const d = dist(h.x, h.y, hero.x, hero.y);
        if (d < h.r + pad) { ax += (hero.x - h.x) / (d || 1); ay += (hero.y - h.y) / (d || 1); }
      } else if (h.kind === 'line' || aim) {
        const w = (h.w || 30) / 2 + pad;
        if (segDist(hero.x, hero.y, h.x, h.y, h.x2, h.y2) >= w) continue;
        const lx = h.x2 - h.x, ly = h.y2 - h.y, L2 = lx * lx + ly * ly || 1;
        const u = clamp(((hero.x - h.x) * lx + (hero.y - h.y) * ly) / L2, 0, 1);
        const px = hero.x - (h.x + lx * u), py = hero.y - (h.y + ly * u), d = Math.hypot(px, py);
        if (d > 1e-6) { ax += px / d; ay += py / d; } else { ax += -ly / Math.sqrt(L2); ay += lx / Math.sqrt(L2); }
      }
    }
    if (!ax && !ay) return;
    const len = Math.hypot(hero.vx, hero.vy);
    if (len <= 1e-9) return;
    const cur = Math.atan2(hero.vy, hero.vx), want = Math.atan2(ay, ax);
    const maxTurn = STEER_MAX_RAD * steerSpeedScale(hero) * (hero.modSteer || 1) * dt;
    const next = cur + clamp(angleDelta(cur, want), -maxTurn, maxTurn);
    hero.vx = Math.cos(next) * len; hero.vy = Math.sin(next) * len;
  }

  function rogueStep(b, dt) {
    b.rogueTime += dt;
    updateHazards(b, dt);
    autoplayDodge(b, dt);
    /* 점액·흡착볼이 거는 둔화. computeStats가 다음 틱에 이 배율을 읽는다. */
    const slime = M.slime, suction = M.suction;
    for (const f of b.fighters) {
      if (isMonster(f)) continue;
      for (const body of [f].concat(f.splitBalls || [])) {
        if (body.dead) continue;
        let mm = 1, ma = 1, ms = 1;
        if (body.timers && body.timers.slime > 0) { mm *= slime.slowMove; ms *= slime.slowSteer; }
        const stuck = attachedTo(b, body).length;
        if (stuck) { mm *= Math.pow(suction.slowEach, stuck); ma *= Math.pow(suction.aspdEach, stuck); }
        body.modMove = mm !== 1 ? mm : undefined;
        body.modAspd = ma !== 1 ? ma : undefined;
        body.modSteer = ms !== 1 ? ms : undefined;
      }
    }
  }

  /* 넉백이 줄어들고, 날아가다 벽에 박히면 벽꽝(추가 피해 + 기절).
   * 벽에 정면으로 세게 부딪히면 흡착볼이 떨어진다. */
  function rogueAfterMove(b, f, dt, n, pushed, impact) {
    let slammed = false;
    const k = f.knock;
    if (k) {
      k.age += dt;
      const fade = Math.max(0, 1 - k.age / k.T);
      if (pushed && fade > 0.28 && k.slam) { wallSlam(b, f, k); slammed = true; f.knock = null; }
      else if (fade <= 0) f.knock = null;
      else { k.vx = k.v0x * fade; k.vy = k.v0y * fade; }
    }
    if ((n > 0 && impact >= M.suction.impact) || slammed) {
      const stuck = attachedTo(b, f);
      if (stuck.length) {
        for (const s of stuck) detachSuction(b, s, true, f);
        comicBurst(b, f.x, f.y, f.radius);
        sound(b, 'monster.suction.pop', f, 0.1);
        popup(b, f.x, f.y - f.radius - 26, '떼어냈다!', '#f2c2ff', true);
        rogueEvent(b, 'SUCTIONBALL_DETACHED', f, null, { count: stuck.length });
      }
    }
  }

  function rogueCheckEnd(b) {
    const hero = b.rogueHero;
    const foes = b.fighters.filter(f => f !== hero);
    const foesAlive = foes.some(f => b.fighterAlive(f));
    if (!foesAlive) {
      // 이긴 뒤에는 남은 예고가 터지지 않는다
      b.rogueHazards = b.rogueHazards.filter(h => h.kind === 'puddle');
      b.projectiles = b.projectiles.filter(p => !isMonster(p.owner));
      rogueEvent(b, 'WAVE_CLEAR', hero, null, { wave: b.rogueWave.n });
      b.finish(hero, b.rogueWave.kind === 'boss' ? '보스 격파' : b.rogueWave.kind === 'rival' ? '라이벌 격파' : '섬멸');
    } else if (!b.fighterAlive(hero)) {
      b.finish(foes.find(f => b.fighterAlive(f)) || null, '쓰러짐');
    }
  }

  /* ═══════════ 웨이브 전투 만들기 ═══════════ */
  function flattenSpawns(spawns) {
    const out = [];
    for (const [type, count] of spawns) for (let i = 0; i < count; i++) out.push(type);
    return out;
  }
  // 몬스터 몸 수 (볼트윈 한 쌍은 둘)
  function spawnBodies(spawns) { return flattenSpawns(spawns).reduce((n, t) => n + (M[t].pair ? 2 : 1), 0); }
  /* 영웅은 왼쪽, 몬스터는 오른쪽 절반에 서로 떨어뜨려 흩는다. 한 판 안에서만 무작위다. */
  function spawnSpot(b, taken, r, heroX, heroY) {
    const L = b.arena.L;
    for (let i = 0; i < 240; i++) {
      const x = rand(-0.05 * L, 0.62 * L);
      const lim = (L - Math.abs(x)) - r * 2.2;
      if (lim < 20) continue;
      const y = rand(-lim, lim) * 0.85;
      if (dist(x, y, heroX, heroY) < 230) continue;
      if (taken.some(p => dist(p.x, p.y, x, y) < p.r + r + 34)) continue;
      return { x, y };
    }
    return { x: rand(0.1, 0.4) * L, y: rand(-0.2, 0.2) * L };
  }
  function waveDef(n) { return ROGUE_WAVES[clamp(n, 1, ROGUE_WAVE_COUNT) - 1]; }

  function createWaveBattle(run, opts = {}) {
    const wave = waveDef(run.wave);
    const tier = wave.kind === 'choice' ? (opts.tier || run.choice || 'normal') : null;
    const hero = run.player;
    hero.isAI = !!opts.autoplay;
    if (opts.autoplay && opts.heroSkill != null) hero.aiSkill = opts.heroSkill; else if (!opts.autoplay) delete hero.aiSkill;
    const hooks = { step: rogueStep, checkEnd: rogueCheckEnd, afterMove: rogueAfterMove };
    let players = [hero], arenaL = ROGUE_ARENA_L;
    if (wave.kind === 'rival') {
      growRival(run, wave.meet);
      players = [hero, rivalPlayer(run, wave)];
      arenaL = ROGUE_DUEL_L;
    }
    const b = new Battle('diamond', players, { noTimeLimit: true, rogue: hooks, arenaL });
    /* 공도 몬스터와 같은 비율로 줄인다 (무기 길이도 perm.size를 따라 함께 줄어든다).
     * 능력치를 그 자리에서 다시 계산해 둬야 카운트다운 동안에도 줄어든 크기로 보인다. */
    for (const f of b.fighters) { f.perm.size *= ROGUE_BODY_SCALE; computeStats(f); }
    const info = {
      n: wave.n, kind: wave.kind, tier, title: wave.title, boss: wave.boss || null, meet: wave.meet || 0,
      late: !!wave.late, hard: !!wave.hard, runId: run.id,
      rivalName: run.rival.name, rivalAugments: run.rival.augments.length,
    };
    Object.assign(b, {
      rogueWave: info, rogueHazards: [], rogueEvents: [], rogueSeq: 0, rogueTime: 0,
      rogueFlags: {}, rogueStats: { kills: 0, spawned: 0 }, rogueRun: run, rogueHero: b.fighters[0],
      soundSource: 'rogue',
    });
    hooks.info = info;
    const heroF = b.fighters[0];
    if (wave.kind === 'rival') {
      const rf = b.fighters[1];
      rf.rival = true;
      // 라이벌의 체력 배율 (피해 배율은 rivalPlayer의 damageRewardMult로 들어간다)
      const power = ROGUE_RIVAL_MEETS[wave.meet - 1].power ?? 1;
      rf.maxHp = Math.max(30, Math.round(rf.maxHp * power)); rf.hp = rf.maxHp;
      rogueEvent(b, ['RIVAL_APPEAR_1', 'RIVAL_APPEAR_2', 'RIVAL_APPEAR_3', 'RIVAL_APPEAR_FINAL'][wave.meet - 1], rf, heroF,
        { meet: wave.meet, name: run.rival.name, augments: run.rival.augments.length });
      return b;
    }
    const L = b.arena.L;
    b.setPos(heroF, -0.5 * L, 0, 0);
    // 몬스터전 무기 보정 (라이벌전에는 걸지 않는다 — 1대1은 PvP 균형 그대로)
    heroF.perm.dmg *= ROGUE_MONSTER_WEAPON_DMG[heroF.weaponId] || 1;
    if (wave.kind === 'boss') {
      const boss = addMonster(b, wave.boss, 0.36 * L, 0, {});
      boss.vx = -1; boss.vy = 0; boss.weaponAngle = Math.PI;
      b.rogueStats.spawned = 1;
      rogueEvent(b, wave.boss === 'former' ? 'FORMER_CHAMPION_APPEAR' : 'CURRENT_CHAMPION_APPEAR', boss, heroF);
      return b;
    }
    const spawns = wave.kind === 'choice' ? wave.options[tier].spawns : wave.spawns;
    const scale = { hp: wave.hp || 1, dmg: wave.dmg || 1 };
    const taken = [];
    for (const type of flattenSpawns(spawns)) {
      const def = M[type];
      const p = spawnSpot(b, taken, def.r, heroF.x, heroF.y);
      // 볼트윈 짝은 조금 떨어진 자리에 함께 나온다
      for (const m of spawnMonster(b, type, p.x, p.y, scale)) {
        taken.push({ x: m.x, y: m.y, r: def.r });
        b.rogueStats.spawned++;
      }
    }
    return b;
  }

  /* ═══════════ 라이벌 ═══════════ */
  function makeRival() {
    const weaponId = pick(Object.keys(WEAPONS));
    const weaponAugs = shuffle(AUGMENTS.filter(a => a.weapon === weaponId && !ROGUE_EXCLUDED_AUGMENTS.includes(a.id)).map(a => a.id));
    return {
      name: pick(ROGUE_RIVAL_NAMES), color: ROGUE_RIVAL_COLOR,
      charId: pick(Object.keys(CHARACTERS)), weaponId,
      augments: [], weaponAugOrder: weaponAugs, meets: 0,
    };
  }
  // 라이벌 증강 점수: AI 기본 성향(실측) × 무기 궁합 × 이미 가진 증강의 뒷줄
  function rivalScore(aug, rival) {
    const owned = rival.augments;
    let w = aiAugmentScore(aug, { augments: owned, coins: 5, rounds: rival.meets * 6 });
    const syn = ROGUE_RIVAL_SYNERGY[rival.weaponId] || [];
    if (syn.includes(aug.id)) w *= 2.4;
    for (const [base, next] of Object.entries(ROGUE_RIVAL_FOLLOWUPS)) {
      if (owned.includes(base) && next.includes(aug.id)) w *= 2.6;
    }
    return w;
  }
  /* 라이벌을 이번 만남의 빌드까지 키운다. 무기 전용 증강은 정해진 개수만큼 순서대로 받고,
   * 나머지는 무기와 잘 맞는 쪽으로 고른다. 지난 빌드는 그대로 두고 더한다. */
  function growRival(run, meet) {
    const rival = run.rival;
    if (rival.meets >= meet) return rival;
    const target = ROGUE_RIVAL_MEETS[meet - 1];
    const asPlayer = { augments: rival.augments, weaponId: rival.weaponId, coins: 5, gamble: false, trollCondition: false };
    const weaponCount = () => rival.augments.filter(id => AUG_BY_ID[id] && AUG_BY_ID[id].weapon).length;
    while (weaponCount() < target.weaponAugments && rival.weaponAugOrder.length) {
      const id = rival.weaponAugOrder.shift();
      if (!rival.augments.includes(id)) rival.augments.push(id);
    }
    const exclude = ROGUE_EXCLUDED_AUGMENTS.concat(AUGMENTS.filter(a => a.weapon).map(a => a.id));
    let guard = 0;
    while (rival.augments.length < target.augments && guard++ < 200) {
      const offers = rollAugmentOffers(asPlayer, 4, { exclude });
      const scores = offers.map(a => rivalScore(a, rival));
      let total = scores.reduce((s, x) => s + x, 0), r = Math.random() * total, chosen = offers[offers.length - 1];
      for (let i = 0; i < offers.length; i++) { r -= scores[i]; if (r <= 0) { chosen = offers[i]; break; } }
      rival.augments.push(chosen.id);
    }
    rival.meets = meet;
    return rival;
  }
  function rivalPlayer(run, wave) {
    const rival = run.rival, meet = ROGUE_RIVAL_MEETS[wave.meet - 1];
    return {
      id: 1, name: rival.name, isAI: true, color: rival.color, charId: rival.charId, weaponId: rival.weaponId,
      augments: rival.augments.slice(), augmentBaselines: {}, coins: 5, coinsLost: 0,
      wins: wave.meet - 1, losses: 0, streak: 0, rounds: wave.n - 1, gamble: false, trollCondition: false,
      damageRewardMult: meet.power ?? 1, aiSkill: meet.aiSkill, rival: true,
    };
  }

  /* ═══════════ 런 ═══════════ */
  const RUN_VERSION = 1;
  function newRun({ name = '바운서', charId, weaponId, color = '#4da6ff' } = {}) {
    const id = 'run-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    return {
      v: RUN_VERSION, id, wave: 1, status: 'active', choice: null, startedAt: Date.now(),
      player: {
        id: 0, name, isAI: false, color,
        charId: CHARACTERS[charId] ? charId : 'cat', weaponId: WEAPONS[weaponId] ? weaponId : 'sword',
        augments: [], augmentBaselines: {}, coins: 1, coinsLost: 0, wins: 0, losses: 0, streak: 0, rounds: 0,
        gamble: false, trollCondition: false, damageRewardMult: 1, eventDamageMult: 1,
        bonusAtk: 1, bonusAspd: 1, bonusMove: 1, totalDmg: 0,
      },
      rival: makeRival(),
      refreshes: 0, statPicks: { atk: 0, aspd: 0, move: 0 },
      history: [], seen: {},
    };
  }
  function rollOffers(run) { return rollAugmentOffers(run.player, 3, { exclude: ROGUE_EXCLUDED_AUGMENTS }); }
  function pickAugment(run, aug) { if (aug && AUG_BY_ID[aug.id]) applyAugmentPick(run.player, AUG_BY_ID[aug.id]); }
  function applyStatReward(run, id) {
    const r = ROGUE_STAT_REWARDS.find(x => x.id === id);
    if (!r) return false;
    run.player[r.key] = Math.round((run.player[r.key] || 1) * 1.1 * 10000) / 10000;
    run.statPicks[id] = (run.statPicks[id] || 0) + 1;
    return true;
  }
  /* 웨이브가 끝났다. 이겼으면 받을 보상을 알려 주고 기록을 남긴다. 다음 웨이브로는
   * 보상을 다 받은 뒤 advance가 넘긴다 (보상 도중에 저장돼도 같은 보상을 다시 받는다). */
  function finishWave(run, battle) {
    const wave = waveDef(run.wave);
    const won = !!(battle.result && battle.result.winner === battle.rogueHero);
    const hero = battle.rogueHero;
    run.history.push({
      wave: wave.n, kind: wave.kind, tier: battle.rogueWave.tier, won,
      time: Math.round(battle.simT * 10) / 10,
      hpLeft: Math.round(Math.max(0, battle.hpRatio(hero)) * 100),
      kills: battle.rogueStats.kills,
    });
    if (!won) { run.status = 'dead'; run.endedAt = Date.now(); return { won, reward: null }; }
    run.player.rounds++; run.player.wins++;
    if (wave.n >= ROGUE_WAVE_COUNT) { run.status = 'cleared'; run.endedAt = Date.now(); return { won, reward: null, cleared: true }; }
    let reward = { kind: 'augment', picks: 1 };
    if (wave.kind === 'choice') {
      const t = ROGUE_CHOICE_TIERS[battle.rogueWave.tier] || ROGUE_CHOICE_TIERS.normal;
      reward = t.rewardKind === 'stat' ? { kind: 'stat' } : { kind: 'augment', picks: t.picks };
    }
    run.pendingReward = { ...reward, left: reward.picks || 1, wave: wave.n };
    return { won, reward };
  }
  function advance(run) {
    run.pendingReward = null; run.choice = null;
    run.wave = Math.min(ROGUE_WAVE_COUNT, run.wave + 1);
  }

  /* 저장본을 되살린다. 모양이 틀리거나 없는 캐릭터·무기·증강은 버린다. */
  function restoreRun(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== RUN_VERSION || raw.status !== 'active') return null;
    const p = raw.player, r = raw.rival;
    if (!p || !r || !CHARACTERS[p.charId] || !WEAPONS[p.weaponId] || !CHARACTERS[r.charId] || !WEAPONS[r.weaponId]) return null;
    const wave = Math.round(Number(raw.wave));
    if (!(wave >= 1 && wave <= ROGUE_WAVE_COUNT)) return null;
    const augs = list => (Array.isArray(list) ? list : []).filter(id => typeof id === 'string' && AUG_BY_ID[id]);
    const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
    const run = newRun({ name: p.name, charId: p.charId, weaponId: p.weaponId, color: p.color });
    Object.assign(run, {
      id: String(raw.id || run.id), wave, choice: ROGUE_CHOICE_TIERS[raw.choice] ? raw.choice : null,
      startedAt: num(raw.startedAt, Date.now()), refreshes: Math.max(0, Math.round(num(raw.refreshes, 0))),
      statPicks: { atk: num(raw.statPicks && raw.statPicks.atk, 0), aspd: num(raw.statPicks && raw.statPicks.aspd, 0), move: num(raw.statPicks && raw.statPicks.move, 0) },
      history: Array.isArray(raw.history) ? raw.history.slice(0, 40) : [], seen: raw.seen && typeof raw.seen === 'object' ? { ...raw.seen } : {},
      pendingReward: raw.pendingReward && typeof raw.pendingReward === 'object' ? { ...raw.pendingReward } : null,
    });
    Object.assign(run.player, {
      augments: augs(p.augments), augmentBaselines: p.augmentBaselines && typeof p.augmentBaselines === 'object' ? p.augmentBaselines : {},
      rounds: num(p.rounds, 0), wins: num(p.wins, 0), totalDmg: num(p.totalDmg, 0),
      bonusAtk: num(p.bonusAtk, 1), bonusAspd: num(p.bonusAspd, 1), bonusMove: num(p.bonusMove, 1),
    });
    Object.assign(run.rival, {
      name: typeof r.name === 'string' ? r.name.slice(0, 12) : run.rival.name, charId: r.charId, weaponId: r.weaponId,
      augments: augs(r.augments), weaponAugOrder: augs(r.weaponAugOrder), meets: Math.max(0, Math.min(4, Math.round(num(r.meets, 0)))),
    });
    return run;
  }

  /* 테스트용 바로가기: wave 직전까지 이겼다고 치고 그만큼의 보상을 AI 기준으로 받아 둔다.
   * 선택형 스테이지는 보통(증강 1회)으로 친다. 라이벌도 그때까지의 빌드로 키운다. */
  function fastForward(run, wave) {
    const target = clamp(Math.round(wave), 1, ROGUE_WAVE_COUNT);
    while (run.wave < target) {
      const def = waveDef(run.wave);
      if (def.kind === 'rival') growRival(run, def.meet);
      run.history.push({ wave: def.n, kind: def.kind, tier: def.kind === 'choice' ? 'normal' : null, won: true, time: 0, hpLeft: 100, kills: 0, skipped: true });
      run.player.rounds++; run.player.wins++;
      run.refreshes++;
      pickAugment(run, aiPickAugment(rollOffers(run), run.player));
      run.wave++;
    }
    return run;
  }

  /* ═══════════ 헤드리스 자동 진행 (테스트·밸런스 측정용) ═══════════ */
  function aiChooseTier(run, policy) {
    if (policy === 'weak' || policy === 'normal' || policy === 'strong') return policy;
    // 기본: 체력이 넉넉하게 이겨 왔으면 욕심낸다
    const last = run.history[run.history.length - 1];
    if (last && last.hpLeft >= 70) return chance(0.55) ? 'strong' : 'normal';
    if (last && last.hpLeft <= 30) return chance(0.6) ? 'weak' : 'normal';
    return 'normal';
  }
  function simulateWave(run, opts = {}) {
    const b = createWaveBattle(run, { autoplay: true, heroSkill: opts.heroSkill ?? 0.7, tier: opts.tier });
    const cap = (opts.cap || 240) * 60;
    let steps = 0;
    while (!b.result && steps++ < cap) b.update(1 / 60);
    const stalled = !b.result;
    if (stalled) b.finish(b.fighters.find(f => f !== b.rogueHero) || null, '시간 초과');
    for (let i = 0; i < 200 && !b.finished; i++) b.update(1 / 60);
    return { battle: b, stalled, ...finishWave(run, b) };
  }
  function simulateRun(opts = {}) {
    const run = newRun({ charId: opts.charId || pick(Object.keys(CHARACTERS)), weaponId: opts.weaponId || pick(Object.keys(WEAPONS)) });
    const log = [];
    while (run.status === 'active') {
      const wave = waveDef(run.wave);
      const tier = wave.kind === 'choice' ? aiChooseTier(run, opts.policy) : null;
      if (tier) run.choice = tier;
      const res = simulateWave(run, { heroSkill: opts.heroSkill, tier, cap: opts.cap });
      log.push({ wave: wave.n, kind: wave.kind, tier, won: res.won, time: res.battle.simT, stalled: res.stalled,
        hpLeft: run.history[run.history.length - 1].hpLeft });
      if (!res.won || res.cleared) break;
      const reward = res.reward;
      if (reward.kind === 'stat') applyStatReward(run, pick(['atk', 'aspd', 'move']));
      else for (let i = 0; i < reward.picks; i++) pickAugment(run, aiPickAugment(rollOffers(run), run.player));
      advance(run);
    }
    return { run, log };
  }

  root.BounceRoyalRogueSim = Object.freeze({
    BRAINS, rogueEvent, clampInside, wallPoint, wallParam, heroBodies, aliveMonsters, attachedTo,
    makeMonster, addMonster, spawnMonster, forcePattern, addHazard, knockHero, createWaveBattle, waveDef, spawnBodies, flattenSpawns,
    makeRival, growRival, rivalPlayer, newRun, rollOffers, pickAugment, applyStatReward, finishWave, advance,
    restoreRun, simulateWave, simulateRun, aiChooseTier, isMonster, fastForward,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
