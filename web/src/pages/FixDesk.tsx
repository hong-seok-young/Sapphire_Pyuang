// 개선 접수 (#/gaps, 오피서 이상) · 내 접수 (#/fix, 누구나) (제작자 2026-11-18 '챗봇 개선 말고 개선 접수', '어느 메뉴에서 오류가 접수된 건지, 스샷 및 내용을 보고 고칠 수 있게',
// '보는 사람은 길마 개발자 오피서, 고친 뒤 처리는 쓴 사람 + 패치 내역', '접수자와 길마 개발자 오피서가 대화할 수 있게').
// 접수 칸: 접수 · 처리 중 · 고침, 그 아래 종류 칩 (챗봇은 예전 챗봇 개선, 길드마스터·앱개발자만). 줄을 누르면 그 자리에 스샷·정보·대화·처리 단추
import { useEffect, useRef, useState } from "react";
import { RANK } from "../auth";
import type { Me } from "../auth";
import { emojiPic } from "../emojiIcons";
import { STATUS_NAME, deleteFix, errorText, fixOne, listFix, myFix, sayFix, setFixStatus, shotUrl } from "../fix";
import type { FixKind, FixReport, FixStatus, FixTalk } from "../fix";
import { KakaoButton, Nick } from "../kakao";
import { INFO_TILES, ITEMS } from "../launcher";
import { ago } from "../market";
import { markThingSeen, newsSide, thingSince, useNews } from "../news";
import { PATCHES } from "../patchnotes";
import { useEntryState } from "../router";
import type { Wiki } from "../types";
import { Loading, NewTag, NewsDot, ThingDot, TopBar } from "../ui";
import { ChatGapsPage } from "./ChatGaps";
import { ImageViewer } from "./ImageViewer";

const STATUSES: FixStatus[] = ["new", "doing", "done"];
type KindChip = "all" | FixKind | "chat";
const KIND_SHORT: Record<FixKind, string> = { bug: "오류", ux: "불편", idea: "아이디어" };
const ROLE_NAME: Record<string, string> = { master: "길마", officer: "오피서", developer: "개발자" };

/** 접수한 메뉴의 아이콘 (홈 칸·정보 칸) */
function MenuIcon({ k }: { k: string | null }) {
  const item = ITEMS.find((i) => i.key === k) ?? INFO_TILES.find((i) => i.key === k);
  const pic = item ? (item.iconPic ?? emojiPic(item.icon)) : null;
  return <span className="fx-ico">{pic ? <img src={pic} alt="" /> : (item?.icon ?? "📄")}</span>;
}

export default function FixDeskPage({ me, mine, query, wiki }: { me: Me; mine: boolean; query: URLSearchParams; wiki: Wiki | null }) {
  const staff = RANK[me.role] >= 1;
  const master = RANK[me.role] >= 2;
  const [status, setStatus] = useEntryState<FixStatus>("fix.status", "new");
  const [kind, setKind] = useEntryState<KindChip>("fix.kind", "all");
  const [list, setList] = useState<FixReport[] | null>(null);
  const [counts, setCounts] = useState<{ status: FixStatus; kind: FixKind; n: number }[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useEntryState<number | null>("fix.open", null);
  const [tick, setTick] = useState(0);
  const news = useNews();
  const asked = useRef(false);

  // 알림으로 들어오면 (?r=번호) 그 접수가 있는 칸으로 가서 펼친다
  useEffect(() => {
    const r = Number(query.get("r"));
    if (!r || asked.current) return;
    asked.current = true;
    fixOne(r).then(
      ({ report }) => {
        if (!mine) {
          setStatus(report.status);
          setKind("all");
        }
        setOpen(r);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (kind === "chat") return;
    let alive = true;
    (mine ? myFix() : listFix(status)).then(
      (r) => {
        if (!alive) return;
        setList(r.reports);
        if ("counts" in r) setCounts((r as { counts: typeof counts }).counts);
        setError("");
      },
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [mine, status, kind, tick]);
  // 보는 동안 30초마다 (대화·처리 상태)
  useEffect(() => {
    const t = window.setInterval(() => !document.hidden && setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const countOf = (s: FixStatus, k?: FixKind) => counts.filter((c) => c.status === s && (!k || c.kind === k)).reduce((n, c) => n + c.n, 0);
  const shown = (list ?? []).filter((r) => kind === "all" || kind === "chat" || r.kind === kind);

  return (
    <>
      <TopBar title={mine ? "내 접수" : "개선 접수"} />
      {!mine && (
        <>
          <div className="pill-row fx-tabs">
            {STATUSES.map((s) => (
              <button key={s} className={"pill" + (status === s && kind !== "chat" ? " pill-on" : "")} onClick={() => (setStatus(s), kind === "chat" && setKind("all"))}>
                {STATUS_NAME[s]}
                {s !== "done" && countOf(s) > 0 && <small> {countOf(s)}</small>}
                <NewsDot n={(s === "new" ? news["fix.new"] : 0) + newsSide("fix.talk", (x) => x === s)} />
              </button>
            ))}
          </div>
          <div className="sub-tabs rent-sub fx-kinds-sub">
            {(["all", "bug", "ux", "idea"] as const).map((k) => (
              <button key={k} className={"sub-tab" + (kind === k ? " sub-tab-on" : "")} onClick={() => setKind(k)}>
                {k === "all" ? "전체" : KIND_SHORT[k]}
                {k !== "all" && countOf(status, k) > 0 && <small> {countOf(status, k)}</small>}
              </button>
            ))}
            {master && (
              <button className={"sub-tab" + (kind === "chat" ? " sub-tab-on" : "")} onClick={() => setKind("chat")}>
                챗봇
              </button>
            )}
          </div>
        </>
      )}
      {kind === "chat" && !mine ? (
        <ChatGapsPage role={me.role} wiki={wiki} embedded />
      ) : (
        <>
          {error && <p className="form-error">{error}</p>}
          {list === null && !error && <Loading />}
          {list !== null && shown.length === 0 && (
            <p className="muted fx-empty">
              {mine ? "아직 보낸 접수가 없어요. 메뉴 위 줄의 경광등 단추로 보내요." : status === "new" ? "새 접수가 없어요" : "없어요"}
            </p>
          )}
          <ul className="fx-list">
            {shown.map((r) => (
              <FixRow
                key={r.id}
                r={r}
                me={me}
                staff={staff}
                mine={mine}
                open={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                onChanged={() => setTick((n) => n + 1)}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function FixRow({
  r,
  me,
  staff,
  mine,
  open,
  onToggle,
  onChanged,
}: {
  r: FixReport;
  me: Me;
  staff: boolean;
  mine: boolean;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const el = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) el.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <li ref={el} className={"fx-row" + (open ? " fx-row-open" : "")}>
      <button className="fx-row-head" onClick={onToggle}>
        <MenuIcon k={r.menu_key} />
        <span className="fx-row-main">
          <span className="fx-row-top">
            <i className={"fx-kind fx-kind-" + r.kind}>{KIND_SHORT[r.kind]}</i>
            {mine && <i className={"fx-st fx-st-" + r.status}>{STATUS_NAME[r.status]}</i>}
            <span className="fx-menu">{r.menu}</span>
            <ThingDot k={`fixt:${r.id}`} />
          </span>
          <span className="fx-row-text">{r.text}</span>
          <span className="fx-row-meta">
            {!mine && (
              <>
                <Nick name={r.user_id} /> <KakaoButton name={r.user_id} nested />
                {" · "}
              </>
            )}
            {ago(r.created_at)}
            {r.shots.length > 0 && ` · 스샷 ${r.shots.length}`}
            {r.talks > 0 && ` · 대화 ${r.talks}`}
            {r.status === "done" && r.patch && ` · 고침`}
          </span>
        </span>
      </button>
      {open && <FixDetail r={r} me={me} staff={staff} onChanged={onChanged} />}
    </li>
  );
}

function FixDetail({ r, me, staff, onChanged }: { r: FixReport; me: Me; staff: boolean; onChanged: () => void }) {
  const [talk, setTalk] = useState<FixTalk[] | null>(null);
  const [say, setSay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<number | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  // 열었을 때: 그 전에 본 때 (그 뒤에 남이 쓴 대화에 N)
  const [since] = useState(() => thingSince(`fixt:${r.id}`));
  const load = () =>
    fixOne(r.id).then(
      (x) => setTalk(x.talk),
      (e) => setError(errorText(e)),
    );
  useEffect(() => {
    void load();
    markThingSeen(`fixt:${r.id}`);
    const t = window.setInterval(() => !document.hidden && void load(), 20_000);
    return () => window.clearInterval(t);
  }, [r.id]);

  async function send() {
    const text = say.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const { talk: t } = await sayFix(r.id, text);
      setTalk([...(talk ?? []), t]);
      setSay("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const mineChars = me.characters?.map((c) => c.id) ?? [me.id];

  return (
    <div className="fx-detail">
      <p className="fx-full">{r.text}</p>
      {r.shots.length > 0 && (
        <div className="fx-shots fx-shots-view">
          {r.shots.map((sid, i) => (
            <button key={sid} className="fx-shot" onClick={() => setView(i)} aria-label="스샷 크게">
              <img src={shotUrl(sid)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {view !== null && <ImageViewer images={r.shots.map((sid) => ({ src: shotUrl(sid) }))} start={view} onClose={() => setView(null)} />}
      <dl className="fx-info">
        <dt>메뉴</dt>
        <dd>{r.menu}</dd>
        <dt>화면</dt>
        <dd>
          <a href={r.path}>{decodeURIComponentSafe(r.path)}</a>
        </dd>
        {staff && r.deviceName && (
          <>
            <dt>기기</dt>
            <dd>{r.deviceName}</dd>
          </>
        )}
        {r.version && (
          <>
            <dt>앱</dt>
            <dd>v{r.version}</dd>
          </>
        )}
        {staff && r.trail.length > 0 && (
          <>
            <dt>직전</dt>
            <dd>{r.trail.map(decodeURIComponentSafe).join(" → ")}</dd>
          </>
        )}
        <dt>때</dt>
        <dd>{new Date(r.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</dd>
        {r.status === "done" && r.patch && (
          <>
            <dt>고침</dt>
            <dd className="fx-patch">{r.patch}</dd>
          </>
        )}
      </dl>

      <div className="fx-talk">
        <h4>대화</h4>
        {talk === null && <p className="muted">불러오는 중…</p>}
        {talk?.length === 0 && <p className="muted fx-talk-none">{staff ? "쓴 사람에게 물어볼 것이 있으면 여기에" : "운영진과 이야기할 것이 있으면 여기에"}</p>}
        {talk?.map((t) => {
          const own = mineChars.includes(t.user_id);
          return (
            <div key={t.id} className={"fx-say" + (own ? " fx-say-me" : "")}>
              <span className="fx-say-who">
                <NewTag on={!own && t.created_at > since} />
                <Nick name={t.user_id} />
                {ROLE_NAME[t.role ?? ""] && <i className="fx-role">{ROLE_NAME[t.role ?? ""]}</i>}
                <small>{ago(t.created_at)}</small>
              </span>
              <span className="fx-say-text">{t.text}</span>
            </div>
          );
        })}
        <div className="fx-say-box">
          <input value={say} maxLength={500} placeholder="대화 쓰기" onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className="pill" disabled={busy || !say.trim()} onClick={send}>
            보내기
          </button>
        </div>
      </div>

      {staff && (
        <div className="fx-acts">
          {patch !== null ? (
            <div className="fx-patch-box">
              <label>
                패치 내역 v{PATCHES[0]?.version ?? ""} 에 넣을 한 줄
                <input value={patch} maxLength={80} onChange={(e) => setPatch(e.target.value)} placeholder="예: 시세 동향 골드 시세 오류 수정" />
              </label>
              <div className="pill-row">
                <button className="pill" onClick={() => setPatch(null)}>
                  취소
                </button>
                <button className="pill pill-on" disabled={busy || !patch.trim()} onClick={() => act(() => setFixStatus(r.id, "done", patch.trim()))}>
                  고침 · 알림
                </button>
              </div>
            </div>
          ) : (
            <div className="pill-row">
              {r.status !== "new" && (
                <button className="pill" disabled={busy} onClick={() => act(() => setFixStatus(r.id, "new"))}>
                  다시 접수
                </button>
              )}
              {r.status === "new" && (
                <button className="pill" disabled={busy} onClick={() => act(() => setFixStatus(r.id, "doing"))}>
                  처리 중
                </button>
              )}
              {r.status !== "done" && (
                <button className="pill pill-on" onClick={() => setPatch(`${r.menu.split(" · ")[0]} ${r.kind === "idea" ? "개선" : "수정"}`)}>
                  고침
                </button>
              )}
              <button className={"pill" + (del ? " fx-del-sure" : "")} disabled={busy} onClick={() => (del ? act(() => deleteFix(r.id)) : setDel(true))}>
                {del ? "정말 삭제" : "삭제"}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
