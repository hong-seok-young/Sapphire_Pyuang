import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { KIND_NAME, VIA_NAME, actionText, fetchActivity, pageName } from "../activity";
import type { ActivityRow, DeviceInfo, Kind, Person } from "../activity";
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

/**
 * 사용 기록 (앱개발자만, 제작자 요청): 사람별 접속 수와 마지막으로 쓴 때, 그리고 누가 어디서 무엇을 했는지.
 * 사람을 누르면 그 사람 기록과 기기 목록, 칩으로 접속/화면/한 일만 본다. 기록은 지우지 않는다 (영구 보관).
 * 줄마다 붙던 기기·도시·IP 는 뺐다 (제작자 요청 2026-11-02: '주소 뜨는 거 불필요'. IP 는 데이터·와이파이만 바꿔도 바뀌어 다른 사람인지 알 수 없다).
 * 대신 사람마다 기기 표로 센 기기 수, '새 기기', '같은 때 다른 곳'(10분 안에 다른 기기가 다른 도시에서)을 보인다. 기록에는 그대로 남긴다
 */
export function ActivityLogPage({ wiki }: { wiki: Wiki }) {
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
                  {d.legacy && " · 기기 표 전"}
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
          {rows.map((r) => {
            const day = dayText(r.at);
            const head = day !== lastDay;
            lastDay = day;
            return (
              <li key={r.id}>
                {head && <h3 className="log-day">{day}</h3>}
                <div className={"log-row log-" + r.kind}>
                  <time>{timeText(r.at)}</time>
                  <span>
                    <b>{r.user}</b>
                    {r.via && <small> · {VIA_NAME[r.via]}</small>}
                    <br />
                    {r.kind === "visit" ? "🟢 접속" : r.kind === "view" ? `📖 ${pageName(r.what, wiki)}` : `✏️ ${actionText(r.what, r.detail)}`}
                  </span>
                </div>
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
