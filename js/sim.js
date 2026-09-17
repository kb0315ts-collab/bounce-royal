'use strict';
/* ============================================================
 * 바운스 로얄 — 전투 시뮬레이션 (자체 2D 반사 물리)
 * 서버 권위형 구조를 로컬에서 동일하게 재현: 모든 판정이 이 코어에서 발생한다
 * ============================================================ */

const TAU = Math.PI * 2;
const ROCKET_SPEED = 760;
const DIAMOND_L = 405;      // 다이아 경기장 기본 크기 (4인 난투)
const DUEL_ARENA_L = 320;   // 1대1은 조우율을 위해 좁힌다
const PISTOL_BARRAGE_ROT = TAU * 2;  // 회전 난사 중 초당 2바퀴
const BOW_HOMING_NEAR = 140;         // 유도 화살이 듣기 시작하는 거리. 이 밖에서는 사실상 직선
const BOW_HOMING_RATE = 1.6;         // 코앞에서의 선회 속도(rad/s). 거리에 따라 제곱으로 줄어든다
const BOW_CHARGE_TURNS = 2;          // 차지 샷: 두 바퀴 돌 동안 조준한다
const BOW_CHARGE_SECS = 4;           // 두 바퀴에 걸리는 시간. 조준 난이도를 여기서 조절한다
const BOW_CHARGE_ROT = TAU * BOW_CHARGE_TURNS / BOW_CHARGE_SECS;  // 공격속도 영향 없음 — 조준 감각을 일정하게 유지
const COUNT_TIME = 3;       // 라운드 시작 카운트다운 (3 · 2 · 1)
const ENDING_TIME = 1.5;    // 승패가 갈린 뒤 슬로우로 보여주는 시간
const MELEE_ASPD_GAIN = 1.5;  // 근접이 공격속도 증가분을 받는 배율
const STEER_MAX_RAD = 50 * Math.PI / 180; // 최대 조향속도: 초당 50도
// 화염방사기 조준이 목표를 따라 도는 속도(rad/s). 한 바퀴에 1초.
// 조향보다 7배 이상 빠르되, 순간이동은 아니라서 끊기지 않는다.
const FLAME_AIM_RATE = TAU;
const STEER_RAMP_TIME = 0.25;              // 입력이 최대 조향력에 도달하는 시간
const STEER_BOUNCE_LOCK = 0.15;            // 벽 반사 직후에는 반사 방향을 우선한다
let UID = 0;
let SOUND_BATTLE_UID = 0; // 소리는 게임 엔티티 ID나 난수 흐름을 소비하지 않는다.
const SOUND_EVENT_TTL = 1.2, SOUND_EVENT_CAP = 96;
const COMMENTARY_EVENT_TTL = 2, COMMENTARY_EVENT_CAP = 96;

// 관전용 사실 기록. 난수·엔티티 UID·전투 판정과 독립적이며 화면에서만 소비한다.
// source: weapon:<weaponId>, skill:<weaponId>, char:<charId>,
// augment:swordBeam|bayonet|rocketStart|staticShock|shockwave|lightning|chainBolt|
// missile|shuriken|satellite|miniBall|minionRevenge, dot:bleed|flame.
// actor/target은 분열체도 원래 참가자의 UID다. 소환수에 맞힌 공격은 기록하지 않는다.
function battleCommentary(b, type, actor, target, source, amount = 0) {
  if (!b || b.demo || !Array.isArray(b.commentaryEvents)) return;
  const owner = teamOwner(actor), victim = teamOwner(target);
  if (!owner || (type === 'hit' && (!isFighterBody(target) || amount <= 0))) return;
  recordRoundFact(b, owner, type, source, amount);
  b.commentaryEvents.push({ seq: ++b.commentarySeq, t: b.simT || 0, type,
    actor: owner.uid, target: victim ? victim.uid : 0, source, amount });
  pruneBattleCommentary(b);
}

/* 해설에 넘기는 사실 몇 가지. 판정이 필요한 것은 여기서 사실로 정한다.
 *  guard     직접 공격을 면역·보호막으로 통째로 막았다 (actor=막은 쪽, target=때린 쪽)
 *  wall-hit  벽에 튕긴 직후(몸은 0.6초 안, 투사체·방패는 튕긴 뒤)에 맞혔다
 *  dodge     무기 투사체가 몸 가장자리 NEAR_MISS 안까지 왔다가 안 맞고 사라졌다
 *  last-stand 마지막 저항 · 최후의 3초 발동
 *  split     분열 발동 */
const WALL_ASSIST_T = 0.6;
const NEAR_MISS = 16;
const DIRECT_SOURCE = /^(weapon|skill):|^char:(bomb|bball)$/;

function commentaryGuard(b, defender, attacker, source, amount) {
  if (!attacker || !DIRECT_SOURCE.test(source) || teamOwner(attacker) === teamOwner(defender)) return;
  battleCommentary(b, 'guard', defender, attacker, source, amount);
}

function projectileSource(p) {
  const owner = p.owner;
  return p.kind === 'charge' ? 'skill:bow' : p.kind === 'beam' ? 'augment:swordBeam'
    : p.kind === 'orb' && !owner.dead && owner.timers.rampage > 0 ? 'skill:staff'
      : p.commentarySource || (p.weapon ? 'weapon:' + ({ arrow: 'bow', bullet: 'pistol', orb: 'staff' }[p.kind] || owner.weaponId) : 'augment:' + p.kind);
}

// 스쳐 간 투사체 — 끝까지 안 맞은 상대에게만 '비켜 갔다'고 알린다
function reportNearMisses(b, p) {
  if (!p.near) return;
  const source = projectileSource(p);
  for (const body of p.near.values()) {
    if (!body.dead && !body.mainDead && body.hp > 0) battleCommentary(b, 'dodge', body, p.owner, source, 0);
  }
  p.near = null;
}

// Cumulative presentation facts survive event pruning and missed snapshots.
// Amounts are effective HP damage/healing, never attempted damage or overheal.
function recordRoundFact(b, owner, type, source, amount = 0) {
  if (!b || b.demo || !owner || !owner.player) return;
  const rows = b.roundReport || (b.roundReport = Object.create(null));
  const row = rows[owner.player.id] || (rows[owner.player.id] = {
    id: owner.player.id, damage: {}, healing: {}, skills: {}, releases: {},
  });
  const bucket = type === 'hit' ? row.damage : type === 'heal' ? row.healing
    : type === 'release' ? row.releases : type === 'skill' ? row.skills : null;
  if (bucket) bucket[source] = (bucket[source] || 0) + (type === 'hit' || type === 'heal' ? amount : 1);
}

function pruneBattleCommentary(b) {
  const cutoff = (b.simT || 0) - COMMENTARY_EVENT_TTL;
  while (b.commentaryEvents.length && (b.commentaryEvents[0].t < cutoff || b.commentaryEvents.length > COMMENTARY_EVENT_CAP)) b.commentaryEvents.shift();
}

function battleSound(b, id, body, cooldown = 0) {
  if (!b || b.demo || !Array.isArray(b.soundEvents)) return;
  const t = b.simT || 0;
  if (cooldown > 0) {
    const key = id + ':' + (body && body.uid || 0);
    const prev = b.soundCooldowns.get(key);
    if (prev != null && t - prev < cooldown) return;
    b.soundCooldowns.set(key, t);
  }
  b.soundEvents.push({ seq: ++b.soundSeq, id, x: body && body.x || 0, y: body && body.y || 0, t });
  pruneBattleSounds(b);
}

function pruneBattleSounds(b) {
  const cutoff = (b.simT || 0) - SOUND_EVENT_TTL;
  while (b.soundEvents.length && (b.soundEvents[0].t < cutoff || b.soundEvents.length > SOUND_EVENT_CAP)) b.soundEvents.shift();
}

/* ---------------- utils ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;
const bodyRadius = body => body.kind === 'main' ? body.radius : (body.r || body.radius);
const isFighterBody = body => body && (body.kind === 'main' || body.kind === 'split');
const teamOwner = body => body && body.kind !== 'main' && body.owner ? body.owner : body;
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function normDir(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }
function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
function angleTo(ax, ay, bx, ay2) { return Math.atan2(ay2 - ay, bx - ax); }
function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

function steerBodies(f) {
  if (f && f.mainDead && f.splitBalls && f.splitBalls.length) {
    return f.splitBalls.filter(s => !s.dead);
  }
  return f ? [f] : [];
}

/*
 * 조향 입력은 이동을 직접 덮어쓰지 않고 목표만 저장한다.
 * angle은 월드 좌표계 라디안, magnitude는 0..1이다. 분열 후 본체에
 * 들어온 입력은 살아 있는 두 분열체에 똑같이 전달된다.
 */
/* 화염방사기의 분사 버튼. 누르고 있는 상태가 서버에 전달돼야 해서
 * 조향과 같은 방식으로 상태를 받는다. */
function setFlameInput(f, on) {
  for (const body of steerBodies(f)) {
    if (body.flame) body.flame.on = !!on;
  }
}

function setSteerInput(f, angle, magnitude = 1) {
  if (!f || !Number.isFinite(angle) || !Number.isFinite(magnitude)) return false;
  const mag = clamp(magnitude, 0, 1);
  if (mag <= 0) return clearSteerInput(f);
  let changed = false;
  for (const body of steerBodies(f)) {
    if (!body.steer) body.steer = { active: false, angle: 0, magnitude: 0, power: 0, lock: 0 };
    const wasActive = body.steer.active;
    body.steer.active = true;
    body.steer.angle = angle;
    body.steer.magnitude = mag;
    if (!wasActive) body.steer.power = 0;
    changed = true;
  }
  return changed;
}

function clearSteerInput(f) {
  if (!f) return false;
  let changed = false;
  for (const body of steerBodies(f)) {
    if (!body.steer) body.steer = { active: false, angle: 0, magnitude: 0, power: 0, lock: 0 };
    body.steer.active = false;
    body.steer.magnitude = 0;
    body.steer.power = 0;
    changed = true;
  }
  return changed;
}

function steeringBlocked(f) {
  const T = f.timers || {};
  return f.rocketActive || T.dashPrep > 0 || T.dashT > 0 || T.stun > 0 || T.bind > 0;
}

function applySteering(f, dt) {
  const s = f.steer;
  if (!s || dt <= 0) return;
  s.lock = Math.max(0, (s.lock || 0) - dt);
  if (!s.active || s.lock > 0 || steeringBlocked(f)) return;

  // 입력 자체의 조향력이 0.25초에 걸쳐 올라간다. 스틱 세기는 별도 배율로 즉시 반영한다.
  s.power = Math.min(1, (s.power || 0) + dt / STEER_RAMP_TIME);
  const len = Math.hypot(f.vx, f.vy);
  if (len <= 1e-9 || s.power <= 0) return;
  const current = Math.atan2(f.vy, f.vx);
  const maxTurn = STEER_MAX_RAD * s.power * s.magnitude * dt;
  const next = current + clamp(angleDelta(current, s.angle), -maxTurn, maxTurn);
  // 방향만 바꾸고 벡터의 길이는 그대로 둔다. 실제 이동속도는 st.move가 맡는다.
  f.vx = Math.cos(next) * len;
  f.vy = Math.sin(next) * len;
}

/* ============================================================
 * 경기장
 * ============================================================ */
class Arena {
  constructor(type) {
    this.type = type;
    this.R = 378;          // 원형 반지름
    this.H = 350;          // 사각형 절반 폭
    this.L = DIAMOND_L;    // 마름모 중심에서 꼭짓점까지 (|x|+|y| <= L)
    this.pillars = [];     // 장애물 {x,y,r}
    if (type === 'obstacle') {
      this.H = 335;
      for (const [px, py] of [[-150, -150], [150, -150], [-150, 150], [150, 150]]) this.pillars.push({ x: px, y: py, r: 42 });
    }
    this.cube = null;      // 파워업 큐브 {x,y,active,respT,spin}
    if (type === 'power') this.cube = { x: 0, y: 0, active: false, respT: 2.5, spin: 0 };
  }

  get name() { return MAPS[this.type] ? MAPS[this.type].name : this.type; }

  /* 볼(원) 반사. dir는 단위벡터. 반사 횟수 반환 */
  collideBody(b) {
    let n = 0;
    const br = bodyRadius(b);
    if (this.type === 'diamond') {
      // 네 변의 법선은 (±1,±1)/√2 상수다. 중심에서 변까지의 거리는 (|x|+|y|)/√2.
      const lim = this.L - br * Math.SQRT2;
      const sum = Math.abs(b.x) + Math.abs(b.y);
      if (sum > lim) {
        const sx = b.x >= 0 ? 1 : -1, sy = b.y >= 0 ? 1 : -1;
        const nx = sx * Math.SQRT1_2, ny = sy * Math.SQRT1_2;
        const dot = b.vx * nx + b.vy * ny;
        if (dot > 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; n++; }
        const push = (sum - lim) * 0.5;
        b.x -= sx * push; b.y -= sy * push;
      }
    } else if (this.type === 'circle') {
      const d = Math.hypot(b.x, b.y), lim = this.R - br;
      if (d > lim) {
        const nx = b.x / (d || 1), ny = b.y / (d || 1);
        const dot = b.vx * nx + b.vy * ny;
        if (dot > 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; n++; }
        b.x = nx * lim; b.y = ny * lim;
      }
    } else {
      const H = this.H;
      if (b.x < -H + br) { b.x = -H + br; if (b.vx < 0) { b.vx = -b.vx; n++; } }
      if (b.x > H - br) { b.x = H - br; if (b.vx > 0) { b.vx = -b.vx; n++; } }
      if (b.y < -H + br) { b.y = -H + br; if (b.vy < 0) { b.vy = -b.vy; n++; } }
      if (b.y > H - br) { b.y = H - br; if (b.vy > 0) { b.vy = -b.vy; n++; } }
    }
    for (const p of this.pillars) {
      const d = dist(b.x, b.y, p.x, p.y);
      if (d < p.r + br) {
        const nx = (b.x - p.x) / (d || 1), ny = (b.y - p.y) / (d || 1);
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; n++; }
        b.x = p.x + nx * (p.r + br); b.y = p.y + ny * (p.r + br);
      }
    }
    return n;
  }

  /* 투사체용: 벽에 닿으면 반사(단위벡터 갱신). hit 여부 반환 */
  reflectProj(p) {
    let hit = false;
    if (this.type === 'diamond') {
      const lim = this.L - p.r * Math.SQRT2;
      const sum = Math.abs(p.x) + Math.abs(p.y);
      if (sum > lim) {
        const sx = p.x >= 0 ? 1 : -1, sy = p.y >= 0 ? 1 : -1;
        const nx = sx * Math.SQRT1_2, ny = sy * Math.SQRT1_2;
        const dot = p.vx * nx + p.vy * ny;
        if (dot > 0) { p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny; }
        const push = (sum - lim) * 0.5;
        p.x -= sx * push; p.y -= sy * push;
        hit = true;
      }
    } else if (this.type === 'circle') {
      const d = Math.hypot(p.x, p.y), lim = this.R - p.r;
      if (d > lim) {
        const nx = p.x / (d || 1), ny = p.y / (d || 1);
        const dot = p.vx * nx + p.vy * ny;
        if (dot > 0) { p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny; }
        p.x = nx * lim; p.y = ny * lim;
        hit = true;
      }
    } else {
      const H = this.H;
      if (p.x < -H + p.r) { p.x = -H + p.r; if (p.vx < 0) { p.vx = -p.vx; hit = true; } }
      if (p.x > H - p.r) { p.x = H - p.r; if (p.vx > 0) { p.vx = -p.vx; hit = true; } }
      if (p.y < -H + p.r) { p.y = -H + p.r; if (p.vy < 0) { p.vy = -p.vy; hit = true; } }
      if (p.y > H - p.r) { p.y = H - p.r; if (p.vy > 0) { p.vy = -p.vy; hit = true; } }
    }
    for (const pi of p.pierceObstacles ? [] : this.pillars) {
      const d = dist(p.x, p.y, pi.x, pi.y);
      if (d < pi.r + p.r) {
        const nx = (p.x - pi.x) / (d || 1), ny = (p.y - pi.y) / (d || 1);
        const dot = p.vx * nx + p.vy * ny;
        if (dot < 0) { p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny; hit = true; }
        p.x = pi.x + nx * (pi.r + p.r); p.y = pi.y + ny * (pi.r + p.r);
      }
    }
    if (hit) p.ang = Math.atan2(p.vy, p.vx);
    return hit;
  }

  /* 조준 예측용 광선: 첫 벽 충돌 지점과 반사 방향 */
  castRay(x, y, dx, dy, r) {
    let best = null;
    if (this.type === 'diamond') {
      // 볼록 도형이므로 진행 방향과 마주보는 변 중 가장 가까운 교차점이 첫 충돌이다.
      const lim = this.L - r * Math.SQRT2;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const denom = sx * dx + sy * dy;
        if (denom <= 0) continue;
        const t = (lim - (sx * x + sy * y)) / denom;
        if (t > 0 && (!best || t < best.t)) {
          best = { t, x: x + dx * t, y: y + dy * t, nx: sx * Math.SQRT1_2, ny: sy * Math.SQRT1_2 };
        }
      }
    } else if (this.type === 'circle') {
      const lim = this.R - r;
      const b = x * dx + y * dy, c = x * x + y * y - lim * lim;
      const disc = b * b - c;
      if (disc > 0) { const t = -b + Math.sqrt(disc); if (t > 0) { const hx = x + dx * t, hy = y + dy * t; const l = Math.hypot(hx, hy) || 1; best = { t, x: hx, y: hy, nx: hx / l, ny: hy / l }; } }
    } else {
      const H = this.H - r;
      const cands = [];
      if (dx < 0) cands.push({ t: (-H - x) / dx, nx: -1, ny: 0 });
      if (dx > 0) cands.push({ t: (H - x) / dx, nx: 1, ny: 0 });
      if (dy < 0) cands.push({ t: (-H - y) / dy, nx: 0, ny: -1 });
      if (dy > 0) cands.push({ t: (H - y) / dy, nx: 0, ny: 1 });
      for (const c of cands) if (c.t > 0 && (!best || c.t < best.t)) best = c;
      if (best) { best.x = x + dx * best.t; best.y = y + dy * best.t; }
    }
    // 기둥이 벽보다 가까우면 기둥 표면이 첫 충돌 지점이 된다.
    // '쌍둥이 기둥' 이벤트로 원형 경기장에 기둥이 생겨도 예측선이 실제 반사와 일치해야 한다.
    for (const p of this.pillars) {
      const R = p.r + r;
      const ox = x - p.x, oy = y - p.y;
      const pb = ox * dx + oy * dy, pc = ox * ox + oy * oy - R * R;
      const pdisc = pb * pb - pc;
      if (pdisc <= 0) continue;
      const t = -pb - Math.sqrt(pdisc);
      if (t <= 0 || (best && t >= best.t)) continue;
      const hx = x + dx * t, hy = y + dy * t;
      best = { t, x: hx, y: hy, nx: (hx - p.x) / R, ny: (hy - p.y) / R };
    }
    return best;
  }

  update(dt) {
    if (this.cube) {
      this.cube.spin += dt * 2;
      if (!this.cube.active) { this.cube.respT -= dt; if (this.cube.respT <= 0) this.cube.active = true; }
    }
  }
}

/* ============================================================
 * 증강 적용 (전투 빌드 시)
 * ============================================================ */
function applyAugmentBattle(f, id, player) {
  const P = f.perm, Fl = f.flags;
  /* 누적형은 집은 뒤로 쌓은 것만 센다. 기준선을 찍어 두고 그만큼 뺀다 —
   * 안 그러면 늦게 집을수록 공짜로 세진다.
   * 연승만은 예외다. '지금 몇 연승 중인가'가 곧 그 증강의 값이라,
   * 늦게 집었다고 진행 중인 연승을 못 본 척하면 말이 안 된다. */
  const baseline = player.augmentBaselines && player.augmentBaselines[id];
  const gained = key => Math.max(0, (player[key] || 0) - (baseline ? baseline[key] || 0 : 0));
  const streakGained = () => Math.max(0, player.streak || 0);
  switch (id) {
    case 'hp15': P.hp *= 1.15; break;
    case 'atk15': P.atk *= 1.15; break;
    case 'dmg10': P.dmg *= 1.10; break;
    case 'rot15': P.aspd *= 1.15; break;
    case 'move15': P.move *= 1.15; break;
    case 'lifesteal': Fl.lifesteal = (Fl.lifesteal || 0) + 0.08; break;
    case 'giant': P.size *= 1.2; P.hp *= 1.5; break;
    case 'tiny': P.size *= 0.8; break;
    case 'elastic': Fl.elastic = 1; break;
    case 'warmup': case 'accelRot': case 'speedster': case 'meditate':
    case 'marathoner': case 'rampage20': Fl[id] = 1; break;
    case 'firstStrike': case 'rocketStart': case 'ironDefense':
    case 'berserker': case 'desperateSpin': case 'escapeInstinct': case 'lastResistance':
    case 'survivalInstinct': Fl[id] = 1; break;
    case 'winMomentum': P.atk *= 1 + 0.04 * gained('wins'); break;
    case 'bloodRush': P.atk *= 1 + 0.06 * streakGained(); break;
    case 'vengeance': P.atk *= 1 + 0.07 * gained('losses'); break;
    case 'learnLoss': P.hp *= 1 + 0.08 * gained('losses'); break;
    case 'survivor': P.hp *= 1 + 0.03 * gained('rounds'); break;
    case 'battleExp': P.aspd *= 1 + 0.02 * gained('rounds'); break;
    case 'seasonedExp': P.atk *= 1 + 0.03 * gained('rounds'); break;
    case 'fallenPower': P.dmg *= 1 + 0.05 * gained('coinsLost'); break;
    case 'brink':
      if (player.coins === 1) P.dmg *= 1.2;
      break;
    case 'devilDeal': P.atk *= 1.25; break;
    case 'glass': P.atk *= 1.2; P.hp *= 0.85; break;
    case 'brute': P.atk *= 1.25; P.aspd *= 0.75; break;
    case 'bloodWeapon': P.atk *= 1.3; Fl.bloodWeapon = 1; break;
    case 'reflectCharge': case 'wallClimb': case 'shockwave':
    case 'collisionMania':
    case 'staticShock': case 'staticUp': case 'staticFast':
    case 'sleepGas': case 'frost': case 'gravityWell':
    case 'missile': case 'missilePlus': case 'missileUp':
    case 'flame': case 'flameUp': case 'flameDur':
    case 'lightning': case 'chainBolt':
    case 'shuriken': case 'shurikenSpd': case 'shurikenUp':
    case 'satellite': case 'satellitePlus':
    case 'miniBall': case 'twins': case 'legion': case 'minionRevenge':
    case 'split': case 'lastStand':
    case 'warmonger': case 'rotMomentum': case 'chase': case 'vampiric':
    case 'mark': case 'counter': case 'hitCharge':
    case 'autoExpert': case 'speedPower':
      Fl[id] = 1; break;
    case 'w_giant': Fl.giantBlade = 1; break;
    case 'w_beam': Fl.swordBeam = 1; break;
    case 'd_dual': Fl.dualDagger = 1; break;
    case 'd_phase': Fl.dualPhase = 1; break;
    case 'd_bleed': Fl.bleed = 1; break;
    case 'b_triple': Fl.triple = 1; break;
    case 'b_homing': Fl.homing = 1; break;
    case 'b_kb': Fl.kbArrow = 1; break;
    case 'p_shotgun': Fl.shotgun = 1; break;
    case 'p_mag': Fl.extMag = 1; break;
    case 'p_bayonet': Fl.bayonet = 1; break;
    case 's_double': Fl.doubleMagic = 1; break;
    case 's_steal': Fl.steal = 1; break;
    case 's_bounce': Fl.doubleReflect = 1; break;
    case 'm_big': Fl.bigMine = 1; break;
    case 'm_heal': Fl.healMine = 1; break;
    case 'm_freeze': Fl.freezeMine = 1; break;
    case 'sh_magnet': Fl.discMagnet = 1; break;
    case 'sh_ricochet': Fl.discRicochet = 1; break;
    case 'sh_grip': Fl.discGrip = 1; break;
    case 'f_pressure': Fl.flamePressure = 1; break;
    case 'f_ember': Fl.flameEmber = 1; break;
    case 'f_thrust': Fl.flameThrust = 1; break;
    case 'c_long': Fl.chainLong = 1; break;
    case 'c_barbed': Fl.chainBarbed = 1; break;
    case 'c_quake': Fl.chainQuake = 1; break;
  }
}

/* ---------------- 플레이어(메타) → 전투 참가자 빌드 ---------------- */
function buildFighter(player, battle) {
  const ch = CHARACTERS[player.charId], wp = WEAPONS[player.weaponId];
  const f = {
    uid: ++UID, kind: 'main', b: battle,
    player, pid: player.id, name: player.name, isAI: player.isAI, color: player.color,
    charId: player.charId, weaponId: player.weaponId,
    perm: { atk: 1, dmg: (player.damageRewardMult || 1) * (player.eventDamageMult || 1), hp: 1, move: wp.moveMult, aspd: 1, size: ch.size, dmgTaken: 1 },
    flags: {},
    x: 0, y: 0, vx: 1, vy: 0, hp: 1, maxHp: 1, shield: 0, radius: 22,
    weaponAngle: rand(0, TAU), spinAcc: 0, spinRemaining: 0,
    timers: {
      immune: 0, untouchable: 0, freeze: 0, bind: 0, stun: 0, weaponLock: 0,
      chase: 0, revSpeed: 0, rampage: 0, balloon: 0, fuse: 0, det: 0, gunBarrage: 0,
      dashPrep: 0, dashT: 0, actingDead: 0, atkBuff: 0, spdBuff: 0, berserk: 0,
      elastic: 0,
    },
    // computeStats가 돌기 전(조준 단계)에도 읽히므로 모양을 완전히 맞춰 둔다.
    // aspd가 빠져 있어 스탯판이 첫 프레임에 터졌었다.
    st: { atk: 1, dmg: 1, move: ch.move * wp.moveMult, rot: wp.rot, fr: 1, aspd: 1, size: 1 },
    warmStacks: 0, rotStacks: 0, hitChargeStacks: 0, collisionStacks: 0,
    cd: {}, meleeContact: new Set(), markHits: new Map(),
    gun: null, charging: null, tracking: null, dash: null, dashHit: null, dashPrepDir: null,
    berserkPhase: 0, bleed: { n: 0, stacks: [] }, frost: { n: 0, t: 0 },
    bounceRun: 0, charged: false, counterReady: false, pushReady: false,
    bounceTotal: 0, lightningNext: 3,
    sfxSkill: 0,        // 스킬 효과음이 난 횟수. 멀티에서 클라이언트가 같은 소리를 재생하는 근거
    sfxSlash: 0,        // 근접 무기가 벤 횟수. 위와 같은 이유로 센다

    hist: [], histT: 0,
    // 방패. disc가 있으면 던져져 있는 상태이고 그동안은 무기가 없다.
    disc: null,
    gripT: 0,          // 주운 직후 피해 감소가 남은 시간 (단단한 손)
    // 화염방사기. on은 버튼을 누르고 있는지, fuel은 남은 연료다.
    flame: { on: false, fuel: WEAPONS.flame ? WEAPONS.flame.fuelMax : 100, idle: 0, aim: null },
    // 쇠사슬의 추. 공과 별개의 물체라 자기 위치·속도를 갖는다.
    // 철퇴면 하나, 다른 무기는 빈 배열이다.
    chainHeads: [],
    chainHits: new Map(),   // 대상 uid -> 다음에 때릴 수 있는 시각 (재타격 잠금)
    flameHits: new Map(),   // 화염방사기: 대상 uid -> 다음 불길 피해 시각
    // 무기 스킬은 쿨타임(cd, 초)으로 돈다. 분열체가 이 객체를 참조로 공유하므로
    // 쿨타임도 여기 넣어야 본체와 분열체가 같은 값을 본다.
    skillUses: { char: 1, weapon: 1, cd: 0 },
    summons: [], splitBalls: [], satellites: [],
    splitUsed: false, lastStandUsed: false,
    mainDead: false, dead: false, deathAt: 0, downPending: false,
    lastResistanceUsed: false, survivalInstinctUsed: false,
    // aimTouched: 카운트다운 동안 조이스틱으로 방향을 한 번이라도 잡았는가.
    // 잡아 뒀다면 손을 떼도 그 방향으로 나가고, 끝까지 안 잡았으면 아무 방향으로나 나간다.
    flash: 0, staticCd: 0, collisionCd: 0, onSticky: false, pendingAim: false, aimTouched: false,
    rocketActive: false, rocketHits: new Set(),
    steer: { active: false, angle: 0, magnitude: 0, power: 0, lock: 0 },
    aiT: rand(0.4, 1.4), aiSteerT: rand(0.4, 0.7), aiSteerSide: chance(0.5) ? 1 : -1,
    aiDodgeT: rand(0, AI_DODGE_TICK),   // 봇들이 같은 프레임에 몰려 살피지 않게 흩어 둔다
    spawnX: 0, spawnY: 0,
  };
  for (const id of player.augments) applyAugmentBattle(f, id, player);
  f.rocketActive = !!f.flags.rocketStart;
  f.maxHp = Math.max(30, Math.round(ch.hp * f.perm.hp));
  f.hp = f.maxHp;
  if (player.weaponId === 'pistol') {
    const mag = wp.burst + (f.flags.extMag ? 4 : 0);
    f.gun = { mag, burst: mag, shotT: 0.4, reloadT: 0, focus: false };
  }
  const satN = (f.flags.satellite ? 1 : 0) + (f.flags.satellitePlus ? 1 : 0);
  for (let i = 0; i < satN; i++) f.satellites.push({ ang: i * TAU / satN, cd: 0 });
  // 쿨다운 초기화
  const exp = f.flags.autoExpert ? 0.7 : 1;
  f.autoCdMult = exp;
  f.cd = {
    fire: 0.5, mine: 0.8, missile: 3 * exp, shuriken: 2 * exp, flame: 0, sticky: 0,
    gasT: 10 * exp, gravT: 10 * exp, medT: 5, bloodT: 5, flameTick: 0,
  };
  return f;
}

/* ============================================================
 * 증강 제시/선택 (메타)
 * ============================================================ */
function augEligible(a, player) {
  if (a.hidden) return false;
  if (a.weapon && a.weapon !== player.weaponId) return false;
  if (a.req && !player.augments.includes(a.req)) return false;
  if (!a.stackable && player.augments.includes(a.id)) return false;
  switch (a.id) {
    case 'devilDeal': return player.coins >= 2;
    case 'gamble': return !player.gamble && !player.trollCondition;
    case 'trollCondition': return !player.trollCondition && !player.gamble;
    default: return true;
  }
}
function augWeight(a) {
  if (a.cat === 'weapon') return 1.7;
  if (a.cat === 'copy') return 0.75;
  if (a.cat === 'coin') return 0.85;
  return 1;
}
function rollAugmentOffers(player, n = 3) {
  const pool = AUGMENTS.filter(a => augEligible(a, player));
  const offers = [];
  const used = new Set();
  for (let k = 0; k < n && pool.length; k++) {
    const cands = pool.filter(a => !used.has(a.id));
    if (!cands.length) break;
    let total = 0; for (const a of cands) total += augWeight(a);
    let r = Math.random() * total;
    let chosen = cands[0];
    for (const a of cands) { r -= augWeight(a); if (r <= 0) { chosen = a; break; } }
    offers.push(chosen); used.add(chosen.id);
  }
  // 풀 부족 시 기본 스탯으로 채우기
  const fillers = ['hp15', 'atk15', 'dmg10', 'rot15', 'move15'];
  while (offers.length < n) offers.push(AUG_BY_ID[pick(fillers)]);
  return offers;
}
/* 집은 뒤로 쌓은 것만 세는 증강들. 연승 계열(핏빛 질주)은 여기 없다 —
 * 진행 중인 연승을 그대로 받는다. */
const BASELINE_AUGMENTS = ['winMomentum', 'vengeance', 'learnLoss', 'survivor', 'battleExp', 'seasonedExp', 'fallenPower'];
function applyAugmentPick(player, aug) {
  if (BASELINE_AUGMENTS.includes(aug.id)) {
    player.augmentBaselines = player.augmentBaselines || {};
    player.augmentBaselines[aug.id] = {
      wins: player.wins || 0, losses: player.losses || 0,
      rounds: player.rounds || 0, coinsLost: player.coinsLost || 0,
    };
  }
  player.augments.push(aug.id);
  switch (aug.id) {
    case 'devilDeal':
      player.coins--;
      player.coinsLost = (player.coinsLost || 0) + 1;
      break;
    case 'gamble': player.gamble = true; break;
    case 'trollCondition': player.trollCondition = true; break;
  }
}
/* ---- AI 증강 선택 ----
 * 성향 값은 짐작이 아니라 실측이다. 무작위 빌드끼리 1497판을 붙여
 * 각 증강이 들어간 쪽의 승률을 센 뒤, (승률 - 50%)에 비례하도록 옮겼다.
 * 밸런스를 고치면 이 값도 다시 재야 한다. */
const AI_CAT_WEIGHT = {
  weapon: 2.60,   // 61.8%  압도적이다 (삼중 마법 97%, 트리플 샷 96%). 나올 때마다 집는 게 맞다
  time: 1.23,     // 53.9%
  summon: 1.19,   // 53.2%
  death: 1.14,    // 52.3%
  auto: 1.13,     // 52.1%
  onhit: 1.06,    // 51.0%
  stat: 1.03,     // 50.5%  평범하다. 예전에는 과대평가하고 있었다
  physics: 0.96,  // 49.3%
  coin: 0.92,     // 48.6%
  trade: 0.89,    // 48.2%
  tempo: 0.89,    // 48.2%
  hpcond: 0.86,   // 47.7%
  cc: 0.86,       // 47.6%
  link: 0.79,     // 46.5%
  streak: 0.76,   // 46.0%  누적형은 생각보다 약하다
};
/* 카테고리 평균에서 크게 벗어난 개별 증강 (표본 200판 이상) */
const AI_AUG_WEIGHT = {
  vampiric: 1.5,        // 63%
  missile: 1.4,         // 62%
  meditate: 1.4,        // 61%
  winMomentum: 0.85,    // 44%
  gravityWell: 0.8,     // 43%
  escapeInstinct: 0.8,  // 43%
  trollCondition: 0.8,  // 43%
  hitCharge: 0.8,       // 43%
  flame: 0.75,          // 42%
  bloodRush: 0.7,       // 40%
};
/* '자동화 전문가'가 쿨타임을 줄여 주는 대상 */
const COOLDOWN_AUGMENTS = ['missile', 'shuriken', 'sleepGas', 'gravityWell'];

/* 후보 하나의 점수. 성향(실측)에 그 판의 사정을 곱한다.
 * 사정은 고르는 시점에 알 수 있는 것만 쓴다 — 가진 증강, 코인, 치른 라운드. */
function aiAugmentScore(aug, player) {
  const owned = (player && player.augments) || [];
  const has = id => owned.indexOf(id) >= 0;
  const count = id => owned.reduce((n, x) => n + (x === id ? 1 : 0), 0);
  const coins = player && player.coins != null ? player.coins : 5;
  const rounds = (player && player.rounds) || 0;

  const cat = aug.weapon ? 'weapon' : aug.cat;
  let w = (AI_CAT_WEIGHT[cat] || 1) * (AI_AUG_WEIGHT[aug.id] || 1);

  // 조건이 붙은 것은 조건을 실제로 갖췄을 때만 값어치가 있다
  if (aug.id === 'autoExpert') {
    const n = COOLDOWN_AUGMENTS.reduce((s, id) => s + (has(id) ? 1 : 0), 0);
    w *= n === 0 ? 0.3 : 1 + 0.4 * n;
  }
  if (aug.id === 'speedPower') w *= 0.4 + 0.5 * count('move15');

  // 코인이 곧 목숨이다. 여유가 없으면 거는 증강을 피하고, 벼랑 끝에서는 오히려 챙긴다.
  if (aug.id === 'devilDeal' || aug.id === 'gamble') w *= coins <= 2 ? 0.15 : coins >= 4 ? 1.1 : 0.6;
  if (aug.id === 'brink') w *= coins <= 2 ? 2.2 : 0.5;
  if (aug.id === 'fallenPower') w *= 1 + 0.3 * Math.min(3, (player && player.coinsLost) || 0);

  // 누적형은 획득 이후부터 쌓인다. 끝물에 집으면 쌓일 시간이 없다.
  if (cat === 'streak') w *= rounds >= 5 ? 0.6 : 1;

  return Math.max(0.05, w);
}

function aiPickAugment(offers, player) {
  const w = offers.map(a => aiAugmentScore(a, player));
  let total = 0; for (const x of w) total += x;
  let r = Math.random() * total;
  for (let i = 0; i < offers.length; i++) { r -= w[i]; if (r <= 0) return offers[i]; }
  return offers[offers.length - 1];
}

/* ---------------- 라운드 승패·코인 계약 ---------------- */
function loseCoin(p) {
  p.trollLossProtected = false; p.gambleExtra = 0;
  if (p.trollCondition) {
    p.trollCondition = false;
    p.trollLossProtected = true;
    p.damageRewardMult = (p.damageRewardMult || 1) * 1.1;
  } else {
    p.coins--;
    let lost = 1;
    if (p.gamble) { p.coins--; p.gamble = false; p.gambleExtra = 1; lost++; }
    p.coinsLost = (p.coinsLost || 0) + lost;
  }
  p.losses++; p.streak = 0; p.lossStreak = (p.lossStreak || 0) + 1;
}

function winRound(p) {
  p.trollWinCost = false; p.gambleRewarded = false;
  p.wins++; p.streak++; p.lossStreak = 0;
  if (p.trollCondition) {
    p.trollCondition = false;
    p.trollWinCost = true;
    p.coins--;
    p.coinsLost = (p.coinsLost || 0) + 1;
  }
  if (p.gamble) {
    p.gamble = false;
    p.gambleRewarded = true;
    p.damageRewardMult = (p.damageRewardMult || 1) * 1.2;
  }
}

/* ============================================================
 * 이펙트 헬퍼
 * ============================================================ */
function popup(b, x, y, txt, color, big) {
  b.popups.push({ uid: ++UID, x, y, txt, color, t: 0.9, big: !!big });
  if (b.popups.length > 40) b.popups.shift();
}
function addFx(b, o) { o.t = 0; o.uid = ++UID; b.fx.push(o); if (b.fx.length > 80) b.fx.shift(); }
function sparks(b, x, y, n, color, spd = 160) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(spd * 0.4, spd);
    b.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.25, 0.55), color, size: rand(1.5, 3.5) });
  }
  if (b.particles.length > 300) b.particles.splice(0, b.particles.length - 300);
}
/* 공이 깨져 껍질 조각이 흩어진다. 누가 졌는지 눈으로 확인할 시간을 주려고
 * 조각을 크게, 오래 남긴다. 멀티에서는 파티클을 실어 보내지 않으므로
 * '깨졌다'는 신호 하나를 남겨 클라이언트가 같은 조각을 만들게 한다. */
function shatterFx(b, x, y, r, color) {
  const R = r || 14;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + rand(-0.16, 0.16), s = rand(80, 210);
    b.particles.push({
      x: x + Math.cos(a) * R * 0.5, y: y + Math.sin(a) * R * 0.5,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      t: 0, life: rand(0.8, 1.25), color, size: rand(R * 0.3, R * 0.52),
      shard: true, ang: a, spin: rand(-6, 6),
    });
  }
  sparks(b, x, y, 16, color, 300);
  addFx(b, { type: 'shatter', x, y, r: R, color, dur: 0.05 });
}
function explodeFx(b, x, y, r, color = '#ffb14d', sound = 'battle.explosion') {
  addFx(b, { type: 'ring', x, y, r0: r * 0.2, r1: r, color, dur: 0.35, boom: true });
  sparks(b, x, y, 14, color, 260);
  b.shake = Math.min(14, b.shake + r / 14);
  if (sound) battleSound(b, sound, { x, y });
}
function boltFx(b, x1, y1, x2, y2) {
  const segs = []; const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    segs.push({ x: x1 + (x2 - x1) * t + (i && i < n ? rand(-22, 22) : 0), y: y1 + (y2 - y1) * t + (i && i < n ? rand(-22, 22) : 0) });
  }
  addFx(b, { type: 'bolt', segs, dur: 0.28, color: '#aee3ff' });
}

/* ============================================================
 * 전투
 * ============================================================ */
/* 한 판은 실시간 40초로 끝난다. 연장전은 없다 — 시간이 다 되면 체력 비율로 가린다. */
const BATTLE_TIME = 40;
// 장기전 체질이 발동하는 경기 시각. 예전 연장전 진입 시점(남은 10초)과 같다.
const MARATHON_TIME = 30;

/* 경기 진행 속도. 1이면 수치 그대로, 0.583이면 그 속도로 굴러간다.
 *
 * 0.583인 이유: 그동안 윈도우 로컬 서버가 60틱이 아니라 35틱으로 돌았고
 * (setInterval(16.67ms)가 타이머 눈금 때문에 30ms로 벌어졌다), 그래서
 * 게임이 이 비율로 느리게 굴러갔다. 재미를 검증한 것이 그 속도였으므로
 * 느린 쪽을 기본값으로 삼는다. 실측값이다.
 *
 * 곱하는 대상은 '움직임'뿐이다 — step()과 연출.
 * 시계(simT·otT·endT·countT)에는 곱하지 않는다. 그래서 한 판은 설계대로
 * 실제 40초(본경기 30 + 연장 10)로 끝나고, 그 안의 움직임만 느리다.
 *
 * 이동·회전·투사체뿐 아니라 발사 간격·재장전·쿨다운·출혈 같은 것도 전부
 * step() 안에서 이 dt를 쓰므로 같은 비율로 함께 느려진다. 비율이 그대로라
 * 밸런스는 틀어지지 않는다. */
const GAME_SPEED = 0.583;

class Battle {
  constructor(mapId, players, opts = {}) {
    this.mapId = mapId;
    this.arena = new Arena(mapId);
    this.demo = !!opts.demo;
    this.soundId = ++SOUND_BATTLE_UID;
    this.soundSeq = 0;
    this.soundEvents = [];
    this.soundCooldowns = new Map();
    this.commentarySeq = 0;
    this.commentaryEvents = [];
    this.eventFfa = !!opts.eventFfa;
    this.eventPowerSupply = !!opts.powerSupply;
    this.eventTwoPillars = !!opts.twoPillars;
    if (this.eventPowerSupply && !this.arena.cube) {
      this.arena.cube = { x: 0, y: 0, active: false, respT: 2.5, spin: 0 };
    }
    if (this.eventTwoPillars) {
      this.arena.pillars.push(
        { x: -145, y: -65, r: 42 },
        { x: 145, y: 65, r: 42 },
      );
    }
    // 1대1은 서로 만날 확률을 높이기 위해 경기장을 좁힌다. 4인 난투는 그대로 둔다.
    if (this.arena.type === 'diamond' && players.length <= 2) this.arena.L = DUEL_ARENA_L;
    this.fighters = players.map(p => buildFighter(p, this));
    for (const f of this.fighters) recordRoundFact(this, f, 'init', '');
    this.placeFighters();
    this.phase = 'count';         // count → fight → ending
    this.countT = COUNT_TIME;
    this.simT = 0; this.marathonDone = false;
    this.projectiles = []; this.mines = []; this.flames = []; this.stickies = [];
    this.fx = []; this.popups = []; this.particles = [];
    this.shake = 0; this.result = null; this.finished = false; this.endT = 0;
    this.inStep = false;
    this.flameTick = 0;
    // 소환수 배치
    for (const f of this.fighters) {
      const n = (f.flags.miniBall ? 1 : 0) + (f.flags.twins ? 1 : 0);
      for (let i = 0; i < n; i++) this.spawnSummon(f, !!f.flags.legion);
    }
  }

  human() { return this.fighters.find(f => !f.isAI) || null; }

  placeFighters() {
    const n = this.fighters.length;
    const A = this.arena;
    if (n === 2) {
      const k = A.type === 'diamond' ? A.L / DIAMOND_L : 1;   // 경기장이 좁아지면 스폰도 같은 비율로
      this.setPos(this.fighters[0], -185 * k, 0, 0);
      this.setPos(this.fighters[1], 185 * k, 0, Math.PI);
    } else {
      const pos = this.arena.type === 'diamond'
        ? [[-150, -150], [150, -150], [150, 150], [-150, 150]]
        : [[-210, -210], [210, -210], [210, 210], [-210, 210]];
      for (let i = 0; i < n; i++) {
        const [x, y] = pos[i % 4];
        this.setPos(this.fighters[i], x, y, Math.atan2(-y, -x));
      }
    }
  }
  setPos(f, x, y, ang) {
    f.x = f.spawnX = x; f.y = f.spawnY = y;
    f.vx = Math.cos(ang); f.vy = Math.sin(ang);
  }
  setDir(f, ang) { f.vx = Math.cos(ang); f.vy = Math.sin(ang); }
  /* 출발 방향을 잡는다. 카운트다운 3초 동안만 받는다.
   * 조이스틱이 가리키는 쪽이 곧 출발 방향이다. 확정이라는 단계는 없어서
   * 놓았다 다시 잡아도 얼마든지 바뀌고, 마지막으로 가리킨 쪽으로 나간다. */
  aimDir(f, ang) {
    if (!f || !Number.isFinite(ang)) return false;
    if (this.phase !== 'count') return false;
    this.setDir(f, ang);
    f.aimTouched = true;
    return true;
  }
  setSteerInput(f, ang, magnitude = 1) { return setSteerInput(f, ang, magnitude); }
  setFlameInput(f, on) { return setFlameInput(f, on); }
  clearSteerInput(f) { return clearSteerInput(f); }

  spawnSummon(f, legion = false) {
    const a = rand(0, TAU);
    const statMult = legion ? 1.3 : 1;
    f.summons.push({
      uid: ++UID, kind: 'summon', owner: f, x: f.x + Math.cos(a) * 40, y: f.y + Math.sin(a) * 40,
      vx: Math.cos(a), vy: Math.sin(a), r: 13 * statMult, hp: 30 * statMult, maxHp: 30 * statMult,
      dmg: 10 * statMult, spd: 205, cd: 0, spin: rand(0, TAU),
    });
  }
  spawnSplits(f) {
    for (const da of [-0.7, 0.7]) {
      const ang = Math.atan2(f.vy, f.vx) + da;
      // A split is a complete fighter copy, not a homing minion.  It keeps the
      // character, weapon and augment build, but owns an independent runtime.
      const clone = buildFighter(f.player, this);
      clone.kind = 'split';
      clone.owner = f;
      clone.perm = { ...f.perm };
      clone.flags = { ...f.flags };
      clone.charId = f.charId;
      clone.weaponId = f.weaponId;
      clone.x = f.x + Math.cos(ang) * (f.radius + 3);
      clone.y = f.y + Math.sin(ang) * (f.radius + 3);
      clone.spawnX = clone.x;
      clone.spawnY = clone.y;
      clone.vx = Math.cos(ang);
      clone.vy = Math.sin(ang);
      clone.weaponAngle = f.weaponAngle + da;
      clone.maxHp = f.maxHp * 0.10;
      clone.hp = clone.maxHp;
      clone.radius = f.radius;
      clone.r = clone.radius;
      clone.shield = Math.min(clone.maxHp * 0.3, f.shield * 0.10);
      clone.attackScale = 0.5;
      clone.skillUses = f.skillUses; // the two copies share the original remaining active uses
      clone.rocketActive = f.rocketActive;
      clone.rocketHits = new Set();
      clone.steer = { ...f.steer };
      clone.timers = {
        ...f.timers,
        actingDead: 0, dashPrep: 0, dashT: 0, fuse: 0, det: 0,
      };
      clone.cd = { ...f.cd };
      clone.gun = f.gun ? { ...f.gun, focus: false } : null;
      clone.charging = f.charging ? { ...f.charging } : null;
      clone.berserkPhase = f.berserkPhase;
      clone.warmStacks = f.warmStacks;
      clone.rotStacks = f.rotStacks;
      clone.hitChargeStacks = f.hitChargeStacks;
      clone.collisionStacks = f.collisionStacks;
      clone.charged = f.charged;
      clone.counterReady = f.counterReady;
      clone.splitUsed = true;
      clone.splitBalls = [];
      clone.summons = [];
      f.splitBalls.push(clone);
    }
  }

  bodiesOf(f) {
    const arr = [];
    if (!f.mainDead && !f.dead) arr.push(f);
    for (const s of f.summons) arr.push(s);
    for (const s of f.splitBalls) arr.push(s);
    return arr;
  }
  enemiesOf(f) {
    const team = teamOwner(f);
    return this.fighters.filter(x => x !== team);
  }
  activeFighterBodies() {
    const arr = [];
    for (const f of this.fighters) {
      if (!f.mainDead && !f.dead) arr.push(f);
      for (const s of f.splitBalls) if (!s.dead) arr.push(s);
    }
    return arr;
  }
  fighterAlive(f) { return !f.dead && (!f.mainDead || f.splitBalls.length > 0); }

  nearestEnemyMain(f) {
    let best = null, bd = 1e9;
    for (const e of this.enemiesOf(f)) {
      if (!this.fighterAlive(e)) continue;
      const candidates = !e.mainDead && !e.dead ? [e] : e.splitBalls.filter(s => !s.dead);
      for (const body of candidates) {
        const d = dist(f.x, f.y, body.x, body.y);
        if (d < bd) { bd = d; best = body; }
      }
    }
    return best;
  }
  nearestEnemyBody(f) {
    let best = null, bd = 1e9;
    for (const e of this.enemiesOf(f)) {
      for (const body of this.bodiesOf(e)) {
        const d = dist(f.x, f.y, body.x, body.y);
        if (d < bd) { bd = d; best = body; }
      }
    }
    return best;
  }

  /* ================= 메인 루프 ================= */
  update(rdt) {
    this.shake = Math.max(0, this.shake - rdt * 26);
    let fxDt = rdt;
    if (this.phase === 'count') {
      // 3 · 2 · 1. 세는 동안 조이스틱이 가리키는 쪽이 곧 출발 방향이다.
      this.countT -= rdt;
      for (const f of this.fighters) {
        if (!f.isAI || f.aimTouched) continue;
        f.aiT -= rdt;
        if (f.aiT <= 0) { this.setDir(f, aiChooseStartDir(this, f)); f.aimTouched = true; }
      }
      if (this.countT <= 0) {
        // 끝날 때까지 아무도 안 건드린 쪽은 아무 방향으로나 내보낸다.
        for (const f of this.fighters) if (!f.aimTouched) this.setDir(f, rand(0, TAU));
        this.phase = 'fight'; this.simT = 0;
        for (const f of this.fighters) {
          if (f.rocketActive) battleSound(this, 'augment.rocket', f);
        }
      }
    } else if (this.phase === 'fight') {
      // 시계용. 여기에는 GAME_SPEED를 곱하지 않는다 — 한 판 길이는 실시간이다.
      this.simT += rdt;
      if (!this.marathonDone && this.simT >= MARATHON_TIME) {
        this.marathonDone = true;
        for (const f of this.fighters) if (f.flags.marathoner && this.fighterAlive(f)) healFighter(this, f, (f.maxHp - f.hp) * 0.5);
      }
      if (this.simT >= BATTLE_TIME) { this.timeoutResolve(); return; }
      this.step(rdt);
    } else if (this.phase === 'ending') {
      // 거의 멈춘 상태에서 시작해 서서히 풀린다. 파편과 팝업도 같은 속도로
      // 흘러야 화면 전체가 느려진 것처럼 보인다.
      const k = 1 - Math.max(0, this.endT) / ENDING_TIME;
      fxDt = rdt * (0.10 + 0.45 * k * k);
      this.step(fxDt);
      this.endT -= rdt;
      if (this.endT <= 0) this.finished = true;
    }
    this.updateFx(fxDt);
    pruneBattleSounds(this);
    pruneBattleCommentary(this);
  }

  updateFx(rdt) {
    for (const p of this.popups) { p.t -= rdt; p.y -= 34 * rdt; }
    this.popups = this.popups.filter(p => p.t > 0);
    for (const e of this.fx) e.t += rdt;
    this.fx = this.fx.filter(e => e.t < (e.dur || 0.5));
    for (const p of this.particles) { p.t += rdt; p.x += p.vx * rdt; p.y += p.vy * rdt; p.vx *= 0.94; p.vy *= 0.94; }
    this.particles = this.particles.filter(p => p.t < p.life);
  }

  /* ================= 전투 스텝 ================= */
  step(dt) {
    if (dt <= 0) return;
    this.inStep = true;
    // Chain hit speed uses actual travel, including stops, recoil and dashes.
    for (const f of this.fighters) for (const body of this.bodiesOf(f)) {
      body._motionX = body.x; body._motionY = body.y;
    }
    this.arena.update(dt);
    // 통계/타이머/상태
    for (const f of this.fighters) {
      computeStats(f);
      updateTimers(this, f, dt);
    }
    // 이동 + 벽
    for (const f of this.fighters) moveFighter(this, f, dt);
    // 볼·볼 충돌 (메인끼리)
    this.mainCollisions(dt);
    // 소환수/분열체
    this.updateMinions(dt);
    // 무기 · 자동 시스템 · AI
    for (const f of this.fighters) {
      updateCooldowns(this, f, dt);
      updateWeapon(this, f, dt);
      autoSystems(this, f, dt);
      updateSatellites(this, f, dt);
      if (f.isAI) aiUpdate(this, f, dt);
    }
    this.updateProjectiles(dt);
    this.updateMines(dt);
    this.updateGroundFx(dt);
    this.updateCube(dt);
    this.inStep = false;
    this.checkEnd();
  }

  mainCollisions(dt) {
    const mains = this.fighters.filter(f => !f.mainDead && !f.dead);
    for (let i = 0; i < mains.length; i++) for (let j = i + 1; j < mains.length; j++) {
      resolveFighterCollision(this, mains[i], mains[j]);
    }
  }

  updateMinions(dt) {
    const summons = [];
    const splits = [];
    for (const f of this.fighters) {
      for (const s of f.summons) summons.push(s);
      for (const s of f.splitBalls) splits.push(s);
    }

    // 꼬마볼은 적을 추적하지 않는다. 처음 정한 방향으로 움직이다가
    // 벽이나 다른 몸체와 부딪힐 때만 방향이 바뀐다.
    for (const m of summons) {
      m.cd = Math.max(0, m.cd - dt);
      m.x += m.vx * m.spd * GAME_SPEED * dt; m.y += m.vy * m.spd * GAME_SPEED * dt;
      m.spin += dt * 7;
      this.arena.collideBody(m);
      // 적 본체 접촉 공격
      for (const e of this.enemiesOf(m.owner)) {
        for (const body of this.bodiesOf(e)) {
          const d = dist(m.x, m.y, body.x, body.y);
          const br = bodyRadius(body);
          if (d < m.r + br) {
            const n = normDir(body.x - m.x, body.y - m.y);
            if (m.cd <= 0) {
              dealDamage(this, m.owner, body, m.dmg * m.owner.st.dmg, { kind: 'auto', commentarySource: 'augment:miniBall' });
              m.cd = 0.8;
            }
            m.x -= n.x * (m.r + br - d); m.y -= n.y * (m.r + br - d);
            const nd = normDir(m.x - body.x, m.y - body.y); m.vx = nd.x; m.vy = nd.y;
          }
        }
      }
    }

    // 분열체는 완전한 전투원 파이프라인(이동, 무기, 자동 증강)을
    // 각각 독립적으로 실행한다.
    for (const s of splits) {
      if (s.dead || !s.owner.splitBalls.includes(s)) continue;
      s.onSticky = this.stickies.some(st => teamOwner(st.owner) !== s.owner &&
        dist(st.x, st.y, s.x, s.y) < st.r + s.radius);
      computeStats(s);
      s.r = s.radius;
      updateTimers(this, s, dt);
      if (s.dead || !s.owner.splitBalls.includes(s)) continue;
      moveFighter(this, s, dt);
    }

    // 메인-분열체 및 분열체-분열체의 물리 충돌. 같은 소유자의 두
    // 분열체는 enemiesOf에서 빠지므로 서로를 공격하지 않는다.
    const handled = new Set();
    for (const s of splits) {
      if (s.dead || !s.owner.splitBalls.includes(s)) continue;
      for (const enemy of this.enemiesOf(s)) {
        for (const body of this.bodiesOf(enemy)) {
          if (!isFighterBody(body)) continue;
          const lo = Math.min(s.uid, body.uid), hi = Math.max(s.uid, body.uid);
          const key = lo + ':' + hi;
          if (handled.has(key)) continue;
          handled.add(key);
          resolveFighterCollision(this, s, body);
        }
      }
    }

    for (const s of splits) {
      if (s.dead || !s.owner.splitBalls.includes(s)) continue;
      updateCooldowns(this, s, dt);
      updateWeapon(this, s, dt);
      autoSystems(this, s, dt);
      updateSatellites(this, s, dt);
      if (s.isAI) aiUpdate(this, s, dt);
    }
  }

  updateProjectiles(dt) {
    const projs = this.projectiles;
    for (let i = projs.length - 1; i >= 0; i--) {
      const p = projs[i];
      p.life -= dt;
      if (p.life <= 0) { reportNearMisses(this, p); projs.splice(i, 1); continue; }
      if (p.homing) {
        const tgt = this.nearestEnemyBody(p.owner);
        if (tgt && tgt !== p.owner) {
          const want = Math.atan2(tgt.y - p.y, tgt.x - p.x);
          let d = want - p.ang;
          while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
          // homeNear가 붙은 투사체(유도 화살)는 가까울 때만 휜다. 멀리서는 거의 직선이라
          // 조준은 여전히 사람 몫이고, 아슬아슬하게 스칠 것만 끌어당긴다.
          let rate = p.homing;
          if (p.homeNear) {
            const near = clamp((p.homeNear - dist(p.x, p.y, tgt.x, tgt.y)) / p.homeNear, 0, 1);
            rate = p.homing * near * near;
          }
          p.ang += clamp(d, -rate * dt, rate * dt);
          p.vx = Math.cos(p.ang); p.vy = Math.sin(p.ang);
        }
      }
      const enlargedOrb = p.kind === 'orb' && !p.owner.dead && p.owner.timers.rampage > 0;
      if (p.baseR == null) p.baseR = p.r;
      p.r = p.baseR * (enlargedOrb ? 2 : 1);
      const projSpd = p.spd * GAME_SPEED;
      p.x += p.vx * projSpd * dt; p.y += p.vy * projSpd * dt;
      // 벽
      if (this.arena.reflectProj(p)) {
        if (p.bounces > 0) { p.bounces--; p.reflected = true; sparks(this, p.x, p.y, 3, '#c9d6ff', 90); battleSound(this, 'augment.reflect', p.owner, 0.12); }
        else { sparks(this, p.x, p.y, 4, '#8a93b8', 80); reportNearMisses(this, p); projs.splice(i, 1); continue; }
      }
      // 본체 적중
      let dead = false;
      for (const e of this.enemiesOf(p.owner)) {
        for (const body of this.bodiesOf(e)) {
          if (p.hitSet && p.hitSet.has(body.uid)) continue;
          const gap = dist(p.x, p.y, body.x, body.y) - (p.r + bodyRadius(body));
          if (gap >= 0 && gap < NEAR_MISS && p.weapon && isFighterBody(body)) (p.near = p.near || new Map()).set(body.uid, body);
          if (gap < 0) {
            if (p.near) p.near.delete(body.uid);
            projectileHit(this, p, body);
            if (p.pierce) { (p.hitSet = p.hitSet || new Set()).add(body.uid); }
            else { dead = true; }
            break;
          }
        }
        if (dead) break;
      }
      if (dead) { reportNearMisses(this, p); projs.splice(i, 1); }
    }
  }

  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.arm -= dt; m.t += dt;
      // 자기 회복 지뢰. 장전 중에도 벗어난 것은 세어 둔다.
      const onOwner = !m.owner.mainDead
        && dist(m.x, m.y, m.owner.x, m.owner.y) < m.trig + m.owner.radius;
      if (!m.selfArmed && !onOwner) m.selfArmed = true;
      if (m.arm > 0) continue;
      if (m.owner.flags.healMine && m.selfArmed && onOwner) {
        healFighter(this, m.owner, m.owner.maxHp * 0.08);
        addFx(this, { type: 'ring', x: m.x, y: m.y, r0: 6, r1: 40, color: '#7dffa8', dur: 0.3 });
        this.mines.splice(i, 1); continue;
      }
      let boom = false;
      for (const e of this.enemiesOf(m.owner)) {
        for (const body of this.bodiesOf(e)) {
          if (dist(m.x, m.y, body.x, body.y) < m.trig + bodyRadius(body)) { boom = true; break; }
        }
        if (boom) break;
      }
      if (boom) {
        explodeMine(this, m, 1);
        this.mines.splice(i, 1);
      }
    }
  }

  updateGroundFx(dt) {
    // 화염/점착 지속
    this.flameTick -= dt;
    const doFlame = this.flameTick <= 0;
    if (doFlame) this.flameTick = 0.25;
    const flameHits = doFlame ? new Map() : null;
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const fl = this.flames[i]; fl.life -= dt;
      if (fl.life <= 0) { this.flames.splice(i, 1); continue; }
      if (doFlame) {
        for (const e of this.enemiesOf(fl.owner)) {
          for (const body of this.bodiesOf(e)) {
            if (dist(fl.x, fl.y, body.x, body.y) < fl.r + bodyRadius(body)) {
              // 한 공격자가 남긴 여러 화염 조각은 시각적인 연속 장판일 뿐
              // 같은 대상에게 한 틱 안에서 중첩 피해를 주지 않는다.
              const key = `${fl.owner.uid}:${body.uid}`;
              const current = flameHits.get(key);
              if (!current || fl.dps > current.fl.dps) flameHits.set(key, { fl, body });
            }
          }
        }
      }
    }
    if (doFlame) {
      for (const { fl, body } of flameHits.values()) {
        dealDamage(this, fl.owner, body, fl.dps * 0.25 * fl.owner.st.dmg, { kind: 'auto', autoType: 'flame' });
      }
    }
    for (let i = this.stickies.length - 1; i >= 0; i--) {
      const s = this.stickies[i]; s.life -= dt;
      if (s.life <= 0) this.stickies.splice(i, 1);
    }
    // 점착 판정
    for (const f of this.activeFighterBodies()) {
      f.onSticky = false;
      for (const s of this.stickies) {
        if (teamOwner(s.owner) === teamOwner(f)) continue;
        if (dist(s.x, s.y, f.x, f.y) < s.r + f.radius) { f.onSticky = true; break; }
      }
    }
  }

  updateCube(dt) {
    const c = this.arena.cube;
    if (!c || !c.active || this.phase !== 'fight') return;
    for (const f of this.activeFighterBodies()) {
      if (dist(f.x, f.y, c.x, c.y) < 22 + f.radius) {
        c.active = false; c.respT = 12;
        const kind = pick(['atk', 'spd', 'heal', 'shield']);
        if (kind === 'atk') { f.timers.atkBuff = 8; popup(this, f.x, f.y - f.radius - 26, '공격 강화!', '#ffd24d', true); }
        if (kind === 'spd') { f.timers.spdBuff = 8; popup(this, f.x, f.y - f.radius - 26, '속도 강화!', '#7dffa8', true); }
        if (kind === 'heal') { healFighter(this, f, f.maxHp * 0.2); }
        if (kind === 'shield') { f.shield = Math.min(f.maxHp * 0.3, f.shield + f.maxHp * 0.15); popup(this, f.x, f.y - f.radius - 26, '보호막!', '#7fd8ff', true); }
        addFx(this, { type: 'ring', x: c.x, y: c.y, r0: 10, r1: 70, color: '#ffd24d', dur: 0.4 });
        sparks(this, c.x, c.y, 16, '#ffd24d', 240);
        break;
      }
    }
  }

  /* ================= 종료 처리 ================= */
  hpRatio(f) {
    if (!f.mainDead) return Math.max(0, f.hp) / f.maxHp;
    let s = 0; for (const sp of f.splitBalls) s += Math.max(0, sp.hp);
    return s / f.maxHp;
  }

  timeoutResolve() {
    const sorted = this.fighters.slice().sort((a, b) => {
      const d = this.hpRatio(b) - this.hpRatio(a);
      if (Math.abs(d) > 0.0001) return d;
      return b.maxHp - a.maxHp;
    });
    this.finish(sorted[0], '체력 비율 판정');
  }

  checkEnd() {
    if (this.phase !== 'fight' || this.result) return;
    if (this.inStep) return;
    const alive = this.fighters.filter(f => this.fighterAlive(f));
    if (this.fighters.length <= 2) {
      if (alive.length === 1) this.finish(alive[0], '격파');
      else if (alive.length === 0) {
        const [a, b] = this.fighters;
        if (Math.abs(a.deathAt - b.deathAt) < 0.001) this.finish(null, '무승부');
        else this.finish(a.deathAt > b.deathAt ? a : b, '끝까지 생존');
      }
    } else {
      if (alive.length === 1) this.finish(alive[0], '최후의 생존자');
      else if (alive.length === 0) {
        const sorted = this.fighters.slice().sort((x, y) => y.deathAt - x.deathAt);
        this.finish(sorted[0].deathAt === sorted[1].deathAt ? null : sorted[0], '동시 격파');
      }
    }
  }

  finish(winner, reason) {
    if (this.result) return;
    this.result = { winner, losers: this.fighters.filter(f => f !== winner), draw: !winner, reason };
    this.phase = 'ending'; this.endT = ENDING_TIME;
    if (winner) {
      addFx(this, { type: 'ring', x: winner.x, y: winner.y, r0: 20, r1: 160, color: winner.color, dur: 0.7 });
      sparks(this, winner.x, winner.y, 30, winner.color, 320);
    }
    this.shake = 12;
  }
}

/* ============================================================
 * 전투원 업데이트 함수들
 * ============================================================ */
function computeStats(f) {
  const t = f.b.simT;
  const ch = CHARACTERS[f.charId], wp = WEAPONS[f.weaponId];
  let atk = f.perm.atk, dmg = f.perm.dmg;
  // 공격속도(aspd) 하나로 통합했다. 근접은 무기 회전속도로, 원거리·지뢰는 발사 빈도로 쓰인다.
  let move = ch.move * f.perm.move, aspd = f.perm.aspd, size = f.perm.size;
  const T = f.timers, Fl = f.flags;
  if (Fl.warmup) atk *= 1 + 0.04 * Math.floor(t / 5);
  if (Fl.accelRot) aspd *= 1 + 0.10 * Math.floor(t / 5);
  if (Fl.speedster) move *= 1 + 0.06 * Math.floor(t / 5);
  if (Fl.rampage20 && t >= 20) { atk *= 1.2; move *= 1.2; aspd *= 1.2; }
  if (Fl.firstStrike && t < 10) atk *= 1.3;
  const hpRatio = clamp(f.hp / f.maxHp, 0, 1);
  if (Fl.berserker) atk *= 1 + Math.min(0.5, (1 - hpRatio) * 0.5);
  if (Fl.desperateSpin && hpRatio <= 0.3) aspd *= 1.5;
  if (Fl.escapeInstinct && hpRatio <= 0.3) move *= 1.4;
  atk *= 1 + 0.05 * f.warmStacks;
  aspd *= 1 + 0.06 * f.rotStacks;
  atk *= 1 + 0.03 * f.collisionStacks;
  dmg *= 1 + 0.03 * f.hitChargeStacks;
  if (T.chase > 0) move *= 1.2;
  if (T.elastic > 0) move *= 1.25;
  if (T.freeze > 0) { move *= 0.3; aspd *= 0.3; }
  if (f.frost.n > 0) move *= 1 - 0.1 * Math.min(3, f.frost.n);
  if (T.balloon > 0) size *= 1.6;
  if (T.atkBuff > 0) atk *= 1.3;
  if (T.spdBuff > 0) move *= 1.3;
  if (f.rocketActive) move = Math.max(move, ROCKET_SPEED);
  if (f.berserkPhase === 1) { atk *= 1.45; move *= 1.45; aspd *= 1.45; dmg *= 1.15; }
  if (f.berserkPhase === 2) { atk *= 0.72; move *= 0.72; aspd *= 0.72; dmg *= 0.85; }
  // 무기를 실제로 돌리는 경우에만 회전속도가 생긴다.
  // 근접은 항상, 권총은 '회전 난사' 스킬 중에만 돈다. 나머지 원거리는 상대를 조준한다.
  let rot = 0;
  // 쇠사슬도 연결부가 돌아간다. 검·단검과 같은 규칙으로 공격속도를 회전으로 받는다.
  if (wp.type === 'melee' || wp.type === 'chain') {
    // 근접은 조우가 짧아 회전이 조금 빨라져도 결국 한 번 스치고 끝난다.
    // 그래서 공격속도가 오른 만큼을 더 얹어 준다 (속사 하나 = 회전 +22.5%).
    // 반대로 느려지는 쪽(빙결·야만)은 그대로 둔다. 배로 깎으면 회전이 멈추거나 뒤집힌다.
    //
    // 배율은 2였는데 1.5로 낮췄다. 2에서는 속사를 겹칠수록 근접만 과하게 올라갔다 —
    // 속사 셋일 때 검 +25.8%p / 단검 +19.4%p 대 원거리 +15.4%p로 벌어졌다.
    // 1.5에서는 +18.3 / +16.8 대 +15.4로 거의 나란해진다. 아주 없애면(1) 반대로
    // 근접이 속사를 못 쓰는 무기가 된다 (+10.5 / +12.5).
    rot = wp.rot * (aspd > 1 ? 1 + (aspd - 1) * MELEE_ASPD_GAIN : aspd);
  }
  else if (f.weaponId === 'pistol' && T.gunBarrage > 0) rot = PISTOL_BARRAGE_ROT * aspd;
  if (Fl.speedPower) {
    const baseMove = ch.move * wp.moveMult;
    dmg *= 1 + Math.max(0, move / baseMove - 1) / 3;
  }
  // Split copies retain the full build, with one explicit global outgoing
  // attack penalty. st.dmg is used by weapons, projectiles and auto systems.
  dmg *= f.attackScale || 1;
  f.st = { atk, dmg, move, rot, fr: aspd, aspd, size };
  f.radius = 22 * size;
}

function updateTimers(b, f, dt) {
  if (f.dead) return;
  const T = f.timers;
  const prev = {
    actingDead: T.actingDead, fuse: T.fuse, det: T.det, dashPrep: T.dashPrep,
    gunBarrage: T.gunBarrage, balloon: T.balloon,
  };
  for (const k in T) if (T[k] > 0) T[k] = Math.max(0, T[k] - dt);
  if (T.gunBarrage < 1e-9) T.gunBarrage = 0;
  if (prev.actingDead > 0 && T.actingDead === 0 && !f.dead) { finalDeath(b, f); return; }
  // 왁뿌볼 폭주 페이즈
  if (f.berserkPhase === 1 && T.berserk <= 0) {
    f.berserkPhase = 2;
    battleSound(b, 'skill.rampage.end', f);
    popup(b, f.x, f.y - f.radius - 20, '추락…', '#ff8f8f');
  }
  if (prev.balloon > 0 && T.balloon === 0) battleSound(b, 'skill.balloon.deflate', f);
  // 출혈
  if (f.bleed.stacks.length > 0) {
    // 가해자마다 초침이 하나다. 매초 한 번, 그 가해자가 쌓은 중첩 수만큼 들어간다.
    // 중첩마다 따로 초침을 돌리면 쌓을수록 1 피해가 여기저기서 어긋나게 터진다.
    for (const st of f.bleed.stacks) {
      st.t -= dt;
      while (st.t <= 1e-9) {
        dealDamage(b, st.src, f, st.n, { kind: 'auto', autoType: 'bleed' });
        st.t += 1;
      }
    }
    f.bleed.n = f.bleed.stacks.reduce((sum, st) => sum + st.n, 0);
  }
  if (f.frost.n > 0) { f.frost.t -= dt; if (f.frost.t <= 0) f.frost.n = 0; }
  // 주기 회복/대가 및 조건부 회복
  if (f.flags.meditate) {
    f.cd.medT = Math.max(0, f.cd.medT - dt);
    if (f.cd.medT <= 0) {
      f.cd.medT = 5;
      healFighter(b, f, f.maxHp * 0.05);
    }
  }
  if (f.flags.bloodWeapon) {
    f.cd.bloodT = Math.max(0, f.cd.bloodT - dt);
    if (f.cd.bloodT <= 0 && f.hp > 0) {
      f.cd.bloodT = 5;
      f.hp = Math.max(0.01, f.hp * 0.95);
      resolveHealthThresholds(b, f);
      popup(b, f.x, f.y - f.radius - 18, '피의 대가', '#ff7d7d');
    }
  }
  // 폭탄 스킬
  if (prev.fuse > 0 && T.fuse === 0 && !f.mainDead && !f.dead) {
    explodeAt(b, f, f.x, f.y, 100, 26 * f.st.dmg, 'auto', false, 'skill.bomb.explode', 'char:bomb');
    popup(b, f.x, f.y - f.radius - 24, '시한폭발!', '#ffb14d', true);
  }
  // 지뢰 원격 폭파
  if (prev.det > 0 && T.det === 0 && !f.mainDead && !f.dead) {
    const own = b.mines.filter(m => m.owner === f);
    for (const m of own) explodeMine(b, m, 1.5, 18, 'skill:mine');
    b.mines = b.mines.filter(m => m.owner !== f);
    if (own.length) popup(b, f.x, f.y - f.radius - 24, '원격 폭파!', '#ffb14d', true);
  }
  if (prev.gunBarrage > 0 && T.gunBarrage === 0 && f.gun) {
    f.gun.focus = false;
    f.gun.burst = 0;
    f.gun.shotT = 0;
    f.gun.reloadT = WEAPONS.pistol.reload;
    battleSound(b, 'weapon.pistol.reload', f);
  }
  // 단검 돌진 준비
  if (prev.dashPrep > 0 && T.dashPrep === 0 && f.dashPrepDir && !f.mainDead && !f.dead) {
    const nd = normDir(f.dashPrepDir.x, f.dashPrepDir.y);
    f.dash = { dx: nd.x, dy: nd.y, spd: 780, kind: 'dash' };
    T.dashT = 0.35 / GAME_SPEED; f.dashHit = new Set();
    battleSound(b, 'skill.dagger.dash', f);
    addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 8, r1: 60, color: '#8ef', dur: 0.3 });
  }
  // 활 차지
  if (f.charging) f.charging.t += dt;
  // 위치 기록 (되돌아가기)
  f.histT -= dt;
  if (f.histT <= 0) { f.histT = 0.1; f.hist.push({ x: f.x, y: f.y, t: b.simT }); if (f.hist.length > 26) f.hist.shift(); }
}

function moveFighter(b, f, dt) {
  if (f.mainDead || f.dead) return;
  if (f.timers.stun > 0) return;
  applySteering(f, dt);
  const px = f.x, py = f.y;
  const wasRocket = f.rocketActive;
  if (f.timers.dashPrep > 0) { /* 정지 */ }
  else if (f.timers.dashT > 0 && f.dash) {
    f.x += f.dash.dx * f.dash.spd * GAME_SPEED * dt;
    f.y += f.dash.dy * f.dash.spd * GAME_SPEED * dt;
  }
  else if (!(f.timers.bind > 0)) {
    // 경기 진행 속도는 여기처럼 '실제로 나아가는 자리'에서만 곱한다.
    // dt에 걸면 쿨타임·출혈 같은 초 단위 약속까지 늘어나 설명과 어긋나고,
    // st에 걸면 스탯판에 표시되는 숫자가 깎인다.
    f.x += (f.vx * f.st.move + (f.thrustX || 0)) * GAME_SPEED * dt;
    f.y += (f.vy * f.st.move + (f.thrustY || 0)) * GAME_SPEED * dt;
  }
  const n = b.arena.collideBody(f);
  // High-speed rocket movement can cross a body completely in one tick, so
  // use a swept segment instead of relying on overlap at the final position.
  if (wasRocket) rocketSweepHits(b, f, px, py, f.x, f.y);
  if (n > 0) {
    onWallBounce(b, f, n);
    if (f.timers.dashT > 0) { f.timers.dashT = 0; f.dash = null; }
  }
  // 돌진 경로 판정 (터널링 방지)
  if (f.timers.dashT > 0) {
    for (const e of b.enemiesOf(f)) {
      if (e.mainDead || e.dead) continue;
      if (f.dashHit.has(e.uid)) continue;
      if (segDist(e.x, e.y, px, py, f.x, f.y) < e.radius + f.radius) {
        f.dashHit.add(e.uid);
        if (f.dash.kind === 'dash') {
          weaponDamage(b, f, e, WEAPONS.dagger.dashDmg, 'skill:dagger');
        } else {
          dealDamage(b, f, e, 26 * f.st.dmg, { kind: 'auto', commentarySource: 'char:bball' });
        }
        addFx(b, { type: 'ring', x: e.x, y: e.y, r0: 10, r1: 80, color: '#ffd24d', dur: 0.3 });
        b.shake = Math.min(16, b.shake + 10);
      }
    }
  }
}

function rocketSweepHits(b, f, x0, y0, x1, y1) {
  for (const enemy of b.enemiesOf(f)) {
    for (const body of b.bodiesOf(enemy)) {
      if (f.rocketHits.has(body.uid)) continue;
      if (segDist(body.x, body.y, x0, y0, x1, y1) > f.radius + bodyRadius(body)) continue;
      f.rocketHits.add(body.uid);
      dealDamage(b, f, body, 24 * f.st.dmg, { kind: 'auto', commentarySource: 'augment:rocketStart' });
      addFx(b, { type: 'ring', x: body.x, y: body.y, r0: 8, r1: 70, color: '#8ed8ff', dur: 0.3 });
      popup(b, body.x, body.y - bodyRadius(body) - 28, '로켓 관통!', '#8ed8ff', true);
    }
  }
}

function resolveFighterCollision(b, a, c) {
  if (!a || !c || a.dead || c.dead || teamOwner(a) === teamOwner(c)) return false;
  const dx = c.x - a.x, dy = c.y - a.y;
  const d = Math.hypot(dx, dy), rr = bodyRadius(a) + bodyRadius(c);
  if (d >= rr) return false;
  const nx = d > 0 ? dx / d : 1, ny = d > 0 ? dy / d : 0;
  const ov = rr - d;

  // Rocket bodies emerge on the far side and retain their heading/speed.
  if (a.rocketActive && !c.rocketActive) {
    a.x = c.x + a.vx * (rr + 2); a.y = c.y + a.vy * (rr + 2);
  } else if (c.rocketActive && !a.rocketActive) {
    c.x = a.x + c.vx * (rr + 2); c.y = a.y + c.vy * (rr + 2);
  } else if (a.rocketActive && c.rocketActive) {
    const ax = a.x, ay = a.y; a.x = c.x; a.y = c.y; c.x = ax; c.y = ay;
  } else {
    a.x -= nx * ov / 2; a.y -= ny * ov / 2;
    c.x += nx * ov / 2; c.y += ny * ov / 2;
    const p = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
    if (p > 0) {
      a.vx -= p * nx; a.vy -= p * ny; c.vx += p * nx; c.vy += p * ny;
      const n1 = normDir(a.vx, a.vy); a.vx = n1.x; a.vy = n1.y;
      const n2 = normDir(c.vx, c.vy); c.vx = n2.x; c.vy = n2.y;
    }
  }
  registerBodyCollision(b, a, c);
  tryStatic(b, a, c); tryStatic(b, c, a);
  tryDashHit(b, a, c); tryDashHit(b, c, a);
  return true;
}

function onWallBounce(b, f, n) {
  f.bounceTotal += n;
  f._wallT = b.simT;
  if (f.steer) f.steer.lock = Math.max(f.steer.lock || 0, STEER_BOUNCE_LOCK);
  battleSound(b, 'battle.bounce', f, 0.055);
  if (f.flags.elastic) f.timers.elastic = 1;
  if (f.rocketActive) {
    f.rocketActive = false;
    popup(b, f.x, f.y - f.radius - 20, '로켓 종료', '#8ed8ff');
  }
  if (f.flags.wallClimb) healFighter(b, f, f.maxHp * 0.01, true);
  if (f.flags.shockwave) { battleSound(b, 'augment.shockwave', f); explodeAt(b, f, f.x, f.y, SHOCKWAVE_R, 7 * f.st.dmg, 'auto', true, undefined, 'augment:shockwave'); }
  if (f.flags.reflectCharge) {
    f.bounceRun += n;
    if (f.bounceRun >= 3 && !f.charged) { f.charged = true; f.bounceRun = 0; battleSound(b, 'augment.reflect', f); addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 6, r1: 44, color: '#ffe08a', dur: 0.3 }); }
  }
  while (f.flags.lightning && f.bounceTotal >= f.lightningNext) {
    spawnBolt(b, f);
    f.lightningNext += 3;
  }
  if (f.tracking) {
    f.tracking.bounces += n;
    if (f.tracking.bounces >= 3) {
      const e = b.nearestEnemyMain(f);
      f.tracking = null;
      if (e) {
        const nd = normDir(e.x - f.x, e.y - f.y);
        f.dash = { dx: nd.x, dy: nd.y, spd: 690, kind: 'rush' };
        f.timers.dashT = 0.55 / GAME_SPEED; f.dashHit = new Set();
        battleSound(b, 'skill.basketball.rush', f);
        popup(b, f.x, f.y - f.radius - 24, '3바운드!', '#ffd24d', true);
        addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 10, r1: 70, color: '#ffd24d', dur: 0.35 });
      }
    }
  }
}

function tryStatic(b, a, c) {
  if (!a.flags.staticShock || a.staticCd > 0) return;
  if (c.mainDead || c.dead) return;
  a.staticCd = 0.6;
  battleSound(b, 'augment.static', a);
  let dmg = 5 * a.st.dmg;
  if (a.flags.staticUp) dmg *= 1.6;
  if (a.flags.staticFast) dmg *= 0.55 + a.st.move / 320;
  dealDamage(b, a, c, dmg, { kind: 'auto', commentarySource: 'augment:staticShock' });
  boltFx(b, a.x, a.y, c.x, c.y);
}

function registerBodyCollision(b, a, c) {
  for (const [self, other] of [[a, c], [c, a]]) {
    if (self.collisionCd <= 0) {
      self.collisionCd = 0.25;
      if (self.flags.collisionMania) {
        self.collisionStacks++;
        popup(b, self.x, self.y - self.radius - 18, `충돌광 ${self.collisionStacks}`, '#ffd24d');
      }
    }
    if (self.rocketActive && !self.rocketHits.has(other.uid)) {
      self.rocketHits.add(other.uid);
      dealDamage(b, self, other, 24 * self.st.dmg, { kind: 'auto', commentarySource: 'augment:rocketStart' });
      addFx(b, { type: 'ring', x: other.x, y: other.y, r0: 8, r1: 70, color: '#8ed8ff', dur: 0.3 });
      popup(b, other.x, other.y - other.radius - 28, '로켓 관통!', '#8ed8ff', true);
    }
  }
}

function tryDashHit(b, a, c) {
  if (a.timers.dashT <= 0 || !a.dashHit || a.dashHit.has(c.uid)) return;
  if (a.dash.kind === 'dash') { weaponDamage(b, a, c, WEAPONS.dagger.dashDmg, 'skill:dagger'); }
  else dealDamage(b, a, c, 26 * a.st.dmg, { kind: 'auto', commentarySource: 'char:bball' });
  a.dashHit.add(c.uid);
  b.shake = Math.min(16, b.shake + 10);
}

function nearestBodyFrom(b, m) {
  let best = null, bd = 1e9;
  for (const e of b.enemiesOf(m.owner)) {
    for (const body of b.bodiesOf(e)) {
      const d = dist(m.x, m.y, body.x, body.y);
      if (d < bd) { bd = d; best = body; }
    }
  }
  return best;
}

/* ---------------- 무기 ---------------- */
function weaponScale(f) { return (f.timers.balloon > 0 ? 1.6 : 1) * (f.flags.giantBlade ? 1.5 : 1); }
function weaponSegment(f) {
  const wp = WEAPONS[f.weaponId];
  const ws = weaponScale(f);
  const tipDist = f.radius + wp.reach * ws;
  return {
    ax: f.x + Math.cos(f.weaponAngle) * f.radius * 0.4,
    ay: f.y + Math.sin(f.weaponAngle) * f.radius * 0.4,
    bx: f.x + Math.cos(f.weaponAngle) * tipDist,
    by: f.y + Math.sin(f.weaponAngle) * tipDist,
    tipR: wp.tip * ws,
  };
}

/* 무기 스킬 쿨타임. 값이 없는 무기(화염방사기·방패처럼 연료나 회수가
 * 제한인 무기)는 0이라 곧바로 다시 쓸 수 있다. */
function weaponSkillCd(f) {
  // 방패는 주워야 다시 던지므로 쿨타임이 없다. 자기 방패만 던질 때 불러오기 쿨타임이 돈다.
  if (f.weaponId === 'shield') return f.flags && f.flags.discMagnet ? WEAPONS.shield.recallCd : 0;
  return (typeof WEAPON_SKILL_CD !== 'undefined' && WEAPON_SKILL_CD[f.weaponId]) || 0;
}

/* 쿨타임을 걸 때는 버튼이 보는 값도 같은 자리에서 세운다.
 * 따로 두었더니 활의 자동 발사 경로에서 한쪽만 갱신돼, 그 틱의 스냅샷이
 * 서버와 클라이언트에서 다르게 보였다. */
function startWeaponCd(f) {
  f.skillUses.cd = weaponSkillCd(f);
  f.skillUses.weapon = f.skillUses.cd > 0 ? 0 : 1;
}

function updateCooldowns(b, f, dt) {
  if (f.disc) updateDisc(b, f, dt);
  f.gripT = Math.max(0, (f.gripT || 0) - dt);
  f.skillUses.cd = Math.max(0, (f.skillUses.cd || 0) - dt);
  // 버튼과 파리티가 같은 값을 보게 쿨타임을 그대로 비춰 둔다.
  f.skillUses.weapon = f.skillUses.cd > 0 ? 0 : 1;
  f.staticCd = Math.max(0, f.staticCd - dt);
  f.collisionCd = Math.max(0, f.collisionCd - dt);
  f.flash = Math.max(0, f.flash - dt);
  f.gunFlash = Math.max(0, (f.gunFlash || 0) - dt);
}

function updateWeapon(b, f, dt) {
  if (f.mainDead || f.dead) { f.meleeContact.clear(); return; }
  const wp = WEAPONS[f.weaponId];
  /* 쇠사슬은 무기를 돌리지 않는다. 추가 물리로 따라오고, 그 방향이 곧 무기 각도다.
   * 기절 중에도 줄은 계속 굴려야 한다 — 굳혀 두면 공만 움직여 줄이 늘어나고,
   * 풀리는 순간 구속이 추를 한 프레임에 되감아 말도 안 되는 속도가 나온다.
   * 기절 중 피해는 아래 판정에서 따로 막는다. */
  if (wp.type === 'chain') { updateChain(b, f, dt); return; }
  if (f.timers.stun > 0) { f.meleeContact.clear(); return; }
  const fr = f.st.fr;
  const meleeSource = f.spinRemaining > 0 && f.weaponId === 'sword' ? 'skill:sword' : undefined;
  // 화염방사기도 돌지 않는다. 조향 방향이 곧 무기 각도다.
  if (wp.type === 'cone') { updateFlame(b, f, dt); return; }
  // 회전하거나(근접·회전 난사) 상대를 조준하거나(그 외 원거리·지뢰) 둘 중 하나다.
  if (f.timers.weaponLock <= 0) {
    let applied;
    if (f.charging) {
      // 차지 샷은 자동 조준을 끄고 천천히 돈다. 두 바퀴 도는 동안 직접 노려서 쏜다.
      applied = BOW_CHARGE_ROT * dt;
      f.charging.spin += applied;
    } else if (f.spinRemaining > 0) {
      applied = Math.min(f.spinRemaining, TAU / 0.5 * GAME_SPEED * dt);
      f.spinRemaining = Math.max(0, f.spinRemaining - applied);
    } else {
      applied = f.st.rot * GAME_SPEED * dt;
    }
    if (applied === 0) {
      // 표창처럼 상대의 현재 위치를 그대로 겨눈다
      const target = b.nearestEnemyBody(f) || b.nearestEnemyMain(f);
      if (target) f.weaponAngle = Math.atan2(target.y - f.y, target.x - f.x);
    }
    f.weaponAngle = (f.weaponAngle + applied) % TAU;
    if (f.flags.swordBeam) {
      f.spinAcc += Math.abs(applied);
      // 딱 한 바퀴에서 끊길 때 부동소수점 오차로 마지막 검기가 통째로 빠졌다.
      // (믹서기는 정확히 두 바퀴인데 누적이 TAU에 1e-15만큼 못 미쳐 한 번만 나갔다.)
      if (f.spinAcc >= TAU - 1e-9) {
        f.spinAcc -= TAU;
        const nd = normDir(f.vx, f.vy);
        spawnProj(b, f, { kind: 'beam', x: f.x + nd.x * f.radius, y: f.y + nd.y * f.radius, ang: Math.atan2(nd.y, nd.x), spd: 430, dmg: 15, r: 12, life: 1.6, pierce: true, weapon: true });
        addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 10, r1: 50, color: '#9fd0ff', dur: 0.25 });
      }
    }
  }
  // 두 바퀴를 다 돌 때까지 안 쏘면 그 자리에서 자동으로 나간다 (사용 횟수는 그대로 소비)
  if (f.charging && f.charging.spin >= TAU * BOW_CHARGE_TURNS) {
    if (releaseCharge(b, f)) startWeaponCd(f);
  }
  if (f.timers.weaponLock > 0 || f.charging) {
    // 무기 정지/충전 중에는 발사 없음 (회전만)
    if (f.timers.weaponLock <= 0 && wp.type === 'melee') meleeHits(b, f, dt, undefined, meleeSource);
    else f.meleeContact.clear();
    return;
  }
  if (wp.type === 'melee') {
    // 방패는 던져 둔 동안 근접 판정이 없다 — 무기가 손에 없다.
    if (f.weaponId === 'shield' && f.disc) f.meleeContact.clear();
    else meleeHits(b, f, dt, undefined, meleeSource);
  } else if (f.weaponId === 'bow') {
    f.cd.fire -= dt * fr;
    if (f.cd.fire <= 0) { f.cd.fire = wp.interval; fireBow(b, f); }
  } else if (f.weaponId === 'pistol') {
    const g = f.gun;
    if (!(f.flags.bayonet && g.reloadT > 0)) f.meleeContact.clear();
    if (f.timers.gunBarrage > 0) {
      g.focus = true;
      g.reloadT = 0;
      g.shotT -= dt * fr;
      while (g.shotT <= 0) {
        fireGun(b, f);
        g.shotT += wp.shotGap;
      }
    } else if (g.reloadT > 0) {
      g.reloadT -= dt * fr;
      if (g.reloadT <= 0) { g.burst = g.mag; g.shotT = 0.35; }
      if (f.flags.bayonet) meleeHits(b, f, dt, { reach: 30, tip: 9, dmg: 15 });
    } else if (g.shotT > 0) {
      g.shotT -= dt * fr;
      if (g.shotT <= 0) {
        if (f.flags.shotgun) {
          fireShotgun(b, f, g.burst);
          g.burst = 0;
          g.reloadT = wp.reload; g.focus = false;
          battleSound(b, 'weapon.pistol.reload', f);
        } else {
          fireGun(b, f);
          g.burst--;
          if (g.burst <= 0) { g.reloadT = wp.reload; g.focus = false; battleSound(b, 'weapon.pistol.reload', f); }
          else g.shotT = wp.shotGap;
        }
      }
    }
  } else if (f.weaponId === 'staff') {
    f.cd.fire -= dt * fr;
    if (f.cd.fire <= 0) { f.cd.fire = wp.interval; fireStaff(b, f); }
  } else if (f.weaponId === 'mine') {
    f.cd.mine -= dt * fr;
    if (f.cd.mine <= 0) {
      f.cd.mine = wp.interval;
      const big = f.flags.bigMine;
      const balloon = f.timers.balloon > 0 ? 1.6 : 1;
      const mineSize = balloon * (big ? 1.35 : 1);
      b.mines.push({
        uid: ++UID, owner: f, x: f.x, y: f.y, arm: 0.7, t: 0,
        r: 11 * mineSize,
        trig: (big ? 40 : wp.triggerR) * balloon,
        blast: (big ? 88 : wp.blastR) * balloon,
        dmg: wp.dmg,
        // 회복 지뢰는 공 한가운데에 깔려서 깔자마자 자기가 밟는다.
        // 팽창까지 겹치면 0.7초 장전 동안 반경을 못 벗어난다.
        // 방패와 같은 방식 — 한 번 벗어나야 주인에게 반응한다.
        selfArmed: false,
      });
      battleSound(b, 'weapon.mine.place', f);
    }
  }
}

/* 근접 무기는 시간 쿨다운이 아니라 접촉 상태로 재타격을 막는다.
 * 칼날 판정에 새로 들어온 순간에만 1회 피해를 주고, 칼날에서 완전히
 * 벗어났다가 다시 닿아야 다음 타격이 나간다. 칼날마다 따로 추적하므로
 * 쌍단검은 각 칼날이 독립적으로 한 번씩 맞힌다. */
/* ═══════════ 방패 ═══════════
 *
 * 평소엔 검처럼 돌다가 던지면 날아가고, 주울 때까지 무기가 없다.
 * 던지고 쫓아가서 줍는 순환이 이 무기의 전부다.
 *
 * 횟수 제한을 두지 않는다 — 주워야만 다시 던질 수 있으니 회수가 곧 제한이다. */
function throwDisc(b, f) {
  if (f.disc) return false;                       // 이미 던져 두었다
  const wp = WEAPONS.shield;
  const a = f.weaponAngle;
  const ws = weaponScale(f);
  f.disc = {
    x: f.x + Math.cos(a) * (f.radius + 12), y: f.y + Math.sin(a) * (f.radius + 12),
    vx: Math.cos(a), vy: Math.sin(a), spd: wp.throwSpd,
    r: wp.discR * ws, owner: f, bounces: 0, contact: new Set(), resting: false,
    // 던진 자리가 이미 회수 반경 안이라, 한 번 벗어나기 전에는 주울 수 없다.
    // 이게 없으면 던지는 즉시 도로 주워져 무기가 아예 손을 떠나지 않는다.
    armed: false,
  };
  battleSound(b, 'weapon.shield.throw', f);
  addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 8, r1: 44, color: '#8fe3d0', dur: 0.25 });
  return true;
}

/* 자기 방패 — 쿨타임이 끝난 뒤 스킬을 누르면 던져 둔 방패가 주인에게 날아온다. */
function recallDisc(b, f) {
  const d = f.disc;
  if (!d || d.returning) return false;
  d.returning = true; d.resting = false; d.armed = true;
  d.hitSet = new Set();
  battleSound(b, 'weapon.shield.throw', d);
  addFx(b, { type: 'ring', x: d.x, y: d.y, r0: 6, r1: 36, color: '#8fe3d0', dur: 0.25 });
  return true;
}

function catchDisc(b, f) {
  f.disc = null;
  if (f.flags.discGrip) f.gripT = 5;
  // 자기 방패 — 손에 들어오면 쿨타임이 바로 풀려 곧장 다시 던질 수 있다
  if (f.flags.discMagnet) { f.skillUses.cd = 0; f.skillUses.weapon = 1; }
  battleSound(b, 'weapon.shield.catch', f);
  addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 6, r1: 40, color: '#8fe3d0', dur: 0.3 });
}

function updateDisc(b, f, dt) {
  const d = f.disc;
  if (!d) return;
  const wp = WEAPONS.shield;
  if (d.returning) {
    /* 불러온 방패는 주인에게 곧장 날아온다. 튕기지 않고 길목의 적을 관통하며
     * 한 번씩만 때린다. 경기장은 볼록해서 방패→주인 직선은 늘 경기장 안이다. */
    const gx = f.x - d.x, gy = f.y - d.y, far = Math.hypot(gx, gy);
    if (far > 1e-6) { d.vx = gx / far; d.vy = gy / far; }
    d.spd = wp.recallSpd;
    const step = Math.min(far, wp.recallSpd * GAME_SPEED * dt);
    d.x += d.vx * step; d.y += d.vy * step;
    const mult = f.flags.discRicochet ? 1 + 0.25 * Math.min(3, d.bounces) : 1;
    for (const e of b.enemiesOf(f)) {
      for (const body of b.bodiesOf(e)) {
        if (d.hitSet.has(body.uid) || dist(d.x, d.y, body.x, body.y) > d.r + bodyRadius(body)) continue;
        d.hitSet.add(body.uid);
        if (weaponDamage(b, f, body, wp.throwDmg * mult, undefined, { projectile: true, wallAssist: false }) > 0) {
          battleSound(b, 'weapon.shield.hit', body, 0.05);
          sparks(b, d.x, d.y, 4, '#b7ffe9', 110);
        }
      }
    }
    if (dist(f.x, f.y, d.x, d.y) < f.radius + d.r + wp.pickupPad) catchDisc(b, f);
    return;
  }
  if (!d.resting) {
    d.spd *= Math.pow(wp.decel, dt);              // 초당 x0.82
    d.x += d.vx * d.spd * GAME_SPEED * dt;
    d.y += d.vy * d.spd * GAME_SPEED * dt;
    if (b.arena.reflectProj(d)) {
      d.bounces++;
      // 벽에 튕기면 방향이 바뀐다 — 붙어 있던 상대도 새로 맞을 수 있다.
      d.contact.clear();
      battleSound(b, 'weapon.shield.bounce', d, 0.08);
      sparks(b, d.x, d.y, 3, '#b7ffe9', 90);
    }
    if (d.spd < wp.restSpd) { d.resting = true; d.spd = 0; }
    /* 적중 — 관통하지 않고 맞은 상대에게서 튕겨 나온다. 벽과 똑같이.
     * 재타격은 시간이 아니라 접촉 상태로 막는다: 판정에 새로 들어온 순간에만
     * 한 대, 완전히 벗어났다 다시 닿아야 다음 한 대다. */
    const mult = f.flags.discRicochet ? 1 + 0.25 * Math.min(3, d.bounces) : 1;
    const contact = new Set();
    for (const e of b.enemiesOf(f)) {
      for (const body of b.bodiesOf(e)) {
        const br = bodyRadius(body);
        let nx = d.x - body.x, ny = d.y - body.y;
        const gap = Math.hypot(nx, ny);
        if (gap > d.r + br) continue;
        contact.add(body.uid);
        if (!d.contact.has(body.uid)) {
          if (weaponDamage(b, f, body, wp.throwDmg * mult, undefined, { projectile: true, wallAssist: d.bounces > 0 }) > 0) {
            battleSound(b, 'weapon.shield.hit', body, 0.05);
          }
        }
        /* 튕김. 상대도 움직이므로 '상대 기준 속도'를 표면 법선에 대해 뒤집는다 —
         * 달려오는 공에 맞으면 더 세게, 도망가는 공에 맞으면 덜 튕긴다.
         * 이미 멀어지는 중이면 뒤집지 않는다(겹친 채 다시 끌려 들어가지 않게).
         * 마지막에 겹친 만큼 밀어내서 몸에 박혀 떨지 않게 한다.
         *
         * 벽과 달리 몸에 부딪히면 법선 방향 속도를 일부 잃는다(hitBounce).
         * 다 돌려주면 벽에 붙은 상대와 벽 사이에 끼었을 때 탁구처럼 오가며
         * 초당 31대까지 맞았다. 부딪힐 때마다 잃으니 몇 번 만에 멈춘다. */
        if (gap < 1e-6) { nx = d.vx; ny = d.vy; } else { nx /= gap; ny /= gap; }
        const bv = bodyVel(body);
        const vx = d.vx * d.spd, vy = d.vy * d.spd;
        const rx = vx - bv.x, ry = vy - bv.y;
        const into = rx * nx + ry * ny;
        if (into < 0) {
          const k = 1 + wp.hitBounce;
          const ox = rx - k * into * nx + bv.x, oy = ry - k * into * ny + bv.y;
          // 막 던진 속도보다 빨라지지는 않는다 — 달려오는 공이 방패를 발사대로 쓰면 곤란하다
          const sp = Math.min(wp.throwSpd, Math.hypot(ox, oy));
          if (sp > 1e-6) { const h = Math.hypot(ox, oy); d.vx = ox / h; d.vy = oy / h; d.spd = sp; }
          sparks(b, d.x - nx * d.r, d.y - ny * d.r, 4, '#b7ffe9', 110);
        }
        const push = d.r + br - gap + 0.5;
        if (push > 0) { d.x += nx * push; d.y += ny * push; }
      }
    }
    d.contact = contact;
    // 몸에서 밀려난 자리가 벽 밖일 수 있다. 벽 반사는 방향만 뒤집고 자리를 되돌린다.
    b.arena.reflectProj(d);
  }
  // 회수 — 주인이 닿으면 다시 든다
  const reach = f.radius + d.r + wp.pickupPad;
  const away = dist(f.x, f.y, d.x, d.y);
  if (!d.armed) { if (away > reach) d.armed = true; return; }
  if (away < reach) catchDisc(b, f);
}

/* ═══════════ 화염방사기 ═══════════
 *
 * 이 게임에서 자동으로 공격하지 않는 유일한 무기다. 버튼을 누르고 있는
 * 동안만 조향 방향으로 원뿔을 뿜는다.
 *
 * 조준이 조향 조이스틱이라는 게 핵심이다 — 피할 것인가 맞힐 것인가를
 * 매 순간 고르게 된다. 조향은 초당 50도로 느리게 돌지만 조준은 즉시라,
 * '보는 곳'과 '가는 곳'이 갈린다. */
/* 조준이 향하려는 곳. 조이스틱을 놓고 있으면 그냥 가는 방향이다. */
function flameTarget(f) {
  return (f.steer && f.steer.active) ? f.steer.angle : Math.atan2(f.vy, f.vx);
}

/* 실제 조준은 목표를 향해 정해진 속도로 돌아간다.
 * 예전에는 조이스틱 각도를 그대로 썼다. 손가락이 떠는 대로 노즐이 떨고,
 * 조이스틱을 놓는 순간 진행 방향으로 뚝 끊겨 튀었다.
 * 공의 조향(초당 50도)보다는 훨씬 빠르게 둔다 — '보는 곳'과 '가는 곳'이
 * 갈리는 것이 이 무기의 정체성이라, 조준까지 느리면 무기가 죽는다. */
function flameAim(f, dt) {
  const st = f.flame;
  const target = flameTarget(f);
  if (st.aim == null || !Number.isFinite(st.aim)) { st.aim = target; return st.aim; }
  if (!(dt > 0)) return st.aim;
  let d = target - st.aim;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  const max = FLAME_AIM_RATE * dt;
  st.aim += Math.abs(d) <= max ? d : Math.sign(d) * max;
  while (st.aim > Math.PI) st.aim -= TAU;
  while (st.aim < -Math.PI) st.aim += TAU;
  return st.aim;
}

function updateFlame(b, f, dt) {
  const wp = WEAPONS.flame;
  const st = f.flame;
  const ws = weaponScale(f);
  const range = (f.flags.flamePressure ? 140 : wp.range) * ws;
  const halfArc = f.flags.flamePressure ? 0.26 : wp.halfArc;

  f.weaponAngle = flameAim(f, dt);   // 스냅샷의 a가 이 값을 그대로 나른다

  const blocked = f.timers.weaponLock > 0 || f.timers.stun > 0 || f.mainDead || f.dead;
  const firing = st.on && !blocked && st.fuel > 0;
  if (firing && !st.firing) battleSound(b, 'weapon.flame.ignite', f, 0.25);
  st.firing = !!firing;

  if (firing) {
    // 초 단위 약속이라 GAME_SPEED를 곱하지 않는다
    st.fuel = Math.max(0, st.fuel - wp.burnRate * dt);
    st.idle = 0;
    const aim = f.weaponAngle;
    // 역분사 — 조향 제한을 우회하는 유일한 기동이라 상한을 둔다
    if (f.flags.flameThrust) {
      const base = CHARACTERS[f.charId].move * wp.moveMult;
      const cap = base * 0.45;
      f.thrustX = (f.thrustX || 0) - Math.cos(aim) * 260 * dt;
      f.thrustY = (f.thrustY || 0) - Math.sin(aim) * 260 * dt;
      const ts = Math.hypot(f.thrustX, f.thrustY);
      if (ts > cap) { f.thrustX = f.thrustX / ts * cap; f.thrustY = f.thrustY / ts * cap; }
    }
    /* 불길 안의 상대는 tickT(0.5초)마다 tickDmg씩 맞는다. 간격은 공격속도와 상관없이
     * 고정이다 — 공격속도는 연료가 다시 차는 속도로만 들어간다. 대상마다 따로 재서
     * 불길에 막 들어온 상대는 바로 한 대 맞고, 버튼을 뗐다 눌러도 더 자주 맞지 않는다. */
    for (const e of b.enemiesOf(f)) {
      for (const body of b.bodiesOf(e)) {
        const d = dist(f.x, f.y, body.x, body.y);
        if (d > range + bodyRadius(body)) continue;
        const to = Math.atan2(body.y - f.y, body.x - f.x);
        if (Math.abs(angleDelta(aim, to)) > halfArc) continue;
        if (b.simT + 1e-6 < (f.flameHits.get(body.uid) || 0)) continue;   // 프레임 합의 부동소수 오차로 한 프레임 밀리지 않게
        f.flameHits.set(body.uid, b.simT + wp.tickT);
        dealDamage(b, f, body, wp.tickDmg * f.st.atk * f.st.dmg, { kind: 'weapon' });
      }
    }
    if (f.flameHits.size > 40) f.flameHits.clear();
    // 잔불 — 불길이 닿은 바닥에 남는다. 기존 화염 구조를 그대로 쓴다.
    if (f.flags.flameEmber) {
      f.cd.ember = (f.cd.ember || 0) - dt;
      if (f.cd.ember <= 0) {
        f.cd.ember = 0.18;
        const r = range * (0.45 + Math.random() * 0.5);
        const a = f.weaponAngle + rand(-halfArc, halfArc);
        b.flames.push({ owner: f, x: f.x + Math.cos(a) * r, y: f.y + Math.sin(a) * r,
          r: 16, life: 2, maxLife: 2, dps: 4 });
        if (b.flames.length > 60) b.flames.shift();
      }
    }
    battleSound(b, 'weapon.flame.spray', f, 0.22);
  } else {
    st.idle += dt;
    if (st.idle >= wp.refillDelay) {
      // 공격속도는 '다시 쏘기까지의 공백'으로 들어간다
      st.fuel = Math.min(wp.fuelMax, st.fuel + wp.refillRate * Math.max(0.2, f.st.aspd) * dt);
    }
  }
  // 추진력은 매 틱 줄어든다 (분사를 멈추면 서서히 원래 속도로)
  if (f.thrustX || f.thrustY) {
    const k = Math.max(0, 1 - 2.2 * dt);
    f.thrustX *= k; f.thrustY *= k;
    if (Math.hypot(f.thrustX, f.thrustY) < 0.5) { f.thrustX = 0; f.thrustY = 0; }
  }
}

/* ═══════════ 쇠사슬 ═══════════
 *
 * 추는 공과 별개의 물체다. 공이 방향을 꺾어도 추는 관성으로 계속 가고,
 * 그게 채찍이 된다. 벽 튕김이 가장 강한 채찍 발생기다.
 *
 * 공의 경로를 작은 시간 간격으로 따라가며 마디의 질량과 줄 구속을 계산한다.
 * 자동 유도 없이 조향과 벽 반사가 만든 운동량만으로 휘두른다. */
/* 몸통의 실제 속도. 전투원·분열체는 st.move, 소환수는 spd가 크기다. */
function bodyVel(body) {
  const s = body.st ? body.st.move : (body.spd || 0);
  return { x: (body.vx || 0) * s, y: (body.vy || 0) * s };
}

/* 표면에 매인 줄의 실제 길이. chainLen은 '공 가운데에서 추까지의 사거리'라는
 * 약속을 그대로 지키고, 표면에 매인 만큼(반지름) 줄을 짧게 둔다.
 * 안 그러면 표면으로 옮기는 것만으로 사거리가 반지름만큼(약 +24%) 늘어난다. */
function ropeLen(f) {
  return Math.max(chainLen(f) * 0.5, chainLen(f) - (f.radius || 0));
}

function chainLen(f) {
  const wp = WEAPONS.chain;
  return (f.flags.chainLong ? 130 : wp.chainLen) * weaponScale(f);
}

/* 줄은 마디로 이어진 밧줄이다. 공에서 추까지 CHAIN_SEGS등분한 점을
 * 각각 물리로 굴리고 마디 길이로 묶는다. 이래야 줄이 접히고 휜다 —
 * 공과 추를 직선으로 이으면 무슨 짓을 해도 막대기다. */
const CHAIN_SEGS = 5;
// 추가 낼 수 있는 속도의 상한(px/s, GAME_SPEED 곱하기 전). 순간이동 보정용이라
// 실제 휘두름(관측 상위 10%가 800 언저리)보다 넉넉히 위에 둔다.
const CHAIN_MAX_SPD = 2000;
// 추의 역질량. 1이면 마디와 같은 무게(끝이 채찍처럼 튄다), 작을수록 무겁다.
const CHAIN_HEAD_W = 0.25;
// 줄의 탄성. 마디가 제 길이를 넘은 만큼 당기는 세기와, 늘어나는 속도를 죽이는 세기.
// 최대 늘어남을 넘으면 그때만 딱 잡는다 (끊어질 듯 늘어나지 않게).
const CHAIN_SPRING = 5500;
const CHAIN_SPRING_DAMP = 8;
// 한계 근처에서 몇 배까지 뻣뻣해지나 (한계에서 1 + 이 값 배)
const CHAIN_SPRING_HARDEN = 4;
const CHAIN_MAX_STRETCH = 1.18;
// 튕길 때 법선 방향 속도를 얼마나 돌려주나 (1이면 그대로, 0이면 딱 멈춤).
// 거의 다 돌려준다 — 부딪히면 확실히 반대편으로 튀어 나가야 상대에 붙어 비비지 않는다.
const CHAIN_WALL_BOUNCE = 0.9;
const CHAIN_BODY_BOUNCE = 0.9;
// 맞힌 상대에게서 추가 이만큼(px) 떨어져야 같은 상대를 다시 맞힐 수 있다.
// 추 지름(20)보다 조금 더 — 8로는 튕겨 나가다 스친 것도 새로 부딪힌 것으로 쳐 연타가 남았다.
const CHAIN_REHIT_GAP = 24;
// 겹친 추를 한 서브스텝에 떼어 놓는 최대 거리(px)
const CHAIN_SHOVE_MAX = 3;
const CHAIN_ITERS = 8;
// 줄이 당긴 힘 중 추가 운동량으로 쌓는 몫. 1이면 채찍, 작을수록 묵직하다.
const CHAIN_INHERIT = 1;
/* 조이스틱이 추에 주는 힘(px/s², GAME_SPEED 곱하기 전). 조이스틱은 공을 조향하는
 * 동시에 추를 당긴 쪽으로 민다 — 스틱을 돌리면 추가 따라 돌고, 반대로 꺾으면 크게
 * 휘둘린다. 공격속도가 오르면 이 힘이 같은 배율로 세진다(연결부 회전 대신). */
const CHAIN_STEER_ACCEL = 600;
const CHAIN_STEP = 1 / 120;

/* 사슬은 공 가운데가 아니라 공 표면에 매여 있다. 매인 자리(attach)는 사슬
 * 회전속도로 표면을 따라 돈다 — 도는 공이 줄을 직접 끌고 가야 회전력이
 * 줄에 실린다. 가운데에 매면 공이 돌아도 줄에는 아무 힘이 안 간다. */
/* 매인 자리 각도는 -π..π로 감싼다 — 끝없이 커지면 소수점 정밀도와 전송 크기가 나빠진다. */
function wrapChainAngle(a) {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

function chainAttach(f, h, cx = f.x, cy = f.y) {
  const r = f.radius || 0, a = h.attach || 0;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

function ensureChainHeads(f) {
  const L = ropeLen(f);
  if (f.chainHeads.length !== 1) {
    const a = f.weaponAngle;
    const h = { attach: a, vx: 0, vy: 0 };
    const at = chainAttach(f, h);
    h.x = at.x + Math.cos(a) * L; h.y = at.y + Math.sin(a) * L;
    f.chainHeads = [h];
  }
  for (const h of f.chainHeads) {
    // 매인 자리가 없던 추(예전 상태)는 추가 있는 쪽 표면에 맨다
    if (!Number.isFinite(h.attach)) h.attach = Math.atan2(h.y - f.y, h.x - f.x);
    if (h.nodes && h.nodes.length === CHAIN_SEGS - 1) continue;
    // 마디는 매인 자리와 추 사이에 고르게 깐다. 추가 곧 마지막 마디다.
    const at = chainAttach(f, h);
    h.nodes = [];
    for (let i = 1; i < CHAIN_SEGS; i++) {
      const t = i / CHAIN_SEGS;
      h.nodes.push({ x: at.x + (h.x - at.x) * t, y: at.y + (h.y - at.y) * t, vx: 0, vy: 0 });
    }
  }
}

/* 줄을 공-추 직선 위에 다시 깔고 속도를 공에 맞춘다.
 * 공이 한 프레임에 순간이동했을 때(고양이 되돌아가기, 폭발 밀침, 위치 교환)
 * 쓴다. 그냥 두면 구속이 줄 전체를 한 프레임에 되감고, 그 변위가 그대로
 * 속도가 되어 추가 경기장을 가로질러 튕겨 나간다. */
function relayChain(f, h, velocity = bodyVel(f)) {
  const L = ropeLen(f);
  /* 다시 깔 때는 추를 향한 쪽 표면에 다시 맨다. 위치 교환 뒤에는 공과 추의
   * 자리가 뒤바뀌어 줄 방향이 반대가 된다 — 옛 각도를 두면 매인 자리가 공
   * 반대편에 가서 줄이 공을 관통하고, 교환한 추가 제자리에서 끌려 나간다. */
  if (Math.hypot(h.x - f.x, h.y - f.y) > 1e-6) h.attach = Math.atan2(h.y - f.y, h.x - f.x);
  else if (!Number.isFinite(h.attach)) h.attach = f.weaponAngle || 0;
  const at = chainAttach(f, h);
  let dx = h.x - at.x, dy = h.y - at.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = Math.cos(h.attach); dy = Math.sin(h.attach); d = 1; }
  if (d > L) { h.x = at.x + dx / d * L; h.y = at.y + dy / d * L; }
  const bvx = velocity.x, bvy = velocity.y;
  h.vx = bvx; h.vy = bvy;
  for (let i = 0; i < h.nodes.length; i++) {
    const t = (i + 1) / CHAIN_SEGS, n = h.nodes[i];
    n.x = at.x + (h.x - at.x) * t; n.y = at.y + (h.y - at.y) * t;
    n.vx = bvx; n.vy = bvy;
  }
  h._anchor = at;
}

/* 마디 사이 거리를 맞춘다. 줄은 늘어나지 않지만 줄어들 수는 있어서 접힌다.
 *
 * 무게가 여기서 나온다. 공은 고정점이고(무게 무한), 추는 마디보다 무겁다.
 * 당김을 나눌 때 가벼운 마디가 많이 움직이고 추는 조금만 움직인다 —
 * 줄이 먼저 접히고 추는 묵직하게 끌려온다.
 * 추를 마디와 같은 무게로 두면 당김이 전부 끝으로 몰려 채찍처럼 튄다. */
function solveChainRope(anchor, h, seg, arena) {
  const pts = h.nodes.concat(h), last = pts.length - 1;
  for (let it = 0; it < CHAIN_ITERS; it++) {
    // Bidirectional, mass-weighted constraints: no one-way teleport of the head.
    for (let pass = 0; pass < 2; pass++) for (let j = 0; j < pts.length; j++) {
      const i = pass ? last - j : j, q = pts[i], a = i ? pts[i - 1] : anchor;
      const wa = i ? 1 : 0, wb = i === last ? CHAIN_HEAD_W : 1;
      const dx = q.x - a.x, dy = q.y - a.y, d = Math.hypot(dx, dy);
      // 제 길이까지는 스프링(springChainRope)이 맡는다. 여기서는 끊어지듯
      // 늘어나지 않게 최대 늘어남만 막는다.
      const lim = seg * CHAIN_MAX_STRETCH;
      if (d <= lim || d < 1e-6) continue;
      const c = (d - lim) / (d * (wa + wb));
      if (wa) { a.x += dx * c * wa; a.y += dy * c * wa; }
      q.x -= dx * c * wb; q.y -= dy * c * wb;
    }
    // Wall and rope positions converge together. Projection never adds a second
    // bounce impulse; velocity is recovered once from the constrained travel.
    for (const q of pts) {
      const p = { x: q.x, y: q.y, r: q.r, vx: 0, vy: 0 };
      arena.reflectProj(p);
      // 추가 벽에 밀려난 방향과 양. 나중에 이걸로 튕겨 나갈 속도를 준다.
      if (q === h && h._wallPush) { h._wallPush.x += p.x - q.x; h._wallPush.y += p.y - q.y; }
      q.x = p.x; q.y = p.y;
    }
  }
}

/* 사슬 마디의 탄성. 제 길이보다 벌어진 만큼 서로 끌어당기는 힘을 속도에 준다.
 * 줄이 관성·원심력에 살짝 늘어났다가, 모은 속도로 되돌아오며 조금 지나쳐
 * 다시 펴진다 — 그게 탄력이다. 줄이라 짧아질 때는 밀어내지 않는다.
 * 위치를 곧장 제 길이로 되돌리던 예전 방식은 늘 같은 길이라 딱딱했다. */
function springChainRope(anchor, anchorV, h, seg, travelDt) {
  const pts = h.nodes.concat(h), last = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i], a = i ? pts[i - 1] : anchor;
    const dx = q.x - a.x, dy = q.y - a.y, d = Math.hypot(dx, dy);
    if (d <= seg || d < 1e-6) continue;
    const wa = i ? 1 : 0, wb = i === last ? CHAIN_HEAD_W : 1;
    const ux = dx / d, uy = dy / d;
    const avx = i ? a.vx : anchorV.x, avy = i ? a.vy : anchorV.y;
    const apart = (q.vx - avx) * ux + (q.vy - avy) * uy;   // + 이면 벌어지는 중
    /* 늘어날수록 뻣뻣해진다. 조금 늘어날 때는 부드럽게 튕기고, 한계에 가까워지면
     * 강하게 버틴다. 일정한 세기로 두면 공격속도가 높을 때 줄이 늘 한계에 붙어
     * 다시 딱딱해졌다 (공속 2배부터 1.18에 고정). */
    /* 스프링은 한계까지의 늘어남만 본다. 한계를 넘은 몫은 딱딱한 구속이 맡는다.
     * 제곱으로 뻣뻣해지는 항을 막지 않으면, 넉백 등으로 줄이 한계를 훨씬 넘은 채
     * 시작한 서브스텝에서 세기가 수천 배가 되어 속도가 백만 단위로 튀었다. */
    const room = seg * (CHAIN_MAX_STRETCH - 1), x = Math.min(d - seg, room);
    const stiff = CHAIN_SPRING * (1 + CHAIN_SPRING_HARDEN * (x / room) * (x / room));
    const pull = (stiff * x + CHAIN_SPRING_DAMP * apart) * travelDt / (wa + wb);
    if (wa) { a.vx += ux * pull * wa; a.vy += uy * pull * wa; }
    q.vx -= ux * pull * wb; q.vy -= uy * pull * wb;
  }
}

/* 추를 밀어낸다(상대 몸에 겹쳤을 때). 밀린 거리는 휘두른 것이 아니므로
 * 따로 모아 두었다가 추 속도를 잴 때 뺀다. 안 그러면 제자리에 놓인 추가 몸에서
 * 한 틱에 26px 밀려나는 것을 '빠르게 휘둘렀다'로 읽어 가만히 있는데도 때린다. */
function shoveChainHead(run, dx, dy) {
  run.h.x += dx; run.h.y += dy;
  run.pushX += dx; run.pushY += dy;
}

/* 밀어낸 자리가 벽 밖일 수 있다(벽은 줄 계산 안에서 이미 막았다). 자리만 되돌린다. */
function keepChainHeadInArena(arena, run) {
  const h = run.h, p = { x: h.x, y: h.y, r: h.r, vx: 0, vy: 0 };
  arena.reflectProj(p);
  shoveChainHead(run, p.x - h.x, p.y - h.y);
}

function updateChain(b, f, dt) {
  if (!(dt > 0)) return;
  const wp = WEAPONS.chain;
  ensureChainHeads(f);
  const L = chainLen(f), rope = ropeLen(f), ws = weaponScale(f), headR = wp.headR * ws;
  // 접힌 줄을 펴는 힘. 고정이다.
  const resp = wp.response;
  /* 조이스틱이 추를 미는 힘. 연결부가 저절로 돌지 않는다 — 추는 공의 움직임과
   * 조이스틱이 준 힘, 줄과 벽과 몸이 만드는 관성으로만 움직인다.
   * 공격속도(computeStats가 st.rot에 반영)는 이 힘의 배율이다. */
  const steer = f.steer && f.steer.active && !steeringBlocked(f) ? f.steer : null;
  const swing = ((f.st && f.st.rot) || wp.rot) / wp.rot;
  const pullX = steer ? Math.cos(steer.angle) * CHAIN_STEER_ACCEL * steer.magnitude * swing : 0;
  const pullY = steer ? Math.sin(steer.angle) * CHAIN_STEER_ACCEL * steer.magnitude * swing : 0;
  const base = wp.dmg, seg = rope / CHAIN_SEGS;
  const origin = f._chainAnchor || { x: f._motionX ?? f.x, y: f._motionY ?? f.y };
  const dxAnchor = f.x - origin.x, dyAnchor = f.y - origin.y;
  const teleported = Math.hypot(dxAnchor, dyAnchor) > Math.max(60, f.st.move * GAME_SPEED * dt * 3);
  const steps = Math.max(1, Math.min(48, Math.ceil(dt / CHAIN_STEP)));
  const subDt = dt / steps, travelDt = GAME_SPEED * subDt;
  const anchorV = { x: dxAnchor / (dt * GAME_SPEED), y: dyAnchor / (dt * GAME_SPEED) };
  const damp = Math.exp(-wp.drag * subDt);
  f._chainAnchor = { x: f.x, y: f.y };
  const heads = f.chainHeads;

  if (teleported) {
    for (const h of heads) { relayChain(f, h); h.sx = 0; h.sy = 0; h._sweep = []; h._touch = null; }
  } else {
    /* 추가 튕겨 나올 상대 몸. 실제로 움직인 거리로 속도를 잰다 — 기절·속박·대시가
     * 반영되고, 명목 이동속도로 잴 때처럼 멈춘 상대를 달리는 것으로 착각하지 않는다.
     * 속도 단위는 추와 같게(GAME_SPEED 곱하기 전) 맞춘다. */
    const bodies = [];
    for (const e of b.enemiesOf(f)) for (const body of b.bodiesOf(e)) {
      const bx = body._motionX ?? body.x, by = body._motionY ?? body.y;
      const v = Number.isFinite(body._motionX)
        ? { x: (body.x - bx) / (dt * GAME_SPEED), y: (body.y - by) / (dt * GAME_SPEED) }
        : body.timers?.stun > 0 || body.timers?.bind > 0 ? { x: 0, y: 0 } : bodyVel(body);
      bodies.push({ body, r: bodyRadius(body), bx, by, v });
    }
    const runs = heads.map(h => {
      const pts = h.nodes.concat(h);
      for (const q of pts) q.r = q === h ? headR : 3 * ws;
      h._sweep = [{ x: h.x, y: h.y, px: 0, py: 0 }];
      h._touch = new Map();
      return { h, pts, px: h.x, py: h.y, pushX: 0, pushY: 0 };
    });
    for (let step = 1; step <= steps; step++) {
      // Moving the anchor to its final position at the first substep would
      // create a fake whip impulse at low frame rates.
      const t = step / steps;
      const center = { x: origin.x + dxAnchor * t, y: origin.y + dyAnchor * t };
      const rim = f.radius || 0;
      for (const run of runs) {
        const h = run.h, pts = run.pts;
        /* 매인 자리는 줄이 나가는 쪽 표면으로 미끄러진다(고리처럼). 공이 돌지 않으니
         * 그 자리의 속도는 공의 이동뿐이다. 기준은 공 밖으로 처음 나온 마디다 —
         * 첫 마디만 보면 공을 가로질러 접힌 줄이 반대편에 매인 채 영영 안 펴졌다. */
        const out = pts.find(q => Math.hypot(q.x - center.x, q.y - center.y) > rim);
        if (out) h.attach = wrapChainAngle(Math.atan2(out.y - center.y, out.x - center.x));
        const anchor = chainAttach(f, h, center.x, center.y);
        const rimV = anchorV;
        if (steer) {
          /* 줄 바깥쪽으로 미는 몫은 줄이 느슨할 때만 준다. 느슨한 줄은 이 힘으로 펴지고
           * (공이 앞서 달려 추를 덮쳐도 다시 펼쳐진다), 이미 팽팽한 줄은 더 늘리지 않는다
           * — 늘 주면 스틱을 대고만 있어도 줄이 한계 가까이 늘어나 있었다.
           * 옆으로·안쪽으로 미는 몫은 그대로 둔다. 휘두름은 거기서 나온다. */
          const rx = h.x - center.x, ry = h.y - center.y, rl = Math.hypot(rx, ry);
          let px = pullX, py = pullY;
          const along = rl > 1e-6 ? (px * rx + py * ry) / rl : 0;
          if (along > 0 && Math.hypot(h.x - anchor.x, h.y - anchor.y) >= rope) { px -= rx / rl * along; py -= ry / rl * along; }
          h.vx += px * subDt; h.vy += py * subDt;
        }
        const dx = h.x - anchor.x, dy = h.y - anchor.y, d = Math.hypot(dx, dy);
        if (d < rope) {
          // A fully folded rope opens in its own last direction, never toward an
          // enemy. Turning and wall rebounds remain the only source of aiming.
          const a = d > 1 ? Math.atan2(dy, dx) : (h._unfoldAngle ?? f.weaponAngle);
          const k = (rope - d) * resp * subDt;
          h.vx += Math.cos(a) * k; h.vy += Math.sin(a) * k;
        }
        if (d > headR) h._unfoldAngle = Math.atan2(dy, dx);
        springChainRope(anchor, rimV, h, seg, travelDt);
        for (const q of pts) {
          q.vx *= damp; q.vy *= damp;
          q.x += q.vx * travelDt; q.y += q.vy * travelDt;
        }
        const into = { x: h.vx, y: h.vy };        // 벽으로 들어가던 속도 (튕김 계산용)
        const free = pts.map(q => ({ x: q.x, y: q.y }));
        h._wallPush = { x: 0, y: 0 };
        solveChainRope(anchor, h, seg, b.arena);
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i];
          q.vx += (q.x - free[i].x) / travelDt * CHAIN_INHERIT;
          q.vy += (q.y - free[i].y) / travelDt * CHAIN_INHERIT;
          const speed = Math.hypot(q.vx, q.vy);
          if (speed > CHAIN_MAX_SPD) { q.vx *= CHAIN_MAX_SPD / speed; q.vy *= CHAIN_MAX_SPD / speed; }
        }
        /* 벽 튕김. 벽 안으로 밀어 넣기만 하면 벽 쪽 속도가 사라져 추가 벽을 타고
         * 미끄러졌다. 들어가던 속도를 벽 법선에 대해 뒤집어(일부 잃고) 돌려준다. */
        const wl = Math.hypot(h._wallPush.x, h._wallPush.y);
        if (wl > 1e-6) {
          const nx = h._wallPush.x / wl, ny = h._wallPush.y / wl;   // 벽에서 안쪽 방향
          const hit = into.x * nx + into.y * ny;
          if (hit < 0) {
            const now = h.vx * nx + h.vy * ny, want = -hit * CHAIN_WALL_BOUNCE;
            h.vx += nx * (want - now); h.vy += ny * (want - now);
            /* 벽 강타 — 세게(피해 관문 이상) 부딪힌 자리에 충격파. 벽을 긁고 지나갈 때
             * 매 서브스텝 터지지 않게 같은 추는 quakeCd 동안 다시 터지지 않는다.
             * 기절·무기 잠금 중에는 무기 피해가 없으므로 충격파도 없다. */
            if (f.flags.chainQuake && -hit * GAME_SPEED >= wp.gate && b.simT >= (h._quakeUntil || 0)
              && !(f.timers.weaponLock > 0) && !(f.timers.stun > 0)) {
              h._quakeUntil = b.simT + wp.quakeCd;
              battleSound(b, 'augment.shockwave', h, 0.08);
              explodeAt(b, f, h.x - nx * h.r, h.y - ny * h.r, wp.quakeR * ws, wp.quakeDmg * f.st.dmg,
                'auto', true, undefined, 'augment:chainQuake');
            }
          }
        }
        h._wallPush = null;
        /* 상대 몸에 튕김. 관통하지 않는다 — 상대 기준 속도를 표면 법선에 대해 뒤집고
         * 겹친 만큼 밀어낸다. 달려오는 상대에 맞으면 더 세게 튕긴다. 맞은 순간의
         * 상대 속도를 기록해 두었다가 피해 판정(관문)에 쓴다. */
        for (const o of bodies) {
          const ox = o.bx + (o.body.x - o.bx) * t, oy = o.by + (o.body.y - o.by) * t;
          const ddx = h.x - ox, ddy = h.y - oy, dist = Math.hypot(ddx, ddy), min = headR + o.r;
          if (dist >= min) continue;
          const nx = dist > 1e-6 ? ddx / dist : 1, ny = dist > 1e-6 ? ddy / dist : 0;
          const rx = h.vx - o.v.x, ry = h.vy - o.v.y, vn = rx * nx + ry * ny;
          if (vn < 0) {
            const speed = Math.hypot(rx, ry) * GAME_SPEED;
            h._touch.set(o.body.uid, Math.max(h._touch.get(o.body.uid) || 0, speed));
            h.vx = rx - (1 + CHAIN_BODY_BOUNCE) * vn * nx + o.v.x;
            h.vy = ry - (1 + CHAIN_BODY_BOUNCE) * vn * ny + o.v.y;
          }
          // 한 번에 조금씩만 떼어 놓는다. 깊이 겹친 채 한 번에 밀어내면 줄 길이를
          // 넘어가 줄이 추를 되감으며 속도 상한으로 튕겨 버린다.
          const push = Math.min(min - dist + 0.3, CHAIN_SHOVE_MAX);
          shoveChainHead(run, nx * push, ny * push);
          keepChainHeadInArena(b.arena, run);
        }
      }
      for (const run of runs) run.h._sweep.push({ x: run.h.x, y: run.h.y, px: run.pushX, py: run.pushY });
    }
    for (const run of runs) {
      // 밀린 거리는 빼고 잰다 — 휘두른 속도만 남긴다
      run.h.sx = (run.h.x - run.px - run.pushX) / dt; run.h.sy = (run.h.y - run.py - run.pushY) / dt;
      run.h._anchor = chainAttach(f, run.h);
    }
  }
  const h0 = heads[0];
  f.weaponAngle = Math.atan2(h0.y - f.y, h0.x - f.x);
  if (f.timers.weaponLock > 0 || f.timers.stun > 0) return;
  // 휘두르는 소리는 내지 않는다. 계속 도는 무기라 상시 휙휙 소리가 과했다 — 맞을 때만 소리 낸다.

  /* 재타격은 시간(hitLock)과 접촉 둘 다로 막는다. 맞힌 상대에게서 추가 완전히
   * 떨어졌다가 다시 부딪혀야 다음 한 대다 — 스틱이 추를 상대 쪽으로 계속 미는 동안
   * 붙어서 잠금이 풀릴 때마다 또 맞는 일이 없게. 던진 방패와 같은 규칙이다. */
  const held = f.chainHeld || (f.chainHeld = new Set());
  for (const e of b.enemiesOf(f)) for (const body of b.bodiesOf(e)) {
    const br = bodyRadius(body);
    if (held.has(body.uid)) {
      if (heads.some(h => Math.hypot(h.x - body.x, h.y - body.y) < headR + br + CHAIN_REHIT_GAP)) continue;
      held.delete(body.uid);
    }
    if (b.simT < (f.chainHits.get(body.uid) || 0)) continue;
    const bx = body._motionX ?? body.x, by = body._motionY ?? body.y;
    // Real displacement includes stun/bind/dash, unlike the nominal move stat.
    const bv = Number.isFinite(body._motionX)
      ? { x: (body.x - bx) / dt, y: (body.y - by) / dt }
      : body.timers?.stun > 0 || body.timers?.bind > 0 ? { x: 0, y: 0 }
      : { x: bodyVel(body).x * GAME_SPEED, y: bodyVel(body).y * GAME_SPEED };
    let hitDmg = 0;
    for (const h of heads) {
      // 튕겨 나온 접촉. 부딪힌 순간의 상대 속도가 관문을 넘었으면 맞은 것이다.
      if (h._touch && (h._touch.get(body.uid) || 0) >= wp.gate) hitDmg = Math.max(hitDmg, base);
      const sweep = h._sweep;
      if (!sweep.length) continue; // Teleport repositioning is not an attack.
      for (let i = 1; i < sweep.length; i++) {
        const a = sweep[i - 1], q = sweep[i], t0 = (i - 1) / steps, t1 = i / steps;
        // 이 구간의 이동에서 밀린 몫을 빼고 휘두른 속도만 본다
        const mx = (q.x - a.x) - ((q.px || 0) - (a.px || 0)), my = (q.y - a.y) - ((q.py || 0) - (a.py || 0));
        const relative = Math.hypot(mx / subDt - bv.x, my / subDt - bv.y);
        if (relative < wp.gate) continue;
        // Swept head relative to the victim, so a quick intentional whip cannot
        // tunnel through it between two rendered frames.
        if (segDist(0, 0, a.x - (bx + (body.x - bx) * t0), a.y - (by + (body.y - by) * t0),
          q.x - (bx + (body.x - bx) * t1), q.y - (by + (body.y - by) * t1)) < headR + br)
          hitDmg = Math.max(hitDmg, base);
      }
      const relative = Math.hypot(h.sx - bv.x, h.sy - bv.y);
      if (f.flags.chainBarbed && relative >= wp.gate && ropeDist(f, h, body.x, body.y) < br + 4 * ws)
        hitDmg = Math.max(hitDmg, base * 0.4);
    }
    if (hitDmg > 0 && weaponDamage(b, f, body, hitDmg) > 0) {
      f.chainHits.set(body.uid, b.simT + wp.hitLock);
      held.add(body.uid);
      battleSound(b, 'weapon.chain.hit', body, 0.05);
    }
  }
  if (f.chainHits.size > 40) f.chainHits.clear();
  if (held.size > 40) held.clear();
}

/* 위치 교환 — 공과 추의 자리·속도를 맞바꾼다.
 * 추가 피해를 주는 부분이라, 붙은 상대 옆에 추를 남기고 빠져나가는 수가 된다. */
/* 꺾인 줄까지의 거리. 마디를 이은 꺾은선 전체에서 가장 가까운 곳을 본다.
 * 직선으로 재면 접힌 줄이 실제로는 없는 자리를 때린다. */
function ropeDist(f, h, x, y) {
  const at = h._anchor || chainAttach(f, h);
  let ax = at.x, ay = at.y, best = Infinity;
  for (const q of h.nodes.concat([h])) {
    best = Math.min(best, segDist(x, y, ax, ay, q.x, q.y));
    ax = q.x; ay = q.y;
  }
  return best;
}

function chainSwap(b, f) {
  ensureChainHeads(f);
  const h = f.chainHeads[0];
  const px = f.x, py = f.y;
  const mv = (f.st && f.st.move) || 1;
  const bvx = f.vx * mv, bvy = f.vy * mv;     // 공의 실제 속도 (단위벡터 x 이동속도)
  f.x = h.x; f.y = h.y;
  h.x = px; h.y = py;
  // 공은 추가 휘두르던 속도의 방향을 받는다 (크기는 st.move가 정한다)
  const hs = Math.hypot(h.vx, h.vy);
  if (hs > 1e-6) { f.vx = h.vx / hs; f.vy = h.vy / hs; }
  h.vx = bvx; h.vy = bvy;
  b.arena.collideBody(f);
  // A head can reach closer to a diamond's corner than the larger body.
  // Single-face reflection may cross the adjacent face during this teleport.
  if (b.arena.type === 'diamond') {
    const limit = b.arena.L - bodyRadius(f) * Math.SQRT2;
    const reach = Math.abs(f.x) + Math.abs(f.y);
    if (reach > limit && reach > 0) { f.x *= limit / reach; f.y *= limit / reach; }
  }
  // Preserve the old body's momentum; relaying with the new body velocity
  // silently undid half of the promised position/velocity exchange.
  relayChain(f, h, { x: bvx, y: bvy });
  for (const other of f.chainHeads) if (other !== h) relayChain(f, other);
  f._chainAnchor = { x: f.x, y: f.y };
  addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 6, r1: 46, color: '#9fd0ff', dur: 0.28 });
  addFx(b, { type: 'ring', x: h.x, y: h.y, r0: 6, r1: 46, color: '#9fd0ff', dur: 0.28 });
}

function meleeHits(b, f, dt, override, commentarySource) {
  const wp = WEAPONS[f.weaponId];
  const def = override || { reach: wp.reach, tip: wp.tip, dmg: wp.dmg };
  const ws = weaponScale(f);
  const angles = [f.weaponAngle];
  if (f.flags.dualDagger) angles.push(f.weaponAngle + Math.PI);
  const contact = new Set();
  for (let blade = 0; blade < angles.length; blade++) {
    const ang = angles[blade];
    const tipDist = f.radius + def.reach * ws;
    const ax = f.x + Math.cos(ang) * f.radius * 0.4, ay = f.y + Math.sin(ang) * f.radius * 0.4;
    const bx = f.x + Math.cos(ang) * tipDist, by = f.y + Math.sin(ang) * tipDist;
    const tipR = def.tip * ws;
    for (const e of b.enemiesOf(f)) {
      for (const body of b.bodiesOf(e)) {
        if (segDist(body.x, body.y, ax, ay, bx, by) >= bodyRadius(body) + tipR) continue;
        const key = blade + ':' + body.uid;
        if (f.meleeContact.has(key)) { contact.add(key); continue; }
        // 무적 등으로 피해가 들어가지 않았다면 접촉으로 치지 않고 다음 프레임에 다시 시도한다
        if (weaponDamage(b, f, body, def.dmg, commentarySource || (override ? 'augment:bayonet' : undefined)) > 0) {
          contact.add(key);
          f.sfxSlash++;
          battleSound(b, f.weaponId === 'shield' ? 'weapon.shield.hit' : f.weaponId === 'sword' ? 'weapon.sword.hit' : 'weapon.dagger.hit', body, 0.045);
        }
      }
    }
  }
  f.meleeContact = contact;
}

function fireBow(b, f) {
  battleSound(b, 'weapon.bow.fire', f);
  const wp = WEAPONS.bow;
  // 세 갈래로 뿌리는 대신 발당 피해가 절반이다. 다 맞혀야 이득이 된다.
  const angs = f.flags.triple ? [f.weaponAngle - 0.21, f.weaponAngle, f.weaponAngle + 0.21] : [f.weaponAngle];
  const dmg = f.flags.triple ? wp.dmg * 0.5 : wp.dmg;
  for (const a of angs) {
    spawnProj(b, f, { kind: 'arrow', x: f.x + Math.cos(a) * (f.radius + 8), y: f.y + Math.sin(a) * (f.radius + 8), ang: a, spd: wp.projSpeed, dmg, r: 5, life: 4, homing: f.flags.homing ? BOW_HOMING_RATE : 0, homeNear: f.flags.homing ? BOW_HOMING_NEAR : 0, weapon: true });
  }
}

function fireGun(b, f) {
  battleSound(b, f.timers.gunBarrage > 0 ? 'weapon.pistol.barrage-shot' : 'weapon.pistol.fire', f);
  const wp = WEAPONS.pistol;
  const a = f.weaponAngle;
  spawnProj(b, f, { kind: 'bullet', x: f.x + Math.cos(a) * (f.radius + 8), y: f.y + Math.sin(a) * (f.radius + 8), ang: a, spd: wp.projSpeed, dmg: wp.dmg, r: 4, life: 2.5, weapon: true });
  f.gunFlash = 0.08;
}

/* 샷건 — 남은 탄창을 부채꼴로 한 번에 뿌린다. 쫓아가며 한 발씩 맞히는 대신
 * 한순간에 걸고, 빗나가면 통째로 빗나간다. */
function fireShotgun(b, f, n) {
  battleSound(b, 'weapon.shotgun.fire', f);
  const wp = WEAPONS.pistol;
  const count = Math.max(1, n);
  const SPREAD = 0.5;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const a = f.weaponAngle + t * SPREAD + rand(-0.03, 0.03);
    spawnProj(b, f, { kind: 'bullet', x: f.x + Math.cos(a) * (f.radius + 8), y: f.y + Math.sin(a) * (f.radius + 8), ang: a, spd: wp.projSpeed * rand(0.9, 1.08), dmg: wp.dmg, r: 4, life: 2.5, weapon: true });
  }
  f.gunFlash = 0.16;
  b.shake = Math.max(b.shake, Math.min(9, b.shake + 4));
}

function fireStaff(b, f) {
  battleSound(b, 'weapon.staff.fire', f);
  const wp = WEAPONS.staff;
  // 정면이 비어 있다. 똑바로 굴러오는 상대는 오히려 두 발 다 비껴간다.
  const angs = f.flags.doubleMagic ? [f.weaponAngle - 0.26, f.weaponAngle + 0.26] : [f.weaponAngle];
  const bounce = wp.bounces + (f.flags.doubleReflect ? 1 : 0);
  for (const a of angs) {
    spawnProj(b, f, { kind: 'orb', x: f.x + Math.cos(a) * (f.radius + 10), y: f.y + Math.sin(a) * (f.radius + 10), ang: a, spd: wp.projSpeed, dmg: wp.dmg, r: 9, life: 7, bounces: bounce, weapon: true });
  }
}

function releaseCharge(b, f) {
  if (!f.charging || f.charging.t < 0.2) return false;
  battleCommentary(b, 'release', f, null, 'skill:bow');
  battleSound(b, 'skill.bow.release', f);
  spawnProj(b, f, {
    kind: 'charge', x: f.x + Math.cos(f.weaponAngle) * (f.radius + 10), y: f.y + Math.sin(f.weaponAngle) * (f.radius + 10),
    ang: f.weaponAngle, spd: 580, dmg: WEAPONS.bow.chargeDmg, r: 8, life: 3, pierce: true, pierceObstacles: true, weapon: true,
  });
  f.charging = null;
  b.shake = Math.min(12, b.shake + 5);
  addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 10, r1: 60, color: '#ffe08a', dur: 0.3 });
  return true;
}

function spawnProj(b, owner, o) {
  if (o.weapon && owner.timers.balloon > 0) o.r *= 1.7;
  o.baseR = o.r;
  o.uid = ++UID; o.owner = owner; o.vx = Math.cos(o.ang); o.vy = Math.sin(o.ang);
  o.bounces = o.bounces || 0; o.pierce = !!o.pierce; o.life = o.life || 4;
  // 느리게 날아가는 만큼 오래 살아야 사거리가 그대로다. 유도 선회도 같이 늦춘다.
  o.life /= GAME_SPEED;
  if (o.homing) o.homing *= GAME_SPEED;
  // 회전 난사 탄환은 스킬이 끝난 후 적중해도 발사 당시 출처를 유지한다.
  if (o.kind === 'bullet' && owner.timers.gunBarrage > 0) o.commentarySource = 'skill:pistol';
  b.projectiles.push(o);
  if (o.kind === 'beam') battleSound(b, 'augment.beam', owner);
  else if (o.kind === 'missile') battleSound(b, 'augment.missile', owner, 0.05);
  else if (o.kind === 'shuriken') battleSound(b, 'augment.shuriken', owner);
  return o;
}

function projectileHit(b, p, body) {
  const owner = p.owner;
  const source = projectileSource(p);
  const via = { projectile: true, wallAssist: !!p.reflected };
  const dealt = p.weapon
    ? weaponDamage(b, owner, body, p.dmg, source, via)
    : dealDamage(b, owner, body, p.dmg * owner.st.dmg, { kind: 'auto', autoType: p.kind, ...via });
  if (dealt <= 0) return;
  // 화살 넉백
  if (p.kind === 'arrow' && owner.flags.kbArrow && isFighterBody(body)) {
    body.x += p.vx * 34; body.y += p.vy * 34;
  }
  // 무기 강탈
  if (p.kind === 'orb' && owner.flags.steal && isFighterBody(body)) {
    body.timers.weaponLock = 1;
    popup(b, body.x, body.y - body.radius - 34, '무기 강탈!', '#c9a0ff');
  }
}

function weaponDamage(b, f, body, baseDmg, commentarySource, via) {
  let mult = 1;
  if (f.charged) { f.charged = false; f.bounceRun = 0; mult *= 1.3; addFx(b, { type: 'ring', x: body.x, y: body.y, r0: 8, r1: 50, color: '#ffe08a', dur: 0.25 }); }
  if (f.counterReady) { f.counterReady = false; mult *= 1.3; }
  if (f.flags.mark) {
    const n = (f.markHits.get(body.uid) || 0) + 1;
    f.markHits.set(body.uid, n >= 5 ? 0 : n);
    if (n >= 5) { mult *= 1.5; popup(b, body.x, body.y - bodyRadius(body) - 40, '표식 발동!', '#ffd24d'); }
  }
  const raw = baseDmg * f.st.atk * f.st.dmg * mult;
  const dealt = dealDamage(b, f, body, raw, { kind: 'weapon', commentarySource: commentarySource || 'weapon:' + f.weaponId, ...via });
  if (dealt > 0) {
    onWeaponHitEffects(b, f, body);
  }
  return dealt;
}

function onWeaponHitEffects(b, f, body) {
  if (isFighterBody(body)) {
    if (f.flags.bleed) {
      const bleed = body.bleed;
      const st = bleed.stacks.find(x => x.src === f);
      if (st) st.n++;                                  // 이미 물린 상대면 중첩만 올린다 (초침은 그대로)
      else bleed.stacks.push({ src: f, n: 1, t: 1 });
      bleed.n = bleed.stacks.reduce((sum, x) => sum + x.n, 0);
    }
    if (f.flags.frost) {
      if (!body.frost.n) battleSound(b, 'augment.frost', body);
      body.frost = { n: Math.min(3, body.frost.n + 1), t: 3 };
    }
  }
  if (f.flags.warmonger) f.warmStacks = Math.min(5, f.warmStacks + 1);
  if (f.flags.rotMomentum) f.rotStacks = Math.min(8, f.rotStacks + 1);
  if (f.flags.chase) f.timers.chase = 3;
  if (f.flags.vampiric) healFighter(b, f, f.maxHp * 0.05, true, 'vampiric');
  if (f.flags.dualPhase) f.timers.untouchable = Math.max(f.timers.untouchable, 1);
}

/* ---------------- 자동 공격 시스템 ---------------- */
function autoSystems(b, f, dt) {
  if (f.mainDead || f.dead) return;
  const Fl = f.flags;
  if (Fl.missile) {
    f.cd.missile -= dt;
    if (f.cd.missile <= 0) {
      f.cd.missile = 3 * f.autoCdMult;
      const n = 2 + (Fl.missilePlus ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const a = f.weaponAngle + rand(-0.6, 0.6) + i * 0.5;
        spawnProj(b, f, { kind: 'missile', x: f.x + Math.cos(a) * f.radius, y: f.y + Math.sin(a) * f.radius, ang: a, spd: 230, dmg: 2 * (Fl.missileUp ? 1.3 : 1), r: 6, life: 4.5, homing: 3.2 });
      }
    }
  }
  if (Fl.shuriken) {
    f.cd.shuriken -= dt;
    if (f.cd.shuriken <= 0) {
      f.cd.shuriken = 2 * f.autoCdMult;
      const tgt = b.nearestEnemyBody(f);
      if (tgt) {
        const a = Math.atan2(tgt.y - f.y, tgt.x - f.x);
        spawnProj(b, f, { kind: 'shuriken', x: f.x, y: f.y, ang: a, spd: 320 * (Fl.shurikenSpd ? 1.5 : 1), dmg: 5 * (Fl.shurikenUp ? 1.3 : 1), r: 7, life: 3 });
      }
    }
  }
  if (Fl.flame) {
    f.cd.flame -= dt;
    if (f.cd.flame <= 0) {
      f.cd.flame = 0.18;
      const duration = 2 * (Fl.flameDur ? 1.5 : 1);
      b.flames.push({ owner: f, x: f.x, y: f.y, r: 16, life: duration, maxLife: duration, dps: 1 * (Fl.flameUp ? 1.3 : 1) });
      if (b.flames.length > 60) b.flames.shift();
    }
  }
  if (Fl.sleepGas) {
    f.cd.gasT -= dt;
    if (f.cd.gasT <= 0) {
      f.cd.gasT = 10 * f.autoCdMult;
      let did = false;
      for (const e of b.enemiesOf(f)) {
        for (const body of b.bodiesOf(e)) {
          if (!isFighterBody(body) || body.dead) continue;
          body.timers.stun = Math.max(body.timers.stun, 1); did = true;
          addFx(b, { type: 'ring', x: body.x, y: body.y, r0: 44, r1: 12, color: '#b7e6d2', dur: 0.45 });
        }
      }
      if (did) { battleSound(b, 'augment.sleep', f); popup(b, f.x, f.y - f.radius - 30, '수면 가스!', '#b7e6d2'); }
    }
  }
  if (Fl.gravityWell) {
    f.cd.gravT -= dt;
    if (f.cd.gravT <= 0) {
      f.cd.gravT = 10 * f.autoCdMult;
      let did = false;
      for (const e of b.enemiesOf(f)) {
        if (e.mainDead || e.dead) continue;
        const nd = normDir(f.x - e.x, f.y - e.y);
        e.vx = nd.x; e.vy = nd.y; did = true;
        addFx(b, { type: 'ring', x: e.x, y: e.y, r0: 50, r1: 8, color: '#8ef', dur: 0.4 });
      }
      if (did) { battleSound(b, 'augment.gravity', f); popup(b, f.x, f.y - f.radius - 30, '중력장!', '#8ef'); }
    }
  }
}

/* 위성체가 도는 거리(공 중심에서). 공이 커지면 같이 멀어진다. 기본 공(반지름 22)에서 63.
 * 예전에는 화면은 중심에서 42에 그리고 판정은 반지름+42(=64)에서 해서 보이는 자리와
 * 맞는 자리가 달랐다. 화면을 1.5배(63) 벌리면서 둘을 이 함수 하나로 맞췄다. */
function satelliteOrbit(f) {
  return (f.radius || 22) + 41;
}

function updateSatellites(b, f, dt) {
  if (f.mainDead || f.dead) return;
  const orbit = satelliteOrbit(f);
  for (const s of f.satellites) {
    s.ang += 2.7 * GAME_SPEED * dt;
    s.cd = Math.max(0, s.cd - dt);
    const sx = f.x + Math.cos(s.ang) * orbit;
    const sy = f.y + Math.sin(s.ang) * orbit;
    if (s.cd <= 0) {
      for (const e of b.enemiesOf(f)) {
        for (const body of b.bodiesOf(e)) {
          if (dist(sx, sy, body.x, body.y) < 9 + bodyRadius(body)) {
            dealDamage(b, f, body, 3 * f.st.dmg, { kind: 'auto', autoType: 'satellite' });
            s.cd = 0.8;
            sparks(b, sx, sy, 5, '#9fd0ff', 120);
            break;
          }
        }
        if (s.cd > 0) break;
      }
    }
  }
}

function spawnBolt(b, f) {
  const e = b.nearestEnemyMain(f);
  if (!e) return;
  const tx = e.x + rand(-110, 110), ty = e.y + rand(-110, 110);
  battleSound(b, 'augment.lightning', { x: tx, y: ty });
  boltFx(b, tx, ty - 340, tx, ty);
  b.shake = Math.min(12, b.shake + 4);
  let hit = false;
  for (const ef of b.enemiesOf(f)) {
    for (const body of b.bodiesOf(ef)) {
      if (dist(tx, ty, body.x, body.y) < 48 + bodyRadius(body)) {
        if (dealDamage(b, f, body, 10 * f.st.dmg, { kind: 'auto', autoType: 'lightning' }) > 0) hit = true;
      }
    }
  }
  if (hit && f.flags.chainBolt) {
    battleSound(b, 'augment.chain-lightning', { x: tx, y: ty });
    for (let i = 0; i < 2; i++) {
      const cx = tx + rand(-130, 130), cy = ty + rand(-130, 130);
      boltFx(b, tx, ty, cx, cy);
      for (const ef of b.enemiesOf(f)) {
        for (const body of b.bodiesOf(ef)) {
          if (dist(cx, cy, body.x, body.y) < 36 + bodyRadius(body)) dealDamage(b, f, body, 6 * f.st.dmg, { kind: 'auto', autoType: 'lightning', commentarySource: 'augment:chainBolt' });
        }
      }
    }
  }
}

/* ---------------- 지뢰/폭발 ---------------- */
function explodeMine(b, m, scale = 1, damage = m.dmg, commentarySource = 'weapon:mine') {
  const R = m.blast * scale;
  explodeFx(b, m.x, m.y, R, '#ffb14d', 'weapon.mine.explode');
  for (const e of b.enemiesOf(m.owner)) {
    for (const body of b.bodiesOf(e)) {
      if (dist(m.x, m.y, body.x, body.y) < R + bodyRadius(body)) {
        weaponDamage(b, m.owner, body, damage, commentarySource);
        if (m.owner.flags.freezeMine && body.kind === 'main') {
          body.timers.freeze = 2;
        }
      }
    }
  }
}
// 충격파 증강(shockwave)이 벽에 튕길 때 퍼지는 반경. 철퇴의 벽 강타(quakeR)도 같은 크기다.
const SHOCKWAVE_R = 112;

function explodeAt(b, src, x, y, radius, dmg, kind, small, sound = 'battle.explosion', commentarySource) {
  if (small) addFx(b, { type: 'ring', x, y, r0: radius * 0.3, r1: radius, color: '#8ea6ff', dur: 0.25 });
  else explodeFx(b, x, y, radius, '#ffb14d', sound);
  for (const e of b.enemiesOf(src)) {
    for (const body of b.bodiesOf(e)) {
      if (dist(x, y, body.x, body.y) < radius + bodyRadius(body)) dealDamage(b, src, body, dmg, { kind, commentarySource });
    }
  }
}

/* ---------------- 피해/치유/사망 ---------------- */
function resolveHealthThresholds(b, f) {
  if (f.mainDead || f.dead) return;
  if (f.hp <= 0 && f.flags.lastResistance && !f.lastResistanceUsed) {
    f.lastResistanceUsed = true;
    f.downPending = false;
    f.hp = 1;
    battleSound(b, 'augment.last-stand', f);
    popup(b, f.x, f.y - f.radius - 30, '마지막 저항!', '#ffd24d', true);
    battleCommentary(b, 'last-stand', f, null, 'augment:lastResistance');
    addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 8, r1: 65, color: '#ffd24d', dur: 0.35 });
  }
  if (!f.survivalInstinctUsed && f.flags.survivalInstinct && f.hp / f.maxHp <= 0.3) {
    f.survivalInstinctUsed = true;
    healFighter(b, f, f.maxHp * 0.15, true);
    popup(b, f.x, f.y - f.radius - 24, '생존 본능!', '#7dffa8', true);
  }
}

function dealDamage(b, src, body, raw, opts = {}) {
  const actorBody = isFighterBody(body);
  const t = actorBody ? body : body.owner;
  const br = bodyRadius(body);
  if (body.hp <= 0) return 0;
  // 면역·보호막·과잉 피해를 제외한 실제 체력 피해만 기록한다. 생존 증강의
  // 후속 회복은 공격 적중 사실을 취소하지 않으며 지속 피해는 별도 출처다.
  const commentarySource = opts.commentarySource || (opts.autoType
    ? (opts.autoType === 'bleed' || opts.autoType === 'flame' ? 'dot:' : 'augment:') + opts.autoType
    : opts.kind === 'weapon' && src ? 'weapon:' + src.weaponId : 'damage:other');
  if (t.timers.immune > 0 || t.timers.untouchable > 0) {
    if (Math.random() < 0.3) popup(b, body.x, body.y - br - 10, '면역', '#7fd8ff');
    if (actorBody && raw > 0) commentaryGuard(b, t, src, commentarySource, raw);
    return 0;
  }
  let dmg = raw;
  if (t.flags.ironDefense && b.simT < 5) dmg *= 0.6;
  dmg *= (t.perm.dmgTaken || 1);
  if (t.gripT > 0) dmg *= 0.7;   // 단단한 손 — 주운 직후 5초간
  if (actorBody && t.shield > 0) {
    const ab = Math.min(t.shield, dmg);
    t.shield -= ab; dmg -= ab;
    if (ab > 0) popup(b, body.x + rand(-8, 8), body.y - br - 6, '보호막', '#7fd8ff');
    if (ab > 0 && dmg <= 0) commentaryGuard(b, t, src, commentarySource, ab);
  }
  const hpBefore = body.hp;
  body.hp -= dmg;
  const commentaryDamage = Math.min(Math.max(0, hpBefore), Math.max(0, dmg));
  if (actorBody) resolveHealthThresholds(b, t);
  battleCommentary(b, 'hit', src, body, commentarySource, commentaryDamage);
  // 벽 활용 — 투사체·방패는 벽에 튕긴 뒤 맞혔을 때, 몸으로 휘두른 공격은 튕긴 직후에
  if (commentaryDamage > 0 && src && DIRECT_SOURCE.test(commentarySource)
    && (opts.projectile ? opts.wallAssist : src._wallT != null && b.simT - src._wallT <= WALL_ASSIST_T)) {
    battleCommentary(b, 'wall-hit', src, body, commentarySource, commentaryDamage);
  }
  if (src && src.player) src.player.totalDmg = (src.player.totalDmg || 0) + dmg;
  const val = Math.max(1, Math.round(dmg));
  popup(b, body.x + rand(-10, 10), body.y - br - 4, val, opts.kind === 'auto' ? '#c9d6ff' : '#ffffff');
  battleSound(b, 'battle.hit', body, 0.04);
  sparks(b, body.x, body.y, 4, '#ffb0b0', 130);
  if (actorBody) {
    t.flash = 0.12;
    if (t.flags.counter) t.counterReady = true;
    if (t.flags.hitCharge) t.hitChargeStacks = Math.min(5, t.hitChargeStacks + 1);
    if (t.tracking) t.tracking.bounces = 0;
    // 세게 맞을수록 크게 흔든다. 예전에는 3딜이든 40딜이든 똑같이 +2였는데,
    // 그 정도는 0.08초 만에 사그라들어 맞은 느낌이 거의 없었다.
    // 이미 폭발 등으로 더 크게 흔들리는 중이면 그대로 둔다.
    // min만 쓰면 큰 흔들림이 작은 피격 때문에 오히려 줄어든다.
    b.shake = Math.max(b.shake, Math.min(11, b.shake + Math.min(8, 2.5 + dmg * 0.18)));
  }
  if (src && src.flags && src.flags.lifesteal) healFighter(b, src, dmg * src.flags.lifesteal, true, 'lifesteal');
  if (body.hp <= 0 && !body.downPending) { body.downPending = true; killBody(b, body, src); }
  return dmg;
}

function healFighter(b, f, amount, quiet, source = 'heal') {
  if (f.mainDead || f.dead || amount <= 0) return;
  const before = f.hp;
  const missing = Math.max(0, f.maxHp - before);
  f.hp = Math.min(f.maxHp, f.hp + amount);
  if (f.hp > before) recordRoundFact(b, teamOwner(f), 'heal', source, f.hp - before);
  if (f.hp - before >= 0.5) battleSound(b, 'augment.heal', f, 0.7);
  if (!quiet && f.hp - before >= 1) popup(b, f.x, f.y - f.radius - 6, '+' + Math.round(f.hp - before), '#7dffa8');
}

function killBody(b, body, src) {
  if (body.kind === 'summon') {
    const arr = body.owner.summons;
    const i = arr.indexOf(body); if (i >= 0) arr.splice(i, 1);
    sparks(b, body.x, body.y, 10, body.owner.color, 180);
    if (body.owner.flags.minionRevenge) explodeAt(b, body.owner, body.x, body.y, 80, 20 * body.owner.st.dmg, 'auto', false, 'augment.minion-explode', 'augment:minionRevenge');
    return;
  }
  if (body.kind === 'split') {
    body.hp = 0;
    if (body.flags.lastStand && !body.lastStandUsed) {
      body.lastStandUsed = true;
      body.downPending = false;
      body.timers.actingDead = 3;
      battleSound(b, 'augment.last-stand', body);
      popup(b, body.x, body.y - 40, '최후의 3초!', '#ff8f8f', true);
      battleCommentary(b, 'last-stand', body, null, 'augment:lastStand');
      return;
    }
    finalDeath(b, body);
    return;
  }
  // 메인 다운
  const f = body;
  f.hp = 0;
  if (f.flags.split && !f.splitUsed) {
    f.splitUsed = true; f.mainDead = true;
    b.spawnSplits(f);
    popup(b, f.x, f.y - 40, '분열!', '#ffd24d', true);
    battleCommentary(b, 'split', f, null, 'augment:split');
    explodeFx(b, f.x, f.y, 70, f.color, 'augment.split');
    b.checkEnd();
    return;
  }
  if (f.flags.lastStand && !f.lastStandUsed) {
    f.lastStandUsed = true;
    f.timers.actingDead = 3;
    battleSound(b, 'augment.last-stand', f);
    popup(b, f.x, f.y - 40, '최후의 3초!', '#ff8f8f', true);
    battleCommentary(b, 'last-stand', f, null, 'augment:lastStand');
    return;
  }
  finalDeath(b, f);
}

function finalDeath(b, f) {
  if (f.dead) return;
  f.dead = true;
  f.deathAt = b.simT;
  shatterFx(b, f.x, f.y, f.radius, f.color || (f.owner && f.owner.color));
  explodeFx(b, f.x, f.y, 90, f.color, 'battle.death');
  if (f.kind === 'split') {
    const root = f.owner;
    const i = root.splitBalls.indexOf(f);
    if (i >= 0) {
      // 효과음 누적 횟수를 본체로 옮긴다. 배열에서 빠지면서 합계가 줄면
      // 멀티에서 마지막 순간의 튕김·스킬 소리가 사라진다.
      root.bounceTotal += f.bounceTotal;
      root.sfxSkill += f.sfxSkill;
      root.sfxSlash += f.sfxSlash;
      root.splitBalls.splice(i, 1);
    }
    sparks(b, f.x, f.y, 10, root.color, 180);
    if (!root.splitBalls.length) {
      root.x = f.x; root.y = f.y;
      finalDeath(b, root);
    } else b.checkEnd();
    return;
  }
  b.checkEnd();
}

/* ============================================================
 * 스킬
 * ============================================================ */
/* 분열한 뒤에는 살아 있는 분열체 모두가 본체다. 한 번 누르면 전부 같은 스킬을 쓴다
 * (조이스틱이 이미 전부를 함께 조종하는 것과 같다).
 * 횟수·쿨타임은 한 벌을 공유한다. 그래서 쓸 수 있는지는 모두 같은 처음 조건으로 보고,
 * 소비는 한 번만 남긴다 — 앞 분열체가 쿨타임을 걸어 뒤 분열체가 막히면 안 된다. */
function useSkill(b, f, slot) {
  if (f.mainDead && f.splitBalls && f.splitBalls.length) {
    const alive = f.splitBalls.filter(s => !s.dead);
    if (!alive.length) return false;
    const uses = alive[0].skillUses, before = { ...uses };
    let result = false, after = null;
    for (const body of alive) {
      Object.assign(uses, before);
      const r = useSkillBody(b, body, slot);
      if (r) { if (result === false || result === true) result = r; after = { ...uses }; }
    }
    Object.assign(uses, after || before);
    return result;
  }
  return useSkillBody(b, f, slot);
}

function useSkillBody(b, f, slot) {
  if (b.phase !== 'fight' || f.dead || f.mainDead || f.timers.stun > 0) return false;
  // 칸은 둘뿐이다. 없는 이름이 들어오면 무기 스킬이 대신 나가 버린다.
  if (slot !== 'char' && slot !== 'weapon') return false;
  // 활은 첫 입력으로 충전하고, 두 번째 입력으로 발사할 때 사용 횟수를 소비한다.
  // 활은 첫 입력으로 충전을 시작하고 두 번째 입력으로 쏜다.
  // 쿨타임은 '쏜 순간'부터 돈다 — 충전만 하고 안 쏴도 잠기면 억울하다.
  if (slot === 'weapon' && f.weaponId === 'bow' && f.charging) {
    if (!releaseCharge(b, f)) return false;
    startWeaponCd(f);
    f.sfxSkill++;
    return true;
  }
  // 화염방사기는 스킬 버튼이 곧 기본 공격이다. 쿨타임도 횟수도 없다.
  if (slot === 'weapon' && f.weaponId === 'flame') {
    setFlameInput(f, true);
    return true;
  }
  if (slot === 'char' && f.skillUses.char <= 0) return false;
  if (slot === 'weapon' && f.skillUses.cd > 0) return false;
  const id = slot === 'char' ? f.charId : f.weaponId;
  switch (id) {
    case 'direction':
      f.pendingAim = true;   // 드래그로 발동 (소비는 발동 시)
      return 'aim';
    case 'cat': {
      const target = b.simT - 2;
      let best = null;
      for (const h of f.hist) { if (h.t <= target) best = h; else break; }
      const dest = best || f.hist[0] || { x: f.spawnX, y: f.spawnY };
      addFx(b, { type: 'ring', x: f.x, y: f.y, r0: f.radius, r1: 2, color: '#ffb3d1', dur: 0.3 });
      f.x = dest.x; f.y = dest.y;
      b.arena.collideBody(f);
      addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 4, r1: f.radius * 2, color: '#ffb3d1', dur: 0.3 });
      popup(b, f.x, f.y - f.radius - 20, '되돌아가기', '#ffb3d1');
      break;
    }
    case 'wak':
      f.berserkPhase = 1; f.timers.berserk = 5;
      popup(b, f.x, f.y - f.radius - 24, '파괴 폭주!', '#ffa94d', true);
      explodeFx(b, f.x, f.y, 60, '#ffa94d', null);
      break;
    case 'soft':
      f.timers.immune = 2;
      popup(b, f.x, f.y - f.radius - 24, '말랑 방어!', '#f3f0e8', true);
      break;
    case 'bomb':
      f.timers.fuse = 1;
      popup(b, f.x, f.y - f.radius - 24, '점화…', '#ffb14d');
      break;
    case 'bball':
      f.tracking = { bounces: 0 };
      popup(b, f.x, f.y - f.radius - 24, '3바운드 도전!', '#ffd24d', true);
      break;
    case 'balloon':
      f.timers.balloon = 5;
      popup(b, f.x, f.y - f.radius - 30, '팽창!', '#ff6b81', true);
      break;
    case 'sword':
      f.spinRemaining += TAU * 2;
      popup(b, f.x, f.y - f.radius - 24, '믹서기!', '#9fd0ff', true);
      break;
    case 'dagger':
      f.dashPrepDir = { x: f.vx, y: f.vy };
      f.timers.dashPrep = 1;
      popup(b, f.x, f.y - f.radius - 24, '돌진 준비…', '#8ef');
      break;
    case 'bow': {
      f.charging = { t: 0, spin: 0 };
      popup(b, f.x, f.y - f.radius - 24, '차지 중…', '#ffe08a');
      f.sfxSkill++;
      battleSound(b, 'skill.bow.charge', f);
      battleCommentary(b, 'skill', f, null, 'skill:bow');
      return true;
    }
    case 'pistol': {
      const g = f.gun;
      f.timers.gunBarrage = 1.5;
      g.reloadT = 0; g.burst = g.mag; g.shotT = 0;
      g.focus = true;
      popup(b, f.x, f.y - f.radius - 24, '회전 난사!', '#ffe08a', true);
      break;
    }
    case 'staff':
      f.timers.rampage = 3;
      popup(b, f.x, f.y - f.radius - 24, '마력 폭주!', '#c9a0ff', true);
      break;
    case 'shield':
      if (f.disc) {
        // 자기 방패는 쿨타임이 끝났으면 던져 둔 방패를 불러온다. 불러오는 데에는
        // 쿨타임을 쓰지 않는다 — 손에 들어오면 바로 다시 던진다.
        if (!f.flags.discMagnet || !recallDisc(b, f)) return false;
        popup(b, f.x, f.y - f.radius - 24, '회수!', '#8fe3d0');
        f.sfxSkill++;
        return true;
      }
      if (!throwDisc(b, f)) return false;   // 던져 둔 채로는 다시 못 던진다
      popup(b, f.x, f.y - f.radius - 24, '투척!', '#8fe3d0');
      break;
    case 'chain':
      chainSwap(b, f);
      popup(b, f.x, f.y - f.radius - 24, '위치 교환!', '#9fd0ff');
      break;
    case 'mine':
      f.timers.det = 1;
      popup(b, f.x, f.y - f.radius - 24, '폭파 예약…', '#ffb14d');
      break;
  }
  if (slot === 'char') f.skillUses.char--;
  else startWeaponCd(f);
  f.sfxSkill++;
  const cue = {
    cat: 'skill.cat.rewind', wak: 'skill.rampage.start', soft: 'skill.soft.guard',
    bomb: 'skill.bomb.arm', bball: 'skill.basketball.arm', balloon: 'skill.balloon.inflate',
    sword: 'skill.sword.spin', dagger: 'skill.dagger.prepare', pistol: 'skill.pistol.barrage',
    staff: 'skill.staff.overload', mine: 'skill.mine.remote', chain: 'skill.chain.swap',
    shield: null,   // 투척 소리는 throwDisc가 직접 낸다
  }[id];
  if (cue) battleSound(b, cue, f);
  if (cue) battleCommentary(b, 'skill', f, null, (slot === 'char' ? 'char:' : 'skill:') + id);
  return true;
}


/* ============================================================
 * 전투 AI
 * ============================================================ */
function aiChooseStartDir(b, f) {
  const e = b.nearestEnemyMain(f);
  const wp = WEAPONS[f.weaponId];
  if (!e) return rand(0, TAU);
  const lead = clamp(dist(f.x, f.y, e.x, e.y) / 300, 0, 1) * 0.6;
  const px = e.x + e.vx * 170 * lead, py = e.y + e.vy * 170 * lead;
  let ang = Math.atan2(py - f.y, px - f.x);
  if (wp.type === 'ranged' || f.weaponId === 'mine') {
    if (chance(0.55)) ang += (chance(0.5) ? 1 : -1) * rand(0.7, 1.2); // 탄젠트 궤도
  }
  return ang + rand(-0.12, 0.12);
}

/* ---- 회피 ----
 *
 * 여기까지 AI는 상대와의 거리만 보고 방향을 정했다. 날아오는 것을 보는
 * 코드가 아예 없어서, 이동속도를 올려 줘도 피할 줄을 몰랐다 — 밸런스를
 * 재 보면 이동·기동 계열 증강이 전부 0으로 나왔다.
 *
 * 조향 판단(0.4~0.7초)과 따로 도는 이유: 화살이 300px/s로 오면 경기장을
 * 가로지르는 데 2초 남짓이라 0.5초에 한 번 봐서는 이미 늦는다.
 * 차지 샷 조준이 같은 이유로 따로 도는 것과 같은 자리다.
 *
 * 완벽하게 피하면 상대하기 싫어진다. 일정 확률로 못 본 척하게 두어
 * 빈틈을 남긴다. */
const AI_DODGE_TICK = 0.1;    // 위협을 다시 살피는 주기
const AI_DODGE_LOOK = 0.8;    // 이 시간 안에 닿을 것만 본다
const AI_DODGE_PAD = 12;      // 스칠 것도 피한다
const AI_DODGE_MISS = 0.25;   // 이 확률로는 못 본 척한다

/* 가장 급한 위협 하나를 찾는다. 나와 투사체의 상대속도로 최접근 시각을
 * 구하고, 그때 거리가 몸통+투사체 반지름 안이면 맞을 것으로 본다. */
function aiIncomingThreat(b, f) {
  const team = teamOwner(f);
  const myR = bodyRadius(f);
  const mv = (f.st && f.st.move) || 0;
  let best = null;
  for (const p of b.projectiles) {
    if (!p.owner || teamOwner(p.owner) === team) continue;   // 내 편이 쏜 것은 건너뛴다
    const dx = f.x - p.x, dy = f.y - p.y;
    // 상대속도로 본다. 내가 움직이는 것까지 넣어야 엉뚱한 데로 앞질러 비키지 않는다.
    const rvx = p.vx * p.spd - f.vx * mv;
    const rvy = p.vy * p.spd - f.vy * mv;
    const vv = rvx * rvx + rvy * rvy;
    if (vv < 1) continue;
    const t = (dx * rvx + dy * rvy) / vv;
    if (t <= 0 || t > AI_DODGE_LOOK) continue;               // 멀어지는 중이거나 아직 먼 것
    const cx = dx - rvx * t, cy = dy - rvy * t;              // 최접근 순간의 벌어짐
    if (Math.hypot(cx, cy) > myR + p.r + AI_DODGE_PAD) continue;
    if (!best || t < best.t) best = { p, t, dx, dy };
  }
  if (!best) return null;
  // 투사체 진행선의 어느 쪽에 있는지 보고 그쪽으로 더 비킨다 — 가로지르는 것보다 짧다.
  // 선 위에 거의 걸쳐 있으면 지금 방향에서 덜 꺾는 쪽을 고른다.
  const p = best.p;
  const pAng = Math.atan2(p.vy, p.vx);
  const cross = p.vx * best.dy - p.vy * best.dx;
  let side;
  if (Math.abs(cross) > 1) side = cross > 0 ? 1 : -1;
  else side = angleDelta(Math.atan2(f.vy, f.vx), pAng + Math.PI / 2) > 0 ? 1 : -1;
  return { angle: pAng + side * Math.PI / 2, t: best.t };
}

function aiChooseSteer(b, f, e) {
  const wp = WEAPONS[f.weaponId];
  const d = dist(f.x, f.y, e.x, e.y);
  const toward = Math.atan2(e.y - f.y, e.x - f.x);
  let angle = toward;

  if (f.weaponId === 'shield' && f.disc) {
    // 던져 놓았으면 줍는 것이 최우선이다. 무기가 없는 동안은 싸울 수 없다.
    angle = Math.atan2(f.disc.y - f.y, f.disc.x - f.x) + rand(-0.12, 0.12);
  } else if (wp.type === 'cone') {
    // 화염방사기는 붙어야 쓴다. 조향이 곧 조준이라 상대 쪽을 향한다.
    angle = toward + rand(-0.2, 0.2);
  } else if (wp.type === 'chain') {
    // 쇠사슬은 정면으로 붙으면 추가 뒤에 남아 안 맞는다. 옆으로 스쳐 지나가며
    // 추를 상대 쪽으로 휘두르는 궤도가 맞다.
    const side = f.aiSteerSide || 1;
    angle = toward + side * rand(0.55, 0.95);
    if (chance(0.12)) f.aiSteerSide = side * -1;
  } else if (wp.type === 'melee') {
    // 근접은 약간의 예측과 오차를 섞어 쫓되, 완벽한 유도탄처럼 붙지는 않는다.
    const lead = clamp(d / 380, 0, 0.65);
    angle = Math.atan2(e.y + e.vy * 120 * lead - f.y, e.x + e.vx * 120 * lead - f.x);
    angle += rand(-0.18, 0.18);
  } else {
    const ideal = f.weaponId === 'staff' ? 225 : f.weaponId === 'mine' ? 190 : 250;
    if (d < ideal * 0.72) {
      angle = toward + Math.PI + rand(-0.24, 0.24); // 너무 가까우면 거리를 벌린다
    } else if (d > ideal * 1.35) {
      angle = toward + rand(-0.25, 0.25);           // 너무 멀면 다시 사거리로 들어온다
    } else {
      // 적정 거리에서는 한쪽으로 선회한다. 가끔 방향을 바꿔 패턴을 읽을 수 있게 한다.
      if (chance(0.16)) f.aiSteerSide *= -1;
      angle = toward + f.aiSteerSide * rand(1.05, 1.38);
    }
  }
  return { angle, magnitude: rand(0.72, 0.96) };
}

function aiUpdate(b, f, dt) {
  if (b.phase !== 'fight' || f.dead || f.mainDead || f.timers.stun > 0) return;
  f.aiSteerT -= dt;
  if (f.aiSteerT <= 0) {
    f.aiSteerT = rand(0.4, 0.7);
    const steerTarget = b.nearestEnemyMain(f);
    if (steerTarget) {
      const choice = aiChooseSteer(b, f, steerTarget);
      setSteerInput(f, choice.angle, choice.magnitude);
    } else clearSteerInput(f);
  }

  // 날아오는 것 피하기. 위 판단 주기와 따로 보고, 잡히면 그쪽을 덮어쓴다.
  f.aiDodgeT = (f.aiDodgeT || 0) - dt;
  if (f.aiDodgeT <= 0) {
    f.aiDodgeT = AI_DODGE_TICK;
    if (!steeringBlocked(f)) {
      const dodge = aiIncomingThreat(b, f);
      if (dodge && !chance(AI_DODGE_MISS)) {
        setSteerInput(f, dodge.angle, 1);
        f.aiSteerT = Math.max(f.aiSteerT, 0.2);   // 비키는 동안은 원래 판단을 미룬다
      }
    }
  }
  // 차지 샷 조준만은 판단 주기와 따로, 매 프레임 본다.
  // 활은 두 바퀴 도는 동안 상대와 겹치는 순간이 0.1초 남짓이라
  // 0.2~0.4초마다 보는 일반 판단으로는 절반 넘게 그냥 지나쳐 버린다.
  if (f.charging && f.charging.t >= 0.2) {
    const tgt = b.nearestEnemyMain(f);
    if (tgt) {
      // 화살이 날아가는 동안 상대가 움직이는 만큼 앞을 겨눈다
      const flight = dist(f.x, f.y, tgt.x, tgt.y) / 580;
      const spd = tgt.st ? tgt.st.move : 170;
      const aimAng = Math.atan2(tgt.y + tgt.vy * spd * flight - f.y, tgt.x + tgt.vx * spd * flight - f.x);
      let off = f.weaponAngle - aimAng;
      while (off > Math.PI) off -= TAU; while (off < -Math.PI) off += TAU;
      if (Math.abs(off) < 0.1) { useSkill(b, f, 'weapon'); return; }
    }
  }
  f.aiT -= dt;
  if (f.aiT > 0) return;
  f.aiT = rand(0.2, 0.4);
  const e = b.nearestEnemyMain(f);
  if (!e) return;
  const d = dist(f.x, f.y, e.x, e.y);
  const hpP = f.hp / f.maxHp;
  const eHpP = e.hp / e.maxHp;
  const wp = WEAPONS[f.weaponId];
  // 분열체는 주인을 거쳐 쓴다 — 사람이 조종할 때처럼 살아 있는 분열체가 함께 쓴다
  const use = slot => useSkill(b, f.kind === 'split' && f.owner && f.owner.mainDead ? f.owner : f, slot);
  // 캐릭터 스킬 (카피 스킬도 동일 휴리스틱)
  const charHeur = id => {
    switch (id) {
      case 'cat': return hpP < 0.45 && d < 170;
      case 'wak': return (eHpP < 0.5 || b.simT > 14) && hpP > 0.45;
      case 'soft': return hpP < 0.55 && d < 140;
      case 'bomb': return d < 135;
      case 'bball': return b.simT < 5 && d > 190;
      case 'balloon': return b.simT > 3;
      default: return false;
    }
  };
  if (f.skillUses.char > 0 && charHeur(f.charId)) use('char');
  // 무기 스킬
  if (f.skillUses.cd <= 0) {
    const angToE = Math.atan2(e.y - f.y, e.x - f.x);
    let diff = f.weaponAngle - angToE;
    while (diff > Math.PI) diff -= TAU; while (diff < -Math.PI) diff += TAU;
    switch (f.weaponId) {
      // 위치 교환은 상대가 붙었을 때가 값어치가 가장 크다 — 그 자리에 추가 남는다.
      // 방패는 맞을 만한 거리에서만 던진다. 빗나가면 주우러 가는 동안 무방비다.
      case 'shield':
        if (!f.disc) { if (d > 90 && d < 300) use('weapon'); }
        // 자기 방패 — 쿨타임이 끝났는데 방패가 멀리 있으면 불러온다
        else if (f.flags.discMagnet && !f.disc.returning && dist(f.x, f.y, f.disc.x, f.disc.y) > 140) use('weapon');
        break;
      case 'chain': if (d < f.radius + 70) use('weapon'); break;
      // 화염방사기는 사거리 안일 때만 뿜고, 벗어나면 끈다. 연료가 바닥이면 쉰다.
      case 'flame': {
        const inRange = d < f.radius + WEAPONS.flame.range * weaponScale(f) * 0.95;
        setFlameInput(f, inRange && f.flame.fuel > 12);
        break;
      }
      case 'sword': if (d < f.radius + wp.reach * weaponScale(f) + 55) use('weapon'); break;
      // 돌진은 780 x 0.35초라 270px 남짓 간다. 430px에서 걸면 닿지 못하고
      // 빈 곳으로 뛰어들어 오히려 맞기만 한다.
      case 'dagger': if (d > 120 && d < 300) use('weapon'); break;
      case 'bow':
        // 발사는 위쪽 매 프레임 조준 검사가 맡는다. 여기서는 충전 시작만 판단한다.
        if (!f.charging && d < 520) use('weapon');
        break;
      // 회전 난사는 켜는 순간 자동 조준을 버리고 사방으로 뿌린다.
      // 430px에서 켜면 대부분 빗나가고, 그동안 조준 사격을 통째로 잃는다.
      // 뿌리는 각도가 360도라 조준 여부는 상관없고 거리만 본다.
      case 'pistol': if (d < 200) use('weapon'); break;
      // 마력 폭주는 '날아가는 마법'을 3초간 키우는 스킬이다. 화면에 마법이
      // 없으면 통째로 버리는 셈인데, 전에는 7초만 지나면 그냥 썼다.
      case 'staff':
        // 날아가는 마법이 상대 근처까지 갔을 때 키워야 실제로 맞는다.
        // 그냥 '마법이 있으면'으로 잡으면 쏘자마자 써 버려 3초가 헛돈다.
        if (b.projectiles.some(p => p.owner === f && p.kind === 'orb'
          && dist(p.x, p.y, e.x, e.y) < 220)) use('weapon');
        break;
      case 'mine': {
        // 터뜨려 봐야 폭발 반경(기본 62) 안에 있어야 맞는다. 150px로 잡아
        // 두어 두 배 넘게 먼 지뢰를 그냥 날리고 있었다.
        const near = b.mines.some(m => m.owner === f && dist(m.x, m.y, e.x, e.y) < m.blast * 0.9);
        if (near) use('weapon');
        break;
      }
    }
  }
  // 차지 완료 후 각도 맞춰 발사 (무기 스킬 사용으로 처리됨)
}
