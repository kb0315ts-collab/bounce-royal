'use strict';
/* Presentation only: concise fact-based copy and bounded, render-only replays. */
(function(root) {
  const sourceNames = {
    'augment:shuriken':'표창', 'augment:missile':'유도 미사일', 'augment:swordBeam':'검기',
    'augment:staticShock':'정전기', 'augment:shockwave':'충격파', 'augment:chainQuake':'벽 강타', 'augment:lightning':'번개',
    'augment:chainBolt':'연쇄 번개', 'augment:satellite':'위성체', 'augment:miniBall':'꼬마볼',
    'augment:minionRevenge':'복수하는 부하', 'augment:bayonet':'총검술',
    'augment:rocketStart':'로켓 관통', 'dot:bleed':'출혈', 'dot:flame':'화염 흔적',
  };
  const name = value => Array.from(String(value || '선수')).slice(0,12).join('');
  const number = value => Math.round(Math.max(0, value || 0) * 10) / 10;
  const voiceDuration = text => Math.min(1500, Math.max(500, 350 + Array.from(String(text || '')).length * 28));
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
  const RECAP = {
    // 기록이 없는 예외 경로다. 문구를 돌릴 근거가 없으니 한 줄로 둔다.
    none: ['지난 전투 기록을 받지 못했네요. 이번 증강에서 다음 승부를 준비해 봅시다!'],
    top: (what, amount) => [
      `지난 전투, ${ro(what)} ${amount} 피해! 잘 들어갔어요.`,
      `${what}, ${amount} 피해를 만들었습니다. 오늘의 주력이네요!`,
      `${what}, ${amount} 피해! 이게 제 몫을 톡톡히 했습니다.`,
      `지난 판 ${ro(what)}만 ${amount} 피해가 들어갔습니다!`,
    ],
    heal: amount => [
      `흡혈로 실제 회복한 체력은 ${amount}! 버티는 데 도움이 됐네요.`,
      `흡혈로 ${amount}을 되찾았습니다. 오래 버틴 이유죠!`,
      `${amount}만큼 빨아들였습니다. 흡혈이 일했네요!`,
    ],
    /* '발사는 했는데 체력 피해가 없었다'가 이 문구의 사실이다.
     * 차지를 걸다 죽은 것은 빗나감이 아니므로, 어느 표현을 쓰든
     * '체력 피해로 이어지지'는 반드시 남는다. */
    bowMiss: [
      '차지 샷은 발사했지만 체력 피해로 이어지지 못했네요. 다음에는 제대로 꽂아 봅시다!',
      '차지 샷을 쐈지만 체력 피해로 이어지지 못했습니다. 조준을 가다듬어 보죠!',
      '차지 샷이 나갔는데 체력 피해로 이어지지 않았네요. 다음 한 발을 노려 봅시다!',
    ],
    bowHit: amount => [
      `차지 샷으로 ${amount} 피해! 한 발의 존재감이 컸어요.`,
      `차지 샷 ${amount} 피해! 한 방이 묵직했습니다.`,
      `차지 샷이 ${amount}을 꽂았습니다. 이 맛에 당기는 거죠!`,
    ],
    empty: [
      '이번 전투에서는 유효 피해가 기록되지 않았네요. 다음 증강으로 반격을 준비합시다!',
      '유효 피해가 없었습니다. 증강으로 판을 다시 짜 보죠!',
      '이번엔 한 대도 제대로 못 넣었네요. 다음 판에서 갚아 줍시다!',
    ],
  };
  function recapLines(row, weapons, characters) {
    if (!row) return [RECAP.none[0]];
    const lines = [], damage = row.damage || {}, n = rowSpin(row);
    const sources = Object.entries(damage).filter(([s,v])=>v>0 && sourceName(s,weapons,characters))
      .sort((a,b)=>(Number(b[0].startsWith('augment:'))-Number(a[0].startsWith('augment:'))) || b[1]-a[1]);
    sources.slice(0,2).forEach(([source, amount], i) =>
      lines.push(pick(RECAP.top(sourceName(source,weapons,characters), number(amount)), n + i)));
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
  const EVENT_INTRO = [
    ['게임의 판도를 바꿀 이벤트 투표 타임~! 세 선택지 중 마음에 드는 하나를 골라 주세요!',
      '표를 던진 네 명 중 한 명을 뽑습니다! 당첨된 선수의 선택이 이번 게임의 이벤트가 돼요.'],
    ['이벤트 투표입니다! 세 선택지 중 하나를 골라 주세요, 판이 통째로 바뀝니다!',
      '네 명 중 한 명이 당첨됩니다! 그 선수의 선택이 이번 게임에 걸려요.'],
    ['자, 세 선택지 중 하나! 이벤트 투표 들어갑니다!',
      '뽑기는 네 명 중 한 명! 당첨된 선수의 표가 이번 게임의 규칙이 됩니다.'],
  ];
  // round를 받아 결정적으로 고른다. 같은 화면을 다시 봐도 같은 대사여야 한다.
  function eventIntro(round = 0) {
    return pick(EVENT_INTRO, round);
  }
  const EVENT_WIN = (who, what, desc) => [
    `${who}님의 선택, 「${what}」 당첨! ${desc}`,
    `당첨은 ${who}님! 「${what}」으로 갑니다. ${desc}`,
    `${who}님이 뽑혔습니다! 이번 게임은 「${what}」! ${desc}`,
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
  const api={voiceDuration,sourceName,recapLines,eventIntro,eventWinner,ReplayBuffer,paintFrame,playbackFrame};
  root.BounceRoyalBroadcastCore=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
