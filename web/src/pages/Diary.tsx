// 비공개 일지 (#/diary, 서버 server/diary.ts): 보는 사람만 (/api/me 의 diary). 다른 사람에게는 칸도 화면도 없다.
// 사용 기록·누른 단추·접수의 직전 화면에 남기지 않는다 (src/activity.ts, src/fix.ts). 알림을 보내지 않는다.
import { useEffect, useMemo, useState } from "react";
import { api } from "../auth";
import type { Me } from "../auth";
import { Loading, TopBar } from "../ui";
import "./diary.css";

interface Entry {
  id: number;
  author: string;
  day: string;
  time: string;
  place: string;
  lv_from: number | null;
  exp_from: number | null;
  lv_to: number | null;
  exp_to: number | null;
  gold: number | null;
  items: string;
  note: string;
  updated_at: number;
}

type Draft = Omit<Entry, "id" | "author" | "updated_at">;

const DAY_MS = 86_400_000;
/** 한국 날짜 'YYYY-MM-DD' */
const kstDay = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const shiftDay = (day: string, n: number) => kstDay(Date.parse(day + "T00:00:00+09:00") + n * DAY_MS);
const WEEK = "일월화수목금토";
const weekOf = (day: string) => WEEK[new Date(Date.parse(day + "T12:00:00+09:00")).getUTCDay()];
const dayText = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 (${weekOf(day)})`;

const lvText = (lv: number | null, exp: number | null) => (lv === null ? "" : `Lv.${lv}${exp === null ? "" : ` ${trim(exp)}%`}`);
const trim = (n: number) => String(Math.round(n * 1000) / 1000);
/** 오른 만큼 (레벨 1 = 100%) */
const gainOf = (e: Pick<Entry, "lv_from" | "exp_from" | "lv_to" | "exp_to">) =>
  e.lv_from === null || e.lv_to === null ? null : (e.lv_to - e.lv_from) * 100 + ((e.exp_to ?? 0) - (e.exp_from ?? 0));
const goldText = (g: number) => {
  const a = Math.abs(g);
  const s = a >= 10000 ? `${trim(a / 10000)}억` : `${trim(a)}만`;
  return (g < 0 ? "-" : "+") + s;
};

const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

export function DiaryPage({ me }: { me: Me }) {
  const title = me.diary || "일지";
  const [list, setList] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  /** 쓰는 중: 새 일지면 id 0 */
  const [edit, setEdit] = useState<{ id: number; d: Draft } | null>(null);
  const load = () =>
    api<{ entries: Entry[] }>("/api/diary")
      .then((r) => setList(r.entries))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const sum = useMemo(() => {
    if (!list?.length) return null;
    const asc = [...list].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id));
    const first = asc.find((e) => e.lv_from !== null) ?? asc.find((e) => e.lv_to !== null);
    const last = [...asc].reverse().find((e) => e.lv_to !== null);
    const gold = list.reduce((t, e) => t + (e.gold ?? 0), 0);
    const days = new Set(list.map((e) => e.day)).size;
    return {
      days,
      from: first ? lvText(first.lv_from ?? first.lv_to, first.lv_from !== null ? first.exp_from : first.exp_to) : "",
      to: last ? lvText(last.lv_to, last.exp_to) : "",
      gold,
      since: asc[0].day,
    };
  }, [list]);

  const startNew = () => {
    const last = list?.find((e) => e.lv_to !== null);
    setEdit({
      id: 0,
      d: {
        day: kstDay(Date.now()),
        time: "",
        place: "",
        lv_from: last?.lv_to ?? null,
        exp_from: last?.exp_to ?? null,
        lv_to: last?.lv_to ?? null,
        exp_to: null,
        gold: null,
        items: "",
        note: "",
      },
    });
  };

  if (error && !list) return <><TopBar title={title} /><p className="dy-empty">{error}</p></>;
  if (!list) return <><TopBar title={title} /><Loading /></>;

  return (
    <>
      <TopBar title={title} />
      <div className="dy">
        {sum && (
          <section className="dy-sum">
            <span>
              <b>{sum.days}</b>일
              <small>{sum.since.slice(5).replace("-", "/")}부터</small>
            </span>
            <span>
              <b>{sum.to || "-"}</b>
              <small>{sum.from && sum.from !== sum.to ? `${sum.from}에서` : "지금"}</small>
            </span>
            <span>
              <b className={sum.gold < 0 ? "dy-minus" : ""}>{sum.gold ? goldText(sum.gold) : "0"}</b>
              <small>골드</small>
            </span>
          </section>
        )}
        {edit?.id === 0 ? (
          <EntryForm me={me} draft={edit.d} onCancel={() => setEdit(null)} onSaved={() => (setEdit(null), void load())} />
        ) : (
          <button className="dy-new" onClick={startNew}>
            <b>+ 일지 쓰기</b>
          </button>
        )}
        {list.length === 0 && !edit && <p className="dy-empty">아직 일지가 없어요</p>}
        {list.map((e) =>
          edit?.id === e.id ? (
            <EntryForm key={e.id} me={me} id={e.id} draft={edit.d} onCancel={() => setEdit(null)} onSaved={() => (setEdit(null), void load())} />
          ) : (
            <EntryCard key={e.id} e={e} onEdit={() => setEdit({ id: e.id, d: { ...e } })} onDeleted={() => void load()} />
          ),
        )}
      </div>
    </>
  );
}

function EntryCard({ e, onEdit, onDeleted }: { e: Entry; onEdit: () => void; onDeleted: () => void }) {
  const [sure, setSure] = useState(false);
  const gain = gainOf(e);
  const del = () => {
    if (!sure) {
      setSure(true);
      window.setTimeout(() => setSure(false), 3000);
      return;
    }
    void api(`/api/diary/${e.id}`, "DELETE").then(onDeleted).catch(() => undefined);
  };
  return (
    <article className="dy-card">
      <header className="dy-card-head">
        <b>
          {Number(e.day.slice(5, 7))}/{Number(e.day.slice(8, 10))} ({weekOf(e.day)})
        </b>
        {e.time && <span className="dy-time">{e.time}</span>}
        <small>{e.author}</small>
      </header>
      {e.place && <p className="dy-place">{e.place}</p>}
      {(e.lv_to !== null || e.lv_from !== null) && (
        <p className="dy-lv">
          {lvText(e.lv_from, e.exp_from)}
          {e.lv_from !== null && e.lv_to !== null && " → "}
          {lvText(e.lv_to, e.exp_to)}
          {gain !== null && <em className={gain < 0 ? "dy-minus" : ""}> {gain >= 0 ? "+" : ""}{trim(gain)}%</em>}
        </p>
      )}
      {e.gold !== null && e.gold !== 0 && <p className={"dy-gold" + (e.gold < 0 ? " dy-minus" : "")}>골드 {goldText(e.gold)}</p>}
      {e.items && <p className="dy-items">{e.items}</p>}
      {e.note && <p className="dy-note">{e.note}</p>}
      <footer className="dy-card-foot">
        <button className="dy-link" onClick={onEdit}>수정</button>
        <button className={"dy-link" + (sure ? " dy-sure" : "")} onClick={del}>{sure ? "정말 삭제" : "삭제"}</button>
      </footer>
    </article>
  );
}

function EntryForm({ id = 0, draft, onCancel, onSaved }: { me: Me; id?: number; draft: Draft; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [txt, setTxt] = useState(() => ({
    lv_from: draft.lv_from?.toString() ?? "",
    exp_from: draft.exp_from?.toString() ?? "",
    lv_to: draft.lv_to?.toString() ?? "",
    exp_to: draft.exp_to?.toString() ?? "",
    gold: draft.gold?.toString() ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const put = (k: keyof typeof txt) => (ev: { target: { value: string } }) => setTxt((t) => ({ ...t, [k]: ev.target.value.replace(/[^\d.-]/g, "") }));
  const today = kstDay(Date.now());
  const save = () => {
    setBusy(true);
    setErr("");
    const body = {
      ...d,
      lv_from: numOrNull(txt.lv_from),
      exp_from: numOrNull(txt.exp_from),
      lv_to: numOrNull(txt.lv_to),
      exp_to: numOrNull(txt.exp_to),
      gold: numOrNull(txt.gold),
    };
    api(id ? `/api/diary/${id}` : "/api/diary", id ? "PUT" : "POST", body)
      .then(onSaved)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="dy-form">
      <div className="dy-row dy-day">
        <button className="pill" onClick={() => setD({ ...d, day: shiftDay(d.day, -1) })} aria-label="하루 전">◀</button>
        <b>{dayText(d.day)}</b>
        <button className="pill" onClick={() => setD({ ...d, day: shiftDay(d.day, 1) })} disabled={d.day >= today} aria-label="하루 뒤">▶</button>
        {d.day !== today && (
          <button className="pill" onClick={() => setD({ ...d, day: today })}>오늘</button>
        )}
      </div>
      <label className="dy-f">
        <span>시간</span>
        <input className="mk-input" maxLength={30} placeholder="21:00~23:30" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} />
      </label>
      <label className="dy-f">
        <span>사냥터 · 한 일</span>
        <input className="mk-input" maxLength={60} value={d.place} onChange={(e) => setD({ ...d, place: e.target.value })} />
      </label>
      <div className="dy-f">
        <span>시작</span>
        <div className="dy-lvin">
          <em>Lv</em>
          <input className="mk-input" inputMode="numeric" value={txt.lv_from} onChange={put("lv_from")} />
          <input className="mk-input" inputMode="decimal" value={txt.exp_from} onChange={put("exp_from")} />
          <em>%</em>
        </div>
      </div>
      <div className="dy-f">
        <span>끝</span>
        <div className="dy-lvin">
          <em>Lv</em>
          <input className="mk-input" inputMode="numeric" value={txt.lv_to} onChange={put("lv_to")} />
          <input className="mk-input" inputMode="decimal" value={txt.exp_to} onChange={put("exp_to")} />
          <em>%</em>
        </div>
      </div>
      <label className="dy-f">
        <span>골드 (만)</span>
        <input className="mk-input" inputMode="decimal" placeholder="번 만큼, 쓴 것은 -" value={txt.gold} onChange={put("gold")} />
      </label>
      <label className="dy-f">
        <span>얻은 템</span>
        <input className="mk-input" maxLength={500} value={d.items} onChange={(e) => setD({ ...d, items: e.target.value })} />
      </label>
      <label className="dy-f">
        <span>메모</span>
        <textarea className="dy-text" rows={3} maxLength={2000} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
      </label>
      {err && <p className="dy-err">{err}</p>}
      <div className="dy-row">
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>취소</button>
        <button className="btn" onClick={save} disabled={busy}>{id ? "저장" : "올리기"}</button>
      </div>
    </section>
  );
}
