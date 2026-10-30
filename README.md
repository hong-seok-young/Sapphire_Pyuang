# Sapphire (플로팅 시계)

길드 Sapphire의 아이모 위키 앱입니다. 안드로이드 앱은 게임(아이모 등) 위에 **초 단위 시계**도 띄워 줍니다.
제작: 퓨앙 (Sapphire)

- **웹앱 (아이폰, 안드로이드)**: https://sapphire-guild.pages.dev — 아이폰은 Safari, 안드로이드는 Chrome에서 열고 '홈 화면에 추가'
- **안드로이드 앱**: 아래 설치 방법. 같은 위키에 게임 위 시계와 타이머가 더 있습니다.

## 기능
- **위키 첫 화면**: 앱을 열면 길드 위키 웹앱이 그대로 뜸 (두 앱의 정보가 늘 같음). 시계와 타이머는 위쪽 메뉴의 '⏰ 시계'와 ⋮(타이머 설정, 웹앱 링크 보내기, 새로고침)에서 엶. 카페 원글 같은 바깥 링크는 브라우저로 열림
- 다른 앱 위에 `HH:mm:ss` 시계 오버레이 (초가 바뀌는 순간에 맞춰 갱신)
- 기본은 그림자·배경 없이 작은 글자만 표시. 잘 안 보이면 글자 색을 바꾸거나 배경 진하기를 올리면 됨
- 시계는 켜 두는 동안 어디서나 보임. 게임을 마치면 시계 설정이나 알림창의 '끄기'로 끔 (어떤 앱이 켜져 있는지 알아보는 게임 감지는 v1.12에서 뺌)
- **빠른 설정 버튼**: 알림창 빠른 설정에 'Sapphire 시계' 버튼을 넣어 두면 한 번 눌러 시계를 켜고 끔. 시계 설정의 '빠른 설정에 시계 버튼 넣기'로 추가 (안드로이드 13 이상은 시스템 추가 창, 그 전에는 직접 넣는 방법 안내)
- 재부팅이나 업데이트 뒤에도 켜 두었던 시계가 자동으로 다시 켜짐
- **타이머**: 게임 중 시계를 누르면 내가 만든 타이머 목록이 떠서 바로 시작 (예: 보스 30분). 남은 시간이 시계 아래에 뜨고, 곧 끝나면 주황색, 끝나면 빨간색으로 깜빡이며 진동·소리. 정해진 시각 알림(매일 21:00 등)도 지원. 화면이 꺼져 있을 땐 폰 알림으로 알려 줌. 게임을 읽지 않고 현재 시각만 보고 동작
- **보스·네임드 젠 타이머**: 길드 위키의 재부활 시간(iOS 님 드랍표)을 받아 와서, 시계를 누르면 사냥터를 펼쳐 방금 잡은 몬스터를 골라 시작. 10분 넘게 걸려 다시 나오는 몬스터만, 잡을수록 줄어드는 보스는 고정되는 마지막 값으로 셈. 매일 정해진 시각에 나오는 몬스터는 다음 등장 시각까지 셈
- 시계를 끌어서 이동 + 설정 화면의 가로/세로 슬라이더로 이동 (상태바에 가려 드래그가 안 될 때)
- 기본 위치는 상태바 바로 아래 가운데 (상태바와 겹치면 터치가 상태바에 먹힘)
- 글자 크기 / 글자 색 / 24시간제 / 날짜 표시 옵션, 위치 고정(드래그 잠금)
- 포그라운드 서비스로 동작해서 게임 중에도 안 꺼짐 (알림에서 바로 끄기)
- **알림 숨기기**: 알림창의 '시계 실행 중', '다른 앱 위에 표시 중' 알림을 끄는 설정으로 바로 이동. 꺼도 시계는 그대로 보임 (두 알림 모두 안드로이드 규칙이라 앱이 직접 없앨 수는 없음)
- **앱 내 업데이트**: 앱을 열면 GitHub 릴리스에서 새 버전을 확인하고, 받아서 설치까지 진행

## 게임 안전 원칙
아이모 운영 측은 외부 프로그램으로 게임에 영향을 주면 계정을 정지한다고 안내합니다. 그래서 이 앱은:
- 게임 화면을 읽지 않고, 게임에 입력을 보내지 않고, 게임 파일·메모리·통신에 손대지 않습니다.
- 화면 위에 시간만 따로 그립니다. 어떤 앱이 켜져 있는지 알아보던 게임 감지 기능도 v1.12에서 '사용 정보 접근' 권한까지 뺐습니다.
- v1.5에 잠깐 있던 화면 인식 기능은 v1.6에서 완전히 뺐습니다.
- 그래도 판단은 운영 측이 합니다. 걱정되면 컴투스 고객센터에 먼저 물어보세요.

개발 규칙 전문은 [CLAUDE.md](CLAUDE.md)에 있습니다.

## 설치
1. `FloatingClock-v1.x.apk` 를 폰에 복사해서 설치 (출처를 알 수 없는 앱 설치 허용 필요)
2. 앱 실행 → 위쪽 **⏰ 시계** → **권한 설정 열기** → "다른 앱 위에 표시" 허용
3. **시계 켜기** → 홈으로 나가서 게임 실행

처음 업데이트할 때 한 번 "이 출처의 앱 설치 허용"을 켜 달라는 화면이 뜹니다. 허용 후 다시 업데이트를 누르면 됩니다.

## 업데이트 배포 (개발자용)
1. `app/build.gradle.kts` 에서 `versionCode` 를 1 올리고 `versionName` 을 바꿉니다 (예: 1.2)
2. `publish.cmd "변경 내용"` 실행 → 빌드 후 GitHub 릴리스 `v1.2` 가 만들어지고 APK 가 첨부됩니다
3. 폰에서 앱을 열면 "새 버전 v1.2" 안내가 뜹니다

배포 저장소: `https://github.com/hong-seok-young/Sapphire_Pyuang` (`UpdateChecker.REPO`). 공개 저장소여야 폰이 로그인 없이 APK를 받을 수 있습니다.

### 서명 키 주의
업데이트는 **같은 서명 키**로 만든 APK만 덮어쓰기 설치가 됩니다.
키는 `keystore/floatingclock.jks` + `keystore.properties` 에 있고 `.gitignore` 로 커밋에서 제외됩니다. **백업해 두세요.** 잃어버리면 기존 사용자는 앱을 지우고 다시 설치해야 합니다.

## 빌드 (Windows)
JDK 17 과 Android SDK 가 `C:\Users\Administrator\android-dev` 에 포터블로 설치되어 있습니다.

```bat
build.cmd
```

> 다른 PC에서 빌드할 때는 `local.properties` 의 `sdk.dir` 을 그 PC의 SDK 경로로 바꾸세요.
> 안드로이드 스튜디오로 폴더를 열어도 바로 빌드됩니다.

### 이 PC에서 Gradle 8.4 / AGP 8.3.2 를 쓰는 이유
이 PC의 보안 프로그램(AhnLab V3 등)이 새로 만들어진 jar 파일을 한참 잡고 있어서,
Gradle 8.5 이상이 쓰는 "임시 폴더 → 캐시 폴더 이동(rename)" 방식이
`Could not move temporary workspace ... AccessDeniedException` 으로 실패합니다.
Gradle 8.4 는 폴더 이동 없이 캐시에 바로 쓰기 때문에 문제가 없습니다.
백신 실시간 검사 예외에 `C:\Users\Administrator\android-dev` 를 추가할 수 있다면 최신 Gradle/AGP 로 올려도 됩니다.

## 구조
```
app/src/main/java/com/floatingclock/app/
  MainActivity.kt          첫 화면: 길드 위키 웹앱(WebView) + 위쪽 메뉴 (시계, 타이머, 링크 보내기, 새로고침)
  ClockActivity.kt         시계 설정 화면 (권한, 켜기/끄기, 빠른 설정 버튼 넣기, 알림 숨기기, 모양, 위치, 업데이트)
  ClockTileService.kt      알림창 빠른 설정의 '시계' 켜기/끄기 버튼
  UpdateUi.kt              새 버전 확인과 업데이트 창 (두 화면이 같이 씀)
  FloatingClockService.kt  오버레이 시계 포그라운드 서비스 (드래그, 1초 갱신, 게임 감지 시에만 표시)
  ClockStyle.kt            시계 글꼴/색/크기/배경 (오버레이와 미리보기 공용)
  StartupReceiver.kt       재부팅/업데이트 뒤 시계 자동 재시작
  TimerStore.kt            타이머, 정해진 시각 알림, 돌아가는 타이머 저장 + 시간 글자 만들기
  TimerActivity.kt         타이머 설정 화면 (목록, 위키 보스·네임드, 시각 알림, 진동/소리, 미리 알림)
  WikiTimers.kt            위키 사이트의 data/*.json 에서 보스·네임드 재부활 시간 받기 (바뀐 파일만)
  UpdateChecker.kt         GitHub 릴리스 확인 / APK 다운로드 / 설치 실행
  Prefs.kt                 설정 저장 (SharedPreferences)
```

## 웹앱 (web/)
아이폰, 안드로이드 모두 쓰는 위키 웹앱입니다. 주소: **https://sapphire-guild.pages.dev** (Cloudflare Pages, `npm run deploy`). 사냥터, 몬스터 드랍, 아이템 검색(초성 검색 포함), 장비, 육성 공략, 스킬, 조합책 등.
안드로이드 앱은 정보, 챗봇 화면으로 이 웹앱을 그대로 띄웁니다 (두 앱을 같이 고치는 규칙은 [CLAUDE.md](CLAUDE.md)).

```bash
cd web
npm install
pip install -r scripts/requirements.txt   # 처음 한 번
python scripts/build_data.py              # ../자료 -> public/data, public/img (3~4분)
npm run dev                               # http://localhost:5173
npm run build                             # 배포용 dist/
npm run deploy                            # 빌드 + Cloudflare Pages(sapphire-guild)에 올리기 (처음엔 npx wrangler login)
```

- 위키 자료(`자료/`, `web/public/data`, `web/public/img`)는 git에 올리지 않습니다. 자료 출처: 아이모 원클릭 드랍표 (Made by iOS).
- 글꼴: [갈무리](https://github.com/quiple/galmuri) (SIL OFL 1.1)

```
web/
  scripts/build_data.py  저장한 카페 글 -> 글 본문 블록, 사냥터, 몬스터, 아이템, 장비 JSON + 그림
  src/App.tsx            화면 전환 (해시 주소), 아래 탭
  src/pages/             홈, 검색, 사냥터, 몬스터/아이템, 장비, 메뉴/글 보기
  src/Blocks.tsx         원글 표를 종이색 바탕에 그대로 그리기
  src/search.ts          이름, 초성 검색
```

## 참고
- iOS 는 다른 앱 위에 뜨는 오버레이를 허용하지 않아서 안드로이드 전용입니다.
- 시계가 사라지면 설정 → 앱 → Sapphire → 배터리 → **제한 없음** 으로 바꿔 주세요.
