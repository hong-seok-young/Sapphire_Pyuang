// 카톡 '공유'로 받은 파일 (manifest share_target). 보통은 서비스 워커(public/sw.js)가 받아 #/talk 로 넘긴다.
// 서비스 워커가 아직 없을 때 여기로 오면 톡방 올리기 화면으로 보내고 파일 고르기로 올리게 한다
export const onRequestPost: PagesFunction = async () => new Response(null, { status: 303, headers: { location: "/#/talk?sw=0" } });
export const onRequestGet: PagesFunction = async () => new Response(null, { status: 303, headers: { location: "/#/talk" } });
