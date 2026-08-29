'use strict';
/* ============================================================
 * 전투 상태를 클라이언트가 그릴 수 있는 최소 형태로 직렬화한다.
 * 좌표는 소수 1자리로 줄여 대역폭을 아낀다. 이펙트·팝업처럼 화면에만
 * 쓰이는 것은 보내지 않고 클라이언트가 자체 생성한다.
 * ============================================================ */
const r1 = n => Math.round(n * 10) / 10;
const sfxCount = (f, key) => (f[key] || 0) + f.splitBalls.reduce((s, x) => s + (x[key] || 0), 0);

function fighterView(f) {
  const t = f.timers;
  return {
    u: f.uid, p: f.pid,
    x: r1(f.x), y: r1(f.y), r: r1(f.radius),
    a: Math.round(f.weaponAngle * 100) / 100,
    h: Math.round(f.hp), m: f.maxHp, s: Math.round(f.shield),
    d: f.dead ? 1 : 0, md: f.mainDead ? 1 : 0,
    fl: r1(f.flash),
    // 렌더링에 영향을 주는 상태만 추린다
    ti: { im: r1(t.immune), un: r1(t.untouchable), fz: r1(t.freeze), ad: r1(t.actingDead), st: r1(t.stun), ba: r1(t.balloon), ra: r1(t.rampage), gb: r1(t.gunBarrage) },
    // 충전 진행도. 렌더러가 시위 당겨지는 정도로 쓴다(1에서 포화).
    // 0/1만 보내면 멀티에서 활 차지가 처음부터 끝까지 최대로 당겨진 채 보인다.
    ch: f.charging ? Math.max(0.05, Math.min(1, r1(f.charging.t))) : 0,
    gf: r1(f.gunFlash || 0),
    // 무기 모양에 영향을 주는 증강만 비트로 싣는다
    fg: (f.flags.giantBlade ? 1 : 0) | (f.flags.dualDagger ? 2 : 0)
      | (f.flags.dualPistol ? 4 : 0) | (f.flags.bayonet ? 8 : 0),
    // 권총 재장전 상태(총검술 표시용)
    rl: f.gun && f.gun.reloadT > 0 ? 1 : 0,
    // 시작 조준 방향 (aim 단계 화살표)
    vx: Math.round(f.vx * 100) / 100, vy: Math.round(f.vy * 100) / 100,
    lk: f.aimLocked ? 1 : 0,
    // 스킬 잔여/최대 사용 횟수 (스킬바 표시용)
    su: [f.skillUses.char, f.skillUses.weapon, f.skillUses.common],
    sx: [1 + (f.flags.talent ? 1 : 0), 1 + (f.flags.weaponMastery ? 1 : 0), 1 + (f.flags.battery ? 1 : 0)],
    cp: f.player.copiedSkill || null,
    // 벽 튕김·스킬 효과음 횟수. 서버에는 소리가 없으므로 클라이언트가 증가분만큼 재생한다.
    // 본체가 죽으면 분열체가 몸을 대신하므로 둘을 합쳐 센다 (분열체는 0에서 시작한다).
    bc: sfxCount(f, 'bounceTotal'), sc: sfxCount(f, 'sfxSkill'),
    // 소환수·분열체도 uid를 실어야 죽어서 배열이 밀려도 엉뚱한 대상과 보간되지 않는다
    sm: f.summons.map(s => ({ u: s.uid, x: r1(s.x), y: r1(s.y), r: r1(s.r) })),
    // fl(피격 플래시)도 실어야 한다. 분열체는 본체와 따로 맞고 따로 번쩍인다.
    sp: f.splitBalls.filter(s => !s.dead).map(s => ({ u: s.uid, x: r1(s.x), y: r1(s.y), r: r1(s.r || s.radius || 12), fl: r1(s.flash || 0) })),
    sa: f.satellites.map(s => ({ a: Math.round(s.ang * 100) / 100 })),
  };
}

function snapshot(battle) {
  return {
    ph: battle.phase,
    t: r1(battle.simT),
    ot: battle.overtime ? r1(battle.otT) : null,
    sh: r1(battle.shake),
    L: battle.arena.L,
    pil: battle.arena.pillars.map(p => ({ x: p.x, y: p.y, r: p.r })),
    cube: battle.arena.cube && battle.arena.cube.active
      ? { x: battle.arena.cube.x, y: battle.arena.cube.y, s: r1(battle.arena.cube.spin) } : null,
    f: battle.fighters.map(fighterView),
    // uid를 함께 보낸다. 인덱스로 맞추면 투사체가 사라질 때 서로 다른 투사체를
    // 보간하게 되어 화살이 꺾이거나 순간이동하는 것처럼 보인다.
    pr: battle.projectiles.map(p => ({
      u: p.uid, k: p.kind, x: r1(p.x), y: r1(p.y), a: Math.round(p.ang * 100) / 100, r: r1(p.r), o: p.owner ? p.owner.pid : null,
    })),
    mn: battle.mines.map(m => ({ u: m.uid, x: r1(m.x), y: r1(m.y), r: r1(m.r || 11), a: m.arm <= 0 ? 1 : 0, o: m.owner ? m.owner.pid : null })),
    fm: battle.flames.map(f => ({ x: r1(f.x), y: r1(f.y), r: r1(f.r), l: r1(f.life) })),
    sk: battle.stickies.map(s => ({ x: r1(s.x), y: r1(s.y), r: r1(s.r), l: r1(s.life) })),
    // 타격 피드백. 클라이언트는 처음 본 uid만 자기 쪽에서 한 번 재생한다.
    px: battle.popups.map(p => ({ u: p.uid, x: r1(p.x), y: r1(p.y), s: String(p.txt), c: p.color, b: p.big ? 1 : 0 })),
    fx: battle.fx.map(e => (e.type === 'ring'
      ? { u: e.uid, k: 'r', x: r1(e.x), y: r1(e.y), a: r1(e.r0), b: r1(e.r1), c: e.color, d: e.dur, m: e.boom ? 1 : 0 }
      : { u: e.uid, k: 'b', c: e.color, d: e.dur, g: e.segs.map(s => [r1(s.x), r1(s.y)]) })),
    res: battle.result ? { w: battle.result.winner ? battle.result.winner.pid : null, why: battle.result.reason, draw: !!battle.result.draw } : null,
  };
}

module.exports = { snapshot };
