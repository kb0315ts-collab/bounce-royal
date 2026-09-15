'use strict';
/* Presentation only: concise fact-based copy and bounded, render-only replays. */
(function(root) {
  const sourceNames = {
    'augment:shuriken':'표창', 'augment:missile':'유도 미사일', 'augment:swordBeam':'검기',
    'augment:staticShock':'정전기', 'augment:shockwave':'충격파', 'augment:lightning':'번개',
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
  function recapLines(row, weapons, characters) {
    if (!row) return ['지난 전투 기록을 받지 못했네요. 이번 증강에서 다음 승부를 준비해 봅시다!'];
    const lines = [], damage = row.damage || {};
    const sources = Object.entries(damage).filter(([s,v])=>v>0 && sourceName(s,weapons,characters))
      .sort((a,b)=>(Number(b[0].startsWith('augment:'))-Number(a[0].startsWith('augment:'))) || b[1]-a[1]);
    for (const [source, amount] of sources.slice(0,2)) lines.push(`지난 전투, ${sourceName(source,weapons,characters)}으로 ${number(amount)} 피해! 잘 들어갔어요.`);
    const stolen = (row.healing?.lifesteal || 0) + (row.healing?.vampiric || 0);
    if (stolen > 0) lines.push(`흡혈로 실제 회복한 체력은 ${number(stolen)}! 버티는 데 도움이 됐네요.`);
    // Only a released shot with no effective hit is a miss. Starting a charge
    // and dying before release is NOT a miss; shields may also absorb the shot.
    if (row.releases?.['skill:bow'] && !damage['skill:bow']) lines.unshift('차지 샷은 발사했지만 체력 피해로 이어지지 못했네요. 다음에는 제대로 꽂아 봅시다!');
    else if (damage['skill:bow'] > 0 && !lines.some(s=>s.includes(weapons?.bow?.skillName || '차지 샷')))
      lines.push(`차지 샷으로 ${number(damage['skill:bow'])} 피해! 한 발의 존재감이 컸어요.`);
    if (!lines.length) lines.push('이번 전투에서는 유효 피해가 기록되지 않았네요. 다음 증강으로 반격을 준비합시다!');
    return lines.slice(0,4);
  }
  function eventIntro() {
    return ['게임의 판도를 바꿀 이벤트 투표 타임~! 세 선택지 중 마음에 드는 하나를 골라 주세요!',
      '표를 던진 네 명 중 한 명을 뽑습니다! 당첨된 선수의 선택이 이번 게임의 이벤트가 돼요.'];
  }
  function eventWinner(event, player) {
    if (!event) return [];
    return [`${name(player?.name)}님의 선택, 「${event.name}」 당첨! ${event.desc || ''}`];
  }
  const json = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const bodyFields = 'uid pid x y vx vy radius r hp maxHp shield dead mainDead flash gunFlash weaponAngle weaponId charId color name charging rocketActive spinRemaining flags timers st gun satellites flame gripT'.split(' ');
  const paintPoint = p => ({ x:p.x, y:p.y, vx:p.vx || 0, vy:p.vy || 0, r:p.r });
  function paintBody(f) {
    const out = {};
    for (const key of bodyFields) if (f[key] !== undefined) out[key] = json(f[key]);
    out.chainHeads = (f.chainHeads || []).map(h=>({...paintPoint(h),nodes:(h.nodes || []).map(paintPoint)}));
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
        return {...point(h,next),nodes:h.nodes.map((n,j)=>point(n,next.nodes[j]))};
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
