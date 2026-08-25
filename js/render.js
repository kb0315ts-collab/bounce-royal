'use strict';
/* ============================================================
 * 바운스 로얄 — 렌더러 (Canvas 2D)
 * ============================================================ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let VIEW = { s: 1, cx: 0, cy: 0, w: 0, h: 0, ox: 0, oy: 0 };

// 화면 구성은 반응형 9:16으로 유지하되 Canvas의 실제 픽셀 예산은
// 전체 화면 720×1280을 넘지 않게 제한한다. 물리/레이아웃 좌표에는 영향이 없다.
const DISPLAY_TARGET = Object.freeze({ width: 720, height: 1280, maxDpr: 2 });
function getRenderPixelRatio() {
  const app = document.getElementById('app');
  const nativeDpr = Math.min(DISPLAY_TARGET.maxDpr, Math.max(0.1, window.devicePixelRatio || 1));
  if (!app?.clientWidth || !app?.clientHeight) return nativeDpr;
  return Math.min(
    nativeDpr,
    DISPLAY_TARGET.width / app.clientWidth,
    DISPLAY_TARGET.height / app.clientHeight,
  );
}
window.BounceRoyalDisplay = Object.freeze({
  width: DISPLAY_TARGET.width,
  height: DISPLAY_TARGET.height,
  pixelRatio: getRenderPixelRatio,
});

function resizeCanvas() {
  const dpr = getRenderPixelRatio();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = Math.min(w, h) / 840;
  VIEW = { s, w, h, ox: (w - 840 * s) / 2, oy: (h - 840 * s) / 2 };
}
window.addEventListener('resize', resizeCanvas);

function toScreen(x, y) { return { x: VIEW.ox + (420 + x) * VIEW.s, y: VIEW.oy + (420 + y) * VIEW.s }; }

/* ---------------- 배경 ---------------- */
function drawBackdrop() {
  const { w, h } = VIEW;
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 60, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#101830');
  g.addColorStop(0.55, '#0a0f20');
  g.addColorStop(1, '#05070f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 별
  if (!drawBackdrop.stars) {
    drawBackdrop.stars = [];
    for (let i = 0; i < 70; i++) drawBackdrop.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, p: Math.random() * TAU });
  }
  const t = performance.now() / 1000;
  for (const s of drawBackdrop.stars) {
    ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 1.5 + s.p);
    ctx.fillStyle = '#9fb4e8';
    ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- 경기장 ---------------- */
/* 주의: 호출부(renderBattle)에서 이미 중심 원점 좌표계로 변환되어 있다 */
function drawArena(b) {
  const A = b.arena;
  // 은은한 격자
  ctx.strokeStyle = 'rgba(90,110,180,.07)';
  ctx.lineWidth = 1;
  for (let i = -360; i <= 360; i += 80) {
    ctx.beginPath(); ctx.moveTo(i, -360); ctx.lineTo(i, 360); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-360, i); ctx.lineTo(360, i); ctx.stroke();
  }
  if (A.type === 'diamond') {
    const L = A.L;
    ctx.beginPath();
    ctx.moveTo(0, -L); ctx.lineTo(L, 0); ctx.lineTo(0, L); ctx.lineTo(-L, 0); ctx.closePath();
    ctx.fillStyle = 'rgba(16,24,48,.55)'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = '#2c3d6e'; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(120,160,255,.55)';
    ctx.shadowColor = 'rgba(100,140,255,.5)'; ctx.shadowBlur = 18;
    ctx.stroke(); ctx.shadowBlur = 0;
  } else if (A.type === 'circle') {
    ctx.beginPath(); ctx.arc(0, 0, A.R, 0, TAU);
    ctx.fillStyle = 'rgba(16,24,48,.55)'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = '#2c3d6e'; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(120,160,255,.55)';
    ctx.shadowColor = 'rgba(100,140,255,.5)'; ctx.shadowBlur = 18;
    ctx.stroke(); ctx.shadowBlur = 0;
  } else {
    const H = A.H;
    ctx.fillStyle = 'rgba(16,24,48,.55)';
    ctx.fillRect(-H, -H, H * 2, H * 2);
    ctx.lineWidth = 7; ctx.strokeStyle = '#2c3d6e';
    ctx.strokeRect(-H, -H, H * 2, H * 2);
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(120,160,255,.55)';
    ctx.shadowColor = 'rgba(100,140,255,.5)'; ctx.shadowBlur = 18;
    ctx.strokeRect(-H, -H, H * 2, H * 2); ctx.shadowBlur = 0;
  }
  for (const p of A.pillars) {
    const g = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.2, p.x, p.y, p.r);
    g.addColorStop(0, '#3a4a80'); g.addColorStop(1, '#1a2340');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(120,160,255,.5)'; ctx.stroke();
  }
  // 파워업 큐브
  if (A.cube && A.cube.active) {
    const c = A.cube, t = performance.now() / 1000;
    ctx.save();
    ctx.translate(c.x, c.y + Math.sin(t * 2.2) * 8);
    ctx.rotate(c.spin);
    ctx.shadowColor = 'rgba(255,210,77,.8)'; ctx.shadowBlur = 26;
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath(); ctx.roundRect(-16, -16, 32, 32, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#8a6410';
    ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 1);
    ctx.restore();
  }
}

/* ---------------- 플레이어 소유 색상 ---------------- */
function ownerPlayerColor(owner, fallback = '#b97bff') {
  const color = owner && (owner.color || (owner.player && owner.player.color));
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

/* ---------------- 지면 이펙트 ---------------- */
function drawGroundFx(b) {
  const t = performance.now() / 1000;
  for (const s of b.stickies) {
    ctx.globalAlpha = 0.4 * Math.min(1, s.life);
    ctx.fillStyle = '#63c26f';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * 0.75, 0, 0, TAU); ctx.fill();
  }
  for (const fl of b.flames) {
    const a = Math.min(1, fl.life / 0.5);
    const flick = 0.8 + 0.2 * Math.sin(t * 22 + fl.x);
    ctx.globalAlpha = 0.5 * a;
    const g = ctx.createRadialGradient(fl.x, fl.y, 2, fl.x, fl.y, fl.r * flick);
    g.addColorStop(0, '#fff3b0'); g.addColorStop(0.45, '#ff9d3c'); g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r * flick, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const m of b.mines) {
    const armed = m.arm <= 0;
    const mr = m.r || 11;
    const coreColor = ownerPlayerColor(m.owner);
    ctx.fillStyle = '#2a2030';
    ctx.beginPath(); ctx.arc(m.x, m.y, mr, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5a4a60'; ctx.lineWidth = 2; ctx.stroke();
    // 스파이크
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      ctx.beginPath(); ctx.moveTo(m.x + Math.cos(a) * mr, m.y + Math.sin(a) * mr);
      ctx.lineTo(m.x + Math.cos(a) * (mr + 5), m.y + Math.sin(a) * (mr + 5));
      ctx.strokeStyle = '#6a5a70'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    ctx.save();
    ctx.globalAlpha = armed ? 0.72 + 0.28 * Math.max(0, Math.sin(t * 10 + m.x)) : 0.42;
    ctx.fillStyle = coreColor;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = armed ? 9 : 4;
    ctx.beginPath(); ctx.arc(m.x, m.y, 3.5 * mr / 11, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ---------------- 얼굴이 아닌 캐릭터 표식 / 재질 ---------------- */
function drawBallDetails(c, charId, r, opts = {}) {
  switch (charId) {
    case 'cat': {
      c.fillStyle = '#d6739b';
      for (const [tx, ty] of [[-r * 0.34, -r * 0.36], [0, -r * 0.46], [r * 0.34, -r * 0.36]]) {
        c.beginPath(); c.arc(tx, ty, r * 0.14, 0, TAU); c.fill();
      }
      break;
    }
    case 'bball': {
      c.save(); c.rotate(opts.spin || 0);
      c.strokeStyle = 'rgba(60,30,5,.8)'; c.lineWidth = r * 0.09;
      c.beginPath(); c.arc(0, 0, r * 0.72, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.72, 0); c.lineTo(r * 0.72, 0); c.stroke();
      c.beginPath(); c.moveTo(0, -r * 0.72); c.lineTo(0, r * 0.72); c.stroke();
      c.restore();
      break;
    }
    case 'balloon': {
      c.fillStyle = 'rgba(255,255,255,.65)';
      c.beginPath(); c.ellipse(-r * 0.4, -r * 0.45, r * 0.16, r * 0.26, -0.6, 0, TAU); c.fill();
      break;
    }
  }
}

function drawBall(c, f, x, y, r, opts = {}) {
  const ch = CHARACTERS[f.charId];
  // 본체
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.2, x, y, r);
  g.addColorStop(0, lighten(ch.color, 0.25));
  g.addColorStop(1, darken(ch.color, 0.22));
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  // 테두리(플레이어 색)
  c.lineWidth = 3.5;
  c.strokeStyle = f.color;
  c.stroke();
  // 폭탄 도화선
  if (f.charId === 'bomb') {
    c.strokeStyle = '#c9b18a'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x, y - r);
    c.quadraticCurveTo(x + r * 0.35, y - r * 1.35, x + r * 0.6, y - r * 1.15);
    c.stroke();
    const t = performance.now() / 1000;
    if (Math.sin(t * 14) > -0.2) {
      c.fillStyle = '#ffd24d';
      c.beginPath(); c.arc(x + r * 0.6, y - r * 1.15, 3.5 + Math.sin(t * 20) * 1.5, 0, TAU); c.fill();
    }
  }
  c.save();
  c.translate(x, y);
  drawBallDetails(c, f.charId, r, opts);
  c.restore();
  // 피격 플래시
  if (f.flash > 0) {
    c.globalAlpha = f.flash * 5;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.globalAlpha = 1;
  }
  // 면역/무적 표시
  if (f.timers && (f.timers.immune > 0 || f.timers.untouchable > 0)) {
    c.strokeStyle = 'rgba(160,220,255,.8)'; c.lineWidth = 2.5;
    c.setLineDash([6, 5]);
    c.beginPath(); c.arc(x, y, r + 7, performance.now() / 300, performance.now() / 300 + TAU); c.stroke();
    c.setLineDash([]);
  }
  // 빙결
  if (f.timers && f.timers.freeze > 0) {
    c.fillStyle = 'rgba(140,200,255,.35)';
    c.beginPath(); c.arc(x, y, r + 3, 0, TAU); c.fill();
  }
  // 최후의 3초
  if (f.timers && f.timers.actingDead > 0) {
    c.strokeStyle = '#ff5d5d'; c.lineWidth = 3;
    c.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 90);
    c.beginPath(); c.arc(x, y, r + 8, 0, TAU); c.stroke();
    c.globalAlpha = 1;
  }
}

function lighten(hex, k) { return shade(hex, k); }
function darken(hex, k) { return shade(hex, -k); }
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= (1 + k); g *= (1 + k); b *= (1 + k); }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/* ---------------- DOM UI용 캐릭터 + 무기 초상화 ---------------- */
function drawLoadoutPortrait(target, charId, weaponId, color = '#4da6ff') {
  if (!target || !CHARACTERS[charId] || !WEAPONS[weaponId]) return;
  const c = target.getContext('2d');
  const dpr = getRenderPixelRatio();
  const w = Math.max(96, target.clientWidth || 180);
  const h = Math.max(72, target.clientHeight || 130);
  target.width = Math.round(w * dpr);
  target.height = Math.round(h * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const bg = c.createRadialGradient(w * 0.42, h * 0.5, 4, w * 0.5, h * 0.58, Math.max(w, h) * 0.65);
  bg.addColorStop(0, 'rgba(77,166,255,.2)');
  bg.addColorStop(1, 'rgba(7,10,20,0)');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);

  const scale = Math.min(w / 180, h / 130);
  const lw = w / scale, lh = h / scale;
  c.save();
  c.scale(scale, scale);
  const f = {
    charId, weaponId, color,
    x: lw * 0.39, y: lh * 0.59, radius: 27,
    vx: 1, vy: 0, weaponAngle: -0.38,
    mainDead: false, flash: 0, gunFlash: 0, charging: null,
    flags: {}, timers: { balloon: 0, rampage: 0, immune: 0, untouchable: 0, freeze: 0, actingDead: 0 },
  };
  drawWeapon(c, f);
  drawBall(c, f, f.x, f.y, f.radius);
  c.restore();
}

/* ---------------- 무기 ---------------- */
function drawWeapon(c, f) {
  if (f.mainDead || f.timers.stun > 0) return;
  const ws = weaponScale(f);
  const ang = f.weaponAngle;
  const R = f.radius;
  c.save();
  c.translate(f.x, f.y);
  c.rotate(ang);
  switch (f.weaponId) {
    case 'sword': case 'dagger': {
      const bladeLen = WEAPONS[f.weaponId].reach * ws;
      const w = (f.weaponId === 'sword' ? 13 : 9) * ws;
      // 손잡이
      c.fillStyle = '#5a4030';
      c.fillRect(R * 0.35, -3.5, 12, 7);
      // 가드
      c.fillStyle = '#c9a23f';
      c.fillRect(R * 0.55, -w * 0.7, 5, w * 1.4);
      // 검신
      const bg = c.createLinearGradient(0, -w / 2, 0, w / 2);
      bg.addColorStop(0, '#f2f6ff'); bg.addColorStop(0.5, '#c3cfe6'); bg.addColorStop(1, '#8d9cbf');
      c.fillStyle = bg;
      c.beginPath();
      c.moveTo(R * 0.55 + 5, -w / 2);
      c.lineTo(R * 0.55 + 5 + bladeLen * 0.82, -w / 2);
      c.lineTo(R * 0.55 + 5 + bladeLen, 0);
      c.lineTo(R * 0.55 + 5 + bladeLen * 0.82, w / 2);
      c.lineTo(R * 0.55 + 5, w / 2);
      c.closePath(); c.fill();
      if (f.flags.giantBlade) { c.strokeStyle = 'rgba(255,210,77,.7)'; c.lineWidth = 2; c.stroke(); }
      // 쌍단검 뒤쪽
      if (f.flags.dualDagger) {
        c.rotate(Math.PI);
        c.fillStyle = '#5a4030'; c.fillRect(R * 0.35, -3, 10, 6);
        c.fillStyle = '#c3cfe6';
        c.beginPath();
        c.moveTo(R * 0.5, -w / 2); c.lineTo(R * 0.5 + bladeLen * 0.85, 0); c.lineTo(R * 0.5, w / 2);
        c.closePath(); c.fill();
      }
      break;
    }
    case 'bow': {
      c.translate(R + 16, 0);
      c.strokeStyle = '#a5743c'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.arc(-6, 0, 20, -Math.PI * 0.42, Math.PI * 0.42); c.stroke();
      c.strokeStyle = '#e8e0c8'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(-6 + 20 * Math.cos(-Math.PI * 0.42), 20 * Math.sin(-Math.PI * 0.42));
      c.lineTo(f.charging ? -14 - Math.min(10, f.charging.t * 10) : -10, 0);
      c.lineTo(-6 + 20 * Math.cos(Math.PI * 0.42), 20 * Math.sin(Math.PI * 0.42));
      c.stroke();
      // 시위 위 화살
      c.strokeStyle = '#d8cca8'; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(-14, 0); c.lineTo(16, 0); c.stroke();
      if (f.charging) {
        const k = Math.min(1, f.charging.t);
        c.fillStyle = `rgba(255,220,110,${0.35 + 0.5 * k})`;
        c.beginPath(); c.arc(0, 0, 6 + k * 8, 0, TAU); c.fill();
      }
      break;
    }
    case 'pistol': {
      if (f.flags.bayonet && f.gun && f.gun.reloadT > 0) {
        const bladeLen = 30 * ws, w = 9 * ws;
        c.fillStyle = '#5a4030'; c.fillRect(R * 0.35, -3.5, 12, 7);
        c.fillStyle = '#c9a23f'; c.fillRect(R * 0.55, -w * 0.7, 5, w * 1.4);
        const bg = c.createLinearGradient(0, -w / 2, 0, w / 2);
        bg.addColorStop(0, '#f2f6ff'); bg.addColorStop(0.5, '#c3cfe6'); bg.addColorStop(1, '#8d9cbf');
        c.fillStyle = bg; c.beginPath();
        c.moveTo(R * 0.55 + 5, -w / 2);
        c.lineTo(R * 0.55 + 5 + bladeLen * 0.82, -w / 2);
        c.lineTo(R * 0.55 + 5 + bladeLen, 0);
        c.lineTo(R * 0.55 + 5 + bladeLen * 0.82, w / 2);
        c.lineTo(R * 0.55 + 5, w / 2); c.closePath(); c.fill();
        break;
      }
      c.fillStyle = '#3a4258';
      c.fillRect(R * 0.6, -5, 30, 10);
      c.fillStyle = '#20242f';
      c.fillRect(R * 0.6 + 6, 3, 8, 10);
      c.fillStyle = '#565f7a';
      c.fillRect(R * 0.6 + 22, -6, 8, 5);
      if (f.gunFlash > 0) {
        c.fillStyle = 'rgba(255,220,110,.9)';
        c.beginPath();
        c.arc(R * 0.6 + 34, 0, 9, 0, TAU); c.fill();
      }
      if (f.flags.dualPistol) {
        c.rotate(Math.PI);
        c.fillStyle = '#3a4258';
        c.fillRect(R * 0.6, -5, 30, 10);
      }
      break;
    }
    case 'staff': {
      c.strokeStyle = '#7a5a3a'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(R * 0.3, 0); c.lineTo(R + 42 * ws, 0); c.stroke();
      const t = performance.now() / 1000;
      const orbR = (8 + Math.sin(t * 5) * 1.5) * ws * (f.timers.rampage > 0 ? 2 : 1);
      c.shadowColor = '#b97bff'; c.shadowBlur = 16;
      c.fillStyle = f.timers.rampage > 0 ? '#e3c8ff' : '#c9a0ff';
      c.beginPath(); c.arc(R + 42 * ws + 6, 0, orbR, 0, TAU); c.fill();
      c.shadowBlur = 0;
      break;
    }
    case 'mine': {
      c.fillStyle = '#4a4050';
      c.beginPath(); c.arc(R * 0.55, 0, 6, 0, TAU); c.fill();
      c.strokeStyle = '#7a6a80'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(R * 0.55, 0); c.lineTo(R * 0.55 + 10, -8); c.stroke();
      break;
    }
  }
  c.restore();
}

/* ---------------- 투사체 ---------------- */
function drawProjectiles(b) {
  const t = performance.now() / 1000;
  for (const p of b.projectiles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang);
    switch (p.kind) {
      case 'arrow': case 'charge': {
        const big = p.kind === 'charge';
        const scale = p.r / (big ? 8 : 5);
        ctx.scale(scale, scale);
        const L = big ? 30 : 17;
        ctx.strokeStyle = big ? '#ffd24d' : '#e0d6b0';
        ctx.lineWidth = big ? 4 : 2.5;
        ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L * 0.5, 0); ctx.stroke();
        ctx.fillStyle = big ? '#ffe9a0' : '#f2f2f2';
        ctx.beginPath(); ctx.moveTo(L * 0.75, 0); ctx.lineTo(L * 0.3, -4.5); ctx.lineTo(L * 0.3, 4.5); ctx.closePath(); ctx.fill();
        if (big) { ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 14; ctx.fill(); }
        break;
      }
      case 'bullet': {
        ctx.scale(p.r / 4, p.r / 4);
        ctx.fillStyle = '#ffe08a';
        ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 3, 0, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
      case 'orb': {
        const body = ownerPlayerColor(p.owner);
        const core = lighten(body, 0.62);
        const edge = hexA(darken(body, 0.2), 0);
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, p.r + 6);
        g.addColorStop(0, core); g.addColorStop(0.4, body); g.addColorStop(1, edge);
        ctx.fillStyle = g;
        ctx.shadowColor = body;
        ctx.shadowBlur = 13;
        ctx.beginPath(); ctx.arc(0, 0, p.r + 6, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
      case 'missile': {
        ctx.fillStyle = '#c3cfe6';
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -4.5); ctx.lineTo(-6, 4.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(255,${140 + Math.sin(t * 40) * 60},60,.95)`;
        ctx.beginPath(); ctx.ellipse(-9, 0, 6 + Math.sin(t * 50) * 2, 3, 0, 0, TAU); ctx.fill();
        break;
      }
      case 'shuriken': {
        ctx.rotate(t * 18);
        ctx.fillStyle = '#dfe6f5';
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath(); ctx.moveTo(0, -2.5); ctx.lineTo(9, 0); ctx.lineTo(0, 2.5); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#565f7a';
        ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
        break;
      }
      case 'beam': {
        ctx.scale(p.r / 6, p.r / 6);
        ctx.shadowColor = '#9fd0ff'; ctx.shadowBlur = 12;
        const g = ctx.createLinearGradient(-26, 0, 20, 0);
        g.addColorStop(0, 'rgba(160,200,255,0)'); g.addColorStop(0.7, '#cfe4ff'); g.addColorStop(1, '#ffffff');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-26, -5); ctx.lineTo(-26, 5); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
    }
    ctx.restore();
  }
}

/* ---------------- 이펙트 ---------------- */
function drawFx(b) {
  for (const e of b.fx) {
    const k = e.t / (e.dur || 0.4);
    if (e.type === 'ring') {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 3.5 * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r0 + (e.r1 - e.r0) * k, 0, TAU);
      ctx.stroke();
    } else if (e.type === 'bolt') {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = e.color;
      ctx.shadowColor = '#aee3ff'; ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.segs[0].x, e.segs[0].y);
      for (let i = 1; i < e.segs.length; i++) ctx.lineTo(e.segs[i].x, e.segs[i].y);
      ctx.stroke();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
  for (const p of b.particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const p of b.popups) {
    ctx.globalAlpha = Math.min(1, p.t * 2.5);
    ctx.font = (p.big ? 'bold 22px' : 'bold 15px') + " 'Jua',sans-serif";
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
    ctx.strokeText(p.txt, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.txt, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- HP 바 / 이름 ---------------- */
function drawUnitUI(b) {
  ctx.textAlign = 'center';
  for (const f of b.fighters) {
    // 위성체
    if (!f.mainDead && !f.dead) {
      for (const s of f.satellites) {
        const sx = f.x + Math.cos(s.ang) * (f.radius + 42), sy = f.y + Math.sin(s.ang) * (f.radius + 42);
        ctx.fillStyle = '#9fd0ff';
        ctx.shadowColor = '#9fd0ff'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    // 소환수/분열체 UI 없음 (본체만)
    if (f.mainDead || f.dead) continue;
    const barW = 68, x = f.x - barW / 2, y = f.y - f.radius - 26;
    // 이름
    ctx.font = "13px 'Jua',sans-serif";
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText(f.name, f.x, y - 6);
    ctx.fillStyle = f.color;
    ctx.fillText(f.name, f.x, y - 6);
    // HP
    const pct = clamp(f.hp / f.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(8,10,20,.8)';
    ctx.beginPath(); ctx.roundRect(x - 1.5, y - 1.5, barW + 3, 9, 4); ctx.fill();
    ctx.fillStyle = pct > 0.5 ? '#6bd968' : pct > 0.25 ? '#ffd24d' : '#ff6b6b';
    ctx.beginPath(); ctx.roundRect(x, y, barW * pct, 6, 3); ctx.fill();
    if (f.shield > 0) {
      ctx.fillStyle = 'rgba(127,216,255,.85)';
      ctx.beginPath(); ctx.roundRect(x, y, barW * clamp(f.shield / f.maxHp, 0, 1), 6, 3); ctx.fill();
    }
    // 상태 아이콘
    let sx = x - 4;
    const putIcon = (txt, col) => { ctx.font = '11px sans-serif'; ctx.fillStyle = col; ctx.fillText(txt, sx + 6, y + 18); sx += 14; };
    if (f.timers.freeze > 0) putIcon('❄', '#9fd8ff');
    if (f.timers.bind > 0) putIcon('⛓', '#c9a0ff');
    if (f.timers.stun > 0) putIcon('💤', '#b7e6d2');
    if (f.timers.immune > 0 || f.timers.untouchable > 0) putIcon('✦', '#7fd8ff');
    if (f.bleed.n > 0) putIcon('🩸', '#ff7d7d');
    if (f.charged) putIcon('⚡', '#ffe08a');
    if (f.tracking) putIcon('3️⃣', '#ffd24d');
    if (f.berserkPhase === 1) putIcon('💢', '#ffa94d');
  }
}

/* ---------------- 조준 표시 ---------------- */
function drawArrow(c, x, y, ang, len, color, width) {
  c.save();
  c.translate(x, y); c.rotate(ang);
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round';
  c.shadowColor = color; c.shadowBlur = 10;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(len, 0); c.stroke();
  c.beginPath(); c.moveTo(len + 12, 0); c.lineTo(len - 4, -8); c.lineTo(len - 4, 8); c.closePath();
  c.fillStyle = color; c.fill();
  c.shadowBlur = 0;
  c.restore();
}

function drawAimUI(b) {
  const t = performance.now() / 1000;
  if (b.phase === 'aim' || b.phase === 'count') {
    for (const f of b.fighters) {
      if (f.aimLocked) drawArrow(ctx, f.x, f.y, Math.atan2(f.vy, f.vx), 52, hexA(f.color, 0.55), 3);
      else drawArrow(ctx, f.x, f.y, Math.atan2(f.vy, f.vx), 44 + Math.sin(t * 5) * 8, hexA(f.color, 0.9), 3);
    }
  }
  const human = b.human();
  // 인간 드래그 조준 (최초 or 방향 전환)
  if (human && b.humanAim && b.humanAim.active) {
    const f = human;
    const ang = b.humanAim.ang;
    const isCommon = b.phase === 'fight';
    const col = isCommon ? '#ffd24d' : '#4da6ff';
    drawArrow(ctx, f.x, f.y, ang, 80, col, 4.5);
    // 예상 궤적 (첫 반사까지)
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hit = b.arena.castRay(f.x, f.y, dx, dy, f.radius);
    ctx.setLineDash([8, 9]);
    ctx.strokeStyle = hexA(col, 0.55); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(f.x + dx * (f.radius + 14), f.y + dy * (f.radius + 14));
    if (hit) {
      ctx.lineTo(hit.x, hit.y);
      const dot = dx * hit.nx + dy * hit.ny;
      const rx = dx - 2 * dot * hit.nx, ry = dy - 2 * dot * hit.ny;
      ctx.lineTo(hit.x + rx * 120, hit.y + ry * 120);
    } else ctx.lineTo(f.x + dx * 300, f.y + dy * 300);
    ctx.stroke();
    ctx.setLineDash([]);
    if (hit) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(hit.x, hit.y, 5, 0, TAU); ctx.fill();
    }
  }
  // 대기 중 인간 안내
  if (b.phase === 'aim' && human && !human.aimLocked && !(b.humanAim && b.humanAim.active)) {
    ctx.font = "17px 'Jua',sans-serif";
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * Math.sin(t * 4)})`;
    ctx.fillText('드래그로 방향을 조준하고 손을 놓으세요', human.x, human.y - human.radius - 48);
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------------- 전체 렌더 ---------------- */
function renderBattle(b, now) {
  resizeCanvas();
  drawBackdrop();
  if (!b) return;
  ctx.save();
  // 카메라 셰이크
  const sh = b.shake;
  ctx.translate(rand(-sh, sh), rand(-sh, sh));
  ctx.translate(VIEW.ox + 420 * VIEW.s, VIEW.oy + 420 * VIEW.s);
  ctx.scale(VIEW.s, VIEW.s);

  drawArena(b);
  drawGroundFx(b);

  // 꼬마볼은 얼굴 없는 단순 구체로, 분열체는 원본과 같은 완전한 전투체로 그린다.
  for (const f of b.fighters) {
    for (const m of f.summons) {
      ctx.save();
      ctx.translate(m.x, m.y);
      const g = ctx.createRadialGradient(-m.r * 0.3, -m.r * 0.35, m.r * 0.2, 0, 0, m.r);
      g.addColorStop(0, lighten(f.color, 0.3)); g.addColorStop(1, darken(f.color, 0.25));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, m.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();

      const y = m.y - m.r - 12;
      ctx.fillStyle = 'rgba(8,10,20,.7)';
      ctx.fillRect(m.x - 14, y, 28, 4);
      ctx.fillStyle = '#6bd968';
      ctx.fillRect(m.x - 14, y, 28 * clamp(m.hp / m.maxHp, 0, 1), 4);
    }

    for (const clone of f.splitBalls) {
      if (clone.dead) continue;
      drawWeapon(ctx, clone);
      drawBall(ctx, clone, clone.x, clone.y, clone.radius, { spin: clone.weaponAngle });

      const barW = Math.max(32, clone.radius * 1.5);
      const y = clone.y - clone.radius - 12;
      ctx.fillStyle = 'rgba(8,10,20,.7)';
      ctx.fillRect(clone.x - barW / 2, y, barW, 4);
      ctx.fillStyle = '#ffd24d';
      ctx.fillRect(clone.x - barW / 2, y, barW * clamp(clone.hp / clone.maxHp, 0, 1), 4);
    }
  }

  // 본체 + 무기
  for (const f of b.fighters) {
    if (f.mainDead || f.dead) continue;
    // 이동 궤적 잔상
    if (!f._trail) f._trail = [];
    f._trail.push({ x: f.x, y: f.y });
    if (f._trail.length > 9) f._trail.shift();
    if (b.phase === 'fight') {
      for (let i = 0; i < f._trail.length - 1; i++) {
        ctx.globalAlpha = 0.05 + 0.02 * i;
        ctx.strokeStyle = f.color; ctx.lineWidth = f.radius * 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(f._trail[i].x, f._trail[i].y); ctx.lineTo(f._trail[i + 1].x, f._trail[i + 1].y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    drawWeapon(ctx, f);
    drawBall(ctx, f, f.x, f.y, f.radius, { spin: f.weaponAngle });
  }

  drawProjectiles(b);
  drawFx(b);
  drawUnitUI(b);
  drawAimUI(b);

  // 카운트다운
  if (b.phase === 'count') {
    const n = Math.ceil(b.countT - 0.0001);
    ctx.font = "120px 'Jua',sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 8;
    ctx.strokeText(n, 0, 0);
    ctx.fillStyle = '#ffd24d';
    ctx.fillText(n, 0, 0);
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();

  // 비네트
  const g = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, Math.min(VIEW.w, VIEW.h) * 0.35, VIEW.w / 2, VIEW.h / 2, Math.max(VIEW.w, VIEW.h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,5,.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}
