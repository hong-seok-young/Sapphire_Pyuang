// 확률 시뮬레이터의 명성과 계급 (제작자 2026-11-19 '통합 랭킹, 계급으로만 표현', '계급도 엄청 다양하게, 플레이 시간 엄청 길게 보고 수백 가지, 어디가 끝인지 절대 모르게',
// '재밌는 용어', '앞에 계급장, 누가 봐도 이 사람이 더 높구나', '테두리·애니메이션도 높아질수록 점점 더').
// 명성 = 지금까지 쓴 코인 (서버 sim_wallet.spent). 계급 n 이 되는 명성 = round(10 x n^2.15) (서버 server/simcoin.ts tierXp 와 같은 식).
// 칭호 66개 x 다섯 계급(1 → 5) = 330 계급, 그 뒤는 '이름 없는 신 N' 으로 끝없이 이어진다. 화면에는 다음 계급 하나만 보인다 (끝이 어디인지 보이지 않게).
// 계급장(pages/SimBadge.tsx): 칭호 여섯마다 재질(나무 → 무쇠 → 청동 → 은 → 금 → 에메랄드 → 사파이어 → 루비 → 자수정 → 오팔 → 우주 → 그 너머)이 바뀌고,
// 재질 안에서는 가운데 그림(동전 → 망치 → 클로버 → 보석 → 별 → 왕관), 아래 다섯 칸은 그 칭호 안의 계급.

export const TIER_TITLES = [
  // 나무
  "구경꾼", "동전 줍는 사람", "견습 도박꾼", "망치 든 초보", "똥손", "기도 메타 입문자",
  // 무쇠
  "마법서 수집가", "터진 장비 수집가", "파괴 전문가", "확률의 노예", "강화 중독 초기", "손맛 본 사람",
  // 청동
  "운 좋은 길드원", "동네 승부사", "존버 장인", "한 방 노리는 자", "영끌 강화러", "야수의 심장",
  // 은
  "은손", "행운의 손", "대장간 단골", "뽑기 중독자", "풀매수 전사", "강화 장인",
  // 금
  "금손", "타짜", "확률 학자", "모루의 주인", "기적 수집가", "명장",
  // 에메랄드
  "행운 독점자", "불굴의 망치", "확률 조작 의심자", "강화의 달인", "대박 전문가", "길드의 전설",
  // 사파이어
  "사파이어 승부사", "파괴를 모르는 자", "천운아", "도박 귀신", "강화의 왕", "신의 손",
  // 루비
  "불타는 망치", "운명의 지배자", "확률 파괴자", "기적의 대장장이", "행운의 화신", "강화의 신",
  // 자수정
  "도박의 신", "신화 속 망치", "별을 강화한 자", "운명의 설계자", "차원 강화사", "전설 그 자체",
  // 오팔
  "무지개 손", "확률의 창조주", "은하 승부사", "별빛 대장장이", "우주의 타짜", "시간을 강화한 자",
  // 우주
  "무한의 손", "초월자", "태초의 망치", "운명 그 자체", "끝을 본 자", "끝 너머의 자",
];
/** 칭호 하나의 계급 수 */
export const GRADES = 5;
/** 이름이 있는 계급 수 (그 뒤는 끝없이) */
export const NAMED = TIER_TITLES.length * GRADES;
const BEYOND = "이름 없는 신";
export const ERA_NAMES = ["나무", "무쇠", "청동", "은", "금", "에메랄드", "사파이어", "루비", "자수정", "오팔", "우주", "태초"];

/** 계급 n 이 되는 명성 */
export const tierXp = (n: number) => Math.round(10 * Math.pow(Math.max(0, n), 2.15));
/** 명성으로 계급 번호 (0 부터) */
export function rankOf(xp: number): number {
  let n = Math.max(0, Math.floor(Math.pow(Math.max(0, xp) / 10, 1 / 2.15)));
  while (tierXp(n + 1) <= xp) n++;
  while (n > 0 && tierXp(n) > xp) n--;
  return n;
}

export interface Tier {
  /** 계급 번호 (0 부터, 끝없이) */
  n: number;
  /** 재질 0 ~ 11 (11 = 이름 있는 계급을 다 넘은 뒤) */
  era: number;
  /** 가운데 그림 0 ~ 5 (동전 · 망치 · 클로버 · 보석 · 별 · 왕관) */
  fam: number;
  /** 칭호 안의 계급 1 ~ 5 (아래 다섯 칸) */
  grade: number;
  title: string;
  /** 칭호와 계급: '금손 3' */
  name: string;
  /** 이 계급이 시작하는 명성과 다음 계급이 되는 명성 */
  from: number;
  next: number;
}
export function tierAt(n: number): Tier {
  const k = Math.max(0, Math.floor(n));
  if (k >= NAMED) {
    const over = k - NAMED + 1;
    return { n: k, era: 11, fam: 5, grade: GRADES, title: BEYOND, name: `${BEYOND} ${over.toLocaleString()}`, from: tierXp(k), next: tierXp(k + 1) };
  }
  const t = Math.floor(k / GRADES);
  const grade = (k % GRADES) + 1;
  return { n: k, era: Math.floor(t / 6), fam: t % 6, grade, title: TIER_TITLES[t], name: `${TIER_TITLES[t]} ${grade}`, from: tierXp(k), next: tierXp(k + 1) };
}
export const tierOfXp = (xp: number) => tierAt(rankOf(xp));
/** 다음 계급까지 얼마나 왔나 (0 ~ 1) */
export const tierProgress = (xp: number, t: Tier = tierOfXp(xp)) => Math.min(1, Math.max(0, (xp - t.from) / Math.max(1, t.next - t.from)));
/** 새 칭호가 됐나 (다섯 계급마다, 전광판에 알린다) */
export const isNewTitle = (n: number) => n > 0 && n % GRADES === 0;
