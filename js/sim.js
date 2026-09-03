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
const BOW_CHARGE_TURNS = 2;          // 차지 샷: 두 바퀴 돌 동안 조준한다
const BOW_CHARGE_SECS = 4;           // 두 바퀴에 걸리는 시간. 조준 난이도를 여기서 조절한다
const BOW_CHARGE_ROT = TAU * BOW_CHARGE_TURNS / BOW_CHARGE_SECS;  // 공격속도 영향 없음 — 조준 감각을 일정하게 유지
const AIM_TIME = 5;         // 라운드 시작 조준 제한시간
const MELEE_ASPD_GAIN = 2;  // 근접이 공격속도 증가분을 받는 배율
let UID = 0;

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
  const baseline = player.augmentBaselines && player.augmentBaselines[id];
  const gained = key => Math.max(0, (player[key] || 0) - (baseline ? baseline[key] || 0 : 0));
  const streakGained = () => {
    if (!baseline) return player.streak || 0;
    return player.losses === baseline.losses ? Math.max(0, player.streak - baseline.streak) : player.streak;
  };
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
    case 'winAccel': P.move *= 1 + 0.05 * streakGained(); break;
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
    case 'pinball': case 'reflectCharge': case 'wallClimb': case 'shockwave':
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
    case 'battery': case 'weaponMastery': case 'talent':
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
    case 'p_dual': Fl.dualPistol = 1; break;
    case 'p_mag': Fl.extMag = 1; break;
    case 'p_bayonet': Fl.bayonet = 1; break;
    case 's_triple': Fl.tripleMagic = 1; break;
    case 's_steal': Fl.steal = 1; break;
    case 's_bounce': Fl.doubleReflect = 1; break;
    case 'm_big': Fl.bigMine = 1; break;
    case 'm_heal': Fl.healMine = 1; break;
    case 'm_freeze': Fl.freezeMine = 1; break;
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
      elastic: 0, pawDrop: 0,
    },
    // computeStats가 돌기 전(조준 단계)에도 읽히므로 모양을 완전히 맞춰 둔다.
    // aspd가 빠져 있어 스탯판이 첫 프레임에 터졌었다.
    st: { atk: 1, dmg: 1, move: ch.move * wp.moveMult, rot: wp.rot, fr: 1, aspd: 1, size: 1 },
    pinStacks: 0, warmStacks: 0, rotStacks: 0, hitChargeStacks: 0, collisionStacks: 0,
    cd: {}, meleeContact: new Set(), markHits: new Map(),
    gun: null, charging: null, tracking: null, dash: null, dashHit: null, dashPrepDir: null,
    berserkPhase: 0, bleed: { n: 0, stacks: [] }, frost: { n: 0, t: 0 },
    bounceRun: 0, charged: false, counterReady: false, pushReady: false,
    bounceTotal: 0, lightningNext: 3,
    sfxSkill: 0,        // 스킬 효과음이 난 횟수. 멀티에서 클라이언트가 같은 소리를 재생하는 근거

    hist: [], histT: 0,
    skillUses: { char: 1, weapon: 1, common: 1 },
    summons: [], splitBalls: [], satellites: [],
    splitUsed: false, lastStandUsed: false,
    mainDead: false, dead: false, deathAt: 0, downPending: false,
    lastResistanceUsed: false, survivalInstinctUsed: false,
    flash: 0, staticCd: 0, collisionCd: 0, onSticky: false, pendingAim: false, aimLocked: false,
    rocketActive: false, rocketHits: new Set(),
    aiT: rand(0.4, 1.4), spawnX: 0, spawnY: 0,
  };
  for (const id of player.augments) applyAugmentBattle(f, id, player);
  f.rocketActive = !!f.flags.rocketStart;
  f.maxHp = Math.max(30, Math.round(ch.hp * f.perm.hp));
  f.hp = f.maxHp;
  f.skillUses.char += f.flags.talent ? 1 : 0;
  f.skillUses.weapon += f.flags.weaponMastery ? 1 : 0;
  f.skillUses.common += f.flags.battery ? 1 : 0;
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
  if (a.charId && (player.charId === a.charId || player.copiedSkill)) return false;
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
function applyAugmentPick(player, aug) {
  if (['winMomentum', 'winAccel', 'vengeance', 'learnLoss', 'survivor', 'battleExp', 'seasonedExp', 'fallenPower'].includes(aug.id)) {
    player.augmentBaselines = player.augmentBaselines || {};
    player.augmentBaselines[aug.id] = {
      wins: player.wins || 0, losses: player.losses || 0, streak: player.streak || 0,
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
  if (aug.cat === 'copy') player.copiedSkill = aug.charId;
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
  skill: 0.77,    // 46.2%
  streak: 0.76,   // 46.0%  누적형은 생각보다 약하다
  copy: 0.72,     // 45.3%
};
/* 카테고리 평균에서 크게 벗어난 개별 증강 (표본 200판 이상) */
const AI_AUG_WEIGHT = {
  vampiric: 1.5,        // 63%
  missile: 1.4,         // 62%
  meditate: 1.4,        // 61%
  winMomentum: 0.85,    // 44%
  gravityWell: 0.8,     // 43%
  escapeInstinct: 0.8,  // 43%
  winAccel: 0.8,        // 43%
  trollCondition: 0.8,  // 43%
  hitCharge: 0.8,       // 43%
  flame: 0.75,          // 42%
  talent: 0.7,          // 40%
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
  p.losses++; p.streak = 0;
}

function winRound(p) {
  p.trollWinCost = false; p.gambleRewarded = false;
  p.wins++; p.streak++;
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
function explodeFx(b, x, y, r, color = '#ffb14d') {
  addFx(b, { type: 'ring', x, y, r0: r * 0.2, r1: r, color, dur: 0.35, boom: true });
  sparks(b, x, y, 14, color, 260);
  b.shake = Math.min(14, b.shake + r / 14);
  if (typeof SFX !== 'undefined') SFX.boom();
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
const BATTLE_TIME = 30, OVERTIME = 10, OVERTIME_RAMP = 5;

class Battle {
  constructor(mapId, players, opts = {}) {
    this.mapId = mapId;
    this.arena = new Arena(mapId);
    this.demo = !!opts.demo;
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
    this.placeFighters();
    this.phase = 'aim';           // aim → count → fight → ending
    this.countT = 0;
    this.simT = 0; this.overtime = false; this.otT = 0; this.timeScale = 1;
    this.aimTimeout = AIM_TIME;
    this.projectiles = []; this.mines = []; this.flames = []; this.stickies = [];
    this.fx = []; this.popups = []; this.particles = [];
    this.shake = 0; this.result = null; this.finished = false; this.endT = 0;
    this.inStep = false;
    this.humanAim = null;         // {active, ang} 렌더용
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
      clone.timers = {
        ...f.timers,
        actingDead: 0, dashPrep: 0, dashT: 0, fuse: 0, det: 0,
      };
      clone.cd = { ...f.cd };
      clone.gun = f.gun ? { ...f.gun, focus: false } : null;
      clone.charging = f.charging ? { ...f.charging } : null;
      clone.berserkPhase = f.berserkPhase;
      clone.pinStacks = f.pinStacks;
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
    if (this.phase === 'aim') {
      this.aimTimeout -= rdt;
      for (const f of this.fighters) {
        if (f.aimLocked) continue;
        if (f.isAI) { f.aiT -= rdt; if (f.aiT <= 0) { const a = aiChooseStartDir(this, f); this.setDir(f, a); f.aimLocked = true; } }
        // 제한시간 안에 방향을 정하지 않으면 아무 방향으로나 출발한다.
        else if (this.aimTimeout <= 0) { this.setDir(f, rand(0, TAU)); f.aimLocked = true; }
      }
      if (this.fighters.every(f => f.aimLocked)) { this.phase = 'count'; this.countT = 1.8; }
    } else if (this.phase === 'count') {
      this.countT -= rdt;
      if (this.countT <= 0) { this.phase = 'fight'; this.simT = 0; }
    } else if (this.phase === 'fight') {
      const dt = rdt * this.timeScale;
      this.simT += dt;
      if (!this.overtime && this.simT >= BATTLE_TIME) {
        this.overtime = true; this.otT = OVERTIME; this.timeScale = 1;
        for (const f of this.fighters) if (f.flags.marathoner && this.fighterAlive(f)) healFighter(this, f, (f.maxHp - f.hp) * 0.5);
      } else if (this.overtime) {
        this.otT -= rdt;
        if (this.otT <= 0) { this.timeoutResolve(); return; }
        // 연장전은 1배속에서 시작해 OVERTIME_RAMP초에 걸쳐 2배속까지 서서히 오르고,
        // 그 이후 남은 시간은 2배속을 유지한다.
        this.timeScale = 1 + Math.min(1, (OVERTIME - this.otT) / OVERTIME_RAMP);
      }
      this.step(dt);
    } else if (this.phase === 'ending') {
      this.step(rdt * 0.22);
      this.endT -= rdt;
      if (this.endT <= 0) this.finished = true;
    }
    this.updateFx(rdt);
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
      m.x += m.vx * m.spd * dt; m.y += m.vy * m.spd * dt;
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
              dealDamage(this, m.owner, body, m.dmg * m.owner.st.dmg, { kind: 'auto' });
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
      if (p.life <= 0) { projs.splice(i, 1); continue; }
      if (p.homing) {
        const tgt = this.nearestEnemyBody(p.owner);
        if (tgt && tgt !== p.owner) {
          const want = Math.atan2(tgt.y - p.y, tgt.x - p.x);
          let d = want - p.ang;
          while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
          p.ang += clamp(d, -p.homing * dt, p.homing * dt);
          p.vx = Math.cos(p.ang); p.vy = Math.sin(p.ang);
        }
      }
      const enlargedOrb = p.kind === 'orb' && !p.owner.dead && p.owner.timers.rampage > 0;
      if (p.baseR == null) p.baseR = p.r;
      p.r = p.baseR * (enlargedOrb ? 2 : 1);
      const projSpd = p.spd;
      p.x += p.vx * projSpd * dt; p.y += p.vy * projSpd * dt;
      // 벽
      if (this.arena.reflectProj(p)) {
        if (p.bounces > 0) { p.bounces--; sparks(this, p.x, p.y, 3, '#c9d6ff', 90); }
        else { sparks(this, p.x, p.y, 4, '#8a93b8', 80); projs.splice(i, 1); continue; }
      }
      // 본체 적중
      let dead = false;
      for (const e of this.enemiesOf(p.owner)) {
        for (const body of this.bodiesOf(e)) {
          if (p.hitSet && p.hitSet.has(body.uid)) continue;
          if (dist(p.x, p.y, body.x, body.y) < p.r + bodyRadius(body)) {
            projectileHit(this, p, body);
            if (p.pierce) { (p.hitSet = p.hitSet || new Set()).add(body.uid); }
            else { dead = true; }
            break;
          }
        }
        if (dead) break;
      }
      if (dead) projs.splice(i, 1);
    }
  }

  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.arm -= dt; m.t += dt;
      if (m.arm > 0) continue;
      // 자기 회복 지뢰
      if (m.owner.flags.healMine && !m.owner.mainDead && dist(m.x, m.y, m.owner.x, m.owner.y) < m.trig + m.owner.radius) {
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
    this.phase = 'ending'; this.endT = 1.1;
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
  atk *= 1 + 0.04 * f.pinStacks;
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
  if (wp.type === 'melee') {
    // 근접은 조우가 짧아 회전이 조금 빨라져도 결국 한 번 스치고 끝난다.
    // 그래서 공격속도가 오른 만큼은 두 배로 준다 (속사 하나 = 회전 +30%).
    // 반대로 느려지는 쪽(빙결·야만)은 그대로 둔다. 배로 깎으면 회전이 멈추거나 뒤집힌다.
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
    gunBarrage: T.gunBarrage, pawDrop: T.pawDrop,
  };
  for (const k in T) if (T[k] > 0) T[k] = Math.max(0, T[k] - dt);
  if (T.gunBarrage < 1e-9) T.gunBarrage = 0;
  if (prev.actingDead > 0 && T.actingDead === 0 && !f.dead) { finalDeath(b, f); return; }
  // 왁뿌볼 폭주 페이즈
  if (f.berserkPhase === 1 && T.berserk <= 0) {
    f.berserkPhase = 2;
    popup(b, f.x, f.y - f.radius - 20, '추락…', '#ff8f8f');
  }
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
    explodeAt(b, f, f.x, f.y, 100, 26 * f.st.dmg, 'auto');
    popup(b, f.x, f.y - f.radius - 24, '시한폭발!', '#ffb14d', true);
  }
  // 지뢰 원격 폭파
  if (prev.det > 0 && T.det === 0 && !f.mainDead && !f.dead) {
    const own = b.mines.filter(m => m.owner === f);
    for (const m of own) explodeMine(b, m, 1.5, 18);
    b.mines = b.mines.filter(m => m.owner !== f);
    if (own.length) popup(b, f.x, f.y - f.radius - 24, '원격 폭파!', '#ffb14d', true);
  }
  if (prev.gunBarrage > 0 && T.gunBarrage === 0 && f.gun) {
    f.gun.focus = false;
    f.gun.burst = 0;
    f.gun.shotT = 0;
    f.gun.reloadT = WEAPONS.pistol.reload;
  }
  if (prev.pawDrop > 0 && T.pawDrop === 0 && !f.mainDead && !f.dead) {
    popup(b, 0, -34, '🐾', '#ffb3d1', true);
    explodeAt(b, f, 0, 0, 90, 24 * f.st.dmg, 'auto');
  }
  // 단검 돌진 준비
  if (prev.dashPrep > 0 && T.dashPrep === 0 && f.dashPrepDir && !f.mainDead && !f.dead) {
    const nd = normDir(f.dashPrepDir.x, f.dashPrepDir.y);
    f.dash = { dx: nd.x, dy: nd.y, spd: 780, kind: 'dash' };
    T.dashT = 0.35; f.dashHit = new Set();
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
  const px = f.x, py = f.y;
  const wasRocket = f.rocketActive;
  if (f.timers.dashPrep > 0) { /* 정지 */ }
  else if (f.timers.dashT > 0 && f.dash) {
    f.x += f.dash.dx * f.dash.spd * dt;
    f.y += f.dash.dy * f.dash.spd * dt;
  }
  else if (!(f.timers.bind > 0)) {
    f.x += f.vx * f.st.move * dt;
    f.y += f.vy * f.st.move * dt;
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
          weaponDamage(b, f, e, 40);
        } else {
          dealDamage(b, f, e, 26 * f.st.dmg, { kind: 'auto' });
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
      dealDamage(b, f, body, 24 * f.st.dmg, { kind: 'auto' });
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
  if (typeof SFX !== 'undefined') SFX.bounce();
  if (f.flags.elastic) f.timers.elastic = 1;
  if (f.rocketActive) {
    f.rocketActive = false;
    popup(b, f.x, f.y - f.radius - 20, '로켓 종료', '#8ed8ff');
  }
  if (f.flags.pinball) f.pinStacks = Math.min(10, f.pinStacks + n);
  if (f.flags.wallClimb) healFighter(b, f, f.maxHp * 0.01, true);
  if (f.flags.shockwave) explodeAt(b, f, f.x, f.y, 75, 7 * f.st.dmg, 'auto', true);
  if (f.flags.reflectCharge) {
    f.bounceRun += n;
    if (f.bounceRun >= 3 && !f.charged) { f.charged = true; f.bounceRun = 0; addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 6, r1: 44, color: '#ffe08a', dur: 0.3 }); }
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
        f.timers.dashT = 0.55; f.dashHit = new Set();
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
  let dmg = 5 * a.st.dmg;
  if (a.flags.staticUp) dmg *= 1.6;
  if (a.flags.staticFast) dmg *= 0.55 + a.st.move / 320;
  dealDamage(b, a, c, dmg, { kind: 'auto' });
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
      dealDamage(b, self, other, 24 * self.st.dmg, { kind: 'auto' });
      addFx(b, { type: 'ring', x: other.x, y: other.y, r0: 8, r1: 70, color: '#8ed8ff', dur: 0.3 });
      popup(b, other.x, other.y - other.radius - 28, '로켓 관통!', '#8ed8ff', true);
    }
  }
}

function tryDashHit(b, a, c) {
  if (a.timers.dashT <= 0 || !a.dashHit || a.dashHit.has(c.uid)) return;
  if (a.dash.kind === 'dash') { weaponDamage(b, a, c, 40); }
  else dealDamage(b, a, c, 26 * a.st.dmg, { kind: 'auto' });
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

function updateCooldowns(b, f, dt) {
  f.staticCd = Math.max(0, f.staticCd - dt);
  f.collisionCd = Math.max(0, f.collisionCd - dt);
  f.flash = Math.max(0, f.flash - dt);
  f.gunFlash = Math.max(0, (f.gunFlash || 0) - dt);
}

function updateWeapon(b, f, dt) {
  if (f.mainDead || f.dead) { f.meleeContact.clear(); return; }
  if (f.timers.stun > 0) { f.meleeContact.clear(); return; }
  const wp = WEAPONS[f.weaponId];
  const fr = f.st.fr;
  // 회전하거나(근접·회전 난사) 상대를 조준하거나(그 외 원거리·지뢰) 둘 중 하나다.
  if (f.timers.weaponLock <= 0) {
    let applied;
    if (f.charging) {
      // 차지 샷은 자동 조준을 끄고 천천히 돈다. 두 바퀴 도는 동안 직접 노려서 쏜다.
      applied = BOW_CHARGE_ROT * dt;
      f.charging.spin += applied;
    } else if (f.spinRemaining > 0) {
      applied = Math.min(f.spinRemaining, TAU / 0.6 * dt);
      f.spinRemaining = Math.max(0, f.spinRemaining - applied);
    } else {
      applied = f.st.rot * dt;
    }
    if (applied === 0) {
      // 표창처럼 상대의 현재 위치를 그대로 겨눈다
      const target = b.nearestEnemyBody(f) || b.nearestEnemyMain(f);
      if (target) f.weaponAngle = Math.atan2(target.y - f.y, target.x - f.x);
    }
    f.weaponAngle = (f.weaponAngle + applied) % TAU;
    if (f.flags.swordBeam) {
      f.spinAcc += Math.abs(applied);
      if (f.spinAcc >= TAU) {
        f.spinAcc -= TAU;
        const nd = normDir(f.vx, f.vy);
        spawnProj(b, f, { kind: 'beam', x: f.x + nd.x * f.radius, y: f.y + nd.y * f.radius, ang: Math.atan2(nd.y, nd.x), spd: 430, dmg: 15, r: 12, life: 1.6, pierce: true, weapon: true });
        addFx(b, { type: 'ring', x: f.x, y: f.y, r0: 10, r1: 50, color: '#9fd0ff', dur: 0.25 });
      }
    }
  }
  // 두 바퀴를 다 돌 때까지 안 쏘면 그 자리에서 자동으로 나간다 (사용 횟수는 그대로 소비)
  if (f.charging && f.charging.spin >= TAU * BOW_CHARGE_TURNS && f.skillUses.weapon > 0) {
    if (releaseCharge(b, f)) f.skillUses.weapon--;
  }
  if (f.timers.weaponLock > 0 || f.charging) {
    // 무기 정지/충전 중에는 발사 없음 (회전만)
    if (f.timers.weaponLock <= 0 && wp.type === 'melee') meleeHits(b, f, dt);
    else f.meleeContact.clear();
    return;
  }
  if (wp.type === 'melee') {
    meleeHits(b, f, dt);
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
        fireGun(b, f);
        g.burst--;
        if (g.burst <= 0) { g.reloadT = wp.reload; g.focus = false; }
        else g.shotT = wp.shotGap;
      }
    }
  } else if (f.weaponId === 'staff') {
    f.cd.fire -= dt * fr;
    if (f.cd.fire <= 0) { f.cd.fire = wp.interval; fireStaff(b, f); }
  } else if (f.weaponId === 'mine') {
    f.cd.mine -= dt * fr;
    if (f.cd.mine <= 0 && b.mines.filter(m => m.owner === f).length < wp.maxMines) {
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
      });
    }
  }
}

/* 근접 무기는 시간 쿨다운이 아니라 접촉 상태로 재타격을 막는다.
 * 칼날 판정에 새로 들어온 순간에만 1회 피해를 주고, 칼날에서 완전히
 * 벗어났다가 다시 닿아야 다음 타격이 나간다. 칼날마다 따로 추적하므로
 * 쌍단검은 각 칼날이 독립적으로 한 번씩 맞힌다. */
function meleeHits(b, f, dt, override) {
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
        if (weaponDamage(b, f, body, def.dmg) > 0) contact.add(key);
      }
    }
  }
  f.meleeContact = contact;
}

function fireBow(b, f) {
  const wp = WEAPONS.bow;
  const angs = f.flags.triple ? [f.weaponAngle - 0.21, f.weaponAngle, f.weaponAngle + 0.21] : [f.weaponAngle];
  for (const a of angs) {
    spawnProj(b, f, { kind: 'arrow', x: f.x + Math.cos(a) * (f.radius + 8), y: f.y + Math.sin(a) * (f.radius + 8), ang: a, spd: wp.projSpeed, dmg: wp.dmg, r: 5, life: 4, homing: f.flags.homing ? 1.6 : 0, weapon: true });
  }
}

function fireGun(b, f) {
  const wp = WEAPONS.pistol;
  const angs = f.flags.dualPistol ? [f.weaponAngle, f.weaponAngle + Math.PI] : [f.weaponAngle];
  for (const a of angs) {
    spawnProj(b, f, { kind: 'bullet', x: f.x + Math.cos(a) * (f.radius + 8), y: f.y + Math.sin(a) * (f.radius + 8), ang: a, spd: wp.projSpeed, dmg: wp.dmg, r: 4, life: 2.5, weapon: true });
  }
  f.gunFlash = 0.08;
}

function fireStaff(b, f) {
  const wp = WEAPONS.staff;
  const angs = f.flags.tripleMagic ? [f.weaponAngle - 0.24, f.weaponAngle, f.weaponAngle + 0.24] : [f.weaponAngle];
  const bounce = wp.bounces + (f.flags.doubleReflect ? 1 : 0);
  for (const a of angs) {
    spawnProj(b, f, { kind: 'orb', x: f.x + Math.cos(a) * (f.radius + 10), y: f.y + Math.sin(a) * (f.radius + 10), ang: a, spd: wp.projSpeed, dmg: wp.dmg, r: 9, life: 7, bounces: bounce, weapon: true });
  }
}

function releaseCharge(b, f) {
  if (!f.charging || f.charging.t < 1) return false;
  spawnProj(b, f, {
    kind: 'charge', x: f.x + Math.cos(f.weaponAngle) * (f.radius + 10), y: f.y + Math.sin(f.weaponAngle) * (f.radius + 10),
    ang: f.weaponAngle, spd: 580, dmg: 30, r: 8, life: 3, pierce: true, pierceObstacles: true, weapon: true,
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
  b.projectiles.push(o);
  return o;
}

function projectileHit(b, p, body) {
  const owner = p.owner;
  const dealt = p.weapon
    ? weaponDamage(b, owner, body, p.dmg)
    : dealDamage(b, owner, body, p.dmg * owner.st.dmg, { kind: 'auto', autoType: p.kind });
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

function weaponDamage(b, f, body, baseDmg) {
  let mult = 1;
  if (f.charged) { f.charged = false; f.bounceRun = 0; mult *= 1.3; addFx(b, { type: 'ring', x: body.x, y: body.y, r0: 8, r1: 50, color: '#ffe08a', dur: 0.25 }); }
  if (f.counterReady) { f.counterReady = false; mult *= 1.3; }
  if (f.flags.mark) {
    const n = (f.markHits.get(body.uid) || 0) + 1;
    f.markHits.set(body.uid, n >= 5 ? 0 : n);
    if (n >= 5) { mult *= 1.5; popup(b, body.x, body.y - bodyRadius(body) - 40, '표식 발동!', '#ffd24d'); }
  }
  const raw = baseDmg * f.st.atk * f.st.dmg * mult;
  const dealt = dealDamage(b, f, body, raw, { kind: 'weapon' });
  if (dealt > 0) onWeaponHitEffects(b, f, body);
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
    if (f.flags.frost) body.frost = { n: Math.min(3, body.frost.n + 1), t: 3 };
  }
  if (f.flags.warmonger) f.warmStacks = Math.min(5, f.warmStacks + 1);
  if (f.flags.rotMomentum) f.rotStacks = Math.min(8, f.rotStacks + 1);
  if (f.flags.chase) f.timers.chase = 3;
  if (f.flags.vampiric) healFighter(b, f, f.maxHp * 0.05, true);
  if (f.flags.dualPhase) f.timers.untouchable = Math.max(f.timers.untouchable, 1);
  if (f.flags.pinball) f.pinStacks = 0;
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
      if (did) popup(b, f.x, f.y - f.radius - 30, '수면 가스!', '#b7e6d2');
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
      if (did) popup(b, f.x, f.y - f.radius - 30, '중력장!', '#8ef');
    }
  }
}

function updateSatellites(b, f, dt) {
  if (f.mainDead || f.dead) return;
  for (const s of f.satellites) {
    s.ang += 2.7 * dt;
    s.cd = Math.max(0, s.cd - dt);
    const sx = f.x + Math.cos(s.ang) * (f.radius + 42);
    const sy = f.y + Math.sin(s.ang) * (f.radius + 42);
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
    for (let i = 0; i < 2; i++) {
      const cx = tx + rand(-130, 130), cy = ty + rand(-130, 130);
      boltFx(b, tx, ty, cx, cy);
      for (const ef of b.enemiesOf(f)) {
        for (const body of b.bodiesOf(ef)) {
          if (dist(cx, cy, body.x, body.y) < 36 + bodyRadius(body)) dealDamage(b, f, body, 6 * f.st.dmg, { kind: 'auto', autoType: 'lightning' });
        }
      }
    }
  }
}

/* ---------------- 지뢰/폭발 ---------------- */
function explodeMine(b, m, scale = 1, damage = m.dmg) {
  const R = m.blast * scale;
  explodeFx(b, m.x, m.y, R);
  for (const e of b.enemiesOf(m.owner)) {
    for (const body of b.bodiesOf(e)) {
      if (dist(m.x, m.y, body.x, body.y) < R + bodyRadius(body)) {
        weaponDamage(b, m.owner, body, damage);
        if (m.owner.flags.freezeMine && body.kind === 'main') body.timers.freeze = 2;
      }
    }
  }
}
function explodeAt(b, src, x, y, radius, dmg, kind, small) {
  if (small) addFx(b, { type: 'ring', x, y, r0: radius * 0.3, r1: radius, color: '#8ea6ff', dur: 0.25 });
  else explodeFx(b, x, y, radius);
  for (const e of b.enemiesOf(src)) {
    for (const body of b.bodiesOf(e)) {
      if (dist(x, y, body.x, body.y) < radius + bodyRadius(body)) dealDamage(b, src, body, dmg, { kind });
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
    popup(b, f.x, f.y - f.radius - 30, '마지막 저항!', '#ffd24d', true);
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
  if (t.timers.immune > 0 || t.timers.untouchable > 0) {
    if (Math.random() < 0.3) popup(b, body.x, body.y - br - 10, '면역', '#7fd8ff');
    return 0;
  }
  let dmg = raw;
  if (t.flags.ironDefense && b.simT < 5) dmg *= 0.6;
  dmg *= (t.perm.dmgTaken || 1);
  if (actorBody && t.shield > 0) {
    const ab = Math.min(t.shield, dmg);
    t.shield -= ab; dmg -= ab;
    if (ab > 0) popup(b, body.x + rand(-8, 8), body.y - br - 6, '보호막', '#7fd8ff');
  }
  body.hp -= dmg;
  if (actorBody) resolveHealthThresholds(b, t);
  if (src && src.player) src.player.totalDmg = (src.player.totalDmg || 0) + dmg;
  const val = Math.max(1, Math.round(dmg));
  popup(b, body.x + rand(-10, 10), body.y - br - 4, val, opts.kind === 'auto' ? '#c9d6ff' : '#ffffff');
  if (typeof SFX !== 'undefined') SFX.hit();
  sparks(b, body.x, body.y, 4, '#ffb0b0', 130);
  if (actorBody) {
    t.flash = 0.12;
    if (t.flags.counter) t.counterReady = true;
    if (t.flags.hitCharge) t.hitChargeStacks = Math.min(5, t.hitChargeStacks + 1);
    if (t.tracking) t.tracking.bounces = 0;
    b.shake = Math.min(10, b.shake + 2);
  }
  if (src && src.flags && src.flags.lifesteal) healFighter(b, src, dmg * src.flags.lifesteal, true);
  if (body.hp <= 0 && !body.downPending) { body.downPending = true; killBody(b, body, src); }
  return dmg;
}

function healFighter(b, f, amount, quiet) {
  if (f.mainDead || f.dead || amount <= 0) return;
  const before = f.hp;
  const missing = Math.max(0, f.maxHp - before);
  f.hp = Math.min(f.maxHp, f.hp + amount);
  if (!quiet && f.hp - before >= 1) popup(b, f.x, f.y - f.radius - 6, '+' + Math.round(f.hp - before), '#7dffa8');
}

function killBody(b, body, src) {
  if (body.kind === 'summon') {
    const arr = body.owner.summons;
    const i = arr.indexOf(body); if (i >= 0) arr.splice(i, 1);
    sparks(b, body.x, body.y, 10, body.owner.color, 180);
    if (body.owner.flags.minionRevenge) explodeAt(b, body.owner, body.x, body.y, 80, 20 * body.owner.st.dmg, 'auto');
    return;
  }
  if (body.kind === 'split') {
    body.hp = 0;
    if (body.flags.lastStand && !body.lastStandUsed) {
      body.lastStandUsed = true;
      body.downPending = false;
      body.timers.actingDead = 3;
      popup(b, body.x, body.y - 40, '최후의 3초!', '#ff8f8f', true);
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
    explodeFx(b, f.x, f.y, 70, f.color);
    b.checkEnd();
    return;
  }
  if (f.flags.lastStand && !f.lastStandUsed) {
    f.lastStandUsed = true;
    f.timers.actingDead = 3;
    popup(b, f.x, f.y - 40, '최후의 3초!', '#ff8f8f', true);
    return;
  }
  finalDeath(b, f);
}

function finalDeath(b, f) {
  if (f.dead) return;
  f.dead = true;
  f.deathAt = b.simT;
  explodeFx(b, f.x, f.y, 90, f.color);
  if (f.kind === 'split') {
    const root = f.owner;
    const i = root.splitBalls.indexOf(f);
    if (i >= 0) {
      // 효과음 누적 횟수를 본체로 옮긴다. 배열에서 빠지면서 합계가 줄면
      // 멀티에서 마지막 순간의 튕김·스킬 소리가 사라진다.
      root.bounceTotal += f.bounceTotal;
      root.sfxSkill += f.sfxSkill;
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
function useSkill(b, f, slot) {
  // After splitting, the surviving copies are the player's controllable body.
  // Remaining uses are shared, so one input can never duplicate an active.
  if (f.mainDead && f.splitBalls && f.splitBalls.length) {
    const active = f.splitBalls.find(s => !s.dead);
    if (active) f = active;
  }
  if (b.phase !== 'fight' || f.dead || f.mainDead || f.timers.stun > 0) return false;
  // 활은 첫 입력으로 충전하고, 두 번째 입력으로 발사할 때 사용 횟수를 소비한다.
  if (slot === 'weapon' && f.weaponId === 'bow' && f.charging) {
    if (f.skillUses.weapon <= 0 || !releaseCharge(b, f)) return false;
    f.skillUses.weapon--;
    f.sfxSkill++;
    if (typeof SFX !== 'undefined' && SFX.skill) SFX.skill();
    return true;
  }
  if (f.skillUses[slot] <= 0) return false;
  const commonId = f.player.copiedSkill || 'direction';
  const id = slot === 'char' ? f.charId : slot === 'weapon' ? f.weaponId : commonId;
  switch (id) {
    case 'direction':
      f.pendingAim = true;   // 드래그로 발동 (소비는 발동 시)
      return 'aim';
    case 'cat': {
      if (slot === 'common' && f.player.copiedSkill === 'cat') {
        f.timers.pawDrop = 1;
        popup(b, 0, -34, '🐾 1초 후', '#ffb3d1', true);
        break;
      }
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
      explodeFx(b, f.x, f.y, 60, '#ffa94d');
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
      if (typeof SFX !== 'undefined' && SFX.skill) SFX.skill();
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
    case 'mine':
      f.timers.det = 1;
      popup(b, f.x, f.y - f.radius - 24, '폭파 예약…', '#ffb14d');
      break;
  }
  f.skillUses[slot]--;
  f.sfxSkill++;
  if (typeof SFX !== 'undefined' && SFX.skill) SFX.skill();
  return true;
}

function applyCommonAim(b, f, ang) {
  if (f.mainDead && f.splitBalls && f.splitBalls.length) {
    const active = f.splitBalls.find(s => !s.dead);
    if (active) f = active;
  }
  if (f.skillUses.common <= 0 || f.timers.stun > 0) return false;
  f.skillUses.common--;
  b.setDir(f, ang);
  f.pendingAim = false;
  addFx(b, { type: 'ring', x: f.x, y: f.y, r0: f.radius, r1: f.radius + 40, color: '#ffd24d', dur: 0.3 });
  popup(b, f.x, f.y - f.radius - 20, '방향 전환!', '#ffd24d');
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

function aiUpdate(b, f, dt) {
  if (b.phase !== 'fight' || f.dead || f.mainDead || f.timers.stun > 0) return;
  // 차지 샷 조준만은 판단 주기와 따로, 매 프레임 본다.
  // 활은 두 바퀴 도는 동안 상대와 겹치는 순간이 0.1초 남짓이라
  // 0.2~0.4초마다 보는 일반 판단으로는 절반 넘게 그냥 지나쳐 버린다.
  if (f.charging && f.charging.t >= 1 && f.skillUses.weapon > 0) {
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
  const use = slot => useSkill(b, f, slot);
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
  if (f.skillUses.common > 0) {
    const cid = f.player.copiedSkill;
    if (cid) { if (charHeur(cid)) use('common'); }
    else {
      // 방향 전환
      if (wp.type === 'melee' && d > 240) {
        f.skillUses.common--;
        const lead = clamp(d / 300, 0, 1) * 0.6;
        b.setDir(f, Math.atan2(e.y + e.vy * 170 * lead - f.y, e.x + e.vx * 170 * lead - f.x));
        addFx(b, { type: 'ring', x: f.x, y: f.y, r0: f.radius, r1: f.radius + 36, color: f.color, dur: 0.3 });
      } else if ((wp.type === 'ranged' || f.weaponId === 'mine') && d < 140) {
        f.skillUses.common--;
        b.setDir(f, Math.atan2(f.y - e.y, f.x - e.x) + rand(-0.4, 0.4));
        addFx(b, { type: 'ring', x: f.x, y: f.y, r0: f.radius, r1: f.radius + 36, color: f.color, dur: 0.3 });
      }
    }
  }
  // 무기 스킬
  if (f.skillUses.weapon > 0) {
    const angToE = Math.atan2(e.y - f.y, e.x - f.x);
    let diff = f.weaponAngle - angToE;
    while (diff > Math.PI) diff -= TAU; while (diff < -Math.PI) diff += TAU;
    switch (f.weaponId) {
      case 'sword': if (d < f.radius + wp.reach * weaponScale(f) + 55) use('weapon'); break;
      case 'dagger': if (d > 130 && d < 430) use('weapon'); break;
      case 'bow':
        // 발사는 위쪽 매 프레임 조준 검사가 맡는다. 여기서는 충전 시작만 판단한다.
        if (!f.charging && d < 520) use('weapon');
        break;
      case 'pistol': if (d < 430 && Math.abs(diff) < 0.5) use('weapon'); break;
      case 'staff': if (b.simT > 7 || eHpP < 0.45) use('weapon'); break;
      case 'mine': {
        const near = b.mines.some(m => m.owner === f && dist(m.x, m.y, e.x, e.y) < 150);
        if (near) use('weapon');
        break;
      }
    }
  }
  // 차지 완료 후 각도 맞춰 발사 (무기 스킬 사용으로 처리됨)
}
