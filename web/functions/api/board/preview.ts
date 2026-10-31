// GET /api/board/preview?url= -> 글 속 링크의 미리보기 (제목, 설명, 그림, 사이트 이름). 로그인한 길드원만.
// 그 페이지 머리의 og:title, og:description, og:image (없으면 <title>)를 읽는다. 7일 동안 D1 link_previews 에 두고 쓴다.
// 유튜브는 화면이 영상 번호로 바로 미리보기를 그리므로 여기에 오지 않는다
import { NEED_LOGIN, currentUser, json } from "../../../server/auth";
import type { Env } from "../../../server/auth";

const KEEP_MS = 7 * 86_400_000;
const READ_BYTES = 300_000;

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

function meta(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content).trim().slice(0, 300) || null : null;
}

async function readPage(url: URL): Promise<Preview> {
  const res = await fetch(url.toString(), {
    headers: { "user-agent": "Mozilla/5.0 (compatible; SapphireBoard/1.0; link preview)", accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(6000),
  });
  const empty: Preview = { url: url.toString(), title: null, description: null, image: null, site: url.hostname };
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html") || !res.body) return empty;
  // 앞부분만 읽는다 (머리에 미리보기 정보가 있다)
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < READ_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  const html = new TextDecoder().decode(all);
  const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const title = meta(html, "og:title") ?? (pageTitle ? decode(pageTitle).trim().slice(0, 200) || null : null);
  let image = meta(html, "og:image") ?? meta(html, "twitter:image");
  if (image) {
    try {
      image = new URL(image, res.url).toString();
      if (!/^https?:/.test(image)) image = null;
    } catch {
      image = null;
    }
  }
  return {
    url: url.toString(),
    title,
    description: meta(html, "og:description") ?? meta(html, "description"),
    image,
    site: meta(html, "og:site_name") ?? url.hostname,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await currentUser(env, request);
  if (!me) return NEED_LOGIN();
  let url: URL;
  try {
    url = new URL(new URL(request.url).searchParams.get("url") ?? "");
  } catch {
    return json({ error: "주소가 맞지 않아요" }, 400);
  }
  if (!/^https?:$/.test(url.protocol) || url.toString().length > 500) return json({ error: "주소가 맞지 않아요" }, 400);
  const key = url.toString();
  const now = Date.now();
  const cached = await env.DB.prepare("SELECT title, description, image, site, fetched_at FROM link_previews WHERE url = ?")
    .bind(key)
    .first<Preview & { fetched_at: number }>();
  if (cached && now - cached.fetched_at < KEEP_MS) {
    return json({ url: key, title: cached.title, description: cached.description, image: cached.image, site: cached.site });
  }
  let p: Preview;
  try {
    p = await readPage(url);
  } catch {
    p = { url: key, title: null, description: null, image: null, site: url.hostname };
  }
  await env.DB.prepare(
    "INSERT INTO link_previews (url, title, description, image, site, fetched_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (url) DO UPDATE SET title = excluded.title, description = excluded.description, image = excluded.image, " +
      "site = excluded.site, fetched_at = excluded.fetched_at",
  )
    .bind(key, p.title, p.description, p.image, p.site, now)
    .run();
  return json(p);
};
