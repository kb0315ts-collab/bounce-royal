'use strict';
// Local-only integration and screenshot QA for the cosmic-sports presentation.
// node tools/check-cosmic-browser.js <playwright module> <existing screenshot dir>
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.argv[2] || 'playwright');
const shots = process.argv[3];
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  const errors=[],failed=[],assetRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
  page.on('request',r=>{if(r.url().includes('/assets/icons/augments/'))assetRequests.push(r.url());});
  const snap = async name => {if(shots)await page.screenshot({path:path.join(shots,'cosmic-final-'+name+'.png')});};
  try {
    await page.goto('http://localhost:8080/');
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>TitleDemo.video.currentTime>1);
    const title=await page.evaluate(()=>({live:TitleDemo.shouldRunLive(),src:TitleDemo.video.currentSrc,duration:TitleDemo.video.duration,width:TitleDemo.video.videoWidth}));
    assert.equal(title.live,false); assert.match(title.src,/title-demos-cosmic/); assert.equal(title.width,540); assert.ok(title.duration>14.7&&title.duration<15.3);
    console.log('TITLE',JSON.stringify(title)); await snap('title');
    for(const width of [320,390,720]){
      await page.setViewportSize({width,height:width===390?844:Math.round(width*16/9)});
      assert.equal(await page.evaluate(()=>['btn-ranked','btn-friendly','btn-bag','btn-codex','btn-settings'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})),true,'Menu fits '+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.click('#btn-friendly');
    await page.waitForFunction(()=>Game.state==='lobby'&&Game.mode==='multi');
    assert.match(await page.evaluate(()=>BounceRoyalNet.serverUrl),/^ws:\/\/localhost:8080/);
    await snap('friendly'); await page.click('#btn-room-start');
    await page.waitForSelector('#weapon-cards .weapon-card'); await page.waitForTimeout(1500); await snap('weapon');
    await page.locator('#weapon-cards .weapon-card').first().click();
    await page.waitForFunction(()=>Game.state==='battle'&&Multi.view?.phase==='fight',null,{timeout:30000});
    const initial=await page.evaluate(()=>Multi.view.fighters.map(f=>[f.x,f.y]));
    await page.waitForTimeout(700);
    assert.notDeepEqual(await page.evaluate(()=>Multi.view.fighters.map(f=>[f.x,f.y])),initial);
    await snap('battle');
    const joy=await page.locator('#steer-base').boundingBox();
    await page.mouse.move(joy.x+joy.width/2,joy.y+joy.height/2);await page.mouse.down();await page.mouse.move(joy.x+joy.width*.9,joy.y+joy.height*.3);await page.waitForTimeout(200);await page.mouse.up();
    await page.click('#sk-char');await page.click('#sk-weapon');
    await page.evaluate(()=>Game.returnToTitle());
    // Isolated UI fixture: exercise new art in the real selection/long-press card renderer.
    await page.evaluate(()=>{
      Game.newMatch('cat','sword',{mode:'friendly'});Game.round=4;Game.state='augment';
      hudVisible(false);showScreen('scr-augment');
      buildAugmentSelect(['shuriken','missile','w_beam'].map(id=>AUG_BY_ID[id]),Game.human,()=>{},'전투에서 본 모습 그대로',{count:3,onRefresh:()=>{}});
    });
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#aug-cards .ui-svg--game-art').count(),3); await snap('augment');
    await page.evaluate(()=>buildAugmentSelect(['winMomentum','vengeance','seasonedExp'].map(id=>AUG_BY_ID[id]),Game.human,a=>{window.__cosmicPicked=a.id;},'공격력 + 승리 · 패배 · 라운드 성장',{count:3,onRefresh:()=>{}}));
    await snap('augment-stats');
    await page.locator('#aug-cards .augment-card').first().click();
    assert.equal(await page.evaluate(()=>window.__cosmicPicked),'winMomentum');
    await page.evaluate(()=>Game.returnToTitle());
    await page.goto('http://localhost:8080/icon-gallery.html');
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('#icon-grid .ui-svg--game-art').count(),93);
    assert.equal(await page.locator('#icon-grid img').count(),0);
    assert.equal(assetRequests.length,0,'New artwork must not download the old pack by default');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await snap('gallery');
    await page.fill('#icon-search','표창');
    // Search also legitimately includes Automation Expert, whose description mentions shuriken.
    for (const id of ['shuriken','shurikenSpd','shurikenUp']) assert.equal(await page.locator('.icon-card[data-augment="'+id+'"]').count(),1);
    await page.locator('.icon-card[data-augment="shuriken"]').click();
    assert.equal(await page.locator('#icon-dialog').evaluate(d=>d.open),true);
    assert.match(await page.locator('#dialog-reason').innerText(),/표창/);
    await snap('icon-detail'); await page.keyboard.press('Escape');
    await page.fill('#icon-search','');
    await page.click('#compare');
    await page.waitForFunction(()=>document.querySelectorAll('#icon-grid img').length===93&&[...document.querySelectorAll('#icon-grid img')].every(i=>i.complete&&i.naturalWidth>0));
    assert.equal(await page.locator('#icon-grid .ui-svg--game-art').count(),93);
    await page.click('#compare');
    assert.equal(await page.locator('#icon-grid img').count(),0);
    // Save a whole-roster contact sheet without changing game state or source.
    if(shots){
      await page.setViewportSize({width:1200,height:950});
      await page.locator('#icon-grid').screenshot({path:path.join(shots,'cosmic-icons-all.png')});
    }
    await page.setViewportSize({width:390,height:844});
    await page.goto('http://localhost:8080/sound-lab.html'); await page.evaluate(()=>document.fonts.ready);
    await page.waitForSelector('.sound-card'); await snap('soundroom');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    console.log('PASS: portrait layouts, cosmic video, real local-server match and inputs, 93 native icons without asset downloads, gallery archive comparison, no JS/HTTP errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
