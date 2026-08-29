'use strict';
/* ============================================================
 * 바운스 로얄 — 렌더러 (Phaser 4 Graphics)
 *
 * 전투 화면은 Phaser 4의 Graphics로 그린다. Canvas 2D의 그라디언트와
 * shadowBlur는 Phaser Graphics에 대응물이 없으므로 다음으로 대체했다.
 *   - 방사형/선형 그라디언트 → 색을 보간한 동심원·띠를 겹쳐 그림
 *   - shadowBlur 글로우      → 발광 대상만 별도 레이어에 그리고 Glow 필터 적용
 *
 * 가방·도감의 DOM 캔버스 초상화는 Phaser가 관여할 수 없으므로
 * 파일 하단에 Canvas 2D 구현을 그대로 유지한다.
 * ============================================================ */

const canvas = document.getElementById('game');
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

/* 기준 경기장(L=405)이 꽉 차게 들어가는 월드 정사각형.
 * 1대1처럼 경기장이 작아지면 이 박스도 같은 비율로 줄여서,
 * 화면에서 경기장이 차지하는 크기는 항상 같게 만든다. */
const WORLD_BOX = 840;
const WORLD_REF_L = typeof DIAMOND_L === 'number' ? DIAMOND_L : 405;
function arenaZoom(arena) {
  return arena && arena.type === 'diamond' ? arena.L / WORLD_REF_L : 1;
}
function toScreen(x, y) {
  const half = (VIEW.span || WORLD_BOX) / 2;   // 아직 뷰가 계산되기 전이면 기본 박스를 쓴다
  return { x: VIEW.ox + (half + x) * VIEW.s, y: VIEW.oy + (half + y) * VIEW.s };
}

/* ---------------- 색 헬퍼 ---------------- */
function lighten(hex, k) { return shade(hex, k); }
function darken(hex, k) { return shade(hex, -k); }
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= (1 + k); g *= (1 + k); b *= (1 + k); }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/* Phaser는 색을 정수로 받는다. '#rrggbb' 와 'rgb(r,g,b)' 를 모두 처리한다. */
function toInt(color) {
  if (typeof color === 'number') return color;
  if (typeof color !== 'string') return 0xffffff;
  if (color[0] === '#') return parseInt(color.slice(1), 16);
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 0xffffff;
  const [r, g, b] = m[1].split(',').map(v => Math.max(0, Math.min(255, Math.round(parseFloat(v)))));
  return (r << 16) | (g << 8) | b;
}
function alphaOf(color, fallback = 1) {
  if (typeof color !== 'string') return fallback;
  const m = color.match(/rgba\(([^)]+)\)/);
  if (!m) return fallback;
  const parts = m[1].split(',');
  return parts.length > 3 ? Math.max(0, Math.min(1, parseFloat(parts[3]))) : fallback;
}
/* 두 색 사이를 보간해 정수로 반환 — 그라디언트를 동심원으로 대체할 때 쓴다 */
function mixInt(a, b, t) {
  const ca = toInt(a), cb = toInt(b);
  const r = ((ca >> 16) & 255) + (((cb >> 16) & 255) - ((ca >> 16) & 255)) * t;
  const g = ((ca >> 8) & 255) + (((cb >> 8) & 255) - ((ca >> 8) & 255)) * t;
  const bl = (ca & 255) + ((cb & 255) - (ca & 255)) * t;
  return ((r | 0) << 16) | ((g | 0) << 8) | (bl | 0);
}
/* 방사형 그라디언트 대체: 바깥→안쪽으로 동심원을 겹친다 */
function radialFill(g, x, y, r0, r1, inner, outer, steps = 14, alpha = 1) {
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    g.fillStyle(mixInt(inner, outer, t), alpha);
    g.fillCircle(x, y, r0 + (r1 - r0) * t);
  }
}

/* ============================================================
 * Phaser 씬
 * ============================================================ */
let scene = null;              // 준비되면 BattleScene 인스턴스
let pendingBattle = null;      // main.js가 renderBattle로 넘겨준 현재 전투
const STAR_COUNT = 70;

class BattleScene extends Phaser.Scene {
  constructor() { super('battle'); }

  create() {
    // 화면 좌표 레이어 (배경)
    this.gBack = this.add.graphics();
    // 월드 좌표 컨테이너 — 경기장 중심이 원점
    this.world = this.add.container(0, 0);
    const mk = () => { const g = this.add.graphics(); this.world.add(g); return g; };
    this.gArena = mk();
    this.gArenaGlow = mk();
    this.gGround = mk();
    this.gGroundGlow = mk();
    this.gUnits = mk();
    this.gProj = mk();
    this.gProjGlow = mk();
    this.gFx = mk();
    this.gFxGlow = mk();
    this.gUI = mk();
    // 발광 레이어에 Glow 필터
    for (const [g, color, outer] of [
      [this.gArenaGlow, 0x648cff, 1.6],
      [this.gGroundGlow, 0xffffff, 1.2],
      [this.gProjGlow, 0xffd24d, 1.8],
      [this.gFxGlow, 0xaee3ff, 1.8],
    ]) {
      g.enableFilters();
      g.filters.internal.addGlow(color, outer, 0, 1, false, 6, 12);
    }
    this.texts = [];           // 팝업·이름 텍스트 풀
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, p: Math.random() * TAU });
    }
    scene = this;
    resizeCanvas();
  }

  /* 텍스트 풀 — 매 프레임 새로 만들지 않는다 */
  useText(x, y, str, style) {
    let t = this.texts[this.textIndex];
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: 'Jua, sans-serif' }).setOrigin(0.5, 0.5);
      this.world.add(t);
      this.texts[this.textIndex] = t;
    }
    this.textIndex++;
    t.setVisible(true).setPosition(x, y).setText(str).setStyle(style);
    return t;
  }

  update() {
    const b = pendingBattle;
    this.textIndex = 0;
    this.gBack.clear();
    for (const g of [this.gArena, this.gArenaGlow, this.gGround, this.gGroundGlow,
      this.gUnits, this.gProj, this.gProjGlow, this.gFx, this.gFxGlow, this.gUI]) g.clear();
    drawBackdrop(this.gBack, this.stars);
    if (b) {
      applyView(b.arena);
      // 화면 흔들림
      const sh = b.shake || 0;
      const ox = sh ? rand(-sh, sh) : 0, oy = sh ? rand(-sh, sh) : 0;
      this.world.setPosition(VIEW.w / 2 + ox * VIEW.s, VIEW.h / 2 + oy * VIEW.s);
      drawArena(this.gArena, this.gArenaGlow, b);
      drawGroundFx(this.gGround, this.gGroundGlow, b);
      drawUnits(this.gUnits, b);
      drawProjectiles(this.gProj, this.gProjGlow, b);
      drawFx(this.gFx, this.gFxGlow, b, this);
      drawUnitUI(this.gUI, b, this);
      drawAimUI(this.gUI, b);
    }
    // 남는 텍스트는 숨긴다
    for (let i = this.textIndex; i < this.texts.length; i++) this.texts[i].setVisible(false);
  }
}

/* ---------------- 부트스트랩 ---------------- */
const phaserGame = new Phaser.Game({
  type: Phaser.WEBGL,   // 커스텀 캔버스를 넘기므로 명시 필요. Glow 필터도 WebGL 전용이다.
  canvas,
  width: canvas.clientWidth || 720,
  height: canvas.clientHeight || 914,
  transparent: true,
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
  scene: BattleScene,
  banner: false,
});

function applyView(arena) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const span = WORLD_BOX * arenaZoom(arena);
  const s = Math.min(w, h) / span;
  VIEW = { s, w, h, span, ox: (w - span * s) / 2, oy: (h - span * s) / 2 };
  // 월드 박스를 어떻게 잡든 경기장 중심은 캔버스 정중앙에 온다.
  if (scene) { scene.world.setPosition(w / 2, h / 2); scene.world.setScale(s); }
}

function resizeCanvas() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (phaserGame?.scale) phaserGame.scale.resize(w, h);
  applyView(pendingBattle ? pendingBattle.arena : null);
}
window.addEventListener('resize', resizeCanvas);

/* main.js는 매 프레임 이 함수를 부른다. 실제 그리기는 씬의 update가 담당한다. */
function renderBattle(b) { pendingBattle = b; }

/* ============================================================
 * 배경
 * ============================================================ */
function drawBackdrop(g, stars) {
  const { w, h } = VIEW;
  if (!w || !h) return;
  // 방사형 그라디언트 대체: 큰 동심원을 겹친다
  const cx = w / 2, cy = h * 0.42, rMax = Math.max(w, h) * 0.75;
  g.fillStyle(0x05070f, 1);
  g.fillRect(0, 0, w, h);
  const stops = [[0, '#101830'], [0.55, '#0a0f20'], [1, '#05070f']];
  for (let i = 22; i >= 0; i--) {
    const t = i / 22;
    let c;
    if (t <= 0.55) c = mixInt(stops[0][1], stops[1][1], t / 0.55);
    else c = mixInt(stops[1][1], stops[2][1], (t - 0.55) / 0.45);
    g.fillStyle(c, 1);
    g.fillCircle(cx, cy, 60 + (rMax - 60) * t);
  }
  const t = performance.now() / 1000;
  for (const s of stars) {
    g.fillStyle(0x9fb4e8, 0.25 + 0.25 * Math.sin(t * 1.5 + s.p));
    g.fillRect(s.x * w, s.y * h, s.r, s.r);
  }
}

/* ============================================================
 * 경기장
 * ============================================================ */
function arenaPath(g, A) {
  if (A.type === 'diamond') {
    const L = A.L;
    g.beginPath();
    g.moveTo(0, -L); g.lineTo(L, 0); g.lineTo(0, L); g.lineTo(-L, 0);
    g.closePath();
    return 'path';
  }
  if (A.type === 'circle') return 'circle';
  return 'rect';
}

function drawArena(g, glow, b) {
  const A = b.arena;
  // 은은한 격자
  g.lineStyle(1, 0x5a6eb4, 0.07);
  const gk = arenaZoom(A), gEnd = 360 * gk, gStep = 80 * gk;
  for (let i = -gEnd; i <= gEnd + 1e-6; i += gStep) {
    g.beginPath(); g.moveTo(i, -gEnd); g.lineTo(i, gEnd); g.strokePath();
    g.beginPath(); g.moveTo(-gEnd, i); g.lineTo(gEnd, i); g.strokePath();
  }
  const kind = arenaPath(g, A);
  if (kind === 'path') {
    g.fillStyle(0x101830, 0.55); g.fillPath();
    g.lineStyle(7, 0x2c3d6e, 1); g.strokePath();
    glow.beginPath();
    glow.moveTo(0, -A.L); glow.lineTo(A.L, 0); glow.lineTo(0, A.L); glow.lineTo(-A.L, 0);
    glow.closePath();
    glow.lineStyle(2.5, 0x78a0ff, 0.55); glow.strokePath();
  } else if (kind === 'circle') {
    g.fillStyle(0x101830, 0.55); g.fillCircle(0, 0, A.R);
    g.lineStyle(7, 0x2c3d6e, 1); g.strokeCircle(0, 0, A.R);
    glow.lineStyle(2.5, 0x78a0ff, 0.55); glow.strokeCircle(0, 0, A.R);
  } else {
    const H = A.H;
    g.fillStyle(0x101830, 0.55); g.fillRect(-H, -H, H * 2, H * 2);
    g.lineStyle(7, 0x2c3d6e, 1); g.strokeRect(-H, -H, H * 2, H * 2);
    glow.lineStyle(2.5, 0x78a0ff, 0.55); glow.strokeRect(-H, -H, H * 2, H * 2);
  }
  for (const p of A.pillars) {
    radialFill(g, p.x, p.y, 0, p.r, '#3a4a80', '#1a2340', 10);
    g.lineStyle(3, 0x78a0ff, 0.5); g.strokeCircle(p.x, p.y, p.r);
  }
  if (A.cube && A.cube.active) {
    const c = A.cube, t = performance.now() / 1000;
    glow.save();
    glow.translateCanvas(c.x, c.y + Math.sin(t * 2.2) * 8);
    glow.rotateCanvas(c.spin);
    glow.fillStyle(0xffd24d, 1);
    glow.fillRoundedRect(-16, -16, 32, 32, 7);
    glow.restore();
  }
}

/* ---------------- 플레이어 소유 색상 ---------------- */
function ownerPlayerColor(owner, fallback = '#b97bff') {
  const color = owner && (owner.color || (owner.player && owner.player.color));
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

/* ============================================================
 * 지면 이펙트
 * ============================================================ */
function drawGroundFx(g, glow, b) {
  const t = performance.now() / 1000;
  for (const s of b.stickies) {
    g.fillStyle(0x63c26f, 0.4 * Math.min(1, s.life));
    g.fillEllipse(s.x, s.y, s.r * 2, s.r * 1.5);
  }
  for (const fl of b.flames) {
    const a = Math.min(1, fl.life / 0.5);
    const flick = 0.8 + 0.2 * Math.sin(t * 22 + fl.x);
    const R = fl.r * flick;
    // 그라디언트(흰노랑 → 주황 → 투명) 대체
    for (let i = 10; i >= 0; i--) {
      const k = i / 10;
      const c = k <= 0.45 ? mixInt('#fff3b0', '#ff9d3c', k / 0.45) : mixInt('#ff9d3c', '#ff5014', (k - 0.45) / 0.55);
      g.fillStyle(c, 0.5 * a * (1 - k * 0.85));
      g.fillCircle(fl.x, fl.y, R * k || 1);
    }
  }
  for (const m of b.mines) {
    const armed = m.arm <= 0;
    const mr = m.r || 11;
    const coreColor = ownerPlayerColor(m.owner);
    g.fillStyle(0x2a2030, 1); g.fillCircle(m.x, m.y, mr);
    g.lineStyle(2, 0x5a4a60, 1); g.strokeCircle(m.x, m.y, mr);
    g.lineStyle(2.5, 0x6a5a70, 1);
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      g.beginPath();
      g.moveTo(m.x + Math.cos(a) * mr, m.y + Math.sin(a) * mr);
      g.lineTo(m.x + Math.cos(a) * (mr + 5), m.y + Math.sin(a) * (mr + 5));
      g.strokePath();
    }
    glow.fillStyle(toInt(coreColor), armed ? 0.72 + 0.28 * Math.max(0, Math.sin(t * 10 + m.x)) : 0.42);
    glow.fillCircle(m.x, m.y, 3.5 * mr / 11);
  }
}

/* ============================================================
 * 캐릭터 / 무기
 * ============================================================ */
function drawBallDetailsG(g, charId, r, opts = {}) {
  switch (charId) {
    case 'cat':
      g.fillStyle(0xd6739b, 1);
      for (const [tx, ty] of [[-r * 0.34, -r * 0.36], [0, -r * 0.46], [r * 0.34, -r * 0.36]]) {
        g.fillCircle(tx, ty, r * 0.14);
      }
      break;
    case 'bball':
      g.save(); g.rotateCanvas(opts.spin || 0);
      g.lineStyle(r * 0.09, 0x3c1e05, 0.8);
      g.strokeCircle(0, 0, r * 0.72);
      g.beginPath(); g.moveTo(-r * 0.72, 0); g.lineTo(r * 0.72, 0); g.strokePath();
      g.beginPath(); g.moveTo(0, -r * 0.72); g.lineTo(0, r * 0.72); g.strokePath();
      g.restore();
      break;
    case 'balloon':
      g.fillStyle(0xffffff, 0.65);
      g.save(); g.translateCanvas(-r * 0.4, -r * 0.45); g.rotateCanvas(-0.6);
      g.fillEllipse(0, 0, r * 0.32, r * 0.52);
      g.restore();
      break;
  }
}

function drawBallG(g, f, x, y, r, opts = {}) {
  const ch = CHARACTERS[f.charId];
  // 본체 그라디언트 대체
  radialFill(g, x, y, 0, r, lighten(ch.color, 0.25), darken(ch.color, 0.22), 12);
  g.lineStyle(3.5, toInt(f.color), 1);
  g.strokeCircle(x, y, r);
  if (f.charId === 'bomb') {
    g.lineStyle(3, 0xc9b18a, 1);
    g.beginPath(); g.moveTo(x, y - r);
    g.lineTo(x + r * 0.35, y - r * 1.3); g.lineTo(x + r * 0.6, y - r * 1.15);
    g.strokePath();
    const t = performance.now() / 1000;
    if (Math.sin(t * 14) > -0.2) {
      g.fillStyle(0xffd24d, 1);
      g.fillCircle(x + r * 0.6, y - r * 1.15, 3.5 + Math.sin(t * 20) * 1.5);
    }
  }
  g.save(); g.translateCanvas(x, y);
  drawBallDetailsG(g, f.charId, r, opts);
  g.restore();
  if (f.flash > 0) {
    g.fillStyle(0xffffff, Math.min(1, f.flash * 5));
    g.fillCircle(x, y, r);
  }
  if (f.timers && (f.timers.immune > 0 || f.timers.untouchable > 0)) {
    // setLineDash 대체: 원호를 끊어 그린다
    const base = performance.now() / 300;
    g.lineStyle(2.5, 0xa0dcff, 0.8);
    for (let i = 0; i < 12; i++) {
      const a0 = base + i * TAU / 12, a1 = a0 + TAU / 22;
      g.beginPath(); g.arc(x, y, r + 7, a0, a1); g.strokePath();
    }
  }
  if (f.timers && f.timers.freeze > 0) {
    g.fillStyle(0x8cc8ff, 0.35);
    g.fillCircle(x, y, r + 3);
  }
  if (f.timers && f.timers.actingDead > 0) {
    g.lineStyle(3, 0xff5d5d, 0.5 + 0.5 * Math.sin(performance.now() / 90));
    g.strokeCircle(x, y, r + 8);
  }
}

function drawWeaponG(g, f) {
  if (f.mainDead || f.timers.stun > 0) return;
  const ws = weaponScale(f);
  const R = f.radius;
  g.save();
  g.translateCanvas(f.x, f.y);
  g.rotateCanvas(f.weaponAngle);
  switch (f.weaponId) {
    case 'sword': case 'dagger': {
      const bladeLen = WEAPONS[f.weaponId].reach * ws;
      const w = (f.weaponId === 'sword' ? 13 : 9) * ws;
      // 쌍단검은 두 자루를 회전축에서 서로 반대쪽으로 비켜 놓는다.
      // 축 위에 겹쳐 그리면 공이 꼬치에 꿰인 것처럼 보인다.
      const dual = !!f.flags.dualDagger;
      const off = dual ? w * 0.7 : 0;
      bladeUnit(g, R, bladeLen, w, off);
      if (f.flags.giantBlade) {
        g.lineStyle(2, 0xffd24d, 0.7);
        g.beginPath();
        g.moveTo(R * 0.55 + 5, -w / 2);
        g.lineTo(R * 0.55 + 5 + bladeLen * 0.82, -w / 2);
        g.lineTo(R * 0.55 + 5 + bladeLen, 0);
        g.lineTo(R * 0.55 + 5 + bladeLen * 0.82, w / 2);
        g.lineTo(R * 0.55 + 5, w / 2);
        g.closePath(); g.strokePath();
      }
      if (dual) {
        g.save(); g.rotateCanvas(Math.PI);
        bladeUnit(g, R, bladeLen, w, off);   // 회전한 좌표계라 반대쪽으로 비켜난다
        g.restore();
      }
      break;
    }
    case 'bow': {
      g.save(); g.translateCanvas(R + 16, 0);
      g.lineStyle(5, 0xa5743c, 1);
      g.beginPath(); g.arc(-6, 0, 20, -Math.PI * 0.42, Math.PI * 0.42); g.strokePath();
      g.lineStyle(1.6, 0xe8e0c8, 1);
      g.beginPath();
      g.moveTo(-6 + 20 * Math.cos(-Math.PI * 0.42), 20 * Math.sin(-Math.PI * 0.42));
      g.lineTo(f.charging ? -14 - Math.min(10, f.charging.t * 10) : -10, 0);
      g.lineTo(-6 + 20 * Math.cos(Math.PI * 0.42), 20 * Math.sin(Math.PI * 0.42));
      g.strokePath();
      g.lineStyle(2.5, 0xd8cca8, 1);
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(16, 0); g.strokePath();
      if (f.charging) {
        const k = Math.min(1, f.charging.t);
        g.fillStyle(0xffdc6e, 0.35 + 0.5 * k);
        g.fillCircle(0, 0, 6 + k * 8);
      }
      g.restore();
      break;
    }
    case 'pistol': {
      if (f.flags.bayonet && f.gun && f.gun.reloadT > 0) {
        const bladeLen = 30 * ws, w = 9 * ws;
        g.fillStyle(0x5a4030, 1); g.fillRect(R * 0.35, -3.5, 12, 7);
        g.fillStyle(0xc9a23f, 1); g.fillRect(R * 0.55, -w * 0.7, 5, w * 1.4);
        bladeShape(g, R * 0.55 + 5, bladeLen, w);
        break;
      }
      g.fillStyle(0x3a4258, 1); g.fillRect(R * 0.6, -5, 30, 10);
      g.fillStyle(0x20242f, 1); g.fillRect(R * 0.6 + 6, 3, 8, 10);
      g.fillStyle(0x565f7a, 1); g.fillRect(R * 0.6 + 22, -6, 8, 5);
      if (f.gunFlash > 0) {
        g.fillStyle(0xffdc6e, 0.9);
        g.fillCircle(R * 0.6 + 34, 0, 9);
      }
      if (f.flags.dualPistol) {
        g.save(); g.rotateCanvas(Math.PI);
        g.fillStyle(0x3a4258, 1); g.fillRect(R * 0.6, -5, 30, 10);
        g.restore();
      }
      break;
    }
    case 'staff': {
      g.lineStyle(5, 0x7a5a3a, 1);
      g.beginPath(); g.moveTo(R * 0.3, 0); g.lineTo(R + 42 * ws, 0); g.strokePath();
      const t = performance.now() / 1000;
      const orbR = (8 + Math.sin(t * 5) * 1.5) * ws * (f.timers.rampage > 0 ? 2 : 1);
      g.fillStyle(toInt(f.timers.rampage > 0 ? '#e3c8ff' : '#c9a0ff'), 1);
      g.fillCircle(R + 42 * ws + 6, 0, orbR);
      break;
    }
    case 'mine': {
      g.fillStyle(0x4a4050, 1); g.fillCircle(R * 0.55, 0, 6);
      g.lineStyle(2, 0x7a6a80, 1);
      g.beginPath(); g.moveTo(R * 0.55, 0); g.lineTo(R * 0.55 + 10, -8); g.strokePath();
      break;
    }
  }
  g.restore();
}

/* 검신의 세로 선형 그라디언트를 가로 띠 세 겹으로 대체 */
function bladeShape(g, x0, bladeLen, w) {
  const bands = [['#f2f6ff', -0.5, -0.17], ['#c3cfe6', -0.17, 0.17], ['#8d9cbf', 0.17, 0.5]];
  for (const [color, a, b] of bands) {
    g.fillStyle(toInt(color), 1);
    g.beginPath();
    g.moveTo(x0, w * a);
    g.lineTo(x0 + bladeLen * 0.82, w * a);
    g.lineTo(x0 + bladeLen, w * (a + b) * 0.06);
    g.lineTo(x0 + bladeLen * 0.82, w * b);
    g.lineTo(x0, w * b);
    g.closePath(); g.fillPath();
  }
}

/* 손잡이 + 코등이 + 검신 한 벌. off는 회전축에서 옆으로 비켜난 정도. */
function bladeUnit(g, R, bladeLen, w, off) {
  g.save();
  if (off) g.translateCanvas(0, off);
  g.fillStyle(0x5a4030, 1); g.fillRect(R * 0.35, -3.5, 12, 7);
  g.fillStyle(0xc9a23f, 1); g.fillRect(R * 0.55, -w * 0.7, 5, w * 1.4);
  bladeShape(g, R * 0.55 + 5, bladeLen, w);
  g.restore();
}

function drawUnits(g, b) {
  for (const f of b.fighters) {
    for (const s of f.summons) {
      radialFill(g, s.x, s.y, 0, s.r, lighten(f.color, 0.3), darken(f.color, 0.25), 8);
      g.lineStyle(2, toInt(f.color), 1); g.strokeCircle(s.x, s.y, s.r);
    }
    for (const sp of f.splitBalls) {
      if (sp.dead) continue;
      drawBallG(g, Object.assign({}, f, { x: sp.x, y: sp.y, flash: sp.flash || 0 }), sp.x, sp.y, sp.r || sp.radius || 12);
    }
    if (!f.mainDead && !f.dead) {
      drawBallG(g, f, f.x, f.y, f.radius, { spin: f.weaponAngle });
      drawWeaponG(g, f);
    }
  }
}

/* ============================================================
 * 투사체
 * ============================================================ */
function drawProjectiles(g, glow, b) {
  const t = performance.now() / 1000;
  for (const p of b.projectiles) {
    const target = (p.kind === 'orb' || p.kind === 'bullet' || p.kind === 'beam' || p.kind === 'charge') ? glow : g;
    target.save();
    target.translateCanvas(p.x, p.y);
    target.rotateCanvas(p.ang);
    switch (p.kind) {
      case 'arrow': case 'charge': {
        const big = p.kind === 'charge';
        const scale = p.r / (big ? 8 : 5);
        target.scaleCanvas(scale, scale);
        const L = big ? 30 : 17;
        target.lineStyle(big ? 4 : 2.5, toInt(big ? '#ffd24d' : '#e0d6b0'), 1);
        target.beginPath(); target.moveTo(-L, 0); target.lineTo(L * 0.5, 0); target.strokePath();
        target.fillStyle(toInt(big ? '#ffe9a0' : '#f2f2f2'), 1);
        target.fillTriangle(L * 0.75, 0, L * 0.3, -4.5, L * 0.3, 4.5);
        break;
      }
      case 'bullet': {
        target.scaleCanvas(p.r / 4, p.r / 4);
        target.fillStyle(0xffe08a, 1);
        target.fillEllipse(0, 0, 12, 6);
        break;
      }
      case 'orb': {
        const body = ownerPlayerColor(p.owner);
        radialFill(target, 0, 0, 0, p.r + 6, lighten(body, 0.62), body, 10);
        break;
      }
      case 'missile': {
        target.fillStyle(0xc3cfe6, 1);
        target.fillTriangle(9, 0, -6, -4.5, -6, 4.5);
        target.fillStyle(mixInt('#ff8c3c', '#ffc83c', (Math.sin(t * 40) + 1) / 2), 0.95);
        target.fillEllipse(-9, 0, (6 + Math.sin(t * 50) * 2) * 2, 6);
        break;
      }
      case 'shuriken': {
        target.rotateCanvas(t * 18);
        target.fillStyle(0xdfe6f5, 1);
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2;
          const c = Math.cos(a), s = Math.sin(a);
          const pt = (px, py) => [px * c - py * s, px * s + py * c];
          const [x1, y1] = pt(0, -2.5), [x2, y2] = pt(9, 0), [x3, y3] = pt(0, 2.5);
          target.fillTriangle(x1, y1, x2, y2, x3, y3);
        }
        target.fillStyle(0x565f7a, 1); target.fillCircle(0, 0, 2.6);
        break;
      }
      case 'beam': {
        // 좌우로 넓게 퍼지는 검기. 기준 크기는 r=12.
        target.scaleCanvas(p.r / 12, p.r / 12);
        target.fillStyle(0xcfe4ff, 0.9);
        target.fillTriangle(26, 0, -30, -18, -30, 18);
        target.fillStyle(0xffffff, 0.75);
        target.fillTriangle(18, 0, -18, -9, -18, 9);
        break;
      }
    }
    target.restore();
  }
}

/* ============================================================
 * 이펙트
 * ============================================================ */
function drawFx(g, glow, b, sc) {
  for (const e of b.fx) {
    const k = e.t / (e.dur || 0.4);
    if (e.type === 'ring') {
      g.lineStyle(3.5 * (1 - k * 0.6), toInt(e.color), Math.max(0, 1 - k) * alphaOf(e.color));
      g.strokeCircle(e.x, e.y, e.r0 + (e.r1 - e.r0) * k);
    } else if (e.type === 'bolt') {
      const a = Math.max(0, 1 - k);
      glow.lineStyle(3, toInt(e.color), a);
      glow.beginPath();
      glow.moveTo(e.segs[0].x, e.segs[0].y);
      for (let i = 1; i < e.segs.length; i++) glow.lineTo(e.segs[i].x, e.segs[i].y);
      glow.strokePath();
      glow.lineStyle(1.2, 0xffffff, a);
      glow.beginPath();
      glow.moveTo(e.segs[0].x, e.segs[0].y);
      for (let i = 1; i < e.segs.length; i++) glow.lineTo(e.segs[i].x, e.segs[i].y);
      glow.strokePath();
    }
  }
  for (const p of b.particles) {
    g.fillStyle(toInt(p.color), Math.max(0, 1 - p.t / p.life));
    g.fillCircle(p.x, p.y, p.size);
  }
  for (const p of b.popups) {
    sc.useText(p.x, p.y, p.txt, {
      fontFamily: 'Jua, sans-serif',
      fontSize: (p.big ? 22 : 15) + 'px',
      fontStyle: 'bold',
      color: p.color,
      stroke: 'rgba(0,0,0,.6)',
      strokeThickness: 3,
    }).setAlpha(Math.min(1, p.t * 2.5));
  }
}

/* ============================================================
 * HP 바 / 이름 / 조준
 * ============================================================ */
function drawUnitUI(g, b, sc) {
  for (const f of b.fighters) {
    // 소환수 체력바. 본체보다 작게 그려 구분한다.
    for (const s of f.summons) {
      if (!s.maxHp) continue;
      const ratio = Math.max(0, Math.min(1, s.hp / s.maxHp));
      const sw = 20, sx = s.x - sw / 2, sy = s.y - s.r - 9;
      g.fillStyle(0x000000, 0.45);
      g.fillRect(sx - 1, sy - 1, sw + 2, 4.5);
      g.fillStyle(toInt(ratio > 0.5 ? '#6bd968' : ratio > 0.25 ? '#ffd24d' : '#ff6879'), 1);
      g.fillRect(sx, sy, sw * ratio, 2.5);
    }
    if (!f.mainDead && !f.dead) {
      for (const s of f.satellites) {
        const a = s.ang;
        const sx = f.x + Math.cos(a) * 42, sy = f.y + Math.sin(a) * 42;
        g.fillStyle(toInt(lighten(f.color, 0.35)), 0.95);
        g.fillCircle(sx, sy, 7);
      }
    }
    if (f.dead) continue;
    const alive = !f.mainDead;
    const bx = f.x, by = f.y - f.radius - 16;
    const w = 44, hp = Math.max(0, Math.min(1, f.hp / f.maxHp));
    if (alive) {
      g.fillStyle(0x000000, 0.45);
      g.fillRect(bx - w / 2 - 1, by - 1, w + 2, 6);
      g.fillStyle(toInt(hp > 0.5 ? '#6bd968' : hp > 0.25 ? '#ffd24d' : '#ff6879'), 1);
      g.fillRect(bx - w / 2, by, w * hp, 4);
      if (f.shield > 0) {
        g.fillStyle(0x7fd8ff, 0.9);
        g.fillRect(bx - w / 2, by - 3, w * Math.min(1, f.shield / f.maxHp), 2.5);
      }
      sc.useText(bx, by - 11, f.name, {
        fontFamily: 'Jua, sans-serif', fontSize: '12px', color: f.color,
        stroke: 'rgba(0,0,0,.55)', strokeThickness: 3,
      }).setAlpha(1);
    }
  }
}

function drawArrowG(g, x, y, ang, len, color, width, alpha = 1) {
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  g.lineStyle(width, toInt(color), alpha);
  g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.strokePath();
  const a1 = ang + Math.PI * 0.82, a2 = ang - Math.PI * 0.82;
  g.fillStyle(toInt(color), alpha);
  g.fillTriangle(ex, ey, ex + Math.cos(a1) * 12, ey + Math.sin(a1) * 12, ex + Math.cos(a2) * 12, ey + Math.sin(a2) * 12);
}

function drawAimUI(g, b) {
  const t = performance.now() / 1000;
  if (b.phase === 'aim' || b.phase === 'count') {
    for (const f of b.fighters) {
      if (f.aimLocked) drawArrowG(g, f.x, f.y, Math.atan2(f.vy, f.vx), 52, f.color, 3, 0.55);
      else drawArrowG(g, f.x, f.y, Math.atan2(f.vy, f.vx), 44 + Math.sin(t * 5) * 8, f.color, 3, 0.9);
    }
  }
  const human = b.human();
  if (human && b.humanAim && b.humanAim.active) {
    const f = human;
    const ang = b.humanAim.ang;
    const isCommon = b.phase === 'fight';
    const col = isCommon ? '#ffd24d' : '#4da6ff';
    drawArrowG(g, f.x, f.y, ang, 80, col, 4.5);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hit = b.arena.castRay(f.x, f.y, dx, dy, f.radius);
    const sx = f.x + dx * (f.radius + 14), sy = f.y + dy * (f.radius + 14);
    // setLineDash 대체: 점선을 직접 끊어 그린다
    const dash = (x1, y1, x2, y2) => {
      const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      g.lineStyle(2, toInt(col), 0.55);
      for (let d = 0; d < len; d += 17) {
        const e = Math.min(len, d + 8);
        g.beginPath(); g.moveTo(x1 + ux * d, y1 + uy * d); g.lineTo(x1 + ux * e, y1 + uy * e); g.strokePath();
      }
    };
    if (hit) {
      dash(sx, sy, hit.x, hit.y);
      const dot = dx * hit.nx + dy * hit.ny;
      const rx = dx - 2 * dot * hit.nx, ry = dy - 2 * dot * hit.ny;
      dash(hit.x, hit.y, hit.x + rx * 120, hit.y + ry * 120);
      g.fillStyle(toInt(col), 1); g.fillCircle(hit.x, hit.y, 5);
    } else {
      dash(sx, sy, f.x + dx * 300, f.y + dy * 300);
    }
  }
}

/* ============================================================
 * DOM 캔버스용 초상화 (Canvas 2D 유지)
 * 가방·도감·참가자 소개는 Phaser 화면 밖의 <canvas> 요소라
 * Phaser가 그릴 수 없다. 기존 Canvas 2D 구현을 그대로 쓴다.
 * ============================================================ */
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
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.2, x, y, r);
  g.addColorStop(0, lighten(ch.color, 0.25));
  g.addColorStop(1, darken(ch.color, 0.22));
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.lineWidth = 3.5;
  c.strokeStyle = f.color;
  c.stroke();
  c.save();
  c.translate(x, y);
  drawBallDetails(c, f.charId, r, opts);
  c.restore();
}

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
      const dual = !!f.flags.dualDagger;
      const off = dual ? w * 0.7 : 0;
      // 손잡이 + 가드 + 검신 한 벌
      const unit = () => {
        c.save();
        if (off) c.translate(0, off);
        c.fillStyle = '#5a4030';
        c.fillRect(R * 0.35, -3.5, 12, 7);
        c.fillStyle = '#c9a23f';
        c.fillRect(R * 0.55, -w * 0.7, 5, w * 1.4);
        const bg = c.createLinearGradient(0, -w / 2 + off, 0, w / 2 + off);
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
        c.restore();
      };
      unit();
      // 쌍단검: 반대쪽 한 자루. 축 위에 겹치면 꼬치처럼 보이므로 같은 만큼 비켜 놓는다.
      if (dual) { c.save(); c.rotate(Math.PI); unit(); c.restore(); }
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

