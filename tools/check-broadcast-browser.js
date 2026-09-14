'use strict';
// Isolated local browser QA, not a production match or account.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.argv[2]||'playwright');
const shots=process.argv[3],url=process.argv[4]||'http://localhost:8082/';
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  if(shots)fs.mkdirSync(shots,{recursive:true});
  const shot=async n=>{if(shots)await page.screenshot({path:path.join(shots,n+'.png')});};
  try{
    await page.goto(url);await page.evaluate(()=>document.fonts.ready);
    await page.click('#btn-title-settings');
    await page.evaluate(()=>{
      Game.returnToTitle();Game.newMatch('cat','bow',{mode:'friendly'});
      Game.mode='single';Game.state='battle';Game.battles=null;Game.round=3;
      window.qaBattle=new Battle('diamond',Game.players.slice(0,2));
      qaBattle.phase='fight';qaBattle.simT=4;
      const [a,e]=qaBattle.fighters;a.hp=70;a.flags.lifesteal=.5;
      dealDamage(qaBattle,a,e,18,{kind:'auto',autoType:'shuriken'});
      useSkill(qaBattle,a,'weapon');updateTimers(qaBattle,a,.25);useSkill(qaBattle,a,'weapon');
      qaBattle.finish(a,'격파');
      BounceRoyalCommentary.rememberReport(qaBattle.roundReport,Game.human.id);
      Game.state='augment';hudVisible(false);showScreen('scr-augment');
      buildAugmentSelect(AUGMENTS.slice(0,3),Game.human,()=>{},null,{refreshes:2});
      startPhaseTimer('aug-timer',25,null,25);
    });
    assert.match(await page.locator('#caster-copy').innerText(),/차지 샷.*피해로 이어지지/);
    assert.equal(await page.locator('#commentator').evaluate(e=>e.parentElement.id),'augment-caster-dock');
    for(const width of [320,390,720]){
      await page.setViewportSize({width,height:Math.round(width*16/9)});
      await page.waitForTimeout(100);
      const boxes=await page.evaluate(()=>{
        const rect=id=>document.getElementById(id).getBoundingClientRect();
        const b=rect('caster-bubble'),cards=rect('aug-cards'),app=rect('app'),toggle=rect('caster-toggle');
        return {noOverlap:b.bottom<=cards.top,inApp:b.left>=app.left&&b.right<=app.right,toggleClear:toggle.bottom<=cards.top,
          textFits:document.getElementById('caster-copy').scrollHeight<=document.getElementById('caster-copy').clientHeight+1};
      });
      assert.deepEqual(boxes,{noOverlap:true,inApp:true,toggleClear:true,textFits:true},'selection layout '+width);
      await shot('recap-'+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.getElementById('caster-copy').textContent.includes('표창'),null,{timeout:9000});
    assert.match(await page.locator('#caster-copy').innerText(),/18/);
    await page.click('#caster-toggle');assert.equal(await page.locator('#caster-bubble').isVisible(),false);
    await page.click('#caster-toggle');assert.equal(await page.locator('#caster-bubble').isVisible(),true);
    // Multi-style late snapshots must not hide the caster mounted in the menu.
    await page.evaluate(()=>renderBattle(qaBattle));
    assert.equal(await page.locator('#commentator').isVisible(),true);
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#commentator').isVisible(),false);
    await page.evaluate(()=>{
      delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#commentator').isVisible(),true,'selection caster returns after tab was hidden');
    await page.evaluate(()=>{
      showScreen(null);BounceRoyalCommentary.rememberReport({},Game.human.id);showScreen('scr-augment');
    });
    assert.doesNotMatch(await page.locator('#caster-copy').innerText(),/표창|18 피해/,'missing current record never reuses an older round');
    await page.evaluate(()=>{
      stopPhaseTimer();Game.state='eventVote';
      showEventVote([GAME_EVENTS[0],GAME_EVENTS[2],GAME_EVENTS[8]],Game.players,()=>{});
      startPhaseTimer('event-timer',20,null,20);
    });
    assert.match(await page.locator('#caster-copy').innerText(),/판도를 바꿀 이벤트 투표/);
    await shot('event-vote');
    await page.locator('#event-cards .event-card').first().click();
    await page.evaluate(()=>{
      const ev=GAME_EVENTS[8],votes=new Map(Game.players.map(p=>[p.id,ev.id]));
      showEventVoteResult({offers:[GAME_EVENTS[0],GAME_EVENTS[2],ev],players:Game.players,votes,event:ev,winnerPlayer:Game.players[0]},null);
    });
    await page.waitForFunction(()=>document.getElementById('caster-copy').textContent.includes('30%'));
    assert.match(await page.locator('#caster-copy').innerText(),/과격한 경기.*30%/);
    await page.waitForTimeout(220);
    await shot('event-winner');
    // Real rendering frames, with controlled confirmed actions, build three distinct moments.
    await page.evaluate(()=>{
      stopPhaseTimer();Game.returnToTitle();Game.newMatch('cat','sword',{mode:'friendly'});
      Game.state='battle';Game.mode='single';Game.battles=null;Game.round=7;
      Game.players.forEach((p,i)=>Object.assign(p,{coins:i===0?2:i===1?1:0,eliminated:i>1,elimOrder:i>1?i:0}));
      Game.elimCounter=4;showScreen(null);hudVisible(true);TitleDemo.sync();updatePlayersPanel(Game);
      window.qaBattle=new Battle('diamond',Game.players.slice(0,2));
      qaBattle.phase='fight';qaBattle.simT=.01;
      const a=qaBattle.fighters[0];
      // Circular owner reference must never escape into a recorded paint frame.
      qaBattle.flames.push({owner:a,x:0,y:0,r:20,life:2});
      window.qaClock=0;
      window.qaInterval=setInterval(()=>{
        qaClock+=.08;qaBattle.simT=qaClock;
        a.x=Math.sin(qaClock)*100;a.y=Math.cos(qaClock)*100;a.weaponAngle=qaClock*3;
        renderBattle(qaBattle);
      },80);
    });
    await page.waitForTimeout(1500);
    await page.evaluate(()=>useSkill(qaBattle,qaBattle.fighters[0],'weapon'));
    await page.waitForTimeout(2800);
    await page.evaluate(()=>dealDamage(qaBattle,qaBattle.fighters[0],qaBattle.fighters[1],35,{kind:'weapon'}));
    await page.waitForTimeout(2800);
    await page.evaluate(()=>{
      clearInterval(qaInterval);Game.battles=[qaBattle];Game.focus=Game.ownBattle=qaBattle;Game.resolving=false;
      dealDamage(qaBattle,qaBattle.fighters[0],qaBattle.fighters[1],10000,{kind:'weapon'});Game.update(0);
    });
    assert.equal(await page.locator('#commentator.is-gg').count(),1);
    await page.waitForSelector('#scr-replay:not(.hidden)');
    await page.waitForFunction(()=>document.getElementById('replay-count').textContent==='1 / 3');
    await page.evaluate(()=>showGameOver(Game.players,Game.human,()=>Game.returnToTitle()));
    assert.equal(await page.locator('#scr-replay').isVisible(),true,'duplicate result cannot interrupt ongoing replay');
    assert.equal(await page.locator('#caster-bubble').isVisible(),true);
    assert.match(await page.locator('#caster-copy').innerText(),/믹서기/);
    await page.waitForTimeout(220);
    await shot('replay-skill');
    const replayX=await page.evaluate(()=>BounceRoyalHighlights.view.fighters[0].x);
    await page.waitForTimeout(350);
    assert.notEqual(await page.evaluate(()=>BounceRoyalHighlights.view.fighters[0].x),replayX,'recorded motion is replayed');
    await page.waitForFunction(()=>document.getElementById('replay-count').textContent==='3 / 3');
    await page.waitForTimeout(2400);
    assert.equal(await page.evaluate(()=>BounceRoyalHighlights.view.fighters[1].dead),true,'decisive clip includes the actual death');
    await shot('replay-decisive');
    await page.waitForSelector('#scr-over:not(.hidden)');
    assert.deepEqual(await page.evaluate(()=>BounceRoyalHighlights.stats()),{frames:0,clips:0,playing:false});
    assert.equal(await page.evaluate(()=>Game.players[1].coins),0,'replay cannot settle coins twice');
    await page.evaluate(()=>showGameOver(Game.players,Game.human,()=>Game.returnToTitle()));
    assert.equal(await page.locator('#scr-replay').isVisible(),false,'duplicate gameOver does not replay');
    await page.evaluate(()=>{
      BounceRoyalHighlights.reset();
      qaBattle.phase='fight';qaBattle.result=null;delete qaBattle.matchConclusion;
      const realNow=performance.now;let now=0;
      performance.now=()=>now;
      try{
        for(let i=0;i<30;i++){
          now=i*100;qaBattle.simT=i*.1;
          if(i===15)qaBattle.finish(qaBattle.fighters[0],'격파');
          BounceRoyalHighlights.capture(qaBattle);
        }
      }finally{performance.now=realNow;}
      BounceRoyalHighlights.play();
    });
    await page.waitForSelector('#scr-replay:not(.hidden)');
    await page.click('#replay-skip');
    assert.equal(await page.locator('#scr-over').isVisible(),true,'skip immediately returns to results');
    assert.deepEqual(await page.evaluate(()=>BounceRoyalHighlights.stats()),{frames:0,clips:0,playing:false});
    assert.deepEqual(errors,[]);
    console.log('PASS: factual recap, selection layouts 320/390/720, gag controls, vote intro/winner, cyclic ground safety, 3 real replay clips, motion, result cleanup and no double settlement/errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
