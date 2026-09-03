'use strict';
/* ============================================================
 * 브라우저용 게임 코드를 Node에서 그대로 불러온다.
 *
 * js/ 아래 파일들은 <script>로 로드되는 클래식 스크립트라 전역에 심볼을
 * 노출한다. 이를 하나의 vm 컨텍스트에 이어 붙여 실행하고 필요한 심볼만
 * 꺼내 쓴다. 게임 파일을 서버용으로 수정하지 않으므로 클라이언트와
 * 완전히 같은 물리·규칙이 돌아간다. (tests/ 가 쓰는 방식과 동일하다)
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const EXPORTS = [
  'Battle', 'Arena', 'CHARACTERS', 'WEAPONS', 'MAPS', 'AUGMENTS', 'AUG_BY_ID',
  'AI_NAMES', 'BATTLE_TIME', 'OVERTIME', 'AIM_TIME', 'DIAMOND_L', 'DUEL_ARENA_L',
  'rollAugmentOffers', 'applyAugmentPick', 'aiPickAugment', 'augEligible',
  'winRound', 'loseCoin', 'useSkill', 'applyCommonAim', 'setSteerInput', 'clearSteerInput', 'buildFighter',
  'GAME_EVENTS', 'GAME_EVENT_BY_ID', 'rollGameEventOffers', 'resolveGameEventVote',
  'resetGameEventState', 'applyGameEvent', 'eventAugmentPickCount',
  'BounceRoyalMatchmaking', 'shuffle', 'pick', 'rand',
];

function loadCore() {
  const sandbox = { console, Math, Date, performance, JSON, Map, Set };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const source = [
    read('js/data.js'),
    read('js/sim.js'),
    read('js/matchmaking.js'),
    read('js/events.js'),
    `globalThis.__core = { ${EXPORTS.join(', ')} };`,
  ].join('\n');
  vm.runInContext(source, context, { filename: 'bounce-royal-core.js' });
  return context.__core;
}

module.exports = loadCore();
