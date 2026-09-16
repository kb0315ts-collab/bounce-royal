'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* 전투 화면 글자(피해 숫자·이름표·스탯판)는 한 풀의 칸을 순서대로 돌려쓴다.
 * 떠 있는 피해 숫자 개수가 바뀌면 칸이 밀려, 스탯판이 방금까지 사라지던
 * 피해 숫자의 칸을 넘겨받는다. 그 투명도나 테두리가 남으면 안 된다. */
function scene() {
  const sandbox = {
    console, Math, performance: { now: () => 0 },
    document: { getElementById: () => ({ clientWidth: 375, clientHeight: 476 }) },
    Phaser: { Scene: class {}, Game: class {}, Scale: {}, WEBGL: 2 },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = ['js/data.js', 'js/sim.js', 'js/render.js']
    .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  vm.runInContext(source + '\nglobalThis.api = { BattleScene };', sandbox);
  // Phaser Text처럼 동작하는 가짜: setStyle은 넘긴 속성만 바꾸고 나머지는 둔다
  const fakeText = () => ({
    style: { fontStyle: '', stroke: '#fff', strokeThickness: 0 }, alpha: 1, visible: true,
    setOrigin() { return this; }, setVisible(v) { this.visible = v; return this; },
    setPosition() { return this; }, setText(t) { this.text = t; return this; },
    setAlpha(a) { this.alpha = a; return this; },
    setStyle(s) { Object.assign(this.style, s); return this; },
  });
  const sc = new sandbox.api.BattleScene();
  sc.texts = []; sc.textIndex = 0; sc.world = { add() {} };
  sc.add = { text: fakeText };
  return sc;
}

const popup = { fontFamily: 'Jua', fontSize: '16px', fontStyle: 'bold', color: '#fff', stroke: '#243747', strokeThickness: 3.4 };
const nameTag = { fontFamily: 'Jua', fontSize: '12px', color: '#243747', stroke: '#fff7dd', strokeThickness: 3 };
const statRow = { fontFamily: 'Jua', fontSize: '18px', color: '#607568', originX: 0, originY: 0.5 };

test('a stat label that inherits a fading damage number slot is fully opaque with its own look', () => {
  const sc = scene();
  // 한 프레임: 사라지는 중인 피해 숫자 두 개가 앞 칸을 쓴다
  sc.textIndex = 0;
  for (let i = 0; i < 2; i++) sc.useText(0, 0, String(20 + i), popup).setAlpha(0.13);
  // 다음 프레임: 피해 숫자가 사라져 스탯판이 그 칸을 넘겨받는다
  sc.textIndex = 0;
  const label = sc.useText(0, 0, '공격력', statRow);
  assert.equal(label, sc.texts[0], '같은 칸을 돌려쓴다');
  assert.equal(label.alpha, 1, '앞 주인의 투명도가 남지 않는다');
  assert.equal(label.style.strokeThickness, 0, '앞 주인의 테두리가 남지 않는다');
  assert.equal(label.style.fontStyle, '', '앞 주인의 굵기가 남지 않는다');
  assert.equal(label.style.color, '#607568');
});

test('a stat label that inherits a name tag slot drops the cream outline', () => {
  const sc = scene();
  sc.textIndex = 0;
  sc.useText(0, 0, '바운서', nameTag);
  sc.textIndex = 0;
  const label = sc.useText(0, 0, '체력', statRow);
  assert.equal(label.style.strokeThickness, 0);
  // 이름표·피해 숫자가 다시 그 칸을 받으면 제 모양을 되찾는다
  sc.textIndex = 0;
  const tag = sc.useText(0, 0, '바운서', nameTag);
  assert.equal(tag.style.stroke, '#fff7dd'); assert.equal(tag.style.strokeThickness, 3);
});
