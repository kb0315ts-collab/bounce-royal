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

/* 무기 스킬은 라운드당 1회가 아니라 쿨타임으로 돈다 (초).
 * 캐릭터 스킬은 그대로 라운드당 1회다 — 왁뿌볼 파괴 폭주처럼 대가가
 * 영구히 남는 스킬은 두 번째 사용이 자해라서 횟수로 두는 편이 맞다. */
const WEAPON_SKILL_CD = { sword: 8, dagger: 20, bow: 15, pistol: 12, staff: 18, mine: 12, chain: 12 };

const WEAPONS = {
  // 회전은 검 3.0 -> 2.6, 단검 5.0 -> 5.8. 검이 무증강 대진에서 68%로 혼자 앞서고
  // 단검이 43%로 처져 있었다. 둘을 맞바꿔 좁혔다 (실측 61% / 48%).
  sword:  { name:'검', ico:'⚔️', type:'melee', dmg:20, reach:60, tip:13, rot:2.6, moveMult:0.90,
    desc:'긴 사거리와 높은 피해. 대신 공격속도·이동속도가 느리다.', stat:{atk:.85,spd:.45,rng:.7,mob:.4},
    skillName:'믹서기', skillDesc:'별도 피해 없이 1.2초 동안 두 바퀴 연속 회전한다.' },
  dagger: { name:'단검', ico:'🔪', type:'melee', dmg:18, reach:30, tip:9, rot:5.8, moveMult:1.15, dashDmg:22,
    desc:'짧고 피해는 낮지만 공격속도·이동속도가 매우 빠르다.', stat:{atk:.45,spd:.95,rng:.3,mob:.95},
    skillName:'관통 돌진', skillDesc:'1초간 정지 후 원래 진행 방향으로 돌진해 관통하며 22의 무기 피해.' },
  bow:    { name:'활', ico:'🏹', type:'ranged', dmg:8, interval:1.5, projSpeed:300, rot:2.6, moveMult:1.0, chargeDmg:15,
    desc:'상대를 자동으로 겨눠 화살을 계속 발사하는 안정적인 원거리 무기.', stat:{atk:.55,spd:.65,rng:.95,mob:.7},
    skillName:'차지 샷', skillDesc:'자동 조준을 끄고 두 바퀴에 걸쳐 천천히 회전한다. 1초 후부터 다시 눌러 노린 방향으로 발사 — 적과 장애물을 관통하는 피해 15. 안 쏘면 두 바퀴째에 그대로 나간다.' },
  pistol: { name:'권총', ico:'🔫', type:'ranged', dmg:3, burst:7, shotGap:0.12, reload:3.0, projSpeed:500, rot:3.0, moveMult:1.0,
    desc:'상대를 자동으로 겨눠 7연사 후 3초 재장전. 화력과 공백이 명확하다.', stat:{atk:.6,spd:.9,rng:.85,mob:.7},
    skillName:'회전 난사', skillDesc:'1.5초간 빙글빙글 돌며 재장전 없이 사방으로 난사한다.' },
  staff:  { name:'지팡이', ico:'🪄', type:'ranged', dmg:15, interval:2.5, projSpeed:135, bounces:1, rot:2.5, moveMult:1.0,
    desc:'상대를 자동으로 겨누는 느리고 강한 마법 투사체. 벽에 한 번 반사된다.', stat:{atk:1,spd:.15,rng:.8,mob:.7},
    skillName:'마력 폭주', skillDesc:'3초간 자신이 발사한 모든 마법 투사체의 크기가 2배가 된다.' },
  /* 평소엔 검처럼 돌며 닿으면 피해. 스킬로 바라보는 방향에 던진다.
   * 던진 뒤에는 주울 때까지 무기가 없으니 신중해야 한다.
   * 횟수 제한이 필요 없다 — 주워야만 다시 던질 수 있어 제한이 저절로 걸린다. */
  shield: { name:'방패', ico:'🛡️', type:'melee', dmg:15, reach:42, tip:14, rot:2.2, moveMult:0.95,
    throwSpd:520, throwDmg:8, decel:0.82, restSpd:40, pickupPad:18, discR:15, hitBounce:0.5,
    // 자기 방패(sh_magnet): 던지면 recallCd초 쿨타임, 끝나면 스킬로 불러온다(recallSpd로 날아옴)
    recallCd:8, recallSpd:700,
    desc:'몸에 붙여 휘두르다 던질 수 있다. 던진 뒤에는 주울 때까지 무기가 없다.', stat:{atk:.65,spd:.5,rng:.45,mob:.65},
    skillName:'투척', skillDesc:'방패가 바라보는 방향으로 던진다. 벽과 상대에 맞으면 튕겨 나오고, 주워야 다시 던질 수 있다.' },
  /* 자동 공격이 없는 첫 무기. 스킬 버튼을 누르고 있는 동안만 조향 방향으로
   * 분사하고 연료를 쓴다. 떼면 다시 찬다. 투사체가 없어 피할 수 없는 대신
   * 사거리가 짧고 연료가 상한 역할을 한다.
   *   tickDmg 불길 안의 상대가 tickT초마다 받는 피해 (tickT는 공격속도와 상관없이 고정)
   *   (0.5초마다 3이던 것을 0.2초마다 2로 — 닿았는데 한동안 안 아픈 틈이 줄었다)
   *   range 사거리 · halfArc 반각(rad)
   *   burnRate 초당 소모 · refillRate 초당 회복 (공격속도가 여기 곱해진다 —
   *   기본 회복을 낮게 두어 공격속도를 챙길 이유가 된다) */
  flame:  { name:'화염방사기', ico:'🔥', type:'cone', dmg:0, tickDmg:2, tickT:0.2, range:114, halfArc:0.35,
    fuelMax:100, burnRate:40, refillRate:15, refillDelay:0.5, rot:0, moveMult:0.92,
    desc:'버튼을 누르는 동안 조향 방향으로 불을 뿜는다. 피할 수 없지만 연료가 있다.', stat:{atk:.75,spd:.6,rng:.35,mob:.6},
    skillName:'분사', skillDesc:'누르고 있는 동안 조향 방향으로 불을 뿜는다. 연료를 다 쓰면 잠시 못 쏜다.' },
  /* 공에 매달린 추가 관성으로 따라온다. 휘두르지 않으면 아프지 않은 것이
   * 이 무기의 전부다 — 조이스틱이 공을 조향하는 동시에 추를 민다.
   *   chainLen 사슬 길이 · headR 추 반지름 · gate 피해가 들어가는 최소 상대속도
   *   response 접힌 줄을 펴는 힘 (조이스틱 힘을 450으로 낮추며 3 -> 6. 약한 힘으로는
   *            달리며 꺾을 때 줄이 공 속으로 접혀 들어갔다) · drag 감쇠
   *   rot 조이스틱 힘의 기준값 (공격속도가 오르면 st.rot이 커지고 그 비율만큼 세게 민다) */
  chain:  { name:'철퇴', ico:'⛓️', type:'chain', dmg:12, rot:2.3, moveMult:1.05,
    chainLen:85, headR:10, gate:80, hitLock:0.35, response:6, drag:0.35,
    // 벽 강타(c_quake): 추가 벽에 세게 부딪힌 자리의 충격파 피해·반경·같은 추 재발동 간격
    quakeDmg:5, quakeR:112, quakeCd:0.5,
    desc:'조이스틱으로 공을 조향하면 매달린 추도 그쪽으로 휘둘린다. 천천히 닿으면 피해가 없다.', stat:{atk:.7,spd:.5,rng:.55,mob:.8},
    skillName:'위치 교환', skillDesc:'공과 추의 위치·속도를 즉시 맞바꾼다. 상대가 붙었을 때 쓰면 그 자리에 추가 남는다.' },
  // maxMines를 없앴다. 이제 제한 없이 깔아 둘 수 있다.
  mine:   { name:'지뢰', ico:'🧨', type:'mine', dmg:9, interval:3.5, triggerR:28, blastR:62, moveMult:1.0, rot:1.5,
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
  weapon:'무기 전용',
};

/* 증강 목록 — stackable:true 는 중복 획득 가능 */
const AUGMENTS = [
  // ---- 기본 스탯 ----
  { id:'hp15',      cat:'stat', stackable:true, name:'단단한 몸', desc:'최대 체력 +15%' },
  { id:'atk15',     cat:'stat', stackable:true, name:'무기 강화', desc:'공격력 +15%' },
  { id:'dmg10',     cat:'stat', stackable:true, name:'날카로운 감각', desc:'모든 피해량 +10%' },
  { id:'rot15',     cat:'stat', stackable:true, name:'속사', desc:'공격속도 +15%' },
  { id:'move15',    cat:'stat', stackable:true, name:'가벼운 몸', desc:'이동속도 +15%' },
  { id:'lifesteal', cat:'stat', stackable:true, name:'전투 흡수', desc:'가한 피해의 25%만큼 체력 회복' },
  { id:'giant',     cat:'stat', name:'거대화', desc:'본체 크기 +20%, 최대 체력 +50% (무기 크기 불변)' },
  { id:'tiny',      cat:'stat', name:'소형화', desc:'본체 크기 -20%. 맞기 어려워진다' },
  { id:'elastic',   cat:'stat', name:'탄성 강화', desc:'벽에 충돌한 직후 1초간 이동속도 +25%' },
  // ---- 시간 성장 ----
  { id:'warmup',    cat:'time', name:'예열', desc:'전투 중 5초마다 공격력 +3%' },
  { id:'accelRot',  cat:'time', name:'가속', desc:'전투 중 5초마다 공격속도 +3%' },
  { id:'speedster', cat:'time', name:'속도광', desc:'전투 중 5초마다 이동속도 +5%' },
  { id:'meditate',  cat:'time', name:'명상', desc:'전투 중 5초마다 체력 3% 회복' },
  { id:'marathoner',cat:'time', name:'장기전 체질', desc:'전투 30초가 지나면 잃은 체력의 50% 회복' },
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
  { id:'vengeance',  cat:'streak', name:'복수심', desc:'패배할 때마다 공격력 +7%' },
  { id:'learnLoss',  cat:'streak', name:'패배에서 배운다', desc:'패배할 때마다 최대 체력 +8%' },
  { id:'survivor',   cat:'streak', name:'끈질긴 생존자', desc:'라운드 종료마다 최대 체력 +3%' },
  { id:'battleExp',  cat:'streak', name:'전투 경험', desc:'라운드마다 공격속도 +2%' },
  { id:'seasonedExp',cat:'streak', name:'노련한 경험', desc:'라운드 종료마다 공격력 +3%' },
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
  { id:'repulse', cat:'cc', name:'반발심', desc:'8초마다 주변(반경 130)의 적을 밀어내 나에게서 멀어지는 쪽으로 보낸다. 충전된 뒤 적이 가까이 오면 터진다' },
  // ---- 자동 공격 ----
  { id:'missile',    cat:'auto', name:'유도 미사일', desc:'3초마다 피해 2의 유도탄 2발 발사' },
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
  { id:'legion',      cat:'summon', name:'군단', desc:'소환수 체력·피해·크기 +50%', req:'miniBall' },
  { id:'thornLeash',  cat:'summon', name:'가시목줄', desc:'꼬마볼과 내 공 사이에 가시 줄이 생긴다. 줄에 닿은 상대는 피해 4 (같은 상대는 0.5초에 한 번)', req:'miniBall' },
  { id:'minionRevenge',cat:'summon', name:'복수하는 부하', desc:'소환수 사망 시 주변에 피해 20의 폭발', req:'miniBall' },
  // ---- 사망 관련 ----
  { id:'split',    cat:'death', name:'분열', desc:'HP 0 시 현재 장비와 증강을 복제한 공 2개로 분열. 각 HP 10%, 모든 피해 50% (전투당 1회)' },
  { id:'lastStand',cat:'death', name:'최후의 3초', desc:'HP 0 이후에도 3초간 행동 가능. 그 안에 쓰러뜨리면 승리' },
  // ---- 타격/피격 ----
  { id:'warmonger',  cat:'onhit', name:'전투광', desc:'무기 공격 성공마다 공격력 +5% (최대 5스택)' },
  { id:'rotMomentum',cat:'onhit', name:'연격 가속', desc:'무기 적중마다 공격속도 +6% (최대 8스택)' },
  { id:'chase',      cat:'onhit', name:'추격 본능', desc:'공격 성공 시 3초간 이동속도 +20%' },
  { id:'vampiric',   cat:'onhit', name:'흡혈 폭주', desc:'무기 공격 성공 시 HP 4% 회복' },
  { id:'mark',       cat:'onhit', name:'표식', desc:'같은 상대에게 5번째 무기 적중 시 추가 피해' },
  { id:'counter',    cat:'onhit', name:'반격', desc:'피해를 받은 뒤 다음 무기 공격 피해 +30%' },
  { id:'hitCharge',  cat:'onhit', name:'피격 충전', desc:'피해를 받을 때마다 모든 피해량 +3% (최대 5중첩)' },
  // ---- 스킬 강화 ----
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
  { id:'b_triple',cat:'weapon', weapon:'bow', name:'트리플 샷', desc:'화살이 세 갈래. 대신 발당 피해가 절반' },
  { id:'b_homing',cat:'weapon', weapon:'bow', name:'유도 화살', desc:'상대에게 가까워진 화살만 살짝 휘어 따라붙는다. 멀리서는 그대로 직진' },
  { id:'b_kb',    cat:'weapon', weapon:'bow', name:'넉백 화살', desc:'적중 시 상대를 살짝 밀어낸다 (진행 방향 유지)' },
  { id:'p_shotgun',cat:'weapon', weapon:'pistol', name:'샷건', desc:'한 발씩 쏘지 않고 탄창을 모아 산탄으로 한 번에 뿌린다' },
  { id:'p_mag',   cat:'weapon', weapon:'pistol', name:'확장 탄창', desc:'한 번에 발사 가능한 탄환 수 증가 (+4)' },
  { id:'p_bayonet',cat:'weapon',weapon:'pistol', name:'총검술', desc:'재장전 동안 피해 10의 단검을 들고 근접 공격한다' },
  { id:'s_double',cat:'weapon', weapon:'staff', name:'이중 마법', desc:'마법 투사체가 양옆 두 갈래로 갈라져 나간다. 정면이 비어 똑바로 오는 상대는 놓칠 수 있다' },
  { id:'s_steal', cat:'weapon', weapon:'staff', name:'무기 강탈', desc:'마법 적중 시 상대 무기를 1초간 사용 불가' },
  { id:'s_bounce',cat:'weapon', weapon:'staff', name:'이중 반사', desc:'마법 투사체 벽 반사 +1회' },
  { id:'m_big',   cat:'weapon', weapon:'mine', name:'대형 지뢰', desc:'지뢰를 밟는 판정 범위와 폭발 피해 판정 범위 증가' },
  { id:'m_heal',  cat:'weapon', weapon:'mine', name:'회복 지뢰', desc:'자신이 지뢰를 밟으면 체력 8% 회복' },
  { id:'sh_magnet',  cat:'weapon', weapon:'shield', name:'자기 방패', desc:'던지면 8초 쿨타임. 그 뒤 스킬로 방패를 불러오고, 날아오는 방패는 적을 관통하며 피해를 준다. 8초 전에 주우면 바로 다시 던질 수 있다' },
  { id:'sh_ricochet',cat:'weapon', weapon:'shield', name:'튕기는 방패', desc:'벽에 튕길 때마다 피해 +25% (3회까지, 최대 2배)' },
  { id:'sh_grip',    cat:'weapon', weapon:'shield', name:'단단한 손', desc:'방패를 들고 있으면 방패가 향한 정면(좌우 45°)에서 오는 투사체·근접 공격·돌진·화염을 막아낸다. 방패는 돌고 있어 등 뒤는 못 지킨다' },
  { id:'f_pressure',cat:'weapon', weapon:'flame', name:'압축 연료', desc:'사거리가 길어지는 대신 분사 각도가 좁아진다' },
  { id:'f_ember', cat:'weapon', weapon:'flame', name:'잔불', desc:'불길이 닿은 바닥에 2초간 화염이 남는다' },
  { id:'f_thrust',cat:'weapon', weapon:'flame', name:'역분사', desc:'분사하는 동안 반대 방향으로 밀려난다. 조향으로는 못 하는 기동이 열린다' },
  { id:'c_long',  cat:'weapon', weapon:'chain', name:'사슬 연장', desc:'사슬이 길어진다. 훑는 범위가 넓어지지만 추가 더 늦게 따라온다' },
  { id:'c_barbed',cat:'weapon', weapon:'chain', name:'가시 사슬', desc:'사슬 줄에도 판정이 생긴다. 줄에 스치면 추 피해의 40%' },
  { id:'c_quake', cat:'weapon', weapon:'chain', name:'벽 강타', desc:'추가 벽에 세게 부딪히면 그 자리에 충격파가 퍼져 주변 적에게 피해 5' },
  { id:'m_freeze',cat:'weapon', weapon:'mine', name:'빙결 지뢰', desc:'상대가 밟으면 2초간 이동속도·공격속도 대폭 감소' },
  // ---- 캐릭터 스킬 카피 ----
];

const AUG_BY_ID = {};
AUGMENTS.forEach(a => AUG_BY_ID[a.id] = a);

const AI_NAMES = ['반사의달인', '코인부자', '왁와크', '탱곰', '부엉이상승', '핀볼마스터', '말랑말랑', '세계의검'];
const AI_COLORS = ['#ff6b6b', '#6bd968', '#b97bff'];

const SKILL_ICONS = {
  cat:'🐾', wak:'💢', soft:'🛡️', bomb:'💣', bball:'🏀', balloon:'🎈', direction:'🧭',
  sword:'🌀', dagger:'💨', bow:'🏹', pistol:'🎯', staff:'✨', mine:'🧨',
};
