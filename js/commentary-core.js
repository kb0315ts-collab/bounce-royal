'use strict';

/* Client-only sports commentary. Reads confirmed battle facts; never runs gameplay,
 * consumes the simulation RNG, or keeps a queue of already expired announcements.
 *
 * 선인장 해설은 세 층이다.
 *  - 중요: 스킬 적중 · 특수 공격 · 큰 한 방 · 마지막 저항 · 분열 · 탈락 · 역전 · 남은 시간 · 승패 · GG.
 *    일반 해설을 하던 중이면 끊고 바로 나온다. 중요끼리는 앞 대사를 MIN_SHOW_MS만큼은
 *    보여 주고, 더 중요한 일이면 그 전에라도 넘긴다. 틈을 못 얻으면 PENDING_MS 동안만 기다린다.
 *  - 일반: 적중 · 연속타 · 벽 활용 · 방어 · 회피 · 빗나감 · 우세 · 위기 · 근접전 · 스킬 사용 등.
 *    앞 대사가 말풍선에서 사라지고 GENERAL_GAP_MS가 지나야 말한다. 같은 종류는 연달아 말하지 않는다.
 *  - 소강: 한동안 아무도 못 맞히면 시간에 따라 세 단계로 한마디.
 * 모든 대사는 확정된 사실(피해·스킬·체력·시간·위치)에서만 나온다. 말투는 짧고 담담하게. */
(function (root) {
  const GENERAL_GAP_MS = 3000;
  const MIN_SHOW_MS = 1000;
  const PENDING_MS = 1500;
  const SAME_KIND_MS = 12000;
  const IMPORTANT = 60;            // 이 우선순위부터 중요 해설
  const EVENT_MAX_AGE = 1.25;
  const COMBO_WINDOW = 2;
  const BIG_BLOW = .3, HEAVY_HIT = .12;   // 한 방이 상대 최대 체력에서 차지하는 몫
  const QUIET_STEPS = [7, 12, 16], QUIET_REPEAT = 8;
  const CLOSE_GAP = 30, CLOSE_HOLD = 2.5;
  const TIME_WARNING = 10;
  const CHARGE_MISS_T = 1.2;
  const UTILITY_SKILLS = new Set(['skill:sword', 'skill:pistol', 'skill:staff',
    'char:cat', 'char:wak', 'char:soft', 'char:balloon']);
  const SPECIALS = { 'augment:lightning': 'lightning', 'augment:shockwave': 'shockwave',
    'augment:chainBolt': 'chainBolt', 'augment:chainQuake': 'chainQuake' };
  const AUTO = new Set(['augment:shuriken', 'augment:missile', 'augment:satellite', 'augment:swordBeam',
    'augment:bayonet', 'augment:rocketStart', 'augment:staticShock']);
  const SUMMON = new Set(['augment:miniBall', 'augment:minionRevenge']);
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const nameOf = value => {
    const letters = Array.from(String(value == null ? '선수' : value)
      .replace(/[\u0000-\u001f\u007f]/g, '').trim() || '선수');
    return letters.length > 9 ? letters.slice(0, 8).join('') + '…' : letters.join('');
  };
  const actorOf = fighter => ({ uid: fighter ? fighter.uid ?? fighter.id ?? null : null,
    name: fighter ? nameOf(fighter.name) : '', color: fighter && typeof fighter.color === 'string'
      ? fighter.color : '#ffe18a' });
  const ratio = fighter => Math.max(0, Math.min(1, finite(fighter.hp) / Math.max(1, finite(fighter.maxHp, 1))));
  const entry = (data, id) => Object.prototype.hasOwnProperty.call(data, id) ? data[id] : null;
  // 말풍선이 떠 있는 시간. 화면(commentary.js)과 감독이 같은 값을 쓴다.
  const displayMs = (text, gg = false) => gg ? 2500
    : Math.min(3300, Math.max(2500, Array.from(String(text == null ? '' : text)).length * 65));

  /* 같은 상황이라도 표현이 돌아가게 한다. 난수는 쓸 수 없다 — 중계는 게임
   * RNG를 절대 건드리지 않는다 — 그래서 이미 확정된 사실(이벤트 seq, uid,
   * 경기 시각)에서 뽑은 정수로 고른다. 같은 경기를 다시 봐도 같은 대사가 나온다. */
  const pick = (list, n) => list[((Math.trunc(finite(n)) % list.length) + list.length) % list.length];
  /* 문자열에서 고르게 퍼지는 정수를 만든다. 사실을 그냥 더하면 배수가 겹쳐
   * 늘 같은 항목만 나온다 (실제로 12n+11 꼴이 되어 한 가지만 뽑혔다). */
  const spin = value => {
    let h = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 8;
  };
  /* 한국어 조사. 받침이 있으면 앞쪽, 없으면 뒤쪽을 쓴다.
   * 이게 없으면 '지훈가 앞섭니다', '방어을 발동' 같은 말이 나간다. */
  const hasJong = word => {
    const text = String(word || '');
    const code = text.charCodeAt(text.length - 1);
    return code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 !== 0 : false;
  };
  const josa = (word, withJong, without) => String(word) + (hasJong(word) ? withJong : without);
  // 으로/로는 ㄹ 받침도 '로'를 쓴다
  const ro = word => {
    const text = String(word || '');
    const code = text.charCodeAt(text.length - 1);
    const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
    return text + (jong === 0 || jong === 8 ? '로' : '으로');
  };
  const ga = who => josa(who, '이', '가');

  /* 대사 사전. 짧고 담담한 중계 톤 — 무슨 일이 있었는지 짚고, 가끔만 한마디 얹는다.
   * 이름이 없는 대사도 말풍선에 선수 이름표가 붙어 누구 이야기인지 보인다. */
  const LINES = {
    intro: (who, weapon) => [
      `${who}의 ${weapon}, 준비됐습니다. 시작합니다.`,
      `${weapon} 든 ${who}, 출발합니다.`,
      '모두 준비 완료. 갑니다.',
      '이번 판, 꽤 치열하겠는데요.',
      '전투 시작됩니다. 첫 충돌이 중요해요.',
      '이번 라운드도 바로 템포 올려봅니다.',
      '준비 끝났습니다. 출발하죠.',
      '누가 먼저 자기 템포를 잡을까요.',
    ],
    duel: (a, wa, b, wb) => [
      `${a} 대 ${b}. 바로 붙습니다.`,
      `${wa} 상대 ${wb}. 운영 차이가 꽤 나겠네요.`,
      `${a}의 ${wa}, ${b}의 ${wb}. 거리 싸움이 핵심이겠어요.`,
      `${a} 대 ${b}. 누가 먼저 템포를 잡을까요?`,
    ],
    streak: (who, n) => [
      `${who}, 현재 ${n}연승입니다. 흐름이 좋아요.`,
      `${who}의 ${n}연승, 계속 이어질까요?`,
      `${who}, ${n}연승 중입니다. 상대가 끊어낼 수 있을까요?`,
      `${n}연승이 걸려 있습니다. ${who}, 시작부터 중요해요.`,
      `지금 가장 분위기 좋은 건 ${n}연승의 ${who}입니다.`,
    ],
    build: (who, n) => [
      `${who}, 증강 ${n}개. 빌드가 꽤 갖춰졌어요.`,
      `${who} 쪽은 증강 시너지가 슬슬 보입니다.`,
      `${who}, 이제부턴 조합의 힘이 나올 차례예요.`,
    ],
    skillUse: (who, skill) => [
      `${who}, ${skill} 사용합니다.`,
      `여기서 ${skill}!`,
      `${skill} 나왔어요.`,
      `타이밍 보고 ${skill} 꺼냈습니다.`,
      `${who}의 ${skill}, 발동.`,
      `좋은 순간에 ${skill} 씁니다.`,
      `딱 필요한 순간에 ${skill} 나왔어요.`,
    ],
    skillHit: (who, skill) => [
      `${who}의 ${skill}, 정확히 들어갔어요.`,
      `${skill} 적중. 이건 아픕니다.`,
      `${who}, ${ro(skill)} 맞혔습니다.`,
      `여기서 ${skill}, 통했습니다.`,
      `${skill}, 노린 대로 들어갑니다.`,
      `${who}의 ${skill}, 좋은 각이었어요.`,
      `${skill} 명중. 흐름이 바뀔 수 있어요.`,
    ],
    lightning: () => [
      '번개까지 연결됩니다.',
      '번개 적중. 피해 누적됩니다.',
      '번개가 정확히 떨어졌어요.',
      '아, 번개까지 이어졌네요.',
      '저 위치에서 번개 맞으면 까다롭죠.',
      '추가 번개, 잘 들어갔어요.',
    ],
    shockwave: () => [
      '충격파까지 맞았습니다.',
      '벽을 활용한 충격파가 통했어요.',
      '반사 직후 충격파, 좋았습니다.',
      '충격파 범위에 걸렸어요.',
      '이건 벽 쪽 운영이 좋았네요.',
      '충격파 추가타 들어갑니다.',
    ],
    chainBolt: () => [
      '끝이 아닙니다. 연쇄 번개예요.',
      '연쇄까지 이어졌어요.',
      '한 번 맞고 끝나질 않네요.',
      '추가 번개가 따라갑니다.',
      '연쇄 피해까지 챙깁니다.',
      '이건 생각보다 더 아파요.',
    ],
    chainQuake: () => [
      '추가 벽을 치고, 충격파가 퍼집니다.',
      '벽 강타, 주변까지 맞았어요.',
      '벽에 부딪힌 추가 그대로 무기가 됐네요.',
      '벽 강타 적중. 벽 근처는 위험해요.',
      '추가 벽을 때리는 순간 걸렸습니다.',
    ],
    bigBlow: (who, target) => [
      '와, 이건 큽니다.',
      '한 방에 많이 빠졌어요.',
      `${who}, 묵직한 한 방입니다.`,
      '방금 타격은 컸습니다.',
      `${target}, 체력이 크게 깎였어요.`,
      '좋은 각에서 크게 들어갔습니다.',
    ],
    heavyHit: () => [
      '이건 좀 아픈데요.',
      '한 방이 묵직합니다.',
      '체력이 쑥 빠졌어요.',
      '좋은 각에서 들어갔습니다.',
      '상대 입장에선 꽤 부담되겠어요.',
      '이건 교환비가 좋네요.',
      '저건 맞기 싫죠.',
    ],
    hit: () => [
      '맞았습니다.',
      '정확히 들어갔어요.',
      '깔끔하게 긁었네요.',
      '한 번 맞춰줍니다.',
      '좋아요, 일단 적중입니다.',
      '짧지만 유효타예요.',
      '스치듯 들어갔어요.',
      '이건 피하기 어려웠죠.',
    ],
    autoHit: () => [
      '자동 공격이 계속 누적돼요.',
      '저런 자잘한 피해가 은근 아픕니다.',
      '계속 따라붙네요.',
      '이건 무시하기 어려워요.',
      '한두 번이 아니라 꾸준히 맞습니다.',
      '빌드가 슬슬 작동하기 시작했어요.',
    ],
    summonHit: () => [
      '소환수가 잘 뛰어다닙니다.',
      '소환수도 무시 못 해요.',
      '부하들이 생각보다 성가셔요.',
      '소환 빌드가 슬슬 힘을 냅니다.',
      '계속 신경 써야 하는 요소가 늘었어요.',
    ],
    dotFlame: () => [
      '바닥 불길이 계속 거슬려요.',
      '저 구역은 오래 있으면 위험합니다.',
      '밟는 동안 계속 손해예요.',
      '지속 피해가 은근히 누적됩니다.',
    ],
    dotBleed: () => [
      '출혈이 계속 체력을 갉아먹어요.',
      '지속 피해가 은근히 누적됩니다.',
      '맞은 뒤에도 피해가 이어지네요.',
    ],
    combo: who => [
      `${who}, 연속으로 맞춥니다.`,
      '연속 적중입니다. 흐름 좋아요.',
      '계속 들어가요.',
      '콤보 끊기지 않습니다.',
      '짧은 시간에 많이 맞췄어요.',
      '세 번 연속 적중, 좋았어요.',
      `지금은 ${who} 쪽 리듬입니다.`,
      '이상하게 다 맞습니다.',
    ],
    firstBlood: who => [
      `${who}, 첫 유효타 만듭니다.`,
      `첫 피해는 ${who} 쪽에서 나왔어요.`,
      `${ga(who)} 먼저 맞혔습니다.`,
      `선제타는 ${who}입니다.`,
      `${who}, 먼저 흐름을 잡아요.`,
      `첫 교전, ${who} 쪽이 이득입니다.`,
    ],
    wallHit: () => [
      '벽 각이 좋았네요.',
      '반사 궤적이 예뻤어요.',
      '벽을 아주 잘 쓰고 있습니다.',
      '저렇게 튕기면 읽기 어렵죠.',
      '반사 이후 동선이 좋았어요.',
      '맵 활용이 좋네요.',
      '이 정도면 벽도 한 팀이에요.',
      '벽이 꽤 열심히 일하네요.',
    ],
    guard: who => [
      '잘 막아냈어요.',
      '피해를 하나도 안 받았습니다.',
      '좋은 방어였네요.',
      '상대의 타이밍을 잘 받아냈습니다.',
      '이건 수비가 좋았어요.',
      `${who}, 한 번 잘 버텼어요.`,
    ],
    dodge: who => [
      '살짝 빗나갔습니다.',
      '아슬아슬하게 비켜 갔어요.',
      '각은 좋았는데 안 맞았어요.',
      '스치듯 지나갔네요.',
      `${who}, 한 끗 차이로 피했어요.`,
      '위험했는데 안 맞았어요.',
      '좋은 판단이었습니다.',
    ],
    chargeMiss: () => [
      '차지 샷, 살짝 빗나갔습니다.',
      '한 방을 노렸지만 비켜 갔어요.',
      '차지 샷 각은 좋았는데 안 맞았어요.',
      '노린 그림은 있었는데 결과가 안 나왔습니다.',
      '아쉽습니다. 차지 샷이 빗나갑니다.',
    ],
    close: (a, b) => [
      '바짝 붙습니다.',
      '서로 물러서지 않네요.',
      '거리 안 줍니다.',
      '붙어서 싸우겠다는 판단이에요.',
      `${a}, ${b} 쪽에 딱 붙었습니다.`,
      '한 번 잘못 들어가면 바로 손해예요.',
    ],
    lead: who => [
      `${who}, 체력에서 앞서갑니다.`,
      '체력 차이가 조금씩 벌어져요.',
      `지금은 ${who} 쪽이 여유 있습니다.`,
      `${who}, 확실히 앞서는 분위기예요.`,
      '체력 우위가 분명해졌습니다.',
      '운영이 깔끔해요. 손해를 덜 보고 있습니다.',
      `현재까진 ${who} 쪽이 더 좋습니다.`,
    ],
    bigLead: who => [
      '체력 차이가 꽤 벌어졌습니다.',
      `이제는 ${who} 쪽이 많이 편해졌어요.`,
      '한쪽으로 기울고 있습니다.',
      '상대는 한 번 크게 뒤집어야 해요.',
      '이대로면 따라가기 쉽지 않습니다.',
      '격차가 제법 납니다.',
    ],
    lowHp: who => [
      `${who}, 이제 꽤 위험합니다.`,
      '체력이 많이 내려왔어요.',
      '한 번 더 맞으면 큰일 날 수 있어요.',
      '버티기가 쉽지 않겠네요.',
      '이제 여유가 거의 없습니다.',
      '다음 한 번이 치명적일 수 있어요.',
      '정말 아슬아슬합니다.',
      '위기예요. 판단이 중요합니다.',
    ],
    veryLow: () => [
      '거의 끝 직전입니다.',
      '정말 한 끗이에요.',
      '이건 숨만 붙어 있는 수준인데요.',
      '체력이 거의 바닥입니다.',
      '다음 충돌이 마지막일 수도 있어요.',
      '아직 살아는 있는데, 많이 위태롭습니다.',
    ],
    comeback: who => [
      '어느새 체력 우위가 뒤집혔어요.',
      '방금 교전으로 흐름이 바뀝니다.',
      '이게 또 달라지네요.',
      `${ga(who)} 다시 앞서갑니다.`,
      '밀리던 쪽이 살아났어요.',
      '승부가 다시 팽팽해집니다.',
      '순간 판단 하나로 분위기가 바뀌었어요.',
    ],
    lastStand: who => [
      '끝난 줄 알았는데, 버팁니다.',
      '아직 안 끝났어요.',
      '간신히 살아남았습니다.',
      '마지막 저항, 발동했어요.',
      `${who}, 이걸 한 번 더 버티네요.`,
      '정말 끈질깁니다.',
    ],
    finalSeconds: who => [
      '최후의 3초, 아직 움직입니다.',
      `${who}, 끝까지 물고 늘어질 수 있어요.`,
      '마지막 순간까지 위협적입니다.',
      '쓰러지기 전 3초, 아직 끝난 게 아닙니다.',
    ],
    split: who => [
      '여기서 분열합니다!',
      '아직 끝난 게 아닙니다. 둘로 나뉘어요.',
      '쓰러지면서도 변수를 남깁니다.',
      `${who}, 둘로 갈라져 버팁니다.`,
    ],
    knockout: who => [
      `${who}, 여기서 탈락합니다.`,
      `${who}, 더는 버티지 못했습니다.`,
      `${who} 아웃. 남은 인원이 줄어듭니다.`,
      `한 명 정리됐습니다. ${who}, 여기까지예요.`,
      `${who}, 아쉽게 여기까지입니다.`,
      `${ga(who)} 쓰러집니다. 이제 남은 인원이 줄어요.`,
    ],
    timeLeft: () => [
      '시간이 얼마 남지 않았습니다.',
      '남은 시간 10초. 이제 시간도 변수예요.',
      '슬슬 판정도 계산해야 합니다.',
      '마무리할지, 버틸지 선택해야 해요.',
      '남은 시간, 많지 않습니다.',
      '이제는 체력 관리도 중요합니다.',
    ],
    roundWin: who => [
      `${who}, 이번 라운드 가져갑니다.`,
      `이번 승자는 ${who}입니다.`,
      `${who}, 먼저 끝냈습니다.`,
      `여기서는 ${ga(who)} 웃습니다.`,
      `${who}, 좋은 마무리였어요.`,
      `이번 교전은 ${who}의 승리입니다.`,
      `${who}, 깔끔하게 정리합니다.`,
      `이 라운드는 ${who} 쪽으로 갑니다.`,
    ],
    roundClose: who => [
      `팽팽했는데, 마지막은 ${who}입니다.`,
      `끝까지 접전이었지만 ${ga(who)} 가져갑니다.`,
      `쉽지 않은 경기였어요. 승자는 ${who}.`,
      `박빙 승부, ${ga(who)} 마무리합니다.`,
      `끝에 집중력이 좋았어요. ${who} 승리.`,
    ],
    roundJudge: who => [
      `시간 종료. 체력 판정으로 ${ga(who)} 가져갑니다.`,
      `판정승은 ${who}입니다.`,
      `끝까지 버틴 쪽은 ${who}입니다.`,
      `시간 종료, ${ga(who)} 앞섰습니다.`,
      `남은 체력에서 ${ga(who)} 우세했습니다.`,
      `길게 갔지만 승자는 ${who}입니다.`,
    ],
    draw: () => [
      '결국 승부를 못 냈습니다. 무승부예요.',
      '이번 라운드는 무승부입니다.',
      '끝까지 비슷했어요. 무승부.',
      '누가 더 낫다고 하기 어려웠네요. 무승부입니다.',
      '아주 팽팽했습니다. 여기서는 무승부예요.',
      '서로 쉽게 안 무너졌습니다. 무승부.',
    ],
    roundOver: () => [
      '이번 라운드가 종료됐습니다.',
      '전투 종료. 결과 확인합니다.',
      '여기까지입니다.',
      '라운드 마무리됐습니다.',
    ],
    gg: who => [
      `GG~~! 최종 우승은 ${who}!`,
      `GG~~! ${who}, 마지막까지 살아남았습니다!`,
      `GG~~! 이 게임의 승자는 ${who}입니다!`,
      `GG~~! ${ga(who)} 바운스 로얄을 가져갑니다!`,
      `GG~~! ${who}, 오늘의 최종 승자입니다!`,
      `GG~~! 길었던 승부의 끝, 우승은 ${who}!`,
      `GG~~! ${who}, 끝까지 가장 강했습니다!`,
      `GG~~! 결국 남은 건 ${who} 하나였습니다!`,
    ],
  };
  /* 소강 — [대사, 아무도 못 맞힌 판에서만 맞는 말인가].
   * 한 번이라도 피해가 오간 판의 소강에서 '아직 체력 변화가 없어요' 같은 말은 거짓이다. */
  const QUIET = [
    null,
    [['아직 유효타는 없습니다.', true], ['서로 첫 타를 못 만들고 있네요.', true],
      ['생각보다 조용하게 흘러갑니다.', false], ['아직 체력 변화가 없어요.', true],
      ['첫 피해가 조금 늦게 나오네요.', true], ['누가 먼저 맞힐까요?', false],
      ['아직 서로 멀쩡합니다.', true], ['조금 길게 탐색전이 이어집니다.', false],
      ['첫 교전이 쉽게 안 나오네요.', true], ['아직은 팽팽합니다.', false]],
    [['슬슬 한 번 부딪힐 때가 됐는데요.', false], ['시간은 가는데 체력은 그대로예요.', false],
      ['생각보다 오래 안 맞고 있습니다.', false], ['아직도 첫 유효타가 안 나왔어요.', true],
      ['조금 긴 침묵이네요.', false], ['이대로 시간만 보낼 순 없죠.', false],
      ['슬슬 누군가는 먼저 들어가야 합니다.', false], ['경기장이 넓어 보이기 시작하는데요.', false],
      ['묘하게 서로 안 만납니다.', false], ['한 번만 제대로 걸리면 분위기가 바뀔 텐데요.', false]],
    [['음... 아직도 안 맞았습니다.', false], ['저기요, 경기 중입니다.', false],
      ['서로 굉장히 건강합니다.', true], ['체력바가 너무 평화로운데요.', false],
      ['오늘 경기장 상태가 아주 쾌적합니다.', false], ['아직 치료가 필요할 선수는 없겠습니다.', true],
      ['공들은 바쁜데 체력은 한가합니다.', false], ['잘 튕기고는 있는데... 아직 그게 다예요.', false],
      ['슬슬 뭔가 일어나도 좋겠습니다.', false], ['선인장 입장에서는 할 말이 조금 줄어드는데요.', false],
      ['이렇게 오래 멀쩡할 줄은 몰랐습니다.', true], ['아직 누구도 상대 체력바에 손을 못 댔어요.', true],
      ['굉장히 평화로운 전투가 이어지고 있습니다.', false], ['전투 맞죠? 일단 계속 지켜보겠습니다.', false],
      ['먼저 맞는 쪽이 조금 민망해질 타이밍입니다.', true]],
  ];
  const quietLines = (tier, noHitYet) => QUIET[tier].filter(([, first]) => noHitYet || !first).map(([text]) => text);

  class Director {
    constructor({ weapons = {}, characters = {}, battleTime = 40 } = {}) {
      this.weapons = weapons;
      this.characters = characters;
      this.battleTime = finite(battleTime, 40);
      this.battles = new Map();
      this.objectKeys = new WeakMap();
      this.nextKey = 0;
      this.activeKey = null;
      this.lastSpoken = -Infinity;
      this.current = null;                            // 지금 말풍선: { priority, until }
      this.lastGeneral = { kind: null, at: -Infinity };
      this.finishedMatches = new Set();
    }

    battleKey(battle) {
      if (battle.soundId != null) return String(battle.soundSource || 'local') + ':' + battle.soundId;
      if (!this.objectKeys.has(battle)) this.objectKeys.set(battle, 'object:' + (++this.nextKey));
      return this.objectKeys.get(battle);
    }

    line(kind, priority, fighter, text, label, gg = false) {
      return { kind, priority, actor: actorOf(fighter), text, label, gg };
    }

    // 실제로 말한 대사만 말풍선 시계와 같은 종류 제한을 움직인다.
    speak(line, now) {
      this.lastSpoken = now;
      this.current = { kind: line.kind, priority: line.priority, until: now + displayMs(line.text, line.gg) };
      if (line.priority < IMPORTANT) this.lastGeneral = { kind: line.kind, at: now };
      return line;
    }

    // Authoritative match decision, not just the winner of one battle.
    decideMatch(champion, nowMilliseconds, matchKey) {
      if (!champion || champion.id == null || matchKey == null || this.finishedMatches.has(matchKey)) return null;
      this.finishedMatches.add(matchKey);
      if (this.finishedMatches.size > 64) this.finishedMatches.delete(this.finishedMatches.values().next().value);
      return this.speak(this.line('gg', 100, champion,
        pick(LINES.gg(nameOf(champion.name)), spin(champion.id + ':' + champion.name)), '최종 승부', true),
      finite(nowMilliseconds));
    }

    // Result-screen fallback for reconnects, old servers or offscreen fast-sim.
    finishMatch(players, nowMilliseconds, matchKey = players) {
      if (!Array.isArray(players) || !players.length || matchKey == null) return null;
      const ranks = new Set(players.map(player => player && player.rank));
      if (ranks.size !== players.length || players.some(player => !player ||
        !Number.isInteger(player.rank) || player.rank < 1 || player.rank > players.length)) return null;
      const champion = players.find(player => player.rank === 1);
      return this.decideMatch({ ...champion, id: champion.id ?? champion.uid ?? 0 }, nowMilliseconds, matchKey);
    }

    lead(battle) {
      const alive = (battle.fighters || []).filter(f => !f.dead && !f.mainDead && f.hp > 0)
        .map(f => ({ fighter: f, ratio: ratio(f) })).sort((a, b) => b.ratio - a.ratio);
      return alive.length > 1 ? { fighter: alive[0].fighter, gap: alive[0].ratio - alive[1].ratio }
        : { fighter: null, gap: 0 };
    }

    baseline(battle, state, events, time) {
      for (const event of events) state.seq = Math.max(state.seq, finite(event.seq));
      state.simT = Math.max(state.simT, time);
      state.hits.clear();
      const gap = this.lead(battle).gap;
      state.leadArmed = gap <= .2;
      state.bigLeadArmed = gap <= .45;
      // A finished battle discovered by switching is not a newly witnessed finish.
      if (battle.result) state.resultDone = true;
      // 전환해 들어온 경기의 지난 일은 새로 본 일이 아니다
      for (const f of battle.fighters || []) if (f.dead) state.downs.add(f.uid);
      state.lastHitT = time;
      state.anyHit = state.anyHit || time > .5;
      state.releases.clear(); state.closeSince.clear(); state.pending = null;
      if (time >= this.battleTime - TIME_WARNING) state.timeDone = true;
    }

    skillName(source) {
      const [category, id] = source.split(':');
      const def = entry(category === 'char' ? this.characters : this.weapons, id);
      return def && def.skillName ? String(def.skillName) : '스킬';
    }

    roundEnd(battle, state, now) {
      state.resultDone = true;
      state.pending = null;
      for (const event of battle.commentaryEvents || []) state.seq = Math.max(state.seq, finite(event.seq));
      const winner = battle.result.winner;
      const fighter = winner && typeof winner === 'object' ? winner
        : (battle.fighters || []).find(f => f.uid === winner) || null;
      const turn = spin(state.seq + ':' + finite(fighter && fighter.uid));
      let text, label = '라운드 종료';
      if (battle.result.draw) text = pick(LINES.draw(), turn);
      else if (!fighter) text = pick(LINES.roundOver(), turn);
      else {
        const who = nameOf(fighter.name);
        const judged = battle.result.reason === '체력 비율 판정';
        const rival = Math.max(0, ...(battle.fighters || []).filter(f => f !== fighter && !f.dead).map(ratio));
        const close = judged ? ratio(fighter) - rival <= .1 : ratio(fighter) <= .25;
        text = pick(judged ? LINES.roundJudge(who) : close ? LINES.roundClose(who) : LINES.roundWin(who), turn);
        if (judged) label = '판정';
      }
      return this.speak(this.line('round-end', 90, fighter, text, label), now);
    }

    observe(battle, nowMilliseconds) {
      // 솔로 로그라이크 웨이브는 따로 본다 (라이벌 관계·챔피언 소개·기믹 중계)
      if (battle && battle.rogueWave && !battle.demo) return this.observeRogue(battle, nowMilliseconds);
      return this.observeCombat(battle, nowMilliseconds, null);
    }

    /* 전투 중계. rogue가 넘어오면(로그라이크 라이벌전) 소개와 결과는 로그라이크 쪽이 맡고,
     * rogue.extra가 기믹·소개 후보를 더한다. PvP는 rogue 없이 예전 그대로 돈다. */
    observeCombat(battle, nowMilliseconds, rogue) {
      if (!battle || battle.demo) { this.activeKey = null; return null; }
      const now = finite(nowMilliseconds);
      const time = finite(battle.simT);
      const events = Array.isArray(battle.commentaryEvents) ? battle.commentaryEvents : [];
      const key = this.battleKey(battle);
      let state = this.battles.get(key);
      const fresh = !state;
      if (fresh) {
        state = { seq: 0, simT: -Infinity, phase: battle.phase, introDone: false,
          resultDone: false, hits: new Map(), sourceTimes: new Map(), leadArmed: true, bigLeadArmed: true,
          firstHitDone: false, anyHit: false, lastHitT: 0, quietSaid: 0, quietNext: 0,
          leaderUid: null, lowArmed: new Set(), veryLowArmed: new Set(), downs: new Set(),
          releases: new Map(), closeSince: new Map(), timeDone: false, pending: null };
        this.battles.set(key, state);
        // A normal session is much smaller; keep spectator/reconnect history bounded.
        if (this.battles.size > 64) this.battles.delete(this.battles.keys().next().value);
      }
      const switched = this.activeKey !== key;
      this.activeKey = key;
      if (time + .001 < state.simT) return null; // A late snapshot cannot rewind the director.
      const starting = battle.phase === 'fight' && !state.introDone &&
        ((state.phase === 'count' && !fresh) || (fresh && time <= .15));
      if (switched) {
        this.baseline(battle, state, events, time);
        if (!starting && battle.phase !== 'count') state.introDone = true;
      }

      state.simT = Math.max(state.simT, time);
      state.phase = battle.phase;
      if (battle.result && !state.resultDone) {
        if (rogue) { state.resultDone = true; return null; }
        return this.roundEnd(battle, state, now);
      }
      if (battle.phase !== 'fight' || battle.result) return null;

      const candidates = [];
      const add = (kind, priority, fighter, text, label, extra = {}) =>
        candidates.push({ ...this.line(kind, priority, fighter, text, label), ...extra });
      const roster = battle.fighters || [];
      const fighters = new Map(roster.map(f => [f.uid, f]));

      if (starting && rogue) { state.introDone = true; state.lastHitT = time; }
      if (starting && !rogue) {
        state.introDone = true;
        state.lastHitT = time;
        const active = roster.filter(f => !f.dead);
        const streak = active.find(f => finite(f.player && f.player.streak) >= 2);
        const built = active.find(f => f.player && Array.isArray(f.player.augments) && f.player.augments.length >= 5);
        let fighter = streak || active[0];
        if (fighter) {
          const weaponName = f => { const w = entry(this.weapons, f.weaponId); return w ? w.name : '무기'; };
          const who = nameOf(fighter.name);
          const turn = spin(finite(fighter.uid) + ':' + who + ':'
            + finite(fighter.player && fighter.player.rounds) + ':' + finite(battle.soundId));
          let text;
          if (streak) text = pick(LINES.streak(who, Math.floor(fighter.player.streak)), turn);
          else if (built && turn % 3 === 0) {
            fighter = built;
            text = pick(LINES.build(nameOf(built.name), built.player.augments.length), turn);
          } else if (active.length === 2) {
            const [a, b] = active;
            text = pick([...LINES.intro(who, weaponName(fighter)),
              ...LINES.duel(nameOf(a.name), weaponName(a), nameOf(b.name), weaponName(b))], turn);
          } else text = pick(LINES.intro(who, weaponName(fighter)), turn);
          // '모두 준비 완료' 같은 말에는 특정 선수 이름표를 달지 않는다
          add('intro', IMPORTANT, Array.from(fighters.values()).some(f => text.includes(nameOf(f.name))) ? fighter : null, text, 'ON AIR');
        }
      }

      // Duplicate entries can share the same seq; sort a copy, never mutate snapshots.
      const incoming = events.filter(event => finite(event.seq) > state.seq)
        .slice().sort((a, b) => a.seq - b.seq);
      for (const event of incoming) {
        if (event.seq <= state.seq) continue;
        const eventTime = finite(event.t, -Infinity);
        // Interpolation uses the newest packet's events with a slightly older
        // presentation clock. Keep a future fact pending until that clock catches
        // up; consuming its seq here would permanently lose a confirmed hit.
        if (eventTime > time + .05) break;
        state.seq = Math.max(state.seq, finite(event.seq));
        if (event.type === 'release' && event.source === 'skill:bow') { state.releases.set(event.actor, eventTime); continue; }
        if (time - eventTime > EVENT_MAX_AGE) continue;
        const fighter = fighters.get(event.actor);
        if (!fighter) continue;
        const source = typeof event.source === 'string' ? event.source : '';
        const name = nameOf(fighter.name);
        const turn = spin(event.seq + ':' + source + ':' + event.type);
        const every = (id, ms) => ({ cooldownKey: id, cooldownMs: ms });
        if (event.type === 'skill') {
          // Charge, dash and detonation acceptance do not prove an impact.
          if (UTILITY_SKILLS.has(source)) add('skill-use', 44, fighter,
            pick(LINES.skillUse(name, this.skillName(source)), turn), '스킬 발동', every('use:' + event.actor + ':' + source, 8000));
          continue;
        }
        if (event.type === 'last-stand') {
          add('last-stand', 84, fighter, pick(source === 'augment:lastStand' ? LINES.finalSeconds(name) : LINES.lastStand(name), turn), '마지막 저항');
          continue;
        }
        if (event.type === 'split') { add('split', 84, fighter, pick(LINES.split(name), turn), '분열'); continue; }
        if (event.type === 'guard') { add('guard', 52, fighter, pick(LINES.guard(name), turn), '방어', every('guard:' + event.actor, 8000)); continue; }
        if (event.type === 'dodge') { add('dodge', 50, fighter, pick(LINES.dodge(name), turn), '회피', every('dodge:' + event.actor, 8000)); continue; }
        if (event.type === 'wall-hit') { add('wall-hit', 54, fighter, pick(LINES.wallHit(name), turn), '벽 활용', every('wall:' + event.actor, 10000)); continue; }
        if (event.type !== 'hit' || !(event.amount > 0) || !fighters.has(event.target) || event.target === event.actor) continue;
        const target = fighters.get(event.target);
        state.lastHitT = Math.max(state.lastHitT, eventTime);
        state.anyHit = true;
        state.quietSaid = 0;
        if (source === 'skill:bow') state.releases.delete(event.actor);
        const sourceKey = event.actor + ':' + source;
        const skillHit = source.startsWith('skill:') || source === 'char:bomb' || source === 'char:bball';
        if (skillHit) add('skill-hit', 80, fighter, pick(LINES.skillHit(name, this.skillName(source)), turn), '스킬 적중', every('skill-hit:' + event.actor, 10000));
        if (Object.prototype.hasOwnProperty.call(SPECIALS, source)) {
          add('special-hit', 70, fighter, pick(LINES[SPECIALS[source]](), turn), '특수 공격', every(sourceKey, 8000));
        } else if (SUMMON.has(source)) add('summon-hit', 43, fighter, pick(LINES.summonHit(), turn), '소환수', every('summon:' + event.actor, 10000));
        else if (AUTO.has(source)) add('auto-hit', 42, fighter, pick(LINES.autoHit(), turn), '자동 공격', every('auto:' + event.actor, 10000));
        else if (source === 'dot:flame' || source === 'dot:bleed') {
          add('dot-hit', 41, fighter, pick(source === 'dot:flame' ? LINES.dotFlame() : LINES.dotBleed(), turn), '지속 피해', every('dot:' + event.actor, 10000));
        }
        // Periodic damage, summons and passive systems must not look like a weapon combo.
        if (!source.startsWith('weapon:') && !source.startsWith('skill:')) continue;
        // 오늘의 첫 유효타. 지속 피해나 소환수가 아니라 직접 때린 것만 센다.
        if (!state.firstHitDone) {
          state.firstHitDone = true;
          add('first-blood', 58, fighter, pick(LINES.firstBlood(name), spin(event.seq + name)), '선제 타격');
        }
        const share = event.amount / Math.max(1, finite(target.maxHp, 1));
        if (share >= BIG_BLOW) add('big-blow', 78, fighter, pick(LINES.bigBlow(name, nameOf(target.name)), turn), '큰 한 방', every('big:' + event.actor, 5000));
        else if (share >= HEAVY_HIT) add('heavy-hit', 45, fighter, pick(LINES.heavyHit(), turn), '적중');
        else add('hit', 40, fighter, pick(LINES.hit(), turn), '적중');
        const pair = event.actor + '>' + event.target;
        let hits = (state.hits.get(pair) || []).filter(t => eventTime - t <= COMBO_WINDOW);
        if (!hits.length || eventTime - hits[hits.length - 1] >= .08 - 1e-6) hits.push(eventTime);
        state.hits.set(pair, hits);
        if (hits.length >= 3) {
          state.hits.set(pair, []);
          add('combo', 56, fighter, pick(LINES.combo(name), spin(event.seq + pair)), '연속 적중', every('combo:' + pair, 8000));
        }
      }
      // 차지 샷을 쏘고도 맞지 않았다
      for (const [uid, at] of state.releases) {
        if (time - at < CHARGE_MISS_T) continue;
        state.releases.delete(uid);
        const f = fighters.get(uid);
        if (f && !f.dead && time - at <= CHARGE_MISS_T + EVENT_MAX_AGE) {
          add('charge-miss', 50, f, pick(LINES.chargeMiss(), spin(uid + ':' + at)), '빗나감');
        }
      }
      // 탈락 — 여럿이 싸우는 판에서만. 1대1은 곧바로 라운드 결과가 말한다.
      for (const f of roster) {
        if (!f.dead || state.downs.has(f.uid)) continue;
        state.downs.add(f.uid);
        if (roster.length > 2) add('knockout', 85, f, pick(LINES.knockout(nameOf(f.name)), spin(state.seq + ':' + f.uid)), '탈락');
      }
      // 남은 시간 — 제한시간이 없는 전투(로그라이크)에는 없다
      if (!battle.noTimeLimit && !state.timeDone && time >= this.battleTime - TIME_WARNING) {
        add('time', 66, null, pick(LINES.timeLeft(), spin(key + ':time')), '남은 시간',
          { onSpoken: () => { state.timeDone = true; } });
      }
      /* 위기 — 체력이 25% 밑으로 떨어진 순간. 한 번 알린 선수는 35% 위로
       * 회복해야 다시 알린다. 10% 밑은 한 단계 더 다급하게. */
      for (const f of roster) {
        if (f.dead || f.mainDead) { state.lowArmed.delete(f.uid); state.veryLowArmed.delete(f.uid); continue; }
        const r = ratio(f);
        if (r > .35) state.lowArmed.delete(f.uid);
        if (r > .2) state.veryLowArmed.delete(f.uid);
        if (r > 0 && r <= .1 && !state.veryLowArmed.has(f.uid)) {
          state.veryLowArmed.add(f.uid); state.lowArmed.add(f.uid);
          add('very-low', 51, f, pick(LINES.veryLow(), spin(state.seq + ':' + f.uid)), '위기');
        } else if (r > 0 && r <= .25 && !state.lowArmed.has(f.uid)) {
          state.lowArmed.add(f.uid);
          add('low-hp', 49, f, pick(LINES.lowHp(nameOf(f.name)), spin(state.seq + ':' + f.uid)), '위기');
        }
      }
      const lead = this.lead(battle);
      /* 역전 — 앞서던 선수가 바뀌었다. 첫 관측은 기준만 잡고 넘어간다.
       * 체력이 붙어 있을 때 엎치락뒤치락하는 것까지 역전이라 부르지는 않는다. */
      if (lead.fighter) {
        const uid = lead.fighter.uid;
        if (state.leaderUid == null) state.leaderUid = uid;
        else if (state.leaderUid !== uid) {
          state.leaderUid = uid;
          if (time >= 4 && lead.gap >= .12) add('comeback', 75, lead.fighter,
            pick(LINES.comeback(nameOf(lead.fighter.name)), spin(state.seq + ':' + uid)), '역전');
        }
      }
      if (lead.gap <= .2) state.leadArmed = true;
      if (lead.gap <= .45) state.bigLeadArmed = true;
      if (time >= 3 && lead.fighter) {
        const who = nameOf(lead.fighter.name), turn = spin(state.seq + ':' + lead.fighter.uid);
        if (lead.gap >= .6 && state.bigLeadArmed) {
          state.bigLeadArmed = false; state.leadArmed = false;
          add('big-lead', 47, lead.fighter, pick(LINES.bigLead(who), turn), '큰 격차');
        } else if (lead.gap >= .35 && state.leadArmed) {
          state.leadArmed = false;
          add('lead', 46, lead.fighter, pick(LINES.lead(who), turn), '체력 우세');
        }
      }
      // 근접전 — 두 공이 CLOSE_HOLD초 넘게 붙어 있다
      const bodies = roster.filter(f => !f.dead && !f.mainDead && Number.isFinite(f.x) && Number.isFinite(f.y));
      const touching = new Set();
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - finite(a.radius, 22) - finite(b.radius, 22);
        if (gap > CLOSE_GAP) continue;
        const pair = a.uid + '~' + b.uid;
        touching.add(pair);
        if (!state.closeSince.has(pair)) state.closeSince.set(pair, time);
        else if (time - state.closeSince.get(pair) >= CLOSE_HOLD) {
          add('close', 43, a, pick(LINES.close(nameOf(a.name), nameOf(b.name)), spin(pair + ':' + Math.floor(state.closeSince.get(pair)))),
            '근접전', { cooldownKey: 'close:' + pair, cooldownMs: 12000 });
        }
      }
      for (const pair of state.closeSince.keys()) if (!touching.has(pair)) state.closeSince.delete(pair);
      // 소강 — 한동안 아무도 못 맞혔다
      const quietFor = time - state.lastHitT;
      const tier = quietFor >= QUIET_STEPS[2] ? 3 : quietFor >= QUIET_STEPS[1] ? 2 : quietFor >= QUIET_STEPS[0] ? 1 : 0;
      if (tier && (tier > state.quietSaid || (tier === 3 && quietFor >= state.quietNext))) {
        add('quiet', 30, null, pick(quietLines(tier, !state.anyHit), spin(key + ':' + tier + ':' + Math.floor(quietFor))),
          '탐색전', { onSpoken: () => { state.quietSaid = tier; state.quietNext = quietFor + QUIET_REPEAT; } });
      }
      for (const [pair, hits] of state.hits) {
        const recent = hits.filter(t => time - t <= COMBO_WINDOW);
        if (recent.length) state.hits.set(pair, recent); else state.hits.delete(pair);
      }

      if (rogue && rogue.extra) rogue.extra(add, time);
      return this.choose(state, candidates, now);
    }

    /* 후보 중 하나를 고른다. 중요 해설은 끼어들고, 일반 해설은 틈을 기다린다. */
    choose(state, candidates, now) {
      // 말할 틈을 기다리던 중요 해설
      if (state.pending) {
        if (now <= state.pending.expires) candidates.push(state.pending);
        state.pending = null;
      }
      const ready = candidates.filter(c => !c.cooldownKey
        || now - (state.sourceTimes.get(c.cooldownKey) ?? -Infinity) >= c.cooldownMs)
        .sort((a, b) => b.priority - a.priority);
      if (!ready.length) return null;
      const cur = this.current;
      let chosen = null;
      if (ready[0].priority >= IMPORTANT) {
        const top = ready[0];
        /* 일반 해설 중이면, 이게 더 중요하면, 같은 급의 다른 일이고 앞 대사를 충분히 보여 줬으면
         * 바로 나온다. 같은 종류(스킬 적중이 연달아)나 덜 중요한 일은 앞 말풍선이 끝나기를
         * PENDING_MS까지만 기다리고, 그래도 안 되면 버린다 — 몰아치는 순간에 떠들지 않게. */
        if (!cur || cur.priority < IMPORTANT || now >= cur.until || top.priority > cur.priority
          || (top.kind !== cur.kind && top.priority === cur.priority && now - this.lastSpoken >= MIN_SHOW_MS)) chosen = top;
        else { state.pending = { ...top, expires: top.expires ?? now + PENDING_MS }; return null; }
      } else {
        if (cur && now < cur.until + GENERAL_GAP_MS) return null;
        // Dropped facts are not queued; a repeated kind waits for a different one.
        chosen = ready.find(c => c.kind !== this.lastGeneral.kind || now - this.lastGeneral.at >= SAME_KIND_MS);
        if (!chosen) return null;
      }
      const { cooldownKey, cooldownMs, onSpoken, expires, ...line } = chosen;
      // The per-source cooldown begins only for the line we select.
      if (cooldownKey) state.sourceTimes.set(cooldownKey, now);
      if (onSpoken) onSpoken();
      return this.speak(line, now);
    }

    /* ═══════════ 솔로 로그라이크 ═══════════
     * 해설자는 추측하지 않는다 — 전투가 남긴 rogueEvents(기믹이 실제로 일어난 순간)만 읽는다.
     * 우선순위: 이번 런에서 처음 본 기믹 > 강한 위험 > 특이한 결과 > 평범한 반복.
     * 평범한 반복은 한두 번 말한 뒤 한동안 침묵한다. 몬스터를 때릴 때마다의 적중 해설은 하지 않는다. */
    rogueRunMemory(runId) {
      const key = String(runId || 'run');
      if (!this.rogueRuns) this.rogueRuns = new Map();
      let mem = this.rogueRuns.get(key);
      if (!mem) {
        mem = { seen: new Set(), again: new Map() };
        this.rogueRuns.set(key, mem);
        if (this.rogueRuns.size > 8) this.rogueRuns.delete(this.rogueRuns.keys().next().value);
      }
      return mem;
    }
    rogueState(battle) {
      const key = this.battleKey(battle) + ':rogue';
      let rs = this.battles.get(key);
      if (!rs) {
        rs = { rseq: 0, seq: 0, introBuilt: false, intro: [], introAt: 0, endDone: false, follow: [],
          sourceTimes: new Map(), pending: null, lowArmed: new Set(), veryLowArmed: new Set(), once: new Set() };
        this.battles.set(key, rs);
        if (this.battles.size > 64) this.battles.delete(this.battles.keys().next().value);
      }
      return rs;
    }
    rogueIntro(battle) {
      const info = battle.rogueWave;
      const seed = spin(info.runId + ':' + info.n);
      const take = (list, n) => {
        const out = [];
        for (let i = 0; out.length < Math.min(n, list.length) && i < list.length * 3; i++) {
          const line = pick(list, seed + i * 7);
          if (!out.includes(line)) out.push(line);
        }
        return out;
      };
      const events = battle.rogueEvents || [];
      const has = type => events.some(e => e.type === type);
      if (info.kind === 'rival') {
        const rival = nameOf(info.rivalName);
        const L = ROGUE_LINES.rival(rival);
        if (has('RIVAL_APPEAR_1') || info.meet === 1) return take(L.first, 2);
        if (has('RIVAL_APPEAR_2') || info.meet === 2) return [L.second[0]].concat(take(L.second.slice(1), 1));
        if (has('RIVAL_APPEAR_3') || info.meet === 3) {
          const lines = [pick(L.third.slice(0, 1).concat(L.third.slice(2)), seed), L.third[1]];
          if (info.rivalAugments >= 16) lines.push(pick(L.armed, seed));
          return lines;
        }
        return [pick(L.final.slice(0, 2), seed), pick(L.final.slice(2, 4), seed + 1), L.final[4]];
      }
      if (info.kind === 'boss') {
        // 소개는 짧게 — 보스는 곧 첫 예고를 시작하고, 그 순간은 기믹 해설이 맡는다
        const B = info.boss === 'former' ? ROGUE_LINES.formerIntro : ROGUE_LINES.currentIntro;
        return info.boss === 'former' ? [B[0], B[1], pick(B.slice(2), seed)]
          : [pick(B.slice(0, 2), seed), B[2], pick(B.slice(3, 5), seed + 1), B[5]];
      }
      if (info.kind === 'choice') return [pick(ROGUE_LINES.choice[info.tier] || ROGUE_LINES.choice.normal, seed)];
      if (info.n === 2) return [ROGUE_LINES.firstMonsters];
      return [pick(info.late ? ROGUE_LINES.late : ROGUE_LINES.wave(info.n), seed)];
    }
    rogueEnd(battle, now) {
      const info = battle.rogueWave, r = battle.result;
      const hero = battle.rogueHero;
      const won = r && r.winner === hero;
      const who = nameOf(hero && hero.name);
      const turn = spin(info.runId + ':end:' + info.n);
      let text, label = won ? '웨이브 클리어' : '런 종료';
      if (won) {
        if (info.kind === 'rival') text = pick(ROGUE_LINES.rivalWin(who, nameOf(info.rivalName))[info.meet - 1], turn);
        else if (info.kind === 'boss') text = pick(info.boss === 'former' ? ROGUE_LINES.formerDown : ROGUE_LINES.currentDown, turn);
        else if (info.kind === 'choice' && info.tier === 'strong') text = pick(ROGUE_LINES.strongWin, turn);
        else text = pick(ROGUE_LINES.waveWin(info.n), turn);
        if (info.kind === 'boss') label = '보스 격파';
        // 첫 만남에서는 아직 '라이벌'이라 부르지 않는다
        if (info.kind === 'rival') label = info.meet === 1 ? '첫 대결' : '라이벌전';
      } else {
        text = info.kind === 'rival' ? pick(ROGUE_LINES.rivalLose(nameOf(info.rivalName)), turn)
          : info.kind === 'boss' ? pick(ROGUE_LINES.bossLose, turn) : pick(ROGUE_LINES.lose(who), turn);
      }
      return this.speak(this.line('rg-end', 95, won ? hero : null, text, label), now);
    }
    rogueFinale(player, nowMilliseconds) {
      const who = nameOf(player && player.name);
      return this.speak(this.line('gg', 100, { uid: 0, name: who, color: player && player.color },
        pick(ROGUE_LINES.finale(who), spin(who + ':finale')), '새 챔피언', true), finite(nowMilliseconds));
    }
    /* 기믹 이벤트 → 후보. first는 런에서 처음 본 순간, 이후는 tier에 따라 강도가 다르다. */
    rogueEventCandidates(battle, rs, mem, add, time) {
      const events = (battle.rogueEvents || []).filter(e => finite(e.seq) > rs.rseq).slice().sort((a, b) => a.seq - b.seq);
      const fighters = new Map((battle.fighters || []).map(f => [f.uid, f]));
      for (const e of events) {
        const et = finite(e.t, -Infinity);
        if (et > time + .05) break;
        rs.rseq = Math.max(rs.rseq, finite(e.seq));
        if (time - et > EVENT_MAX_AGE + 0.5) continue;
        const spec = ROGUE_EVENT_LINES[e.type];
        if (!spec) continue;
        const actor = fighters.get(e.actor) || null;
        const turn = spin(e.seq + ':' + e.type);
        const label = spec.label || '중계';
        const kind = 'rg-' + e.type;
        if (spec.once) {
          if (rs.once.has(e.type)) continue;
          add(kind, spec.priority || 70, null, pick(spec.lines(e, actor), turn), label, { onSpoken: () => rs.once.add(e.type) });
          continue;
        }
        const first = !mem.seen.has(e.type);
        if (first) {
          if (!spec.first) { mem.seen.add(e.type); continue; }
          const lines = spec.first(e, actor);
          add(kind, 90, null, pick(lines, turn), label, {
            onSpoken: () => {
              mem.seen.add(e.type);
              if (spec.follow) rs.follow.push({ kind: kind + '-tip', text: pick(spec.follow, turn), label });
            },
          });
          continue;
        }
        const count = mem.again.get(e.type) || 0;
        if (spec.tier === 'routine' && count >= (spec.max ?? 1)) continue;
        const priority = spec.tier === 'danger' ? 64 : spec.tier === 'result' ? 55 : 38;
        add(kind, priority, null, pick(spec.again(e, actor), turn), label, {
          cooldownKey: 'rg:' + e.type, cooldownMs: spec.cd || 25000,
          onSpoken: () => mem.again.set(e.type, count + 1),
        });
      }
    }
    /* 몬스터 웨이브의 전투 사실은 나(영웅)에 관한 것만 고른다: 내 스킬 적중, 내가 크게 맞음, 내 위기. */
    rogueHeroFacts(battle, rs, add, time) {
      const hero = battle.rogueHero;
      if (!hero) return;
      const who = nameOf(hero.name);
      const events = (battle.commentaryEvents || []).filter(e => finite(e.seq) > rs.seq).slice().sort((a, b) => a.seq - b.seq);
      for (const e of events) {
        const et = finite(e.t, -Infinity);
        if (et > time + .05) break;
        rs.seq = Math.max(rs.seq, finite(e.seq));
        if (time - et > EVENT_MAX_AGE) continue;
        const source = typeof e.source === 'string' ? e.source : '';
        const turn = spin(e.seq + ':' + source);
        if (e.actor === hero.uid && (e.type === 'last-stand' || e.type === 'split')) {
          add('last-stand', 84, hero, pick(e.type === 'split' ? LINES.split(who) : LINES.lastStand(who), turn), '버티기');
          continue;
        }
        if (e.type !== 'hit' || !(e.amount > 0)) continue;
        if (e.actor === hero.uid) {
          const skillHit = source.startsWith('skill:') || source === 'char:bomb' || source === 'char:bball';
          if (skillHit) add('skill-hit', 80, hero, pick(LINES.skillHit(who, this.skillName(source)), turn), '스킬 적중',
            { cooldownKey: 'skill-hit:' + hero.uid, cooldownMs: 12000 });
          else if (Object.prototype.hasOwnProperty.call(SPECIALS, source)) add('special-hit', 58, hero, pick(LINES[SPECIALS[source]](), turn), '특수 공격',
            { cooldownKey: 'special:' + source, cooldownMs: 15000 });
        } else if (e.target === hero.uid) {
          const share = e.amount / Math.max(1, finite(hero.maxHp, 1));
          if (share >= BIG_BLOW * 0.8) add('big-blow', 78, hero, pick(ROGUE_LINES.bigHit, turn), '큰 한 방', { cooldownKey: 'big-in', cooldownMs: 8000 });
        }
      }
      for (const f of [hero].concat(hero.splitBalls || [])) {
        if (f.dead || f.mainDead) { rs.lowArmed.delete(f.uid); rs.veryLowArmed.delete(f.uid); continue; }
        const r = ratio(f);
        if (r > .35) rs.lowArmed.delete(f.uid);
        if (r > .2) rs.veryLowArmed.delete(f.uid);
        if (r > 0 && r <= .1 && !rs.veryLowArmed.has(f.uid)) {
          rs.veryLowArmed.add(f.uid); rs.lowArmed.add(f.uid);
          add('very-low', 62, f, pick(LINES.veryLow(), spin(rs.seq + ':' + f.uid)), '위기');
        } else if (r > 0 && r <= .25 && !rs.lowArmed.has(f.uid)) {
          rs.lowArmed.add(f.uid);
          add('low-hp', 60, f, pick(LINES.lowHp(nameOf(f.name)), spin(rs.seq + ':' + f.uid)), '위기');
        }
      }
    }
    observeRogue(battle, nowMilliseconds) {
      const now = finite(nowMilliseconds);
      const info = battle.rogueWave;
      const rs = this.rogueState(battle);
      const mem = this.rogueRunMemory(info.runId);
      const time = finite(battle.simT);
      this.activeKey = this.battleKey(battle);
      if (battle.result) {
        if (!rs.endDone) { rs.endDone = true; rs.intro = []; rs.follow = []; return this.rogueEnd(battle, now); }
        return null;
      }
      // 소개 — 카운트다운부터 이어서 한 줄씩. 처음 보는 기믹이 끼어들면 그 뒤에 잇는다.
      if (!rs.introBuilt) { rs.introBuilt = true; rs.intro = this.rogueIntro(battle); rs.introAt = now + 200; }
      const cur = this.current;
      const free = !cur || now >= cur.until + 250;
      if (rs.follow.length && free) {
        const tip = rs.follow.shift();
        return this.speak(this.line(tip.kind, 88, null, tip.text, tip.label), now);
      }
      // 싸움이 한창인데 소개가 남아 있으면 버린다 (늦게 나온 소개는 지금 일과 어긋난다)
      if (rs.intro.length && battle.phase === 'fight' && time > 8) rs.intro = [];
      if (rs.intro.length && now >= rs.introAt && free) {
        const text = rs.intro.shift();
        rs.introAt = now + displayMs(text) + 350;
        const who = info.kind === 'rival' ? (battle.fighters || []).find(f => f.rival) : null;
        return this.speak(this.line('rg-intro', 88, who && text.includes(nameOf(who.name)) ? who : null, text,
          info.kind === 'boss' ? (info.boss === 'former' ? '전 챔피언' : '현 챔피언')
            : info.kind === 'rival' ? (info.meet === 1 ? '첫 대결' : '라이벌') : 'ON AIR'), now);
      }
      if (battle.phase !== 'fight') return null;
      const extra = add => this.rogueEventCandidates(battle, rs, mem, (kind, p, fighter, text, label, more = {}) => add(kind, p, fighter, text, label, more), time);
      if (info.kind === 'rival') {
        // 라이벌전은 1대1이다. 아레나 중계를 그대로 쓰고 기믹·소개만 로그라이크가 더한다.
        return this.observeCombat(battle, now, { extra: (add) => extra(add) });
      }
      const candidates = [];
      const add = (kind, priority, fighter, text, label, more = {}) => candidates.push({ ...this.line(kind, priority, fighter, text, label), ...more });
      extra(add);
      this.rogueHeroFacts(battle, rs, add, time);
      return this.choose(rs, candidates, now);
    }
  }

  /* ---------------- 로그라이크 대사 사전 (기획서 18~21절의 예시를 그대로 담았다) ---------------- */
  const ROGUE_LINES = {
    rival: n => ({
      first: ['신예 두 명이 여기서 붙는군요.', '둘 다 이제 막 올라오기 시작한 선수들입니다.', '첫 대결입니다. 누가 먼저 앞서갈까요.', '새 얼굴끼리 만났네요.'],
      second: [`${n} 선수, 아직 아레나에 남아 있었습니다.`, '다시 만났네요.', '복수전의 시간인가요?', '첫 경기를 기억하고 있을 겁니다.', '둘 다 여기까지 올라왔군요.'],
      third: ['또 만났습니다.', '이쯤 되면 라이벌이라고 불러야겠네요.', '서로 참 오래 살아남았습니다.', `${n} 선수도 많이 달라졌습니다.`, '세 번째 대결입니다. 이제 서로를 잘 알겠죠.'],
      armed: [`${n} 선수, 이번엔 무장이 상당합니다.`, '지난번과 같은 상대라고 생각하면 곤란하겠습니다.'],
      final: ['결국 둘 다 여기까지 왔습니다.', '네 번째 대결. 아마 마지막이겠죠.', '챔피언에게 가기 전에 넘어야 할 상대가 있습니다.', `${n} 선수와의 마지막 승부입니다.`, '한쪽만 챔피언에게 도전할 수 있습니다.'],
    }),
    formerIntro: ['상대가 심상치 않습니다.', '한때 이 아레나의 정상에 있었던 선수입니다.', '세월은 흘렀지만 저 해머는 여전합니다.', '예전에는 저 한 방으로 수많은 선수들이 쓰러졌죠.'],
    currentIntro: ['여기까지 왔군요.', '이제 남은 상대는 단 한 명입니다.', '현재 아레나의 챔피언.', '지금까지 본 선수들과는 움직임부터 다릅니다.', '속도와 마법을 동시에 다루는 선수입니다.', '챔피언전, 시작합니다.'],
    firstMonsters: '첫 몬스터전입니다. 모두 쓰러뜨리면 끝나요.',
    wave: n => [`웨이브 ${n}, 시작합니다.`, '몬스터들이 몰려옵니다.', `${n}번째 웨이브입니다. 하나씩 정리하죠.`, '조합을 먼저 보세요. 누구부터 칠지가 중요합니다.'],
    late: ['후반입니다. 기믹이 한꺼번에 작동합니다.', '이제부터는 조합이 무섭습니다.', '여기서부터가 진짜 고비예요.'],
    choice: {
      weak: ['안전한 쪽을 골랐습니다. 착실하게 가죠.', '약한 적입니다. 기본기를 챙기는 선택이에요.'],
      normal: ['무난한 선택입니다. 증강 하나가 걸려 있어요.', '표준 구성입니다. 방심만 안 하면 돼요.'],
      strong: ['강한 쪽을 골랐어요. 대담합니다.', '위험한 구성입니다. 대신 증강이 두 개예요.'],
    },
    waveWin: n => [`웨이브 ${n} 정리됐습니다.`, '깔끔하게 전멸시켰습니다.', '다음 웨이브로 갑니다.', '전부 쓰러뜨렸어요.'],
    strongWin: ['강한 쪽을 넘었습니다. 보상이 두둑해요.', '위험을 감수한 보람이 있네요.'],
    rivalWin: (who, rival) => [
      [`첫 대결은 ${who}의 승리입니다.`, `${rival} 선수, 이번엔 ${who}에게 졌습니다.`],
      [`두 번째도 ${who}가 가져갑니다.`, `${rival} 선수, 또 한 번 막혔네요.`],
      [`라이벌전, 이번에도 ${who}.`, `${rival} 선수, 세 번째도 넘지 못했습니다.`],
      [`${who}, 챔피언에게 도전할 자격을 얻었습니다!`, `마지막 라이벌전, 승자는 ${who}입니다!`],
    ],
    rivalLose: rival => [`${rival} 선수가 이번엔 이겼습니다.`, `${rival}, 끝내 넘어섰네요.`, '라이벌에게 막혔습니다. 여기까지예요.'],
    formerDown: ['전 챔피언이 쓰러졌습니다!', '노장을 넘었습니다.', '해머가 멈췄습니다. 대단해요.'],
    currentDown: ['현 챔피언이 쓰러집니다!', '해냈습니다! 챔피언을 넘었어요!'],
    bossLose: ['챔피언의 벽은 높았습니다.', '이번엔 여기까지입니다.', '아쉽습니다. 다음엔 넘을 수 있을 거예요.'],
    lose: who => [`${who}, 쓰러졌습니다.`, '여기까지입니다.', '아쉽습니다. 런이 끝났어요.'],
    bigHit: ['와, 이건 아픕니다.', '크게 맞았어요.', '방금 건 컸습니다.', '체력이 쑥 빠졌어요.'],
    finale: who => [`GG~~! 새 챔피언의 탄생, ${who}!`, `GG~~! ${who}, 아레나의 정상에 섰습니다!`, `GG~~! 20웨이브 완주, ${who}가 챔피언입니다!`],
  };
  /* 기믹 이벤트 → 대사. first: 런에서 처음 본 순간 · follow: 처음 뒤에 붙는 한마디 ·
   * again: 두 번째부터 · tier: danger(강한 위험) result(특이한 결과) routine(평범한 반복) · max: routine 최대 횟수 */
  const L1 = list => () => list;
  const ROGUE_EVENT_LINES = {
    VOLTTWIN_LINK_CREATED: { label: '볼트윈', first: L1(['둘 사이에 전기가 연결됐습니다.']), again: L1(['다시 전기줄이 이어졌어요.']), tier: 'routine', max: 1, cd: 40000 },
    VOLTTWIN_LINK_HIT: { label: '볼트윈', first: L1(['전기선을 가로질렀네요.']), again: L1(['전기줄에 걸렸습니다.', '또 감전됐어요.']), tier: 'result', cd: 18000 },
    SUCTIONBALL_ATTACHED: { label: '흡착볼', first: L1(['흡착볼이 붙었습니다.']), follow: ['벽에 강하게 부딪히면 떨어질 겁니다.'],
      again: L1(['또 붙었어요.', '흡착볼이 달라붙습니다.']), tier: 'routine', max: 2, cd: 30000 },
    SUCTIONBALL_DETACHED: { label: '흡착볼', first: L1(['벽에 부딪혀서 떼어냈습니다!']), again: L1(['떼어냈어요. 지금 정리하죠.', '벽꽝으로 털어냈습니다.']), tier: 'result', cd: 20000 },
    BOOMBALL_COUNTDOWN: { label: '붐볼', first: L1(['붐볼이 터지려 합니다.']), follow: ['다른 몬스터 쪽으로 끌고 가면 같이 터집니다.'],
      again: L1(['또 불이 붙었어요.']), tier: 'routine', max: 1, cd: 40000 },
    BOOMBALL_CHAIN: { label: '붐볼', first: e => e.data && e.data.count >= 3 ? ['한꺼번에 날아갔습니다!'] : ['폭발이 다른 녀석까지 휘말렸네요.'],
      again: e => e.data && e.data.count >= 3 ? ['한꺼번에 날아갔습니다!'] : ['같이 터졌습니다. 잘 끌고 갔어요.', '폭발이 다른 녀석까지 휘말렸네요.'], tier: 'result', cd: 12000 },
    DRILLBALL_BURROW: { label: '드릴볼', first: L1(['벽 속으로 들어갔습니다.']), again: L1(['또 파고듭니다.']), tier: 'routine', max: 1, cd: 40000 },
    DRILLBALL_EMERGE: { label: '드릴볼', first: L1(['다른 쪽에서 나옵니다.']), follow: ['금이 간 자리를 보세요.'], again: L1(['곧 튀어나옵니다.']), tier: 'routine', max: 2, cd: 25000 },
    MULTIGEL_DUPLICATED: { label: '멀티젤', first: L1(['멀티젤이 늘어났습니다.']), follow: ['빨리 처리하지 않으면 계속 불어나요.'], again: L1(['또 늘었어요.']), tier: 'routine', max: 1, cd: 30000 },
    MULTIGEL_SWARM: { label: '멀티젤', once: true, priority: 72, lines: () => ['너무 오래 놔뒀네요.', '젤리가 경기장을 덮고 있습니다.'] },
    RUSHHORN_CHARGE: { label: '러시혼', first: L1(['돌진합니다.']), follow: ['피하면 벽에 박힐 거예요.'], again: L1(['또 겨눕니다.', '돌진 준비.']), tier: 'routine', max: 2, cd: 20000 },
    RUSHHORN_WALL_CRASH: { label: '러시혼', first: L1(['제대로 벽에 박혔습니다.']), again: L1(['벽에 박혔어요. 지금이 기회입니다.', '제대로 벽에 박혔습니다.']), tier: 'result', cd: 15000 },
    SPARKGEL_FIELD_ON: { label: '스파크젤', first: L1(['주변에 전기가 들어왔습니다.']), again: L1(['전기장이 다시 켜졌어요.']), tier: 'routine', max: 1, cd: 40000 },
    SPARKGEL_FIELD_OFF: { label: '스파크젤', first: L1(['지금은 접근할 수 있겠네요.']), again: L1(['전기가 꺼졌습니다.']), tier: 'routine', max: 1, cd: 40000 },
    MEDICBALL_HEAL: { label: '메딕볼', first: L1(['메딕볼이 회복시키고 있습니다.']), again: L1(['또 회복시킵니다.']), tier: 'routine', max: 1, cd: 30000 },
    MEDICBALL_BIG_HEAL: { label: '메딕볼', first: L1(['저 녀석부터 처리하는 게 좋겠습니다.']), again: L1(['회복량이 상당합니다. 메딕볼부터요.', '저 녀석부터 처리하는 게 좋겠습니다.']), tier: 'danger', cd: 20000 },
    WALL_SLAM: { label: '벽꽝', first: L1(['벽까지 날아갔습니다. 잠깐 멍해요.']), again: L1(['또 벽에 박혔어요.', '벽 충돌, 아프죠.']), tier: 'result', cd: 20000 },
    LAST_MONSTER: { label: '마지막', once: true, priority: 70, lines: () => ['마지막 하나 남았습니다.', '이제 한 마리.', '거의 다 왔어요. 하나 남았습니다.'] },
    HAMMER_RAISE: { label: '전 챔피언', first: L1(['해머가 올라갑니다.']), again: L1(['또 해머를 듭니다.']), tier: 'routine', max: 1, cd: 30000 },
    HAMMER_SLAM: { label: '전 챔피언', again: L1(['또 경기장을 찍어버리는군요.']), tier: 'routine', max: 2, cd: 30000 },
    HAMMER_SWEEP: { label: '전 챔피언', first: L1(['넓게 옵니다.']), again: L1(['넓게 휘두릅니다.']), tier: 'routine', max: 1, cd: 30000 },
    HAMMER_SHOCKWAVE: { label: '전 챔피언', first: L1(['충격파입니다.']), again: L1(['벽에서 충격파가 번집니다.']), tier: 'routine', max: 1, cd: 30000 },
    HAMMER_LEAP: { label: '전 챔피언', first: L1(['바닥을 보세요.']), again: L1(['또 뛰어오릅니다!', '그림자를 피하세요.']), tier: 'danger', cd: 25000 },
    HAMMER_SPIN: { label: '전 챔피언', first: L1(['해머를 돌리기 시작합니다.']), again: L1(['또 돌립니다. 거리를 벌리세요.']), tier: 'danger', cd: 25000 },
    CHAMPION_BLINK: { label: '현 챔피언', first: L1(['순간 위치를 바꿨습니다.']), again: L1(['또 위치를 바꿉니다.']), tier: 'routine', max: 2, cd: 25000 },
    CHAMPION_TRAIL: { label: '현 챔피언', first: L1(['움직이면서 주문까지 이어갑니다.']), again: L1(['지나간 자리가 터집니다.']), tier: 'routine', max: 1, cd: 30000 },
    CHAMPION_CIRCLES: { label: '현 챔피언', first: L1(['마법진이 깔리고 있습니다.']), follow: ['순서대로 터집니다. 숫자를 보세요.'], again: L1(['다시 마법진입니다.']), tier: 'routine', max: 1, cd: 30000 },
    CHAMPION_BEAMS: { label: '현 챔피언', first: L1(['한 곳만 보고 있을 수 없겠네요.']), again: L1(['가로세로로 옵니다.']), tier: 'danger', cd: 25000 },
    CHAMPION_NOVA: { label: '현 챔피언', first: L1(['챔피언다운 공격입니다.']), again: L1(['또 쏟아집니다!']), tier: 'danger', cd: 30000 },
    BOSS_PHASE2: { label: '보스', once: true, priority: 86, lines: e => e.data && e.data.boss === 'former' ? ['노장이 본색을 드러냅니다.', '이제부터 더 빨라집니다.'] : ['이제부터가 진짜입니다.', '챔피언이 진심입니다.'] },
  };

  const api = { Director, displayMs, ROGUE_EVENT_LINES, ROGUE_LINES };
  root.BounceRoyalCommentaryCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
