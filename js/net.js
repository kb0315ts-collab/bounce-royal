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
const STEER_SEND_HZ = 15;            // 조향 입력 전송 상한
const STEER_SEND_INTERVAL = 1000 / STEER_SEND_HZ;
const STEER_ANGLE_EPS = 0.005;
const STEER_MAG_EPS = 0.01;

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
  localFx: [], localPopups: [], localParticles: [],   // 서버 이벤트로 만든 화면 효과
  seenFx: new Set(), seenPopups: new Set(),
  soundState: new Map(),   // 전투원 uid → 마지막으로 소리를 낸 누적 횟수
  lastSnapAt: 0,
  lastSeq: 0,               // 마지막으로 받아들인 스냅샷 순번
  handlers: {},
  queueInfo: null,
  wantQueue: false,
  serverUrl: null,
  steerActive: false,
  steerLast: null,
  steerPending: null,
  steerTimer: null,
  steerLastSentAt: 0,
  aimLastSentAt: 0,

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
        this.resetSteerState();
        this.emit('close');
        if (!settled) { settled = true; reject(new Error('서버에 연결할 수 없습니다')); }
      };
      ws.onerror = () => { /* close에서 처리한다 */ };
    });
  },

  disconnect() {
    this.wantQueue = false;
    this.clearSteer();
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
    this.clearFx();
    this.resetSteerState();
  },

  resetSteerState() {
    if (this.steerTimer != null) clearTimeout(this.steerTimer);
    this.steerTimer = null;
    this.steerPending = null;
    this.steerLast = null;
    this.steerActive = false;
    this.steerLastSentAt = 0;
    this.aimLastSentAt = 0;
  },

  clearFx() {
    this.localFx.length = 0; this.localPopups.length = 0; this.localParticles.length = 0;
    this.seenFx.clear(); this.seenPopups.clear();
    this.soundState.clear();
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
        this.roomSize = msg.roomSize;
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
        this.lastSeq = 0;
        this.clearFx();
        break;
      case 'resumed':
        this.seat = msg.id;
        this.phase = msg.phase;
        this.round = msg.round;
        if (msg.players) this.players = msg.players;
        this.buffer.length = 0;
        this.lastSeq = 0;
        break;
      case 's':
        this.pushSnapshot(msg.b, msg.q);
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
  pushSnapshot(snap, seq) {
    // 지터가 크면 나중에 보낸 스냅샷이 먼저 도착하기도 한다. 그대로 버퍼에 넣으면
    // 시간이 되감겨 화살이 뒤로 튄다. 순번이 밀린 것은 보간에 쓰지 않는다.
    // 다만 타격 연출은 그 스냅샷에만 실려 있을 수 있으므로 재생은 시킨다.
    const stale = seq != null && seq <= this.lastSeq;
    if (seq != null && !stale) this.lastSeq = seq;
    if (!stale) {
      const at = performance.now();
      this.buffer.push({ at, snap });
      while (this.buffer.length > SNAP_BUFFER) this.buffer.shift();
      this.lastSnapAt = at;
    }
    this.spawnFx(snap);
    if (!stale) this.emit('snapshot', snap);
  },

  /* 서버가 보낸 타격 효과 중 처음 보는 것만 클라이언트에서 한 번 재생한다.
   * 재생 자체는 로컬 타이밍으로 돌아가므로 20Hz 스냅샷과 무관하게 부드럽다. */
  spawnFx(snap) {
    for (const p of snap.px || []) {
      if (this.seenPopups.has(p.u)) continue;
      this.seenPopups.add(p.u);
      this.localPopups.push({ x: p.x, y: p.y, txt: p.s, color: p.c, big: !!p.b, t: 0.9 });
      if (/^[0-9]+$/.test(p.s)) {          // 피해 숫자면 불꽃과 타격음
        this.burst(p.x, p.y, 4, '#ffb0b0', 130);
        if (typeof SFX !== 'undefined' && SFX.hit) SFX.hit();
      }
    }
    for (const e of snap.fx || []) {
      if (this.seenFx.has(e.u)) continue;
      this.seenFx.add(e.u);
      if (e.k === 'r') {
        this.localFx.push({ type: 'ring', x: e.x, y: e.y, r0: e.a, r1: e.b, color: e.c, dur: e.d, t: 0 });
        // m=1은 explodeFx가 만든 폭발 고리다. 폭발음은 여기서만 낸다.
        // 예전처럼 반경 차이로 짐작하면 큐브 획득 같은 큰 고리에도 폭발음이 났고,
        // 반대로 작은 폭발(반경 56 이하)은 소리가 나지 않았다.
        if (e.m) { this.burst(e.x, e.y, 10, e.c, 240); if (typeof SFX !== 'undefined' && SFX.boom) SFX.boom(); }
        else if (e.b - e.a > 45) this.burst(e.x, e.y, 10, e.c, 240);
      } else {
        this.localFx.push({ type: 'bolt', segs: e.g.map(s => ({ x: s[0], y: s[1] })), color: e.c, dur: e.d, t: 0 });
      }
    }
    this.replaySounds(snap);
    if (this.seenPopups.size > 4000) this.seenPopups.clear();
    if (this.seenFx.size > 4000) this.seenFx.clear();
  },

  /* 벽 튕김과 스킬 발동 소리.
   * 이 둘은 sim.js가 직접 내는 소리인데, 멀티에서는 sim이 서버에서 도는 탓에
   * 아무 소리도 나지 않았다. 서버가 누적 횟수를 실어 보내면 클라이언트가
   * 늘어난 만큼 재생한다. 스냅샷을 놓쳐 여러 번이 몰릴 수 있으므로 2회로 자른다. */
  replaySounds(snap) {
    const has = typeof SFX !== 'undefined';
    for (const f of snap.f || NET_EMPTY) {
      const prev = this.soundState.get(f.u);
      const bc = f.bc || 0, sc = f.sc || 0;
      if (prev) {
        const nb = Math.min(2, bc - prev.bc);
        for (let i = 0; i < nb; i++) if (has && SFX.bounce) SFX.bounce();
        const ns = Math.min(3, sc - prev.sc);   // 한 전투원이 세 슬롯을 연달아 쓸 수 있다
        for (let i = 0; i < ns; i++) if (has && SFX.skill) SFX.skill();
      }
      // 순서가 뒤바뀐 스냅샷이 기준을 되돌려 같은 소리를 두 번 내지 않게 한다
      this.soundState.set(f.u, { bc: Math.max(prev ? prev.bc : 0, bc), sc: Math.max(prev ? prev.sc : 0, sc) });
    }
  },

  burst(x, y, n, color, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.6);
      this.localParticles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0,
        life: 0.25 + Math.random() * 0.3, color, size: 1.5 + Math.random() * 2 });
    }
    if (this.localParticles.length > 300) this.localParticles.splice(0, this.localParticles.length - 300);
  },

  /* 로컬 효과의 시간을 매 프레임 진행시킨다 (Battle.updateFx와 같은 규칙) */
  advanceFx(dt) {
    for (const p of this.localPopups) { p.t -= dt; p.y -= 34 * dt; }
    this.localPopups = this.localPopups.filter(p => p.t > 0);
    for (const e of this.localFx) e.t += dt;
    this.localFx = this.localFx.filter(e => e.t < (e.dur || 0.5));
    for (const p of this.localParticles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    this.localParticles = this.localParticles.filter(p => p.t < p.life);
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
    return lerpSnapshot(a.snap, b.snap, k, span);
  },

  /* ---------------- 입력 ---------------- */
  queue() { this.wantQueue = true; this.send({ t: 'queue' }); },
  leaveQueue() { this.wantQueue = false; this.send({ t: 'leave' }); },
  createRoom() { this.send({ t: 'createRoom' }); },
  joinRoom(code) { this.send({ t: 'joinRoom', code: String(code || '').toUpperCase() }); },
  startRoom() { this.send({ t: 'startRoom' }); },
  leaveRoom() { this.send({ t: 'leaveRoom' }); },
  pickWeapon(id) { this.send({ t: 'weapon', id }); },
  /* 출발 방향. 조향과 같은 상한(15Hz)으로 흘려보낸다. 확정 패킷은
   * 없앴다 — 마지막으로 가리킨 방향이 곧 출발 방향이다. */
  aim(ang) {
    if (typeof ang !== 'number' || !Number.isFinite(ang)) return false;
    const now = Date.now();
    if (now - this.aimLastSentAt < STEER_SEND_INTERVAL) return false;
    this.aimLastSentAt = now;
    return this.send({ t: 'aim', ang: Math.atan2(Math.sin(ang), Math.cos(ang)) });
  },
  /* 포인터의 60Hz 입력을 그대로 보내지 않는다. 바뀐 최신 값만 최대 15Hz로
   * 보내되, 손을 놓는 패킷은 즉시 보내 잔류 조향을 막는다. */
  steer(angle, magnitude, active = true) {
    if (active !== true) return this.clearSteer();
    if (typeof angle !== 'number' || !Number.isFinite(angle)
      || typeof magnitude !== 'number' || !Number.isFinite(magnitude)) return false;
    const payload = {
      active: true,
      angle: Math.atan2(Math.sin(angle), Math.cos(angle)),
      magnitude: Math.max(0, Math.min(1, magnitude)),
    };
    const basis = this.steerPending || this.steerLast;
    const angleDiff = basis
      ? Math.abs(Math.atan2(Math.sin(payload.angle - basis.angle), Math.cos(payload.angle - basis.angle)))
      : Infinity;
    if (basis && basis.active && angleDiff < STEER_ANGLE_EPS
      && Math.abs(payload.magnitude - basis.magnitude) < STEER_MAG_EPS) return false;

    this.steerActive = true;
    const wait = STEER_SEND_INTERVAL - (Date.now() - this.steerLastSentAt);
    if (wait <= 0 || !this.steerLast) {
      if (this.steerTimer != null) clearTimeout(this.steerTimer);
      this.steerTimer = null;
      this.steerPending = null;
      return this.sendSteerPayload(payload);
    }

    this.steerPending = payload;
    if (this.steerTimer == null) {
      this.steerTimer = setTimeout(() => {
        this.steerTimer = null;
        const pending = this.steerPending;
        this.steerPending = null;
        if (pending && this.steerActive) this.sendSteerPayload(pending);
      }, Math.max(0, wait));
    }
    return true;
  },
  sendSteerPayload(payload) {
    const sent = this.send({
      t: 'steer', active: !!payload.active,
      angle: payload.angle, magnitude: payload.magnitude,
    });
    if (sent) {
      this.steerLast = payload;
      this.steerLastSentAt = Date.now();
    }
    return sent;
  },
  clearSteer() {
    if (this.steerTimer != null) clearTimeout(this.steerTimer);
    this.steerTimer = null;
    this.steerPending = null;
    const shouldSend = this.steerActive || !!(this.steerLast && this.steerLast.active);
    this.steerActive = false;
    if (!shouldSend) return false;
    const sent = this.send({ t: 'steer', active: false });
    this.steerLast = { active: false, angle: 0, magnitude: 0 };
    this.steerLastSentAt = Date.now();
    return sent;
  },
  skill(slot) { this.send({ t: 'skill', slot }); },
  spectate(i) { this.send({ t: 'spectate', i }); },
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

/* uid로 짝지어 위치만 섞는다. 짝이 없으면(새로 생긴 것) 최신 값을 그대로 쓴다. */
function lerpById(prevList, nextList, k, jump) {
  if (!prevList || !prevList.length) return nextList;
  const prev = new Map(prevList.map(s => [s.u, s]));
  return nextList.map(s => {
    const q = prev.get(s.u);
    if (!q) return s;
    if (jump && Math.hypot(s.x - q.x, s.y - q.y) > jump) return s;
    return Object.assign({}, s, { x: lerp(q.x, s.x, k), y: lerp(q.y, s.y, k) });
  });
}

/* 두 스냅샷 사이에 물리적으로 가능한 최대 이동거리(px).
 * 이보다 멀리 움직였다면 순간이동(고양이 되돌아가기 등)이므로 섞지 않고
 * 목적지를 그대로 그린다. 안 그러면 경기장을 가로질러 미끄러지는 것처럼 보인다.
 *
 * spanMs는 두 스냅샷이 실제로 도착한 시간 간격이다. 스냅샷의 simT는 소수
 * 1자리로 반올림되어 20Hz(0.05초 간격)에서는 차이가 0이 되기도 하므로
 * 시간 근거로 쓸 수 없다. 호출자가 실제 간격을 넘겨준다.
 * 1600 = 로켓 스타트(760px/s) × 연장전 2배속에 여유를 더한 값. */
const SNAP_INTERVAL_MS = 50;   // 서버 기본 전송 간격
function maxTravel(spanMs) {
  return 1600 * Math.max(0, spanMs) / 1000 + 24;
}

function lerpSnapshot(a, b, k, spanMs) {
  if (!a || !b) return b || a;
  const out = Object.assign({}, b);
  out.t = lerp(a.t, b.t, k);
  out.sh = lerp(a.sh, b.sh, k);
  const jump = maxTravel(spanMs > 0 ? spanMs : SNAP_INTERVAL_MS);
  // 전투원: 같은 uid끼리만 섞는다
  const prev = new Map(a.f.map(f => [f.u, f]));
  out.f = b.f.map(f => {
    const p = prev.get(f.u);
    if (!p) return f;
    if (Math.hypot(f.x - p.x, f.y - p.y) > jump) return f;   // 순간이동은 그대로 스냅
    return Object.assign({}, f, {
      x: lerp(p.x, f.x, k), y: lerp(p.y, f.y, k),
      // 반지름은 섞지 않는다. 전투 중 크기는 풍선 스킬(1.6배)처럼 계단식으로만
      // 바뀌므로, 섞으면 즉발이어야 할 스킬 발동이 50ms 램프로 뭉개진다.
      a: lerpAngle(p.a, f.a, k),
      h: lerp(p.h, f.h, k),
      // 소환수·분열체는 uid로 짝짓는다 (죽으면 배열이 밀리기 때문).
      // 위성체는 전투 중 개수가 변하지 않아 인덱스가 곧 고유 식별자다.
      sm: lerpById(p.sm, f.sm, k, jump),
      sp: lerpById(p.sp, f.sp, k, jump),
      sa: f.sa.map((s, i) => (p.sa[i] ? { a: lerpAngle(p.sa[i].a, s.a, k) } : s)),
    });
  });
  // 투사체는 반드시 uid로 맞춘다. 인덱스로 맞추면 하나가 사라질 때 배열이
  // 밀려서 서로 다른 투사체 사이를 보간하게 되고, 화살이 꺾이거나
  // 순간이동하는 것처럼 보인다.
  const prevProj = new Map(a.pr.map(p => [p.u, p]));
  out.pr = b.pr.map(p => {
    const q = prevProj.get(p.u);
    if (!q) return p;
    if (Math.hypot(p.x - q.x, p.y - q.y) > jump) return p;
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
  const pillars = snap.pil || NET_EMPTY;
  const cube = snap.cube ? { x: snap.cube.x, y: snap.cube.y, active: true, spin: snap.cube.s } : null;
  // 렌더러의 조준 예측선은 arena.castRay()를 부른다. 메서드 없는 평범한 객체를
  // 넘기면 조준 드래그를 시작하는 순간 그리기 루프가 통째로 죽는다.
  // sim.js의 Arena를 그대로 써야 예측선 기하도 로컬과 같아진다.
  if (typeof Arena === 'function') {
    const a = new Arena('diamond');
    a.L = snap.L;
    a.pillars = pillars;
    a.cube = cube;
    return a;
  }
  // sim.js가 없는 환경(Node 테스트)용 최소 형태
  return {
    type: 'diamond',
    L: snap.L, R: 378, H: 350,
    pillars, cube,
    castRay() { return null; },
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
    charging: view.ch ? { t: view.ch } : null,
    gun: { reloadT: view.rl ? 1 : 0, focus: false },
    // 스탯판이 읽는 값. 서버가 계산한 것을 그대로 받는다.
    st: { atk: (view.st || [1, 1, 1, 0])[0], dmg: (view.st || [1, 1, 1, 0])[1],
      aspd: (view.st || [1, 1, 1, 0])[2], rot: (view.st || [1, 1, 1, 0])[3] },
    timers: {
      immune: ti.im || 0, untouchable: ti.un || 0, freeze: ti.fz || 0,
      actingDead: ti.ad || 0, stun: ti.st || 0, balloon: ti.ba || 0,
      rampage: ti.ra || 0, gunBarrage: ti.gb || 0,
    },
    flags: {
      giantBlade: !!(fg & 1), dualDagger: !!(fg & 2),
      dualPistol: !!(fg & 4), bayonet: !!(fg & 8),
    },
    // 스냅샷은 h/m으로 싣고 렌더러는 hp/maxHp를 읽는다 (소환수 체력바)
    summons: (view.sm || NET_EMPTY).map(s => ({ u: s.u, x: s.x, y: s.y, r: s.r, hp: s.h, maxHp: s.m })),
    splitBalls: (view.sp || NET_EMPTY).map(s => ({ dead: false, x: s.x, y: s.y, r: s.r, flash: s.fl || 0 })),
    // 스냅샷은 각도를 a로 싣지만 렌더러는 ang을 읽는다. 여기서 이름을 맞춰야
    // 위성 증강(satellite / satellitePlus)이 화면에 나온다.
    satellites: (view.sa || NET_EMPTY).map(s => ({ ang: s.a })),
    skillUses: { char: (view.su||[0,0,0])[0], weapon: (view.su||[0,0,0])[1], common: (view.su||[0,0,0])[2] },
    skillMax: { char: (view.sx||[1,1,1])[0], weapon: (view.sx||[1,1,1])[1], common: (view.sx||[1,1,1])[2] },
    isMe: view.p === seat,
  };
}

/* 서버 스냅샷을 renderBattle이 받을 수 있는 객체로 감싼다 */
function netBattleView(snap, players, seat) {
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
    fx: Net.localFx, particles: Net.localParticles, popups: Net.localPopups,
    human() { return fighters.find(f => f.isMe) || null; },
  };
}

if (typeof window !== 'undefined') window.netBattleView = netBattleView;
// Node 테스트에서 순수 함수만 꺼내 쓸 수 있게 한다 (브라우저에는 영향 없음)
if (typeof module === 'object' && module.exports) module.exports = { Net, lerpSnapshot, netBattleView };
