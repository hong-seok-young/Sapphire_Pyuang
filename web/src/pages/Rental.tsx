// 장비대여 (#/rent, 제작자 요청 2026-11-01, 2026-11-02 고침): 대여 담당 성민 님의 카카오톡 대여무기 목록을 옮겼다.
// - 목록: 직업마다 레벨별로 쭉 (레벨 머리줄 아래 얇은 줄): 위키 그림과 +강, 짧은 옵션(명중9 크리4), 기한, 💎 가격, 빌려 간 무기만 '대여 중'
//   (2026-11-02 제작자 요청: '바로' 표시와 '바로 가능' 거르기는 뺐다. 줄과 내 차례는 펼친 칸과 신청서에서).
// - 폰 화면이 작아서 단추는 한 줄에 (2026-11-02 제작자 요청 '두 줄씩 있는 거 보기 안 좋아, 콤팩트하게'): 신청서의 무기 줄은 단추를 오른쪽에,
//   확인을 묻는 동안에는 그 단추만, 대화창은 '대화'를 눌러 연다.
// - 신청: 줄 왼쪽 칸으로 여러 개 골라 한 번에 신청서로. 무기마다 선착순으로 줄을 서고, 신청 전에 '앞사람이 받은 날 + 기한 뒤' 받을 수 있는 날을 보인다.
//   줄이 없으면 기한이 지나도 계속 쓰고, 줄이 생기면 기한이 끝나는 날 담당자에게 돌려준다. 신청서마다 신청한 사람과 운영진의 대화창.
// - 운영진: 신청서마다 무기별 수락·거절, 차례가 오면 '대여 완료'(보증금: 마일리지와 골드), 반납, 대여 등록, 물건 더하기·고치기·내리기, 카톡 목록 붙여넣기, 마일리지.
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
  manGold,
  md,
  optionFull,
  optionParts,
  optionShort,
  removeRent,
  returnRent,
  talkRent,
  weaponOf,
} from "../rental";
import type { AppRequest, ImportSummary, LedgerLine, RentApp, RentData, RentFields, RentItem, RentTerm } from "../rental";
import { MARKET_PIC, itemFacts, jobsFor, rollHint } from "../market";

const REASON: Record<LedgerLine["reason"], string> = { donate: "기부", rent: "대여 보증금", adjust: "고침", return: "반납 · 보증금 돌려받음" };
/** 한 번에 고를 수 있는 무기 수 (서버 MAX_APP_ITEMS 와 같다. 제작자 요청 2026-11-02: 5개 한도를 두지 말고, 여러 개면 안내만) */
const MAX_PICK = 30;

/** '11/2 14:05' */
function when(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
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
                {i.deposit && (i.deposit.dia > 0 || i.deposit.gold > 0) && (
                  <small className="rent-muted">
                    {" "}
                    · 보증금 {[i.deposit.dia ? `💎${i.deposit.dia}` : "", i.deposit.gold ? `골드 ${manGold(i.deposit.gold)}` : ""].filter(Boolean).join(" + ")}
                  </small>
                )}
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
        // 아래 단계 단추는 위 단추 바로 아래 어두운 띠의 작은 글자 단추로 (제작자 요청 2026-11-02: 맨 위 단추와 하위 단추가 구분되게)
        <nav className="sub-tabs rent-sub">
          {(["apps", "add", "paste", "mileage"] as const).map((p) => (
            <button key={p} className={"sub-tab" + (panel === p ? " sub-tab-on" : "")} aria-pressed={panel === p} onClick={() => setPanel(p)}>
              {p === "apps" ? `신청 ${openApps.length}` : p === "add" ? "물건 추가" : p === "paste" ? "붙여넣기" : "마일리지"}
            </button>
          ))}
        </nav>
      )}
      {tab === "staff" && (
        <section className="panel rent-admin">
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
      <nav className="sub-tabs rent-sub">
        {JOBS.map((j) => (
          <button key={j} className={"sub-tab" + (job === j ? " sub-tab-on" : "")} aria-pressed={job === j} onClick={() => setJob(j)}>
            {JOB_NAME[j]}
          </button>
        ))}
      </nav>

      {levels.map((lv) => (
        <section key={lv} className="rent-lv">
          <h2 className="rent-lv-head">Lv.{lv}</h2>
          <ul className="rent-list">
            {ofJob
              .filter((i) => levelOf(wiki, i) === lv)
              .sort((a, b) => a.weapon.localeCompare(b.weapon) || a.enhance - b.enhance || TERMS.indexOf(a.term) - TERMS.indexOf(b.term) || a.price - b.price)
              .map((i) => (
                <li key={i.id} className={"rent-li" + (i.renter ? " rent-held" : "")}>
                  <div className="rent-row">
                    {/* 고르기: 신청할 수 있는 무기만 (내가 쓰거나 이미 신청한 것은 빼고) */}
                    {i.mine || (i.renter && mine.has(i.renter)) ? (
                      <span className="rent-pick rent-pick-off" aria-hidden>
                        {i.mine ? "신청" : "대여"}
                      </span>
                    ) : (
                      <button className={"rent-pick" + (picked.includes(i.id) ? " rent-pick-on" : "")} onClick={() => toggle(i.id)} aria-label="고르기" aria-pressed={picked.includes(i.id)} />
                    )}
                    <button className="rent-main" onClick={() => setOpen(i.id)}>
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
                </li>
              ))}
          </ul>
        </section>
      ))}
      {!ofJob.length && <div className="empty">대여 무기가 없어요</div>}
      {open !== null && byId.get(open) && (
        <ItemPopup
          wiki={wiki}
          item={byId.get(open)!}
          data={data}
          picked={picked.includes(open)}
          onPick={() => toggle(open)}
          onClose={() => setOpen(null)}
          onDone={() => void load()}
        />
      )}
        </>
      )}

      {tab === "list" && picked.length > 0 && (
        <Cart
          picked={picked.map((id) => byId.get(id)).filter((i): i is RentItem => !!i)}
          mileage={data.mileage}
          rate={data.rate}
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

/** 차례를 기다리면 받는 때: '11/19부터' / '앞사람 반납 뒤' (지금 받을 수 있으면 빈 글) */
function waitText(i: RentItem): string {
  if (!i.renter && !i.queue) return "";
  return i.next === null ? "앞사람 반납 뒤" : i.next <= Date.now() + 60_000 ? "" : `${md(i.next)}부터`;
}

/**
 * 무기 정보창 (제작자 요청 2026-11-02: 목록에서 무기를 누르면 게임처럼 정보창이 잠깐 뜨고, 다른 곳을 누르면 닫힌다. 줄 아래 설명은 뺐다).
 * 위키 정보(요구 레벨, 공격·속도, 이 무기의 옵션 값, 직업), 기한과 보증금, 대여 중이면 누가 언제까지, 대기, 내 신청 또는 담기, 운영진 일
 */
function ItemPopup({ wiki, item, data, picked, onPick, onClose, onDone }: {
  wiki: Wiki;
  item: RentItem;
  data: RentData;
  picked: boolean;
  onPick: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const it = weaponOf(wiki, item.weapon);
  const facts = itemFacts(it);
  const values = optionFull(item.options);
  const holding = !!item.renter && data.mine.includes(item.renter);
  return (
    <>
      <div className="rent-pop-back" onClick={onClose} />
      <div className="rent-pop" role="dialog" aria-label={`${item.weapon} +${item.enhance}`}>
        <div className="mk-tip">
          <b className="mk-tip-name rent-pop-name">
            {it?.icon && <PicImg pic={it.icon} fit={22} />}
            <span>
              {item.weapon} <em>+{item.enhance}</em>
            </span>
          </b>
          <p className="mk-tip-lv">요구 레벨 {levelOf(wiki, item)}</p>
          {facts.stats.map((s) => (
            <p key={s}>{s}</p>
          ))}
          {values.map(([n, v]) => (
            <p key={n}>
              {n} {v}
            </p>
          ))}
          {!values.length && item.options && <p>{item.options}</p>}
          {facts.options.fixed.map((f) => (
            <p key={f}>{f}</p>
          ))}
          {facts.options.sets.map((s) => (
            <p key={s} className="mk-tip-dim">
              {s}
            </p>
          ))}
          {facts.job && (
            <div className="mk-tip-jobs" aria-label={`직업 ${facts.job}`}>
              {jobsFor(facts.job).map((j) => (
                <img key={j} src={`${MARKET_PIC}job_${j}.png`} alt={JOB_NAME[j]} title={JOB_NAME[j]} />
              ))}
            </div>
          )}
        </div>
        <div className="rent-pop-info">
          <p>
            {item.term === "none" ? "기한 없음" : `기한 ${TERM_NAME[item.term]}`} · 보증금 💎{item.price} <small>(골드 {diaGold(item.price, data.rate)})</small>
          </p>
          {item.donor && <p className="rent-muted">기부 {item.donor}</p>}
          {item.renter && (
            <p>
              <b className="rent-st">대여 중</b> {item.renter}
              {item.dueAt ? ` · ${md(item.dueAt)}까지` : " · 기한 없음"}
              {item.deposit && (
                <small className="rent-muted">
                  {" "}
                  · 보증금 {[item.deposit.dia ? `💎${item.deposit.dia}` : "", item.deposit.gold ? `골드 ${manGold(item.deposit.gold)}` : ""].filter(Boolean).join(" + ") || "없음"}
                </small>
              )}
            </p>
          )}
          {/* 줄: 길드원은 수, 운영진은 명단 */}
          {item.queue > 0 && (
            <p>
              대기 {item.queue}명{waitText(item) && ` · 새 신청은 ${waitText(item)}`}
              {item.line && <small className="rent-muted"> · {item.line.map((q) => `${q.pos}. ${q.user}(${STATUS_NAME[q.status]})`).join(", ")}</small>}
            </p>
          )}
          {item.note && <p className="mk-note">{item.note}</p>}
        </div>
        {item.mine ? (
          <MyRequest item={item} onDone={onDone} />
        ) : (
          !holding && (
            <div className="pill-row">
              <button className={"pill" + (picked ? " pill-on" : "")} onClick={onPick}>
                {picked ? "담기 취소" : "신청 담기"}
              </button>
            </div>
          )
        )}
        {data.manager &&
          (editing ? (
            <ItemForm wiki={wiki} data={data} start={item} onDone={() => (setEditing(false), onDone())} />
          ) : (
            <ManagerBox item={item} data={data} onEdit={() => setEditing(true)} onDone={onDone} />
          ))}
      </div>
    </>
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

/**
 * 고른 무기 칸 (화면 아래): 무기마다 보증금(💎, 골드)과 기다리면 받는 때, 합계와 '마일리지를 다 쓰면 골드를 얼마 더' (제작자 요청 2026-11-02:
 * 마일리지 1 = 10만 골드, 보증금이라 반납하면 돌려받는다). 여러 개면 1인 1개가 원칙이라는 안내. 한마디와 함께 신청서로
 */
function Cart({ picked, mileage, rate, onClear, onDone }: { picked: RentItem[]; mileage: number; rate: number; onClear: () => void; onDone: () => void }) {
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
              <span>
                {i.term === "none" ? "무기한" : TERM_NAME[i.term]} · 💎{i.price} <small>골드 {diaGold(i.price, rate)}</small>
              </span>
              {waitText(i) && <small>{waitText(i)}</small>}
            </p>
          ))}
          {(() => {
            const total = picked.reduce((n, i) => n + i.price, 0);
            const use = Math.min(mileage, total);
            return (
              <div className="rent-cart-sum">
                <p>
                  보증금 <b>💎{total}</b> <small>= 골드 {diaGold(total, rate)}</small>
                </p>
                {/* 마일리지를 다 쓰면 골드로 얼마 더 (제작자 요청 2026-11-02) */}
                <p>
                  내 마일리지 💎{mileage}
                  {use >= total ? ` · 마일리지로 모두 내요 (남는 💎${mileage - total})` : use > 0 ? ` 다 쓰고 골드 ${diaGold(total - use, rate)} 더` : ` · 골드 ${diaGold(total, rate)}`}
                </p>
                <small className="rent-muted">보증금이라 반납하면 마일리지와 골드를 돌려받아요</small>
              </div>
            );
          })()}
          {picked.length > 1 && <p className="rent-cart-warn">1인 1개 대여가 원칙이에요. 여러 개 신청하면 담당자가 거절할 수 있어요.</p>}
          <input className="mk-input" placeholder="한마디 (마일리지 쓸 양, 받을 시간 등)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
      <div className="rent-cart-bar">
        <span>
          고른 무기 <b>{picked.length}</b>
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

/** 신청서: 무기마다 상태와 차례, 운영진의 수락·거절·대여 완료, 신청한 사람의 취소, 대화창 */
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
  const act = async (action: "accept" | "reject" | "cancel" | "hand", use = 0, gold?: number) => {
    setBusy(true);
    setError("");
    try {
      await actRequest(r.rid, action, use, gold);
      setHanding(false);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const queued = r.status === "wait" || r.status === "ok";
  // 대여 완료할 수 있는 때: 무기가 담당자에게 있을 때 (줄의 첫 사람이 아니어도 담당자 판단으로)
  const free = item && !item.renter;
  // 아직 다른 사람이 쓰고 있으면 운영진에게는 누구에게 돌려받아야 하는지 ('춘천다크갈비 반납 뒤')
  const after = manage && !free && item?.renter ? `${item.renter} 반납 뒤` : "앞사람 반납 뒤";
  const state = r.holding
    ? `대여 중${item?.dueAt ? ` · 기한 ${md(item.dueAt)}` : ""}`
    : queued
      ? `${STATUS_NAME[r.status]} · ${r.pos}번째${r.at ? (r.at <= Date.now() + 60_000 ? "" : ` · ${md(r.at)}부터`) : free && r.pos === 1 ? "" : ` · ${after}`}`
      : r.status === "done"
        ? `대여 완료${r.returnedAt ? ` · ${md(r.returnedAt)} 반납` : ""}`
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
                대여 완료
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
          <DepositForm price={item.price} mileage={app.mileage ?? 0} rate={rate} busy={busy} label="대여 완료" onSave={(use, gold) => void act("hand", use, gold)} />
        </div>
      )}
      {error && <p className="form-error rent-full">{error}</p>}
    </li>
  );
}

/**
 * 보증금 받기 (대여 완료, 대여 등록): 마일리지에서 쓸 💎 (− +) 와 받은 골드(만). 골드는 처음에 '가격에서 마일리지를 뺀 나머지'로 채우고
 * 고칠 수 있다 (제작자 요청 2026-11-02: 마일리지만 뜨고 골드를 입력 못 했다. 마일리지 1 = 10만 골드, 보증금이라 반납하면 돌려준다)
 */
function DepositForm({ price, mileage, rate, busy, label, onSave }: {
  price: number;
  mileage: number;
  rate: number;
  busy: boolean;
  label: string;
  onSave: (useDia: number, gold: number) => void;
}) {
  const max = Math.min(price, mileage);
  const [use, setUse] = useState(0);
  // 골드는 만 단위로 적는다. 손대기 전에는 나머지를 따라간다
  const rest = ((price - use) * rate) / 10_000;
  const [man, setMan] = useState<string | null>(null);
  const goldMan = man === null ? rest : Number(man) || 0;
  return (
    <div className="rent-deposit">
      <p className="rent-muted">
        보증금 💎{price} <small>= 골드 {diaGold(price, rate)}</small>
        {mileage > 0 && <small> · 마일리지 💎{mileage}</small>}
      </p>
      <div className="rent-deposit-row">
        <span className="rent-step">
          <span className="rent-muted">마일리지</span>
          <button type="button" className="pill" disabled={use <= 0} onClick={() => setUse(Math.max(0, use - 1))} aria-label="마일리지 빼기">
            −
          </button>
          <b className="rent-use">💎{use}</b>
          <button type="button" className="pill" disabled={use >= max} onClick={() => setUse(Math.min(max, use + 1))} aria-label="마일리지 더하기">
            +
          </button>
        </span>
        <label className="rent-gold">
          <span className="rent-muted">골드</span>
          <input className="mk-input" inputMode="numeric" value={man ?? String(rest)} onChange={(e) => setMan(e.target.value.replace(/\D/g, "").slice(0, 7))} aria-label="받은 골드 (만)" />
          <span className="rent-muted">만</span>
        </label>
      </div>
      <div className="pill-row">
        <button className="pill pill-on" disabled={busy} onClick={() => onSave(use, goldMan * 10_000)}>
          {label}
        </button>
      </div>
    </div>
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

/** 운영진: 대여 등록, 반납, 고치기, 내리기 (신청서의 수락·대여 완료은 '운영 > 신청') */
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
        // 반납: 받은 보증금을 돌려준다 (마일리지는 장부로 저절로, 골드는 게임 안에서)
        <div className="rent-return">
          <p className="rent-muted">
            게임 안에서 돌려받았어요?
            {item.deposit && (item.deposit.dia > 0 || item.deposit.gold > 0) && (
              <>
                {" "}
                보증금 돌려주기: {[item.deposit.dia ? `마일리지 💎${item.deposit.dia} (저절로)` : "", item.deposit.gold ? `골드 ${manGold(item.deposit.gold)} (게임 안에서)` : ""].filter(Boolean).join(" · ")}
              </>
            )}
          </p>
          <div className="pill-row">
            <button className="pill pill-on" disabled={busy} onClick={() => run(() => returnRent(item.id))}>
              반납
            </button>
            <button className="pill" onClick={() => setSure("")}>
              취소
            </button>
          </div>
        </div>
      ) : sure === "remove" ? (
        <div className="pill-row">
          <button className="pill pill-danger" disabled={busy} onClick={() => run(() => removeRent(item.id))}>
            내리기
          </button>
          <button className="pill" onClick={() => setSure("")}>
            취소
          </button>
        </div>
      ) : (
        <div className="pill-row">
          {item.renter ? (
            <button className="pill" onClick={() => (setLending(false), setSure("return"))}>
              반납
            </button>
          ) : (
            // 대여 등록: 카톡 등 앱 밖에서 받은 신청을 운영진이 적는다 (예전 이름 '직접 대여', 제작자: '직접 대여는 뭔 말임')
            <button className={"pill" + (lending ? " pill-on" : "")} onClick={() => setLending((v) => !v)}>
              대여 등록
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

/** 대여 등록: 카톡 등 앱 밖 신청을 닉네임으로 적는다 (보증금 마일리지와 골드, 빌려 간 날을 고르면 그날 빌려 간 것으로) */
function LendForm({ item, data, busy, onLend }: {
  item: RentItem;
  data: RentData;
  busy: boolean;
  onLend: (b: { renter: string; useDia: number; gold: number; date?: string }) => void;
}) {
  const [renter, setRenter] = useState("");
  const [date, setDate] = useState("");
  const who = (data.balances ?? []).find((b) => b.person === renter.trim());
  return (
    <div className="rent-ask">
      <NameInput value={renter} onChange={setRenter} members={data.members ?? []} placeholder="빌려 갈 사람 닉네임" />
      <label className="mk-field">
        <span>빌려 간 날 (비우면 오늘)</span>
        <input className="mk-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <DepositForm
        key={renter.trim()}
        price={item.price}
        mileage={who?.dia ?? 0}
        rate={data.rate}
        busy={busy || !renter.trim()}
        label="대여 등록"
        onSave={(useDia, gold) => onLend({ renter: renter.trim(), useDia, gold, ...(date ? { date } : {}) })}
      />
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
  // 위키 무기면 그 무기에 뜰 수 있는 옵션(명중 0~6, 크리티컬 0~5 …)을 칸으로 보이고 값만 적게 한다 (제작자 요청 2026-11-02: 아이템 자료 연동, 옵션 자동완성)
  const rolls = itemFacts(weaponOf(wiki, f.weapon)).options.rolls;
  const values = new Map(optionFull(f.options));
  const setRoll = (name: string, v: number) =>
    set(
      "options",
      optionShort(rolls.map((r) => [r.name, r.name === name ? v : (values.get(r.name) ?? 0)] as [string, number])),
    );
  /** 위키에서 무기를 고르면 레벨을 채우고 옵션은 그 무기 것으로 비운다 */
  const pickWeapon = (name: string, level: number) => setF((cur) => ({ ...cur, weapon: name, level, options: "" }));
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
        <input
          className="mk-input"
          maxLength={30}
          value={f.weapon}
          onChange={(e) => {
            // 위키 무기 이름을 다 적으면 고른 것과 같게 레벨을 채운다
            const exact = weapons.find((w) => w.name === e.target.value.trim());
            if (exact) pickWeapon(exact.name, exact.level);
            else set("weapon", e.target.value);
          }}
        />
      </label>
      {hits.length > 0 && (
        <div className="mk-chips">
          {hits.map((w) => (
            <button
              key={w.name}
              type="button"
              className="pill"
              onClick={() => pickWeapon(w.name, w.level)}
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
      {rolls.length > 0 ? (
        // 위키 무기: 옵션마다 값 칸 (범위는 이름 옆에, 0 이면 없음)
        <div className="rent-rolls">
          {rolls.map((r) => (
            <Num
              key={r.name}
              label={
                <>
                  {r.name} <small>{rollHint(r)}</small>
                </>
              }
              value={values.get(r.name) ?? 0}
              min={0}
              max={999}
              onChange={(v) => setRoll(r.name, v)}
            />
          ))}
        </div>
      ) : (
        <label className="mk-field">
          <span>옵션 (명6크3, 지4마11마재1)</span>
          <input className="mk-input" maxLength={30} value={f.options} onChange={(e) => set("options", e.target.value)} />
        </label>
      )}
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

