// 오류·개선 접수 (제작자 2026-11-18 '각 버튼 들어가면 알림 종 왼쪽에 오류 개선 접수하는 버튼, 스샷도 올리고 정보도 적게',
// '어느 메뉴에서 오류가 접수된 건지, 스샷 및 내용을 보고 고칠 수 있게', '보는 사람은 길마 개발자 오피서', '고친 뒤는 쓴 사람 + 패치 내역',
// '접수하고 나서도 접수자와 길마 개발자 오피서가 대화할 수 있게').
// 표는 schema.sql 의 fix_reports · fix_shots · fix_talk · patch_extra, 화면은 src/pages/FixReport.tsx (접수 창) · src/pages/FixDesk.tsx (개선 접수 · 내 접수)
import { RANK } from "./auth";
import type { Env, User } from "./auth";

export const FIX_KINDS = { bug: "오류·오정보", ux: "불편", idea: "개선 아이디어" } as const;
export type FixKind = keyof typeof FIX_KINDS;
export const isFixKind = (k: unknown): k is FixKind => typeof k === "string" && k in FIX_KINDS;
export const FIX_STATUS = ["new", "doing", "done"] as const;
export type FixStatus = (typeof FIX_STATUS)[number];
/** 접수 하나에 스샷 몇 장 · 한 장 크기 (사진은 화면이 긴 변 1600px JPEG 로 줄여 보낸다) */
export const SHOTS_MAX = 3;
export const SHOT_MAX_BYTES = 1_900_000;

/** 개선 접수를 보고 처리하는 사람: 오피서·길드마스터·앱개발자 (묶은 캐릭터 중 가장 높은 역할) */
export const canSeeFix = (me: User) => RANK[me.role] >= 1;

/** 내 캐릭터의 접수인지 (부캐를 묶었으면 그 캐릭터들 모두) */
export const ownsFix = (me: User, userId: string) => (me.chars ?? [me.id]).includes(userId);

export interface FixRow {
  id: number;
  user_id: string;
  kind: FixKind;
  menu: string;
  menu_key: string | null;
  path: string;
  text: string;
  device: string | null;
  version: string | null;
  trail: string | null;
  status: FixStatus;
  created_at: number;
  done_at: number | null;
  done_by: string | null;
  patch: string | null;
  talk_at: number | null;
}

export async function loadFix(env: Env, id: number): Promise<FixRow | null> {
  return await env.DB.prepare("SELECT * FROM fix_reports WHERE id = ?").bind(id).first<FixRow>();
}

/** 접수를 받는 사람들 (본캐에게, 알림은 묶은 캐릭터 알림함에 같이 보인다) */
export async function fixStaff(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT COALESCE(main_id, id) AS id FROM users WHERE role IN ('officer', 'master', 'developer')",
  ).all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 기기·브라우저 한 줄 (User-Agent 에서): '안드로이드 · 삼성 인터넷 · 앱' */
export function deviceText(ua: string | null): string {
  if (!ua) return "";
  const os = /iPhone|iPad/.test(ua) ? "아이폰" : /Android/.test(ua) ? "안드로이드" : /Windows/.test(ua) ? "윈도우" : /Mac OS/.test(ua) ? "맥" : "기타";
  const model = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim();
  const br = /SamsungBrowser/.test(ua)
    ? "삼성 인터넷"
    : /KAKAOTALK/.test(ua)
      ? "카카오톡"
      : /NAVER/.test(ua)
        ? "네이버 앱"
        : /CriOS|Chrome/.test(ua)
          ? "크롬"
          : /Safari/.test(ua)
            ? "사파리"
            : "브라우저";
  const app = /SapphireFloat/.test(ua) ? " · 게임 위 창" : /SapphireApp/.test(ua) ? " · 앱" : / wv\)/.test(ua) ? "" : "";
  return [os, model && model !== "K" ? model : "", br].filter(Boolean).join(" · ") + app;
}

/** 알림에 보일 짧은 글 */
export const clip = (s: string, n = 40) => (s.length > n ? s.slice(0, n) + "…" : s);
