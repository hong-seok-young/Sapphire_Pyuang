// 개발 요청 (제작자 요청 2026-11-05, 같은 날 길드원 전체에 열었다 '개발자한테 아주 자유롭게 신청, 범위는 개인·특정 인원·길드원 전체, 맨 위 전광판에 이 개발자는 무료로 해 줍니다,
// 개발 가능 -> 합의 1명 이상 -> 길마 최종 결재 -> 개발, 결재 의견, 반려되면 고쳐서 다시 신청, 버튼·테두리 반짝 애니메이션 잔뜩').
// 서버 server/devreq.ts. 결재란은 회사 결재 서류처럼 칸마다 도장 (새로 찍힌 도장만 쾅 찍힌다: 화면을 열 때는 움직이지 않는다)
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../auth";
import type { Me } from "../auth";
import { KakaoButton, Nick } from "../kakao";
import { ago } from "../market";
import { useEntryState } from "../router";
import { FitLine, FlowLine, Loading, TopBar } from "../ui";
import { SCOPE_NAME, STATUS_NAME, actDevReq, addDevReq, addDevTalk, delDevReq, editDevReq, loadDevReqs, loadDevTalk, loadPeople, myTurn, roundSteps } from "../devreq";
import type { DevAct, DevReq, DevRole, DevStep, DevTalk, Scope, Status } from "../devreq";

/** 앱개발자 (결재란의 개발자 검토·개발 착수 칸에 미리 적는다) */
/** 상태 거르기 칸의 짧은 이름 (제작자 2026-11-05 '모두부터 반려까지 버튼 한 행에': 두 글자로 6칸 한 줄) */
const FILTER_NAME: Record<string, string> = { any: "모두", review: "검토", agree: "결재", dev: "개발", done: "완료", rejected: "반려" };
const DEVELOPER = "퓨앙";
/** 길마 결재 칸 아래 미리 적는 이름 (제작자 2026-11-05 '길마 결재 아래에는 마을모금함 닉네임'). 길드마스터가 바뀌면 고친다 */
const GUILD_MASTER = "마을모금함";

const BOARD = "이 개발자는 무료로 해 줍니다 ★ 필요한 기능을 자유롭게 신청하세요 ★ 개발 가능 → 합의 → 길마 결재 → 개발 ★ 반려돼도 고쳐서 다시 신청할 수 있어요";

/** 이미 본 도장 (새로 찍힌 것만 쾅) */
const seenStamps = new Set<string>();
let primed = false;

type Tab = "all" | "turn" | "mine";
const FILTERS: (Status | "any")[] = ["any", "review", "agree", "dev", "done", "rejected"];

export function DevRequestsPage({ me, query }: { me: Me; query: URLSearchParams }) {
  const [data, setData] = useState<{ list: DevReq[]; role: DevRole } | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useEntryState<Tab>("dr.tab", "all");
  const [filter, setFilter] = useEntryState<Status | "any">("dr.st", "any");
  const [open, setOpen] = useState<number | null>(() => Number(query.get("id")) || null);
  const [writing, setWriting] = useState(false);
  const reload = useCallback(() => {
    loadDevReqs()
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    reload();
    // 보는 동안 30초마다, 앱으로 돌아올 때 다시 받는다
    const t = window.setInterval(() => document.visibilityState === "visible" && reload(), 30_000);
    const vis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [reload]);
  // 처음 그린 도장은 본 것으로 (화면을 열 때는 쾅 하지 않는다)
  useEffect(() => {
    if (data && !primed) window.setTimeout(() => (primed = true), 0);
  }, [data]);
  // 알림으로 들어오면 그 요청을 펼쳐 보인다
  const target = Number(query.get("id")) || null;
  useEffect(() => {
    if (!data || !target) return;
    setOpen(target);
    window.setTimeout(() => document.getElementById(`dr-${target}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
  }, [data, target]);

  const mineOf = (r: DevReq) => r.user_id === me.id || (me.characters ?? []).some((c) => c.id === r.user_id);
  const list = data?.list ?? [];
  const turn = data ? list.filter((r) => myTurn(r, data.role, me.id, mineOf(r))) : [];
  const mine = list.filter(mineOf);
  const shown = tab === "turn" ? turn : tab === "mine" ? mine : filter === "any" ? list : list.filter((r) => r.status === filter);

  return (
    <>
      <TopBar title="개발 요청" />
      <div className="dr">
        {/* 전광판 (제작자 '맨 위에 이 개발자는 무료로 해 줍니다 전광판 배너') */}
        <div className="dr-board" role="note">
          <span className="dr-bulbs dr-bulbs-a" aria-hidden />
          <span className="dr-bulbs dr-bulbs-b" aria-hidden />
          <span className="dr-board-tag">FREE</span>
          <FlowLine text={BOARD} />
        </div>

        {writing ? (
          <RequestForm
            meId={me.id}
            title="개발 요청하기"
            submit="신청"
            onCancel={() => setWriting(false)}
            onSave={async (b) => {
              const r = await addDevReq(b);
              setWriting(false);
              setTab("mine");
              setOpen(r.id);
              reload();
            }}
          />
        ) : (
          <button type="button" className="dr-new" onClick={() => setWriting(true)}>
            <span className="dr-new-shine" aria-hidden />
            <b>+ 개발 요청하기</b>
            <small>만들어 줬으면 하는 것, 불편한 것 무엇이든</small>
          </button>
        )}

        <div className="pill-row dr-tabs" role="tablist">
          {(
            [
              ["all", "전체", list.length],
              ["turn", "내 차례", turn.length],
              ["mine", "내 요청", mine.length],
            ] as [Tab, string, number][]
          ).map(([k, name, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={"pill" + (tab === k ? " pill-on" : "") + (k === "turn" && n ? " dr-tab-hot" : "")} onClick={() => setTab(k)}>
              {name} {n}
            </button>
          ))}
        </div>
        {tab === "all" && (
          <div className="mk-sub dr-filter" role="tablist">
            {FILTERS.map((f) => {
              const n = f === "any" ? list.length : list.filter((r) => r.status === f).length;
              return (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className={"sub-tab" + (filter === f ? " sub-tab-on" : "")} onClick={() => setFilter(f)}>
                  {FILTER_NAME[f]} <small>{n}</small>
                </button>
              );
            })}
          </div>
        )}

        {!data ? (
          <Loading error={error || undefined} />
        ) : shown.length === 0 ? (
          <p className="dr-empty">{tab === "turn" ? "지금 결재할 요청이 없어요" : tab === "mine" ? "아직 신청한 요청이 없어요" : "아직 요청이 없어요"}</p>
        ) : (
          <div className="dr-list">
            {shown.map((r) => (
              <ReqCard
                key={r.id}
                r={r}
                role={data.role}
                me={me.id}
                mine={mineOf(r)}
                turn={myTurn(r, data.role, me.id, mineOf(r))}
                open={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                onChanged={reload}
              />
            ))}
          </div>
        )}
        {error && data && <p className="dr-err">{error}</p>}
      </div>
    </>
  );
}

/** 새 요청과 고치기 (반려된 요청은 고쳐서 다시 신청) */
function RequestForm({
  meId,
  title,
  submit,
  init,
  onSave,
  onCancel,
}: {
  /** 신청한 사람 (특정 인원의 '나도 포함') */
  meId: string;
  title: string;
  submit: string;
  init?: { body: string; scope: Scope; people: string[] };
  onSave: (b: { body: string; scope: Scope; people: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(init?.body ?? "");
  const [scope, setScope] = useState<Scope>(init?.scope ?? "me");
  const [people, setPeople] = useState<string[]>(init?.people ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!body.trim()) return setErr("무엇이 필요한지 적어 주세요");
    if (scope === "some" && !people.length) return setErr("누구를 위한 기능인지 골라 주세요");
    setBusy(true);
    setErr("");
    try {
      await onSave({ body: body.trim(), scope, people: scope === "some" ? people : [] });
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };
  return (
    <section className="dr-form">
      <b className="dr-form-title">{title}</b>
      <textarea
        className="dr-text"
        value={body}
        maxLength={1000}
        rows={4}
        placeholder="자유롭게 적어 주세요 (예: 길드 던전 시간표를 카톡으로 보내는 버튼이 있으면 좋겠어요)"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="dr-scope-label">누구를 위한 기능이에요?</div>
      <div className="pill-row dr-scope" role="radiogroup">
        {(["me", "some", "all"] as Scope[]).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={scope === s} className={"pill" + (scope === s ? " pill-on" : "")} onClick={() => setScope(s)}>
            {SCOPE_NAME[s]}
          </button>
        ))}
      </div>
      {/* 제작자 2026-11-05 '정말 개인 용도도 가능, 그 버튼이 나한테만 뜨게 할 수도 있음' -> '나를 선택했을 때만' (누가 보는지는 안내에 넣지 않는다, 요청은 모두가 본다) */}
      {scope === "me" && <p className="dr-scope-tip">개인 용도도 가능해요 · 예: 그 버튼이 나에게만 보이게</p>}
      {scope === "some" && <PeoplePick me={meId} value={people} onChange={setPeople} />}
      {err && <p className="dr-err">{err}</p>}
      <div className="dr-form-btns">
        <button type="button" className="btn dr-btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="button" className="btn dr-btn dr-btn-go" onClick={() => void save()} disabled={busy}>
          <span className="dr-btn-shine" aria-hidden />
          {busy ? "보내는 중" : submit}
        </button>
      </div>
    </section>
  );
}

/** 특정 인원 고르기: 닉네임 찾기 + 고른 사람 칩 */
/** 특정 인원 고르기: 한 줄에 '나도 포함' 체크와 닉네임 찾기 (제작자 2026-11-05 '특정 인원 누르면 나도 포함인지 체크하게, 되도록 한 행에').
 *  나도 포함이면 people 에 신청한 사람 아이디가 들어간다 (고른 사람 칩에는 나를 빼고 보인다) */
function PeoplePick({ me, value, onChange }: { me: string; value: string[]; onChange: (v: string[]) => void }) {
  const [all, setAll] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    loadPeople()
      .then((r) => setAll(r.people.map((p) => p.id)))
      .catch(() => setAll([]));
  }, []);
  const hits = q.trim() && all ? all.filter((id) => id !== me && id.includes(q.trim()) && !value.includes(id)).slice(0, 8) : [];
  const withMe = value.includes(me);
  const others = value.filter((id) => id !== me);
  return (
    <div className="dr-people">
      {others.length > 0 && (
        <div className="dr-chips">
          {others.map((id) => (
            <button key={id} type="button" className="dr-chip dr-pop" onClick={() => onChange(value.filter((x) => x !== id))}>
              {id} ✕
            </button>
          ))}
        </div>
      )}
      <div className="dr-pick-row">
        <button
          type="button"
          role="checkbox"
          aria-checked={withMe}
          className={"dr-me" + (withMe ? " dr-me-on" : "")}
          onClick={() => onChange(withMe ? others : [me, ...others].slice(0, 30))}
        >
          <span className="dr-me-box" />나도 포함
        </button>
        <input className="dr-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder={all ? "닉네임 찾기" : "불러오는 중"} />
      </div>
      {hits.length > 0 && (
        <div className="dr-chips">
          {hits.map((id) => (
            <button
              key={id}
              type="button"
              className="dr-chip dr-chip-add"
              onClick={() => {
                onChange([...value, id].slice(0, 30));
                setQ("");
              }}
            >
              + {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STAMP_TEXT: Record<string, string> = { submit: "신청", resubmit: "신청", feasible: "가능", agree: "합의", approve: "결재", skip: "결재", force: "강제", done: "완료", reject: "반려" };

/** 결재란: 신청 · 개발자 검토 · 오피서 합의 · 길마 결재 · 개발 착수 (칸마다 도장, 제작자 2026-11-05 '개발 검토 말고 개발자 검토로') */
function ApprovalLine({ r }: { r: DevReq }) {
  const st = roundSteps(r);
  const by = (k: string) => st.filter((s) => s.kind === k);
  const sub = by("resubmit")[0] ?? by("submit")[0];
  const reject = by("reject")[0];
  const agrees = by("agree");
  // 칸: 이름, 찍힌 단계(도장 글), 지금 기다리는 칸인지, 미리 적어 둔 사람 (제작자 2026-11-05 '개발 검토는 퓨앙이니까 이름은 미리 아래에',
  // '합의는 오피서 합의로', '마지막은 개발 착수로': 길마 결재가 나면 착수 도장, 개발 완료면 완료 도장)
  const approve = by("approve")[0];
  // 길마가 합의 없이 결재(skip)하면 오피서 합의 칸에 회색 '생략', 반려된 요청을 강제 결재(force)하면 길마 결재 칸에 '강제' (제작자 2026-11-05)
  const skip = by("skip")[0];
  const force = by("force")[0];
  const go = approve ?? skip ?? force;
  const done = by("done")[0];
  const cells: { key: string; label: string; step?: DevStep; stamp?: string; count?: number; wait: boolean; rejected?: boolean; grey?: boolean; pre?: string }[] = [
    { key: "sub", label: "신청", step: sub, wait: false },
    { key: "feas", label: "개발자 검토", step: by("feasible")[0], wait: r.status === "review", pre: DEVELOPER },
    skip && !agrees.length
      ? { key: "agree", label: "오피서 합의", step: skip, stamp: "생략", grey: true, wait: false }
      : { key: "agree", label: "오피서 합의", step: agrees[agrees.length - 1], count: agrees.length, wait: r.status === "agree" && agrees.length === 0 },
    { key: "appr", label: "길마 결재", step: go, wait: r.status === "agree" && agrees.length > 0, pre: GUILD_MASTER },
    {
      key: "start",
      label: "개발 착수",
      step: done ?? (go && r.status === "dev" ? { ...go, user_id: DEVELOPER } : undefined),
      stamp: done ? "완료" : "착수",
      wait: false,
      pre: DEVELOPER,
    },
  ];
  // 반려는 도장이 끝난 다음 칸에 빨간 도장 (반려한 사람 이름이 아래에)
  if (reject) {
    const cell = cells.find((c) => !c.step && c.key !== "sub");
    if (cell) {
      cell.step = reject;
      cell.rejected = true;
    }
  }
  return (
    <div className={"dr-line" + (r.status === "rejected" ? " dr-line-rej" : "")}>
      {cells.map((c, i) => (
        <Fragment key={c.key}>
          {i > 0 && <span className={"dr-link" + (c.step || c.wait ? " dr-link-on" : "")} aria-hidden />}
          <div className={"dr-cell" + (c.wait && r.status !== "rejected" ? " dr-cell-wait" : "") + (c.step ? " dr-cell-done" : "")}>
            <span className="dr-cell-label">
              <FitLine text={c.label} wrap={false} />
            </span>
            <span className="dr-cell-box">
              {c.step ? (
                <Stamp
                  id={`${r.id}:${r.round}:${c.key}:${c.step.kind}:${c.count ?? 0}`}
                  text={c.rejected ? "반려" : c.stamp ?? (c.key === "agree" && (c.count ?? 0) > 1 ? `합의${c.count}` : STAMP_TEXT[c.step.kind])}
                  red={!!c.rejected}
                  grey={!!c.grey}
                />
              ) : c.wait && r.status !== "rejected" ? (
                <span className="dr-wait">대기</span>
              ) : null}
            </span>
            <span className={"dr-cell-who" + (!c.step && c.pre ? " dr-cell-pre" : "")}>
              {c.step ? <FitLine text={c.step.user_id} wrap={false} /> : c.pre ? <FitLine text={c.pre} wrap={false} /> : null}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** 도장: 새로 찍힌 것만 쾅 */
function Stamp({ id, text, red, grey }: { id: string; text: string; red: boolean; grey?: boolean }) {
  const pop = useRef(primed && !seenStamps.has(id)).current;
  useEffect(() => {
    seenStamps.add(id);
  }, [id]);
  return <span className={"dr-stamp" + (red ? " dr-stamp-red" : "") + (grey ? " dr-stamp-grey" : "") + (pop ? " dr-stamp-pop" : "")}>{text}</span>;
}

const KIND_LINE: Record<string, string> = {
  submit: "신청",
  resubmit: "고쳐서 다시 신청",
  feasible: "개발 가능",
  agree: "합의",
  approve: "최종 결재",
  skip: "합의 생략 · 최종 결재",
  force: "강제 결재",
  reject: "반려",
  done: "개발 완료",
};

function ReqCard({
  r,
  role,
  me,
  mine,
  turn,
  open,
  onToggle,
  onChanged,
}: {
  r: DevReq;
  role: DevRole;
  me: string;
  mine: boolean;
  turn: boolean;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  const lastReject = [...r.steps].reverse().find((s) => s.kind === "reject" && s.round === r.round);
  const st = roundSteps(r);
  const touched = st.some((s) => s.kind !== "submit" && s.kind !== "resubmit");
  const rounds = [...new Set(r.steps.map((s) => s.round))];
  return (
    <article id={`dr-${r.id}`} className={`dr-card dr-st-${r.status}` + (turn ? " dr-card-turn" : "") + (open ? " dr-card-open" : "")}>
      {turn && <span className="dr-turn-glow" aria-hidden />}
      <button type="button" className="dr-card-head" onClick={onToggle} aria-expanded={open}>
        <span className={`dr-badge dr-badge-${r.status}`}>
          {r.status === "dev" && <i className="dr-badge-run" aria-hidden />}
          {STATUS_NAME[r.status]}
        </span>
        <span className="dr-scope-chip">
          {r.scope === "some" ? `${SCOPE_NAME.some} ${r.people.length}명` : SCOPE_NAME[r.scope]}
        </span>
        {r.round > 1 && <span className="dr-round">{r.round}차</span>}
        {turn && <span className="dr-turn-tag">{r.status === "rejected" ? "고쳐서 다시" : "내 차례"}</span>}
        <span className="dr-card-no">#{r.id}</span>
      </button>
      <p className="dr-body" onClick={onToggle}>
        {r.body}
      </p>
      <div className="dr-meta">
        <span className="dr-who">
          <Nick name={r.user_id} />
          <KakaoButton name={r.user_id} />
        </span>
        <span>{ago(r.created_at)}</span>
        {r.talk > 0 && <span className="dr-talk-n">대화 {r.talk}</span>}
      </div>
      <ApprovalLine r={r} />

      {open && (
        <div className="dr-detail">
          {r.scope === "some" && <p className="dr-for">대상: {r.people.join(", ")}</p>}
          {r.status === "rejected" && lastReject && (
            <div className="dr-reject">
              <b>반려 의견 · {lastReject.user_id}</b>
              <p>{lastReject.note}</p>
            </div>
          )}

          {editing ? (
            <RequestForm
              meId={r.user_id}
              title={r.status === "rejected" ? "고쳐서 다시 신청" : "요청 고치기"}
              submit={r.status === "rejected" ? "다시 신청" : "저장"}
              init={{ body: r.body, scope: r.scope, people: r.people }}
              onCancel={() => setEditing(false)}
              onSave={async (b) => {
                await editDevReq(r.id, b);
                setEditing(false);
                onChanged();
              }}
            />
          ) : (
            <>
              <ActPanel r={r} role={role} me={me} mine={mine} onDone={onChanged} />
              {mine && (r.status === "rejected" || (r.status === "review" && !touched)) && (
                <button type="button" className={"btn dr-btn" + (r.status === "rejected" ? " dr-btn-go" : "")} onClick={() => setEditing(true)}>
                  {r.status === "rejected" && <span className="dr-btn-shine" aria-hidden />}
                  {r.status === "rejected" ? "고쳐서 다시 신청" : "수정"}
                </button>
              )}
            </>
          )}

          <div className="dr-history">
            <b className="dr-sub-title">결재 이력</b>
            {rounds.map((n) => (
              <div key={n} className="dr-round-box">
                {rounds.length > 1 && <span className="dr-round-name">{n}차</span>}
                {r.steps
                  .filter((s) => s.round === n)
                  .map((s, i) => (
                    <div key={i} className={`dr-step dr-step-${s.kind}`}>
                      <span className="dr-step-kind">{KIND_LINE[s.kind]}</span>
                      <span className="dr-step-who">
                        <Nick name={s.user_id} />
                      </span>
                      <span className="dr-step-at">{ago(s.created_at)}</span>
                      {s.note && <p className="dr-step-note">{s.note}</p>}
                    </div>
                  ))}
              </div>
            ))}
          </div>

          <Talk id={r.id} n={r.talk} onSent={onChanged} />

          {(mine || role.dev) && (
            <div className="dr-del">
              {err && <span className="dr-err">{err}</span>}
              <button
                type="button"
                className={"btn dr-btn dr-btn-small" + (sure ? " dr-btn-danger" : "")}
                onClick={async () => {
                  if (!sure) return setSure(true);
                  try {
                    await delDevReq(r.id);
                    onChanged();
                  } catch (e) {
                    setErr(errorText(e));
                  }
                }}
              >
                {sure ? "정말 삭제" : "삭제"}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** 결재 단추: 차례에 맞는 것만 (개발 가능·합의·최종 결재·개발 완료, 반려는 의견 필수) */
function ActPanel({ r, role, me, mine, onDone }: { r: DevReq; role: DevRole; me: string; mine: boolean; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 강제 결재는 두 번 눌러야 (처음 누르면 단추가 빨갛게 깜박, 글자는 그대로. 제작자 2026-11-05 '정말 강제 결재에서 정말은 빼')
  const [armed, setArmed] = useState(false);
  const st = roundSteps(r);
  const agrees = st.filter((s) => s.kind === "agree");
  type Act = DevAct;
  let acts: [Act, string][] = [];
  let hint = "";
  let ph = "결재 의견 (선택)";
  if (r.status === "review" && role.dev) {
    acts = [
      ["feasible", "개발 가능"],
      ["reject", "반려"],
    ];
    ph = "의견 (반려하면 꼭 적어 주세요)";
  } else if (r.status === "agree") {
    if (role.agree && !mine && !agrees.some((s) => s.user_id === me)) {
      acts = [
        ["agree", "합의"],
        ["reject", "반려"],
      ];
      ph = "개발자에게 제안 (예: 이 화면에 이렇게 넣어 주세요)";
    } else if (role.approve) {
      // 합의가 없으면 길마 권한으로 오피서 합의를 건너뛰고 결재 (제작자 2026-11-05)
      acts = [
        agrees.length ? ["approve", "최종 결재"] : ["skip", "합의 생략 결재"],
        ["reject", "반려"],
      ];
      ph = "개발자에게 제안 (예: 이렇게 만들어 주세요)";
    }
  } else if (r.status === "rejected" && role.approve && st.some((s) => s.kind === "feasible")) {
    // 개발자 검토를 지나 오피서(나 길마)가 반려한 요청은 길마가 강제 결재 (제작자 2026-11-05 '오피서가 반려해도 강제 결재')
    acts = [["force", "강제 결재"]];
    ph = "개발자에게 제안 (예: 이렇게 만들어 주세요)";
  } else if (r.status === "dev" && role.dev) {
    acts = [["done", "개발 완료"]];
    ph = "한마디 (선택)";
  }
  if (!acts.length) return null;
  const go = async (act: Act) => {
    if (act === "reject" && !note.trim()) return setErr("반려 의견을 적어 주세요");
    if (act === "force" && !armed) return setArmed(true);
    setBusy(true);
    setErr("");
    try {
      await actDevReq(r.id, act, note.trim());
      setNote("");
      onDone();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dr-act">
      <b className="dr-sub-title dr-act-title">내 결재</b>
      <textarea className="dr-text dr-note" rows={2} maxLength={300} value={note} placeholder={ph} onChange={(e) => setNote(e.target.value)} />
      {hint && <p className="dr-hint">{hint}</p>}
      {err && <p className="dr-err">{err}</p>}
      <div className="dr-act-btns">
        {acts.map(([a, name]) => (
          <button
            key={a}
            type="button"
            className={"btn dr-btn " + (a === "reject" ? "dr-btn-no" : a === "force" ? "dr-btn-force" + (armed ? " dr-btn-danger" : "") : "dr-btn-go")}
            disabled={busy}
            onClick={() => void go(a)}
          >
            {a !== "reject" && <span className="dr-btn-shine" aria-hidden />}
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 요청마다 대화 */
function Talk({ id, n, onSent }: { id: number; n: number; onSent: () => void }) {
  const [talk, setTalk] = useState<DevTalk[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    loadDevTalk(id)
      .then((r) => setTalk(r.talk))
      .catch(() => setTalk([]));
  }, [id, n]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await addDevTalk(id, text.trim());
      setText("");
      onSent();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dr-talk">
      <b className="dr-sub-title">대화</b>
      {talk?.map((t) => (
        <div key={t.id} className="dr-talk-line">
          <span className="dr-talk-who">
            <Nick name={t.user_id} />
          </span>
          <span className="dr-talk-text">{t.text}</span>
          <span className="dr-step-at">{ago(t.created_at)}</span>
        </div>
      ))}
      <div className="dr-talk-in">
        <input value={text} maxLength={300} placeholder="개발할 수 있는지 이야기해요" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void send()} />
        <button type="button" className="btn dr-btn" disabled={busy || !text.trim()} onClick={() => void send()}>
          보내기
        </button>
      </div>
      {err && <p className="dr-err">{err}</p>}
    </div>
  );
}
