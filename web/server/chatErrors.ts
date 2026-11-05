// 챗봇 오류 글 (functions/api/chat/index.ts 와 답 받기 일꾼 server/chatRun.ts 가 같이 쓴다)
import Anthropic from "@anthropic-ai/sdk";

/** 길드원에게 보여 줄 오류 글 */
export function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return "챗봇 API 키에 문제가 있어요. 앱개발자에게 알려 주세요";
  }
  if (e instanceof Anthropic.RateLimitError) return "지금 질문이 몰렸어요. 잠시 뒤에 다시 물어봐 주세요";
  if (e instanceof Anthropic.BadRequestError) return "질문을 처리하지 못했어요. 첨부를 빼거나 질문을 바꿔 다시 해 주세요";
  if (e instanceof Anthropic.APIConnectionError) return "AI 서버에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요";
  if (e instanceof Anthropic.APIError) return "AI 서버가 바빠요. 잠시 뒤에 다시 물어봐 주세요";
  return "답을 받다가 문제가 생겼어요";
}

/** 앱개발자에게만 붙이는 실제 오류 (상태 코드와 API 메시지, 키 같은 비밀값은 들어 있지 않다) */
export function errorCause(e: unknown): string {
  if (e instanceof Anthropic.APIError) return ` [원인 ${e.status ?? "-"}: ${String(e.message).slice(0, 200)}]`;
  return ` [원인: ${String(e instanceof Error ? e.message : e).slice(0, 200)}]`;
}

/** 웹 찾기를 쓸 수 없는 계정(콘솔에서 꺼 둔 경우)이라 웹 없이 다시 물어야 하는 오류인지 */
export const isWebOff = (e: unknown) =>
  (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.PermissionDeniedError) && /web_(search|fetch)|tool/i.test(String(e.message));
