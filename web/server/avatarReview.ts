// 캐릭터 사진 AI 검수의 지시문과 부르기 (functions/api/avatar/review.ts, 시험 scripts/avatar-review-test.mjs 가 같이 쓴다).
// 배경 지우기 AI 가 남긴 것 중 캐릭터가 아닌 것(remove)과 캐릭터의 각 부분(keep)에 점을 받는다
import type Anthropic from "@anthropic-ai/sdk";

/** CLAUDE.md 'AI 는 무조건 품질' */
export const MODEL = "claude-opus-5-5";
const MAX_POINTS = 24;

const POINT = {
  type: "object",
  properties: { x: { type: "integer" }, y: { type: "integer" }, what: { type: "string" } },
  required: ["x", "y", "what"],
  additionalProperties: false,
};
export const REVIEW_SCHEMA = {
  type: "object",
  properties: { remove: { type: "array", items: POINT }, keep: { type: "array", items: POINT } },
  required: ["remove", "keep"],
  additionalProperties: false,
};

export const reviewPrompt = (w: number, h: number) => `두 그림은 크기가 같다 (가로 ${w}, 세로 ${h} 픽셀, 왼쪽 위가 x=0, y=0).
첫째 그림: 모바일 도트 게임 아이모(IMO) 스샷에서 길드원이 자기 캐릭터가 네모에 꽉 차게 자른 것.
둘째 그림: 배경 지우기 AI 가 배경을 지운 결과. 지운 곳은 자홍색(#FF00FF)으로 칠했다.

할 일: 둘째 그림에 남아 있는 것(자홍색이 아닌 곳) 중에서 가운데에 있는 주인공 캐릭터 한 명이 아닌 것을 찾아 점을 찍는다.
- 캐릭터에 들어가는 것: 머리, 얼굴, 몸, 옷, 모자·투구, 손에 든 무기·방패, 등의 날개·망토, 몸에 붙은 빛·오라 효과, 발 바로 밑의 검은 그림자.
- 캐릭터가 아닌 것: 바닥 타일, 풀, 꽃, 돌, 바닥에 놓인 둥근 물체나 원판, 뒤에 있는 동상·건물·나무·울타리, 다른 캐릭터·NPC·몬스터·펫,
  이름표·길드 마크·말풍선·숫자·글자, 게임 화면의 단추. 캐릭터와 붙어 있어도 캐릭터가 아니면 찾는다.

remove: 캐릭터가 아닌 것마다 그 물체의 한가운데 안쪽(가장자리 말고, 자홍색이 아닌 곳)에 점 하나. 한 물체가 크거나 색이 여러 가지로 나뉘어 있으면 색 덩어리마다 점.
  캐릭터가 아닌 것이 남아 있지 않으면 빈 목록.
keep: 캐릭터의 각 부분(머리, 얼굴, 몸, 팔, 다리·발, 무기, 날개·효과, 그림자 등) 안쪽에 점, 5~12개. 특히 remove 점과 붙어 있는 캐릭터 부분에는 꼭 찍는다.
애매하면 지우지 말고 keep 에 둔다. 좌표는 둘째 그림의 픽셀 (정수). what 에는 무엇인지 짧게 한국어로.`;

export interface Point {
  x: number;
  y: number;
  what: string;
}

export function points(raw: unknown, w: number, h: number): Point[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), what: String(p.what ?? "").slice(0, 40) }))
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h)
    .slice(0, MAX_POINTS);
}

/** 원래 그림(JPEG base64)과 배경을 지운 그림(PNG base64, 지운 곳은 자홍색)을 보여 주고 점을 받는다. 거절이면 빈 목록 */
export async function reviewPoints(client: Anthropic, original: string, cutout: string, w: number, h: number): Promise<{ remove: Point[]; keep: Point[] }> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "high", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: original } },
          { type: "image", source: { type: "base64", media_type: "image/png", data: cutout } },
          { type: "text", text: reviewPrompt(w, h) },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") return { remove: [], keep: [] };
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const raw = JSON.parse(text) as { remove?: unknown; keep?: unknown };
  return { remove: points(raw.remove, w, h), keep: points(raw.keep, w, h) };
}
