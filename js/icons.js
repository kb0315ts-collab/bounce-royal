'use strict';

/* ============================================================
 * 바운스 로얄 — 공통 아이콘 렌더러와 기존 벡터 보관본
 *
 * 증강은 실제 게임 도형과 스탯/조건 부품으로 조합한 SVG를 우선 사용한다.
 * Game-icons 에셋과 기존 벡터는 비교/복구용으로 유지한다. 메뉴·무기·캐릭터 스킬은 캐주얼 토이 컬러 아이콘,
 * 보조 UI 표시는 currentColor 방식이다. 게임 규칙에는 영향을 주지 않는다.
 * ============================================================ */
(function initBounceRoyalIcons(global) {
  const paths = Object.freeze({
    brand: '<g stroke="#243747" stroke-width="4"><circle cx="36" cy="39" r="19" fill="#79dec0"/><path d="m18 21-4-14 12 6 10-9 10 9 12-6-4 14H18Z" fill="#ffd44c"/><path d="M26 34c1-5 5-8 10-8" stroke="#e5ffde"/><path d="M7 35h5M5 45h8M12 54h6"/></g>',
    ranked: '<g stroke="#243747" stroke-width="4"><path d="M18 14H8v9c0 9 7 14 14 14M46 14h10v9c0 9-7 14-14 14" fill="#f6b843"/><path d="M18 8h28v17c0 11-6 18-14 18s-14-7-14-18V8Z" fill="#fff0a8"/><path d="M32 43v9m-12 5h24"/><path d="m32 15 3 7 7 1-6 5 2 7-6-4-6 4 2-7-6-5 7-1 3-7Z" fill="#ffd44c" stroke-width="2.5"/></g>',
    friendly: '<g stroke="#243747" stroke-width="4"><circle cx="21" cy="36" r="15" fill="#78d5f1"/><circle cx="43" cy="36" r="15" fill="#ff9980"/><path d="M13 31c1-4 4-6 7-6M35 31c1-4 4-6 7-6" stroke="#fff8df"/><path d="M29 9h6m-3-3v6M51 13l3 4M9 15l4-3"/></g>',
    bag: '<g stroke="#243747" stroke-width="4"><path d="M23 18v-6c0-7 18-7 18 0v6"/><rect x="12" y="16" width="40" height="43" rx="10" fill="#f4b960"/><path d="M12 27c0-9 40-9 40 0v9H12v-9Z" fill="#ffda83"/><rect x="21" y="40" width="22" height="13" rx="4" fill="#fff8df"/><path d="M32 33v7"/></g>',
    codex: '<g stroke="#243747" stroke-width="4"><path d="M8 12c9-2 16 0 24 5 8-5 15-7 24-5v41c-8-2-16 0-24 5-8-5-16-7-24-5V12Z" fill="#fff8df"/><path d="M32 17v41M7 53l-3 5 28 5 28-5-4-5" fill="#79dec0"/><path d="M15 24c4 0 7 1 10 3M15 33c4 0 7 1 10 3M40 24l3 4 7-7M40 38h9" stroke="#668d6a" stroke-width="3"/></g>',
    settings: '<g stroke="#243747" stroke-width="4"><path d="m25 7 14 0 2 8 7 4 8-2 7 12-6 6v8l6 6-7 12-8-2-7 4-2 8H25l-2-8-7-4-8 2-7-12 6-6v-8l-6-6 7-12 8 2 7-4 2-8Z" transform="translate(5 -3) scale(.85)" fill="#b1cbc9"/><circle cx="32" cy="30" r="10" fill="#fff8df"/></g>',
    play: '<path d="m24 14 27 18-27 18V14Z"/>',
    back: '<path d="m39 12-20 20 20 20"/>',
    chevron: '<path d="m25 13 19 19-19 19"/>',
    copy: '<rect x="11" y="17" width="31" height="34" rx="5"/><path d="M22 17v-5h31v34h-11"/>',
    refresh: '<path d="M51 22V10l-6 6a22 22 0 1 0 6 27"/><path d="M51 10H39"/>',
    watch: '<path d="M5 32s10-16 27-16 27 16 27 16-10 16-27 16S5 32 5 32Z"/><circle cx="32" cy="32" r="7"/>',
    plus: '<path d="M32 12v40M12 32h40"/>',
    close: '<path d="m14 14 36 36M50 14 14 50"/>',
    coin: '<circle cx="32" cy="32" r="23"/><path d="M38 21c-2-2-5-3-8-3-5 0-9 3-9 7 0 10 22 4 22 14 0 4-4 7-10 7-4 0-8-1-11-4M32 13v38"/>',
    sword: '<g stroke="#243747" stroke-width="4"><path d="m9 51 13-13 9 9-13 13-9-9Z" fill="#c38963"/><path d="m21 37 25-31 13 13-31 25-7-7Z" fill="#ecf9e9"/><path d="M29 34 50 14" stroke="#83b6b8" stroke-width="3"/><path d="m13 33 6-6 21 21-6 6-21-21Z" fill="#ffd44c"/></g>',
    dagger: '<g stroke="#243747" stroke-width="4"><path d="m14 51 14-14 8 8-14 14-8-8Z" fill="#9169b2"/><path d="m24 35 27-29 5 20-23 17-9-8Z" fill="#d3c4ef"/><path d="m32 34 18-20" stroke="#fff8df" stroke-width="3"/><path d="m18 32 19 19" stroke="#ffd44c" stroke-width="7"/></g>',
    bow: '<g stroke="#243747" stroke-width="4"><path d="M18 7c24 13 24 37 0 50l5-10c11-10 11-20 0-30L18 7Z" fill="#c98a50"/><path d="m18 7 31 25-31 25" stroke="#fff8df" stroke-width="2.5"/><path d="M9 32h47" stroke="#6b6549"/><path d="m47 25 12 7-12 7V25Z" fill="#d9f3e0"/><path d="m10 27 7 5-7 5" stroke="#79b657"/></g>',
    pistol: '<g stroke="#243747" stroke-width="4"><path d="m13 30 19 3-5 24H13l3-18-3-9Z" fill="#b28b68"/><path d="M8 17h44v18H8V17Z" fill="#87acb1"/><path d="M13 17v-5h35v5M24 35h18v9H30" fill="#cddad2"/><path d="M46 17v18M14 24h19" stroke="#d7eadf" stroke-width="3"/></g>',
    staff: '<g stroke="#243747" stroke-width="4"><path d="m12 54 26-34 7 5-26 34-7-5Z" fill="#a174bd"/><path d="m33 11 11-7 13 8-3 15-14 6-11-11 4-11Z" fill="#ba87e4"/><path d="m33 11 21 16-10-23-4 29" stroke="#ecd3ff" stroke-width="2.5"/><path d="m27 12-5-3M55 35l5 3" stroke="#c088d5"/></g>',
    chain: '<g stroke="#243747" stroke-width="4"><path d="M11 12 24 25M24 25l10 10" fill="none" stroke-linecap="round"/>'
      + '<circle cx="11" cy="12" r="6" fill="#dfe6f2"/><circle cx="24" cy="25" r="6" fill="#dfe6f2"/>'
      + '<circle cx="45" cy="45" r="14" fill="#9aa3bb"/>'
      + '<path d="M45 27v-6M45 63v6M27 45h-6M63 45h6" stroke-linecap="round"/>'
      + '<circle cx="40" cy="40" r="4" fill="#dfe6f2" stroke="none"/></g>',
    mine: '<g stroke="#243747" stroke-width="4"><path d="M13 29h38l6 17c-10 13-40 13-50 0l6-17Z" fill="#78967b"/><ellipse cx="32" cy="29" rx="21" ry="12" fill="#a9c095"/><ellipse cx="32" cy="28" rx="7" ry="5" fill="#ff8477"/><path d="M12 44h40M23 17v-6h18v6"/></g>',
    cat: '<g stroke="#243747" stroke-width="3.5" fill="#f59cbb"><ellipse cx="12" cy="24" rx="6" ry="8" transform="rotate(-24 12 24)"/><ellipse cx="25" cy="14" rx="6" ry="8"/><ellipse cx="40" cy="14" rx="6" ry="8"/><ellipse cx="53" cy="24" rx="6" ry="8" transform="rotate(24 53 24)"/><path d="M17 42c5-8 10-12 15-12s10 4 15 12c6 11-2 17-10 13l-5-2-5 2c-8 4-16-2-10-13Z"/><path d="M25 40c2-3 5-5 7-5" fill="none" stroke="#ffe4ea"/></g>',
    wak: '<g stroke="#243747" stroke-width="4"><path d="m32 5 6 16 18-7-8 17 12 8-19 3-3 17-9-14-16 9 6-18L4 28l19-4 9-19Z" fill="#ffb95f"/><path d="m35 15-14 20h11l-3 16 16-23H33l2-13Z" fill="#fff1b5" stroke-width="2.5"/></g>',
    soft: '<g stroke="#243747" stroke-width="4"><path d="M32 7 52 15v16c0 12-7 20-20 26C19 51 12 43 12 31V15l20-8Z" fill="#c0ecc9"/><path d="M32 14v35" stroke="#fff8df" stroke-width="3"/><path d="m22 32 7 7 14-16" stroke="#528d6a" stroke-width="5"/></g>',
    bomb: '<g stroke="#243747" stroke-width="4"><circle cx="28" cy="37" r="20" fill="#678087"/><path d="M18 32c1-5 5-8 10-8" stroke="#b6d0c9"/><path d="m38 18 4-8 8 4-5 9" fill="#b1bab0"/><path d="M48 10c2-4 4-5 7-4"/><path d="m54 3 2 5 6-1-4 5 4 4-7-1-2 5-1-7-6-2 6-2 2-6Z" fill="#ffd44c" stroke-width="2"/></g>',
    bball: '<g stroke="#243747" stroke-width="3.5"><circle cx="32" cy="32" r="23" fill="#efa45d"/><path d="M12 49c13-2 27-15 34-34M15 15c13 7 27 21 34 34M9 32h46M32 9v46"/><path d="M19 18c3-3 6-5 11-5" stroke="#ffda8c" stroke-width="3"/></g>',
    balloon: '<g stroke="#243747" stroke-width="3.5"><path d="M32 6c13 0 21 10 21 22 0 13-9 21-21 21S11 41 11 28C11 16 19 6 32 6Z" fill="#ff8f9b"/><path d="M20 24c0-7 5-12 11-12" stroke="#ffe0d9" stroke-width="4"/><path d="m27 49 5 7 5-7M32 56v7" fill="#ff8f9b"/></g>',
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
    skill: '<path d="M37 4 14 36h16l-3 24 23-34H35l2-22Z" fill="#ffd44c" stroke="#243747" stroke-width="4"/>',
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
   * 증강 아이콘 v2
   * 작은 화면에서는 장면을 묘사하지 않고, 큰 실루엣 하나와 일관된 효과
   * 표식 하나만 사용한다. 밝은 본체 + 능력색의 2색 구조라 29px에서도
   * 검·체력·속도·폭발·투사체 계열을 먼저 알아볼 수 있다.
   */
  const AUG_SHAPES = Object.freeze({
    heart:'<path d="M32 55C26 50 9 40 9 24c0-10 12-15 20-6l3 4 3-4c8-9 20-4 20 6 0 16-17 26-23 31Z"/>',
    brokenHeart:'<path d="M32 55C26 50 9 40 9 24c0-10 12-15 20-6l3 4 3-4c8-9 20-4 20 6 0 16-17 26-23 31Z"/><path d="m34 20-7 12 8 5-7 15" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="4.5"/>',
    sword:'<path d="M8 56h10l13-13-9-9L9 47 8 56ZM27 30 47 7l10 10-24 19-6-6Z"/>',
    dagger:'<path d="M10 56h10l10-12-9-9-11 12v9ZM26 31 45 7l11 11-25 18-5-5Z"/>',
    burst:'<path d="m32 5 7 15 16-7-7 16 12 9-17 2 2 18-13-12-13 12 2-18-17-2 12-9-7-16 16 7 7-15Z"/>',
    rotor:'<path d="M32 24C17 22 13 11 21 7c8-4 14 7 11 17Zm8 12c11 10 6 22-3 20-8-2-7-14 3-20Zm-16 0c-3 14-16 16-18 7-2-9 10-14 18-7Z"/><circle cx="32" cy="32" r="6" fill="currentColor"/>',
    ball:'<circle cx="29" cy="31" r="19"/>',
    wing:'<path d="M24 23 9 11l1 12-9 5 22 8-16 5 2 11 18-15Z"/>',
    drop:'<path d="M21 7C11 21 7 29 7 38c0 9 6 15 14 15s14-6 14-15c0-9-4-17-14-31Z"/>',
    wall:'<rect x="7" y="7" width="14" height="50" rx="4"/><path d="M7 19h14M7 32h14M7 45h14" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="3"/>',
    shield:'<path d="M32 5 54 14v17c0 14-8 23-22 29C18 54 10 45 10 31V14L32 5Z"/>',
    // 쇠사슬 — 마디 셋을 비스듬히 잇고 끝에 추를 단다
    chain:'<circle cx="13" cy="13" r="6" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="4.5"/>'
      + '<circle cx="24" cy="24" r="6" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="4.5"/>'
      + '<circle cx="35" cy="35" r="6" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="4.5"/>'
      + '<circle cx="47" cy="47" r="11"/>',
    clock:'<circle cx="30" cy="31" r="22" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="7"/><path d="M30 17v15l11 7" fill="none" stroke="currentColor" stroke-width="6"/>',
    trophy:'<path d="M17 7h30v11c0 11-5 18-12 21v8h10v9H19v-9h10v-8c-7-3-12-10-12-21V7Zm0 7H6v7c0 9 5 14 14 15v-8c-4-2-6-5-6-10h3v-4Zm30 0h11v7c0 9-5 14-14 15v-8c4-2 6-5 6-10h-3v-4Z"/>',
    coin:'<circle cx="29" cy="30" r="22"/><path d="M34 19c-3-2-7-2-10 0-6 5 12 8 6 16-3 4-9 3-13 0M27 14v32" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="4"/>',
    book:'<path d="M6 13c10-3 19-1 26 5v39c-8-6-17-8-26-4V13Zm52 0c-10-3-19-1-26 5v39c8-6 17-8 26-4V13Z"/>',
    medal:'<path d="M18 5h12l2 18-9 5L18 5Zm28 0H34l-2 18 9 5 5-23Z"/><circle cx="32" cy="39" r="17"/>',
    mask:'<path d="M10 10c14 7 30 7 44 0l-5 27c-3 16-31 16-34 0l-5-27Z"/><path d="M19 26c5-5 9-5 13 0M36 26c4-5 8-5 13 0M23 37c6 5 12 5 18 0" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="4"/>',
    dice:'<rect x="8" y="8" width="44" height="44" rx="10"/><path d="M19 19h.1M41 19h.1M30 30h.1M19 41h.1M41 41h.1" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="7"/>',
    fist:'<path d="M9 36c0-8 8-12 14-7V16c0-7 9-7 9 0v11-15c0-7 9-7 9 0v16-11c0-7 9-7 9 0v14c0-6 9-6 9 0v8c0 13-9 20-23 20H25C15 59 9 50 9 36Z"/>',
    cloud:'<path d="M12 49C1 45 3 30 13 28c0-11 13-18 22-10 8-8 23-2 22 11 10 4 7 19-4 20H12Z"/>',
    snow:'<path d="M32 5v54M8 18l48 28M56 18 8 46M23 9l9 9 9-9M23 55l9-9 9 9M9 28l12 3-3-12M55 28l-12 3 3-12" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="5"/>',
    missile:'<path d="M8 46 19 18 47 7l10 10-11 28-23 8 4-13-10-9-9 15Zm22-19 8 8 8-19-16 11Z"/>',
    fire:'<path d="M32 59C17 59 9 49 14 36c3-8 11-13 10-27 13 8 18 17 16 28 5-4 8-8 9-14 10 14 9 26 2 32-5 4-11 4-19 4Zm1-8c7-5 7-12 1-20-1 7-7 10-7 15 0 4 2 6 6 5Z"/>',
    lightning:'<path d="M33 3 12 35h16l-6 26 30-38H36L48 3H33Z"/>',
    shuriken:'<path d="m32 4 8 19 20-6-13 16 13 15-20-6-8 19-8-19-20 6 13-15L4 17l20 6 8-19Z"/><circle cx="32" cy="33" r="6" fill="var(--aug-dark,#07131b)"/>',
    orbit1:'<circle cx="30" cy="32" r="12"/><ellipse cx="30" cy="32" rx="27" ry="18" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="54" cy="24" r="7" fill="currentColor"/>',
    orbit2:'<circle cx="30" cy="32" r="11"/><ellipse cx="30" cy="32" rx="27" ry="18" fill="none" stroke="currentColor" stroke-width="5"/><path d="M54 17a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM6 34a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z" fill="currentColor"/>',
    skull:'<path d="M10 29C10 15 19 6 32 6s22 9 22 23c0 10-5 16-12 19v10H22V48c-7-3-12-9-12-19Z"/><path d="M20 29h.1M44 29h.1M26 42l6-6 6 6M27 51v7M37 51v7" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="6"/>',
    target:'<circle cx="31" cy="31" r="23" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="7"/><circle cx="31" cy="31" r="9" fill="currentColor"/>',
    gear:'<path d="m32 4 6 8 10-2 2 10 9 5-5 9 5 9-9 5-2 10-10-2-6 8-6-8-10 2-2-10-9-5 5-9-5-9 9-5 2-10 10 2 6-8Z"/><circle cx="32" cy="34" r="10" fill="var(--aug-dark,#07131b)"/>',
    bow:'<path d="M15 6c23 14 23 38 0 52M15 6c-10 16-10 36 0 52M15 32h43M47 23l11 9-11 9" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="6"/>',
    pistol:'<path d="M5 19h42l11 10-11 10H28l-4 19H10l4-19H5V19Z"/>',
    staff:'<path d="M10 59 40 19l8 6-29 37-9-3Z"/><circle cx="48" cy="15" r="11" fill="currentColor"/>',
    mine:'<path d="M32 7 37 18l11-6-1 13 13 1-9 9 9 9-13 1 1 13-11-6-5 11-5-11-11 6 1-13-13-1 9-9-9-9 13-1-1-13 11 6 5-11Z"/><circle cx="32" cy="35" r="9" fill="var(--aug-dark,#07131b)"/>',
    lotus:'<path d="M32 53C17 53 8 46 5 34c11-2 19 1 27 11 8-10 16-13 27-11-3 12-12 19-27 19Zm0-8c-10-9-11-21 0-34 11 13 10 25 0 34Z"/>',
    hourglass:'<path d="M13 7h38v9c0 8-5 14-13 18 8 4 13 10 13 18v7H13v-7c0-8 5-14 13-18-8-4-13-10-13-18V7Zm9 9c0 6 4 10 10 13 6-3 10-7 10-13H22Zm10 23c-6 3-10 7-10 12h20c0-5-4-9-10-12Z"/>',
    flag:'<path d="M10 5h8v54h-8V5Zm8 4h34l-8 10 8 10H18V9Z"/>',
    rocket:'<path d="M8 46 18 18 45 6l13 13-12 27-18 6 3-12-8-8-12 3-3 11Zm25-21 7 7 8-16-15 9Z"/><path d="M17 39 5 58l20-12-8-7Z" fill="currentColor"/>',
    crown:'<path d="m7 17 13 8L32 7l12 18 13-8-6 30H13L7 17Zm8 35h34v8H15v-8Z"/>',
    lowHeart:'<path d="M32 55C26 50 9 40 9 24c0-10 12-15 20-6l3 4 3-4c8-9 20-4 20 6 0 16-17 26-23 31Z"/><path d="M13 35h38" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="6"/>'
  });

  const AUG_BADGES = Object.freeze({
    plus:'<path d="M50 44v12M44 50h12"/>',
    up:'<path d="M44 53l6-7 6 7M50 46v11"/>',
    down:'<path d="M44 47l6 7 6-7M50 43v11"/>',
    clock:'<path d="M50 44v7l5 3"/>',
    speed:'<path d="m43 46 5 4-5 4m7-8 5 4-5 4"/>',
    one:'<path d="M47 47l3-3v12M46 56h8"/>',
    two:'<path d="M44 47c1-4 11-4 11 1 0 3-5 5-10 8h11"/>',
    three:'<path d="M44 45h7c6 0 6 5 1 5 6 0 6 6-1 6h-7"/>',
    five:'<path d="M55 44H46l-1 6h6c6 0 6 7-1 7h-6"/>',
    stack:'<path d="M44 55v-3m4 3v-6m4 6v-9m4 9V43"/>',
    blast:'<path d="m50 42 2 5 5-2-3 5 4 4-6-1-2 6-2-6-6 1 4-4-3-5 5 2 2-5Z" fill="var(--aug-dark,#07131b)" stroke="none"/>',
    swap:'<path d="M44 47h11l-3-3m4 9H45l3 3"/>',
    lock:'<path d="M45 49h10v8H45v-8Zm2 0v-3c0-4 6-4 6 0v3"/>',
    heal:'<path d="M50 43v14M43 50h14"/>',
    bounce:'<path d="m43 47 5-4 4 4 5-4M43 55l5-4 4 4 5-4"/>'
  });

  function augmentBadge(mark) {
    if (!mark) return '';
    return '<g class="aug-badge" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="50" r="11" fill="currentColor" stroke="var(--aug-ink,#effaff)" stroke-width="2.5"/>' + mark + '</g>';
  }

  function augmentIcon(primary, secondary, detail, badgeMark) {
    return '<circle class="aug-plate" cx="32" cy="32" r="29" fill="currentColor" opacity=".13" stroke="currentColor" stroke-width="2"/>' +
      '<g class="aug-primary" fill="var(--aug-ink,#effaff)" stroke="none">' + primary + '</g>' +
      (secondary ? '<g class="aug-secondary" fill="currentColor" stroke="none">' + secondary + '</g>' : '') +
      (detail ? '<g class="aug-detail" fill="none" stroke="var(--aug-dark,#07131b)" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">' + detail + '</g>' : '') +
      augmentBadge(badgeMark);
  }

  const augmentPaths = Object.freeze({
    'aug-hp15':augmentIcon(AUG_SHAPES.heart,'<path d="M21 25h22v20H21Z"/>','<path d="M32 28v14M25 35h14"/>'),
    'aug-atk15':augmentIcon(AUG_SHAPES.sword,'','',AUG_BADGES.up),
    'aug-dmg10':augmentIcon(AUG_SHAPES.burst,'','',AUG_BADGES.up),
    'aug-rot15':augmentIcon(AUG_SHAPES.rotor,'<path d="M46 11c8 5 12 13 11 22l-5-6-6 5"/>'),
    'aug-move15':augmentIcon(AUG_SHAPES.ball,AUG_SHAPES.wing,'<path d="M43 21h13M46 31h14M43 41h13"/>'),
    'aug-lifesteal':augmentIcon(AUG_SHAPES.heart,AUG_SHAPES.drop,'<path d="M21 27h12m0 0-5-5m5 5-5 5"/>'),
    'aug-giant':augmentIcon('<circle cx="32" cy="32" r="23"/>','<path d="M15 15 7 7m0 0 1 8M7 7l8 1M49 15l8-8m0 0-8 1m8-1-1 8M15 49l-8 8m0 0 8-1m-8 1 1-8M49 49l8 8m0 0-1-8m1 8-8-1" fill="none" stroke="currentColor" stroke-width="4.5"/>'),
    'aug-tiny':augmentIcon('<circle cx="32" cy="32" r="8"/>','<path d="M8 8l15 15m0 0-8-1m8 1-1-8M56 8 41 23m0 0 8-1m-8 1 1-8M8 56l15-15m0 0-1 8m1-8-8 1M56 56 41 41m0 0 1 8m-1-8 8 1" fill="none" stroke="currentColor" stroke-width="4.5"/>'),
    'aug-elastic':augmentIcon(AUG_SHAPES.wall,'<circle cx="34" cy="34" r="12"/><path d="m34 19 10 15-10 15M47 25h10M49 34h11M47 43h10" fill="none" stroke="currentColor" stroke-width="4.5"/>'),

    'aug-warmup':augmentIcon(AUG_SHAPES.sword,AUG_SHAPES.fire,'',AUG_BADGES.clock),
    'aug-accelRot':augmentIcon(AUG_SHAPES.rotor,'<path d="M45 10c9 6 13 15 11 25l-5-6-6 5"/>','',AUG_BADGES.clock),
    'aug-speedster':augmentIcon(AUG_SHAPES.ball,AUG_SHAPES.wing,'<path d="M42 24h15M45 33h15M42 42h15"/>',AUG_BADGES.clock),
    'aug-meditate':augmentIcon(AUG_SHAPES.lotus,'<path d="M32 49c-7-5-13-9-13-16 0-7 8-10 13-3 5-7 13-4 13 3 0 7-6 11-13 16Z"/>','',AUG_BADGES.clock),
    'aug-marathoner':augmentIcon(AUG_SHAPES.hourglass,'<path d="M32 52c-5-4-10-7-10-12 0-5 6-7 10-2 4-5 10-3 10 2 0 5-5 8-10 12Z"/>','',AUG_BADGES.heal),
    'aug-rampage20':augmentIcon(AUG_SHAPES.clock,AUG_SHAPES.burst,'<path d="M12 55l8-9m5 9 7-12m6 12 8-9"/>'),

    'aug-firstStrike':augmentIcon(AUG_SHAPES.flag,AUG_SHAPES.sword,'',AUG_BADGES.clock),
    'aug-rocketStart':augmentIcon(AUG_SHAPES.rocket,'<rect x="48" y="8" width="9" height="48" rx="3"/>','<path d="M37 32h22"/>'),
    'aug-ironDefense':augmentIcon(AUG_SHAPES.shield,'<path d="M12 10h22l-6 8 6 8H12Z"/>','',AUG_BADGES.clock),

    'aug-berserker':augmentIcon(AUG_SHAPES.brokenHeart,AUG_SHAPES.sword,'',AUG_BADGES.up),
    'aug-escapeInstinct':augmentIcon(AUG_SHAPES.lowHeart,'<circle cx="46" cy="38" r="9"/><path d="M38 33 26 24l1 9-7 4 18 6Z"/>','<path d="M43 24h14M46 34h14"/>'),
    'aug-lastResistance':augmentIcon(AUG_SHAPES.brokenHeart,'','',AUG_BADGES.one),
    'aug-survivalInstinct':augmentIcon(AUG_SHAPES.lowHeart,'<path d="M43 12v20M33 22h20"/>','',AUG_BADGES.heal),

    'aug-winMomentum':augmentIcon(AUG_SHAPES.trophy,AUG_SHAPES.sword,'',AUG_BADGES.up),
    'aug-bloodRush':augmentIcon('<path d="M13 51c-5 0-8-5-5-10l5-8 5 8c3 5 0 10-5 10Zm17-9c-5 0-8-5-5-10l5-8 5 8c3 5 0 10-5 10Zm17-9c-5 0-8-5-5-10l5-8 5 8c3 5 0 10-5 10Z"/>',AUG_SHAPES.sword,'',AUG_BADGES.up),
    'aug-vengeance':augmentIcon(AUG_SHAPES.shield,AUG_SHAPES.sword,'<path d="m19 19 18 18m0-18L19 37M49 16c8 10 4 23-6 28m0 0 3-7m-3 7 8 1"/>'),
    'aug-learnLoss':augmentIcon(AUG_SHAPES.book,'<path d="M32 49c-7-5-13-9-13-16 0-7 8-10 13-3 5-7 13-4 13 3 0 7-6 11-13 16Z"/>','',AUG_BADGES.up),
    'aug-survivor':augmentIcon(AUG_SHAPES.heart,'<circle cx="15" cy="15" r="6"/><circle cx="32" cy="9" r="6"/><circle cx="49" cy="15" r="6"/>','',AUG_BADGES.heal),
    'aug-battleExp':augmentIcon(AUG_SHAPES.medal,AUG_SHAPES.rotor,'',AUG_BADGES.up),
    'aug-seasonedExp':augmentIcon(AUG_SHAPES.medal,AUG_SHAPES.sword,'',AUG_BADGES.up),
    'aug-fallenPower':augmentIcon(AUG_SHAPES.coin,AUG_SHAPES.burst,'<path d="m27 12 6 11-7 8 8 9-5 10"/>',AUG_BADGES.down),
    'aug-brink':augmentIcon('<path d="M5 46h28l7-14h19v27H5V46Z"/>','<circle cx="31" cy="34" r="10"/>','',AUG_BADGES.one),

    'aug-trollCondition':augmentIcon(AUG_SHAPES.mask,'<circle cx="33" cy="31" r="12"/>','',AUG_BADGES.swap),
    'aug-devilDeal':augmentIcon(AUG_SHAPES.coin,'<path d="M14 13 8 4l12 6M44 13l6-9-12 6"/><path d="M38 54 55 31l6 6-19 20Z"/>','',AUG_BADGES.swap),
    'aug-gamble':augmentIcon(AUG_SHAPES.dice,'','<path d="M7 57h20m0 0-6-5m6 5-6 5M57 57H37m0 0 6-5m-6 5 6 5"/>'),

    'aug-glass':augmentIcon(AUG_SHAPES.sword,'<path d="M48 54c-6-4-11-8-11-14 0-6 7-8 11-2 4-6 11-4 11 2 0 6-5 10-11 14Z"/>','<path d="m39 13 5 9-6 6 7 7-5 7"/>',AUG_BADGES.down),
    'aug-brute':augmentIcon(AUG_SHAPES.fist,AUG_SHAPES.rotor,'',AUG_BADGES.down),
    'aug-bloodWeapon':augmentIcon(AUG_SHAPES.sword,'<path d="M43 39c7 9 9 12 9 16 0 5-4 8-9 8s-9-3-9-8c0-4 2-7 9-16Z"/>','',AUG_BADGES.down),

    'aug-reflectCharge':augmentIcon(AUG_SHAPES.wall,'<circle cx="31" cy="17" r="6"/><path d="M29 29h.1M40 38h.1M50 27h.1" fill="none" stroke="currentColor" stroke-width="7"/>','<path d="m27 13 20 14-10 11 15 9"/>',AUG_BADGES.blast),
    'aug-wallClimb':augmentIcon(AUG_SHAPES.wall,'<circle cx="35" cy="35" r="14"/>','<path d="M35 28v14M28 35h14"/>'),
    'aug-shockwave':augmentIcon(AUG_SHAPES.wall,'<circle cx="30" cy="32" r="11"/>','<path d="M41 20c10 7 10 17 0 24M48 14c16 11 16 25 0 36"/>'),
    'aug-collisionMania':augmentIcon('<circle cx="17" cy="32" r="13"/><circle cx="47" cy="32" r="13"/>','<path d="m32 20 3 7 8-3-4 7 7 5-9 1 1 9-6-6-6 6 1-9-9-1 7-5-4-7 8 3 3-7Z"/>','',AUG_BADGES.up),
    'aug-staticShock':augmentIcon('<circle cx="15" cy="34" r="12"/><circle cx="49" cy="34" r="12"/>',AUG_SHAPES.lightning),
    'aug-staticUp':augmentIcon(AUG_SHAPES.lightning,'<path d="M7 14h14M4 26h13M7 38h10"/>','',AUG_BADGES.up),
    'aug-staticFast':augmentIcon(AUG_SHAPES.lightning,'<path d="M6 20h15M3 32h16M7 44h14"/>','',AUG_BADGES.speed),

    'aug-sleepGas':augmentIcon(AUG_SHAPES.cloud,'','<path d="M17 27h13L17 40h13M35 19h12L35 31h12"/>'),
    'aug-frost':augmentIcon(AUG_SHAPES.snow,'<path d="M47 17h.1M54 25h.1M48 33h.1" fill="none" stroke="currentColor" stroke-width="7"/>','',AUG_BADGES.three),
    'aug-gravityWell':augmentIcon('<circle cx="32" cy="32" r="14"/>','<path d="m7 16 13 8-12 6M57 16l-13 8 12 6M7 49l13-8-12-6M57 49l-13-8 12-6"/>'),

    'aug-missile':augmentIcon('<path d="M5 25 15 7l16 6-7 18-10 8 1-9-10-5Zm25 25 10-18 16 6-7 18-10 8 1-9-10-5Z"/>','<path d="m12 30-8 12 13-7m20 20-8 9 13-4"/>','<path d="M27 16c12-8 20-6 27 3M52 42c4-1 7 0 9 2"/>'),
    'aug-missilePlus':augmentIcon('<path d="M3 21 12 5l14 6-6 15-9 7 1-8-9-4Zm28 0 9-16 14 6-6 15-9 7 1-8-9-4ZM17 49l9-16 14 6-6 15-9 7 1-8-9-4Z"/>','<path d="m9 26-6 10 10-5m25-5-6 10 10-5M23 54l-6 9 10-4"/>'),
    'aug-missileUp':augmentIcon(AUG_SHAPES.missile,'<path d="m49 4 3 7 8-3-4 7 7 5-9 1 1 9-6-6-6 6 1-9-9-1 7-5-4-7 8 3 3-7Z"/>'),
    'aug-flame':augmentIcon('<circle cx="47" cy="32" r="12"/>','<path d="M4 32c10-5 12-13 25-14-4 5-3 9 2 11 7 3 7 8 1 12-7 5-18 1-28-9Z"/>','<path d="M46 24v16"/>'),
    'aug-flameUp':augmentIcon(AUG_SHAPES.fire,'<path d="M33 51c7-5 7-12 1-20-1 7-7 10-7 15 0 4 2 6 6 5Z"/>','',AUG_BADGES.blast),
    'aug-flameDur':augmentIcon(AUG_SHAPES.fire,'<path d="M8 50c9-8 13-12 18-24"/>','',AUG_BADGES.clock),
    'aug-lightning':augmentIcon(AUG_SHAPES.cloud,AUG_SHAPES.lightning,'<path d="M13 55h.1M28 55h.1M43 55h.1" stroke="currentColor" stroke-width="7"/>'),
    'aug-chainBolt':augmentIcon(AUG_SHAPES.lightning,'<path d="M29 32 9 48l11 2-5 10M36 31l20 17-11 2 5 10"/>'),
    'aug-shuriken':augmentIcon(AUG_SHAPES.shuriken,'<circle cx="49" cy="15" r="8"/>','<path d="M49 9v12M43 15h12"/>'),
    'aug-shurikenSpd':augmentIcon(AUG_SHAPES.shuriken,'<path d="M4 21h15M1 32h17M4 43h15"/>','',AUG_BADGES.speed),
    'aug-shurikenUp':augmentIcon(AUG_SHAPES.shuriken,'','',AUG_BADGES.blast),
    'aug-satellite':augmentIcon(AUG_SHAPES.orbit1),
    'aug-satellitePlus':augmentIcon(AUG_SHAPES.orbit2),

    'aug-miniBall':augmentIcon('<circle cx="24" cy="30" r="18"/><circle cx="50" cy="43" r="9"/>','','<path d="M38 35c5 1 7 3 9 5m-4 9 7 7m0 0-1-7m1 7 7-1"/>'),
    'aug-twins':augmentIcon('<circle cx="32" cy="22" r="16"/><circle cx="16" cy="47" r="9"/><circle cx="48" cy="47" r="9"/>'),
    'aug-legion':augmentIcon('<circle cx="13" cy="45" r="10"/><circle cx="32" cy="42" r="13"/><circle cx="52" cy="45" r="10"/>',AUG_SHAPES.crown),
    'aug-minionRevenge':augmentIcon('<circle cx="32" cy="32" r="20"/>','<path d="m50 9 3 7 8-3-4 7 6 5-9 1 1 9-6-6-6 6 1-9-9-1 7-5-4-7 8 3 3-7Z"/>','<path d="m30 13 4 12-7 8 8 11-4 7"/>',AUG_BADGES.blast),

    'aug-split':augmentIcon('<circle cx="22" cy="25" r="17"/>','<circle cx="16" cy="48" r="10"/><circle cx="48" cy="48" r="10"/>','<path d="M27 34 18 40m19-6 9 6"/>'),
    'aug-lastStand':augmentIcon(AUG_SHAPES.skull,'','',AUG_BADGES.three),

    'aug-warmonger':augmentIcon(AUG_SHAPES.sword,'<path d="M40 53h4v-8h-4v8Zm6 0h4V41h-4v12Zm6 0h4V37h-4v16Z"/>','',AUG_BADGES.five),
    'aug-rotMomentum':augmentIcon(AUG_SHAPES.rotor,'<path d="M10 13h.1M19 7h.1M30 5h.1M42 8h.1M51 15h.1" fill="none" stroke="currentColor" stroke-width="6"/>','',AUG_BADGES.speed),
    'aug-chase':augmentIcon(AUG_SHAPES.target,'<circle cx="17" cy="47" r="10"/>' ,'<path d="M24 42 42 32M5 39h8M4 48h9M7 56h8"/>',AUG_BADGES.speed),
    'aug-vampiric':augmentIcon(AUG_SHAPES.heart,'','<path d="M17 15 25 31l7-14 7 14 8-16"/>',AUG_BADGES.heal),
    'aug-mark':augmentIcon(AUG_SHAPES.target,'<path d="M13 12h.1M32 5h.1M50 12h.1M57 31h.1M50 50h.1" fill="none" stroke="currentColor" stroke-width="6"/>','',AUG_BADGES.five),
    'aug-counter':augmentIcon(AUG_SHAPES.shield,AUG_SHAPES.sword,'<path d="M47 11c9 11 7 26-4 34m0 0 2-8m-2 8 8 1"/>'),
    'aug-hitCharge':augmentIcon(AUG_SHAPES.shield,'<path d="m12 9 3 7 8-3-4 7 6 5-9 1 1 9-6-6-6 6 1-9-9-1 7-5-4-7 8 3 3-7Z"/>','<path d="M40 50h16V27H40m4 18h8m-8-6h8m-8-6h8"/>',AUG_BADGES.stack),

    'aug-autoExpert':augmentIcon(AUG_SHAPES.gear,AUG_SHAPES.clock,'',AUG_BADGES.speed),
    'aug-speedPower':augmentIcon('<path d="M7 48a25 25 0 0 1 50 0H7Z"/>','<path d="m49 7 3 7 8-3-4 7 6 5-9 1 1 9-6-6-6 6 1-9-9-1 7-5-4-7 8 3 3-7Z"/>','<path d="M31 43 45 20M12 38h7M44 38h7M20 26l5 6"/>',AUG_BADGES.swap),

    'aug-w_giant':augmentIcon(AUG_SHAPES.sword,'<path d="M12 13 5 6m0 0 1 8M5 6l8 1M51 51l8 8m0 0-1-8m1 8-8-1" fill="none" stroke="currentColor" stroke-width="4.5"/>'),
    'aug-w_beam':augmentIcon(AUG_SHAPES.sword,'<path d="M7 18c9 5 14 10 18 18C15 33 9 28 4 22l3-4Zm50 18c-9-5-14-10-18-18 10 3 16 8 21 14l-3 4Z"/>'),
    'aug-desperateSpin':augmentIcon(AUG_SHAPES.lowHeart,AUG_SHAPES.sword,'<path d="M9 27C6 12 21 3 34 8m0 0-8-3m8 3-5 7"/>',AUG_BADGES.speed),
    'aug-d_dual':augmentIcon('<path d="M5 56h8l14-17-8-8L5 48v8Zm18-29L39 6l9 9-20 17-5-5ZM59 56h-8L37 39l8-8 14 17v8ZM41 27 25 6l-9 9 20 17 5-5Z"/>'),
    'aug-d_phase':augmentIcon(AUG_SHAPES.dagger,'<circle cx="42" cy="31" r="17" opacity=".55"/>','<path d="M27 31h31m0 0-7-6m7 6-7 6"/>'),
    'aug-d_bleed':augmentIcon(AUG_SHAPES.dagger,AUG_SHAPES.drop,'',AUG_BADGES.clock),
    'aug-b_triple':augmentIcon(AUG_SHAPES.bow,'<path d="M39 20 59 11v8l-20 7Zm0 12h21v8H39Zm0 12 20 7v8l-20-9Z"/>'),
    'aug-b_homing':augmentIcon('<path d="M6 49c22 0 33-3 36-15 2-8 2-13 9-17M43 11l8 6-8 7" fill="none" stroke="var(--aug-ink,#effaff)" stroke-width="7"/>',AUG_SHAPES.target),
    'aug-b_kb':augmentIcon('<path d="M5 28h36v-9l18 13-18 13v-9H5V28Z"/>','<circle cx="50" cy="32" r="11"/>','<path d="M55 17h6M58 32h6M55 47h6"/>'),
    'aug-p_shotgun':augmentIcon(AUG_SHAPES.pistol,'<path d="m43 22 18-13M46 28l18-4M46 35l18 5M43 41l18 14"/>'),
    'aug-p_mag':augmentIcon('<path d="M8 8h34v17H8V8Zm5 17h23l-5 34H17l-4-34Z"/>','<path d="M47 8h6v15h-6V8Zm9 0h6v15h-6V8ZM47 28h6v15h-6V28Zm9 0h6v15h-6V28Z"/>'),
    'aug-p_bayonet':augmentIcon(AUG_SHAPES.pistol,'<path d="m39 37 18 14-7 8-17-18 6-4Z"/>','<path d="M33 9c11 0 18 7 19 16m0 0-6-5m6 5 4-7"/>'),
    'aug-s_double':augmentIcon(AUG_SHAPES.staff,'<circle cx="16" cy="20" r="9"/><circle cx="54" cy="38" r="9"/>','<path d="M42 18 23 20m25 4 5 8"/>'),
    'aug-s_steal':augmentIcon(AUG_SHAPES.staff,AUG_SHAPES.sword,'<path d="M12 49c8 5 19 3 26-7m0 0-8 2m8-2-1 8"/>',AUG_BADGES.lock),
    'aug-s_bounce':augmentIcon('<rect x="5" y="5" width="9" height="54" rx="3"/><rect x="50" y="5" width="9" height="54" rx="3"/>','<circle cx="22" cy="15" r="7"/>','<path d="m22 15 22 14-24 17 22 10"/>',AUG_BADGES.bounce),
    'aug-m_big':augmentIcon(AUG_SHAPES.mine,'<circle cx="32" cy="35" r="23" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="32" cy="35" r="29" fill="none" stroke="currentColor" stroke-width="3"/>'),
    'aug-m_heal':augmentIcon(AUG_SHAPES.mine,'<path d="M32 46c-7-5-13-9-13-16 0-7 8-10 13-3 5-7 13-4 13 3 0 7-6 11-13 16Z"/>','<path d="M32 28v12M26 34h12"/>'),
    'aug-m_freeze':augmentIcon(AUG_SHAPES.mine,AUG_SHAPES.snow,'<path d="M14 52h36"/>'),
    // 사슬 연장 — 마디를 하나 더 늘린 화살표
    'aug-c_long':augmentIcon(AUG_SHAPES.chain,'','<path d="M8 56 20 44M50 8 40 18"/>',AUG_BADGES.up),
    // 가시 사슬 — 줄에 가시가 돋는다
    'aug-c_barbed':augmentIcon(AUG_SHAPES.chain,'','<path d="M18 8 24 18M8 20 18 25M32 18l6 10M22 34l-10 5"/>'),
    // 이중 사슬 — 추가 둘
    'aug-c_twin':augmentIcon(AUG_SHAPES.chain,'<circle cx="14" cy="47" r="9"/>','<path d="M24 38 18 44"/>')
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

  function legacyMarkup(name, className = '') {
    const key = resolve(name);
    const drawing = augmentPaths[key] || paths[key];
    const requestedClasses = String(className || '').trim();
    const classTokens = requestedClasses ? requestedClasses.split(/\s+/) : [];
    const safeClasses = classTokens.length && classTokens.every(token => /^[A-Za-z0-9_-]+$/.test(token))
      ? classTokens.join(' ')
      : '';
    const isAugment = Object.prototype.hasOwnProperty.call(augmentPaths, key);
    const svgClasses = ['ui-svg', isAugment ? 'ui-svg--augment' : '', safeClasses].filter(Boolean).join(' ');
    return '<svg class="' + svgClasses + '" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + drawing + '</svg>';
  }

  function archivedMarkup(name, className = '') {
    const key = resolve(name);
    const source = global.BRAugmentAssets && global.BRAugmentAssets[key];
    // Restrict image URLs to our checked-in assets (including the content hash).
    if (!source || !/^assets\/icons\/augments\/[A-Za-z0-9_]+\.svg\?v=[a-f0-9]{12}$/.test(source)) return legacyMarkup(name, className);
    const tokens = String(className || '').trim().split(/\s+/).filter(Boolean);
    const safeClasses = tokens.every(token => /^[A-Za-z0-9_-]+$/.test(token)) ? tokens.join(' ') : '';
    const classes = ['ui-svg', 'ui-svg--augment', 'ui-svg--asset', safeClasses].filter(Boolean).join(' ');
    return '<img class="' + classes + '" src="' + source + '" data-augment-icon="' + key + '" width="512" height="512" alt="" aria-hidden="true" draggable="false">';
  }

  function markup(name, className = '') {
    const key = resolve(name);
    const art = global.BRAugmentArt;
    const current = art && typeof art.markup === 'function' ? art.markup(key, className) : '';
    return current || archivedMarkup(name, className);
  }

  function hydrate(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-ui-icon]').forEach(element => {
      element.innerHTML = markup(element.dataset.uiIcon, element.dataset.iconClass || '');
    });
  }

  global.BRIcons = Object.freeze({ markup, archivedMarkup, legacyMarkup, hydrate, resolve, has:name => !!(paths[aliases[name] || name] || augmentPaths[aliases[name] || name]) });
  if (typeof document !== 'undefined') {
    // A failed asset download must not leave a blank card or require a reload.
    document.addEventListener('error', event => {
      const element = event.target;
      if (!element || element.tagName !== 'IMG' || !element.dataset.augmentIcon) return;
      const template = document.createElement('template');
      template.innerHTML = legacyMarkup(element.dataset.augmentIcon, element.className.replace(/\bui-svg(?:--[a-z]+)?\b/g, '').trim());
      element.replaceWith(template.content.firstChild);
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate(document), { once:true });
    else hydrate(document);
  }
})(typeof window !== 'undefined' ? window : globalThis);
