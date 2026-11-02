import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { KIND_NAME, VIA_NAME, actionText, fetchActivity, fetchUsage, pageName, sectionOf } from "../activity";
import type { ActivityRow, DeviceInfo, Kind, LogDbInfo, Person, Storage } from "../activity";
import { ago } from "../market";
import type { Wiki } from "../types";
import { Loading, TopBar } from "../ui";

const KINDS: (Kind | null)[] = [null, "visit", "view", "act"];
const SHOWN_PEOPLE = 12;

/** '오늘', '어제', '10월 29일 (목)' */
function dayText(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`;
}

const timeText = (t: number) => new Date(t).toTimeString().slice(0, 5);
const mdText = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
/** 무료 요금제의 DB 하나 크기 한도 (Cloudflare D1 Free 500MB, Workers Paid 10GB) */
const DB_LIMIT = 500 * 1024 * 1024;
const mbText = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)}KB` : `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)}MB`);

/**
 * 같은 사람이 같은 메뉴(게시판, 중개인 …)에서 잇달아 한 기록은 한 묶음으로 (제작자 요청 2026-11-02: '게시판 안에서 뭐 했는지 기록을 묶어서').
 * 사람마다 따로 이어 붙여서, 여럿이 같은 때 쓴 기록이 섞여도 끊기지 않는다. 그 사람이 다른 메뉴로 가거나 접속이 새로 되거나,
 * 날짜가 바뀌거나 30분 넘게 비면 끊는다. 하나뿐이면 그냥 한 줄. 묶음은 그 안에서 가장 나중 기록 자리에 보인다
 */
type Item = { one: ActivityRow } | { group: ActivityRow[]; section: string };
const GAP = 30 * 60_000;
function groupRows(rows: ActivityRow[]): Item[] {
  const slots: { rows: ActivityRow[]; section: string | null }[] = [];
  const open = new Map<string, { rows: ActivityRow[]; section: string | null }>();
  for (const r of rows) {
    const section = sectionOf(r);
    const cur = open.get(r.user);
    const prev = cur?.rows[cur.rows.length - 1];
    if (cur && section && cur.section === section && prev && dayText(prev.at) === dayText(r.at) && prev.at - r.at < GAP) {
      cur.rows.push(r);
      continue;
    }
    const slot = { rows: [r], section };
    slots.push(slot);
    if (section) open.set(r.user, slot);
    else open.delete(r.user);
  }
  return slots.map((g) => (g.rows.length > 1 && g.section ? { group: g.rows, section: g.section } : { one: g.rows[0] }));
}

/**
 * 사용 기록 (앱개발자만, 제작자 요청): 사람별 접속 수와 마지막으로 쓴 때, 그리고 누가 어디서 무엇을 했는지.
 * 사람을 누르면 그 사람 기록과 기기 목록, 칩으로 접속/화면/한 일만 본다. 기록은 지우지 않는다 (영구 보관).
 * 줄마다 붙던 기기·도시·IP 는 뺐다 (제작자 요청 2026-11-02: '주소 뜨는 거 불필요'. IP 는 데이터·와이파이만 바꿔도 바뀌어 다른 사람인지 알 수 없다).
 * 대신 사람마다 기기 표로 센 기기 수, '새 기기', '같은 때 다른 곳'(10분 안에 다른 기기가 다른 도시에서)을 보인다. 기록에는 그대로 남긴다
 */
export function ActivityLogPage({ wiki }: { wiki: Wiki }) {
  /** 묶음 요약에 쓰는 짧은 이름 ('게시판: 자유' -> '자유', '게시판 글: 제목' -> '제목') */
  const itemText = (r: ActivityRow) =>
    r.kind === "view" ? pageName(r.what, wiki, r.detail).replace(/^(게시판|게시판 글|아이모 소식 글|글|사냥터|몬스터|아이템|메뉴|장비|검색): /, "") : actionText(r.what, r.detail);
  const lineText = (r: ActivityRow) =>
    r.kind === "visit" ? "🟢 접속" : r.kind === "view" ? `📖 ${pageName(r.what, wiki, r.detail)}` : `✏️ ${actionText(r.what, r.detail)}`;
  const [user, setUser] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [allPeople, setAllPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<Storage | null>(null);
  /** '자세히': DB 를 무엇이 얼마나 쓰는지 */
  const [usage, setUsage] = useState<{ total: number | null; parts: { name: string; bytes: number }[] } | "loading" | null>(null);
  /** 펼친 묶음 (그 묶음 맨 위 기록 번호) */
  const [opened, setOpened] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError("");
    fetchActivity({ user, kind }).then(
      (r) => {
        if (!alive) return;
        setRows(r.rows);
        setMore(r.more);
        if (r.people) setPeople(r.people);
        if (r.storage) setStorage(r.storage);
        setDevices(r.devices ?? null);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [user, kind]);

  async function loadMore() {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const r = await fetchActivity({ user, kind, before: rows[rows.length - 1].id });
      setRows([...rows, ...r.rows]);
      setMore(r.more);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const q = squash(query);
  const found = people.filter((p) => !q || [p.id, ...(p.alts ?? [])].some((id) => squash(id).includes(q)));
  const shownPeople = q || allPeople ? found : found.slice(0, SHOWN_PEOPLE);
  let lastDay = "";

  return (
    <>
      <TopBar title="사용 기록" />
      {/* 기록은 지우지 않고 쌓는다. 한도는 DB 크기뿐이라 얼마나 찼는지 (제작자 2026-11-02 '사용 기록 무제한으로 못 쌓아?') */}
      {storage && (
        <div className="log-storage">
          <span>기록 {storage.rows.toLocaleString()}건</span>
          {storage.bytes !== null && (
            <>
              <span className="log-storage-line">
                <b>DB 1 계정·글·사진</b> {mbText(storage.bytes)} / {mbText(DB_LIMIT)}
              </span>
              <span className="log-storage-bar">
                <i style={{ width: `${Math.min(100, (storage.bytes / DB_LIMIT) * 100)}%` }} />
              </span>
            </>
          )}
          {/* 사용 기록 DB 2~10 (제작자 요청 2026-11-02: 차례로 채우고 10까지 차면 가장 오래된 것을 비운다, server/logdb.ts) */}
          {storage.logs && storage.logFull && <LogRing logs={storage.logs} full={storage.logFull} />}
          {usage === null ? (
            <button
              type="button"
              className="log-usage-btn"
              onClick={() => {
                setUsage("loading");
                fetchUsage().then(setUsage, (x) => (setError(errorText(x)), setUsage(null)));
              }}
            >
              자세히
            </button>
          ) : usage === "loading" ? (
            <span>재는 중…</span>
          ) : (
            <ul className="log-usage">
              {[...usage.parts]
                .sort((a, b) => b.bytes - a.bytes)
                .map((p) => (
                  <li key={p.name}>
                    <span>{p.name}</span>
                    <b>{mbText(p.bytes)}</b>
                  </li>
                ))}
              {usage.total !== null && (
                <li className="log-usage-etc">
                  <span>계정·글·알림·색인 등</span>
                  <b>{mbText(Math.max(0, usage.total - usage.parts.reduce((n, p) => n + p.bytes, 0)))}</b>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <section className="panel">
        <h2 className="panel-title">사람별 (7일)</h2>
        <input className="mk-input log-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 닉네임" aria-label="닉네임 찾기" />
        <ul className="log-people">
          {shownPeople.map((p) => (
            <li key={p.id}>
              <button className={"log-person" + (user === p.id ? " log-person-on" : "")} onClick={() => setUser(user === p.id ? null : p.id)}>
                <b>{p.id}</b>
                <span>
                  접속 {p.visits7}번 <small>(30일 {p.visits30})</small> · 화면 {p.views7} · 한 일 {p.acts7}
                </span>
                <small>
                  {p.last ? `${ago(p.last)}${p.lastVia ? ` · ${VIA_NAME[p.lastVia]}` : ""}` : "기록 없음"}
                  {/* 부캐 묶기: 같은 사람의 캐릭터를 합친 줄 */}
                  {p.alts?.length ? ` · 부캐 ${p.alts.join(", ")}` : ""}
                  {p.devices7 > 1 && ` · 기기 ${p.devices7}대`}
                  {p.newDev && <em className="log-flag log-flag-new">새 기기</em>}
                  {p.together > 0 && <em className="log-flag log-flag-warn">같은 때 다른 곳 {p.together}</em>}
                </small>
              </button>
            </li>
          ))}
        </ul>
        {!q && !allPeople && found.length > SHOWN_PEOPLE && (
          <button className="pill" onClick={() => setAllPeople(true)}>
            모두 보기 ({found.length}명)
          </button>
        )}
      </section>

      {/* 고른 사람의 기기 (60일): 기기와 브라우저, 처음·마지막, 접속 수, 도시 */}
      {user && devices && devices.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">{user}의 기기 (60일)</h2>
          <ul className="log-devs">
            {devices.map((d, i) => (
              <li key={i} className={"log-dev" + (d.legacy ? " log-dev-old" : "")}>
                <b>
                  {d.name ?? "알 수 없는 기기"}
                  {d.isNew && <em className="log-flag log-flag-new">새 기기</em>}
                </b>
                <small>
                  {mdText(d.first)} ~ {ago(d.last)} · 접속 {d.visits} · 기록 {d.n}
                  {d.cities.length > 0 && ` · ${d.cities.join(", ")}`}
                  {d.chars.length > 1 && ` · ${d.chars.join(", ")}`}
                  {d.legacy && " · 11/2 전 기록이라 같은 기종 폰이 하나로 묶임"}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="filter">
        {user && (
          <button className="pill pill-on" onClick={() => setUser(null)}>
            {user} ✕
          </button>
        )}
        {KINDS.map((k) => (
          <button key={k ?? "all"} className={"pill" + (kind === k ? " pill-on" : "")} onClick={() => setKind(k)}>
            {k ? KIND_NAME[k] : "전체"}
          </button>
        ))}
      </div>

      {!rows ? (
        <Loading error={error} />
      ) : rows.length === 0 ? (
        <div className="empty">아직 기록이 없어요.</div>
      ) : (
        <ol className="log-list">
          {groupRows(rows).map((it) => {
            const first = "one" in it ? it.one : it.group[0];
            const day = dayText(first.at);
            const head = day !== lastDay;
            lastDay = day;
            if ("one" in it) {
              const r = it.one;
              return (
                <li key={r.id}>
                  {head && <h3 className="log-day">{day}</h3>}
                  <div className={"log-row log-" + r.kind}>
                    <time>{timeText(r.at)}</time>
                    <span>
                      <b>{r.user}</b>
                      {r.via && <small> · {VIA_NAME[r.via]}</small>}
                      <br />
                      {lineText(r)}
                    </span>
                  </div>
                </li>
              );
            }
            // 묶음: 메뉴 이름과 화면·한 일 수, 무엇을 봤는지 짧게. 누르면 그 안의 기록을 처음부터 차례로
            const g = it.group;
            const last = g[g.length - 1];
            const views = g.filter((r) => r.kind === "view").length;
            const acts = g.length - views;
            const names = [...new Set([...g].reverse().map(itemText).filter((t) => t !== it.section))];
            const open = opened.has(first.id);
            return (
              <li key={first.id}>
                {head && <h3 className="log-day">{day}</h3>}
                <button
                  className={"log-row log-group" + (open ? " log-group-open" : "")}
                  aria-expanded={open}
                  onClick={() =>
                    setOpened((o) => {
                      const n = new Set(o);
                      if (n.has(first.id)) n.delete(first.id);
                      else n.add(first.id);
                      return n;
                    })
                  }
                >
                  <time>
                    {timeText(first.at)}
                    <small>~{timeText(last.at)}</small>
                  </time>
                  <span>
                    <b>{first.user}</b>
                    {first.via && <small> · {VIA_NAME[first.via]}</small>}
                    <br />
                    📚 {it.section}
                    <small className="log-group-n">
                      {" "}
                      · 화면 {views}
                      {acts > 0 && ` · 한 일 ${acts}`}
                    </small>
                    {names.length > 0 && (
                      <small className="log-group-sum">
                        {names.slice(0, 3).join(" · ")}
                        {names.length > 3 && ` 외 ${names.length - 3}`}
                      </small>
                    )}
                  </span>
                  <i className="log-chev" aria-hidden />
                </button>
                {open && (
                  <ol className="log-sub">
                    {[...g].reverse().map((r) => (
                      <li key={r.id} className={"log-" + r.kind}>
                        <time>{timeText(r.at)}</time>
                        <span>{lineText(r)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {error && rows && <p className="form-error">{error}</p>}
      {more && rows && (
        <div className="links">
          <button className="btn btn-ghost" disabled={busy} onClick={loadMore}>
            {busy ? "불러오는 중…" : "더 보기"}
          </button>
        </div>
      )}
    </>
  );
}

/** 사용 기록 DB 2~10: 칸마다 찬 만큼, 지금 쓰는 칸은 금색 테두리 */
function LogRing({ logs, full }: { logs: LogDbInfo[]; full: number }) {
  const cur = logs.find((l) => l.cur);
  return (
    <>
      <span className="log-storage-line">
        <b>사용 기록 DB 2~10</b>
        {cur && cur.bytes !== null && ` 지금 DB ${cur.n} ${mbText(cur.bytes)} / ${mbText(full)}`}
      </span>
      <span className="log-ring" role="img" aria-label={`사용 기록 DB ${cur ? cur.n : 2}에 쓰는 중`}>
        {logs.map((l) => (
          <span key={l.n} className={"log-ring-cell" + (l.cur ? " log-ring-cur" : "") + (l.since === null ? " log-ring-empty" : "")}>
            <i style={{ height: `${l.since === null || l.bytes === null ? 0 : Math.min(100, Math.max(4, (l.bytes / full) * 100))}%` }} />
            <small>{l.n}</small>
          </span>
        ))}
      </span>
    </>
  );
}
