'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const art = require('../js/augment-art.js');
const data = {};
vm.runInNewContext(read('js/data.js')+'\nglobalThis.ids=AUGMENTS.map(a=>a.id);',data);

test('all 99 augments have original native SVG with a compact, safe vocabulary',()=>{
  assert.deepEqual([...art.keys].sort(),Array.from(data.ids,id=>'aug-'+id).sort());
  const unique = new Set();
  for(const key of art.keys){
    const s=art.markup(key),d=art.descriptors[key];
    assert.ok(art.primitives[d.base],key+' has a shared primary');
    assert.ok(d.reason && d.modifier,key+' explains its composition');
    assert.match(s,/viewBox="0 0 96 96"/);
    assert.match(s,/class="ui-svg ui-svg--augment ui-svg--game-art/);
    assert.match(s,/aria-hidden="true"/);
    assert.doesNotMatch(s,/<(?:script|text|style|image|foreignObject|use|linearGradient|radialGradient)\b|\bhref\s*=|\bon\w+\s*=|\burl\(|NaN|Infinity/i);
    assert.ok(s.length<2600,key+' keeps mobile geometry bounded');
    unique.add(s);
  }
  assert.equal(unique.size,99,'Family members have meaningful visual differences');
  assert.equal(art.markup('__proto__'),'');assert.equal(art.markup('constructor'),'');assert.equal(art.markup('unknown'),'');
  assert.doesNotMatch(art.markup('aug-atk15','bad" onload="evil()'),/onload=|evil\(/);
});

test('stat families reuse the same effect while win/loss/round conditions change',()=>{
  const d=id=>art.descriptors['aug-'+id];
  for(const ids of [['atk15','warmup','winMomentum','bloodRush','vengeance','seasonedExp'],['hp15','learnLoss','survivor'],['rot15','accelRot','battleExp'],['missile','missilePlus','missileUp'],['shuriken','shurikenSpd','shurikenUp'],['flame','flameUp','flameDur'],['m_big','m_heal','m_freeze']]){
    assert.equal(new Set(ids.map(id=>d(id).base)).size,1,ids.join(', '));
  }
  assert.equal(d('atk15').condition,null);
  for(const id of ['survivor','battleExp','seasonedExp'])assert.equal(d(id).condition,'round');
  assert.equal(d('winMomentum').condition,'win');assert.equal(d('bloodRush').condition,'streak');
  assert.equal(d('vengeance').condition,'loss');assert.equal(d('learnLoss').condition,'loss');
  assert.equal(d('shuriken').condition,null);assert.equal(d('missile').condition,null);
  assert.equal(d('w_giant').condition,'expand','Giant Sword has size, not damage, symbolism');
  assert.equal(d('split').base,'split');assert.notEqual(d('split').base,d('twins').base);
});

test('native artwork takes precedence; archives stay available and do not affect menu or weapon art',()=>{
  let random=0;const math=Object.create(Math);math.random=()=>{random++;return .5;};
  const c={Math:math};
  for(const file of ['js/augment-assets.js','js/augment-art.js','js/icons.js'])vm.runInNewContext(read(file),c);
  for(const key of art.keys){
    assert.match(c.BRIcons.markup(key),/ui-svg--game-art/);
    assert.match(c.BRIcons.archivedMarkup(key),/^<img /);
    assert.match(c.BRIcons.legacyMarkup(key),/^<svg /);
  }
  for(const key of ['ranked','friendly','sword','dagger','bow','pistol','staff','mine','cat'])assert.equal(c.BRIcons.markup(key),c.BRIcons.legacyMarkup(key));
  assert.equal(random,0,'Presentation never consumes simulation randomness');
  c.BRAugmentArt=null;
  assert.match(c.BRIcons.markup('aug-atk15'),/^<img /,'Archive remains a reversible fallback');
  for(const page of ['index.html','sound-lab.html','icon-gallery.html']){
    const h=read(page);assert.ok(h.indexOf('js/augment-art.js')<h.indexOf('js/icons.js'));
  }
});

test('cosmic title videos preserve the portrait, silent replay contract',()=>{
  const m=JSON.parse(read('assets/title-demos-cosmic/manifest.json'));
  assert.equal(m.clips.length,6);
  for(const c of m.clips){
    assert.equal(c.width,540);assert.equal(c.height,960);assert.equal(c.sound,false);
    assert.ok(c.seconds>14.7&&c.seconds<15.3);assert.equal(c.tailSeekVerified,true);
    assert.equal(fs.statSync(path.join(__dirname,'../assets/title-demos-cosmic',c.name)).size,c.bytes);
  }
  assert.match(read('js/main.js'),/const TITLE_DEMO_MODE = 'video'/);
});
