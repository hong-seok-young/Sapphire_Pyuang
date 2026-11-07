// 답 받기 일꾼 Worker (sapphire-chat-runner): 챗봇 답을 화면 연결과 상관없이 끝까지 받는 Durable Object 만 담는다 (server/chatRun.ts).
// 사이트(Cloudflare Pages)는 Durable Object 를 직접 만들 수 없어서 따로 배포하고, 사이트의 wrangler.toml 이 CHATRUN 으로 이어 쓴다.
// 바깥 주소는 없다 (workers_dev = false). 사이트 안에서만 부른다.
export { ChatRun } from "../server/chatRun";
// 생일 콤보 실시간 (server/bdayLive.ts): 사이트의 BDAYLIVE 바인딩
export { BdayLive } from "../server/bdayLive";

export default {
  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 });
  },
};
