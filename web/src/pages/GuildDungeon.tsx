// 길드 던전 화면 #/match (제작자 요청 2026-11-02, 1군 전용, src/gdungeon.ts, 서버 server/gdungeon.ts)
// 위에서부터 (이번 주 날짜 줄은 뺐다, 제작자 요청 2026-11-02 '다 알아'): 내 파티와 지금 후보(확정·불참), 내 시간표 / 교집합, 모든 파티.
// 시간표는 칸을 누르고 끌어서 칠한다 (왼쪽 시간 줄을 끌면 화면이 내려간다).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { JOB_NAME, errorText } from "../auth";
import type { Job, Me } from "../auth";
import {
  COLS,
  EMPTY,
  MAX_MEMBERS,
  ROWS,
  SLOT_MS,
  answerGd,
  candidateNo,
  colHead,
  createParty,
  deleteParty,
  editParty,
  fetchGd,
  leaveParty,
  rowLabel,
  saveAvail,
  setPartiesOpen,
  slotOf,
  slotShort,
  slotText,
  undoAnswer,
  validSlot,
} from "../gdungeon";
import type { GdData, GdPerson, PartyState } from "../gdungeon";
import { KakaoButton, Nick, useKakao } from "../kakao";
import { sampleParty } from "../sample";
import { useSample } from "../tutorialState";
import { useEntryState } from "../router";
import { FitLine, Loading, TopBar } from "../ui";

export function GuildDungeonPage({ me }: { me: Me }) {
  const [data, setData] = useState<GdData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useEntryState<"mine" | "heat">("gd.tab", "mine");
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
    // 파티원이 확정·불참을 누르면 바로 보이게: 화면을 보는 동안 30초마다, 앱으로 돌아올 때
    const t = window.setInterval(
      () => document.visibilityState === "visible" && load(),
      30_000,
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
  // 파티 명단을 숨긴 동안 (제작자 2026-11-03 '일단 파티 목록 안 보이게'): 안내 한 줄과 내 시간표만. 칠해 두면 명단이 열릴 때 바로 후보가 나온다
  if (data.hidden && !party)
    return (
      <>
        <TopBar title="길드 던전" />
        {error && <p className="form-error">{error}</p>}
        <p className="gd-hidden">파티 명단은 운영진이 공지한 뒤에 열려요 · 먼저 내 시간표를 칠해 두세요</p>
        <MyTimes key={data.week} me={me.id} data={data} onSaved={setParty} onError={setError} />
      </>
    );
  return (
    <>
      <TopBar title="길드 던전" />
      {error && <p className="form-error">{error}</p>}
      {data.canOpen && <OpenBar data={data} onDone={load} onError={setError} />}
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
          <button
            className={"pill" + (tab === "heat" ? " pill-on" : "")}
            onClick={() => setTab("heat")}
          >
            교집합
          </button>
        </nav>
      )}
      {!party || tab === "mine" ? (
        <MyTimes
          key={data.week}
          me={me.id}
          data={data}
          onSaved={setParty}
          onError={setError}
        />
      ) : (
        <HeatTimes data={data} party={party} />
      )}
      <AllParties data={data} />
    </>
  );
}

/** 파티 명단 열기·숨기기 줄 (길드마스터·앱개발자, 제작자 2026-11-03 '공지까지 숨기기 버튼'): 숨긴 동안 길드원은 안내 한 줄과 내 시간표만 본다.
 *  '명단 열기'는 두 번 눌러야 하고(정말 열기), 열면 파티에 든 사람 모두에게 알림이 간다 (functions/api/gd/open.ts) */
function OpenBar({ data, onDone, onError }: { data: GdData; onDone: () => void; onError: (m: string) => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSure(false);
  }, [data.open]);
  const go = (open: boolean) => {
    setBusy(true);
    setPartiesOpen(open)
      .then(
        () => {
          setSure(false);
          onDone();
        },
        (e) => onError(errorText(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className="gd-open-bar">
      <span>{data.open ? "파티 명단이 모두에게 열려 있어요" : "공지 전 숨김 · 길드원은 내 시간표만 봐요"}</span>
      {data.open ? (
        <button className="pill" disabled={busy} onClick={() => go(false)}>
          공지까지 숨기기
        </button>
      ) : sure ? (
        <button className="pill pill-gold" disabled={busy} onClick={() => go(true)}>
          정말 열기
        </button>
      ) : (
        <button className="pill" disabled={busy} onClick={() => setSure(true)}>
          명단 열기
        </button>
      )}
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
  const { high } = useKakao();
  const week = data.week;
  const leader = p.leader === me.id;
  const canManage = leader || data.staff;
  const all = p.members.every((m) => m.filled);
  const waiting = p.members.filter((m) => !m.filled).map((m) => m.id);
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
        {(p.stage !== null || canManage) && (
          <span className="gd-stage">
            {canManage && (
              <button
                className="pill gd-stage-btn"
                disabled={busy || p.stage === null}
                onClick={() =>
                  run(() =>
                    editParty(p.id, {
                      stage: p.stage !== null && p.stage > 1 ? p.stage - 1 : null,
                    }),
                  )
                }
                aria-label="단계 내리기"
              >
                −
              </button>
            )}
            <i>{p.stage !== null ? `${p.stage}단계` : "단계"}</i>
            {canManage && (
              <button
                className="pill gd-stage-btn"
                disabled={busy || (p.stage ?? 0) >= 9}
                onClick={() => run(() => editParty(p.id, { stage: (p.stage ?? 0) + 1 }))}
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
          const said = p.current !== null && p.yes.includes(m.id);
          // 상태는 짧게 (한 칸에 닉네임 · 카톡 · 파티장 · 상태가 한 줄로 들어가게, 제작자 요청 2026-11-02)
          const state = !m.filled
            ? "미입력"
            : p.confirmed !== null || said
              ? "확정"
              : all && p.current !== null
                ? "대기"
                : "입력";
          const row = (
            <>
              <FitLine
                className="gd-member-name"
                text={m.id}
                wrap={false}
                hs={high.includes(m.id)}
              />
              <KakaoButton name={m.id} nested={canManage || m.id === me.id} />
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
                (m.filled ? "" : "gd-member-wait") +
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
              onClick={() => void run(() => answerGd(p.current!, "yes"))}
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

/** 시간표 머리 (열마다 요일과 날짜) */
function Head({ week }: { week: number }) {
  return (
    <>
      <span className="gd-corner" />
      {Array.from({ length: COLS }, (_, c) => {
        const h = colHead(week, c);
        return (
          <span
            key={c}
            className={
              "gd-head" +
              (h.day === "토" || h.day === "일" ? " gd-weekend" : "")
            }
          >
            <b>{h.day}</b>
            <small>{h.date}</small>
          </span>
        );
      })}
    </>
  );
}

/** 내 시간표: 칸을 누르고 끌어서 칠한다. 손을 떼면 저장 */
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
  const [bits, setBits] = useState(data.mine ?? EMPTY);
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const bitsRef = useRef(bits);
  bitsRef.current = bits;
  const drag = useRef<{ val: boolean; changed: boolean } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  // 확정: 다 칠한 뒤 누르면 시간표가 잠겨 스크롤하다 잘못 눌러도 안 바뀐다. '수정'을 누르면 풀린다
  // (제작자 요청 2026-11-02 '자꾸 스크롤하다가 막 누르게 된다'). 이 기기에 계정·주마다 기억한다
  const lockKey = `sapphire.gd.lock.${me}.${data.week}`;
  const [lock, setLockState] = useState<boolean>(() => {
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
  };
  // 지난 칸도 칠할 수 있다: 매주 같은 루틴을 그대로 적어 두려고 (제작자 요청 2026-11-02 '시간 지났다고 비활성화하지 마'). 후보는 앞으로 올 때만 (서버)
  const locked = (i: number) => !validSlot(i);

  async function save(next: string) {
    setState("saving");
    try {
      const r = await saveAvail(next);
      onSaved(r.party);
      setState("saved");
    } catch (e) {
      setState("");
      onError(errorText(e));
    }
  }
  const setCell = (i: number, val: boolean) => {
    if (locked(i) || (bitsRef.current[i] === "1") === val) return;
    const b =
      bitsRef.current.slice(0, i) +
      (val ? "1" : "0") +
      bitsRef.current.slice(i + 1);
    bitsRef.current = b;
    setBits(b);
    if (drag.current) drag.current.changed = true;
  };
  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const v = el?.dataset?.slot;
    return v === undefined ? null : Number(v);
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (lock) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i === null || locked(i)) return;
    e.preventDefault();
    drag.current = { val: bitsRef.current[i] !== "1", changed: false };
    setCell(i, drag.current.val);
    grid.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i !== null) setCell(i, drag.current.val);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.changed) void save(bitsRef.current);
  };
  /** 전주 복사: 칸 자리가 요일·시각마다 같아서 지난주 시간표를 그대로 옮긴다 (목 10시에 새 주가 되면 시간표는 빈다) */
  const fill = (from: string) => {
    let b = "";
    for (let i = 0; i < from.length; i++)
      b += locked(i)
        ? bitsRef.current[i]
        : from[i] === "1" && validSlot(i)
          ? "1"
          : "0";
    setBits(b);
    void save(b);
  };
  const count = useMemo(
    () => [...bits].filter((c, i) => c === "1" && validSlot(i)).length,
    [bits],
  );
  // 파티원이 모두 되는 칸 (내 칸은 지금 칠한 대로, 다른 사람은 받은 시간표로. 모두 칠했을 때만)
  const party = data.party;
  const others = party ? party.members.filter((m) => m.id !== me) : [];
  const ready = !!party && party.members.every((m) => m.filled || m.id === me);
  const allAt = (i: number) =>
    ready &&
    bits[i] === "1" &&
    others.every((m) => party!.avail[m.id]?.[i] === "1");

  return (
    <section className="panel gd-times">
      {/* 한 줄: 내 시간표 · 시간 · (전주 복사 · 모두 지우기) · 확정/수정 (제작자 요청 2026-11-02) */}
      <div className="gd-times-head gd-mine-head">
        <b>내 시간표</b>
        <small>
          {count ? `${count / 2}시간` : "칠한 때 없음"}
          {lock
            ? " · 확정"
            : state === "saving"
              ? " · 저장 중"
              : state === "saved"
                ? " · 저장됨"
                : ""}
        </small>
        <span className="gd-tools">
          {!lock && data.prev && data.prev !== bits && (
            <button className="bd-mini" onClick={() => fill(data.prev!)}>
              전주 복사
            </button>
          )}
          {!lock && count > 0 && (
            <button className="bd-mini" onClick={() => fill(EMPTY)}>
              모두 지우기
            </button>
          )}
          <button
            className={"pill gd-lock" + (lock ? "" : " pill-on")}
            onClick={() => setLock(!lock)}
          >
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
        <Head week={data.week} />
        {Array.from({ length: ROWS }, (_, r) => (
          <Row key={r} row={r}>
            {(i) => {
              const m = candMark(party, i);
              const cls =
                "gd-cell" +
                hourLine(i) +
                (locked(i)
                  ? " gd-off"
                  : allAt(i)
                    ? " gd-all"
                    : bits[i] === "1"
                      ? " gd-on"
                      : "") +
                m.cls;
              return (
                <span key={i} data-slot={i} className={cls}>
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
 * 그리고 칸 안에 후보 번호 (빠른 순 1부터)
 */
function candMark(
  p: PartyState | null,
  i: number,
): { cls: string; no: number } {
  if (!p) return { cls: "", no: 0 };
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

/** 정각(09:00, 10:00 …)에 시작하는 칸: 위에 가로 구분선 (제작자 요청 2026-11-02 '정각마다 가로 구분선, 헷갈림') */
const hourLine = (i: number) => {
  const row = (((i + 2) % 48) + 48) % 48;
  return row > 0 && row % 2 === 0 ? " gd-hourline" : "";
};

/** 한 줄: 왼쪽 시간 이름과 7칸 */
function Row({
  row,
  children,
}: {
  row: number;
  children: (i: number) => JSX.Element;
}) {
  return (
    <>
      <span className={"gd-time" + (row % 2 ? "" : " gd-hour")}>
        {rowLabel(row)}
      </span>
      {Array.from({ length: COLS }, (_, c) => children(slotOf(c, row)))}
    </>
  );
}

/** 교집합: 칸마다 되는 사람 수 (모두 되면 금색), 후보는 테두리. 칸을 누르면 누가 되는지 */
function HeatTimes({ data, party: p }: { data: GdData; party: PartyState }) {
  const [pick, setPick] = useState<number | null>(null);
  const ids = p.members.map((m) => m.id);
  const total = ids.length;
  const countAt = (i: number) =>
    ids.filter((id) => p.avail[id]?.[i] === "1").length;
  const off = (i: number) => !validSlot(i);
  return (
    <section className="panel gd-times">
      <div className="gd-times-head">
        <b>교집합</b>
        <small>
          {p.members.filter((m) => m.filled).length}/{total}명 칠함
        </small>
      </div>
      <div className="gd-grid">
        <Head week={data.week} />
        {Array.from({ length: ROWS }, (_, r) => (
          <Row key={r} row={r}>
            {(i) => {
              const n = off(i) ? 0 : countAt(i);
              const m = candMark(p, i);
              const cls =
                "gd-cell" +
                hourLine(i) +
                (off(i)
                  ? " gd-off"
                  : n === total && total > 0
                    ? " gd-all"
                    : n > 0
                      ? ` gd-h${Math.min(3, Math.ceil((n / total) * 3))}`
                      : "") +
                m.cls +
                (pick === i ? " gd-picked" : "");
              return (
                <span
                  key={i}
                  data-slot={i}
                  className={cls}
                  onClick={() => !off(i) && setPick(pick === i ? null : i)}
                >
                  {m.no > 0 && <b>{m.no}</b>}
                </span>
              );
            }}
          </Row>
        ))}
      </div>
      {pick !== null && (
        <p className="gd-who">
          <b>{slotText(data.week, pick)}</b>
          <span>
            {" "}
            됨{" "}
            {ids.filter((id) => p.avail[id]?.[pick] === "1").join(", ") ||
              "없음"}
          </span>
          {ids.some((id) => p.avail[id]?.[pick] !== "1") && (
            <span className="gd-who-no">
              {" "}
              · 안 됨{" "}
              {ids.filter((id) => p.avail[id]?.[pick] !== "1").join(", ")}
            </span>
          )}
        </p>
      )}
      <Legend />
    </section>
  );
}

/** 모든 파티: 이름, 파티원, 이번 주 정한 때 */
function AllParties({ data }: { data: GdData }) {
  const others = data.parties.filter((p) => p.id !== data.party?.id);
  if (!others.length) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">다른 파티 {others.length}</h2>
      <ul className="gd-all-list">
        {others.map((p) => (
          <li key={p.id}>
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
              </small>
            </div>
            <p className="gd-all-members">
              {p.members.map((id) => (
                <span key={id}>
                  <Nick name={id} /> <KakaoButton name={id} />
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
