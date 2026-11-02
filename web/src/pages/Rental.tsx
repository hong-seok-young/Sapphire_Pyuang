// 장비대여 (#/rent, 제작자 요청 2026-11-01, 2026-11-02 고침): 대여 담당 성민 님의 카카오톡 대여무기 목록을 옮겼다.
// - 목록: 직업마다 레벨별로 쭉 (레벨 머리줄 아래 얇은 줄): 위키 그림과 +강, 짧은 옵션(명중9 크리4), 기한, 💎 가격, 빌려 간 무기만 '대여 중'
//   (2026-11-02 제작자 요청: '바로' 표시와 '바로 가능' 거르기는 뺐다. 줄과 내 차례는 펼친 칸과 신청서에서).
// - 폰 화면이 작아서 단추는 한 줄에 (2026-11-02 제작자 요청 '두 줄씩 있는 거 보기 안 좋아, 콤팩트하게'): 신청서의 무기 줄은 단추를 오른쪽에,
//   확인을 묻는 동안에는 그 단추만, 대화창은 '대화'를 눌러 연다.
// - 신청: 줄 왼쪽 칸으로 여러 개 골라 한 번에 신청서로. 무기마다 선착순으로 줄을 서고, 신청 전에 '앞사람이 받은 날 + 기한 뒤' 받을 수 있는 날을 보인다.
//   줄이 없으면 기한이 지나도 계속 쓰고, 줄이 생기면 기한이 끝나는 날 담당자에게 돌려준다. 신청서마다 신청한 사람과 운영진의 대화창.
// - 운영진: 신청서마다 무기별 수락·거절, 차례가 오면 '건네줌'(마일리지에서 쓴 💎), 반납, 직접 대여, 물건 더하기·고치기·내리기, 카톡 목록 붙여넣기, 마일리지.
// - 화면은 세 칸 (제작자 요청 2026-11-02 '신청함은 따로, 운영에서도 신청 관리 단추 따로, 위에 뜨게 하니까 복잡함'): 목록(#/rent, 무기 목록부터),
//   신청함(#/rent?v=apps: 내 마일리지와 장부, 쓰는 무기, 내 신청서), 운영(#/rent?v=staff: 신청 · 물건 추가 · 붙여넣기 · 마일리지).
// - 단추에 이모지를 넣지 않고 같은 줄 단추는 폭을 같게 (.pill-row). 💎 는 값의 단위로만 쓴다.
// - 기부 마일리지: 물건 더하기·고치기에서 '기부 💎' 를 적으면 기부자에게 적립 (server/rental.ts setDonation, 고치면 차이만).
// 실제 주고받기는 게임 안에서. 지금은 개발 중이라 운영진과 앱개발자만 미리 본다 (src/launcher.ts canPreview, server/rental.ts canEnter)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { go, useEntryState } from "../router";
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

/** 새로 신청하면 언제 받는지: 지금 / 11/19부터 (앞사람이 받은 날 + 2주) / 앞사람이 반납하면 ('바로'라는 말은 쓰지 않는다, 제작자 요청 2026-11-02) */
function nextText(i: RentItem, now: number): string {
  if (!i.renter && !i.queue) return "지금 받을 수 있어요";
  if (i.next === null) return "앞사람이 반납하면 받아요 (기한 없음)";
  if (i.next <= now + 60_000) return "앞사람이 돌려주면 받아요";
  return `${md(i.next)}부터 받아요 (앞사람이 받은 날 + ${TERM_NAME[i.term]})`;
}

export function RentalPage({ wiki, me, view }: { wiki: Wiki; me: Me; view: string }) {
  const [data, setData] = useState<RentData | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useEntryState<Job>("job", me.job ?? "warrior");
  const [open, setOpen] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [panel, setPanel] = useEntryState<"apps" | "add" | "paste" | "mileage">("panel", "apps");
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
  const ofJob = data.items.filter((i) => i.job === job);
  // 레벨별로 쭉 (같은 레벨 안에서는 무기, 강화, 기한 순서)
  const levels = [...new Set(ofJob.map((i) => levelOf(wiki, i)))].sort((a, b) => a - b);
  const toggle = (id: number) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PICK ? cur : [...cur, id]));

  const tab = view === "apps" || (view === "staff" && data.manager) ? view : "list";
  const views: { key: string; name: string; to: string; badge?: number }[] = [
    { key: "list", name: "목록", to: "#/rent" },
    { key: "apps", name: myApps.length ? `신청함 ${myApps.length}` : "신청함", to: "#/rent?v=apps" },
    ...(data.manager ? [{ key: "staff", name: "운영", to: "#/rent?v=staff", badge: waitCount }] : []),
  ];

  return (
    <>
      <TopBar title="장비대여" />
      {/* 목록 · 신청함 · 운영 (제작자 요청 2026-11-02: 신청함과 운영의 신청 관리를 따로, 목록은 무기부터) */}
      <nav className="pill-row rent-views">
        {views.map((v) => (
          <button key={v.key} className={"pill" + (tab === v.key ? " pill-on" : "")} aria-pressed={tab === v.key} onClick={() => go(v.to, true)}>
            {v.name}
            {!!v.badge && (
              <span className="rent-new" aria-label={`확인 전 ${v.badge}`}>
                {v.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
      {error && <p className="form-error">{error}</p>}

      {/* 신청함: 내 마일리지와 장부, 쓰는 무기(돌려줄 날), 내 신청서 */}
      {tab === "apps" && (
        <section className="panel rent-me">
          <div className="rent-me-top">
            <span className="rent-dia">💎 {data.mileage.toLocaleString()}</span>
            <small>마일리지 · {diaGold(data.mileage, data.rate)} 골드</small>
            <button className={"pill" + (showLedger ? " pill-on" : "")} onClick={() => setShowLedger((v) => !v)}>
              장부
            </button>
          </div>
          {showLedger && <Ledger lines={data.ledger} rate={data.rate} />}
          {/* 쓰는 무기: 줄이 있으면 기한이 끝나는 날 담당자에게 반납, 없으면 계속 쓴다 */}
          {myHeld.map((i) => (
            <p key={i.id} className="rent-me-line">
              <span>
                {i.weapon} +{i.enhance} <small className="rent-muted">대여 중</small>
              </span>
              {!i.dueAt ? (
                <span className="rent-muted">기한 없음</span>
              ) : i.queue ? (
                <b className={i.dueAt < now ? "rent-late" : "rent-warn"}>
                  {md(i.dueAt)} 반납 · 대기 {i.queue}
                </b>
              ) : (
                <span className="rent-muted">기한 {md(i.dueAt)} · 대기 없음</span>
              )}
            </p>
          ))}
          {myApps.map((a) => (
            <AppCard key={a.id} app={a} data={data} byId={byId} onDone={() => void load()} />
          ))}
          {!myHeld.length && !myApps.length && <p className="rent-muted">신청한 무기가 없어요</p>}
        </section>
      )}

      {/* 운영: 신청 관리, 물건 추가, 카톡 목록 붙여넣기, 마일리지 */}
      {tab === "staff" && (
        <section className="panel rent-admin">
          <div className="pill-row">
            {(["apps", "add", "paste", "mileage"] as const).map((p) => (
              <button key={p} className={"pill" + (panel === p ? " pill-on" : "")} aria-pressed={panel === p} onClick={() => setPanel(p)}>
                {p === "apps" ? `신청 ${openApps.length}` : p === "add" ? "물건 추가" : p === "paste" ? "붙여넣기" : "마일리지"}
              </button>
            ))}
          </div>
          {panel === "apps" &&
            (openApps.length ? (
              openApps.map((a) => <AppCard key={a.id} app={a} data={data} byId={byId} manage onDone={() => void load()} />)
            ) : (
              <p className="rent-muted">기다리는 신청이 없어요</p>
            ))}
          {panel === "add" && <ItemForm wiki={wiki} data={data} start={{ job }} onDone={() => (setPanel("apps"), void load())} />}
          {panel === "paste" && <PasteImport onDone={() => void load()} />}
          {panel === "mileage" && <MileagePanel data={data} onDone={() => void load()} />}
        </section>
      )}

      {tab === "list" && (
        <>
      {/* 직업 */}
      <div className="pill-row rent-jobs">
        {JOBS.map((j) => (
          <button key={j} className={"pill" + (job === j ? " pill-on" : "")} onClick={() => setJob(j)}>
            {JOB_NAME[j]}
          </button>
        ))}
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
                        {i.mine ? "신청" : "대여"}
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
      {!ofJob.length && <div className="empty">대여 무기가 없어요</div>}
        </>
      )}

      {tab === "list" && picked.length > 0 && (
        <Cart
          picked={picked.map((id) => byId.get(id)).filter((i): i is RentItem => !!i)}
          now={now}
          onClear={() => setPicked([])}
          onDone={() => (setPicked([]), void load(), go("#/rent?v=apps", true))}
        />
      )}
    </>
  );
}

/** 무기 그림 칸 (+강 표) */
function Slot({ wiki, item }: { wiki: Wiki; item: RentItem }) {
  const it = weaponOf(wiki, item.weapon);
  return <span className="rent-slot">{it?.icon ? <PicImg pic={it.icon} fit={20} /> : "?"}</span>;
}

/** 줄 오른쪽 끝: 빌려 간 무기만 '대여 중' (대기와 내 차례는 펼친 칸에서, 내 신청은 왼쪽 '신청') */
function RowStatus({ item }: { item: RentItem }) {
  return item.renter ? <span className="rent-st">대여 중</span> : null;
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
            {item.renter} 대여 중{item.rentedAt ? ` · ${md(item.rentedAt)}부터` : ""}
            {item.dueAt ? ` · 기한 ${md(item.dueAt)}` : " · 기한 없음"}
            {item.dueAt && !item.queue ? " · 대기 없으면 계속" : ""}
          </>
        ) : (
          "담당자에게 있어요"
        )}
      </p>
      {/* 줄: 길드원은 수와 내 차례, 운영진은 명단 */}
      {item.queue > 0 && (
        <p className="rent-line">
          대기 {item.queue}명
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
          <ItemForm wiki={wiki} data={data} start={item} onDone={() => (setEditing(false), onDone())} />
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
    <div className="rent-bar">
      <span className="rent-next">
        내 신청 · {STATUS_NAME[m.status]} · {m.pos}번째
        {m.at ? (m.at <= Date.now() + 60_000 ? "" : ` · ${md(m.at)}부터`) : m.pos === 1 && !item.renter ? "" : " · 앞사람 반납 뒤"}
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
      {error && <p className="form-error rent-full">{error}</p>}
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
          고른 무기 <b>{picked.length}</b>
          <small>/{MAX_PICK}</small>
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
  // 대화창은 접어 두고 '대화'로 연다. 상대가 마지막으로 썼으면 '대화'를 금색으로 (운영진에게는 신청한 사람의 글, 신청한 사람에게는 운영진의 글)
  const [talkOpen, setTalkOpen] = useState(false);
  const last = app.talk[app.talk.length - 1];
  const fresh = !!last && (manage ? last.user === app.user : !data.mine.includes(last.user));
  return (
    <div className="rent-app">
      <div className="rent-app-head">
        <b>{manage ? app.user : "내 신청"}</b>
        <small>{when(app.createdAt)}</small>
        {manage && app.mileage !== undefined && <small className="rent-dia-sm">💎{app.mileage}</small>}
        <button
          className={"pill rent-talk-btn" + (talkOpen ? " pill-on" : fresh ? " rent-talk-fresh" : "")}
          onClick={() => setTalkOpen((v) => !v)}
          aria-label="대화"
          aria-expanded={talkOpen}
        >
          대화{app.talk.length ? ` ${app.talk.length}` : ""}
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
  // 아직 다른 사람이 쓰고 있으면 운영진에게는 누구에게 돌려받아야 하는지 ('춘천다크갈비 반납 뒤')
  const after = manage && !free && item?.renter ? `${item.renter} 반납 뒤` : "앞사람 반납 뒤";
  const state = r.holding
    ? `대여 중${item?.dueAt ? ` · 기한 ${md(item.dueAt)}` : ""}`
    : queued
      ? `${STATUS_NAME[r.status]} · ${r.pos}번째${r.at ? (r.at <= Date.now() + 60_000 ? "" : ` · ${md(r.at)}부터`) : free && r.pos === 1 ? "" : ` · ${after}`}`
      : r.status === "done"
        ? `건네받음${r.returnedAt ? ` · ${md(r.returnedAt)} 반납` : ""}`
        : STATUS_NAME[r.status];
  return (
    <li className="rent-req">
      {/* 왼쪽: 무기와 상태 두 줄, 오른쪽: 단추 한 줄 */}
      <div className="rent-req-info">
        <span className="rent-req-name">
          {r.weapon ?? "내려간 무기"} {r.enhance !== null ? `+${r.enhance}` : ""}
          <small>
            {r.term ? (r.term === "none" ? " 무기한" : ` ${TERM_NAME[r.term]}`) : ""} {r.price !== null ? `💎${r.price}` : ""}
          </small>
        </span>
        <span className={"rent-req-st rent-req-" + (r.holding ? "hold" : r.status)}>{state}</span>
      </div>
      {queued && (manage || app.mine) && (
        // 운영진은 단추 셋을 무기 아래 같은 폭 한 줄에 (오른쪽에 두면 무기 이름이 두 줄로 밀렸다), 신청한 사람은 '취소' 하나를 오른쪽에
        <div className={manage ? "pill-row rent-full rent-req-acts" : "rent-btns"}>
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
            </>
          ) : (
            <button className="pill" disabled={busy} onClick={() => void act("cancel")}>
              취소
            </button>
          )}
        </div>
      )}
      {handing && item && (
        <div className="rent-hand rent-full">
          <DiaStep use={use} max={Math.min(item.price, app.mileage ?? 0)} price={item.price} rate={rate} onChange={setUse} />
          <button className="pill pill-on" disabled={busy} onClick={() => void act("hand")}>
            완료
          </button>
        </div>
      )}
      {error && <p className="form-error rent-full">{error}</p>}
    </li>
  );
}

/** 마일리지에서 쓸 💎: 마일리지 − 💎2 + 골드 80만 (나머지는 골드) */
function DiaStep({ use, max, price, rate, onChange }: { use: number; max: number; price: number; rate: number; onChange: (v: number) => void }) {
  return (
    <span className="rent-step">
      <span className="rent-muted">마일리지</span>
      <button type="button" className="pill" disabled={use <= 0} onClick={() => onChange(Math.max(0, use - 1))} aria-label="마일리지 빼기">
        −
      </button>
      <b className="rent-use">💎{use}</b>
      <button type="button" className="pill" disabled={use >= max} onClick={() => onChange(Math.min(max, use + 1))} aria-label="마일리지 더하기">
        +
      </button>
      <span className="rent-muted">골드 {diaGold(price - use, rate)}</span>
    </span>
  );
}

/** 신청서 대화창 (신청한 사람과 운영진) */
function Talk({ app, onDone }: { app: RentApp; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // 열면 입력 칸이 보이게 ('대화'를 눌러야 열려서 화면을 열 때 저절로 내려가지 않는다)
  // scrollIntoView 는 요즘 크롬에서 Promise 를 돌려준다: 화살표 함수로 그대로 돌려주면 React 가 정리 함수로 불러 화면이 멈췄다 (운영 칸 바꾸기, 대화 닫기)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, []);
  // 새 글은 대화 목록 안에서만 맨 아래로
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
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
        <ul ref={list} className="rent-talk-list">
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
      {/* 한 줄: 반납·내리기는 한 번 더 묻는 동안 그 단추와 취소만 */}
      {sure === "return" ? (
        <div className="rent-btns">
          <span className="rent-muted">게임 안에서 돌려받았어요?</span>
          <button className="pill pill-on" disabled={busy} onClick={() => run(() => returnRent(item.id))}>
            반납
          </button>
          <button className="pill" onClick={() => setSure("")}>
            취소
          </button>
        </div>
      ) : sure === "remove" ? (
        <div className="rent-btns">
          <button className="pill pill-danger" disabled={busy} onClick={() => run(() => removeRent(item.id))}>
            내리기
          </button>
          <button className="pill" onClick={() => setSure("")}>
            취소
          </button>
        </div>
      ) : (
        <div className="rent-btns">
          {item.renter ? (
            <button className="pill" onClick={() => (setLending(false), setSure("return"))}>
              반납
            </button>
          ) : (
            <button className={"pill" + (lending ? " pill-on" : "")} onClick={() => setLending((v) => !v)}>
              직접 대여
            </button>
          )}
          <button className="pill" onClick={onEdit}>
            정보 수정
          </button>
          {!item.renter && (
            <button className="pill" onClick={() => (setLending(false), setSure("remove"))}>
              내리기
            </button>
          )}
        </div>
      )}
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
      <DiaStep use={use} max={item.price} price={item.price} rate={data.rate} onChange={setUse} />
      {/* 빌려 간 날과 처리 단추를 한 줄에 */}
      <div className="rent-lend">
        <label className="mk-field">
          <span>빌려 간 날 (비우면 오늘)</span>
          <input className="mk-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="pill pill-on" disabled={busy || !renter.trim()} onClick={() => onLend({ renter: renter.trim(), useDia: use, ...(date ? { date } : {}) })}>
          대여 처리
        </button>
      </div>
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

/** 물건 더하기·고치기. 기부 💎 를 적으면 기부자 마일리지에 쌓인다 (고치면 차이만, 제작자 요청 2026-11-02) */
function ItemForm({ wiki, data, start, onDone }: { wiki: Wiki; data: RentData; start: Partial<RentItem>; onDone: () => void }) {
  const [f, setF] = useState<RentFields>({
    job: start.job ?? "warrior",
    level: start.level ?? 1,
    weapon: start.weapon ?? "",
    options: start.options ?? "",
    enhance: start.enhance ?? 6,
    term: start.term ?? "none",
    price: start.price ?? 1,
    donor: start.donor ?? "",
    donorDia: start.donorDia ?? 0,
    note: start.note ?? "",
  });
  const [warning, setWarning] = useState("");
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
      else {
        const r = await addRent(f);
        if (r.warning) {
          setWarning(r.warning);
          return;
        }
      }
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-form rent-form">
      <div className="pill-row">
        {JOBS.map((j) => (
          <button key={j} type="button" className={"pill" + (f.job === j ? " pill-on" : "")} onClick={() => set("job", j)}>
            {JOB_NAME[j]}
          </button>
        ))}
      </div>
      <div className="pill-row">
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
        <Num label="가격 💎" value={f.price} min={0} max={9999} onChange={(v) => set("price", v)} />
      </div>
      <label className="mk-field">
        <span>옵션 (명6크3, 지4마11마재1)</span>
        <input className="mk-input" maxLength={30} value={f.options} onChange={(e) => set("options", e.target.value)} />
      </label>
      {/* 기부한 사람과 그 사람에게 적립할 마일리지 */}
      <div className="rent-donor">
        <label className="mk-field">
          <span>기부</span>
          <input className="mk-input" maxLength={20} value={f.donor} onChange={(e) => set("donor", e.target.value)} placeholder="닉네임" />
        </label>
        <Num label="기부 💎" value={f.donorDia} min={0} max={9999} onChange={(v) => set("donorDia", v)} />
      </div>
      {(() => {
        const q = f.donor.trim().toLowerCase();
        const hits = q ? (data.members ?? []).filter((m) => m.toLowerCase().includes(q) && m !== f.donor).slice(0, 6) : [];
        return hits.length > 0 ? (
          <div className="mk-chips">
            {hits.map((m) => (
              <button key={m} type="button" className="pill" onClick={() => set("donor", m)}>
                {m}
              </button>
            ))}
          </div>
        ) : null;
      })()}
      {f.donorDia > 0 && (
        <p className="rent-muted">
          {f.donor.trim() || "기부자"} 님 마일리지에 💎{f.donorDia}
          {start.id && start.donorDia ? ` (지금까지 💎${start.donorDia}, 차이만 적립)` : ""}
        </p>
      )}
      <label className="mk-field">
        <span>메모</span>
        <input className="mk-input" maxLength={100} value={f.note} onChange={(e) => set("note", e.target.value)} />
      </label>
      {warning && <p className="form-error">{warning}</p>}
      <div className="mk-actions">
        <button className="btn" disabled={busy || !f.weapon.trim() || (f.donorDia > 0 && !f.donor.trim())} onClick={() => void save()}>
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
      <div className="pill-row">
        <button type="button" className={"pill" + (!minus && reason === "donate" ? " pill-on" : "")} onClick={() => (setMinus(false), setReason("donate"))}>
          기부 적립
        </button>
        <button type="button" className={"pill" + (!minus && reason === "adjust" ? " pill-on" : "")} onClick={() => (setMinus(false), setReason("adjust"))}>
          고침
        </button>
        <button type="button" className={"pill" + (minus ? " pill-on" : "")} onClick={() => (setMinus(true), setReason("adjust"))}>
          차감
        </button>
      </div>
      {/* 💎 와 메모를 한 줄에 */}
      <div className="rent-mile">
        <Num label="💎" value={amount} min={1} max={9999} onChange={setAmount} />
        <label className="mk-field">
          <span>메모</span>
          <input className="mk-input" placeholder={reason === "donate" ? "기부한 장비 (+8 글라디우스)" : "까닭"} maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button className="btn" disabled={busy || !who.trim()} onClick={() => void save()}>
        {minus ? "차감" : "적립"}
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

