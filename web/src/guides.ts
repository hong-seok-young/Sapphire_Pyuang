// 메뉴 튜토리얼 글 (제작자 요청 2026-11-02: '각 메뉴에서 가장 위 제목을 누르면 … 버튼별 기능과 사용 흐름을 튜토리얼로, 권한별로'
// -> '설명서 필요 없고 바로 튜토리얼 시작하게' -> '홈 화면 설명은 길드마크 누르면. 패치나 배치도, 날씨도 비·눈·함박눈·빈 곳 누르기도 샘플로. 모든 메뉴 적용, 설명 다 빼').
// 제목(위 줄 배너, 홈은 길드마크)을 누르면 src/tutorial.tsx 의 Tutorial 이 화면의 그 자리를 하나씩 비추며 짧게 말한다. 글은 설명 문장이 아니라 이름 몇 마디.
// 단계는 그 사람의 권한(who)에 맞는 것만 돌고, 자리를 못 찾으면(자료가 없어서) 건너뛴다. 새 메뉴를 만들거나 단추를 바꾸면 여기도 같이 고친다. 이모지는 쓰지 않는다.
import type { Me } from "./auth";
import { RANK, TEST_IDS } from "./auth";
import type { Sky } from "./weather";

/** 누구에게 보이는 단계인지: all 모두 | main 1군 | officer 오피서 이상 | master 길드마스터·앱개발자 | developer 앱개발자 | rentStaff 장비대여 운영(길드마스터·대여 담당·앱개발자) */
export type Who = "all" | "main" | "officer" | "master" | "developer" | "rentStaff";

export interface GuideStep {
  /** 비출 곳 (CSS 선택자, 쉼표로 여럿이면 처음 보이는 것. ':has-text('글')' 도 됨). 없으면 화면 전체 */
  sel?: string;
  text: string;
  /** true 면 그 자리를 직접 누르면 다음으로 (바꾸지 않는 것만: 칸 열기, 탭 바꾸기). 다음을 눌러도 된다. fx 와 같이 쓰면 빈 곳을 누르면 다음으로 */
  tap?: boolean;
  /** 이 단계 전에 이동할 주소 */
  go?: string;
  /** 날씨 샘플: 이 단계 동안 그 날씨 효과를 화면에 그린다 (홈, 제작자 요청 2026-11-02) */
  fx?: Sky;
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
      { sel: ".hero-bell", text: "알림" },
      { sel: ".hero-me", text: "내 정보. 캐릭터를 묶었으면 목록" },
      { sel: ".tiles", text: "메뉴. 띠는 들어갈 수 있는 사람, 빨간 숫자는 새 글" },
      { sel: ".home-edit", text: "배치 편집", tap: true },
      { sel: ".tiles", text: "끌어서 옮기기. 아래 탭과도 바꿔요" },
      { sel: ".launch-bar .pill-on", text: "완료", tap: true },
      { fx: "rain", text: "비 샘플. 아래 선에 빗물이 고여요" },
      { fx: "snow", text: "눈 샘플. 쌓여요" },
      { fx: "blizzard", text: "함박눈 샘플" },
      { fx: "blizzard", text: "빈 곳을 눌러 보세요", tap: true },
      { sel: ".home-version", text: "패치 내역", tap: true },
      { go: "#/patch", sel: "main", text: "버전마다 바뀐 것" },
      { go: "#/", sel: ".tabbar", text: "아래 탭" },
    ],
  },
  {
    key: "ranking",
    title: "길드 랭킹",
    tutorial: [
      { sel: ".rank-views button:has-text('주간')", text: "주간 성장", tap: true },
      { sel: ".growth-hero", text: "이번 주 성장왕. 목 10시에 새로" },
      { sel: ".rank-views button:has-text('레벨')", text: "레벨", tap: true },
      { sel: ".rank-filters", text: "길드, 직업 거르기" },
      { sel: ".rank-row .nick-btn", text: "닉네임: 성장 그래프", tap: true },
      { sel: ".rank-mine", text: "내 줄. 경험치 막대를 눌러 바로 적기" },
      { sel: ".rank-mine-bar", text: "레벨업: 레벨, 경험치 적기" },
    ],
  },
  {
    key: "market",
    title: "사파이어 중개인",
    tutorial: [
      { sel: ".mk-tabs, .main-tabs", text: "사기, 내 판매, 팔기, 골드" },
      { sel: ".mk-list .mk-row", text: "물건", tap: true },
      { sel: ".mk-open .mk-detail", text: "정보창. 살래요(흥정 가격은 판 사람만), 경매는 입찰, 카톡" },
      { sel: ".mk-open .mk-talk-btn", text: "토론방" },
      { sel: "[role=tab]:has-text('팔기')", text: "팔기", tap: true },
      { sel: ".mk-form", text: "이름, 수량, 가격, 바로 판매 또는 경매. 위키에 없으면 스샷 올리기" },
      { sel: "[role=tab]:has-text('내 판매')", text: "내 판매", tap: true },
      { sel: ".mk-list .mk-row", text: "거래 완료, 가격 변경, 삭제, 경매 전환" },
      { sel: "[role=tab]:has-text('골드')", text: "골드", tap: true },
      { sel: ".mk-list, main", text: "골드 팝니다, 삽니다. 만 골드 단위, 시세" },
    ],
  },
  {
    key: "requests",
    title: "길드원 의뢰소",
    tutorial: [
      { sel: ".mk-cats", text: "모집 중, 진행 중, 완료, 내 의뢰" },
      { sel: ".mk-list .mk-row", text: "의뢰", tap: true },
      { sel: ".mk-open .mk-detail", text: "수락하면 내 것. 이틀 안에 못 하면 다시 모집. 의뢰한 사람은 완료" },
      { sel: "button:has-text('의뢰 등록')", text: "의뢰 등록: 무엇을, 보상" },
    ],
  },
  {
    key: "board",
    title: "게시판",
    tutorial: [
      { sel: ".main-tabs *:has-text('아이모 소식')", text: "아이모 소식", tap: true },
      { sel: ".pill-row", text: "공지사항, 점검, 이벤트" },
      { sel: ".off-row", text: "글", tap: true },
      { sel: ".off-sum, .off-body, main", text: "핵심 요약, 원문 보기" },
      { go: "#/board?cat=free", sel: ".bd-write", text: "글쓰기: 사진, 파일, 링크" },
      { sel: ".bd-write", text: "공지, 이벤트는 AI로 다듬기", who: "officer" },
      { sel: ".bd-list .bd-row", text: "댓글, 답글, 좋아요. 운영진은 고정" },
    ],
  },
  {
    key: "shop",
    title: "플래티넘 할인 상점",
    tutorial: [
      { sel: ".ps-tabs", text: "상점, 내 신청" },
      { sel: ".ps-limit, .ps-week", text: "이용한도. 목 10시마다 300" },
      { sel: ".ps-grid li", text: "물건", tap: true },
      { sel: ".ps-contents", text: "들어 있는 아이템. 구매 신청" },
      { go: "#/shop?v=orders", sel: ".ps-orders, .ps-order", text: "신청: 거래 완료", who: "officer" },
      { go: "#/shop?v=settle", sel: ".st-cards, .st-list, main", text: "정산: 기록, 구매자, 아이템", who: "officer" },
    ],
  },
  {
    key: "rent",
    title: "장비대여",
    tutorial: [
      { sel: ".rent-views", text: "목록, 신청함, 운영, 기록" },
      { sel: ".rent-sub", text: "직업" },
      { sel: ".rent-main", text: "무기. 왼쪽 네모는 신청 담기", tap: true },
      { sel: ".rent-pop", text: "기한, 보증금(1다이아 = 10만 골드), 쓰는 사람, 대기" },
      { go: "#/rent?v=apps", sel: "main", text: "신청함: 마일리지, 내 신청서, 대화, 반납 신청" },
      { go: "#/rent?v=staff", sel: ".rent-sub", text: "운영: 장비대여, 장비반납, 물건 추가, 기부 현황", who: "rentStaff" },
      { sel: ".rent-app", text: "수락, 대여 완료(보증금), 거절, 대화", who: "rentStaff" },
      { go: "#/rent?v=log", sel: ".rent-log", text: "기록", who: "rentStaff" },
    ],
  },
  {
    key: "match",
    title: "길드 던전",
    tutorial: [
      { sel: ".gd-party", text: "내 파티. 4명, 만든 사람이 파티장" },
      { sel: ".gd-members", text: "내 카드: 파티 나가기. 남의 카드: 파티장 지정, 빼기" },
      { sel: ".gd-cand, .gd-confirm, .gd-state", text: "지금 후보. 확정 또는 불참. 모두 확정하면 결정" },
      { sel: ".gd-tabs", text: "내 시간표", tap: true },
      { sel: ".gd-grid", text: "누르고 끌어 칠하기. 전주 복사" },
      { sel: ".gd-lock", text: "확정하면 잠김. 수정으로 풀기" },
      { sel: ".gd-tabs", text: "교집합", tap: true },
      { sel: ".gd-grid", text: "금색은 모두 됨, 숫자는 후보 번호" },
    ],
  },
  {
    key: "todo",
    title: "To do",
    tutorial: [
      { sel: ".todo-head", text: "일간 0시, 주간 목 10시 초기화" },
      { sel: ".todo-row .todo-check", text: "체크: 끝낸 일로" },
      { sel: ".todo-row .todo-hit", text: "이름", tap: true },
      { sel: ".todo-detail, .todo-acts", text: "할 것, 손해 주의. 수정, 함께, 숨김" },
      { sel: ".todo-add", text: "할 일 추가" },
    ],
  },
  {
    key: "me",
    title: "내 정보",
    tutorial: [
      { sel: ".me-hero", text: "내 카드" },
      { sel: ".me-row:has-text('캐릭터 정보')", text: "캐릭터 정보: 길드, 직업, 레벨, 경험치", tap: true },
      { sel: ".me-row:has-text('캐릭터 사진')", text: "캐릭터 사진: 스샷 고르기, AI 보정", tap: true },
      { sel: ".me-row:has-text('내 캐릭터')", text: "내 캐릭터: 부캐, 본캐 지정", tap: true },
      { sel: ".me-row:has-text('카톡 오픈프로필')", text: "카톡 오픈프로필: 내 이름 옆 카톡 단추", tap: true },
      { sel: ".me-row:has-text('날씨 반영')", text: "날씨 반영: 위치 허용, 미리 보기", tap: true },
      { sel: ".me-logout, button:has-text('로그아웃')", text: "로그아웃. 회색 계정 삭제는 운영진 승낙 뒤" },
    ],
  },
  {
    key: "alerts",
    title: "알림",
    tutorial: [
      { sel: ".alert-list", text: "알림. 누르면 그 화면" },
      { sel: ".alert-prefs", text: "알림 설정. 폰 알림" },
    ],
  },
  {
    key: "search",
    title: "검색",
    tutorial: [
      { sel: ".search-box", text: "이름, 초성, 오타도" },
      { sel: ".search-recent, .panel, main", text: "최근 검색, 즐겨찾기" },
    ],
  },
  {
    key: "info",
    title: "정보",
    tutorial: [
      { sel: ".tiles", text: "위키" },
      { sel: ".tile:has-text('사냥터')", text: "사냥터", tap: true },
      { sel: ".region-tabs, .region", text: "지역별 사냥터" },
    ],
  },
  {
    key: "chat",
    title: "AI 챗봇",
    tutorial: [
      { sel: ".chat-compose", text: "길잡이. 나, 할 것을 물으면 내 레벨과 직업으로" },
      { sel: "button[aria-label='첨부']", text: "첨부: 사진, PDF, 글 파일" },
      { sel: ".topbar-action:has-text('목록')", text: "목록: 지난 대화" },
    ],
  },
  {
    key: "admin",
    title: "길드원 관리",
    tutorial: [
      { sel: ".signup-row", text: "아이디 생성 요청, 계정 삭제 요청" },
      { sel: ".admin-search, .filter", text: "찾기, 거르기" },
      { sel: ".account-list .account-row", text: "사람 줄", tap: true },
      { sel: ".account-panel", text: "역할, 정보 수정, 성장 기록, 고스펙, 비밀번호 초기화, 계정 통합" },
    ],
  },
  {
    key: "log",
    title: "사용 기록",
    tutorial: [
      { sel: ".log-storage", text: "기록 수, DB" },
      { sel: ".log-people", text: "사람별 7일", tap: true },
      { sel: ".log-list", text: "접속, 화면, 한 일. 묶음은 눌러 펼치기" },
    ],
  },
  {
    key: "gaps",
    title: "챗봇 개선",
    tutorial: [
      { sel: ".pill-row", text: "대기, 개선함" },
      { sel: ".gap-card", text: "모르는 질문. 답 보기, 개선 완료" },
    ],
  },
  {
    key: "odds",
    title: "공식 확률",
    tutorial: [
      { sel: ".odds-cats", text: "분류", tap: true },
      { sel: ".odds-panel, .odds-group", text: "표. 찾기" },
    ],
  },
];

export const guideOf = (key: string) => GUIDES.find((g) => g.key === key) ?? null;
/** 제목으로 (TopBar 가 title 만 안다). 챗봇은 대화 제목이 떠 있어도 */
export const guideByTitle = (title: string) => GUIDES.find((g) => g.title === title || (g.key === "chat" && title === "챗봇")) ?? null;
