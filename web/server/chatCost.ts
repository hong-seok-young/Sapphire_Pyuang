// 확률형 상품의 기대값·비용 계산 자료 (제작자 요청 2026-11-06: '유물깡으로 덥마북을 뽑는다고 하면 기대값이 어떻게 되고 얼마를 써야 되고,
// 현금이면 얼마, 골드로 하면 얼마, 확률형 이벤트·뽑기는 그런 것까지 다 계산해서 대답'). 챗봇이 확률표(공식 글 그림·공식 확률)와 이 자료로 직접 계산한다
// (계산하는 법은 server/chatPrompt.ts). 플래티넘 충전표는 플래티넘 상점 예산 검토와 같은 게임 상점 정가 (src/platshop.ts PLAT_PACKS, 제작자가 준 자료),
// 플래티넘 -> 골드는 플래티넘 상점 설정의 시중가, 현금 -> 골드는 사파이어 중개인 골드 팝니다 글의 평균 (없으면 75:1).
// Node 가 타입을 지우고 그대로 읽으므로 상대 경로 import 는 타입만 둔다.
import type { Env } from "./auth";

/** 이런 말이 있으면 붙인다 */
export const COST_ASK =
  /확률|기대|뽑|가챠|상자|깡|현질|과금|얼마|몇 ?개|몇 ?번|몇 ?판|몇 ?회|플래|플티|원어치|골드로|현금|비용|패키지|유물|전리품|스킬북|마북|북 |북$|북\?|천장/;

/** 게임 상점 플래티넘 충전 상품 (정가, src/platshop.ts PLAT_PACKS 와 같다) */
const PLAT_PACKS = [
  { plat: 13000, won: 110_000 },
  { plat: 6250, won: 55_000 },
  { plat: 2400, won: 22_000 },
  { plat: 1150, won: 11_000 },
  { plat: 550, won: 5_500 },
  { plat: 315, won: 3_300 },
  { plat: 100, won: 1_100 },
];

/**
 * 플래티넘으로 파는 확률형 상품의 가격 (공식 글에 없어서 제작자가 알려 준 것). 이름: 플래티넘.
 * 모르는 상품은 챗봇이 몇 개(회)가 필요한지까지만 계산하고 가격을 묻는다.
 * 과거의 유물: 제작자 2026-11-06 카페 글 스샷 ('[이벤트] 영웅의 유물 확률 & 회수율 정리', 2026-08-13 회차: 1개 600플, 10개 5,700플)
 */
const PRICES: Record<string, number> = {
  "과거의 유물 (과거의기억 x1 + 남겨진흔적 x1, 캐릭터당 50회)": 600,
  "과거의 유물 패키지 (과거의기억 x10 + 남겨진흔적 x10, 캐릭터당 15회)": 5700,
};

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export async function costContext(env: Env, question: string): Promise<string> {
  if (!COST_ASK.test(question)) return "";
  const [plat, gold] = await Promise.all([
    env.DB.prepare("SELECT ratio, high_ratio, market FROM plat_settings WHERE id = 1")
      .first<{ ratio: number; high_ratio: number; market: number }>()
      .catch(() => null),
    env.DB.prepare("SELECT AVG(rate) AS rate, COUNT(*) AS n FROM gold_offers WHERE status = 'open' AND side = 'sell'")
      .first<{ rate: number | null; n: number }>()
      .catch(() => null),
  ]);
  const market = plat?.market ?? 7;
  const rate = gold?.rate ? Math.round(gold.rate * 10) / 10 : 75;
  const lines = [
    `플래티넘 충전 (게임 상점 정가): ${PLAT_PACKS.map((p) => `${p.plat.toLocaleString("ko-KR")}플 ${won(p.won)} (1플 ${(p.won / p.plat).toFixed(2)}원)`).join(" · ")}`,
    `가장 싸게 사면 1플 ${(PLAT_PACKS[0].won / PLAT_PACKS[0].plat).toFixed(2)}원 (13,000플 상품), 조금씩 사면 1플 11원 (100플 상품). 원스토어 결제는 그때그때 18~30% 할인이 붙기도 한다 (할인 전 정가로 계산하고 할인은 따로 말한다)`,
    `플래티넘 -> 골드: 시중 시세 100플 = ${market}만 골드 (1플 = ${(market * 100).toLocaleString("ko-KR")}골드). 길드 플래티넘 할인 상점은 1군 ${plat?.ratio ?? 5}만, 고스펙 ${plat?.high_ratio ?? 4}만 골드 (100플당)`,
    `현금 -> 골드: 1만 원 = ${rate}만 골드 (${gold?.n ? `사파이어 중개인 골드 팝니다 글 ${gold.n}개 평균` : "보통 시세"})`,
    Object.keys(PRICES).length
      ? `알려진 상품 가격 (공식 글에는 없어서 길드원이 알려 준 값, 회차마다 다를 수 있다): ${Object.entries(PRICES).map(([k, v]) => `${k} ${v.toLocaleString("ko-KR")}플`).join(" · ")}`
      : "",
    "여기 없는 상품 가격(플래티넘)은 모른다. 가격을 모르는 상품은 몇 개(회)가 필요한지까지 계산하고, 가격(몇 플인지)을 알려 주면 현금·골드로 바꿔 주겠다고 말한다",
  ];
  return lines.filter(Boolean).join("\n");
}
