'use strict';
// Isolated client fixtures: no matchmaking, accounts or production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  const shots=fs.mkdtempSync(path.join(os.tmpdir(),'bounce-trio-'));
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(process.argv[3]||'http://localhost:8082/');
    await page.evaluate(()=>document.fonts.ready);
    await page.click('#btn-title-settings');
    await page.evaluate(()=>{
      Game.returnToTitle();Game.newMatch('cat','chain',{mode:'friendly'});stopPhaseTimer();
      Game.update=()=>{};Game.mode='single';Game.state='battle';Game.battles=null;
      ['chain','flame','shield','sword'].forEach((id,i)=>{Game.players[i].weaponId=id;Game.players[i].isAI=false;});
      window.trioBattle=new Battle('circle',Game.players,{ffa:true});trioBattle.phase='fight';
      const [c,f,s,e]=trioBattle.fighters;
      [[c,-80,-80],[f,-75,65],[s,85,35],[e,80,-70]].forEach(([b,x,y])=>{b.x=x;b.y=y;b.vx=1;b.vy=0;});
      c.weaponAngle=-1;c.flags.chainBarbed=true;c.flags.chainTwin=true;ensureChainHeads(c);
      f.flame.on=true;f.flame.fuel=90;f.weaponAngle=0;f.steer={active:true,angle:0,strength:1};
      updateFlame(trioBattle,f,.016);s.weaponAngle=-.7;throwDisc(trioBattle,s);
      showScreen(null);hudVisible(true);updateSkillbar(trioBattle);renderBattle(trioBattle);
    });
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(shots,'battle.png')});
    assert.ok(await page.locator('#sk-weapon .ico svg').count());
    const initial=await page.evaluate(()=>trioBattle.fighters[0].chainHeads[0].x);
    await page.evaluate(()=>{
      const c=trioBattle.fighters[0];
      for(let i=0;i<90;i++){c.x+=Math.cos(i/50);c.y+=Math.sin(i/50);updateChain(trioBattle,c,1/60);}
      renderBattle(trioBattle);
    });
    assert.notEqual(await page.evaluate(()=>trioBattle.fighters[0].chainHeads[0].x),initial);
    for(const id of ['chain','flame','shield']) {
      await page.evaluate(id=>{
        showScreen('scr-augment');hudVisible(false);
        const offers=AUGMENTS.filter(a=>a.weapon===id);
        window.trioOfferCount=offers.length;
        buildAugmentSelect(offers,Game.human,()=>{},null,{refreshes:2});
      },id);
      assert.equal(await page.evaluate(()=>trioOfferCount),3);
      for(const width of [320,390,720]) {
        await page.setViewportSize({width,height:Math.round(width*16/9)});await page.waitForTimeout(100);
        assert.equal(await page.locator('#aug-cards .card').count(),3);
        await page.screenshot({path:path.join(shots,id+'-'+width+'.png')});
      }
    }
    await page.evaluate(()=>{showScreen('scr-weapon');buildWeaponSelect(['chain','flame','shield'],()=>{});});
    await page.waitForTimeout(150);await page.screenshot({path:path.join(shots,'weapons.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: trio live render/motion, skill SVG, 9 augment cards at 320/390/720, weapons; no page errors. Screenshots: '+shots);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
