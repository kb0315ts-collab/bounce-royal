'use strict';
/* ============================================================
 * 바운스 로얄 — 솔로 로그라이크 그림
 *
 * render.js와 같은 문법으로 그린다: 굵은 먹선(CASUAL_INK), 단색 면, 흰 하이라이트,
 * 바닥 그림자. 공이 화면에서 반지름 7~10px 남짓이라 몬스터마다 한눈에 읽히는
 * 실루엣 하나(귀·모자·뿔·드릴·해파리 다리)를 크게 둔다.
 * 예고(위험지역)는 모두 바닥 층에 그리고, 발동이 가까울수록 차오르고 밝아진다.
 * 게임 상태를 읽기만 하고 바꾸지 않는다. 난수도 쓰지 않는다.
 * ============================================================ */

const RG_THEME = Object.freeze({
  fire:   { line: 0xff7a3c, fill: 0xff8a3c, core: 0xffe08a },
  earth:  { line: 0xd79a4a, fill: 0xe0a656, core: 0xfff0c8 },
  arcane: { line: 0x9f86ff, fill: 0x8f74ff, core: 0xf0e8ff },
  star:   { line: 0xffc94d, fill: 0xffd76a, core: 0xfffbe0 },
  boom:   { line: 0xff5a3c, fill: 0xff6a3c, core: 0xffe6a0 },
});
const rgNow = () => performance.now() / 1000;

/* ---------------- 공통 몸통 ---------------- */
function rgBall(g, f, x, y, r, pal, opts = {}) {
  const hit = Math.max(0, Math.min(1, (f.flash || 0) / 0.12));
  if (!opts.noShadow) { g.fillStyle(CASUAL_INK, 0.18); g.fillEllipse(x + r * 0.1, y + r * 0.77, r * 2.06, r * 0.82); }
  g.save(); g.translateCanvas(x, y);
  const sx = (opts.sx || 1) * (1 + hit * 0.09), sy = (opts.sy || 1) * (1 - hit * 0.08);
  if (opts.rot) g.rotateCanvas(opts.rot);
  g.scaleCanvas(sx, sy);
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  g.fillStyle(toInt(pal.dark), alpha); g.fillCircle(0, 0, r);
  g.fillStyle(toInt(pal.body), alpha); g.fillEllipse(-r * 0.045, -r * 0.12, r * 1.86, r * 1.58);
  g.lineStyle(Math.max(2.3, r * 0.12), CASUAL_INK, 1); g.strokeCircle(0, 0, r);
  g.fillStyle(0xffffff, 0.72 * alpha); g.fillEllipse(-r * 0.38, -r * 0.51, r * 0.42, r * 0.17);
  g.restore();
}
function rgFlash(g, f, x, y, r) {
  if (!(f.flash > 0)) return;
  g.fillStyle(0xffffff, Math.min(0.6, f.flash * 5)); g.fillCircle(x, y, r);
}
// 눈 두 개. look은 보는 방향(rad). 몬스터는 얼굴이 있어 '적'으로 읽힌다 (플레이어 공에는 얼굴이 없다).
function rgEyes(g, x, y, r, look, opts = {}) {
  const ex = r * (opts.spread || 0.33), ey = -r * (opts.up || 0.12);
  const w = r * (opts.w || 0.36), h = r * (opts.h || 0.44);
  const px = Math.cos(look) * r * 0.09, py = Math.sin(look) * r * 0.09;
  for (const s of [-1, 1]) {
    g.fillStyle(opts.white || 0xfffbe8, 1); g.fillEllipse(x + s * ex, y + ey, w, h);
    g.lineStyle(Math.max(1.2, r * 0.06), CASUAL_INK, 1); g.strokeEllipse(x + s * ex, y + ey, w, h);
    g.fillStyle(opts.pupil || CASUAL_INK, 1); g.fillCircle(x + s * ex + px, y + ey + py, r * (opts.pupilR || 0.12));
  }
  if (opts.brow !== false) {
    g.lineStyle(Math.max(1.6, r * 0.11), CASUAL_INK, 1);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + s * (ex + w * 0.55), y + ey - h * 0.62 - (opts.angry ? r * 0.08 : 0));
      g.lineTo(x + s * (ex - w * 0.45), y + ey - h * 0.42 + (opts.angry ? r * 0.06 : 0));
      g.strokePath();
    }
  }
}
function rgGoblinFace(g, x, y, r, look, pal, opts = {}) {
  rgEyes(g, x, y, r, look, { angry: true, ...opts });
  // 입과 엄니
  const my = y + r * 0.38, mw = r * 0.46;
  g.fillStyle(0x5a2a2a, 1); g.fillRoundedRect(x - mw / 2, my - r * 0.08, mw, r * 0.17, r * 0.07);
  g.fillStyle(0xfff6dc, 1);
  g.fillTriangle(x - mw * 0.38, my - r * 0.08, x - mw * 0.2, my - r * 0.08, x - mw * 0.3, my - r * 0.26);
  g.fillTriangle(x + mw * 0.38, my - r * 0.08, x + mw * 0.2, my - r * 0.08, x + mw * 0.3, my - r * 0.26);
}
// 고블린 귀 — 화면 기준 좌우로 뾰족하게. 공이 돌아도 귀는 돌지 않는다.
function rgEars(g, x, y, r, pal, size = 1) {
  for (const s of [-1, 1]) {
    const ax = x + s * r * 0.78, ay = y - r * 0.28;
    const tx = x + s * r * (1.25 + 0.3 * size), ty = y - r * (0.62 + 0.18 * size);
    const bx = x + s * r * 0.8, by = y + r * 0.18;
    g.fillStyle(toInt(pal.body), 1); g.fillTriangle(ax, ay, tx, ty, bx, by);
    g.lineStyle(Math.max(1.8, r * 0.1), CASUAL_INK, 1); g.strokeTriangle(ax, ay, tx, ty, bx, by);
    g.fillStyle(0xf2a39a, 1);
    g.fillTriangle(ax + s * r * 0.08, ay + r * 0.1, tx - s * r * 0.12, ty + r * 0.1, bx + s * r * 0.06, by - r * 0.1);
  }
}
/* 몬스터는 나온 순간부터 제 크기다 (작게 나와 커지는 연출은 쓰지 않는다). */
function rgSpawnScale() { return 1; }

/* ---------------- 무기 부품 ---------------- */
/* 도는 무기가 지나온 자리에 옅은 부채꼴을 남긴다. 회전이 빠를수록 길게 남는다. */
function rgSpinTrail(g, f, def) {
  const span = Math.min(2.0, Math.max(0.5, def.rot * 0.55));
  const a1 = f.weaponAngle, a0 = a1 - span;
  const r0 = f.radius * 0.7, r1 = f.radius + def.reach * (f.sizeMul || 1);
  g.fillStyle(0xfff4d9, 0.14);
  g.beginPath();
  g.arc(f.x, f.y, r1, a0, a1);
  g.arc(f.x, f.y, r0, a1, a0, true);
  g.closePath(); g.fillPath();
}
function rgClub(g, f, len, thick, spiked) {
  g.save(); g.translateCanvas(f.x, f.y); g.rotateCanvas(f.weaponAngle);
  const r = f.radius, x0 = r * 0.45, x1 = r + len;
  g.fillStyle(0xb98552, 1);
  g.beginPath();
  g.moveTo(x0, -thick * 0.28); g.lineTo(x1 - thick * 0.5, -thick * 0.62);
  g.lineTo(x1 - thick * 0.5, thick * 0.62); g.lineTo(x0, thick * 0.28); g.closePath(); g.fillPath();
  g.lineStyle(Math.max(1.8, thick * 0.16), CASUAL_INK, 1); g.strokePath();
  g.fillStyle(0xcf9a64, 1); g.fillCircle(x1 - thick * 0.5, 0, thick * 0.62);
  g.strokeCircle(x1 - thick * 0.5, 0, thick * 0.62);
  g.fillStyle(0x8c5d36, 1); g.fillCircle(x1 - thick * 0.62, -thick * 0.15, thick * 0.14); g.fillCircle(x0 + len * 0.45, thick * 0.08, thick * 0.1);
  if (spiked) {
    g.fillStyle(0xfff6dc, 1);
    for (const a of [-1.2, -0.4, 0.4, 1.2]) {
      const cx = x1 - thick * 0.5 + Math.cos(a) * thick * 0.62, cy = Math.sin(a) * thick * 0.62;
      const tx = x1 - thick * 0.5 + Math.cos(a) * thick * 1.05, ty = Math.sin(a) * thick * 1.05;
      g.fillTriangle(cx - Math.sin(a) * 2.5, cy + Math.cos(a) * 2.5, cx + Math.sin(a) * 2.5, cy - Math.cos(a) * 2.5, tx, ty);
      g.lineStyle(1.3, CASUAL_INK, 1);
      g.strokeTriangle(cx - Math.sin(a) * 2.5, cy + Math.cos(a) * 2.5, cx + Math.sin(a) * 2.5, cy - Math.cos(a) * 2.5, tx, ty);
    }
  }
  g.restore();
}
// 휘두르는 궤적 — 흰 호 두 줄
function rgSwingTrail(g, f, from, to, reach) {
  const R = f.radius + reach;
  for (let i = 0; i < 2; i++) {
    g.lineStyle(4 - i * 1.5, 0xfff6dc, 0.75 - i * 0.3);
    g.beginPath(); g.arc(f.x, f.y, R - i * 6, Math.min(from, to), Math.max(from, to)); g.strokePath();
  }
}
// 휘두를 자리 예고 — 붉은 부채꼴이 차오른다
function rgSectorWarn(g, x, y, r, face, arc, p, color = 0xff5a4f) {
  const a0 = face - arc / 2, a1 = face + arc / 2;
  g.fillStyle(color, 0.1 + 0.16 * p);
  g.beginPath(); g.moveTo(x, y); g.arc(x, y, r * (0.35 + 0.65 * p), a0, a1); g.closePath(); g.fillPath();
  g.lineStyle(2.2, color, 0.35 + 0.5 * p);
  g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0, a1); g.closePath(); g.strokePath();
}

/* ═══════════ 몬스터 ═══════════ */
function drawMonsterG(g, f, b) {
  if (f.dead) return;
  const type = f.mtype, pal = f.monster.palette, t = rgNow();
  const R = f.radius * rgSpawnScale(f);
  const look = f.weaponAngle != null ? f.weaponAngle : Math.atan2(f.vy, f.vx);
  // 무기가 도는 몬스터는 얼굴이 무기를 따라 돌면 안 된다 — 가는 쪽을 본다
  const moveDir = Math.atan2(f.vy, f.vx);
  const ai = f.ai || {};
  switch (type) {
    case 'club': case 'giant': {
      const def = f.monster, giant = type === 'giant';
      rgSpinTrail(g, f, def);
      const cs = f.sizeMul || 1;
      rgClub(g, f, def.reach * cs * (giant ? 1 : 0.95), (giant ? 15 : 9.5) * cs, giant);
      rgEars(g, f.x, f.y, R, pal, giant ? 1.1 : 1);
      rgBall(g, f, f.x, f.y, R, pal);
      if (giant) {
        // 어깨끈
        g.lineStyle(R * 0.2, 0x8a6547, 1); g.beginPath(); g.moveTo(f.x - R * 0.72, f.y - R * 0.55); g.lineTo(f.x + R * 0.62, f.y + R * 0.7); g.strokePath();
        g.lineStyle(1.6, CASUAL_INK, 0.8); g.beginPath(); g.moveTo(f.x - R * 0.72, f.y - R * 0.55); g.lineTo(f.x + R * 0.62, f.y + R * 0.7); g.strokePath();
      }
      rgGoblinFace(g, f.x, f.y, R, moveDir, pal, giant ? { brow: true, w: 0.3, h: 0.36 } : {});
      break;
    }
    case 'slime': {
      const def = f.monster;
      const swell = ai.state === 'windup' ? 1 + (1 - ai.t / def.windup) * 0.55 : 1;
      rgEars(g, f.x, f.y, R, pal, 0.8);
      rgBall(g, f, f.x, f.y, R, pal);
      // 머리 위 점액 덩어리
      g.fillStyle(0x9be05a, 0.95);
      g.fillCircle(f.x - R * 0.2, f.y - R * 0.85, R * 0.32); g.fillCircle(f.x + R * 0.18, f.y - R * 0.9, R * 0.26);
      g.fillCircle(f.x + R * 0.42, f.y - R * 0.55, R * 0.14 + Math.sin(t * 5 + f.uid) * 1.2);
      rgGoblinFace(g, f.x, f.y, R, look, pal);
      // 뱉을 점액 주머니 — 뱉기 전에 부풀어 오른다
      const sx = f.x + Math.cos(look) * (R + 6), sy = f.y + Math.sin(look) * (R + 6);
      g.fillStyle(0x9be05a, 0.95); g.fillCircle(sx, sy, 6 * swell);
      g.lineStyle(1.8, CASUAL_INK, 1); g.strokeCircle(sx, sy, 6 * swell);
      g.fillStyle(0xe8ffc8, 0.9); g.fillCircle(sx - 2 * swell, sy - 2 * swell, 1.8 * swell);
      break;
    }
    case 'hammer': {
      const def = f.monster;
      rgSpinTrail(g, f, def);
      const hs = f.sizeMul || 1;
      rgHammer(g, f.x, f.y, f.weaponAngle, f.radius * 0.4, f.radius + def.reach * hs * 0.82, 11 * hs, 0x9aa7b8, 0x6f7d90);
      rgEars(g, f.x, f.y, R, pal, 0.9);
      rgBall(g, f, f.x, f.y, R, pal);
      // 쇠 투구와 정예 별
      g.fillStyle(0x9aa7b8, 1);
      g.beginPath(); g.arc(f.x, f.y - R * 0.12, R * 0.98, Math.PI * 1.08, Math.PI * 1.92); g.closePath(); g.fillPath();
      g.lineStyle(Math.max(2, R * 0.1), CASUAL_INK, 1); g.strokePath();
      g.fillStyle(0xc9d2de, 1); g.fillRoundedRect(f.x - R * 0.95, f.y - R * 0.3, R * 1.9, R * 0.2, R * 0.08);
      g.strokeRoundedRect(f.x - R * 0.95, f.y - R * 0.3, R * 1.9, R * 0.2, R * 0.08);
      comicStar(g, f.x, f.y - R * 0.72, R * 0.22, '#ffd24d', 1, 5, -Math.PI / 2);
      rgGoblinFace(g, f.x, f.y + R * 0.08, R * 0.92, moveDir, pal, { up: 0.05 });
      break;
    }
    case 'mage': {
      const casting = ai.state === 'cast';
      // 지팡이
      g.save(); g.translateCanvas(f.x, f.y); g.rotateCanvas(look + 0.5);
      g.lineStyle(5, CASUAL_INK, 1); g.beginPath(); g.moveTo(R * 0.2, 0); g.lineTo(R + 20, 0); g.strokePath();
      g.lineStyle(2.6, 0xc99a62, 1); g.beginPath(); g.moveTo(R * 0.2, 0); g.lineTo(R + 20, 0); g.strokePath();
      const orb = 5.5 + (casting ? 2.5 + Math.sin(t * 18) * 1.2 : Math.sin(t * 4) * 0.6);
      if (casting) { g.fillStyle(0xff8a3c, 0.35); g.fillCircle(R + 24, 0, orb + 5); }
      g.fillStyle(casting ? 0xffb35c : 0x8d6ae0, 1); g.fillCircle(R + 24, 0, orb);
      g.lineStyle(1.6, CASUAL_INK, 1); g.strokeCircle(R + 24, 0, orb);
      g.restore();
      rgEars(g, f.x, f.y, R, pal, 0.75);
      rgBall(g, f, f.x, f.y, R, pal);
      rgGoblinFace(g, f.x, f.y + R * 0.1, R * 0.9, look, pal, { up: 0.02 });
      // 보라 마법사 모자
      g.fillStyle(0x7a55cf, 1);
      g.fillTriangle(f.x - R * 0.72, f.y - R * 0.5, f.x + R * 0.72, f.y - R * 0.5, f.x + R * 0.28, f.y - R * 1.75);
      g.lineStyle(Math.max(1.8, R * 0.1), CASUAL_INK, 1);
      g.strokeTriangle(f.x - R * 0.72, f.y - R * 0.5, f.x + R * 0.72, f.y - R * 0.5, f.x + R * 0.28, f.y - R * 1.75);
      g.fillStyle(0x9c7ae8, 1); g.fillEllipse(f.x, f.y - R * 0.5, R * 1.9, R * 0.42); g.strokeEllipse(f.x, f.y - R * 0.5, R * 1.9, R * 0.42);
      comicStar(g, f.x + R * 0.12, f.y - R * 1.05, R * 0.2, '#ffe36a', 1, 5, t);
      if (casting) for (let i = 0; i < 3; i++) {
        const a = t * 5 + i * TAU / 3;
        comicStar(g, f.x + Math.cos(a) * (R + 9), f.y + Math.sin(a) * (R + 9), 3.5, '#ffd28a', 0.9, 4, a);
      }
      break;
    }
    case 'volt': {
      rgBall(g, f, f.x, f.y, R, pal);
      // 플러그 두 갈래
      g.fillStyle(0xb9c4d2, 1);
      for (const s of [-1, 1]) {
        g.fillRoundedRect(f.x + s * R * 0.32 - R * 0.1, f.y - R * 1.28, R * 0.2, R * 0.42, 1.5);
        g.lineStyle(1.4, CASUAL_INK, 1); g.strokeRoundedRect(f.x + s * R * 0.32 - R * 0.1, f.y - R * 1.28, R * 0.2, R * 0.42, 1.5);
      }
      // 번개 문양
      g.fillStyle(0xffffff, 1);
      g.beginPath();
      g.moveTo(f.x + R * 0.12, f.y - R * 0.6); g.lineTo(f.x - R * 0.28, f.y + R * 0.08); g.lineTo(f.x + R * 0.02, f.y + R * 0.08);
      g.lineTo(f.x - R * 0.14, f.y + R * 0.62); g.lineTo(f.x + R * 0.32, f.y - R * 0.08); g.lineTo(f.x + R * 0.02, f.y - R * 0.08);
      g.closePath(); g.fillPath(); g.lineStyle(1.4, CASUAL_INK, 1); g.strokePath();
      rgEyes(g, f.x, f.y - R * 0.05, R * 0.8, look, { spread: 0.5, brow: false, pupilR: 0.16 });
      break;
    }
    case 'suction': {
      const at = f.attached;
      if (at) {
        // 영웅 표면에 납작하게 붙어 흡반이 영웅 쪽을 본다
        const face = at.ang + Math.PI;
        rgBall(g, f, f.x, f.y, R, pal, { sx: 0.72, sy: 1.08, rot: face, noShadow: true });
        rgSuctionCup(g, f.x + Math.cos(face) * R * 0.55, f.y + Math.sin(face) * R * 0.55, R * 0.6, face);
        const pulse = 0.5 + Math.sin(t * 9 + f.uid) * 0.5;
        g.lineStyle(2, 0xff9fc6, 0.35 + pulse * 0.4); g.strokeCircle(f.x, f.y, R + 3);
        break;
      }
      const face = Math.atan2(f.vy, f.vx);
      rgBall(g, f, f.x, f.y, R, pal);
      rgSuctionCup(g, f.x + Math.cos(face) * R * 0.62, f.y + Math.sin(face) * R * 0.62, R * 0.52, face);
      rgEyes(g, f.x - Math.cos(face) * R * 0.22, f.y - Math.sin(face) * R * 0.22 - R * 0.1, R * 0.75, face, { brow: false });
      if (f.timers.stun > 0) rgDizzy(g, f.x, f.y - R - 6, R, t);
      break;
    }
    case 'boom': {
      const fusing = ai.fuse > 0;
      const blink = fusing && Math.sin(t * (10 + (1 - ai.fuse / (ai.fuseMax || 2)) * 26)) > 0;
      rgBall(g, f, f.x, f.y, R, blink ? { body: '#fff1d6', dark: '#ffb37a' } : pal);
      g.fillStyle(0x3b2b33, 1); g.fillRoundedRect(f.x - R * 0.98, f.y - R * 0.05, R * 1.96, R * 0.3, R * 0.1);
      // 심지와 불꽃
      g.lineStyle(2.6, 0x7a5a3a, 1); g.beginPath(); g.moveTo(f.x + R * 0.2, f.y - R * 0.95); g.lineTo(f.x + R * 0.45, f.y - R * 1.35); g.lineTo(f.x + R * 0.72, f.y - R * 1.28); g.strokePath();
      if (Math.sin(t * 16 + f.uid) > -0.3 || fusing) comicStar(g, f.x + R * 0.72, f.y - R * 1.28, (fusing ? 6 : 4) + Math.sin(t * 22) * 1.2, fusing ? '#ff6a3c' : '#ffd24d', 1, 4, t * 3);
      rgEyes(g, f.x, f.y - R * 0.3, R * 0.85, look, { angry: true, up: 0.05 });
      break;
    }
    case 'drill': {
      if (ai.state === 'tunnel' || ai.state === 'warn') { rgDrillMound(g, f, t); break; }
      const face = Math.atan2(f.vy, f.vx);
      rgDrillCone(g, f.x, f.y, R, face, t * (ai.state === 'burst' ? 30 : 12));
      rgBall(g, f, f.x, f.y, R, pal);
      // 고글
      g.fillStyle(0x3b4a5c, 1); g.fillRoundedRect(f.x - R * 0.8, f.y - R * 0.42, R * 1.6, R * 0.5, R * 0.2);
      g.lineStyle(1.6, CASUAL_INK, 1); g.strokeRoundedRect(f.x - R * 0.8, f.y - R * 0.42, R * 1.6, R * 0.5, R * 0.2);
      for (const s of [-1, 1]) { g.fillStyle(0xf0c05a, 1); g.fillCircle(f.x + s * R * 0.35, f.y - R * 0.17, R * 0.19); g.strokeCircle(f.x + s * R * 0.35, f.y - R * 0.17, R * 0.19); }
      g.fillStyle(0x5a7896, 1); for (const s of [-1, 1]) g.fillCircle(f.x + s * R * 0.55, f.y + R * 0.45, R * 0.08);
      break;
    }
    case 'gel': {
      const def = f.monster;
      const soon = ai.dup != null && ai.dup < def.dupWarn && !(f.timers.stun > 0);
      const k = soon ? 1 - ai.dup / def.dupWarn : 0;
      const wob = Math.sin(t * 5 + f.uid) * 0.05;
      const face = Math.atan2(f.vy, f.vx) + Math.PI / 2;
      rgBall(g, f, f.x, f.y, R, pal, { sx: 1 + wob + k * 0.32, sy: 1 - wob - k * 0.16, rot: soon ? face : 0, alpha: 0.86 });
      g.fillStyle(0xe7fffb, 0.8);
      g.fillCircle(f.x - R * 0.25, f.y + R * 0.15, R * 0.14); g.fillCircle(f.x + R * 0.28, f.y + R * 0.3, R * 0.1); g.fillCircle(f.x + R * 0.05, f.y - R * 0.35, R * 0.08);
      if (soon) {
        // 곧 갈라진다 — 가운데에 잘록한 선
        g.lineStyle(2, CASUAL_INK, 0.5 + k * 0.5);
        g.beginPath(); g.moveTo(f.x + Math.cos(face + Math.PI / 2) * R * 0.9, f.y + Math.sin(face + Math.PI / 2) * R * 0.9);
        g.lineTo(f.x - Math.cos(face + Math.PI / 2) * R * 0.9, f.y - Math.sin(face + Math.PI / 2) * R * 0.9); g.strokePath();
        g.lineStyle(2.5, 0x7df2e3, 0.4 + 0.5 * Math.abs(Math.sin(t * 14))); g.strokeCircle(f.x, f.y, R + 4 + k * 4);
      }
      rgEyes(g, f.x, f.y - R * 0.12, R * 0.8, look, { brow: false, pupilR: 0.15 });
      break;
    }
    case 'horn': {
      const face = ai.state === 'aim' || ai.state === 'charge' ? ai.aimAng : Math.atan2(f.vy, f.vx);
      rgBall(g, f, f.x, f.y, R, pal);
      rgHorns(g, f.x, f.y, R, face);
      // 코와 코뚜레
      const nx = f.x + Math.cos(face) * R * 0.62, ny = f.y + Math.sin(face) * R * 0.62;
      g.fillStyle(0xe8b894, 1); g.fillEllipse(nx, ny, R * 0.7, R * 0.5); g.lineStyle(1.5, CASUAL_INK, 1); g.strokeEllipse(nx, ny, R * 0.7, R * 0.5);
      g.lineStyle(2.2, 0xffd24d, 1); g.strokeCircle(nx + Math.cos(face) * R * 0.26, ny + Math.sin(face) * R * 0.26, R * 0.16);
      rgEyes(g, f.x - Math.cos(face) * R * 0.1, f.y - Math.sin(face) * R * 0.1 - R * 0.18, R * 0.85, face, { angry: true });
      if (ai.state === 'aim') {
        // 콧김
        for (let i = 0; i < 2; i++) {
          const a = face + Math.PI + (i ? 0.5 : -0.5), k2 = (t * 2 + i * 0.5) % 1;
          g.fillStyle(0xffffff, 0.6 * (1 - k2)); g.fillCircle(f.x + Math.cos(a) * (R + 4 + k2 * 12), f.y + Math.sin(a) * (R + 4 + k2 * 12), 3 + k2 * 4);
        }
      }
      if (ai.state === 'daze') rgDizzy(g, f.x, f.y - R - 6, R, t);
      break;
    }
    case 'spark': {
      const face = Math.atan2(f.vy, f.vx);
      // 다리 — 진행 반대쪽으로 흐늘거린다
      for (let i = 0; i < 5; i++) {
        const off = (i - 2) * 0.28, a = face + Math.PI + off;
        g.lineStyle(2.4, 0x3a9fc4, 0.9); g.beginPath();
        let px = f.x + Math.cos(a) * R * 0.6, py = f.y + Math.sin(a) * R * 0.6;
        g.moveTo(px, py);
        for (let s = 1; s <= 4; s++) {
          const w = Math.sin(t * 6 + i + s) * 3;
          px = f.x + Math.cos(a) * (R * 0.6 + s * 7) - Math.sin(a) * w; py = f.y + Math.sin(a) * (R * 0.6 + s * 7) + Math.cos(a) * w;
          g.lineTo(px, py);
        }
        g.strokePath();
      }
      rgBall(g, f, f.x, f.y, R, pal, { alpha: 0.92 });
      g.fillStyle(0xd6fbff, 0.8); g.fillEllipse(f.x, f.y - R * 0.3, R * 1.3, R * 0.5);
      // 빛나는 점
      for (let i = 0; i < 3; i++) { g.fillStyle(0xfff78a, 0.6 + 0.4 * Math.sin(t * 5 + i)); g.fillCircle(f.x + (i - 1) * R * 0.42, f.y + R * 0.4, R * 0.1); }
      rgEyes(g, f.x, f.y - R * 0.05, R * 0.75, face, { brow: false });
      break;
    }
    case 'medic': {
      rgBall(g, f, f.x, f.y, R, pal);
      // 빨간 십자와 간호모
      g.fillStyle(0xff6b6b, 1);
      g.fillRect(f.x - R * 0.13, f.y + R * 0.05, R * 0.26, R * 0.7); g.fillRect(f.x - R * 0.35, f.y + R * 0.27, R * 0.7, R * 0.26);
      g.fillStyle(0xffffff, 1); g.fillRoundedRect(f.x - R * 0.58, f.y - R * 1.18, R * 1.16, R * 0.5, R * 0.12);
      g.lineStyle(1.6, CASUAL_INK, 1); g.strokeRoundedRect(f.x - R * 0.58, f.y - R * 1.18, R * 1.16, R * 0.5, R * 0.12);
      g.fillStyle(0xff6b6b, 1); g.fillRect(f.x - R * 0.06, f.y - R * 1.12, R * 0.12, R * 0.38); g.fillRect(f.x - R * 0.19, f.y - R * 0.99, R * 0.38, R * 0.12);
      rgEyes(g, f.x, f.y - R * 0.25, R * 0.8, look, { brow: false, pupilR: 0.13 });
      if (ai.pulse > 0) { g.lineStyle(3, 0x7dffa8, ai.pulse * 1.4); g.strokeCircle(f.x, f.y, R + 6 + (0.55 - ai.pulse) * 30); }
      break;
    }
    case 'former': drawFormerChampion(g, f, t); break;
    case 'current': drawCurrentChampion(g, f, t); break;
  }
  rgFlash(g, f, f.x, f.y, R);
  if (f.timers && f.timers.freeze > 0) { g.fillStyle(0x8cc8ff, 0.35); g.fillCircle(f.x, f.y, R + 3); }
  if (f.timers && f.timers.stun > 0 && type !== 'suction' && type !== 'horn') rgDizzy(g, f.x, f.y - R - 6, R, t);
}

function rgHammer(g, x, y, ang, r0, r1, headR, metal, shade) {
  g.save(); g.translateCanvas(x, y); g.rotateCanvas(ang);
  g.lineStyle(headR * 0.62, CASUAL_INK, 1); g.beginPath(); g.moveTo(r0, 0); g.lineTo(r1, 0); g.strokePath();
  g.lineStyle(headR * 0.36, 0xb98552, 1); g.beginPath(); g.moveTo(r0, 0); g.lineTo(r1, 0); g.strokePath();
  g.fillStyle(metal, 1); g.fillRoundedRect(r1 - headR * 0.8, -headR * 1.2, headR * 1.6, headR * 2.4, headR * 0.35);
  g.lineStyle(Math.max(1.8, headR * 0.2), CASUAL_INK, 1); g.strokeRoundedRect(r1 - headR * 0.8, -headR * 1.2, headR * 1.6, headR * 2.4, headR * 0.35);
  g.fillStyle(shade, 1); g.fillRect(r1 - headR * 0.8 + 2, headR * 0.3, headR * 1.6 - 4, headR * 0.6);
  g.fillStyle(0xffffff, 0.55); g.fillRect(r1 - headR * 0.55, -headR * 0.95, headR * 0.3, headR * 1.3);
  g.restore();
}
function rgSuctionCup(g, x, y, r, face) {
  g.save(); g.translateCanvas(x, y); g.rotateCanvas(face);
  g.fillStyle(0xff9fc6, 1); g.fillEllipse(0, 0, r * 0.9, r * 2);
  g.lineStyle(Math.max(1.5, r * 0.2), CASUAL_INK, 1); g.strokeEllipse(0, 0, r * 0.9, r * 2);
  g.fillStyle(0xb44f86, 1); g.fillEllipse(r * 0.08, 0, r * 0.45, r * 1.2);
  g.restore();
}
function rgDrillCone(g, x, y, R, face, spin) {
  g.save(); g.translateCanvas(x, y); g.rotateCanvas(face);
  const L = R * 1.1;
  g.fillStyle(0xf0c05a, 1); g.fillTriangle(R * 0.6, -R * 0.62, R * 0.6, R * 0.62, R * 0.6 + L, 0);
  g.lineStyle(Math.max(1.8, R * 0.1), CASUAL_INK, 1); g.strokeTriangle(R * 0.6, -R * 0.62, R * 0.6, R * 0.62, R * 0.6 + L, 0);
  // 나선 — 돌아가는 것처럼 줄이 흐른다
  g.lineStyle(1.6, 0xa8781c, 1);
  for (let i = 0; i < 4; i++) {
    const k = ((i / 4 + spin * 0.05) % 1);
    const px = R * 0.6 + L * k, h = R * 0.62 * (1 - k);
    g.beginPath(); g.moveTo(px, -h); g.lineTo(px + L * 0.12, h); g.strokePath();
  }
  g.restore();
}
function rgDrillMound(g, f, t) {
  const ai = f.ai, R = f.radius;
  const nx = ai.nx || 0, ny = ai.ny || -1;
  const x = f.x - nx * R * 0.5, y = f.y - ny * R * 0.5;
  const wob = Math.sin(t * 20) * 1.5;
  g.fillStyle(0x9c7147, 0.9); g.fillEllipse(x + wob, y, R * 2.1, R * 1.3);
  g.lineStyle(2, CASUAL_INK, 0.8); g.strokeEllipse(x + wob, y, R * 2.1, R * 1.3);
  g.fillStyle(0xc99a62, 1); g.fillEllipse(x + wob - R * 0.2, y - R * 0.2, R * 1.1, R * 0.55);
  for (let i = 0; i < 3; i++) {
    const a = t * 7 + i * 2.1, k = (t * 3 + i * 0.33) % 1;
    g.fillStyle(0xd9b88a, 0.8 * (1 - k)); g.fillCircle(x + Math.cos(a) * R * (0.8 + k), y + Math.sin(a) * R * (0.5 + k) - k * 8, 2.5);
  }
  if (ai.state === 'warn') {
    // 드릴 끝이 벽에서 살짝 나와 있다
    rgDrillCone(g, f.x, f.y, R * 0.8, Math.atan2(ny, nx), t * 20);
  }
}
function rgHorns(g, x, y, R, face) {
  for (const s of [-1, 1]) {
    const a = face + s * 0.72;
    const bx = x + Math.cos(a) * R * 0.78, by = y + Math.sin(a) * R * 0.78;
    const mx = x + Math.cos(face + s * 1.0) * R * 1.35, my = y + Math.sin(face + s * 1.0) * R * 1.35;
    const tx = x + Math.cos(face + s * 0.42) * R * 1.72, ty = y + Math.sin(face + s * 0.42) * R * 1.72;
    g.lineStyle(R * 0.36, CASUAL_INK, 1); g.beginPath(); g.moveTo(bx, by); g.lineTo(mx, my); g.lineTo(tx, ty); g.strokePath();
    g.lineStyle(R * 0.22, 0xfff3d6, 1); g.beginPath(); g.moveTo(bx, by); g.lineTo(mx, my); g.lineTo(tx, ty); g.strokePath();
  }
}
function rgDizzy(g, x, y, R, t) {
  for (let i = 0; i < 3; i++) {
    const a = t * 5 + i * TAU / 3;
    comicStar(g, x + Math.cos(a) * R * 0.7, y + Math.sin(a) * R * 0.22, 3.6, '#ffe36a', 1, 5, a);
  }
}

/* ═══════════ 보스 ═══════════ */
function drawFormerChampion(g, f, t) {
  const def = f.monster, ai = f.ai, pal = def.palette;
  let R = f.radius * rgSpawnScale(f), x = f.x, y = f.y;
  // 점프 중에는 그림자만 제자리에 두고 몸은 떠오른다
  let lift = 0;
  if (ai.state === 'air') {
    const p = 1 - ai.t / ai.dur;
    lift = Math.sin(Math.PI * p);
    g.fillStyle(CASUAL_INK, 0.28); g.fillEllipse(x, y + R * 0.7, R * 2.2 * (1 - lift * 0.3), R * 0.9 * (1 - lift * 0.3));
    y -= lift * 70; R *= 1 + lift * 0.35;
  }
  if (ai.phase === 2) {
    const pulse = 0.5 + Math.sin(t * 6) * 0.5;
    g.fillStyle(0xff5a3c, 0.12 + pulse * 0.1); g.fillCircle(x, y, R + 12 + pulse * 5);
  }
  // 해머
  const hr = def.hammerHeadR * (R / f.radius);
  const ang = f.weaponAngle;
  if (ai.state === 'spin') {
    for (let i = 1; i <= 3; i++) {
      g.lineStyle(5 - i, 0xfff6dc, 0.45 - i * 0.12);
      g.beginPath(); g.arc(x, y, def.hammerReach, ang - i * 0.45, ang - (i - 1) * 0.45); g.strokePath();
    }
  }
  const raised = ai.state === 'slam' || ai.state === 'wallUp' ? 1 - ai.t / (ai.state === 'slam' ? def.slam.warn : def.wall.warn) : 0;
  if (ai.state === 'recover' && ai.sweepFx > 0) rgSwingTrail(g, { x, y, radius: R }, ai.face - def.sweep.arc / 2, ai.face + def.sweep.arc / 2, def.sweep.r - R);
  const reach = def.hammerReach * (1 - raised * 0.45) * (R / f.radius);
  rgHammer(g, x, y, ang, R * 0.3, reach, hr * (1 + raised * 0.45), 0x8e8a86, 0x6d6964);
  // 해머 머리의 금 간 자국과 옛 챔피언 띠
  g.save(); g.translateCanvas(x, y); g.rotateCanvas(ang);
  g.fillStyle(0xd8b25a, 1); g.fillRect(reach - hr * 0.8 * (1 + raised * 0.45), -hr * 0.2, hr * 1.6 * (1 + raised * 0.45), hr * 0.4);
  g.lineStyle(1.5, CASUAL_INK, 0.8); g.beginPath(); g.moveTo(reach - hr * 0.3, -hr * 1.1); g.lineTo(reach, -hr * 0.6); g.lineTo(reach - hr * 0.2, -hr * 0.3); g.strokePath();
  g.restore();
  if (raised > 0) { g.lineStyle(3, 0xffe38a, 0.3 + raised * 0.6); g.strokeCircle(x + Math.cos(ang) * reach, y + Math.sin(ang) * reach, hr * 1.6 + raised * 4); }
  rgBall(g, f, x, y, R, pal, { noShadow: lift > 0 });
  // 낡은 머리띠와 바랜 챔피언 별
  g.fillStyle(0xb5453d, 1); g.fillRoundedRect(x - R * 0.96, y - R * 0.62, R * 1.92, R * 0.26, R * 0.1);
  g.lineStyle(Math.max(2, R * 0.06), CASUAL_INK, 1); g.strokeRoundedRect(x - R * 0.96, y - R * 0.62, R * 1.92, R * 0.26, R * 0.1);
  g.fillStyle(0xb5453d, 1); g.fillTriangle(x + R * 0.9, y - R * 0.55, x + R * 1.35, y - R * 0.35, x + R * 1.15, y - R * 0.2);
  comicStar(g, x, y - R * 0.49, R * 0.2, '#e3c26a', 0.95, 5, -Math.PI / 2);
  // 흉터
  g.lineStyle(2, 0xf0d7b4, 0.9); g.beginPath(); g.moveTo(x + R * 0.38, y + R * 0.1); g.lineTo(x + R * 0.62, y + R * 0.42); g.strokePath();
  // 굵은 흰 눈썹과 콧수염 — 노장의 얼굴
  rgEyes(g, x, y - R * 0.12, R * 0.9, ang, { brow: false, w: 0.26, h: 0.26, pupilR: 0.1, white: ai.phase === 2 ? 0xffd9a0 : 0xfffbe8 });
  g.fillStyle(0xeee7da, 1);
  for (const s of [-1, 1]) {
    g.fillEllipse(x + s * R * 0.3, y - R * 0.34, R * 0.46, R * 0.16);
    g.fillEllipse(x + s * R * 0.24, y + R * 0.2, R * 0.5, R * 0.2);
  }
  g.lineStyle(1.4, CASUAL_INK, 0.8);
  for (const s of [-1, 1]) g.strokeEllipse(x + s * R * 0.24, y + R * 0.2, R * 0.5, R * 0.2);
  if (ai.state === 'recover' || ai.state === 'spin') {
    const k = (t * 2) % 1;
    g.fillStyle(0xd9c3a0, 0.5 * (1 - k)); g.fillCircle(x - R * 0.9, y + R * 0.8, 5 + k * 8); g.fillCircle(x + R * 0.9, y + R * 0.8, 5 + k * 8);
  }
}

function drawCurrentChampion(g, f, t) {
  const def = f.monster, ai = f.ai, pal = def.palette;
  const R = f.radius * rgSpawnScale(f), x = f.x, y = f.y;
  const move = Math.atan2(f.vy, f.vx);
  const blinking = ai.state === 'blinkWarn';
  const alpha = blinking ? 0.45 + 0.4 * Math.abs(Math.sin(t * 24)) : 1;
  // 망토 — 가는 쪽 반대로 휘날린다
  g.save(); g.translateCanvas(x, y); g.rotateCanvas(move + Math.PI);
  const flap = Math.sin(t * 9) * 4;
  g.fillStyle(0xc0304a, alpha);
  g.beginPath(); g.moveTo(-R * 0.2, -R * 0.75); g.lineTo(R * 1.55, -R * 0.55 + flap); g.lineTo(R * 1.35, 0); g.lineTo(R * 1.6, R * 0.55 - flap); g.lineTo(-R * 0.2, R * 0.75); g.closePath(); g.fillPath();
  g.lineStyle(2.4, CASUAL_INK, alpha); g.strokePath();
  g.fillStyle(0xe8566e, alpha); g.fillTriangle(R * 0.1, -R * 0.4, R * 1.2, -R * 0.3 + flap * 0.5, R * 0.1, R * 0.1);
  g.restore();
  if (ai.state === 'novaCharge') {
    const k = 1 - ai.t / (def.nova.charge || 1.5);
    g.fillStyle(0xffd76a, 0.12 + k * 0.2); g.fillCircle(x, y, R + 14 + k * 30);
    g.lineStyle(3, 0xffe9a0, 0.5 + k * 0.5); g.strokeCircle(x, y, R + 10 + k * 40);
  }
  if (ai.phase === 2) { g.lineStyle(3, 0xff6fd8, 0.4 + 0.3 * Math.sin(t * 7)); g.strokeCircle(x, y, R + 8); }
  rgBall(g, f, x, y, R, pal, { alpha });
  // 금 테두리와 왕관
  g.lineStyle(Math.max(2, R * 0.12), 0xffd76a, alpha); g.strokeCircle(x, y, R * 0.82);
  g.fillStyle(0xffd76a, alpha);
  g.beginPath(); g.moveTo(x - R * 0.62, y - R * 0.72); g.lineTo(x - R * 0.62, y - R * 1.25); g.lineTo(x - R * 0.3, y - R * 0.98);
  g.lineTo(x, y - R * 1.42); g.lineTo(x + R * 0.3, y - R * 0.98); g.lineTo(x + R * 0.62, y - R * 1.25); g.lineTo(x + R * 0.62, y - R * 0.72); g.closePath(); g.fillPath();
  g.lineStyle(Math.max(1.8, R * 0.08), CASUAL_INK, alpha); g.strokePath();
  g.fillStyle(0xff5a8a, alpha); g.fillCircle(x, y - R * 1.08, R * 0.1);
  // 날카로운 빛나는 눈
  const look = f.weaponAngle;
  for (const s of [-1, 1]) {
    g.fillStyle(0xfff6c8, alpha);
    g.fillTriangle(x + s * R * 0.14, y - R * 0.12, x + s * R * 0.58, y - R * 0.26, x + s * R * 0.5, y + R * 0.02);
    g.fillStyle(0x43309c, alpha); g.fillCircle(x + s * R * 0.38 + Math.cos(look) * R * 0.05, y - R * 0.12 + Math.sin(look) * R * 0.04, R * 0.07);
  }
  // 도는 룬 돌 셋
  for (let i = 0; i < 3; i++) {
    const a = t * 2.2 + i * TAU / 3, rr = R + 14;
    const sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr * 0.6;
    g.fillStyle(0xb89bff, 0.95 * alpha); g.fillCircle(sx, sy, 4.2);
    g.lineStyle(1.4, CASUAL_INK, alpha); g.strokeCircle(sx, sy, 4.2);
    g.fillStyle(0xffffff, 0.8 * alpha); g.fillCircle(sx - 1.2, sy - 1.2, 1.3);
  }
  // 잔상 (궤적 돌진 중)
  if (ai.state === 'trail') for (let i = 1; i <= 3; i++) {
    g.fillStyle(0x8f74ff, 0.18 / i); g.fillCircle(x - f.vx * i * 16, y - f.vy * i * 16, R * (1 - i * 0.12));
  }
}

/* ═══════════ 바닥: 예고 · 장판 · 연결선 ═══════════ */
function rgDashCircle(g, x, y, r, color, alpha, width = 2.4, segs = 18, spin = 0) {
  g.lineStyle(width, color, alpha);
  for (let i = 0; i < segs; i++) {
    const a0 = spin + i * TAU / segs, a1 = a0 + TAU / segs * 0.55;
    g.beginPath(); g.arc(x, y, r, a0, a1); g.strokePath();
  }
}
function drawRogueGround(g, glow, b) {
  const t = rgNow();
  for (const h of b.rogueHazards || []) {
    if (h.kind === 'puddle') {
      const a = Math.min(1, (h.life - h.t) / 0.8) * Math.min(1, h.t / 0.2);
      g.fillStyle(0x8cc74a, 0.5 * a); g.fillEllipse(h.x, h.y, h.r * 2.1, h.r * 1.5);
      g.fillStyle(0xa8e05a, 0.7 * a); g.fillEllipse(h.x - h.r * 0.25, h.y - h.r * 0.12, h.r * 1.1, h.r * 0.7);
      g.fillStyle(0xe8ffc8, 0.7 * a); g.fillCircle(h.x + h.r * 0.35 + Math.sin(t * 3 + h.uid) * 2, h.y, 2.5);
      continue;
    }
    const p = Math.max(0, Math.min(1, h.t / Math.max(0.001, h.warn)));
    const after = h.fired ? h.t - h.warn : -1;
    if (h.kind === 'circle') {
      const th = RG_THEME[h.theme] || RG_THEME.fire;
      if (!h.fired) {
        if (h.shadow) { g.fillStyle(CASUAL_INK, 0.12 + p * 0.3); g.fillCircle(h.x, h.y, h.r * (0.3 + 0.7 * p)); }
        g.fillStyle(th.fill, 0.1 + 0.22 * p); g.fillCircle(h.x, h.y, h.r * p);
        const urgent = p > 0.72 ? 0.5 + 0.5 * Math.abs(Math.sin(t * 16)) : 0;
        rgDashCircle(g, h.x, h.y, h.r, th.line, 0.55 + 0.35 * p + urgent * 0.1, 2.6 + urgent * 1.4, 20, t * 0.8);
        if (h.theme === 'arcane' || h.theme === 'star') rgRune(g, h.x, h.y, h.r * 0.62, th.line, 0.35 + 0.4 * p, t);
        if (h.theme === 'earth') rgCracks(g, h.x, h.y, h.r * (0.4 + 0.6 * p), th.line, 0.4 + 0.4 * p, h.uid);
      } else {
        const k = Math.max(0, 1 - after / h.fade);
        g.fillStyle(h.theme === 'earth' ? 0x7a5a34 : 0x3b2b33, 0.25 * k); g.fillCircle(h.x, h.y, h.r * 0.95);
        g.lineStyle(4 * k, th.core, 0.8 * k); g.strokeCircle(h.x, h.y, h.r * (0.9 + (1 - k) * 0.25));
      }
    } else if (h.kind === 'ring') {
      if (!h.fired) continue;
      const th = RG_THEME[h.theme] || RG_THEME.earth;
      const pr = Math.min(1, after / h.dur), rad = h.r0 + (h.r1 - h.r0) * pr, k = 1 - Math.max(0, (after - h.dur) / h.fade);
      g.lineStyle(h.width, th.fill, 0.45 * k); g.strokeCircle(h.x, h.y, rad);
      g.lineStyle(3, th.core, 0.9 * k); g.strokeCircle(h.x, h.y, rad);
      g.lineStyle(2, CASUAL_INK, 0.4 * k); g.strokeCircle(h.x, h.y, rad + h.width / 2);
    } else if (h.kind === 'line') {
      const th = RG_THEME[h.theme] || RG_THEME.arcane;
      const dx = h.x2 - h.x, dy = h.y2 - h.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const nx = -uy * h.w / 2, ny = ux * h.w / 2;
      if (!h.fired) {
        g.fillStyle(th.fill, 0.08 + 0.16 * p);
        g.beginPath(); g.moveTo(h.x + nx, h.y + ny); g.lineTo(h.x2 + nx, h.y2 + ny); g.lineTo(h.x2 - nx, h.y2 - ny); g.lineTo(h.x - nx, h.y - ny); g.closePath(); g.fillPath();
        g.lineStyle(2.2, th.line, 0.5 + 0.4 * p);
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(h.x + nx * s, h.y + ny * s); g.lineTo(h.x2 + nx * s, h.y2 + ny * s); g.strokePath(); }
        // 차오르는 가운데 선
        g.lineStyle(3, th.core, 0.6); g.beginPath(); g.moveTo(h.x, h.y); g.lineTo(h.x + dx * p, h.y + dy * p); g.strokePath();
        // 화살 무늬
        for (let d = 30; d < len - 20; d += 60) {
          const cx = h.x + ux * d, cy = h.y + uy * d;
          g.lineStyle(2, th.line, 0.4 + 0.4 * p); g.beginPath();
          g.moveTo(cx - ux * 8 + nx * 0.5, cy - uy * 8 + ny * 0.5); g.lineTo(cx, cy); g.lineTo(cx - ux * 8 - nx * 0.5, cy - uy * 8 - ny * 0.5); g.strokePath();
        }
      } else {
        const active = after < h.active, k = active ? 1 : Math.max(0, 1 - (after - h.active) / h.fade);
        g.fillStyle(th.fill, 0.55 * k);
        g.beginPath(); g.moveTo(h.x + nx, h.y + ny); g.lineTo(h.x2 + nx, h.y2 + ny); g.lineTo(h.x2 - nx, h.y2 - ny); g.lineTo(h.x - nx, h.y - ny); g.closePath(); g.fillPath();
        g.lineStyle(h.w * 0.35, th.core, 0.95 * k); g.beginPath(); g.moveTo(h.x, h.y); g.lineTo(h.x2, h.y2); g.strokePath();
      }
    } else if (h.kind === 'mark') {
      rgMark(g, h, p, t);
    }
  }
  // 몬스터에 붙은 바닥 표시: 전기장·폭발 반경·돌진선·전기줄·치유 광선
  for (const f of b.fighters) {
    if (!f.monster || f.dead) continue;
    const ai = f.ai || {};
    if (f.mtype === 'spark' && ai.field !== 'off') {
      const R = f.monster.fieldR;
      if (ai.field === 'warn') {
        rgDashCircle(g, f.x, f.y, R, 0x6fe0ff, 0.35 + 0.35 * Math.abs(Math.sin(t * 14)), 2, 16, t * 2);
      } else {
        g.fillStyle(0x6fe0ff, 0.14 + 0.06 * Math.sin(t * 20)); g.fillCircle(f.x, f.y, R);
        g.lineStyle(3.5, 0xaef3ff, 0.9); g.strokeCircle(f.x, f.y, R);
        g.lineStyle(2, 0xfff78a, 0.9);
        for (let i = 0; i < 6; i++) {
          const a = t * 3 + i * TAU / 6;
          g.beginPath(); g.moveTo(f.x + Math.cos(a) * f.radius, f.y + Math.sin(a) * f.radius);
          g.lineTo(f.x + Math.cos(a + 0.25) * R * 0.55, f.y + Math.sin(a + 0.25) * R * 0.55);
          g.lineTo(f.x + Math.cos(a - 0.1) * R * 0.95, f.y + Math.sin(a - 0.1) * R * 0.95); g.strokePath();
        }
      }
    }
    if (f.mtype === 'boom' && ai.fuse > 0) {
      const k = 1 - ai.fuse / (ai.fuseMax || 2);
      g.fillStyle(0xff5a3c, 0.08 + 0.18 * k); g.fillCircle(f.x, f.y, f.monster.blastR * (0.4 + 0.6 * k));
      rgDashCircle(g, f.x, f.y, f.monster.blastR, 0xff5a3c, 0.5 + 0.4 * k, 2.4, 16, t);
    }
    if ((f.mtype === 'horn' && ai.state === 'aim') || (f.mtype === 'former' && ai.state === 'aim')) {
      const a = f.mtype === 'horn' ? ai.aimAng : ai.face;
      const locked = f.mtype === 'horn' ? ai.t <= f.monster.lockAt : ai.t <= 0.3;
      const hit = b.arena.castRay(f.x, f.y, Math.cos(a), Math.sin(a), f.radius);
      const ex = hit ? hit.x : f.x + Math.cos(a) * 400, ey = hit ? hit.y : f.y + Math.sin(a) * 400;
      const w = f.radius, nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      const k = 1 - ai.t / (ai.dur || 1.1);
      g.fillStyle(0xff4f4f, (locked ? 0.26 : 0.1) + 0.1 * k);
      g.beginPath(); g.moveTo(f.x + nx, f.y + ny); g.lineTo(ex + nx, ey + ny); g.lineTo(ex - nx, ey - ny); g.lineTo(f.x - nx, f.y - ny); g.closePath(); g.fillPath();
      g.lineStyle(locked ? 3 : 2, 0xff4f4f, locked ? 0.95 : 0.5);
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(f.x + nx * s, f.y + ny * s); g.lineTo(ex + nx * s, ey + ny * s); g.strokePath(); }
      const len = Math.hypot(ex - f.x, ey - f.y), ux = Math.cos(a), uy = Math.sin(a);
      for (let d = 40 + ((t * 120) % 40); d < len; d += 40) {
        const cx = f.x + ux * d, cy = f.y + uy * d;
        g.lineStyle(2.4, 0xffd0c0, locked ? 0.9 : 0.5); g.beginPath();
        g.moveTo(cx - ux * 9 + nx * 0.55, cy - uy * 9 + ny * 0.55); g.lineTo(cx, cy); g.lineTo(cx - ux * 9 - nx * 0.55, cy - uy * 9 - ny * 0.55); g.strokePath();
      }
    }
    if (f.mtype === 'volt' && ai.lead && ai.partner && !ai.partner.dead && ai.link) {
      const m = ai.partner, link = ai.link;
      if (link.active) rgBoltLine(g, f.x, f.y, m.x, m.y, t, 1);
      else if (link.charge > 0 && !f.phased && !m.phased) {
        const k = Math.min(1, link.charge / f.monster.linkCharge);
        if (Math.sin(t * 40) > 0) rgBoltLine(g, f.x, f.y, m.x, m.y, t, 0.25 + 0.4 * k, true);
      }
    }
    if (f.mtype === 'medic' && ai.pulse > 0 && Array.isArray(ai.beams)) {
      for (const uid of ai.beams) {
        const m = b.fighters.find(x => x.uid === uid);
        if (!m || m.dead) continue;
        g.lineStyle(5, 0x7dffa8, ai.pulse * 0.8); g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(m.x, m.y); g.strokePath();
        g.lineStyle(2, 0xffffff, ai.pulse); g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(m.x, m.y); g.strokePath();
      }
    }
  }
}
function rgBoltLine(g, x1, y1, x2, y2, t, alpha, thin = false) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const n = Math.max(4, Math.round(len / 28));
  const pts = [[x1, y1]];
  for (let i = 1; i < n; i++) {
    const k = i / n, w = Math.sin(t * 37 + i * 2.3) * 9 + Math.sin(t * 23 + i) * 4;
    pts.push([x1 + (x2 - x1) * k - uy * w, y1 + (y2 - y1) * k + ux * w]);
  }
  pts.push([x2, y2]);
  const trace = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.strokePath(); };
  if (!thin) { g.lineStyle(9, 0x6fd3ff, 0.3 * alpha); trace(); g.lineStyle(5, CASUAL_INK, 0.6 * alpha); trace(); }
  g.lineStyle(thin ? 1.6 : 3.2, 0xffe36a, alpha); trace();
  if (!thin) { g.lineStyle(1.2, 0xffffff, alpha); trace(); }
}
function rgRune(g, x, y, r, color, alpha, t) {
  g.lineStyle(2, color, alpha);
  g.strokeCircle(x, y, r);
  g.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = t * 0.6 + i * TAU * 2 / 5 - Math.PI / 2;
    if (i) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.strokePath();
}
function rgCracks(g, x, y, r, color, alpha, seed) {
  g.lineStyle(2, color, alpha);
  for (let i = 0; i < 6; i++) {
    const a = seed * 0.37 + i * TAU / 6;
    g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15);
    g.lineTo(x + Math.cos(a + 0.2) * r * 0.55, y + Math.sin(a + 0.2) * r * 0.55);
    g.lineTo(x + Math.cos(a - 0.1) * r, y + Math.sin(a - 0.1) * r); g.strokePath();
  }
}
function rgMark(g, h, p, t) {
  if (h.theme === 'drill' || h.theme === 'crack') {
    // 벽에 간 금과 안쪽으로 나오는 화살표
    const nx = h.nx || 0, ny = h.ny || -1;
    const pulse = 0.5 + 0.5 * Math.abs(Math.sin(t * 12));
    g.fillStyle(h.theme === 'drill' ? 0xff5a4f : 0xd79a4a, 0.2 + 0.25 * p); g.fillCircle(h.x, h.y, h.r * (0.6 + 0.4 * p));
    rgCracks(g, h.x - nx * 6, h.y - ny * 6, h.r * (0.6 + 0.6 * p), 0x3b2b20, 0.7, h.uid);
    const ax = h.x + nx * h.r * 1.1, ay = h.y + ny * h.r * 1.1;
    const L = 14 + p * 16;
    g.lineStyle(4, CASUAL_INK, 0.9); g.beginPath(); g.moveTo(h.x + nx * 6, h.y + ny * 6); g.lineTo(ax + nx * L, ay + ny * L); g.strokePath();
    g.lineStyle(2.4, 0xffd0c0, 0.6 + 0.4 * pulse); g.beginPath(); g.moveTo(h.x + nx * 6, h.y + ny * 6); g.lineTo(ax + nx * L, ay + ny * L); g.strokePath();
    const tx = ax + nx * (L + 8), ty = ay + ny * (L + 8);
    g.fillStyle(0xff5a4f, 0.9); g.fillTriangle(tx, ty, tx - nx * 10 - ny * 7, ty - ny * 10 + nx * 7, tx - nx * 10 + ny * 7, ty - ny * 10 - nx * 7);
    return;
  }
  if (h.theme === 'sector') {
    rgSectorWarn(g, h.x, h.y, h.r, h.ang, h.arc, p);
    return;
  }
  if (h.theme === 'aim') {
    const dx = h.x2 - h.x, dy = h.y2 - h.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const nx = -uy * h.w / 2, ny = ux * h.w / 2;
    g.fillStyle(0x8f74ff, 0.12 + 0.18 * p);
    g.beginPath(); g.moveTo(h.x + nx, h.y + ny); g.lineTo(h.x2 + nx, h.y2 + ny); g.lineTo(h.x2 - nx, h.y2 - ny); g.lineTo(h.x - nx, h.y - ny); g.closePath(); g.fillPath();
    for (let d = 20; d < len; d += 36) {
      const cx = h.x + ux * d, cy = h.y + uy * d;
      g.lineStyle(2.2, 0xd8ccff, 0.7); g.beginPath(); g.moveTo(cx - ux * 8 + nx * 0.6, cy - uy * 8 + ny * 0.6); g.lineTo(cx, cy); g.lineTo(cx - ux * 8 - nx * 0.6, cy - uy * 8 - ny * 0.6); g.strokePath();
    }
    return;
  }
  if (h.theme === 'blink') {
    for (let i = 0; i < 4; i++) {
      const a = t * 4 + i * TAU / 4;
      comicStar(g, h.x + Math.cos(a) * h.r * (1 - p * 0.4), h.y + Math.sin(a) * h.r * (1 - p * 0.4), 5, '#e2d8ff', 0.9, 4, a);
    }
    rgDashCircle(g, h.x, h.y, h.r, 0xb89bff, 0.4 + 0.5 * p, 2.2, 12, -t * 2);
  }
}

/* ═══════════ 투사체 (render.js의 drawProjectiles가 회전한 좌표계로 넘긴다) ═══════════ */
function drawRogueProjectileG(g, p, t) {
  if (p.kind === 'slime') {
    g.fillStyle(0x9be05a, 0.35); g.fillEllipse(-p.r * 1.4, 0, p.r * 2.4, p.r * 1.2);
    g.fillStyle(0xb4e35a, 1); g.fillEllipse(0, 0, p.r * 2.3, p.r * 1.8);
    g.lineStyle(1.8, CASUAL_INK, 1); g.strokeEllipse(0, 0, p.r * 2.3, p.r * 1.8);
    g.fillStyle(0xf2ffd8, 0.9); g.fillCircle(p.r * 0.3, -p.r * 0.3, p.r * 0.3);
    return true;
  }
  if (p.kind === 'mbolt') {
    g.fillStyle(0x8f74ff, 0.3); g.fillEllipse(-p.r * 1.6, 0, p.r * 3.2, p.r * 1.4);
    g.fillStyle(0xb89bff, 1); g.fillCircle(0, 0, p.r);
    g.lineStyle(1.6, CASUAL_INK, 1); g.strokeCircle(0, 0, p.r);
    g.fillStyle(0xffffff, 0.95); g.fillCircle(-p.r * 0.2, -p.r * 0.25, p.r * 0.4);
    comicStar(g, 0, 0, p.r * 1.3, '#f0e8ff', 0.35, 4, t * 6);
    return true;
  }
  return false;
}

/* ═══════════ 위 층: 체력바 · 카운트다운 · 순서 번호 · 영웅 상태 ═══════════ */
function drawMonsterUIG(g, f, b, sc) {
  if (f.dead || f.phased || f.boss) return;
  const R = f.radius;
  const ratio = Math.max(0, Math.min(1, f.hp / f.maxHp));
  if (ratio < 0.999 || f.ai.state === 'daze') {
    const w = Math.max(24, R * 1.7), x = f.x - w / 2, y = f.y - R - (f.mtype === 'mage' ? 22 : f.mtype === 'volt' ? 14 : 10);
    g.fillStyle(CASUAL_INK, 1); g.fillRoundedRect(x - 1.5, y - 1.5, w + 3, 5.5, 2.2);
    g.fillStyle(0xff7a5a, 1); g.fillRect(x, y, w * ratio, 2.5);
    g.fillStyle(0xffffff, 0.4); g.fillRect(x, y, w * ratio, 0.9);
  }
  if (f.mtype === 'boom' && f.ai.fuse > 0) {
    sc.useText(f.x, f.y - R - 22, String(Math.max(1, Math.ceil(f.ai.fuse))), {
      fontFamily: 'Jua, sans-serif', fontSize: '20px', color: '#fff1d6', stroke: '#c24e2b', strokeThickness: 4.5,
    });
  }
}
function drawRogueOverlay(g, b, sc) {
  const t = rgNow();
  for (const h of b.rogueHazards || []) {
    if (h.order && !h.fired) {
      sc.useText(h.x, h.y, String(h.order), {
        fontFamily: 'Jua, sans-serif', fontSize: '22px', color: '#f0e8ff', stroke: '#43309c', strokeThickness: 4.5,
      }).setAlpha(0.55 + 0.45 * Math.min(1, h.t / h.warn));
    }
    if (h.kind === 'mark' && h.theme === 'drill' && !h.fired) {
      sc.useText(h.x + (h.nx || 0) * 30, h.y + (h.ny || 0) * 30 - 18, '!', {
        fontFamily: 'Jua, sans-serif', fontSize: '24px', color: '#ffd24d', stroke: '#243747', strokeThickness: 5,
      }).setAlpha(0.5 + 0.5 * Math.abs(Math.sin(t * 10)));
    }
  }
  // 영웅이 점액에 젖었거나 벽꽝으로 기절했다
  for (const f of b.fighters) {
    if (f.monster) continue;
    for (const body of [f].concat(f.splitBalls || [])) {
      if (body.dead || body.mainDead) continue;
      const r = body.radius || 22;
      if (body.timers && body.timers.slime > 0) {
        const a = Math.min(1, body.timers.slime);
        g.fillStyle(0x9be05a, 0.55 * a);
        g.fillEllipse(body.x, body.y - r * 0.55, r * 1.5, r * 0.6);
        for (let i = 0; i < 3; i++) {
          const k = (t * 1.3 + i / 3) % 1;
          g.fillCircle(body.x + (i - 1) * r * 0.45, body.y - r * 0.3 + k * r * 1.1, 2.6 * (1 - k * 0.5));
        }
      }
      if (body.timers && body.timers.stun > 0) rgDizzy(g, body.x, body.y - r - 8, r, t);
    }
  }
}

/* ═══════════ DOM 초상화 (선택 카드·웨이브 미리보기) ═══════════ */
function paintMonsterPortrait(target, type) {
  if (!target || !ROGUE_MONSTERS[type] || typeof graphicsForCanvas !== 'function') return;
  const paint = () => {
    if (!target.isConnected) return;
    const c = target.getContext('2d');
    const dpr = getRenderPixelRatio();
    const w = target.clientWidth || 64, h = target.clientHeight || 64;
    target.width = Math.round(w * dpr); target.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const def = ROGUE_MONSTERS[type];
    const boss = !!def.boss;
    const size = boss ? 2.1 : type === 'giant' ? 2.3 : 2.9;
    const scale = Math.min(w, h) / (def.r * size * (type === 'mage' ? 1.25 : 1) * 2);
    const f = {
      mtype: type, monster: def, uid: 7, x: 0, y: 0, vx: 1, vy: 0.001, radius: def.r, r: def.r, hp: 1, maxHp: 1,
      weaponAngle: boss ? -2.4 : 0.45, flash: 0, timers: { stun: 0, freeze: 0 }, dead: false,
      ai: { state: 'idle', t: 0, face: 0.45, born: 0, field: 'off', dup: 99, phase: 1, aimAng: 0.4, link: null, fuse: 0 },
    };
    c.save();
    c.translate(w / 2, h / 2 + (type === 'mage' ? def.r * scale * 0.3 : 0) + (type === 'medic' || type === 'current' ? def.r * scale * 0.15 : 0));
    c.scale(scale, scale);
    if (type === 'club' || type === 'giant' || type === 'hammer') c.translate(-def.r * 0.35, 0);
    drawMonsterG(graphicsForCanvas(c), f, null);
    c.restore();
  };
  paint();
  requestAnimationFrame(paint);
}

Object.assign(window, { drawMonsterG, drawRogueGround, drawRogueProjectileG, drawMonsterUIG, drawRogueOverlay, paintMonsterPortrait });
