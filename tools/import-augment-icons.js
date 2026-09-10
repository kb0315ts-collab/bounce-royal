'use strict';

// Import ONLY the selected, attributed vector artwork. No third-party code is run.
// First import: node tools/import-augment-icons.js --source-root <pack/icons>
// Rebuild from the checked-in originals: node tools/import-augment-icons.js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const selection = require('./augment-icon-selection.json');
const base = path.join(root, 'assets/icons/game-icons');
const output = path.join(root, 'assets/icons/augments');
const sourceArg = process.argv.indexOf('--source-root');
const sourceRoot = sourceArg < 0 ? null : path.resolve(process.argv[sourceArg + 1]);
const data = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\nglobalThis.augments = AUGMENTS;', data);
const ids = data.augments.map(a => a.id);
if (JSON.stringify(ids.slice().sort()) !== JSON.stringify(Object.keys(selection).sort())) throw Error('Selection must match the current augment roster exactly');
const authors = {
  lorc: { name:'Lorc', url:'http://lorcblog.blogspot.com' },
  delapouite: { name:'Delapouite', url:'https://delapouite.com' },
  darkzaitzev: { name:'DarkZaitzev', url:'http://darkzaitzev.deviantart.com' },
  skoll: { name:'Skoll', url:'https://game-icons.net/1x1/skoll/teller-mine.html' },
  willdabeast: { name:'Willdabeast', url:'http://wjbstories.blogspot.com' },
};
const palette = {
  health:['#b0ffb1','#43c68e'], attack:['#ffe88a','#ffa948'],
  speed:['#97f3ff','#3abbdc'], magic:['#ddb7ff','#9974e7'],
  defense:['#dbe8ff','#80addf'], electric:['#fff686','#f3bd35'],
  fire:['#ffd381','#ff8350'], cold:['#c5ffff','#56cfd8'],
  utility:['#bedbff','#71aafa'], curse:['#ffc2d2','#eb769a'],
};
const badges = {
  heal:'<path d="M397 357v80m-40-40h80"/>',
  snow:'<path d="M397 348v98m-43-74 86 50m-86 0 86-50m-43-24-12 14m12-14 12 14m-12 84-12-14m12 14 12-14"/>',
  clock:'<circle cx="397" cy="397" r="40"/><path d="M397 368v30l22 14"/>',
  two:'<path d="M369 378c0-30 57-30 57 0 0 18-44 36-56 52h59"/>',
  three:'<path d="M371 367h47l-30 27c53-10 48 44 13 44-14 0-24-4-30-11"/>',
  five:'<path d="M424 364h-48l-4 34c65-21 68 44 24 44-14 0-22-4-29-11"/>',
};
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const manifest = {};
fs.mkdirSync(output, { recursive:true });
for (const id of ids) {
  const choice = selection[id];
  if (!/^[a-z]+\/[a-z0-9-]+$/.test(choice.source)) throw Error('Invalid source: ' + id);
  const [author] = choice.source.split('/');
  if (!authors[author] || !palette[choice.tone]) throw Error('Unknown author or tone: ' + id);
  const originalPath = path.join(base, 'source', choice.source + '.svg');
  if (sourceRoot) {
    fs.mkdirSync(path.dirname(originalPath), { recursive:true });
    fs.copyFileSync(path.join(sourceRoot, 'ffffff/transparent/1x1', choice.source + '.svg'), originalPath);
  }
  const original = fs.readFileSync(originalPath, 'utf8');
  // This selection consists exclusively of single, filled paths. Reconstruct
  // from geometry instead of trusting XML, scripts, styles or external references.
  const match = original.trim().match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512"><path fill="#fff" d="([MmZzLlHhVvCcSsQqTtAaEe0-9.,+\-\s]+)"\s*\/><\/svg>$/);
  if (!match) throw Error('Unexpected SVG structure: ' + choice.source);
  const drawing = '<path d="' + match[1] + '"/>';
  let shapes;
  if (choice.layout === 'pair') {
    shapes = '<g transform="translate(4 165) scale(.58)">' + drawing + '</g><g transform="translate(214 28) scale(.58)">' + drawing + '</g>';
  } else if (choice.layout === 'split') {
    shapes = '<g transform="translate(0 130) scale(.46)">' + drawing + '</g><g transform="translate(276 130) scale(.46)">' + drawing + '</g><path d="M263 40 240 122l37 58-37 69 35 71-30 144" fill="none" stroke="' + palette[choice.tone][1] + '" stroke-width="16" stroke-linejoin="round"/>';
  } else if (choice.layout === 'triple') {
    shapes = [[0,140,-155],[154,36,-135],[308,140,-115]].map(([x,y,angle]) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + angle + ' 102 102) scale(.4)">' + drawing + '</g>').join('');
  } else if (choice.badge) {
    shapes = '<g transform="translate(12 12) scale(.83)">' + drawing + '</g>';
  } else {
    shapes = '<g transform="translate(10 10) scale(.96)">' + drawing + '</g>';
  }
  let badge = '';
  if (choice.badge) {
    if (!badges[choice.badge]) throw Error('Unknown badge: ' + id);
    badge = '<circle cx="397" cy="407" r="86" fill="#243747"/><circle cx="397" cy="397" r="86" fill="' + palette[choice.tone][0] + '" stroke="#243747" stroke-width="12"/><g fill="none" stroke="#243747" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">' + badges[choice.badge] + '</g>';
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="ink" x1="0" y1="0" x2=".35" y2="1"><stop stop-color="' + palette[choice.tone][0] + '"/><stop offset="1" stop-color="' + palette[choice.tone][1] + '"/></linearGradient></defs><g fill="url(#ink)" stroke="#243747" stroke-width="11" stroke-linejoin="round" paint-order="stroke fill">' + shapes + '</g>' + badge + '</svg>\n';
  fs.writeFileSync(path.join(output, id + '.svg'), svg);
  manifest[id] = {
    file:'assets/icons/augments/' + id + '.svg',
    source:choice.source, sourceUrl:'https://game-icons.net/1x1/' + choice.source + '.html',
    author:authors[author].name, authorUrl:authors[author].url,
    license:'CC BY 3.0', licenseUrl:'https://creativecommons.org/licenses/by/3.0/',
    tone:choice.tone, reason:choice.reason,
    modifications:'Casual color gradient; charcoal outline; scaled' + (choice.layout ? '; ' + choice.layout + ' composition' : '') + (choice.layout === 'split' ? '; original fracture mark added' : '') + (choice.badge ? '; original ' + choice.badge + ' badge added' : ''),
    sourceSha256:hash(original), sha256:hash(svg),
  };
}
if (sourceRoot) fs.copyFileSync(path.join(sourceRoot, 'license.txt'), path.join(base, 'LICENSE.txt'));
fs.writeFileSync(path.join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// Small browser index; source attribution remains in the gallery's manifest.
const assets = Object.fromEntries(Object.entries(manifest).map(([id, m]) => ['aug-' + id, m.file + '?v=' + m.sha256.slice(0, 12)]));
fs.writeFileSync(path.join(root, 'js/augment-assets.js'), "/* Generated by tools/import-augment-icons.js. Artwork credits: icon-gallery.html#credits */\n(function (global) {\n  'use strict';\n  global.BRAugmentAssets = Object.freeze(" + JSON.stringify(assets, null, 2) + ");\n})(typeof window !== 'undefined' ? window : globalThis);\n");
console.log('Imported ' + ids.length + ' augment images from ' + new Set(Object.values(selection).map(v => v.source)).size + ' credited Game-icons originals.');
