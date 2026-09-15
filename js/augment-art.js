/* Bounce Royale — native, faceless toy-art augment vocabulary.
 * No imported icon art, fonts, gradients, image requests, or game state.
 * Main symbol = affected stat / actual projectile. Bottom-right badge = trigger.
 * All geometry is authored here; projectile silhouettes follow render.js.
 */
(function (root) {
  'use strict';

  const C = Object.freeze({
    ink: '#243747', cream: '#fff6dc', blade: '#ebfff4', gold: '#ffd256',
    coral: '#f18c66', red: '#f2707e', blue: '#84dcf0', blueDark: '#5eaed0',
    mint: '#95dac4', purple: '#b394e8', orange: '#ffa544', white: '#ffffff',
  });
  const path = (d, fill = 'none', extra = '') => `<path d="${d}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
  const circle = (x, y, r, fill, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
  const ellipse = (x, y, rx, ry, fill, extra = '') => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
  const group = (s, x = 0, y = 0, scale = 1, rotation = 0) => `<g transform="translate(${x} ${y}) rotate(${rotation}) scale(${scale})">${s}</g>`;
  const noStroke = 'stroke="none"';
  const line = d => path(d);
  const ball = (color = C.blue, radius = 25) => circle(0, 0, radius, color) +
    ellipse(-radius * .28, -radius * .35, radius * .3, radius * .13, C.white, `${noStroke} transform="rotate(-28 ${-radius * .28} ${-radius * .35})"`);
  const heart = path('M0-16C-18-36-39-16-29 4C-23 17-9 27 0 33C9 27 23 17 29 4C39-16 18-36 0-16Z', C.red) +
    path('M-23-7Q-22-16-14-16', 'none', `stroke="${C.cream}" stroke-width="5"`);
  const swordUpright = path('M-5 17H5V33Q0 38-5 33Z', C.coral) +
    path('M-8 10V-19L0-35L8-19V10Z', C.blade) +
    path('M0-28V8H7V-18Z', '#c2e7e5', noStroke) +
    path('M-16 9H16L13 18H-13Z', C.gold);
  const daggerUpright = path('M-5 11H5V31Q0 36-5 31Z', C.coral) +
    path('M-9 7V-11L0-28L9-11V7Z', C.blade) +
    path('M0-22V6H7V-10Z', '#c2e7e5', noStroke) +
    path('M-15 5H15L12 13H-12Z', C.gold);
  const sword = group(swordUpright, 0, 0, 1, 40);
  const dagger = group(daggerUpright, 0, 0, 1, 40);
  const streaks = path('M-35-18H-19M-38-3H-24M-32 12H-20', 'none', 'stroke-width="5"');
  const damage = path('M0-33L9-17L27-25L22-7L36 1L20 10L25 29L6 22L-4 36L-12 18L-32 23L-23 5L-36-7L-16-12L-15-31L-2-21Z', C.gold) +
    path('M-8-8L7-13L14 3L0 14L-12 6Z', C.coral, noStroke);
  const flame = path('M-26 13C-29 0-16-11-15-24L-5-12L4-34C5-13 26-7 27 12C29 26 17 34 1 34C-13 34-25 28-26 13Z', C.orange) +
    path('M-10 20L-7 3L1 10L10-3L14 20Q13 30 1 30Q-11 29-10 20Z', '#ffef8c', noStroke);
  const bolt = path('M3-36L-24 4H-5L-12 36L27-9H6L17-36Z', C.gold) +
    path('M3-26L-10-3H1', 'none', `stroke="${C.cream}" stroke-width="4"`);
  const cross = path('M-7-24H7V-7H24V7H7V24H-7V7H-24V-7H-7Z', C.mint);
  const clock = circle(0, 0, 29, C.cream) + line('M0-18V0L14 8') +
    path('M0-28V-24M28 0H24M-28 0H-24M0 28V24', 'none', 'stroke-width="3"');
  const coin = circle(0, 0, 27, C.gold) + circle(0, 0, 17, '#ffeb9e', 'stroke-width="3"') +
    path('M-5-9H5V9H-5Z', C.gold, noStroke);
  const shield = path('M0-33L28-20V1Q26 23 0 36Q-26 23-28 1V-20Z', C.cream) +
    path('M0-23L19-14V0Q18 15 0 25Z', C.blue, noStroke);
  const arrow = path('M-26 0H19', 'none', `stroke="${C.ink}" stroke-width="8"`) +
    path('M-26 0H19', 'none', `stroke="${C.cream}" stroke-width="4"`) +
    path('M12-12L33 0L12 12Z', C.blade) + path('M-27 0L-33-12H-20L-11 0L-20 12H-33Z', C.coral);
  const missile = ellipse(-26, 0, 10, 6, C.orange) +
    path('M-7 0L-23-24L-20 0L-23 24Z', C.blue) +
    path('M33 0L-21-16V16Z', C.cream) + path('M27 0H-9', 'none', 'stroke="#ffe6a4" stroke-width="4"');
  const shuriken = Array.from({ length: 4 }, (_, i) => group(path('M0-9L34 0L0 9Z', C.blade), 0, 0, 1, i * 90)).join('') +
    circle(0, 0, 10, C.blue, 'stroke-width="3.5"');
  const beam = path('M35 0L-32-25V25Z', C.blue) + path('M23 0L-19-12V12Z', C.white, noStroke);
  const mine = Array.from({ length: 6 }, (_, i) => group(line('M26 0H35'), 0, 0, 1, i * 60)).join('') +
    circle(0, 0, 26, '#f8e3a0') + circle(0, 0, 13, C.blue, 'stroke-width="3.5"') +
    ellipse(-4, -5, 5, 3, C.white, noStroke);
  const orb = ball(C.purple, 26) + path('M-29 19L-35 25M28-21L33-26', 'none', `stroke="${C.purple}" stroke-width="4"`);
  const gun = path('M-11 6L-20 31H-2L8 7Z', C.gold) +
    path('M-29-18H29V4H-23Q-29 4-29-2Z', '#82b7c4') +
    path('M-21-10H16', 'none', `stroke="${C.blade}" stroke-width="5"`) +
    path('M22-18H31V4H22Z', '#55768b') + line('M4 8V16H-6');
  const snow = path('M0-32V32M-28-16L28 16M-28 16L28-16M-8-24L0-16L8-24M-8 24L0 16L8 24M-25-4L-14-8L-15-20M25 4L14 8L15 20M-25 4L-14 8L-15 20M25-4L14-8L15-20', 'none', `stroke="${C.ink}" stroke-width="7"`) +
    path('M0-32V32M-28-16L28 16M-28 16L28-16M-8-24L0-16L8-24M-8 24L0 16L8 24M-25-4L-14-8L-15-20M25 4L14 8L15 20M-25 4L-14 8L-15 20M25-4L14-8L15-20', 'none', `stroke="${C.blue}" stroke-width="3.5"`);
  const target = circle(0, 0, 26, C.cream) + circle(0, 0, 13, C.coral, 'stroke-width="3.5"') +
    line('M0-35V-22M0 35V22M-35 0H-22M35 0H22');
  // Match the actual new weapons: cream/gold rim + mint disc, mint fuel tank,
  // and chunky blue-steel weights. These are not the generic defence/orbit art.
  const disc = circle(0, 0, 30, C.gold) + circle(0, 0, 24, C.cream, 'stroke-width="3"') +
    circle(0, 0, 17, C.mint, 'stroke-width="3.5"') + circle(0, 0, 7, C.blue, 'stroke-width="3"') +
    path('M-14-7Q-10-15-3-16', 'none', `stroke="${C.white}" stroke-width="4"`) + line('M0-28V-25M28 0H25M0 28V25M-28 0H-25');
  const chainWeight = path('M-7-16H7V-12L15-6V7L7 15H-7L-15 7V-6L-7-12Z', '#95b1c7') +
    path('M-10-3Q-7-10 0-10', 'none', `stroke="${C.cream}" stroke-width="3.5"`) + circle(2, 3, 4.5, C.gold, 'stroke-width="2.5"');
  const chainLinks = path('M-23-29Q-31-11-17 1L5 17', 'none', 'stroke-width="8"') +
    path('M-23-29Q-31-11-17 1L5 17', 'none', `stroke="${C.cream}" stroke-width="3.5"`) +
    ellipse(-24, -22, 5, 8, C.cream, 'stroke-width="3.5"') +
    ellipse(-22, -7, 5, 8, C.blue, 'stroke-width="3.5" transform="rotate(-30 -22 -7)"');
  const weightedChain = chainLinks + group(chainWeight, 16, 17, 1.18);
  const flameJet = path('M-17-5L-3-16L-5-6L18-29L13-9L34-13L24 1L32 13L13 11L13 24L-16 6Z', C.orange) +
    path('M-18 0L6-10L1 0L23 2L8 10L-18 5Z', '#ffef8c', noStroke) +
    path('M-33-9H-15V10H-33Z', C.mint) + path('M-20-9V10', 'none', `stroke="${C.cream}" stroke-width="4"`);

  // Shared primary silhouettes. Repetition within a family is deliberate:
  // the badge changes the rule, not the identity of its weapon/stat.
  const primitives = Object.freeze({
    heart, attack: sword, dagger, damage,
    attackSpeed: streaks + group(sword, 5, 0, .91),
    move: streaks + group(ball(), 9, 0, .94),
    ball: ball(), heal: heart + group(cross, 15, 17, .48),
    absorb: group(sword, -16, -9, .71) + group(heart, 15, 15, .62) +
      path('M-24 15Q-20 29-7 31L-11 22M-7 31L-18 33', 'none', `stroke="${C.ink}" stroke-width="4"`),
    allStats: streaks + group(sword, -7, -8, .81) + group(ball(C.gold), 15, 13, .65),
    shield, coin, clock, flame, lightning: bolt, missile, shuriken, beam, mine, orb, gun, snow, target,
    disc, weightedChain, flameJet,
    barbedChain: chainLinks + path('M-27-8L-37-11L-29 2M-13-1L-9-13L-5 6M-7 12L-15 23L-1 20', C.cream, 'stroke-width="3.5"') +
      group(chainWeight, 16, 17, 1.18),
    twinChain: path('M-22-19L0 0L23 20', 'none', 'stroke-width="9"') +
      path('M-22-19L0 0L23 20', 'none', `stroke="${C.cream}" stroke-width="3.5"`) +
      group(chainWeight, -22, -20, .88) + group(chainWeight, 22, 20, .88) + ball(C.blue, 11),
    emberJet: group(flameJet, 0, -10, .87) + ellipse(7, 25, 28, 7, C.coral, 'stroke-width="3"') +
      path('M-9 23L-4 8L2 19L13 4L14 19L22 15L19 29H-6Z', C.orange, 'stroke-width="3.5"') +
      path('M3 24L9 16L12 25Z', '#ffef8c', noStroke),
    rocketBall: path('M-17-15L-36-4L-27 2L-38 17L-14 15Z', C.orange) + group(ball(), 9, -3, 1),
    shockwave: ellipse(0, 8, 35, 24, 'none', `stroke="${C.blueDark}" stroke-width="5"`) +
      ellipse(0, 8, 27, 15, 'none', 'stroke-width="3.5"') + group(ball(), 0, -7, .64),
    gas: path('M-25 20C-45 13-34-7-22-5C-26-30 4-38 14-17C34-22 45 3 29 14Q24 29 4 24Q-11 33-25 20Z', '#c7b8eb') +
      path('M-23 3Q-16-7-8 0M2-18Q13-16 13-5', 'none', `stroke="${C.cream}" stroke-width="4"`),
    gravity: circle(0, 0, 13, C.purple) +
      path('M-30-26Q-3-42 20-24L12-23M20-24L18-33M31-13Q42 13 23 28L24 18M23 28L33 25M10 33Q-21 43-31 14L-23 19M-31 14L-35 24', 'none', `stroke="${C.blueDark}" stroke-width="5"`),
    flameTrail: ellipse(0, 24, 34, 9, '#f7bb87', 'stroke-width="3.5"') + group(flame, 0, -4, .86),
    lightningCloud: path('M-27-3Q-39-16-24-24Q-15-40 0-29Q19-39 27-24Q41-19 29-6Z', '#c7e9ef') + group(bolt, 1, 9, .77),
    chainedLightning: group(bolt, -13, 0, .88) + group(bolt, 22, 10, .5),
    orbit: ellipse(0, 0, 35, 23, 'none', `stroke="${C.blueDark}" stroke-width="3.5" transform="rotate(-28)"`) +
      ball(C.cream, 20) + group(ball(), 26, -17, .47),
    doubleOrbit: ellipse(0, 0, 35, 23, 'none', `stroke="${C.blueDark}" stroke-width="3.5" transform="rotate(-28)"`) +
      ball(C.cream, 20) + group(ball(), 26, -17, .47) + group(ball(), -26, 17, .47),
    mini: group(ball(C.cream), -13, -8, .83) + group(ball(), 18, 16, .64),
    twins: group(ball(), -18, -9, .81) + group(ball(), 18, 17, .81),
    summonBlast: group(damage, 0, 0, 1.07) + group(ball(), 0, 1, .71),
    split: group(ball() + group(sword, 16, -4, .7), -20, -12, .69) +
      group(ball() + group(sword, 16, -4, .7), 18, 18, .69),
    protectedCoin: group(shield, 0, 1, 1) + group(coin, 0, -1, .64),
    phase: circle(0, 0, 29, 'none', 'stroke-dasharray="6 8" stroke-width="3.5"') +
      group(ball('#d5eee8'), 0, 0, .74),
    blood: path('M0-34C-6-19-26-2-26 12A26 26 0 0 0 26 12C26-2 6-19 0-34Z', C.red) +
      path('M-16 8Q-22 17-13 24', 'none', `stroke="${C.cream}" stroke-width="5"`),
    arrow: group(arrow, 0, 0, 1, -30),
    tripleArrow: group(arrow, -5, -19, .7, -43) + group(arrow, 7, 0, .78, -15) + group(arrow, 0, 24, .7, 13),
    homingArrow: path('M-31 26Q14 35 14-8', 'none', `stroke="${C.ink}" stroke-width="7"`) +
      path('M-31 26Q14 35 14-8', 'none', `stroke="${C.cream}" stroke-width="3.5"`) +
      path('M2-5L14-28L27-5Z', C.blade) + path('M-29 26L-34 13L-17 16L-13 27L-20 37H-34Z', C.coral),
    doubleDagger: group(daggerUpright, -17, 2, .85, -24) + group(daggerUpright, 17, 2, .85, 24),
    shotgun: group(gun, -9, 5, .91, -20) +
      ellipse(24, -22, 7, 4, C.gold, 'transform="rotate(-25 24 -22)" stroke-width="3"') +
      ellipse(33, -6, 7, 4, C.gold, 'stroke-width="3"'),
    magazine: path('M-16-30H16L21 27Q0 38-20 27Z', '#82b7c4') +
      path('M-20 23Q0 30 21 22V31Q0 38-20 31Z', C.gold) +
      path('M-8-17H8M-7-3H9M-6 11H10', 'none', `stroke="${C.cream}" stroke-width="6"`),
    bayonet: group(gun, -13, 7, .83, 0) + group(daggerUpright, 20, -2, .87, 22),
    doubleOrb: group(ball(C.purple), -22, -11, .7) + group(ball(C.purple), 22, 11, .7) +
      path('M-22 15V29M22-15V-29', 'none', `stroke="${C.purple}" stroke-width="4"`),
    sealedWeapon: group(orb, -12, -9, .77) + group(sword, 12, 10, .77) +
      path('M3 24L34-7', 'none', `stroke="${C.coral}" stroke-width="7"`),
    cooldown: clock + path('M-30-26L-17-25L-20-37M-31-25Q-22-38-7-37', 'none', `stroke="${C.blueDark}" stroke-width="5"`),
  });

  // Large, consistent condition badges: no numbers or tiny pictograms.
  const badgeArt = Object.freeze({
    time: clock,
    overtime: clock + path('M16-29L23-18L32-28', 'none', `stroke="${C.coral}" stroke-width="5"`),
    start: path('M-21 30V-30M-19-28Q-4-37 6-26Q17-19 29-28V4Q13 14 1 5Q-7-2-19 4Z', C.gold),
    lowHealth: path('M0-15C-18-35-38-15-28 5C-22 18-8 27 0 32C8 27 22 18 28 5C38-15 18-35 0-15Z', '#f8ddd2') +
      path('M-22 15Q-13 25 0 32Q13 25 22 15Z', C.red, noStroke) + line('M-15 10H15'),
    lethal: path('M0-15C-18-35-38-15-28 5C-22 18-8 27 0 32C8 27 22 18 28 5C38-15 18-35 0-15Z', C.red) +
      path('M8-24L-3-4L8 6L-4 27', 'none', `stroke="${C.cream}" stroke-width="6"`),
    win: flame,
    streak: group(flame, -23, 8, .55) + group(flame, 22, 8, .55) + group(flame, 0, -8, .69),
    loss: path('M0-34C-6-19-26-2-26 12A26 26 0 0 0 26 12C26-2 6-19 0-34Z', C.blueDark) +
      path('M-16 8Q-22 17-13 24', 'none', `stroke="${C.cream}" stroke-width="5"`),
    round: path('M-27 25V11H-16V25M-6 25V-2H5V25M15 25V-17H26V25', C.blue, 'stroke-width="3.5"') +
      path('M-30-3L-9-16L5-12L28-33M12-32H29V-16', 'none', `stroke="${C.ink}" stroke-width="5"`),
    coinLoss: coin + path('M9 22H33', 'none', `stroke="${C.coral}" stroke-width="10"`),
    lastCoin: coin,
    wall: path('M25-32V32', 'none', 'stroke-width="10"') +
      path('M-30-25L11 0L-29 25M-28 13L-29 25L-15 25', 'none', `stroke="${C.blueDark}" stroke-width="6"`),
    collision: group(ball(), -20, 0, .67) + group(ball(C.coral), 20, 0, .67) +
      path('M0-30V-19M0 19V30', 'none', 'stroke-width="5"'),
    hit: group(swordUpright, -13, 12, .78, 38) + group(damage, 18, -15, .55),
    hurt: group(ball(), 5, 11, .83) + group(damage, -14, -17, .55),
    health: heart,
    heal: cross,
    damage,
    speed: path('M-30-20H18M-34 0H29M-30 20H18', 'none', `stroke="${C.blueDark}" stroke-width="9"`),
    more: path('M0-25V25M-25 0H25', 'none', `stroke="${C.ink}" stroke-width="11"`),
    expand: path('M-9-9L-28-28M-28-12V-28H-12M9 9L28 28M12 28H28V12', 'none', `stroke="${C.ink}" stroke-width="7"`),
    contract: path('M-29-29L-8-8M-8-23V-8H-23M29 29L8 8M8 23V8H23', 'none', 'stroke-width="7"'),
    slow: clock + path('M10 22H34', 'none', `stroke="${C.coral}" stroke-width="9"`),
    bloodCost: path('M0-33C-6-17-23-1-23 13A23 23 0 0 0 23 13C23-1 6-17 0-33Z', C.red) +
      path('M12 23H33', 'none', `stroke="${C.ink}" stroke-width="7"`),
    healthCost: heart + path('M10 24H34', 'none', `stroke="${C.ink}" stroke-width="8"`),
    freeze: snow,
    rotation: path('M-26-8A27 27 0 0 1 25-10L14-12M25-10L28-23M26 8A27 27 0 0 1-25 10L-14 12M-25 10L-28 23', 'none', `stroke="${C.blueDark}" stroke-width="6"`),
    push: path('M-28 0H29M10-20L30 0L10 20', 'none', `stroke="${C.blueDark}" stroke-width="9"`),
    recoil: path('M29 0H-29M-9-20L-30 0L-9 20', 'none', `stroke="${C.blueDark}" stroke-width="9"`),
    magnet: path('M-27-27H-11V4Q0 20 11 4V-27H27V5Q0 48-27 5Z', C.coral) +
      path('M-27-27H-11V-12H-27ZM11-27H27V-12H11Z', C.cream, 'stroke-width="3"'),
    grip: path('M-22 7V-4Q-22-12-15-12V-22Q-15-30-7-27Q-4-36 4-28Q14-32 17-21Q27-23 28-13V7L17 20V30H-14V19Z', C.gold) +
      path('M-15-9H6Q15-6 10 3H-7M-6-25V-14M5-25V-14M17-20V-10', 'none', 'stroke-width="3.5"'),
  });

  // Descriptors deliberately describe semantics, not art-title guesses.
  // `modifier` explains a secondary change. `condition` alone selects a badge
  // when present; no pile of tiny badges is used to summarize every stat.
  const rows = [
    ['hp15', 'heart', null, 'increase', '두툼한 하트 하나: 최대 체력 증가.'],
    ['atk15', 'attack', null, 'increase', '실제 장난감 검: 무기 공격력 증가.'],
    ['dmg10', 'damage', null, 'increase', '타격 이펙트와 같은 노란 충격 별: 무기뿐 아니라 모든 피해 증가.'],
    ['rot15', 'attackSpeed', null, 'increase', '같은 검에 속도선: 공격속도 증가.'],
    ['move15', 'move', null, 'increase', '달리는 얼굴 없는 공: 이동속도 증가.'],
    ['lifesteal', 'absorb', null, 'damage-to-health', '검에서 하트로 이어지는 흡수: 가한 피해를 체력으로 회복.'],
    ['giant', 'ball', 'health', 'size-up', '커지는 공과 체력 하트: 본체 크기와 최대 체력 증가, 무기 확대 아님.'],
    ['tiny', 'ball', null, 'size-down', '작은 공을 향하는 안쪽 화살표: 본체 축소.'],
    ['elastic', 'move', 'wall', 'temporary', '이동속도 공 + 벽 반사 배지: 벽에 닿은 직후 가속.'],
    ['warmup', 'attack', 'time', 'growth', '공격력 검 + 시계: 전투 중 일정 시간마다 공격력 성장.'],
    ['accelRot', 'attackSpeed', 'time', 'growth', '공격속도 검 + 시계: 일정 시간마다 공격속도 성장.'],
    ['speedster', 'move', 'time', 'growth', '이동속도 공 + 시계: 일정 시간마다 이동속도 성장.'],
    ['meditate', 'heal', 'time', 'periodic', '회복 하트 + 시계: 일정 시간마다 체력 회복.'],
    ['marathoner', 'heal', 'overtime', 'missing-health', '회복 하트 + 연장 시계: 연장전 진입 시 잃은 체력 회복.'],
    ['rampage20', 'allStats', 'time', 'late-buff', '검과 움직이는 공 + 시계: 일정 시간 이후 공격력·공격속도·이동속도 강화.'],
    ['firstStrike', 'attack', 'start', 'temporary', '공격력 검 + 출발 깃발: 전투 초반에만 공격력 강화.'],
    ['rocketStart', 'rocketBall', 'start', 'piercing', '추진 불꽃이 붙은 공 + 출발 깃발: 첫 벽까지 초고속 관통 돌진.'],
    ['ironDefense', 'shield', 'start', 'temporary', '방패 + 출발 깃발: 전투 초반 피해 감소.'],
    ['berserker', 'attack', 'lowHealth', 'missing-health-growth', '공격력 검 + 빈 체력 하트: 잃은 체력에 비례해 공격력 상승.'],
    ['escapeInstinct', 'move', 'lowHealth', 'threshold', '이동속도 공 + 빈 체력 하트: 체력이 낮을 때 가속.'],
    ['lastResistance', 'shield', 'lethal', 'once', '방패 + 갈라진 하트: 첫 치명상을 막아 최소 체력으로 생존.'],
    ['survivalInstinct', 'heal', 'lowHealth', 'once', '회복 하트 + 빈 체력 하트: 처음 위험 체력에 도달할 때 회복.'],
    ['winMomentum', 'attack', 'win', 'growth', '공격력 검 + 주황 불꽃 하나: 승리할 때마다 공격력 성장.'],
    ['bloodRush', 'attack', 'streak', 'reset-on-loss', '공격력 검 + 여러 불꽃: 연승할수록 공격력 증가, 패배 시 초기화.'],
    ['vengeance', 'attack', 'loss', 'growth', '공격력 검 + 파란 눈물방울: 패배할 때마다 공격력 성장.'],
    ['learnLoss', 'heart', 'loss', 'growth', '최대 체력 하트 + 같은 파란 눈물방울: 패배할 때마다 체력 성장.'],
    ['survivor', 'heart', 'round', 'growth', '체력 하트 + 상승 그래프: 라운드 종료마다 최대 체력 성장.'],
    ['battleExp', 'attackSpeed', 'round', 'growth', '공격속도 검 + 같은 상승 그래프: 라운드마다 공격속도 성장.'],
    ['seasonedExp', 'attack', 'round', 'growth', '공격력 검 + 같은 상승 그래프: 라운드 종료마다 공격력 성장.'],
    ['fallenPower', 'damage', 'coinLoss', 'growth', '모든 피해 충격 별 + 잃는 코인: 코인 상실에 따라 피해 성장.'],
    ['brink', 'damage', 'lastCoin', 'threshold', '모든 피해 충격 별 + 마지막 코인 하나: 코인 한 개일 때 피해 증가.'],
    ['trollCondition', 'protectedCoin', 'loss', 'win-cost-damage-gain', '방패에 든 코인 + 패배 눈물: 다음 패배는 코인 보호와 피해 강화, 승리는 코인 상실.'],
    ['devilDeal', 'attack', 'coinLoss', 'immediate-cost', '공격력 검 + 코인 감소: 즉시 코인을 내고 공격력 획득.'],
    ['gamble', 'damage', 'win', 'coin-risk', '모든 피해 충격 별 + 승리 불꽃: 다음 승리 보상은 피해 강화, 패배는 추가 코인 손실.'],
    ['glass', 'attack', 'healthCost', 'trade', '공격력 검 + 체력 감소 하트: 최대 체력을 대가로 공격력 증가.'],
    ['brute', 'attack', 'slow', 'trade', '공격력 검 + 느려지는 시계: 공격력 대신 공격속도를 희생.'],
    ['bloodWeapon', 'attack', 'bloodCost', 'periodic-cost', '공격력 검 + 붉은 피 감소: 주기적인 체력 소모를 대가로 강화.'],
    ['reflectCharge', 'damage', 'wall', 'charged-hit', '피해 충격 별 + 반사 배지: 벽 반사를 모아 다음 공격 강화.'],
    ['wallClimb', 'heal', 'wall', 'on-bounce', '회복 하트 + 같은 반사 배지: 벽 접촉 시 체력 회복.'],
    ['shockwave', 'shockwave', 'wall', 'on-bounce', '공에서 퍼지는 충격 고리 + 반사 배지: 벽에서 충격파 발생.'],
    ['collisionMania', 'attack', 'collision', 'growth', '공격력 검 + 부딪히는 두 공: 몸통 충돌마다 공격력 성장.'],
    ['staticShock', 'lightning', 'collision', 'contact-damage', '전기 번개 + 부딪히는 두 공: 몸통 충돌 때 정전기 피해.'],
    ['staticUp', 'lightning', 'damage', 'increase', '같은 전기 번개 + 피해 충격 별: 정전기 피해 강화.'],
    ['staticFast', 'lightning', 'speed', 'movement-scaling', '같은 전기 번개 + 이동 속도선: 이동속도에 비례한 정전기 강화.'],
    ['sleepGas', 'gas', 'time', 'stun', '보라색 가스 구름 + 시계: 주기적으로 이동·무기·스킬 정지.'],
    ['frost', 'snow', 'hit', 'slow', '얼음 결정 + 무기 적중 배지: 적중할 때 상대를 둔화.'],
    ['gravityWell', 'gravity', 'time', 'redirect', '가운데 공을 감아 도는 화살표 + 시계: 주기적으로 상대 방향을 자신 쪽으로 변경.'],
    ['missile', 'missile', null, 'automatic-pair', '실제 크림 삼각 탄두·파란 꼬리날개·주황 추진 불꽃의 유도탄.'],
    ['missilePlus', 'missile', 'more', 'count', '같은 유도탄 + 더하기 배지: 발사 수 증가.'],
    ['missileUp', 'missile', 'damage', 'increase', '같은 유도탄 + 피해 충격 별: 탄두 피해 강화.'],
    ['flame', 'flameTrail', null, 'ground-trail', '경기장 바닥과 같은 주황 불꽃·노란 중심·낮은 타원 자국.'],
    ['flameUp', 'flameTrail', 'damage', 'increase', '같은 바닥 불꽃 + 피해 충격 별: 화염 피해 강화.'],
    ['flameDur', 'flameTrail', 'time', 'duration', '같은 바닥 불꽃 + 시계: 흔적 지속시간 증가.'],
    ['lightning', 'lightningCloud', 'wall', 'periodic-bounce', '구름 아래 인게임 노란 번개 + 벽 반사 배지: 반사 누적으로 낙뢰.'],
    ['chainBolt', 'chainedLightning', null, 'follow-up', '동일한 굵은 번개 옆에 작은 후속 번개: 낙뢰 적중 후 추가 타격.'],
    ['shuriken', 'shuriken', null, 'automatic', '인게임 그대로 네 삼각 날과 플레이어색 중앙 원을 가진 표창.'],
    ['shurikenSpd', 'shuriken', 'speed', 'projectile-speed', '같은 네 날 표창 + 속도선: 투사체 속도 증가.'],
    ['shurikenUp', 'shuriken', 'damage', 'increase', '같은 네 날 표창 + 피해 충격 별: 표창 피해 강화.'],
    ['satellite', 'orbit', null, 'orbiting', '본체를 도는 궤도와 플레이어색 위성 공: 접촉 피해를 주는 위성체.'],
    ['satellitePlus', 'doubleOrbit', null, 'count', '같은 궤도에 위성 공을 하나 더: 위성체 수 증가.'],
    ['miniBall', 'mini', null, 'bouncing-ally', '큰 공 옆의 작은 같은 편 공: 스스로 벽을 튕기는 꼬마볼.'],
    ['twins', 'twins', null, 'count', '같은 크기·같은 색 꼬마볼 두 개: 꼬마볼 한 개 추가.'],
    ['legion', 'mini', 'expand', 'health-damage-size', '같은 소환 공 + 확대 화살표: 소환수 체력·피해·크기를 함께 강화.'],
    ['minionRevenge', 'summonBlast', 'lethal', 'death-explosion', '소환 공 뒤로 퍼지는 실제 충격 별 + 치명상 하트: 소환수 사망 시 폭발.'],
    ['split', 'split', 'lethal', 'copy-build', '같은 검을 장착한 두 복제 공 + 치명상 하트: 꼬마볼이 아닌 자신의 장비·증강 복제.'],
    ['lastStand', 'clock', 'lethal', 'extra-time', '큰 시계 + 치명상 하트: 체력 0 뒤 짧은 시간 동안 추가 행동.'],
    ['warmonger', 'attack', 'hit', 'growth', '공격력 검 + 무기 적중 배지: 무기 적중마다 공격력 성장.'],
    ['rotMomentum', 'attackSpeed', 'hit', 'growth', '공격속도 검 + 같은 적중 배지: 무기 적중마다 공격속도 성장.'],
    ['chase', 'move', 'hit', 'temporary', '이동속도 공 + 같은 적중 배지: 공격 성공 직후 추격 가속.'],
    ['vampiric', 'heal', 'hit', 'on-hit', '회복 하트 + 같은 적중 배지: 무기 공격 성공 시 체력 회복.'],
    ['mark', 'target', 'hit', 'repeated-target', '누적 타격을 받는 표적 + 무기 적중 배지: 같은 상대를 거듭 맞혀 추가 피해.'],
    ['counter', 'attack', 'hurt', 'next-hit', '공격력 검 + 맞는 공 배지: 피해를 받은 뒤 다음 무기 공격 강화.'],
    ['hitCharge', 'damage', 'hurt', 'growth', '모든 피해 충격 별 + 같은 피격 공: 피해를 받을 때마다 모든 피해 성장.'],
    ['autoExpert', 'cooldown', null, 'cooldown-reduction', '되감기는 큰 시계: 쿨타임형 증강의 대기시간 감소.'],
    ['speedPower', 'damage', 'speed', 'movement-scaling', '모든 피해 충격 별 + 이동 속도선: 추가 이동속도를 피해로 전환.'],
    ['w_giant', 'attack', 'expand', 'weapon-size', '실제 검 + 확대 화살표: 검 크기만 증가하고 피해 배지는 없음.'],
    ['w_beam', 'beam', 'rotation', 'piercing', '실제 청록 삼각 파형 + 회전 고리: 한 바퀴마다 관통 검기 발사.'],
    ['desperateSpin', 'attackSpeed', 'lowHealth', 'sword-only', '같은 공격속도 검 + 빈 체력 하트: 낮은 체력에서 검 공격속도 강화.'],
    ['d_dual', 'doubleDagger', null, 'opposite-hands', '같은 짧은 단검 두 자루: 양손 장착.'],
    ['d_phase', 'phase', 'hit', 'invulnerable', '점선으로 비물질화된 공 + 무기 적중 배지: 적중 뒤 잠깐 피해를 받지 않음.'],
    ['d_bleed', 'blood', 'hit', 'permanent-stack', '붉은 피 한 방울 + 무기 적중 배지: 적중마다 영구 출혈 중첩, 매초 고정 피해.'],
    ['b_triple', 'tripleArrow', null, 'spread', '인게임과 같은 크림 화살·코랄 깃 세 갈래: 갈라져 나가는 평타.'],
    ['b_homing', 'homingArrow', null, 'close-range-homing', '같은 화살의 줄기만 휘어진 형태: 가까운 적을 향해 약하게 유도.'],
    ['b_kb', 'arrow', 'push', 'knockback', '같은 화살 + 밀어내는 굵은 화살표: 적중 시 상대를 밀어냄.'],
    ['p_shotgun', 'shotgun', null, 'scatter', '실제 파란 몸통·노란 손잡이 총과 흩어진 노란 탄환: 탄창을 산탄으로 발사.'],
    ['p_mag', 'magazine', 'more', 'capacity', '총과 같은 파랑·노랑 재질의 탄창 + 더하기: 탄환 수 증가.'],
    ['p_bayonet', 'bayonet', 'time', 'during-reload', '실제 권총과 짧은 단검 + 대기 시계: 재장전 동안 단검 공격.'],
    ['s_double', 'doubleOrb', null, 'empty-center', '양옆으로 떨어진 실제 보라 마법 구체 두 개: 가운데가 빈 두 갈래 발사.'],
    ['s_steal', 'sealedWeapon', null, 'temporary-lock', '마법 구체 옆 금지선이 그어진 검: 적중 시 상대 무기를 잠시 봉인.'],
    ['s_bounce', 'orb', 'wall', 'extra-bounce', '같은 마법 구체 + 벽 반사 배지: 반사 가능 횟수 증가.'],
    ['m_big', 'mine', 'expand', 'area', '실제 여섯 접점·크림 원판·색 중앙의 지뢰 + 확대: 감지와 폭발 범위 증가.'],
    ['m_heal', 'mine', 'heal', 'self-trigger', '같은 지뢰 + 회복 십자: 자신이 밟으면 회복.'],
    ['m_freeze', 'mine', 'freeze', 'slow', '같은 지뢰 + 얼음 결정: 밟은 상대의 이동·공격속도 감소.'],
    ['sh_magnet', 'disc', 'magnet', 'pickup', '실제 원형 방패 + 말굽자석: 더 넓은 범위에서 회수한다.'],
    ['sh_ricochet', 'disc', 'wall', 'bounce-damage', '같은 원형 방패 + 반사 화살표: 벽에 튕길 때마다 피해가 올라간다.'],
    ['sh_grip', 'disc', 'grip', 'guard', '같은 원형 방패 + 꽉 쥔 장갑: 주운 직후 받는 피해가 줄어든다.'],
    ['f_pressure', 'flameJet', 'contract', 'focus', '실제 노즐과 분사 불길 + 압축 화살표: 더 좁고 길어지는 불꽃.'],
    ['f_ember', 'emberJet', null, 'lingering', '노즐에서 뿜은 불 아래 바닥 잔불: 이동 화염 흔적과 다른 화염방사기 전용 증강.'],
    ['f_thrust', 'flameJet', 'recoil', 'recoil', '오른쪽으로 분사하는 노즐 + 왼쪽 화살표: 불꽃의 반대편으로 밀려난다.'],
    ['c_long', 'weightedChain', 'expand', 'reach', '실제 마디 사슬과 철제 추 + 확장 화살표: 길어진 사슬.'],
    ['c_barbed', 'barbedChain', null, 'line-damage', '추에 이어진 사슬 줄에 큰 삼각 가시: 줄에도 공격 판정이 생긴다.'],
    ['c_twin', 'twinChain', null, 'twin-head', '가운데 플레이어 공 양쪽에 사슬로 연결된 동일한 두 추: 이중 사슬.'],
  ];

  const descriptors = Object.create(null);
  for (const [id, base, condition, modifier, reason] of rows) {
    if (!primitives[base] || (condition && !badgeArt[condition])) throw new Error(`Unknown augment art vocabulary: ${id}`);
    descriptors['aug-' + id] = Object.freeze({ base, condition, modifier, reason });
  }
  Object.freeze(descriptors);
  const keys = Object.freeze(Object.keys(descriptors));

  function primary(desc) {
    let shape = primitives[desc.base];
    if (desc.modifier === 'size-down') {
      shape = group(shape, 0, 0, .63) +
        path('M-32-27L-17-14M-17-25V-14H-28M32 27L17 14M17 25V14H28', 'none', 'stroke-width="4.5"');
    } else if (desc.modifier === 'size-up') {
      shape = group(shape, 0, 0, 1.08) +
        path('M-24-24L-34-34M-34-23V-34H-23M24 24L34 34M23 34H34V23', 'none', 'stroke-width="4"');
    }
    return shape;
  }

  function markup(key, extraClass = '') {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(descriptors, key)) return '';
    const desc = descriptors[key];
    const classes = typeof extraClass === 'string' ? extraClass.split(/\s+/).filter(token => /^[A-Za-z0-9_-]+$/.test(token)).join(' ') : '';
    let drawing;
    if (desc.condition) {
      drawing = group(primary(desc), 40, 39, .93) +
        circle(75, 75, 18.5, C.cream, 'stroke-width="3.6"') +
        group(badgeArt[desc.condition], 75, 75, .43);
    } else {
      drawing = group(primary(desc), 48, 47, 1.09);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" class="ui-svg ui-svg--augment ui-svg--game-art${classes ? ' ' + classes : ''}" aria-hidden="true" focusable="false"><g stroke="${C.ink}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${drawing}</g></svg>`;
  }

  const api = Object.freeze({ markup, descriptors, primitives, keys });
  root.BRAugmentArt = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
