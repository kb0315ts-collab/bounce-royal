'use strict';
/* Presentation only: concise fact-based copy and bounded, render-only replays. */
(function(root) {
  const sourceNames = {
    'augment:shuriken':'표창', 'augment:missile':'유도 미사일', 'augment:swordBeam':'검기',
    'augment:staticShock':'정전기', 'augment:shockwave':'충격파', 'augment:chainQuake':'벽 강타', 'augment:lightning':'번개',
    'augment:chainBolt':'연쇄 번개', 'augment:satellite':'위성체', 'augment:miniBall':'꼬마볼',
    'augment:minionRevenge':'복수하는 부하', 'augment:bayonet':'총검술', 'augment:thornLeash':'가시목줄',
    'augment:rocketStart':'로켓 관통', 'dot:bleed':'출혈', 'dot:flame':'화염 흔적',
  };
  const name = value => Array.from(String(value || '선수')).slice(0,12).join('');
  const number = value => Math.round(Math.max(0, value || 0) * 10) / 10;
  /* 대사를 음절 악보로 바꾼다 — 동물의 숲 주민 말투.
   * 글자 하나(한글 음절·영문자·숫자)가 짧은 음절 하나다. 모음은 그 글자의 모음을
   * 따르고, ㅅ·ㅈ·ㅊ·ㅎ은 쉿, ㄱ·ㄷ·ㅂ 계열은 톡 하는 자음 앞머리를 단다.
   * 띄어쓰기와 문장부호에서는 쉬고, 말 덩어리마다 높게 시작해 조금씩 내려앉는다.
   * 물음표 앞 음절은 올리고, 느낌표 앞 음절도 살짝 올린다.
   * 난수 없이 글자만으로 정해지므로 같은 대사는 늘 같은 말투로 나온다. */
  const VOICE_STEP_MS = 62, VOICE_MAX_MS = 2400;
  // 중성 21개 -> 모음 소리 7가지 (0 ㅏ, 1 ㅔ, 2 ㅓ, 3 ㅗ, 4 ㅜ, 5 ㅡ, 6 ㅣ)
  //                  ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅗ ㅘ ㅙ ㅚ ㅛ ㅜ ㅝ ㅞ ㅟ ㅠ ㅡ ㅢ ㅣ
  const JUNG_VOWEL = [0, 1, 0, 1, 2, 1, 2, 1, 3, 0, 1, 1, 3, 4, 2, 1, 6, 4, 5, 6, 6];
  //                  ㄱ     ㄲ     ㄴ    ㄷ     ㄸ     ㄹ    ㅁ    ㅂ     ㅃ     ㅅ      ㅆ      ㅇ    ㅈ      ㅉ      ㅊ      ㅋ     ㅌ     ㅍ     ㅎ
  const CHO_ONSET = ['pop','pop',null,'pop','pop',null,null,'pop','pop','hiss','hiss',null,'hiss','hiss','hiss','pop','pop','pop','hiss'];
  const LATIN_VOWEL = { a:0, e:1, i:6, o:3, u:4, y:6 };
  // 0~9를 읽을 때의 모음: 영 일 이 삼 사 오 육 칠 팔 구
  const DIGIT_VOWEL = [2, 6, 6, 0, 0, 3, 4, 6, 0, 4];
  function voiceScript(text) {
    const steps = [];
    for (const ch of Array.from(String(text == null ? '' : text))) {
      const code = ch.codePointAt(0);
      let syllable = null;
      if (code >= 0xac00 && code <= 0xd7a3) {
        const k = code - 0xac00;
        syllable = { vowel: JUNG_VOWEL[Math.floor((k % 588) / 28)], onset: CHO_ONSET[Math.floor(k / 588)] };
      } else if (/^[a-z]$/i.test(ch)) {
        const c = ch.toLowerCase();
        syllable = { vowel: c in LATIN_VOWEL ? LATIN_VOWEL[c] : 5,
          onset: 'szcfhxj'.includes(c) ? 'hiss' : 'bdgkpt'.includes(c) ? 'pop' : null };
      } else if (/^[0-9]$/.test(ch)) syllable = { vowel: DIGIT_VOWEL[Number(ch)], onset: null };
      if (syllable) { steps.push({ ...syllable, tilt: 0, wait: VOICE_STEP_MS }); continue; }
      const last = steps[steps.length - 1];
      if (!last) continue;
      if (ch === ' ') last.wait += 40;
      else if (ch === ',') last.wait += 130;
      else if (ch === '.' || ch === '…') last.wait += 170;
      else if (ch === '!') { last.tilt += .14; last.wait += 120; }
      else if (ch === '?') { last.tilt += .26; last.wait += 150; }
      else if (ch === '~') { last.tilt += .06; last.wait += 80; }
    }
    // 말 덩어리(100ms 넘게 쉬는 자리까지)마다 높게 시작해 내려앉는다
    let from = 0;
    steps.forEach((s, i) => {
      if (i < steps.length - 1 && s.wait < VOICE_STEP_MS + 100) return;
      const n = i - from + 1;
      for (let j = from; j <= i; j++) steps[j].tilt += .07 - .12 * (n > 1 ? (j - from) / (n - 1) : 0);
      from = i + 1;
    });
    // 음절마다 조금씩 흔들린다. 난수 대신 자리와 모음에서 뽑는다.
    steps.forEach((s, i) => { s.tilt = Math.round((s.tilt + (((i * 7 + s.vowel * 3) % 5) - 2) * .015) * 1000) / 1000; });
    return steps;
  }
  // 말하는 시간 = 악보 길이. 긴 대사도 VOICE_MAX_MS에서 끊는다.
  const voiceDuration = text => Math.min(VOICE_MAX_MS, voiceScript(text).reduce((t, s) => t + s.wait, 0));
  function sourceName(source, weapons = {}, characters = {}) {
    const [type, id] = source.split(':');
    return sourceNames[source] || (type === 'weapon' ? weapons[id]?.name
      : type === 'skill' ? weapons[id]?.skillName : type === 'char' ? characters[id]?.skillName : null);
  }
  /* 같은 상황이라도 말이 돌아가게 한다. 난수를 쓰면 같은 화면을 다시 봤을
   * 때 대사가 바뀌어 버리므로, 이미 확정된 수치에서 뽑은 정수로 고른다. */
  const pick = (list, n) => list[((Math.trunc(Number(n) || 0) % list.length) + list.length) % list.length];
  /* 사실을 그냥 더해 고르면 배수가 겹쳐 한 가지만 계속 나온다.
   * (실제로 12n+11 꼴이 되어 14판 내내 같은 문장이 나왔다.) 해시로 흩는다. */
  const spin = value => {
    let h = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 8;
  };
  const rowSpin = row => spin((row?.round || 0) + '|' + Object.entries(row?.damage || {})
    .map(([k, v]) => k + ':' + Math.round(v || 0)).sort().join(','));
  // 한국어 조사 — '표창으로' / '번개로' 를 가른다 (ㄹ 받침은 '로')
  const ro = word => {
    const text = String(word || '');
    const code = text.charCodeAt(text.length - 1);
    const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
    return text + (jong === 0 || jong === 8 ? '로' : '으로');
  };
  // '이었습니다/였습니다'
  const ieot = word => { const code = String(word).charCodeAt(String(word).length - 1);
    return word + (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? '이었' : '였'); };
  const RECAP = {
    // 기록이 없는 예외 경로다. 문구를 돌릴 근거가 없으니 한 줄로 둔다.
    none: ['지난 전투 기록을 받지 못했네요. 이번 증강으로 다음 판을 준비해 보죠.'],
    // 가장 많이 준 피해 — 첫 줄만 '가장·핵심'이라고 말할 수 있다
    top: (what, amount) => [
      `지난 전투, ${ro(what)} ${amount} 피해를 넣었습니다.`,
      `가장 많이 일한 건 ${what}, 총 ${amount} 피해예요.`,
      `이번 전투 핵심은 ${ieot(what)}습니다. ${amount} 피해 기록했어요.`,
      `${what}, 꾸준히 누적됐네요. 총 ${amount} 피해입니다.`,
      `${ro(what)} ${amount} 피해. 제 몫을 했어요.`,
    ],
    next: (what, amount) => [
      `${what}도 ${amount} 피해를 보탰습니다.`,
      `${ro(what)}도 ${amount} 피해를 넣었어요.`,
      `그다음은 ${what}, ${amount} 피해입니다.`,
    ],
    heal: amount => [
      `흡혈로 ${amount} 회복했습니다. 꽤 쏠쏠했어요.`,
      `이번 전투 흡혈 회복량은 ${amount}입니다.`,
      `흡혈로 ${amount}만큼 회복하면서 버텼어요.`,
      `흡혈 회복량도 무시 못 하겠네요. ${amount}입니다.`,
    ],
    /* '발사는 했는데 체력 피해가 없었다'가 이 문구의 사실이다.
     * 차지를 걸다 죽은 것은 빗나감이 아니므로, 어느 표현을 쓰든
     * '체력 피해로 이어지지'는 반드시 남는다. */
    bowMiss: [
      '차지 샷은 나갔지만 체력 피해로 이어지지 못했습니다.',
      '한 방을 노렸는데, 차지 샷이 체력 피해로 이어지지 않았어요.',
      '좋은 시도였는데 차지 샷이 체력 피해로 이어지지는 않았습니다.',
      '그림은 있었는데, 차지 샷이 체력 피해로 이어지지 못했네요.',
    ],
    bowHit: amount => [
      `차지 샷으로 ${amount} 피해. 한 방이 묵직했어요.`,
      `차지 샷 ${amount} 피해. 노린 보람이 있었네요.`,
      `차지 샷이 ${amount} 피해를 냈습니다.`,
    ],
    empty: [
      '이번 전투는 유효타가 많지 않았습니다.',
      '서로 조심해서 큰 피해가 잘 안 났어요.',
      '생각보다 단단한 경기였네요.',
      '의외로 조용하게 흘러간 전투였습니다.',
      '다음 라운드에서는 화력이 더 필요해 보입니다.',
    ],
  };
  function recapLines(row, weapons, characters) {
    if (!row) return [RECAP.none[0]];
    const lines = [], damage = row.damage || {}, n = rowSpin(row);
    const sources = Object.entries(damage).filter(([s,v])=>v>0 && sourceName(s,weapons,characters))
      .sort((a,b)=>(Number(b[0].startsWith('augment:'))-Number(a[0].startsWith('augment:'))) || b[1]-a[1]);
    sources.slice(0,2).forEach(([source, amount], i) =>
      lines.push(pick((i === 0 ? RECAP.top : RECAP.next)(sourceName(source,weapons,characters), number(amount)), n + i)));
    const stolen = (row.healing?.lifesteal || 0) + (row.healing?.vampiric || 0);
    if (stolen > 0) lines.push(pick(RECAP.heal(number(stolen)), n));
    // Only a released shot with no effective hit is a miss. Starting a charge
    // and dying before release is NOT a miss; shields may also absorb the shot.
    if (row.releases?.['skill:bow'] && !damage['skill:bow']) lines.unshift(pick(RECAP.bowMiss, n));
    else if (damage['skill:bow'] > 0 && !lines.some(s=>s.includes(weapons?.bow?.skillName || '차지 샷')))
      lines.push(pick(RECAP.bowHit(number(damage['skill:bow'])), n));
    if (!lines.length) lines.push(pick(RECAP.empty, n));
    return lines.slice(0,4);
  }
  // 두 줄이 한 세트다. 어느 세트든 '세 선택지'와 '네 명 중 한 명'은 사실로 남긴다.
  const EVENT_INTRO = [
    ['게임의 판도를 바꿀 이벤트 투표 타임! 세 선택지 중 하나를 골라 주세요.',
      '네 명 중 한 명의 선택만 뽑혀서, 이번 게임에 적용됩니다.'],
    ['잠깐 쉬어 가고, 이벤트 투표 갑니다. 세 선택지 중 하나를 고르세요.',
      '표는 네 명 중 한 명만 당첨돼요. 누구 선택일지 봅시다.'],
    ['이제 판을 흔들 시간입니다. 세 선택지가 준비됐어요.',
      '네 명 중 한 명의 표가 이번 게임 규칙이 됩니다. 이번엔 운도 한몫하겠네요.'],
    ['어떤 이벤트가 들어올지 직접 정해봅시다. 세 선택지 중 하나!',
      '뽑히는 건 네 명 중 한 명. 선택 하나로 흐름이 달라질 수 있어요.'],
  ];
  // round를 받아 결정적으로 고른다. 같은 화면을 다시 봐도 같은 대사여야 한다.
  function eventIntro(round = 0) {
    return pick(EVENT_INTRO, round);
  }
  const EVENT_WIN = (who, what, desc) => [
    `${who}님의 선택, 「${what}」 적용! ${desc}`,
    `뽑혔습니다. ${who}님의 「${what}」. ${desc}`,
    `이번 게임은 ${who}님이 고른 「${what}」. ${desc}`,
    `당첨된 선택은 ${who}님의 「${what}」입니다. ${desc}`,
    `「${what}」 확정. ${who}님의 선택이에요. ${desc}`,
  ];
  function eventWinner(event, player) {
    if (!event) return [];
    const who = name(player?.name);
    return [pick(EVENT_WIN(who, event.name, event.desc || ''), spin(who + '|' + event.name))];
  }
  const json = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const bodyFields = 'uid pid x y vx vy radius r hp maxHp shield dead mainDead flash gunFlash weaponAngle weaponId charId color name charging rocketActive spinRemaining flags timers st gun satellites flame gripT'.split(' ');
  const paintPoint = p => ({ x:p.x, y:p.y, vx:p.vx || 0, vy:p.vy || 0, r:p.r });
  function paintBody(f) {
    const out = {};
    for (const key of bodyFields) if (f[key] !== undefined) out[key] = json(f[key]);
    out.chainHeads = (f.chainHeads || []).map(h=>({...paintPoint(h),attach:h.attach,nodes:(h.nodes || []).map(paintPoint)}));
    // A thrown shield owns a cyclic fighter reference and a contact Set. Only
    // copy paint state, never collision bookkeeping or the simulation owner.
    out.disc = f.disc ? {...paintPoint(f.disc),resting:!!f.disc.resting,spd:f.disc.spd} : null;
    out.summons = (f.summons || []).map(s=>({x:s.x,y:s.y,r:s.r,hp:s.hp,maxHp:s.maxHp}));
    out.splitBalls = (f.splitBalls || []).map(paintBody);
    return out;
  }
  function paintFrame(b) {
    const fighters = b.fighters.map(paintBody), byUid = new Map();
    const register = f => {byUid.set(f.uid,f);f.splitBalls.forEach(register);};
    fighters.forEach(register);
    const owned = list => (list || []).map(p => {
      const out = {};
      for (const key of ['uid','kind','x','y','ang','r','arm','life']) if(p[key]!==undefined)out[key]=p[key];
      out.owner = byUid.get(p.owner?.uid) || fighters.find(f=>f.pid===p.owner?.pid) || null; return out;
    });
    const ground = list => (list || []).map(p=>({x:p.x,y:p.y,r:p.r,life:p.life}));
    const frame = { isReplay:true, phase:b.phase, simT:b.simT, shake:0, arena:json(b.arena), fighters,
      projectiles:owned(b.projectiles), mines:owned(b.mines), flames:ground(b.flames),
      stickies:ground(b.stickies), fx:json((b.fx || []).slice(-64)),
      particles:json((b.particles || []).slice(-96)), popups:json((b.popups || []).slice(-40)),
      me:b.human?.()?.uid,
      swaps:Object.fromEntries((b.commentaryEvents || []).filter(e=>e.type==='skill' && e.source==='skill:chain').map(e=>[e.actor,e.seq])) };
    return frame;
  }
  function playbackFrame(a,b,t) {
    const point = (p,q) => ({...p,x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});
    const lerpList = (left,right,angleKey) => left.map(p=>{
      const q = right.find(q=>q.uid!=null && q.uid===p.uid);
      if(!q)return p;
      if ((b.swaps?.[p.uid] || 0) > (a.swaps?.[p.uid] || 0) || Math.hypot(q.x-p.x,q.y-p.y)>180) return q;
      const out=point(p,q);
      if(angleKey && Number.isFinite(p[angleKey]) && Number.isFinite(q[angleKey]))
        out[angleKey]=p[angleKey]+Math.atan2(Math.sin(q[angleKey]-p[angleKey]),Math.cos(q[angleKey]-p[angleKey]))*t;
      if(p.chainHeads?.length === q.chainHeads?.length) out.chainHeads = p.chainHeads?.map((h,i)=>{
        const next=q.chainHeads[i];
        if(h.nodes.length!==next.nodes.length)return h;
        const mixed={...point(h,next),nodes:h.nodes.map((n,j)=>point(n,next.nodes[j]))};
        if(Number.isFinite(h.attach) && Number.isFinite(next.attach))
          mixed.attach=h.attach+Math.atan2(Math.sin(next.attach-h.attach),Math.cos(next.attach-h.attach))*t;
        return mixed;
      });
      if(p.disc && q.disc) out.disc=point(p.disc,q.disc);
      if(p.splitBalls && q.splitBalls) out.splitBalls=lerpList(p.splitBalls,q.splitBalls,'weaponAngle');
      return out;
    });
    const fighters=lerpList(a.fighters,b.fighters,'weaponAngle');
    return {...a,fighters,projectiles:lerpList(a.projectiles,b.projectiles,'ang'),human(){return fighters.find(f=>f.uid===a.me)||null;}};
  }
  class ReplayBuffer {
    constructor(){this.reset();}
    reset(){this.key=null;this.frames=[];this.best={};this.alternates={};this.pending={};this.hits=[];this.seq=0;this.last=-Infinity;this.ended=false;}
    capture(b,now,round=0){
      if(!b || b.demo || b.isReplay || b.phase==='count' || now-this.last<80)return;
      const key=(b.soundSource||'local')+':'+b.soundId;
      if(key!==this.key){this.flush(this.last,true);this.frames=[];this.pending={};this.hits=[];this.seq=0;this.ended=false;this.key=key;}
      this.last=now;
      this.frames.push({at:now,paint:paintFrame(b)});
      if(this.frames.length>100)this.frames.shift();
      for(const e of b.commentaryEvents || []){
        if(e.seq<=this.seq || e.t>b.simT+.05)continue;
        this.seq=e.seq;
        if(b.simT-e.t>1.3)continue;
        const actor=b.fighters.find(f=>f.uid===e.actor);
        if((e.type==='skill' || e.type==='release') && e.source.startsWith('skill:'))
          this.mark('skill',now,e.type==='release'?60:40,{source:e.source,actor:name(actor?.name),round,key});
        if(e.type==='hit' && e.amount>0){
          this.hits=this.hits.filter(h=>now-h.at<1200);
          this.hits.push({at:now,actor:e.actor,target:e.target,amount:e.amount});
          const sum=this.hits.filter(h=>h.actor===e.actor && h.target===e.target).reduce((n,h)=>n+h.amount,0);
          if(sum>=30)this.mark('burst',now,sum,{amount:number(sum),actor:name(actor?.name),target:name(b.fighters.find(f=>f.uid===e.target)?.name),round,key});
        }
      }
      if(b.result&&!this.ended){this.ended=true;this.mark('final',now,100,{actor:name(b.result.winner?.name),reason:b.result.reason,draw:!!b.result.draw,round,key,decisive:!!b.matchConclusion});}
      this.flush(now);
    }
    mark(kind,at,score,info){
      const previous=this.pending[kind]||this.best[kind];
      if(kind!=='final' && previous && score<=previous.score)return;
      this.pending[kind]={kind,at,score,...info};
    }
    flush(now,force=false){
      for(const [kind,c] of Object.entries(this.pending)){
        if(!force && now<c.at+1000)continue;
        const frames=this.frames.filter(f=>f.at>=c.at-1600 && f.at<=c.at+1000);
        if(frames.length>=5){
          if(this.best[kind])this.alternates[kind]=[this.best[kind],...(this.alternates[kind]||[])].slice(0,2);
          this.best[kind]={...c,frames};
        }
        delete this.pending[kind];
      }
    }
    clips(){
      this.flush(this.last,true);
      const chosen=[];
      for(const kind of ['final','burst','skill']){
        const c=[this.best[kind],...(this.alternates[kind]||[])].find(c=>c && !chosen.some(x=>x.key===c.key && Math.abs(x.at-c.at)<1800));
        if(c)chosen.push(c);
      }
      return chosen.sort((a,b)=>a.at-b.at).slice(0,3);
    }
  }
  const api={voiceDuration,voiceScript,sourceName,recapLines,eventIntro,eventWinner,ReplayBuffer,paintFrame,playbackFrame};
  root.BounceRoyalBroadcastCore=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
