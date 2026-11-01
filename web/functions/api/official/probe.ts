// 잠깐 쓰는 시험 (2026-11-01): Cloudflare 가 한국에서 withhive 를 부르면 한국 목록(공지 285, 이벤트 361)을 받는지. 개수만 돌려준다
export const onRequestGet: PagesFunction = async ({ request }) => {
  const total = async (type: string) => {
    const res = await fetch("https://withhive.com/api/notice/list/32", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", cookie: "language=ko" },
      body: `page=999&type=${type}&rows=1`,
    });
    const text = await res.text();
    return Number(/"total_count":(\d+)/.exec(text)?.[1] ?? -1);
  };
  const cf = (request as unknown as { cf?: { colo?: string; country?: string } }).cf;
  return new Response(JSON.stringify({ notices: await total(""), events: await total("E"), colo: cf?.colo, country: cf?.country }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
