import { useEffect, useState } from "react";
import { useEntryState } from "../router";
import { errorText } from "../auth";
import type { Me } from "../auth";
import { KIND_NAME, TIER_NAME, VIA_NAME, actionText, fetchActivity, fetchUsage, pageName, sectionOf, tierOf } from "../activity";
import type { ActivityRow, DashPerson, DeviceInfo, Kind, LogDbInfo, OverlapInfo, Period, Person, Storage } from "../activity";
import { ago } from "../market";
import type { Wiki } from "../types";
import { Loading, MasterNote, TopBar } from "../ui";
import {
  AiPanel,
  HeatPanel,
  KpiGrid,
  LeadPanel,
  MenuPanel,
  MiniBars,
  PersonPanel,
  ScoreRing,
  TierPanel,
  TrendPanel,
  ViaPanel,
  lastText,
  minText,
  num,
  tokText,
  useDash,
  usePerson,
} from "./LogDash";

const NO_LIVE = new Set<string>();

const KINDS: (Kind | null)[] = [null, "visit", "view", "act"];

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
/** '11/2 21:10' */
const whenText = (t: number) => {
  const d = new Date(t);
  return `${mdText(t)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};
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

/** 이번에 연 동안 받은 것: 다시 들어오면 받는 동안 바로 보인다 */
const rowsCache = new Map<string, { rows: ActivityRow[]; more: boolean }>();
const summaryCache = new Map<string, Awaited<ReturnType<typeof fetchActivity>>>();

type Tab = "dash" | "people" | "rows" | "db";
const TABS: { key: Tab; name: string }[] = [
  { key: "dash", name: "대시보드" },
  { key: "people", name: "사람" },
  { key: "rows", name: "기록" },
  { key: "db", name: "저장소" },
];
const PERIODS: { key: Period; name: string }[] = [
  { key: 1, name: "오늘" },
  { key: 7, name: "7일" },
  { key: 30, name: "30일" },
];

/**
 * 사용 기록 (길드마스터·앱개발자·유어아너, 제작자 2026-11-13 개편 '싹 개편, 유어아너도, 누가 웹과 챗봇 api 사용량이 많은가 대시보드, 차트와 애니메이션',
 * '로그인 횟수 등등 종합해서 잘 쓰는 사람과 안 쓰는 사람'). 맨 위 같은 폭 단추 대시보드 · 사람 · 기록 · 저장소, 그 아래 어두운 띠에 기간 오늘 · 7일 · 30일.
 * - 대시보드: 지금 접속 중(20초마다), 핵심 숫자(지난 기간 대비), 날마다 그림, 잘 쓰는 사람 · 안 쓰는 사람(점수로 핵심·활발·가끔·잠수), 누가 많이 쓰나(순위),
 *   언제 붐비나(요일 x 시), 많이 쓴 메뉴, 어디서 쓰나, 챗봇 · AI 사용량 (pages/LogDash.tsx, 서버 server/actDash.ts)
 * - 사람: 점수·마지막 접속·14일 막대와 기기 표시(새 기기, 다른 도시 동시 접속). 누르면 그 사람만 (날마다, 자주 쓰는 때·메뉴, 최근 챗봇 질문, 기기)
 * - 기록: 누가 어디서 무엇을 했는지 (같은 메뉴에서 이어 한 것은 한 줄로 묶음). 기록은 지우지 않는다
 * - 저장소: DB 크기와 사용 기록 DB 2~10
 */
export function ActivityLogPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const [tab, setTab] = useEntryState<Tab>("log.tab", "dash");
  const [period, setPeriod] = useEntryState<Period>("log.period", 7);
  const [user, setUser] = useEntryState<string | null>("log.user", null);
  const { dash, error } = useDash(period);
  // '지금 접속 중'은 뺐다 (2026-11-14 제작자 '지금 접속 중 중요하지 않아': 30초마다 기록 DB 를 읽어 D1 하루 읽기를 많이 썼다)
  const liveIds = NO_LIVE;
  const pick = (id: string) => {
    setUser(id);
    setTab("people");
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <TopBar title="사용 기록" />
      <MasterNote role={me.role === "developer" ? "developer" : "master"} who="길드마스터·유어아너와 개발자에게만 보이는 메뉴예요">
        길드원이 언제 접속해서 어떤 화면을 보고 무엇을 했는지 남아요. 앱을 더 낫게 고치고, 오류나 사고가 났을 때 무슨 일이 있었는지 원인을 찾으려고
        쓰는 메뉴예요. 길드원에게는 보이지 않아요.
      </MasterNote>
      <nav className="pill-row ld-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => setTab(t.key)}>
            {t.name}
          </button>
        ))}
      </nav>
      {(tab === "dash" || tab === "people") && (
        <nav className="sub-tabs ld-period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className={"sub-tab" + (period === p.key ? " sub-tab-on" : "")} onClick={() => setPeriod(p.key)}>
              {p.name}
            </button>
          ))}
        </nav>
      )}

      {tab === "dash" &&
        (!dash ? (
          <Loading error={error} />
        ) : (
          <div className="ld-dash">
            <KpiGrid dash={dash} />
            <TrendPanel dash={dash} />
            <TierPanel dash={dash} onPick={pick} />
            <LeadPanel dash={dash} onPick={pick} />
            <HeatPanel heat={dash.heat} users={dash.heatUsers} days={dash.heatDays} now={dash.now} />
            <MenuPanel secs={dash.secs} />
            <ViaPanel vias={dash.vias} />
            <AiPanel dash={dash} />
            {dash.partial && <p className="ld-score-why">지난 기록을 정리하는 중…</p>}
          </div>
        ))}
      {tab === "people" && (
        <PeopleTab
          people={dash?.people}
          today={dash?.today ?? 0}
          now={dash?.now ?? Date.now()}
          period={period}
          user={user}
          setUser={setUser}
          liveIds={liveIds}
          error={error}
          onRecords={() => setTab("rows")}
        />
      )}
      {tab === "rows" && <RecordsTab wiki={wiki} user={user} setUser={setUser} />}
      {tab === "db" && <StorageTab />}
    </>
  );
}

type Sort = "score" | "last" | "v" | "m" | "q";
const SORTS: { key: Sort; name: string }[] = [
  { key: "score", name: "점수" },
  { key: "last", name: "최근" },
  { key: "v", name: "로그인" },
  { key: "m", name: "시간" },
  { key: "q", name: "챗봇" },
];

/** 사람: 점수 고리, 마지막 접속, 14일 막대, 기기 표시. 누르면 위에 그 사람 자세히 */
function PeopleTab({
  people,
  today,
  now,
  period,
  user,
  setUser,
  liveIds,
  error,
  onRecords,
}: {
  people?: DashPerson[];
  today: number;
  now: number;
  period: Period;
  user: string | null;
  setUser: (u: string | null) => void;
  liveIds: Set<string>;
  error: string;
  onRecords: () => void;
}) {
  const [sort, setSort] = useEntryState<Sort>("log.sort", "score");
  const [query, setQuery] = useEntryState("log.q", "");
  const [all, setAll] = useState(false);
  // 기기 표시 (7일): 기기 수, 새 기기, 다른 도시 동시 접속 (part=summary)
  const [flags, setFlags] = useState<Map<string, Person>>(() => new Map((summaryCache.get("")?.people ?? []).map((p) => [p.id, p])));
  useEffect(() => {
    let alive = true;
    fetchActivity({ part: "summary" }).then(
      (r) => {
        summaryCache.set("", r);
        if (alive && r.people) setFlags(new Map(r.people.map((p) => [p.id, p])));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  const { data, error: perr } = usePerson(user, period);
  if (!people) return <Loading error={error} />;
  const q = squash(query);
  const key = (p: DashPerson) =>
    sort === "score" ? p.score : sort === "last" ? (liveIds.has(p.id) ? 1e9 : 0) + (flags.get(p.id)?.last ?? (p.last ?? -1) * 86_400_000) : sort === "v" ? p.v : sort === "m" ? p.m : p.q;
  const list = people.filter((p) => !q || [p.id, ...p.alts].some((id) => squash(id).includes(q))).sort((a, b) => key(b) - key(a) || a.id.localeCompare(b.id));
  const shown = q || all ? list : list.slice(0, 30);
  const sel = user ? people.find((p) => p.id === user || p.alts.includes(user)) : undefined;
  return (
    <>
      {user && (
        <PersonPanel
          id={user}
          person={sel}
          data={data}
          error={perr}
          today={today}
          now={now}
          live={!!sel && liveIds.has(sel.id)}
          onRecords={onRecords}
          onClose={() => setUser(null)}
        >
          {data && data.overlaps.length > 0 && <Overlaps user={user} overlaps={data.overlaps} />}
          {data && data.devices.length > 0 && <Devices user={user} devices={data.devices} />}
        </PersonPanel>
      )}
      <section className="panel">
        <input className="mk-input log-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="닉네임 찾기" aria-label="닉네임 찾기" />
        <nav className="sub-tabs ld-sort">
          {SORTS.map((s) => (
            <button key={s.key} type="button" className={"sub-tab" + (sort === s.key ? " sub-tab-on" : "")} onClick={() => setSort(s.key)}>
              {s.name}
            </button>
          ))}
        </nav>
        <ul className="ld-people">
          {shown.map((p) => {
            const f = flags.get(p.id);
            const t = tierOf(p.score);
            const on = liveIds.has(p.id);
            return (
              <li key={p.id}>
                <button type="button" className={"ld-pcard ld-t-" + t + (sel?.id === p.id ? " ld-pcard-on" : "")} onClick={() => setUser(sel?.id === p.id ? null : p.id)}>
                  <ScoreRing score={p.score} />
                  <span className="ld-pmain">
                    <b>
                      {on && <i className="ld-dot" aria-label="지금 접속 중" />}
                      <span className="ld-pname">{p.id}</span>
                      <em className={"ld-tbadge ld-t-" + t}>{TIER_NAME[t]}</em>
                    </b>
                    <small>
                      {on ? "지금 접속 중" : f?.last ? ago(f.last, now) : lastText(p.last, today)}
                      {f?.lastVia ? ` · ${VIA_NAME[f.lastVia]}` : ""}
                      {p.alts.length ? ` · 부캐 ${p.alts.join(", ")}` : ""}
                    </small>
                    <small className="ld-pstats">
                      로그인 {num(p.v)} · 화면 {num(p.w)} · 한 일 {num(p.a)} · {minText(p.m)} · 챗봇 {p.q}
                      {p.tok > 0 && ` · 토큰 ${tokText(p.tok)}`}
                    </small>
                    {f && (f.devices7 > 1 || f.newDev || f.together > 0) && (
                      <small>
                        {f.devices7 > 1 && `기기 ${f.devices7}대`}
                        {f.newDev && <em className="log-flag log-flag-new">새 기기</em>}
                        {f.together > 0 && <em className="log-flag log-flag-warn">다른 도시 동시 접속 {f.together}번</em>}
                      </small>
                    )}
                  </span>
                  {period > 1 && <MiniBars values={p.spark.slice(-14)} className="ld-pspark" />}
                </button>
              </li>
            );
          })}
        </ul>
        {!q && !all && list.length > 30 && (
          <button className="pill" onClick={() => setAll(true)}>
            모두 보기 ({list.length}명)
          </button>
        )}
      </section>
    </>
  );
}

/** 고른 사람의 겹친 접속 (60일): 언제, 도시 · 기기 ↔ 도시 · 기기 */
function Overlaps({ user, overlaps }: { user: string; overlaps: OverlapInfo[] }) {
  return (
    <section className="panel">
      <h2 className="panel-title">다른 도시 동시 접속 (60일)</h2>
      <p className="log-overlap-why">10분 안에 다른 기기가 다른 도시에서 썼어요. 아이디를 빌려줬거나 같이 쓰는 걸 수 있어요 (확실하지는 않아요).</p>
      <ul className="log-overlaps">
        {overlaps.map((o, i) => (
          <li key={i} className="log-overlap">
            <b>{whenText(o.at)}</b>
            <span>
              {o.a.city} · {o.a.name ?? "알 수 없는 기기"}
              {o.a.char !== user ? ` · ${o.a.char}` : ""}
            </span>
            <span>
              <i className="log-overlap-vs">↔</i> {o.b.city} · {o.b.name ?? "알 수 없는 기기"}
              {o.b.char !== user ? ` · ${o.b.char}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 고른 사람의 기기 (60일) */
function Devices({ devices }: { user: string; devices: DeviceInfo[] }) {
  return (
    <section className="panel">
      <h2 className="panel-title">기기 (60일)</h2>
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
  );
}

/** 기록: 누가 어디서 무엇을 했는지 (사람을 고르면 그 사람 것만) */
function RecordsTab({ wiki, user, setUser }: { wiki: Wiki; user: string | null; setUser: (u: string | null) => void }) {
  /** 묶음 요약에 쓰는 짧은 이름 ('게시판: 자유' -> '자유', '게시판 글: 제목' -> '제목') */
  const itemText = (r: ActivityRow) =>
    r.kind === "view" ? pageName(r.what, wiki, r.detail).replace(/^(게시판|게시판 글|아이모 소식 글|글|사냥터|몬스터|아이템|메뉴|장비|검색): /, "") : actionText(r.what, r.detail, r.at);
  const lineText = (r: ActivityRow) =>
    r.kind === "visit" ? "접속" : r.kind === "view" ? pageName(r.what, wiki, r.detail) : actionText(r.what, r.detail, r.at);
  const [kind, setKind] = useEntryState<Kind | null>("log.kind", null);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** 펼친 묶음 (그 묶음 맨 위 기록 번호) */
  const [opened, setOpened] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    const key = `${user ?? ""}|${kind ?? ""}`;
    const had = rowsCache.get(key);
    setRows(had?.rows ?? null);
    setMore(had?.more ?? false);
    setError("");
    fetchActivity({ user, kind, part: "rows" }).then(
      (r) => {
        if (!alive) return;
        rowsCache.set(key, { rows: r.rows, more: r.more });
        setRows(r.rows);
        setMore(r.more);
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
  let lastDay = "";
  return (
    <>
      <nav className="sub-tabs ld-kinds">
        {KINDS.map((k) => (
          <button key={k ?? "all"} type="button" className={"sub-tab" + (kind === k ? " sub-tab-on" : "")} onClick={() => setKind(k)}>
            {k ? KIND_NAME[k] : "전체"}
          </button>
        ))}
      </nav>
      {user && (
        <div className="filter">
          <button className="pill pill-on" onClick={() => setUser(null)}>
            {user} ✕
          </button>
        </div>
      )}
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
                      <i className={"ld-kdot ld-k-" + r.kind} aria-hidden />
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
                    <i className="ld-kdot ld-k-group" aria-hidden />
                    {it.section}
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

/** 저장소: 기록 수, DB 1 크기, 사용 기록 DB 2~10, '자세히' (무엇이 얼마나) */
function StorageTab() {
  const [storage, setStorage] = useState<Storage | null>(summaryCache.get("")?.storage ?? null);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<{ total: number | null; parts: { name: string; bytes: number }[] } | "loading" | null>(null);
  useEffect(() => {
    fetchActivity({ part: "summary" }).then(
      (r) => {
        summaryCache.set("", r);
        if (r.storage) setStorage(r.storage);
      },
      (x) => setError(errorText(x)),
    );
  }, []);
  if (!storage) return <Loading error={error} />;
  const pct = storage.bytes !== null ? Math.min(100, (storage.bytes / DB_LIMIT) * 100) : 0;
  const parts = usage && usage !== "loading" ? [...usage.parts].sort((a, b) => b.bytes - a.bytes) : [];
  const maxPart = Math.max(1, ...parts.map((p) => p.bytes));
  return (
    <section className="panel ld-db">
      <div className="ld-db-top">
        <span className="ld-gauge" style={{ "--p": `${pct}` } as React.CSSProperties} role="img" aria-label={`DB 1 ${Math.round(pct)}%`}>
          <svg viewBox="0 0 64 64" width="72" height="72">
            <circle cx="32" cy="32" r="26" className="ld-ring-bg" />
            <circle cx="32" cy="32" r="26" className="ld-gauge-fg" strokeDasharray={163.4} strokeDashoffset={163.4 * (1 - pct / 100)} />
          </svg>
          <b>{Math.round(pct)}%</b>
        </span>
        <div>
          <b className="ld-db-n">기록 {num(storage.rows)}건</b>
          {storage.bytes !== null && (
            <small>
              DB 1 계정·글·사진 {mbText(storage.bytes)} / {mbText(DB_LIMIT)}
            </small>
          )}
        </div>
      </div>
      {storage.logs && storage.logFull && (
        <div className="log-storage">
          <LogRing logs={storage.logs} full={storage.logFull} />
        </div>
      )}
      {usage === null ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setUsage("loading");
            fetchUsage().then(setUsage, (x) => (setError(errorText(x)), setUsage(null)));
          }}
        >
          무엇이 얼마나 쓰나
        </button>
      ) : usage === "loading" ? (
        <p className="ld-quiet">재는 중…</p>
      ) : (
        <ul className="ld-ai-kinds">
          {parts.map((p) => (
            <li key={p.name}>
              <span>{p.name}</span>
              <span className="ld-row-bar">
                <i className="ld-seg-1" style={{ width: `${(p.bytes / maxPart) * 100}%` }} />
              </span>
              <b>{mbText(p.bytes)}</b>
            </li>
          ))}
          {usage.total !== null && (
            <li className="log-usage-etc">
              <span>계정·글·알림·색인 등</span>
              <span />
              <b>{mbText(Math.max(0, usage.total - usage.parts.reduce((n, p) => n + p.bytes, 0)))}</b>
            </li>
          )}
        </ul>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
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
