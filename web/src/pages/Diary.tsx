// 비공개 일지 (#/diary, 서버 server/diary.ts): 보는 사람만 (/api/me 의 diary = 이름). 다른 사람에게는 칸도 화면도 없다.
// 사용 기록·누른 단추·접수의 직전 화면에 남기지 않는다 (src/activity.ts, src/fix.ts). 알림을 보내지 않는다.
//
// 기록 = 시작·끝 스샷 두 장. 사용자가 갤러리에서 고른 스샷을 AI 가 읽어(/api/diary/read: 레벨, 경험치 %, 게임 시각) 칸을 채우고 사람이 보고 고쳐 올린다.
// 표는 한 줄에 날짜 · 시작 · 끝 · 증감 · 금액, 줄을 누르면 증거 사진. 금액 = 오른 % x 그 레벨 1%당 단가 (레벨이 오른 줄은 레벨마다 나눈다, 서버 valueOf 와 같은 셈).
// 정산: 정산 안 한 줄 합 + 지난 이월, 1000원 아래는 버려 다음 정산으로.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiHeaders } from "../auth";
import type { Me } from "../auth";
import { Loading, TopBar } from "../ui";
import { ImageViewer } from "./ImageViewer";
import "./diary.css";

interface Rate {
  level: number;
  per_pct: number | null;
  per_hour: number | null;
  test_pct: number | null;
}
interface Run {
  id: number;
  author: string;
  day: string;
  lv_from: number;
  exp_from: number;
  t_from: string;
  lv_to: number;
  exp_to: number;
  t_to: string;
  settle_id: number | null;
  won: number | null;
  /** 이 줄만 따로 정한 1%당 원 */
  rate: number | null;
  created_at: number;
  shots: { from?: number; to?: number };
}
interface Settle {
  id: number;
  at: number;
  by_user: string;
  runs: number;
  sum: number;
  carry_in: number;
  pay: number;
  carry_out: number;
  /** 정산서 링크 토큰 (만들었으면) */
  share?: string | null;
}
interface Data {
  runs: Run[];
  rates: Rate[];
  settles: Settle[];
}

const UNIT = 1000;
const kstDay = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const WEEK = "일월화수목금토";
const weekOf = (day: string) => WEEK[new Date(Date.parse(day + "T12:00:00+09:00")).getUTCDay()];
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(3) + "%";
const hm = (t: string) => t.split(":").slice(0, 2).join(":");
const shotUrl = (id: number) => `/api/diary/shots/${id}`;

/** 그 레벨의 1%당 원 (모르면 null) */
function perPct(rates: Rate[], level: number): number | null {
  const r = rates.find((x) => x.level === level);
  if (!r) return null;
  if (r.per_pct !== null && r.per_pct > 0) return r.per_pct;
  if (r.per_hour !== null && r.per_hour > 0 && r.test_pct !== null && r.test_pct > 0) return r.per_hour / r.test_pct;
  return null;
}
type Span = Pick<Run, "lv_from" | "exp_from" | "lv_to" | "exp_to"> & { rate?: number | null };
/** 오른 % (레벨 1 = 100%) */
const gainOf = (r: Span) => (r.lv_to - r.lv_from) * 100 + r.exp_to - r.exp_from;
/** 금액 (단가를 모르는 레벨이 있으면 null) */
function valueOf(r: Span, rates: Rate[]): number | null {
  if (r.rate != null && r.rate > 0) return gainOf(r) * r.rate;
  let sum = 0;
  for (let lv = r.lv_from; lv <= r.lv_to; lv++) {
    const p = (lv === r.lv_to ? r.exp_to : 100) - (lv === r.lv_from ? r.exp_from : 0);
    if (p === 0) continue;
    const rate = perPct(rates, lv);
    if (rate === null) return null;
    sum += p * rate;
  }
  return sum;
}
const runValue = (r: Run, rates: Rate[]) => (r.settle_id !== null ? r.won : valueOf(r, rates));

export function DiaryPage({ me }: { me: Me }) {
  const title = me.diary || "일지";
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const load = () =>
    api<Data>("/api/diary")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // 다른 사람이 올린 기록을 보려고: 앱으로 돌아오면 다시 받는다
    const on = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  if (!data)
    return (
      <>
        <TopBar title={title} />
        {error ? <p className="dy-empty">{error}</p> : <Loading />}
      </>
    );

  const open = data.runs.filter((r) => r.settle_id === null);
  const carry = data.settles[0]?.carry_out ?? 0;
  return (
    <>
      <TopBar title={title} />
      <div className="dy">
        {adding ? (
          <NewRun
            rates={data.rates}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              void load();
            }}
          />
        ) : (
          <button className="dy-new" onClick={() => setAdding(true)}>
            <b>+ 기록 올리기</b>
            <small>시작 · 끝 스샷 두 장</small>
          </button>
        )}
        <OpenRuns runs={open} rates={data.rates} carry={carry} onChange={() => void load()} />
        <Rates rates={data.rates} onChange={() => void load()} />
        <Settles settles={data.settles} runs={data.runs} rates={data.rates} onChange={() => void load()} />
      </div>
    </>
  );
}

/** 정산 안 한 기록 표와 합계, 정산 단추 */
function OpenRuns({ runs, rates, carry, onChange }: { runs: Run[]; rates: Rate[]; carry: number; onChange: () => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const vals = runs.map((r) => valueOf(r, rates));
  const missing = vals.some((v) => v === null);
  const sum = vals.reduce<number>((t, v) => t + (v ?? 0), 0);
  const gain = runs.reduce((t, r) => t + gainOf(r), 0);
  const total = sum + carry;
  const pay = Math.max(0, Math.floor(total / UNIT) * UNIT);
  const settle = () => {
    if (!sure) {
      setSure(true);
      window.setTimeout(() => setSure(false), 4000);
      return;
    }
    setBusy(true);
    setErr("");
    api("/api/diary/settle", "POST")
      .then(() => {
        setSure(false);
        onChange();
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="dy-box">
      <header className="dy-box-head">
        <b>정산 전</b>
        <small>{runs.length}개</small>
      </header>
      {runs.length ? <RunTable runs={runs} rates={rates} editable onChange={onChange} /> : <p className="dy-empty">정산 전 기록이 없어요</p>}
      <div className="dy-total">
        <span>
          합계 <b>{pct(gain)}</b>
        </span>
        <span>
          <b>{won(sum)}원</b>
          {missing && <em className="dy-warn"> + 단가 없음</em>}
        </span>
      </div>
      {carry > 0.5 && (
        <div className="dy-carry">
          <span>지난 이월</span>
          <span>+{won(carry)}원</span>
        </div>
      )}
      {runs.length > 0 && (
        <>
          <button className={"dy-settle" + (sure ? " dy-settle-sure" : "")} onClick={settle} disabled={busy || missing}>
            {missing ? "단가 없는 레벨이 있어요" : sure ? `${won(pay)}원 정산 확인` : `정산 ${won(pay)}원`}
            {!missing && <small>{total - pay > 0.5 ? `이월 ${won(total - pay)}원` : "이월 없음"}</small>}
          </button>
          {err && <p className="dy-err">{err}</p>}
        </>
      )}
    </section>
  );
}

/** 기록 표: 날짜 · 시작 · 끝 · 증감 · 금액, 줄을 누르면 사진 */
function RunTable({ runs, rates, editable = false, onChange }: { runs: Run[]; rates: Rate[]; editable?: boolean; onChange: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <div className="dy-table" role="table">
      <div className="dy-tr dy-th" role="row">
        <span>날짜</span>
        <span>시작</span>
        <span>끝</span>
        <span>증감</span>
        <span>금액</span>
      </div>
      {runs.map((r) => {
        const v = runValue(r, rates);
        const on = openId === r.id;
        return (
          <div key={r.id} className={"dy-run" + (on ? " dy-run-on" : "")}>
            <button className="dy-tr" role="row" onClick={() => setOpenId(on ? null : r.id)} aria-expanded={on}>
              <span className="dy-td-day">
                {md(r.day)}
                <small>{weekOf(r.day)}</small>
              </span>
              <span>
                {r.lv_from} · {r.exp_from.toFixed(3)}
                {r.t_from && <small>{hm(r.t_from)}</small>}
              </span>
              <span>
                {r.lv_to} · {r.exp_to.toFixed(3)}
                {r.t_to && <small>{hm(r.t_to)}</small>}
              </span>
              <span className={"dy-td-gain" + (gainOf(r) < 0 ? " dy-minus" : "")}>{pct(gainOf(r))}</span>
              <span className="dy-td-won">{v === null ? <em className="dy-warn">단가?</em> : won(v)}</span>
            </button>
            {on && <RunDetail r={r} editable={editable && r.settle_id === null} onChange={onChange} />}
          </div>
        );
      })}
    </div>
  );
}

/** 줄을 펼치면: 시작 · 끝 사진 (누르면 크게), 고치기 · 지우기 */
function RunDetail({ r, editable, onChange }: { r: Run; editable: boolean; onChange: () => void }) {
  const [view, setView] = useState<number | null>(null);
  const [edit, setEdit] = useState(false);
  const [sure, setSure] = useState(false);
  const shots = [
    { id: r.shots.from, name: "시작" },
    { id: r.shots.to, name: "끝" },
  ];
  const images = shots.filter((s) => s.id).map((s) => ({ src: shotUrl(s.id!), name: s.name }));
  const del = () => {
    if (!sure) {
      setSure(true);
      window.setTimeout(() => setSure(false), 3000);
      return;
    }
    void api(`/api/diary/runs/${r.id}`, "DELETE").then(onChange).catch(() => undefined);
  };
  return (
    <div className="dy-detail">
      <div className="dy-shots">
        {shots.map((s) => (
          <figure key={s.name} className="dy-shot">
            {s.id ? (
              <button onClick={() => setView(images.findIndex((i) => i.name === s.name))}>
                <img src={shotUrl(s.id)} alt={s.name} loading="lazy" />
              </button>
            ) : (
              <span className="dy-shot-none">사진 없음</span>
            )}
            <figcaption>{s.name}</figcaption>
          </figure>
        ))}
      </div>
      {edit ? (
        <EditRun
          r={r}
          onCancel={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            onChange();
          }}
        />
      ) : (
        <div className="dy-detail-foot">
          <small>
            {r.author}
            {r.rate ? ` · 1%당 ${won(r.rate)}원 고정` : ""}
          </small>
          {editable && (
            <>
              <button className="dy-link" onClick={() => setEdit(true)}>
                수정
              </button>
              <button className={"dy-link" + (sure ? " dy-sure" : "")} onClick={del}>
                {sure ? "정말 삭제" : "삭제"}
              </button>
            </>
          )}
        </div>
      )}
      {view !== null && images.length > 0 && <ImageViewer images={images} start={Math.max(0, view)} onClose={() => setView(null)} />}
    </div>
  );
}

interface Side {
  lv: string;
  exp: string;
  time: string;
}
const sideOf = (lv: number | null, exp: number | null, time: string | null): Side => ({
  lv: lv === null ? "" : String(lv),
  exp: exp === null ? "" : String(exp),
  time: time ?? "",
});
const numOr = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
const spanOf = (a: Side, b: Side): Span | null => {
  const [lf, ef, lt, et] = [numOr(a.lv), numOr(a.exp), numOr(b.lv), numOr(b.exp)];
  return lf === null || ef === null || lt === null || et === null ? null : { lv_from: lf, exp_from: ef, lv_to: lt, exp_to: et };
};
const onlyNum = (s: string) => s.replace(/[^\d.]/g, "");

/** 레벨 · 경험치 % · 시각 칸 */
function SideFields({ v, set }: { v: Side; set: (v: Side) => void }) {
  return (
    <div className="dy-sidef">
      <label>
        <em>Lv</em>
        <input className="mk-input" inputMode="numeric" value={v.lv} onChange={(e) => set({ ...v, lv: onlyNum(e.target.value) })} />
      </label>
      <label>
        <input className="mk-input" inputMode="decimal" value={v.exp} onChange={(e) => set({ ...v, exp: onlyNum(e.target.value) })} />
        <em>%</em>
      </label>
      <label>
        <input className="mk-input" inputMode="numeric" placeholder="시각" value={v.time} onChange={(e) => set({ ...v, time: e.target.value.replace(/[^\d:]/g, "") })} />
      </label>
    </div>
  );
}

function Preview({ span, rates }: { span: Span | null; rates: Rate[] }) {
  if (!span) return null;
  const v = valueOf(span, rates);
  const g = gainOf(span);
  return (
    <div className={"dy-preview" + (g < 0 ? " dy-minus" : "")}>
      <span>
        증감 <b>{pct(g)}</b>
      </span>
      <span>{v === null ? <em className="dy-warn">단가 없음</em> : <b>{won(v)}원</b>}</span>
    </div>
  );
}

function EditRun({ r, onCancel, onSaved }: { r: Run; onCancel: () => void; onSaved: () => void }) {
  const [a, setA] = useState(sideOf(r.lv_from, r.exp_from, r.t_from));
  const [b, setB] = useState(sideOf(r.lv_to, r.exp_to, r.t_to));
  const [err, setErr] = useState("");
  const save = () => {
    const s = spanOf(a, b);
    if (!s) {
      setErr("레벨과 경험치를 적어 주세요");
      return;
    }
    api(`/api/diary/runs/${r.id}`, "PUT", { day: r.day, ...s, t_from: a.time, t_to: b.time, rate: r.rate })
      .then(onSaved)
      .catch((e: Error) => setErr(e.message));
  };
  return (
    <div className="dy-edit">
      <div className="dy-side-row">
        <b>시작</b>
        <SideFields v={a} set={setA} />
      </div>
      <div className="dy-side-row">
        <b>끝</b>
        <SideFields v={b} set={setB} />
      </div>
      {err && <p className="dy-err">{err}</p>}
      <div className="dy-row">
        <button className="btn btn-ghost" onClick={onCancel}>
          취소
        </button>
        <button className="btn" onClick={save}>
          저장
        </button>
      </div>
    </div>
  );
}

interface Shot {
  blob: Blob | null;
  url: string;
  at: number;
  read: "wait" | "ok" | "fail";
  v: Side;
}
const WAITING: Shot = { blob: null, url: "", at: 0, read: "wait", v: sideOf(null, null, null) };

/** 스샷을 긴 변 1200px 로 줄인다 (WebP, 못 쓰는 브라우저는 JPEG). 경험치 글자가 읽히는 크기 */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/webp", 0.6));
    if (!blob || blob.type !== "image/webp") blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.7));
    c.width = c.height = 0;
    if (!blob) throw new Error("사진을 줄이지 못했어요");
    return blob;
  } finally {
    bmp.close();
  }
}
const toB64 = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => fail(new Error("사진을 읽지 못했어요"));
    fr.readAsDataURL(blob);
  });

/** 새 기록: 스샷 두 장 고르기 -> AI 가 레벨·경험치·시각을 읽어 채움 -> 보고 고쳐 올리기 */
function NewRun({ rates, onCancel, onSaved }: { rates: Rate[]; onCancel: () => void; onSaved: () => void }) {
  const [shots, setShots] = useState<(Shot | null)[]>([null, null]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const both = useRef<HTMLInputElement>(null);
  const one = useRef<HTMLInputElement>(null);
  const slot = useRef(0);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const readOne = async (file: File): Promise<Shot> => {
    const blob = await shrink(file);
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    const p: Shot = { blob, url, at: file.lastModified || Date.now(), read: "wait", v: sideOf(null, null, null) };
    try {
      const r = await api<{ level: number | null; exp: number | null; time: string | null }>("/api/diary/read", "POST", {
        image: { type: blob.type, data: await toB64(blob) },
      });
      return { ...p, read: r.level !== null && r.exp !== null ? "ok" : "fail", v: sideOf(r.level, r.exp, r.time) };
    } catch {
      return { ...p, read: "fail" };
    }
  };
  const put = (i: number, s: Shot | null) => setShots((ps) => ps.map((p, k) => (k === i ? s : p)));

  const pickBoth = async (files: File[]) => {
    if (!files.length) return;
    setErr("");
    setBusy(true);
    try {
      if (files.length === 1) {
        // 한 장만 고르면 비어 있는 칸에
        const i = shots[0] ? 1 : 0;
        put(i, WAITING);
        put(i, await readOne(files[0]));
        return;
      }
      setShots([WAITING, WAITING]);
      const [x, y] = await Promise.all(files.slice(0, 2).map(readOne));
      // 낮은 쪽이 시작 (레벨·경험치를 읽었으면 그것으로, 못 읽었으면 찍은 때로)
      const key = (p: Shot) => {
        const lv = numOr(p.v.lv);
        const e = numOr(p.v.exp);
        return lv !== null && e !== null ? lv * 1000 + e : null;
      };
      const kx = key(x);
      const ky = key(y);
      setShots(kx !== null && ky !== null ? (kx <= ky ? [x, y] : [y, x]) : x.at <= y.at ? [x, y] : [y, x]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "사진을 열지 못했어요");
      setShots([null, null]);
    } finally {
      setBusy(false);
    }
  };

  const pickOne = async (file: File | undefined) => {
    if (!file) return;
    const i = slot.current;
    setBusy(true);
    put(i, WAITING);
    try {
      put(i, await readOne(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "사진을 열지 못했어요");
      put(i, null);
    } finally {
      setBusy(false);
    }
  };

  const [a, b] = shots;
  const span = a && b ? spanOf(a.v, b.v) : null;
  const ready = !!(a?.blob && b?.blob && a.read !== "wait" && b.read !== "wait" && span);

  const save = async () => {
    if (!a?.blob || !b?.blob || !span) return;
    setBusy(true);
    setErr("");
    const now = Date.now();
    const day = kstDay(b.at > now - 30 * 86_400_000 && b.at <= now + 60_000 ? b.at : now);
    let id = 0;
    try {
      ({ id } = await api<{ id: number }>("/api/diary/runs", "POST", { day, ...span, t_from: a.v.time, t_to: b.v.time }));
      for (const [side, p] of [
        ["from", a],
        ["to", b],
      ] as const) {
        const res = await fetch(`/api/diary/runs/${id}/shot?side=${side}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { ...apiHeaders(false), "content-type": p.blob!.type },
          body: p.blob,
        });
        if (!res.ok) throw new Error("사진을 올리지 못했어요. 다시 해 주세요");
      }
      onSaved();
    } catch (e) {
      if (id) void api(`/api/diary/runs/${id}`, "DELETE").catch(() => undefined);
      setErr(e instanceof Error ? e.message : "올리지 못했어요");
    } finally {
      setBusy(false);
    }
  };

  const setSide = (i: number, v: Side) => setShots((ps) => ps.map((p, k) => (k === i && p ? { ...p, v } : p)));
  return (
    <section className="dy-form">
      <input
        ref={both}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void pickBoth([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <input
        ref={one}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pickOne(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {!a && !b ? (
        <button className="dy-pick" onClick={() => both.current?.click()} disabled={busy}>
          <b>스샷 두 장 고르기</b>
          <small>시작 · 끝 (순서는 알아서)</small>
        </button>
      ) : (
        <>
          {[a, b].map((p, i) => (
            <div key={i} className="dy-side">
              <button
                className="dy-thumb"
                onClick={() => {
                  slot.current = i;
                  one.current?.click();
                }}
                disabled={busy}
              >
                {p?.url ? <img src={p.url} alt="" /> : <span>{p ? "줄이는 중" : "+ 사진"}</span>}
              </button>
              <div className="dy-side-main">
                <b>
                  {i === 0 ? "시작" : "끝"}
                  {p?.read === "wait" && <small className="dy-reading"> 읽는 중</small>}
                  {p?.read === "fail" && <small className="dy-warn"> 직접 적어 주세요</small>}
                </b>
                {p && p.read !== "wait" && <SideFields v={p.v} set={(v) => setSide(i, v)} />}
              </div>
            </div>
          ))}
          <div className="dy-row dy-row-mid">
            <button className="pill" onClick={() => setShots([b, a])} disabled={busy}>
              시작 ⇄ 끝
            </button>
          </div>
          <Preview span={span} rates={rates} />
        </>
      )}
      {err && <p className="dy-err">{err}</p>}
      <div className="dy-row">
        <button className="btn btn-ghost" onClick={onCancel}>
          취소
        </button>
        <button className="btn" onClick={() => void save()} disabled={busy || !ready}>
          올리기
        </button>
      </div>
    </section>
  );
}

/** 레벨마다 1% 단가 (1%당 원, 또는 1시간 금액 ÷ 1시간 시험 %) */
function Rates({ rates, onChange }: { rates: Rate[]; onChange: () => void }) {
  const [open, setOpen] = useState(rates.length === 0);
  const [adding, setAdding] = useState("");
  const summary = rates.map((r) => {
    const p = perPct(rates, r.level);
    return `Lv.${r.level} ${p === null ? "?" : won(p)}`;
  });
  return (
    <section className="dy-box">
      <button className="dy-box-head dy-fold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>1% 단가</b>
        <small>{summary.length ? summary.join(" · ") : "없음"}</small>
        <i>{open ? "▲" : "▼"}</i>
      </button>
      {open && (
        <div className="dy-rates">
          {rates.map((r) => (
            <RateRow key={r.level} r={r} onChange={onChange} />
          ))}
          <div className="dy-rate-add">
            <em>Lv</em>
            <input className="mk-input" inputMode="numeric" value={adding} onChange={(e) => setAdding(e.target.value.replace(/\D/g, ""))} />
            <button
              className="pill"
              disabled={!adding || rates.some((r) => r.level === Number(adding))}
              onClick={() => {
                void api("/api/diary/rates", "PUT", { level: Number(adding), per_pct: 1000 }).then(() => {
                  setAdding("");
                  onChange();
                });
              }}
            >
              레벨 추가
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function RateRow({ r, onChange }: { r: Rate; onChange: () => void }) {
  const [mode, setMode] = useState<"pct" | "hour">(r.per_pct === null && r.per_hour !== null ? "hour" : "pct");
  const [p, setP] = useState(r.per_pct?.toString() ?? "");
  const [h, setH] = useState(r.per_hour?.toString() ?? "");
  const [t, setT] = useState(r.test_pct?.toString() ?? "");
  const [msg, setMsg] = useState("");
  const hn = numOr(h);
  const tn = numOr(t);
  const per = mode === "pct" ? numOr(p) : hn !== null && tn !== null && tn > 0 ? hn / tn : null;
  const save = () =>
    api("/api/diary/rates", "PUT", mode === "pct" ? { level: r.level, per_pct: numOr(p) } : { level: r.level, per_hour: hn, test_pct: tn })
      .then(() => {
        setMsg("저장했어요");
        onChange();
      })
      .catch((e: Error) => setMsg(e.message));
  return (
    <div className="dy-rate">
      <div className="dy-rate-head">
        <b>Lv.{r.level}</b>
        <span className="dy-modes">
          <button className={"pill" + (mode === "pct" ? " pill-on" : "")} onClick={() => setMode("pct")}>
            1%당
          </button>
          <button className={"pill" + (mode === "hour" ? " pill-on" : "")} onClick={() => setMode("hour")}>
            1시간
          </button>
        </span>
      </div>
      {mode === "pct" ? (
        <div className="dy-rate-in">
          <input className="mk-input" inputMode="decimal" value={p} onChange={(e) => setP(onlyNum(e.target.value))} />
          <em>원 / 1%</em>
        </div>
      ) : (
        <div className="dy-rate-in">
          <input className="mk-input" inputMode="decimal" value={h} placeholder="1시간 금액" onChange={(e) => setH(onlyNum(e.target.value))} />
          <em>원 ÷</em>
          <input className="mk-input" inputMode="decimal" value={t} placeholder="시험 %" onChange={(e) => setT(onlyNum(e.target.value))} />
          <em>%</em>
        </div>
      )}
      <div className="dy-rate-foot">
        <span>{per === null ? (mode === "hour" ? "1시간 시험에서 오른 % 를 적으면 1%당 단가" : "") : `1%당 ${won(per)}원`}</span>
        {msg && <small>{msg}</small>}
        <button className="pill" onClick={() => void save()}>
          저장
        </button>
      </div>
    </div>
  );
}

/** 지난 정산: 누르면 그때 기록. 가장 최근 정산은 취소할 수 있다 */
function Settles({ settles, runs, rates, onChange }: { settles: Settle[]; runs: Run[]; rates: Rate[]; onChange: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  const bySettle = useMemo(() => {
    const m = new Map<number, Run[]>();
    for (const r of runs) if (r.settle_id !== null) m.set(r.settle_id, [...(m.get(r.settle_id) ?? []), r]);
    return m;
  }, [runs]);
  if (!settles.length) return null;
  const undo = () => {
    if (!sure) {
      setSure(true);
      window.setTimeout(() => setSure(false), 3000);
      return;
    }
    void api("/api/diary/settle", "DELETE").then(() => {
      setSure(false);
      onChange();
    });
  };
  return (
    <section className="dy-box">
      <header className="dy-box-head">
        <b>정산 기록</b>
        <small>합 {won(settles.reduce((t, s) => t + s.pay, 0))}원</small>
      </header>
      {settles.map((s, i) => {
        const on = openId === s.id;
        const d = kstDay(s.at);
        return (
          <div key={s.id} className="dy-settled">
            <button className="dy-settled-row" onClick={() => setOpenId(on ? null : s.id)} aria-expanded={on}>
              <span>
                {md(d)} ({weekOf(d)})
              </span>
              <b>{won(s.pay)}원</b>
              <small>
                {s.runs}개{s.carry_out > 0.5 ? ` · 이월 ${won(s.carry_out)}` : ""}
              </small>
            </button>
            {on && (
              <div className="dy-settled-body">
                <RunTable runs={bySettle.get(s.id) ?? []} rates={rates} onChange={onChange} />
                <div className="dy-carry">
                  <span>
                    기록 합 {won(s.sum)}원{s.carry_in > 0.5 ? ` + 이월 ${won(s.carry_in)}원` : ""}
                  </span>
                  <span>{s.by_user}</span>
                </div>
                <SendSheet s={s} onMade={onChange} />
                {i === 0 && (
                  <button className={"dy-link dy-undo" + (sure ? " dy-sure" : "")} onClick={undo}>
                    {sure ? "정말 정산 취소" : "정산 취소"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** 정산서 보내기: 로그인 없이 보는 정산서 링크(/p/<토큰>)를 복사한다. 처음 누를 때 링크를 만든다 */
function SendSheet({ s, onMade }: { s: Settle; onMade: () => void }) {
  const [url, setUrl] = useState(s.share ? location.origin + "/p/" + s.share : "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = (u: string) => {
    const done = () => setMsg("링크를 복사했어요");
    const fail = () => setMsg("아래 링크를 길게 눌러 복사해 주세요");
    try {
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(u).then(done, fail);
      else fail();
    } catch {
      fail();
    }
  };
  const send = () => {
    if (url) return copy(url);
    setBusy(true);
    setMsg("");
    api<{ url: string }>("/api/diary/share", "POST", { settle: s.id })
      .then((r) => {
        setUrl(r.url);
        copy(r.url);
        onMade();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="dy-send">
      <button className="pill dy-send-btn" onClick={send} disabled={busy}>
        {busy ? "링크 만드는 중" : "정산서 보내기"}
      </button>
      {msg && <small>{msg}</small>}
      {url && (
        <input className="mk-input dy-send-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="정산서 링크" />
      )}
    </div>
  );
}
