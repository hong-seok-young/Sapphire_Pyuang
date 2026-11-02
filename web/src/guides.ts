// 메뉴 튜토리얼 글 (제작자 요청 2026-11-02: '각 메뉴에서 가장 위 제목을 누르면 … 용도보다 버튼별 기능과 사용 흐름. 튜토리얼로 그 메뉴에서 다 써 보게, 권한별로'
// -> 같은 날 '설명서 필요 없고 바로 튜토리얼 시작하게', '이모지·분리 기호 쓰지 말고 글만 나열하지 말고 콤팩트하게').
// 제목(위 줄 배너, 홈은 'Sapphire' 글씨)을 누르면 src/tutorial.tsx 의 Tutorial 이 화면의 그 자리를 하나씩 비추며(spotlight) 짧게 말한다.
// 단계는 그 사람의 권한(who)에 맞는 것만 돌고, 자리를 못 찾으면(자료가 없어서) 건너뛴다. 새 메뉴를 만들거나 단추를 바꾸면 여기도 같이 고친다.
// 글은 화면 글자 그대로의 단추 이름과 한두 문장. 이모지는 쓰지 않는다.
import type { Me } from "./auth";
import { RANK, TEST_IDS } from "./auth";

/** 누구에게 보이는 단계인지: all 모두 | main 1군 | officer 오피서 이상 | master 길드마스터·앱개발자 | developer 앱개발자 | rentStaff 장비대여 운영(길드마스터·대여 담당·앱개발자) */
export type Who = "all" | "main" | "officer" | "master" | "developer" | "rentStaff";

export interface GuideStep {
  /** 비출 곳 (CSS 선택자, 쉼표로 여럿이면 처음 보이는 것. ':has-text('글')' 도 됨). 없으면 화면 전체 */
  sel?: string;
  text: string;
  /** true 면 그 자리를 직접 누르면 다음으로 (바꾸지 않는 것만: 칸 열기, 탭 바꾸기). 다음을 눌러도 된다 */
  tap?: boolean;
  /** 이 단계 전에 이동할 주소 */
  go?: string;
  who?: Who;
}
export interface Guide {
  /** 화면 주소 첫 칸 (ranking, market …). 홈은 '' */
  key: string;
  title: string;
  tutorial: GuideStep[];
}

/** 대여 담당 (server/rental.ts RENT_STAFF 와 같다) */
const RENT_STAFF = ["멍멍"];

/** 그 단계가 이 사람에게 보이는지 */
export function canSee(who: Who | undefined, me: Me): boolean {
  switch (who) {
    case undefined:
    case "all":
      return true;
    case "main":
      return me.guild === "main" || me.role === "developer";
    case "officer":
      return RANK[me.role] >= 1;
    case "master":
      return RANK[me.role] >= 2;
    case "developer":
      return me.role === "developer" || TEST_IDS.includes(me.id);
    case "rentStaff":
      return me.role === "master" || me.role === "developer" || RENT_STAFF.includes(me.id) || (me.characters ?? []).some((c) => RENT_STAFF.includes(c.id));
  }
}

export const GUIDES: Guide[] = [
  {
    key: "",
    title: "홈",
    tutorial: [
      { sel: ".tiles", text: "메뉴 칸. 왼쪽 위 띠는 들어갈 수 있는 사람, UPDATE 는 고친 메뉴, 빨간 숫자는 새 글 수." },
      { sel: ".hero-bell", text: "알림. 살래요, 댓글, 길드 던전 확정이 여기로." },
      { sel: ".hero-me", text: "내 정보. 캐릭터를 묶었으면 캐릭터 목록이 먼저." },
      { sel: ".home-edit", text: "배치 편집. 칸을 끌어 옮기고 아래 탭과 바꿔요. 칸을 꾹 눌러도 돼요.", tap: true },
      { sel: ".launch-bar .pill-on", text: "다 옮겼으면 완료. 기본 배치로 되돌릴 수도.", tap: true },
      { sel: ".home-weather", text: "우리 동네 날씨. 비나 눈이면 화면에 내리고 아래에 쌓여요. 내 정보의 앱 설정에서 켜고 꺼요." },
      { sel: ".home-version", text: "버전을 누르면 패치 내역." },
      { sel: ".tabbar", text: "아래 탭. 홈, 게시판, 정보, 검색, 챗봇." },
    ],
  },
  {
    key: "ranking",
    title: "길드 랭킹",
    tutorial: [
      { sel: ".rank-views button:has-text('주간')", text: "성장은 그 기간에 오른 레벨과 경험치 순. 주는 목 10시부터. 주간 성장을 눌러 보세요.", tap: true },
      { sel: ".growth-hero", text: "이번 주 성장왕. 사진은 내 정보의 캐릭터 사진." },
      { sel: ".rank-views button:has-text('레벨')", text: "레벨을 눌러 돌아가요.", tap: true },
      { sel: ".rank-filters", text: "길드(통합, 1군, 2군)와 직업으로 걸러요. 사람 수와 평균 레벨." },
      { sel: ".rank-row .nick-btn", text: "닉네임을 누르면 레벨과 경험치 그래프.", tap: true },
      { sel: ".rank-mine", text: "내 줄. 경험치 막대를 누르면 바로 적어요. 이번 주 오른 만큼은 화살표와 더하기 퍼센트로." },
      { sel: ".rank-mine-bar", text: "내 순위. 레벨업에서 레벨과 경험치를 적어요. 이미 적은 값을 바꾸면 실제 성장인지 오타 수정인지 골라요." },
    ],
  },
  {
    key: "market",
    title: "사파이어 중개인",
    tutorial: [
      { sel: ".mk-tabs, .main-tabs", text: "사기, 내 판매, 팔기, 골드. 실제 거래는 게임 안에서." },
      { sel: ".mk-list .mk-row", text: "물건 줄을 눌러 보세요.", tap: true },
      { sel: ".mk-open .mk-detail", text: "옵션, 가격과 원화 어림, 판 사람과 카톡. 살래요를 누르면 판 사람에게 알림, 흥정 가격은 판 사람만 봐요. 경매면 입찰." },
      { sel: ".mk-open .mk-talk-btn", text: "토론방. 물건마다 한 줄씩 묻고 답해요." },
      { sel: "[role=tab]:has-text('팔기')", text: "팔기를 눌러 보세요.", tap: true },
      { sel: ".mk-form", text: "이름을 적으면 그림과 옵션이 붙어요. 수량, 가격(골드 또는 현금), 바로 판매 또는 경매. 위키에 없는 물건은 스샷 올리기로 AI 가 읽어요. 등록." },
      { sel: "[role=tab]:has-text('내 판매')", text: "내 판매를 눌러 보세요.", tap: true },
      { sel: ".mk-list .mk-row", text: "내가 올린 물건. 거래 완료, 가격 변경, 삭제. 살래요가 2명 넘으면 경매 전환." },
      { sel: "[role=tab]:has-text('골드')", text: "골드를 눌러 보세요.", tap: true },
      { sel: ".mk-list, main", text: "골드 팝니다와 삽니다. 양은 만 골드, 시세는 1만 원에 몇 만 골드. 글쓰기로 올려요." },
    ],
  },
  {
    key: "requests",
    title: "길드원 의뢰소",
    tutorial: [
      { sel: ".mk-cats", text: "모집 중, 진행 중, 완료, 내 의뢰." },
      { sel: ".mk-list .mk-row", text: "의뢰 줄을 눌러 보세요.", tap: true },
      { sel: ".mk-open .mk-detail", text: "보상과 한마디. 수락하면 내가 맡아요. 이틀 안에 안 끝나면 다시 모집 중. 의뢰한 사람은 게임에서 받은 뒤 완료." },
      { sel: "button:has-text('의뢰 등록')", text: "의뢰 등록. 무엇을, 보상(골드 또는 글), 한마디." },
    ],
  },
  {
    key: "board",
    title: "게시판",
    tutorial: [
      { sel: ".main-tabs *:has-text('아이모 소식')", text: "공지사항과 길드 이벤트는 운영진만 써요. 건의 사항은 운영진에게 알림. 아이모 소식을 눌러 보세요.", tap: true },
      { sel: ".pill-row", text: "전체, 공지사항, 점검, 이벤트. 컴투스 공식 글." },
      { sel: ".off-row", text: "글을 눌러 보세요.", tap: true },
      { sel: ".off-sum, .off-body, main", text: "위에 핵심 요약. 패치노트면 내 직업 변경점도. 맨 위 원문 보기." },
      { go: "#/board?cat=free", sel: ".bd-write", text: "글쓰기. 제목, 내용, 사진, 파일, 링크(유튜브는 안에서 재생)." },
      { sel: ".bd-write", text: "공지사항과 길드 이벤트를 쓸 때는 AI로 다듬기로 공지 모양으로. 미리 보고 적용.", who: "officer" },
      { sel: ".bd-list .bd-row", text: "글을 누르면 댓글, 답글, 좋아요. 내 글 댓글은 알림. 운영진은 고정." },
    ],
  },
  {
    key: "shop",
    title: "플래티넘 할인 상점",
    tutorial: [
      { sel: ".ps-tabs", text: "상점, 내 신청. 운영진은 신청, 정산, 설정, 예산도." },
      { sel: ".ps-limit, .ps-week", text: "플래티넘 이용한도. 매주 목 10시에 300, 안 쓰면 쌓여요." },
      { sel: ".ps-grid li", text: "물건 칸을 눌러 보세요.", tap: true },
      { sel: ".ps-contents", text: "들어 있는 아이템. 내 할인가가 진하게. 구매 신청하면 플래티넘이 빠지고 운영진에게 알림, 취소하면 돌아와요." },
      { go: "#/shop?v=orders", sel: ".ps-orders, .ps-order", text: "신청. 게임에서 거래한 뒤 거래 완료.", who: "officer" },
      { go: "#/shop?v=settle", sel: ".st-cards, .st-list, main", text: "정산. 이번 달과 전체, 기록·구매자·아이템. 줄을 누르면 삭제, 복구, 골드 수정.", who: "officer" },
    ],
  },
  {
    key: "rent",
    title: "장비대여",
    tutorial: [
      { sel: ".rent-views", text: "목록, 신청함, 운영, 기록. 주고받기는 게임 안에서." },
      { sel: ".rent-sub", text: "직업. 처음엔 내 직업." },
      { sel: ".rent-main", text: "무기 줄을 눌러 보세요. 왼쪽 네모는 신청 담기.", tap: true },
      { sel: ".rent-pop", text: "요구 레벨, 옵션, 기한, 보증금(1다이아 = 10만 골드), 쓰는 사람과 대기. 신청 담기로 여러 개 담고 화면 아래 대여 신청." },
      { go: "#/rent?v=apps", sel: "main", text: "신청함. 내 마일리지와 장부, 쓰는 무기와 반납 날, 내 신청서. 대화로 담당자와, 다 쓰면 반납 신청." },
      { go: "#/rent?v=staff", sel: ".rent-sub", text: "운영. 장비대여, 장비반납, 물건 추가, 기부 현황.", who: "rentStaff" },
      { sel: ".rent-app", text: "신청서마다 수락, 대여 완료(보증금 다이아와 골드), 거절. 대화로 받을 때를.", who: "rentStaff" },
      { go: "#/rent?v=log", sel: ".rent-log", text: "기록. 누가 언제 빌리고 반납했는지.", who: "rentStaff" },
    ],
  },
  {
    key: "match",
    title: "길드 던전",
    tutorial: [
      { sel: ".gd-party", text: "내 파티. 파티 만들기를 누른 사람이 파티장, 4명까지. 주는 목 10시부터." },
      { sel: ".gd-members", text: "카드마다 상태. 내 카드를 누르면 파티 나가기, 파티장은 남의 카드를 눌러 파티장 지정이나 빼기." },
      { sel: ".gd-cand, .gd-confirm, .gd-state", text: "지금 후보. 되면 확정, 안 되면 불참. 모두 확정하면 정해지고, 한 명이라도 불참하면 다음 후보로. 정한 뒤에 일이 생겨도 불참." },
      { sel: ".gd-tabs", text: "내 시간표를 눌러 보세요.", tap: true },
      { sel: ".gd-grid", text: "누르고 끌어서 가능한 때를 칠해요. 손을 떼면 저장. 전주 복사로 지난주 그대로." },
      { sel: ".gd-lock", text: "다 칠했으면 확정. 잠겨서 스크롤하다 눌러도 안 바뀌어요. 고치려면 수정." },
      { sel: ".gd-tabs", text: "교집합을 눌러 보세요.", tap: true },
      { sel: ".gd-grid", text: "되는 사람 수가 진할수록 많고, 금색은 모두 됨, 숫자는 후보 번호. 칸을 누르면 누가 되는지." },
    ],
  },
  {
    key: "todo",
    title: "To do",
    tutorial: [
      { sel: ".todo-head", text: "일간은 0시, 주간은 목 10시에 초기화. 머리에 끝낸 수와 남은 때." },
      { sel: ".todo-row .todo-check", text: "체크 칸을 누르면 끝낸 일로. 다시 누르면 풀려요." },
      { sel: ".todo-row .todo-hit", text: "이름을 눌러 펼쳐 보세요.", tap: true },
      { sel: ".todo-detail, .todo-acts", text: "할 것과 손해 주의. 이벤트는 참여 링크. 아래 수정, 함께(언제와 같이 할 사람), 숨김." },
      { sel: ".todo-add", text: "할 일 추가. 일간, 주간, 한 번." },
    ],
  },
  {
    key: "me",
    title: "내 정보",
    tutorial: [
      { sel: ".me-hero", text: "내 카드. 사진, 길드와 직책, 직업과 레벨, 경험치." },
      { sel: ".me-row:has-text('캐릭터 정보')", text: "캐릭터 정보. 길드, 직업, 레벨, 경험치를 여기서 저장해요.", tap: true },
      { sel: ".me-row:has-text('캐릭터 사진')", text: "캐릭터 사진. 스샷 고르고 AI 보정 한 번이면 끝. 성장 랭킹에 보여요.", tap: true },
      { sel: ".me-row:has-text('내 캐릭터')", text: "내 캐릭터. 부캐를 묶고 캐릭터 추가, 본캐 지정.", tap: true },
      { sel: ".me-row:has-text('카톡 오픈프로필')", text: "카톡 오픈프로필 링크를 적으면 내 이름 옆에 카톡 단추.", tap: true },
      { sel: ".me-row:has-text('날씨 반영')", text: "날씨 반영. 위치 허용과 비, 눈, 함박눈 미리 보기.", tap: true },
      { sel: ".me-logout, button:has-text('로그아웃')", text: "로그아웃. 밑의 회색 계정 삭제는 운영진이 승낙하면 지워져요." },
    ],
  },
  {
    key: "alerts",
    title: "알림",
    tutorial: [
      { sel: ".alert-list", text: "알림을 누르면 그 화면으로. 다른 캐릭터 것은 이름표. 열면 모두 읽음." },
      { sel: ".alert-prefs", text: "알림 설정. 메뉴별로 켜고 끄고, 폰 표시는 폰 알림만. 맨 위 폰 알림을 켜면 앱을 안 열어도 폰에." },
    ],
  },
  {
    key: "search",
    title: "검색",
    tutorial: [
      { sel: ".search-box", text: "아이템, 몬스터, 사냥터 이름. 초성이나 한두 글자 틀려도 찾아요. 결과 줄의 별은 즐겨찾기." },
      { sel: ".search-recent, .panel, main", text: "비어 있으면 최근 검색과 즐겨찾기." },
    ],
  },
  {
    key: "info",
    title: "정보",
    tutorial: [
      { sel: ".tiles", text: "위키. 사냥터, 장비, 육성 공략, 직업별 스킬, 조합책, 강화·보석·성장, 인던·길드던전, 전장·헌팅그라운드, 퀘스트·지도, 공식 확률." },
      { sel: ".tile:has-text('사냥터')", text: "사냥터를 눌러 보세요.", tap: true },
      { sel: ".region-tabs, .region", text: "지역별 사냥터. 누르면 몬스터와 드랍, 지도, 옆 사냥터. 글 맨 위 카페 원글." },
    ],
  },
  {
    key: "chat",
    title: "AI 챗봇",
    tutorial: [
      { sel: ".chat-compose", text: "사파이어 길잡이. 위키와 길드 앱 자료로 답하고 없으면 웹을 찾아요. 나, 내가 지금 할 것처럼 물으면 내 레벨과 직업으로." },
      { sel: "button[aria-label='첨부']", text: "첨부. 사진 4장, PDF, 글 파일. 게임 스샷을 주면 직업과 레벨을 읽어 맞는 공략." },
      { sel: ".topbar-action:has-text('목록')", text: "목록. 지난 대화를 이어서, 고정, 이름 변경, 삭제. 답이 별로면 별로를 눌러 개발자에게." },
    ],
  },
  {
    key: "admin",
    title: "길드원 관리",
    tutorial: [
      { sel: ".signup-row", text: "아이디 생성 요청과 계정 삭제 요청. 승낙, 거절." },
      { sel: ".admin-search, .filter", text: "닉네임 찾기와 거르기. 1군, 2군, 오피서 이상, 비밀번호 바꾸기 전, 직업·레벨 안 정함." },
      { sel: ".account-list .account-row", text: "사람 줄을 눌러 보세요.", tap: true },
      { sel: ".account-panel", text: "역할, 정보 수정(길드·직업·레벨·카톡), 성장 기록, 고스펙, 비밀번호 초기화(123123), 계정 통합, 닉네임 변경, 계정 삭제." },
    ],
  },
  {
    key: "log",
    title: "사용 기록",
    tutorial: [
      { sel: ".log-storage", text: "기록 수와 DB 크기. 자세히로 무엇이 큰지." },
      { sel: ".log-people", text: "사람별 7일. 기기 수, 새 기기, 같은 때 다른 곳. 닉네임을 눌러 보세요.", tap: true },
      { sel: ".log-list", text: "그 사람의 접속, 화면, 한 일. 같은 메뉴 묶음을 누르면 하나씩. 더 보기로 처음까지." },
    ],
  },
  {
    key: "gaps",
    title: "챗봇 개선",
    tutorial: [
      { sel: ".pill-row", text: "대기와 개선함." },
      { sel: ".gap-card", text: "챗봇이 몰라 짐작한 답과 별로를 받은 답. 답 보기, 목록 복사로 개발자에게, 고치면 개선 완료(물은 사람에게 알림)." },
    ],
  },
  {
    key: "odds",
    title: "공식 확률",
    tutorial: [
      { sel: ".odds-cats", text: "컴투스 공식 확률표. 분류를 눌러 보세요.", tap: true },
      { sel: ".odds-panel, .odds-group", text: "표 목록. 누르면 확률, 많으면 더 보기. 찾기로 아이템이나 상자 이름." },
    ],
  },
];

export const guideOf = (key: string) => GUIDES.find((g) => g.key === key) ?? null;
/** 제목으로 (TopBar 가 title 만 안다). 챗봇은 대화 제목이 떠 있어도 */
export const guideByTitle = (title: string) => GUIDES.find((g) => g.title === title || (g.key === "chat" && title === "챗봇")) ?? null;
