// 챗봇 오류 글 (functions/api/chat/index.ts 와 답 받기 일꾼 server/chatRun.ts 가 같이 쓴다)
import Anthropic from "@anthropic-ai/sdk";

/** 길드원에게 보여 줄 오류 글 */
/** API 크레딧(요금)이 다 떨어졌다는 오류인지 (400 'Your credit balance is too low to access the Anthropic API') */
export const isNoCredit = (e: unknown) => e instanceof Anthropic.APIError && /credit balance|billing|purchase credits/i.test(String(e.message));

export function errorText(e: unknown): string {
  if (isNoCredit(e)) return "챗봇 이용 요금이 다 떨어졌어요. 앱개발자가 충전하면 다시 쓸 수 있어요";
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

/**
 * 글자 속 짝 잃은 서로게이트(이모지를 반쯤 자른 것)를 � 로 바꾼다. 그대로 보내면 API 가 요청 본문을 JSON 으로 못 읽는다
 * (2026-11-18 '…unexpected end of hex escape at line 1 column 83931', 400: 자료를 글자 수로 자른 곳이 이모지 한가운데를 잘랐다)
 */
export function wellFormed<T>(v: T): T {
  if (typeof v === "string") {
    const s = v as string;
    const ok = (s as unknown as { isWellFormed?: () => boolean }).isWellFormed?.();
    if (ok === true) return v;
    return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD") as unknown as T;
  }
  if (Array.isArray(v)) return v.map((x) => wellFormed(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = wellFormed(x);
    return out as T;
  }
  return v;
}
