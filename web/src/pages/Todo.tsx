// To do (#/todo, 제작자 요청 2026-11-01): 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일을 명사형으로 딱.
// 오늘(한국 시간 0시 초기화) · 이번 주(목요일 오전 10시 초기화) · 이벤트(기간 안에 한 번) 칸에 체크 칸과 함께 보인다.
// 줄을 누르면 체크, 오른쪽 '›' 는 그 인던의 위키 화면이나 이벤트 공식 글. 늘 하는 일과 이벤트 할 일은 src/todo.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../auth";
import { GUILD_NAME, JOB_NAME, errorText } from "../auth";
import type { Wiki } from "../types";
import { Loading, TopBar } from "../ui";
import { digestTodo, eventItems, fetchTodo, leftText, routineItems, setTodoDone } from "../todo";
import type { TodoData, TodoItem } from "../todo";

export function TodoPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const [data, setData] = useState<TodoData | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [digesting, setDigesting] = useState(false);
  const [, tick] = useState(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const d = await fetchTodo();
      if (!alive.current) return null;
      setData(d);
      setDone(new Set(d.done));
      setError("");
      return d;
    } catch (e) {
      if (alive.current) setError(errorText(e));
      return null;
    }
  }, []);

  useEffect(() => {
    let stop = false;
    void (async () => {
      const d = await load();
      // 아직 정리 안 된 새 공식 글이 있으면 서버가 정리하게 하고(1분쯤), 다른 곳이 정리하는 중이면 끝날 때까지 가끔 다시 본다 (3분까지)
      if (!d || (!d.pending && !d.working)) return;
      setDigesting(true);
      const until = Date.now() + 180_000;
      let cur: TodoData | null = d;
      while (!stop && cur && (cur.pending || cur.working) && Date.now() < until) {
        if (cur.pending) await digestTodo().catch(() => null);
        else await new Promise((ok) => setTimeout(ok, 15_000));
        if (stop) break;
        const next: TodoData | null = await load();
        // 서버가 더 할 수 없으면(API 키 없음 등) 그만
        if (!next || (next.pending && next.pending === cur.pending && !next.working)) break;
        cur = next;
      }
      if (alive.current) setDigesting(false);
    })();
    // 자정, 목요일 10시가 지나면 새 주기로 (1분마다 남은 때를 고치고, 넘어가면 다시 받는다)
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (data && (Date.now() >= data.dayEnd || Date.now() >= data.weekEnd)) void load();
  });

  if (!data) return (
    <>
      <TopBar title="To do" />
      <Loading error={error || undefined} onRetry={() => void load()} />
    </>
  );

  const routine = routineItems(wiki, me.level);
  const events = eventItems(data.tasks, data.dayEnd);
  const today = [...routine.today, ...events.today];
  const week = [...routine.week, ...events.week];

  const toggle = (key: string) => {
    const on = !done.has(key);
    const next = new Set(done);
    if (on) next.add(key);
    else next.delete(key);
    setDone(next);
    navigator.vibrate?.(8);
    setTodoDone(key, on).catch((e) => {
      // 못 적었으면 되돌린다
      setDone((cur) => {
        const back = new Set(cur);
        if (on) back.delete(key);
        else back.add(key);
        return back;
      });
      setError(errorText(e));
    });
  };

  const now = Date.now();
  return (
    <>
      <TopBar title="To do" />
      <p className="todo-who">
        {me.id} · Lv.{me.level ?? "?"} {me.job ? JOB_NAME[me.job] : ""}
        {me.guild ? ` · ${GUILD_NAME[me.guild]}` : ""}
      </p>
      {error && <p className="form-error">{error}</p>}
      <Section title="오늘" reset={`초기화 ${leftText(data.dayEnd - now)} 뒤`} items={today} done={done} onToggle={toggle} />
      <Section title="이번 주" reset={`목 10:00 초기화 · ${leftText(data.weekEnd - now)} 뒤`} items={week} done={done} onToggle={toggle} />
      <Section title="이벤트" items={events.once} done={done} onToggle={toggle} empty={digesting ? undefined : "진행 중인 이벤트 할 일이 없어요"} />
      {digesting && <p className="todo-working">📝 새 공식 글 정리 중…</p>}
    </>
  );
}

function Section({ title, reset, items, done, onToggle, empty }: {
  title: string;
  reset?: string;
  items: TodoItem[];
  done: Set<string>;
  onToggle: (key: string) => void;
  empty?: string;
}) {
  if (!items.length && !empty) return null;
  const count = items.filter((i) => done.has(i.key)).length;
  return (
    <section className="panel todo">
      <h2 className="todo-head">
        <span>{title}</span>
        {items.length > 0 && <b className={count === items.length ? "todo-all" : ""}>{count}/{items.length}</b>}
        {reset && <small>{reset}</small>}
      </h2>
      {!items.length && <p className="todo-empty">{empty}</p>}
      <ul className="todo-list">
        {items.map((i) => {
          const on = done.has(i.key);
          return (
            <li key={i.key} className={"todo-row" + (on ? " todo-done" : "")}>
              <button className="todo-hit" onClick={() => onToggle(i.key)} aria-pressed={on}>
                <span className="todo-box" aria-hidden>
                  {on ? "✓" : ""}
                </span>
                <span className="todo-text">
                  <span className="todo-name">{i.text}</span>
                  {i.note && <span className="todo-note">{i.note}</span>}
                </span>
                {i.right && <span className="todo-right">{i.right}</span>}
              </button>
              {i.to && (
                <a className="todo-go" href={i.to} aria-label="자세히">
                  ›
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
