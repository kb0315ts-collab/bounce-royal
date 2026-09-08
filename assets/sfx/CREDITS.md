# 효과음 출처

여기 있는 mp3는 **Kenney** (https://kenney.nl) 의 CC0 팩에서 골라 왔다.

**CC0(퍼블릭 도메인)이라 저작자 표기 의무는 없다.** 이 파일은 의무가 아니라
나중에 "이 소리 어디서 왔더라"를 찾기 위한 기록이다.

| 파일 | 원본 | 쓰이는 곳 |
|---|---|---|
| fire-bow.mp3 | impact-sounds / footstep_wood_000 | 활 발사 |
| fire-pistol.mp3 | ui-audio / click2 | 권총 발사 |
| fire-shotgun.mp3 | impact-sounds / footstep_carpet_001 | 샷건 |

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
| bow-draw.wav | English Longbow Draw.wav | 0.04–1.38 | 차지 샷 시위 당기기 |
| bow-release.wav | English Longbow Shoot.wav | 0.065–0.49 | 차지 샷 발사 |
| bow-release-alt.wav | English Longbow Shoot.wav | 1.20–1.63 | 발사 변주 |
| blade-air.wav | Katana Swing.wav | 0.31–0.72 | 단검 돌진·믹서기 풍절 |
| blade-scrape.wav | Katana Sheath Fast.wav | 2.42–2.88 | 단검 준비·강탈 마찰 |
| blade-scrape-alt.wav | Katana Sheath Fast.wav | 5.51–5.98 | 마찰 변주 |
| mechanism.wav | Crossbow Lever Trigger.wav | 0.66–1.55 | 재장전·잠금 기구 질감 |
| arrow-pass.wav | Scythian Recurve Arrow Passby.wav | 0.69–1.66 | 되돌아가기의 역방향 바람 |

원본 192kHz/24bit를 구간 추출하고, windowed-sinc 저역 통과 리샘플링,
95Hz 하이패스, 짧은 시작·끝 페이드, 피크 0.72 정규화를 거쳐
모노 32kHz/16bit WAV로 저장했다. 8개 합계 **345,632바이트**다.
재현 스크립트: `node tools/prepare-foley.js <압축 해제 폴더> --build`.

## 원래 소리를 지키는 공유 사운드 뱅크

현재 게임과 사운드룸은 `js/audio.js`의 같은 효과음 59종을 사용한다.
`js/audio-design.js`가 현재 음색을 정의한다. 기존 MP3 세 개는 **추가 합성 레이어 없이**
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
- 사운드룸의 **직전 시안**은 `524a896`의 전자음 중심 버전이다. 비교만 가능하며 게임 설정을 바꾸지 않는다.

`tools/audio-check.html`은 브라우저의 OfflineAudioContext로 실제 합성 결과를
렌더링해 무음·비정상 값·클리핑과 16개 동시 재생을 점검한다.
이 수치 검증이 주관적인 음질 평가를 대체하지는 않는다.

## 소리를 바꾸고 싶으면

`js/audio-design.js`의 음색 정의를 바꾸면 게임과 `sound-lab.html`의 게임 적용음에
함께 반영된다. `js/audio.js`의 기존 정의는 직전 시안 비교용으로 보관한다.
`tone`은 공명, `noise`는 마찰·공기·파열, `sample`은 녹음 레이어다.
`filterPath`/`freqPath`/`gainPath`는 시간에 따른 재질·장력·리듬의 변화를 표현한다.
전투 재생 시점은 `js/sim.js`의 `battleSound` 호출에서 정하며,
서버 스냅샷을 거쳐 실제 보고 있는 전투의 렌더러에서만 재생한다.
