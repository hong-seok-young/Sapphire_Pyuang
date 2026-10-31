# 이어서 할 일 (2026-10-31 인계)

주간 사용량 때문에 이 세션을 여기서 멈추고, 제작자(퓨앙)가 집 PC의 다른 세션에서 이어서 한다.
여기까지는 모두 `main` 에 커밋하고 올렸다 (df88a24: 중개인 현금 환산·흥정·경매, 비밀번호 바꾸게 하기,
랭킹 마크 말풍선, 글자 안 잘리게, 위키 제목 밑줄 정리). 아래 세 가지는 아직 안 했다. 요청 순서대로 적는다.

시작하기 전에: 이 폴더의 `CLAUDE.md` 를 먼저 읽는다 (게임 안전 규칙, 두 앱 규칙, 글자와 줄바꿈 규칙).
`자료/` 가 없으면 비공개 저장소 `hong-seok-young/sapphire-imo-data` 를 `자료` 로 클론한다.

---

## 1. 사용 기록 (앱개발자만 보는 화면) — 설계와 서버 초안 있음

제작자 요청 그대로: "나만 볼 수 있게 백로그도 다 기록해서 볼 수 있게 해 줘. 누가 어디서 뭐 하고, 몇 번 접속하고 등등"

### 정한 것
- 보는 사람: 역할이 `developer`(퓨앙)인 계정만. 화면 `#/log` '사용 기록', 홈 타일 📊 (앱개발자에게만 보임).
- 남기는 것 (D1 `activity`, 60일 뒤 지움):
  - **접속(visit)**: 30분 넘게 아무것도 안 하다가 다시 쓰면 하나. `/api/me`(앱 열기), 화면 보기, 한 일이 모두 접속을 깨운다.
  - **화면(view)**: 본 화면의 해시 주소(`#/market`, `#/post/343732` ...). 한 화면에 1.5초 넘게 있을 때만, 같은 화면은 잇달아 안 보냄.
    5분 넘게 다른 앱에 있다 돌아오면 지금 화면을 다시 보낸다 (접속 세기).
  - **한 일(act)**: GET 이 아닌 API 요청이 성공하면 `메서드 경로` 와 짧은 내용(detail JSON).
  - **어디서(via)**: User-Agent 로 `float`(게임 위 위키 창, `SapphireFloat`), `app`(`SapphireApp`), `ios`/`android`/`pc`(웹).
- **남기지 않는 것** (화면에 '판 사람만 봐요', '본인만 봐요'라고 안내한 것들이라): 비밀번호, 챗봇 질문 내용, 한마디(note),
  흥정 가격(offer, 대신 `offered: true` 만), 입찰 금액(amount), 경험치(exp), 사진, IP와 위치.
  → `server/activity.ts` 의 `KEEP` 목록에 있는 칸만 남긴다.
- 계정을 지우면 그 사람의 기록도 지운다 (`functions/api/users/[id].ts` DELETE 에 `DELETE FROM activity WHERE user_id = ?` 추가).
- 길드원에게 기록한다는 걸 알릴지는 제작자에게 물어볼 것 (예: 로그인 화면 아래 한 줄 "접속과 사용 기록은 앱 관리를 위해 남아요").

### 초안 파일 (이 폴더의 `activity/`) — 아직 시험 안 함
| 초안 | 넣을 곳 |
| --- | --- |
| `activity/server-activity.ts` | `web/server/activity.ts` (viaOf, detailOf, record, subjectOf, KEEP_DAYS) |
| `activity/api-middleware.ts` | `web/functions/api/_middleware.ts` (모든 /api 쓰기 요청 기록, /api/me 는 접속) |
| `activity/api-activity.ts` | `web/functions/api/activity.ts` (POST 화면 보기, GET 앱개발자 전용 보기 + 사람별 요약) |

`web/schema.sql` 에 넣을 표:
```sql
-- 사용 기록 (앱개발자만 본다, 60일 보관): 접속, 화면, 한 일. 비밀번호, 챗봇 질문, 한마디, 흥정 가격, 입찰 금액, 경험치는 넣지 않는다
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,   -- visit 접속 | view 화면 | act 한 일
  what TEXT NOT NULL,   -- 화면 주소(#/market) 또는 한 일(POST /api/market)
  detail TEXT,          -- 한 일의 짧은 내용 JSON (KEEP 칸과 subject)
  via TEXT,             -- app | float | ios | android | pc
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_at ON activity (at);
CREATE INDEX IF NOT EXISTS activity_user_at ON activity (user_id, at);
```
(새 표라 `ci-d1.mjs` 의 ADDED_COLUMNS 는 필요 없다. 배포가 schema.sql 을 그대로 돌린다.)

### 남은 화면 쪽 일
- `web/src/activity.ts`: 타입, `fetchActivity({user, kind, before})`, `reportView(hash)`(1.5초 디바운스, `fetch(..., {keepalive: true})`),
  `VIA_NAME`(앱 / 게임 위 창 / 웹(아이폰) / 웹(안드로이드) / 웹(PC)).
- `App.tsx` 의 `Wiki`: 라우트가 바뀔 때 `reportView(location.hash)`, `visibilitychange` 로 5분 넘게 숨었다 돌아오면 다시 보냄.
  `page === "log"` 이면 `me.role === "developer"` 일 때만 `ActivityLogPage`(위키 자료가 필요하니 `!wiki` 검사 뒤에).
- `pages/ActivityLog.tsx`:
  - 위: "앱개발자에게만 보여요. 60일 동안 남아요. 비밀번호, 챗봇 질문, 한마디, 흥정 가격, 입찰 금액, 경험치는 남기지 않아요."
  - 사람별 요약 (GET 의 `people`): 닉네임, 7일/30일 접속 수, 마지막으로 쓴 때(n분 전)와 곳, 7일 화면 수·한 일 수.
    누르면 아래 기록을 그 사람만 거른다. 사람이 많으니 닉네임 검색 칸.
  - 종류 칩: 전체 / 접속 / 화면 / 한 일 (줄이 모자라면 다음 줄로, 옆으로 넘기는 띠 금지).
  - 기록: 날짜 머리줄(오늘, 어제, 10월 29일) 아래 `시:분 닉네임 · 곳 — 내용`. 맨 아래 '더 보기'(before = 마지막 id).
  - 화면 이름은 위키 자료로 푼다: `#/post/ID` -> 글 제목, `#/place/ID` -> 사냥터 이름, `#/item/이름`, `#/monster/키`,
    `#/menu/이름`, 그 밖은 고정 이름(사파이어 중개인, 길드 랭킹, 길드원 의뢰소, 챗봇, 내 정보, 길드원 관리 ...).
  - 한 일 이름은 `메서드 경로` 정규식 표로: 로그인, 로그아웃, 비밀번호 바꿈, 직업·레벨 저장(PUT /api/profile), 캐릭터 사진,
    계정 만듦/지움, 역할 바꿈, 비밀번호 초기화, 비밀번호 바꾸게 함, 중개인 물건 올림/고침/내림, 살래요(흥정 있음)/취소, 입찰,
    골드 글 올림/고침/내림, 거래할래요, 의뢰 올림/수락/완료/내림(PATCH 본문 action), 챗봇 질문.
- `Home.tsx` 타일 `{ title: "사용 기록", to: "#/log", icon: "📊", developer: true }`.
- 시험: 로컬 D1 에 표를 만들고(`npx wrangler d1 execute sapphire-accounts --local --file schema.sql`),
  `tests/` 의 시험처럼 node 로: 접속 30분 묶음, 화면 기록, 한 일 detail 에 비밀번호/note/offer/amount/exp 가 없는지,
  GET 은 developer 만(다른 역할 403), 계정 삭제 시 기록 삭제. 360px 화면에서 잘리는 글 없는지.
- 문서: CLAUDE.md 에 '사용 기록' 절, README 웹앱 절, CLAUDE.md 기록.

---

## 2. 길드원 관리 화면 정리 — 아직 시작 안 함

제작자 요청: "한 행으로 못 하나. 권한도 드롭박스식으로 하면 좋지 않을까, 더 좋은 의견 있으면 그렇게 해 주고.
길드원이 몇백 명 되면 검색도 해야 될 것 같아." (스샷: 계정마다 단추가 두세 줄이라 길다)

### 정한 방향
- 계정 하나를 **한 줄**로: 엠블럼, 닉네임, 길드·Lv·직업(작게), 표시(역할, '비밀번호 바꾸기 전'), 오른쪽 '관리 ▾'.
  줄을 누르면 그 줄 아래로만 관리 칸이 펼쳐진다 (한 번에 하나).
- 역할: 드롭다운 느낌이지만 **`<select>` 는 쓰지 않는다** (게임 위 위키 창 WebView 에서 안 열린다. CLAUDE.md 규칙).
  펼친 칸 안에 [길드마스터][오피서][길드원] 세 칸 단추(지금 역할이 주황), 바꿀 수 있는 것만 누를 수 있게.
- 펼친 칸의 나머지: 레벨·직업·길드 고치기, 닉네임 바꾸기(아래 3), 비밀번호 초기화, 비밀번호 바꾸게 하기, 사진 내리기, 계정 삭제(한 번 더 확인).
- 맨 위에 **닉네임 검색**(띄어쓰기 무시, 초성 검색은 `web/src` 의 검색 함수 재사용 검토), 그리고 거르기 칩: 전체 / 1군 / 2군 / 오피서 이상 /
  비밀번호 바꾸기 전 / 직업·레벨 안 정함. "길드원 N명" 수 표시. 몇백 명이면 처음 50명만 그리고 '더 보기'.
- 화면: `web/src/pages/Admin.tsx` (`AccountRow`), 스타일 `.account*` (styles.css).

---

## 3. 닉네임 바꾸기 — 아직 시작 안 함

제작자 요청: "이 게임은 주로 키우는 캐릭터를 바꾸는 경우도 있고, 캐릭터 구매도 하는 경우도 있어. 그럴 때는 닉네임도 바꾸게 해 줘야 돼."

### 정한 방향
- 본인은 '내 정보'에서, 오피서 이상은 '길드원 관리'에서 (다룰 수 있는 역할만, `canManage`).
- 서버 `POST /api/users/:id/rename { newId }` (본인이면 `/api/me/rename` 처럼 따로 두거나 같은 곳에서 me.id 허용):
  새 닉네임 규칙은 계정 만들기와 같다 (`functions/api/users/index.ts` POST 의 아이디 검사 재사용), 이미 있으면 409.
  **아이디가 여러 표의 키라서 한 번의 batch 로 모두 바꾼다**: users.id(+ created_by), sessions.user_id, profiles.user_id,
  level_log.user_id, avatars.user_id, listings.seller, listing_wants.user_id, listing_bids.user_id, gold_offers.owner,
  gold_wants.user_id, requests.owner, requests.accepter, chat_usage.user_id, (사용 기록을 넣었으면) activity.user_id.
  `web/schema.sql` 에서 user 를 가리키는 칸을 한 번 더 찾아서 빠진 게 없게 할 것.
  세션은 그대로 두면(user_id 만 바꾸면) 다시 로그인하지 않아도 된다. 로그인은 새 닉네임으로.
- **캐릭터를 바꾼 경우 성장 랭킹**: 산 캐릭터나 다른 캐릭터로 레벨이 갑자기 바뀌면 오늘/주간/월간 성장이 크게 튄다.
  닉네임 바꾸기 칸에 "다른 캐릭터로 바꿨어요 (성장 기록을 새로 시작)"를 두고, 고르면 그 사람의 `level_log` 를 지우고
  지금 직업·레벨로 새로 시작한다(`saveProfile` 의 첫 기록 방식). 단순 오타 고치기는 기록을 그대로 둔다.
  직업·레벨도 같이 바꾸게 (`ProfileForm` 재사용).
- 아이디 아바타 그림 주소(`avatarUrl(id, ...)`)와 랭킹 캐시가 새 아이디로 바로 보이는지 확인.
- 시험: 위 표들에 글/입찰/의뢰/세션이 있는 계정을 바꾼 뒤 모두 따라오는지, 같은 이름 409, 남의 것(권한 없음) 403.

---

## 4. 빠릿빠릿한 애니메이션 — 일부 했음

했음 (styles.css 맨 아래 'snappy motion'): 초록 점 두 번 깜빡임, 단추·타일·탭 눌림, 고른 탭 아이콘 톡 튀기,
켜진 칩 톡, 살래요 하트 눌림, 움직임 줄이기 설정이면 모두 끔. 아래 목록에서 남은 것: 화면 전환, 입찰 최고가 반짝,
경매 1시간 아래 시계 흔들림, 성장 1등 카드 반짝.

제작자 요청: "답답하지 않을 정도로만 빠릿빠릿하고 위트 있는 애니메이션을 전반적으로. 예: 로그인하면 오른쪽 위 닉네임 앞
초록 점이 빠르게 깜빡이게. 메뉴 전환 때 늦게 뜨면 답답해하는 사람도 있고, 스크롤할 때마다 스르륵 뜨는 건 바로 안 보여서 답답하다."

### 정한 방향 (CSS 위주, `web/src/styles.css`)
- 길이는 짧게: 눌림 80~120ms, 나타남 150~200ms. 내용이 늦게 보이는 효과(스크롤 따라 나타나기, 긴 페이드)는 넣지 않는다.
  화면 전환은 새 화면을 바로 그리고, 위에서 4px 내려오며 0.15초 안에 또렷해지는 정도만 (내용은 처음부터 거의 다 보임).
- 초록 점(`.online-dot`): 로그인 표시답게 1.6초마다 짧게 반짝(두 번 깜빡) 또는 퍼지는 링.
- 단추와 타일(`.pill`, `.tile`, `.mk-row`, `.tab`): 누를 때 살짝 눌림(scale 0.96 / 1px 내려감), 켜진 칩(`.pill-on`)이 바뀔 때 톡 튀는 느낌.
- 아래 탭: 고른 탭 아이콘이 한 번 통 튀기.
- 중개인: 입찰이 들어가면 최고가 숫자가 한 번 반짝, '살래요' 하트가 톡 커졌다 돌아오기. 경매 남은 시간이 1시간 아래면 시계 아이콘이 살짝 흔들림.
- 랭킹: 레벨업 ▲ 뱃지는 이미 둥실거림(`bob`). 성장 1등 카드가 처음 뜰 때 한 번 반짝.
- `TapTip` 말풍선은 이미 0.15초 안에 나타나고 2초 뒤 사라짐 (그대로).
- 움직임 줄이기 설정을 켠 사람(`@media (prefers-reduced-motion: reduce)`)에게는 모두 끈다.
- 확인: 360px 폰 크기에서 전환이 늦어 보이지 않는지, 누를 때 바로 반응하는지.

---

## 시험과 배포 방법 (이번 세션에서 쓴 방법)
- 로컬 서버: `.claude/launch.json` 의 `web-accounts` (vite build + `wrangler pages dev dist --port 8788`).
  남은 workerd 가 포트를 잡고 있으면 PowerShell 로 `pages dev dist`/`workerd-windows-64` 프로세스를 끈다.
- 로컬 D1 표 바꾸기: `npx wrangler d1 execute sapphire-accounts --local --command "ALTER TABLE ..."` / `--file schema.sql`.
- 시험 스크립트 예: `tests/test-auction.mjs` (중개인 흥정·경매, 비밀번호 바꾸게 하기 58가지, 모두 통과),
  `tests/seed-auction-ui.mjs` (화면 확인용 자료). 실행: `cd web && npm run build && node ../docs/handoff/tests/test-auction.mjs <로컬 개발자 비밀번호 파일>`.
  로컬 개발자 계정은 `localtest` (로컬 D1 에만 있다. 비밀번호는 파일로 넘기고 화면에 찍지 않는다).
- 배포: `main` 에 `web/` 이 바뀌어 올라가면 GitHub Actions 가 자동 배포 (`gh run watch`). `docs/` 만 바뀌면 배포하지 않는다.

## 이번에 알게 된 함정
- 크롬은 `white-space: nowrap` 안에서도 `<wbr>` 에서 줄을 바꾼다 → 줄 바꿀 자리는 폭 없는 공백 문자(`​`)로.
- `grid-template-columns: repeat(3, 1fr)` 은 한 줄로 둔 긴 글이 칸을 넓힌다 → `minmax(0, 1fr)`.
- 정규식 뒤보기(`(?<=...)`)는 iOS 16.4 전 사파리에서 앱 전체가 안 뜬다 → 쓰지 않는다.
- 숨긴 미리보기 창에서는 스크린샷이 가끔 시간 초과, CSS 애니메이션이 멈춰 보인다 → JS 로 확인하고 다시 시도.
