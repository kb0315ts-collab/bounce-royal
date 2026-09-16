'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* 전투 캔버스는 화면에 보이는 크기에 기기 픽셀 비율을 곱해 그린다.
 * 예전에는 CSS 크기 그대로 그려 폰(DPR 2~3)에서 경기장·공·무기만 흐렸다. */
function runtime({ dpr, app = [375, 667], game = [375, 476] }) {
  const resizes = [];
  const el = (w, h) => ({ clientWidth: w, clientHeight: h, width: w, height: h });
  const canvas = el(...game), appEl = el(...app);
  class Game {
    constructor(config) {
      const self = this;
      this.scale = {
        width: config.width, height: config.height,
        resize(w, h) { resizes.push([w, h]); this.width = w; this.height = h; canvas.width = w; canvas.height = h; },
      };
      self.config = config;
    }
  }
  const sandbox = {
    console, Math, performance: { now: () => 0 },
    document: { getElementById: id => id === 'game' ? canvas : id === 'app' ? appEl : null },
    Phaser: { Scene: class {}, Game, Scale: {}, WEBGL: 2 },
    devicePixelRatio: dpr, addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = ['js/data.js', 'js/sim.js', 'js/render.js']
    .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  vm.runInContext(source + '\nglobalThis.api = { applyView, view: () => VIEW, DIAMOND_L };', sandbox);
  return { ...sandbox.api, canvas, resizes };
}

test('a DPR 2 phone draws the battle canvas at real pixels, capped by the 720x1280 budget', () => {
  const r = runtime({ dpr: 2 });
  r.applyView({ type: 'diamond', L: r.DIAMOND_L });
  const px = Math.min(2, 720 / 375, 1280 / 667);
  assert.deepEqual(r.resizes, [[Math.round(375 * px), Math.round(476 * px)]], '실제 픽셀로 키운다');
  assert.equal(r.canvas.width, 720);
  const v = r.view();
  assert.equal(v.w, 375, '그리기 좌표는 CSS 픽셀 그대로다');
  assert.ok(Math.abs(v.px - px) < 1e-9);
  r.applyView({ type: 'diamond', L: r.DIAMOND_L });
  assert.equal(r.resizes.length, 1, '크기가 같으면 매 프레임 다시 만들지 않는다');
});

test('a DPR 1 screen keeps the old one-to-one canvas and a DPR 3 phone stays within budget', () => {
  const flat = runtime({ dpr: 1 });
  flat.applyView(null);
  assert.deepEqual(flat.resizes, [], '이미 같은 크기라 바꿀 것이 없다');
  assert.equal(flat.view().px, 1);
  const dense = runtime({ dpr: 3, app: [390, 844], game: [390, 603] });
  dense.applyView(null);
  const [w, h] = dense.resizes[0];
  assert.ok(w <= 720 && h <= 1280, `픽셀 예산 안이다 (${w}x${h})`);
  assert.ok(w > 390 * 1.5, '그래도 CSS 크기보다 훨씬 촘촘하다');
});
