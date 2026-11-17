# 운영진 때리기 (접어 둠, 2026-11-17)

개발 요청 #10(현금술사 님 신청, 길마 결재)으로 만들다가 제작자가 2026-11-17 '지금 너무 허접해' → '아니다 이건 그냥 접자, 개발중에서도 내리고,
하던 거만 그냥 깃에 저장해 둬'라고 해서 홈 '개발 중' 묶음과 주소(#/smack), API 에서 뺐다. 코드는 여기에 원래 자리 그대로 둔다 (빌드에 안 들어간다).

## 여기 있는 것 (원래 자리)
- `web/src/pages/Smack.tsx` 화면 (목록·때리는 무대), `web/src/smackFx.ts` 타격 효과 (영상에서 옮긴 숫자·CRITICAL!·DEADLY! 움직임)
- `web/src/smack.css` 스타일 (원래 `web/src/styles.css` 의 '운영진 때리기' 묶음, 성장코인 팝업 `.ct` 바로 앞에 있었다)
- `web/server/smack.ts` (SMACK_OPEN, canSmack, smackTargets), `web/functions/api/smack/index.ts` (GET/POST /api/smack)
- `test/mock.cjs`·`test/shot.cjs`: vite preview(dist) 위에 Playwright 로 /api 를 흉내 내 화면을 찍는 시험 (자료 저장소의 캐릭터 사진 경로는 절대 경로라 그 PC 에 맞춘다)

## 접을 때 하다 만 것 (2차 '허접하지 않게' 작업, 2026-11-17 시작 직후 중단)
- `web/functions/api/smack/index.ts`: GET 에 운영진마다 맞은 합 `totals` 를 더했다 (목록 카드에 현상금·K.O. 를 보이려고). 화면은 아직 안 쓴다.
- `web/src/smackFx.ts` 맨 아래 '2차' 묶음: 도트 글러브 그림(`gloveArt`), 필살기 게이지·데미지(`ULT_*`, `rollUlt`, `ultBurst`), 콤보 외침(`SHOUTS`, `shoutOf`, `FEVER_AT`),
  말풍선 글(`TAUNTS`), 피버 불똥(`feverSparks`). 화면·CSS 에는 아직 하나도 붙이지 않았다.
- 계획했던 것(안 만듦): 보스 HP 판(초상·칸 나눈 HP 바), 별이 뜬 밤하늘·조명·바닥이 있는 무대, 누른 자리에 글러브가 꽂힘, 맞을 때 흰 실루엣 번쩍(mask-image),
  HP 낮으면 머리 위 도는 별·땀, 말풍선, 콤보 외침과 줄어드는 콤보 막대, 30콤보 피버(무지개 테두리), 필살기 단추와 연출(어두워짐·큰 금빛 글러브·화면 금·큰 숫자),
  K.O. 뒤 카운트다운, 목록 카드를 현상수배 포스터 모양으로(현상금 = 맞은 데미지), 순위에 막대·메달, 진동(크리·죽음의 일격·K.O.).

## 되살리려면
1. 위 파일을 원래 자리로 옮기고 `smack.css` 내용을 `styles.css` 의 `.ct` 묶음 앞에 넣는다.
2. `web/src/launcher.ts`: `SMACK_OPEN`·`canSmack` 과 ITEMS 의 smack 칸(`{ key: "smack", title: "운영진 때리기", short: "때리기", to: "#/smack", icon: "🥊", developer, soon, badge: "개발중", match: ["smack"] }`),
   `DEFAULT_LAYOUT.grid` 끝의 "smack". `web/src/App.tsx`: `canSmack` import, `CHUNKS.Smack`, `SmackPage` lazy, `page === "smack"` 분기.
   `web/functions/api/_middleware.ts`: 사용 기록에 안 남기는 경로에 `path === "/api/smack"`.
3. D1 `smack_stats` 표(schema.sql)와 닉네임 바꾸기(rename.ts)·계정 삭제(accountDelete.ts)의 처리는 그대로 두었다 (기록은 남아 있다).
4. 자료: 비공개 자료 `이미지/때리기/`(영상에서 오린 숫자·글씨, 원본 영상), `제공/운영진_때리기.md`. `build_data.py` 가 `data/smack/` 으로 복사하는 것도 그대로다.
접기 전 커밋: `git log --follow -- archive/smack/web/src/pages/Smack.tsx` 로 원래 자리의 기록을 본다.
