# 플로팅 시계 (Floating Clock)

게임(아이모 등) 위에 **초 단위 시계**를 띄워 주는 안드로이드 앱입니다.
제작: 퓨앙 (Sapphire)

## 기능
- 다른 앱 위에 `HH:mm:ss` 시계 오버레이 (초가 바뀌는 순간에 맞춰 갱신)
- 기본은 그림자·배경 없이 작은 글자만 표시. 잘 안 보이면 글자 색을 바꾸거나 배경 진하기를 올리면 됨
- **게임 연동**: 고른 게임(설치된 아이모 자동 감지)이 화면 앞에 있을 때만 시계 표시. '사용 정보 접근' 허용 필요, 허용 전에는 항상 표시
- 재부팅이나 업데이트 뒤에도 켜 두었던 시계가 자동으로 다시 켜짐
- **화면 인식 (실험)**: 게임에서 📷 버튼으로 장면을 캡처하고 감시할 부분을 네모로 고르면, 그 부분이 보이거나(같은 모습) 바뀔 때 옆에 화살표·알림·진동/소리. 화면 녹화 허용 필요(켤 때마다 물어봄). 화면은 폰 안에서 비교만 하고 보내지 않음. 게임 약관상 제재 위험은 사용자 판단
- 시계를 끌어서 이동 + 설정 화면의 가로/세로 슬라이더로 이동 (상태바에 가려 드래그가 안 될 때)
- 기본 위치는 상태바 바로 아래 가운데 (상태바와 겹치면 터치가 상태바에 먹힘)
- 글자 크기 / 글자 색 / 24시간제 / 날짜 표시 옵션, 위치 고정(드래그 잠금)
- 포그라운드 서비스로 동작해서 게임 중에도 안 꺼짐 (알림에서 바로 끄기)
- **앱 내 업데이트**: 앱을 열면 GitHub 릴리스에서 새 버전을 확인하고, 받아서 설치까지 진행

## 설치
1. `FloatingClock-v1.x.apk` 를 폰에 복사해서 설치 (출처를 알 수 없는 앱 설치 허용 필요)
2. 앱 실행 → **권한 설정 열기** → "다른 앱 위에 표시" 허용
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
  MainActivity.kt          설정 화면 (권한, 켜기/끄기, 게임 연동, 모양, 위치, 업데이트)
  FloatingClockService.kt  오버레이 시계 포그라운드 서비스 (드래그, 1초 갱신, 게임 감지 시에만 표시)
  ClockStyle.kt            시계 글꼴/색/크기/배경 (오버레이와 미리보기 공용)
  GameDetector.kt          화면 앞 앱 감지(사용 정보 접근), 게임 목록, 아이모 자동 감지
  StartupReceiver.kt       재부팅/업데이트 뒤 시계 자동 재시작
  ScreenWatchService.kt    화면 인식: 화면 녹화, 1초 4번 비교, 화살표/알림, 📷 캡처 버튼, 회전 대응
  ScreenWatchActivity.kt   화면 인식 설정 (켜기/끄기, 규칙 목록)
  RuleEditorActivity.kt    규칙 만들기 (캡처 위에 네모 고르기, 보이면/바뀌면, 일치 기준)
  Rule.kt                  규칙과 저장소, 캡처 파일
  RegionSampler.kt         영역을 12x12 칸 평균색으로 뽑아 기준과 비교
  CalloutView.kt           감시 영역 옆에 화살표·알림 그리기 (영역은 가리지 않음)
  RegionSelectView.kt      캡처 위에서 네모 고르는 뷰
  OverlayRegistry.kt       이 앱이 그린 것(시계/버튼/알림) 위치 공유 → 비교에서 제외
  UpdateChecker.kt         GitHub 릴리스 확인 / APK 다운로드 / 설치 실행
  Prefs.kt                 설정 저장 (SharedPreferences)
```

## 참고
- iOS 는 다른 앱 위에 뜨는 오버레이를 허용하지 않아서 안드로이드 전용입니다.
- 시계가 사라지면 설정 → 앱 → 플로팅 시계 → 배터리 → **제한 없음** 으로 바꿔 주세요.
- '사용정보 접근 허용' 스위치가 회색(제한된 설정으로 제어됨)이면: 설정 → 애플리케이션 → 플로팅 시계 → 오른쪽 위 ⋮ → **제한된 설정 허용** 후 다시 켜기. 스토어 밖에서 설치한 앱에 안드로이드가 거는 기본 잠금입니다.
