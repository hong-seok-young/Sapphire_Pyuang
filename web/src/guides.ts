// 메뉴 튜토리얼 글 (제작자 요청 2026-11-02: '각 메뉴에서 가장 위 제목을 누르면 … 버튼별 기능과 사용 흐름을 튜토리얼로, 권한별로'
// -> '설명서 필요 없고 바로 튜토리얼 시작하게' -> '홈 화면 설명은 길드마크 누르면. 패치나 배치도, 날씨도 비·눈·함박눈·빈 곳 누르기도 샘플로. 모든 메뉴 적용, 설명 다 빼').
// -> 같은 날 '직관적으로 한 번에 알 수 있는 설명은 다 빼': 단추 이름·탭처럼 보면 아는 것은 적지 않고, 숨은 동작(꾹 누르기, 끌기, 줄 누르면 열림)과 규칙(보증금, 초기화 때, 선착순)만.
// 제목(위 줄 배너, 홈은 길드마크)을 누르면 src/tutorial.tsx 의 Tutorial 이 화면의 그 자리를 하나씩 비춘다. 단계마다 head(무엇인지) 한 줄과 text(보면 모르는 것) 한두 문장.
// 자료가 있어야 보이는 줄(물건, 의뢰, 무기, 파티, 모르는 질문, 이벤트 할 일)은 튜토리얼 동안 예시 자료(src/sample.ts, '예시' 표)를 끼워 넣어 늘 보인다
// (제작자 2026-11-03: 내 물건으로 설명하다 지우면? 의뢰소는 '설명할 게 없다'고 떴다). 선택자는 '[data-tut-sample] …' 을 먼저 둔다.
// 숨은 것이 없는 메뉴(정보, 공식 확률)는 튜토리얼이 없다 (제목을 눌러도 아무 일 없음). 첫 화면만이 아니라 안의 칸(팔기·내 판매·골드, 운영의 장비반납·물건 추가, 상점의 정산·예산,
// 내 정보의 줄들)도 들어가 보며 거기에 설명할 것이 있을 때만 (제작자 2026-11-02 '버튼 하나하나 들어가면서 거기서 설명할 게 있으면. 설명할 게 없으면 안 해도 돼').
// 단계는 그 사람의 권한(who)에 맞는 것만 돌고, 자리를 못 찾으면(자료가 없어서) 건너뛴다. 새 메뉴를 만들거나 단추를 바꾸면 여기도 같이 고친다. 이모지는 쓰지 않는다.
import type { Me } from "./auth";
import { RANK, TEST_IDS } from "./auth";
import type { Sky } from "./weather";

/** 누구에게 보이는 단계인지: all 모두 | main 1군 | officer 오피서 이상 | master 길드마스터·앱개발자 | developer 앱개발자 | rentStaff 장비대여 운영(길드마스터·대여 담당·앱개발자) */
export type Who = "all" | "main" | "officer" | "master" | "developer" | "rentStaff";

export interface GuideStep {
  /** 비출 곳 (CSS 선택자, 쉼표로 여럿이면 처음 보이는 것. ':has-text('글')' 도 됨). 없으면 화면 전체 */
  sel?: string;
  /** 무엇인지 ('내 정보 버튼', '배치 편집'). 글 상자 첫 줄에 굵게 */
  head?: string;
  /** 보면 모르는 것 한두 문장 (줄을 바꾸려면 \n). 제작자 요청 2026-11-02: 명사형일 필요 없고 '캐릭터가 여러 개면 캐릭터 목록이 떠요' 처럼 */
  text: string;
  /** true 면 그 자리를 눌러 보는 단계 (바꾸지 않는 것만: 칸 열기, 탭 바꾸기). 어디를 누르든 튜토리얼이 그 자리를 대신 눌러 주고 다음으로. fx 와 같이 쓰면 빈 곳을 누르면 다음으로 */
  tap?: boolean;
  /** 눌러 보기가 여는 것 (선택자): 벌써 보이면 다시 누르지 않고, 이전으로 돌아오면 닫는다(undo). 없으면 aria-expanded 로 안다 */
  opens?: string;
  /** 눌러 보기가 닫는 것 (선택자, 예: 완료 단추가 닫는 배치 편집 줄): 벌써 안 보이면 다시 누르지 않는다 */
  closes?: string;
  /** false 면 이전으로 돌아와도 되돌리지 않는다 (탭 바꾸기: 그 탭이 보이는 채로 설명한다) */
  undo?: false;
  /** 이 단계 동안 입력 칸(sel)에 적어 둘 예시 글 (팔기의 아이템 이름). 떠나면 원래대로 */
  type?: { sel: string; value: string };
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
      { sel: ".hero-me", head: "내 정보 버튼", text: "캐릭터가 여러 개면 캐릭터 목록이 떠요." },
      { sel: ".home-edit", head: "배치 편집", text: "홈 칸을 꾹 눌러도 편집이 시작돼요.", tap: true, opens: ".launch-bar" },
      { sel: ".tiles", head: "칸 옮기기", text: "끌어서 정해진 자리에 놓아요. 빈 자리에 놓으면 거기 그대로 있고, 다른 칸 위에 놓으면 둘이 자리를 바꿔요. 아래 탭에 넣을 수도 있어요." },
      { sel: ".launch-bar .pill-on", head: "완료", text: "배치는 계정에 저장돼서 다른 폰에서도 같아요.", tap: true, closes: ".launch-bar", undo: false },
      { sel: ".home-weather", head: "날씨 표", text: "우리 동네 날씨를 홈에 반영해요. 누르면 비, 눈, 함박눈을 미리 봐요." },
      { fx: "rain", head: "비", text: "아래 선에 빗물이 고여요." },
      { fx: "snow", head: "눈", text: "아래에 쌓여요. 안 만지고 두면 화면 위까지 차요." },
      { fx: "blizzard", head: "함박눈", text: "큰 송이가 천천히 내려요." },
      { fx: "blizzard", head: "빈 곳 누르기", text: "비나 눈이 올 때 빈 곳을 누르면 그 자리에서 팡 터져요. 눌러 보고 다음을 누르세요.", tap: true },
      { sel: ".home-version", head: "패치 내역", text: "v1.0 글씨를 누르면 바뀐 것을 볼 수 있어요.", tap: true },
    ],
  },
  {
    key: "ranking",
    title: "길드 랭킹",
    tutorial: [
      { sel: ".rank-row .nick-btn", head: "닉네임", text: "누르면 그 사람의 레벨과 경험치 그래프가 펼쳐져요.", tap: true, opens: ".gc-svg" },
      { sel: ".rank-mine-bar, .rank-mine", head: "내 줄의 경험치 막대", text: "누르면 여기서 바로 레벨과 경험치를 적어요." },
      {
        sel: ".rank-views button:has-text('주간')",
        head: "주간 성장",
        text: "목요일 오전 10시마다 새로 시작해요. 1등 카드의 사진은 내 정보의 캐릭터 사진이에요.",
        tap: true,
        opens: ".growth-hero",
        undo: false,
      },
    ],
  },
  {
    key: "market",
    title: "사파이어 중개인",
    tutorial: [
      { sel: ".mk-side", head: "팝니다 · 삽니다", text: "삽니다 글은 구하는 사람이 희망가와 조건을 적은 거예요. 팔 사람이 '팔래요'를 눌러요." },
      { sel: "[data-tut-sample] .mk-row, .mk-list .mk-row", head: "물건 줄", text: "살래요(삽니다 글은 팔래요)에 흥정 가격을 붙일 수 있어요. 누가 눌렀는지와 흥정 가격은 올린 사람만 봐요.", tap: true, opens: ".mk-open .mk-detail" },
      { sel: ".mk-open .mk-detail", head: "정보창", text: "살래요가 2명 넘으면 경매로 바꿀 수 있어요. 올릴 때 미리 정해 두면 저절로 경매가 돼요." },
      { sel: "[role=tab]:has-text('올리기')", head: "올리기", text: "맨 위에서 팝니다와 삽니다를 골라요. 예약 판매는 언제 팔지 조건(날짜, 레벨, 다음 무기 구하면)을 적어 미리 올려요.", tap: true, opens: ".mk-form", undo: false },
      {
        sel: ".mk-shot-btn",
        type: { sel: ".mk-form .mk-input", value: "길잡이의 검" },
        head: "스샷 올리기",
        text: "위키에 없는 이름을 적으면 이 단추가 나와요. 스샷을 고르면 AI 가 이름, 종류, 강화를 읽어 채워요.\n가격은 현금으로 적어도 돼요. 시세로 골드를 계산해 올라가요.",
      },
      {
        sel: "[role=tab]:has-text('내 글')",
        head: "내 글",
        text: "거래 완료를 누른 글은 30일 동안만 보여요. 경매가 끝나면 낙찰자를 보고 게임 안에서 거래한 뒤 거래 완료를 눌러요.",
        tap: true,
        undo: false,
      },
      { sel: "[role=tab]:has-text('골드')", head: "골드", text: "여기 올라온 골드 팝니다 글의 평균이 시세가 돼서 물건 가격 옆 원화 환산에 쓰여요.", tap: true, undo: false },
    ],
  },
  {
    key: "requests",
    title: "길드원 의뢰소",
    tutorial: [
      {
        sel: "[data-tut-sample] .mk-row, .mk-list .mk-row",
        head: "의뢰",
        text: "선착순이 아니에요. 여러 명이 수락할 수 있고, 거래는 게임 안에서 각자 해요. 수량이나 기한은 자세히 칸에 글로 적어요.",
        tap: true,
        opens: "[data-tut-sample] .mk-detail, .mk-list .mk-detail",
      },
      {
        sel: "[data-tut-sample] .rq-accept, .mk-list .rq-accept",
        head: "수락",
        text: "한마디에 저 20개 있어요, 토요일 밤 돼요처럼 적어요. 올린 사람에게 알림이 가고, 올린 사람이 완료를 누르면 끝나요.",
      },
    ],
  },
  {
    key: "board",
    title: "게시판",
    tutorial: [
      { sel: ".main-tabs *:has-text('건의')", head: "건의", text: "글을 올리면 길드마스터와 오피서에게 알림이 가요." },
      {
        sel: ".main-tabs *:has-text('아이모 소식')",
        head: "아이모 소식",
        text: "컴투스 공식 공지, 점검, 이벤트를 30분마다 모아 와요 (점검 글은 2분마다 확인). 새 글이 오면 알림이 가요.",
        tap: true,
        opens: ".main-tab-on:has-text('아이모 소식')",
        undo: false,
      },
      {
        go: "#/board?cat=notice",
        sel: ".bd-write",
        head: "공지 글쓰기",
        text: "공지와 길드 이벤트에는 AI로 다듬기가 있어요. 쓴 사실은 그대로 두고 공지 모양으로 다듬은 글을 먼저 보여 주고, 적용을 눌러야 바뀌어요.",
        who: "officer",
      },
      { go: "#/board?cat=imo", sel: ".off-row", head: "공식 글", text: "누르면 앱 안에서 읽어요. 처음 여는 사람 때 AI 가 핵심 요약을 만들고, 패치노트면 내 직업 변경점도 나와요.", tap: true },
    ],
  },
  {
    key: "shop",
    title: "플래티넘 할인 상점",
    tutorial: [
      { sel: ".ps-limit, .ps-week", head: "플래티넘 이용한도", text: "목요일 오전 10시마다 300 이 들어와요. 안 쓴 것은 쌓여요." },
      { sel: ".ps-grid li", head: "구매 신청", text: "신청하면 이용한도에서 플래티넘이 빠져요. 골드는 게임 안에서 할인가로 내고, 취소하면 플래티넘이 돌아와요." },
      { sel: ".ps-tabs [data-tab=pending]", head: "신청", text: "게임 안에서 건넨 뒤 거래 완료를 누르면 정산에 쌓여요.", tap: true, undo: false, who: "officer" },
      {
        sel: ".ps-tabs [data-tab=ledger]",
        head: "정산",
        text: "줄을 누르면 기록 삭제, 복구, 골드 수정이 나와요. 삭제한 줄은 합계와 그 사람 이용한도에서 빠져요.",
        tap: true,
        undo: false,
        who: "officer",
      },
      {
        sel: ".ps-tabs [data-tab=budget]",
        head: "예산",
        text: "현금으로 충전을 적으면 그 돈 안에서 플래티넘이 가장 많은 상품 조합을 골라요. 할인율은 실제 결제액에만 들어가요.",
        tap: true,
        undo: false,
        who: "officer",
      },
    ],
  },
  {
    key: "rent",
    title: "장비대여",
    tutorial: [
      { sel: "[data-tut-sample] .rent-main, .rent-main", head: "무기 줄", text: "왼쪽 네모는 신청 담기예요. 여러 개 담아 아래 대여 신청으로 한 번에 보내요.", tap: true, opens: ".rent-pop" },
      { sel: ".rent-pop", head: "보증금", text: "다이아 가격은 보증금이에요. 1다이아 = 10만 골드. 반납하면 마일리지와 골드를 돌려받아요." },
      { go: "#/rent?v=apps", sel: "main", head: "신청함", text: "쓰는 무기 줄에서 반납 신청과 대화를 해요. 기부한 장비의 마일리지도 여기 보여요." },
      {
        go: "#/rent?v=staff",
        sel: ".rent-sub button:has-text('장비대여')",
        head: "장비대여",
        text: "수락한 뒤 게임 안에서 건네고 대여 완료를 눌러요. 거기서 마일리지로 낼 다이아와 받은 골드를 적어요.",
        who: "rentStaff",
      },
      {
        sel: ".rent-sub button:has-text('장비반납')",
        head: "장비반납",
        text: "반납을 누르면 쓴 마일리지는 저절로 돌아가고 골드는 게임 안에서 돌려줘요. 줄 선 다음 사람에게 알림이 가요.",
        tap: true,
        undo: false,
        who: "rentStaff",
      },
      {
        sel: ".rent-sub button:has-text('물건 추가')",
        head: "물건 추가",
        text: "위키 무기 이름을 고르면 레벨과 옵션 칸이 채워지고, 스샷을 고르면 AI 가 읽어 채워요.\n기부와 기부 다이아를 적으면 그 사람 장부에 적립돼요.",
        tap: true,
        undo: false,
        who: "rentStaff",
      },
      { sel: ".rent-sub button:has-text('기부 현황')", head: "기부 현황", text: "사람을 누르면 기부한 무기와 장부가 나와요.", tap: true, undo: false, who: "rentStaff" },
    ],
  },
  {
    key: "match",
    title: "길드 던전",
    tutorial: [
      { sel: ".gd-members", head: "파티원 카드", text: "오른쪽은 시간표를 확정했는지예요.\n누르면 파티장 지정, 빼기, 파티 나가기가 나와요." },
      {
        sel: ".gd-cand, .gd-confirm, .gd-state",
        head: "후보",
        text: "모두 되는 가장 빠른 때부터 1번 후보예요. 모두 확정하면 정해지고, 한 명이라도 불참이면 다음 후보로 넘어가요.",
      },
      { sel: ".gd-tabs button:has-text('내 시간표')", head: "내 시간표", text: "누르고 끌어서 되는 때를 칠해요. 손을 떼면 저장돼요.", tap: true, undo: false },
      { sel: ".gd-grid", head: "시간표", text: "지난 칸도 칠할 수 있어요." },
      { sel: ".gd-tabs button:has-text('파티원')", head: "파티원", text: "파티원마다 시간표를 봐요. 나와 겹치는 때는 금색이에요.", tap: true, undo: false },
      { sel: ".gd-tabs button:has-text('교집합')", head: "교집합", text: "칸을 누르면 누가 되는지 보여요.", tap: true, undo: false },
    ],
  },
  {
    key: "todo",
    title: "To do",
    tutorial: [
      {
        sel: ".todo-head:has-text('이벤트')",
        head: "이벤트 할 일",
        text: "AI 가 컴투스 공식 글을 읽고 기간 안에 챙길 일만 뽑아요. 공식 글은 30분마다 모으고, 이 화면을 열 때도 아직 안 읽은 글을 정리해요.",
      },
      { sel: "[data-tut-sample] .todo-hit, .todo-row .todo-hit", head: "할 일 이름", text: "누르면 AI 가 요약한 할 것과 손해 주의가 펼쳐져요.", tap: true, opens: ".todo-detail, .todo-acts" },
      { sel: ".todo-detail, .todo-acts", head: "함께", text: "고른 사람의 To do 에도 같은 줄이 생겨요. 수정과 숨김은 나에게만 적용돼요." },
    ],
  },
  {
    key: "me",
    title: "내 정보",
    tutorial: [
      {
        sel: ".me-row:has-text('캐릭터 정보')",
        head: "캐릭터 정보",
        text: "레벨과 경험치를 바꾸면 실제 성장인지 오타 수정인지 물어요. 오타 수정은 성장 랭킹에 안 들어가요.",
      },
      { sel: ".me-row:has-text('캐릭터 사진')", head: "캐릭터 사진", text: "성장 랭킹 1등 카드에 나와요. 스샷을 고르고 AI 보정을 누르면 배경을 따고 가운데에 맞춰요.", tap: true },
      {
        sel: ".me-row:has-text('내 캐릭터')",
        head: "내 캐릭터",
        text: "부캐를 추가하면 운영진이 승낙한 뒤 묶여요. 본캐 지정을 누르면 로그인 아이디가 그 캐릭터로 바뀌어요.",
        tap: true,
      },
      { sel: ".me-row:has-text('닉네임 변경')", head: "닉네임 변경", text: "다른 캐릭터로 바꿨어요를 고르면 성장 기록을 새로 시작해서 랭킹이 튀지 않아요.", tap: true },
      { sel: ".me-row:has-text('카톡 오픈프로필')", head: "카톡 오픈프로필", text: "적어 두면 다른 길드원 화면의 내 이름 옆에 카톡 단추가 생겨요.", tap: true },
      { sel: ".me-delete, .me-logout", head: "계정 삭제", text: "로그아웃 아래 회색 글씨예요. 운영진이 승낙하면 지워져요." },
    ],
  },
  {
    key: "alerts",
    title: "알림",
    tutorial: [{ sel: ".alert-prefs", head: "알림 설정", text: "종류마다 끄고, 옆의 폰 표시로 폰 알림만 따로 끌 수 있어요. 새 알림은 1분마다, 홈의 새 글 숫자는 2분마다 다시 세요." }],
  },
  {
    key: "search",
    title: "검색",
    tutorial: [
      { sel: ".search-box", head: "검색 칸", text: "초성이나 한두 글자 틀린 이름도 찾아요." },
      { sel: ".search-recent, .panel, main", head: "즐겨찾기", text: "결과 줄 오른쪽의 별을 누르면 여기 모여요. 계정에 저장돼요." },
    ],
  },
  {
    key: "chat",
    title: "AI 챗봇",
    tutorial: [
      {
        sel: ".chat-compose",
        head: "질문 칸",
        text: "내 레벨과 직업, 길드 앱 자료까지 알아요. '내가 지금 할 것'처럼 물어보세요. 위키에 없으면 웹을 찾아 출처를 달아요.\n사진을 올리면 직업과 레벨을 읽어 맞는 공략을 찾아요. 답이 별로면 별로를 눌러요. 고치면 알림이 와요.",
      },
      { sel: ".topbar-action:has-text('목록')", head: "목록", text: "대화는 계정에 남아서 다른 폰에서도 이어서 물어요." },
    ],
  },
  {
    key: "admin",
    title: "길드원 관리",
    tutorial: [
      { sel: ".signup-row", head: "요청", text: "승낙하면 본인이 적은 비밀번호 그대로 계정이 생겨요." },
      { sel: ".account-list .account-row", head: "사람 줄", text: "누르면 그 아래로 관리 칸이 펼쳐져요.", tap: true },
      {
        sel: ".account-panel",
        head: "관리 칸",
        text: "새 계정과 비밀번호 초기화의 처음 비밀번호는 123123 이에요.\n계정 통합은 같은 사람의 부캐를 하나로 묶고, 성장 기록에서는 잘못 적힌 줄과 레벨업 표시를 지워요.",
      },
    ],
  },
  {
    key: "log",
    title: "사용 기록",
    tutorial: [
      {
        sel: ".log-people .log-person",
        head: "사람 줄",
        text: "금색 새 기기, 붉은 같은 때 다른 곳은 아이디를 빌려줬을 수 있다는 표시예요. 누르면 기기 목록이 나와요.",
        tap: true,
        opens: ".log-person-on",
      },
      { sel: ".log-list", head: "기록", text: "같은 메뉴에서 이어서 한 기록은 한 줄로 묶여요. 누르면 펼쳐져요." },
    ],
  },
];
// 챗봇 개선(gaps)은 튜토리얼이 없다 (제작자 2026-11-03 '챗봇 개선 설명은 빼자': 제목을 눌러도 아무 일 없고 Click! 표도 없다)

export const guideOf = (key: string) => GUIDES.find((g) => g.key === key) ?? null;
/** 제목으로 (TopBar 가 title 만 안다). 챗봇은 대화 제목이 떠 있어도 */
export const guideByTitle = (title: string) => GUIDES.find((g) => g.title === title || (g.key === "chat" && title === "챗봇")) ?? null;
