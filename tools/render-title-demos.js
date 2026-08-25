'use strict';

// Reproducibly renders six live Battle simulations into title-background MP4s.
// Usage: node tools/render-title-demos.js <@napi-rs/canvas path> <ffmpeg exe>
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const canvasModulePath = process.argv[2];
const ffmpegPath = process.argv[3];
const onlyClip = Number(process.argv[4] || 0);
if (!canvasModulePath || !ffmpegPath) {
  console.error('Canvas module path and FFmpeg executable path are required.');
  process.exit(2);
}
const { createCanvas } = require(canvasModulePath);

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'assets', 'title-demos');
fs.mkdirSync(outputDir, { recursive: true });

const WIDTH = 540;
const HEIGHT = 960;
const GAME_TOP = Math.round(HEIGHT * 0.144);
const GAME_HEIGHT = Math.round(HEIGHT * 0.714);
const FPS = 30;
const FRAMES = FPS * 15;
const gameCanvas = createCanvas(WIDTH, GAME_HEIGHT);
Object.defineProperties(gameCanvas, {
  clientWidth: { value: WIDTH, configurable: true },
  clientHeight: { value: GAME_HEIGHT, configurable: true },
});
const outputCanvas = createCanvas(WIDTH, HEIGHT);
const outputCtx = outputCanvas.getContext('2d');

const sandbox = {
  console,
  Math,
  performance: { now: () => Date.now() },
  setTimeout,
  clearTimeout,
  window: { devicePixelRatio: 1, addEventListener() {} },
  document: { getElementById(id) { return id === 'game' ? gameCanvas : null; } },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['js/data.js', 'js/sim.js', 'js/render.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const scenarios = [
  [['cat','sword',['s_beam','s_giant']],['wak','dagger',['d_dual','d_bleed']],['soft','pistol',['p_dual','p_mag']],['bomb','staff',['s_triple','s_bounce']]],
  [['balloon','bow',['b_triple','b_homing']],['bball','mine',['m_big','m_freeze']],['cat','staff',['s_triple','s_steal']],['wak','pistol',['p_dual','p_bayonet']]],
  [['bomb','mine',['m_big','missile','missilePlus']],['soft','bow',['b_triple','shuriken']],['balloon','sword',['s_beam','satellite']],['bball','staff',['s_triple','lightning']]],
  [['wak','pistol',['p_dual','p_mag','flame']],['cat','bow',['b_triple','b_homing']],['bomb','dagger',['d_dual','d_phase']],['soft','mine',['m_big','m_heal']]],
  [['bball','sword',['s_beam','desperateSpin']],['balloon','staff',['s_triple','s_bounce']],['wak','mine',['m_big','missile']],['cat','pistol',['p_dual','satellite']]],
  [['soft','dagger',['d_dual','d_bleed']],['bomb','bow',['b_triple','b_kb']],['bball','pistol',['p_dual','p_bayonet']],['balloon','mine',['m_big','flame']]],
];

function makePlayer([charId, weaponId, augments], index) {
  return {
    id: 900 + index, name: `DEMO ${index + 1}`, isAI: true,
    color: ['#4da6ff', '#ff6879', '#6bd968', '#ffd24d'][index],
    charId, weaponId, coins: 5, coinsLost: 0, augments: augments.slice(),
    augmentBaselines: {}, copiedSkill: null, gamble: false, trollCondition: false,
    damageRewardMult: 1, wins: 0, losses: 0, streak: 0, rounds: 0, totalDmg: 0,
  };
}

function startScenario(scenario) {
  sandbox.__recordPlayers = scenario.map(makePlayer);
  vm.runInContext(`
    globalThis.__recordBattle = new Battle('circle', globalThis.__recordPlayers, { demo:true });
    globalThis.__recordBattle.phase = 'fight';
    globalThis.__recordBattle.simT = 0;
  `, sandbox);
}

function writeFrame(child) {
  vm.runInContext(`
    globalThis.__recordBattle.update(1 / ${FPS});
    renderBattle(globalThis.__recordBattle);
  `, sandbox);
  outputCtx.fillStyle = '#050812';
  outputCtx.fillRect(0, 0, WIDTH, HEIGHT);
  outputCtx.drawImage(gameCanvas, 0, GAME_TOP, WIDTH, GAME_HEIGHT);
  const pixels = outputCtx.getImageData(0, 0, WIDTH, HEIGHT).data;
  return new Promise(resolve => {
    const data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    if (child.stdin.write(data)) resolve();
    else child.stdin.once('drain', resolve);
  });
}

async function renderClip(scenario, index) {
  startScenario(scenario);
  const output = path.join(outputDir, `title-demo-${String(index + 1).padStart(2, '0')}.mp4`);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', '-',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-b:v', '1000k', '-maxrate', '1200k', '-bufsize', '2000k',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ];
  const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let frame = 0; frame < FRAMES; frame++) await writeFrame(child);
  child.stdin.end();
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with ${code}`)));
  });
  const mb = fs.statSync(output).size / 1024 / 1024;
  console.log(`${path.basename(output)} · ${mb.toFixed(2)} MB`);
}

(async () => {
  if (onlyClip >= 1 && onlyClip <= scenarios.length) {
    await renderClip(scenarios[onlyClip - 1], onlyClip - 1);
  } else {
    for (let i = 0; i < scenarios.length; i++) await renderClip(scenarios[i], i);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
