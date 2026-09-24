'use strict';
/* Shared game / listening-room sound library. Audio starts only after ensure()
 * is called from a user gesture; recipes are scheduled on the audio clock. */
(function (root) {
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const tone = (f, to, dur, gain, wave = 'sine', delay = 0, attack = .006) =>
    ({ kind:'tone', f, to, dur, gain, wave, delay, attack });
  const noise = (f, to, dur, gain, filter = 'bandpass', delay = 0, attack = .008, q = .8) =>
    ({ kind:'noise', f, to, dur, gain, filter, delay, attack, q });
  const sample = (name, gain, dur, fallback) => ({ kind:'sample', name, gain, dur, fallback, delay:0, attack:.003 });
  /* 선인장 해설자의 목소리 — 동물의 숲 주민 말투.
   * 글자 하나에 아주 짧고 높은 음절 하나('뾱')를 낸다. 음절의 모음은 실제 대사의
   * 모음을 따르고(해설 쪽이 vowel로 알려 준다), ㅅ·ㅈ·ㅊ 같은 자음은 앞머리에 쉿,
   * ㄱ·ㄷ·ㅂ 계열은 톡 하는 짧은 공명을 얹는다. tilt는 억양(문장 끝 내려앉기·
   * 물음표 올리기)이다. 녹음이나 실제 발음은 쓰지 않는 합성음이다. */
  // [첫째, 둘째 공명] Hz. 몸집이 작은 목소리라 사람 모음보다 높게 잡았다.
  const CHATTER_VOWELS = [
    [900,1500],   // 0 ㅏ
    [620,2100],   // 1 ㅔ·ㅐ
    [700,1250],   // 2 ㅓ
    [560,1000],   // 3 ㅗ
    [420,950],    // 4 ㅜ
    [470,1650],   // 5 ㅡ
    [380,2450],   // 6 ㅣ
  ];
  function chatterLayers(index, emphasis = false, muffled = false, variation = .5, delay = 0, shape = {}) {
    const vowelIndex = Number.isInteger(shape.vowel) ? shape.vowel : index;
    const [first,second] = CHATTER_VOWELS[((vowelIndex % CHATTER_VOWELS.length) + CHATTER_VOWELS.length) % CHATTER_VOWELS.length];
    // 음절 간격(약 62ms)보다 짧게 끊어야 글자가 하나하나 또렷하다
    const duration = .04 + (index % 3) * .004 + variation * .006;
    const tilt = clamp(finite(shape.tilt, 0), -.2, .35);
    const pitch = (muffled ? 250 : emphasis ? 440 : 370) * (1 + tilt) * (.95 + variation * .1);
    // 톡 튀어 올랐다가 내려앉는 짧은 음정 곡선
    const pitchPath = [[0,pitch*.92],[.25,pitch*1.08],[.7,pitch],[1,pitch*.9]];
    const envelope = gain => [[0,.0001],[.08,gain],[.45,gain*.8],[1,.0001]];
    const formant = (f,gain,q) => ({
      ...tone(pitch,pitch,duration,gain,'sawtooth',delay),
      freqPath:pitchPath, gainPath:envelope(gain),
      filter:{type:'bandpass',q,path:[[0,f*.9],[.3,f],[1,f*.94]]},
    });
    const layers = [
      // 음량은 예전 웅얼거림과 비슷한 정점에 맞춘다 — 전투 효과음 밑에 깔려야 한다
      formant(muffled ? first*.6 : first, muffled ? .03 : .05, 5),
      formant(muffled ? second*.45 : second, muffled ? .008 : .03, 7),
      {...tone(pitch,pitch,duration,muffled ? .012 : .018,'square',delay),
        freqPath:pitchPath,gainPath:envelope(muffled ? .012 : .018),
        filter:{type:'lowpass',q:.7,f:muffled ? 500 : 1100,to:muffled ? 380 : 800}},
    ];
    // 자음 앞머리 — 난수를 쓰는 잡음 대신 높은 공명을 16ms만 얹는다
    if (!muffled && (shape.onset === 'hiss' || shape.onset === 'pop')) {
      const hiss = shape.onset === 'hiss', gain = hiss ? .018 : .013;
      layers.push({...tone(pitch*2,pitch*2,.016,gain,'sawtooth',delay),
        freqPath:[[0,pitch*2.2],[1,pitch*1.6]],gainPath:[[0,.0001],[.2,gain],[1,.0001]],
        filter:hiss ? {type:'highpass',q:.7,path:[[0,4200],[1,3200]]} : {type:'bandpass',q:2.5,path:[[0,2600],[1,1800]]}});
    }
    return layers;
  }
  // 사운드 랩 미리 듣기: "싸요~" 두 음절 (청음실은 한 소리에 8겹까지)
  const CHATTER_PREVIEW = [[0,'hiss',.06],[3,null,-.03]];
  const definitions = [];
  function sound(id, name, group, description, icon, layers, options = {}) {
    definitions.push({ id, name, group, description, icon, layers, gap:.055, priority:2, ...options });
  }

  // Bright transients, a softer body, and short tails keep rapid combat legible.
  sound('weapon.sword.hit', '검 · 묵직한 베기', '무기', '넓게 훑는 바람에 낮은 금속 울림이 이어집니다.', 'sword', [noise(3300,650,.23,.28), tone(620,260,.16,.045,'triangle',.012), tone(1260,760,.09,.023,'sine',.008)], { priority:1, variation:.035 });
  sound('weapon.dagger.hit', '단검 · 날카로운 베기', '무기', '검보다 짧고 높은 칼날 소리로 빠른 접촉을 구분합니다.', 'dagger', [noise(5100,1700,.10,.23), tone(1850,960,.08,.035,'triangle'), tone(420,170,.06,.025)], { priority:1, variation:.05 });
  // 방패 — 던질 때 쇳덩이가 회전하며 날고, 받을 때 손에 탁 걸린다.
  sound('weapon.shield.throw', '방패 · 투척', '무기 스킬', '금속판이 공기를 가르며 회전해 나가는 소리입니다.', 'shield', [noise(1400,620,.22,.24,'bandpass',0,.008), tone(520,240,.16,.05,'triangle',.006)], { priority:2, variation:.04 });
  sound('weapon.shield.hit', '방패 · 적중', '무기', '넓은 판이 부딪히는 둔탁하고 단단한 충격음입니다.', 'shield', [noise(1100,380,.10,.28), tone(240,150,.09,.06,'triangle',.004)], { priority:1, variation:.05 });
  sound('weapon.shield.catch', '방패 · 회수', '무기', '손에 탁 걸리는 짧은 금속 접촉음으로 다시 무장했음을 알립니다.', 'shield', [noise(2600,900,.055,.16,'bandpass',0,.002), tone(680,900,.07,.04,'triangle',.004)], { priority:2, variation:.03 });
  sound('weapon.shield.bounce', '방패 · 벽 반사', '무기', '원판 테두리가 벽을 치는 짧고 높은 금속 접촉음입니다.', 'shield', [noise(3500,1600,.08,.10), tone(1720,1715,.12,.03)], { gap:.09, priority:1 });
  // 연속 분사는 낮은 우선순위, 점화는 시작 순간만: 중요한 적중음을 가리지 않는다.
  sound('weapon.flame.ignite', '화염방사기 · 점화', '무기 스킬', '작은 밸브 클릭 후 불꽃이 붙는 짧은 분출입니다.', 'flame', [noise(1500,700,.15,.16,'lowpass'), noise(3600,2400,.08,.025,'highpass',.03)], { gap:.28, priority:2 });
  sound('weapon.flame.spray', '화염방사기 · 분사', '무기', '낮은 연소음 위에 바람이 새는 쉭 소리를 얹어 계속 뿜는 느낌을 냅니다.', 'flame', [noise(900,420,.26,.19,'lowpass',0,.03), noise(4200,2600,.24,.055,'highpass',.01,.04), tone(120,96,.22,.045,'triangle',.01)], { gap:.2, priority:0, variation:.025 });
  // 철퇴 — 검의 넓은 칼바람과 달리 쇳덩이가 짧고 낮게 박힌다.
  sound('weapon.chain.hit', '철퇴 · 쇳덩이 타격', '무기', '짧고 낮게 끝나는 금속 타격에 사슬이 팽팽해지는 쇳소리를 얹었습니다.', 'chain', [noise(1900,520,.13,.26), tone(190,120,.10,.055,'triangle',.004), tone(2400,1500,.05,.022,'sine',.006)], { priority:1, variation:.05 });
  sound('skill.chain.swap', '철퇴 · 위치 교환', '무기 스킬', '짧게 빨아들였다 튕겨 나가는 두 겹 소리로 자리가 뒤바뀐 순간을 표시합니다.', 'chain', [noise(500,2100,.12,.20,'bandpass',0,.004), tone(760,300,.14,.055,'triangle',.03), tone(300,760,.10,.035,'sine',.01)], { priority:3, gap:.15 });
  sound('weapon.bow.fire', '활 · 화살 발사', '무기', '활시위의 탄성과 가느다란 바람을 함께 냅니다.', 'bow', [sample('bow',.30,.18,noise(2400,650,.14,.22)), tone(440,150,.10,.036,'triangle'), noise(4900,2100,.12,.055,'highpass',.018)], { priority:1, variation:.035 });
  sound('weapon.pistol.fire', '권총 · 발사', '무기', '짧은 발사음에 낮은 탄력을 더해 연사 중에도 선명합니다.', 'pistol', [sample('pistol',.26,.13,noise(3600,1100,.055,.22,'lowpass')), tone(160,60,.065,.085), noise(2700,800,.045,.045,'bandpass',.008)], { gap:.035, priority:1, variation:.025 });
  sound('weapon.pistol.barrage-shot', '회전 난사 · 한 발', '무기 스킬', '실제 연사 발사 시점에만 재생됩니다.', 'pistol', [noise(3800,750,.095,.20,'lowpass')], { gap:.025, priority:2, internal:true });
  sound('weapon.pistol.reload', '권총 · 재장전', '무기', '탄창을 넣고 장전하는 두 번의 기계적인 클릭입니다.', 'pistol', [noise(2100,700,.055,.13), tone(340,240,.05,.042,'triangle'), noise(3900,1100,.075,.16,'bandpass',.21), tone(570,310,.055,.035,'triangle',.21)], { gap:.25 });
  sound('weapon.shotgun.fire', '산탄 · 발사', '무기', '권총보다 넓은 파열음과 두툼한 저음을 냅니다.', 'pistol', [sample('shotgun',.34,.24,noise(2700,450,.19,.3,'lowpass')), tone(130,43,.17,.14), noise(4800,1200,.12,.075,'bandpass',.015)], { gap:.09 });
  sound('weapon.staff.fire', '지팡이 · 마법탄', '무기', '살짝 어긋난 두 음이 둥글고 푸른 마력의 울림을 만듭니다.', 'staff', [tone(212,136,.29,.065,'triangle',0,.018), tone(216,140,.31,.046,'sine',.008,.02), tone(970,360,.16,.024,'sine'), noise(1900,520,.20,.048,'bandpass',0,.02)], { priority:1, variation:.018 });
  sound('weapon.mine.place', '지뢰 · 설치', '무기', '금속 잠금쇠가 걸리고 작은 신호음이 켜집니다.', 'mine', [noise(1800,550,.065,.13), tone(180,105,.07,.06,'triangle'), tone(1240,1240,.08,.026,'sine',.085)], { gap:.1, priority:1 });
  sound('weapon.mine.explode', '지뢰 · 폭발', '무기', '작은 파열 뒤에 묵직한 저음이 빠르게 사라집니다.', 'mine', [noise(3900,340,.29,.31,'lowpass'), tone(126,35,.32,.16), tone(780,130,.085,.033,'triangle')], { gap:.08 });

  sound('skill.bow.charge', '차지 샷 · 충전', '무기 스킬', '활시위와 공기가 조여들며 높은 음으로 힘을 모읍니다.', 'bow', [tone(190,920,.95,.064,'triangle',0,.14), tone(285,1380,.92,.035,'sine',.025,.15), noise(450,4200,.98,.10,'bandpass',0,.22)], { gap:.4, priority:3 });
  sound('skill.bow.release', '차지 샷 · 관통 발사', '무기 스킬', '충전음을 끊고 강한 공기 파열과 긴 관통음을 냅니다.', 'bow', [noise(5100,560,.38,.33), tone(180,43,.24,.15), tone(1680,230,.29,.066,'triangle'), noise(1700,350,.32,.075,'lowpass',.04)], { gap:.12, priority:4, stops:['skill.bow.charge'] });
  sound('skill.dagger.prepare', '단검 · 돌진 준비', '무기 스킬', '날을 당기는 금속음과 짧은 흡입음이 출발을 예고합니다.', 'dagger', [noise(560,3800,.24,.18,'bandpass',0,.08), tone(340,970,.21,.06,'triangle',0,.04), tone(1620,1960,.12,.02,'sine',.10)], { priority:3 });
  sound('skill.dagger.dash', '단검 · 관통 돌진', '무기 스킬', '날카로운 칼바람이 앞으로 빠르게 뻗습니다.', 'dagger', [noise(6300,650,.29,.32), tone(930,150,.22,.078,'triangle'), tone(110,38,.16,.09), noise(3400,1300,.10,.07,'bandpass',.025)], { priority:4, stops:['skill.dagger.prepare'] });
  sound('skill.sword.spin', '검 · 믹서기', '무기 스킬', '1.2초 동안 두 바퀴 휘두르는 동작에 맞춰 굵은 칼바람이 두 번 이어집니다.', 'sword', [noise(4300,650,.57,.25,'bandpass',0,.04), noise(4800,550,.57,.27,'bandpass',.60,.04), tone(720,180,.52,.043,'triangle'), tone(880,220,.52,.038,'triangle',.60)], { priority:3, gap:.2 });
  sound('skill.pistol.barrage', '권총 · 회전 난사 시작', '무기 스킬', '회전 난사의 잠금장치와 점화음입니다. 1.5초간 이어지는 연사음은 실제 발사마다 울립니다.', 'pistol', [noise(3500,600,.10,.15), tone(170,310,.17,.066,'triangle'), noise(2100,4200,.20,.075,'bandpass',.035,.045)], { priority:3 });
  sound('skill.staff.overload', '지팡이 · 마력 폭주', '무기 스킬', '낮은 마력이 솟아오른 뒤 맑은 배음이 퍼집니다.', 'staff', [tone(128,390,.48,.07,'triangle',0,.08), tone(192,590,.52,.055,'sine',.035,.09), tone(1050,1580,.40,.042,'sine',.18,.025), noise(500,3100,.43,.075,'bandpass',.08,.09)], { priority:3 });
  sound('skill.mine.remote', '지뢰 · 원격 폭파', '무기 스킬', '격발 신호 다음에 넓고 낮은 폭발이 이어집니다.', 'mine', [tone(1550,1550,.055,.04), noise(4100,220,.45,.34,'lowpass',.065), tone(152,30,.48,.17,'sine',.065), noise(1700,400,.24,.08,'bandpass',.14)], { priority:4, gap:.15 });

  sound('skill.cat.rewind', '고양이 발바닥 · 되돌아가기', '캐릭터 스킬', '역방향으로 빨려드는 울림과 부드러운 착지음입니다.', 'cat', [noise(480,3800,.27,.16,'bandpass',0,.09), tone(820,170,.26,.07,'sine',0,.015), tone(190,76,.14,.08,'sine',.25), tone(620,920,.15,.027,'sine',.28)], { priority:3 });
  sound('skill.rampage.start', '왁뿌볼 · 폭주 시작', '캐릭터 스킬', '엔진이 점화되듯 거칠게 힘이 차오릅니다.', 'wak', [tone(95,280,.34,.09,'triangle',0,.035), noise(300,2600,.31,.15,'lowpass',0,.07), tone(210,680,.27,.045,'triangle',.07)], { priority:3 });
  sound('skill.rampage.end', '왁뿌볼 · 폭주 종료', '캐릭터 스킬', '힘을 쓴 엔진이 낮게 가라앉으며 식습니다.', 'wak', [tone(280,55,.40,.065,'triangle',0,.015), noise(1600,280,.34,.10,'lowpass'), tone(145,70,.27,.042,'sine',.10)], { priority:2 });
  sound('skill.soft.guard', '말랑이 · 말랑 방어', '캐릭터 스킬', '말랑한 막이 펼쳐지고 유리처럼 맑은 보호음이 남습니다.', 'soft', [tone(190,540,.24,.07,'sine',0,.025), tone(940,960,.45,.033,'sine',.08,.018), tone(1410,1440,.37,.025,'sine',.1), noise(1400,3100,.15,.06,'bandpass',0,.035)], { priority:3 });
  sound('skill.bomb.arm', '폭탄 · 점화', '캐릭터 스킬', '도화선의 작은 불꽃과 올라가는 경고음입니다.', 'bomb', [noise(3400,5200,.68,.09,'highpass',0,.02), tone(560,930,.11,.033,'triangle'), tone(690,1200,.10,.037,'triangle',.3), tone(880,1580,.10,.042,'triangle',.57)], { gap:.5, priority:3 });
  sound('skill.bomb.explode', '폭탄 · 시한폭발', '캐릭터 스킬', '점화 후 주변으로 폭발을 일으킬 때 둥글고 큰 파열음이 퍼집니다.', 'bomb', [noise(5300,240,.49,.37,'lowpass'), tone(182,32,.47,.19), noise(800,170,.43,.105,'lowpass',.07), tone(940,170,.13,.035,'triangle')], { priority:4, gap:.2, stops:['skill.bomb.arm'] });
  sound('skill.basketball.arm', '농구공 · 돌진 준비', '캐릭터 스킬', '탄력 있는 공이 낮게 울리며 힘을 모읍니다.', 'bball', [tone(165,95,.14,.10), tone(250,145,.12,.065,'sine',.13), tone(360,210,.13,.05,'sine',.25), noise(900,3100,.27,.065,'bandpass',.09,.055)], { priority:3 });
  sound('skill.basketball.rush', '농구공 · 강력 돌진', '캐릭터 스킬', '탄성 있는 출발음과 낮고 굵은 공기 흐름입니다.', 'bball', [tone(210,52,.22,.14), noise(2900,360,.39,.3), tone(740,190,.21,.05,'triangle')], { priority:4 });
  sound('skill.balloon.inflate', '풍선 · 팽창', '캐릭터 스킬', '공기가 차오르며 고무 같은 음이 부드럽게 올라갑니다.', 'balloon', [noise(900,2600,.50,.12,'bandpass',0,.12), tone(160,540,.47,.065,'sine',0,.06), tone(245,810,.43,.022,'sine',.045,.07)], { priority:3 });
  sound('skill.balloon.deflate', '풍선 · 팽창 종료', '캐릭터 스킬', '빠져나가는 공기와 내려가는 고무 울림입니다.', 'balloon', [noise(2900,700,.37,.12,'bandpass',0,.02), tone(460,130,.34,.055,'sine'), tone(700,210,.24,.023,'sine',.05)], { priority:2 });

  sound('augment.rocket', '로켓 스타트 · 초고속 돌진', '증강', '점화 후 길게 뻗는 로켓 분사음으로 속도를 강조합니다.', 'aug-rocketStart', [noise(700,2800,.24,.19,'lowpass',0,.02), noise(4200,500,.51,.23,'bandpass',.045,.03), tone(155,40,.32,.13), tone(660,150,.27,.042,'triangle')], { priority:3, gap:.3 });
  sound('augment.beam', '검기 · 관통 파동', '증강', '검의 금속성을 유지하면서 공중으로 뻗는 에너지 파동입니다.', 'aug-w_beam', [noise(3400,900,.24,.22), tone(1140,280,.30,.065,'triangle'), tone(2280,640,.20,.025,'sine'), tone(190,85,.12,.052)], { priority:2, variation:.025 });
  sound('augment.missile', '유도미사일 · 발사', '증강', '작은 점화 뒤 낮고 매끄러운 추진음이 이어집니다.', 'aug-missile', [noise(1800,3800,.15,.13,'bandpass'), noise(2700,480,.31,.15,'lowpass',.03,.025), tone(165,65,.25,.078,'triangle')], { gap:.075, priority:1, variation:.035 });
  sound('augment.shuriken', '표창 · 투척', '증강', '가늘고 높은 금속 회전음으로 미사일과 구별됩니다.', 'aug-shuriken', [noise(6400,1900,.135,.20), tone(2800,1500,.11,.025,'sine'), tone(4200,2250,.085,.013,'sine',.025)], { gap:.07, priority:1, variation:.045 });
  sound('augment.lightning', '번개 구름 · 낙뢰', '증강', '날카로운 전기 파열 뒤 낮은 천둥이 빠르게 남습니다.', 'aug-lightning', [noise(6100,1600,.095,.30,'highpass'), tone(74,39,.31,.13), noise(2900,230,.33,.16,'lowpass',.025), tone(1320,170,.085,.044,'triangle')], { priority:3, gap:.12 });
  sound('augment.chain-lightning', '연쇄 번개 · 전이', '증강', '두 번 튀는 전기음으로 번개 적중 후 이어지는 추가 번개를 표현합니다.', 'aug-chainBolt', [noise(5300,1300,.075,.19,'highpass'), tone(1140,380,.09,.048,'triangle'), noise(6600,1700,.085,.18,'highpass',.075), tone(1520,510,.105,.044,'triangle',.075)], { gap:.085 });
  sound('augment.static', '전기 충돌 · 정전기', '증강', '작고 빠른 전기 스파크가 톡 터집니다.', 'aug-staticShock', [noise(5100,2100,.075,.15,'highpass'), tone(1220,240,.07,.033,'triangle')], { gap:.09, priority:1, variation:.04 });
  sound('augment.shockwave', '충격파 · 방출', '증강', '둥근 저음과 넓게 확장되는 바람이 밀려나갑니다.', 'aug-shockwave', [tone(155,34,.35,.14), noise(2400,380,.34,.21,'lowpass',.015,.035), tone(520,140,.15,.038,'triangle')], { priority:2, gap:.12 });
  sound('augment.sleep', '수면가스 · 기절', '증강', '가스가 퍼지고 두 음이 나른하게 낮아집니다.', 'aug-sleepGas', [noise(1800,650,.46,.12,'bandpass',0,.09), tone(740,570,.38,.046,'sine',.02,.025), tone(555,420,.36,.035,'sine',.18,.04)], { priority:3, gap:.3 });
  sound('augment.gravity', '중력장 · 흡인', '증강', '낮은 공명과 빨려드는 공기가 무게감을 만듭니다.', 'aug-gravityWell', [tone(66,98,.51,.082,'sine',0,.075), tone(101,147,.48,.037,'triangle',.025,.08), noise(3400,400,.49,.12,'bandpass',0,.07)], { priority:2, gap:.35 });
  sound('augment.split', '분열 · 복제', '증강', '중심이 갈라진 뒤 서로 다른 두 높이의 공명으로 나뉩니다.', 'aug-split', [noise(1900,700,.17,.12), tone(260,150,.15,.055), tone(520,820,.27,.05,'sine',.08), tone(780,1230,.30,.037,'sine',.115)], { priority:3, gap:.2 });
  sound('augment.minion-explode', '복수하는 부하 · 폭발', '증강', '작은 공이 팽팽하게 터지는 높은 폭발음입니다.', 'aug-minionRevenge', [tone(260,50,.21,.105), noise(3600,500,.23,.24,'lowpass'), tone(1400,260,.11,.032,'triangle')], { priority:2, gap:.10 });
  sound('augment.last-stand', '최후의 3초 · 발동', '증강', '체력이 0이 된 뒤에도 3초간 행동할 수 있는 마지막 기회를 낮은 균열과 상승음으로 알립니다.', 'aug-lastStand', [tone(95,280,.35,.09,'triangle',0,.04), noise(2700,400,.32,.18), tone(420,1120,.28,.05,'sine',.10,.03)], { priority:3, gap:.25 });
  sound('augment.heal', '회복 · 생명력', '증강', '맑고 부드러운 두 음이 위로 피어납니다.', 'aug-meditate', [tone(660,680,.27,.04,'sine',0,.025), tone(990,1020,.33,.032,'sine',.075,.035), noise(2300,4600,.20,.025,'bandpass',.035,.05)], { priority:1, gap:.20 });
  sound('augment.frost', '냉기 · 적중', '증강', '냉기의 첫 무기 적중에 짧은 결정음이 들립니다.', 'aug-frost', [tone(2350,2200,.25,.029,'sine'), tone(3520,3300,.19,.018,'sine',.03), noise(6200,2200,.22,.083,'highpass',0,.02)], { priority:2, gap:.15 });
  sound('augment.reflect', '반사 · 튕겨내기', '증강', '밝은 금속 접촉음이 즉시 반대쪽으로 튀어오릅니다.', 'aug-reflectCharge', [tone(1240,1900,.17,.047,'sine'), noise(3300,5600,.10,.11,'bandpass'), tone(610,920,.13,.034,'triangle')], { priority:2, gap:.085 });

  sound('battle.hit', '전투 · 피해', '전투', '무기 소리를 가리지 않는 짧고 둥근 타격음입니다.', 'onhit', [tone(200,77,.072,.062), noise(1100,380,.045,.065,'lowpass')], { gap:.065, priority:0, variation:.11 });
  sound('battle.bounce', '전투 · 벽 반사', '전투', '핀볼처럼 탄력 있지만 작게 울리는 벽 충돌음입니다.', 'physics', [tone(178,93,.095,.052), tone(390,210,.05,.013,'triangle')], { gap:.065, priority:0, variation:.08 });
  sound('battle.death', '전투 · 쓰러짐', '전투', '공이 터지고 힘이 빠지는 낮은 하강음입니다.', 'death', [noise(2300,380,.27,.17,'lowpass'), tone(245,48,.35,.072,'triangle'), tone(480,110,.22,.025,'sine',.03)], { priority:3, gap:.15 });
  sound('battle.explosion', '전투 · 기본 폭발', '전투', '폭발성 충돌에 쓰는 짧고 부드러운 파열음입니다.', 'bomb', [noise(2700,350,.28,.21,'lowpass'), tone(120,35,.29,.115)], { priority:2, gap:.10 });
  sound('skill.activate', '스킬 · 공통 활성화', '전투', '별도 소리가 없는 활성화 상황을 알리는 작은 상승음입니다.', 'skill', [tone(440,760,.19,.044,'sine'), tone(880,1520,.13,.018,'sine',.035)], { priority:2, gap:.15 });
  // 솔로 로그라이크 — 고블린볼·기믹 몬스터·보스. 예고(마크·차징)는 가볍고 높게, 실제 타격은 낮고 묵직하게 나눠 듣는다.
  const ROGUE = '로그라이크';
  sound('monster.pop', '몬스터 · 쓰러짐', ROGUE, '작은 공이 퐁 하고 꺼지는 짧은 소리입니다.', 'rogue', [tone(520,140,.14,.06,'triangle'), noise(2600,600,.10,.08,'lowpass')], { priority:1, gap:.06, variation:.08 });
  sound('monster.club.hit', '몽둥이 · 적중', ROGUE, '나무 몽둥이가 둔탁하게 부딪힙니다.', 'rogue', [tone(180,90,.09,.07,'triangle'), noise(800,300,.06,.08,'lowpass'), tone(420,260,.05,.018,'square')], { priority:1, gap:.07, variation:.08 });
  sound('monster.giant.swing', '거인 · 큰 휘두름', ROGUE, '무거운 몽둥이가 공기를 크게 밀어냅니다.', 'rogue', [noise(500,1200,.26,.10,'bandpass',0,.03), tone(90,60,.24,.06)], { priority:2, gap:.12 });
  sound('monster.slime.spit', '점액 · 발사', ROGUE, '퉤 하고 끈적한 덩어리를 뱉습니다.', 'rogue', [tone(300,700,.08,.04,'sine'), noise(1500,900,.09,.05,'bandpass')], { priority:1, gap:.1, variation:.1 });
  sound('monster.slime.splat', '점액 · 철퍽', ROGUE, '바닥이나 공에 점액이 철퍽 달라붙습니다.', 'rogue', [noise(700,250,.16,.08,'lowpass'), tone(240,90,.12,.04,'sine',.01)], { priority:1, gap:.1, variation:.1 });
  sound('monster.hammer.smash', '해머 정예 · 강타', ROGUE, '해머가 내려찍히며 튕겨 나가는 무거운 타격음입니다.', 'rogue', [tone(120,40,.28,.11), noise(1800,300,.22,.16,'lowpass'), tone(620,330,.10,.03,'triangle')], { priority:3, gap:.12 });
  sound('monster.wall.slam', '벽꽝 · 충돌', ROGUE, '벽에 처박히는 순간의 둔탁한 충격과 짧은 금속 울림입니다.', 'physics', [tone(95,45,.22,.10), noise(1200,260,.18,.15,'lowpass'), tone(880,440,.08,.02,'square',.01)], { priority:3, gap:.15 });
  sound('monster.mage.cast', '마법사 · 표식', ROGUE, '반짝이며 올라가는 음으로 폭발 자리를 알립니다.', 'staff', [tone(660,1320,.32,.03,'sine',0,.04), tone(990,1760,.28,.02,'triangle',.06,.04), noise(4200,6000,.30,.02,'highpass',0,.05)], { priority:2, gap:.2 });
  sound('monster.mage.blast', '마법사 · 화염 폭발', ROGUE, '표식 자리에서 불꽃이 터집니다.', 'flame', [noise(2400,300,.32,.18,'lowpass'), tone(160,45,.30,.10), tone(1200,600,.12,.025,'sawtooth')], { priority:3, gap:.12 });
  sound('monster.volt.link', '볼트윈 · 연결', ROGUE, '두 공 사이에 전기가 이어지는 낮은 험 소리입니다.', 'link', [tone(120,120,.35,.03,'sawtooth',0,.02), tone(240,245,.35,.02,'square'), noise(5200,4800,.30,.02,'highpass')], { priority:2, gap:.3 });
  sound('monster.volt.zap', '볼트윈 · 감전', ROGUE, '전기줄에 닿았을 때 지지직 튀는 소리입니다.', 'link', [noise(6000,2500,.12,.09,'highpass'), tone(1800,600,.10,.04,'sawtooth'), tone(3600,1200,.06,.02,'square',.02)], { priority:2, gap:.12 });
  sound('monster.suction.attach', '흡착볼 · 달라붙음', ROGUE, '뽁 하고 빨판이 붙는 소리입니다.', 'rogue', [tone(400,160,.12,.06,'sine'), noise(900,400,.10,.06,'lowpass')], { priority:3, gap:.15 });
  sound('monster.suction.pop', '흡착볼 · 떨어짐', ROGUE, '벽에 부딪혀 빨판이 퐁 떨어져 나갑니다.', 'rogue', [tone(180,620,.10,.06,'sine'), noise(2400,1200,.06,.05)], { priority:3, gap:.15 });
  sound('monster.boom.tick', '붐볼 · 카운트다운', ROGUE, '째깍이는 높은 신호로 폭발 시간을 셉니다.', 'bomb', [tone(1480,1480,.05,.035,'square'), tone(2960,2960,.03,.012,'sine')], { priority:2, gap:.08 });
  sound('monster.boom.blast', '붐볼 · 폭발', ROGUE, '주변 몬스터까지 휩쓰는 큰 파열음입니다.', 'bomb', [noise(3000,250,.42,.24,'lowpass'), tone(110,30,.40,.13), tone(60,40,.30,.08,'sine',.02)], { priority:4, gap:.1 });
  sound('monster.drill.dig', '드릴볼 · 파고들기', ROGUE, '벽을 갈아 들어가는 거친 회전음입니다.', 'rogue', [noise(700,500,.40,.08,'bandpass',0,.02,2), tone(160,150,.40,.03,'sawtooth'), tone(320,300,.40,.015,'square')], { priority:2, gap:.25 });
  sound('monster.drill.emerge', '드릴볼 · 튀어나옴', ROGUE, '금이 간 벽을 부수고 튀어나옵니다.', 'rogue', [noise(1400,400,.30,.14,'lowpass'), tone(140,60,.28,.08), noise(3000,1200,.20,.05,'bandpass',.05)], { priority:3, gap:.2 });
  sound('monster.gel.split', '멀티젤 · 복제', ROGUE, '말랑한 두 음으로 젤리가 둘로 나뉩니다.', 'summon', [tone(300,520,.09,.05,'sine'), tone(360,640,.09,.045,'sine',.08)], { priority:2, gap:.12, variation:.06 });
  sound('monster.horn.snort', '러시혼 · 조준', ROGUE, '콧김을 뿜으며 방향을 잡습니다.', 'rogue', [noise(600,300,.20,.07,'lowpass'), tone(110,90,.18,.04,'sawtooth')], { priority:2, gap:.3 });
  sound('monster.horn.charge', '러시혼 · 돌진', ROGUE, '빨라지는 바람 소리로 일직선 돌진을 알립니다.', 'rogue', [noise(800,2200,.40,.08,'bandpass',0,.05), tone(90,180,.40,.05,'triangle')], { priority:3, gap:.25 });
  sound('monster.horn.crash', '러시혼 · 벽 충돌', ROGUE, '벽에 박히고 어지러운 새소리가 이어집니다.', 'physics', [tone(100,40,.30,.11), noise(1600,250,.25,.18,'lowpass'), tone(2400,1800,.20,.02,'sine',.05), tone(2800,2100,.18,.015,'sine',.14)], { priority:4, gap:.2 });
  sound('monster.spark.on', '스파크젤 · 전기장', ROGUE, '전기장이 켜지며 높은 지직임이 올라옵니다.', 'cc', [tone(80,240,.30,.05,'sawtooth',0,.03), noise(5000,7000,.30,.03,'highpass'), tone(1200,1600,.20,.015,'square',.1)], { priority:2, gap:.3 });
  sound('monster.medic.heal', '메딕볼 · 회복', ROGUE, '맑은 세 음이 차례로 피어오르며 동료를 치료합니다.', 'rogue', [tone(784,790,.25,.035,'sine',0,.02), tone(1175,1180,.30,.028,'sine',.08,.02), tone(1568,1570,.25,.018,'sine',.16,.02)], { priority:2, gap:.4 });
  sound('boss.hammer.raise', '전 챔피언 · 해머 들기', ROGUE, '삐걱이며 올라가는 음으로 큰 공격을 예고합니다.', 'rogue', [tone(90,220,.55,.06,'sawtooth',0,.08), noise(600,1600,.50,.05,'bandpass',0,.1)], { priority:4, gap:.3 });
  sound('boss.hammer.slam', '전 챔피언 · 내려찍기', ROGUE, '경기장을 울리는 가장 무거운 해머 타격입니다.', 'rogue', [tone(80,28,.55,.16), noise(2000,200,.45,.22,'lowpass'), tone(160,60,.40,.07,'triangle'), noise(500,150,.60,.08,'lowpass',.05)], { priority:5, gap:.25 });
  sound('boss.hammer.sweep', '전 챔피언 · 휩쓸기', ROGUE, '넓게 휘두르는 해머가 공기를 가릅니다.', 'rogue', [noise(400,1400,.40,.13,'bandpass',0,.05), tone(70,110,.40,.07,'sine'), noise(2400,800,.20,.06,'bandpass',.2)], { priority:4, gap:.25 });
  sound('boss.hammer.spin', '전 챔피언 · 회전', ROGUE, '해머가 도는 동안 이어지는 휘몰이 소리입니다.', 'rogue', [noise(900,1800,.60,.09,'bandpass',0,.05,3), tone(120,180,.60,.04,'sawtooth')], { priority:4, gap:.3 });
  sound('boss.leap', '전 챔피언 · 도약', ROGUE, '몸이 떠오르는 상승음입니다. 곧 그림자 자리에 떨어집니다.', 'rogue', [tone(200,700,.35,.05,'triangle',0,.02), noise(900,2600,.30,.08,'bandpass')], { priority:4, gap:.3 });
  sound('boss.land', '전 챔피언 · 착지', ROGUE, '큰 몸이 바닥을 찍는 깊은 충격입니다.', 'rogue', [tone(60,25,.60,.18), noise(1600,160,.55,.24,'lowpass'), tone(130,50,.45,.08,'triangle',.02)], { priority:5, gap:.25 });
  sound('boss.shockwave', '전 챔피언 · 충격파', ROGUE, '벽에서 번지는 낮은 파동입니다.', 'rogue', [noise(1200,200,.50,.15,'lowpass',0,.01), tone(90,40,.45,.09), tone(45,30,.60,.07,'sine',.05)], { priority:4, gap:.2 });
  sound('boss.phase', '보스 · 2페이즈', ROGUE, '낮은 화음이 부풀며 보스가 본색을 드러냅니다.', 'rogue', [tone(110,110,.80,.07,'sawtooth',0,.05), tone(165,165,.80,.05,'sawtooth',0,.05), tone(220,440,.60,.04,'triangle',.2), noise(1500,300,.60,.10,'lowpass')], { priority:6, gap:1 });
  sound('boss.down', '보스 · 쓰러짐', ROGUE, '큰 폭발 뒤 두 음이 내려앉으며 보스전을 닫습니다.', 'death', [noise(2600,200,.90,.22,'lowpass'), tone(160,30,.90,.12), tone(523,262,.80,.03,'triangle',.2), tone(392,196,.90,.03,'triangle',.35)], { priority:7, gap:1 });
  sound('boss.magic.charge', '현 챔피언 · 마력 모으기', ROGUE, '높아지는 공명으로 마법 예고를 알립니다.', 'staff', [tone(330,990,.50,.035,'sine',0,.1), tone(495,1485,.50,.02,'triangle',0,.1), noise(3000,7000,.50,.025,'highpass',0,.15)], { priority:3, gap:.2 });
  sound('boss.magic.blink', '현 챔피언 · 순간이동', ROGUE, '사라졌다 나타나는 두 갈래의 짧은 음입니다.', 'staff', [tone(1800,400,.12,.04,'sine'), noise(6000,2000,.10,.05,'highpass'), tone(400,1800,.12,.03,'sine',.08)], { priority:4, gap:.2 });
  sound('boss.magic.rune', '현 챔피언 · 마법진', ROGUE, '바닥에 마법진이 새겨지는 맑은 울림입니다.', 'staff', [tone(880,880,.35,.03,'triangle',0,.03), tone(1320,1320,.30,.02,'sine',.05), tone(660,660,.40,.02,'sine',.1)], { priority:3, gap:.12 });
  sound('boss.magic.beam', '현 챔피언 · 광선', ROGUE, '경기장을 가로지르는 굵은 광선입니다.', 'staff', [noise(3500,1500,.50,.12,'bandpass',0,.01), tone(220,210,.50,.06,'sawtooth'), tone(440,420,.50,.03,'square')], { priority:5, gap:.15 });
  sound('boss.magic.bolt', '현 챔피언 · 마탄', ROGUE, '빠르게 날아가는 짧은 마탄입니다.', 'staff', [tone(1400,500,.14,.05,'sawtooth'), noise(4800,1800,.12,.06,'highpass')], { priority:2, gap:.08, variation:.06 });
  sound('boss.magic.nova', '현 챔피언 · 대폭발', ROGUE, '모든 방향으로 쏟아지는 필살 마법입니다.', 'staff', [noise(4000,300,.80,.20,'lowpass'), tone(1760,220,.70,.05,'sine'), tone(110,40,.80,.12), tone(2640,880,.50,.02,'triangle',.05)], { priority:6, gap:.5 });
  sound('rogue.wave.start', '웨이브 · 시작', ROGUE, '세 음이 올라가며 새 웨이브를 엽니다.', 'rogue', [tone(392,392,.16,.04,'triangle'), tone(523,523,.20,.04,'triangle',.1), tone(784,784,.30,.035,'triangle',.2)], { priority:5, gap:.5 });
  sound('rogue.wave.clear', '웨이브 · 클리어', ROGUE, '밝은 상승음에 반짝임을 얹어 섬멸을 알립니다.', 'ranked', [tone(523,523,.18,.045,'triangle'), tone(659,659,.20,.042,'triangle',.1), tone(784,784,.35,.04,'triangle',.2), tone(1568,1568,.30,.015,'sine',.2)], { priority:6, gap:.6 });
  sound('rogue.run.clear', '런 · 챔피언 등극', ROGUE, '다섯 음 팡파르로 20웨이브 완주를 축하합니다.', 'ranked', [tone(523,523,.22,.05,'triangle',0,.01), tone(659,659,.22,.048,'triangle',.14,.01), tone(784,784,.24,.046,'triangle',.28,.01), tone(1046,1046,.60,.045,'triangle',.42,.02), tone(1318,1318,.70,.03,'sine',.56,.02), tone(2093,2093,.50,.012,'sine',.56,.02), tone(131,65,.40,.06,'sine',.42)], { priority:8, gap:1 });
  sound('rogue.run.fail', '런 · 종료', ROGUE, '네 음이 천천히 내려가며 런을 마칩니다.', 'death', [tone(392,386,.30,.045,'triangle',0,.02), tone(330,324,.30,.042,'triangle',.18,.02), tone(262,257,.34,.042,'triangle',.36,.02), tone(196,190,.55,.045,'triangle',.54,.03)], { priority:6, gap:.8 });

  sound('ui.click', '메뉴 · 선택', '인터페이스', '빠르고 깔끔한 유리 버튼의 클릭입니다.', 'play', [tone(820,610,.065,.042,'sine'), noise(2800,1500,.028,.027)], { priority:3, gap:.045 });
  sound('ui.coin', '코인 · 획득', '인터페이스', '두 번 반짝이는 금속성 음으로 보상을 알립니다.', 'coin', [tone(1175,1160,.17,.038,'sine'), tone(1760,1740,.21,.026,'sine',.075), tone(2350,2320,.10,.009,'sine',.075)], { priority:3, gap:.12 });
  sound('ui.win', '결과 · 승리', '인터페이스', '네 음이 상승하며 맑고 절제된 승리를 연주합니다.', 'ranked', [tone(523,523,.28,.054,'triangle',0,.01), tone(659,659,.30,.05,'triangle',.13,.01), tone(784,784,.33,.048,'triangle',.26,.01), tone(1046,1046,.52,.042,'triangle',.39,.02)], { priority:5, gap:.6 });
  sound('ui.lose', '결과 · 패배', '인터페이스', '날카롭지 않은 세 음이 내려가며 라운드를 마칩니다.', 'death', [tone(440,431,.34,.047,'triangle',0,.018), tone(370,362,.35,.044,'triangle',.17,.018), tone(294,286,.49,.047,'triangle',.34,.025)], { priority:5, gap:.6 });
  sound('ui.countdown', '전투 · 카운트다운', '인터페이스', '짧고 또렷한 준비 신호입니다.', 'time', [tone(660,660,.13,.044,'sine'), tone(1320,1320,.075,.013,'sine')], { priority:4, gap:.2 });
  sound('ui.fight', '전투 · 시작', '인터페이스', '강한 첫 박자 위로 두 음이 힘차게 열립니다.', 'sword', [tone(150,65,.20,.085), tone(523,523,.30,.048,'triangle'), tone(784,784,.36,.039,'triangle',.045), noise(1900,490,.18,.07)], { priority:5, gap:.5 });
  sound('ui.vote.tick', '이벤트 · 추첨 이동', '인터페이스', '빛이 다른 플레이어로 옮겨갈 때 울리는 작은 클릭입니다.', 'watch', [tone(960,690,.054,.035,'sine'), noise(3300,1700,.022,.021)], { priority:3, gap:.035 });
  sound('ui.vote.win', '이벤트 · 당첨', '인터페이스', '선택된 플레이어를 밝은 세 음과 반짝임으로 강조합니다.', 'ranked', [tone(784,784,.24,.045,'triangle'), tone(1046,1046,.30,.042,'triangle',.11), tone(1568,1568,.43,.032,'sine',.22), tone(2093,2093,.33,.015,'sine',.255)], { priority:5, gap:.5 });
  sound('caster.chatter', '선인장 해설자 · 조잘조잘', '인터페이스', '동물의 숲 주민처럼 글자마다 짧고 높은 음절을 냅니다. 대사의 모음과 자음을 따라 입모양이 바뀌고, 문장 끝에서 내려앉고 물음표에서 올라갑니다. 녹음된 목소리는 쓰지 않습니다.', 'skill', chatterLayers(0), {
    priority:-1,gap:.035,
    previewLayers:CHATTER_PREVIEW.flatMap(([vowel,onset,tilt],i)=>chatterLayers(i,false,false,.5,i*.062,{vowel,onset,tilt})),
    source:'오리지널 모음 합성',signature:'글자마다 한 음절 · 높고 짧은 뾱 · 대사 모음 따라가기',
  });

  // The listening room loads the deployed 511fb88 design for exact A/B. It is
  // intentionally not an extra script download on the main game's hot path.
  const design = root.BounceRoyalSoundDesign || (typeof require === 'function' ? require('./audio-design.js') : {});
  const previousDesign = root.BounceRoyalPreviousSoundDesign || (typeof require === 'function' ? require('./audio-design-previous.js') : null);
  // An archive can intentionally leave a cue on its original base definition.
  // Only pages that do not load the archive fall back to the current design.
  const previousById = new Map(definitions.map(def => [def.id, {...def, ...(previousDesign ? previousDesign[def.id] || {} : design[def.id] || {})}]));
  for (const def of definitions) if (design[def.id]) Object.assign(def, design[def.id]);
  const layerDuration = l => Math.max(l.trim || l.dur,l.fallback?.dur || 0) / (l.rate || 1) + (l.delay || 0);
  const durationOf = def => Math.round((Math.max(...(def.previewLayers || def.layers).map(layerDuration)) + .025) * 1000) / 1000;
  const byId = new Map(definitions.map(def => [def.id, def]));
  const catalog = Object.freeze(definitions.map(def => Object.freeze({
    id:def.id, name:def.name, group:def.group, description:def.description, icon:def.icon,
    duration:durationOf(def), previousDuration:durationOf(previousById.get(def.id)),
    variants:Object.freeze(['current','previous']), restored:!!def.restored, revised:!!def.revised, internal:!!def.internal, signature:def.signature || '',
    source:def.source || (def.layers.some(l => l.kind === 'sample') ? (def.restored ? '원본 샘플' : 'CC0 폴리 + 디자인') : def.restored ? '원래 음색 복원' : '절차 합성'),
  })));
  const sampleFiles = Object.freeze({ bow:'fire-bow.mp3', pistol:'fire-pistol.mp3', shotgun:'fire-shotgun.mp3',
    bowDraw:'foley/bow-draw.wav',bowRelease:'foley/bow-release.wav',bowReleaseAlt:'foley/bow-release-alt.wav',
    bladeAir:'foley/blade-air.wav',bladeScrape:'foley/blade-scrape.wav',bladeScrapeAlt:'foley/blade-scrape-alt.wav',
    mechanism:'foley/mechanism.wav',arrowPass:'foley/arrow-pass.wav',
    actionDraw:'foley/action-bow-draw.wav',actionRelease:'foley/action-bow-release.wav',actionMine:'foley/action-mine-place.wav',
    actionDash:'foley/action-dagger-dash.wav',actionSpin:'foley/action-sword-spin.wav',actionFall:'foley/action-fall.wav',
    actionBarrageStart:'foley/action-barrage-start.wav',actionBarrageShot:'foley/action-barrage-shot.wav',actionBarragePreview:'foley/action-barrage-preview.wav',
    casualDraw:'casual/bow-draw.wav',casualRelease:'casual/bow-release.wav',casualPistol:'casual/pistol.wav',casualShotgun:'casual/shotgun.wav',
    casualMine:'casual/mine-place.wav',casualDash:'casual/dagger-dash.wav',casualFall:'casual/fall.wav',casualBarragePreview:'casual/barrage-preview.wav' });
  const fireIds = Object.freeze({ arrow:'weapon.bow.fire', bullet:'weapon.pistol.fire', shotgun:'weapon.shotgun.fire', orb:'weapon.staff.fire', mine:'weapon.mine.place', charge:'skill.bow.release', beam:'augment.beam', missile:'augment.missile', shuriken:'augment.shuriken' });
  const aliases = Object.freeze({ 'fire-bow':'weapon.bow.fire', 'fire-pistol':'weapon.pistol.fire', 'fire-shotgun':'weapon.shotgun.fire' });

  class SoundEngine {
    constructor(options = {}) {
      this.ctx = null;
      this.options = options;
      this._volume = clamp(finite(options.volume, .8), 0, 1);
      this._muted = !!options.muted;
      this.maxVoices = Math.round(clamp(finite(options.maxVoices, 16), 1, 32));
      this.buffers = new Map();
      this.lastAt = new Map();
      this.voices = new Set();
      this.sampleFailures = [];
      this.dropped = 0;
      // Cosmetic pitch variation must never consume the simulation's RNG.
      this._randomState = (finite(options.seed, 0x6a09e667) >>> 0) || 0x6a09e667;
      this._chatterRandomState = this._randomState ^ 0x3c6ef372;
      this._previewVersion = 0;
      this._sampleWaiters = new Set();
      this._document = options.document || root.document;
      this._onVisibility = () => { if (this._document.hidden) this.stopAll(); };
      if (this._document && this._document.addEventListener) this._document.addEventListener('visibilitychange', this._onVisibility);
    }
    get volume() { return this._volume; }
    set volume(value) { this._volume = clamp(finite(value, this._volume), 0, 1); this._applyVolume(); }
    get muted() { return this._muted; }
    set muted(value) { this._muted = !!value; this._applyVolume(); if (this._muted) this.stopAll(); }
    _applyVolume() {
      if (!this.master || !this.ctx) return;
      const param = this.master.gain;
      param.cancelScheduledValues(this.ctx.currentTime);
      param.setValueAtTime(this._muted ? 0 : this._volume * .72, this.ctx.currentTime);
    }
    async ensure() {
      try {
        if (!this.ctx) {
          const Context = this.options.AudioContext || root.AudioContext || root.webkitAudioContext;
          if (!Context) return false;
          this.ctx = new Context({ latencyHint:'interactive' });
          this.master = this.ctx.createGain();
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.value = -17;
          this.compressor.knee.value = 13;
          this.compressor.ratio.value = 8;
          this.compressor.attack.value = .003;
          this.compressor.release.value = .13;
          this.compressor.connect(this.master);
          // Transparent below 0.70: approved quiet Foley/swish is unchanged.
          // Catch the compressor's initial transient when many explosions align.
          if (this.ctx.createWaveShaper) {
            this.limiter = this.ctx.createWaveShaper();
            const curve = new Float32Array(4097);
            for(let i=0;i<curve.length;i++) {
              const x=i/(curve.length-1)*2-1,a=Math.abs(x);
              curve[i]=Math.sign(x)*(a<=.70?a:.70+.28*Math.tanh((a-.70)/.28));
            }
            // Do not oversample this final safety stage: the downsampler's
            // ringing can overshoot its own ceiling on synchronized transients.
            this.limiter.curve=curve;this.limiter.oversample='none';
            this.master.connect(this.limiter).connect(this.ctx.destination);
          } else this.master.connect(this.ctx.destination);
          this._applyVolume();
        }
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        this._loadSamples();
        return this.ctx.state === 'running';
      } catch (_) { return false; }
    }
    _loadSamples() {
      if (this.loading || !this.ctx) return;
      this.loading = true;
      const fetcher = this.options.fetch || (root.fetch && root.fetch.bind(root));
      if (!fetcher) return;
      this.loadPromise = Promise.all(Object.entries(sampleFiles).map(async ([key, file]) => {
        try {
          const response = await fetcher((this.options.assetPath || 'assets/sfx/') + file);
          if (!response.ok) throw new Error('sample unavailable');
          const data = await response.arrayBuffer();
          const decoded = await this.ctx.decodeAudioData(data);
          this.buffers.set(key, decoded);
        } catch (_) { this.sampleFailures.push(key); }
      }));
    }
    _noiseBuffer() {
      if (this._noise) return this._noise;
      const count = Math.ceil(this.ctx.sampleRate * 1.1);
      this._noise = this.ctx.createBuffer(1, count, this.ctx.sampleRate);
      const data = this._noise.getChannelData(0);
      let seed = 0x6357f13d;
      for (let i = 0; i < count; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
      }
      return this._noise;
    }
    _random() {
      let state = this._randomState;
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      this._randomState = state >>> 0;
      return this._randomState / 4294967296;
    }
    play(rawId, options = {}) {
      const id = aliases[rawId] || rawId;
      const def = (options.variant === 'previous' ? previousById : byId).get(id);
      if (!def) return false;
      return this._playDefinition(options.preview && def.previewLayers ? {...def,layers:def.previewLayers} : def, options);
    }
    _playDefinition(def, options) {
      if (this._muted || this._volume <= 0 || !this.ctx || this.ctx.state !== 'running' || (this._document && this._document.hidden)) return false;
      const now = this.ctx.currentTime;
      const gap = Math.max(0, finite(options.gap, def.gap));
      if (!options.preview && this.lastAt.has(def.id) && now - this.lastAt.get(def.id) < gap) return false;
      for (const voice of this.voices) if (voice.endTime <= now) this._finish(voice);
      const priority = finite(options.priority, def.priority);
      if (this.voices.size >= this.maxVoices) {
        const weakest = [...this.voices].sort((a,b) => a.priority - b.priority || a.startTime - b.startTime)[0];
        if (weakest.priority > priority) { this.dropped++; return false; }
        this._finish(weakest);
      }
      if (def.stops) def.stops.forEach(id => this.stop(id));
      const variation = options.preview || !def.variation ? 0 : (this._random() * 2 - 1) * def.variation;
      const rate = clamp(finite(options.rate, 1) * (1 + variation), .5, 2);
      const vol = clamp(finite(options.vol, 1), 0, 2);
      if (vol === 0) return false;
      const voice = { id:def.id, preview:!!options.preview, priority, startTime:now, endTime:now, nodes:[], sources:[], pending:0, finished:false };
      try {
        const gain = this.ctx.createGain();
        gain.gain.value = vol;
        voice.nodes.push(gain);
        voice.output = gain;
        if (this.ctx.createStereoPanner && Number.isFinite(options.pan)) {
          const panner = this.ctx.createStereoPanner();
          panner.pan.value = clamp(options.pan, -.65, .65);
          voice.nodes.push(panner);
          gain.connect(panner).connect(this.compressor);
        } else gain.connect(this.compressor);
        this.voices.add(voice);
        for (const layer of def.layers) this._layer(voice, layer, rate);
        this.lastAt.set(def.id, now);
        return true;
      } catch (_) { this._finish(voice); return false; }
    }
    _layer(voice, rawLayer, rate) {
      const layer = rawLayer.kind === 'sample' && !this.buffers.has(rawLayer.name)
        ? {...rawLayer.fallback,delay:(rawLayer.delay || 0)+(rawLayer.fallback?.delay || 0),rate:rawLayer.rate || 1}
        : rawLayer;
      // A fallback keeps its parent cue's timing, not an unrelated time-zero hit.
      if (!layer) return;
      const t = voice.startTime + (layer.delay || 0);
      const layerRate = rate * (layer.rate || 1);
      let buffer;
      if (layer.kind === 'sample') {
        const candidates = [layer.name,...(layer.alternates || [])].filter(name => this.buffers.has(name));
        const name = candidates[voice.preview ? 0 : Math.floor(this._random() * candidates.length)];
        buffer = this.buffers.get(name);
        if (layer.reverse) {
          if (!this._reversed) this._reversed = new Map();
          if (!this._reversed.has(name)) {
            const reversed = this.ctx.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
            for (let c=0;c<buffer.numberOfChannels;c++) reversed.getChannelData(c).set(buffer.getChannelData(c).slice().reverse());
            this._reversed.set(name,reversed);
          }
          buffer = this._reversed.get(name);
        }
      }
      const duration = (layer.trim || (layer.flat && buffer ? Math.max(.01,buffer.duration - (layer.offset || 0)) : layer.dur)) / layerRate;
      const end = t + duration;
      const env = this.ctx.createGain();
      voice.nodes.push(env);
      if (layer.gainPath) {
        layer.gainPath.forEach(([at,g],i)=>env.gain[i===0?'setValueAtTime':'linearRampToValueAtTime'](Math.max(.0001,g),t+at*duration));
      } else if (layer.flat) {
        env.gain.setValueAtTime(layer.gain,t);
        env.gain.setValueAtTime(layer.gain,Math.max(t,end-.008));
        env.gain.linearRampToValueAtTime(.0001,end);
      } else {
        const floor=layer.floor || .0001;
        env.gain.setValueAtTime(layer.attack===0 ? layer.gain : .0001,t);
        if (layer.attack!==0) env.gain.linearRampToValueAtTime(layer.gain,t+Math.min(duration*.45,layer.attack || .006));
        env.gain.exponentialRampToValueAtTime(floor,end);
      }
      env.connect(voice.output);
      const sweep = (param,points,min,max) => points.forEach(([at,value],i)=>param[i===0?'setValueAtTime':'exponentialRampToValueAtTime'](clamp(value*rate,min,max),t+at*duration));
      const makeFilter = spec => {
        const filter=this.ctx.createBiquadFilter(); filter.type=spec.type;filter.Q.value=spec.q || .8;
        sweep(filter.frequency,spec.path || [[0,spec.f],[1,spec.to]],40,this.ctx.sampleRate*.45);
        voice.nodes.push(filter);return filter;
      };
      let source;
      if (layer.kind === 'tone') {
        source = this.ctx.createOscillator();
        source.type = layer.wave;
        sweep(source.frequency,layer.freqPath || [[0,layer.f],[1,layer.to]],25,this.ctx.sampleRate*.45);
        if (layer.filter && typeof layer.filter==='object') source.connect(makeFilter(layer.filter)).connect(env);
        else source.connect(env);
      } else {
        source = this.ctx.createBufferSource();
        source.buffer = layer.kind === 'sample' ? buffer : this._noiseBuffer();
        source.playbackRate.value = layer.kind === 'sample' ? layerRate : 1 + (voice.preview ? 0 : (this._random()*2-1)*(layer.noiseRateVariation || 0));
        if (layer.kind === 'noise') {
          source.loop = true;
          const filter = makeFilter({type:layer.filter,q:layer.q,f:layer.f,to:layer.to,path:layer.filterPath});
          source.connect(filter).connect(env);
        } else source.connect(env);
      }
      voice.nodes.push(source);
      voice.sources.push(source);
      voice.pending++;
      voice.endTime = Math.max(voice.endTime, end + .025);
      source.onended = () => {
        if (voice.finished) return;
        // Release completed layer graphs immediately, including scheduled tails.
        try { source.disconnect(); env.disconnect(); } catch (_) { /* already closed */ }
        voice.pending--;
        if (voice.pending === 0) this._finish(voice);
      };
      if (layer.kind === 'sample') source.start(t,layer.offset || 0);
      else source.start(t);
      source.stop(end + .025);
    }
    _finish(voice) {
      if (voice.finished) return;
      voice.finished = true;
      for (const source of voice.sources) {
        source.onended = null;
        try { source.stop(); } catch (_) { /* source already ended */ }
      }
      for (const node of voice.nodes) { try { node.disconnect(); } catch (_) { /* context closed */ } }
      this.voices.delete(voice);
    }
    stop(id) { for (const voice of this.voices) if (voice.id === id) this._finish(voice); }
    stopAll() {
      this._previewVersion++;
      for (const waiter of this._sampleWaiters) waiter.finish();
      for (const voice of this.voices) this._finish(voice);
      this.lastAt.clear();
    }
    _waitForSamples() {
      return new Promise(resolve => {
        const waiter = { timer:null, done:false, finish:() => {
          if (waiter.done) return;
          waiter.done = true;
          clearTimeout(waiter.timer);
          this._sampleWaiters.delete(waiter);
          resolve();
        } };
        this._sampleWaiters.add(waiter);
        waiter.timer = setTimeout(waiter.finish, clamp(finite(this.options.previewWaitMs,1500),0,2500));
        this.loadPromise.then(waiter.finish,waiter.finish);
      });
    }
    async preview(id, options = {}) {
      this.stopAll();
      const version = this._previewVersion;
      if (!await this.ensure() || version !== this._previewVersion) return false;
      const def = (options.variant === 'previous' ? previousById : byId).get(aliases[id] || id);
      // Gameplay never waits for network I/O. In the listening room, briefly
      // prefer the finished sample layer over a first-click fallback instead.
      if (def && this.loadPromise && (def.previewLayers || def.layers).some(layer => layer.kind === 'sample' && !this.buffers.has(layer.name) && !this.sampleFailures.includes(layer.name))) await this._waitForSamples();
      if (version !== this._previewVersion) return false;
      return this.play(id, { preview:true, priority:10, variant:options.variant });
    }
    check() {
      return { supported:!!(this.options.AudioContext || root.AudioContext || root.webkitAudioContext), state:this.ctx ? this.ctx.state : 'not-started', muted:this.muted, volume:this.volume, activeVoices:this.voices.size, maxVoices:this.maxVoices, loadedSamples:[...this.buffers.keys()], sampleFailures:[...this.sampleFailures], dropped:this.dropped, sounds:catalog.length };
    }
    ui() { return this.play('ui.click'); }
    hit() { return this.play('battle.hit'); }
    bounce() { return this.play('battle.bounce'); }
    boom() { return this.play('battle.explosion'); }
    skill() { return this.play('skill.activate'); }
    coin() { return this.play('ui.coin'); }
    win() { return this.play('ui.win'); }
    lose() { return this.play('ui.lose'); }
    shoot() { return this.play('weapon.pistol.fire'); }
    slash(weaponId) { return this.play(weaponId === 'dagger' ? 'weapon.dagger.hit' : 'weapon.sword.hit'); }
    fire(kind) { return this.play(fireIds[kind]); }
    chatterSyllable({index = 0, emphasis = false, muffled = false, vowel, onset, tilt = 0} = {}) {
      // Dialogue cadence belongs to the caster controller. No timer or audio
      // context is created here, and this voice cannot displace combat sounds.
      if (this._muted || this._volume <= 0 || !this.ctx || this.ctx.state !== 'running' || this._document?.hidden) return false;
      const now = this.ctx.currentTime;
      // 글자마다 한 음절이라 간격이 짧다(약 62ms). 같은 순간 겹치기만 막는다.
      if (this.lastAt.has('caster.chatter') && now - this.lastAt.get('caster.chatter') < .035) return false;
      let seed = this._chatterRandomState;
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      this._chatterRandomState = seed >>> 0;
      const syllable = Math.abs(Math.trunc(finite(index,0))) % 30;
      return this._playDefinition({id:'caster.chatter',gap:.035,priority:-1,
        layers:chatterLayers(syllable,!!emphasis,!!muffled,this._chatterRandomState/4294967296,0,
          {vowel:Number.isInteger(vowel) ? vowel : undefined,onset,tilt})},{});
    }
    stopChatter() { this.stop('caster.chatter'); this.lastAt.delete('caster.chatter'); }
    tone(freq, duration, type = 'sine', vol = .08, slide = 0, delay = 0) {
      const f = clamp(finite(freq,440), 25, 12000);
      return this._playDefinition({ id:'legacy.tone', gap:0, priority:2, layers:[tone(f, Math.max(25,f + finite(slide,0)), clamp(finite(duration,.1),.02,3), clamp(finite(vol,.08),0,.25), ['sine','triangle','sawtooth','square'].includes(type) ? type : 'sine', clamp(finite(delay,0),0,3))] }, {});
    }
    destroy() {
      this.stopAll();
      if (this._document && this._document.removeEventListener) this._document.removeEventListener('visibilitychange', this._onVisibility);
      if (this.compressor) this.compressor.disconnect();
      if (this.master) this.master.disconnect();
      if (this.limiter) this.limiter.disconnect();
      if (this.ctx && this.ctx.close) this.ctx.close();
    }
  }
  const api = Object.freeze({ create:options => new SoundEngine(options), catalog, samples:sampleFiles });
  root.BounceRoyalAudio = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
