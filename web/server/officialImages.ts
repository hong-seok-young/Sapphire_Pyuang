// 공식 글 속 그림을 글자로 (제작자 요청 2026-11-06: '이벤트에 있는 모든 데이터 이미지 포함해서 싹 다 데이터화'. 유물 이벤트의 직업별 교환표처럼
// 중요한 표가 그림으로만 있어서 챗봇이 못 읽었다). 그림 하나를 Claude 가 표·글자 그대로 옮겨 D1 official_img 에 두고(주소마다 한 번, 같은 그림을 쓰는 글끼리 같이 쓴다),
// 글마다 본문 글자 속 그림 자리에 ⟦그림 N⟧ 을 넣은 것을 official_rich 에 둔다. 챗봇은 둘을 합쳐 읽는다 (server/official.ts officialContext).
// 옮기기는 GitHub Actions 가 한다 (scripts/read-official-images.mjs: 30분마다 공식 소식을 받은 뒤, 배포 때). 사람이 직접 확인한 글(비공개 자료 공식/그림글.json)은 AI 보다 먼저.
// 공식 홈페이지의 공개 글을 읽을 뿐 게임은 읽지 않는다 (CLAUDE.md 게임 안전 규칙). Node 가 타입을 지우고 그대로 읽으므로 상대 경로 import 는 두지 않는다.

/** official_rich 를 만든 방법의 판. 바꾸면 모든 글을 다시 만든다 (그림 글자는 그대로 둔다) */
export const RICH_V = "1";

/** 본문 글자 속 그림 자리 */
export const IMG_TOKEN = /⟦그림 (\d+)⟧/g;
export const imgToken = (i: number) => `⟦그림 ${i}⟧`;

/** 그림 글자가 없을 때(글자 없는 그림, 아이콘, 못 읽은 그림) 표의 text */
export const NO_TEXT = "";

/**
 * 본문 글자 속 그림 자리에 옮긴 글을 넣는다. 글자 없는 그림과 아직 못 옮긴 그림은 자리만 뺀다.
 * 그림 자리 앞뒤로 [그림 속 글자 · 그림 주소: …] … [그림 끝] 을 달아 챗봇이 본문과 그림 속 표를 구분하고 답에 그 그림을 넣게 한다
 */
export function withImages(text: string, keys: string[], texts: Map<string, string>, urls = true): string {
  return text
    .replace(IMG_TOKEN, (_, n: string) => {
      const key = keys[Number(n)] ?? "";
      const t = texts.get(key)?.trim();
      // 그림 주소도 준다: 챗봇이 답에 그 그림을 [[그림:주소|설명]] 으로 넣는다 (본문에 통째로 든 그림(data:)은 주소가 없다)
      const url = urls && key.startsWith("http") ? ` · 그림 주소: ${key}` : "";
      return t ? `\n[그림 속 글자${url}]\n${t}\n[그림 끝]\n` : "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 글 본문 + 그림 속 글자 (To do 정리, 핵심 요약이 쓴다. 제작자 2026-11-06 '시너지 다 하자': 이벤트의 표·기간이 그림에만 있는 글이 많다).
 * rich 는 official_rich 의 text·keys, texts 는 그 글 그림들의 official_img (글자 없는 그림은 ''). rich 가 없으면 원래 본문.
 * complete: 그림을 모두 옮겼는지 (아직이면 그림이 다 옮겨진 뒤 다시 만든다)
 */
export function richBody(
  body: string,
  rich: { text: string | null; keys: string | null } | null | undefined,
  texts: Map<string, string>,
  urls = false,
): { body: string; complete: boolean } {
  if (!rich?.text) return { body, complete: false };
  let keys: string[] = [];
  try {
    keys = JSON.parse(rich.keys ?? "[]") as string[];
  } catch {
    keys = [];
  }
  return { body: withImages(rich.text, keys, texts, urls), complete: keys.every((k) => texts.has(k)) };
}

/** SQL: 글(별칭 n)의 그림을 모두 옮겼는지 (official_rich 가 있고 그림마다 official_img 가 있다) */
export const RICH_DONE_SQL =
  "EXISTS (SELECT 1 FROM official_rich r WHERE r.id = n.id AND r.text IS NOT NULL AND NOT EXISTS " +
  "(SELECT 1 FROM json_each(r.keys) k LEFT JOIN official_img g ON g.key = k.value WHERE g.key IS NULL))";

/** SQL: 글 하나의 그림 글자 (?1 = 글 번호. 글자 없는 그림도 '' 로 와서 옮겼는지 알 수 있다) */
export const RICH_IMG_SQL =
  "SELECT g.key, COALESCE(g.text, '') AS text FROM official_rich r, json_each(r.keys) k JOIN official_img g ON g.key = k.value WHERE r.id = ?1";

/**
 * 게임 안 은어를 공식 글에 쓰는 말로 (제작자 2026-11-06: '유물 이벤트인데 유물깡이라고 해'). 질문에 붙여 찾기에 쓴다.
 * 화면(src/chat.ts SLANG)에도 같은 표가 있다 (위키·공식 확률 찾기). 둘을 같이 고친다
 */
export const SLANG: [RegExp, string][] = [
  [/유물\s*깡|유물\s*까기|유물\s*상자|과거의\s*유물|용사의\s*유물|유물\s*이벤트|글러트|전리품/, "과거의 유물 용사의 유물 과거의 기억 마법의유물 영웅의유물 전설의유물 전리품 글러트"],
  [/상자\s*깡/, "상자"],
  // 스킬북 은어 ('덥마북' = 더블샷 마지막 단계 스킬북. 시세 동향 build_trend.py SKILL_BOOK 과 같은 줄임말)
  [/덥마/, "더블샷4 더블샷"],
  [/와마/, "와일드스윙4 와일드스윙"],
  [/프마/, "프레임쇼크4 프레임쇼크"],
  [/수기/, "수호의기원3 수호의기원"],
  [/아프(?!다|고|서|면|네|지|니|잖)/, "아이스프리즌3 아이스프리즌"],
  [/화폭/, "화염폭풍2 화염폭풍"],
  [/치격/, "치명적일격2 치명적일격"],
  [/포아/, "포레스트아이"],
  [/마북/, "스킬북"],
];
export const slangOf = (q: string) => SLANG.filter(([re]) => re.test(q)).map(([, w]) => w).join(" ");
