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

assert.equal(augmentIds.length, 93, '기획된 증강 수가 바뀌면 아이콘 전수 검증도 함께 갱신해야 한다');
const missing = augmentIds.filter(id => !context.BRIcons.has(`aug-${id}`));
assert.deepEqual(missing, [], `전용 아이콘이 없는 증강: ${missing.join(', ')}`);

const drawings = augmentIds.map(id => context.BRIcons.markup(`aug-${id}`));
assert.equal(new Set(drawings).size, augmentIds.length, '각 증강은 서로 다른 SVG 구성을 사용해야 한다');

console.log(`✓ 증강 ${augmentIds.length}종 모두 능력별 전용 SVG 아이콘을 사용한다`);
