// 메뉴 튜토리얼 글 (제작자 요청 2026-11-02: '각 메뉴에서 가장 위 제목을 누르면 … 버튼별 기능과 사용 흐름을 튜토리얼로, 권한별로'
// -> '설명서 필요 없고 바로 튜토리얼 시작하게' -> '홈 화면 설명은 길드마크 누르면. 패치나 배치도, 날씨도 비·눈·함박눈·빈 곳 누르기도 샘플로. 모든 메뉴 적용, 설명 다 빼').
// -> 같은 날 '직관적으로 한 번에 알 수 있는 설명은 다 빼': 단추 이름·탭처럼 보면 아는 것은 적지 않고, 숨은 동작(꾹 누르기, 끌기, 줄 누르면 열림)과 규칙(보증금, 초기화 때, 선착순)만.
// 제목(위 줄 배너, 홈은 길드마크)을 누르면 src/tutorial.tsx 의 Tutorial 이 화면의 그 자리를 하나씩 비춘다. 단계마다 head(무엇인지) 한 줄과 text(보면 모르는 것) 한두 문장.
// 숨은 것이 없는 메뉴(정보, 공식 확률)는 튜토리얼이 없다 (제목을 눌러도 아무 일 없음).
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
      { sel: ".hero-me", head: "내 정보 버튼", text: "캐릭터가 여러 개면 캐릭터 목록이 떠요." },
      { sel: ".home-edit", head: "배치 편집", text: "홈 칸을 꾹 눌러도 편집이 시작돼요.", tap: true },
      { sel: ".tiles", head: "칸 옮기기", text: "끌어서 옮겨요. 아래 탭에 넣거나 아래 탭 칸과 바꿀 수도 있어요." },
      { sel: ".launch-bar .pill-on", head: "완료", text: "배치는 계정에 저장돼서 다른 폰에서도 같아요.", tap: true },
      { fx: "rain", head: "비", text: "우리 동네에 비가 오면 홈에 비가 내려요. 아래 선에 빗물이 고여요." },
      { fx: "snow", head: "눈", text: "눈은 아래에 쌓여요. 안 만지고 두면 화면 위까지 차요." },
      { fx: "blizzard", head: "함박눈", text: "큰 송이가 천천히 내려요." },
      { fx: "blizzard", head: "빈 곳 누르기", text: "비나 눈이 올 때 빈 곳을 누르면 그 자리에서 팡 터져요. 눌러 보세요.", tap: true },
      { sel: ".home-version", head: "패치 내역", text: "v1.0 글씨를 누르면 바뀐 것을 볼 수 있어요.", tap: true },
    ],
  },
  {
    key: "ranking",
    title: "길드 랭킹",
    tutorial: [
      { sel: ".rank-row .nick-btn", head: "닉네임", text: "누르면 그 사람의 레벨과 경험치 그래프가 펼쳐져요.", tap: true },
      { sel: ".rank-mine-bar, .rank-mine", head: "내 줄의 경험치 막대", text: "누르면 여기서 바로 레벨과 경험치를 적어요." },
      { sel: ".rank-views button:has-text('주간')", head: "주간 성장", text: "목요일 오전 10시마다 새로 시작해요. 1등 카드의 사진은 내 정보의 캐릭터 사진이에요.", tap: true },
    ],
  },
  {
    key: "market",
    title: "사파이어 중개인",
    tutorial: [
      { sel: ".mk-list .mk-row", head: "물건 줄", text: "살래요에 흥정 가격을 붙일 수 있어요. 누가 눌렀는지와 흥정 가격은 판 사람만 봐요.", tap: true },
      { sel: ".mk-open .mk-detail", head: "정보창", text: "살래요가 2명 넘으면 경매로 바꿀 수 있어요. 올릴 때 미리 정해 두면 저절로 경매가 돼요." },
      { sel: "[role=tab]:has-text('팔기')", head: "팔기", text: "위키에 없는 물건도 올릴 수 있어요.", tap: true },
      {
        sel: ".mk-form",
        head: "스샷 올리기",
        text: "위키에 없는 이름을 적으면 스샷 올리기가 나와요. AI 가 이름, 종류, 강화를 읽어 채워요.\n가격은 현금으로 적어도 돼요. 시세로 골드를 계산해 올라가요.",
      },
    ],
  },
  {
    key: "requests",
    title: "길드원 의뢰소",
    tutorial: [
      { sel: ".mk-list .mk-row", head: "수락", text: "선착순이에요. 수락하고 이틀 안에 못 끝내면 다시 모집 중이 돼요. 실제 거래는 게임 안에서 해요." },
    ],
  },
  {
    key: "board",
    title: "게시판",
    tutorial: [
      { sel: ".main-tabs *:has-text('아이모 소식')", head: "아이모 소식", text: "컴투스 공식 공지, 점검, 이벤트가 여기 들어와요. 새 글이 오면 알림이 가요.", tap: true },
      { go: "#/board?cat=imo", sel: ".off-row", head: "공식 글", text: "누르면 앱 안에서 읽어요. 위에 AI 핵심 요약이 붙고, 패치노트면 내 직업 변경점도 나와요.", tap: true },
    ],
  },
  {
    key: "shop",
    title: "플래티넘 할인 상점",
    tutorial: [
      { sel: ".ps-limit, .ps-week", head: "플래티넘 이용한도", text: "목요일 오전 10시마다 300 이 들어와요. 안 쓴 것은 쌓여요." },
      { sel: ".ps-grid li", head: "구매 신청", text: "신청하면 이용한도에서 플래티넘이 빠져요. 골드는 게임 안에서 할인가로 내고, 취소하면 플래티넘이 돌아와요." },
    ],
  },
  {
    key: "rent",
    title: "장비대여",
    tutorial: [
      { sel: ".rent-main", head: "무기 줄", text: "왼쪽 네모는 신청 담기예요. 여러 개 담아 아래 대여 신청으로 한 번에 보내요.", tap: true },
      { sel: ".rent-pop", head: "보증금", text: "다이아 가격은 보증금이에요. 1다이아 = 10만 골드. 반납하면 마일리지와 골드를 돌려받아요." },
      { go: "#/rent?v=apps", sel: "main", head: "신청함", text: "쓰는 무기 줄에서 반납 신청과 대화를 해요. 기부한 장비의 마일리지도 여기 보여요." },
    ],
  },
  {
    key: "match",
    title: "길드 던전",
    tutorial: [
      { sel: ".gd-members", head: "파티원 카드", text: "누르면 파티장 지정, 빼기, 파티 나가기가 나와요." },
      {
        sel: ".gd-cand, .gd-confirm, .gd-state",
        head: "후보",
        text: "모두 되는 가장 빠른 때부터 1번 후보예요. 모두 확정하면 정해지고, 한 명이라도 불참이면 다음 후보로 넘어가요.",
      },
      { sel: ".gd-tabs button:has-text('내 시간표')", head: "내 시간표", text: "누르고 끌어서 되는 때를 칠해요. 손을 떼면 저장돼요.", tap: true },
      { sel: ".gd-grid", head: "시간표", text: "지난 칸도 칠할 수 있어요. 목요일 10시에 새 주가 되면 전주 복사로 가져와요." },
      { sel: ".gd-tabs button:has-text('교집합')", head: "교집합", text: "칸을 누르면 누가 되는지 보여요.", tap: true },
    ],
  },
  {
    key: "todo",
    title: "To do",
    tutorial: [
      { sel: ".todo-row .todo-hit", head: "할 일 이름", text: "누르면 할 것과 손해 주의가 펼쳐져요.", tap: true },
      { sel: ".todo-detail, .todo-acts", head: "함께", text: "고른 사람의 To do 에도 같은 줄이 생겨요. 수정과 숨김은 나에게만 적용돼요." },
    ],
  },
  {
    key: "me",
    title: "내 정보",
    tutorial: [
      { sel: ".me-row:has-text('카톡 오픈프로필')", head: "카톡 오픈프로필", text: "적어 두면 다른 길드원 화면의 내 이름 옆에 카톡 단추가 생겨요.", tap: true },
      {
        sel: ".me-row:has-text('캐릭터 정보')",
        head: "캐릭터 정보",
        text: "레벨과 경험치를 바꾸면 실제 성장인지 오타 수정인지 물어요. 오타 수정은 성장 랭킹에 안 들어가요.",
      },
      { sel: ".me-delete, .me-logout", head: "계정 삭제", text: "로그아웃 아래 회색 글씨예요. 운영진이 승낙하면 지워져요." },
    ],
  },
  {
    key: "alerts",
    title: "알림",
    tutorial: [{ sel: ".alert-prefs", head: "알림 설정", text: "종류마다 끄고, 옆의 폰 표시로 폰 알림만 따로 끌 수 있어요." }],
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
        text: "내 레벨과 직업, 길드 앱 자료까지 알아요. '내가 지금 할 것'처럼 물어보세요.\n사진을 올리면 직업과 레벨을 읽어 맞는 공략을 찾아요.",
      },
    ],
  },
  {
    key: "admin",
    title: "길드원 관리",
    tutorial: [
      { sel: ".account-list .account-row", head: "사람 줄", text: "누르면 그 아래로 관리 칸이 펼쳐져요.", tap: true },
      {
        sel: ".account-panel",
        head: "관리 칸",
        text: "새 계정과 비밀번호 초기화의 처음 비밀번호는 123123 이에요.\n계정 통합은 같은 사람의 부캐를 하나로 묶어요.",
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
      },
      { sel: ".log-list", head: "기록", text: "같은 메뉴에서 이어서 한 기록은 한 줄로 묶여요. 누르면 펼쳐져요." },
    ],
  },
  {
    key: "gaps",
    title: "챗봇 개선",
    tutorial: [
      {
        sel: ".gap-card",
        head: "모르는 질문",
        text: "목록 복사로 Claude 에게 넘겨 고친 뒤 개선 완료를 누르면, 물은 사람에게 알림이 가고 같은 질문을 다시 물어요.",
      },
    ],
  },
];

export const guideOf = (key: string) => GUIDES.find((g) => g.key === key) ?? null;
/** 제목으로 (TopBar 가 title 만 안다). 챗봇은 대화 제목이 떠 있어도 */
export const guideByTitle = (title: string) => GUIDES.find((g) => g.title === title || (g.key === "chat" && title === "챗봇")) ?? null;
