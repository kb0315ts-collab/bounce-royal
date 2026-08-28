'use strict';
/* ============================================================
 * 전투 상태를 클라이언트가 그릴 수 있는 최소 형태로 직렬화한다.
 * 좌표는 소수 1자리로 줄여 대역폭을 아낀다. 이펙트·팝업처럼 화면에만
 * 쓰이는 것은 보내지 않고 클라이언트가 자체 생성한다.
 * ============================================================ */
const r1 = n => Math.round(n * 10) / 10;

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
    ch: f.charging ? 1 : 0,
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
    sm: f.summons.map(s => ({ x: r1(s.x), y: r1(s.y), r: r1(s.r) })),
    sp: f.splitBalls.filter(s => !s.dead).map(s => ({ x: r1(s.x), y: r1(s.y), r: r1(s.r || 12) })),
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
      ? { u: e.uid, k: 'r', x: r1(e.x), y: r1(e.y), a: r1(e.r0), b: r1(e.r1), c: e.color, d: e.dur }
      : { u: e.uid, k: 'b', c: e.color, d: e.dur, g: e.segs.map(s => [r1(s.x), r1(s.y)]) })),
    res: battle.result ? { w: battle.result.winner ? battle.result.winner.pid : null, why: battle.result.reason, draw: !!battle.result.draw } : null,
  };
}

module.exports = { snapshot };
