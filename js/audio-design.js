'use strict';
/* Sound direction, separate from playback. Original textures are deliberately
 * protected. Foley is edited CC0 material, not a claim of recording it ourselves.
 * Time paths are fractions of one layer's duration; levels are linear gain. */
(function(root) {
  const T=(f,to,dur,gain,wave='sine',delay=0,attack=.003)=>({kind:'tone',f,to,dur,gain,wave,delay,attack});
  const N=(f,to,dur,gain,q=.8,delay=0,attack=.008,filter='bandpass')=>({kind:'noise',f,to,dur,gain,q,delay,attack,filter});
  const S=(name,dur,gain,fallback,delay=0)=>({kind:'sample',name,dur,gain,fallback,delay,flat:true});
  const D={};
  function set(id,signature,description,layers,restored=false) { D[id]={signature,description,layers,restored,variation:0}; }
  // Match the approved 878ceab sweep, Q, attack and duration. No electronic
  // sine impact is superimposed on these approved blade/projectile textures.
  const swish=(f0,f1,q,vol,dur,attack,delay=0)=>({...N(f0,f1,dur,vol*(q>=4?5:3.2)/.72,q,delay,attack),noiseRateVariation:.08});
  const whoosh=(pitch,vol,dur,delay=0)=>({...N(420*pitch,700*pitch,dur,vol*6/.72,5.5,delay,dur*.2),filterPath:[[0,420*pitch],[.65,2400*pitch],[1,700*pitch]],noiseRateVariation:.1});
  const oldTone=(f,dur,wave,vol,to=f,delay=0)=>({...T(f,to,dur,vol/.72,wave,delay),attack:0,floor:.001/.72});
  const sword=()=>swish(1900,500,2.3,.12,.25,.012);
  const dagger=()=>swish(2700,1250,4.5,.075,.085,.01);
  set('weapon.sword.hit','스겅 — 넓고 묵직한 칼날','마음에 들었던 원래 검 소리. 금속 마찰 같은 거친 칼바람을 그대로 되살렸습니다.',[sword()],true);
  set('weapon.dagger.hit','샥 — 짧고 날카로운 칼날','원래 단검의 짧고 좁은 베기음을 보존했습니다.',[dagger()],true);
  set('weapon.bow.fire','기존 활 발사음','직접 골라 두었던 활 샘플을 추가 전자음 없이 재생합니다.',[S('bow',.28,.5/.72,whoosh(1.2,.08,.14))],true);
  set('weapon.pistol.fire','기존 권총 발사음','직접 골라 두었던 권총 샘플을 보존합니다.',[S('pistol',.08,.4/.72,whoosh(1.5,.05,.08))],true);
  set('weapon.shotgun.fire','기존 산탄 발사음','직접 골라 두었던 산탄 샘플을 보존합니다.',[S('shotgun',.15,.55/.72,whoosh(.7,.11,.2))],true);
  for(const id of ['weapon.bow.fire','weapon.pistol.fire','weapon.shotgun.fire']) D[id].variation=.06;
  set('weapon.staff.fire','지이잉 — 낮게 떨리는 마력','원래 지팡이의 두 톱니파가 만드는 낮고 거친 맥놀이를 복원했습니다.',[1,1.012].map(m=>({...T(128*m,128*m*.82,.3,.042/.72,'sawtooth',0,.03),filter:{type:'lowpass',f:900,to:320,q:1.2}})),true);
  set('weapon.mine.place','딸깍 — 원래 설치음','원래 지뢰의 짧은 설치 클릭입니다.',[oldTone(320,.05,'square',.07,240)],true);
  set('augment.shuriken','휘릭 — 가볍게 스치는 표창','원래 표창의 올라갔다 내려오는 휘릭 소리입니다. 금속 전자음을 덧씌우지 않았습니다.',[whoosh(1.55,.075,.12)],true);
  set('augment.missile','후우릭 — 낮고 긴 미사일','원래 유도미사일의 낮고 묵직한 휘릭거림을 복원했습니다.',[whoosh(.7,.1,.26)],true);
  set('augment.beam','쉬익 — 베어 날리는 검기','원래 검기의 공기를 가르는 소리를 복원했습니다.',[whoosh(1,.1,.18)],true);
  set('battle.bounce','통 — 짧은 벽 반사','원래 벽 반사음을 보존해 전투의 칼바람을 가리지 않습니다.',[oldTone(130,.05,'sine',.07)],true);
  set('battle.hit','작은 타격 피드백','베기음을 덮지 않도록 원래 타격음의 짧은 질감을 낮게 유지합니다.',[oldTone(215,.06,'square',.045)],true);
  set('battle.explosion','부웅 — 원래 폭발 피드백','기본 폭발음은 원래의 짧은 저음을 보존합니다.',[oldTone(90,.3,'sawtooth',.16,35)],true);
  set('skill.activate','원래 스킬 활성화음','기존 공통 스킬 신호입니다.',[oldTone(420,.16,'sine',.11,680)],true);
  set('ui.click','원래 메뉴 클릭','기존 메뉴 버튼의 작은 선택음입니다.',[oldTone(700,.06,'triangle',.1)],true);
  set('ui.countdown','원래 준비 신호','기존 준비 카운트다운의 선택음입니다.',[oldTone(700,.06,'triangle',.1)],true);
  set('ui.coin','띵딩 — 원래 코인 소리','원래 코인의 두 음을 보존했습니다.',[oldTone(880,.08,'triangle',.1),oldTone(1320,.1,'triangle',.08,1320,.07)],true);
  set('ui.win','원래 승리 멜로디','기존 승리 멜로디와 리듬을 보존했습니다.',[523,659,784,1046].map((f,i)=>oldTone(f,.16,'triangle',.12,f,i*.12)),true);
  set('ui.lose','원래 패배 멜로디','기존 패배 멜로디와 리듬을 보존했습니다.',[400,330,262].map((f,i)=>oldTone(f,.2,'sawtooth',.08,f,i*.14)),true);
  set('ui.fight','원래 전투 시작 신호','기존 시작 신호를 보존했습니다.',[oldTone(540,.05,'triangle',.05,400)],true);

  // Real weapon Foley. Let the recording carry the material; synthesis only
  // supplies a restrained string resonance / air tail, not a generic boom.
  set('skill.bow.charge','기리릭… — 활시위를 당기는 장력','실제 장궁을 당기는 목재·시위 마찰음 위로 팽팽해지는 줄의 떨림이 이어집니다.',[
    S('bowDraw',1.34,.24,{...N(650,2100,1.3,.14,3,0,.12),gainPath:[[0,.0001],[.12,.02],[.24,.08],[.28,.03],[.43,.12],[.5,.04],[.67,.14],[.77,.035],[.9,.1],[1,.0001]]}),
    {...T(160,270,1.32,.012,'triangle',.03,.1),gainPath:[[0,.0001],[.25,.003],[.6,.011],[.82,.018],[1,.0001]]}
  ]);
  set('skill.bow.release','피용—쉬익! 시위 해방과 관통','실제 활의 시위가 풀리는 소리, 휘는 줄의 잔향, 원래 관통 바람이 한 번에 나갑니다.',[
    {...S('bowRelease',.43,.55,whoosh(.62,.13,.3)),alternates:['bowReleaseAlt']},
    {...T(580,155,.29,.05,'triangle',.012,.001),freqPath:[[0,580],[.10,320],[.22,480],[.45,260],[1,155]]},
    {...whoosh(.62,.095,.32,.025)}
  ]);
  set('skill.dagger.prepare','찰칵, 스르릉 — 날을 당김','실제 칼날과 칼집이 마찰하는 소리입니다. 낮은 타격음 대신 금속의 긁힘이 먼저 들립니다.',[
    {...S('bladeScrape',.47,.30,swish(3400,1200,4,.055,.32,.015)),alternates:['bladeScrapeAlt']}
  ]);
  set('skill.dagger.dash','쐐애액 — 찢고 지나가는 칼바람','칼날의 실제 풍절음에 짧고 날카로운 원래 단검 질감을 이어 빠르게 관통합니다.',[
    S('bladeAir',.41,.34,swish(3800,680,2.6,.1,.29,.008)),
    swish(4400,900,3.7,.08,.24,.007,.015)
  ]);
  set('skill.sword.spin','스겅—스겅 — 두 바퀴','마음에 들었던 검의 질감으로 0.6초마다 두 번 크게 베어냅니다.',[
    sword(),swish(1900,500,2.3,.12,.25,.012,.6),
    S('bladeAir',.41,.13,N(1600,700,.41,.1),.10),S('bladeAir',.41,.13,N(1600,700,.41,.1),.70)
  ]);
  set('weapon.pistol.reload','철컥…차칵 — 장전 장치','실제 금속 기구의 잠금과 작동음을 잘라 재장전의 두 동작으로 구성했습니다.',[
    S('mechanism',.89,.34,N(3100,800,.12,.16,3)),
    {...N(2900,1400,.035,.11,5,.16,.001),gainPath:[[0,.11],[.2,.04],[1,.0001]]}
  ]);
  set('skill.pistol.barrage','차칵—위리릭 — 회전 난사 준비','금속 장치가 걸린 뒤 짧은 회전 모터가 풀립니다. 실제 총성은 각 발사 순간에 따로 납니다.',[
    {...S('mechanism',.89,.22,N(3200,1200,.12,.13,4)),rate:1.8,offset:.04,trim:.34},
    {...N(2600,800,.24,.09,6,.045,.01),filterPath:[[0,2600],[.2,1400],[.35,2300],[.5,1200],[.7,1800],[1,800]]}
  ]);

  // Material / rhythm families, rather than the same pitch sweep on every cue.
  const crack=(delay,gain=.19)=>({...N(6000,2200,.025,gain,.5,delay,.001,'highpass'),gainPath:[[0,gain],[.16,gain*.4],[1,.0001]]});
  const air=(dur,gain,delay=0)=>N(1900,650,dur,gain,1.2,delay,.03);
  const rumble=(dur,gain,delay=0)=>({...N(230,55,dur,gain,.65,delay,.007,'lowpass'),gainPath:[[0,.0001],[.02,gain],[.15,gain*.5],[.24,gain*.75],[.48,gain*.18],[1,.0001]]});
  set('weapon.mine.explode','팍—푸르릉 — 지면 폭발','마른 격발 파열과 짧은 저역 공기 진동으로 땅에서 터지는 폭발을 만듭니다.',[crack(0,.25),N(2100,160,.35,.30,.7,.004,.005,'lowpass'),rumble(.55,.32)]);
  set('skill.mine.remote','삑삑—콰르릉 — 동시 격발','원격 장치의 두 신호 뒤, 넓은 폭발과 작은 파편이 흩어집니다.',[T(1400,1400,.042,.045,'square'),T(1900,1900,.038,.035,'square',.065),crack(.125,.25),rumble(.65,.42,.13),N(2800,140,.48,.30,.7,.13,.004,'lowpass'),crack(.24,.075),crack(.35,.03)]);
  set('skill.bomb.arm','치지직…틱틱틱 — 도화선','불꽃 같은 불규칙한 마찰과 점점 촘촘해지는 점화 소리입니다.',[N(4100,6200,.82,.10,.6,0,.015,'highpass'),...[0,.25,.44,.59,.70,.78].map((t,i)=>({...crack(t,.035+i*.006),dur:.018}))]);
  set('skill.bomb.explode','콰앙—화르륵 — 시한폭발','단단한 첫 파열 뒤 낮은 공기 충격과 불길이 남습니다. 짧은 둥 소리로 끝나지 않습니다.',[crack(0,.33),N(3700,190,.44,.38,.8,0,.003,'lowpass'),rumble(.85,.46,.008),N(1200,350,.62,.11,1.3,.10,.02),crack(.15,.06)]);
  set('augment.rocket','푸슉—쏴아 — 로켓 분사','점화 파열 다음에 긴 고압 분사음이 뻗습니다. 유도미사일의 휘릭 소리와 구분됩니다.',[crack(0,.12),{...N(550,2900,.63,.26,2,0,.04),gainPath:[[0,.0001],[.12,.20],[.35,.24],[.72,.15],[1,.0001]],filterPath:[[0,550],[.22,2200],[.65,3300],[1,850]]},rumble(.38,.13)]);
  set('augment.lightning','짜직—크르릉 — 낙뢰','날카로운 전기 아크가 불규칙하게 갈라진 뒤 낮은 천둥이 따라옵니다.',[crack(0,.3),crack(.027,.2),crack(.076,.15),crack(.14,.07),rumble(.52,.30,.035),N(1700,260,.25,.16,.9,.035,.003,'lowpass')]);
  set('augment.chain-lightning','지직, 짜직, 찌직 — 전이','서로 다른 간격의 세 전기 아크가 연이어 튑니다.',[crack(0,.19),crack(.073,.16),crack(.19,.12),{...T(1800,420,.08,.026,'sawtooth'),filter:{type:'bandpass',f:2100,to:550,q:2}},N(6300,3400,.22,.035,3,0,.002,'highpass')]);
  set('augment.static','파직 — 순간 방전','금속성 음계 대신 아주 짧고 거친 전기 아크 두 번으로 접촉 방전을 알립니다.',[crack(0,.13),crack(.016,.075),N(3600,800,.065,.09,3,0,.001)]);
  set('augment.flame','화륵, 타닥 — 발화','숨을 내뿜듯 불이 붙고 마른 불씨가 두 번 튑니다.',[N(750,180,.45,.30,.65,0,.03,'lowpass'),crack(.04,.045),crack(.16,.025),crack(.27,.013)]);
  set('augment.shockwave','우웅—퍼엉 — 공기 충격파','낮은 압력 변화와 넓게 퍼지는 공기를 중심으로 파장을 만듭니다.',[rumble(.65,.50),N(1000,120,.42,.28,.9,0,.015,'lowpass'),{...T(64,31,.44,.035),gainPath:[[0,.0001],[.09,.035],[.38,.022],[1,.0001]]}]);
  set('augment.sleep','푸시이이… — 수면 가스','노즐이 열리는 작은 클릭 뒤, 고운 가스가 길게 새어 나옵니다.',[crack(0,.03),{...N(4900,1300,.85,.12,1.2,.025,.04),gainPath:[[0,.0001],[.07,.12],[.40,.10],[.74,.055],[1,.0001]]}]);
  set('augment.freeze','차르륵 — 얼음 결정','서로 맞지 않는 금속·유리 배음이 얼음 조각처럼 시차를 두고 반짝입니다.',[...[0,1,2,3].map((i)=>T([2240,3560,4810,5930][i],[2100,3460,4600,5710][i],.30-i*.025,.026-i*.005,'sine',i*.026,.001)),N(7000,2900,.23,.07,1,0,.012,'highpass')]);
  set('augment.gravity','워르르르—웅 — 중력 흡인','저음의 주기적인 떨림과 거꾸로 빨려드는 바람입니다.',[{...N(900,120,.82,.22,5,0,.06),gainPath:[[0,.0001],[.12,.10],[.2,.025],[.3,.15],[.39,.04],[.5,.21],[.6,.055],[.73,.15],[1,.0001]]},T(56,78,.80,.045,'sine',0,.10),{...T(81,109,.8,.021,'triangle',.012,.1),filter:{type:'lowpass',f:230,to:180,q:1}}]);
  const rubber=(f,delay=0)=>({...T(f,f*.52,.26,.065,'sine',delay,.001),freqPath:[[0,f*1.3],[.07,f*.65],[.18,f],[.4,f*.63],[1,f*.52]]});
  set('skill.basketball.arm','통, 통, 통 — 농구공 탄성','농구공 가죽의 짧은 접촉과 속이 빈 고무 울림을 세 번 반복합니다.',[rubber(180),rubber(180,.19),rubber(180,.38),N(900,380,.05,.12,1,0,.001,'lowpass'),N(900,380,.05,.09,1,.19,.001,'lowpass'),N(900,380,.05,.07,1,.38,.001,'lowpass')]);
  set('skill.basketball.rush','뻥—후아악 — 탄성 돌진','공의 속이 빈 탄성 울림 다음으로 굵은 공기 흐름이 뻗습니다.',[rubber(155),whoosh(.55,.11,.44,.01)]);
  set('skill.balloon.inflate','후우우—끼익 — 고무 팽창','고운 주입 공기 위에 비선형으로 늘어나는 고무의 마찰음을 얹었습니다.',[{...N(1900,2700,.78,.10,2,0,.06),gainPath:[[0,.0001],[.1,.04],[.35,.1],[.72,.10],[1,.0001]]},{...T(320,1100,.70,.035,'triangle',.06,.02),freqPath:[[0,320],[.16,410],[.22,350],[.38,590],[.47,420],[.72,880],[.82,640],[1,1100]],filter:{type:'bandpass',f:1400,to:2300,q:3}}]);
  set('skill.balloon.deflate','피시시시… — 공기 빠짐','작은 틈으로 공기가 떨리며 빠지고 고무 마찰음이 낮아집니다.',[{...N(4200,900,.66,.12,2,0,.008),gainPath:[[0,.01],[.07,.12],[.16,.025],[.25,.1],[.35,.025],[.43,.08],[.6,.06],[1,.0001]]},{...T(1050,150,.51,.025,'triangle',0,.01),freqPath:[[0,1050],[.2,500],[.35,720],[.6,290],[1,150]]}]);
  set('skill.soft.guard','뽀용—둥글게 감싸는 막','부드러운 젤이 펼쳐지는 탄성과 살짝 떨리는 얇은 막의 잔향입니다.',[rubber(430),T(1120,1100,.55,.016,'sine',.07,.008),T(1635,1610,.44,.009,'sine',.083,.006),N(2400,900,.17,.045,2,0,.01)]);
  set('skill.cat.rewind','슈루룩—착 — 시간을 되감음','실제 화살 풍절음을 역재생해 궤적이 빨려들어가는 느낌을 내고 작은 착지음으로 끝냅니다.',[{...S('arrowPass',.97,.26,whoosh(.9,.07,.45)),reverse:true,rate:1.6},N(1100,460,.055,.10,1,.60,.001,'lowpass')]);
  set('skill.rampage.start','그르르—크아 — 거친 폭주','낮은 거친 진동이 끊기듯 올라오며 힘을 켭니다.',[{...T(75,180,.65,.075,'sawtooth',0,.035),filter:{type:'lowpass',f:300,to:1100,q:1.4},gainPath:[[0,.0001],[.08,.05],[.15,.015],[.24,.065],[.33,.023],[.45,.075],[.70,.065],[1,.0001]]},N(350,1200,.51,.12,1.8,0,.08)]);
  set('skill.rampage.end','크르르… — 엔진이 식는 듯한 탈진','폭주 때의 거친 진동이 몇 차례 흔들리며 낮아집니다.',[{...T(165,40,.73,.07,'sawtooth',0,.012),filter:{type:'lowpass',f:850,to:150,q:1.3},gainPath:[[0,.07],[.2,.035],[.3,.055],[.48,.018],[.58,.027],[1,.0001]]},N(1700,240,.46,.07,1.3)]);
  set('skill.staff.overload','지이이잉—쨍 — 마력이 공명함','원래 지팡이의 거친 저음을 키우고 불협 배음의 공명을 펼칩니다.',[...D['weapon.staff.fire'].layers.map(l=>({...l,dur:.62,gain:l.gain*.75,filter:{type:'lowpass',f:700,to:1900,q:1.2}})),T(1460,1420,.64,.022,'sine',.12,.015),T(2237,2200,.5,.014,'sine',.18,.01)]);
  set('augment.summon','뽁—포로롱 — 작은 공의 등장','가벼운 고무 탄성 뒤에 짧은 방울 울림이 이어집니다.',[rubber(510),T(1260,1240,.23,.016,'sine',.1,.003),T(1870,1840,.18,.010,'sine',.16,.002)]);
  set('augment.split','쩍—뽁뽁 — 둘로 갈라짐','막이 찢어지는 마찰 다음에 높이가 다른 두 공의 탄성이 따로 들립니다.',[N(3100,450,.19,.20,2,0,.002),rubber(290,.1),rubber(435,.16)]);
  set('augment.minion-explode','뻑—파사삭 — 작은 폭발','얇은 공이 터지는 작은 폭발과 마른 조각 소리입니다.',[crack(0,.18),N(1900,270,.22,.22,1,0,.002,'lowpass'),crack(.065,.06),crack(.115,.035)]);
  set('augment.last-stand','쿵쿵…쿵쿵 — 마지막 심장박동','마지막 행동 시간이 시작되는 순간 두 번의 심장박동을 알립니다.',[T(57,43,.16,.065,'sine',0,.006),T(75,51,.13,.045,'sine',.14,.006),T(57,43,.16,.055,'sine',.53,.006),T(75,51,.13,.035,'sine',.67,.006)]);
  set('augment.heal','물방울이 피어나는 회복','둔한 타격 대신 물방울의 탄성과 밝고 짧은 배음이 올라옵니다.',[{...rubber(850),gain:.018},T(1700,1670,.32,.015,'sine',.1,.002),T(2550,2500,.23,.008,'sine',.16,.002)]);
  set('augment.steal','스르륵—찰칵 — 무기 강탈','역방향 금속 마찰 뒤에 잠금쇠가 걸려 무기를 가져가는 동작을 표현합니다.',[{...S('bladeScrape',.47,.27,whoosh(.8,.055,.25)),reverse:true},S('mechanism',.89,.14,N(2900,1300,.09,.10,3),.35)]);
  set('augment.reflect','챙! — 튕겨내는 금속','단순 알림음 대신 서로 어긋난 금속 배음으로 튕겨내는 접촉을 냅니다.',[T(1740,1705,.21,.032,'sine',0,.001),T(2761,2710,.14,.021,'sine',.002,.001),T(4050,3990,.085,.011,'sine',.004,.001),N(4200,1700,.06,.09,2,0,.001)]);
  set('battle.death','팍—파사사 — 공이 부서짐','마른 파열과 시간차로 흩어지는 작은 조각들로 전투 종료를 표현합니다.',[crack(0,.14),N(1800,230,.27,.18,1,0,.003,'lowpass'),crack(.065,.05),crack(.12,.035),crack(.23,.02)]);
  root.BounceRoyalSoundDesign=Object.freeze(D);
  if(typeof module==='object' && module.exports) module.exports=root.BounceRoyalSoundDesign;
})(typeof window!=='undefined'?window:globalThis);
