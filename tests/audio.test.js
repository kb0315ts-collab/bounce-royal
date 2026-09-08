'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create, catalog } = require('../js/audio.js');

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
  assert.ok(catalog.length >= 59);
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
  assert.equal(engine.sampleFailures.length,11);
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

test('approved original samples remain unlayered while failed files retain their original whoosh', async () => {
  const requests = [];
  const engine = newEngine({ fetch:async url => { requests.push(url); return { ok:!url.includes('shotgun'), arrayBuffer:async () => new ArrayBuffer(1) }; } });
  await engine.ensure();
  await engine.loadPromise;
  assert.equal(requests.length,11);
  assert.equal(engine.buffers.size,10);
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
  await engine.preview('weapon.sword.hit',{variant:'previous'});
  assert.equal([...engine.voices][0].sources.length,3);
  engine.stopAll();engine.play('weapon.sword.hit');
  assert.equal([...engine.voices][0].sources.length,1);
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
