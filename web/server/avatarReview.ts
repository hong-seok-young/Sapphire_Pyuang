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
/** 지울 것은 점과 함께 그 물체를 감싸는 네모: 화면이 지우는 범위를 이 네모 안으로 막는다 (색이 비슷한 캐릭터 얼굴까지 번지지 않게) */
const REMOVE = {
  type: "object",
  properties: {
    x: { type: "integer" },
    y: { type: "integer" },
    x0: { type: "integer" },
    y0: { type: "integer" },
    x1: { type: "integer" },
    y1: { type: "integer" },
    what: { type: "string" },
  },
  required: ["x", "y", "x0", "y0", "x1", "y1", "what"],
  additionalProperties: false,
};
export const REVIEW_SCHEMA = {
  type: "object",
  properties: { remove: { type: "array", items: REMOVE }, keep: { type: "array", items: POINT } },
  required: ["remove", "keep"],
  additionalProperties: false,
};

export const reviewPrompt = (w: number, h: number, again = false) => `두 그림은 크기가 같다 (가로 ${w}, 세로 ${h} 픽셀, 왼쪽 위가 x=0, y=0).
첫째 그림: 모바일 도트 게임 아이모(IMO) 스샷에서 길드원이 자기 캐릭터가 네모에 꽉 차게 자른 것.
둘째 그림: ${again ? "배경을 지우고 한 번 검수해서 캐릭터가 아닌 것을 지운 지금 결과" : "배경 지우기 AI 가 배경을 지운 결과"}. 지운 곳은 자홍색(#FF00FF)으로 칠했다.

할 일: 가운데에 있는 주인공 캐릭터 한 명만 남기기.
- 캐릭터에 들어가는 것: 머리, 얼굴, 몸, 옷, 모자·투구, 손에 든 무기·방패, 등의 날개·망토, 몸에 붙은 빛·오라 효과, 발 바로 밑의 검은 그림자.
- 캐릭터가 아닌 것: 바닥 타일, 풀, 꽃, 돌, 바닥에 놓인 둥근 물체나 원판, 뒤에 있는 동상·건물·나무·울타리, 다른 캐릭터·NPC·몬스터·펫,
  이름표·길드 마크와 그 테두리·깃대, 말풍선, 숫자, 글자, 게임 화면의 단추. 캐릭터와 붙어 있어도 캐릭터가 아니면 찾는다.

remove: 둘째 그림에 남아 있는(자홍색이 아닌) 것 중 캐릭터가 아닌 것마다 그 물체의 안쪽(가장자리 말고)에 점 하나(x, y)와,
  그 물체에서 둘째 그림에 남아 있는 부분을 딱 맞게 감싸는 네모(왼쪽 위 x0, y0 ~ 오른쪽 아래 x1, y1). 네모 밖은 지우지 않으니 캐릭터는 되도록 네모에 넣지 않는다.
  한 물체가 크거나 색이 여러 가지로 나뉘어 있으면 색 덩어리마다 점과 네모. 가는 선(테두리, 깃대, 풀잎)은 선 위에 정확히. 남아 있지 않으면 빈 목록.
  캐릭터 바깥의 검은·갈색 테두리 선(외곽선)은 캐릭터의 일부다. 지우지 않는다.
keep: 캐릭터의 각 부분(머리, 얼굴, 몸, 팔, 다리·발, 무기, 날개·효과, 그림자 등) 안쪽에 점, 5~12개. 특히 remove 점과 붙어 있는 캐릭터 부분에는 꼭 찍는다.${
  again
    ? "\n  캐릭터의 일부인데 잘못 지워져 자홍색이 된 곳이 있으면, 첫째 그림에서 그 자리를 보고 그 자리에도 keep 점을 찍는다 (자홍색 위여도 된다). 그러면 되살린다."
    : ""
}
애매하면 지우지 말고 keep 에 둔다. 좌표는 둘째 그림의 픽셀 (정수). what 에는 무엇인지 짧게 한국어로.`;

export interface Point {
  x: number;
  y: number;
  what: string;
}
/** 지울 것: 점과 그 물체를 감싸는 네모 */
export interface RemovePoint extends Point {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const int = (v: unknown, max: number) => Math.min(max - 1, Math.max(0, Math.round(Number(v))));

export function points(raw: unknown, w: number, h: number): Point[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), what: String(p.what ?? "").slice(0, 40) }))
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h)
    .slice(0, MAX_POINTS);
}

/** 지울 것: 네모가 없거나 점을 안 감싸면 점 둘레를 조금 넓혀 쓴다 */
export function removePoints(raw: unknown, w: number, h: number): RemovePoint[] {
  if (!Array.isArray(raw)) return [];
  const pad = Math.round(Math.max(w, h) * 0.04);
  const out: RemovePoint[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const [p] = points([r], w, h);
    if (!p) continue;
    let [x0, y0, x1, y1] = [int(r.x0, w), int(r.y0, h), int(r.x1, w), int(r.y1, h)];
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    const boxed = [r.x0, r.y0, r.x1, r.y1].every((v) => v !== null && v !== "" && Number.isFinite(Number(v)));
    if (!boxed || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) {
      [x0, y0, x1, y1] = [Math.max(0, p.x - pad), Math.max(0, p.y - pad), Math.min(w - 1, p.x + pad), Math.min(h - 1, p.y + pad)];
    }
    out.push({ ...p, x0, y0, x1, y1 });
    if (out.length >= MAX_POINTS) break;
  }
  return out;
}

/** 원래 그림(JPEG base64)과 배경을 지운 그림(PNG base64, 지운 곳은 자홍색)을 보여 주고 점을 받는다. 거절이면 빈 목록 */
export async function reviewPoints(client: Anthropic, original: string, cutout: string, w: number, h: number, again = false): Promise<{ remove: RemovePoint[]; keep: Point[] }> {
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
          { type: "text", text: reviewPrompt(w, h, again) },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") return { remove: [], keep: [] };
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const raw = JSON.parse(text) as { remove?: unknown; keep?: unknown };
  return { remove: removePoints(raw.remove, w, h), keep: points(raw.keep, w, h) };
}
