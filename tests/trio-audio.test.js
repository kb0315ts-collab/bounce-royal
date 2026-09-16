'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, catalog } = require('../js/audio.js');
const design = require('../js/audio-design.js');

const ids = ['weapon.flame.ignite', 'weapon.flame.spray',
  'weapon.chain.hit', 'skill.chain.swap', 'weapon.shield.throw', 'weapon.shield.hit',
  'weapon.shield.bounce', 'weapon.shield.catch'];
// Inspect the actual merged recipe handed to the scheduler, not a duplicate
// test-only catalog. The common audio tests exercise its real WebAudio graph.
const engine = create();
engine._playDefinition = def => def;
const recipe = id => engine.play(id);

test('new weapon feedback is identifiable, locally synthesized and available in sound lab', () => {
  const signatures = new Set();
  for (const id of ids) {
    const def = recipe(id), item = catalog.find(s => s.id === id);
    assert.ok(item && !item.internal, id);
    assert.ok(item.signature && item.description, id);
    assert.ok(def.layers.length >= 3 && def.layers.length <= 8, id);
    assert.ok(def.layers.every(l => l.kind !== 'sample'), 'no new downloads: ' + id);
    assert.ok(item.duration >= .06 && item.duration <= .4, id);
    signatures.add(JSON.stringify(def.layers));
    for (const layer of def.layers) {
      assert.ok(layer.dur > 0 && layer.dur <= .35, id);
      assert.ok(layer.gain > 0 && layer.gain <= .3, id);
      for (const key of ['gainPath', 'filterPath', 'freqPath']) if (layer[key]) {
        const points = layer[key];
        assert.equal(points[0][0], 0, id + ' ' + key);
        assert.equal(points.at(-1)[0], 1, id + ' ' + key);
        assert.ok(points.every(([t, value], i) => Number.isFinite(value) && t >= 0 && t <= 1
          && (!i || t > points[i - 1][0])), id + ' ' + key);
      }
    }
  }
  assert.equal(signatures.size, ids.length, 'no recycled whole-cue recipes');
});

test('held flame is textured air without a pitched drone, ignition is a separate short cue', () => {
  const spray = recipe('weapon.flame.spray'), ignite = recipe('weapon.flame.ignite');
  assert.ok(spray.layers.every(l => l.kind === 'noise'));
  assert.ok(spray.layers.some(l => l.filter === 'lowpass' && l.filterPath && l.gainPath));
  assert.ok(spray.layers.some(l => l.filter === 'bandpass' && l.gainPath));
  assert.ok(spray.gap >= .2 && ignite.gap >= .25);
  assert.equal(spray.priority, 0, 'spray cannot crowd out skill feedback');
  assert.ok(ignite.priority > spray.priority);
  const duration = Math.max(...spray.layers.map(l => l.dur + l.delay));
  assert.ok(duration <= spray.gap * 1.2, 'no many-layer drone buildup on held input');
});

test('chain makes no swing sound at all; only a successful contact has a weighted attack', () => {
  // 계속 도는 무기라 상시 휘두름 소리는 과했다. 카탈로그에서도 뺐다.
  assert.equal(catalog.find(s => s.id === 'weapon.chain.swing'), undefined);
  const hit = recipe('weapon.chain.hit');
  assert.ok(hit.layers.some(l => l.kind === 'tone' && l.f < 200));
  assert.ok(hit.layers.some(l => l.delay >= .075), 'short loose-link rattle after impact');
  assert.ok(recipe('skill.chain.swap').layers.some(l => l.delay >= .18), 'exchange ends with a tension/catch cue');
});

test('shield throw, player impact, wall bounce and hand catch are different materials/timings', () => {
  const thrown = recipe('weapon.shield.throw'), hit = recipe('weapon.shield.hit');
  const wall = recipe('weapon.shield.bounce'), caught = recipe('weapon.shield.catch');
  assert.ok(thrown.layers.some(l => l.gainPath && l.gainPath.length >= 8), 'rotating air pulses');
  assert.ok(hit.layers.some(l => l.kind === 'tone' && l.f < 500));
  assert.ok(wall.layers.filter(l => l.kind === 'tone').every(l => l.f > 1000));
  assert.ok(Math.max(...caught.layers.map(l => l.dur + l.delay)) < .10, 'hand immediately damps the plate');
});

test('silent augments and approved sword/projectile air remain unchanged', () => {
  for (const id of ['augment.flame', 'augment.summon', 'augment.steal', 'augment.freeze']) {
    assert.equal(recipe(id), false);
    assert.equal(design[id], undefined);
  }
  for (const id of ['weapon.sword.hit', 'weapon.dagger.hit', 'augment.shuriken', 'augment.missile', 'augment.beam']) {
    assert.equal(recipe(id).restored, true, id);
    assert.equal(recipe(id).layers.length, 1, id);
  }
});
