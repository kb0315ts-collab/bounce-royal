'use strict';
/* ============================================================
 * 로컬판 대 서버판 동등성 테스트
 *
 * 서버는 전투 상태를 스냅샷으로 줄여 보내고, 클라이언트는 그것을 다시
 * 렌더러가 읽을 수 있는 모양으로 되돌린다. 이 왕복에서 필드가 하나라도
 * 빠지면 화면에서만 조용히 사라진다 (위성 각도가 실제로 그랬다).
 * 여기서는 캐릭터·무기·증강을 전수로 태워 실제 전투를 돌리고,
 * 렌더러가 읽는 값이 로컬과 같은지 매 틱 비교한다.
 * ============================================================ */
const assert = require('node:assert/strict');
const core = require('../server/game-core.js');
const { snapshot } = require('../server/snapshot.js');
const { netBattleView } = require('../js/net.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (err) { console.error('✗ ' + name); throw err; }
}

let pid = 0;
const mkPlayer = (o) => Object.assign({
  id: ++pid, name: 'P' + pid, isAI: false, color: '#4da6ff', charId: 'cat', weaponId: 'sword',
  coins: 5, coinsLost: 0, augments: [], augmentBaselines: {}, copiedSkill: null,
  gamble: false, trollCondition: false, damageRewardMult: 1,
  wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
}, o || {});

const near = (a, b, tol) => Math.abs((a || 0) - (b || 0)) <= tol;
// 허용 오차는 스냅샷 계약에서 나온다: 좌표 소수 1자리, 각도 소수 2자리, HP 정수
const POS = 0.06, ANG = 0.006, HP = 0.51;

function diffFighter(f, v, tag) {
  const out = [];
  const D = (n, ok) => { if (!ok) out.push(tag + '.' + n); };
  D('x', near(f.x, v.x, POS));
  D('y', near(f.y, v.y, POS));
  D('radius', near(f.radius, v.radius, POS));
  D('weaponAngle', near(Math.atan2(Math.sin(f.weaponAngle - v.weaponAngle), Math.cos(f.weaponAngle - v.weaponAngle)), 0, ANG));
  D('hp', near(f.hp, v.hp, HP));
  D('maxHp', f.maxHp === v.maxHp);
  D('shield', near(f.shield, v.shield, HP));
  D('dead', !!f.dead === !!v.dead);
  D('mainDead', !!f.mainDead === !!v.mainDead);
  D('flash', near(f.flash, v.flash, POS));
  D('gunFlash', near(f.gunFlash || 0, v.gunFlash || 0, POS));
  D('charging', !!f.charging === !!v.charging);
  D('reloading', !!(f.gun && f.gun.reloadT > 0) === !!(v.gun && v.gun.reloadT > 0));
  D('aimLocked', !!f.aimLocked === !!v.aimLocked);
  D('vx', near(f.vx, v.vx, 0.011));
  D('vy', near(f.vy, v.vy, 0.011));
  for (const k of ['immune', 'untouchable', 'freeze', 'actingDead', 'stun', 'balloon', 'rampage', 'gunBarrage']) {
    D('timers.' + k, near(f.timers[k], v.timers[k], POS));
  }
  for (const k of ['giantBlade', 'dualDagger', 'dualPistol', 'bayonet']) {
    D('flags.' + k, !!f.flags[k] === !!v.flags[k]);
  }
  for (const k of ['char', 'weapon', 'common']) D('skillUses.' + k, f.skillUses[k] === v.skillUses[k]);

  D('summons.length', f.summons.length === v.summons.length);
  for (let i = 0; i < Math.min(f.summons.length, v.summons.length); i++) {
    const a = f.summons[i], c = v.summons[i];
    D('summons[' + i + ']', near(a.x, c.x, POS) && near(a.y, c.y, POS) && near(a.r, c.r, POS));
  }
  const alive = f.splitBalls.filter(s => !s.dead);
  D('splitBalls.length', alive.length === v.splitBalls.length);
  for (let i = 0; i < Math.min(alive.length, v.splitBalls.length); i++) {
    D('splitBalls[' + i + ']', near(alive[i].x, v.splitBalls[i].x, POS) && near(alive[i].y, v.splitBalls[i].y, POS));
    // 분열체는 본체와 따로 맞고 따로 번쩍인다
    D('splitBalls[' + i + '].flash', near(alive[i].flash || 0, v.splitBalls[i].flash || 0, POS));
  }
  // 위성은 ang이라는 이름으로 와야 한다. a로 오면 렌더러가 NaN 위치에 그려 사라진다.
  D('satellites.length', f.satellites.length === v.satellites.length);
  for (let i = 0; i < Math.min(f.satellites.length, v.satellites.length); i++) {
    D('satellites[' + i + '].ang', near(f.satellites[i].ang, v.satellites[i].ang, ANG));
  }
  return out;
}

function diffBattle(b, view) {
  const out = [];
  const D = (n, ok) => { if (!ok) out.push(n); };
  D('phase', b.phase === view.phase);
  D('simT', near(b.simT, view.simT, POS));
  D('shake', near(b.shake, view.shake, POS));
  D('arena.L', b.arena.L === view.arena.L);
  D('arena.pillars', b.arena.pillars.length === view.arena.pillars.length);
  D('fighters.length', b.fighters.length === view.fighters.length);
  for (let i = 0; i < Math.min(b.fighters.length, view.fighters.length); i++) {
    out.push.apply(out, diffFighter(b.fighters[i], view.fighters[i], 'f' + i));
  }

  D('projectiles.length', b.projectiles.length === view.projectiles.length);
  for (let i = 0; i < Math.min(b.projectiles.length, view.projectiles.length); i++) {
    const a = b.projectiles[i], c = view.projectiles[i];
    D('pr[' + i + '].kind', a.kind === c.kind);
    D('pr[' + i + '].pos', near(a.x, c.x, POS) && near(a.y, c.y, POS));
    D('pr[' + i + '].ang', near(a.ang, c.ang, ANG));
    D('pr[' + i + '].r', near(a.r, c.r, POS));
    D('pr[' + i + '].owner', (a.owner ? a.owner.pid : null) === (c.owner ? c.owner.pid : null));
  }
  D('mines.length', b.mines.length === view.mines.length);
  for (let i = 0; i < Math.min(b.mines.length, view.mines.length); i++) {
    const a = b.mines[i], c = view.mines[i];
    D('mn[' + i + ']', near(a.x, c.x, POS) && near(a.y, c.y, POS) && (a.arm <= 0) === (c.arm <= 0));
    D('mn[' + i + '].owner', (a.owner ? a.owner.pid : null) === (c.owner ? c.owner.pid : null));
  }
  D('flames.length', b.flames.length === view.flames.length);
  for (let i = 0; i < Math.min(b.flames.length, view.flames.length); i++) {
    const a = b.flames[i], c = view.flames[i];
    D('fm[' + i + ']', near(a.x, c.x, POS) && near(a.r, c.r, POS) && near(a.life, c.life, POS));
  }
  D('stickies.length', b.stickies.length === view.stickies.length);
  for (let i = 0; i < Math.min(b.stickies.length, view.stickies.length); i++) {
    const a = b.stickies[i], c = view.stickies[i];
    D('sk[' + i + ']', near(a.x, c.x, POS) && near(a.r, c.r, POS) && near(a.life, c.life, POS));
  }
  return out;
}

/* 같은 전투를 두 눈으로 본다: 로컬 객체 그대로 / 스냅샷을 거쳐 복원한 뷰 */
function runParity(opt) {
  const players = opt.players.map(mkPlayer);
  const b = new core.Battle(opt.arena || 'diamond', players);
  b.phase = 'fight'; b.simT = 0;
  b.fighters.forEach((f, i) => { b.setDir(f, i * 1.1 + 0.3); f.aimLocked = true; });
  const meta = players.map(p => ({
    id: p.id, name: p.name, color: p.color, charId: p.charId,
    weaponId: p.weaponId, isAI: p.isAI, coins: p.coins, eliminated: false, augments: p.augments,
  }));
  for (let i = 0; i < (opt.ticks || 60 * 12); i++) {
    if (opt.hurtAt && i === opt.hurtAt) b.fighters[0].hp = 1;
    if (opt.skills && i % 150 === 40) {
      for (const slot of opt.skills) {
        const f = b.fighters[0];
        if (!f.mainDead) { f.skillUses[slot] = 9; core.useSkill(b, f, slot); }
      }
    }
    b.update(1 / 60);
    const view = netBattleView(JSON.parse(JSON.stringify(snapshot(b))), meta, players[0].id);
    const d = diffBattle(b, view);
    assert.equal(d.length, 0, (opt.label || '') + ' t=' + i + ' 에서 어긋난 필드: ' + d.slice(0, 6).join(', '));
  }
}

test('캐릭터 6종의 스킬 연출이 스냅샷 왕복에서 보존된다', () => {
  for (const charId of Object.keys(core.CHARACTERS)) {
    runParity({
      label: '캐릭터 ' + charId,
      players: [
        { charId: charId, weaponId: 'sword' },
        { charId: 'wak', weaponId: 'bow', isAI: true, color: '#ff6b6b' },
      ],
      skills: ['char'],
      ticks: 60 * 8,
    });
  }
});

test('무기 6종과 무기 스킬이 스냅샷 왕복에서 보존된다', () => {
  for (const weaponId of Object.keys(core.WEAPONS)) {
    runParity({
      label: '무기 ' + weaponId,
      players: [
        { weaponId: weaponId },
        { charId: 'wak', weaponId: 'sword', isAI: true, color: '#ff6b6b' },
      ],
      skills: ['weapon'],
      ticks: 60 * 8,
    });
  }
});

test('증강 전체가 스냅샷 왕복에서 보존된다', () => {
  for (const aug of core.AUGMENTS) {
    runParity({
      label: '증강 ' + aug.id,
      players: [
        { weaponId: aug.weapon || 'sword', augments: [aug.id] },
        { charId: 'soft', weaponId: 'staff', isAI: true, color: '#63c26f' },
      ],
      // 본체를 일찍 죽여 분열체 상태까지 비교 범위에 넣는다
      hurtAt: aug.id === 'split' ? 120 : 0,
      skills: ['char', 'weapon', 'common'],
      ticks: 60 * 6,
    });
  }
});

test('다이아 외 경기장 4종도 그대로 전달된다', () => {
  for (const arena of ['obstacle', 'power', 'circle', 'square']) {
    runParity({
      label: '경기장 ' + arena,
      arena: arena,
      players: [
        { weaponId: 'bow', augments: ['satellite', 'miniBall', 'missile', 'flame', 'shuriken'] },
        { charId: 'bomb', weaponId: 'mine', isAI: true, color: '#ffd24d' },
        { charId: 'balloon', weaponId: 'pistol', isAI: true, color: '#63c26f' },
        { charId: 'bball', weaponId: 'staff', isAI: true, color: '#ff6b6b' },
      ],
      skills: ['char', 'weapon', 'common'],
      ticks: 60 * 10,
    });
  }
});

console.log('\n' + passed + '개 동등성 테스트 통과');
