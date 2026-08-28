'use strict';
/* ============================================================
 * 바운스 로얄 — 멀티플레이 클라이언트 (서버 권위형)
 *
 * 멀티 모드에서 이 계층이 하는 일
 *   - 입력만 서버로 보낸다 (무기·조준·스킬·증강·투표)
 *   - 서버 스냅샷을 받아 보간용 버퍼에 쌓는다
 *   - 전투 결과·라운드 진행·승패는 전부 서버 값을 따른다
 *
 * 로컬 sim은 멀티 모드에서 절대 돌리지 않는다. 싱글플레이는 기존 경로를
 * 그대로 쓰고, 여기서는 서버가 보내준 상태만 그린다.
 * ============================================================ */

const NET_TOKEN_KEY = 'bounce-royale-session-v1';
const SNAP_BUFFER = 12;              // 보간용으로 들고 있는 스냅샷 수
const INTERP_DELAY = 100;            // 이만큼 과거를 그려 끊김을 흡수한다 (ms)

/* 서버 주소: 같은 호스트에서 서빙되면 그대로, 아니면 window.BOUNCE_SERVER 사용 */
function defaultServerUrl() {
  if (typeof window !== 'undefined' && window.BOUNCE_SERVER) return window.BOUNCE_SERVER;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

const Net = {
  ws: null,
  connected: false,
  token: null,
  seat: null,              // 내 자리 번호
  roomCode: null,
  players: [],             // 서버가 알려준 참가자 목록
  phase: null,
  round: 0,
  buffer: [],              // { at, snap } 스냅샷 버퍼
  lastSnapAt: 0,
  handlers: {},
  queueInfo: null,
  wantQueue: false,
  serverUrl: null,

  on(type, fn) { (this.handlers[type] || (this.handlers[type] = [])).push(fn); return this; },
  emit(type, payload) { for (const fn of this.handlers[type] || []) { try { fn(payload); } catch (e) { console.error(e); } } },

  loadToken() {
    // 탭마다 다른 세션이어야 하므로 sessionStorage를 쓴다.
    // 새로고침으로 돌아오는 재접속은 같은 탭이라 그대로 유지된다.
    try { this.token = sessionStorage.getItem(NET_TOKEN_KEY) || null; } catch (e) { this.token = null; }
    return this.token;
  },
  saveToken(token) {
    this.token = token || null;
    try { if (token) sessionStorage.setItem(NET_TOKEN_KEY, token); } catch (e) { /* 저장 실패는 무시 */ }
  },
  clearToken() {
    this.token = null;
    try { sessionStorage.removeItem(NET_TOKEN_KEY); } catch (e) { /* 무시 */ }
  },

  connect(url) {
    this.serverUrl = url || this.serverUrl || defaultServerUrl();
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return Promise.resolve(this);
    this.loadToken();
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try { ws = new WebSocket(this.serverUrl); } catch (err) { reject(err); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.send({
          t: 'hello',
          name: (typeof Profile !== 'undefined' && Profile.data) ? Profile.data.nickname : '플레이어',
          charId: (typeof Profile !== 'undefined' && Profile.data) ? Profile.data.equippedChar : 'cat',
          token: this.token || undefined,
        });
        this.emit('open');
        if (!settled) { settled = true; resolve(this); }
      };
      ws.onmessage = ev => this.receive(ev.data);
      ws.onclose = () => {
        this.connected = false;
        this.emit('close');
        if (!settled) { settled = true; reject(new Error('서버에 연결할 수 없습니다')); }
      };
      ws.onerror = () => { /* close에서 처리한다 */ };
    });
  },

  disconnect() {
    this.wantQueue = false;
    if (this.ws) { try { this.ws.close(); } catch (e) { /* 무시 */ } }
    this.ws = null;
    this.connected = false;
    this.reset();
  },

  reset() {
    this.seat = null;
    this.players = [];
    this.phase = null;
    this.round = 0;
    this.buffer.length = 0;
  },

  send(msg) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  },

  receive(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'welcome':
        if (!this.token) this.saveToken(msg.token);
        this.searchSeconds = msg.searchSeconds;
        break;
      case 'you':
        this.seat = msg.id;
        this.roomCode = msg.code || null;
        this.saveToken(msg.token);
        break;
      case 'queue':
        this.queueInfo = msg;
        break;
      case 'match':
      case 'intro':
      case 'roundEnd':
      case 'rejoined':
      case 'left':
        if (msg.players) this.players = msg.players;
        break;
      case 'round':
        this.round = msg.n;
        if (msg.players) this.players = msg.players;
        this.buffer.length = 0;
        break;
      case 'resumed':
        this.seat = msg.id;
        this.phase = msg.phase;
        this.round = msg.round;
        if (msg.players) this.players = msg.players;
        this.buffer.length = 0;
        break;
      case 's':
        this.pushSnapshot(msg.b);
        return;                       // 스냅샷은 별도 이벤트로 흘리지 않는다
      case 'gameOver':
        if (msg.players) this.players = msg.players;
        this.clearToken();            // 끝난 방으로는 복귀하지 않는다
        break;
      default:
        break;
    }
    this.emit(msg.t, msg);
    this.emit('*', msg);
  },

  /* ---------------- 스냅샷 버퍼 ---------------- */
  pushSnapshot(snap) {
    const at = performance.now();
    this.buffer.push({ at, snap });
    while (this.buffer.length > SNAP_BUFFER) this.buffer.shift();
    this.lastSnapAt = at;
    this.emit('snapshot', snap);
  },

  /* 지금 그려야 할 상태를 보간해서 돌려준다.
   * INTERP_DELAY만큼 과거를 렌더링해 패킷 지터를 흡수한다. */
  viewState() {
    const n = this.buffer.length;
    if (!n) return null;
    const target = performance.now() - INTERP_DELAY;
    if (n === 1 || target >= this.buffer[n - 1].at) return this.buffer[n - 1].snap;
    let i = n - 1;
    while (i > 0 && this.buffer[i - 1].at > target) i--;
    const b = this.buffer[i], a = this.buffer[i - 1] || b;
    const span = b.at - a.at;
    const k = span > 0 ? Math.max(0, Math.min(1, (target - a.at) / span)) : 1;
    return lerpSnapshot(a.snap, b.snap, k);
  },

  /* ---------------- 입력 ---------------- */
  queue() { this.wantQueue = true; this.send({ t: 'queue' }); },
  leaveQueue() { this.wantQueue = false; this.send({ t: 'leave' }); },
  createRoom() { this.send({ t: 'createRoom' }); },
  joinRoom(code) { this.send({ t: 'joinRoom', code: String(code || '').toUpperCase() }); },
  startRoom() { this.send({ t: 'startRoom' }); },
  leaveRoom() { this.send({ t: 'leaveRoom' }); },
  pickWeapon(id) { this.send({ t: 'weapon', id }); },
  aim(ang) { this.send({ t: 'aim', ang }); },
  skill(slot) { this.send({ t: 'skill', slot }); },
  pickAugment(id) { this.send({ t: 'augment', id }); },
  refresh() { this.send({ t: 'refresh' }); },
  vote(id) { this.send({ t: 'vote', id }); },
};

/* ============================================================
 * 스냅샷 보간
 * 위치·각도처럼 연속적인 값만 섞고, 개수가 달라질 수 있는 목록은
 * 최신 쪽을 그대로 쓴다. 각도는 짧은 쪽으로 감아 돈다.
 * ============================================================ */
function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
function lerp(a, b, k) { return a + (b - a) * k; }

function lerpSnapshot(a, b, k) {
  if (!a || !b) return b || a;
  const out = Object.assign({}, b);
  out.t = lerp(a.t, b.t, k);
  out.sh = lerp(a.sh, b.sh, k);
  // 전투원: 같은 uid끼리만 섞는다
  const prev = new Map(a.f.map(f => [f.u, f]));
  out.f = b.f.map(f => {
    const p = prev.get(f.u);
    if (!p) return f;
    return Object.assign({}, f, {
      x: lerp(p.x, f.x, k), y: lerp(p.y, f.y, k),
      r: lerp(p.r, f.r, k),
      a: lerpAngle(p.a, f.a, k),
      h: lerp(p.h, f.h, k),
      sm: f.sm.map((s, i) => (p.sm[i] ? { x: lerp(p.sm[i].x, s.x, k), y: lerp(p.sm[i].y, s.y, k), r: s.r } : s)),
      sp: f.sp.map((s, i) => (p.sp[i] ? { x: lerp(p.sp[i].x, s.x, k), y: lerp(p.sp[i].y, s.y, k), r: s.r } : s)),
      sa: f.sa.map((s, i) => (p.sa[i] ? { a: lerpAngle(p.sa[i].a, s.a, k) } : s)),
    });
  });
  // 투사체: 개수가 자주 바뀌므로 같은 인덱스·종류일 때만 섞는다
  out.pr = b.pr.map((p, i) => {
    const q = a.pr[i];
    if (!q || q.k !== p.k) return p;
    return Object.assign({}, p, { x: lerp(q.x, p.x, k), y: lerp(q.y, p.y, k), a: lerpAngle(q.a, p.a, k) });
  });
  return out;
}

if (typeof window !== 'undefined') {
  window.BounceRoyalNet = Net;
  window.lerpSnapshot = lerpSnapshot;
}

/* ============================================================
 * 스냅샷 → 렌더러가 아는 형태로 변환
 *
 * render.js는 Battle 객체를 받아 그리도록 되어 있다. 서버 스냅샷을
 * 같은 모양으로 감싸면 렌더러를 고치지 않고 그대로 쓸 수 있다.
 * 이펙트·팝업은 서버가 보내지 않으므로 빈 배열로 둔다.
 * ============================================================ */
const NET_EMPTY = [];

function netArena(snap) {
  return {
    type: 'diamond',
    L: snap.L, R: 378, H: 350,
    pillars: snap.pil || NET_EMPTY,
    cube: snap.cube ? { x: snap.cube.x, y: snap.cube.y, active: true, spin: snap.cube.s } : null,
    get name() { return (typeof MAPS !== 'undefined' && MAPS.diamond) ? MAPS.diamond.name : '다이아 경기장'; },
  };
}

function netFighter(view, meta, seat) {
  const ti = view.ti || {};
  const fg = view.fg || 0;
  return {
    uid: view.u, pid: view.p, kind: 'main',
    isAI: meta ? meta.isAI : true,
    player: { id: view.p, charId: meta ? meta.charId : 'cat', color: meta ? meta.color : '#4da6ff', copiedSkill: view.cp || null },
    name: meta ? meta.name : ('P' + view.p),
    color: meta ? meta.color : '#4da6ff',
    charId: meta ? meta.charId : 'cat',
    weaponId: meta && meta.weaponId ? meta.weaponId : 'sword',
    x: view.x, y: view.y, radius: view.r,
    vx: view.vx != null ? view.vx : 1, vy: view.vy != null ? view.vy : 0,
    aimLocked: !!view.lk,
    weaponAngle: view.a,
    hp: view.h, maxHp: view.m, shield: view.s,
    dead: !!view.d, mainDead: !!view.md,
    flash: view.fl,
    gunFlash: view.gf,
    charging: view.ch ? { t: 1 } : null,
    gun: { reloadT: view.rl ? 1 : 0, focus: false },
    timers: {
      immune: ti.im || 0, untouchable: ti.un || 0, freeze: ti.fz || 0,
      actingDead: ti.ad || 0, stun: ti.st || 0, balloon: ti.ba || 0,
      rampage: ti.ra || 0, gunBarrage: ti.gb || 0,
    },
    flags: {
      giantBlade: !!(fg & 1), dualDagger: !!(fg & 2),
      dualPistol: !!(fg & 4), bayonet: !!(fg & 8),
    },
    summons: view.sm || NET_EMPTY,
    splitBalls: (view.sp || NET_EMPTY).map(s => Object.assign({ dead: false }, s)),
    satellites: view.sa || NET_EMPTY,
    skillUses: { char: (view.su||[0,0,0])[0], weapon: (view.su||[0,0,0])[1], common: (view.su||[0,0,0])[2] },
    skillMax: { char: (view.sx||[1,1,1])[0], weapon: (view.sx||[1,1,1])[1], common: (view.sx||[1,1,1])[2] },
    isMe: view.p === seat,
  };
}

/* 서버 스냅샷을 renderBattle이 받을 수 있는 객체로 감싼다 */
function netBattleView(snap, players, seat, humanAim) {
  if (!snap) return null;
  const byId = new Map((players || []).map(p => [p.id, p]));
  const fighters = snap.f.map(v => netFighter(v, byId.get(v.p), seat));
  const owner = pid => fighters.find(f => f.pid === pid) || null;
  return {
    arena: netArena(snap),
    phase: snap.ph,
    simT: snap.t,
    overtime: snap.ot != null,
    otT: snap.ot != null ? snap.ot : 0,
    shake: snap.sh,
    result: snap.res ? { winner: owner(snap.res.w), reason: snap.res.why, draw: snap.res.draw, losers: [] } : null,
    fighters,
    projectiles: (snap.pr || NET_EMPTY).map(p => ({
      kind: p.k, x: p.x, y: p.y, ang: p.a, r: p.r, owner: owner(p.o),
    })),
    mines: (snap.mn || NET_EMPTY).map(m => ({ x: m.x, y: m.y, r: m.r, arm: m.a ? 0 : 1, owner: owner(m.o) })),
    flames: (snap.fm || NET_EMPTY).map(f => ({ x: f.x, y: f.y, r: f.r, life: f.l })),
    stickies: (snap.sk || NET_EMPTY).map(s => ({ x: s.x, y: s.y, r: s.r, life: s.l })),
    fx: NET_EMPTY, particles: NET_EMPTY, popups: NET_EMPTY,
    humanAim: humanAim || null,
    human() { return fighters.find(f => f.isMe) || null; },
  };
}

if (typeof window !== 'undefined') window.netBattleView = netBattleView;
