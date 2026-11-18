// 예전 '공유 → Sapphire'(manifest share_target)는 뺐다 (제작자 2026-11-18 '공유 사파이어 이딴 건 없어 카톡에').
// 예전에 깐 홈 화면 앱이 아직 이 주소로 보내면 톡방 올리기 화면으로 보낸다 (파일 고르기로 올린다)
export const onRequestPost: PagesFunction = async () => new Response(null, { status: 303, headers: { location: "/#/talk" } });
export const onRequestGet: PagesFunction = async () => new Response(null, { status: 303, headers: { location: "/#/talk" } });
