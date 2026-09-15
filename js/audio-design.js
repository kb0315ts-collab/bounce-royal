'use strict';
/* Casual arena mix: short material attacks, buoyant characters, friendly UI.
 * The approved sword/shuriken/missile air textures remain exact. New WAVs are
 * authored offline edits of credited CC0 material, not new field recordings. */
(function(root) {
  const T=(f,to,dur,gain,wave='sine',delay=0,attack=.003)=>({kind:'tone',f,to,dur,gain,wave,delay,attack});
  const N=(f,to,dur,gain,q=.8,delay=0,attack=.004,filter='bandpass')=>({kind:'noise',f,to,dur,gain,q,delay,attack,filter});
  const S=(name,dur,gain,fallback,delay=0)=>({kind:'sample',name,dur,gain,fallback,delay,flat:true});
  const D={};
  function set(id,signature,description,layers,retained=false) {
    D[id]={signature,description,layers,restored:retained,revised:!retained,variation:0,
      source:retained?'승인된 칼날·바람 재질 유지':layers.some(l=>l.kind==='sample')?'캐주얼 폴리 편집':'캐주얼 물성 합성'};
  }
  const swish=(f0,f1,q,vol,dur,attack,delay=0)=>({...N(f0,f1,dur,vol*(q>=4?5:3.2)/.72,q,delay,attack),noiseRateVariation:.08});
  const whoosh=(pitch,vol,dur,delay=0)=>({...N(420*pitch,700*pitch,dur,vol*6/.72,5.5,delay,dur*.2),filterPath:[[0,420*pitch],[.65,2400*pitch],[1,700*pitch]],noiseRateVariation:.1});
  const sword=()=>swish(1900,500,2.3,.12,.25,.012);
  // 쇠사슬 — 쇳덩이가 둔탁하게 박히는 소리. 검의 '슈욱'과 달리 짧고 낮게 끝난다.
  const chainHit=()=>swish(900,220,2.0,.11,.12,.006);
  const dagger=()=>swish(2700,1250,4.5,.075,.085,.01);
  const click=(f,g,at=0)=>({...N(f,f*.7,.023,g,1.1,at,.001),gainPath:[[0,0],[.04,g],[.22,g*.28],[1,0]]});
  const elastic=(f,dur,g,at=0)=>({...T(f,f*.57,dur,g,'sine',at,.001),freqPath:[[0,f*1.5],[.10,f*.72],[.23,f],[.48,f*.64],[1,f*.57]]});
  const bell=(f,dur,g,at=0)=>T(f,f*.997,dur,g,'sine',at,.001);
  const reed=(f,dur,g,at=0)=>({...T(f,f,dur,g,'triangle',at,.004),filter:{type:'lowpass',f:f*4,to:f*2,q:.7}});
  const wood=(f,g,at=0)=>({...T(f,f*.85,.065,g,'triangle',at,.001),filter:{type:'bandpass',f:f*2.4,to:f*1.8,q:1.4}});
  const crack=(at=0,g=.14)=>N(5200,1600,.026,g,.6,at,.001,'highpass');

  // Protected signatures: one material layer, never buried under an extra ding.
  set('weapon.sword.hit','스겅! · 묵직한 칼날','익숙한 검의 거친 금속 마찰과 넓은 칼바람을 그대로 유지합니다.',[sword()],true);
  set('weapon.dagger.hit','샥! · 재빠른 칼끝','짧고 좁게 스치는 단검의 기존 칼날 질감을 유지합니다.',[dagger()],true);
  set('weapon.shield.throw','휘잉— · 방패 투척','금속판이 공기를 가르며 회전해 나가는 소리입니다.',
    [N(1400,620,.22,.24,.9,0,.008), T(520,240,.16,.05,'triangle',.006)]);
  set('weapon.shield.hit','텅! · 방패 적중','넓은 판이 부딪히는 둔탁하고 단단한 충격음입니다.',
    [N(1100,380,.10,.28,.8), T(240,150,.09,.06,'triangle',.004)]);
  set('weapon.shield.catch','탁! · 방패 회수','손에 걸리는 짧은 금속 접촉음으로 다시 무장했음을 알립니다.',
    [N(2600,900,.055,.16,.9,0,.002), T(680,900,.07,.04,'triangle',.004)]);
  set('weapon.flame.spray','쉭— · 타오르는 분사','낮은 연소음과 새는 바람을 겹쳐 끊기지 않고 이어지는 분사를 만듭니다.',
    [N(900,420,.26,.19,.8,0,.03,'lowpass'), N(4200,2600,.24,.055,.9,.01,.04,'highpass'), T(120,96,.22,.045,'triangle',.01)]);
  set('weapon.chain.hit','퍽! · 쇳덩이 타격','짧고 낮게 끝나는 금속 타격에 사슬이 팽팽해지는 쇳소리를 얹었습니다.',
    [chainHit(), click(520,.05,.01), T(190,150,.07,.05,'triangle',.005)]);
  set('skill.chain.swap','휭—! · 자리바꿈','짧게 빨아들였다 튕겨 나가는 두 겹 소리로 위치가 뒤바뀐 순간을 표시합니다.',
    [N(500,2100,.11,.16,3.2,0,.004), T(760,300,.13,.06,'triangle',.03)]);
  set('augment.shuriken','휘릭! · 작은 회전','올라갔다 내려오는 표창의 짧은 휘릭 소리를 유지합니다.',[whoosh(1.55,.075,.12)],true);
  set('augment.missile','후우릭! · 길게 추적','표창보다 낮고 길게 도는 미사일의 익숙한 바람을 유지합니다.',[whoosh(.7,.1,.26)],true);
  set('augment.beam','쉬익! · 날아가는 검기','검기의 날카로운 바람 재질을 유지해 칼날과 자연스럽게 이어집니다.',[whoosh(1,.1,.18)],true);

  set('weapon.bow.fire','툭, 슉! · 가벼운 화살','기존 활 발사의 짧은 접촉음을 보존해 강한 차지 샷과 대비시켰습니다.',[S('bow',.28,.5/.72,whoosh(1.2,.08,.14))]);
  set('weapon.pistol.fire','팍, 찰칵! · 또렷한 한 발','짧은 약실 파열과 가벼운 장전기 복귀음으로 연사를 또렷하게 만듭니다.',[S('casualPistol',.11,.57,N(3400,850,.075,.22,.9,0,.001,'lowpass'))]);
  set('weapon.shotgun.fire','퍼팍! · 넓은 산탄','권총보다 넓은 파열과 나무통 같은 속 빈 울림이 짧게 터집니다.',[S('casualShotgun',.24,.64,N(2700,460,.20,.28,.8,0,.002,'lowpass'))]);
  for(const id of ['weapon.bow.fire','weapon.pistol.fire','weapon.shotgun.fire']) D[id].variation=.04;
  set('weapon.pistol.reload','차칵, 철컥 · 탄창 교체','긴 마찰을 줄이고 금속 걸쇠 두 동작을 가볍고 또렷하게 들려줍니다.',[
    {...S('mechanism',.89,.26,N(2800,1300,.10,.11,2.8)),offset:.04,trim:.17,rate:1.35},
    {...S('mechanism',.89,.30,N(3500,1700,.07,.12,3)),offset:.46,trim:.10,rate:1.5,delay:.19},
  ]);
  set('weapon.staff.fire','뾰옹 · 둥근 마법탄','속이 빈 마법 방울이 튀어나오며 낮고 부드러운 공명을 남깁니다.',[
    {...T(420,175,.21,.064,'triangle',0,.003),freqPath:[[0,310],[.08,510],[.28,300],[1,175]],filter:{type:'lowpass',f:1800,to:540,q:1}},
    bell(1050,.13,.018,.014),N(2300,1000,.06,.045,2),
  ]);
  set('weapon.mine.place','톡, 딸칵 · 지뢰 준비','작은 케이스가 놓인 뒤 두 잠금쇠가 맞물리는 짧고 장난감 같은 기계음입니다.',[S('casualMine',.23,.52,N(1900,900,.085,.18,1.2))]);
  set('weapon.mine.explode','파팡! · 지면 폭발','바닥에서 터지는 짧은 파열과 둥근 공기 충격으로 무게를 표현합니다.',[
    crack(0,.16),N(2300,420,.23,.26,.75,0,.002,'lowpass'),
    {...T(165,62,.24,.12,'triangle'),filter:{type:'lowpass',f:780,to:240,q:.7}},
    click(2200,.035,.075),
  ]);

  set('skill.bow.charge','기리릭… · 시위 당기기','두 번 당기는 줄 마찰과 마지막 팽팽한 떨림을 밝고 짧게 편집했습니다.',[
    S('casualDraw',1.22,.43,{...N(1300,2900,1.22,.16,2.5,0,.02),gainPath:[[0,0],[.12,.1],[.34,.16],[.41,.045],[.67,.18],[.88,.14],[1,0]]}),
  ]);
  set('skill.bow.release','트윙—피슝! · 차지 발사','실제 시위 접촉을 바탕으로 탄력 있는 줄 배음과 빠른 화살 바람을 더했습니다.',[S('casualRelease',.37,.78,whoosh(1.15,.12,.32))]);
  set('skill.dagger.prepare','찰칵—스릉 · 돌진 준비','금속 칼집에서 날을 꺼내는 마찰을 짧게 압축해 출발을 예고합니다.',[
    {...S('bladeScrape',.47,.32,swish(3400,1200,4,.055,.27,.012)),rate:1.35,trim:.40,alternates:['bladeScrapeAlt']},
  ]);
  set('skill.dagger.dash','쐐액! · 관통 돌진','거친 칼끝이 빠르게 지나가는 밝은 바람. 폭발음 없이도 속도가 들립니다.',[S('casualDash',.28,.66,swish(5100,700,2.8,.11,.28,.008))]);
  set('skill.sword.spin','스겅—스겅! · 두 바퀴','승인된 검의 칼날 질감을 두 번 크게 휘둘러 회전 동작을 강조합니다.',[
    sword(),{...sword(),delay:.5},N(1200,620,.70,.035,1.2,.12,.04),
  ]);
  set('skill.pistol.barrage','차칵! · 회전 난사','짧은 금속 걸쇠가 풀립니다. 실제 총성은 각 탄환 발사에 맞춰 재생됩니다.',[
    {...S('actionBarrageStart',.24,.34,N(2900,1400,.09,.16,1.8)),rate:1.2,trim:.24},
  ]);
  D['skill.pistol.barrage'].name='권총 · 회전 난사';
  D['skill.pistol.barrage'].previewLayers=[...D['skill.pistol.barrage'].layers,
    S('casualBarragePreview',1.56,.59,{...N(3000,1200,1.56,.13,1.4),gainPath:[[0,.15],[.06,0],[.08,.15],[.14,0],[.16,.15],[.22,0],[.24,.15],[.30,0],[.32,.15],[.38,0],[.40,.15],[.46,0],[.48,.15],[.54,0],[.56,.15],[.62,0],[.64,.15],[.70,0],[.72,.15],[.78,0],[.80,.15],[.86,0],[.88,.15],[.94,0],[1,0]]}),
  ];
  set('weapon.pistol.barrage-shot','팍! · 난사 중 한 발','회전 난사의 실제 발사 순간에만 재생하는 짧고 마른 격발음입니다.',[S('casualPistol',.11,.49,N(3400,850,.075,.20,.9,0,.001,'lowpass'))]);
  set('skill.staff.overload','포로롱—뾰앙 · 마력 팽창','마법 방울이 세 단계로 부풀어 오르며 부드러운 유리 공명이 펼쳐집니다.',[
    elastic(260,.20,.064),elastic(390,.23,.056,.09),elastic(520,.32,.046,.19),
    bell(1568,.39,.024,.22),bell(2352,.29,.009,.27),
  ]);
  set('skill.mine.remote','삑, 삑! · 원격 신호','짧은 두 신호와 기계 클릭으로 폭파 예약을 알립니다. 실제 폭발은 지뢰가 터질 때 들립니다.',[
    {...T(1420,1420,.042,.036,'square'),filter:{type:'lowpass',f:2600,to:2400,q:.7}},
    {...T(1900,1900,.045,.030,'square',.08),filter:{type:'lowpass',f:3500,to:3000,q:.7}},click(2700,.10,.16),
  ]);

  set('skill.cat.rewind','슈루룩—뽁 · 되돌아가기','바람이 짧게 거꾸로 빨려들고 작은 탄성음으로 이전 위치에 착지합니다.',[
    {...S('arrowPass',.97,.23,whoosh(1.1,.065,.38)),reverse:true,rate:2.3,trim:.85},
    elastic(410,.14,.042,.35),wood(520,.025,.36),
  ]);
  set('skill.rampage.start','부릉—얍! · 폭주 시작','짧게 두 번 힘을 모으는 장난감 엔진과 거친 숨결로 활기 있게 출발합니다.',[
    {...T(118,236,.34,.065,'sawtooth',0,.006),filter:{type:'lowpass',f:420,to:1500,q:1},gainPath:[[0,0],[.08,.06],[.25,.017],[.37,.07],[.60,.065],[1,0]],freqPath:[[0,118],[.20,165],[.26,125],[.60,270],[1,236]]},
    N(1700,850,.12,.075,1.4,.19,.002),
  ]);
  set('skill.rampage.end','부르르… · 폭주 종료','장난감 모터의 떨림이 세 번 작아지며 가볍게 힘이 빠집니다.',[
    {...T(220,92,.36,.045,'triangle',0,.002),freqPath:[[0,220],[.22,145],[.36,178],[.57,118],[.72,134],[1,92]],gainPath:[[0,.045],[.20,.022],[.36,.037],[.58,.015],[.72,.022],[1,0]]},N(1300,480,.20,.035,1.3),
  ]);
  set('skill.soft.guard','뽀요옹 · 말랑 보호막','젤리가 둥글게 퍼지는 탄성 뒤로 얇고 투명한 막의 공명이 남습니다.',[
    elastic(520,.32,.068),elastic(830,.24,.022,.05),bell(1395,.30,.014,.08),N(2100,1100,.08,.030,1.5),
  ]);
  set('skill.bomb.arm','치직, 틱틱! · 점화','작은 도화선 마찰과 점차 촘촘해지는 틱 소리로 폭발을 기다리게 합니다.',[
    {...N(4300,5600,.81,.065,.7,0,.005,'highpass'),gainPath:[[0,0],[.08,.065],[.8,.045],[1,0]]},
    ...[0,.27,.47,.63,.76].map((t,i)=>click(3100+i*180,.048+i*.004,t)),
  ]);
  set('skill.bomb.explode','콰팡! · 둥근 대폭발','큰 풍선처럼 통 크게 터지고 짧은 파편이 톡톡 튀는 경쾌한 폭발입니다.',[
    crack(0,.23),N(3100,340,.29,.32,.8,0,.002,'lowpass'),
    {...T(190,54,.30,.14,'triangle'),filter:{type:'lowpass',f:950,to:280,q:.7}},wood(480,.024,.09),click(2500,.045,.14),
  ]);
  set('skill.basketball.arm','통, 통! · 탄성 준비','빈 농구공의 가죽 접촉과 속 울림이 점점 빠르게 세 번 튑니다.',[
    elastic(205,.15,.082),elastic(215,.13,.060,.17),elastic(240,.11,.045,.30),
    N(1200,560,.035,.073,1,0,.001,'lowpass'),N(1250,610,.03,.052,1,.17,.001,'lowpass'),
  ]);
  set('skill.basketball.rush','뻥—휙! · 농구 돌진','공이 힘차게 튀어나오는 탄성음 뒤에 짧고 굵은 바람이 붙습니다.',[
    elastic(225,.20,.12),whoosh(.65,.075,.27,.025),wood(410,.025),
  ]);
  set('skill.balloon.inflate','후우—삐요옹 · 팽창','바람이 들어가며 고무가 두 번 끼익 늘어나고 밝게 부풉니다.',[
    {...N(2100,3100,.46,.083,1.7,0,.03),gainPath:[[0,0],[.12,.065],[.70,.083],[1,0]]},
    {...T(310,810,.43,.029,'triangle',.02,.004),freqPath:[[0,310],[.24,430],[.31,340],[.64,680],[.72,540],[1,810]],filter:{type:'bandpass',f:1100,to:2300,q:2.2}},
  ]);
  set('skill.balloon.deflate','피리리—푸 · 팽창 종료','고무 틈에서 공기가 떨리며 빠지고 작고 우스운 울림으로 마무리합니다.',[
    {...N(3800,1100,.38,.086,1.8,0,.004),gainPath:[[0,.02],[.1,.086],[.24,.04],[.35,.075],[.50,.026],[.67,.049],[1,0]]},
    {...T(720,190,.32,.027,'triangle'),freqPath:[[0,720],[.18,430],[.34,590],[.55,300],[.70,375],[1,190]]},
  ]);

  set('augment.rocket','푸슉—쏴! · 로켓 관통','작은 점화 뒤 고압 공기가 빠르게 뻗습니다. 낮게 도는 유도미사일과 구별됩니다.',[
    crack(0,.065),{...N(900,3200,.40,.22,2.2,0,.015),filterPath:[[0,900],[.16,2300],[.5,3400],[1,1100]],gainPath:[[0,0],[.12,.17],[.32,.22],[.63,.15],[1,0]]},
  ]);
  set('augment.lightning','짜직—팟! · 낙뢰','서로 다른 간격의 전기 아크와 짧은 공기 파열로 번쩍이는 순간을 살립니다.',[
    crack(0,.21),crack(.021,.12),crack(.057,.075),N(2200,510,.15,.13,.8,.02,.002,'lowpass'),
    {...T(740,230,.075,.026,'sawtooth'),filter:{type:'bandpass',f:2600,to:700,q:1.8}},
  ]);
  set('augment.chain-lightning','찌직, 짜직! · 연쇄 전기','두 방향으로 짧게 튀는 전기음의 간격과 높이를 다르게 구성했습니다.',[
    crack(0,.14),crack(.061,.10),crack(.15,.07),
    {...T(1550,650,.065,.028,'sawtooth'),filter:{type:'bandpass',f:3400,to:1200,q:2.1}},
    {...T(2350,880,.07,.019,'sawtooth',.14),filter:{type:'bandpass',f:4100,to:1600,q:2.4}},
  ]);
  set('augment.static','파직! · 접촉 방전','거친 전기 접촉이 아주 짧게 두 번 튀어 자주 발동해도 귀를 덜 가립니다.',[crack(0,.095),crack(.018,.045),N(3100,1300,.045,.07,2.7,0,.001)]);
  set('augment.shockwave','퍼웅! · 둥근 충격파','넓게 열리는 짧은 공기 파동과 속이 빈 저음으로 원형 파장을 표현합니다.',[
    {...T(145,64,.24,.084,'triangle',0,.006),filter:{type:'lowpass',f:650,to:210,q:.8}},
    {...N(900,240,.28,.24,1.2,0,.016,'lowpass'),gainPath:[[0,0],[.13,.22],[.30,.24],[.62,.085],[1,0]]},
  ]);
  set('augment.sleep','푸시이… · 수면 가스','작은 노즐 클릭 뒤 부드러운 공기가 퍼지며 조용히 내려앉습니다.',[
    click(2100,.023),{...N(4500,1500,.54,.088,1.1,.014,.023),gainPath:[[0,0],[.12,.088],[.50,.060],[1,0]]},
  ]);
  set('augment.gravity','워로로—웅 · 중력 흡인','짧게 맥동하는 속 빈 저음과 뒤로 빨려드는 바람을 사용했습니다.',[
    {...T(135,98,.49,.047,'triangle',0,.014),freqPath:[[0,135],[.15,108],[.31,165],[.47,113],[.65,151],[1,98]],filter:{type:'lowpass',f:510,to:280,q:1.1}},
    {...N(1400,400,.43,.13,3.2,0,.022),gainPath:[[0,0],[.14,.06],[.25,.023],[.39,.10],[.50,.030],[.67,.13],[1,0]]},
  ]);
  set('augment.split','뽁—뽁뽁! · 두 공으로 분열','막이 짧게 갈라진 뒤 높이가 다른 두 공이 각각 튀어나옵니다.',[
    N(2900,750,.070,.11,1.8,0,.001),elastic(370,.16,.066,.055),elastic(560,.15,.053,.135),wood(690,.023,.15),
  ]);
  set('augment.minion-explode','파폭! · 작은 복수','작은 공이 바삭하게 터지고 두 조각이 가볍게 튀는 효과음입니다.',[
    crack(0,.10),N(2300,560,.145,.19,1,0,.001,'lowpass'),elastic(330,.095,.050,.012),click(2600,.031,.095),
  ]);
  set('augment.last-stand','두근, 두근! · 마지막 기회','또렷하지만 위협적이지 않은 두 차례의 심장박동으로 마지막 행동 시간을 알립니다.',[
    T(118,88,.13,.060,'sine',0,.005),T(154,104,.10,.040,'sine',.12,.004),
    T(118,88,.13,.050,'sine',.42,.005),T(154,104,.10,.031,'sine',.54,.004),
  ]);
  set('augment.heal','또록, 반짝 · 생명력 회복','작은 물방울이 올라오고 맑은 두 음이 살짝 피어납니다.',[
    elastic(980,.13,.024),bell(1480,.22,.023,.075),bell(2220,.17,.011,.12),
  ]);
  set('augment.frost','차르륵! · 냉기 결정','높이가 맞지 않는 얇은 결정들이 짧게 부딪쳐 차가운 재질을 만듭니다.',[
    bell(2470,.18,.022),bell(3610,.16,.014,.022),bell(4790,.12,.009,.044),N(6200,3000,.10,.040,1,0,.004,'highpass'),
  ]);
  set('augment.reflect','챙! · 반사 충전','작은 금속 원판의 밝은 접촉음과 두 배음이 즉시 위로 튀어오릅니다.',[
    bell(1630,.14,.032),bell(2580,.11,.018,.003),bell(3749,.073,.009,.006),N(3800,1700,.034,.060,2.2,0,.001),
  ]);
  set('battle.hit','톡! · 작은 타격','짧고 마른 접촉음으로 피해를 표시하며 무기 고유 소리를 가리지 않습니다.',[wood(370,.040),N(1550,730,.022,.029,1.1,0,.001,'lowpass')]);
  set('battle.bounce','통! · 벽 반사','작은 고무공이 벽을 치는 속 빈 탄성으로 경기의 바운스를 살립니다.',[elastic(210,.065,.040),N(950,560,.015,.018,1,0,.001,'lowpass')]);
  set('battle.explosion','팡! · 기본 폭발','짧은 파열과 둥근 공기 압력으로 가볍지만 분명하게 터집니다.',[N(2300,480,.19,.21,.8,0,.001,'lowpass'),T(156,72,.17,.072,'triangle'),crack(0,.068)]);
  set('battle.death','퍽, 토독 · 쓰러짐','공이 작게 터지고 가벼운 후속 접촉 두 번으로 전투 종료를 표현합니다.',[S('casualFall',.35,.58,N(1700,410,.29,.20,1.1,0,.003,'lowpass'))]);
  set('skill.activate','뾱! · 스킬 사용','작은 탄성과 짧은 올라감으로 능력 사용을 또렷하게 알려줍니다.',[elastic(640,.16,.045),bell(1280,.13,.016,.05)]);

  // UI is a small wooden toy / reward instrument family, not weapon impacts.
  set('ui.click','톡 · 버튼 선택','가벼운 나무 버튼을 누르는 짧은 두 재질음으로 손맛을 줍니다.',[wood(840,.069),click(3100,.023)]);
  set('ui.countdown','똑! · 준비 카운트','단단한 우드블록의 한 박자로 준비 숫자를 분명하게 구분합니다.',[wood(1050,.082),T(1730,1680,.045,.014,'sine')]);
  set('ui.fight','따단! · 경기 시작','짧고 경쾌한 두 화음으로 경기가 시작되는 순간을 엽니다.',[
    reed(523,.10,.042),reed(784,.10,.030),reed(1046,.20,.049,.085),reed(1568,.18,.026,.085),wood(430,.036),
  ]);
  set('ui.coin','팅, 띠링! · 코인 획득','동전 두 개가 서로 부딪히며 위로 반짝이는 짧은 금속 울림입니다.',[
    bell(1318,.14,.042),bell(2087,.10,.014),bell(1976,.21,.035,.065),bell(3136,.14,.012,.068),
  ]);
  set('ui.win','따다라—딩! · 승리','짧은 장난감 악기 선율과 마지막 밝은 화음으로 승리를 축하합니다.',[
    reed(659,.13,.055),reed(784,.13,.052,.105),reed(1046,.15,.051,.21),
    reed(1318,.35,.040,.335),reed(1046,.31,.030,.335),bell(2637,.29,.012,.35),
  ]);
  set('ui.lose','뽀, 뽀옹 · 다음 판으로','거친 경고음 대신 부드러운 두 음과 짧은 탄성으로 아쉽게 마무리합니다.',[
    reed(494,.14,.045),{...reed(392,.29,.047,.16),freqPath:[[0,415],[.17,392],[1,383]]},elastic(196,.13,.025,.17),
  ]);
  set('ui.vote.tick','틱 · 추첨 이동','빠른 추첨에도 겹치지 않는 작고 바삭한 나무 클릭입니다.',[wood(1340,.047),click(3900,.015)]);
  set('ui.vote.win','따르릉! · 이벤트 당첨','세 개의 밝은 금속 음과 마지막 화음으로 당첨을 즐겁게 알려줍니다.',[
    bell(1046,.16,.035),bell(1568,.21,.034,.075),bell(2093,.30,.027,.155),
    reed(784,.27,.026,.15),bell(3136,.20,.010,.19),
  ]);
  // Deliberately absent: augment.flame, augment.summon, augment.steal, augment.freeze.
  root.BounceRoyalSoundDesign=Object.freeze(D);
  if(typeof module==='object'&&module.exports)module.exports=root.BounceRoyalSoundDesign;
})(typeof window!=='undefined'?window:globalThis);
