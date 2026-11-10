// 생일 콤보 실시간 (제작자 2026-11-08 '1위가 계속 누르고 있으면 그 수치가 남들한테도 계속 올라가는 걸로 보이게, 끝나고 반영하지 말고 실시간으로 몇 번 누르는지').
// 생일마다 Durable Object 하나 (답 받기 일꾼 Worker sapphire-chat-runner 안). 보는 사람은 모두 WebSocket 으로 붙어 있고,
// 누르는 사람은 지금 콤보를 1초에 한 번쯤 보낸다. 받을 때마다 지금 누르는 사람들의 콤보를 모두에게 그대로 퍼뜨린다.
// D1 에 쓰지 않는다 (메모리만, 잠들면 비고 누르는 사람이 다시 채운다). 무료 요금제: WebSocket 은 쉬는 동안 잠드는 방식(acceptWebSocket),
// 들어오는 글 20개가 요청 하나로 세어진다. 사이트는 /api/bday/live 가 로그인을 보고 user 를 붙여 넘긴다 (이 Worker 는 바깥 주소가 없다)
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./auth";

/** 이만큼 소식이 없으면 그만 누른 것으로 본다 */
const STALE_MS = 4000;
/** 퍼뜨리기는 이만큼에 한 번까지 (그 사이 것은 모아서) */
const SEND_GAP = 250;

interface Live {
  combo: number;
  at: number;
}

export class BdayLive extends DurableObject<Env> {
  private live = new Map<string, Live>();
  private lastSend = 0;
  private pending = false;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
    const user = new URL(request.url).searchParams.get("user") ?? "";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ user });
    server.send(JSON.stringify({ live: this.snapshot() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const { user } = (ws.deserializeAttachment() ?? {}) as { user?: string };
    if (!user || typeof message !== "string" || message.length > 200) return;
    let n = NaN;
    try {
      n = Number((JSON.parse(message) as { combo?: unknown }).combo);
    } catch {
      return;
    }
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return;
    if (n === 0) this.live.delete(user);
    else this.live.set(user, { combo: n, at: Date.now() });
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    const { user } = (ws.deserializeAttachment() ?? {}) as { user?: string };
    if (user && this.live.delete(user)) this.broadcast();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  private snapshot() {
    const now = Date.now();
    const out: { id: string; combo: number }[] = [];
    for (const [id, v] of this.live) {
      if (now - v.at > STALE_MS) this.live.delete(id);
      else out.push({ id, combo: v.combo });
    }
    return out;
  }

  private broadcast() {
    const now = Date.now();
    if (now - this.lastSend < SEND_GAP) {
      if (!this.pending) {
        this.pending = true;
        setTimeout(() => {
          this.pending = false;
          this.broadcast();
        }, SEND_GAP);
      }
      return;
    }
    this.lastSend = now;
    const text = JSON.stringify({ live: this.snapshot() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* 끊긴 것 */
      }
    }
  }
}
