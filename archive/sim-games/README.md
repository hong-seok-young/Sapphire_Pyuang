# 보관: 확률 시뮬레이터 (게임 기능)

2026-11-04 제작자 요청 '게임 기능 빼자, 따로 보관만 해 놓고 운영에는 게임 다 빼 줘, 코인이니 뭐네'로 운영에서 뺀 코드.
이 폴더는 빌드·배포에 들어가지 않는다 (`web/` 밖, tsconfig 의 include 밖). 빼기 직전의 전체 코드는 커밋 `3154f7c` 에 있다.

## 들어 있는 것 (`web/` 안 원래 자리 그대로)
- 화면: `src/pages/Simulator.tsx` (강화 · 성장 · 옵션 · 보석 · 뽑기 · 던전 · 순위), `src/pages/SimDungeon.tsx` (던전)
- 셈: `src/sim.ts` (공식 확률 표 고르기), `src/simRank.ts` (행운 코인 지갑, 운 점수, 칭호), `src/simQuest.ts` (오늘의 도전),
  `src/simGear.ts` (장비 상점, 노작, 앞 장비 +8 잠금), `src/simDungeon.ts` (던전 셈), `src/pixelArt.ts` (도트 용사·던전 배경)
- 모양: `src/sim.css` (원래 `src/styles.css` 맨 끝 '확률 시뮬레이터' 묶음)
- 서버: `functions/api/sim/index.ts` (순위·전광판), `functions/api/sim/wallet.ts` (지갑), `server/simcoin.ts` (코인 버는 표 `EARN`, 도전 코인, 앱개발자 자동 충전)
- `launcher.snippet.ts` (홈 칸 줄), `guide.snippet.ts` (튜토리얼)

## 되살릴 때 다시 이을 곳
- 파일을 `web/` 의 같은 자리로 옮기고 `sim.css` 를 `styles.css` 끝에 붙인다.
- `src/launcher.ts` 의 `ITEMS` 에 홈 칸 줄, `DEFAULT_LAYOUT` grid 의 "enhance" 뒤에 "sim".
- `src/App.tsx`: `CHUNKS` 에 `Simulator: () => import("./pages/Simulator")`, `const SimulatorPage = lazy(...)`,
  `page === "sim"` 줄 (앱개발자와 `TEST_IDS` 만, 아니면 `<DevSoon title="확률 시뮬레이터" />`).
- `src/guides.ts` 의 `GUIDES` 에 튜토리얼, `src/ui.tsx` `TITLE_EN` 에 `"확률 시뮬레이터": "LUCK SIMULATOR"`, `src/activity.ts` 화면 이름 `sim: "확률 시뮬레이터"`.
- 코인 벌기: `functions/api/_middleware.ts` 의 기록 뒤 `earnFor(env, me.id, method, path)` (앱개발자·테스트 계정만), 기록에서 `/api/sim*` 빼기,
  `functions/api/activity.ts` 의 접속(open) 뒤 `earn(env, me.id, "visit")`.
- D1 표 `sim_records`, `sim_wallet`, `sim_earn`, `sim_feed` 는 `web/schema.sql` 에 그대로 있고 자료도 남아 있다 (기록은 평생). 닉네임 바꾸기와 계정 삭제도 그 표를 계속 따라간다.
- 설명은 CLAUDE.md 의 '확률 시뮬레이터 (뺐다)' 와 커밋 `3154f7c` 때의 CLAUDE.md '## 확률 시뮬레이터'.
