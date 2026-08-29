'use strict';
/* ============================================================
 * 바운스 로얄 — 게임 데이터 정의
 * 캐릭터 / 무기 / 맵 / 증강
 * ============================================================ */

const CHARACTERS = {
  cat:     { name:'고양이 발바닥', ico:'🐾', color:'#ff9ec4', hp:100, move:172, size:1.00,
    skillName:'되돌아가기', skillDesc:'2초 전 자신의 위치로 순간이동한다. 회피·이탈·궤도 복구용 숙련형 스킬.' },
  wak:     { name:'왁뿌볼', ico:'🔶', color:'#ffa94d', hp:100, move:166, size:1.00,
    skillName:'파괴 폭주', skillDesc:'5초간 모든 주요 스탯 대폭 상승, 이후 전투가 끝날 때까지 크게 감소하는 올인형 스킬.' },
  soft:    { name:'말랑이', ico:'🍥', color:'#f3f0e8', hp:100, move:156, size:1.05,
    skillName:'말랑 방어', skillDesc:'2초간 받는 모든 피해를 무시한다. 상대의 폭딜 타이밍을 읽어라.' },
  bomb:    { name:'폭탄', ico:'💣', color:'#5c6577', hp:100, move:160, size:0.95,
    skillName:'시한폭발', skillDesc:'사용 1초 후 자신 주변에 폭발을 일으켜 피해를 준다. 충돌 직전에 눌러라.' },
  bball:   { name:'농구공', ico:'🏀', color:'#ff8f3c', hp:100, move:165, size:1.00,
    skillName:'3바운드', skillDesc:'피격 없이 벽에 3번 튕기면 상대에게 돌진하여 26의 모든 피해량 적용 피해를 준다.' },
  balloon: { name:'풍선', ico:'🎈', color:'#ff6b81', hp:100, move:162, size:1.12,
    skillName:'팽창', skillDesc:'5초간 본체·무기·투사체 크기가 커진다. 장착 무기에 따라 완전히 다른 스킬.' },
};

const WEAPONS = {
  sword:  { name:'검', ico:'⚔️', type:'melee', dmg:20, reach:60, tip:13, rot:3.0, moveMult:0.90,
    desc:'긴 사거리와 높은 피해. 대신 공격속도·이동속도가 느리다.', stat:{atk:.85,spd:.45,rng:.7,mob:.4},
    skillName:'믹서기', skillDesc:'별도 피해 없이 1.2초 동안 두 바퀴 연속 회전한다.' },
  dagger: { name:'단검', ico:'🔪', type:'melee', dmg:18, reach:30, tip:9, rot:5.0, moveMult:1.15,
    desc:'짧고 피해는 낮지만 공격속도·이동속도가 매우 빠르다.', stat:{atk:.45,spd:.95,rng:.3,mob:.95},
    skillName:'관통 돌진', skillDesc:'1초간 정지 후 원래 진행 방향으로 돌진해 관통하며 40의 무기 피해.' },
  bow:    { name:'활', ico:'🏹', type:'ranged', dmg:10, interval:1.5, projSpeed:320, rot:2.6, moveMult:1.0,
    desc:'상대를 자동으로 겨눠 화살을 계속 발사하는 안정적인 원거리 무기.', stat:{atk:.55,spd:.65,rng:.95,mob:.7},
    skillName:'차지 샷', skillDesc:'자동 조준을 끄고 두 바퀴에 걸쳐 천천히 회전한다. 1초 후부터 다시 눌러 노린 방향으로 발사 — 적과 장애물을 관통하는 피해 30. 안 쏘면 두 바퀴째에 그대로 나간다.' },
  pistol: { name:'권총', ico:'🔫', type:'ranged', dmg:3, burst:6, shotGap:0.12, reload:3.0, projSpeed:500, rot:3.0, moveMult:1.0,
    desc:'상대를 자동으로 겨눠 6연사 후 3초 재장전. 화력과 공백이 명확하다.', stat:{atk:.6,spd:.9,rng:.85,mob:.7},
    skillName:'회전 난사', skillDesc:'1.5초간 빙글빙글 돌며 재장전 없이 사방으로 난사한다.' },
  staff:  { name:'지팡이', ico:'🪄', type:'ranged', dmg:15, interval:2.5, projSpeed:135, bounces:1, rot:2.5, moveMult:1.0,
    desc:'상대를 자동으로 겨누는 느리고 강한 마법 투사체. 벽에 한 번 반사된다.', stat:{atk:1,spd:.15,rng:.8,mob:.7},
    skillName:'마력 폭주', skillDesc:'3초간 자신이 발사한 모든 마법 투사체의 크기가 2배가 된다.' },
  mine:   { name:'지뢰', ico:'🧨', type:'mine', dmg:10, interval:3.0, maxMines:5, triggerR:28, blastR:62, moveMult:1.0, rot:1.5,
    desc:'휘두르지 않고 이동 경로에 지뢰를 설치한다. 공간 장악형.', stat:{atk:.8,spd:.3,rng:.5,mob:.75},
    skillName:'원격 폭파', skillDesc:'1초 후 설치된 모든 지뢰를 하나당 피해 18, 반경 93으로 동시 폭파한다.' },
};

const MAPS = {
  diamond:{ name:'다이아 경기장', desc:'45도로 기울인 마름모. 반사가 정확하고 궤도가 경기장 전체를 고르게 훑는다' },
  circle: { name:'원형 경기장', desc:'벽 반사 각도가 계속 달라지는 클래식 서클배틀' },
  square: { name:'정사각형 경기장', desc:'예상하기 쉬운 직선 반사' },
  obstacle:{ name:'장애물 경기장', desc:'내부 기둥들이 복잡한 반사 경로를 만든다' },
  power:  { name:'파워업 큐브 경기장', desc:'중앙 큐브에 먼저 접촉하면 일시 강화 획득' },
};

const CAT_TAGS = {
  stat:'기본 스탯', time:'시간 성장', tempo:'초/후반 조건', hpcond:'체력 조건',
  streak:'승패 성장', coin:'코인', trade:'대가',
  physics:'물리 상호작용', cc:'이동 방해', auto:'자동 공격', summon:'소환수',
  death:'사망 관련', onhit:'타격/피격', skill:'스킬 강화', link:'빌드 연결',
  weapon:'무기 전용', copy:'스킬 카피',
};

/* 증강 목록 — stackable:true 는 중복 획득 가능 */
const AUGMENTS = [
  // ---- 기본 스탯 ----
  { id:'hp15',      cat:'stat', stackable:true, name:'단단한 몸', desc:'최대 체력 +15%' },
  { id:'atk15',     cat:'stat', stackable:true, name:'무기 강화', desc:'공격력 +15%' },
  { id:'dmg10',     cat:'stat', stackable:true, name:'날카로운 감각', desc:'모든 피해량 +10%' },
  { id:'rot15',     cat:'stat', stackable:true, name:'속사', desc:'공격속도 +15%' },
  { id:'move15',    cat:'stat', stackable:true, name:'가벼운 몸', desc:'이동속도 +15%' },
  { id:'lifesteal', cat:'stat', stackable:true, name:'전투 흡수', desc:'가한 피해의 8%만큼 체력 회복' },
  { id:'giant',     cat:'stat', name:'거대화', desc:'본체 크기 +20%, 최대 체력 +50% (무기 크기 불변)' },
  { id:'tiny',      cat:'stat', name:'소형화', desc:'본체 크기 -20%. 맞기 어려워진다' },
  { id:'elastic',   cat:'stat', name:'탄성 강화', desc:'벽에 충돌한 직후 1초간 이동속도 +25%' },
  // ---- 시간 성장 ----
  { id:'warmup',    cat:'time', name:'예열', desc:'전투 중 5초마다 공격력 +4%' },
  { id:'accelRot',  cat:'time', name:'가속', desc:'전투 중 5초마다 공격속도 +10%' },
  { id:'speedster', cat:'time', name:'속도광', desc:'전투 중 5초마다 이동속도 +6%' },
  { id:'meditate',  cat:'time', name:'명상', desc:'전투 중 5초마다 체력 5% 회복' },
  { id:'marathoner',cat:'time', name:'장기전 체질', desc:'연장전 돌입 시 잃은 체력의 50% 회복' },
  { id:'rampage20', cat:'time', name:'폭주 시간', desc:'전투 20초 이후 공격력·이동속도·공격속도 +20%' },
  // ---- 초반 / 후반 조건 ----
  { id:'firstStrike', cat:'tempo', name:'선제공격', desc:'전투 시작 후 10초간 공격력 +30%' },
  { id:'rocketStart', cat:'tempo', name:'로켓 스타트', desc:'첫 벽 충돌까지 초고속 돌진. 돌진 속도를 유지한 채 상대를 관통하며 피해' },
  { id:'ironDefense', cat:'tempo', name:'철통 방어', desc:'전투 시작 후 5초 동안 받는 피해 -40%' },
  // ---- 체력 조건 ----
  { id:'berserker',       cat:'hpcond', name:'광전사', desc:'잃은 체력 2%마다 공격력 +1% (최대 +50%)' },
  { id:'escapeInstinct',  cat:'hpcond', name:'도주 본능', desc:'HP 30% 이하에서 이동속도 +40%' },
  { id:'lastResistance',  cat:'hpcond', name:'마지막 저항', desc:'처음 죽음에 이르는 피해를 받을 때 HP 1로 생존 (전투당 1회)' },
  { id:'survivalInstinct',cat:'hpcond', name:'생존 본능', desc:'처음 HP가 30% 이하가 되는 순간 최대 체력의 15% 회복' },
  // ---- 승패 기반 영구 성장 ----
  { id:'winMomentum',cat:'streak', name:'승자의 기세', desc:'승리할 때마다 공격력 +4% (게임 내 영구)' },
  { id:'bloodRush',  cat:'streak', name:'핏빛 질주', desc:'연승마다 공격력 +6%. 패배 시 연승 초기화' },
  { id:'winAccel',   cat:'streak', name:'연승 가속', desc:'연승마다 이동속도 +5%. 패배 시 초기화' },
  { id:'vengeance',  cat:'streak', name:'복수심', desc:'패배할 때마다 공격력 +7%' },
  { id:'learnLoss',  cat:'streak', name:'패배에서 배운다', desc:'패배할 때마다 최대 체력 +8%' },
  { id:'survivor',   cat:'streak', name:'끈질긴 생존자', desc:'라운드 종료마다 최대 체력 +3%' },
  { id:'battleExp',  cat:'streak', name:'전투 경험', desc:'라운드마다 공격속도 +2%' },
  { id:'seasonedExp',cat:'streak', name:'노련한 경험', desc:'라운드 종료마다 공격력 +3%' },
  { id:'fallenPower',cat:'streak', name:'몰락한 강자', desc:'코인을 잃을 때마다 모든 피해량 +5%' },
  { id:'brink',      cat:'streak', name:'벼랑 끝', desc:'코인이 1개 남았을 때 모든 피해량 +20%' },
  // ---- 코인 ----
  { id:'trollCondition',cat:'coin', name:'트롤의 조건', desc:'획득 직후 다음 전투에서 패배하면 코인을 잃지 않고 모든 피해량 +10%. 승리하면 코인 1개 상실' },
  { id:'devilDeal',cat:'coin', name:'악마와의 거래', desc:'코인 1개 즉시 상실. 공격력 +25%' },
  { id:'gamble',   cat:'coin', name:'승부사 기질', desc:'다음 패배 시 코인 추가 -1. 승리 시 모든 피해량 +20%' },
  // ---- 대가성 ----
  { id:'glass',    cat:'trade', name:'유리칼날', desc:'공격력 +20% / 최대 체력 -15%' },
  { id:'brute',    cat:'trade', name:'괴력', desc:'공격력 +25% / 공격속도 -25%' },
  { id:'bloodWeapon',cat:'trade', name:'피의 무기', desc:'공격력 +30% / 전투 중 5초마다 현재 체력 5% 소모' },
  // ---- 물리 상호작용 ----
  { id:'pinball',      cat:'physics', name:'핀볼', desc:'벽에 부딪힐 때마다 공격력 +4% (최대 10중첩). 무기 적중 시 초기화' },
  { id:'reflectCharge',cat:'physics', name:'반사 충전', desc:'벽 3회 접촉 후 다음 공격 피해 +30%' },
  { id:'wallClimb',    cat:'physics', name:'벽타기', desc:'벽 충돌 시 HP 1% 회복' },
  { id:'shockwave',    cat:'physics', name:'충격파', desc:'벽 충돌 시 주변에 피해 7의 충격파 발생' },
  { id:'collisionMania',cat:'physics', name:'충돌광', desc:'상대와 몸통이 충돌할 때마다 공격력 +3%' },
  { id:'staticShock',  cat:'physics', name:'전기 충돌', desc:'상대와 몸통 충돌 시 정전기 피해 5' },
  { id:'staticUp',     cat:'physics', name:'전기 강화', desc:'정전기 피해 +60%', req:'staticShock' },
  { id:'staticFast',   cat:'physics', name:'빠른 정전기', desc:'이동속도가 높을수록 정전기 피해 증가', req:'staticShock' },
  // ---- 이동 방해 ----
  { id:'sleepGas',    cat:'cc', name:'수면 가스', desc:'10초마다 상대를 1초간 기절시켜 이동·무기·스킬 사용을 봉인' },
  { id:'frost',       cat:'cc', name:'냉기', desc:'무기 적중 시 상대 이동속도 -10% (3초, 최대 3중첩)' },
  { id:'gravityWell', cat:'cc', name:'중력장', desc:'10초마다 상대 진행 방향을 자신 쪽으로 변경' },
  // ---- 자동 공격 ----
  { id:'missile',    cat:'auto', name:'유도 미사일', desc:'3초마다 피해 3의 유도탄 2발 발사' },
  { id:'missilePlus',cat:'auto', name:'미사일 증식', desc:'유도 미사일 +1발', req:'missile' },
  { id:'missileUp',  cat:'auto', name:'고폭 탄두', desc:'미사일 피해 +30%', req:'missile' },
  { id:'flame',      cat:'auto', name:'화염 흔적', desc:'지나간 자리에 2초간 불꽃 생성, 밟는 동안 초당 피해 1' },
  { id:'flameUp',    cat:'auto', name:'뜨거운 길', desc:'화염 흔적 피해 +30%', req:'flame' },
  { id:'flameDur',   cat:'auto', name:'끈질긴 화염', desc:'화염 흔적 지속시간 +50%', req:'flame' },
  { id:'lightning',  cat:'auto', name:'번개 구름', desc:'벽에 3번 튕길 때마다 랜덤 위치에 피해 10의 번개 낙하' },
  { id:'chainBolt',  cat:'auto', name:'연쇄 번개', desc:'번개 적중 시 작은 번개 2회 추가', req:'lightning' },
  { id:'shuriken',   cat:'auto', name:'표창', desc:'2초마다 상대 현재 위치를 향해 피해 5의 표창 발사' },
  { id:'shurikenSpd',cat:'auto', name:'표창 강화', desc:'표창 속도 +50%', req:'shuriken' },
  { id:'shurikenUp', cat:'auto', name:'강화 표창', desc:'표창 피해 +30%', req:'shuriken' },
  { id:'satellite',  cat:'auto', name:'위성체', desc:'주위를 공전하며 접촉당 피해 3을 주는 구체 생성' },
  { id:'satellitePlus',cat:'auto', name:'위성 증식', desc:'위성체 +1', req:'satellite' },
  // ---- 소환수 ----
  { id:'miniBall',    cat:'summon', name:'꼬마볼', desc:'전투 시작 시 벽을 튕겨 다니다 적과 부딪히면 접촉당 피해 10을 주는 아군 볼 소환' },
  { id:'twins',       cat:'summon', name:'쌍둥이', desc:'꼬마볼 +1', req:'miniBall' },
  { id:'legion',      cat:'summon', name:'군단', desc:'소환수 체력·피해·크기 +30%', req:'miniBall' },
  { id:'minionRevenge',cat:'summon', name:'복수하는 부하', desc:'소환수 사망 시 주변에 피해 20의 폭발', req:'miniBall' },
  // ---- 사망 관련 ----
  { id:'split',    cat:'death', name:'분열', desc:'HP 0 시 현재 장비와 증강을 복제한 공 2개로 분열. 각 HP 10%, 모든 피해 50% (전투당 1회)' },
  { id:'lastStand',cat:'death', name:'최후의 3초', desc:'HP 0 이후에도 3초간 행동 가능. 그 안에 쓰러뜨리면 승리' },
  // ---- 타격/피격 ----
  { id:'warmonger',  cat:'onhit', name:'전투광', desc:'무기 공격 성공마다 공격력 +5% (최대 5스택)' },
  { id:'rotMomentum',cat:'onhit', name:'연격 가속', desc:'무기 적중마다 공격속도 +6% (최대 8스택)' },
  { id:'chase',      cat:'onhit', name:'추격 본능', desc:'공격 성공 시 3초간 이동속도 +20%' },
  { id:'vampiric',   cat:'onhit', name:'흡혈 폭주', desc:'무기 공격 성공 시 HP 5% 회복' },
  { id:'mark',       cat:'onhit', name:'표식', desc:'같은 상대에게 5번째 무기 적중 시 추가 피해' },
  { id:'counter',    cat:'onhit', name:'반격', desc:'피해를 받은 뒤 다음 무기 공격 피해 +30%' },
  { id:'hitCharge',  cat:'onhit', name:'피격 충전', desc:'피해를 받을 때마다 모든 피해량 +3% (최대 5중첩)' },
  // ---- 스킬 강화 ----
  { id:'battery',         cat:'skill', name:'추가 배터리', desc:'공용 스킬 사용 횟수 +1' },
  { id:'weaponMastery',   cat:'skill', name:'무기 숙련', desc:'무기 전용 스킬 사용 횟수 +1' },
  { id:'talent',          cat:'skill', name:'타고난 재능', desc:'캐릭터 전용 스킬 사용 횟수 +1' },
  // ---- 빌드 연결 ----
  { id:'autoExpert', cat:'link', name:'자동화 전문가', desc:'쿨타임형 증강(미사일·표창·수면 가스·중력장) 쿨타임 -30%' },
  { id:'speedPower', cat:'link', name:'속도는 힘', desc:'추가 이동속도 +3%마다 모든 피해량 +1%' },
  // ---- 무기 전용 ----
  { id:'w_giant', cat:'weapon', weapon:'sword', name:'거대검', desc:'다른 수치 변화 없이 검의 크기만 1.5배' },
  { id:'w_beam',  cat:'weapon', weapon:'sword', name:'검기', desc:'검이 한 바퀴 돌 때마다 좌우로 넓은 피해 15의 관통 검기 발사' },
  { id:'desperateSpin',cat:'weapon', weapon:'sword', name:'필사의 회전', desc:'HP 30% 이하에서 공격속도 +50%' },
  { id:'d_dual',  cat:'weapon', weapon:'dagger', name:'쌍단검', desc:'단검을 양손에 장착한다' },
  { id:'d_phase', cat:'weapon', weapon:'dagger', name:'유체화', desc:'공격 성공 후 1초간 공격받지 않는 상태가 된다' },
  { id:'d_bleed', cat:'weapon', weapon:'dagger', name:'출혈', desc:'적중할 때마다 영구 중첩. 1초마다 중첩 수만큼 고정 피해' },
  { id:'b_triple',cat:'weapon', weapon:'bow', name:'트리플 샷', desc:'한 번의 공격에 화살 세 갈래' },
  { id:'b_homing',cat:'weapon', weapon:'bow', name:'유도 화살', desc:'화살에 약한 유도 효과' },
  { id:'b_kb',    cat:'weapon', weapon:'bow', name:'넉백 화살', desc:'적중 시 상대를 살짝 밀어낸다 (진행 방향 유지)' },
  { id:'p_dual',  cat:'weapon', weapon:'pistol', name:'쌍권총', desc:'권총을 양손에 장착해 서로 반대 방향으로 발사한다' },
  { id:'p_mag',   cat:'weapon', weapon:'pistol', name:'확장 탄창', desc:'한 번에 발사 가능한 탄환 수 증가 (+4)' },
  { id:'p_bayonet',cat:'weapon',weapon:'pistol', name:'총검술', desc:'재장전 동안 피해 15의 단검을 들고 근접 공격한다' },
  { id:'s_triple',cat:'weapon', weapon:'staff', name:'삼중 마법', desc:'마법 투사체가 세 갈래로 발사된다' },
  { id:'s_steal', cat:'weapon', weapon:'staff', name:'무기 강탈', desc:'마법 적중 시 상대 무기를 1초간 사용 불가' },
  { id:'s_bounce',cat:'weapon', weapon:'staff', name:'이중 반사', desc:'마법 투사체 벽 반사 +1회' },
  { id:'m_big',   cat:'weapon', weapon:'mine', name:'대형 지뢰', desc:'지뢰를 밟는 판정 범위와 폭발 피해 판정 범위 증가' },
  { id:'m_heal',  cat:'weapon', weapon:'mine', name:'회복 지뢰', desc:'자신이 지뢰를 밟으면 체력 8% 회복' },
  { id:'m_freeze',cat:'weapon', weapon:'mine', name:'빙결 지뢰', desc:'상대가 밟으면 2초간 이동속도·공격속도 대폭 감소' },
  // ---- 캐릭터 스킬 카피 ----
  { id:'copy_cat', cat:'copy', charId:'cat', name:'고양이 발바닥의 기술', desc:'공용 방향 전환 제거 → 1초 후 경기장 중앙에 피해 24의 고양이 발바닥 낙하' },
  { id:'copy_wak', cat:'copy', charId:'wak', name:'왁뿌볼의 기술', desc:'공용 방향 전환 제거 → 파괴 폭주 획득' },
  { id:'copy_soft',cat:'copy', charId:'soft', name:'말랑이의 기술', desc:'공용 방향 전환 제거 → 2초 피해 무시 획득' },
  { id:'copy_bomb',cat:'copy', charId:'bomb', name:'폭탄의 기술', desc:'공용 방향 전환 제거 → 시한폭발 획득' },
  { id:'copy_bball',cat:'copy',charId:'bball', name:'농구공의 기술', desc:'공용 방향 전환 제거 → 3바운드 획득' },
  { id:'copy_balloon',cat:'copy',charId:'balloon', name:'풍선의 기술', desc:'공용 방향 전환 제거 → 팽창 획득' },
];

const AUG_BY_ID = {};
AUGMENTS.forEach(a => AUG_BY_ID[a.id] = a);

const AI_NAMES = ['반사의달인', '코인부자', '왁와크', '탱곰', '부엉이상승', '핀볼마스터', '말랑말랑', '세계의검'];
const AI_COLORS = ['#ff6b6b', '#6bd968', '#b97bff'];

const SKILL_ICONS = {
  cat:'🐾', wak:'💢', soft:'🛡️', bomb:'💣', bball:'🏀', balloon:'🎈', direction:'🧭',
  sword:'🌀', dagger:'💨', bow:'🏹', pistol:'🎯', staff:'✨', mine:'🧨',
};
