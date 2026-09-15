'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const ctx = {};
vm.runInNewContext(read('js/data.js') + '\nglobalThis.ids = AUGMENTS.map(a => a.id);', ctx);
vm.runInNewContext(read('js/augment-assets.js'), ctx);
vm.runInNewContext(read('js/icons.js'), ctx);
const metadata = JSON.parse(read('assets/icons/game-icons/manifest.json'));
assert.deepEqual(Object.keys(metadata).sort(), Array.from(ctx.ids).sort());
assert.equal(Object.keys(ctx.BRAugmentAssets).length, ctx.ids.length);
const hashes = new Set();
let totalBytes = 0;
for (const id of ctx.ids) {
  const entry = metadata[id];
  const icon = read(entry.file);
  assert.equal(hash(icon), entry.sha256, id + ': modified output needs a rebuild');
  assert.ok(entry.author && entry.reason && entry.modifications);
  /* 아이콘은 두 갈래다.
   *  - 외부에서 가져온 것: 원본 파일이 함께 들어 있어야 하고 출처·라이선스를 밝힌다
   *  - 직접 그린 것(origin:'native'): 원본이 없으니 그 검사는 건너뛴다
   * 어느 쪽이든 아래의 안전·형식 검사는 똑같이 받는다. */
  if (entry.origin === 'native') {
    assert.ok(!entry.source && !entry.sourceUrl, id + ': 직접 그린 아이콘에 외부 출처를 달면 안 된다');
  } else {
    const original = read('assets/icons/game-icons/source/' + entry.source + '.svg');
    assert.equal(hash(original), entry.sourceSha256, id + ': original must remain unchanged');
    assert.match(entry.sourceUrl, /^https:\/\/game-icons\.net\/1x1\/[a-z]+\/[a-z0-9-]+\.html$/);
    assert.equal(entry.licenseUrl, 'https://creativecommons.org/licenses/by/3.0/');
  }
  assert.match(icon, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 512 512">/);
  assert.doesNotMatch(icon, /<(?:script|style|image|foreignObject|use)\b|\bhref\s*=|\bon\w+\s*=/i);
  for (const ref of icon.matchAll(/url\(([^)]+)\)/g)) assert.equal(ref[1], '#ink', 'Only the local color gradient can be referenced');
  const markup = ctx.BRIcons.markup('aug-' + id, 'sample-class');
  assert.match(markup, /^<img class="ui-svg ui-svg--augment ui-svg--asset sample-class"/);
  assert.ok(markup.includes('src="' + entry.file + '?v=' + entry.sha256.slice(0, 12) + '"'));
  assert.ok(markup.includes('data-augment-icon="aug-' + id + '"'));
  assert.ok(markup.includes('alt=""') && markup.includes('aria-hidden="true"'));
  assert.match(ctx.BRIcons.legacyMarkup('aug-' + id), /^<svg /, 'Rollback artwork must remain available');
  hashes.add(hash(icon)); totalBytes += Buffer.byteLength(icon);
}
assert.equal(hashes.size, ctx.ids.length, 'Each derivative must be visually distinct');
assert.ok(totalBytes < 700000, 'Game-ready icons should stay below the 700 KB raw SVG budget');
assert.doesNotMatch(ctx.BRIcons.markup('aug-hp15', 'bad" onerror="evil()'), /onerror=|evil\(/);
for (const key of ['ranked','sword','skill','unknown']) assert.equal(ctx.BRIcons.markup(key), ctx.BRIcons.legacyMarkup(key), 'Non-augment icons must be unchanged');
ctx.BRAugmentAssets = { 'aug-hp15':'https://invalid.example/remote.svg' };
assert.equal(ctx.BRIcons.markup('aug-hp15'), ctx.BRIcons.legacyMarkup('aug-hp15'), 'Unsafe asset URL must fall back');
for (const page of ['index.html','sound-lab.html','icon-gallery.html']) {
  const source = read(page);
  assert.ok(source.indexOf('js/augment-assets.js') < source.indexOf('js/icons.js'), page + ': asset index must load before icons');
}
assert.match(read('index.html'), /href="icon-gallery.html"/, 'Attribution must be accessible from the game');
assert.match(read('server/index.js'), /'\.svg': 'image\/svg\+xml'/, 'Server must serve vector images with the correct MIME type');
console.log('✓ ' + ctx.ids.length + ' augment assets: coverage, provenance, hashes, safe SVG, fallback, script order; ' + (totalBytes / 1024).toFixed(1) + ' KiB game artwork');
