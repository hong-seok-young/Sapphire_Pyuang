// 카톡 오픈프로필 단추 (제작자 요청 2026-11-02: 대화를 카톡 오픈프로필로 바로 그 사람 카톡이 켜지게).
// 카카오는 일반 1:1 대화창을 여는 공개 링크가 없어서, 각자 적어 둔 오픈프로필(또는 1:1 오픈채팅) 링크로 연다.
// 앱 안 대화(기록, 알림)는 그대로 두고 이름 옆에 작은 '카톡' 단추만 더한다. 링크를 안 적은 사람은 단추가 없다.
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./auth";

interface Links {
  links: Record<string, string>;
  /** 링크가 있는 운영진 (장비대여 '담당자 카톡') */
  staff: string[];
  /** 고스펙 닉네임 (닉네임이 뜨는 곳마다 반짝임, Nick) */
  high: string[];
}
let data: Links = { links: {}, staff: [], high: [] };
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
      data = { links: r.links ?? {}, staff: r.staff ?? [], high: r.high ?? [] };
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

/**
 * 닉네임: 고스펙이면 금빛 반짝임이 글자 위로 흐른다 (제작자 요청 2026-11-02 '고스펙 닉네임 애니메이션은 어디서든, 폰트 크기나 글씨체는 바꾸지 말고 딱 애니메이션만').
 * 글자는 그 자리의 색·크기·글꼴 그대로 두고, 같은 글자를 위에 겹쳐 반짝임 띠만 그린다 (styles.css .hs). 랭킹·길드원 관리는 예전 .hs-text 그대로
 */
export function Nick({ name }: { name: string | null | undefined }) {
  const { high } = useKakao();
  if (!name) return null;
  if (!high.includes(name)) return <>{name}</>;
  // 같은 글자 두 벌을 inline-grid 한 칸에 겹친다 (styles.css .hs). 전에는 ::after 를 절대 위치로 얹었는데 폰에서 줄 높이·글꼴 차이로 위치가 어긋났다
  // (제작자 2026-11-03 '고스펙 애니메이션이랑 닉넴 폰트랑 위치가 안 맞음')
  return (
    <span className="hs">
      <span>{name}</span>
      <span className="hs-g" aria-hidden="true">
        {name}
      </span>
      <span className="hs-s" aria-hidden="true">
        {name}
      </span>
    </span>
  );
}

/** 내 링크 적기 (user 를 주면 그 사람 것: 운영진) */
export const saveKakao = (link: string, user?: string) =>
  api<{ ok: boolean; link: string | null }>("/api/kakao", "PUT", {
    link,
    user,
  });

/** 작은 도트 말풍선 (노란 말풍선에 점 셋, 왼쪽 아래 꼬리). 길드 던전처럼 글자 '카톡' 대신 그림으로 둘 때 (제작자 2026-11-03 '카톡 말풍선 작게, 버튼도 작게') */
const BUBBLE = [
  ".1111111111.",
  "122222222221",
  "122222222221",
  "122322322321",
  "122222222221",
  "122222222221",
  ".1122111111.",
  "..121.......",
  "..11........",
];
const BUBBLE_FILL: Record<string, string> = { "1": "#191600", "2": "#fee500", "3": "#191600" };
export function KakaoBubble() {
  const rects: JSX.Element[] = [];
  BUBBLE.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (BUBBLE_FILL[c]) rects.push(<rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={BUBBLE_FILL[c]} />);
    }),
  );
  return (
    <svg className="kakao-bubble" viewBox="0 0 12 9" width={16} height={12} shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}

/**
 * 이름 옆 작은 '카톡' 단추 (그 사람이 링크를 적어 뒀을 때만). label 을 주면 그 글자로, icon 이면 글자 없이 작은 도트 말풍선만 (길드 던전).
 * mine 이면 내 글의 내 이름 옆에도 보인다 (제작자 요청 2026-11-02: 내 판매의 '퓨앙 · 방금 올림'에도): 적어 두었으면 눌러서 내 링크를 확인하고,
 * 안 적었으면 흐린 '카톡'을 눌러 내 정보의 카톡 오픈프로필로 간다
 */
export function KakaoButton({
  name,
  label = "카톡",
  mine = false,
  nested = false,
  icon = false,
}: {
  name: string | null | undefined;
  label?: string;
  mine?: boolean;
  /** 글자 대신 작은 도트 말풍선 (노란 상자 없이 말풍선이 단추) */
  icon?: boolean;
  /** 누르면 펼쳐지는 줄(단추)이나 링크 안에 둘 때: <a> 대신 span 으로 그리고, 눌러도 바깥 줄은 열리지 않는다 */
  nested?: boolean;
}) {
  const { links } = useKakao();
  const link = name ? links[name] : undefined;
  const cls = icon ? "kakao-btn kakao-ico" : "kakao-btn";
  const body = icon ? <KakaoBubble /> : label;
  if (nested) {
    if (!link) return null;
    const open = (e: {
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => {
      e.preventDefault();
      e.stopPropagation();
      // 진짜 링크를 눌러 연다 (앱 WebView 도 바깥 주소를 브라우저·카톡으로 넘기는 같은 길)
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    };
    return (
      <span
        className={cls}
        role="link"
        tabIndex={0}
        aria-label={`${name} 카톡 오픈프로필`}
        onClick={open}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(e)}
      >
        {body}
      </span>
    );
  }
  if (!link) {
    if (!mine) return null;
    return (
      <a
        className={cls + " kakao-btn-off"}
        href="#/me?open=kakao"
        onClick={(e) => e.stopPropagation()}
        aria-label="카톡 오픈프로필 적기"
      >
        {body}
      </a>
    );
  }
  return (
    <a
      className={cls}
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`${name} 카톡 오픈프로필`}
    >
      {body}
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
      <button
        className="pill"
        disabled={busy || text === null}
        onClick={() => void save()}
      >
        저장
      </button>
      {note && <small className="kakao-note">{note}</small>}
    </div>
  );
}
