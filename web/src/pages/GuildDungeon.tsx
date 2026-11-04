// 길드 던전 화면 #/match (제작자 요청 2026-11-02, 1군 전용, src/gdungeon.ts, 서버 server/gdungeon.ts)
// 위에서부터 (이번 주 날짜 줄은 뺐다, 제작자 요청 2026-11-02 '다 알아'): 내 파티와 지금 후보(확정·불참), 내 시간표 / 파티원 / 교집합, 모든 파티.
// 파티원 칸 (제작자 2026-11-04 '다른 파티원의 시간표도, 각각 나와의 교집합이 보이게'): 어두운 띠에서 파티원을 고르면 그 사람 시간표, 나와 겹치는 칸은 금색.
// 시간표는 칸을 누르고 끌어서 칠한다 (왼쪽 시간 줄을 끌면 화면이 내려간다).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { JOB_NAME, errorText } from "../auth";
import type { Job, Me } from "../auth";
import {
  EMPTY,
  MAX_MEMBERS,
  ROWS,
  SLOTS,
  SLOT_MS,
  answerGd,
  candidateNo,
  cellKey,
  confirmAvail,
  createParty,
  deleteParty,
  editParty,
  fetchGd,
  freeAt,
  gridCols,
  keyText,
  leaveParty,
  rowLabel,
  saveAvail,
  slotShort,
  slotText,
  thisWeekSlot,
  unconfirmAvail,
  undoAnswer,
} from "../gdungeon";
import type { GdData, GdPerson, GridCol, PartyState } from "../gdungeon";
import { KakaoButton, Nick, useKakao } from "../kakao";
import { sampleParty } from "../sample";
import { useSample } from "../tutorialState";
import { useEntryState } from "../router";
import { FitLine, Loading, TopBar } from "../ui";

export function GuildDungeonPage({ me }: { me: Me }) {
  const [data, setData] = useState<GdData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useEntryState<"mine" | "member" | "heat">("gd.tab", "mine");
  const [who, setWho] = useEntryState<string>("gd.who", "");
  const sample = useSample();
  const load = useCallback(() => {
    fetchGd().then(
      (d) => {
        setData(d);
        setError("");
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => {
    load();
    // 파티원이 칠한 시간표·확정·불참이 바로 보이게: 화면을 보는 동안 15초마다, 앱으로 돌아올 때, 파티원·교집합 칸으로 바꿀 때
    // (제작자 2026-11-04 '시간표 누르면 실시간으로 공유가 되는 거지'. 칠한 칸은 손을 뗄 때 저장된다)
    const t = window.setInterval(
      () => document.visibilityState === "visible" && load(),
      15_000,
    );
    const v = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", v);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", v);
    };
  }, [load]);

  if (!data)
    return (
      <>
        <TopBar title="길드 던전" />
        <Loading error={error || undefined} onRetry={load} />
      </>
    );
  // 튜토리얼 동안 파티가 없으면 예시 파티 (src/sample.ts: 파티원 카드와 1번 후보가 보이게)
  const party = data.party ?? (sample ? sampleParty(me.id) : null);
  const setParty = (p: PartyState | null | undefined) => {
    if (p !== undefined) setData((d) => (d ? { ...d, party: p } : d));
  };
  const mates = party ? party.members.filter((m) => m.id !== me.id) : [];
  const painted = [data.mine, data.mineNext, data.prev].some((b) => !!b && b.includes("1"));
  return (
    <>
      <TopBar title="길드 던전" />
      {error && <p className="form-error">{error}</p>}
      {party ? (
        <PartyPanel
          me={me}
          data={data}
          party={party}
          onParty={setParty}
          onReload={load}
          onError={setError}
        />
      ) : (
        <NewParty me={me} data={data} onDone={load} onError={setError} />
      )}
      {party && (
        <nav className="pill-row gd-tabs">
          <button
            className={"pill" + (tab === "mine" ? " pill-on" : "")}
            onClick={() => setTab("mine")}
          >
            내 시간표
          </button>
          {mates.length > 0 && (
            <button
              className={"pill" + (tab === "member" ? " pill-on" : "")}
              onClick={() => (setTab("member"), load())}
            >
              파티원
            </button>
          )}
          <button
            className={"pill" + (tab === "heat" ? " pill-on" : "")}
            onClick={() => (setTab("heat"), load())}
          >
            교집합
          </button>
        </nav>
      )}
      {!party || tab === "mine" || (tab === "member" && !mates.length) ? (
        <MyTimes
          key={data.week}
          me={me.id}
          data={data}
          onSaved={setParty}
          onError={setError}
        />
      ) : tab === "member" ? (
        <MateTimes
          data={data}
          party={party}
          me={me.id}
          who={mates.some((m) => m.id === who) ? who : mates[0].id}
          onWho={setWho}
        />
      ) : (
        <HeatTimes data={data} party={party} />
      )}
      <AllParties data={data} me={me.id} />
      {painted && <ColsNotice me={me.id} />}
    </>
  );
}

/**
 * 시간표가 월 ~ 일로 바뀌었다는 안내 (제작자 2026-11-04 '이미 입력한 사람한테는 시간표 열이 바뀌었다고 길드 던전 들어가면 안내 팝업 하나만'):
 * 시간표를 칠해 둔 적이 있는 사람에게 이 기기에서 한 번만 (localStorage 'sapphire.gd.cols.<아이디>')
 */
function ColsNotice({ me }: { me: string }) {
  const key = `sapphire.gd.cols.${me}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "1";
    } catch {
      return false;
    }
  });
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      // 저장 못 해도 이번에는 닫는다
    }
    setOpen(false);
  };
  return (
    <div className="gd-notice" role="dialog" aria-modal="true" onClick={close}>
      <div className="gd-notice-card" onClick={(e) => e.stopPropagation()}>
        <b>시간표가 바뀌었어요</b>
        <p>열이 월요일부터 일요일 순서예요.</p>
        <p>
          <em>오늘</em>부터 오른쪽은 이번 주, 왼쪽은 다음 주 날짜예요.
        </p>
        <p>칠해 둔 시간은 그대로예요.</p>
        <button className="pill pill-on" onClick={close}>
          확인
        </button>
      </div>
    </div>
  );
}

/** 내 파티: 파티원 카드, 지금 후보와 확정·불참, 다음 후보, 무산된 후보 */
function PartyPanel({
  me,
  data,
  party: p,
  onParty,
  onReload,
  onError,
}: {
  me: Me;
  data: GdData;
  party: PartyState;
  onParty: (p: PartyState | null | undefined) => void;
  onReload: () => void;
  onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // 후보 확정을 못 한 까닭 ('별빛하늘 님이 시간표를 확정해야 확정할 수 있어요 · 별빛하늘 님에게 재촉 알림을 보냈어요'), 후보 칸 안에
  const [hint, setHint] = useState("");
  const { high } = useKakao();
  const week = data.week;
  const leader = p.leader === me.id;
  const canManage = leader || data.staff;
  const all = p.members.every((m) => m.filled);
  const waiting = p.members.filter((m) => !m.filled).map((m) => m.id);
  // 단계 − + 는 누르는 대로 바로 바뀌고 저장은 뒤에서 (제작자 2026-11-04 '단계 조종 버튼도 엄청 반응이 늦음': 서버 답을 기다리는 동안 단추가 잠겼다).
  // 잇달아 누르면 0.4초 뒤 마지막 값만 보낸다. 못 저장하면 서버 값으로 되돌린다
  const [stage, setStage] = useState(p.stage);
  const stageSave = useRef<{ timer: number; busy: boolean }>({ timer: 0, busy: false });
  useEffect(() => {
    if (!stageSave.current.timer && !stageSave.current.busy) setStage(p.stage);
  }, [p.stage]);
  const changeStage = (next: number | null) => {
    setStage(next);
    const s = stageSave.current;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(async () => {
      s.timer = 0;
      s.busy = true;
      try {
        await editParty(p.id, { stage: next });
        onParty({ ...p, stage: next });
      } catch (e) {
        onError(errorText(e));
        setStage(p.stage);
      } finally {
        s.busy = false;
      }
    }, 400);
  };
  useEffect(() => () => window.clearTimeout(stageSave.current.timer), []);
  // 두 번 눌러야 하는 단추 (불참, 빼기, 파티 지우기, 나가기): 3초 안에 한 번 더
  useEffect(() => {
    if (!sure) return;
    const t = window.setTimeout(() => setSure(null), 3000);
    return () => window.clearTimeout(t);
  }, [sure]);
  async function run(fn: () => Promise<{ party?: PartyState | null }>) {
    setBusy(true);
    onError("");
    try {
      const r = await fn();
      onParty(r.party);
    } catch (e) {
      onError(errorText(e));
      onReload();
    } finally {
      setBusy(false);
      setSure(null);
    }
  }
  /** 후보에 확정: 파티원 모두 시간표를 확정해야 된다 (제작자 2026-11-04). 서버가 막으면 까닭을 후보 칸에, 아직인 사람에게는 서버가 재촉 알림 */
  async function sayYes(slot: number) {
    setBusy(true);
    setHint("");
    onError("");
    try {
      const r = await answerGd(slot, "yes");
      onParty(r.party);
    } catch (e) {
      setHint(errorText(e));
      onReload();
    } finally {
      setBusy(false);
    }
  }
  const twice = (key: string, fn: () => void) =>
    sure === key ? fn() : setSure(key);
  /** 파티원 넣고 빼기, 파티장 지정, 파티 지우기: 끝나면 다시 받는다 */
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    onError("");
    try {
      await fn();
      setOpen(null);
      setAdding(false);
      onReload();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
      setSure(null);
    }
  }
  const myNo = (slot: number) =>
    p.rejected.some((r) => r.slot === slot && r.by.includes(me.id));
  const next =
    p.current !== null
      ? p.candidates
          .filter(
            (s) => s > p.current! && !p.rejected.some((r) => r.slot === s),
          )
          .slice(0, 4)
      : [];
  const past =
    p.confirmed !== null && week + p.confirmed * SLOT_MS + SLOT_MS <= data.now;

  return (
    <section className="panel gd-party">
      <div className="gd-party-head">
        {/* 길드던전 단계 (제작자 2026-11-03: 파티마다 '4단계', 팀 이름 앞에). 파티장·운영진은 − + 로 바꾼다 (1에서 − 는 없앰) */}
        {(stage !== null || canManage) && (
          <span className="gd-stage">
            {canManage && (
              <button
                className="pill gd-stage-btn"
                disabled={stage === null}
                onClick={() => changeStage(stage !== null && stage > 1 ? stage - 1 : null)}
                aria-label="단계 내리기"
              >
                −
              </button>
            )}
            <i>{stage !== null ? `${stage}단계` : "단계"}</i>
            {canManage && (
              <button
                className="pill gd-stage-btn"
                disabled={(stage ?? 0) >= 9}
                onClick={() => changeStage((stage ?? 0) + 1)}
                aria-label="단계 올리기"
              >
                +
              </button>
            )}
          </span>
        )}
        <b>{p.name}</b>
      </div>
      {/* 파티원 카드: 한 줄에 닉네임 · 카톡 · 파티장 · 상태. 파티장·운영진은 카드를 누르면 아래에 파티장 지정 · 빼기 (파티장 카드는 파티 지우기)
          (제작자 요청 2026-11-02: 아래에 닉네임을 늘어놓은 관리 칸 대신 카드를 눌러서) */}
      {(() => {
        const cells = p.members.map((m) => {
          // 상태는 시간표를 칠하고 '확정'을 눌렀는지만: 입력 전 / 확정 (제작자 2026-11-04: '입력'을 시간표를 다 넣었다는 뜻으로 오해했다.
          // 후보에 확정한 사람은 아래 후보 칸의 '확정 2/4 · 이름'에). 한 칸에 닉네임 · 카톡 · 파티장 · 상태가 한 줄로 들어가게 짧게
          const state = m.confirmed ? "확정" : "입력 전";
          const row = (
            <>
              <FitLine
                className="gd-member-name"
                text={m.id}
                wrap={false}
                hs={high.includes(m.id)}
              />
              <KakaoButton name={m.id} nested={canManage || m.id === me.id} icon />
              {m.id === p.leader && <i className="gd-leader">파티장</i>}
              <small className={state === "확정" ? "gd-st-yes" : undefined}>
                {state}
              </small>
            </>
          );
          return (
            <li
              key={m.id}
              className={
                (m.confirmed ? "" : "gd-member-wait") +
                (open === m.id ? " gd-member-open" : "")
              }
            >
              {/* 내 카드는 누구나 (파티 나가기), 남의 카드는 파티장·운영진만 (파티장 지정 · 빼기) */}
              {canManage || m.id === me.id ? (
                <button
                  className="gd-member-row"
                  onClick={() => (
                    setOpen(open === m.id ? null : m.id),
                    setAdding(false)
                  )}
                  aria-expanded={open === m.id}
                >
                  {row}
                </button>
              ) : (
                <div className="gd-member-row">{row}</div>
              )}
            </li>
          );
        });
        if (canManage && p.members.length < MAX_MEMBERS)
          cells.push(
            <li key="+add" className="gd-member-add">
              <button
                className="gd-member-row"
                onClick={() => (setAdding((v) => !v), setOpen(null))}
                aria-expanded={adding}
              >
                + 파티원 넣기
              </button>
            </li>,
          );
        // 누른 카드: 그 카드 줄 바로 아래 가로 꽉 차게. 남의 카드는 '파티장 지정 · 빼기', 내 카드는 '파티 나가기'(파티장은 '파티 지우기'도)
        // (제작자 요청 2026-11-02 '카드 누르면 파티장 주게', '파티 나가기도 본인 카드 누르면')
        const at =
          open !== null && (canManage || open === me.id)
            ? p.members.findIndex((m) => m.id === open)
            : -1;
        if (at >= 0)
          cells.splice(
            Math.min(cells.length, at - (at % 2) + 2),
            0,
            <li key="+acts" className="gd-member-acts">
              <b>{open}</b>
              <div className="pill-row">
                {open === me.id ? (
                  <>
                    <button
                      className={"pill" + (sure === "leave" ? " gd-sure" : "")}
                      disabled={busy}
                      onClick={() =>
                        twice("leave", () => void act(() => leaveParty(p.id)))
                      }
                    >
                      {sure === "leave" ? "정말 나가기" : "파티 나가기"}
                    </button>
                    {canManage && open === p.leader && (
                      <button
                        className={"pill" + (sure === "del" ? " gd-sure" : "")}
                        disabled={busy}
                        onClick={() =>
                          twice("del", () => void act(() => deleteParty(p.id)))
                        }
                      >
                        {sure === "del" ? "정말 파티 지우기" : "파티 지우기"}
                      </button>
                    )}
                  </>
                ) : open !== p.leader ? (
                  <>
                    <button
                      className="pill"
                      disabled={busy}
                      onClick={() =>
                        void act(() => editParty(p.id, { leader: open! }))
                      }
                    >
                      파티장 지정
                    </button>
                    <button
                      className={
                        "pill" + (sure === "rm" + open ? " gd-sure" : "")
                      }
                      disabled={busy}
                      onClick={() =>
                        twice(
                          "rm" + open,
                          () =>
                            void act(() =>
                              editParty(p.id, { remove: [open!] }),
                            ),
                        )
                      }
                    >
                      {sure === "rm" + open ? "정말 빼기" : "빼기"}
                    </button>
                  </>
                ) : (
                  // 운영진이 남의 파티장 카드를 누른 때
                  <button
                    className={"pill" + (sure === "del" ? " gd-sure" : "")}
                    disabled={busy}
                    onClick={() =>
                      twice("del", () => void act(() => deleteParty(p.id)))
                    }
                  >
                    {sure === "del" ? "정말 파티 지우기" : "파티 지우기"}
                  </button>
                )}
              </div>
            </li>,
          );
        return <ul className="gd-members">{cells}</ul>;
      })()}
      {adding && canManage && (
        <div className="gd-member-acts">
          <PeoplePicker
            people={data.people.filter((x) => x.party === null)}
            exclude={p.members.map((m) => m.id)}
            max={MAX_MEMBERS - p.members.length}
            busy={busy}
            action="넣기"
            onPick={(ids) => void act(() => editParty(p.id, { add: ids }))}
          />
        </div>
      )}

      {/* 지금 상태 */}
      {!all ? (
        <p className="gd-state">
          시간표 {p.members.length - waiting.length}/{p.members.length}
          <small> · {waiting.join(", ")} 기다리는 중</small>
        </p>
      ) : p.confirmed !== null ? (
        <div className="gd-confirm">
          <small>{past ? "이번 주 길드 던전 (끝)" : "이번 주는"}</small>
          <b>{slotText(week, p.confirmed)}</b>
          <small>모두 확정</small>
          {!past && (
            <div className="gd-btns">
              <button
                className={"pill gd-no" + (sure === "no" ? " gd-sure" : "")}
                disabled={busy}
                onClick={() =>
                  twice(
                    "no",
                    () => void run(() => answerGd(p.confirmed!, "no")),
                  )
                }
              >
                {sure === "no" ? "정말 불참" : "불참"}
              </button>
            </div>
          )}
        </div>
      ) : p.current !== null ? (
        <div className="gd-cand">
          <small>{candidateNo(p, p.current)}번 후보</small>
          <b>{slotText(week, p.current)}</b>
          <small>
            확정 {p.yes.length}/{p.members.length}
            {p.yes.length > 0 && ` · ${p.yes.join(", ")}`}
          </small>
          <div className="pill-row gd-btns">
            <button
              className={
                "pill gd-yes" + (p.yes.includes(me.id) ? " pill-on" : "")
              }
              disabled={busy || p.yes.includes(me.id)}
              onClick={() => void sayYes(p.current!)}
            >
              {p.yes.includes(me.id) ? "확정함" : "확정"}
            </button>
            <button
              className={"pill gd-no" + (sure === "no" ? " gd-sure" : "")}
              disabled={busy}
              onClick={() =>
                twice("no", () => void run(() => answerGd(p.current!, "no")))
              }
            >
              {sure === "no" ? "정말 불참" : "불참"}
            </button>
          </div>
          {hint && <p className="gd-hint">{hint}</p>}
          {next.length > 0 && (
            <p className="gd-next">
              다음{" "}
              {next
                .map((s) => `${candidateNo(p, s)}번 ${slotShort(week, s)}`)
                .join(" · ")}
            </p>
          )}
        </div>
      ) : (
        <p className="gd-state">
          교집합이 없어요
          <small> · 시간표를 더 칠해 주세요</small>
        </p>
      )}

      {/* 무산된 후보 */}
      {p.rejected.length > 0 && (
        <ul className="gd-rejected">
          {p.rejected.map((r) => (
            <li key={r.slot}>
              <s>
                {candidateNo(p, r.slot)}번 {slotShort(week, r.slot)}
              </s>
              <small> {r.by.join(", ")} 불참</small>
              {myNo(r.slot) && (
                <button
                  className="bd-mini"
                  disabled={busy}
                  onClick={() => void run(() => undoAnswer(r.slot))}
                >
                  되돌리기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 파티가 없을 때: 파티 만들기 (만든 사람이 파티장, 나 빼고 3명까지, 이름은 'OO 팀') */
function NewParty({
  me,
  data,
  onDone,
  onError,
}: {
  me: Me;
  data: GdData;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel gd-party">
      <p className="gd-state">아직 파티가 없어요</p>
      {!open ? (
        <button className="pill gd-make" onClick={() => setOpen(true)}>
          파티 만들기
        </button>
      ) : (
        <div className="gd-manage">
          <p className="gd-new-name">{me.id} 팀</p>
          <PeoplePicker
            people={data.people.filter((x) => x.party === null)}
            exclude={[me.id]}
            max={MAX_MEMBERS - 1}
            busy={busy}
            action="파티 만들기"
            allowEmpty
            onPick={async (ids) => {
              setBusy(true);
              onError("");
              try {
                await createParty(ids);
                onDone();
              } catch (e) {
                onError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}
    </section>
  );
}

/** 1군에서 사람 고르기 (닉네임 찾기, 다른 파티에 없는 사람만) */
function PeoplePicker({
  people,
  exclude,
  max,
  busy,
  action,
  allowEmpty = false,
  onPick,
}: {
  people: GdPerson[];
  exclude: string[];
  max: number;
  busy: boolean;
  action: string;
  allowEmpty?: boolean;
  onPick: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const list = people
    .filter((x) => !exclude.includes(x.id) && !picked.includes(x.id))
    .filter(
      (x) => !q.trim() || x.id.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .slice(0, 12);
  return (
    <div className="gd-picker">
      {picked.length > 0 && (
        <p className="gd-picked">
          {picked.map((id) => (
            <button
              key={id}
              className="pill pill-on"
              onClick={() => setPicked(picked.filter((x) => x !== id))}
            >
              {id} ✕
            </button>
          ))}
        </p>
      )}
      {picked.length < max && (
        <>
          <input
            className="mk-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="닉네임 찾기 (1군)"
            aria-label="닉네임 찾기"
          />
          <ul className="gd-people">
            {list.map((x) => (
              <li key={x.id}>
                <button
                  onClick={() => (setPicked([...picked, x.id]), setQ(""))}
                >
                  <b>
                    <Nick name={x.id} />
                  </b>
                  {x.level !== null && (
                    <small>
                      Lv.{x.level}
                      {x.job ? ` ${JOB_NAME[x.job as Job] ?? ""}` : ""}
                    </small>
                  )}
                </button>
              </li>
            ))}
            {!list.length && (
              <li className="gd-people-none">고를 사람이 없어요</li>
            )}
          </ul>
        </>
      )}
      <button
        className="pill gd-make"
        disabled={busy || (!allowEmpty && !picked.length)}
        onClick={() => onPick(picked)}
      >
        {action}
        {picked.length > 0 && ` (${picked.length}명)`}
      </button>
    </div>
  );
}

/**
 * 시간표 머리: 월 ~ 일, 날짜는 오늘부터 7일 안의 그 요일. 위에 띠 하나로 오늘 왼쪽은 '다음 주', 오늘부터 오른쪽은 '이번 주',
 * 오늘 열은 금색 '오늘' (제작자 2026-11-04 '오늘 열은 부각되게, 오늘이라고, 우측은 이번 주 좌측은 다음 주 가시적으로')
 */
function Head({ cols }: { cols: GridCol[] }) {
  const ti = cols.findIndex((c) => c.today);
  return (
    <>
      <span className="gd-corner" />
      {ti > 0 && (
        <span className="gd-band gd-band-next" style={{ gridColumn: `2 / span ${ti}` }}>
          다음 주
        </span>
      )}
      <span className="gd-band gd-band-this" style={{ gridColumn: `${ti + 2} / span ${7 - ti}` }}>
        이번 주
      </span>
      <span className="gd-corner" />
      {cols.map((h, c) => (
        <span
          key={c}
          className={
            "gd-head" +
            (h.day === "토" || h.day === "일" ? " gd-weekend" : "") +
            (h.today ? " gd-today" : c < ti ? " gd-head-next" : "")
          }
        >
          <b>{h.today ? "오늘" : h.day}</b>
          <small>{h.today ? `${h.day} ${h.date}` : h.date}</small>
        </span>
      ))}
    </>
  );
}

/** 칸 열의 표시: 오늘 열은 금빛, 다음 주 열은 옅게 (Head 와 같은 기준) */
function colCls(cols: GridCol[], c: number): string {
  const ti = cols.findIndex((x) => x.today);
  return c === ti ? " gd-c-today" : c < ti ? " gd-c-next" : "";
}

/** 이 화면에 보이는 칸 키들 (월 ~ 일 x 09:00 ~ 02:00 중 시간표에 있는 때) */
function visibleKeys(week: number, cols: GridCol[]): number[] {
  const out: number[] = [];
  for (const col of cols)
    for (let r = 0; r < ROWS; r++) {
      const k = cellKey(week, col, r);
      if (k >= 0) out.push(k);
    }
  return out;
}

/** 내 시간표: 칸을 누르고 끌어서 칠한다. 손을 떼면 저장 (이번 주·다음 주 중 바뀐 쪽만) */
function MyTimes({
  me,
  data,
  onSaved,
  onError,
}: {
  me: string;
  data: GdData;
  onSaved: (p: PartyState | null | undefined) => void;
  onError: (e: string) => void;
}) {
  const startBits = (data.mine ?? EMPTY) + (data.mineNext ?? EMPTY);
  const [bits, setBits] = useState(startBits);
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const bitsRef = useRef(bits);
  bitsRef.current = bits;
  const saved = useRef(startBits);
  const drag = useRef<{ val: boolean; changed: boolean } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cols = useMemo(() => gridCols(data.now), [data.now]);
  const keys = useMemo(() => visibleKeys(data.week, cols), [data.week, cols]);
  // 확정: 다 칠한 뒤 누르면 시간표가 잠겨 스크롤하다 잘못 눌러도 안 바뀐다. '수정'을 누르면 풀린다
  // (제작자 요청 2026-11-02 '자꾸 스크롤하다가 막 누르게 된다'). 서버(gd_avail.confirmed_at)에 적어 파티원 카드에 '확정 / 입력 전'으로 보이고
  // (제작자 2026-11-04) 다른 기기에서 열어도 그대로. 예전 서버(mineConfirmed 가 없음)면 이 기기에 둔 것으로
  const lockKey = `sapphire.gd.lock.${me}.${data.week}`;
  const [lock, setLockState] = useState<boolean>(() => {
    if (data.mineConfirmed !== undefined) return data.mineConfirmed;
    try {
      return localStorage.getItem(lockKey) === "1";
    } catch {
      return false;
    }
  });
  const setLock = (v: boolean) => {
    setLockState(v);
    try {
      if (v) localStorage.setItem(lockKey, "1");
      else localStorage.removeItem(lockKey);
    } catch {
      // 저장 못 해도 이번에 연 동안은 잠긴다
    }
    // 확정하면 아직 안 칠한 파티원에게 알림 (제작자 2026-11-03, 서버가 한 주에 한 번만 보낸다). 못 보내도 잠금은 그대로
    if (v && bitsRef.current.includes("1")) void confirmAvail().then((r) => onSaved(r.party), () => undefined);
    if (!v) void unconfirmAvail().then((r) => onSaved(r.party), () => undefined);
  };

  async function save(next: string) {
    const change: { slots?: string; next?: string } = {};
    if (next.slice(0, SLOTS) !== saved.current.slice(0, SLOTS)) change.slots = next.slice(0, SLOTS);
    if (next.slice(SLOTS) !== saved.current.slice(SLOTS)) change.next = next.slice(SLOTS);
    if (!change.slots && !change.next) return;
    setState("saving");
    try {
      const r = await saveAvail(change);
      saved.current = next;
      onSaved(r.party);
      setState("saved");
    } catch (e) {
      setState("");
      onError(errorText(e));
    }
  }
  /** 칸을 바꾸면 같은 요일·시각의 다음 주 칸도 같이 (시간표는 요일 루틴, 제작자 2026-11-04 '시간은 루틴한 거니까'). 보이는 다음 주 칸의 7일 전은 다 지난 때라 그대로 둔다 */
  const put = (a: string[], k: number, v: string) => {
    a[k] = v;
    if (k < SLOTS) a[k + SLOTS] = v;
  };
  const setCell = (k: number, val: boolean) => {
    const v = val ? "1" : "0";
    if (k < 0 || (bitsRef.current[k] === v && (k >= SLOTS || bitsRef.current[k + SLOTS] === v))) return;
    const a = bitsRef.current.split("");
    put(a, k, v);
    const b = a.join("");
    bitsRef.current = b;
    setBits(b);
    if (drag.current) drag.current.changed = true;
  };
  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const v = el?.dataset?.k;
    return v === undefined ? null : Number(v);
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (lock) return;
    const k = cellAt(e.clientX, e.clientY);
    if (k === null || k < 0) return;
    e.preventDefault();
    drag.current = { val: bitsRef.current[k] !== "1", changed: false };
    setCell(k, drag.current.val);
    grid.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const k = cellAt(e.clientX, e.clientY);
    if (k !== null) setCell(k, drag.current.val);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.changed) void save(bitsRef.current);
  };
  /** 모두 지우기: 보이는 칸과 그 다음 주 칸. 루틴이라 새 주에도 그대로 이어져서 '전주 복사'는 뺐다 (제작자 2026-11-04) */
  const clearAll = () => {
    const a = bitsRef.current.split("");
    for (const k of keys) put(a, k, "0");
    const b = a.join("");
    bitsRef.current = b;
    setBits(b);
    void save(b);
  };
  const count = keys.filter((k) => bits[k] === "1").length;
  // 파티원이 모두 되는 칸 (내 칸은 지금 칠한 대로, 다른 사람은 받은 시간표로)
  const party = data.party;
  const others = party ? party.members.filter((m) => m.id !== me) : [];
  const allAt = (k: number) => others.length > 0 && bits[k] === "1" && others.every((m) => freeAt(party!, m.id, k));

  return (
    <section className="panel gd-times">
      {/* 한 줄: 내 시간표 · 시간 · (모두 지우기) · 확정/수정 (제작자 요청 2026-11-02) */}
      <div className="gd-times-head gd-mine-head">
        <b>내 시간표</b>
        <small>
          {count ? `${count / 2}시간` : "칠한 때 없음"}
          {lock ? " · 확정" : state === "saving" ? " · 저장 중" : state === "saved" ? " · 저장됨" : ""}
        </small>
        <span className="gd-tools">
          {!lock && count > 0 && (
            <button className="bd-mini" onClick={clearAll}>
              모두 지우기
            </button>
          )}
          <button className={"pill gd-lock" + (lock ? "" : " pill-on")} onClick={() => setLock(!lock)}>
            {lock ? "수정" : "확정"}
          </button>
        </span>
      </div>
      <div
        ref={grid}
        className={"gd-grid" + (lock ? " gd-grid-locked" : " gd-grid-edit")}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <Head cols={cols} />
        {Array.from({ length: ROWS }, (_, r) => (
          <Row key={r} row={r} cols={cols} week={data.week}>
            {(k, col) => {
              const m = candMark(party, k);
              const cls =
                "gd-cell" +
                col +
                hourLine(r) +
                (k < 0 ? " gd-off" : allAt(k) ? " gd-all" : bits[k] === "1" ? " gd-on" : "") +
                m.cls;
              return (
                <span data-k={k} className={cls}>
                  {m.no > 0 && <b>{m.no}</b>}
                </span>
              );
            }}
          </Row>
        ))}
      </div>
      {party && <Legend mine />}
    </section>
  );
}

/**
 * 후보 칸 표시 (내 시간표와 교집합에 똑같이, 제작자 요청 2026-11-02): 지금 후보는 초록 테두리, 확정은 흰 테두리와 빛, 무산은 붉은 빗금,
 * 그리고 칸 안에 후보 번호 (빠른 순 1부터). 후보는 이번 주 칸만
 */
function candMark(p: PartyState | null, k: number): { cls: string; no: number } {
  const i = thisWeekSlot(k);
  if (!p || i < 0) return { cls: "", no: 0 };
  const no = p.candidates.indexOf(i) + 1;
  const cls =
    i === p.confirmed
      ? " gd-is-confirmed"
      : i === p.current
        ? " gd-is-current"
        : p.rejected.some((r) => r.slot === i)
          ? " gd-is-rejected"
          : "";
  return { cls, no };
}

/** 시간표 아래 뜻 (내 시간표는 '내 시간'도) */
function Legend({ mine = false }: { mine?: boolean }) {
  return (
    <p className="gd-legend">
      {mine && (
        <>
          <i className="gd-cell gd-on" /> 내 시간{" "}
        </>
      )}
      <i className="gd-cell gd-all" /> 모두 됨{" "}
      <i className="gd-cell gd-is-current" /> 지금 후보{" "}
      <i className="gd-cell gd-is-confirmed" /> 확정{" "}
      <i className="gd-cell gd-is-rejected" /> 무산{" "}
      <span className="gd-legend-no">1</span> 후보 번호
    </p>
  );
}

/** 정각(10:00, 11:00 …)에 시작하는 줄: 위에 가로 구분선 (제작자 요청 2026-11-02 '정각마다 가로 구분선, 헷갈림') */
const hourLine = (row: number) => (row > 0 && row % 2 === 0 ? " gd-hourline" : "");

/** 한 줄: 왼쪽 시간 이름과 7칸 (칸마다 키 cellKey: 이번 주·다음 주 칸, 없으면 -1) */
function Row({
  row,
  cols,
  week,
  children,
}: {
  row: number;
  cols: GridCol[];
  week: number;
  children: (k: number, col: string) => JSX.Element;
}) {
  return (
    <>
      <span className={"gd-time" + (row % 2 ? "" : " gd-hour")}>{rowLabel(row)}</span>
      {cols.map((col, c) => (
        <Fragment key={c}>{children(cellKey(week, col, row), colCls(cols, c))}</Fragment>
      ))}
    </>
  );
}

/**
 * 파티원 시간표 (제작자 2026-11-04 '다른 파티원의 시간표도 볼 수 있게, 각각 나와의 교집합이 보이게'):
 * 어두운 띠에서 파티원을 고르면 그 사람이 되는 칸은 파랑, 나도 되는 칸(나와의 교집합)은 금색, 나만 되는 칸은 옅은 테두리. 후보 표시는 다른 시간표와 같다
 */
function MateTimes({
  data,
  party: p,
  me,
  who,
  onWho,
  strip = true,
}: {
  data: GdData;
  party: PartyState;
  me: string;
  who: string;
  onWho: (id: string) => void;
  /** false 면 파티원 고르는 띠를 그리지 않는다 (다른 파티 구경이 따로 그린다) */
  strip?: boolean;
}) {
  const mates = p.members.filter((m) => m.id !== me);
  const mate = mates.find((m) => m.id === who) ?? mates[0];
  const cols = useMemo(() => gridCols(data.now), [data.now]);
  const keys = useMemo(() => visibleKeys(data.week, cols), [data.week, cols]);
  const inParty = p.members.some((m) => m.id === me);
  // 나: 내 파티면 파티 자료, 다른 파티 구경이면 내 시간표
  const mineAt = (k: number) =>
    k < 0 ? false : inParty ? freeAt(p, me, k) : (k >= SLOTS ? data.mineNext?.[k - SLOTS] : data.mine?.[k]) === "1";
  const theirsAt = (k: number) => freeAt(p, mate.id, k);
  const hours = keys.filter(theirsAt).length;
  const both = keys.filter((k) => theirsAt(k) && mineAt(k)).length;
  return (
    <section className="panel gd-times">
      {strip && (
        <div className="mk-sub gd-mates" role="tablist">
          {mates.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={m.id === mate.id}
              className={"sub-tab" + (m.id === mate.id ? " sub-tab-on" : "")}
              onClick={() => onWho(m.id)}
            >
              <FitLine text={m.id} wrap={false} />
            </button>
          ))}
        </div>
      )}
      <div className="gd-times-head">
        <b>{mate.id}</b>
        <small>
          {!hours ? "칠한 때 없음" : `${hours / 2}시간 · 나와 겹침 ${both / 2}시간`}
          {mate.confirmed ? " · 확정" : " · 입력 전"}
        </small>
      </div>
      <div className="gd-grid">
        <Head cols={cols} />
        {Array.from({ length: ROWS }, (_, r) => (
          <Row key={r} row={r} cols={cols} week={data.week}>
            {(k, col) => {
              const t = theirsAt(k);
              const mm = mineAt(k);
              const m = candMark(p, k);
              const cls =
                "gd-cell" +
                col +
                hourLine(r) +
                (k < 0 ? " gd-off" : t && mm ? " gd-all" : t ? " gd-on" : mm ? " gd-me-only" : "") +
                m.cls;
              return (
                <span data-k={k} className={cls}>
                  {m.no > 0 && <b>{m.no}</b>}
                </span>
              );
            }}
          </Row>
        ))}
      </div>
      <p className="gd-legend">
        <i className="gd-cell gd-on" /> {mate.id} <i className="gd-cell gd-all" /> 나와 겹침{" "}
        <i className="gd-cell gd-me-only" /> 나만 <i className="gd-cell gd-is-current" /> 지금 후보{" "}
        <span className="gd-legend-no">1</span> 후보 번호
      </p>
    </section>
  );
}

/** 교집합: 칸마다 되는 사람 수 (모두 되면 금색), 후보는 테두리. 칸을 누르면 누가 되는지 */
function HeatTimes({ data, party: p }: { data: GdData; party: PartyState }) {
  const [pick, setPick] = useState<number | null>(null);
  const cols = useMemo(() => gridCols(data.now), [data.now]);
  const ids = p.members.map((m) => m.id);
  const total = ids.length;
  const countAt = (k: number) => ids.filter((id) => freeAt(p, id, k)).length;
  return (
    <section className="panel gd-times">
      <div className="gd-times-head">
        <b>교집합</b>
        <small>
          {p.members.filter((m) => m.filled).length}/{total}명 칠함
        </small>
      </div>
      <div className="gd-grid">
        <Head cols={cols} />
        {Array.from({ length: ROWS }, (_, r) => (
          <Row key={r} row={r} cols={cols} week={data.week}>
            {(k, col) => {
              const n = k < 0 ? 0 : countAt(k);
              const m = candMark(p, k);
              const cls =
                "gd-cell" +
                col +
                hourLine(r) +
                (k < 0
                  ? " gd-off"
                  : n === total && total > 0
                    ? " gd-all"
                    : n > 0
                      ? ` gd-h${Math.min(3, Math.ceil((n / total) * 3))}`
                      : "") +
                m.cls +
                (pick === k ? " gd-picked" : "");
              return (
                <span data-k={k} className={cls} onClick={() => k >= 0 && setPick(pick === k ? null : k)}>
                  {m.no > 0 && <b>{m.no}</b>}
                </span>
              );
            }}
          </Row>
        ))}
      </div>
      {pick !== null && (
        <p className="gd-who">
          <b>{keyText(data.week, pick)}</b>
          <span> 됨 {ids.filter((id) => freeAt(p, id, pick)).join(", ") || "없음"}</span>
          {ids.some((id) => !freeAt(p, id, pick)) && (
            <span className="gd-who-no"> · 안 됨 {ids.filter((id) => !freeAt(p, id, pick)).join(", ")}</span>
          )}
        </p>
      )}
      <Legend />
    </section>
  );
}

/** 모든 파티: 이름, 파티원, 이번 주 정한 때. 누르면 그 자리에 펼쳐 구경한다 (제작자 2026-11-04 '다른 파티도 들어가서 구경할 수 있게') */
function AllParties({ data, me }: { data: GdData; me: string }) {
  const [open, setOpen] = useEntryState<number>("gd.peek", 0);
  const others = data.parties.filter((p) => p.id !== data.party?.id);
  if (!others.length) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">다른 파티 {others.length}</h2>
      <ul className="gd-all-list">
        {others.map((p) => {
          const full = data.others?.find((x) => x.id === p.id);
          const head = (
            <>
              <div className="gd-all-head">
                <b>
                  {p.stage !== null && <i className="gd-stage-tag">{p.stage}단계</i>}
                  {p.name}
                </b>
                <small>
                  {p.confirmed !== null
                    ? `${slotShort(data.week, p.confirmed)} 확정`
                    : p.current !== null
                      ? "정하는 중"
                      : "모으는 중"}
                  {full && <span className="gd-peek-chev">{open === p.id ? " ▴" : " ▾"}</span>}
                </small>
              </div>
              {open !== p.id && (
                <p className="gd-all-members">
                  {p.members.map((id) => (
                    <span key={id}>
                      <Nick name={id} /> <KakaoButton name={id} icon nested={!!full} />
                    </span>
                  ))}
                </p>
              )}
            </>
          );
          return (
            <li key={p.id} className={open === p.id ? "gd-peek-open" : undefined}>
              {full ? (
                <button className="gd-peek-btn" onClick={() => setOpen(open === p.id ? 0 : p.id)} aria-expanded={open === p.id}>
                  {head}
                </button>
              ) : (
                head
              )}
              {full && open === p.id && <PeekParty data={data} party={full} me={me} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 다른 파티 구경: 파티원 카드(상태만), 지금 상태, 교집합 · 파티원마다 시간표 (나와 겹치는 칸은 금색). 누르는 단추는 없다 */
function PeekParty({ data, party: p, me }: { data: GdData; party: PartyState; me: string }) {
  const [who, setWho] = useState("");
  const { high } = useKakao();
  const week = data.week;
  const all = p.members.every((m) => m.filled);
  const filled = p.members.filter((m) => m.filled).length;
  const pick = p.members.some((m) => m.id === who) ? who : "";
  return (
    <div className="gd-peek">
      <ul className="gd-members">
        {p.members.map((m) => (
          <li key={m.id} className={m.confirmed ? undefined : "gd-member-wait"}>
            <div className="gd-member-row">
              <FitLine className="gd-member-name" text={m.id} wrap={false} hs={high.includes(m.id)} />
              <KakaoButton name={m.id} icon />
              {m.id === p.leader && <i className="gd-leader">파티장</i>}
              <small className={m.confirmed ? "gd-st-yes" : undefined}>{m.confirmed ? "확정" : "입력 전"}</small>
            </div>
          </li>
        ))}
      </ul>
      <p className="gd-state">
        {p.confirmed !== null ? (
          <>
            이번 주는 <b>{slotText(week, p.confirmed)}</b> <small>· 모두 확정</small>
          </>
        ) : p.current !== null ? (
          <>
            {candidateNo(p, p.current)}번 후보 <b>{slotText(week, p.current)}</b>
            <small> · 확정 {p.yes.length}/{p.members.length}</small>
          </>
        ) : !all ? (
          <>
            시간표 {filled}/{p.members.length}
          </>
        ) : (
          <>교집합이 없어요</>
        )}
      </p>
      <div className="mk-sub gd-mates" role="tablist">
        <button role="tab" aria-selected={pick === ""} className={"sub-tab" + (pick === "" ? " sub-tab-on" : "")} onClick={() => setWho("")}>
          교집합
        </button>
        {p.members.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={pick === m.id}
            className={"sub-tab" + (pick === m.id ? " sub-tab-on" : "")}
            onClick={() => setWho(m.id)}
          >
            <FitLine text={m.id} wrap={false} />
          </button>
        ))}
      </div>
      {pick === "" ? (
        <HeatTimes data={data} party={p} />
      ) : (
        <MateTimes data={data} party={p} me={me} who={pick} onWho={setWho} strip={false} />
      )}
    </div>
  );
}
