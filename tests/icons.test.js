'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dataSource = fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8');
const iconSource = fs.readFileSync(path.join(root, 'js', 'icons.js'), 'utf8');
const augmentBlock = dataSource.slice(dataSource.indexOf('const AUGMENTS = ['), dataSource.indexOf('const AUG_BY_ID'));
const augmentIds = [...augmentBlock.matchAll(/\bid:'([^']+)'/g)].map(match => match[1]);
const context = {};
vm.runInNewContext(iconSource, context, { filename:'icons.js' });

const { BRIcons } = context;
const GEOMETRY_RE = /<(?:path|circle|rect|ellipse|polygon|polyline|line)\b/gi;
const FORBIDDEN_SVG_PATTERNS = Object.freeze([
  ['script element', /<\s*script\b/i],
  ['style element', /<\s*style\b/i],
  ['image element', /<\s*image\b/i],
  ['foreignObject element', /<\s*foreignObject\b/i],
  ['href attribute', /\bhref\s*=/i],
  ['event-handler attribute', /\bon[a-z0-9:_-]*\s*=/i],
  ['CSS url()', /\burl\s*\(/i],
  ['id attribute', /\bid\s*=/i],
]);

function parseSvg(markup, label) {
  const match = String(markup).trim().match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/i);
  assert.ok(match, `${label}: markup must contain exactly one SVG root`);
  const rootAttributes = match[1];
  const classMatch = rootAttributes.match(/\bclass="([^"]*)"/i);
  assert.ok(classMatch, `${label}: SVG root must have a class attribute`);
  return {
    rootAttributes,
    rootClasses:classMatch[1].trim().split(/\s+/).filter(Boolean),
    body:match[2],
  };
}

function hasClass(markup, className) {
  const classAttributes = [...String(markup).matchAll(/\bclass="([^"]*)"/gi)];
  return classAttributes.some(match => match[1].split(/\s+/).includes(className));
}

function assertSafeSvg(markup, label) {
  for (const [name, pattern] of FORBIDDEN_SVG_PATTERNS) {
    assert.doesNotMatch(markup, pattern, `${label}: ${name} is forbidden in icon markup`);
  }
}

assert.equal(augmentIds.length, 99, 'Update the icon contract when the augment roster changes');
assert.equal(new Set(augmentIds).size, augmentIds.length, 'Augment IDs themselves must be unique');

const missing = augmentIds.filter(id => !BRIcons.has(`aug-${id}`));
assert.deepEqual(missing, [], `Missing dedicated augment icons: ${missing.join(', ')}`);

const drawings = [];
for (const id of augmentIds) {
  const key = `aug-${id}`;
  const markup = BRIcons.markup(key);
  const svg = parseSvg(markup, key);

  assert.ok(svg.rootClasses.includes('ui-svg'), `${key}: root must retain the base ui-svg class`);
  assert.ok(svg.rootClasses.includes('ui-svg--augment'), `${key}: root must use the augment presentation class`);
  assert.ok(hasClass(svg.body, 'aug-primary'), `${key}: drawing must contain an aug-primary visual layer`);
  assertSafeSvg(markup, key);

  const geometryCount = (svg.body.match(GEOMETRY_RE) || []).length;
  assert.ok(geometryCount > 0, `${key}: drawing must contain visible geometry`);
  assert.ok(geometryCount <= 8, `${key}: ${geometryCount} geometry elements exceeds the mobile icon budget of 8`);

  drawings.push(svg.body.replace(/\s+/g, ' ').trim());
}

assert.equal(new Set(drawings).size, augmentIds.length, 'Every augment must have a genuinely distinct SVG drawing');

for (const key of ['sword', 'ranked']) {
  const markup = BRIcons.markup(key);
  const svg = parseSvg(markup, key);
  assert.ok(svg.rootClasses.includes('ui-svg'), `${key}: root must retain the base ui-svg class`);
  assert.ok(!svg.rootClasses.includes('ui-svg--augment'), `${key}: a regular icon must not opt into augment styling`);
  assert.ok(!hasClass(markup, 'aug-primary'), `${key}: a regular icon must not contain augment visual layers`);
  assert.ok(!hasClass(markup, 'aug-secondary'), `${key}: a regular icon must not contain augment visual layers`);
  assertSafeSvg(markup, key);
}

const unknownKey = '__definitely-not-an-icon__';
assert.equal(BRIcons.has(unknownKey), false, 'Unknown icons must not be reported as available');
assert.equal(BRIcons.resolve(unknownKey), 'skill', 'Unknown icons must resolve to the skill fallback');
assert.equal(BRIcons.markup(unknownKey), BRIcons.markup('skill'), 'Unknown icon markup must match the skill fallback');
assert.ok(!parseSvg(BRIcons.markup(unknownKey), 'fallback').rootClasses.includes('ui-svg--augment'), 'Fallback must remain a regular icon');

const validCustomClass = 'icon-preview icon-preview_2';
const validMarkup = BRIcons.markup('sword', validCustomClass);
const validClasses = parseSvg(validMarkup, 'valid custom class').rootClasses;
assert.ok(validClasses.includes('icon-preview'), 'Sanitizer must preserve valid custom class tokens');
assert.ok(validClasses.includes('icon-preview_2'), 'Sanitizer must preserve valid underscore class tokens');

const maliciousClass = 'evil" onload="alert(1)" data-owned="yes';
const maliciousMarkup = BRIcons.markup('sword', maliciousClass);
const maliciousSvg = parseSvg(maliciousMarkup, 'malicious custom class');
assertSafeSvg(maliciousMarkup, 'malicious custom class');
assert.doesNotMatch(maliciousMarkup, /alert\s*\(/i, 'Class input must not leak script-like payload text');
assert.doesNotMatch(maliciousMarkup, /\bdata-owned\s*=/i, 'Class input must not create arbitrary SVG attributes');
assert.deepEqual(maliciousSvg.rootClasses, ['ui-svg'], 'An unsafe custom class string must be rejected rather than interpolated');

console.log(`✓ ${augmentIds.length} dedicated augment icons satisfy structure, clarity-budget, fallback, and SVG-safety contracts`);
