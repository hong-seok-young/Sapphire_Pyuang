// To do (#/todo, 제작자 요청 2026-11-01): 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일을 명사형으로 딱.
// 일간(한국 시간 0시 초기화) · 주간(목요일 오전 10시 초기화) · 이벤트(공식 글의 할 일, 매일·매주 것은 '일간'·'주간' 표) · 내 할 일(한 번) 칸.
// 체크 칸을 눌러야 끝낸 일로 가고, 이름을 누르면 아래로 펼쳐진다 (제작자 요청 2026-11-02): 무엇을 하라는지 요약, 그리고
// 수정(나만 이름·어디서 고치기), 함께(같이 하는 사람과 공유하고 언제 하자고 적기), 숨김/삭제. 맨 아래 '+ 할 일 추가'와 숨긴 일.
// 오른쪽 '›' 는 인던·길드던전의 위키 화면이나 이벤트 공식 글. 칸을 만드는 것은 src/todo.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../auth";
import { GUILD_NAME, JOB_NAME, errorText } from "../auth";
import type { Wiki } from "../types";
import { Loading, TopBar } from "../ui";
import {
  addCustom, buildLists, deleteCustom, digestTodo, editCustom, editTodo, eventItems, fetchPeople, fetchTodo, leaveShare, leftText, routineItems,
  setTodoDone, shareTodo, updateShare,
} from "../todo";
import type { TodoData, TodoItem, TodoPerson } from "../todo";

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

  const lists = buildLists(routineItems(wiki, me.level, me.guild), eventItems(data.tasks, data.dayEnd), data);

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
  /** 고치기: 서버에 보내고 다시 받는다 */
  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      await load();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  const ctx: RowCtx = { me, done, onToggle: toggle, act };

  const now = Date.now();
  return (
    <>
      <TopBar title="To do" />
      <p className="todo-who">
        {me.id} · Lv.{me.level ?? "?"} {me.job ? JOB_NAME[me.job] : ""}
        {me.guild ? ` · ${GUILD_NAME[me.guild]}` : ""}
      </p>
      {error && <p className="form-error">{error}</p>}
      <Section title="일간" reset={`초기화 ${leftText(data.dayEnd - now)} 뒤`} items={lists.daily} ctx={ctx} />
      <Section title="주간" reset={`목 10:00 초기화 · ${leftText(data.weekEnd - now)} 뒤`} items={lists.weekly} ctx={ctx} />
      <Section title="이벤트" items={lists.events} ctx={ctx} empty={digesting ? undefined : "진행 중인 이벤트 할 일이 없어요"} />
      {lists.mine.length > 0 && <Section title="내 할 일" items={lists.mine} ctx={ctx} />}
      {digesting && <p className="todo-working">📝 새 공식 글 정리 중…</p>}
      <AddTodo act={act} />
      {lists.hidden.length > 0 && <HiddenList items={lists.hidden} act={act} />}
    </>
  );
}

interface RowCtx {
  me: Me;
  done: Set<string>;
  onToggle: (key: string) => void;
  /** 서버에 보내고 다시 받는다 (실패하면 false) */
  act: (run: () => Promise<unknown>) => Promise<boolean>;
}

function Section({ title, reset, items, ctx, empty }: { title: string; reset?: string; items: TodoItem[]; ctx: RowCtx; empty?: string }) {
  const [showDone, setShowDone] = useState(false);
  if (!items.length && !empty) return null;
  // 끝낸 일은 아래로 접는다 (제작자 요청 2026-11-02: 할 일이 너무 많아 보인다). 누르면 펼쳐 다시 풀 수 있다
  const left = items.filter((i) => !ctx.done.has(i.key));
  const finished = items.filter((i) => ctx.done.has(i.key));
  return (
    <section className="panel todo">
      <h2 className="todo-head">
        <span>{title}</span>
        {items.length > 0 && <b className={finished.length === items.length ? "todo-all" : ""}>{finished.length}/{items.length}</b>}
        {reset && <small>{reset}</small>}
      </h2>
      {!items.length && <p className="todo-empty">{empty}</p>}
      {items.length > 0 && !left.length && <p className="todo-empty">다 했어요 ✓</p>}
      <ul className="todo-list">
        {left.map((i) => (
          <Row key={i.key} item={i} ctx={ctx} />
        ))}
      </ul>
      {finished.length > 0 && (
        <>
          <button className="todo-fold" onClick={() => setShowDone((v) => !v)}>
            ✓ 끝낸 일 {finished.length} {showDone ? "▴" : "▾"}
          </button>
          {showDone && (
            <ul className="todo-list">
              {finished.map((i) => (
                <Row key={i.key} item={i} ctx={ctx} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** 할 일 한 줄: 체크 칸, 이름(누르면 펼침), 함께 하는 사람, '›'. 펼치면 요약과 수정·함께·숨김 */
function Row({ item: i, ctx }: { item: TodoItem; ctx: RowCtx }) {
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<"" | "edit" | "share">("");
  const on = ctx.done.has(i.key);
  const s = i.share;
  // 남이 만든 '함께' 의 할 일 (내게는 없던 줄)은 숨기기·수정 대신 나가기
  const foreign = !!s && s.owner !== ctx.me.id && !i.custom && i.key.includes(":c:");
  return (
    <li className={"todo-row" + (on ? " todo-done" : "")}>
      <div className="todo-line">
        {/* 체크 칸만 끝낸 일로 보낸다 */}
        <button className="todo-check" onClick={() => ctx.onToggle(i.key)} aria-pressed={on} aria-label={i.text + (on ? " 끝냄 취소" : " 끝냄")}>
          <span className="todo-box" aria-hidden>
            {on ? "✓" : ""}
          </span>
        </button>
        {/* 이름: 펼치기 */}
        <button className="todo-hit" onClick={() => setOpened((v) => !v)} aria-expanded={opened}>
          <span className="todo-text">
            <span className="todo-name">
              {i.tag && <span className="todo-tag">{i.tag}</span>}
              {i.text}
            </span>
            {i.note && <span className="todo-note">{i.note}</span>}
            {s && (
              <span className="todo-with">
                {s.members.map((m) => (
                  <span key={m.id} className={m.done ? "todo-with-done" : ""}>
                    {m.id}
                    {m.done ? " ✓" : ""}
                  </span>
                ))}
                {s.at && <b>{s.at}</b>}
              </span>
            )}
          </span>
          {i.right && <span className="todo-right">{i.right}</span>}
          <span className="todo-more" aria-hidden>
            {opened ? "▴" : "▾"}
          </span>
        </button>
        {i.to && (
          <a className="todo-go" href={i.to} aria-label="자세히">
            ›
          </a>
        )}
      </div>
      {opened && (
        <div className="todo-detail">
          {i.steps?.map((t) => (
            <p key={"s" + t} className="todo-step">
              {t}
            </p>
          ))}
          {i.warns?.map((w) => (
            <p key={"w" + w} className="todo-warn">
              ⚠️ {w}
            </p>
          ))}
          {mode === "edit" && <EditForm item={i} act={ctx.act} onDone={() => setMode("")} />}
          {mode === "share" && <ShareForm item={i} ctx={ctx} onDone={() => setMode("")} />}
          {!mode && (
            <div className="todo-acts">
              {!foreign && (
                <button className="pill" onClick={() => setMode("edit")}>
                  수정
                </button>
              )}
              <button className={"pill" + (s ? " pill-on" : "")} onClick={() => setMode("share")}>
                함께{s ? ` ${s.members.length}` : ""}
              </button>
              {i.custom ? (
                <DeleteButton onDelete={() => ctx.act(() => deleteCustom(i.custom!))} />
              ) : foreign ? (
                <button className="pill" onClick={() => void ctx.act(() => leaveShare(s!.id))}>
                  나가기
                </button>
              ) : (
                <button className="pill" onClick={() => void ctx.act(() => editTodo(i.key, { hidden: true }))}>
                  숨김
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** 지우기: 한 번 더 눌러야 지운다 (브라우저 확인 창은 게임 위 창에서 안 열려서) */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [sure, setSure] = useState(false);
  return sure ? (
    <button className="pill pill-danger" onClick={onDelete}>
      삭제 확인
    </button>
  ) : (
    <button className="pill" onClick={() => setSure(true)}>
      삭제
    </button>
  );
}

/** 이름·어디서 고치기 (내 할 일은 그 할 일을, 다른 것은 나에게만 보이게) */
function EditForm({ item: i, act, onDone }: { item: TodoItem; act: RowCtx["act"]; onDone: () => void }) {
  const [text, setText] = useState(i.text);
  const [note, setNote] = useState(i.note ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (run: () => Promise<unknown>) => {
    setBusy(true);
    if (await act(run)) onDone();
    setBusy(false);
  };
  return (
    <div className="todo-form">
      <input className="todo-input" value={text} maxLength={30} onChange={(e) => setText(e.target.value)} placeholder="할 일" aria-label="할 일" />
      <input className="todo-input" value={note} maxLength={20} onChange={(e) => setNote(e.target.value)} placeholder="어디서 (선택)" aria-label="어디서" />
      <div className="todo-acts">
        <button
          className="pill pill-on"
          disabled={busy || !text.trim()}
          onClick={() => void save(() => (i.custom ? editCustom(i.custom, text, note) : editTodo(i.key, { text: text === (i.base?.text ?? "") ? "" : text, note })))}
        >
          저장
        </button>
        {i.base && (
          <button className="pill" disabled={busy} onClick={() => void save(() => editTodo(i.key, { reset: true }))}>
            원래대로
          </button>
        )}
        <button className="pill" onClick={onDone}>
          취소
        </button>
      </div>
    </div>
  );
}

/** 함께: 같이 하는 사람 고르기와 언제 (제작자 요청 2026-11-02: 길드던전 고정 멤버처럼). 만든 사람만 사람을 넣고 빼고, 언제는 누구나 */
function ShareForm({ item: i, ctx, onDone }: { item: TodoItem; ctx: RowCtx; onDone: () => void }) {
  const s = i.share;
  const owner = !s || s.owner === ctx.me.id;
  const [at, setAt] = useState(s?.at ?? "");
  const [picked, setPicked] = useState<string[]>(s ? s.members.map((m) => m.id).filter((id) => id !== ctx.me.id) : []);
  const [people, setPeople] = useState<TodoPerson[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (owner) fetchPeople().then((r) => setPeople(r.people), () => setPeople([]));
  }, [owner]);
  const save = async (run: () => Promise<unknown>) => {
    setBusy(true);
    if (await ctx.act(run)) onDone();
    setBusy(false);
  };
  const query = q.replace(/\s+/g, "").toLowerCase();
  const found = (people ?? []).filter((p) => !picked.includes(p.id) && (!query || p.id.toLowerCase().includes(query))).slice(0, 8);
  return (
    <div className="todo-form">
      <input className="todo-input" value={at} maxLength={20} onChange={(e) => setAt(e.target.value)} placeholder="언제 (예: 토 21:00)" aria-label="언제" />
      {owner ? (
        <>
          <div className="todo-people">
            {picked.map((id) => (
              <button key={id} className="pill pill-on" onClick={() => setPicked(picked.filter((x) => x !== id))} aria-label={id + " 빼기"}>
                {id} ✕
              </button>
            ))}
          </div>
          <input className="todo-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="닉네임 찾기" aria-label="닉네임 찾기" />
          <div className="todo-people">
            {people === null && <span className="todo-note">불러오는 중…</span>}
            {found.map((p) => (
              <button key={p.id} className="pill" onClick={() => setPicked([...picked, p.id])}>
                {p.id}
                {p.level ? <small> Lv.{p.level}</small> : null}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="todo-note">{s!.members.map((m) => m.id).join(", ")}</p>
      )}
      <div className="todo-acts">
        <button
          className="pill pill-on"
          disabled={busy || (owner && !picked.length)}
          onClick={() =>
            void save(() =>
              s ? updateShare(s.id, owner ? { at, members: picked } : { at }) : shareTodo(i.key, i.base?.text ?? i.text, i.base ? i.base.note : (i.note ?? null), at, picked),
            )
          }
        >
          {s ? "저장" : "공유"}
        </button>
        {s && (
          <button className="pill" disabled={busy} onClick={() => void save(() => leaveShare(s.id))}>
            {owner ? "끄기" : "나가기"}
          </button>
        )}
        <button className="pill" onClick={onDone}>
          취소
        </button>
      </div>
    </div>
  );
}

/** 맨 아래 '+ 할 일 추가': 일간(매일), 주간(매주), 한 번 */
function AddTodo({ act }: { act: RowCtx["act"] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [cycle, setCycle] = useState<"d" | "w" | "o">("d");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button className="todo-add" onClick={() => setOpen(true)}>
        + 할 일 추가
      </button>
    );
  const save = async () => {
    setBusy(true);
    if (await act(() => addCustom(cycle, text, note))) {
      setText("");
      setNote("");
      setOpen(false);
    }
    setBusy(false);
  };
  return (
    <section className="panel todo todo-form">
      <div className="todo-acts">
        {(
          [
            ["d", "일간"],
            ["w", "주간"],
            ["o", "한 번"],
          ] as const
        ).map(([c, name]) => (
          <button key={c} className={"pill" + (cycle === c ? " pill-on" : "")} onClick={() => setCycle(c)} aria-pressed={cycle === c}>
            {name}
          </button>
        ))}
      </div>
      <input className="todo-input" value={text} maxLength={30} onChange={(e) => setText(e.target.value)} placeholder="할 일" aria-label="할 일" autoFocus />
      <input className="todo-input" value={note} maxLength={20} onChange={(e) => setNote(e.target.value)} placeholder="어디서 (선택)" aria-label="어디서" />
      <div className="todo-acts">
        <button className="pill pill-on" disabled={busy || !text.trim()} onClick={() => void save()}>
          추가
        </button>
        <button className="pill" onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
    </section>
  );
}

/** 숨긴 일: 접혀 있고, '다시 보기'로 되살린다 */
function HiddenList({ items, act }: { items: TodoItem[]; act: RowCtx["act"] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="todo-fold todo-hidden-fold" onClick={() => setOpen((v) => !v)}>
        숨긴 일 {items.length} {open ? "▴" : "▾"}
      </button>
      {open && (
        <ul className="todo-list todo-hidden">
          {items.map((i) => (
            <li key={i.key} className="todo-hidden-row">
              <span className="todo-text">
                <span className="todo-name">
                  {i.tag && <span className="todo-tag">{i.tag}</span>}
                  {i.text}
                </span>
              </span>
              <button className="pill" onClick={() => void act(() => editTodo(i.key, { hidden: false }))}>
                다시 보기
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
