// 임시 시험 (지울 것): AI 지우기 길(cutout_tmp 에 둔 그림을 /api/avatar/cutout/:id 로 읽어 segment)이 실제 사이트에서 되는지.
// 사이트에 이미 있는 공개 아이콘 하나만 쓴다 (사용자 그림은 받지 않는다).
import type { Env } from "../../server/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const icon = new Uint8Array(await (await fetch(new URL("/icon-192.png", request.url))).arrayBuffer());
  const id = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare("INSERT INTO cutout_tmp (id, img, type, created_at) VALUES (?, ?, ?, ?)").bind(id, icon, "image/png", Date.now()).run();
  try {
    const src = new URL(`/api/avatar/cutout/${id}`, request.url).toString();
    const plain = await fetch(src);
    const r = await fetch(src, { cf: { image: { segment: "foreground", format: "png" } } } as RequestInit);
    const body = new Uint8Array(await r.arrayBuffer());
    return Response.json({
      plain: { status: plain.status, bytes: (await plain.arrayBuffer()).byteLength },
      segment: { status: r.status, type: r.headers.get("content-type"), resized: r.headers.get("cf-resized"), bytes: body.byteLength },
    });
  } finally {
    await env.DB.prepare("DELETE FROM cutout_tmp WHERE id = ?").bind(id).run();
  }
};
