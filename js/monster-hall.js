'use strict';
/* ============================================================
 * 바운스 로얄 — 몬스터 전시관 (monster-hall.html)
 *
 * 로그라이크에 나오는 몬스터를 한 마리씩 무대에 세우고, 실제 게임과 같은 두뇌
 * (js/rogue-sim.js의 BRAINS)와 같은 그림(js/rogue-render.js)으로 움직인다.
 * 그림을 따로 그리거나 모션을 흉내 내지 않는다 — 게임이 도는 그대로를 보여 준다.
 *
 * 무대는 진짜 웨이브 전투 하나다. 다만 전시용으로 세 가지만 바꾼다.
 *   · 연습 상대 인형은 피해를 주지 않고(perm.atk = 0), 쓰러져도 바로 일어난다.
 *   · 판정이 끝나지 않는다 (b.rogue.checkEnd를 비운다).
 *   · 붐볼처럼 스스로 사라지는 몬스터는 잠시 뒤 다시 세운다.
 * ============================================================ */
(function (root) {
  const R = root.BounceRoyalRogueSim;
  const $ = id => document.getElementById(id);
  if (!R || !$('game')) return;

  /* 전시 무대 크기. 좁을수록 크게 보이지만, 넓게 쓰는 몬스터는 자리가 있어야 제 모습이 나온다
   * (보스 패턴 · 러시혼의 돌진 거리 · 볼트윈의 전기줄 · 드릴볼의 벽 사이 이동). */
  const stageSize = type => (ROGUE_MONSTERS[type].boss ? 360 : ['horn', 'volt', 'drill'].includes(type) ? 300 : 215);
  const GROUPS = [
    { name: '고블린볼', types: ['club', 'slime', 'giant', 'hammer', 'mage'] },
    { name: '기믹 몬스터', types: ['volt', 'suction', 'boom', 'drill', 'gel', 'horn', 'spark', 'medic'] },
    { name: '보스', types: ['former', 'current'] },
  ];
  // 보스 패턴 단추 — id는 rogue-sim의 pickPattern이 쓰는 이름 그대로다
  const PATTERNS = {
    former: [['slam', '내려찍기'], ['sweep', '휩쓸기'], ['wall', '벽 충격파'], ['leap', '도약'], ['spin', '해머 회전']],
    current: [['blink', '순간이동'], ['trail', '잔상 돌진'], ['circles', '마법진'], ['beams', '광선'], ['nova', '대폭발']],
  };
  /* 무대에 같이 세우는 동료 — 이 몬스터의 특징은 혼자서는 보이지 않는다.
   * 메딕볼은 다친 동료가 있어야 회복을 하고, 붐볼은 곁에 누가 있어야 연쇄가 보인다. */
  const COMPANIONS = { medic: ['club'], boom: ['club', 'club'] };
  const MOTION = {
    club: ['몽둥이를 몸에 달고 계속 돌린다. 예고도 휘두르는 동작도 없다.', '닿으면 맞고, 무기에서 떨어졌다 다시 닿아야 또 맞는다.'],
    slime: ['거리를 두다가 잠깐 부풀린 뒤 점액을 뱉는다.', '맞으면 굼떠지고, 빗나간 점액은 바닥에 웅덩이로 남는다.'],
    giant: ['큰 몽둥이가 느리게 돈다. 닿으면 뒤로 밀려난다.', '몸집이 커서 무기가 지나는 자리가 넓다.'],
    hammer: ['해머를 돌린다. 맞으면 크게 날아간다.', '날아가다 벽에 박히면 추가 피해와 기절 — 벽꽝.'],
    mage: ['멈춰 서서 주문을 왼다.', '바닥에 자리를 표시하고, 충분히 예고한 뒤 화염이 떨어진다.'],
    volt: ['두 마리가 한 세트로 상대를 사이에 두고 자리를 잡는다.', '둘 사이에 전기줄이 이어지고, 줄에 닿으면 감전된다.'],
    suction: ['빠르게 따라와 몸에 달라붙는다.', '붙어 있는 동안 이동과 공격이 느려진다.', '벽에 정면으로 세게 부딪혀야 떨어진다.'],
    boom: ['다가와 카운트다운을 시작하고 터진다.', '폭발은 다른 몬스터에게 더 아프다 — 무리 쪽으로 끌고 가면 같이 터진다.'],
    drill: ['벽 속으로 파고들어 사라진다.', '나올 자리에 먼저 금이 가고, 그 자리에서 튀어나온다.'],
    gel: ['느리게 따라오다 몸을 늘리고 자신을 복제한다. 1 → 2 → 4 → 8.', '한 가족은 여덟 마리까지만 태어난다.'],
    horn: ['멈춰 서서 뿔로 나를 겨눈다 (예고).', '겨눈 방향으로 직선으로 돌진한다.', '피하면 벽에 박혀 잠시 비틀거린다 — 그때가 기회다.'],
    spark: ['꺼짐 → 예고 → 몸 주변에 전기 영역이 켜진다.', '영역 크기는 늘 같다. 꺼진 틈에 다가간다.'],
    medic: ['무리 뒤쪽에 서서 거리를 둔다.', '주기적으로 주변 몬스터의 체력을 회복시킨다.'],
    former: ['해머를 든 노장. 느리지만 한 방이 크다.', '모든 광역 공격은 자리를 표시하고 충분히 예고한 뒤 터진다.', '체력 절반에서 2페이즈 — 예고가 짧아지고 패턴이 이어진다.'],
    current: ['빠르게 움직이며 마법 패턴을 깐다.', '마법진은 순서대로 터지고, 광선은 가로세로로 지나간다.', '체력 절반에서 2페이즈 — 옮기자마자 다음 패턴이 이어진다.'],
  };
  const STATE_LABEL = {
    idle: '대기', walk: '접근', move: '이동', windup: '준비 동작', swing: '휘두름', cast: '주문',
    aim: '조준', charge: '돌진', crash: '벽 충돌', daze: '비틀거림', roam: '배회',
    tunnel: '벽 속 이동', warn: '출현 예고', burst: '튀어나옴', dive: '파고들기', surface: '지상',
    slam: '내려찍기 예고', sweepWarn: '휩쓸기 예고', wallUp: '벽 강타 예고', crouch: '도약 준비',
    air: '공중', spinUp: '회전 준비', spin: '회전', recover: '빈틈',
    blinkWarn: '순간이동 예고', trailAim: '돌진 조준', trail: '잔상 돌진', novaCharge: '대폭발 준비',
    on: '전기장 켜짐', off: '전기장 꺼짐', link: '전기줄', attached: '달라붙음', fuse: '카운트다운',
  };

  /* ---------------- 무대 ---------------- */
  const stage = { battle: null, type: 'club', playing: true, slow: false, hold: false, respawn: 0, gelAt: 0 };

  function makeRun() {
    const run = R.newRun({ name: '연습 인형', charId: 'cat', weaponId: 'sword', color: '#4da6ff' });
    run.wave = 2;
    return run;
  }
  function buildStage(type) {
    const run = makeRun();
    const b = R.createWaveBattle(run, { autoplay: true, heroSkill: 0.55 });
    b.fighters = b.fighters.filter(f => !f.monster);   // 웨이브 몬스터는 비우고 전시할 종류만 세운다
    const L = stageSize(type);
    b.arena.L = L;
    b.rogue.checkEnd = () => {};                        // 전시관은 끝나지 않는다
    b.phase = 'fight'; b.simT = 0; b.countT = 0;
    const dummy = b.rogueHero;
    dummy.perm.atk = 0;                                 // 인형은 때리지 않는다
    stage.dummyMove = dummy.perm.move;                  // '인형 고정'을 풀 때 되돌릴 값
    b.setPos(dummy, -0.34 * L, 0.18 * L, -0.6);
    stage.battle = b;
    stage.type = type;
    stage.respawn = 0;
    stage.gelAt = 0;
    spawnCast(b, type, L);
    return b;
  }
  function spawnCast(b, type, L) {
    stage.main = R.spawnMonster(b, type, 0.16 * L, -0.06 * L, {})[0];
    for (const [i, mate] of (COMPANIONS[type] || []).entries()) {
      R.spawnMonster(b, mate, 0.34 * L, (i ? 1 : -1) * 0.22 * L, {});
    }
  }
  function resetStage() { buildStage(stage.type); }

  // 전시용 손질: 인형은 죽지 않고, 메딕볼의 동료는 다친 채로 둔다, 사라진 몬스터는 다시 세운다
  function keepStage(b, dt) {
    const dummy = b.rogueHero;
    if (dummy) {
      dummy.hp = dummy.maxHp;
      dummy.dead = false; dummy.mainDead = false;
      dummy.perm.atk = 0;
      dummy.perm.move = stage.hold ? 0 : stage.dummyMove;
      dummy.skillUses.char = 0; dummy.skillUses.cd = 99;  // 인형은 스킬을 쓰지 않는다 (무대를 어지럽히지 않게)
    }
    const monsters = b.fighters.filter(f => f.monster && !f.dead);
    // 메딕볼이 회복할 것이 있어야 회복 모션이 보인다
    if (stage.type === 'medic') {
      for (const m of monsters) if (m.mtype !== 'medic' && m.hp > m.maxHp * 0.6) m.hp = m.maxHp * 0.45;
    }
    // 멀티젤은 여덟 마리까지 불어난다. 다 불어나면 잠시 보여 주고 다시 세운다.
    if (stage.type === 'gel' && monsters.length >= 8) {
      stage.gelAt = (stage.gelAt || 0) + dt;
      if (stage.gelAt > 3) { resetStage(); return; }
    }
    // 붐볼처럼 스스로 사라지는 몬스터는 잠시 뒤 다시 세운다 (동료가 남아 있어도)
    if (!stage.main || stage.main.dead) {
      stage.respawn += dt;
      if (stage.respawn > 1.2) resetStage();
    } else stage.respawn = 0;
  }

  /* ---------------- 그리기 루프 ---------------- */
  const FIXED = 1 / 60;
  let last = performance.now(), acc = 0;
  function loop(now) {
    const frame = Math.min(0.1, (now - last) / 1000);
    last = now;
    const b = stage.battle;
    if (b) {
      if (stage.playing) {
        acc += frame * (stage.slow ? 0.35 : 1);
        let steps = 0;
        while (acc >= FIXED && steps++ < 6) { b.update(FIXED); keepStage(b, FIXED); acc -= FIXED; }
      } else acc = 0;
      renderBattle(b);
      paintState(b);
    }
    requestAnimationFrame(loop);
  }
  /* 지금 무엇을 하고 있는지. 두뇌마다 상태를 담는 자리가 달라서(ai.state · ai.field · 남은 시간)
   * 종류별로 읽어 준다. 몸에 달린 무기를 돌리는 종류는 상태가 늘 하나다. */
  const ownsHazard = m => !!(stage.battle && stage.battle.rogueHazards.some(h => h.owner === m));
  function stateText(m) {
    if (!m) return '다시 세우는 중';
    const ai = m.ai || {}, def = m.monster;
    if (m.timers.stun > 0) return '기절';
    switch (m.mtype) {
      case 'club': case 'giant': case 'hammer': return '무기 회전';
      case 'spark': return ai.field === 'on' ? '전기장 켜짐' : ai.field === 'warn' ? '전기장 예고' : '전기장 꺼짐';
      case 'medic': return ai.pulse > 0 ? '회복' : '거리 두기';
      case 'gel': return ai.dup <= def.dupWarn ? '복제 준비' : '접근';
      case 'boom': return ai.fuse > 0 ? '카운트다운' : '접근';
      case 'volt': return ai.link && ai.link.active ? '전기줄 연결' : '자리 잡는 중';
      // 마법사는 주문을 왼 뒤 바닥 예고가 남는다. 그동안은 '대기'가 아니라 예고 중이다.
      case 'mage': return ai.state === 'cast' ? '주문' : ownsHazard(m) ? '화염 예고' : '거리 두기';
      case 'slime': return ai.state === 'windup' ? '뱉기 준비' : '거리 두기';
      case 'suction': return m.attached ? '달라붙음' : ai.reattach > 0 ? '떨어진 직후' : '따라붙는 중';
      default: break;
    }
    return STATE_LABEL[ai.state] || ai.state || '대기';
  }
  function paintState(b) {
    const m = stage.main && !stage.main.dead ? stage.main
      : b.fighters.find(f => f.monster && !f.dead && f.mtype === stage.type);
    let text = stateText(m);
    if (m && m.boss && m.ai && m.ai.phase === 2) text += ' · 2페이즈';
    $('stage-state').textContent = text;
  }

  /* ---------------- 목록 · 설명 ---------------- */
  function buildList() {
    const list = $('hall-list');
    for (const group of GROUPS) {
      const box = document.createElement('div');
      box.className = 'list-group';
      box.innerHTML = `<h2>${group.name}</h2><div class="list-grid"></div>`;
      const grid = box.querySelector('.list-grid');
      for (const type of group.types) {
        const def = ROGUE_MONSTERS[type];
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'mon-card' + (def.boss ? ' boss' : '');
        card.dataset.type = type;
        card.innerHTML = `<canvas aria-hidden="true"></canvas><span>${def.short}</span>`;
        card.onclick = () => select(type);
        grid.appendChild(card);
        paintMonsterPortrait(card.querySelector('canvas'), type);
      }
      list.appendChild(box);
    }
  }
  const NUM = n => (Math.round(n * 100) / 100).toString();
  function statRows(type) {
    const d = ROGUE_MONSTERS[type];
    const rows = [['체력', NUM(d.hp)], ['크기(반지름)', NUM(d.r)], ['이동속도', NUM(d.speed)], ['조향', NUM(d.turn) + ' rad/s'], ['무게', NUM(d.mass || 1)]];
    if (d.rot) rows.push(['무기 회전', NUM(d.rot) + ' rad/s'], ['무기 길이', NUM(d.reach)], ['닿을 때 피해', NUM(d.dmg)]);
    else if (d.dmg) rows.push(['피해', NUM(d.dmg)]);
    if (d.knock) rows.push(['밀어내기', NUM(d.knock) + ' px']);
    if (d.slamDmg) rows.push(['벽꽝 피해 · 기절', `${NUM(d.slamDmg)} · ${NUM(d.slamStun)}초`]);
    if (d.warn) rows.push(['예고 시간', NUM(d.warn) + '초']);
    if (d.cd) rows.push(['재사용 대기', NUM(d.cd) + '초']);
    if (d.fuse) rows.push(['카운트다운', NUM(d.fuse) + '초']);
    if (d.dmgHero) rows.push(['폭발 피해 (나 · 몬스터)', `${NUM(d.dmgHero)} · ${NUM(d.dmgMonster)}`]);
    if (d.dupT) rows.push(['복제 간격', NUM(d.dupT) + '초']);
    if (d.healPct) rows.push(['회복량', `최대 체력 ${Math.round(d.healPct * 100)}% · ${NUM(d.healT)}초마다`]);
    if (d.fieldR) rows.push(['전기장', `반지름 ${NUM(d.fieldR)} · ${NUM(d.on)}초 켜짐`]);
    if (d.linkMax) rows.push(['전기줄 길이', NUM(d.linkMax)]);
    if (d.charge) rows.push(['돌진 속도', NUM(d.charge)]);
    if (d.slam) rows.push(['내려찍기', `피해 ${NUM(d.slam.dmg)} · 예고 ${NUM(d.slam.warn)}초`]);
    if (d.leap) rows.push(['도약', `피해 ${NUM(d.leap.dmg)} · 체공 ${NUM(d.leap.air)}초`]);
    if (d.beams) rows.push(['광선', `피해 ${NUM(d.beams.dmg)} · 예고 ${NUM(d.beams.warn)}초`]);
    if (d.nova) rows.push(['대폭발', `${d.nova.n}발 · 피해 ${NUM(d.nova.dmg)}`]);
    return rows;
  }
  function paintInfo(type) {
    const def = ROGUE_MONSTERS[type];
    $('info-kind').textContent = def.family === 'boss' ? '보스' : def.family === 'gimmick' ? '기믹 몬스터' : '고블린볼';
    $('info-name').textContent = def.name;
    $('info-desc').textContent = def.desc;
    $('info-motion').replaceChildren(...(MOTION[type] || []).map(line => {
      const li = document.createElement('li'); li.textContent = line; return li;
    }));
    const dl = $('info-stats');
    dl.replaceChildren();
    for (const [label, value] of statRows(type)) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      dl.append(dt, dd);
    }
    paintMonsterPortrait($('info-face'), type);
  }
  function paintPatterns(type) {
    const box = $('stage-patterns'), row = $('patterns-row');
    const list = PATTERNS[type];
    box.classList.toggle('hidden', !list);
    row.replaceChildren();
    $('chk-phase2').checked = false;
    if (!list) return;
    for (const [id, label] of list) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'hall-btn small'; btn.textContent = label;
      btn.onclick = () => {
        const boss = stage.battle && stage.battle.fighters.find(f => f.boss && !f.dead);
        if (!boss) return;
        R.forcePattern(boss, id);
        // 지금 하던 동작을 끊고 곧바로 고른 패턴으로 넘어간다
        Object.assign(boss.ai, { state: boss.mtype === 'former' ? 'walk' : 'move', t: 0 });
        stage.playing = true; paintPlay();
      };
      row.appendChild(btn);
    }
  }
  function select(type) {
    document.querySelectorAll('.mon-card').forEach(c => c.classList.toggle('on', c.dataset.type === type));
    buildStage(type);
    paintInfo(type);
    paintPatterns(type);
  }

  /* ---------------- 단추 ---------------- */
  function paintPlay() { $('btn-play').textContent = stage.playing ? '일시정지' : '재생'; }
  $('btn-play').onclick = () => { stage.playing = !stage.playing; paintPlay(); };
  $('btn-reset').onclick = () => resetStage();
  $('chk-slow').onchange = e => { stage.slow = e.target.checked; };
  $('chk-hold').onchange = e => { stage.hold = e.target.checked; };
  $('chk-phase2').onchange = e => {
    const boss = stage.battle && stage.battle.fighters.find(f => f.boss && !f.dead);
    if (!boss) return;
    if (e.target.checked) boss.hp = Math.min(boss.hp, boss.maxHp * 0.5);   // 다음 판정에서 2페이즈로 넘어간다
    else { boss.hp = boss.maxHp; boss.ai.phase = 1; }
  };
  // 소리는 사용자가 켤 때 만든다 (브라우저는 첫 조작 전에는 소리를 내주지 않는다)
  $('chk-sound').onchange = e => {
    if (!e.target.checked) { if (root.SFX) root.SFX.muted = true; return; }
    if (!root.SFX) root.SFX = BounceRoyalAudio.create({ volume: 0.7 });
    root.SFX.muted = false;
    root.SFX.ensure();
  };
  document.addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); stage.playing = !stage.playing; paintPlay(); }
    if (e.key === 'r' || e.key === 'R') resetStage();
  });

  buildList();
  select('club');
  paintPlay();
  requestAnimationFrame(loop);

  /* 밖에서 무대를 들여다보거나 한 칸씩 돌려 볼 수 있게 열어 둔다 (점검용).
   * 창이 가려져 requestAnimationFrame이 멈춘 환경에서도 step으로 확인할 수 있다. */
  root.BounceRoyalMonsterHall = {
    get stage() { return stage; },
    select, reset: resetStage,
    step(seconds = 1) {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) { stage.battle.update(FIXED); keepStage(stage.battle, FIXED); }
      renderBattle(stage.battle);
      paintState(stage.battle);
      if (typeof phaserGame !== 'undefined') phaserGame.step(performance.now(), 16.7);
      return { type: stage.type, t: +stage.battle.simT.toFixed(2), state: $('stage-state').textContent };
    },
  };
})(globalThis);
