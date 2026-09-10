'use strict';
// Local-only integration/visual QA. Usage: node tools/check-casual-browser.js
// <playwright-module> <absolute-screenshot-directory>. Requires local server:8080.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const shots = process.argv[3];
(async () => {
  const browser = await chromium.launch({headless:true});
  const errors = [], requests = [];
  const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) requests.push(r.status() + ' ' + r.url()); });
  const snap = async name => { if (shots) await page.screenshot({path:path.join(shots, name+'.png')}); };
  try {
    await page.goto('http://localhost:8080/');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => TitleDemo.video.currentTime > 1 && TitleDemo.video.videoWidth > 0);
    const title = await page.evaluate(() => ({src:TitleDemo.video.currentSrc,width:TitleDemo.video.videoWidth,height:TitleDemo.video.videoHeight,duration:TitleDemo.video.duration,live:TitleDemo.shouldRunLive(),failed:TitleDemo.failed,font:document.fonts.check('20px Jua'),demoTime:Game.demo?.time}));
    assert.equal(title.live,false); assert.equal(title.failed,false); assert.equal(title.width,540); assert.equal(title.height,960); assert.equal(title.font,true);
    assert.ok(title.duration>14.7 && title.duration<15.3,'Title video metadata must report the full recording, not its first fragment');
    console.log('TITLE', JSON.stringify(title));
    await snap('casual-final-title');
    for (const width of [320,390,720]) {
      await page.setViewportSize({width,height:width===390?844:Math.round(width*16/9)});
      const fits = await page.evaluate(() => ['btn-ranked','btn-friendly','btn-bag','btn-codex','btn-settings'].map(id => { const el=document.getElementById(id),r=el.getBoundingClientRect();return r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}));
      assert.ok(fits.every(Boolean), 'Title buttons must fit at '+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.click('#btn-friendly');
    await page.waitForFunction(() => Game.state==='lobby' && Game.mode==='multi');
    assert.match(await page.evaluate(() => BounceRoyalNet.serverUrl), /^ws:\/\/localhost:8080/);
    await snap('casual-final-friendly');
    await page.click('#btn-room-start');
    await page.waitForSelector('#weapon-cards .weapon-card');
    await page.waitForTimeout(1500); // Let the match-found banner finish before visual QA.
    await snap('casual-final-weapon');
    await page.locator('#weapon-cards .weapon-card').first().click();
    await page.waitForFunction(() => Game.state==='battle' && Multi.view?.phase==='fight' && Multi.view.fighters.length>0, null, {timeout:30000});
    const first = await page.evaluate(() => Multi.view.fighters.map(b => [b.x,b.y]));
    await page.waitForTimeout(700);
    const next = await page.evaluate(() => Multi.view.fighters.map(b => [b.x,b.y]));
    assert.notDeepEqual(first,next,'Server battle balls must move');
    await snap('casual-final-battle');
    const joy = await page.locator('#steer-base').boundingBox();
    await page.mouse.move(joy.x+joy.width/2,joy.y+joy.height/2);
    await page.mouse.down(); await page.mouse.move(joy.x+joy.width*.9,joy.y+joy.height*.3); await page.waitForTimeout(300); await page.mouse.up();
    await page.locator('#sk-char').click();
    await page.locator('#sk-weapon').click();
    await page.waitForTimeout(500);
    console.log('BATTLE',JSON.stringify(await page.evaluate(() => ({mode:Game.mode,state:Game.state,players:BounceRoyalNet.players.length,balls:Multi.view?.fighters.length,seq:BounceRoyalNet.lastSeq}))));
    await page.evaluate(() => Game.returnToTitle());
    await page.goto('http://localhost:8080/icon-gallery.html');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelectorAll('#icon-grid .icon-card').length===93 && [...document.querySelectorAll('#icon-grid img')].every(i=>i.complete&&i.naturalWidth>0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
    await snap('casual-final-gallery');
    await page.locator('.icon-card').first().click();
    assert.equal(await page.locator('#icon-dialog').evaluate(d=>d.open),true);
    await page.keyboard.press('Escape');
    await page.goto('http://localhost:8080/sound-lab.html');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('.sound-card');
    assert.equal(await page.locator('.sound-card').count(),51);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
    await snap('casual-final-soundroom');
    await page.locator('.sound-play[data-variant="current"]').first().click();
    await page.waitForFunction(() => document.getElementById('playback-status').textContent.includes('·') && !document.getElementById('playback-status').classList.contains('is-error'));
    await page.locator('.sound-play[data-variant="previous"]').first().click();
    await page.waitForFunction(() => document.getElementById('playback-status').textContent.includes('리뉴얼 직전'));
    assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
    console.log('PASS: title video, 3 mobile sizes, local server friendly match, movement/inputs, 93 icons, 51 revised sound previews; page errors 0, failed HTTP responses 0');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
