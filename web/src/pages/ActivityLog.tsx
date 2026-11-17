import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useEntryState } from "../router";
import { errorText } from "../auth";
import type { Me } from "../auth";
import { TIER_NAME, VIA_NAME, actionText, fetchActivity, fetchChatFeed, fetchUsage, pageName, secItem, tapsOf, tierOf } from "../activity";
import type { ActivityRow, ChatQA, DashPerson, DeviceInfo, LiveNow, LogDbInfo, OverlapInfo, Period, Person, Storage } from "../activity";
import { Nick } from "../kakao";
import { ago } from "../market";
import type { Wiki } from "../types";
import { Loading, MasterNote, TopBar } from "../ui";
import {
  AiPanel,
  Fold,
  HeatPanel,
  KpiGrid,
  LeadPanel,
  MenuPanel,
  MiniBars,
  PersonPanel,
  ScoreRing,
  SecIcon,
  TierPanel,
  TrendPanel,
  ViaPanel,
  lastText,
  minText,
  num,
  tokText,
  useDash,
  useLive,
  usePerson,
} from "./LogDash";
import { ChatCard } from "./LogChat";
export { LogAnswerPage } from "./LogChat";

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
const spanText = (ms: number) => (ms < 60_000 ? "잠깐" : ms < 3_600_000 ? `${Math.round(ms / 60_000)}분` : `${Math.floor(ms / 3_600_000)}시간 ${Math.round((ms % 3_600_000) / 60_000)}분`);

// ---------- 접속 한 번 = 카드 한 장 (제작자 2026-11-17 '스크롤 양이 많고 불필요한 정보가 많고', '어떤 메뉴 들어가서 어떤 버튼 눌렀는지도', '챗봇 질문과 답변도') ----------

/** 기록에 보이지 않는 한 일: 챗봇 자료 보내기·답 저장 (질문과 답 카드에 이미 있다) */
const NOISE = [/^POST \/api\/chat\/context$/, /^POST \/api\/chat\/threads\/\d+\/msgs$/];
/** 같은 사람이 이만큼 쉬면 다른 접속으로 */
const GAP = 30 * 60_000;

/** 한 화면에서 한 것: 들어간 화면, 누른 단추, 한 일, 챗봇 질문과 답 */
interface Block {
  path: string;
  name: string;
  menu: { title: string; icon: string; pic?: string };
  at: number;
  /** 그 화면에서 한 것 (시간 순서로 그린다, 잇단 단추는 한 줄로) */
  items: Item[];
}
type Item = { at: number; tap: string; n: number } | { at: number; act: string } | { at: number; chat: ChatQA | null; text: string };
interface Session {
  key: string;
  user: string;
  via: ActivityRow["via"];
  start: number;
  end: number;
  blocks: Block[];
  taps: number;
  acts: number;
  asks: number;
}

/** 화면 주소의 메뉴 (홈 칸 이름과 그림) */
function menuOf(path: string): Block["menu"] {
  const page = path.replace(/^#\/?/, "").split(/[/?]/)[0];
  if (!page) return { title: "홈", icon: "🏠" };
  const it = secItem(`view:${page}`);
  return { title: it.title, icon: it.icon, pic: it.item?.iconPic };
}

/**
 * 기록을 사람마다 접속 한 번씩으로 묶는다: 앱을 새로 열었거나(접속) 30분 넘게 쉬면 다음 접속.
 * 그 안에서는 화면마다 한 칸 (누른 단추는 그 화면의 칸에, 한 일·챗봇 질문은 그때 보던 화면의 칸에)
 */
function buildSessions(rows: ActivityRow[], chats: Record<string, ChatQA>, wiki: Wiki): Session[] {
  const byUser = new Map<string, ActivityRow[]>();
  for (const r of rows) (byUser.get(r.user) ?? (byUser.set(r.user, []), byUser.get(r.user)!)).push(r);
  const out: Session[] = [];
  for (const [user, list] of byUser) {
    list.sort((a, b) => a.at - b.at || a.id - b.id);
    let cur: Session | null = null;
    const newBlock = (s: Session, path: string, at: number, detail?: string | null): Block => {
      const b: Block = { path, name: pageName(path, wiki, detail), menu: menuOf(path), at, items: [] };
      s.blocks.push(b);
      return b;
    };
    for (const r of list) {
      const end = r.kind === "tap" ? Math.max(r.at, ...tapsOf(r).map((t) => t.at)) : r.at;
      if (!cur || r.kind === "visit" || r.at - cur.end > GAP) {
        cur = { key: `${user}:${r.id}`, user, via: r.via, start: r.at, end, blocks: [], taps: 0, acts: 0, asks: 0 };
        out.push(cur);
      }
      cur.end = Math.max(cur.end, end);
      if (!cur.via && r.via) cur.via = r.via;
      if (r.kind === "visit") continue;
      if (r.kind === "view") {
        const last = cur.blocks[cur.blocks.length - 1];
        if (!last || last.path !== r.what || last.items.length) newBlock(cur, r.what, r.at, r.detail);
        continue;
      }
      if (r.kind === "tap") {
        // 그 화면의 가장 최근 칸 (화면 기록이 없으면 새 칸)
        let b = [...cur.blocks].reverse().find((x) => x.path === r.what);
        if (!b) b = newBlock(cur, r.what, r.at);
        for (const t of tapsOf(r)) {
          b.items.push({ at: t.at, tap: t.label, n: t.n });
          cur.taps += t.n;
        }
        continue;
      }
      if (NOISE.some((re) => re.test(r.what))) continue;
      const b = cur.blocks[cur.blocks.length - 1] ?? newBlock(cur, "#/", r.at);
      if (r.what === "POST /api/chat") {
        b.items.push({ at: r.at, chat: chats[String(r.id)] ?? null, text: actionText(r.what, r.detail, r.at) });
        cur.asks++;
      } else {
        b.items.push({ at: r.at, act: actionText(r.what, r.detail, r.at) });
        cur.acts++;
      }
    }
  }
  return out.sort((a, b) => b.end - a.end);
}

/** 이번에 연 동안 받은 것: 다시 들어오면 받는 동안 바로 보인다 */
const rowsCache = new Map<string, { rows: ActivityRow[]; more: boolean; chats: Record<string, ChatQA> }>();
const chatCache = new Map<string, { list: ChatQA[]; more: boolean }>();
const summaryCache = new Map<string, Awaited<ReturnType<typeof fetchActivity>>>();

type Tab = "rows" | "people" | "stats";
const TABS: { key: Tab; name: string }[] = [
  { key: "rows", name: "기록" },
  { key: "people", name: "사람" },
  { key: "stats", name: "통계" },
];
const PERIODS: { key: Period; name: string }[] = [
  { key: 1, name: "오늘" },
  { key: 7, name: "7일" },
  { key: 30, name: "30일" },
];

/**
 * 사용 기록 (길드마스터·앱개발자·유어아너). 2026-11-17 다시 개편 (제작자 '싹 개편, 스크롤 양이 많고 불필요한 정보가 많고,
 * 챗봇을 썼으면 질문과 답변도, 어떤 메뉴 들어가서 어떤 버튼 눌렀는지도'): 맨 위 같은 폭 단추 기록 · 사람 · 통계.
 * - 기록(처음): 지금 접속 중 한 줄, 접속 한 번마다 카드 한 장(누가 · 언제 · 얼마나 · 들른 메뉴 · 누름·한 일·질문 수).
 *   카드를 펼치면 화면마다 누른 단추, 한 일, 챗봇 질문과 답. '챗봇' 칸은 질문과 답만 모아서
 * - 사람: 점수·마지막 접속, 누르면 그 사람 (질문과 답, 접어 둔 자주 쓰는 때·메뉴·AI·기기)
 * - 통계: 핵심 숫자·날마다·잘 쓰는 사람·누가 많이 쓰나, 나머지(언제 붐비나·메뉴·어디서·AI·저장소)는 접어 둠
 */
export function ActivityLogPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const [rawTab, setTab] = useEntryState<string>("log.tab2", "rows");
  const tab: Tab = TABS.some((t) => t.key === rawTab) ? (rawTab as Tab) : "rows";
  // 기간은 칸마다 따로: 통계는 처음 오늘 (제작자 2026-11-17 '통계쪽도 기본을 오늘로'), 사람은 처음 7일
  const [statPer, setStatPer] = useEntryState<Period>("log.statPer", 1);
  const [peoplePer, setPeoplePer] = useEntryState<Period>("log.period", 7);
  const period = tab === "stats" ? statPer : peoplePer;
  const setPeriod = tab === "stats" ? setStatPer : setPeoplePer;
  const [sec, setSec] = useEntryState<StatSec>("log.sec", "sum");
  const [user, setUser] = useEntryState<string | null>("log.user", null);
  const { dash, error } = useDash(period);
  const live = useLive();
  const liveIds = useMemo(() => new Set((live?.people ?? []).map((p) => p.id)), [live]);
  const pick = (id: string) => {
    setUser(id);
    setTab("people");
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <TopBar title="사용 기록" />
      <MasterNote role={me.role === "developer" ? "developer" : "master"} who="길드마스터·유어아너와 개발자에게만 보이는 메뉴예요">
        누가 언제 들어와 어느 메뉴에서 무엇을 눌렀는지, 챗봇에 무엇을 묻고 어떤 답을 받았는지 남아요. 길드원에게는 보이지 않아요.
      </MasterNote>
      <nav className="pill-row ld-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => setTab(t.key)}>
            {t.name}
          </button>
        ))}
      </nav>
      {tab !== "rows" && (
        <nav className="sub-tabs ld-period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className={"sub-tab" + (period === p.key ? " sub-tab-on" : "")} onClick={() => setPeriod(p.key)}>
              {p.name}
            </button>
          ))}
        </nav>
      )}

      {tab === "rows" && <RecordsTab wiki={wiki} user={user} setUser={setUser} live={live} />}
      {tab === "people" && (
        <PeopleTab
          wiki={wiki}
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
      {tab === "stats" &&
        (!dash ? (
          <Loading error={error} />
        ) : (
          <div className="ld-dash">
            <nav className="lg-secs" role="tablist" aria-label="통계 칸">
              {STAT_SECS.map((x) => (
                <button key={x.key} type="button" role="tab" aria-selected={sec === x.key} className={"lg-sec" + (sec === x.key ? " lg-sec-on" : "")} onClick={() => setSec(x.key)}>
                  {x.name}
                </button>
              ))}
            </nav>
            {sec === "sum" && (
              <>
                <KpiGrid dash={dash} />
                <TrendPanel dash={dash} />
              </>
            )}
            {sec === "rank" && (
              <>
                <TierPanel dash={dash} onPick={pick} />
                <LeadPanel dash={dash} onPick={pick} />
              </>
            )}
            {sec === "time" && <HeatPanel heat={dash.heat} users={dash.heatUsers} days={dash.heatDays} now={dash.now} />}
            {sec === "menu" && (
              <>
                <MenuPanel secs={dash.secs} />
                <ViaPanel vias={dash.vias} />
              </>
            )}
            {sec === "ai" && <AiPanel dash={dash} />}
            {sec === "db" && <StorageTab />}
            {dash.partial && <p className="ld-score-why">지난 기록을 정리하는 중…</p>}
          </div>
        ))}
    </>
  );
}

/**
 * 통계 칸 (제작자 2026-11-17 '그 아래에 수많은 메뉴들을 각각의 버튼식으로 기간 아래쪽에, 상하위 구분 잘, 버튼들은 한 행을 넘지 않게 제목을 간결하게, 같은 거끼리 묶던'):
 * 핵심 숫자·날마다 = 요약, 잘 쓰는 사람·누가 많이 쓰나 = 순위, 언제 붐비나 = 시간대, 많이 쓴 메뉴·어디서 = 메뉴, 챗봇·AI = AI, 저장소
 */
type StatSec = "sum" | "rank" | "time" | "menu" | "ai" | "db";
const STAT_SECS: { key: StatSec; name: string }[] = [
  { key: "sum", name: "요약" },
  { key: "rank", name: "순위" },
  { key: "time", name: "시간대" },
  { key: "menu", name: "메뉴" },
  { key: "ai", name: "AI" },
  { key: "db", name: "저장소" },
];

type View = "all" | "chat";

/** 기록: 지금 접속 중 한 줄, 전체(접속 카드) · 챗봇(질문과 답) */
function RecordsTab({ wiki, user, setUser, live }: { wiki: Wiki; user: string | null; setUser: (u: string | null) => void; live?: LiveNow }) {
  const [view, setView] = useEntryState<View>("log.view", "all");
  const people = live?.people ?? [];
  return (
    <>
      <div className="lg-live" aria-live="polite">
        <i className={"ld-dot" + (people.length ? "" : " lg-dot-off")} aria-hidden />
        <b>지금 {people.length}명</b>
        <span className="lg-live-list">
          {people.map((p) => (
            <button key={p.id} type="button" className={"lg-live-chip" + (user === p.id ? " lg-live-on" : "")} onClick={() => setUser(user === p.id ? null : p.id)}>
              <Nick name={p.id} />
            </button>
          ))}
          {!people.length && <small>{live ? "조용해요" : "보는 중…"}</small>}
        </span>
      </div>
      <nav className="sub-tabs ld-kinds">
        <button type="button" className={"sub-tab" + (view === "all" ? " sub-tab-on" : "")} onClick={() => setView("all")}>
          전체
        </button>
        <button type="button" className={"sub-tab" + (view === "chat" ? " sub-tab-on" : "")} onClick={() => setView("chat")}>
          챗봇 질문·답
        </button>
        {user && (
          <button type="button" className="sub-tab sub-tab-on lg-who" onClick={() => setUser(null)}>
            {user} ✕
          </button>
        )}
      </nav>
      {view === "all" ? <Sessions wiki={wiki} user={user} setUser={setUser} /> : <ChatFeed wiki={wiki} user={user} />}
    </>
  );
}

/** 접속 카드 목록 (기록 150줄씩, '더 보기'로 앞의 것) */
function Sessions({ wiki, user, setUser }: { wiki: Wiki; user: string | null; setUser: (u: string | null) => void }) {
  const key = user ?? "";
  const [data, setData] = useState(rowsCache.get(key) ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useEntryState<string[]>("log.open", []);

  useEffect(() => {
    let alive = true;
    setData(rowsCache.get(key) ?? null);
    setError("");
    fetchActivity({ user, part: "rows" }).then(
      (r) => {
        if (!alive) return;
        const d = { rows: r.rows, more: r.more, chats: r.chats ?? {} };
        rowsCache.set(key, d);
        setData(d);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [key]);

  const sessions = useMemo(() => (data ? buildSessions(data.rows, data.chats, wiki) : []), [data, wiki]);

  async function loadMore() {
    if (!data?.rows.length) return;
    setBusy(true);
    try {
      const r = await fetchActivity({ user, before: Math.min(...data.rows.map((x) => x.id)) });
      const d = { rows: [...data.rows, ...r.rows], more: r.more, chats: { ...data.chats, ...(r.chats ?? {}) } };
      rowsCache.set(key, d);
      setData(d);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Loading error={error} />;
  if (!sessions.length) return <div className="empty">아직 기록이 없어요.</div>;
  let lastDay = "";
  return (
    <>
      <ol className="lg-sessions">
        {sessions.map((s) => {
          const day = dayText(s.end);
          const head = day !== lastDay;
          lastDay = day;
          const open = opened.includes(s.key);
          const toggle = () => setOpened(open ? opened.filter((k) => k !== s.key) : [...opened, s.key].slice(-20));
          return (
            <li key={s.key}>
              {head && <h3 className="log-day">{day}</h3>}
              <SessionCard s={s} open={open} onToggle={toggle} wiki={wiki} onPerson={user ? undefined : () => setUser(s.user)} />
            </li>
          );
        })}
      </ol>
      {error && <p className="form-error">{error}</p>}
      {data.more && (
        <div className="links">
          <button className="btn btn-ghost" disabled={busy} onClick={loadMore}>
            {busy ? "불러오는 중…" : "더 보기"}
          </button>
        </div>
      )}
    </>
  );
}

/** 들른 메뉴 차례 (같은 메뉴가 잇달면 한 번) */
function trailOf(s: Session) {
  const out: Block["menu"][] = [];
  for (const b of s.blocks) if (out[out.length - 1]?.title !== b.menu.title) out.push(b.menu);
  return out;
}

function SessionCard({ s, open, onToggle, wiki, onPerson }: { s: Session; open: boolean; onToggle: () => void; wiki: Wiki; onPerson?: () => void }) {
  const trail = trailOf(s);
  const shown = trail.slice(0, 6);
  return (
    <div className={"lg-card" + (open ? " lg-card-open" : "")}>
      <button type="button" className="lg-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="lg-card-top">
          <b className="lg-card-who">
            <Nick name={s.user} />
          </b>
          {s.via && <small>{VIA_NAME[s.via]}</small>}
          <span className="lg-card-time">
            {timeText(s.start)}
            {s.end - s.start >= 60_000 && `~${timeText(s.end)}`} · {spanText(s.end - s.start)}
          </span>
        </span>
        <span className="lg-trail">
          {shown.map((m, i) => (
            <span key={i} className="lg-trail-m">
              <SecIcon icon={m.icon} pic={m.pic} />
              {m.title}
            </span>
          ))}
          {trail.length > shown.length && <small>외 {trail.length - shown.length}</small>}
          {!trail.length && <small>앱만 열었어요</small>}
        </span>
        <span className="lg-counts">
          {s.taps > 0 && <em className="lg-c-tap">누름 {s.taps}</em>}
          {s.acts > 0 && <em className="lg-c-act">한 일 {s.acts}</em>}
          {s.asks > 0 && <em className="lg-c-ask">챗봇 {s.asks}</em>}
        </span>
        <i className="log-chev" aria-hidden />
      </button>
      {open && (
        <ol className="lg-blocks">
          {s.blocks.map((b, i) => (
            <li key={i} className="lg-block">
              <time>{timeText(b.at)}</time>
              <div className="lg-block-main">
                <b className="lg-block-name">
                  <SecIcon icon={b.menu.icon} pic={b.menu.pic} />
                  {b.name}
                </b>
                <BlockItems items={b.items} wiki={wiki} />
              </div>
            </li>
          ))}
          {onPerson && (
            <li className="lg-block-end">
              <button type="button" className="ld-more" onClick={onPerson}>
                {s.user} 기록만 보기
              </button>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

/** 한 화면에서 한 것을 시간 순서로: 잇단 단추는 한 줄 (같은 단추를 잇달아 누르면 '×N'), 한 일은 ✔, 챗봇은 질문과 답 */
function BlockItems({ items, wiki }: { items: Item[]; wiki: Wiki }) {
  const list = [...items].sort((a, b) => a.at - b.at);
  const out: ReactNode[] = [];
  let taps: { label: string; n: number }[] = [];
  const flush = () => {
    if (!taps.length) return;
    const row = taps;
    out.push(
      <p key={out.length} className="lg-taps">
        {row.map((t, j) => (
          <span key={j} className="lg-tap">
            {t.label}
            {t.n > 1 && <small> ×{t.n}</small>}
          </span>
        ))}
      </p>,
    );
    taps = [];
  };
  for (const it of list) {
    if ("tap" in it) {
      const prev = taps[taps.length - 1];
      if (prev && prev.label === it.tap) prev.n += it.n;
      else taps.push({ label: it.tap, n: it.n });
      continue;
    }
    flush();
    if ("act" in it)
      out.push(
        <p key={out.length} className="lg-act">
          <i aria-hidden>✔</i>
          {it.act}
          <small> {timeText(it.at)}</small>
        </p>,
      );
    else
      out.push(
        it.chat ? (
          <ChatCard key={out.length} qa={it.chat} wiki={wiki} when={timeText(it.at)} />
        ) : (
          <p key={out.length} className="lg-act">
            {it.text}
          </p>
        ),
      );
  }
  flush();
  return <>{out}</>;
}

/** 챗봇 질문과 답만 (새것부터 30개씩) */
function ChatFeed({ wiki, user }: { wiki: Wiki; user: string | null }) {
  const key = user ?? "";
  const [data, setData] = useState(chatCache.get(key) ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(chatCache.get(key) ?? null);
    setError("");
    fetchChatFeed(user).then(
      (r) => {
        if (!alive) return;
        chatCache.set(key, r);
        setData(r);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [key]);
  async function loadMore() {
    if (!data?.list.length) return;
    setBusy(true);
    try {
      const r = await fetchChatFeed(user, data.list[data.list.length - 1].id);
      const d = { list: [...data.list, ...r.list], more: r.more };
      chatCache.set(key, d);
      setData(d);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <Loading error={error} />;
  if (!data.list.length) return <div className="empty">아직 챗봇 질문이 없어요.</div>;
  let lastDay = "";
  return (
    <>
      <ol className="lg-sessions">
        {data.list.map((qa) => {
          const day = dayText(qa.at);
          const head = day !== lastDay;
          lastDay = day;
          return (
            <li key={qa.id}>
              {head && <h3 className="log-day">{day}</h3>}
              <div className="lg-card lg-card-qa">
                <ChatCard qa={qa} wiki={wiki} who={!user} when={timeText(qa.at)} />
              </div>
            </li>
          );
        })}
      </ol>
      {error && <p className="form-error">{error}</p>}
      {data.more && (
        <div className="links">
          <button className="btn btn-ghost" disabled={busy} onClick={loadMore}>
            {busy ? "불러오는 중…" : "더 보기"}
          </button>
        </div>
      )}
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
  wiki,
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
  wiki: Wiki;
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
          wiki={wiki}
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
          {data && data.overlaps.length > 0 && (
            <Fold k="log.pf.overlap" title="다른 도시 동시 접속" note={`${data.overlaps.length}번`}>
              <Overlaps user={user} overlaps={data.overlaps} />
            </Fold>
          )}
          {data && data.devices.length > 0 && (
            <Fold k="log.pf.dev" title="기기" note={`${data.devices.length}대`}>
              <Devices user={user} devices={data.devices} />
            </Fold>
          )}
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

/** 둘째 Cloudflare 계정의 사용 기록 DB 는 101 (server/logdb.ts REMOTE_N) */
const logName = (n: number) => (n === 101 ? "둘째 계정 DB" : `DB ${n}`);

/** 사용 기록 DB 2~10 과 둘째 계정 DB: 칸마다 찬 만큼, 지금 쓰는 칸은 금색 테두리 */
function LogRing({ logs, full }: { logs: LogDbInfo[]; full: number }) {
  const cur = logs.find((l) => l.cur);
  return (
    <>
      <span className="log-storage-line">
        <b>사용 기록 DB</b>
        {cur && cur.bytes !== null && ` 지금 ${logName(cur.n)} ${mbText(cur.bytes)} / ${mbText(full)}`}
      </span>
      <span className="log-ring" role="img" aria-label={`사용 기록 ${cur ? logName(cur.n) : "DB 2"}에 쓰는 중`}>
        {logs.map((l) => (
          <span key={l.n} className={"log-ring-cell" + (l.cur ? " log-ring-cur" : "") + (l.since === null ? " log-ring-empty" : "")}>
            <i style={{ height: `${l.since === null || l.bytes === null ? 0 : Math.min(100, Math.max(4, (l.bytes / full) * 100))}%` }} />
            <small>{l.n === 101 ? "둘째" : l.n}</small>
          </span>
        ))}
      </span>
    </>
  );
}
