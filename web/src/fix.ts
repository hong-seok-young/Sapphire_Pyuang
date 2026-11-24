// 오류·개선 접수 (제작자 2026-11-18): 메뉴 위 줄 🔔 왼쪽 경광등 단추 -> 접수 창 (pages/FixReport.tsx), 운영진 '개선 접수'(#/gaps) · 내 접수(#/fix) (pages/FixDesk.tsx).
// 서버 server/fix.ts, functions/api/fix
import { ApiError, api } from "./auth";
import { shrinkPhoto } from "./board";
import { INFO_TILES, ITEMS } from "./launcher";
import { PATCHES } from "./patchnotes";

export const FIX_KINDS = { bug: "오류·오정보", ux: "불편", idea: "개선 아이디어" } as const;
export type FixKind = keyof typeof FIX_KINDS;
export type FixStatus = "new" | "doing" | "done";
export const STATUS_NAME: Record<FixStatus, string> = { new: "접수", doing: "처리 중", done: "고침" };
export const SHOTS_MAX = 3;

export interface FixReport {
  id: number;
  user_id: string;
  kind: FixKind;
  menu: string;
  menu_key: string | null;
  path: string;
  text: string;
  version: string | null;
  trail: string[];
  deviceName: string;
  status: FixStatus;
  created_at: number;
  done_at: number | null;
  done_by: string | null;
  patch: string | null;
  talk_at: number | null;
  shots: number[];
  talks: number;
}
export interface FixTalk {
  id: number;
  report_id: number;
  user_id: string;
  text: string;
  created_at: number;
  role: string | null;
}

/** 이번에 연 동안 본 화면 (접수에 '직전에 본 화면'으로 붙인다) */
const trail: string[] = [];
let tracking = false;
function track() {
  const h = location.hash || "#/";
  // 비공개 일지 화면은 접수의 '직전에 본 화면'에 넣지 않는다 (server/diary.ts)
  if (/^#\/diary(?:$|[/?])/.test(h)) return;
  if (trail[trail.length - 1] !== h) trail.push(h);
  if (trail.length > 8) trail.shift();
}
export function startFixTrail() {
  if (tracking) return;
  tracking = true;
  track();
  window.addEventListener("hashchange", track);
}

/** 지금 화면이 어느 메뉴인지: 홈 칸·정보 칸 이름, 위 줄 제목, 지금 고른 칸 단추 */
export function whereNow(): { menu: string; menuKey: string | null; path: string } {
  const path = location.hash || "#/";
  const page = path.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
  const item =
    ITEMS.find((i) => i.key !== "home" && i.match.includes(page)) ??
    INFO_TILES.find((i) => i.to.replace(/^#\/?/, "").split(/[/?]/)[0] === page);
  const top = (document.querySelector(".topbar .tb-ko, .topbar .topbar-title")?.textContent ?? "").trim();
  const tabs = [...document.querySelectorAll("main .pill-row .pill-on, main .sub-tab-on, main .main-tab-on")]
    .map((e) => (e.textContent ?? "").replace(/\d+$/, "").trim())
    .filter((t) => t && t.length <= 14);
  const head = item?.title ?? (top || "앱");
  const parts = [head];
  if (top && top !== head && top.length <= 24) parts.push(top);
  for (const t of tabs) if (!parts.includes(t)) parts.push(t);
  return { menu: parts.slice(0, 4).join(" · ").slice(0, 60), menuKey: item?.key ?? (page || null), path };
}

/** 접수 보내기 (스샷은 그 뒤 하나씩) */
export async function sendFix(
  kind: FixKind,
  text: string,
  shots: File[],
  where: { menu: string; menuKey: string | null; path: string },
): Promise<{ id: number; failed: number }> {
  const { id } = await api<{ id: number }>("/api/fix", "POST", {
    kind,
    text,
    ...where,
    version: PATCHES[0]?.version ?? "",
    trail: trail.slice(0, -1).slice(-5),
  });
  let failed = 0;
  for (const f of shots.slice(0, SHOTS_MAX)) {
    try {
      const { blob } = await shrinkPhoto(f);
      const res = await fetch(`/api/fix/${id}/shots`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": blob.type || "image/jpeg" },
        body: blob,
      });
      if (!res.ok) failed++;
    } catch {
      failed++;
    }
  }
  return { id, failed };
}

export const listFix = (status: FixStatus) => api<{ reports: FixReport[]; counts: { status: FixStatus; kind: FixKind; n: number }[] }>(`/api/fix?status=${status}`);
export const myFix = () => api<{ reports: FixReport[] }>("/api/fix?mine=1");
export const fixOne = (id: number) => api<{ talk: FixTalk[]; report: FixReport }>(`/api/fix/${id}`);
export const sayFix = (id: number, text: string) => api<{ talk: FixTalk }>(`/api/fix/${id}/talk`, "POST", { text });
export const setFixStatus = (id: number, status: FixStatus, patch?: string) =>
  api<{ ok: true }>(`/api/fix/${id}`, "PUT", { status, patch, version: PATCHES[0]?.version ?? "" });
export const deleteFix = (id: number) => api<{ ok: true }>(`/api/fix/${id}`, "DELETE");
export const shotUrl = (sid: number) => `/api/fix/shots/${sid}`;

/** 고친 접수에서 더해진 패치 내역 줄 (화면 #/patch 가 그 판에 붙인다) */
let patchLines: Promise<{ version: string; text: string }[]> | null = null;
export function extraPatchLines() {
  patchLines ??= api<{ lines: { version: string; text: string }[] }>("/api/fix/patch")
    .then((r) => r.lines)
    .catch(() => {
      patchLines = null;
      return [];
    });
  return patchLines;
}

export const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "다시 해 주세요");
