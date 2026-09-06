'use strict';

/* ============================================================
 * 바운스 로얄 — 코드 기반 벡터 아이콘
 *
 * 외부 이미지나 아이콘 폰트에 의존하지 않는다. 모든 아이콘은 currentColor를
 * 사용하므로 화면별 강조색을 CSS 한 곳에서 제어할 수 있다.
 * ============================================================ */
(function initBounceRoyalIcons(global) {
  const paths = Object.freeze({
    brand: '<path d="M19 40c0-10.5 8.5-19 19-19s19 8.5 19 19-8.5 19-19 19S19 50.5 19 40Z"/><path d="M18 20 13 8l12 6 13-9 13 9 12-6-5 12"/><path d="M29 37c3-5 7-7 12-7 7 0 12 5 12 12"/><path d="m48 38 5 4-6 3"/><path d="M11 34h8M8 42h9"/>',
    ranked: '<path d="M32 6 53 14v16c0 13-8 22-21 28C19 52 11 43 11 30V14l21-8Z"/><path d="m22 24 7 2 3-8 3 8 7-2-4 7 4 6H22l4-6-4-7Z"/>',
    friendly: '<circle cx="23" cy="22" r="8"/><circle cx="44" cy="24" r="7"/><path d="M8 52c1-11 7-17 16-17s15 6 16 17M37 39c3-4 7-6 11-5 6 1 10 7 10 16"/>',
    bag: '<path d="M21 20v-5c0-5 4-9 11-9s11 4 11 9v5"/><path d="M12 22h40l4 33H8l4-33Z"/><path d="M8 36h48M19 22v33M45 22v33"/>',
    codex: '<path d="M8 13c8-3 16-2 24 3v39c-8-5-16-6-24-3V13Z"/><path d="M56 13c-8-3-16-2-24 3v39c8-5 16-6 24-3V13Z"/><path d="M14 23c5-1 9 0 13 2M14 31c5-1 9 0 13 2M50 23c-5-1-9 0-13 2M50 31c-5-1-9 0-13 2"/>',
    settings: '<path d="M13 16h24M47 16h4M13 32h8M31 32h20M13 48h19M42 48h9"/><circle cx="42" cy="16" r="5"/><circle cx="26" cy="32" r="5"/><circle cx="37" cy="48" r="5"/>',
    play: '<path d="m24 14 27 18-27 18V14Z"/>',
    back: '<path d="m39 12-20 20 20 20"/>',
    chevron: '<path d="m25 13 19 19-19 19"/>',
    copy: '<rect x="11" y="17" width="31" height="34" rx="5"/><path d="M22 17v-5h31v34h-11"/>',
    refresh: '<path d="M51 22V10l-6 6a22 22 0 1 0 6 27"/><path d="M51 10H39"/>',
    watch: '<path d="M5 32s10-16 27-16 27 16 27 16-10 16-27 16S5 32 5 32Z"/><circle cx="32" cy="32" r="7"/>',
    plus: '<path d="M32 12v40M12 32h40"/>',
    close: '<path d="m14 14 36 36M50 14 14 50"/>',
    coin: '<circle cx="32" cy="32" r="23"/><path d="M38 21c-2-2-5-3-8-3-5 0-9 3-9 7 0 10 22 4 22 14 0 4-4 7-10 7-4 0-8-1-11-4M32 13v38"/>',
    sword: '<path d="m11 53 13-13M17 47l-7-7 7-7 7 7M25 37 46 8l10 10-29 21M42 12l10 10"/>',
    dagger: '<path d="m15 51 12-12M18 45l-6-6 7-7 6 6M27 35 43 9l10 10-26 16ZM43 9l10 10"/>',
    bow: '<path d="M19 7c18 14 18 36 0 50M19 7c-9 15-9 35 0 50M19 7l30 25-30 25M16 32h38M47 27l8 5-8 5"/>',
    pistol: '<path d="M10 23h36l8 8-8 7H27l-3 17H13l3-17h-6V23Z"/><path d="M34 23v-8h12v8M24 38h12"/>',
    staff: '<path d="m16 55 27-38"/><circle cx="47" cy="14" r="9"/><path d="m41 8-4-4M53 8l4-4M47 4V1M56 16h6"/>',
    mine: '<circle cx="32" cy="34" r="17"/><circle cx="32" cy="34" r="5"/><path d="M32 17v-8M20 21l-6-6M44 21l6-6M15 34H7M57 34h-8M20 47l-6 6M44 47l6 6"/>',
    cat: '<path d="M12 42c0-11 9-20 20-20s20 9 20 20"/><circle cx="19" cy="17" r="6"/><circle cx="32" cy="12" r="6"/><circle cx="45" cy="17" r="6"/><path d="M21 44c3-6 7-9 11-9s8 3 11 9c2 5-2 10-7 8l-4-2-4 2c-5 2-9-3-7-8Z"/>',
    wak: '<path d="M10 32h44M32 10v44M16 16l32 32M48 16 16 48"/><circle cx="32" cy="32" r="9"/>',
    soft: '<path d="M32 7 52 15v16c0 12-7 20-20 26C19 51 12 43 12 31V15l20-8Z"/><path d="m22 32 7 7 14-16"/>',
    bomb: '<circle cx="29" cy="36" r="19"/><path d="M41 22c1-8 6-10 12-11M50 8l4-4M54 14h7M49 16l5 5"/>',
    bball: '<path d="M12 49c13-2 27-15 34-34M15 15c13 7 27 21 34 34"/><path d="M9 32h46M32 9v46"/><circle cx="32" cy="32" r="23"/>',
    balloon: '<path d="M32 8c13 0 21 10 21 22 0 13-9 21-21 21S11 43 11 30C11 18 19 8 32 8Z"/><path d="m27 51 5 7 5-7M32 58v4"/>',
    stat: '<path d="M10 48h44M15 43l10-11 8 6 15-20"/><path d="M39 18h9v9"/>',
    time: '<circle cx="32" cy="33" r="23"/><path d="M32 20v14l10 6M24 7h16"/>',
    tempo: '<path d="M7 21h22M4 32h20M8 43h21"/><path d="m34 14 18 18-18 18V14Z"/>',
    hpcond: '<path d="M32 54S10 42 10 25c0-9 11-14 18-6l4 5 4-5c7-8 18-3 18 6 0 17-22 29-22 29Z"/><path d="M17 33h9l4-8 5 15 4-7h9"/>',
    streak: '<path d="M9 52h46M12 45l11-12 9 7 18-22"/><path d="M41 18h9v9"/><circle cx="12" cy="45" r="2"/><circle cx="23" cy="33" r="2"/><circle cx="32" cy="40" r="2"/>',
    trade: '<path d="M32 10v44M17 16h30M14 19 7 37h20l-7-18M44 19l-7 18h20l-7-18M23 55h18"/><path d="M7 37c2 7 18 7 20 0M37 37c2 7 18 7 20 0"/>',
    physics: '<circle cx="21" cy="32" r="13"/><circle cx="43" cy="32" r="13"/><path d="m28 20 8 24M8 17l7 7M56 47l-7-7"/>',
    cc: '<path d="M32 7v50M10 20l44 24M54 20 10 44M25 12l7 7 7-7M25 52l7-7 7 7M12 27l10 3-3-10M52 37l-10-3 3 10"/>',
    auto: '<circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="6"/><path d="M32 5v9M32 50v9M5 32h9M50 32h9M13 13l7 7M44 44l7 7M51 13l-7 7M20 44l-7 7"/>',
    summon: '<circle cx="32" cy="32" r="8"/><circle cx="13" cy="32" r="5"/><circle cx="51" cy="32" r="5"/><path d="M17 19c8-8 22-8 30 0M17 45c8 8 22 8 30 0"/>',
    death: '<path d="M15 29c0-11 7-20 17-20s17 9 17 20c0 7-3 11-7 14v9H22v-9c-4-3-7-7-7-14Z"/><circle cx="25" cy="29" r="4"/><circle cx="39" cy="29" r="4"/><path d="m29 39 3-4 3 4M27 45v7M37 45v7"/>',
    onhit: '<circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="15"/><circle cx="32" cy="32" r="5"/><path d="M32 3v8M32 53v8M3 32h8M53 32h8"/>',
    skill: '<path d="M37 4 14 36h16l-3 24 23-34H35l2-22Z"/>',
    link: '<path d="m27 39-5 5c-5 5-12 5-17 0s-5-12 0-17l9-9c5-5 12-5 17 0M37 25l5-5c5-5 12-5 17 0s5 12 0 17l-9 9c-5 5-12 5-17 0M21 32h22"/>',
    weapon: '<path d="m13 51 16-16M21 43l-7-7 8-8 7 7M30 32 47 8l9 9-24 17M40 46l7 7 8-8-7-7"/>',
    copySkill: '<circle cx="23" cy="24" r="13"/><circle cx="41" cy="40" r="13"/><path d="M35 15h12v12M29 49H17V37"/>',
    nextFfa: '<path d="m13 52 16-16M21 44l-8-8 7-7 8 8M51 52 35 36M43 44l8-8-7-7-8 8M29 10l3-6 3 6 7 2-5 5 1 7-6-3-6 3 1-7-5-5 7-2Z"/>',
    powerSupply: '<path d="M9 24h46v32H9V24Z"/><path d="M6 16h52v10H6V16ZM32 16v40"/><path d="M32 16c-8 0-14-3-14-8 0-4 4-6 8-4 4 2 6 7 6 12ZM32 16c8 0 14-3 14-8 0-4-4-6-8-4-4 2-6 7-6 12Z"/>',
    twoPillars: '<path d="M10 55h18M36 55h18M14 48h10V16H14v32ZM40 48h10V16H40v32ZM11 16h16V9H11v7ZM37 16h16V9H37v7Z"/>',
    doubleAugments: '<path d="m22 7 4 12 12 4-12 4-4 12-4-12-12-4 12-4 4-12ZM45 29l3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9Z"/>',
    coinRelief: '<circle cx="32" cy="32" r="22"/><path d="M39 23c-2-2-5-3-8-3-5 0-8 3-8 6 0 9 18 4 18 12 0 4-4 7-9 7-4 0-7-1-10-4M32 15v34M49 13l5-5M54 18h7"/>',
    refreshTen: '<path d="M51 23V11l-6 6a21 21 0 1 0 6 26"/><path d="M51 11H39M27 23h10v22"/>',
    reverseCoins: '<path d="M10 22h37l-8-8M54 42H17l8 8"/><circle cx="32" cy="32" r="10"/>',
    lossAugment: '<path d="M32 56S11 44 11 27c0-9 10-13 17-6l4 5 4-5c7-7 17-3 17 6 0 17-21 29-21 29Z"/><path d="M32 27v17M24 35h16"/>',
    globalDamage30: '<path d="M32 4v15M32 45v15M4 32h15M45 32h15M12 12l11 11M41 41l11 11M52 12 41 23M23 41 12 52"/><circle cx="32" cy="32" r="9"/>',
    noChange: '<path d="M13 43c-7-2-8-12-2-16 1-10 13-15 21-9 8-7 21-1 21 10 7 3 6 14-2 16H13Z"/>',
  });

  /*
   * 증강은 카테고리 표식을 공유하지 않는다. 작은 카드에서도 능력을 바로
   * 떠올릴 수 있도록 주체 + 작동 방향 + 결과의 세 요소로 93종을 각각 그린다.
   */
  const augmentPaths = Object.freeze({
    'aug-hp15':'<path d="M32 56S10 44 10 26c0-10 11-15 18-6l4 5 4-5c7-9 18-4 18 6 0 18-22 30-22 30Z"/><path d="M20 26h24v20H20zM32 28v16M24 36h16"/>',
    'aug-atk15':'<path d="M14 53h35M19 46h25l5 7H14l5-7Z"/><path d="m25 42 19-30 8 8-25 24M37 13l9 9"/><path d="M14 32V18m0 0-5 6m5-6 5 6"/>',
    'aug-dmg10':'<path d="M6 32s10-15 26-15 26 15 26 15-10 15-26 15S6 32 6 32Z"/><circle cx="32" cy="32" r="7"/><path d="m17 49 30-34M40 14l8 1-1 8"/>',
    'aug-rot15':'<circle cx="32" cy="32" r="8"/><path d="M31 24C18 21 15 12 21 8c6-4 12 5 11 16ZM39 34c10 8 8 18 1 19-7 1-9-10-1-19ZM25 37c-11 6-19 0-16-7 3-6 13-3 16 7Z"/><path d="M51 15a25 25 0 0 1 5 21m0 0-6-5m6 5 3-7"/>',
    'aug-move15':'<circle cx="39" cy="33" r="11"/><path d="M28 26 17 17l-1 10-10 2 20 9M29 37 15 48l1-9-10-2M48 24h9M51 33h10M48 42h9"/>',
    'aug-lifesteal':'<path d="M44 52S28 43 28 31c0-7 8-10 13-4l3 3 3-3c5-6 13-3 13 4 0 12-16 21-16 21Z"/><path d="M8 14h19l-8 9 8 7H8l8-8-8-8ZM26 22c9 0 8 12 13 12"/><path d="m34 31 5 3-3 5"/>',
    'aug-giant':'<circle cx="34" cy="34" r="20"/><circle cx="14" cy="50" r="6"/><path d="M15 14 7 6m0 0 1 9m-1-9 9 1M50 15l8-8m0 0-9 1m9-1-1 9"/>',
    'aug-tiny':'<circle cx="32" cy="32" r="6"/><circle cx="32" cy="32" r="23" stroke-dasharray="4 5"/><path d="m11 11 13 13m0 0-8-1m8 1-1-8M53 11 40 24m0 0 8-1m-8 1 1-8"/>',
    'aug-elastic':'<path d="M8 8v48M12 14h7M12 26h7M12 38h7M12 50h7"/><ellipse cx="27" cy="32" rx="7" ry="13"/><path d="M34 32h6l4-7 6 14 5-7h5M42 18l10-5m0 0-4 7m4-7-8-3"/>',
    'aug-warmup':'<path d="m14 54 19-24M24 42l-8-6 7-8 8 6M34 28l12-19 8 7-18 14"/><path d="M43 48c0-6 7-8 4-15 8 5 10 12 6 18-3 5-10 5-14 1"/><path d="M11 16h10M16 11v10"/>',
    'aug-accelRot':'<circle cx="30" cy="33" r="18"/><path d="M30 21v13l9 5M30 9v5M8 33h5M47 33h5"/><path d="M43 12c8 4 13 11 14 20m0 0-6-6m6 6 3-8"/>',
    'aug-speedster':'<circle cx="39" cy="34" r="16"/><path d="M39 23v12l9 5M32 8h14M39 8v8M17 24H5M20 34H4M17 44H8"/>',
    'aug-meditate':'<path d="M32 50c-11 0-19-5-22-14 8-2 15 0 22 8 7-8 14-10 22-8-3 9-11 14-22 14ZM32 44c-8-7-9-15 0-24 9 9 8 17 0 24Z"/><path d="M9 55h46M44 12v10M39 17h10"/>',
    'aug-marathoner':'<path d="M7 35c5-12 13-16 21-7l4 5 4-5c8-9 16-5 21 7-5 12-13 16-21 7l-4-5-4 5c-8 9-16 5-21-7Z"/><path d="M20 17h24M32 12v10"/><path d="M24 35h5l3-6 4 12 3-6h5"/>',
    'aug-rampage20':'<circle cx="27" cy="31" r="18"/><path d="M27 18v14l9 5M27 8v5M11 12l5 6M43 12l-5 6"/><path d="m43 52 7-15 4 7 7-14M45 52h14"/>',
    'aug-firstStrike':'<path d="M13 7v50M14 10h24l-5 8 5 8H14"/><path d="m20 52 22-22M31 40l-7-7 7-7 7 7M41 30l10-16 7 7-15 11"/><path d="M47 8v9M42 12h10"/>',
    'aug-rocketStart':'<circle cx="20" cy="32" r="8"/><path d="M8 24 3 20m5 12H1m7 8-5 4M28 32h24M38 19v26M45 24l9 8-9 8"/><path d="M53 17v30" stroke-dasharray="4 4"/>',
    'aug-ironDefense':'<path d="M32 6 53 14v17c0 13-8 22-21 27C19 53 11 44 11 31V14l21-8Z"/><path d="M19 23h26M19 31h26M19 39h26M25 17v28M39 17v28"/><path d="M48 9v8M44 13h8"/>',
    'aug-berserker':'<path d="M22 54S7 44 7 29c0-9 10-13 16-6l3 4 3-4c3-4 8-4 11-1M25 28l-5 8 7 4-6 9"/><path d="m36 52 9-19M41 43l-7-5 5-8 8 5M46 32l6-19 7 4-11 16"/><path d="M48 54c4-5 2-8 7-12 3 5 4 9 1 12"/>',
    'aug-escapeInstinct':'<path d="M12 20c0-7 8-10 13-4l3 3 3-3c5-6 13-3 13 4 0 10-16 19-16 19S12 30 12 20Z"/><path d="M13 26h9l3-6 5 12 3-6h10M39 47c8 0 13-5 18-11M35 55h16M31 48h11"/>',
    'aug-lastResistance':'<path d="M10 39c0-14 9-24 22-24s22 10 22 24M15 39h34"/><circle cx="25" cy="31" r="3"/><circle cx="39" cy="31" r="3"/><path d="m28 39 4-5 4 5M32 43v12M27 55h10"/><path d="M7 46h12M13 42v8"/>',
    'aug-survivalInstinct':'<path d="M32 55S10 43 10 25c0-9 10-14 18-6l4 5 4-5c8-8 18-3 18 6 0 18-22 30-22 30Z"/><path d="M13 35h10l4-8 6 16 5-9h13M44 10v10M39 15h10"/>',
    'aug-winMomentum':'<path d="M20 8h24v9c0 9-5 15-12 15s-12-6-12-15V8ZM20 13H10v5c0 6 4 9 11 9M44 13h10v5c0 6-4 9-11 9M32 32v10M23 50h18M27 42h10"/><path d="m39 52 10-13m0 0-1 8m1-8-8 2"/>',
    'aug-bloodRush':'<path d="M8 19h18l5 6h14l5 6h8M8 32h13l5 6h14l5 6h13"/><path d="M18 52c-7 0-10-7-6-13l6-10 6 10c4 6 1 13-6 13Z"/><path d="M35 13h20m0 0-7-5m7 5-7 5"/>',
    'aug-vengeance':'<path d="M11 11 29 17v14c0 8-5 14-14 18-3-2-5-3-7-5M14 20l10 10m0-10L14 30"/><path d="M56 18c-12-2-21 3-24 13m0 0 7-4m-7 4 2-8M34 49l11-14 8 7-13 12M43 38l8 6"/>',
    'aug-learnLoss':'<path d="M9 19c8-3 15-2 23 3v34c-8-5-15-6-23-3V19ZM55 19c-8-3-15-2-23 3v34c8-5 15-6 23-3V19Z"/><path d="m15 13 7 7m0-7-7 7M42 36c0-5 6-7 10-3 4-4 10-2 10 3 0 8-10 13-10 13S42 44 42 36Z"/>',
    'aug-survivor':'<circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="17"/><circle cx="32" cy="32" r="10"/><path d="M32 44S22 38 22 29c0-5 6-7 10-2 4-5 10-3 10 2 0 9-10 15-10 15Z"/>',
    'aug-battleExp':'<path d="m11 51 15-15M18 44l-7-7 7-7 7 7M26 34 44 8l9 9-25 19M53 51 38 36M46 44l7-7-7-7-7 7"/><path d="M31 48a12 12 0 0 0 17 7"/>',
    'aug-seasonedExp':'<path d="m32 7 5 11 12 2-9 8 3 12-11-6-11 6 3-12-9-8 12-2 5-11Z"/><path d="m16 55 12-16M25 47l-6-5M31 39l12-17 7 6-16 15M39 51h17m0 0-6-5m6 5-6 5"/>',
    'aug-fallenPower':'<path d="M13 11 23 18l9-12 9 12 10-7-4 21H17l-4-21Z"/><path d="M32 33v9m0 0-6-6m6 6 6-6"/><circle cx="19" cy="49" r="6"/><path d="m36 46 8 3-5 5 8 3"/>',
    'aug-brink':'<path d="M6 48h29l3-9h20M35 48v10"/><circle cx="28" cy="39" r="7"/><path d="M23 39h10M46 18v16M41 29l5 5 5-5M9 29l9-7M9 22l9 7"/>',
    'aug-trollCondition':'<path d="M17 13c9 5 21 5 30 0l-3 22c-2 12-22 12-24 0l-3-22Z"/><path d="M23 25c3-3 6-3 9 0M35 25c3-3 6-3 9 0M27 35c4 3 7 3 11 0"/><path d="M8 50h18m0 0-6-5m6 5-6 5M56 50H38m0 0 6-5m-6 5 6 5"/>',
    'aug-devilDeal':'<circle cx="32" cy="34" r="18"/><path d="M20 18 14 7l12 7M44 18 50 7l-12 7M39 27c-2-2-5-3-8-3-5 0-8 3-8 6 0 8 17 3 17 11 0 4-4 7-9 7M32 19v30"/><path d="m51 52 7-10"/>',
    'aug-gamble':'<circle cx="21" cy="19" r="9"/><path d="M18 17h6M21 13v12M10 45l11-9 11 9-11 9-11-9ZM17 43h.1M24 47h.1"/><path d="M34 22h20m0 0-6-5m6 5-6 5M34 46h20m0 0-6-5m6 5-6 5"/>',
    'aug-glass':'<path d="m11 55 17-20M20 45l-7-6 7-8 7 6M28 34 44 9l9 8-23 19M38 17l9 7M38 28l7-3"/><path d="M44 47c0-6 7-9 11-3 4-6 10-3 10 3"/><path d="m48 44 4 5-3 6 6-3"/>',
    'aug-brute':'<path d="M8 42c0-8 7-11 13-6V22c0-5 7-5 7 0v12-16c0-5 7-5 7 0v16-13c0-5 7-5 7 0v15c0-5 7-5 7 0v8c0 9-7 14-18 14H21C13 58 8 51 8 42Z"/><path d="M51 12h8M49 20h10M50 28h7"/>',
    'aug-bloodWeapon':'<path d="m10 55 18-19M19 46l-7-7 7-8 8 7M28 35 45 8l9 8-24 21"/><path d="M46 37c6 8 7 10 7 13 0 5-4 8-8 8s-8-3-8-8c0-3 2-6 9-13Z"/><path d="M10 16h11M15 11v10"/>',

    'aug-reflectCharge':'<path d="M11 48 19 13l27 10 7 28Z"/><circle cx="19" cy="13" r="3"/><circle cx="46" cy="23" r="3"/><circle cx="53" cy="51" r="3"/><path d="m20 39 10-9m0 0-1 7m1-7-7 1M31 53l9-14 8 6-12 12"/>',
    'aug-wallClimb':'<path d="M10 6v52M14 12h8M14 25h8M14 38h8M14 51h8"/><circle cx="29" cy="41" r="8"/><path d="M29 33V18m0 0-5 6m5-6 5 6M44 18c0-5 6-7 10-3 4-4 10-2 10 3 0 7-10 12-10 12s-10-5-10-12Z"/>',
    'aug-shockwave':'<path d="M9 7v50M13 32h8l4-6 5 6-5 6-4-6"/><path d="M31 20c8 5 8 19 0 24M38 14c14 9 14 27 0 36M46 9c20 13 20 33 0 46"/>',
    'aug-collisionMania':'<circle cx="19" cy="34" r="11"/><circle cx="45" cy="34" r="11"/><path d="m27 27 5 7-5 7m10-14-5 7 5 7M17 17h30m0 0-6-5m6 5-6 5"/>',
    'aug-staticShock':'<circle cx="16" cy="34" r="10"/><circle cx="48" cy="34" r="10"/><path d="m30 13-8 20h9l-5 19 16-25h-9l6-14M10 18l4 5M54 18l-4 5"/>',
    'aug-staticUp':'<path d="M13 14v36M51 14v36M18 21h8M18 32h8M18 43h8M38 21h8M38 32h8M38 43h8"/><path d="m35 8-10 23h10l-7 25 18-30H35l7-18"/><path d="M7 8v10M2 13h10"/>',
    'aug-staticFast':'<path d="M11 46a22 22 0 0 1 42 0M32 44l13-18M18 40l-7-3M46 40l7-3M22 28l-5-6M42 28l5-6"/><path d="m7 54 9-12h-5l8-11M42 54h17M45 48h14"/>',
    'aug-sleepGas':'<path d="M13 43c-8-2-8-13 0-16 0-8 10-12 16-7 5-7 17-3 17 6 9 1 11 13 3 17H13Z"/><path d="M19 33c3 3 7 3 10 0M36 33c3 3 7 3 10 0"/><rect x="39" y="45" width="17" height="12" rx="3"/><path d="M43 45v-4c0-6 9-6 9 0v4"/>',
    'aug-frost':'<path d="M32 7v50M10 20l44 24M54 20 10 44M25 12l7 7 7-7M25 52l7-7 7 7"/><path d="m8 54 12-15M15 47l-6-5 6-7 6 5M20 38l12-19"/>',
    'aug-gravityWell':'<circle cx="32" cy="32" r="7"/><circle cx="32" cy="32" r="17" stroke-dasharray="7 4"/><path d="M5 19c11-13 29-15 42-5 10 8 12 23 4 33-7 8-20 11-30 5M21 52l5-6m-5 6 7 1"/><path d="M52 16 39 25m0 0 4-7m-4 7 8 1"/>',
    'aug-missile':'<circle cx="50" cy="32" r="8"/><path d="M6 14c14 0 21 5 29 16M6 50c14 0 21-5 29-16" stroke-dasharray="4 4"/><path d="m20 10 14 8-8 8-9-3 3-13ZM20 54l14-8-8-8-9 3 3 13Z"/>',
    'aug-missilePlus':'<path d="m13 12 14 8-8 8-9-3 3-13ZM37 8l14 8-8 8-9-3 3-13ZM25 37l14 8-8 8-9-3 3-13Z"/><path d="M51 38v15M44 46h15"/>',
    'aug-missileUp':'<path d="M9 32 37 16l15 16-15 16L9 32Z"/><path d="M37 16v32M37 25l8 7-8 7M14 25 5 19M14 39 5 45"/><circle cx="54" cy="12" r="5"/>',
    'aug-flame':'<circle cx="17" cy="20" r="8"/><path d="M24 27c6 5 10 5 15 8" stroke-dasharray="3 5"/><path d="M45 56c-10 0-15-8-10-16 3-5 7-8 7-15 9 7 16 17 12 25-2 4-5 6-9 6ZM45 55c-4-4-3-8 1-13 4 5 5 9-1 13Z"/>',
    'aug-flameUp':'<path d="M8 55 24 10h16l16 45M13 44h38"/><path d="M32 49c-8 0-11-6-8-13 2-4 6-7 6-13 8 6 13 14 9 21-1 3-4 5-7 5ZM18 31c-5-3-4-8 0-13 5 5 6 9 0 13Z"/>',
    'aug-flameDur':'<path d="M26 20h12M26 44h12M24 8h16M24 56h16M26 20c0 8 12 8 12 16s-12 8-12 8"/><path d="M11 51c-6-5-4-12 2-18 7 7 9 13 2 18M51 51c-6-5-4-12 2-18 7 7 9 13 2 18"/>',
    'aug-lightning':'<path d="M14 29c-7-2-7-12 0-15 2-8 14-10 19-4 7-5 18 0 17 9 8 2 8 11 2 14H16"/><path d="m35 26-11 19h9l-5 14 18-23h-10l7-10"/><path d="M8 49h9m-6 5h9M48 49h9"/>',
    'aug-chainBolt':'<path d="m31 5-10 24h10l-7 28 18-31H31l8-21"/><path d="M24 32 11 43h8l-5 12M39 31l13 11h-8l5 12"/><circle cx="10" cy="43" r="2"/><circle cx="54" cy="42" r="2"/>',
    'aug-shuriken':'<path d="m32 8 7 16 17-4-11 13 11 12-17-4-7 16-7-16-17 4 11-12L8 20l17 4 7-16Z"/><circle cx="32" cy="32" r="5"/><path d="M52 9v10M47 14h10"/>',
    'aug-shurikenSpd':'<path d="m43 14 4 11 12-2-8 9 8 8-12-2-4 11-4-11-12 2 8-8-8-9 12 2 4-11Z"/><circle cx="43" cy="32" r="3"/><path d="M25 20H9M27 32H3M25 44H9"/>',
    'aug-shurikenUp':'<path d="m32 5 8 18 19-5-12 15 12 14-19-5-8 18-8-18-19 5 12-14L5 18l19 5 8-18Z"/><circle cx="32" cy="33" r="9"/><path d="M32 18v30M17 33h30"/>',
    'aug-satellite':'<circle cx="32" cy="32" r="9"/><ellipse cx="32" cy="32" rx="27" ry="16"/><circle cx="55" cy="24" r="5"/><path d="M9 42c8 9 28 11 39 1" stroke-dasharray="3 4"/>',
    'aug-satellitePlus':'<circle cx="32" cy="32" r="8"/><ellipse cx="32" cy="32" rx="27" ry="15"/><ellipse cx="32" cy="32" rx="15" ry="27"/><circle cx="55" cy="25" r="5"/><circle cx="24" cy="56" r="5"/>',
    'aug-miniBall':'<circle cx="22" cy="31" r="15"/><circle cx="48" cy="43" r="7"/><path d="M36 37c5 0 7 1 9 3M42 48l7 7m0 0-1-7m1 7 7-1M7 15l7 6M8 50l7-6"/>',
    'aug-twins':'<circle cx="32" cy="24" r="14"/><circle cx="15" cy="46" r="7"/><circle cx="49" cy="46" r="7"/><path d="M24 35 18 40M40 35l6 5M22 51c7 5 13 5 20 0"/>',
    'aug-legion':'<circle cx="32" cy="23" r="12"/><circle cx="14" cy="45" r="8"/><circle cx="32" cy="48" r="9"/><circle cx="51" cy="45" r="8"/><path d="M23 20h18M28 15v16M36 15v16M9 56h46"/>',
    'aug-minionRevenge':'<circle cx="32" cy="32" r="13"/><path d="m28 20 4 9-5 5 7 9-3 2M32 4v12M32 48v12M4 32h12M48 32h12M12 12l9 9M43 43l9 9M52 12l-9 9M21 43l-9 9"/>',
    'aug-split':'<circle cx="32" cy="20" r="13"/><path d="m30 8 4 10-6 5 7 7M25 34 15 42m24-8 10 8"/><circle cx="14" cy="49" r="8"/><circle cx="50" cy="49" r="8"/><path d="m8 57 5-5m37 0 6 5"/>',
    'aug-lastStand':'<circle cx="32" cy="32" r="24" stroke-dasharray="13 5"/><path d="M18 35c0-9 6-15 14-15s14 6 14 15M23 35h18M32 35v15"/><circle cx="27" cy="30" r="2"/><circle cx="37" cy="30" r="2"/><path d="m45 53 7-12 7 5-9 11"/>',
    'aug-warmonger':'<path d="m9 54 18-20M18 45l-7-7 7-8 8 7M27 34 44 8l9 8-24 20"/><path d="M36 44h23M39 39v10M44 37v12M49 35v14M54 33v16"/>',
    'aug-rotMomentum':'<circle cx="37" cy="35" r="13"/><circle cx="37" cy="35" r="5"/><path d="M37 15v7M37 48v7M17 35h7M50 35h7M23 21l5 5M46 44l5 5M51 21l-5 5M28 44l-5 5M5 17l14 10"/><path d="m14 17 5 10-11-1"/>',
    'aug-chase':'<circle cx="49" cy="27" r="9"/><circle cx="49" cy="27" r="3"/><circle cx="25" cy="42" r="8"/><path d="M31 37c4-4 7-6 10-7M16 31H6M17 41H3M16 51H8M43 16l6-7 6 7"/>',
    'aug-vampiric':'<path d="m9 11 13 16 7-13 7 13 13-16-4 24H13L9 11Z"/><path d="M32 56S20 49 20 40c0-6 7-8 12-3 5-5 12-3 12 3 0 9-12 16-12 16Z"/><path d="M32 28v9"/>',
    'aug-mark':'<circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="12"/><path d="m15 17 6 6M49 17l-6 6M15 47l6-6M49 47l-6-6M32 22v20M22 32h20"/><circle cx="32" cy="32" r="4"/>',
    'aug-counter':'<path d="M18 9 35 15v14c0 10-6 16-17 21C7 45 1 39 1 29V15l17-6Z"/><path d="M7 28h21M28 19l8 9-8 9"/><path d="M57 18c-10-4-18 0-21 10m0 0 6-4m-6 4 1-7M38 52l10-16 9 6-14 14"/>',
    'aug-hitCharge':'<path d="M12 14 31 8l18 8v15c0 12-7 20-19 25-12-5-18-13-18-25V14Z"/><path d="m26 11 5 11-5 7 8 9-4 7"/><rect x="36" y="17" width="18" height="29" rx="2"/><path d="M54 26h4M40 41h10M40 35h10M40 29h10M40 23h10"/>',
    'aug-autoExpert':'<circle cx="32" cy="32" r="11"/><circle cx="32" cy="32" r="4"/><path d="M32 8v8M32 48v8M8 32h8M48 32h8M15 15l6 6M43 43l6 6M49 15l-6 6M21 43l-6 6"/><path d="m4 13 10 5-6 6M60 12l-10 5 6 6"/>',
    'aug-speedPower':'<path d="M8 45a20 20 0 0 1 38 0M27 43l11-20M17 40l-7-3M38 36l6 5"/><path d="M48 29h11m-6-6 6 6-6 6M45 48l5-5 3 6 7 1-5 5 1 6-6-3-6 3 1-6-5-5 5-2Z"/>',

    'aug-w_giant':'<path d="m8 58 24-27M18 47l-9-8 10-11 9 9M32 31 49 4l11 10-26 19M47 8l9 9"/><path d="M8 12h14m0 0-6-5m6 5-6 5M46 52h14m-14 0 6-5m-6 5 6 5"/>',
    'aug-w_beam':'<path d="m24 47 9-10M27 42l-6-6 7-7 6 6M34 35l10-17 8 7-16 12"/><path d="M22 17C9 21 5 29 5 38m0 0 6-5m-6 5 8 1M43 45c10-2 15-8 16-16m0 0-6 5m6-5-8-1"/>',
    'aug-desperateSpin':'<path d="M8 18c0-6 7-9 12-3 5-6 12-3 12 3 0 9-12 16-12 16S8 27 8 18ZM10 24h8l3-6 5 12 3-6"/><path d="M39 54 28 43l7-7 7 7 11-11 7 7-18 18"/><path d="M34 15c14 0 24 11 24 24m0 0-6-6m6 6 3-8"/>',
    'aug-d_dual':'<path d="m8 55 17-18M17 47l-7-7 7-7 7 7M25 36 42 9l9 8-24 21M56 55 39 37M47 47l7-7-7-7-7 7M39 36 22 9l-9 8 24 21"/>',
    'aug-d_phase':'<circle cx="42" cy="33" r="14" stroke-dasharray="4 5"/><path d="m6 54 18-20M15 44l-7-6 7-8 7 7M24 33 41 8l9 8-24 19M28 33h29"/><path d="m52 28 5 5-5 5"/>',
    'aug-d_bleed':'<path d="m8 45 15-15M15 38l-6-6 7-7 6 6M23 29 36 8l9 8-20 15"/><path d="M42 55c-5 0-8-5-5-10l5-8 5 8c3 5 0 10-5 10ZM55 45c-4 0-6-4-4-8l4-6 4 6c2 4 0 8-4 8Z"/><path d="M49 11v13l7 4"/>',
    'aug-b_triple':'<path d="M14 7c17 14 17 36 0 50M14 7c-8 15-8 35 0 50M14 32h42M45 22l11 10-11 10M42 14l14 10M42 50l14-10"/>',
    'aug-b_homing':'<circle cx="51" cy="22" r="8"/><circle cx="51" cy="22" r="3"/><path d="M6 49c19 0 29-2 32-12 2-7 2-12 8-14"/><path d="m40 17 6 6-7 3M7 43l-1 6 6 2"/>',
    'aug-b_kb':'<path d="M6 32h37M35 24l8 8-8 8"/><circle cx="50" cy="32" r="8"/><path d="M55 22h5M58 32h5M55 42h5M45 15l5-5M45 49l5 5"/>',
    'aug-p_shotgun':'<path d="M5 20h27l7 7-7 7H18l-3 14H7l3-14H5V20Z"/><path d="M40 27 60 12M40 27l22-4M40 27l22 7M40 27l18 16M47 20h.1M53 27h.1M49 35h.1"/>',
    'aug-p_mag':'<path d="M12 12h25v13H12zM30 25l-4 31H14l-2-31M44 14h8v15h-8zM44 34h8v15h-8zM57 14h4v15h-4zM57 34h4v15h-4z"/>',
    'aug-p_bayonet':'<path d="M6 17h33l7 7-7 7H22l-3 14H9l3-14H6V17Z"/><path d="m38 31 15 13M46 39l-5 6 7 7 6-5M52 43l8 8"/><path d="M31 8a12 12 0 0 1 11 7m0 0-6-2m6 2 1-6"/>',
    'aug-s_double':'<path d="m10 56 22-31"/><circle cx="35" cy="20" r="8"/><path d="M39 17c5-7 11-9 18-8M39 23c6 7 12 9 19 8M25 17c-5-7-10-9-17-8M25 23c-6 7-12 9-19 8"/><circle cx="57" cy="9" r="3"/><circle cx="58" cy="31" r="3"/><circle cx="8" cy="9" r="3"/><circle cx="6" cy="31" r="3"/>',
    'aug-s_steal':'<circle cx="15" cy="32" r="8"/><path d="M23 32h17m0 0-6-5m6 5-6 5M42 45l10-14 7 5-12 13M50 34l7 5"/><rect x="41" y="8" width="18" height="14" rx="3"/><path d="M45 8V5c0-6 10-6 10 0v3"/>',
    'aug-s_bounce':'<path d="M7 8v48M57 8v48M16 13l25 15-24 17 28 9"/><circle cx="16" cy="13" r="4"/><circle cx="41" cy="28" r="4"/><circle cx="17" cy="45" r="4"/><path d="m38 50 7 4-6 5"/>',
    'aug-m_big':'<circle cx="32" cy="33" r="12"/><circle cx="32" cy="33" r="23" stroke-dasharray="4 4"/><circle cx="32" cy="33" r="5"/><path d="M32 10V3M10 33H3M54 33h7M16 17l-5-5M48 17l5-5M16 49l-5 5M48 49l5 5"/>',
    'aug-m_heal':'<circle cx="24" cy="37" r="14"/><circle cx="24" cy="37" r="5"/><path d="M24 23v-7M10 37H4M38 37h7M14 27l-5-5"/><path d="M47 54S36 48 36 39c0-6 7-8 11-3 4-5 11-3 11 3 0 9-11 15-11 15ZM47 38v10M42 43h10"/>',
    'aug-m_freeze':'<circle cx="24" cy="38" r="13"/><circle cx="24" cy="38" r="4"/><path d="M24 25v-7M11 38H4M37 38h7"/><path d="M48 8v46M36 15l24 32M60 15 36 47M43 11l5 6 5-6M43 51l5-6 5 6"/>'
  });

  const aliases = Object.freeze({
    'menu-ranked':'ranked', 'menu-friendly':'friendly', 'menu-bag':'bag', 'menu-codex':'codex', 'menu-settings':'settings',
    'weapon-sword':'sword', 'weapon-dagger':'dagger', 'weapon-bow':'bow', 'weapon-pistol':'pistol', 'weapon-staff':'staff', 'weapon-mine':'mine',
    'category-coin':'coin', 'category-copy':'copySkill',
  });

  function resolve(name) {
    const key = aliases[name] || name;
    return (paths[key] || augmentPaths[key]) ? key : 'skill';
  }

  function markup(name, className = '') {
    const key = resolve(name);
    const drawing = augmentPaths[key] || paths[key];
    return `<svg class="ui-svg${className ? ` ${className}` : ''}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawing}</svg>`;
  }

  function hydrate(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-ui-icon]').forEach(element => {
      element.innerHTML = markup(element.dataset.uiIcon, element.dataset.iconClass || '');
    });
  }

  global.BRIcons = Object.freeze({ markup, hydrate, resolve, has:name => !!(paths[aliases[name] || name] || augmentPaths[aliases[name] || name]) });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate(document), { once:true });
    else hydrate(document);
  }
})(typeof window !== 'undefined' ? window : globalThis);
