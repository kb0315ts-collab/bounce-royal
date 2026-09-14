'use strict';
(function(root){
  const core=root.BounceRoyalBroadcastCore, buffer=new core.ReplayBuffer();
  const overlay=document.createElement('section');
  overlay.id='scr-replay'; overlay.className='screen hidden';
  overlay.setAttribute('aria-label','전투 하이라이트 다시 보기');
  overlay.innerHTML='<header class="replay-head"><span>REPLAY · 하이라이트</span><button id="replay-skip" type="button">건너뛰기 →</button></header><div class="caster-dock" id="replay-caster-dock"></div><footer class="replay-footer"><strong id="replay-title"></strong><span id="replay-count"></span><progress id="replay-progress" max="1" value="0" aria-label="하이라이트 진행도"></progress><small>방금 본 전투의 기록 · 실제 경기는 종료되었습니다</small></footer>';
  document.getElementById('app').appendChild(overlay);
  let view=null, played=false, raf=0, startTimer=0, clips=[], index=0, start=0;
  function reset(){
    clearTimeout(startTimer); cancelAnimationFrame(raf); startTimer=raf=0;
    view=null;played=false;clips=[];buffer.reset();overlay.classList.add('hidden');
  }
  function capture(b){
    if(played || document.hidden)return;
    buffer.capture(b,performance.now(),typeof Game!=='undefined'&&Game.mode==='multi'?BounceRoyalNet.round:Game.round);
  }
  function finish(){
    clearTimeout(startTimer);cancelAnimationFrame(raf);startTimer=raf=0;view=null;clips=[];buffer.reset();
    BounceRoyalCommentary.hide();
    showScreen('scr-over');
  }
  function caption(c){
    if(c.kind==='skill')return `${c.actor}의 ${core.sourceName(c.source,WEAPONS,CHARACTERS)||'무기 스킬'}! 그 장면 다시 보시죠!`;
    if(c.kind==='burst')return `${c.actor}, ${c.target}에게 짧은 순간 ${c.amount} 피해! 흐름을 잡아낸 공격이었어요.`;
    if(c.draw)return '끝까지 팽팽했던 승부! 이번 라운드는 무승부로 마무리됐습니다.';
    return c.reason==='체력 비율 판정' ? '마지막까지 버텼습니다! 체력 비율로 승부가 결정된 순간입니다.'
      : `${c.actor}, 승부를 가른 마지막 공격! 다시 한 번 보시죠!`;
  }
  function next(){
    if(index>=clips.length){finish();return;}
    const c=clips[index];start=performance.now();
    document.getElementById('replay-title').textContent=`ROUND ${c.round} · ${c.kind==='skill'?'무기 스킬':c.kind==='burst'?'집중 공격':c.draw?'팽팽한 승부':c.reason==='체력 비율 판정'?'마지막 판정':'승부의 순간'}`;
    document.getElementById('replay-count').textContent=`${index+1} / ${clips.length}`;
    BounceRoyalCommentary.studioLines([caption(c)],'다시 보는 명장면','replay-caster-dock');
    raf=requestAnimationFrame(tick);
  }
  function tick(now){
    if(document.hidden){finish();return;}
    const c=clips[index], frames=c.frames, duration=frames.at(-1).at-frames[0].at;
    // Fixed 3-second clips: compact replay, no simulation or gameplay audio.
    const progress=Math.min(1,(now-start)/3000),at=frames[0].at+duration*progress;
    let i=0;while(i<frames.length-2 && frames[i+1].at<at)i++;
    const a=frames[i],b=frames[Math.min(i+1,frames.length-1)];
    view=core.playbackFrame(a.paint,b.paint,Math.min(1,(at-a.at)/Math.max(1,b.at-a.at)));
    document.getElementById('replay-progress').value=(index+progress)/clips.length;
    if(progress===1){index++;next();}else raf=requestAnimationFrame(tick);
  }
  function play(){
    if(played || document.hidden)return false;
    clips=buffer.clips();played=true;
    if(!clips.length)return false;
    index=0;
    const last=buffer.frames.at(-1)?.paint || clips.at(-1).frames.at(-1).paint;
    view=core.playbackFrame(last,last,0);
    document.getElementById('replay-title').textContent='승부 확정! 잠시 후 주요 장면을 다시 봅니다';
    document.getElementById('replay-count').textContent='';
    document.getElementById('replay-progress').value=0;
    const delay=BounceRoyalCommentary.remainingFinale();
    showScreen('scr-replay');
    startTimer=setTimeout(next,delay+80);
    return true;
  }
  document.getElementById('replay-skip').onclick=finish;
  document.addEventListener('visibilitychange',()=>{if(document.hidden && view)finish();});
  root.BounceRoyalHighlights=Object.freeze({capture,play,reset,get view(){return view;},
    // Small QA counters, not an additional recording or source of game state.
    stats:()=>({frames:buffer.frames.length,clips:Object.keys(buffer.best).length,playing:!!view})});
})(globalThis);
