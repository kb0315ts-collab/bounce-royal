'use strict';
/* ============================================================
 * 바운스 로얄 — 솔로 로그라이크 데이터
 *
 * 20웨이브 수제 구성 · 고블린볼 5종 · 기믹 몬스터 8종 · 보스 2종 · 라이벌 · 보상.
 * 규칙은 js/rogue-sim.js, 그림은 js/rogue-render.js, 화면 흐름은 js/rogue.js가 맡는다.
 * 이 파일은 숫자와 구성만 담는다. 밸런스를 만질 때 여기만 고치면 된다.
 * ============================================================ */

const ROGUE_WAVE_COUNT = 20;
/* 로그라이크는 4인 난투와 같은 크기의 경기장(DIAMOND_L)을 쓰되, 공과 몬스터를 조금 줄여
 * 넉넉하게 움직일 자리를 만든다. 보스는 위압감이 있어야 해서 줄이지 않는다. */
const ROGUE_BODY_SCALE = 0.85;
const ROGUE_ARENA_L = 405;        // 몬스터·보스 웨이브는 혼자여도 4인 난투 크기를 쓴다
const ROGUE_DUEL_L = 320;         // 라이벌전은 아레나 1대1과 같은 크기

/* 아레나에만 있는 규칙이 있어야 발동하는 증강. 로그라이크에서는 선택지에서 뺀다.
 * 기획서의 11종이다. 몰락한 강자는 아레나에서도 이미 삭제돼 목록에만 남는다.
 * 장기전 체질은 지금 아레나에서 '전투 30초' 조건으로 바뀌었지만 기획대로 우선 뺐다. */
const ROGUE_EXCLUDED_AUGMENTS = Object.freeze([
  'marathoner',                                   // 장기전 체질 — 연장전 전제
  'winMomentum', 'bloodRush',                     // PvP 승리·연승 누적
  'vengeance', 'learnLoss',                       // 패배할 때마다 — 로그라이크의 패배는 런 종료
  'fallenPower', 'brink',                         // 코인을 잃을 때 · 코인 1개일 때
  'trollCondition', 'devilDeal', 'gamble',        // 코인 계약
  'lastStand',                                    // 최후의 3초 — 1대1 승패 판정 전제
]);

/* 몬스터전에서만 쓰는 무기별 피해 배율. 방패·쇠사슬·지뢰·화염은 PvP의 1대1 수단(벽 몰기·위치 교환·
 * 길목 막기)으로 균형이 잡혀 있어서, 곧장 달려드는 몬스터 무리 상대로는 초당 피해가 절반쯤이었다
 * (실측: 검 5.5 · 단검 4.1 · 활 3.7 · 권총 4.2 · 지팡이 4.3 / 방패 2.2 · 쇠사슬 1.8 · 지뢰 2.0 · 화염 3.5).
 * 라이벌전은 PvP 그대로이고 아레나 수치도 건드리지 않는다. */
const ROGUE_MONSTER_WEAPON_DMG = Object.freeze({ shield: 2.0, chain: 1.9, mine: 1.35, flame: 1.4 });

/* ---------------- 몬스터 ----------------
 * 모든 수치는 1배(웨이브 배율 적용 전)다. 속도는 전투원과 같은 단위(px/s, GAME_SPEED 곱하기 전),
 * turn은 초당 조향 한도(rad). 공은 전부 공이다 — 이 게임의 모든 것은 튕기는 공이다.
 * palette: body 몸 · dark 그늘 · accent 무기·장식 */
const ROGUE_MONSTERS = Object.freeze({
  /* ── 고블린볼: 전투의 몸통 ── */
  club: Object.freeze({
    name: '몽둥이 고블린볼', short: '몽둥이', family: 'goblin', color: '#8fcf5a',
    palette: { body: '#8fcf5a', dark: '#5f9a3a', accent: '#b98552' },
    hp: 34, r: 17, speed: 132, turn: 2.6, mass: 1,
    // 무기는 아레나의 검·단검처럼 몸에 달린 채 돈다: reach 길이 · tip 굵기 · rot 초당 회전(rad, GAME_SPEED가 곱해진다)
    reach: 26, tip: 9, rot: 3.2, dmg: 10,
    desc: '몽둥이를 돌리며 달려든다. 예고가 없으니 닿지 않게 돌아 나가야 한다.',
  }),
  slime: Object.freeze({
    name: '점액 고블린볼', short: '점액', family: 'goblin', color: '#b6cf4c',
    palette: { body: '#b3cc58', dark: '#7c9434', accent: '#9be05a' },
    hp: 28, r: 16, speed: 92, turn: 2.0, mass: 1,
    keep: 230, windup: 0.45, cd: 2.8, shotSpd: 230, shotR: 9, shotLife: 1.25, dmg: 4,
    slowT: 2.2, slowMove: 0.62, slowSteer: 0.5, puddleR: 34, puddleT: 4.5,
    desc: '거리를 두고 점액을 뱉는다. 맞거나 점액 웅덩이를 밟으면 굼떠진다.',
  }),
  giant: Object.freeze({
    name: '거인 고블린볼', short: '거인', family: 'goblin', color: '#6fae52',
    palette: { body: '#6fae52', dark: '#467a33', accent: '#8a6547' },
    hp: 100, r: 28, speed: 78, turn: 1.5, mass: 3,
    reach: 46, tip: 15, rot: 1.4, dmg: 15, knock: 130, knockCd: 0.9, whoosh: true,
    desc: '크고 느리지만 큰 몽둥이가 묵직하게 돈다. 맞으면 뒤로 밀려난다.',
  }),
  hammer: Object.freeze({
    name: '해머 정예 고블린볼', short: '해머', family: 'goblin', color: '#7fbf6a',
    palette: { body: '#7fbf6a', dark: '#4e8a44', accent: '#9aa7b8' },
    hp: 70, r: 21, speed: 112, turn: 1.9, mass: 1.6,
    reach: 52, tip: 15, rot: 1.9, dmg: 13, knock: 230, knockCd: 1.6, slamDmg: 8, slamStun: 0.9, whoosh: true,
    desc: '해머를 돌린다. 맞으면 크게 날아가고, 날아가다 벽에 박히면 추가 피해와 기절.',
  }),
  mage: Object.freeze({
    name: '마법사 고블린볼', short: '마법사', family: 'goblin', color: '#9fd88a',
    palette: { body: '#9fd88a', dark: '#6aa25a', accent: '#8d6ae0' },
    hp: 30, r: 16, speed: 86, turn: 2.0, mass: 1,
    keep: 270, castT: 0.5, cd: 4.4, marks: 1, warn: 1.3, blastR: 50, dmg: 9,
    desc: '바닥에 위험지역을 표시한 뒤 화염을 떨어뜨린다. 표시를 보고 궤도를 바꿔라.',
  }),

  /* ── 기믹 몬스터: 한 마리에 한 가지 강한 특징 ── */
  volt: Object.freeze({
    name: '볼트윈', short: '볼트윈', family: 'gimmick', color: '#ffd84d', pair: true,
    palette: { body: '#ffd84d', dark: '#c79a1d', accent: '#6fd3ff' },
    hp: 32, r: 15, speed: 92, turn: 2.2, mass: 1,
    linkMax: 340, linkCharge: 0.8, lineW: 7, dmg: 6, lock: 0.7, spread: 140, spin: 0.55,
    desc: '두 마리가 한 세트. 둘 사이의 전기줄에 닿으면 감전된다.',
  }),
  suction: Object.freeze({
    name: '흡착볼', short: '흡착볼', family: 'gimmick', color: '#c98be8',
    palette: { body: '#c98be8', dark: '#8f5bb0', accent: '#ff9fc6' },
    hp: 22, r: 13, speed: 150, turn: 3.2, mass: 0.7,
    slowEach: 0.84, aspdEach: 0.88, drain: 1, drainT: 1.25, impact: 0.7, squish: 12, reattach: 2.5,
    desc: '달라붙어 움직임과 공격을 늦춘다. 벽에 정면으로 세게 부딪혀야 떨어진다.',
  }),
  boom: Object.freeze({
    name: '붐볼', short: '붐볼', family: 'gimmick', color: '#ff7a45',
    palette: { body: '#ff7a45', dark: '#c24e2b', accent: '#ffd24d' },
    hp: 24, r: 15, speed: 128, turn: 2.4, mass: 1,
    trigger: 95, fuse: 2.0, chaseMul: 0.72, blastR: 82, dmgHero: 14, dmgMonster: 20,
    desc: '다가와 카운트다운 후 폭발한다. 폭발은 다른 몬스터에게도 들어간다 — 무리 쪽으로 유도하라.',
  }),
  drill: Object.freeze({
    name: '드릴볼', short: '드릴볼', family: 'gimmick', color: '#8aa7c4',
    palette: { body: '#8aa7c4', dark: '#5a7896', accent: '#f0c05a' },
    hp: 40, r: 17, speed: 122, turn: 2.2, mass: 1.2,
    surface: [2.6, 3.6], tunnelSpd: 290, warn: 0.9, burst: 330, burstT: 0.75, dmg: 10, contactDmg: 6,
    desc: '벽 속으로 파고들어 다른 벽에서 튀어나온다. 튀어나올 자리에 미리 금이 간다.',
  }),
  gel: Object.freeze({
    name: '멀티젤', short: '멀티젤', family: 'gimmick', color: '#5fd6c8',
    palette: { body: '#5fd6c8', dark: '#2f9f93', accent: '#e7fffb' },
    hp: 26, r: 16, speed: 62, turn: 1.3, mass: 0.9,
    dupT: 6.0, dupWarn: 1.2, cap: 10, contactDmg: 3, lock: 0.8,
    desc: '빨리 쓰러뜨리지 않으면 자신을 복제한다. 1 → 2 → 4 → 8.',
  }),
  horn: Object.freeze({
    name: '러시혼', short: '러시혼', family: 'gimmick', color: '#c9844f',
    palette: { body: '#c9844f', dark: '#8c5530', accent: '#fff3d6' },
    hp: 55, r: 20, speed: 78, turn: 1.9, mass: 2.2,
    roam: [1.2, 2.4], aim: 1.1, lockAt: 0.3, charge: 470, dmg: 13, knock: 420, slamDmg: 8, slamStun: 0.9,
    daze: 1.8, dazeTaken: 1.5,
    desc: '나를 겨눠 예고한 뒤 직선으로 돌진한다. 피하면 벽에 박혀 잠시 빈틈이 생긴다.',
  }),
  spark: Object.freeze({
    name: '스파크젤', short: '스파크젤', family: 'gimmick', color: '#6fe0ff',
    palette: { body: '#6fe0ff', dark: '#3a9fc4', accent: '#fff78a' },
    hp: 45, r: 18, speed: 50, turn: 0.9, mass: 1,
    off: 2.6, warn: 0.9, on: 2.2, fieldR: 78, dmg: 4, tick: 0.45,
    desc: '주기적으로 몸 주변에 전기 영역이 켜진다. 꺼진 틈에 다가가라.',
  }),
  medic: Object.freeze({
    name: '메딕볼', short: '메딕볼', family: 'gimmick', color: '#f4f1ea',
    palette: { body: '#f4f1ea', dark: '#c9c1b2', accent: '#ff6b6b' },
    hp: 36, r: 16, speed: 88, turn: 2.2, mass: 1,
    healT: 3.6, healR: 170, healPct: 0.10, healMin: 5, healMax: 16, keep: 190,
    desc: '주변 몬스터의 체력을 회복시킨다. 가장 먼저 처리할 대상.',
  }),

  /* ── 보스 ── */
  former: Object.freeze({
    name: '늙은 전 챔피언', short: '전 챔피언', family: 'boss', color: '#c9a36b', boss: true,
    palette: { body: '#c9a36b', dark: '#8d6d45', accent: '#8e8a86' },
    hp: 480, r: 40, speed: 58, turn: 1.2, mass: 8,
    // 해머: 몸 중심에서 머리까지의 거리와 머리 반지름
    hammerReach: 66, hammerHeadR: 22,
    slam: { warn: 1.3, dist: 64, r: 110, dmg: 14, knock: 440 },
    sweep: { aim: 0.9, speed: 330, dur: 0.9, warn: 0.5, r: 125, arc: 2.1, dmg: 12, knock: 470 },
    wall: { warn: 0.85, ringR: 290, ringT: 0.95, width: 26, dmg: 10 },
    leap: { crouch: 0.4, air: 1.5, r: 118, dmg: 16, knock: 520 },
    spin: { warm: 0.85, dur: 3.2, rate: 7, speed: 130, dmg: 7, knock: 380, lock: 0.45 },
    wallShock: { ringR: 170, ringT: 0.6, width: 22, dmg: 6, cd: 0.9 },
    slamDmg: 8, slamStun: 0.9,
    desc: '거대한 해머를 든 노장. 느리지만 해머 한 방으로 경기장을 크게 장악한다.',
  }),
  current: Object.freeze({
    name: '아레나 챔피언', short: '현 챔피언', family: 'boss', color: '#7c5cff', boss: true,
    palette: { body: '#6f56e8', dark: '#43309c', accent: '#ffd76a' },
    hp: 560, r: 30, speed: 170, turn: 3.0, mass: 4,
    bolt: { cd: 2.1, n: 3, spread: 0.26, spd: 270, dmg: 4, r: 7 },
    blink: { warn: 0.55, runeR: 72, runeWarn: 0.9, dmg: 12 },
    trail: { speed: 440, gap: 40, r: 40, delay: 1.0, dmg: 9 },
    circles: { n: 6, r: 58, warn: 1.1, step: 0.3, dmg: 10 },
    beams: { n: 3, warn: 1.25, active: 0.35, width: 38, dmg: 12 },
    nova: { charge: 1.5, n: 11, r: 46, warn: [1.2, 2.2], dmg: 12 },
    desc: '현역 최강자. 빠르게 움직이며 경기장 곳곳에 마법 패턴을 만든다.',
  }),
});

/* ---------------- 20웨이브 ----------------
 * kind: rival 라이벌 · normal 일반 몬스터전 · choice 선택형 · boss 보스
 * spawns: [종류, 마리 수]. volt는 한 마리 = 한 쌍이다.
 * hp·dmg: 그 웨이브 몬스터의 체력·피해 배율. 숫자만 올리지 않고 조합으로 어려워지게 짰다 —
 * 배율은 플레이어의 빌드가 크는 만큼만 따라간다. */
const ROGUE_WAVES = Object.freeze([
  { n: 1, kind: 'rival', meet: 1, title: '라이벌 용사 1차전' },
  { n: 2, kind: 'normal', title: '고블린 무리', spawns: [['club', 3]], hp: 1.0, dmg: 1.0 },
  { n: 3, kind: 'choice', slot: 1, title: '선택형 스테이지 ①', hp: 1.0, dmg: 1.0, options: {
    weak:   { title: '몽둥이 둘', spawns: [['club', 2]] },
    normal: { title: '점액 지원', spawns: [['club', 2], ['slime', 1]] },
    strong: { title: '고블린 부대', spawns: [['club', 3], ['slime', 2]] },
  } },
  { n: 4, kind: 'normal', title: '점액 사격조', spawns: [['club', 2], ['slime', 2]], hp: 1.05, dmg: 1.05 },
  { n: 5, kind: 'normal', title: '거인의 행차', spawns: [['giant', 1], ['club', 1], ['mage', 1]], hp: 1.1, dmg: 1.08 },
  { n: 6, kind: 'choice', slot: 2, title: '선택형 스테이지 ②', hp: 1.15, dmg: 1.1, options: {
    weak:   { title: '점액 소대', spawns: [['slime', 2], ['club', 1]] },
    normal: { title: '해머 정예', spawns: [['hammer', 1], ['club', 2]] },
    strong: { title: '고블린 정예군', spawns: [['giant', 1], ['mage', 1], ['hammer', 1], ['club', 1]] },
  } },
  { n: 7, kind: 'rival', meet: 2, title: '라이벌 용사 2차전' },
  { n: 8, kind: 'normal', title: '붐볼 소동', spawns: [['boom', 2], ['club', 2], ['slime', 2]], hp: 1.25, dmg: 1.15 },
  { n: 9, kind: 'choice', slot: 3, title: '선택형 스테이지 ③', hp: 1.3, dmg: 1.18, options: {
    weak:   { title: '흡착볼 습격', spawns: [['suction', 2], ['club', 1]] },
    normal: { title: '돌진하는 뿔', spawns: [['horn', 1], ['slime', 2]] },
    strong: { title: '번식과 폭발', spawns: [['gel', 1], ['boom', 2], ['club', 2], ['slime', 2]] },
  } },
  { n: 10, kind: 'boss', boss: 'former', title: '중간보스 — 늙은 전 챔피언' },
  { n: 11, kind: 'normal', title: '들이받기와 흡착', spawns: [['horn', 1], ['suction', 2], ['slime', 1]], hp: 1.45, dmg: 1.25 },
  { n: 12, kind: 'choice', slot: 4, title: '선택형 스테이지 ④', hp: 1.5, dmg: 1.28, options: {
    weak:   { title: '느린 젤리', spawns: [['gel', 1], ['club', 2]] },
    normal: { title: '전기 장벽', spawns: [['volt', 1], ['slime', 2]] },
    strong: { title: '치유사의 방진', spawns: [['medic', 1], ['giant', 1], ['club', 1], ['mage', 1]] },
  } },
  { n: 13, kind: 'rival', meet: 3, title: '라이벌 용사 3차전' },
  { n: 14, kind: 'normal', title: '땅속의 습격', spawns: [['drill', 1], ['gel', 1], ['mage', 1], ['club', 1]], hp: 1.65, dmg: 1.35 },
  { n: 15, kind: 'choice', slot: 5, title: '선택형 스테이지 ⑤', hp: 1.75, dmg: 1.38, options: {
    weak:   { title: '전기 해파리', spawns: [['spark', 1], ['club', 2]] },
    normal: { title: '회복하는 전열', spawns: [['medic', 1], ['hammer', 1], ['club', 1], ['slime', 1]] },
    strong: { title: '감전과 돌진', spawns: [['volt', 1], ['horn', 1], ['slime', 1], ['hammer', 1], ['club', 1]] },
  } },
  { n: 16, kind: 'normal', late: true, title: '후반 몬스터전 — 전기 장벽', spawns: [['volt', 1], ['horn', 1], ['slime', 1], ['club', 2]], hp: 1.85, dmg: 1.42 },
  { n: 17, kind: 'normal', late: true, hard: true, title: '후반 고난도 — 치유사의 요새', spawns: [['medic', 1], ['giant', 2], ['mage', 1], ['spark', 1], ['boom', 2]], hp: 1.95, dmg: 1.46 },
  { n: 18, kind: 'choice', slot: 6, title: '선택형 스테이지 ⑥', hp: 2.05, dmg: 1.5, options: {
    weak:   { title: '젤리와 폭탄', spawns: [['gel', 1], ['boom', 2], ['club', 1]] },
    normal: { title: '마법 포대', spawns: [['medic', 1], ['spark', 1], ['giant', 1], ['mage', 1]] },
    strong: { title: '기믹 총출동', spawns: [['volt', 1], ['drill', 1], ['horn', 1], ['medic', 1], ['hammer', 1], ['suction', 2]] },
  } },
  { n: 19, kind: 'rival', meet: 4, title: '라이벌 용사 최종전' },
  { n: 20, kind: 'boss', boss: 'current', title: '최종보스 — 아레나 챔피언' },
]);

/* ---------------- 선택형 스테이지 보상 ---------------- */
const ROGUE_CHOICE_TIERS = Object.freeze({
  weak:   Object.freeze({ label: '약한 적', risk: '안전', reward: '공격력·공격속도·이동속도 +10% 중 하나', rewardKind: 'stat', picks: 0 }),
  normal: Object.freeze({ label: '보통 적', risk: '표준', reward: '증강 선택 1회', rewardKind: 'augment', picks: 1 }),
  strong: Object.freeze({ label: '강한 적', risk: '위험', reward: '증강 선택 2회', rewardKind: 'augment', picks: 2 }),
});
const ROGUE_CHOICE_ORDER = Object.freeze(['weak', 'normal', 'strong']);

/* 약한 적 보상 — 기본 스탯 +10%. 증강이 아니라 런 동안 곱해지는 배율이다. */
const ROGUE_STAT_REWARDS = Object.freeze([
  Object.freeze({ id: 'atk', key: 'bonusAtk', name: '공격력 +10%', desc: '무기 공격의 위력이 10% 오른다. 여러 번 받으면 곱해진다.' }),
  Object.freeze({ id: 'aspd', key: 'bonusAspd', name: '공격속도 +10%', desc: '휘두르기·발사·연료 회복이 10% 빨라진다.' }),
  Object.freeze({ id: 'move', key: 'bonusMove', name: '이동속도 +10%', desc: '공이 10% 빨리 달린다. 조향도 같은 비율로 따라온다.' }),
]);

/* ---------------- 라이벌 ----------------
 * 한 런의 첫 라이벌전에서 캐릭터·무기가 정해지고 런이 끝날 때까지 바뀌지 않는다.
 * 만남마다 증강이 늘어난다 — 숫자를 올리는 게 아니라 실제로 빌드가 완성되어 간다. */
const ROGUE_RIVAL_NAMES = Object.freeze(['카이', '루나', '제트', '미르', '토르', '세라', '녹스', '비바', '레오', '하루', '피코', '모카']);
const ROGUE_RIVAL_COLOR = '#ff6b6b';
/* power: 라이벌의 체력·피해 배율. 라이벌은 늘 주인공보다 증강이 많다(1·9·16·25 대 0·4~8·9~16·14~24).
 * 1대1은 캐릭터·무기 상성이 크게 갈라서, 증강 차이를 그대로 두면 라이벌전 네 번이 런을 거의 다 끝낸다.
 * 신예였던 라이벌이 만날 때마다 완성돼 가도록 배율을 올린다. 조정은 이 숫자로 한다. */
const ROGUE_RIVAL_MEETS = Object.freeze([
  Object.freeze({ wave: 1,  augments: 1,  weaponAugments: 0, aiSkill: 0.36, power: 0.7 }),
  Object.freeze({ wave: 7,  augments: 9,  weaponAugments: 1, aiSkill: 0.56, power: 0.8 }),
  Object.freeze({ wave: 13, augments: 16, weaponAugments: 2, aiSkill: 0.74, power: 0.8 }),
  Object.freeze({ wave: 19, augments: 25, weaponAugments: 3, aiSkill: 0.9, power: 0.82 }),
]);
/* 라이벌이 자기 무기에 맞춰 빌드를 키우도록 무기마다 잘 맞는 증강을 적어 둔다.
 * 여기 있는 증강은 뽑힐 가능성이 크게 오른다. 무기 전용 증강은 따로 순서대로 받는다. */
const ROGUE_RIVAL_SYNERGY = Object.freeze({
  sword:  ['atk15', 'rot15', 'warmonger', 'rotMomentum', 'vampiric', 'lifesteal', 'hp15', 'giant', 'counter', 'mark', 'reflectCharge', 'chase'],
  dagger: ['move15', 'rot15', 'atk15', 'chase', 'vampiric', 'warmonger', 'speedPower', 'tiny', 'lifesteal', 'elastic', 'mark'],
  bow:    ['atk15', 'dmg10', 'rot15', 'missile', 'missilePlus', 'missileUp', 'shuriken', 'move15', 'mark', 'lifesteal', 'accelRot'],
  pistol: ['rot15', 'atk15', 'accelRot', 'rotMomentum', 'shuriken', 'shurikenUp', 'missile', 'dmg10', 'lifesteal', 'warmup'],
  staff:  ['atk15', 'dmg10', 'missile', 'lightning', 'chainBolt', 'hp15', 'meditate', 'reflectCharge', 'warmup', 'accelRot'],
  mine:   ['dmg10', 'atk15', 'rot15', 'shockwave', 'move15', 'elastic', 'lightning', 'chainBolt', 'flame', 'flameUp'],
  shield: ['atk15', 'hp15', 'counter', 'ironDefense', 'vampiric', 'warmonger', 'giant', 'hitCharge', 'meditate', 'lifesteal'],
  flame:  ['atk15', 'rot15', 'hp15', 'lifesteal', 'vampiric', 'move15', 'giant', 'meditate', 'warmup', 'rampage20'],
  chain:  ['atk15', 'rot15', 'move15', 'speedster', 'elastic', 'shockwave', 'vampiric', 'warmonger', 'hp15', 'mark'],
});
// 어떤 무기든 성장 증강의 뒷줄을 이어 받는다 (미사일을 가졌으면 미사일 증식을 반긴다)
const ROGUE_RIVAL_FOLLOWUPS = Object.freeze({
  missile: ['missilePlus', 'missileUp', 'autoExpert'], shuriken: ['shurikenUp', 'shurikenSpd'],
  lightning: ['chainBolt'], satellite: ['satellitePlus'], miniBall: ['twins', 'legion', 'thornLeash'],
  staticShock: ['staticUp', 'staticFast'], flame: ['flameUp', 'flameDur'],
});

/* 라이벌 무기의 성장 방향을 보여 줄 한 줄 설명 (라이벌 카드용) */
const ROGUE_WAVE_KIND_LABEL = Object.freeze({
  rival: '라이벌전', normal: '일반 몬스터전', choice: '선택형 스테이지', boss: '보스전',
});
