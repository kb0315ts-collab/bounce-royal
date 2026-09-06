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

  const aliases = Object.freeze({
    'menu-ranked':'ranked', 'menu-friendly':'friendly', 'menu-bag':'bag', 'menu-codex':'codex', 'menu-settings':'settings',
    'weapon-sword':'sword', 'weapon-dagger':'dagger', 'weapon-bow':'bow', 'weapon-pistol':'pistol', 'weapon-staff':'staff', 'weapon-mine':'mine',
    'category-coin':'coin', 'category-copy':'copySkill',
  });

  function resolve(name) {
    const key = aliases[name] || name;
    return paths[key] ? key : 'skill';
  }

  function markup(name, className = '') {
    const key = resolve(name);
    return `<svg class="ui-svg${className ? ` ${className}` : ''}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[key]}</svg>`;
  }

  function hydrate(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-ui-icon]').forEach(element => {
      element.innerHTML = markup(element.dataset.uiIcon, element.dataset.iconClass || '');
    });
  }

  global.BRIcons = Object.freeze({ markup, hydrate, resolve, has:name => !!paths[aliases[name] || name] });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate(document), { once:true });
    else hydrate(document);
  }
})(typeof window !== 'undefined' ? window : globalThis);
