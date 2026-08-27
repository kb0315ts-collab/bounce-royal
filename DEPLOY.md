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

## 6. 현재 배포되지 않는 것 (알아둘 것)

- **멀티플레이는 없다.** 링크를 받은 사람은 각자 AI 3명과 싸운다.
  코드에 네트워크 호출이 하나도 없고(`fetch`/`WebSocket` 0건), 친선전의
  `BR-XXXX` 방 코드는 로컬에서 생성만 될 뿐 뒤에 서버가 없다.
  `window.BounceRoyalRoom`은 나중에 네트워크를 붙이기 위한 빈 어댑터다.
- `tests/`, `tools/`, `package.json`도 같이 배포되지만 사이트 동작에는 무관하다.
  제외하고 싶다면 GitHub Actions 워크플로로 바꿔 특정 폴더만 올리면 된다.

---

## 7. 대안: GitHub Actions 방식이 필요해질 때

다음 중 하나가 필요해지면 브랜치 방식 대신 워크플로를 도입한다.

- 배포 대상에서 특정 폴더를 제외하고 싶을 때
- 배포 전에 테스트를 강제로 돌리고 싶을 때
- 빌드 과정이 생겼을 때

그때는 `.github/workflows/` 에 워크플로를 만들고 Settings → Pages의 Source를
`GitHub Actions`로 바꾼다. **지금은 필요 없다** — 빌드가 없어서 브랜치 방식이
가장 단순하고 고장날 여지가 적다.
