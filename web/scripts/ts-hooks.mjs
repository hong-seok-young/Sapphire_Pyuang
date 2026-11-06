// node --experimental-strip-types 로 server/*.ts 를 그대로 읽을 때, 확장자 없는 상대 경로 import('./officialText')를 .ts 로 찾아 준다.
// 쓰는 법: node --import ./scripts/ts-hooks.mjs --experimental-strip-types scripts/chat-test.mjs
import { register } from "node:module";
if (!globalThis.__tsHooks) {
  globalThis.__tsHooks = true;
  register(
    "data:text/javascript," +
      encodeURIComponent(
        "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.\\w+$/.test(s)) return next(s + '.ts', c); throw e; } }",
      ),
  );
}
