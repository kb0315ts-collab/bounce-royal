'use strict';
// node tools/check-caster-browser.js <playwright module> <screenshot directory>
// All fixtures are isolated in the browser; they never change production data.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.argv[2] || 'playwright');
const shots = process.argv[3];
(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width:390, height:844 }, deviceScaleFactor:1 });
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  const shot = async name => { if (shots) await page.screenshot({ path:path.join(shots, name + '.png') }); };
  try {
    await page.goto('http://localhost:8080/');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#commentator').isVisible(), false, 'no caster on title video');
    // A real server room proves snapshots, rendering and controls work together.
    await page.click('#btn-friendly');
    await page.waitForFunction(() => Game.state === 'lobby' && Game.mode === 'multi');
    await page.click('#btn-room-start');
    await page.waitForSelector('#weapon-cards .weapon-card');
    await page.locator('#weapon-cards .weapon-card').first().click();
    await page.waitForFunction(() => Game.state === 'battle' && Multi.view?.phase === 'fight', null, { timeout:30000 });
    await page.waitForSelector('#commentator:not([hidden])');
    await page.waitForFunction(() => document.getElementById('caster-art').naturalWidth > 0);
    const server = await page.evaluate(() => ({ url:BounceRoyalNet.serverUrl, events:Array.isArray(Multi.view.commentaryEvents) }));
    assert.match(server.url, /^ws:\/\/localhost:8080/); assert.equal(server.events, true);
    await shot('server-battle');
    await page.click('#caster-toggle');
    assert.equal(await page.getAttribute('#caster-toggle','aria-pressed'), 'true');
    assert.equal(await page.locator('#caster-bubble').isVisible(), false);
    await shot('gag');
    await page.click('#caster-toggle');
    await page.evaluate(() => Game.returnToTitle());
    assert.equal(await page.locator('#commentator').isVisible(), false);
    // Deterministic fixture with real Battle and real damage functions; no canned lines.
    await page.evaluate(() => sessionStorage.removeItem('bounce-royale-session-v1'));
    await page.reload();
    await page.evaluate(() => {
      Game.newMatch('cat', 'bow', {mode:'friendly'});
      Game.state = 'battle'; Game.mode = 'single'; Game.battles = null;
      showScreen(null); hudVisible(true); TitleDemo.sync(); updatePlayersPanel(Game);
      window.casterTest = new Battle('diamond', Game.players.slice(0,2));
      const b = window.casterTest; b.fighters[0].name = '아주긴닉네임을확인하는선수'; b.fighters[1].name = '우주선수';
      renderBattle(b);
      b.phase = 'fight'; b.simT = .01; renderBattle(b);
    });
    await page.waitForSelector('#caster-bubble:not([hidden])');
    for (const width of [320,390,720]) {
      await page.setViewportSize({width,height:Math.round(width*16/9)});
      await page.evaluate(() => resizeCanvas());
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => {
        const box = id => document.getElementById(id).getBoundingClientRect();
        const b=box('caster-bubble'), t=box('hud-top'), p=box('hud-players'), a=box('app'), c=box('caster-toggle');
        const copy=document.getElementById('caster-copy');
        return {inApp:b.left>=a.left && b.right<=a.right && c.left>=a.left,
          timerClear:b.right<=t.left || b.bottom<=t.top || b.top>=t.bottom,
          rosterClear:b.top>=p.bottom, copyFits:copy.scrollHeight<=copy.clientHeight+1};
      });
      assert.deepEqual(layout,{inApp:true,timerClear:true,rosterClear:true,copyFits:true},'portrait '+width);
      await shot('normal-'+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => { casterTest.fighters[0].name = '별사탕'; });
    await page.waitForTimeout(3600);
    await page.evaluate(() => {
      const b=casterTest,[a,e]=b.fighters; b.simT=5;
      useSkill(b,a,'weapon'); renderBattle(b);
      updateTimers(b,a,.3); useSkill(b,a,'weapon');
      projectileHit(b,b.projectiles.find(p=>p.kind==='charge'),e); renderBattle(b);
    });
    assert.match(await page.locator('#caster-copy').innerText(), /차지 샷.*적중/);
    await shot('skill-hit');
    await page.click('#caster-toggle');
    await page.evaluate(() => {
      const b=casterTest,[a,e]=b.fighters; b.simT=6;
      dealDamage(b,a,e,3,{kind:'auto',autoType:'lightning'}); renderBattle(b);
    });
    assert.equal(await page.locator('#caster-bubble').isVisible(), false);
    await page.evaluate(() => { casterTest.finish(casterTest.fighters[0],'격파'); renderBattle(casterTest); });
    assert.equal(await page.locator('#commentator.is-gg.is-burst').count(),1);
    assert.match(await page.locator('#caster-copy').innerText(), /별사탕.*승리/);
    await page.waitForTimeout(180); await shot('gg-burst');
    await page.waitForTimeout(1450);
    await page.evaluate(() => renderBattle(casterTest));
    assert.equal(await page.locator('#caster-bubble').isVisible(), false);
    assert.equal(await page.locator('#commentator.is-muted:not(.is-burst)').count(),1,'gag returns, preference remains');
    await page.evaluate(() => { hudVisible(false); showScreen('scr-title'); });
    assert.equal(await page.locator('#commentator').isVisible(),false);
    await page.reload();
    assert.equal(await page.evaluate(() => BounceRoyalCommentary.muted),true,'gag persists across reload');
    assert.deepEqual(errors,[]); assert.deepEqual(failed,[]);
    console.log('PASS: live server telemetry, 320/390/720 layouts, confirmed skill hit, gag toggle/persistence, GG breakout, hide on menus, no JS/HTTP errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
