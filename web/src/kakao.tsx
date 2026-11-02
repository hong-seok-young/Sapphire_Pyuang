// 카톡 오픈프로필 단추 (제작자 요청 2026-11-02: 대화를 카톡 오픈프로필로 바로 그 사람 카톡이 켜지게).
// 카카오는 일반 1:1 대화창을 여는 공개 링크가 없어서, 각자 적어 둔 오픈프로필(또는 1:1 오픈채팅) 링크로 연다.
// 앱 안 대화(기록, 알림)는 그대로 두고 이름 옆에 작은 '카톡' 단추만 더한다. 링크를 안 적은 사람은 단추가 없다.
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./auth";

interface Links {
  links: Record<string, string>;
  /** 링크가 있는 운영진 (장비대여 '담당자 카톡') */
  staff: string[];
}
let data: Links = { links: {}, staff: [] };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** 처음 쓸 때 한 번 받는다 (새로 적으면 refreshKakao) */
export function refreshKakao(): Promise<void> {
  loading = api<Links>("/api/kakao")
    .then((r) => {
      data = { links: r.links ?? {}, staff: r.staff ?? [] };
      listeners.forEach((l) => l());
    })
    .catch(() => undefined);
  return loading;
}

export function useKakao(): Links {
  const d = useSyncExternalStore(subscribe, () => data);
  useEffect(() => {
    if (!loading) void refreshKakao();
  }, []);
  return d;
}

/** 내 링크 적기 (user 를 주면 그 사람 것: 운영진) */
export const saveKakao = (link: string, user?: string) => api<{ ok: boolean; link: string | null }>("/api/kakao", "PUT", { link, user });

/**
 * 이름 옆 작은 '카톡' 단추 (그 사람이 링크를 적어 뒀을 때만). label 을 주면 그 글자로.
 * mine 이면 내 글의 내 이름 옆에도 보인다 (제작자 요청 2026-11-02: 내 판매의 '퓨앙 · 방금 올림'에도): 적어 두었으면 눌러서 내 링크를 확인하고,
 * 안 적었으면 흐린 '카톡'을 눌러 내 정보의 카톡 오픈프로필로 간다
 */
export function KakaoButton({ name, label = "카톡", mine = false }: { name: string | null | undefined; label?: string; mine?: boolean }) {
  const { links } = useKakao();
  const link = name ? links[name] : undefined;
  if (!link) {
    if (!mine) return null;
    return (
      <a className="kakao-btn kakao-btn-off" href="#/me?open=kakao" onClick={(e) => e.stopPropagation()} aria-label="카톡 오픈프로필 적기">
        {label}
      </a>
    );
  }
  return (
    <a
      className="kakao-btn"
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`${name} 카톡 오픈프로필`}
    >
      {label}
    </a>
  );
}

/**
 * 링크 적는 칸 (내 정보, 길드원 관리의 '정보 수정'). user 를 주면 그 사람 것 (운영진). 비우고 저장하면 지운다
 */
export function KakaoField({ user, name }: { user?: string; name: string }) {
  const { links } = useKakao();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const value = text ?? links[name] ?? "";
  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await saveKakao(value, user);
      await refreshKakao();
      setText(null);
      setNote(r.link ? "저장했어요" : "지웠어요");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kakao-field">
      <input
        className="mk-input"
        inputMode="url"
        value={value}
        onChange={(e) => setText(e.target.value.slice(0, 80))}
        placeholder="https://open.kakao.com/o/..."
        aria-label="카톡 오픈프로필 링크"
      />
      <button className="pill" disabled={busy || text === null} onClick={() => void save()}>
        저장
      </button>
      {note && <small className="kakao-note">{note}</small>}
    </div>
  );
}
