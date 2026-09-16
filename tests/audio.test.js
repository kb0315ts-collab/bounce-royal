'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { create, catalog, samples } = require('../js/audio.js');

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { assert.ok(Number.isFinite(value) && Number.isFinite(time)); this.value = value; this.events.push(['set',value,time]); }
  linearRampToValueAtTime(value, time) { assert.ok(Number.isFinite(value) && Number.isFinite(time)); this.events.push(['linear',value,time]); }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0 && Number.isFinite(value) && Number.isFinite(time)); this.events.push(['exponential',value,time]); }
  cancelScheduledValues(time) { this.events.push(['cancel',time]); }
}
class Node {
  constructor(kind) {
    this.kind = kind;
    this.gain = new Param(); this.frequency = new Param(); this.Q = new Param(); this.pan = new Param();
    this.playbackRate = new Param(1); this.connections = []; this.disconnected = false;
    this.stops = []; this.starts = []; this.onended = null;
  }
  connect(other) { assert.ok(other); this.connections.push(other); return other; }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(time) { this.starts.push(time); }
  stop(time) { this.stops.push(time); }
}
class Context {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.nodes = []; this.destination = new Node('destination'); }
  node(kind) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createDynamicsCompressor() {
    const node = this.node('compressor');
    for (const p of ['threshold','knee','ratio','attack','release']) node[p] = new Param();
    return node;
  }
  createOscillator() { return this.node('oscillator'); }
  createBufferSource() { return this.node('buffer'); }
  createBiquadFilter() { return this.node('filter'); }
  createStereoPanner() { return this.node('panner'); }
  createWaveShaper() { return this.node('limiter'); }
  createBuffer(channels, length, sampleRate) { const data=Array.from({length:channels},()=>new Float32Array(length));return { numberOfChannels:channels,length,sampleRate,duration:length / sampleRate,getChannelData:c=>data[c] }; }
  async decodeAudioData() { return {...this.createBuffer(1,1600,8000),sample:true}; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
const failedFetch = async () => ({ ok:false });
const newEngine = options => create({ AudioContext:Context, fetch:failedFetch, ...options });

test('audio remains lazy until a user gesture requests ensure', async () => {
  let created = 0;
  class LazyContext extends Context { constructor() { super(); created++; } }
  const engine = newEngine({ AudioContext:LazyContext });
  assert.equal(created,0);
  assert.equal(engine.play('ui.click'),false);
  assert.equal(engine.ctx,null);
  assert.equal(await engine.ensure(),true);
  assert.equal(created,1);
  await engine.ensure();
  assert.equal(created,1);
});

test('audio randomness is isolated from the simulation and catalog icons resolve', async () => {
  const context = { Math:Object.create(Math) };
  context.Math.random = () => { throw new Error('Game RNG must not be consumed by audio'); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/audio-design.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/audio.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/icons.js'),'utf8'),context);
  const engine = context.BounceRoyalAudio.create({ AudioContext:Context, fetch:failedFetch });
  await engine.ensure();
  for (const item of context.BounceRoyalAudio.catalog) {
    assert.equal(context.BRIcons.has(item.icon),true,item.icon);
    engine.stopAll();
    assert.equal(engine.play(item.id),true,item.id);
  }
});

test('all catalog sounds schedule bounded finite sources using synthesis fallback', async () => {
  const engine = newEngine();
  await engine.ensure();
  await engine.loadPromise;
  assert.ok(catalog.length > 0);
  assert.equal(new Set(catalog.map(item => item.id)).size,catalog.length);
  assert.ok(Object.isFrozen(catalog));
  for (const item of catalog) {
    assert.ok(Object.isFrozen(item));
    assert.ok(item.name && item.group && item.description && item.icon);
    assert.ok(item.duration > 0 && item.duration < 2);
    assert.equal(await engine.preview(item.id),true,item.id);
    assert.equal(engine.voices.size,1,item.id);
    const voice = [...engine.voices][0];
    assert.ok(voice.sources.length >= 1 && voice.sources.length <= 8,item.id);
    assert.ok(voice.endTime <= item.duration + .001,item.id);
    for (const source of voice.sources) {
      assert.equal(source.starts.length,1,item.id);
      assert.equal(source.stops.length,1,item.id);
      assert.ok(source.stops[0] > source.starts[0],item.id);
    }
  }
  engine.stopAll();
  assert.equal(engine.voices.size,0);
  assert.equal(engine.sampleFailures.length,Object.keys(samples).length);
});

test('zero volume, mute and runtime volume adjustments control every layer', async () => {
  const engine = newEngine({ volume:0 });
  await engine.ensure();
  assert.equal(engine.play('ui.win'),false);
  assert.equal(engine.master.gain.value,0);
  engine.volume = .5;
  assert.equal(engine.master.gain.value,.36);
  assert.equal(engine.play('ui.win'),true);
  const sources = [...engine.voices][0].sources.slice();
  engine.muted = true;
  assert.equal(engine.master.gain.value,0);
  assert.equal(engine.voices.size,0);
  assert.ok(sources.every(source => source.disconnected && source.stops.length === 2));
  assert.equal(await engine.preview('ui.click'),false);
  engine.muted = false;
  assert.equal(engine.master.gain.value,.36);
  engine.volume = 9;
  assert.equal(engine.volume,1);
  engine.volume = -1;
  assert.equal(engine.volume,0);
  engine.volume = NaN;
  assert.equal(engine.volume,0);
});

test('peak protection is linear at normal levels and bounds extreme stacked transients', async()=>{
  const engine=newEngine();await engine.ensure();
  const curve=engine.limiter.curve;
  assert.equal(curve[2048],0);
  assert.ok(Math.abs(curve[3072]-.5)<1e-6);
  assert.ok(curve.at(-1)<.98 && curve.at(-1)>.9);
  assert.equal(engine.limiter.oversample,'none');
});

test('stopAll cancels already scheduled delayed notes and disconnects their graphs', async () => {
  const engine = newEngine();
  await engine.ensure();
  engine.play('ui.win');
  const voice = [...engine.voices][0];
  assert.ok(voice.sources.some(source => source.starts[0] > engine.ctx.currentTime));
  engine.stopAll();
  assert.equal(engine.voices.size,0);
  assert.ok(voice.nodes.every(node => node.disconnected));
  assert.ok(voice.sources.every(source => source.onended === null && source.stops.at(-1) === undefined));
});

test('preview replaces earlier previews instead of stacking them', async () => {
  const engine = newEngine();
  const results = await Promise.all([engine.preview('ui.win'),engine.preview('ui.lose')]);
  assert.deepEqual(results,[false,true]);
  assert.equal(engine.voices.size,1);
  assert.equal([...engine.voices][0].id,'ui.lose');
  assert.equal(await engine.preview('ui.lose'),true);
  assert.equal(engine.voices.size,1);
});

test('sample preview waits for its canonical layer and stop cancels pending playback', async () => {
  const responses = [];
  const engine = newEngine({ fetch:() => new Promise(resolve => responses.push(resolve)) });
  const preview = engine.preview('weapon.bow.fire');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(engine.voices.size,0);
  assert.equal(engine._sampleWaiters.size,1);
  for (const resolve of responses) resolve({ ok:true, arrayBuffer:async () => new ArrayBuffer(1) });
  assert.equal(await preview,true);
  assert.ok([...engine.voices][0].sources.some(source => source.buffer && source.buffer.sample));
  assert.equal(engine._sampleWaiters.size,0);

  const slow = newEngine({ fetch:() => new Promise(() => {}) });
  const pending = slow.preview('weapon.pistol.fire');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(slow._sampleWaiters.size,1);
  slow.stopAll();
  assert.equal(await pending,false);
  assert.equal(slow._sampleWaiters.size,0);
  assert.equal(slow.voices.size,0);
});

test('slow sample downloads use synthesis after the preview deadline', async () => {
  const engine = newEngine({ fetch:() => new Promise(() => {}), previewWaitMs:1 });
  assert.equal(await engine.preview('weapon.shotgun.fire'),true);
  assert.ok([...engine.voices][0].sources.some(source => source.loop));
  assert.equal(engine._sampleWaiters.size,0);
});

test('voice cap protects important feedback and evicts old equal-priority noise', async () => {
  const engine = newEngine({ maxVoices:2 });
  await engine.ensure();
  engine.play('ui.win');
  engine.play('ui.lose');
  assert.equal(engine.play('battle.hit'),false);
  assert.equal(engine.check().dropped,1);
  assert.equal(engine.voices.size,2);
  assert.equal(engine.play('ui.fight'),true);
  assert.deepEqual([...engine.voices].map(voice => voice.id),['ui.lose','ui.fight']);
  assert.equal(engine.voices.size,2);
});

test('same-sound cooldown prevents duplicate shot clusters without blocking later shots', async () => {
  const engine = newEngine();
  await engine.ensure();
  assert.equal(engine.play('weapon.pistol.fire'),true);
  assert.equal(engine.play('weapon.pistol.fire'),false);
  engine.ctx.currentTime = .12;
  assert.equal(engine.play('weapon.pistol.fire'),true);
  assert.equal(engine.play('unknown.sound'),false);
});

test('approved bow remains unlayered and unavailable casual samples retain bounded material fallbacks', async () => {
  const requests = [];
  const engine = newEngine({ fetch:async url => { requests.push(url); return { ok:!url.includes('shotgun'), arrayBuffer:async () => new ArrayBuffer(1) }; } });
  await engine.ensure();
  await engine.loadPromise;
  assert.equal(requests.length,Object.keys(samples).length);
  assert.equal(engine.buffers.size,Object.keys(samples).length-Object.values(samples).filter(file=>file.includes('shotgun')).length);
  engine.fire('arrow');
  let voice = [...engine.voices][0];
  assert.ok(voice.sources.some(source => source.buffer && source.buffer.sample));
  assert.equal(voice.sources.length,1,'Do not bury the approved original sample in new synth tones');
  engine.stopAll();
  engine.fire('shotgun');
  voice = [...engine.voices][0];
  assert.ok(voice.sources.some(source => source.loop));
  assert.ok(!voice.sources.some(source => source.buffer && source.buffer.sample));
});

test('approved sword and projectile sweep signatures match the pre-update recipes', async () => {
  const engine=newEngine();await engine.ensure();
  for(const [id,start,mid,end,q] of [
    ['augment.shuriken',420*1.55,2400*1.55,700*1.55,5.5],
    ['augment.missile',420*.7,2400*.7,700*.7,5.5],
    ['augment.beam',420,2400,700,5.5],
  ]) {
    engine.stopAll();engine.ctx.nodes=[];await engine.preview(id);
    const filter=engine.ctx.nodes.find(n=>n.kind==='filter');
    assert.deepEqual(filter.frequency.events.map(e=>e[1]),[start,Math.min(mid,engine.ctx.sampleRate*.45),end]);
    assert.equal(filter.Q.value,q);
    assert.equal([...engine.voices][0].sources.length,1);
  }
  engine.stopAll();engine.ctx.nodes=[];await engine.preview('weapon.sword.hit');
  const filter=engine.ctx.nodes.find(n=>n.kind==='filter');
  assert.deepEqual(filter.frequency.events.map(e=>e[1]),[1900,500]);
  assert.equal(filter.Q.value,2.3);
  assert.equal(catalog.find(s=>s.id==='weapon.sword.hit').restored,true);
});

test('comparison preview never changes the sound used by gameplay', async () => {
  const engine=newEngine();await engine.ensure();
  await engine.preview('skill.bow.charge',{variant:'previous'});
  const previousEnd=[...engine.voices][0].endTime;
  assert.ok(previousEnd>1.68 && previousEnd<1.72);
  engine.stopAll();engine.play('skill.bow.charge');
  assert.equal([...engine.voices][0].sources.length,1);
  assert.ok([...engine.voices][0].endTime>1.22 && [...engine.voices][0].endTime<1.26);
});

test('comparison archive exactly preserves the deployed 511fb88 material recipes', () => {
  const previous=require('../js/audio-design-previous.js');
  const hash=crypto.createHash('sha256').update(JSON.stringify(previous)).digest('hex');
  assert.equal(hash,'7adda48f938e0a3db4f182acf92a86a432963c9bcad9bd12fb60a8a0bba9743e');
});

test('archived vote cues without overrides use deployed base sounds and never the current design', async () => {
  const previous=require('../js/audio-design-previous.js');
  const engine=newEngine();await engine.ensure();await engine.loadPromise;
  for(const [id,oldWave,oldPitch,newWave,newPitch] of [
    ['ui.vote.tick','sine',960,'triangle',1340],
    ['ui.vote.win','triangle',784,'sine',1046],
  ]) {
    assert.equal(previous[id],undefined,'These deployed sounds used the base library');
    await engine.preview(id,{variant:'previous'});
    let oscillator=[...engine.voices][0].sources.find(source=>source.kind==='oscillator');
    assert.equal(oscillator.type,oldWave,id);
    assert.equal(oscillator.frequency.events[0][1],oldPitch,id);
    engine.stopAll();engine.play(id,{preview:true});
    oscillator=[...engine.voices][0].sources.find(source=>source.kind==='oscillator');
    assert.equal(oscillator.type,newWave,id);
    assert.equal(oscillator.frequency.events[0][1],newPitch,id);
  }
});

test('a main-game page without the archive safely uses current sounds for its unused comparison fallback', async () => {
  const context={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/audio-design.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/audio.js'),'utf8'),context);
  assert.equal(context.BounceRoyalPreviousSoundDesign,undefined);
  const engine=context.BounceRoyalAudio.create({AudioContext:Context,fetch:failedFetch});
  await engine.ensure();await engine.loadPromise;
  await engine.preview('ui.vote.tick',{variant:'previous'});
  const oscillator=[...engine.voices][0].sources.find(source=>source.kind==='oscillator');
  assert.equal(oscillator.type,'triangle');
  assert.equal(oscillator.frequency.events[0][1],1340);
  engine.stopAll();assert.equal(engine.voices.size,0);
});

test('all previous previews retain bounded scheduled lifetimes independently of the casual mix', async () => {
  const engine=newEngine();await engine.ensure();await engine.loadPromise;
  for(const item of catalog) {
    assert.equal(await engine.preview(item.id,{variant:'previous'}),true,item.id);
    const voice=[...engine.voices][0];
    assert.ok(voice.sources.length>0&&voice.sources.length<=8,item.id);
    assert.ok(voice.endTime<=item.previousDuration+.001,item.id);
  }
  engine.stopAll();assert.equal(engine.voices.size,0);
});

test('removed cues stay silent even for old snapshots; revised sounds have exact pre-update comparisons', async () => {
  const engine=newEngine();await engine.ensure();
  for(const id of ['augment.flame','augment.summon','augment.steal','augment.freeze']) {
    assert.equal(engine.play(id),false,id);
    assert.equal(await engine.preview(id,{variant:'previous'}),false,id);
    assert.ok(!catalog.some(item=>item.id===id));
  }
  // 새 무기의 점화·쇠추 휘두름·방패 벽 반사까지 청음실에서 확인할 수 있다.
  // 쇠사슬 휘두름 소리를 뺐다 (60 -> 59)
  assert.equal(catalog.filter(item=>item.revised && !item.internal).length,59);
  const previous=require('../js/audio-design-previous.js');
  assert.equal(previous['weapon.mine.place'].layers[0].name,'actionMine');
  assert.equal(previous['skill.bow.charge'].layers[0].name,'actionDraw');
});

test('barrage audition includes a full burst, gameplay only schedules the start cue and real individual shots', async () => {
  const engine=newEngine();await engine.ensure();
  engine.play('skill.pistol.barrage');
  let voice=[...engine.voices][0];
  assert.equal(voice.sources.length,1);
  assert.ok(voice.endTime < .3,'The gameplay start must not schedule fake future shots');
  engine.stopAll();await engine.preview('skill.pistol.barrage');
  voice=[...engine.voices][0];
  assert.equal(voice.sources.length,2);
  assert.ok(voice.endTime > 1.5 && voice.endTime < 1.7);
  engine.stopAll();
  assert.ok(voice.sources.every(source=>source.disconnected));
  assert.equal(engine.voices.size,0);
  engine.play('weapon.pistol.barrage-shot');
  assert.ok([...engine.voices][0].endTime < .2);
});

test('Foley playback keeps the complete recording and cleans reverse/alternate layers', async () => {
  const engine=newEngine({fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)})});
  await engine.ensure();await engine.loadPromise;
  const full=engine.ctx.createBuffer(1,3600,8000); // deliberately longer than old .21s crop
  engine.buffers.set('bow',full);engine.play('weapon.bow.fire',{preview:true});
  assert.ok(Math.abs([...engine.voices][0].sources[0].stops[0]-.475)<1e-9);
  engine.stopAll();assert.equal(await engine.preview('skill.cat.rewind'),true);
  const reverse=[...engine.voices][0].sources[0].buffer;
  assert.notEqual(reverse,engine.buffers.get('arrowPass'));
  engine.stopAll();assert.equal(engine.voices.size,0);
});

test('release sounds cancel preparation even if its sources have delayed starts', async () => {
  const engine = newEngine();
  await engine.ensure();
  engine.play('skill.bow.charge');
  const charge = [...engine.voices][0];
  engine.play('skill.bow.release');
  assert.ok(charge.finished);
  assert.equal(engine.voices.size,1);
  assert.equal([...engine.voices][0].id,'skill.bow.release');
});

test('finished sounds disconnect all nodes and leave no active voice', async () => {
  const engine = newEngine();
  await engine.ensure();
  engine.play('weapon.staff.fire');
  const voice = [...engine.voices][0];
  for (const source of voice.sources) source.onended();
  assert.equal(engine.voices.size,0);
  assert.ok(voice.nodes.every(node => node.disconnected));
});

test('hidden tabs stop sound and suppress new playback until visible', async () => {
  const listeners = new Map();
  const document = { hidden:false, addEventListener:(id, fn) => listeners.set(id,fn), removeEventListener:id => listeners.delete(id) };
  const engine = newEngine({ document });
  await engine.ensure();
  engine.play('ui.win');
  document.hidden = true;
  listeners.get('visibilitychange')();
  assert.equal(engine.voices.size,0);
  assert.equal(engine.play('ui.click'),false);
  document.hidden = false;
  assert.equal(engine.play('ui.click'),true);
  engine.destroy();
  assert.equal(listeners.size,0);
});

test('legacy entry points remain usable and feed the same bounded engine', async () => {
  const engine = newEngine();
  await engine.ensure();
  for (const method of ['ui','hit','bounce','boom','skill','coin','win','lose','shoot']) {
    engine.stopAll();
    assert.equal(engine[method](),true,method);
  }
  for (const weapon of ['sword','dagger']) { engine.stopAll(); assert.equal(engine.slash(weapon),true); }
  for (const kind of ['arrow','bullet','shotgun','orb','mine','charge','beam','missile','shuriken']) { engine.stopAll(); assert.equal(engine.fire(kind),true,kind); }
  engine.stopAll();
  assert.equal(engine.tone(440,.1,'triangle',.03,220,.1),true);
  assert.equal(engine.voices.size,1);
});

test('caster voice stays lazy and does not consume combat or simulation randomness', async () => {
  const engine = newEngine({seed:173});
  const initial = engine._randomState;
  assert.equal(engine.chatterSyllable({index:2}),false);
  assert.equal(engine.ctx,null);
  assert.equal(engine._randomState,initial);
  await engine.ensure();
  for (let index=0;index<12;index++) {
    engine.ctx.currentTime=index*.16;
    assert.equal(engine.chatterSyllable({index}),true);
  }
  assert.equal(engine._randomState,initial,'Toy chatter has a separate cosmetic RNG');
  engine.stopAll();
});

test('caster syllables are short, high, vowel-shaped chirps like an Animal Crossing villager', async () => {
  const engine = newEngine({seed:89});
  await engine.ensure();
  const pitches = new Set(), vowels = new Set();
  for (const [index,emphasis,muffled] of [[0,false,false],[1,false,false],[2,true,false],[3,false,true],[Infinity,true,true]]) {
    engine.stopChatter();
    assert.equal(engine.chatterSyllable({index,emphasis,muffled}),true);
    const voice = [...engine.voices][0];
    assert.equal(voice.id,'caster.chatter');
    assert.equal(voice.sources.length,3);
    assert.ok(voice.endTime > .06 && voice.endTime <= .08, '글자 하나는 음절 간격(62ms)보다 짧게 끊긴다 (' + voice.endTime + ')');
    assert.ok(voice.nodes.length <= 10);
    assert.deepEqual(voice.sources.map(source=>source.type),['sawtooth','sawtooth','square']);
    const filters = voice.nodes.filter(node=>node.kind==='filter');
    assert.deepEqual(filters.map(filter=>filter.type),['bandpass','bandpass','lowpass']);
    pitches.add(voice.sources[0].frequency.events[0][1]);
    vowels.add(filters[0].frequency.events[1][1]);
    for (const node of voice.nodes.filter(node=>node.kind==='gain' && node!==voice.output)) {
      assert.ok(node.gain.events.every(event=>event[1]>=0 && event[1]<=.086));
      assert.equal(node.gain.events.at(-1)[1],.0001,'Mouth closes with a soft release');
    }
  }
  assert.ok(pitches.size>=4);
  assert.ok(vowels.size>=4);
  // 모음·억양·자음은 해설이 넘기는 대사 악보를 따른다
  const say = shape => {
    engine.stopChatter();
    assert.equal(engine.chatterSyllable({index:0,...shape}),true);
    const voice = [...engine.voices].at(-1);
    return { voice, filters:voice.nodes.filter(node=>node.kind==='filter'), pitch:voice.sources[0].frequency.events[1][1] };
  };
  const i = say({vowel:6}), o = say({vowel:3});
  assert.ok(i.filters[1].frequency.events[1][1] > o.filters[1].frequency.events[1][1] * 2, 'ㅣ는 ㅗ보다 둘째 공명이 훨씬 높다');
  const flat = say({vowel:0}), rise = say({vowel:0,tilt:.3});
  assert.ok(flat.pitch > 300 && flat.pitch < 480, '작은 동물처럼 높은 음 (' + flat.pitch + 'Hz)');
  assert.ok(rise.pitch > flat.pitch * 1.15, '억양을 올리면 음이 올라간다');
  const hiss = say({vowel:0,onset:'hiss'}), pop = say({vowel:0,onset:'pop'});
  assert.equal(hiss.voice.sources.length,4,'자음 앞머리가 한 겹 붙는다');
  assert.equal(hiss.filters[3].type,'highpass');
  assert.equal(pop.filters[3].type,'bandpass');
  engine.stopAll();
});

test('caster variation is reproducible and cannot stack past its cooldown or voice budget', async () => {
  const engines = [newEngine({seed:291,maxVoices:2}),newEngine({seed:291,maxVoices:2})];
  for (const engine of engines) await engine.ensure();
  for (let index=0;index<60;index++) {
    const paths=[];
    for (const engine of engines) {
      engine.ctx.currentTime=index*.1;
      assert.equal(engine.chatterSyllable({index}),true);
      assert.equal(engine.chatterSyllable({index}),false,'Duplicate syllable in one tick is suppressed');
      assert.ok(engine.voices.size<=2);
      const latest=[...engine.voices].at(-1);
      paths.push(latest.sources[0].frequency.events);
    }
    assert.deepEqual(paths[0],paths[1]);
  }
  for (const engine of engines) engine.stopAll();
});

test('stopChatter stops only the commentator and leaves weapon feedback alive', async () => {
  const engine = newEngine();
  await engine.ensure();
  assert.equal(engine.fire('arrow'),true);
  const arrow=[...engine.voices][0];
  assert.equal(engine.chatterSyllable(),true);
  const chatter=[...engine.voices].find(voice=>voice.id==='caster.chatter');
  engine.stopChatter();
  assert.equal(chatter.finished,true);
  assert.ok(chatter.nodes.every(node=>node.disconnected));
  assert.equal(arrow.finished,false);
  assert.deepEqual([...engine.voices],[arrow]);
  assert.equal(engine.chatterSyllable({muffled:true}),true,'A new gag state can begin without an old cooldown');
  engine.stopAll();
});

test('caster chatter cannot steal the last combat voice slot', async () => {
  const engine = newEngine({maxVoices:1});
  await engine.ensure();
  engine.fire('bullet');
  const shot=[...engine.voices][0];
  assert.equal(engine.chatterSyllable({emphasis:true}),false);
  assert.equal(shot.finished,false);
  assert.deepEqual([...engine.voices],[shot]);
  engine.stopAll();
  assert.equal(engine.chatterSyllable(),true);
  const chatter=[...engine.voices][0];
  assert.equal(engine.fire('bullet'),true);
  assert.equal(chatter.finished,true);
  engine.stopAll();
});

test('caster respects master mute, zero volume, suspended context and tab visibility', async () => {
  const listeners = new Map();
  const document = {hidden:false,addEventListener:(id,fn)=>listeners.set(id,fn),removeEventListener:id=>listeners.delete(id)};
  const engine = newEngine({document,volume:0});
  await engine.ensure();
  assert.equal(engine.chatterSyllable(),false);
  engine.volume=.5;
  engine.muted=true;
  assert.equal(engine.chatterSyllable({muffled:true,emphasis:true}),false);
  engine.muted=false;
  engine.ctx.state='suspended';
  assert.equal(engine.chatterSyllable(),false);
  engine.ctx.state='running';
  assert.equal(engine.chatterSyllable(),true);
  document.hidden=true;
  listeners.get('visibilitychange')();
  assert.equal(engine.voices.size,0);
  assert.equal(engine.chatterSyllable(),false);
  document.hidden=false;
  assert.equal(engine.chatterSyllable(),true);
  engine.destroy();
  assert.equal(engine.voices.size,0);
});

test('sound lab can audition the toy voice without changing combat recipes', async () => {
  const cue=catalog.find(item=>item.id==='caster.chatter');
  assert.ok(cue);
  assert.equal(cue.group,'인터페이스');
  assert.ok(cue.duration<.4);
  const engine=newEngine();
  assert.equal(await engine.preview(cue.id),true);
  const voice=[...engine.voices][0];
  assert.equal(voice.sources.length,7,'두 음절 + 자음 앞머리 하나');
  assert.ok(voice.sources.some(source=>source.starts[0]>.05),'Preview has two separate syllables');
  engine.stopChatter();
  assert.equal(engine.voices.size,0);
});
