import { useEffect } from "react";
import type { Me } from "../auth";
import { INFO_TILES, ITEMS, canPreview, canSee, isLocked } from "../launcher";
import type { LaunchItem } from "../launcher";
import { PATCHES, itemLink, itemText, markPatchSeen } from "../patchnotes";
import type { Patch } from "../patchnotes";
import { useEntryState } from "../router";
import { TopBar } from "../ui";

/**
 * 업데이트 소식 (#/patch, 제작자 요청 2026-11-06 '컨텐츠 추가 이런 식으로만 하고 누르면 바로 가게'):
 * 버전마다 주소를 단 줄(새 메뉴·기능)은 그 메뉴 아이콘과 '바로가기' 로 크게, 누르면 그 메뉴로 간다.
 * 나머지 줄(수정·개선)은 '그 밖의 변경 N개' 를 눌러 펼친다. 정식 오픈(v1.0) 전의 클로즈베타 기록은 맨 아래 한 묶음으로 접는다.
 * 열면 이 기기에서 본 것으로 적어 홈 맨 위 단추의 빨간 점이 사라진다 (patchnotes.ts markPatchSeen)
 */
export function PatchNotesPage({ me }: { me: Me }) {
  useEffect(() => {
    markPatchSeen(me.id);
  }, [me.id]);
  // 펼친 묶음 (뒤로 오면 그대로)
  const [open, setOpen] = useEntryState<string[]>("upd.open", []);
  const toggle = (k: string) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  const openIdx = PATCHES.findIndex((p) => p.version === "1.0" && p.date === "11.01");
  const live = openIdx < 0 ? PATCHES : PATCHES.slice(0, openIdx + 1);
  const beta = openIdx < 0 ? [] : PATCHES.slice(openIdx + 1);
  const betaOpen = open.includes("beta");

  return (
    <>
      <TopBar title="업데이트 소식" />
      <ol className="patch-list">
        {live.map((p, i) => (
          <PatchCard key={"v" + i} p={p} now={i === 0} me={me} open={open.includes("v" + i)} onToggle={() => toggle("v" + i)} />
        ))}
      </ol>
      {beta.length > 0 && (
        <>
          <button className="upd-beta" aria-expanded={betaOpen} onClick={() => toggle("beta")}>
            클로즈베타 기록 · {beta[beta.length - 1].date} ~ {beta[0].date}
            <span className="upd-chev" aria-hidden />
          </button>
          {betaOpen && (
            <ol className="patch-list">
              {beta.map((p, i) => (
                <PatchCard key={"b" + i} p={p} me={me} open={open.includes("b" + i)} onToggle={() => toggle("b" + i)} />
              ))}
            </ol>
          )}
        </>
      )}
    </>
  );
}

function PatchCard({ p, now, me, open, onToggle }: { p: Patch; now?: boolean; me: Me; open: boolean; onToggle: () => void }) {
  const rows: { text: string; to: string; tile?: LaunchItem }[] = [];
  const rest: string[] = [];
  for (const it of p.items) {
    const to = itemLink(it);
    const tile = to ? tileOf(to) : undefined;
    // 그 사람이 못 들어가는 메뉴(운영진 칸, 개발 중)는 바로가기 없이 '그 밖의 변경' 에
    if (to && (!tile || usable(tile, me))) rows.push({ text: itemText(it), to, tile });
    else rest.push(itemText(it));
  }
  return (
    <li className={"panel patch" + (now ? " patch-now" : "")}>
      <h2 className="patch-head">
        <b>v{p.version}</b>
        {now && <span className="patch-tag">지금</span>}
        <small>{p.date}</small>
      </h2>
      {rows.length > 0 && (
        <div className="upd-rows">
          {rows.map((r) => (
            <a key={r.text} className="upd-row" href={r.to}>
              <span className="upd-ico" aria-hidden>
                {r.tile?.iconPic ? <img src={r.tile.iconPic} alt="" width={20} height={20} /> : (r.tile?.icon ?? ICON[path(r.to)] ?? "✨")}
              </span>
              <span className="upd-text">{r.text}</span>
              <span className="upd-go">바로가기</span>
            </a>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <>
          <button className="upd-more" aria-expanded={open} onClick={onToggle}>
            {rows.length ? "그 밖의 변경" : "변경"} {rest.length}개
            <span className="upd-chev" aria-hidden />
          </button>
          {open && (
            <ul className="upd-minor">
              {rest.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/** 칸이 없는 화면의 아이콘 */
const ICON: Record<string, string> = { "#/me": "👤", "#/alerts": "🔔" };

const path = (to: string) => to.split("?")[0];

/** 주소의 홈·정보 칸 (아이콘과 볼 수 있는지): 주소가 그 칸 주소이거나 그 아래 (#/chat/list -> 챗봇) */
function tileOf(to: string) {
  const p = path(to);
  return [...ITEMS, ...INFO_TILES].find((t) => t.to !== "#/" && (p === t.to || p.startsWith(t.to + "/")));
}

/** 이 사람이 들어갈 수 있는 칸인지 (운영진 칸, 개발 중 칸은 막힌 사람에게 바로가기를 달지 않는다) */
const usable = (t: LaunchItem, me: Me) => canSee(t, me) && !isLocked(t, me) && (!t.soon || canPreview(me));
