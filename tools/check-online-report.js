'use strict';
const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(process.argv[3]||'http://localhost:8082/');
    await page.evaluate(()=>BounceRoyalNet.on('roundEnd',m=>window.reportPacket=m));
    await page.click('#btn-friendly');
    await page.waitForFunction(()=>Game.state==='lobby');
    await page.click('#btn-room-start');
    await page.waitForSelector('#weapon-cards .weapon-card');
    await page.locator('#weapon-cards .weapon-card').first().click();
    await page.waitForFunction(()=>Game.state==='augment'&&!!window.reportPacket,null,{timeout:140000});
    const result=await page.evaluate(()=>{
      const row=reportPacket.reports[BounceRoyalNet.seat];
      return {row,text:document.getElementById('caster-copy').textContent,
        expected:BounceRoyalBroadcastCore.recapLines(row,WEAPONS,CHARACTERS)[0],
        dock:document.getElementById('commentator').parentElement.id};
    });
    assert.ok(result.row);assert.equal(result.text,result.expected);
    assert.equal(result.dock,'augment-caster-dock');
    assert.deepEqual(errors,[]);
    console.log('PASS: real server battle → authoritative roundEnd report → correct own-player recap in augment selection',JSON.stringify(result.row));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
