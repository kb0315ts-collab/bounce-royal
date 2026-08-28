# 배포 가이드

이 문서는 **이 프로젝트를 이어받는 사람(또는 코딩 에이전트)** 이 배포를 그대로
이어서 할 수 있도록 쓴 것이다. 읽고 나면 추가 조사 없이 배포할 수 있어야 한다.

---

## 1. 이 사이트의 성격

| 항목 | 내용 |
|---|---|
| 종류 | **순수 정적 사이트** |
| 빌드 과정 | **없음** — 트랜스파일·번들러·전처리기 전부 없음 |
| 실행 조건 | `index.html`을 열기만 하면 동작 (로컬 파일로도 실행됨) |
| 런타임 의존성 | `vendor/phaser.min.js` **하나뿐이며 저장소에 커밋되어 있다** |
| 총 용량 | 약 11MB (`assets/` 영상 8.7MB + Phaser 1.4MB + 코드 0.3MB) |
| 경로 | 전부 상대경로 — 하위 경로(`/저장소이름/`)에 올려도 정상 동작 |

> **중요**: `npm install`은 배포에 **필요 없다**. `node_modules/`는 `.gitignore`에
> 들어 있고, Phaser는 이미 `vendor/`에 복사되어 커밋되어 있다.
> `package.json`은 Phaser 버전을 기록해 두기 위한 용도다.

---

## 2. 배포 방식: GitHub Pages (브랜치 방식)

```
main 브랜치에 push  →  GitHub Pages가 자동으로 다시 배포  →  1~2분 뒤 반영
```

별도의 CI 설정이나 워크플로 파일이 없다. **push가 곧 배포다.**

### 최초 1회 설정 (사람이 직접 해야 함)

1. GitHub에서 저장소 생성 (**Public** — 무료 플랜은 Public이어야 Pages 사용 가능)
2. 로컬에 원격 연결 후 첫 push
   ```bash
   git remote add origin https://github.com/<아이디>/<저장소>.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages** 에서
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `/ (root)`
   - Save
4. 1~2분 뒤 `https://<아이디>.github.io/<저장소>/` 접속 확인

### 이후 업데이트

```bash
git push
```

이게 전부다. Pages가 자동으로 다시 빌드한다.

---

## 3. 에이전트를 위한 작업 규칙

### 3.1 push 전에 확인받을 것

배포는 **외부에 공개되는 동작**이다. 사용자가 "앞으로 매번 묻지 말고 배포해라"라고
명시적으로 말하지 않았다면, **push 직전에 한 번 확인**을 받는다.

### 3.2 push 전에 반드시 테스트를 통과시킬 것

```bash
node tests/sim.test.js
node tests/matchmaking.test.js
node tests/events.test.js
node tests/round-flow.test.js
```

전부 통과해야 한다. 테스트는 렌더러(`js/render.js`)를 로드하지 않으므로,
**렌더링·UI 변경은 테스트로 잡히지 않는다.** 그런 변경은 브라우저에서 직접 확인한다.

### 3.3 브라우저 확인 방법

빌드가 없으므로 정적 서버만 있으면 된다.

```bash
npx serve .
```

또는 `python -m http.server`. `index.html`을 파일로 직접 열어도 대부분 동작하지만,
**클립보드 복사와 진동은 HTTPS 또는 localhost에서만** 동작한다.

### 3.4 커밋에 절대 넣지 말 것

- `node_modules/` — 이미 `.gitignore`에 있음
- 스크래치 파일, 실험용 스크립트, 측정 결과물

### 3.5 반드시 커밋되어 있어야 할 것

- `vendor/phaser.min.js` — 빌드가 없으므로 이 파일이 곧 런타임이다.
  실수로 지우면 사이트가 백지가 된다.
- `.nojekyll` — GitHub Pages의 Jekyll 처리를 끈다. 지우지 말 것.
- `assets/title-demos/*.mp4` — 타이틀 배경 영상. 없으면 실시간 데모로 폴백되지만
  의도한 화면이 아니다.

---

## 4. Phaser 버전을 올릴 때

`vendor/phaser.min.js`는 손으로 갱신한다.

```bash
npm install phaser@<버전>
cp node_modules/phaser/dist/phaser.min.js vendor/phaser.min.js
```

그다음 브라우저에서 전투 화면이 정상인지 확인하고 커밋한다.
렌더러는 Phaser 4 API에 맞춰 작성되어 있다 (`Graphics`, `enableFilters`,
`filters.internal.addGlow`). 메이저 버전을 올릴 때는 이 API들을 먼저 확인할 것.

---

## 5. 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| 404 페이지 | Pages 설정이 안 됐거나 브랜치가 다름. Settings → Pages 확인 |
| 화면이 백지 | `vendor/phaser.min.js`가 없거나 경로가 틀림. 브라우저 콘솔 확인 |
| 옛 버전이 계속 보임 | 브라우저 캐시. 강력 새로고침(Ctrl+Shift+R) 또는 시크릿 창 |
| push는 됐는데 반영 안 됨 | 저장소 **Actions** 탭에서 `pages build and deployment` 진행 상태 확인. 보통 1~2분 |
| 영상이 안 나옴 | `assets/` 폴더가 커밋됐는지 확인. Git LFS는 쓰지 않는다 |
| 소리·진동이 안 됨 | HTTPS가 아닌 환경. Pages는 기본 HTTPS이므로 로컬 확인 시에만 발생 |

---

## 6. 싱글과 멀티의 관계

- **정적 호스팅(Pages)만으로는 싱글플레이만 된다.** 로컬 sim으로 AI 3명과 싸운다.
- **멀티플레이는 WebSocket 서버가 필요하다.** 8절 참고.
- 두 모드는 코드가 갈려 있다. `Game.mode`가 `'multi'`면 `Game.update`가
  로컬 sim을 **아예 돌리지 않고** 서버 스냅샷만 그린다. 싱글 경로는 그대로다.
  멀티에서 전투 판정·라운드 진행·승패는 전부 서버가 결정한다.
- 클라이언트가 서버로 보내는 것은 입력뿐이다 — 무기·조준·스킬·방향 전환·증강·투표.
- `tests/`, `tools/`, `package.json`도 같이 배포되지만 사이트 동작에는 무관하다.

---

## 7. 대안: GitHub Actions 방식이 필요해질 때

다음 중 하나가 필요해지면 브랜치 방식 대신 워크플로를 도입한다.

- 배포 대상에서 특정 폴더를 제외하고 싶을 때
- 배포 전에 테스트를 강제로 돌리고 싶을 때
- 빌드 과정이 생겼을 때

그때는 `.github/workflows/` 에 워크플로를 만들고 Settings → Pages의 Source를
`GitHub Actions`로 바꾼다. **지금은 필요 없다** — 빌드가 없어서 브랜치 방식이
가장 단순하고 고장날 여지가 적다.

---

## 8. 멀티플레이 서버 배포

정적 사이트(GitHub Pages)만으로는 멀티플레이가 불가능하다. WebSocket 서버를
돌릴 호스팅이 따로 필요하다.

### 8.1 구성 선택

**구성 A — 서버 하나에 전부 (권장, 설정 없음)**

`server/index.js`가 게임 파일까지 함께 서빙한다. 서버 하나만 올리면 끝이고
클라이언트와 WebSocket이 같은 출처라 설정할 것이 없다.

```
https://<서비스>.onrender.com        ← 게임 + 멀티플레이 둘 다
```

- 장점: `js/config.js`를 비워두면 자동으로 붙는다. CORS·mixed content 문제 없음
- 단점: 무료 플랜은 15분 미사용 시 잠들어 첫 접속이 30~50초 걸린다

**구성 B — Pages + 서버 분리**

클라이언트는 GitHub Pages(항상 켜짐, 빠름), WebSocket만 서버로 보낸다.

```
https://<아이디>.github.io/bounce-royal/   ← 게임 (싱글은 즉시 플레이 가능)
wss://<서비스>.onrender.com                ← 멀티플레이만
```

이때 `js/config.js`에 서버 주소를 반드시 적어야 한다.

```js
window.BOUNCE_SERVER = 'wss://bounce-royal.onrender.com';
```

> **https 페이지에서는 반드시 `wss://`** 여야 한다. `ws://`는 브라우저가
> mixed content로 차단한다.

### 8.2 Render 배포 절차

저장소에 `render.yaml`이 있어 대부분 자동으로 잡힌다.

1. https://render.com 가입 후 **New → Blueprint**
2. 이 저장소를 선택하면 `render.yaml`을 읽어 설정을 채운다
3. 배포되면 `https://<이름>.onrender.com` 주소가 나온다
4. `/healthz`로 확인한다 — `{"ok":true,"rooms":0,"queued":0}`가 나오면 정상

Blueprint를 쓰지 않고 수동으로 만들 때의 설정값:

| 항목 | 값 |
|---|---|
| Runtime | Node |
| Root Directory | **비워둘 것** |
| Build Command | `npm install --prefix server` |
| Start Command | `node server/index.js` |
| Health Check Path | `/healthz` |

> **Root Directory를 `server`로 지정하면 안 된다.** Render는 Root Directory를
> 빌드 필터로도 쓰기 때문에, `server/` 밖에 있는 클라이언트 파일
> (`index.html`, `js/`)만 고친 커밋이 재배포되지 않는다. 서버가 그 파일들을
> 서빙하므로 저장소 전체를 감시해야 한다.

### 8.3 환경변수

| 이름 | 기본 | 설명 |
|---|---|---|
| `PORT` | 8080 | 호스팅이 자동으로 주입한다. 건드리지 말 것 |
| `SEARCH_SECONDS` | 10 | 대기열에서 사람을 기다리는 시간 |
| `FILL_WITH_AI` | 1 | 0이면 사람 4명이 모일 때까지 시작하지 않는다 |
| `FORCE_EVENT` | 없음 | **테스트 전용.** 특정 이벤트를 강제한다(예: `nextFfa`). 운영에서는 절대 설정하지 말 것 |

### 8.4 무료 플랜에서 알아둘 것

- **잠듦**: 15분간 접속이 없으면 인스턴스가 내려간다. 다음 접속자가 30~50초 기다린다.
  친구들과 약속하고 테스트할 때는 먼저 한 명이 열어 깨워두면 된다
- **잠들면 방이 사라진다**: 진행 중이던 매치는 유지되지 않는다
- **재접속 유예 90초**: 이보다 오래 끊기면 자리가 AI로 확정된다

### 8.5 배포 후 확인

```bash
curl https://<서비스>.onrender.com/healthz
```

그다음 브라우저 두 창에서 접속해 **🌐 온라인 대전**을 눌러 서로 매칭되는지 본다.
`SEARCH_SECONDS` 안에 4명이 모이지 않으면 남은 자리는 AI로 채워진다.

### 8.6 서버 코드 수정 시

`main` 브랜치에 push하면 Render가 자동으로 다시 배포한다(GitHub Pages와 동일).
서버가 재시작되므로 **진행 중이던 방은 전부 종료된다.** 사람이 붙어 있을 때는
피하는 게 좋다.
