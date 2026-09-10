# 효과음 출처

여기 있는 mp3는 **Kenney** (https://kenney.nl) 의 CC0 팩에서 골라 왔다.

**CC0(퍼블릭 도메인)이라 저작자 표기 의무는 없다.** 이 파일은 의무가 아니라
나중에 "이 소리 어디서 왔더라"를 찾기 위한 기록이다.

| 파일 | 원본 | 쓰이는 곳 |
|---|---|---|
| fire-bow.mp3 | impact-sounds / footstep_wood_000 | 활 발사 |
| fire-pistol.mp3 | ui-audio / click2 | 이전 버전 권총 발사 비교 |
| fire-shotgun.mp3 | impact-sounds / footstep_carpet_001 | 이전 버전 샷건 비교 |

원본은 .ogg 다. 사파리(아이폰)가 ogg를 못 여는 경우가 있어 mp3(모노 44.1kHz
96kbps)로 바꿔 넣었다. 세 개 합쳐 8KB다.

지팡이도 파일(interface-sounds / drop_002)을 썼었지만 너무 경쾌해서 뺐다.
지금은 공유 사운드 뱅크의 `weapon.staff.fire`가 마력의 울림을 합성한다.

## 녹음 소재로 만든 무기 질감

아래 소재의 제작·녹음자는 **Ben Jaszczak & Brian Nelson / Still North Media**다.
직접 녹음한 소리라고 주장하지 않는다. 공개된 녹음을 게임용으로 편집하고
시위 공명·칼바람 등 필요한 레이어를 디자인했다.

- 원본 및 CC0 표기: [Medieval sound effects – Weapon Textures](https://opengameart.org/content/medieval-sound-effects-weapon-textures)
- 라이선스: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- 받은 파일: `medieval_sfx_textures_1_of_2.7z` (게임에 포함하지 않음)

| 게임 파일 (`foley/`) | 원본 녹음 | 추출 구간(초) | 사용 |
|---|---|---|---|
| bow-draw.wav | English Longbow Draw.wav | 0.04–1.38 | 새 장력음의 배경 소재·이전 버전 비교 |
| bow-release.wav | English Longbow Shoot.wav | 0.065–0.49 | 새 시위 발사음의 접촉 소재·이전 버전 비교 |
| bow-release-alt.wav | English Longbow Shoot.wav | 1.20–1.63 | 발사 변주 |
| blade-air.wav | Katana Swing.wav | 0.31–0.72 | 단검 돌진·믹서기 풍절 |
| blade-scrape.wav | Katana Sheath Fast.wav | 2.42–2.88 | 단검 준비·돌진 칼끝 마찰 |
| blade-scrape-alt.wav | Katana Sheath Fast.wav | 5.51–5.98 | 마찰 변주 |
| mechanism.wav | Crossbow Lever Trigger.wav | 0.66–1.55 | 재장전·잠금 기구 질감 |
| arrow-pass.wav | Scythian Recurve Arrow Passby.wav | 0.69–1.66 | 되돌아가기의 역방향 바람 |

원본 192kHz/24bit를 구간 추출하고, windowed-sinc 저역 통과 리샘플링,
95Hz 하이패스, 짧은 시작·끝 페이드, 피크 0.72 정규화를 거쳐
모노 32kHz/16bit WAV로 저장했다. 8개 합계 **345,632바이트**다.
재현 스크립트: `node tools/prepare-foley.js <압축 해제 폴더> --build`.

## 511fb88까지의 공유 사운드 뱅크 (비교용 보관)

기존 게임과 사운드룸은 `js/audio.js`의 같은 효과음 정의를 사용했다.
리뉴얼 직전의 음색은 `js/audio-design-previous.js`에 보관한다. 기존 MP3 세 개는 **추가 합성 레이어 없이**
보존했고, 검·단검·표창·미사일·검기·지팡이 등은 `878ceab`의 필터 이동,
Q, 길이, 어택을 기준으로 복원했다. 마스터 믹싱/피크 보호는 공통으로 유지된다.
나머지는 위의 폴리 녹음과 전용 리듬·공명·필터 곡선을 조합한다.
외부 생성형 오디오 서비스는 사용하지 않는다.

- 차지 샷은 충전과 관통 발사, 단검은 준비와 돌진을 따로 디자인했다.
- 검기·미사일·표창은 원래 휘릭거리는 필터 궤적을 유지한다.
- 캐릭터 스킬의 발동/종료, 증강 공격, 재장전, 추첨에도 전용 소리를 사용한다.
- 잦은 피격·벽 반사는 작고 짧게, 중요한 스킬은 더 넓고 선명하게 구성했다.
- 동시 재생은 기본 16개이며, 중요도가 낮은 소리부터 제한한다.
- 전체 음량·압축기·피크 보호·동일 효과음 간격 제한을 공유하고, 화면 이탈 시 중지한다.
- 사운드룸의 **이전 버전**은 `js/audio-design-previous.js`에 정확히 보관한 `511fb88`의 실제 음색이다. 비교만 가능하며 게임 설정을 바꾸지 않는다.

## 동작별 효과음 재설계

`node tools/design-action-foley.js`로 기존 CC0 소재와 직접 작성한 신호처리를
오프라인 합성한다. 이것들은 녹음 소재를 가공하고 물성 표현을 더한 효과음이다.
새로 현장에서 녹음했거나 실물의 소리를 그대로 들려준다는 뜻은 아니다.
재현 확인: `node tools/design-action-foley.js --check`.

| 파일 (`foley/`) | 길이 | 구성 |
|---|---:|---|
| action-bow-draw.wav | 1.680초 | 불규칙한 줄 마찰·장력 진동 + 낮춘 장궁 녹음 질감 |
| action-bow-release.wav | 0.580초 | 시위 녹음의 접촉 + 감쇠하는 줄 배음 + 화살 통과 |
| action-mine-place.wav | 0.340초 | 케이스 바닥 접촉 + 기계 잠금쇠 두 동작 |
| action-dagger-dash.wav | 0.380초 | 칼바람 가속·통과 + 짧은 칼끝 마찰 |
| action-sword-spin.wav | 1.040초 | 0.5초 주기의 두 회전, 가까운 날·먼 바람의 차이 |
| action-barrage-start.wav | 0.240초 | 금속 걸쇠 해제 |
| action-barrage-shot.wav | 0.125초 | 짧은 격발 파열 + 약실 공명 + 복귀 장치 |
| action-barrage-preview.wav | 1.580초 | 사운드룸 전용, 기본 간격 0.12초의 1.5초 연사 |
| action-fall.wav | 0.620초 | 탄성 있는 공의 붕괴·짧은 공기 배출·작은 후속 접촉 |

9개 파일 합계 **421,836바이트**. 32kHz 모노 16bit PCM이며 스마트폰에서
재생 시 추가 물리 합성 연산을 하지 않는다. 새 파일들은 공통 압축기와 피크 보호를
통과하며, 이전 검·표창·미사일 등 승인된 소리는 그대로다.

게임의 회전 난사는 발사 이벤트가 올 때에만 한 발씩 재생한다. 연사 시연 파일은
게임 재생 경로에서 사용하지 않으므로 기절하거나 전투가 끝난 뒤 가짜 총성이 남지 않는다.
화염흔적·꼬마볼 소환·무기강탈·빙결지뢰는 전용 소리 없이 기존 효과만 적용한다.
일반 지뢰 폭발음과 냉기 증강의 첫 적중음은 유지한다.

`tools/audio-check.html`은 브라우저의 OfflineAudioContext로 실제 합성 결과를
렌더링해 무음·비정상 값·클리핑과 16개 동시 재생을 점검한다.
이 수치 검증이 주관적인 음질 평가를 대체하지는 않는다.

## 소리를 바꾸고 싶으면

`js/audio-design.js`의 음색 정의를 바꾸면 게임과 `sound-lab.html`의 게임 적용음에
함께 반영된다. `js/audio-design-previous.js`는 업데이트 전 비교용으로 보관한다.
`tone`은 공명, `noise`는 마찰·공기·파열, `sample`은 녹음 레이어다.
`filterPath`/`freqPath`/`gainPath`는 시간에 따른 재질·장력·리듬의 변화를 표현한다.
전투 재생 시점은 `js/sim.js`의 `battleSound` 호출에서 정하며,
서버 스냅샷을 거쳐 실제 보고 있는 전투의 렌더러에서만 재생한다.

## 캐주얼 리뉴얼

현재 `js/audio-design.js`는 짧은 재질 어택, 탄성 있는 캐릭터,
밝은 장난감 악기와 보상 신호를 중심으로 다시 구성했다.
검·단검·표창·미사일·검기의 승인된 필터 궤적과 길이는 그대로 유지했다.
일반 활의 기존 단일 샘플도 보존했다. 새 소리는 같은 알림음을 반복하지 않고
금속·시위·고무·가스·전기·유리·나무 재질과 리듬을 구분한다.

새 PCM은 `node tools/design-casual-audio.js`로 재생성하며,
`node tools/design-casual-audio.js --check`로 결과가 같은지 검증한다.
기존에 출처를 밝힌 CC0 폴리와 직접 작성한 물성 합성을 편집한 효과음이다.
새 현장 녹음이나 다른 게임에서 추출한 오디오는 사용하지 않았다.

| 파일 (`casual/`) | 길이 | 구성 |
|---|---:|---|
| bow-draw.wav | 1.220초 | 기존 줄 마찰·장궁 소재를 짧은 두 당김으로 편집 |
| bow-release.wav | 0.370초 | 시위 접촉 + 감쇠하는 줄 배음 + 빠른 화살 바람 |
| pistol.wav | 0.110초 | 짧은 공기 파열 + 속 빈 약실 공명 + 금속 복귀 |
| shotgun.wav | 0.240초 | 넓은 파열 + 짧은 저음 + 금속 잠금 |
| mine-place.wav | 0.230초 | 가벼운 케이스 접촉 + 두 잠금쇠 |
| dagger-dash.wav | 0.280초 | 빠른 칼바람 + 칼끝 마찰 |
| fall.wav | 0.350초 | 짧은 공 붕괴 + 공기 배출 + 작은 후속 접촉 |
| barrage-preview.wav | 1.560초 | 사운드룸 전용 기본 연사, 실제 전투에서는 사용하지 않음 |

8개 합계 **279,392바이트**. 모두 모노 32kHz/16bit WAV이며
개별 PCM 피크는 0.68 이하로 조절했다. UI·캐릭터 등 짧은 합성 효과음은
최대 8개 소스로 재생한다. 기존 전체 음량, 동시 재생 제한, 압축기,
피크 보호와 효과음 간격은 변경하지 않았다.

화염흔적·꼬마볼 소환·무기강탈·빙결지뢰의 제거된 전용 효과음은
비교 버튼과 실제 게임 양쪽에서 계속 무음이다. 이전 음색 자료에
과거 정의가 남아 있어도 현재 카탈로그에는 노출하지 않는다.
