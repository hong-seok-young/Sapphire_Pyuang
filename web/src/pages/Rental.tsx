// 장비대여 (#/rent, 제작자 요청 2026-11-01, 2026-11-02 고침): 대여 담당 성민 님의 카카오톡 대여무기 목록을 옮겼다.
// - 목록: 직업마다 레벨별로 쭉 (레벨 머리줄 아래 얇은 줄): 위키 그림과 +강, 짧은 옵션(명중9 크리4), 기한, 💎 가격, 바로 가능 / 사용 중 / 대기 수.
// - 신청: 줄 왼쪽 칸으로 여러 개 골라 한 번에 신청서로. 무기마다 선착순으로 줄을 서고, 신청 전에 '앞사람이 받은 날 + 기한 뒤' 받을 수 있는 날을 보인다.
//   줄이 없으면 기한이 지나도 계속 쓰고, 줄이 생기면 기한이 끝나는 날 담당자에게 돌려준다. 신청서마다 신청한 사람과 운영진의 대화창.
// - 운영진: 신청서마다 무기별 수락·거절, 차례가 오면 '건네줌'(마일리지에서 쓴 💎), 반납, 직접 대여, 물건 더하기·고치기·내리기, 카톡 목록 붙여넣기, 마일리지.
// 실제 주고받기는 게임 안에서. 지금은 개발 중이라 앱개발자만 들어온다 (src/launcher.ts, server/rental.ts)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useEntryState } from "../router";
import { JOBS, JOB_NAME, errorText } from "../auth";
import type { Job, Me } from "../auth";
import type { Wiki } from "../types";
import { Loading, PicImg, TopBar } from "../ui";
import {
  STATUS_NAME,
  TERMS,
  TERM_NAME,
  actRequest,
  addMileage,
  addRent,
  applyRent,
  diaGold,
  editRent,
  fetchMileage,
  fetchRent,
  importRent,
  lendRent,
  levelOf,
  md,
  optionParts,
  removeRent,
  returnRent,
  talkRent,
  weaponOf,
} from "../rental";
import type { AppRequest, ImportSummary, LedgerLine, RentApp, RentData, RentFields, RentItem, RentTerm } from "../rental";

const REASON: Record<LedgerLine["reason"], string> = { donate: "기부", rent: "대여", adjust: "고침" };
/** 한 번에 고를 수 있는 무기 수 (서버 MAX_APP_ITEMS 와 같다) */
const MAX_PICK = 5;

/** '11/2 14:05' */
function when(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 새로 신청하면 언제 받는지: 바로 / 11/19부터 (앞사람이 받은 날 + 2주) / 앞사람이 반납하면 */
function nextText(i: RentItem, now: number): string {
  if (!i.renter && !i.queue) return "바로 받을 수 있어요";
  if (i.next === null) return "앞사람이 반납하면 받아요 (기한 없음)";
  if (i.next <= now + 60_000) return "앞사람이 돌려주면 바로 받아요";
  return `${md(i.next)}부터 받아요 (앞사람이 받은 날 + ${TERM_NAME[i.term]})`;
}

export function RentalPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const [data, setData] = useState<RentData | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useEntryState<Job>("job", me.job ?? "warrior");
  const [onlyFree, setOnlyFree] = useEntryState("free", false);
  const [open, setOpen] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [panel, setPanel] = useState<"" | "apps" | "add" | "paste" | "mileage">("apps");
  const [showLedger, setShowLedger] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchRent());
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (!data) return (
    <>
      <TopBar title="장비대여" />
      <Loading error={error || undefined} onRetry={() => void load()} />
    </>
  );

  const now = Date.now();
  const mine = new Set(data.mine);
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const myHeld = data.items.filter((i) => i.renter && mine.has(i.renter));
  const myApps = data.apps.filter((a) => a.mine && a.requests.some((r) => r.status === "wait" || r.status === "ok" || r.holding));
  const openApps = data.manager ? data.apps.filter((a) => a.requests.some((r) => r.status === "wait" || r.status === "ok")) : [];
  const waitCount = openApps.reduce((n, a) => n + a.requests.filter((r) => r.status === "wait").length, 0);
  const ofJob = data.items.filter((i) => i.job === job && (!onlyFree || (!i.renter && !i.queue)));
  // 레벨별로 쭉 (같은 레벨 안에서는 무기, 강화, 기한 순서)
  const levels = [...new Set(ofJob.map((i) => levelOf(wiki, i)))].sort((a, b) => a - b);
  const toggle = (id: number) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PICK ? cur : [...cur, id]));

  return (
    <>
      <TopBar title="장비대여" />
      {error && <p className="form-error">{error}</p>}

      {/* 내 마일리지, 쓰는 무기(돌려줄 날), 내 신청서 */}
      <section className="panel rent-me">
        <div className="rent-me-top">
          <span className="rent-dia">💎 {data.mileage.toLocaleString()}</span>
          <small>마일리지 · {diaGold(data.mileage, data.rate)} 골드</small>
          <button className="pill" onClick={() => setShowLedger((v) => !v)}>
            장부
          </button>
        </div>
        {showLedger && <Ledger lines={data.ledger} rate={data.rate} />}
        {myHeld.map((i) => (
          <p key={i.id} className="rent-me-line">
            🤝 {i.weapon} +{i.enhance} ·{" "}
            {!i.dueAt ? (
              "기한 없음"
            ) : i.queue ? (
              <b className={i.dueAt < now ? "rent-late" : "rent-warn"}>다음 사람 있음 · {md(i.dueAt)}에 담당자에게 돌려주세요</b>
            ) : (
              <span className="rent-muted">기한 {md(i.dueAt)} · 다음 신청이 없으면 계속 써요</span>
            )}
          </p>
        ))}
        {myApps.map((a) => (
          <AppCard key={a.id} app={a} data={data} byId={byId} onDone={() => void load()} />
        ))}
      </section>

      {/* 운영진: 신청서, 물건 더하기, 카톡 목록 붙여넣기, 마일리지 */}
      {data.manager && (
        <section className="panel rent-admin">
          <div className="mk-chips">
            <b className="rent-admin-title">운영</b>
            {(["apps", "add", "paste", "mileage"] as const).map((p) => (
              <button key={p} className={"pill" + (panel === p ? " pill-on" : "")} onClick={() => setPanel(panel === p ? "" : p)}>
                {p === "apps" ? `신청 ${openApps.length}${waitCount ? ` (새 ${waitCount})` : ""}` : p === "add" ? "+ 물건" : p === "paste" ? "목록 붙여넣기" : "마일리지"}
              </button>
            ))}
          </div>
          {panel === "apps" &&
            (openApps.length ? (
              openApps.map((a) => <AppCard key={a.id} app={a} data={data} byId={byId} manage onDone={() => void load()} />)
            ) : (
              <p className="rent-muted">기다리는 신청이 없어요</p>
            ))}
          {panel === "add" && <ItemForm wiki={wiki} start={{ job }} onDone={() => (setPanel(""), void load())} />}
          {panel === "paste" && <PasteImport onDone={() => void load()} />}
          {panel === "mileage" && <MileagePanel data={data} onDone={() => void load()} />}
        </section>
      )}

      {/* 직업, 바로 받을 수 있는 것만 */}
      <div className="mk-chips rent-jobs">
        {JOBS.map((j) => (
          <button key={j} className={"pill" + (job === j ? " pill-on" : "")} onClick={() => setJob(j)}>
            {JOB_NAME[j]}
          </button>
        ))}
        <button className={"pill" + (onlyFree ? " pill-on" : "")} onClick={() => setOnlyFree((v) => !v)}>
          바로 가능
        </button>
      </div>

      {levels.map((lv) => (
        <section key={lv} className="rent-lv">
          <h2 className="rent-lv-head">Lv.{lv}</h2>
          <ul className="rent-list">
            {ofJob
              .filter((i) => levelOf(wiki, i) === lv)
              .sort((a, b) => a.weapon.localeCompare(b.weapon) || a.enhance - b.enhance || TERMS.indexOf(a.term) - TERMS.indexOf(b.term) || a.price - b.price)
              .map((i) => (
                <li key={i.id} className={"rent-li" + (open === i.id ? " rent-open" : "") + (i.renter ? " rent-held" : "")}>
                  <div className="rent-row">
                    {/* 고르기: 신청할 수 있는 무기만 (내가 쓰거나 이미 신청한 것은 빼고) */}
                    {i.mine || (i.renter && mine.has(i.renter)) ? (
                      <span className="rent-pick rent-pick-off" aria-hidden>
                        {i.mine ? "⏳" : "🤝"}
                      </span>
                    ) : (
                      <button className={"rent-pick" + (picked.includes(i.id) ? " rent-pick-on" : "")} onClick={() => toggle(i.id)} aria-label="고르기" aria-pressed={picked.includes(i.id)} />
                    )}
                    <button className="rent-main" onClick={() => setOpen(open === i.id ? null : i.id)}>
                      <Slot wiki={wiki} item={i} />
                      <span className="rent-nm">
                        {i.weapon}
                        <em>+{i.enhance}</em>
                      </span>
                      <span className="rent-op">{optionParts(i.options).map(([n, v]) => `${n}${v}`).join(" ") || i.options}</span>
                      {/* 기한 없는 것은 표시 없이, 2주·4주만 */}
                      {i.term !== "none" && <span className={"rent-tg rent-tg-" + i.term}>{TERM_NAME[i.term]}</span>}
                      <span className="rent-pr">💎{i.price}</span>
                      <RowStatus item={i} />
                    </button>
                  </div>
                  {open === i.id && <Detail wiki={wiki} item={i} data={data} now={now} onDone={() => void load()} />}
                </li>
              ))}
          </ul>
        </section>
      ))}
      {!ofJob.length && <div className="empty">{onlyFree ? "지금 바로 받을 수 있는 무기가 없어요" : "대여 무기가 없어요"}</div>}

      {picked.length > 0 && <Cart picked={picked.map((id) => byId.get(id)).filter((i): i is RentItem => !!i)} now={now} onClear={() => setPicked([])} onDone={() => (setPicked([]), void load())} />}
    </>
  );
}

/** 무기 그림 칸 (+강 표) */
function Slot({ wiki, item }: { wiki: Wiki; item: RentItem }) {
  const it = weaponOf(wiki, item.weapon);
  return <span className="rent-slot">{it?.icon ? <PicImg pic={it.icon} fit={22} /> : "?"}</span>;
}

/** 줄 오른쪽 끝: 바로 / 대기 2 / 사용 중 */
function RowStatus({ item }: { item: RentItem }) {
  if (item.mine) return <span className="rent-st rent-st-me">{item.mine.pos}번째</span>;
  if (!item.renter && !item.queue) return <span className="rent-st rent-st-free">바로</span>;
  return <span className="rent-st">{item.queue ? `대기 ${item.queue}` : "사용 중"}</span>;
}

/** 펼친 칸: 위키 정보, 쓰는 사람과 줄, 내 신청, 운영진 일 */
function Detail({ wiki, item, data, now, onDone }: { wiki: Wiki; item: RentItem; data: RentData; now: number; onDone: () => void }) {
  const info = weaponOf(wiki, item.weapon)?.equip?.[0]?.info;
  const [editing, setEditing] = useState(false);
  return (
    <div className="rent-detail">
      <p className="mk-meta">
        {[
          `Lv.${levelOf(wiki, item)}`,
          info?.["공격"] && `공격 ${info["공격"]}`,
          info?.["속도"] && `속도 ${info["속도"]}`,
          info?.["옵션"] && `옵션 범위 ${info["옵션"]}`,
          item.donor && `기부 ${item.donor}`,
          `💎${item.price} = ${diaGold(item.price, data.rate)} 골드`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {item.note && <p className="mk-note">{item.note}</p>}
      <p className="rent-line">
        {item.renter ? (
          <>
            🤝 {item.renter} 사용 중{item.rentedAt ? ` · ${md(item.rentedAt)}부터` : ""}
            {item.dueAt ? ` · 기한 ${md(item.dueAt)}` : " · 기한 없음"}
            {item.dueAt && !item.queue ? " (다음 신청이 없으면 계속 써요)" : ""}
          </>
        ) : (
          "담당자에게 있어요"
        )}
      </p>
      {/* 줄: 길드원은 수와 내 차례, 운영진은 명단 */}
      {item.queue > 0 && (
        <p className="rent-line">
          ⏳ 대기 {item.queue}명
          {item.line && ` · ${item.line.map((q) => `${q.pos}. ${q.user}(${STATUS_NAME[q.status]}${q.at ? ` ${md(q.at)}~` : ""})`).join(", ")}`}
        </p>
      )}
      {item.mine ? (
        <MyRequest item={item} onDone={onDone} />
      ) : (
        !(item.renter && data.mine.includes(item.renter)) && <p className="rent-next">새로 신청하면 {nextText(item, now)}</p>
      )}
      {data.manager &&
        (editing ? (
          <ItemForm wiki={wiki} start={item} onDone={() => (setEditing(false), onDone())} />
        ) : (
          <ManagerBox item={item} data={data} onEdit={() => setEditing(true)} onDone={onDone} />
        ))}
    </div>
  );
}

/** 펼친 칸의 내 신청: 차례, 받을 수 있는 날, 취소 */
function MyRequest({ item, onDone }: { item: RentItem; onDone: () => void }) {
  const m = item.mine!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="mk-actions">
      <span className="rent-next">
        내 신청 · {STATUS_NAME[m.status]} · {m.pos}번째
        {m.at ? (m.at <= Date.now() + 60_000 ? " · 바로" : ` · ${md(m.at)}부터`) : m.pos === 1 && !item.renter ? " · 바로" : " · 앞사람이 반납하면"}
      </span>
      <button
        className="pill"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await actRequest(m.rid, "cancel");
            onDone();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        신청 취소
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 고른 무기 칸 (화면 아래): 무기마다 받을 수 있는 날을 보이고 한마디와 함께 신청서로 */
function Cart({ picked, now, onClear, onDone }: { picked: RentItem[]; now: number; onClear: () => void; onDone: () => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="rent-cart">
      {openForm && (
        <div className="rent-cart-form">
          {picked.map((i) => (
            <p key={i.id} className="rent-cart-line">
              <b>
                {i.weapon} +{i.enhance}
              </b>{" "}
              <span>{i.term === "none" ? "무기한" : TERM_NAME[i.term]} · 💎{i.price}</span>
              <small>{nextText(i, now)}</small>
            </p>
          ))}
          <input className="mk-input" placeholder="한마디 (마일리지 쓸 양, 받을 시간 등)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
      <div className="rent-cart-bar">
        <span>
          {picked.length}개 골랐어요 <small>(한 번에 {MAX_PICK}개까지)</small>
        </span>
        <button className="pill" onClick={onClear}>
          비우기
        </button>
        {openForm ? (
          <button
            className="pill pill-on"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await applyRent(
                  picked.map((i) => i.id),
                  note.trim(),
                );
                onDone();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            신청
          </button>
        ) : (
          <button className="pill pill-on" onClick={() => setOpenForm(true)}>
            대여 신청
          </button>
        )}
      </div>
    </div>
  );
}

/** 신청서: 무기마다 상태와 차례, 운영진의 수락·거절·건네줌, 신청한 사람의 취소, 대화창 */
function AppCard({ app, data, byId, manage = false, onDone }: { app: RentApp; data: RentData; byId: Map<number, RentItem>; manage?: boolean; onDone: () => void }) {
  const [talkOpen, setTalkOpen] = useState(manage || app.talk.length > 0);
  return (
    <div className="rent-app">
      <div className="rent-app-head">
        <b>{manage ? app.user : "내 신청"}</b>
        <small>{when(app.createdAt)}</small>
        {manage && app.mileage !== undefined && <small className="rent-dia-sm">💎{app.mileage}</small>}
        <button className="pill rent-talk-btn" onClick={() => setTalkOpen((v) => !v)}>
          💬 {app.talk.length || ""}
        </button>
      </div>
      {app.note && <p className="mk-note">{app.note}</p>}
      <ul className="rent-app-list">
        {app.requests.map((r) => (
          <ReqLine key={r.rid} r={r} item={byId.get(r.itemId)} app={app} manage={manage} rate={data.rate} onDone={onDone} />
        ))}
      </ul>
      {talkOpen && <Talk app={app} onDone={onDone} />}
    </div>
  );
}

/** 신청서의 무기 한 줄 */
function ReqLine({ r, item, app, manage, rate, onDone }: { r: AppRequest; item?: RentItem; app: RentApp; manage: boolean; rate: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handing, setHanding] = useState(false);
  const [use, setUse] = useState(0);
  const act = async (action: "accept" | "reject" | "cancel" | "hand") => {
    setBusy(true);
    setError("");
    try {
      await actRequest(r.rid, action, action === "hand" ? use : 0);
      setHanding(false);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const queued = r.status === "wait" || r.status === "ok";
  // 건넬 수 있는 때: 무기가 담당자에게 있고 줄의 첫 사람 (그 밖에도 담당자 판단으로 건넬 수 있게 '건네줌'은 늘 둔다)
  const free = item && !item.renter;
  const state = r.holding
    ? `사용 중${item?.dueAt ? ` · 기한 ${md(item.dueAt)}` : ""}`
    : queued
      ? `${STATUS_NAME[r.status]} · ${r.pos}번째${r.at ? (r.at <= Date.now() + 60_000 ? " · 바로" : ` · ${md(r.at)}부터`) : free && r.pos === 1 ? " · 바로" : " · 앞사람 반납 뒤"}`
      : r.status === "done"
        ? `건네받음${r.returnedAt ? ` · ${md(r.returnedAt)} 반납` : ""}`
        : STATUS_NAME[r.status];
  return (
    <li className="rent-req">
      <div className="rent-req-top">
        <span className="rent-req-name">
          {r.weapon ?? "내려간 무기"} {r.enhance !== null ? `+${r.enhance}` : ""}
          <small>
            {r.term ? (r.term === "none" ? " 무기한" : ` ${TERM_NAME[r.term]}`) : ""} {r.price !== null ? `💎${r.price}` : ""}
          </small>
        </span>
        <span className={"rent-req-st rent-req-" + (r.holding ? "hold" : r.status)}>{state}</span>
      </div>
      {queued && (
        <div className="mk-actions">
          {manage ? (
            <>
              {r.status === "wait" && (
                <button className="pill pill-on" disabled={busy} onClick={() => void act("accept")}>
                  수락
                </button>
              )}
              <button className={"pill" + (handing ? " pill-on" : "")} disabled={busy || !free} onClick={() => setHanding((v) => !v)}>
                건네줌
              </button>
              <button className="pill" disabled={busy} onClick={() => void act("reject")}>
                거절
              </button>
              {!free && item?.renter && <small className="rent-muted">{item.renter} 님에게 돌려받은 뒤 건네요</small>}
            </>
          ) : (
            app.mine && (
              <button className="pill" disabled={busy} onClick={() => void act("cancel")}>
                취소
              </button>
            )
          )}
        </div>
      )}
      {handing && item && (
        <div className="mk-actions rent-hand">
          <span className="rent-muted">마일리지</span>
          <button className="pill" disabled={use <= 0} onClick={() => setUse((v) => Math.max(0, v - 1))}>
            −
          </button>
          <b className="rent-use">💎{use}</b>
          <button className="pill" disabled={use >= Math.min(item.price, app.mileage ?? 0)} onClick={() => setUse((v) => v + 1)}>
            +
          </button>
          <span className="rent-muted">골드 {diaGold(item.price - use, rate)}</span>
          <button className="pill pill-on" disabled={busy} onClick={() => void act("hand")}>
            건넸어요
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </li>
  );
}

/** 신청서 대화창 (신청한 사람과 운영진) */
function Talk({ app, onDone }: { app: RentApp; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // scrollIntoView 는 요즘 크롬에서 Promise 를 돌려준다: 화살표로 그대로 돌려주면 React 가 정리 함수로 불러 화면이 비었다 (대화 보내기, 장비대여에서 홈)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [app.talk.length]);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError("");
    try {
      await talkRent(app.id, t);
      setText("");
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rent-talk">
      {app.talk.length > 0 && (
        <ul className="rent-talk-list">
          {app.talk.map((t) => (
            <li key={t.id} className={t.user === app.user ? "rent-talk-them" : "rent-talk-staff"}>
              <b>{t.user}</b> <small>{when(t.at)}</small>
              <p>{t.text}</p>
            </li>
          ))}
        </ul>
      )}
      <div ref={end} className="rent-talk-input">
        <input
          className="mk-input"
          placeholder="대화 (받을 시간, 마일리지 등)"
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
          }}
        />
        <button className="pill pill-on" disabled={busy || !text.trim()} onClick={() => void send()}>
          보내기
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 운영진: 직접 대여, 반납, 고치기, 내리기 (신청서의 수락·건네줌은 '운영 > 신청') */
function ManagerBox({ item, data, onEdit, onDone }: { item: RentItem; data: RentData; onEdit: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lending, setLending] = useState(false);
  const [sure, setSure] = useState<"" | "return" | "remove">("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setSure("");
      setLending(false);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rent-manage">
      <div className="mk-actions">
        {item.renter ? (
          sure === "return" ? (
            <>
              <span className="rent-muted">게임 안에서 돌려받았어요?</span>
              <button className="pill pill-on" disabled={busy} onClick={() => run(() => returnRent(item.id))}>
                반납
              </button>
              <button className="pill" onClick={() => setSure("")}>
                취소
              </button>
            </>
          ) : (
            <button className="pill" onClick={() => setSure("return")}>
              반납
            </button>
          )
        ) : (
          <button className={"pill" + (lending ? " pill-on" : "")} onClick={() => setLending((v) => !v)}>
            직접 대여
          </button>
        )}
        <button className="pill" onClick={onEdit}>
          정보 수정
        </button>
        {!item.renter &&
          (sure === "remove" ? (
            <>
              <button className="pill pill-danger" disabled={busy} onClick={() => run(() => removeRent(item.id))}>
                내리기
              </button>
              <button className="pill" onClick={() => setSure("")}>
                취소
              </button>
            </>
          ) : (
            <button className="pill" onClick={() => setSure("remove")}>
              내리기
            </button>
          ))}
      </div>
      {lending && <LendForm item={item} data={data} busy={busy} onLend={(body) => run(() => lendRent(item.id, body))} />}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 직접 대여: 카톡 등으로 따로 받은 것을 닉네임으로 적는다 (마일리지를 쓰면 그 사람 장부에서 뺀다, 날짜를 고르면 그날 빌려 간 것으로) */
function LendForm({ item, data, busy, onLend }: { item: RentItem; data: RentData; busy: boolean; onLend: (b: { renter: string; useDia: number; date?: string }) => void }) {
  const [renter, setRenter] = useState("");
  const [use, setUse] = useState(0);
  const [date, setDate] = useState("");
  return (
    <div className="rent-ask">
      <NameInput value={renter} onChange={setRenter} members={data.members ?? []} placeholder="빌려 갈 사람 닉네임" />
      <div className="mk-actions">
        <span className="rent-muted">마일리지</span>
        <button className="pill" disabled={use <= 0} onClick={() => setUse((v) => Math.max(0, v - 1))}>
          −
        </button>
        <b className="rent-use">💎{use}</b>
        <button className="pill" disabled={use >= item.price} onClick={() => setUse((v) => Math.min(item.price, v + 1))}>
          +
        </button>
        <span className="rent-muted">골드 {diaGold(item.price - use, data.rate)}</span>
      </div>
      <label className="mk-field">
        <span>빌려 간 날 (비우면 오늘)</span>
        <input className="mk-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button className="btn" disabled={busy || !renter.trim()} onClick={() => onLend({ renter: renter.trim(), useDia: use, ...(date ? { date } : {}) })}>
        대여 처리
      </button>
    </div>
  );
}

/** 닉네임 칸: 적는 대로 길드원 닉네임을 칩으로 보여 준다 (앱에 없는 사람도 그대로 적을 수 있다) */
function NameInput({ value, onChange, members, placeholder }: { value: string; onChange: (v: string) => void; members: string[]; placeholder: string }) {
  const q = value.trim().toLowerCase();
  const hits = q ? members.filter((m) => m.toLowerCase().includes(q) && m !== value).slice(0, 6) : [];
  return (
    <>
      <input className="mk-input" placeholder={placeholder} maxLength={20} value={value} onChange={(e) => onChange(e.target.value)} />
      {hits.length > 0 && (
        <div className="mk-chips">
          {hits.map((m) => (
            <button key={m} type="button" className="pill" onClick={() => onChange(m)}>
              {m}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** 물건 더하기·고치기 */
function ItemForm({ wiki, start, onDone }: { wiki: Wiki; start: Partial<RentItem>; onDone: () => void }) {
  const [f, setF] = useState<RentFields>({
    job: start.job ?? "warrior",
    level: start.level ?? 1,
    weapon: start.weapon ?? "",
    options: start.options ?? "",
    enhance: start.enhance ?? 6,
    term: start.term ?? "none",
    price: start.price ?? 1,
    donor: start.donor ?? "",
    note: start.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof RentFields>(k: K, v: RentFields[K]) => setF((cur) => ({ ...cur, [k]: v }));
  // 그 직업의 위키 무기 (이름을 누르면 레벨도 위키 값으로)
  const weapons = useMemo(
    () =>
      Object.values(wiki.items)
        .filter((it) => it.equip?.some((e) => e.slot === `${JOB_NAME[f.job]} 무기`))
        .map((it) => ({ name: it.name, level: Number(it.equip[0].info["레벨제한"]) || 1 }))
        .sort((a, b) => a.level - b.level),
    [wiki, f.job],
  );
  const q = f.weapon.trim().replace(/\s+/g, "");
  const hits = q ? weapons.filter((w) => w.name.replace(/\s+/g, "").includes(q) && w.name !== f.weapon).slice(0, 6) : [];
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (start.id) await editRent(start.id, f);
      else await addRent(f);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-form rent-form">
      <div className="mk-chips">
        {JOBS.map((j) => (
          <button key={j} type="button" className={"pill" + (f.job === j ? " pill-on" : "")} onClick={() => set("job", j)}>
            {JOB_NAME[j]}
          </button>
        ))}
      </div>
      <div className="mk-chips">
        {TERMS.map((t) => (
          <button key={t} type="button" className={"pill" + (f.term === t ? " pill-on" : "")} onClick={() => set("term", t as RentTerm)}>
            {TERM_NAME[t]}
          </button>
        ))}
      </div>
      <label className="mk-field">
        <span>무기</span>
        <input className="mk-input" maxLength={30} value={f.weapon} onChange={(e) => set("weapon", e.target.value)} />
      </label>
      {hits.length > 0 && (
        <div className="mk-chips">
          {hits.map((w) => (
            <button
              key={w.name}
              type="button"
              className="pill"
              onClick={() => setF((cur) => ({ ...cur, weapon: w.name, level: w.level }))}
            >
              {w.name} <small>Lv.{w.level}</small>
            </button>
          ))}
        </div>
      )}
      <div className="rent-grid">
        <Num label="레벨" value={f.level} min={1} max={200} onChange={(v) => set("level", v)} />
        <Num label="+강" value={f.enhance} min={0} max={20} onChange={(v) => set("enhance", v)} />
        <Num label="💎" value={f.price} min={0} max={9999} onChange={(v) => set("price", v)} />
      </div>
      <label className="mk-field">
        <span>옵션 (명6크3, 지4마11마재1)</span>
        <input className="mk-input" maxLength={30} value={f.options} onChange={(e) => set("options", e.target.value)} />
      </label>
      <label className="mk-field">
        <span>기부</span>
        <input className="mk-input" maxLength={20} value={f.donor} onChange={(e) => set("donor", e.target.value)} />
      </label>
      <label className="mk-field">
        <span>메모</span>
        <input className="mk-input" maxLength={100} value={f.note} onChange={(e) => set("note", e.target.value)} />
      </label>
      <div className="mk-actions">
        <button className="btn" disabled={busy || !f.weapon.trim()} onClick={() => void save()}>
          {start.id ? "저장" : "물건 추가"}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          취소
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function Num({ label, value, min, max, onChange }: { label: ReactNode; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="mk-field">
      <span>{label}</span>
      <input
        className="mk-input"
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)));
        }}
      />
    </label>
  );
}

/** 카톡 목록 붙여넣기: 미리 보기(새로, 그대로, 내림) 뒤 적용 */
function PasteImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [sum, setSum] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (apply: boolean) => {
    setBusy(true);
    setError("");
    try {
      const r = await importRent(text, apply);
      setSum(r);
      if (r.applied) onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-form rent-form">
      <textarea
        className="mk-input rent-paste"
        placeholder="[sapphire 대여무기 목록] 전사 … 카톡 목록 글을 그대로"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSum(null);
        }}
      />
      {sum && (
        <p className="mk-meta">
          {sum.jobs.map((j) => JOB_NAME[j]).join(", ")} · 새로 {sum.add} · 그대로 {sum.keep} · 내림 {sum.gone}
          {sum.goneRented ? ` (대여 중 ${sum.goneRented})` : ""}
          {sum.skipped.length ? ` · 읽지 못한 줄 ${sum.skipped.length}: ${sum.skipped.slice(0, 3).join(" / ")}` : ""}
          {sum.applied ? " · 적용했어요" : ""}
        </p>
      )}
      <div className="mk-actions">
        <button className="btn btn-ghost" disabled={busy || !text.trim()} onClick={() => void run(false)}>
          미리 보기
        </button>
        <button className="btn" disabled={busy || !sum || !!sum.applied} onClick={() => void run(true)}>
          적용
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 마일리지: 사람마다 남은 💎, 적립(기부)·차감, 그 사람 장부 */
function MileagePanel({ data, onDone }: { data: RentData; onDone: () => void }) {
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState<"donate" | "adjust">("donate");
  const [minus, setMinus] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<{ who: string; mileage: number; ledger: LedgerLine[] } | null>(null);
  const show = async (name: string) => {
    try {
      setView(await fetchMileage(name));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await addMileage(who.trim(), minus ? -amount : amount, reason, note.trim());
      setNote("");
      onDone();
      void show(who.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-form rent-form">
      <NameInput value={who} onChange={setWho} members={data.members ?? []} placeholder="닉네임" />
      <div className="mk-chips">
        <button type="button" className={"pill" + (!minus && reason === "donate" ? " pill-on" : "")} onClick={() => (setMinus(false), setReason("donate"))}>
          + 기부 적립
        </button>
        <button type="button" className={"pill" + (!minus && reason === "adjust" ? " pill-on" : "")} onClick={() => (setMinus(false), setReason("adjust"))}>
          + 고침
        </button>
        <button type="button" className={"pill" + (minus ? " pill-on" : "")} onClick={() => (setMinus(true), setReason("adjust"))}>
          − 차감
        </button>
      </div>
      <div className="rent-grid">
        <Num label="💎" value={amount} min={1} max={9999} onChange={setAmount} />
      </div>
      <input className="mk-input" placeholder={reason === "donate" ? "기부한 장비 (+8 글라디우스)" : "까닭"} maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" disabled={busy || !who.trim()} onClick={() => void save()}>
        {minus ? `💎${amount} 빼기` : `💎${amount} 더하기`}
      </button>
      {error && <p className="form-error">{error}</p>}
      {view && (
        <div className="rent-view">
          <b>
            {view.who} 💎{view.mileage}
          </b>
          <Ledger lines={view.ledger} rate={data.rate} />
        </div>
      )}
      <ul className="rent-balances">
        {(data.balances ?? []).map((b) => (
          <li key={b.person}>
            <button className="rent-balance" onClick={() => (setWho(b.person), void show(b.person))}>
              <span>{b.person}</span>
              <b>💎{b.dia}</b>
            </button>
          </li>
        ))}
        {!(data.balances ?? []).length && <li className="rent-muted">아직 적립한 사람이 없어요</li>}
      </ul>
    </div>
  );
}

/** 장부 줄들 */
function Ledger({ lines, rate }: { lines: LedgerLine[]; rate: number }) {
  if (!lines.length) return <p className="rent-muted">아직 기록이 없어요</p>;
  return (
    <ul className="rent-ledger">
      {lines.map((l, n) => (
        <li key={n}>
          <span className={l.delta > 0 ? "rent-plus" : "rent-minus"}>
            💎{l.delta > 0 ? "+" : ""}
            {l.delta}
          </span>
          <span>
            {REASON[l.reason]}
            {l.note ? ` · ${l.note}` : ""}
            {l.gold ? ` · 골드 ${diaGold(l.gold / rate, rate)}` : ""}
          </span>
          <small>{md(l.at)}</small>
        </li>
      ))}
    </ul>
  );
}

