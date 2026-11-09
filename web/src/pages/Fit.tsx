// 헬스 루틴 (개발중, 길드원 완뻔치 님 개발 요청 #8 '헬스루틴 추가해주세요', 제작자 2026-11-09 '플릭 같은 헬스 어플 만들어 달라는 거'):
// 실제 헬스장 운동을 적는 기록장 (게임과 상관없다). 칸: 운동(루틴, 시작) · 기록(달력) · 종목(라이브러리, 종목마다 그래프).
// 하는 중인 운동은 세트를 누를 때마다 이 기기(localStorage)와 서버(fit_drafts)에 둔다: 새로 고치거나 다른 폰에서 열어도 이어서.
// 세트 체크 칸을 누르면 쉬는 시간이 돌고(30초씩 조절, 끝나면 폰 진동), 운동 끝을 누르면 끝낸 세트만 기록으로 남고 새 최고 기록을 보여 준다.
// 서버 server/fit.ts. 그래프·최고 기록·지난번 값은 이 화면이 셈한다 (서버 CPU 를 아끼려고)
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { errorText } from "../auth";
import type { Me } from "../auth";
import { useBackClose } from "../backClose";
import { useEntryState } from "../router";
import { FitLine, Loading, TopBar } from "../ui";
import {
  KINDS,
  KIND_NAME,
  LIBRARY,
  PARTS,
  PART_NAME,
  addDays,
  addExercise,
  beaconDraft,
  bestText,
  clock,
  delDraft,
  delExercise,
  delRoutine,
  delWorkout,
  draftTotals,
  durText,
  finishWorkout,
  historyByKey,
  kgText,
  kstDay,
  loadFit,
  mondayOf,
  newRecords,
  numText,
  putDraft,
  readLocal,
  saveRoutine,
  secText,
  setFilled,
  setText,
  volText,
  weekStreak,
  weekdayMon,
  writeLocal,
} from "../fit";
import type { Draft, Entry, Exercise, FitData, FitSet, Kind, PR, Part, Point, Routine, RoutineItem, Workout } from "../fit";
import "./fit.css";

type Tab = "start" | "log" | "ex";
const TABS: [Tab, string][] = [
  ["start", "운동"],
  ["log", "기록"],
  ["ex", "종목"],
];
const REST_DEFAULT = 90;
const REST_STEP = 30;
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

/** 보는 동안 흐르는 시계 (on 일 때만) */
function useNow(on: boolean, ms = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [on, ms]);
  return now;
}

/** 값이 바뀌면 톡 튄다 (처음 그릴 때는 그대로) */
function Pop({ v, children, className }: { v: string | number; children: ReactNode; className?: string }) {
  const first = useRef(v);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (v !== first.current) {
      first.current = v;
      setN((x) => x + 1);
    }
  }, [v]);
  return (
    <span key={n} className={(n ? "fit-pop " : "") + (className ?? "")}>
      {children}
    </span>
  );
}

/** 그 종목을 마지막으로 한 날 */
const lastOf = (history: Map<string, Point[]>, key: string): Point | undefined => {
  const list = history.get(key);
  return list?.length ? list[list.length - 1] : undefined;
};

/** '11/2' */
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const hm = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16);

export function FitPage({ me }: { me: Me }) {
  const [data, setData] = useState<FitData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useEntryState<Tab>("fit.tab", "start");
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [inSession, setInSession] = useState(false);
  const [picker, setPicker] = useState<null | "session" | "routine">(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ w: Workout; prs: PR[] } | null>(null);
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [routineAdd, setRoutineAdd] = useState<Exercise[] | null>(null);
  const [day, setDay] = useEntryState("fit.day", kstDay(Date.now()));

  // 폰 뒤로 가기: 운동 화면은 닫고 운동은 그대로 둔다 (backClose.ts)
  useBackClose(inSession, () => setInSession(false));

  // ---------- 하는 중인 운동: 이 기기에 바로, 서버에는 1.2초 모아서 ----------
  const pending = useRef(false);
  const timer = useRef(0);
  const unsent = useRef<Draft | null>(null);
  const changeDraft = useCallback((fn: (d: Draft | null) => Draft | null) => {
    pending.current = true;
    setDraftState((prev) => {
      const next = fn(prev);
      return next ? { ...next, saved: Date.now() } : null;
    });
  }, []);
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    writeLocal(me.id, draft, false);
    window.clearTimeout(timer.current);
    if (!draft) {
      unsent.current = null;
      return;
    }
    unsent.current = draft;
    timer.current = window.setTimeout(() => {
      const d = draft;
      putDraft(d)
        .then(() => {
          if (unsent.current === d) {
            unsent.current = null;
            writeLocal(me.id, d, true);
          }
        })
        .catch(() => undefined);
    }, 1200);
  }, [draft, me.id]);
  // 다른 앱으로 가거나 화면을 떠나면 모아 둔 것을 바로 보낸다
  useEffect(() => {
    const flush = () => {
      if (!unsent.current) return;
      window.clearTimeout(timer.current);
      beaconDraft(unsent.current);
      writeLocal(me.id, unsent.current, true);
      unsent.current = null;
    };
    const vis = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [me.id]);

  const reload = useCallback(() => {
    loadFit()
      .then((d) => {
        // 이 기기와 서버 중 새 것 (서버에 없는데 이 기기 것이 서버에 올라갔던 것이면 다른 폰에서 끝냈거나 취소한 것)
        const local = readLocal(me.id);
        let dr = d.draft;
        let push = false;
        if (local) {
          if (!dr) {
            dr = local.synced ? null : local.draft;
            push = !!dr;
          } else if (local.draft.saved > (dr.saved ?? 0)) {
            dr = local.draft;
            push = !local.synced;
          }
        }
        setData(d);
        setError("");
        // 하던 운동이 있으면 바로 그 화면으로 (새로 고쳐도 이어서)
        if (dr) setInSession(true);
        if (push && dr) {
          const keep = dr;
          changeDraft(() => keep);
        } else {
          setDraftState(dr);
          writeLocal(me.id, dr, true);
        }
      })
      .catch((e) => setError(errorText(e)));
  }, [me.id, changeDraft]);
  useEffect(() => {
    reload();
  }, [reload]);

  const exercises = useMemo(() => [...LIBRARY, ...(data?.custom ?? [])], [data]);
  const byKey = useMemo(() => new Map(exercises.map((x) => [x.key, x])), [exercises]);
  const history = useMemo(() => historyByKey(data?.workouts ?? []), [data]);

  function start(r?: Routine) {
    if (draft) {
      setInSession(true);
      return;
    }
    const now = Date.now();
    changeDraft(() => ({
      title: r?.name ?? "자유 운동",
      started: now,
      routine: r?.id ?? null,
      entries: (r?.items ?? []).map((it) => ({ key: it.key, name: it.name, part: it.part, kind: it.kind, goal: it.goal, sets: Array.from({ length: it.sets }, () => ({})) })),
      restSec: REST_DEFAULT,
      rest: null,
      saved: now,
    }));
    setInSession(true);
    window.scrollTo(0, 0);
  }

  async function finish(): Promise<string | null> {
    if (!draft || !data) return null;
    if (!draftTotals(draft.entries).sets) return "끝낸 세트가 없어요. 세트 오른쪽 칸을 눌러 체크해 주세요";
    try {
      const w = await finishWorkout(draft);
      const prs = newRecords(draft.entries, history);
      setData({ ...data, workouts: [w, ...data.workouts] });
      changeDraft(() => null);
      setInSession(false);
      setSummary({ w, prs });
      setDay(w.day);
      return null;
    } catch (e) {
      return errorText(e);
    }
  }

  async function cancel() {
    changeDraft(() => null);
    setInSession(false);
    await delDraft().catch(() => undefined);
  }

  const openPicker = (forWhat: "session" | "routine") => setPicker(forWhat);
  const addToDraft = (list: Exercise[]) =>
    changeDraft((d) => (d ? { ...d, entries: [...d.entries, ...list.map((x) => ({ key: x.key, name: x.name, part: x.part, kind: x.kind, sets: [{}, {}, {}] }))] } : d));

  const detailEx = detail ? (byKey.get(detail) ?? exFromHistory(detail, data?.workouts ?? [])) : null;

  let body;
  if (!data) body = <Loading error={error || undefined} onRetry={reload} />;
  else if (inSession && draft)
    body = (
      <Session
        draft={draft}
        change={changeDraft}
        history={history}
        onAdd={() => openPicker("session")}
        onDetail={setDetail}
        onFinish={finish}
        onCancel={cancel}
      />
    );
  else if (editing)
    body = (
      <RoutineEditor
        key={editing === "new" ? "new" : editing.id}
        routine={editing === "new" ? null : editing}
        adding={routineAdd}
        onAdded={() => setRoutineAdd(null)}
        onPick={() => openPicker("routine")}
        onClose={() => setEditing(null)}
        onSaved={(r, gone) => {
          setData({ ...data, routines: gone ? data.routines.filter((x) => x.id !== r.id) : data.routines.some((x) => x.id === r.id) ? data.routines.map((x) => (x.id === r.id ? r : x)) : [...data.routines, r] });
          setEditing(null);
        }}
      />
    );
  else
    body = (
      <>
        <div className="pill-row fit-tabs" role="tablist">
          {TABS.map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={"pill" + (tab === k ? " pill-on" : "")} onClick={() => setTab(k)}>
              {name}
            </button>
          ))}
        </div>
        {tab === "start" && <StartTab data={data} draft={draft} onStart={start} onResume={() => setInSession(true)} onEdit={setEditing} />}
        {tab === "log" && <LogTab data={data} day={day} onDay={setDay} onDetail={setDetail} onDeleted={(id) => setData({ ...data, workouts: data.workouts.filter((w) => w.id !== id) })} />}
        {tab === "ex" && (
          <ExTab
            exercises={exercises}
            history={history}
            onDetail={setDetail}
            onAdded={(x) => setData({ ...data, custom: [...data.custom, x] })}
          />
        )}
      </>
    );

  return (
    <>
      <TopBar title="헬스 루틴" />
      <div className={"fit" + (draft?.rest && inSession ? " fit-resting" : "")}>{body}</div>
      {inSession && draft?.rest && <RestBar draft={draft} change={changeDraft} />}
      {picker && (
        <Picker
          exercises={exercises}
          history={history}
          onClose={() => setPicker(null)}
          onPick={(list) => {
            if (picker === "session") addToDraft(list);
            else setRoutineAdd(list);
            setPicker(null);
          }}
        />
      )}
      {detailEx && (
        <Detail
          ex={detailEx}
          points={history.get(detailEx.key) ?? []}
          onClose={() => setDetail(null)}
          onDeleted={() => {
            setData(data ? { ...data, custom: data.custom.filter((c) => c.key !== detailEx.key) } : data);
            setDetail(null);
          }}
        />
      )}
      {summary && (
        <Summary
          {...summary}
          onClose={() => setSummary(null)}
          onLog={() => {
            setSummary(null);
            setTab("log");
          }}
        />
      )}
    </>
  );
}

/** 지운 내 종목처럼 목록에 없는 종목: 기록에 남은 이름으로 */
function exFromHistory(key: string, workouts: Workout[]): Exercise | null {
  for (const w of workouts) for (const e of w.data.entries ?? []) if (e.key === key) return { key, name: e.name, part: e.part, kind: e.kind };
  return null;
}

// ---------- 운동 칸 ----------

function StartTab({ data, draft, onStart, onResume, onEdit }: { data: FitData; draft: Draft | null; onStart: (r?: Routine) => void; onResume: () => void; onEdit: (r: Routine | "new") => void }) {
  const now = useNow(!!draft, 1000);
  const today = kstDay(now);
  const days = useMemo(() => new Set(data.workouts.map((w) => w.day)), [data.workouts]);
  const monday = mondayOf(today);
  const week = data.workouts.filter((w) => w.day >= monday).length;
  const streak = weekStreak(days, today);
  return (
    <>
      <div className="fit-stats">
        <span>
          이번 주 <b>{week}</b>회
        </span>
        <span>
          연속 <b>{streak}</b>주
        </span>
        <span>
          전체 <b>{data.workouts.length}</b>회
        </span>
      </div>
      {draft ? (
        <button type="button" className="fit-resume" onClick={onResume}>
          <span className="fit-resume-dot" aria-hidden />
          <span className="fit-resume-main">
            <b>운동 중 · {draft.title}</b>
            <small>
              {clock(now - draft.started)} · 세트 {draftTotals(draft.entries).sets}
            </small>
          </span>
          <span className="fit-resume-go">이어서 ›</span>
        </button>
      ) : (
        <button type="button" className="fit-start" onClick={() => onStart()}>
          <b>+ 빈 운동 시작</b>
        </button>
      )}
      <div className="fit-head">
        <h2>루틴</h2>
        <button type="button" className="pill" onClick={() => onEdit("new")}>
          + 루틴 만들기
        </button>
      </div>
      {data.routines.length === 0 ? (
        <p className="fit-empty">아직 루틴이 없어요</p>
      ) : (
        <div className="fit-routines">
          {data.routines.map((r) => (
            <div key={r.id} className="fit-routine">
              <div className="fit-routine-main">
                <b>{r.name}</b>
                <small>
                  {r.items.length}종목 · {r.items.reduce((n, i) => n + i.sets, 0)}세트
                </small>
                <p>{r.items.map((i) => i.name).join(" · ")}</p>
              </div>
              <div className="fit-routine-act">
                <button type="button" className="pill" onClick={() => onEdit(r)}>
                  편집
                </button>
                <button type="button" className="pill pill-gold" disabled={!!draft} onClick={() => onStart(r)}>
                  시작
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- 숫자 칸 (고치는 동안 비울 수 있게, 칸을 벗어나면 맞춘다) ----------

function NumBox({ value, hint, onChange, max, digits = 0, label, className }: { value: number | undefined; hint?: number; onChange: (v: number | undefined) => void; max: number; digits?: number; label: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className={"fit-num " + (className ?? "")}
      inputMode={digits ? "decimal" : "numeric"}
      aria-label={label}
      value={text ?? numText(value)}
      placeholder={hint !== undefined ? numText(hint) : ""}
      onFocus={(e) => {
        setText(numText(value));
        e.target.select();
      }}
      onChange={(e) => {
        let t = e.target.value.replace(",", ".");
        if (!digits) t = t.replace(/\D/g, "");
        if (!/^\d*\.?\d*$/.test(t) || t.length > 7) return;
        setText(t);
        if (t === "" || t === ".") onChange(undefined);
        else onChange(Math.min(max, Math.round(Number(t) * 10 ** digits) / 10 ** digits));
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** 종목의 칸들 (종류마다): [이름, 값 이름, 한도, 소수 자리] */
const FIELDS: Record<Kind, [keyof FitSet, string, number, number][]> = {
  weight: [
    ["kg", "kg", 1000, 2],
    ["reps", "회", 1000, 0],
  ],
  reps: [["reps", "회", 1000, 0]],
  time: [["sec", "초", 36000, 0]],
  cardio: [
    ["min", "분", 1440, 1],
    ["km", "km", 500, 2],
  ],
};

// ---------- 운동 중 ----------

function Session({
  draft,
  change,
  history,
  onAdd,
  onDetail,
  onFinish,
  onCancel,
}: {
  draft: Draft;
  change: (fn: (d: Draft | null) => Draft | null) => void;
  history: Map<string, Point[]>;
  onAdd: () => void;
  onDetail: (key: string) => void;
  onFinish: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const now = useNow(true, 1000);
  const [arm, setArm] = useState<"" | "finish" | "cancel">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bad, setBad] = useState("");
  const [armEntry, setArmEntry] = useState(-1);
  const totals = draftTotals(draft.entries);
  const edit = (i: number, fn: (e: Entry) => Entry | null) =>
    change((d) => {
      if (!d) return d;
      const entries = d.entries.flatMap((e, j) => (j === i ? (fn(e) ?? []) : [e]));
      return { ...d, entries };
    });
  const move = (i: number, by: number) =>
    change((d) => {
      if (!d) return d;
      const j = i + by;
      if (j < 0 || j >= d.entries.length) return d;
      const entries = [...d.entries];
      [entries[i], entries[j]] = [entries[j], entries[i]];
      return { ...d, entries };
    });

  /** 칸의 흐린 값: 지난번 같은 세트 → 이번 운동의 앞 세트 → 루틴 목표 */
  function hintOf(e: Entry, si: number): FitSet {
    const last = lastOf(history, e.key);
    if (last?.sets.length) return last.sets[Math.min(si, last.sets.length - 1)];
    for (let j = si - 1; j >= 0; j--) if (setFilled(e.kind, e.sets[j])) return e.sets[j];
    return e.goal ?? {};
  }

  function toggle(i: number, si: number) {
    const e = draft.entries[i];
    const s = e.sets[si];
    if (s.done) {
      edit(i, (x) => ({ ...x, sets: x.sets.map((y, k) => (k === si ? { ...y, done: false } : y)) }));
      return;
    }
    const h = hintOf(e, si);
    const filled: FitSet = { ...s };
    for (const [f] of FIELDS[e.kind]) if (filled[f] === undefined && typeof h[f] === "number") (filled as Record<string, number>)[f] = h[f] as number;
    if (!setFilled(e.kind, filled)) {
      setBad(`${i}-${si}`);
      window.setTimeout(() => setBad(""), 700);
      return;
    }
    const at = Date.now();
    change((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((x, j) => (j === i ? { ...x, sets: x.sets.map((y, k) => (k === si ? { ...filled, done: true } : y)) } : x)),
            rest: { end: at + d.restSec * 1000, total: d.restSec },
          }
        : d,
    );
    navigator.vibrate?.(15);
  }

  return (
    <div className="fit-session">
      <div className="fit-now">
        <input
          className="fit-title-in"
          aria-label="운동 이름"
          value={draft.title}
          maxLength={30}
          onChange={(e) => {
            const v = e.target.value;
            change((d) => (d ? { ...d, title: v } : d));
          }}
          onBlur={() => !draft.title.trim() && change((d) => (d ? { ...d, title: "자유 운동" } : d))}
        />
        <div className="fit-now-row">
          <span className="fit-clock">{clock(now - draft.started)}</span>
          <span className="fit-now-meta">
            <Pop v={totals.volume}>볼륨 {volText(totals.volume)}</Pop>
            <Pop v={totals.sets}>세트 {totals.sets}</Pop>
          </span>
        </div>
      </div>

      {draft.entries.length === 0 && <p className="fit-empty">종목을 추가해 주세요</p>}
      {draft.entries.map((e, i) => {
        const last = lastOf(history, e.key);
        const fields = FIELDS[e.kind];
        return (
          <div key={i + e.key} className="fit-entry">
            <div className="fit-entry-head">
              <button type="button" className="fit-entry-name" onClick={() => onDetail(e.key)}>
                <b>{e.name}</b>
                <small>{PART_NAME[e.part]}</small>
              </button>
              <span className="fit-entry-act">
                <button type="button" className="fit-mini" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>
                  ▲
                </button>
                <button type="button" className="fit-mini" aria-label="아래로" disabled={i === draft.entries.length - 1} onClick={() => move(i, 1)}>
                  ▼
                </button>
                <button
                  type="button"
                  className={"fit-mini" + (armEntry === i ? " fit-armed" : "")}
                  onClick={() => {
                    if (armEntry !== i) {
                      setArmEntry(i);
                      return;
                    }
                    setArmEntry(-1);
                    edit(i, () => null);
                  }}
                >
                  {armEntry === i ? "빼기 확인" : "빼기"}
                </button>
              </span>
            </div>
            {last && (
              <p className="fit-last">
                지난번 {md(last.day)} · {last.sets.map((s) => setText(e.kind, s)).join(" · ")}
              </p>
            )}
            <div className={"fit-sets fit-cols-" + fields.length}>
              <span className="fit-sets-h">세트</span>
              {fields.map(([, name]) => (
                <span key={name} className="fit-sets-h">
                  {name}
                </span>
              ))}
              <span className="fit-sets-h">완료</span>
              {e.sets.map((s, si) => {
                const h = hintOf(e, si);
                return (
                  <Fragment key={si}>
                    <span className={"fit-set-no" + (s.done ? " fit-done" : "")}>{si + 1}</span>
                    {fields.map(([f, name, max, digits]) => (
                      <NumBox
                        key={f}
                        label={`${si + 1}세트 ${name}`}
                        className={s.done ? "fit-done" : ""}
                        value={s[f] as number | undefined}
                        hint={h[f] as number | undefined}
                        max={max}
                        digits={digits}
                        onChange={(v) => edit(i, (x) => ({ ...x, sets: x.sets.map((y, k) => (k === si ? { ...y, [f]: v } : y)) }))}
                      />
                    ))}
                    <button
                      type="button"
                      className={"fit-check" + (s.done ? " fit-check-on" : "") + (bad === `${i}-${si}` ? " fit-check-bad" : "")}
                      aria-label={`${si + 1}세트 완료`}
                      aria-pressed={!!s.done}
                      onClick={() => toggle(i, si)}
                    >
                      ✓
                    </button>
                  </Fragment>
                );
              })}
            </div>
            <div className="fit-set-btns">
              <button type="button" className="pill" disabled={e.sets.length <= 1} onClick={() => edit(i, (x) => ({ ...x, sets: x.sets.slice(0, -1) }))}>
                − 세트
              </button>
              <button type="button" className="pill" disabled={e.sets.length >= 30} onClick={() => edit(i, (x) => ({ ...x, sets: [...x.sets, {}] }))}>
                + 세트
              </button>
            </div>
          </div>
        );
      })}
      <button type="button" className="fit-start fit-add" onClick={onAdd}>
        <b>+ 종목 추가</b>
      </button>
      {err && <p className="form-error">{err}</p>}
      <div className="fit-end">
        <button
          type="button"
          className={"btn btn-ghost" + (arm === "cancel" ? " fit-armed" : "")}
          onClick={() => {
            if (arm !== "cancel") return setArm("cancel");
            onCancel();
          }}
        >
          {arm === "cancel" ? "취소 확인" : "운동 취소"}
        </button>
        <button
          type="button"
          className={"btn" + (arm === "finish" ? " fit-armed" : "")}
          disabled={busy}
          onClick={async () => {
            if (arm !== "finish") return setArm("finish");
            setBusy(true);
            setErr("");
            const e = await onFinish();
            setBusy(false);
            setArm("");
            if (e) setErr(e);
          }}
        >
          {busy ? "저장 중…" : arm === "finish" ? "끝내기 확인" : "운동 끝"}
        </button>
      </div>
    </div>
  );
}

/** 쉬는 시간 (세트를 체크하면 돈다, 30초씩 조절하면 다음 휴식도 그 길이로, 끝나면 폰 진동) */
function RestBar({ draft, change }: { draft: Draft; change: (fn: (d: Draft | null) => Draft | null) => void }) {
  const rest = draft.rest!;
  const now = useNow(true, 250);
  const left = rest.end - now;
  const ended = left <= 0;
  useEffect(() => {
    if (!ended) return;
    // 방금 끝났으면 진동 (새로 고쳐 열었을 때 오래전에 끝난 휴식은 조용히)
    if (Date.now() - rest.end < 3000) navigator.vibrate?.([300, 120, 300]);
    // 끝난 뒤 4초 보이고 닫는다
    const t = window.setTimeout(() => change((d) => (d && d.rest?.end === rest.end ? { ...d, rest: null } : d)), 4000);
    return () => window.clearTimeout(t);
  }, [ended, rest.end, change]);
  const adjust = (by: number) =>
    change((d) => {
      if (!d?.rest) return d;
      const total = Math.max(REST_STEP, d.rest.total + by);
      const restSec = Math.max(REST_STEP, Math.min(600, d.restSec + by));
      return { ...d, restSec, rest: { end: Math.max(Date.now() + 5000, d.rest.end + by * 1000), total } };
    });
  const done = ended;
  const pct = done ? 100 : Math.min(100, Math.max(0, 100 - (left / (rest.total * 1000)) * 100));
  return (
    <div className={"fit-rest" + (done ? " fit-rest-done" : left < 5000 ? " fit-rest-soon" : "")} role="timer" aria-live="polite">
      <span className="fit-rest-bar" style={{ transform: `scaleX(${pct / 100})` }} aria-hidden />
      <span className="fit-rest-main">
        <small>{done ? "휴식 끝" : `휴식 · 기본 ${secText(draft.restSec)}`}</small>
        <b>{done ? "다음 세트!" : clock(left + 999)}</b>
      </span>
      <button type="button" className="fit-mini" onClick={() => adjust(-REST_STEP)}>
        −30초
      </button>
      <button type="button" className="fit-mini" onClick={() => adjust(REST_STEP)}>
        +30초
      </button>
      <button type="button" className="fit-mini" onClick={() => change((d) => (d ? { ...d, rest: null } : d))}>
        끝
      </button>
    </div>
  );
}

// ---------- 루틴 만들기·편집 ----------

function RoutineEditor({
  routine,
  adding,
  onAdded,
  onPick,
  onClose,
  onSaved,
}: {
  routine: Routine | null;
  adding: Exercise[] | null;
  onAdded: () => void;
  onPick: () => void;
  onClose: () => void;
  onSaved: (r: Routine, gone?: boolean) => void;
}) {
  useBackClose(true, onClose);
  const [name, setName] = useState(routine?.name ?? "");
  const [items, setItems] = useState<RoutineItem[]>(routine?.items ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [armDel, setArmDel] = useState(false);
  const [armItem, setArmItem] = useState(-1);
  // 고른 종목을 넣는다 (기본 3세트, 무게 종목은 10회)
  useEffect(() => {
    if (!adding) return;
    setItems((list) => [...list, ...adding.map((x) => ({ key: x.key, name: x.name, part: x.part, kind: x.kind, sets: 3, goal: x.kind === "weight" || x.kind === "reps" ? { reps: 10 } : {} }))].slice(0, 25));
    onAdded();
  }, [adding, onAdded]);
  const set = (i: number, patch: Partial<RoutineItem>) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) =>
    setItems((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  async function save() {
    setBusy(true);
    setErr("");
    try {
      const r = await saveRoutine(routine?.id ?? null, { name: name.trim(), items });
      onSaved({ id: r.id, name: r.name, items: JSON.parse(r.items) as RoutineItem[] });
    } catch (e) {
      setErr(errorText(e));
    }
    setBusy(false);
  }
  return (
    <div className="fit-editor">
      <div className="fit-head">
        <h2>{routine ? "루틴 편집" : "새 루틴"}</h2>
      </div>
      <input className="mk-input fit-name-in" placeholder="루틴 이름 (예: 가슴·삼두 데이)" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
      {items.length === 0 && <p className="fit-empty">종목을 추가해 주세요</p>}
      {items.map((it, i) => (
        <div key={i + it.key} className="fit-entry">
          <div className="fit-entry-head">
            <span className="fit-entry-name">
              <b>{it.name}</b>
              <small>{PART_NAME[it.part]}</small>
            </span>
            <span className="fit-entry-act">
              <button type="button" className="fit-mini" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>
                ▲
              </button>
              <button type="button" className="fit-mini" aria-label="아래로" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                ▼
              </button>
              <button
                type="button"
                className={"fit-mini" + (armItem === i ? " fit-armed" : "")}
                onClick={() => {
                  if (armItem !== i) return setArmItem(i);
                  setArmItem(-1);
                  setItems((list) => list.filter((_, j) => j !== i));
                }}
              >
                {armItem === i ? "빼기 확인" : "빼기"}
              </button>
            </span>
          </div>
          <div className="fit-goal">
            <span className="fit-step">
              <button type="button" className="fit-mini" aria-label="세트 줄이기" disabled={it.sets <= 1} onClick={() => set(i, { sets: it.sets - 1 })}>
                −
              </button>
              <b>
                <Pop v={it.sets}>{it.sets}세트</Pop>
              </b>
              <button type="button" className="fit-mini" aria-label="세트 늘리기" disabled={it.sets >= 30} onClick={() => set(i, { sets: it.sets + 1 })}>
                +
              </button>
            </span>
            {FIELDS[it.kind].map(([f, label, max, digits]) => (
              <label key={f} className="fit-goal-f">
                <NumBox label={label} value={it.goal[f] as number | undefined} max={max} digits={digits} onChange={(v) => set(i, { goal: { ...it.goal, [f]: v } })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="fit-start fit-add" onClick={onPick} disabled={items.length >= 25}>
        <b>+ 종목 추가</b>
      </button>
      {err && <p className="form-error">{err}</p>}
      <div className="fit-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          취소
        </button>
        <button type="button" className="btn" disabled={busy || !name.trim() || !items.length} onClick={save}>
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
      {routine && (
        <button
          type="button"
          className={"fit-del" + (armDel ? " fit-armed" : "")}
          onClick={async () => {
            if (!armDel) return setArmDel(true);
            try {
              await delRoutine(routine.id);
              onSaved(routine, true);
            } catch (e) {
              setErr(errorText(e));
            }
          }}
        >
          {armDel ? "루틴 삭제 확인" : "루틴 삭제"}
        </button>
      )}
    </div>
  );
}

// ---------- 기록 칸 (달력) ----------

function LogTab({ data, day, onDay, onDetail, onDeleted }: { data: FitData; day: string; onDay: (d: string) => void; onDetail: (k: string) => void; onDeleted: (id: number) => void }) {
  const today = kstDay(Date.now());
  const [month, setMonth] = useEntryState("fit.month", day.slice(0, 7));
  const byDay = useMemo(() => {
    const m = new Map<string, Workout[]>();
    for (const w of data.workouts) m.set(w.day, [...(m.get(w.day) ?? []), w]);
    return m;
  }, [data.workouts]);
  const days = useMemo(() => new Set(byDay.keys()), [byDay]);
  const monday = mondayOf(today);
  const week = data.workouts.filter((w) => w.day >= monday).length;
  const monthCount = data.workouts.filter((w) => w.day.startsWith(month)).length;
  const first = `${month}-01`;
  const lead = weekdayMon(first);
  const [y, mo] = month.split("-").map(Number);
  const len = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const shift = (by: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + by, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: len }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  const list = (byDay.get(day) ?? []).slice().sort((a, b) => a.started_at - b.started_at);
  return (
    <>
      <div className="fit-stats">
        <span>
          이번 주 <b>{week}</b>회
        </span>
        <span>
          {mo}월 <b>{monthCount}</b>회
        </span>
        <span>
          연속 <b>{weekStreak(days, today)}</b>주
        </span>
      </div>
      <div className="fit-cal">
        <div className="fit-cal-head">
          <button type="button" className="fit-mini" aria-label="지난달" onClick={() => shift(-1)}>
            ◀
          </button>
          <b>
            {y}년 {mo}월
          </b>
          <button type="button" className="fit-mini" aria-label="다음 달" disabled={month >= today.slice(0, 7)} onClick={() => shift(1)}>
            ▶
          </button>
        </div>
        <div className="fit-cal-grid">
          {WEEKDAYS.map((w) => (
            <span key={w} className="fit-cal-wd">
              {w}
            </span>
          ))}
          {cells.map((c, i) =>
            c ? (
              <button
                key={c}
                type="button"
                className={"fit-cal-day" + (days.has(c) ? " fit-cal-on" : "") + (c === today ? " fit-cal-today" : "") + (c === day ? " fit-cal-sel" : "")}
                aria-label={`${md(c)}${days.has(c) ? " 운동함" : ""}`}
                aria-pressed={c === day}
                onClick={() => onDay(c)}
              >
                {Number(c.slice(8))}
              </button>
            ) : (
              <span key={"x" + i} />
            ),
          )}
        </div>
      </div>
      <div className="fit-head">
        <h2>
          {md(day)} ({WEEKDAYS[weekdayMon(day)]})
        </h2>
      </div>
      {list.length === 0 ? <p className="fit-empty">운동 기록이 없어요</p> : list.map((w) => <WorkoutCard key={w.id} w={w} onDetail={onDetail} onDeleted={onDeleted} />)}
    </>
  );
}

function WorkoutCard({ w, onDetail, onDeleted }: { w: Workout; onDetail: (k: string) => void; onDeleted: (id: number) => void }) {
  const [arm, setArm] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="fit-workout">
      <div className="fit-workout-head">
        <b>{w.title}</b>
        <small>
          {hm(w.started_at)} ~ {hm(w.ended_at)} · {durText(w.ended_at - w.started_at)}
        </small>
      </div>
      <p className="fit-workout-sum">
        {w.volume > 0 && <>볼륨 {volText(w.volume)} · </>}세트 {w.sets} · {w.data.entries.length}종목
      </p>
      <ul className="fit-workout-list">
        {w.data.entries.map((e, i) => (
          <li key={i}>
            <button type="button" onClick={() => onDetail(e.key)}>
              {e.name}
            </button>
            <span>{e.sets.map((s) => setText(e.kind, s)).join(" · ")}</span>
          </li>
        ))}
      </ul>
      {err && <p className="form-error">{err}</p>}
      <button
        type="button"
        className={"fit-del" + (arm ? " fit-armed" : "")}
        onClick={async () => {
          if (!arm) return setArm(true);
          try {
            await delWorkout(w.id);
            onDeleted(w.id);
          } catch (e) {
            setErr(errorText(e));
          }
        }}
      >
        {arm ? "기록 삭제 확인" : "기록 삭제"}
      </button>
    </div>
  );
}

// ---------- 종목 칸 ----------

function PartFilter({ part, onPart, count }: { part: Part | "all"; onPart: (p: Part | "all") => void; count: (p: Part | "all") => number }) {
  return (
    <div className="mk-sub fit-parts" role="tablist">
      {(["all", ...PARTS] as (Part | "all")[]).map((p) => (
        <button key={p} type="button" role="tab" aria-selected={part === p} className={"sub-tab" + (part === p ? " sub-tab-on" : "")} onClick={() => onPart(p)}>
          {p === "all" ? "전체" : PART_NAME[p]} <small>{count(p)}</small>
        </button>
      ))}
    </div>
  );
}

const matchQ = (x: Exercise, q: string) => !q || x.name.replace(/\s/g, "").includes(q.replace(/\s/g, ""));

function ExTab({ exercises, history, onDetail, onAdded }: { exercises: Exercise[]; history: Map<string, Point[]>; onDetail: (k: string) => void; onAdded: (x: Exercise) => void }) {
  const [q, setQ] = useEntryState("fit.q", "");
  const [part, setPart] = useEntryState<Part | "all">("fit.part", "all");
  const [adding, setAdding] = useState(false);
  const found = exercises.filter((x) => matchQ(x, q));
  const shown = found.filter((x) => part === "all" || x.part === part);
  // 해 본 종목이 위로
  shown.sort((a, b) => (history.get(b.key)?.length ?? 0) - (history.get(a.key)?.length ?? 0));
  return (
    <>
      <div className="mk-search">
        <input className="mk-input" placeholder="종목 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="pill" onClick={() => setAdding((v) => !v)}>
          + 내 종목
        </button>
      </div>
      {adding && (
        <CustomForm
          initialPart={part === "all" ? "etc" : part}
          initialName={q}
          onClose={() => setAdding(false)}
          onAdded={(x) => {
            onAdded(x);
            setAdding(false);
          }}
        />
      )}
      <PartFilter part={part} onPart={setPart} count={(p) => found.filter((x) => p === "all" || x.part === p).length} />
      {shown.length === 0 ? (
        <p className="fit-empty">찾는 종목이 없어요</p>
      ) : (
        <div className="fit-exlist">
          {shown.map((x) => {
            const h = history.get(x.key) ?? [];
            return (
              <button key={x.key} type="button" className="fit-exrow" onClick={() => onDetail(x.key)}>
                <span className="fit-exrow-main">
                  <b>{x.name}</b>
                  <small>
                    {PART_NAME[x.part]} · {KIND_NAME[x.kind]}
                    {x.custom ? " · 내 종목" : ""}
                  </small>
                </span>
                <span className="fit-exrow-side">
                  {h.length ? (
                    <>
                      <b>{bestText(x.kind, h)}</b>
                      <small>{h.length}회</small>
                    </>
                  ) : (
                    <small>기록 없음</small>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function CustomForm({ initialPart, initialName, onClose, onAdded }: { initialPart: Part; initialName: string; onClose: () => void; onAdded: (x: Exercise) => void }) {
  const [name, setName] = useState(initialName);
  const [part, setPart] = useState<Part>(initialPart);
  const [kind, setKind] = useState<Kind>(initialPart === "cardio" ? "cardio" : "weight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="fit-form">
      <input className="mk-input" placeholder="종목 이름" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="fit-choose fit-choose-4">
        {PARTS.map((p) => (
          <button key={p} type="button" className={"pill" + (part === p ? " pill-on" : "")} onClick={() => setPart(p)}>
            {PART_NAME[p]}
          </button>
        ))}
      </div>
      <div className="fit-choose fit-choose-4">
        {KINDS.map((k) => (
          <button key={k} type="button" className={"pill" + (kind === k ? " pill-on" : "")} onClick={() => setKind(k)}>
            <FitLine text={KIND_NAME[k]} wrap={false} />
          </button>
        ))}
      </div>
      {err && <p className="form-error">{err}</p>}
      <div className="fit-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          취소
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              const r = await addExercise({ name: name.trim(), part, kind });
              onAdded({ key: `c${r.id}`, name: r.name, part: r.part, kind: r.kind, custom: r.id });
            } catch (e) {
              setErr(errorText(e));
            }
            setBusy(false);
          }}
        >
          추가
        </button>
      </div>
    </div>
  );
}

// ---------- 창: 종목 고르기, 종목 자세히, 운동 끝 ----------

function Sheet({ title, onClose, children, foot }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  // 폰 뒤로 가기로 이 창만 닫는다 (backClose.ts)
  useBackClose(true, onClose);
  return (
    <>
      <div className="fit-sheet-back" onClick={onClose} data-tut-dismiss />
      <div className="fit-sheet" role="dialog" aria-label={title}>
        <div className="fit-sheet-head">
          <b>{title}</b>
          <button type="button" className="fit-mini" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="fit-sheet-body">{children}</div>
        {foot && <div className="fit-sheet-foot">{foot}</div>}
      </div>
    </>
  );
}

function Picker({ exercises, history, onClose, onPick }: { exercises: Exercise[]; history: Map<string, Point[]>; onClose: () => void; onPick: (list: Exercise[]) => void }) {
  const [q, setQ] = useState("");
  const [part, setPart] = useState<Part | "all">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const found = exercises.filter((x) => matchQ(x, q));
  const shown = found.filter((x) => part === "all" || x.part === part).sort((a, b) => (history.get(b.key)?.length ?? 0) - (history.get(a.key)?.length ?? 0));
  const byKey = new Map(exercises.map((x) => [x.key, x]));
  return (
    <Sheet
      title="종목 추가"
      onClose={onClose}
      foot={
        <button type="button" className="btn" disabled={!picked.length} onClick={() => onPick(picked.map((k) => byKey.get(k)!).filter(Boolean))}>
          {picked.length ? `${picked.length}개 추가` : "종목을 골라 주세요"}
        </button>
      }
    >
      <div className="mk-search">
        <input className="mk-input" placeholder="종목 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <PartFilter part={part} onPart={setPart} count={(p) => found.filter((x) => p === "all" || x.part === p).length} />
      <div className="fit-exlist">
        {shown.map((x) => {
          const on = picked.includes(x.key);
          return (
            <button key={x.key} type="button" className={"fit-exrow" + (on ? " fit-exrow-on" : "")} aria-pressed={on} onClick={() => setPicked((l) => (on ? l.filter((k) => k !== x.key) : [...l, x.key]))}>
              <span className={"fit-tick" + (on ? " fit-tick-on" : "")} aria-hidden>
                {on ? picked.indexOf(x.key) + 1 : ""}
              </span>
              <span className="fit-exrow-main">
                <b>{x.name}</b>
                <small>
                  {PART_NAME[x.part]}
                  {x.custom ? " · 내 종목" : ""}
                </small>
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="fit-empty">찾는 종목이 없어요 · 종목 칸에서 내 종목으로 추가할 수 있어요</p>}
      </div>
    </Sheet>
  );
}

type Metric = "orm" | "vol" | "top" | "reps" | "totalReps" | "sec" | "km" | "min";
const METRICS: Record<Kind, [Metric, string, (v: number) => string][]> = {
  weight: [
    ["orm", "추정 1RM", (v) => kgText(Math.round(v * 10) / 10)],
    ["vol", "볼륨", volText],
    ["top", "최고 무게", kgText],
  ],
  reps: [
    ["reps", "최고 회", (v) => `${v}회`],
    ["totalReps", "총 회", (v) => `${v}회`],
  ],
  time: [["sec", "최고 시간", (v) => secText(v)]],
  cardio: [
    ["km", "거리", (v) => `${numText(Math.round(v * 100) / 100)}km`],
    ["min", "시간", (v) => `${numText(v)}분`],
  ],
};

function Detail({ ex, points, onClose, onDeleted }: { ex: Exercise; points: Point[]; onClose: () => void; onDeleted: () => void }) {
  const metrics = METRICS[ex.kind];
  const [m, setM] = useState<Metric>(metrics[0][0]);
  const [arm, setArm] = useState(false);
  const [err, setErr] = useState("");
  const metric = metrics.find((x) => x[0] === m) ?? metrics[0];
  const max = (k: Metric) => (points.length ? Math.max(...points.map((p) => p[k])) : 0);
  const stats: [string, string][] =
    ex.kind === "weight"
      ? [
          ["최고 무게", kgText(max("top"))],
          ["추정 1RM", kgText(Math.round(max("orm") * 10) / 10)],
          ["하루 볼륨", volText(max("vol"))],
        ]
      : ex.kind === "reps"
        ? [
            ["최고 회", `${max("reps")}회`],
            ["하루 총 회", `${max("totalReps")}회`],
          ]
        : ex.kind === "time"
          ? [["최고 시간", secText(max("sec"))]]
          : [
              ["최장 거리", `${numText(max("km"))}km`],
              ["최장 시간", `${numText(max("min"))}분`],
            ];
  stats.push(["기록", `${points.length}회`]);
  return (
    <Sheet title={ex.name} onClose={onClose}>
      <p className="fit-detail-sub">
        {PART_NAME[ex.part]} · {KIND_NAME[ex.kind]}
        {ex.custom ? " · 내 종목" : ""}
      </p>
      {points.length === 0 ? (
        <p className="fit-empty">아직 기록이 없어요</p>
      ) : (
        <>
          <div className={"fit-tiles fit-tiles-" + stats.length}>
            {stats.map(([k, v]) => (
              <span key={k} className="fit-tile">
                <small>{k}</small>
                <b>{v}</b>
              </span>
            ))}
          </div>
          {metrics.length > 1 && (
            <div className="mk-sub fit-metric" role="tablist">
              {metrics.map(([k, name]) => (
                <button key={k} type="button" role="tab" aria-selected={m === k} className={"sub-tab" + (m === k ? " sub-tab-on" : "")} onClick={() => setM(k)}>
                  {name}
                </button>
              ))}
            </div>
          )}
          <LineChart key={m} points={points.map((p) => ({ at: p.at, day: p.day, y: p[metric[0]] }))} fmt={metric[2]} name={metric[1]} />
          <h3 className="fit-sub-h">최근 기록</h3>
          <ul className="fit-workout-list">
            {points
              .slice(-12)
              .reverse()
              .map((p) => (
                <li key={p.id + p.day}>
                  <span className="fit-day">{md(p.day)}</span>
                  <span>{p.sets.map((s) => setText(ex.kind, s)).join(" · ")}</span>
                </li>
              ))}
          </ul>
        </>
      )}
      {err && <p className="form-error">{err}</p>}
      {ex.custom && (
        <button
          type="button"
          className={"fit-del" + (arm ? " fit-armed" : "")}
          onClick={async () => {
            if (!arm) return setArm(true);
            try {
              await delExercise(ex.custom!);
              onDeleted();
            } catch (e) {
              setErr(errorText(e));
            }
          }}
        >
          {arm ? "내 종목 삭제 확인" : "내 종목 삭제"}
        </button>
      )}
    </Sheet>
  );
}

/** 한 줄 그래프 (그래프 색은 dataviz 검사기로 판 바탕 #262150 에서 통과한 파랑 #6585f5). 누르거나 끌면 그 점의 값 */
function LineChart({ points, fmt, name }: { points: { at: number; day: string; y: number }[]; fmt: (v: number) => string; name: string }) {
  const [sel, setSel] = useState(points.length - 1);
  const W = 320;
  const H = 150;
  const L = 44;
  const R = 12;
  const T = 12;
  const B = 22;
  const xs = points.map((p) => p.at);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y1 - y0 < 1e-9) {
    y0 = Math.max(0, y0 - 1);
    y1 = y1 + 1;
  } else {
    const pad = (y1 - y0) * 0.12;
    y0 = Math.max(0, y0 - pad);
    y1 += pad;
  }
  const px = (at: number) => (x1 === x0 ? L + (W - L - R) / 2 : L + ((at - x0) / (x1 - x0)) * (W - L - R));
  const py = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${px(p.at).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const ticks = [y0, (y0 + y1) / 2, y1];
  const svgRef = useRef<SVGSVGElement>(null);
  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(px(points[i].at) - x) < Math.abs(px(points[best].at) - x)) best = i;
    setSel(best);
  };
  const p = points[Math.min(sel, points.length - 1)];
  return (
    <div className="fit-chart">
      <p className="fit-chart-val">
        <span>{name}</span>
        <b>
          <Pop v={sel}>{fmt(p.y)}</Pop>
        </b>
        <small>{md(p.day)}</small>
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="fit-chart-svg"
        role="img"
        aria-label={`${name} 그래프`}
        onPointerDown={pick}
        onPointerMove={(e) => e.buttons && pick(e)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} className="fit-grid" />
            <text x={L - 6} y={py(t) + 3.5} className="fit-axis" textAnchor="end">
              {Math.round(t * 10) / 10}
            </text>
          </g>
        ))}
        <text x={L} y={H - 6} className="fit-axis">
          {md(points[0].day)}
        </text>
        {points.length > 1 && (
          <text x={W - R} y={H - 6} className="fit-axis" textAnchor="end">
            {md(points[points.length - 1].day)}
          </text>
        )}
        <line x1={px(p.at)} x2={px(p.at)} y1={T} y2={H - B} className="fit-cross" />
        {points.length > 1 && <path d={path} className="fit-line" />}
        {points.length <= 40 && points.map((q, i) => <circle key={i} cx={px(q.at)} cy={py(q.y)} r={3.5} className="fit-dot" />)}
        <circle cx={px(p.at)} cy={py(p.y)} r={5.5} className="fit-dot-sel" />
      </svg>
    </div>
  );
}

function Summary({ w, prs, onClose, onLog }: { w: Workout; prs: PR[]; onClose: () => void; onLog: () => void }) {
  return (
    <Sheet
      title="운동 끝"
      onClose={onClose}
      foot={
        <div className="fit-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn" onClick={onLog}>
            기록 보기
          </button>
        </div>
      }
    >
      <p className="fit-done-title">
        <b>{w.title}</b>
        <small>
          {md(w.day)} {hm(w.started_at)} ~ {hm(w.ended_at)}
        </small>
      </p>
      <div className="fit-tiles fit-tiles-3">
        <span className="fit-tile">
          <small>시간</small>
          <b>{durText(w.ended_at - w.started_at)}</b>
        </span>
        <span className="fit-tile">
          <small>총 볼륨</small>
          <b>{volText(w.volume)}</b>
        </span>
        <span className="fit-tile">
          <small>세트</small>
          <b>
            {w.sets} · {w.data.entries.length}종목
          </b>
        </span>
      </div>
      {prs.length > 0 && (
        <>
          <h3 className="fit-sub-h fit-pr-h">새 최고 기록 {prs.length}</h3>
          <ul className="fit-prs">
            {prs.map((p) => (
              <li key={p.name}>
                <span className="fit-pr-tag">PR</span>
                <b>{p.name}</b>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ul className="fit-workout-list">
        {w.data.entries.map((e, i) => (
          <li key={i}>
            <span>{e.name}</span>
            <span>{e.sets.map((s) => setText(e.kind, s)).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
