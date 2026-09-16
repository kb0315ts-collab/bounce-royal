'use strict';
/* ============================================================
 * 바운스 로얄 — 렌더러 (Phaser 4 Graphics)
 *
 * 전투는 Phaser Graphics로, DOM 초상화는 같은 그리기 함수를
 * Canvas 어댑터로 실행한다. 캐주얼 셀 셰이딩과 선명한 외곽선은
 * 화면 전체 Glow 필터 없이 렌더링하며 게임 상태를 바꾸지 않는다.
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

/* 글자 모양이 그대로인지 비교할 열쇠. 자리(originX/Y)는 setStyle이 보지 않으니 뺀다. */
function styleKey(style) {
  if (!style) return '';
  let key = '';
  for (const name of Object.keys(style)) {
    if (name === 'originX' || name === 'originY') continue;
    key += name + ':' + style[name] + ';';
  }
  return key;
}

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
const STAR_COUNT = 54;
// Shared toy-box palette. These values are paint only: physics continues to use
// the fighter/arena data, never the decorative outlines or squash transforms.
const CASUAL_INK = 0x243747;
// 연료바 기준값. data.js가 없는 환경(포트레이트 단독 렌더)에서도 안전하게.
const FLAME_FUEL_MAX = (typeof WEAPONS !== 'undefined' && WEAPONS.flame) ? WEAPONS.flame.fuelMax : 100;
const CASUAL_BALL_COLORS = Object.freeze({
  cat: '#ffa4c9', wak: '#ffc443', soft: '#fff3d9',
  bomb: '#637892', bball: '#ff984a', balloon: '#ff7898',
});

function comicStar(g, x, y, radius, color, alpha = 1, points = 7, rotation = 0) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rotation + i * Math.PI / points;
    const r = radius * (i % 2 ? 0.48 : 1);
    if (i) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle(toInt(color), alpha); g.fillPath();
  g.lineStyle(Math.max(1.5, radius * 0.085), CASUAL_INK, alpha); g.strokePath();
}

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
    // Retain the layer order, but use crisp ink + flat highlights instead of
    // full-surface glow passes. Readable on a bright board and cheaper on mobile.
    this.texts = [];           // 팝업·이름 텍스트 풀
    // Stable decorative placement; a backdrop never consumes gameplay randomness.
    this.stars = Array.from({ length:STAR_COUNT }, (_, i) => ({
      x: ((i * 137 + 29) % 541) / 541,
      y: ((i * i * 23 + i * 71 + 41) % 557) / 557,
      r: 0.65 + (i % 4) * 0.35,
    }));
    scene = this;
    resizeCanvas();
  }

  /* 텍스트 풀 — 매 프레임 새로 만들지 않는다.
   *
   * setStyle은 글자를 캔버스에 다시 그려 GPU로 올린다. 이름표·스탯판처럼
   * 모양이 그대로인 글자에까지 매 프레임 걸면 그 비용을 공짜로 버린다.
   * 실측(피해 숫자 20개, 200프레임): 216ms -> 11ms. 폰에서는 이 차이가
   * 몇 프레임씩 건너뛰는 끊김으로 나타난다. */
  useText(x, y, str, style) {
    let t = this.texts[this.textIndex];
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: 'Jua, sans-serif' }).setOrigin(0.5, 0.5);
      this.world.add(t);
      this.texts[this.textIndex] = t;
    }
    this.textIndex++;
    t.setVisible(true).setPosition(x, y).setText(str);
    // 풀에서 돌려쓰므로 같은 자리가 이름표였다가 피해 숫자가 되기도 한다.
    // 실제로 달라졌을 때만 다시 그린다.
    const key = styleKey(style);
    if (t.brStyleKey !== key) { t.setStyle(style); t.brStyleKey = key; }
    t.setOrigin(style && style.originX != null ? style.originX : 0.5,
      style && style.originY != null ? style.originY : 0.5);
    return t;
  }

  update() {
    const b = window.BounceRoyalHighlights?.view || pendingBattle;
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
      drawStatPanel(this.gUI, b, this);
    }
    // 남는 텍스트는 숨긴다
    for (let i = this.textIndex; i < this.texts.length; i++) this.texts[i].setVisible(false);
  }
}

/* ---------------- 부트스트랩 ---------------- */
const phaserGame = new Phaser.Game({
  type: Phaser.WEBGL,   // 커스텀 캔버스를 넘기므로 명시한다.
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

/* main.js는 실제로 보고 있는 전투만 넘긴다. 소리도 이 자리에서 소비해
 * 로컬에서 동시에 계산 중인 다른 대진이나 타이틀 시연은 들리지 않는다. */
function renderBattle(b) {
  pendingBattle = b;
  watchBattleSounds(b);
  if (typeof BounceRoyalCommentary !== 'undefined') BounceRoyalCommentary.observe(b);
  if (typeof BounceRoyalHighlights !== 'undefined' && typeof Game !== 'undefined'
    && (Game.state === 'battle' || Game.state === 'roundResult')) BounceRoyalHighlights.capture(b);
}

/* ---------------- 전투 오디오 이벤트 ---------------- */
let battleSoundKey = null, battleSoundMark = 0;
const PLAYABLE_SOUND_AGE = 0.55;

function watchBattleSounds(b) {
  if (!b || b.demo) {
    battleSoundKey = null; battleSoundMark = 0;
    projMark = -1; mineMark = -1;
    return;
  }
  const key = (b.soundSource || 'local') + ':' + (b.soundId == null ? 'legacy' : b.soundId)
    + ':' + (b.fighters || []).map(f => f.uid).join(',');
  const freshBattle = key !== battleSoundKey;
  if (freshBattle) {
    battleSoundKey = key;
    battleSoundMark = 0;
    projMark = -1; mineMark = -1;
  }
  if (!Array.isArray(b.soundEvents)) { watchFireSounds(b); return; }
  const events = b.soundEvents;
  const newest = events.reduce((n, e) => Math.max(n, e.seq || 0), battleSoundMark);
  // 진행 중인 다른 경기를 처음 관전하면 과거 소리는 재생하지 않는다.
  // 카운트다운부터 보고 있던 경기는 이 분기로 빠지지 않아 첫 발도 들린다.
  if (freshBattle && b.phase !== 'count' && b.simT > 0.15) { battleSoundMark = newest; return; }
  for (const e of events) {
    if (!Number.isSafeInteger(e.seq) || e.seq <= battleSoundMark || typeof e.id !== 'string') continue;
    battleSoundMark = e.seq;
    const age = (b.simT || 0) - e.t;
    if (age < -0.15 || age > PLAYABLE_SOUND_AGE || !Number.isFinite(age)) continue;
    if (typeof SFX !== 'undefined' && typeof SFX.play === 'function') SFX.play(e.id);
  }
  // 음소거/오디오 미준비 상태에서도 소비해 나중에 밀린 소리가 터지지 않게 한다.
  battleSoundMark = newest;
}

/* 구형 서버에만 쓰는 투사체 uid 기반 발사음 fallback. */
let projMark = -1, mineMark = -1;

function watchFireSounds(b) {
  if (typeof SFX === 'undefined') return;
  // 타이틀 뒤 시범 경기는 조용히 둔다. 메뉴에서 총소리가 나면 안 된다.
  if (!b || b.demo) { projMark = -1; mineMark = -1; return; }
  projMark = scanNewByUid(b.projectiles, projMark, p => SFX.fire(projKind(p)));
  mineMark = scanNewByUid(b.mines, mineMark, () => SFX.fire('mine'));
}

/* 지금까지 본 가장 큰 uid보다 큰 것이 '이번에 새로 생긴 것'이다.
 *
 * 처음에는 목록 객체를 그대로 비교했는데, 멀티에서는 스냅샷마다 배열도
 * 객체도 새로 만들어진다(multi.js가 매 프레임 netBattleView를 부른다).
 * 그래서 '전투가 바뀌었다'로 오인해 소리가 한 번도 안 났다.
 * uid는 서버에서도 클라이언트에서도 커지기만 하므로 이쪽이 안전하다. */
function scanNewByUid(list, mark, onNew) {
  if (mark < 0) {
    /* 처음 보는 전투다. 이미 날아다니는 게 있으면 방금 쏜 것이 아니므로
     * 소리 없이 기준선만 잡는다(관전 전환 때 한꺼번에 터지는 것 방지).
     * 비어 있으면 0에서 시작해 첫 발부터 들린다. */
    let base = 0;
    for (const it of list || []) if (it.uid > base) base = it.uid;
    return base;
  }
  let next = mark;
  for (const it of list || []) {
    const u = it.uid;
    if (u == null) continue;
    if (u > next) next = u;
    if (u > mark) onNew(it);
  }
  return next;
}

/* 샷건은 총알(bullet)을 뿌리는 것이라 투사체 종류만으로는 권총과 못 가른다.
 * 쏜 사람의 샷건 표식을 보고 갈라 준다 — 이 표식은 멀티 스냅샷에도 실린다. */
function projKind(p) {
  if (p.kind === 'bullet' && p.owner && p.owner.flags && p.owner.flags.shotgun) return 'shotgun';
  return p.kind;
}

/* ============================================================
 * 배경
 * ============================================================ */
function drawBackdrop(g, stars) {
  const { w, h } = VIEW;
  if (!w || !h) return;
  g.fillStyle(0x111c37, 1);
  g.fillRect(0, 0, w, h);
  // Broad flat shapes suggest deep space without costly glows or moving noise.
  g.fillStyle(0x1a2949, 0.52);
  g.fillEllipse(w * 0.1, h * 0.32, w * 1.18, h * 0.72);
  g.fillStyle(0x152240, 0.58);
  g.fillEllipse(w * 0.9, h * 0.7, w * 1.05, h * 0.68);
  for (let i = 0; i < Math.min(STAR_COUNT, stars.length); i++) {
    const s = stars[i];
    const x = s.x * w, y = s.y * h;
    g.fillStyle(i % 8 === 0 ? 0xffd597 : 0xb3c6e4, i % 3 === 0 ? 0.72 : 0.38);
    g.fillCircle(x, y, s.r);
    if (i % 13 === 0) {
      // Just four little star badges; larger silhouettes remain easy to follow.
      const r = s.r * 2.8;
      g.fillTriangle(x, y - r, x - r * 0.3, y, x + r * 0.3, y);
      g.fillTriangle(x, y + r, x - r * 0.3, y, x + r * 0.3, y);
      g.fillTriangle(x - r, y, x, y - r * 0.3, x, y + r * 0.3);
      g.fillTriangle(x + r, y, x, y - r * 0.3, x, y + r * 0.3);
    }
  }
  // Two quiet toy planets in the empty corners, behind (not on) the arena.
  const pr = Math.max(9, w * 0.03);
  g.fillStyle(0x324563, 1); g.fillCircle(w * 0.11, h * 0.17, pr);
  g.fillStyle(0x53678a, 1); g.fillCircle(w * 0.105, h * 0.164, pr * 0.76);
  g.fillStyle(0x324563, 0.7); g.fillCircle(w * 0.107, h * 0.159, pr * 0.18);
  g.save(); g.translateCanvas(w * 0.87, h * 0.82); g.rotateCanvas(-0.35);
  g.lineStyle(2, 0xb99975, 0.58); g.strokeEllipse(0, 0, pr * 3.1, pr * 0.95);
  g.fillStyle(0x9c7965, 1); g.fillCircle(0, 0, pr * 0.75);
  g.fillStyle(0xd0ad81, 1); g.fillEllipse(-pr * 0.12, -pr * 0.2, pr * 1.1, pr * 0.8);
  g.restore();
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
  const shape = (fill, width, stroke) => {
    const kind = arenaPath(g, A);
    g.fillStyle(fill, 1); g.lineStyle(width, stroke, 1);
    if (kind === 'path') { g.fillPath(); g.strokePath(); }
    else if (kind === 'circle') { g.fillCircle(0, 0, A.R); g.strokeCircle(0, 0, A.R); }
    else { g.fillRect(-A.H, -A.H, A.H * 2, A.H * 2); g.strokeRect(-A.H, -A.H, A.H * 2, A.H * 2); }
  };
  const outline = (width, color, alpha = 1) => {
    const kind = arenaPath(g, A); g.lineStyle(width, color, alpha);
    if (kind === 'path') g.strokePath();
    else if (kind === 'circle') g.strokeCircle(0, 0, A.R);
    else g.strokeRect(-A.H, -A.H, A.H * 2, A.H * 2);
  };
  // A boxing-ring canvas floating in space. Rope paint follows the SAME wall
  // coordinates; the padding and rope highlights are never collision objects.
  g.save(); g.translateCanvas(0, 8); shape(0x9b664b, 21, 0x0b1429); g.restore();
  shape(0xefd497, 22, 0x263044);
  outline(17, 0x9e3545);
  outline(11, 0xe55459);
  outline(3, 0xff9b8b);
  // Arena instances retain all three dimensions. Paint the active shape's
  // bounds, not its unused circular radius (especially in smaller duels).
  const edge = A.type === 'diamond' ? A.L : A.type === 'circle' ? A.R : A.H;
  const step = edge / 4;
  g.lineStyle(1.6, 0xb28d58, 0.13);
  for (let n = -3; n <= 3; n++) {
    const v = n * step;
    const extent = A.type === 'diamond' ? edge - Math.abs(v) : A.type === 'circle' ? Math.sqrt(edge * edge - v * v) : edge;
    g.beginPath(); g.moveTo(v, -extent + 5); g.lineTo(v, extent - 5); g.strokePath();
    g.beginPath(); g.moveTo(-extent + 5, v); g.lineTo(extent - 5, v); g.strokePath();
  }
  const markR = edge * 0.12;
  g.lineStyle(3, 0xb48a53, 0.26); g.strokeCircle(0, 0, markR);
  g.fillStyle(0xb48a53, 0.3); g.fillCircle(0, 0, 4);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, d0 = markR * 1.32, d1 = markR * 1.72;
    g.beginPath(); g.moveTo(Math.cos(a) * d0, Math.sin(a) * d0); g.lineTo(Math.cos(a) * d1, Math.sin(a) * d1); g.strokePath();
  }
  if (A.type === 'diamond' || A.type === 'square') {
    const corners = A.type === 'diamond' ? [[0,-A.L],[A.L,0],[0,A.L],[-A.L,0]] : [[-A.H,-A.H],[A.H,-A.H],[A.H,A.H],[-A.H,A.H]];
    for (const [x,y] of corners) {
      g.save(); g.translateCanvas(x,y); if (A.type === 'diamond') g.rotateCanvas(Math.PI/4);
      g.fillStyle(0xc64850, 1); g.fillRoundedRect(-9,-9,18,18,4);
      g.lineStyle(2.5, 0x263044, 1); g.strokeRoundedRect(-9,-9,18,18,4);
      g.fillStyle(0xffc0a6, 0.9); g.fillRoundedRect(-5,-5,10,3,1.5);
      g.restore();
    }
  }
  for (const p of A.pillars) {
    g.fillStyle(0x9c7147, 0.36); g.fillEllipse(p.x, p.y + 10, p.r * 2.2, p.r * 1.65);
    g.fillStyle(0xc7795d, 1); g.fillCircle(p.x, p.y, p.r);
    g.lineStyle(4, CASUAL_INK, 1); g.strokeCircle(p.x, p.y, p.r);
    g.fillStyle(0xedb681, 1); g.fillCircle(p.x - p.r * 0.12, p.y - p.r * 0.16, p.r * 0.68);
    g.lineStyle(2, 0xffdeac, 1); g.strokeCircle(p.x, p.y - 2, Math.max(2, p.r - 6));
  }
  if (A.cube && A.cube.active) {
    const c = A.cube, t = performance.now() / 1000;
    glow.save();
    glow.translateCanvas(c.x, c.y + Math.sin(t * 2.2) * 8);
    glow.rotateCanvas(c.spin);
    glow.fillStyle(0xffd34f, 1);
    glow.fillRoundedRect(-16, -16, 32, 32, 7);
    glow.lineStyle(3, CASUAL_INK, 1); glow.strokeRoundedRect(-16, -16, 32, 32, 7);
    glow.fillStyle(0xfff7d5, 1); glow.fillRoundedRect(-11, -11, 22, 8, 3);
    glow.lineStyle(3, CASUAL_INK, 1); glow.beginPath(); glow.moveTo(0, -5); glow.lineTo(0, 8); glow.moveTo(-6, 2); glow.lineTo(6, 2); glow.strokePath();
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
    g.fillStyle(0xf17848, a * 0.55); g.fillEllipse(fl.x, fl.y, R * 2, R * 1.3);
    g.fillStyle(0xffa544, a * 0.88);
    g.fillTriangle(fl.x - R * 0.6, fl.y + R * 0.3, fl.x - R * 0.15, fl.y - R, fl.x + R * 0.4, fl.y + R * 0.3);
    g.fillTriangle(fl.x, fl.y + R * 0.3, fl.x + R * 0.5, fl.y - R * 0.75, fl.x + R * 0.7, fl.y + R * 0.3);
    g.fillStyle(0xffef8c, a); g.fillEllipse(fl.x, fl.y, R * 0.7, R * 0.75);
  }
  // 던져 둔 방패 — 날아가는 동안 돌고, 멈추면 바닥에 눕는다.
  // 분열체도 제 방패를 던지므로 함께 훑는다.
  for (const owner of b.fighters) {
    for (const f of [owner, ...(owner.splitBalls || [])]) {
      const d = f.disc;
      if (!d) continue;
      const t = performance.now() / 1000;
      const spin = d.resting ? 0 : t * 9;
      g.fillStyle(CASUAL_INK, 0.2);
      g.fillEllipse(d.x + 2, d.y + 6, d.r * 2.3, d.r * (d.resting ? 1.5 : 1.1));
      if (d.resting) {
        // A loose, low pickup cue, not a second collision outline.
        g.lineStyle(1.8, toInt(ownerPlayerColor(owner)), 0.45 + Math.sin(t * 4) * 0.1);
        g.strokeEllipse(d.x, d.y + 4, d.r * 3.2, d.r * 1.55);
      }
      g.save(); g.translateCanvas(d.x, d.y); g.rotateCanvas(spin);
      if (!d.resting) {
        // Two bounded spin streaks work on live snapshots and replays alike.
        for (let i = 0; i < 2; i++) {
          const a = i * Math.PI + 0.25;
          g.lineStyle(2.5, 0xfff6dc, 0.72);
          g.beginPath(); g.arc(0, 0, d.r + 5, a, a + 1.1); g.strokePath();
          g.lineStyle(1.8, toInt(ownerPlayerColor(owner)), 0.62);
          g.beginPath(); g.arc(0, 0, d.r + 8, a + 0.2, a + 0.8); g.strokePath();
        }
      }
      discFaceG(g, 0, 0, d.r, toInt(ownerPlayerColor(owner)));
      g.restore();
    }
  }
  for (const m of b.mines) {
    const armed = m.arm <= 0;
    const mr = m.r || 11;
    const coreColor = ownerPlayerColor(m.owner);
    g.fillStyle(CASUAL_INK, 0.18); g.fillEllipse(m.x, m.y + 5, mr * 2.5, mr * 1.65);
    g.fillStyle(0xf8e3a0, 1); g.fillCircle(m.x, m.y, mr);
    g.lineStyle(2.7, CASUAL_INK, 1); g.strokeCircle(m.x, m.y, mr);
    g.lineStyle(3, CASUAL_INK, 1);
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      g.beginPath();
      g.moveTo(m.x + Math.cos(a) * mr, m.y + Math.sin(a) * mr);
      g.lineTo(m.x + Math.cos(a) * (mr + 5), m.y + Math.sin(a) * (mr + 5));
      g.strokePath();
    }
    glow.fillStyle(toInt(coreColor), armed ? 1 : 0.4);
    glow.fillCircle(m.x, m.y, 5.4 * mr / 11);
    glow.lineStyle(1.5, CASUAL_INK, 1); glow.strokeCircle(m.x, m.y, 5.4 * mr / 11);
    glow.fillStyle(0xffffff, armed ? 0.65 + 0.3 * Math.sin(t * 10 + m.x) : 0.2);
    glow.fillCircle(m.x - mr * 0.16, m.y - mr * 0.17, mr * 0.15);
  }
}

/* ============================================================
 * 캐릭터 / 무기
 * ============================================================ */
function drawBallDetailsG(g, charId, r, opts = {}) {
  switch (charId) {
    case 'cat': {
      // A single paw-print emblem, deliberately not a character face.
      g.fillStyle(0xd9518b, 1);
      g.fillEllipse(0, r * 0.2, r * 0.72, r * 0.52);
      for (const [tx, ty] of [[-0.42, -0.17], [-0.16, -0.4], [0.16, -0.4], [0.42, -0.17]]) {
        g.fillEllipse(tx * r, ty * r, r * 0.24, r * 0.3);
      }
      break;
    }
    case 'wak': {
      g.fillStyle(0xf88c39, 1);
      g.beginPath(); g.moveTo(0, -r * 0.57); g.lineTo(r * 0.39, 0); g.lineTo(0, r * 0.57); g.lineTo(-r * 0.39, 0); g.closePath(); g.fillPath();
      g.lineStyle(r * 0.06, 0xb96d28, 1); g.strokePath();
      g.fillStyle(0xffef91, 1); g.fillTriangle(0, -r * 0.38, 0, r * 0.32, -r * 0.23, 0);
      break;
    }
    case 'soft': {
      g.lineStyle(r * 0.12, 0xf0a6b4, 1);
      g.beginPath();
      for (let i = 0; i <= 30; i++) {
        const a = i / 30 * Math.PI * 3.5, sr = r * (0.04 + i / 30 * 0.49);
        if (i) g.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
        else g.moveTo(Math.cos(a) * sr, Math.sin(a) * sr);
      }
      g.strokePath();
      break;
    }
    case 'bball':
      g.save(); g.rotateCanvas(opts.spin || 0);
      g.lineStyle(r * 0.09, 0x8d452d, 1);
      g.beginPath(); g.moveTo(-r * 0.83, 0); g.lineTo(r * 0.83, 0); g.strokePath();
      g.beginPath(); g.moveTo(0, -r * 0.83); g.lineTo(0, r * 0.83); g.strokePath();
      g.beginPath(); g.arc(-r * 0.84, 0, r * 0.95, -1, 1); g.strokePath();
      g.beginPath(); g.arc(r * 0.84, 0, r * 0.95, Math.PI - 1, Math.PI + 1); g.strokePath();
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
  const body = CASUAL_BALL_COLORS[f.charId] || CHARACTERS[f.charId].color;
  const hit = Math.max(0, Math.min(1, (f.flash || 0) / 0.12));
  // Impact-only squash never changes radius, velocity, weapon position, or hitbox.
  g.fillStyle(CASUAL_INK, 0.18); g.fillEllipse(x + r * 0.1, y + r * 0.77, r * 2.06, r * 0.82);
  g.save(); g.translateCanvas(x, y); g.scaleCanvas(1 + hit * 0.085, 1 - hit * 0.075);
  x = 0; y = 0;
  g.fillStyle(toInt(darken(body, 0.18)), 1); g.fillCircle(x, y, r);
  g.fillStyle(toInt(body), 1); g.fillEllipse(-r * 0.045, -r * 0.12, r * 1.86, r * 1.58);
  g.lineStyle(Math.max(2.6, r * 0.12), CASUAL_INK, 1); g.strokeCircle(x, y, r);
  // Owner rim is consistent with magic projectiles/mines, outside the material.
  g.lineStyle(Math.max(1.8, r * 0.075), toInt(ownerPlayerColor(f)), 1); g.strokeCircle(x, y, r - r * 0.13);
  g.fillStyle(0xffffff, 0.75); g.fillEllipse(-r * 0.38, -r * 0.51, r * 0.4, r * 0.16);
  if (f.charId === 'bomb') {
    g.fillStyle(0xf0c978, 1); g.fillRoundedRect(-r * 0.19, -r * 1.13, r * 0.38, r * 0.23, 2);
    g.lineStyle(2, CASUAL_INK, 1); g.strokeRoundedRect(-r * 0.19, -r * 1.13, r * 0.38, r * 0.23, 2);
    g.lineStyle(3, 0x9b6e47, 1);
    g.beginPath(); g.moveTo(x, y - r);
    g.lineTo(x + r * 0.35, y - r * 1.3); g.lineTo(x + r * 0.6, y - r * 1.15);
    g.strokePath();
    const t = performance.now() / 1000;
    if (Math.sin(t * 14) > -0.2) {
      comicStar(g, x + r * 0.6, y - r * 1.15, 5.5 + Math.sin(t * 20), '#ffcf4c', 1, 4, t);
    }
  }
  if (f.charId === 'balloon') {
    g.fillStyle(0xdb547e, 1); g.fillTriangle(-r * 0.15, r * 1.13, 0, r * 0.9, r * 0.15, r * 1.13);
    g.lineStyle(1.8, CASUAL_INK, 1); g.beginPath(); g.moveTo(0, r * 1.12); g.lineTo(r * 0.1, r * 1.34); g.lineTo(0, r * 1.5); g.strokePath();
  }
  g.save(); g.translateCanvas(x, y);
  drawBallDetailsG(g, f.charId, r, opts);
  g.restore();
  if (f.flash > 0) {
    const hitAlpha = Math.min(0.62, f.flash * 5);
    g.fillStyle(0xffffff, hitAlpha);
    g.fillCircle(x, y, r);
    g.lineStyle(3.5, 0xfff8cf, Math.min(0.85, f.flash * 7));
    g.strokeCircle(x, y, r + 3 + (0.12 - Math.min(0.12, f.flash)) * 55);
  }
  if (f.timers && (f.timers.immune > 0 || f.timers.untouchable > 0)) {
    // setLineDash 대체: 원호를 끊어 그린다
    const base = performance.now() / 300;
    g.lineStyle(3.5, 0xffffff, 1);
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
  g.restore();
}

/* 방패 원반. 들고 있을 때와 던졌을 때가 같은 그림이어야 한다 —
 * 한 군데서 그려서 둘이 갈라지지 않게 한다.
 * 테두리 리벳 넷이 도는 것을 보이게 해 준다 (원은 그냥 돌면 안 보인다). */
function discFaceG(g, x, y, r, own) {
  g.fillStyle(0xffd256, 1); g.fillCircle(x, y, r);
  g.lineStyle(Math.max(2.3, r * 0.16), CASUAL_INK, 1); g.strokeCircle(x, y, r);
  g.fillStyle(0xfff6dc, 1); g.fillCircle(x, y, r * 0.8);
  g.lineStyle(Math.max(1.2, r * 0.08), CASUAL_INK, 1); g.strokeCircle(x, y, r * 0.8);
  g.fillStyle(0x95dac4, 1); g.fillCircle(x, y, r * 0.59);
  g.lineStyle(Math.max(1.4, r * 0.1), CASUAL_INK, 1); g.strokeCircle(x, y, r * 0.59);
  g.lineStyle(Math.max(1.2, r * 0.12), 0xffffff, 0.9);
  g.beginPath(); g.arc(x, y, r * 0.46, Math.PI * 1.08, Math.PI * 1.48); g.strokePath();
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4;
    g.lineStyle(Math.max(1.3, r * 0.1), CASUAL_INK, 1);
    g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.87, y + Math.sin(a) * r * 0.87);
    g.lineTo(x + Math.cos(a) * r * 0.97, y + Math.sin(a) * r * 0.97); g.strokePath();
  }
  g.fillStyle(own, 1); g.fillCircle(x, y, r * 0.25);
  g.lineStyle(Math.max(1.3, r * 0.1), CASUAL_INK, 1); g.strokeCircle(x, y, r * 0.25);
}

function drawWeaponG(g, f) {
  if (f.mainDead || f.timers.stun > 0) return;
  const ws = weaponScale(f);
  const R = f.radius;
  // 쇠사슬은 추가 세계 좌표에 따로 있어서 회전 좌표계로 그릴 수 없다.
  if (f.weaponId === 'chain') { drawChainG(g, f, ws); return; }
  if (f.weaponId === 'flame') { drawFlameG(g, f, ws); return; }
  // 던져 둔 동안은 손에 무기가 없다 — 몸에는 아무것도 그리지 않는다.
  if (f.weaponId === 'shield' && f.disc) return;
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
      g.lineStyle(9, CASUAL_INK, 1);
      g.beginPath(); g.arc(-6, 0, 20, -Math.PI * 0.42, Math.PI * 0.42); g.strokePath();
      g.lineStyle(5, 0xffbc56, 1);
      g.beginPath(); g.arc(-6, 0, 20, -Math.PI * 0.42, Math.PI * 0.42); g.strokePath();
      g.lineStyle(1.8, CASUAL_INK, 1);
      g.beginPath();
      g.moveTo(-6 + 20 * Math.cos(-Math.PI * 0.42), 20 * Math.sin(-Math.PI * 0.42));
      g.lineTo(f.charging ? -14 - Math.min(10, f.charging.t * 10) : -10, 0);
      g.lineTo(-6 + 20 * Math.cos(Math.PI * 0.42), 20 * Math.sin(Math.PI * 0.42));
      g.strokePath();
      g.lineStyle(3.5, CASUAL_INK, 1);
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(16, 0); g.strokePath();
      g.lineStyle(1.6, 0xfff7dd, 1);
      g.beginPath(); g.moveTo(-14, -0.7); g.lineTo(14, -0.7); g.strokePath();
      g.fillStyle(0xfaffff, 1); g.fillTriangle(21, 0, 12, -4.5, 12, 4.5);
      g.lineStyle(1.8, CASUAL_INK, 1); g.strokeTriangle(21, 0, 12, -4.5, 12, 4.5);
      if (f.charging) {
        const k = Math.min(1, f.charging.t);
        const pulse = Math.sin(performance.now() / 90) * 1.5;
        g.lineStyle(3, 0xffda55, 0.55 + k * 0.4); g.strokeCircle(16, 0, 10 + k * 7 + pulse);
        for (let i = 0; i < 3; i++) {
          const a = i * TAU / 3 + performance.now() / 420;
          g.fillStyle(0xfff6ae, 1); g.fillCircle(16 + Math.cos(a) * 19, Math.sin(a) * 19, 2.5);
        }
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
      g.fillStyle(0xf8b94c, 1); g.fillRoundedRect(R * 0.6 + 6, 2, 9, 12, 2);
      g.lineStyle(2.6, CASUAL_INK, 1); g.strokeRoundedRect(R * 0.6 + 6, 2, 9, 12, 2);
      g.fillStyle(0x82b7c4, 1); g.fillRoundedRect(R * 0.6, -6, 31, 12, 2.5);
      g.lineStyle(2.6, CASUAL_INK, 1); g.strokeRoundedRect(R * 0.6, -6, 31, 12, 2.5);
      g.fillStyle(0xe1f8eb, 1); g.fillRect(R * 0.6 + 3, -4, 21, 3);
      g.fillStyle(CASUAL_INK, 1); g.fillRect(R * 0.6 + 25, -6, 6, 12);
      if (f.gunFlash > 0) {
        comicStar(g, R * 0.6 + 39, 0, 12, '#ffe46c', 1, 5);
      }
      if (f.flags.shotgun) {
        g.fillStyle(0x6d96ab, 1); g.fillRoundedRect(R * 0.6 + 12, -8, 22, 16, 2);
        g.lineStyle(2.6, CASUAL_INK, 1); g.strokeRoundedRect(R * 0.6 + 12, -8, 22, 16, 2);
        g.fillStyle(0xd3f0ed, 1); g.fillRect(R * 0.6 + 30, -7, 5, 14);
        g.lineStyle(2, CASUAL_INK, 1); g.beginPath(); g.moveTo(R * 0.6 + 14, 0); g.lineTo(R * 0.6 + 34, 0); g.strokePath();
      }
      break;
    }
    case 'shield': {
      /* 던지는 그 원반을 그대로 든다. 공에 살짝 겹쳐 놓아서
       * 들고 있다는 것이 보이게 한다 — 떨어뜨려 놓으면 떠 있는 것 같다. */
      const dr = WEAPONS.shield.discR * ws;
      discFaceG(g, R * 0.45 + dr, 0, dr, toInt(ownerPlayerColor(f)));
      break;
    }
    case 'staff': {
      g.lineStyle(8, CASUAL_INK, 1);
      g.beginPath(); g.moveTo(R * 0.3, 0); g.lineTo(R + 42 * ws, 0); g.strokePath();
      g.lineStyle(4.5, 0xf3be66, 1);
      g.beginPath(); g.moveTo(R * 0.3, 0); g.lineTo(R + 42 * ws, 0); g.strokePath();
      const t = performance.now() / 1000;
      const orbR = (8 + Math.sin(t * 5) * 1.5) * ws * (f.timers.rampage > 0 ? 2 : 1);
      const gemX = R + 42 * ws + 6;
      g.fillStyle(0xac83ec, 1); g.beginPath(); g.moveTo(gemX + orbR, 0); g.lineTo(gemX, -orbR * 1.25); g.lineTo(gemX - orbR, 0); g.lineTo(gemX, orbR * 1.25); g.closePath(); g.fillPath();
      g.lineStyle(2.5, CASUAL_INK, 1); g.strokePath();
      g.fillStyle(0xeddaff, 1); g.fillTriangle(gemX, -orbR, gemX, orbR * 0.6, gemX - orbR * 0.7, 0);
      break;
    }
    case 'mine': {
      g.fillStyle(0xf3c460, 1); g.fillRoundedRect(R * 0.4, -7, 17, 15, 3);
      g.lineStyle(2.5, CASUAL_INK, 1); g.strokeRoundedRect(R * 0.4, -7, 17, 15, 3);
      g.fillStyle(toInt(ownerPlayerColor(f)), 1); g.fillCircle(R * 0.4 + 8, 0, 3.5);
      g.lineStyle(2.5, CASUAL_INK, 1);
      g.beginPath(); g.moveTo(R * 0.4 + 13, -7); g.lineTo(R * 0.4 + 18, -15); g.strokePath();
      break;
    }
  }
  g.restore();
}

/* 검신의 세로 선형 그라디언트를 가로 띠 세 겹으로 대체 */
function bladeShape(g, x0, bladeLen, w) {
  g.fillStyle(0xeafaf2, 1); g.beginPath();
  g.moveTo(x0, -w / 2); g.lineTo(x0 + bladeLen * 0.82, -w / 2); g.lineTo(x0 + bladeLen, 0);
  g.lineTo(x0 + bladeLen * 0.82, w / 2); g.lineTo(x0, w / 2); g.closePath(); g.fillPath();
  g.lineStyle(2.4, CASUAL_INK, 1); g.strokePath();
  g.fillStyle(0x88c3d0, 1); g.beginPath(); g.moveTo(x0 + 1, 0); g.lineTo(x0 + bladeLen - 2, 0); g.lineTo(x0 + bladeLen * 0.81, w * 0.35); g.lineTo(x0 + 1, w * 0.35); g.closePath(); g.fillPath();
  g.lineStyle(1.1, 0xffffff, 1); g.beginPath(); g.moveTo(x0 + 4, -w * 0.26); g.lineTo(x0 + bladeLen * 0.74, -w * 0.26); g.strokePath();
}

/* A mint fuel tank + cream/gold nozzle. The moving flame tongues remain
 * WITHIN the real center-based cone, including the pressure augment's range.
 * No emitters, randomness, glow filters, or simulation state mutations. */
function drawFlameG(g, f, ws) {
  const wp = WEAPONS.flame;
  const R = f.radius;
  const a = f.weaponAngle;
  const pressure = !!f.flags.flamePressure;
  const range = (pressure ? 140 : wp.range) * ws;
  const half = pressure ? 0.26 : wp.halfArc;
  g.save();
  g.translateCanvas(f.x, f.y);
  g.rotateCanvas(a);
  const nozzle = R * 0.45, x0 = nozzle + 27 * ws;
  const firing = f.flame && f.flame.on && f.flame.fuel > 0 && !f.dead && !f.mainDead &&
    !(f.timers && (f.timers.weaponLock > 0 || f.timers.stun > 0));
  if (firing && range > x0) {
    const t = performance.now() / 1000;
    const tip = range * (0.975 + Math.sin(t * 24) * 0.015);
    const side = Math.sin(half) * range;
    const tongue = (end, width, color, alpha, outline) => {
      const length = end - x0;
      const point = (x, y, first = false) => {
        const bound = Math.min(x * Math.tan(half), Math.sqrt(Math.max(0, range * range - x * x))) * 0.97;
        const py = Math.max(-bound, Math.min(bound, y));
        if (first) g.moveTo(x, py); else g.lineTo(x, py);
      };
      g.beginPath(); point(x0, -Math.min(4 * ws, width * 0.22), true);
      point(x0 + length * 0.52, -width * 0.67);
      point(x0 + length * 0.72, -width * 0.96);
      point(x0 + length * 0.66, -width * 0.27);
      point(x0 + length * 0.92, -width * 0.43);
      point(x0 + length * 0.81, -width * 0.08);
      point(end, 0);
      point(x0 + length * 0.82, width * 0.29);
      point(x0 + length * 0.87, width * 0.72);
      point(x0 + length * 0.62, width * 0.50);
      point(x0 + length * 0.58, width * 0.84);
      point(x0, Math.min(4 * ws, width * 0.22)); g.closePath();
      g.fillStyle(color, alpha); g.fillPath();
      if (outline) { g.lineStyle(1.8 * ws, 0xc8623e, 0.8); g.strokePath(); }
    };
    tongue(tip, side * 0.88, 0xff9850, 0.9, true);
    tongue(x0 + (tip - x0) * 0.88, side * 0.56, 0xffd256, 0.96, false);
    tongue(x0 + (tip - x0) * 0.66, side * 0.27, 0xfff6dc, 1, false);
    // Three small embers move down the cone; none extend its apparent reach.
    for (let i = 0; i < 3; i++) {
      const k = (t * 2.8 + i / 3) % 1;
      const sr = (1.6 + (1 - k) * 1.2) * ws;
      const px = Math.min(range - sr * 2.1, x0 + (tip - x0) * k);
      const py = Math.sin(t * 10 + i * 2.1) * side * k * 0.35;
      g.fillStyle(0xfff6dc, (1 - k) * 0.85);
      g.fillTriangle(px - sr, py - sr, px + sr * 1.5, py, px - sr, py + sr);
    }
  }
  // A short body rather than a dark stick: tank, fuel stripe, insulated grip.
  g.fillStyle(0xf18c66, 1); g.fillRoundedRect(nozzle + 6 * ws, 4 * ws, 8 * ws, 13 * ws, 2 * ws);
  g.lineStyle(2.3 * ws, CASUAL_INK, 1); g.strokeRoundedRect(nozzle + 6 * ws, 4 * ws, 8 * ws, 13 * ws, 2 * ws);
  g.fillStyle(0x95dac4, 1); g.fillRoundedRect(nozzle - 4 * ws, -14 * ws, 13 * ws, 22 * ws, 5 * ws);
  g.lineStyle(2.3 * ws, CASUAL_INK, 1); g.strokeRoundedRect(nozzle - 4 * ws, -14 * ws, 13 * ws, 22 * ws, 5 * ws);
  g.fillStyle(0xfff6dc, 1); g.fillRoundedRect(nozzle + 5 * ws, -6 * ws, 20 * ws, 12 * ws, 2 * ws);
  g.lineStyle(2.3 * ws, CASUAL_INK, 1); g.strokeRoundedRect(nozzle + 5 * ws, -6 * ws, 20 * ws, 12 * ws, 2 * ws);
  g.fillStyle(0xffd256, 1); g.fillRoundedRect(nozzle + 21 * ws, -8 * ws, 7 * ws, 16 * ws, 2 * ws);
  g.lineStyle(2.2 * ws, CASUAL_INK, 1); g.strokeRoundedRect(nozzle + 21 * ws, -8 * ws, 7 * ws, 16 * ws, 2 * ws);
  g.lineStyle(2 * ws, 0xffffff, 0.95); g.beginPath();
  g.moveTo(nozzle - ws, -10 * ws); g.lineTo(nozzle + 5 * ws, -10 * ws); g.strokePath();
  g.fillStyle(firing ? 0xfff6dc : CASUAL_INK, 1); g.fillRect(nozzle + 25 * ws, -3.2 * ws, 3 * ws, 6.4 * ws);
  g.restore();
}

/* Actual constraint nodes drive all links. Alternating little oval faces make
 * them read as chain rather than a rigid rod, with no simulated visual lag. */
function drawChainG(g, f, ws) {
  const heads = f.chainHeads || [];
  if (!heads.length) return;
  const R = f.radius;
  const headR = WEAPONS.chain.headR * ws;
  const own = toInt(ownerPlayerColor(f));
  for (const h of heads) {
    const nodes = h.nodes || [];
    const first = nodes[0] || h;
    const dx = first.x - f.x, dy = first.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    /* 줄은 공 표면에 매여 있다. 매인 자리 각도(로컬·멀티·다시보기 모두 있다)와
     * 지금 그리는 공 위치로 계산한다. 각도가 없는 구형 데이터만 첫 마디 쪽 표면에서
     * 시작한다. 좌표를 따로 들고 다니면 순간이동한 틱에 옛 자리에서 그려진다. */
    const hasAttach = Number.isFinite(h.attach);
    const x0 = hasAttach ? f.x + Math.cos(h.attach) * R : f.x + dx / d * R;
    const y0 = hasAttach ? f.y + Math.sin(h.attach) * R : f.y + dy / d * R;
    /* 줄은 마디를 이은 꺾은선이다. 공과 추를 직선으로 이으면 접힌 줄이
     * 막대기로 보인다 — 휘는 게 이 무기의 전부인데. */
    const rope = [{ x: x0, y: y0 }].concat(nodes, [h]);
    const trace = () => {
      g.beginPath(); g.moveTo(rope[0].x, rope[0].y);
      for (let i = 1; i < rope.length; i++) g.lineTo(rope[i].x, rope[i].y);
      g.strokePath();
    };
    // 굵은 먹선 위에 밝은 선을 얹는 이 게임의 기본 문법
    g.lineStyle(5.4 * ws, CASUAL_INK, 1); trace();
    g.lineStyle(2.5 * ws, 0xfff6dc, 1); trace();
    // Inset links along each real segment: bounded even on a long/twin chain.
    for (let i = 1; i < rope.length; i++) {
      const p = rope[i - 1], q = rope[i];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const count = Math.min(3, Math.max(1, Math.floor(length / (10 * ws))));
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      for (let j = 0; j < count; j++) {
        const k = (j + 0.5) / count;
        const x = p.x + (q.x - p.x) * k, y = p.y + (q.y - p.y) * k;
        const wide = (i + j) % 2 === 0;
        g.save(); g.translateCanvas(x, y); g.rotateCanvas(angle);
        g.fillStyle(wide ? 0x84dcf0 : 0xfff6dc, 1);
        g.fillEllipse(0, 0, 7 * ws, (wide ? 5.5 : 3.6) * ws);
        g.lineStyle(1.35 * ws, CASUAL_INK, 1);
        g.strokeEllipse(0, 0, 7 * ws, (wide ? 5.5 : 3.6) * ws);
        if (f.flags.chainBarbed && j === 0 && i % 2 === 0) {
          g.fillStyle(0xfff6dc, 1);
          g.fillTriangle(-3 * ws, -2 * ws, ws, -8 * ws, 4 * ws, -ws);
          g.strokeTriangle(-3 * ws, -2 * ws, ws, -8 * ws, 4 * ws, -ws);
          g.fillTriangle(3 * ws, 2 * ws, -ws, 8 * ws, -4 * ws, ws);
          g.strokeTriangle(3 * ws, 2 * ws, -ws, 8 * ws, -4 * ws, ws);
        }
        g.restore();
      }
    }
    // The head stays compact and weighty; the player-colour hub identifies it.
    g.fillStyle(CASUAL_INK, 0.16); g.fillEllipse(h.x + 2, h.y + 5, headR * 2.2, headR * 1.3);
    const last = nodes[nodes.length - 1] || { x: f.x, y: f.y };
    g.save(); g.translateCanvas(h.x, h.y); g.rotateCanvas(Math.atan2(h.y - last.y, h.x - last.x));
    g.fillStyle(0xfff6dc, 1); g.fillRoundedRect(-headR * 1.25, -headR * 0.3, headR * 0.7, headR * 0.6, headR * 0.1);
    g.lineStyle(1.8 * ws, CASUAL_INK, 1); g.strokeRoundedRect(-headR * 1.25, -headR * 0.3, headR * 0.7, headR * 0.6, headR * 0.1);
    g.fillStyle(0x95b1c7, 1); g.fillCircle(0, 0, headR);
    g.lineStyle(2.4 * ws, CASUAL_INK, 1); g.strokeCircle(0, 0, headR);
    g.fillStyle(0x7797b0, 1); g.fillEllipse(headR * 0.12, headR * 0.28, headR * 1.5, headR * 0.97);
    g.lineStyle(2 * ws, 0xfff6dc, 1); g.beginPath();
    g.arc(0, 0, headR * 0.67, Math.PI * 1.02, Math.PI * 1.47); g.strokePath();
    g.fillStyle(own, 1); g.fillCircle(headR * 0.06, headR * 0.1, headR * 0.32);
    g.lineStyle(1.5 * ws, CASUAL_INK, 1); g.strokeCircle(headR * 0.06, headR * 0.1, headR * 0.32);
    g.restore();
  }
}

/* 손잡이 + 코등이 + 검신 한 벌. off는 회전축에서 옆으로 비켜난 정도. */
function bladeUnit(g, R, bladeLen, w, off) {
  g.save();
  if (off) g.translateCanvas(0, off);
  g.fillStyle(0xf18c66, 1); g.fillRoundedRect(R * 0.35, -3.5, 12, 7, 2);
  g.lineStyle(2, CASUAL_INK, 1); g.strokeRoundedRect(R * 0.35, -3.5, 12, 7, 2);
  g.fillStyle(0xffd256, 1); g.fillRoundedRect(R * 0.55, -w * 0.7, 5, w * 1.4, 2);
  g.lineStyle(2, CASUAL_INK, 1); g.strokeRoundedRect(R * 0.55, -w * 0.7, 5, w * 1.4, 2);
  bladeShape(g, R * 0.55 + 5, bladeLen, w);
  g.restore();
}

/* 판정과 무관한 상태 가독성 레이어. 현재 스킬 타이머만 읽으며 새 게임 상태를 만들지 않는다. */
function drawFighterAura(g, f, x, y, r) {
  const T = f.timers || {}, now = performance.now() / 1000;
  const dx = Number.isFinite(f.vx) ? f.vx : 0, dy = Number.isFinite(f.vy) ? f.vy : 0;
  if (f.gripT > 0) {
    // Mint brackets distinguish the temporary catch guard from white immunity.
    const alpha = Math.min(0.9, f.gripT * 1.8);
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI - 0.64;
      g.lineStyle(5, CASUAL_INK, alpha * 0.7);
      g.beginPath(); g.arc(x, y, r + 5.5, a, a + 1.28); g.strokePath();
      g.lineStyle(2.8, 0x95dac4, alpha);
      g.beginPath(); g.arc(x, y, r + 5.5, a, a + 1.28); g.strokePath();
    }
  }
  const forceTrail = !!f.rocketActive || T.dashT > 0 || (f.st && f.st.move > 205);
  if (forceTrail && (dx || dy)) {
    const strength = f.rocketActive ? 1 : T.dashT > 0 ? 0.82 : 0.35;
    const norm = Math.hypot(dx, dy) || 1, ux = dx / norm, uy = dy / norm;
    for (let i = 3; i >= 1; i--) {
      const d = (r * 0.62 + i * r * 0.72) * strength;
      g.fillStyle(toInt(f.color || '#67ddeb'), (0.29 / i) * strength);
      g.fillCircle(x - ux * d, y - uy * d, r * (0.9 - i * 0.12));
    }
    if (strength > 0.7) {
      g.lineStyle(3, 0xfff6d6, 0.9);
      for (const side of [-1, 1]) {
        g.beginPath(); g.moveTo(x - uy * r * side, y + ux * r * side);
        g.lineTo(x - ux * r * 2.6 - uy * r * side, y - uy * r * 2.6 + ux * r * side); g.strokePath();
      }
    }
  }
  if (T.berserk > 0) {
    const pulse = 0.5 + Math.sin(now * 10) * 0.12;
    comicStar(g, x, y, r + 10 + Math.sin(now * 8) * 2, '#ffad43', pulse * 0.52, 9, now * 0.7);
  }
  if (T.balloon > 0) {
    g.lineStyle(2, 0xff8ca1, 0.35 + Math.sin(now * 7) * 0.12); g.strokeCircle(x, y, r + 6);
  }
  if (T.rampage > 0) {
    g.lineStyle(3.2, 0x9f77d9, 0.8); g.strokeCircle(x, y, r + 8 + Math.sin(now * 8) * 2);
    for (let i = 0; i < 3; i++) {
      const a = now * 2.4 + i * TAU / 3;
      comicStar(g, x + Math.cos(a) * (r + 13), y + Math.sin(a) * (r + 13), 5, '#e8d5ff', 0.9, 4, a);
    }
  }
  if (T.fuse > 0 || T.det > 0) {
    const ratio = Math.max(T.fuse || 0, T.det || 0);
    const alpha = 0.36 + (1 - Math.min(1, ratio)) * 0.42;
    g.lineStyle(3, 0xffad4f, alpha);
    for (let i = 0; i < 8; i += 2) {
      const a0 = now * 5 + i * TAU / 8;
      g.beginPath(); g.arc(x, y, r + 10, a0, a0 + TAU / 16); g.strokePath();
    }
  }
  if (f.spinRemaining > 0) {
    g.lineStyle(5, 0xf6fff0, 0.82);
    for (let i = 0; i < 3; i++) {
      const a0 = f.weaponAngle - i * 0.7;
      g.beginPath(); g.arc(x, y, r + 27 + i * 4, a0 - 0.65, a0); g.strokePath();
    }
  }
  if (T.dashPrep > 0 && (dx || dy)) {
    const sideX = -dy, sideY = dx, len = r + 30 + (1 - Math.min(1, T.dashPrep)) * 18;
    g.fillStyle(0x9cecf2, 0.3 + (1 - Math.min(1, T.dashPrep)) * 0.35);
    g.fillTriangle(
      x + dx * len, y + dy * len,
      x - dx * r * 0.25 + sideX * 6, y - dy * r * 0.25 + sideY * 6,
      x - dx * r * 0.25 - sideX * 6, y - dy * r * 0.25 - sideY * 6);
  }
}

/* 분열체는 본체와 같은 무기를 제 각도로 든다. 생김새(캐릭터·색·증강 비트)는
 * 본체에서 빌리되, 세계 좌표를 쓰는 사슬·불길·방패는 제 것만 쓴다 —
 * 본체 것을 그대로 두면 추와 불길이 분열체 수만큼 겹쳐 그려진다. */
function splitProxy(f, sp, sr) {
  return Object.assign({}, f, {
    uid: sp.uid != null ? sp.uid : f.uid,
    x: sp.x, y: sp.y, radius: sr, r: sr,
    flash: sp.flash || 0,
    mainDead: false, dead: false,
    weaponAngle: sp.weaponAngle != null ? sp.weaponAngle : f.weaponAngle,
    timers: sp.timers || f.timers,
    flags: sp.flags || f.flags,
    gripT: sp.gripT || 0,
    charging: sp.charging !== undefined ? sp.charging : f.charging,
    gun: sp.gun !== undefined ? sp.gun : f.gun,
    chainHeads: sp.chainHeads || null,
    flame: sp.flame || null,
    disc: sp.disc || null,
  });
}

function drawUnits(g, b) {
  for (const f of b.fighters) {
    for (const s of f.summons) {
      g.fillStyle(CASUAL_INK, 0.16); g.fillEllipse(s.x, s.y + s.r * 0.8, s.r * 2, s.r * 0.65);
      g.fillStyle(toInt(f.color), 1); g.fillCircle(s.x, s.y, s.r);
      g.lineStyle(2.3, CASUAL_INK, 1); g.strokeCircle(s.x, s.y, s.r);
      g.fillStyle(0xffffff, 0.72); g.fillEllipse(s.x - s.r * 0.27, s.y - s.r * 0.34, s.r * 0.64, s.r * 0.28);
    }
    for (const sp of f.splitBalls) {
      if (sp.dead) continue;
      const sr = sp.r || sp.radius || 12;
      const proxy = splitProxy(f, sp, sr);
      drawFighterAura(g, proxy, sp.x, sp.y, sr);
      drawBallG(g, proxy, sp.x, sp.y, sr, { spin: proxy.weaponAngle });
      drawWeaponG(g, proxy);
    }
    if (!f.mainDead && !f.dead) {
      drawFighterAura(g, f, f.x, f.y, f.radius);
      drawBallG(g, f, f.x, f.y, f.radius, { spin: f.weaponAngle });
      drawWeaponG(g, f);
    }
  }
}

/* ============================================================
 * 투사체
 * ============================================================ */
function drawProjectileTrail(g, p, color, length, width, alpha = 0.28) {
  const dx = Math.cos(p.ang || 0), dy = Math.sin(p.ang || 0);
  for (let i = 3; i >= 1; i--) {
    const from = length * (i - 1) / 3, to = length * i / 3;
    g.lineStyle(Math.max(0.7, width * (1 - i * 0.18)), toInt(color), alpha * (1 - i * 0.2));
    g.beginPath();
    g.moveTo(p.x - dx * from, p.y - dy * from);
    g.lineTo(p.x - dx * to, p.y - dy * to);
    g.strokePath();
  }
}

function drawProjectiles(g, glow, b) {
  const t = performance.now() / 1000;
  for (const p of b.projectiles) {
    const target = g;
    const ownerColor = ownerPlayerColor(p.owner, '#67ddeb');
    if (p.kind === 'charge') drawProjectileTrail(target, p, '#ffd477', 62, 8, 0.48);
    else if (p.kind === 'beam') drawProjectileTrail(target, p, '#bdeeff', 44, 7, 0.34);
    else if (p.kind === 'bullet') drawProjectileTrail(target, p, '#ffcf72', 25, 4, 0.36);
    else if (p.kind === 'orb') drawProjectileTrail(target, p, ownerColor, 31, Math.max(3, p.r * 0.65), 0.25);
    else if (p.kind === 'missile') drawProjectileTrail(target, p, ownerColor, 28, 3, 0.3);
    else if (p.kind === 'arrow') drawProjectileTrail(target, p, '#ffffff', 22, 2.5, 0.48);
    else if (p.kind === 'shuriken') drawProjectileTrail(target, p, ownerColor, 18, 2, 0.18);
    target.save();
    target.translateCanvas(p.x, p.y);
    target.rotateCanvas(p.ang);
    switch (p.kind) {
      case 'arrow': case 'charge': {
        const big = p.kind === 'charge';
        const scale = p.r / (big ? 8 : 5);
        target.scaleCanvas(scale, scale);
        const L = big ? 30 : 17;
        target.lineStyle(big ? 6 : 4, CASUAL_INK, 1);
        target.beginPath(); target.moveTo(-L, 0); target.lineTo(L * 0.5, 0); target.strokePath();
        target.lineStyle(big ? 3 : 1.8, toInt(big ? '#ffda52' : '#fff5d8'), 1);
        target.beginPath(); target.moveTo(-L, -0.5); target.lineTo(L * 0.5, -0.5); target.strokePath();
        target.fillStyle(toInt(big ? '#ffed80' : '#f4ffef'), 1);
        target.fillTriangle(L * 0.8, 0, L * 0.25, -5.5, L * 0.25, 5.5);
        target.lineStyle(1.7, CASUAL_INK, 1); target.strokeTriangle(L * 0.8, 0, L * 0.25, -5.5, L * 0.25, 5.5);
        target.fillStyle(toInt(big ? '#fffad6' : '#ff9d72'), 1);
        target.fillTriangle(-L, 0, -L * 0.55, -4, -L * 0.65, 0);
        target.fillTriangle(-L, 0, -L * 0.55, 4, -L * 0.65, 0);
        if (big) { target.lineStyle(2, 0xfffbe7, 0.9); target.beginPath(); target.moveTo(-L * 1.4, -8); target.lineTo(4, -8); target.moveTo(-L * 1.4, 8); target.lineTo(4, 8); target.strokePath(); }
        break;
      }
      case 'bullet': {
        target.scaleCanvas(p.r / 4, p.r / 4);
        target.fillStyle(0xffd651, 1); target.fillEllipse(0, 0, 12, 6);
        target.lineStyle(1.5, CASUAL_INK, 1); target.strokeEllipse(0, 0, 12, 6);
        target.fillStyle(0xfffce6, 1); target.fillEllipse(2, -1, 5, 2);
        break;
      }
      case 'orb': {
        const body = ownerPlayerColor(p.owner);
        target.fillStyle(toInt(body), 0.17); target.fillCircle(0, 0, p.r + 4);
        target.fillStyle(toInt(body), 1); target.fillCircle(0, 0, p.r);
        target.lineStyle(2.2, CASUAL_INK, 1); target.strokeCircle(0, 0, p.r);
        target.fillStyle(toInt(lighten(body, 0.58)), 1); target.fillCircle(-p.r * 0.13, -p.r * 0.17, p.r * 0.65);
        target.fillStyle(0xffffff, 1); target.fillEllipse(-p.r * 0.25, -p.r * 0.37, p.r * 0.5, p.r * 0.2);
        break;
      }
      case 'missile': {
        target.fillStyle(0xf0fff1, 1);
        target.fillTriangle(9, 0, -6, -4.5, -6, 4.5);
        target.lineStyle(2, CASUAL_INK, 1); target.strokeTriangle(9, 0, -6, -4.5, -6, 4.5);
        target.fillStyle(toInt(ownerColor), 0.9);
        target.fillTriangle(-2, 0, -8, -7, -7, 0); target.fillTriangle(-2, 0, -8, 7, -7, 0);
        target.fillStyle(mixInt('#ff8c3c', '#ffc83c', (Math.sin(t * 40) + 1) / 2), 0.95);
        target.fillEllipse(-9, 0, (6 + Math.sin(t * 50) * 2) * 2, 6);
        break;
      }
      case 'shuriken': {
        target.rotateCanvas(t * 18);
        target.fillStyle(0xebfff4, 1);
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2;
          const c = Math.cos(a), s = Math.sin(a);
          const pt = (px, py) => [px * c - py * s, px * s + py * c];
          const [x1, y1] = pt(0, -2.5), [x2, y2] = pt(9, 0), [x3, y3] = pt(0, 2.5);
          target.fillTriangle(x1, y1, x2, y2, x3, y3);
          target.lineStyle(1.6, CASUAL_INK, 1); target.strokeTriangle(x1, y1, x2, y2, x3, y3);
        }
        target.fillStyle(toInt(ownerColor), 1); target.fillCircle(0, 0, 2.6);
        break;
      }
      case 'beam': {
        // 좌우로 넓게 퍼지는 검기. 기준 크기는 r=12.
        target.scaleCanvas(p.r / 12, p.r / 12);
        target.fillStyle(0x84dcf0, 0.92);
        target.fillTriangle(26, 0, -30, -18, -30, 18);
        target.lineStyle(2, CASUAL_INK, 0.85); target.strokeTriangle(26, 0, -30, -18, -30, 18);
        target.fillStyle(0xffffff, 0.95);
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
      const fade = Math.max(0, 1 - k) * alphaOf(e.color);
      const radius = e.r0 + (e.r1 - e.r0) * k;
      g.lineStyle(5.5 * (1 - k * 0.55), toInt(e.color), fade); g.strokeCircle(e.x, e.y, radius);
      glow.lineStyle(2, 0xfffce9, fade * 0.9); glow.strokeCircle(e.x, e.y, Math.max(1, radius - 4));
      if (e.boom) {
        if (k < 0.5) comicStar(g, e.x, e.y, Math.max(6, radius * 0.72), '#ffdd61', (1 - k * 2) * 0.82, 9, 0.16);
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8, d0 = radius * 0.76, d1 = radius * (1.05 + k * 0.18);
          g.lineStyle(3.4 * (1 - k), toInt(e.color), fade * 0.9);
          g.beginPath(); g.moveTo(e.x + Math.cos(a) * d0, e.y + Math.sin(a) * d0); g.lineTo(e.x + Math.cos(a) * d1, e.y + Math.sin(a) * d1); g.strokePath();
        }
      }
    } else if (e.type === 'bolt') {
      const a = Math.max(0, 1 - k);
      glow.lineStyle(7, CASUAL_INK, a * 0.75);
      glow.beginPath();
      glow.moveTo(e.segs[0].x, e.segs[0].y);
      for (let i = 1; i < e.segs.length; i++) glow.lineTo(e.segs[i].x, e.segs[i].y);
      glow.strokePath();
      glow.lineStyle(4.2, 0xffd943, a);
      glow.beginPath();
      glow.moveTo(e.segs[0].x, e.segs[0].y);
      for (let i = 1; i < e.segs.length; i++) glow.lineTo(e.segs[i].x, e.segs[i].y);
      glow.strokePath();
      glow.lineStyle(1.4, 0xfffbe1, a); glow.beginPath(); glow.moveTo(e.segs[0].x, e.segs[0].y);
      for (let i = 1; i < e.segs.length; i++) glow.lineTo(e.segs[i].x, e.segs[i].y); glow.strokePath();
    } else if (e.type === 'shatter') {
      const a = Math.max(0, 1 - k);
      comicStar(glow, e.x, e.y, Math.max(2, e.r * (1 - k)), '#fff5bb', a * 0.88, 8, k);
    }
  }
  for (const p of b.particles) {
    const a = Math.max(0, 1 - p.t / p.life);
    if (!p.shard) {
      const speed = Math.hypot(p.vx || 0, p.vy || 0), ux = speed ? p.vx / speed : 0, uy = speed ? p.vy / speed : 0;
      const len = Math.min(11, speed * 0.035) * a;
      g.lineStyle(Math.max(1, p.size * a), toInt(p.color), a);
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - ux * len, p.y - uy * len); g.strokePath();
      g.fillStyle(0xfff7d6, a * 0.8); g.fillCircle(p.x, p.y, Math.max(0.7, p.size * 0.42));
      continue;
    }
    // 깨진 공 껍질 — 돌면서 날아가고 사그라들며 작아진다
    const ang = p.ang + p.spin * p.t, s = p.size * (0.55 + 0.45 * a);
    const cx = Math.cos(ang), cy = Math.sin(ang);
    g.fillStyle(toInt(p.color), a);
    g.fillTriangle(
      p.x + cx * s * 1.4, p.y + cy * s * 1.4,
      p.x - cx * s * 0.6 - cy * s * 0.8, p.y - cy * s * 0.6 + cx * s * 0.8,
      p.x - cx * s * 0.6 + cy * s * 0.8, p.y - cy * s * 0.6 - cx * s * 0.8);
    g.lineStyle(1.3, CASUAL_INK, a); g.strokeTriangle(
      p.x + cx * s * 1.4, p.y + cy * s * 1.4,
      p.x - cx * s * 0.6 - cy * s * 0.8, p.y - cy * s * 0.6 + cx * s * 0.8,
      p.x - cx * s * 0.6 + cy * s * 0.8, p.y - cy * s * 0.6 - cx * s * 0.8);
  }
  for (const p of b.popups) {
    const number = Number.parseFloat(String(p.txt));
    const impactSize = Number.isFinite(number) ? Math.min(8, Math.max(0, number - 8) * 0.22) : 0;
    sc.useText(p.x, p.y, p.txt, {
      fontFamily: 'Do Hyeon, Jua, sans-serif',
      fontSize: (p.big ? 27 : 16 + impactSize) + 'px',
      fontStyle: 'bold',
      color: p.color,
      stroke: '#243747',
      strokeThickness: p.big ? 4.5 : 3.4,
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
        g.fillStyle(toInt(f.color), 1); g.fillCircle(sx, sy, 7);
        g.lineStyle(2, CASUAL_INK, 1); g.strokeCircle(sx, sy, 7);
        g.fillStyle(0xffffff, 0.8); g.fillEllipse(sx - 2, sy - 2.5, 5, 2);
      }
    }
    // 분열체 체력바. 소환수처럼 본체보다 작게 그려 구분한다.
    for (const sp of f.splitBalls) {
      if (sp.dead || !sp.maxHp) continue;
      const sr = sp.r || sp.radius || 12;
      const ratio = Math.max(0, Math.min(1, sp.hp / sp.maxHp));
      const sw = 28, sx = sp.x - sw / 2, sy = sp.y - sr - 11;
      g.fillStyle(CASUAL_INK, 1);
      g.fillRoundedRect(sx - 1.5, sy - 1.5, sw + 3, 6, 2.5);
      g.fillStyle(toInt(ratio > 0.5 ? '#a4ef58' : ratio > 0.25 ? '#ffdc55' : '#ff7965'), 1);
      g.fillRect(sx, sy, sw * ratio, 3);
      g.fillStyle(0xffffff, 0.45); g.fillRect(sx, sy, sw * ratio, 1);
      if (sp.shield > 0) {
        g.fillStyle(0x7fd8ff, 0.9);
        g.fillRect(sx, sy - 2.5, sw * Math.min(1, sp.shield / sp.maxHp), 2);
      }
    }
    if (f.dead) continue;
    const alive = !f.mainDead;
    const bx = f.x, by = f.y - f.radius - 16;
    const w = 44, hp = Math.max(0, Math.min(1, f.hp / f.maxHp));
    if (alive) {
      g.fillStyle(CASUAL_INK, 1);
      g.fillRoundedRect(bx - w / 2 - 2, by - 2, w + 4, 8, 3);
      g.fillStyle(toInt(hp > 0.5 ? '#a4ef58' : hp > 0.25 ? '#ffdc55' : '#ff7965'), 1);
      g.fillRect(bx - w / 2, by, w * hp, 4);
      g.fillStyle(0xffffff, 0.45); g.fillRect(bx - w / 2, by, w * hp, 1.3);
      if (f.shield > 0) {
        g.fillStyle(0x7fd8ff, 0.9);
        g.fillRect(bx - w / 2, by - 3, w * Math.min(1, f.shield / f.maxHp), 2.5);
      }
      /* 화염방사기 연료. 체력바 바로 위에 한 칸 더 얹는다 — 남은 연료가
       * 곧 남은 공격이라, 체력만큼 자주 봐야 하는 값이다.
       * 다 쓰면 색을 죽여서 '지금은 못 쏜다'가 한눈에 읽히게 한다. */
      let nameY = by - 11;
      if (f.weaponId === 'flame' && f.flame) {
        const fu = Math.max(0, Math.min(1, (f.flame.fuel || 0) / FLAME_FUEL_MAX));
        const fy = by - 9;
        g.fillStyle(CASUAL_INK, 1);
        g.fillRoundedRect(bx - w / 2 - 2, fy - 1.5, w + 4, 6, 2.5);
        g.fillStyle(toInt(fu > 0 ? '#ffa544' : '#8d6a52'), 1);
        g.fillRect(bx - w / 2, fy, w * Math.max(fu, 0.001), 3);
        if (fu > 0) { g.fillStyle(0xffef8c, 0.5); g.fillRect(bx - w / 2, fy, w * fu, 1); }
        nameY = by - 18;
      }
      sc.useText(bx, nameY, f.name, {
        fontFamily: 'Jua, sans-serif', fontSize: '12px', color: '#243747',
        stroke: '#fff7dd', strokeThickness: 3,
      }).setAlpha(1);
    }
  }
}

/* ============================================================
 * 좌하단 스탯판
 * 다이아 경기장 바깥의 빈 삼각형에 내 현재 수치를 적는다.
 * ============================================================ */
function drawStatPanel(g, b, sc) {
  const me = b.human && b.human();
  if (!me || !me.st) return;                    // 관전 중이면 보여줄 내 수치가 없다
  const L = (b.arena && b.arena.L) || 405;
  // 마름모(|x|+|y| <= L) 밖이면서 화면 박스(반폭 1.037L) 안에 들어가야 한다.
  // 네 모서리 중 오른쪽 위가 가장 빠듯하다: (-0.42L, 0.62L) -> 합 1.04L
  const padX = L * 0.024, padY = L * 0.022;
  const x = -L + padX, y = L * 0.62 + padY;
  const rowH = L * 0.062, w = L * 0.532;
  // 값이 아직 없을 수 있다. 화면 장식 하나 때문에 그리기 루프가 죽으면 안 된다.
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const rows = [
    ['공격력', '×' + num(me.st.atk, 1).toFixed(2)],
    ['체력', Math.max(0, Math.round(num(me.hp, 0))) + ' / ' + Math.round(num(me.maxHp, 0))],
    ['공격속도', '×' + num(me.st.aspd, 1).toFixed(2)],
    ['회전력', num(me.st.rot, 0) > 0 ? num(me.st.rot, 0).toFixed(2) + ' rad/s' : '—'],
    ['피해 증폭', '×' + num(me.st.dmg, 1).toFixed(2)],
  ];
  g.fillStyle(CASUAL_INK, 0.18);
  g.fillRoundedRect(x - padX, y - padY + 5, w + padX * 2, rowH * rows.length + padY * 2, 9);
  g.fillStyle(0xfff7df, 0.98);
  g.fillRoundedRect(x - padX, y - padY, w + padX * 2, rowH * rows.length + padY * 2, 9);
  g.lineStyle(Math.max(1.8, L * 0.006), CASUAL_INK, 1);
  g.strokeRoundedRect(x - padX, y - padY, w + padX * 2, rowH * rows.length + padY * 2, 9);

  const size = Math.max(9, Math.round(L * 0.045));
  rows.forEach(([label, value], i) => {
    const ty = y + rowH * (i + 0.5);
    sc.useText(x, ty, label, {
      fontFamily: 'Jua, sans-serif', fontSize: size + 'px', color: '#607568',
      originX: 0, originY: 0.5,
    });
    sc.useText(x + w, ty, value, {
      fontFamily: 'Jua, sans-serif', fontSize: size + 'px', color: '#243747',
      originX: 1, originY: 0.5,
    });
  });
}

/* 출발 방향 화살표는 없앴다. 방향을 미리 정해 두는 단계가 사라졌으니
 * 가리킬 것도 없다. 지금 어디를 향하는지는 조이스틱 손잡이가 보여준다. */

/* ============================================================
 * DOM 캔버스용 초상화 (Canvas 2D 유지)
 * 가방·도감·참가자 소개는 Phaser 화면 밖의 <canvas> 요소라
 * Phaser가 직접 그릴 수 없으므로 같은 Graphics 호출을 Canvas로 변환한다.
 * ============================================================ */
// Canvas portraits and offline title capture consume the exact Phaser geometry.
// No secondary art implementation to drift when a weapon or skin is restyled.
const canvasGraphicsCache = new WeakMap();
function graphicsForCanvas(c) {
  if (canvasGraphicsCache.has(c)) return canvasGraphicsCache.get(c);
  const css = (color, alpha = 1) => {
    const v = toInt(color);
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + alpha + ')';
  };
  const pathCircle = (x, y, r) => { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, TAU); };
  const pathEllipse = (x, y, w, h) => { c.beginPath(); c.ellipse(x, y, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, TAU); };
  const pathTriangle = (x1, y1, x2, y2, x3, y3) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.closePath(); };
  const pathRoundRect = (x, y, w, h, radius) => {
    const r = Math.max(0, Math.min(typeof radius === 'number' ? radius : 0, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  };
  const g = {
    fillStyle(color, alpha = 1) { c.fillStyle = css(color, alpha); },
    lineStyle(width, color, alpha = 1) { c.lineWidth = width; c.strokeStyle = css(color, alpha); c.lineJoin = 'round'; c.lineCap = 'round'; },
    save() { c.save(); }, restore() { c.restore(); },
    translateCanvas(x, y) { c.translate(x, y); }, rotateCanvas(a) { c.rotate(a); }, scaleCanvas(x, y) { c.scale(x, y); },
    beginPath() { c.beginPath(); }, closePath() { c.closePath(); },
    moveTo(x, y) { c.moveTo(x, y); }, lineTo(x, y) { c.lineTo(x, y); },
    arc(x, y, r, a0, a1, ccw = false) { c.arc(x, y, Math.max(0, r), a0, a1, ccw); },
    fillPath() { c.fill(); }, strokePath() { c.stroke(); },
    fillRect(x, y, w, h) { c.fillRect(x, y, w, h); }, strokeRect(x, y, w, h) { c.strokeRect(x, y, w, h); },
    fillCircle(x, y, r) { pathCircle(x, y, r); c.fill(); }, strokeCircle(x, y, r) { pathCircle(x, y, r); c.stroke(); },
    fillEllipse(x, y, w, h) { pathEllipse(x, y, w, h); c.fill(); }, strokeEllipse(x, y, w, h) { pathEllipse(x, y, w, h); c.stroke(); },
    fillTriangle(...args) { pathTriangle(...args); c.fill(); }, strokeTriangle(...args) { pathTriangle(...args); c.stroke(); },
    fillRoundedRect(...args) { pathRoundRect(...args); c.fill(); }, strokeRoundedRect(...args) { pathRoundRect(...args); c.stroke(); },
  };
  canvasGraphicsCache.set(c, g);
  return g;
}
function drawBallDetails(c, charId, r, opts = {}) { drawBallDetailsG(graphicsForCanvas(c), charId, r, opts); }
function drawBall(c, f, x, y, r, opts = {}) { drawBallG(graphicsForCanvas(c), f, x, y, r, opts); }

function drawLoadoutPortrait(target, charId, weaponId, color = '#4da6ff') {
  if (!target || !CHARACTERS[charId] || !WEAPONS[weaponId]) return;
  const c = target.getContext('2d');
  const dpr = getRenderPixelRatio();
  // 하한을 두면 그보다 납작한 칸에서 캔버스가 눌려 그림이 찌그러진다
  const w = target.clientWidth || 180;
  const h = target.clientHeight || 130;
  target.width = Math.round(w * dpr);
  target.height = Math.round(h * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  c.fillStyle = 'rgba(255,249,218,.32)';
  c.beginPath(); c.ellipse(w * 0.46, h * 0.52, w * 0.36, h * 0.4, 0, 0, TAU); c.fill();

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
  // Portrait-only pose. Do not initialize physics or change a real fighter to
  // show equipment: the same drawChainG simply receives a small hanging chain.
  if (weaponId === 'chain') {
    f.chainHeads = [{ x: f.x + 55, y: f.y + 4, nodes: [
      { x: f.x + 20, y: f.y - 16 }, { x: f.x + 35, y: f.y - 19 },
      { x: f.x + 49, y: f.y - 13 },
    ] }];
  }
  drawWeapon(c, f);
  drawBall(c, f, f.x, f.y, f.radius);
  c.restore();
}

/* ---------------- 무기 ---------------- */
function drawWeapon(c, f) { drawWeaponG(graphicsForCanvas(c), f); }
