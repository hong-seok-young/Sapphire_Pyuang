// 임시 시험 (지울 것): Cloudflare 이미지 변환(cf.image)과 배경 지우기(segment)가 이 사이트에서 되는지 본다.
// 사이트에 이미 있는 공개 아이콘 하나만 쓴다 (사용자 그림은 받지 않는다).
export const onRequestGet: PagesFunction = async ({ request }) => {
  const src = new URL("/icon-192.png", request.url).toString();
  const probe = async (image: Record<string, unknown>) => {
    try {
      const r = await fetch(src, { cf: { image } } as RequestInit);
      const body = await r.arrayBuffer();
      return { status: r.status, type: r.headers.get("content-type"), resized: r.headers.get("cf-resized"), bytes: body.byteLength };
    } catch (e) {
      return { error: String(e) };
    }
  };
  const plain = await fetch(src).then(async (r) => ({ status: r.status, bytes: (await r.arrayBuffer()).byteLength }));
  return Response.json({
    plain,
    width: await probe({ width: 64, format: "png" }),
    segment: await probe({ segment: "foreground", format: "png" }),
  });
};
