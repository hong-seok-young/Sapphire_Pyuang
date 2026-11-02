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
// 실제 주고받기는 게임 안에서. 2026-11-02 길드원에게 열었다. 운영은 길드마스터·대여 담당(멍멍)·앱개발자 (server/rental.ts isManager)
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { go, useEntryState } from "../router";
import { JOBS, JOB_NAME, errorText } from "../auth";
import type { Job, Me } from "../auth";
import type { Wiki } from "../types";
import { FitLine, Loading, NewsDot, PicImg, TopBar } from "../ui";
import { useNews, useNewsSeen } from "../news";
import {
  STATUS_NAME,
  MAX_WEEKS,
  jobsOf,
  jobsText,
  wikiJobs,
  termName,
  termWeeks,
  actRequest,
  addMileage,
  addRent,
  applyRent,
  deleteMileageLine,
  deleteRentLog,
  diaGold,
  editRent,
  fetchMileage,
  fetchRent,
  fetchRentLog,
  lendRent,
  levelOf,
  manGold,
  md,
  optionFull,
  optionParts,
  optionShort,
  removeRent,
  requestReturn,
  returnRent,
  talkRent,
  weaponOf,
} from "../rental";
import type { AppRequest, LedgerLine, RentApp, RentData, RentFields, RentItem, RentLogRow, RentTerm } from "../rental";
import { MARKET_PIC, itemFacts, rollHint } from "../market";
import { readShot, shrinkShot } from "../shot";
import { KakaoButton, useKakao } from "../kakao";

const REASON: Record<LedgerLine["reason"], string> = { donate: "기부", rent: "대여 보증금", adjust: "고침", return: "반납 · 보증금 돌려받음" };
/** 한 번에 고를 수 있는 무기 수 (서버 MAX_APP_ITEMS 와 같다. 제작자 요청 2026-11-02: 5개 한도를 두지 말고, 여러 개면 안내만) */
const MAX_PICK = 30;

/** '11/2 14:05' */
function when(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}


/** 운영의 아래 칸: 장비대여(신청) · 장비반납 · 물건 추가 · 기부 현황 */
type Panel = "apps" | "back" | "add" | "mileage";
const PANELS: Panel[] = ["apps", "back", "add", "mileage"];

export function RentalPage({ wiki, me, view }: { wiki: Wiki; me: Me; view: string }) {
  const [data, setData] = useState<RentData | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useEntryState<Job>("job", me.job ?? "warrior");
  const [open, setOpen] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [panelRaw, setPanel] = useEntryState<Panel>("panel", "apps");
  // 예전에 고른 칸('paste' 등)이 남아 있으면 처음 칸으로
  const panel: Panel = PANELS.includes(panelRaw) ? panelRaw : "apps";
  // 새 것 수 (news.ts, 제작자 요청 2026-11-02: 장비대여에 숫자 -> 안에서 목록·신청함·운영 어디에 새로 생겼는지). 보고 있는 칸은 본 것으로
  const news = useNews();
  useNewsSeen([view === "apps" ? "rent.apps" : view === "staff" ? "rent.staff" : "rent.list"]);
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
  // 빌려 간 무기 (장비반납 칸): 기한이 먼저 끝나는 것부터, 기한 없는 것은 뒤로
  // 반납 신청한 것이 맨 위 (제작자 요청 2026-11-02: 장비 반납도 신청하게)
  const lent = data.items
    .filter((i) => i.renter)
    .sort((a, b) => Number(!a.returnReqAt) - Number(!b.returnReqAt) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || (a.rentedAt ?? 0) - (b.rentedAt ?? 0));
  const backAsked = lent.filter((i) => i.returnReqAt).length;
  const waitCount = openApps.reduce((n, a) => n + a.requests.filter((r) => r.status === "wait").length, 0);
  // 공용이거나 여러 직업인 물건은 그 직업 칸마다 보인다
  const ofJob = data.items.filter((i) => jobsOf(i.job).includes(job));
  // 레벨별로 쭉 (같은 레벨 안에서는 무기, 강화, 기한 순서)
  const levels = [...new Set(ofJob.map((i) => levelOf(wiki, i)))].sort((a, b) => a - b);
  const toggle = (id: number) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PICK ? cur : [...cur, id]));

  const tab = view === "apps" || ((view === "staff" || view === "log") && data.manager) ? view : "list";
  const views: { key: string; name: string; to: string; badge?: number }[] = [
    { key: "list", name: "목록", to: "#/rent", badge: news["rent.list"] },
    { key: "apps", name: myApps.length ? `신청함 ${myApps.length}` : "신청함", to: "#/rent?v=apps", badge: news["rent.apps"] },
    // 운영: 확인 전 신청 수 (없으면 새 대화 같은 새 것 수)
    ...(data.manager ? [{ key: "staff", name: "운영", to: "#/rent?v=staff", badge: waitCount || news["rent.staff"] }] : []),
    // 운영 오른쪽에 기록: 누가 언제 대여하고 반납했는지 (제작자 요청 2026-11-02)
    ...(data.manager ? [{ key: "log", name: "기록", to: "#/rent?v=log" }] : []),
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
          <StaffKakao />
          {showLedger && <Ledger lines={data.ledger} rate={data.rate} />}
          {/* 쓰는 무기: 줄이 있으면 기한이 끝나는 날 담당자에게 반납, 없으면 계속 쓴다 */}
          {myHeld.map((i) => (
            <HeldLine key={i.id} item={i} now={now} apps={data.apps} onDone={() => void load()} />
          ))}
          {myApps.map((a) => (
            <AppCard key={a.id} app={a} data={data} byId={byId} onDone={() => void load()} />
          ))}
          {!myHeld.length && !myApps.length && <p className="rent-muted">신청한 무기가 없어요</p>}
        </section>
      )}

      {/* 운영: 장비대여(신청 관리), 장비반납(빌려 간 무기), 물건 추가, 기부 현황 */}
      {tab === "staff" && (
        // 아래 단계 단추는 위 단추 바로 아래 어두운 띠의 작은 글자 단추로 (제작자 요청 2026-11-02: 맨 위 단추와 하위 단추가 구분되게)
        <nav className="sub-tabs rent-sub">
          {/* 카톡 목록 붙여넣기는 뺐다 (제작자 요청 2026-11-02: '이걸로 운영할 거임, 카톡으로 안 함').
              '신청'은 '장비대여'로, 그 오른쪽에 '장비반납', '마일리지'는 '기부 현황'으로 (제작자 요청 2026-11-02) */}
          {PANELS.map((p) => (
            <button key={p} className={"sub-tab" + (panel === p ? " sub-tab-on" : "")} aria-pressed={panel === p} onClick={() => setPanel(p)}>
              {p === "apps" ? `장비대여 ${openApps.length}` : p === "back" ? `장비반납 ${lent.length}` : p === "add" ? "물건 추가" : "기부 현황"}
              {p === "back" && <NewsDot n={backAsked} />}
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
          {panel === "back" &&
            (lent.length ? (
              <ul className="rent-backs">
                {lent.map((i) => (
                  <ReturnRow key={i.id} wiki={wiki} item={i} apps={data.apps} onDone={() => void load()} />
                ))}
              </ul>
            ) : (
              <p className="rent-muted">빌려 간 무기가 없어요</p>
            ))}
          {panel === "add" && <ItemForm wiki={wiki} data={data} start={{ job }} onDone={() => (setPanel("apps"), void load())} />}
          {panel === "mileage" && <DonationPanel wiki={wiki} data={data} onDone={() => void load()} />}
        </section>
      )}
      {tab === "log" && (
        <section className="panel rent-admin">
          <RentLog wiki={wiki} />
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
              .sort((a, b) => a.weapon.localeCompare(b.weapon) || a.enhance - b.enhance || (termWeeks(b.term) ?? 999) - (termWeeks(a.term) ?? 999) || a.price - b.price)
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
                      {/* 기한 없는 것은 표시 없이, 기한이 있으면 '3주' (2주 이하는 붉게) */}
                      {i.term !== "none" && <span className={"rent-tg" + ((termWeeks(i.term) ?? 99) <= 2 ? " rent-tg-short" : " rent-tg-long")}>{termName(i.term)}</span>}
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
function Slot({ wiki, item }: { wiki: Wiki; item: { weapon: string } }) {
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
          {/* 직업 그림: 운영진이 물건 추가에서 고른 직업 (공용이면 넷 다) */}
          {jobsOf(item.job).length > 0 && (
            <div className="mk-tip-jobs" aria-label={`직업 ${jobsText(item.job)}`}>
              {jobsOf(item.job).map((j) => (
                <img key={j} src={`${MARKET_PIC}job_${j}.png`} alt={JOB_NAME[j]} title={JOB_NAME[j]} />
              ))}
            </div>
          )}
        </div>
        <div className="rent-pop-info">
          <p>
            {item.term === "none" ? "기한 없음" : `기한 ${termName(item.term)}`} · 보증금 💎{item.price} <small>(골드 {diaGold(item.price, data.rate)})</small>
          </p>
          {item.donor && <p className="rent-muted">기부 {item.donor}</p>}
          {item.renter && (
            <p>
              <b className="rent-st">대여 중</b> {item.renter} <KakaoButton name={item.renter} />
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
              {item.line && (
                <small className="rent-muted">
                  {item.line.map((q, i) => (
                    <Fragment key={q.pos + q.user}>
                      {i === 0 ? " · " : ", "}
                      {`${q.pos}. ${q.user}(${STATUS_NAME[q.status]})`} <KakaoButton name={q.user} />
                    </Fragment>
                  ))}
                </small>
              )}
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
                {i.term === "none" ? "무기한" : termName(i.term)} · 💎{i.price} <small>골드 {diaGold(i.price, rate)}</small>
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
        {manage && <KakaoButton name={app.user} />}
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
            {r.term ? (r.term === "none" ? " 무기한" : ` ${termName(r.term)}`) : ""} {r.price !== null ? `💎${r.price}` : ""}
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
              <b>{t.user}</b> <KakaoButton name={t.user} /> <small>{when(t.at)}</small>
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
    job: jobsOf(start.job).length ? jobsOf(start.job) : ["warrior"],
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
  const [reading, setReading] = useState(false);
  const set = <K extends keyof RentFields>(k: K, v: RentFields[K]) => setF((cur) => ({ ...cur, [k]: v }));
  // 직업은 여럿 고를 수 있고 넷 다면 공용 (제작자 요청 2026-11-02: '아이템 공용일 수도 있음, 직업도 전·렌 이렇게 할 수도'). 하나는 남긴다
  const common = f.job.length === JOBS.length;
  // 공용을 다시 누르면 처음 직업으로 (처음부터 공용이었으면 전사)
  const startJobs: Job[] = jobsOf(start.job).length && jobsOf(start.job).length < JOBS.length ? jobsOf(start.job) : ["warrior"];
  const toggleJob = (j: Job) =>
    setF((cur) => {
      if (!cur.job.includes(j)) return { ...cur, job: JOBS.filter((x) => x === j || cur.job.includes(x)) };
      return cur.job.length > 1 ? { ...cur, job: cur.job.filter((x) => x !== j) } : cur;
    });
  // 대여 중인 물건은 반납 기한도 여기서 고친다 (제작자 요청 2026-11-02: 기한을 조정하는 곳이 없다). 기한 칸을 바꾸면 빌린 날 + 기한으로 다시 맞춘다
  const rentedAt = start.renter ? (start.rentedAt ?? null) : null;
  const [due, setDue] = useState<number | null>(start.dueAt ?? null);
  const DAY = 86_400_000;
  const setTerm = (t: RentTerm) => {
    set("term", t);
    const w = termWeeks(t);
    if (rentedAt !== null) setDue(w === null ? null : rentedAt + w * 7 * DAY);
  };
  // 기한은 '기한 없음' 또는 1~52주 (제작자 요청 2026-11-02: '3주 할 수도 있고 5주 할 수도 있잖아, 뭐 저렇게 고정을 함'). 기한 없음일 때 −/+ 를 누르면 그 주로 돌아온다
  const [weeks, setWeeks] = useState(termWeeks(start.term) ?? 4);
  const stepWeeks = (d: number) => {
    const w = termWeeks(f.term) === null ? weeks : Math.min(MAX_WEEKS, Math.max(1, weeks + d));
    setWeeks(w);
    setTerm(`${w}w`);
  };
  const moveDue = (days: number) => setDue((d) => (d === null ? null : Math.max((rentedAt ?? 0) + DAY, d + days * DAY)));
  /**
   * 무기 스샷으로 칸 채우기 (제작자 요청 2026-11-02: 데이터에 없는 장비를 넣을 때). 운영진이 갤러리에서 고른 스샷을 읽어 직업, 무기, 레벨, +강, 옵션을 채운다.
   * 위키 무기면 레벨과 직업은 위키 값으로. 채운 뒤 사람이 보고 고친다
   */
  async function pickShot(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      const r = await readShot("rental", await shrinkShot(file));
      const it = r.name ? weaponOf(wiki, r.name) : undefined;
      // 위키 장비면 위키의 직업 (무기는 그 직업, 방어구·장신구는 '직업' 칸), 아니면 AI 가 읽은 직업 (공용이면 넷 다)
      const slotJobs = it ? wikiJobs(it) : [];
      const readJobs = r.job === "공용" ? [...JOBS] : JOBS.filter((j) => JOB_NAME[j] === r.job);
      const wikiLv = Number(it?.equip?.[0]?.info["레벨제한"]) || null;
      setF((cur) => ({
        ...cur,
        job: slotJobs.length ? slotJobs : readJobs.length ? readJobs : cur.job,
        weapon: it?.name ?? r.name ?? cur.weapon,
        level: wikiLv ?? r.level ?? cur.level,
        enhance: r.enhance ?? cur.enhance,
        options: r.options.length ? optionShort(r.options.map((o) => [o.name, o.value] as [string, number])) : cur.options,
      }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReading(false);
    }
  }
  // 고른 직업이 쓰는 위키 장비 (무기는 그 직업 것, 방어구·장신구는 고른 직업이 모두 쓸 수 있는 것. 이름을 누르면 레벨도 위키 값으로)
  const weapons = useMemo(
    () =>
      Object.values(wiki.items)
        .filter((it) => {
          const js = wikiJobs(it);
          return it.equip?.some((e) => e.slot.endsWith(" 무기")) ? js.some((j) => f.job.includes(j)) : js.length > 0 && f.job.every((j) => js.includes(j));
        })
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
      if (start.id) await editRent(start.id, f, rentedAt !== null ? due : undefined);
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
          <button key={j} type="button" className={"pill" + (f.job.includes(j) ? " pill-on" : "")} aria-pressed={f.job.includes(j)} onClick={() => toggleJob(j)}>
            {JOB_NAME[j]}
          </button>
        ))}
        <button type="button" className={"pill" + (common ? " pill-on" : "")} aria-pressed={common} onClick={() => set("job", common ? startJobs : [...JOBS])}>
          공용
        </button>
      </div>
      {/* 기한 (제작자 요청 2026-11-02: 무엇을 고르는 단추인지 이름을 붙였다) */}
      <div className="mk-field">
        <span className="rent-field-head">대여 기한</span>
        <div className="rent-term">
          <button type="button" className={"pill" + (f.term === "none" ? " pill-on" : "")} onClick={() => setTerm("none")}>
            기한 없음
          </button>
          <div className="rent-weeks">
            <button type="button" className="pill" onClick={() => stepWeeks(-1)} disabled={f.term !== "none" && weeks <= 1} aria-label="1주 줄이기">
              −
            </button>
            <button type="button" className={"pill" + (f.term !== "none" ? " pill-on" : "")} onClick={() => setTerm(`${weeks}w`)}>
              {weeks}주
            </button>
            <button type="button" className="pill" onClick={() => stepWeeks(1)} disabled={f.term !== "none" && weeks >= MAX_WEEKS} aria-label="1주 늘리기">
              +
            </button>
          </div>
        </div>
      </div>
      {rentedAt !== null && (
        <div className="mk-field">
          <span className="rent-field-head">
            반납 기한 · {start.renter} {md(rentedAt)} 대여
          </span>
          <div className="rent-due">
            <b>{due === null ? "기한 없음" : md(due)}</b>
            {due !== null && (
              <>
                <button type="button" className="pill" onClick={() => moveDue(-7)}>
                  −1주
                </button>
                <button type="button" className="pill" onClick={() => moveDue(-1)}>
                  −1일
                </button>
                <button type="button" className="pill" onClick={() => moveDue(1)}>
                  +1일
                </button>
                <button type="button" className="pill" onClick={() => moveDue(7)}>
                  +1주
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* 무기 칸 머리 오른쪽에 작은 '스샷' (데이터에 없는 장비를 넣을 때 칸을 채운다) */}
      <div className="mk-field">
        <span className="rent-field-head">
          무기
          <label className={"pill rent-shot" + (reading ? " pill-off" : "")}>
            {reading ? "읽는 중…" : "스샷"}
            <input type="file" accept="image/*" hidden disabled={reading} onChange={(e) => (void pickShot(e.target.files?.[0]), (e.target.value = ""))} />
          </label>
        </span>
        <input
          className="mk-input"
          maxLength={30}
          aria-label="무기"
          value={f.weapon}
          onChange={(e) => {
            // 위키 무기 이름을 다 적으면 고른 것과 같게 레벨을 채운다
            const exact = weapons.find((w) => w.name === e.target.value.trim());
            if (exact) pickWeapon(exact.name, exact.level);
            else set("weapon", e.target.value);
          }}
        />
      </div>
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

/**
 * 숫자 칸. 고치는 동안은 적은 글자 그대로 두어 지우고 새로 적을 수 있다 (2026-11-02: 차감 💎 의 1 이 안 지워졌다. 비우면 바로 최소값으로 돌아갔다).
 * 칸을 벗어나면 범위에 맞춘 값을 보인다. 누르면 전체가 골라져 바로 새로 적는다
 */
function Num({ label, value, min, max, onChange }: { label: ReactNode; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="mk-field">
      <span>{label}</span>
      <input
        className="mk-input"
        inputMode="numeric"
        value={text ?? String(value)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, "").slice(0, String(max).length);
          setText(t);
          if (t !== "") onChange(Math.min(max, Math.max(min, Number(t))));
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

/** 신청함 맨 위: 링크를 적어 둔 장비대여 담당(길드마스터, server/rental.ts RENT_STAFF)에게 바로 카톡 (제작자 요청 2026-11-02, 앱 안 대화와 같이) */
function StaffKakao() {
  const { staff } = useKakao();
  if (!staff.length) return null;
  return (
    <p className="rent-kakao">
      <small className="rent-muted">담당자 카톡</small>
      {staff.map((s) => (
        <KakaoButton key={s} name={s} label={s} />
      ))}
    </p>
  );
}

/**
 * 신청함의 내가 쓰는 무기 한 줄: 기한, 보증금, 그리고 '반납 신청' (제작자 요청 2026-11-02: 장비 반납도 신청하게).
 * 신청하면 운영진에게 알림이 가고 '운영 > 장비반납' 맨 위에 보인다. 게임 안에서 돌려준 뒤 담당자가 '반납'을 누르면 끝난다
 */
function HeldLine({ item: i, now, apps, onDone }: { item: RentItem; now: number; apps: RentApp[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 반납 신청: 언제 돌려줄 수 있는지 한마디(안 적어도 된다)를 적고 신청하면 대화창 첫 줄로 (제작자 요청 2026-11-02: 신청하고 나서 언제 할지 정하게)
  const [asking, setAsking] = useState(false);
  const [when, setWhen] = useState("");
  const [talkOpen, setTalkOpen] = useState(false);
  const app = i.returnAppId ? apps.find((a) => a.id === i.returnAppId) : undefined;
  const ask = async (cancel: boolean) => {
    setBusy(true);
    setError("");
    try {
      await requestReturn(i.id, cancel ? { cancel: true } : { when: when.trim() });
      setAsking(false);
      setWhen("");
      if (!cancel) setTalkOpen(true);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rent-held">
      <div className="rent-me-line">
        <span>
          {i.weapon} +{i.enhance} <small className="rent-muted">대여 중</small>
          {i.deposit && (i.deposit.dia > 0 || i.deposit.gold > 0) && (
            <small className="rent-muted">
              {" "}
              · 보증금 {[i.deposit.dia ? `💎${i.deposit.dia}` : "", i.deposit.gold ? `골드 ${manGold(i.deposit.gold)}` : ""].filter(Boolean).join(" + ")}
            </small>
          )}
          <br />
          {!i.dueAt ? (
            <small className="rent-muted">기한 없음</small>
          ) : i.queue ? (
            <small className={i.dueAt < now ? "rent-late" : "rent-warn"}>
              {md(i.dueAt)} 반납 · 대기 {i.queue}
            </small>
          ) : (
            <small className="rent-muted">기한 {md(i.dueAt)} · 대기 없음</small>
          )}
        </span>
        {i.returnReqAt ? (
          <span className="rent-btns">
            <small className="rent-back-asked">반납 신청함</small>
            {app && (
              <button className={"pill" + (talkOpen ? " pill-on" : "")} onClick={() => setTalkOpen((v) => !v)}>
                대화
              </button>
            )}
            <button className="pill" disabled={busy} onClick={() => void ask(true)}>
              취소
            </button>
          </span>
        ) : (
          !asking && (
            <button className="pill" disabled={busy} onClick={() => setAsking(true)}>
              반납 신청
            </button>
          )
        )}
      </div>
      {asking && !i.returnReqAt && (
        <div className="rent-ask">
          <input className="mk-input" maxLength={40} value={when} onChange={(e) => setWhen(e.target.value)} placeholder="언제 드릴까요? (예: 오늘 밤 10시)" aria-label="반납할 때" />
          <button className="pill pill-on" disabled={busy} onClick={() => void ask(false)}>
            신청
          </button>
          <button className="pill" onClick={() => (setAsking(false), setWhen(""))}>
            취소
          </button>
        </div>
      )}
      {talkOpen && app && <Talk app={app} onDone={onDone} />}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/**
 * 장비반납 칸의 한 줄 (제작자 요청 2026-11-02: '대여 완료를 눌렀으면 장비 반납 단추를'): 무기, 빌려 간 사람, 빌린 날, 기한(지나면 빨강),
 * 받은 보증금, 대기. '반납'은 한 번 더 묻고, 쓴 마일리지는 저절로 돌려주고 골드는 게임 안에서 돌려준다
 */
function ReturnRow({ wiki, item, apps, onDone }: { wiki: Wiki; item: RentItem; apps: RentApp[]; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  // 반납 날짜를 정하는 대화창 (빌린 사람이 반납 신청하면 생긴다)
  const [talkOpen, setTalkOpen] = useState(false);
  const app = item.returnAppId ? apps.find((a) => a.id === item.returnAppId) : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const late = item.dueAt !== null && item.dueAt < Date.now();
  const deposit = item.deposit ? [item.deposit.dia ? `💎${item.deposit.dia}` : "", item.deposit.gold ? `골드 ${manGold(item.deposit.gold)}` : ""].filter(Boolean).join(" + ") : "";
  const back = async () => {
    setBusy(true);
    setError("");
    try {
      await returnRent(item.id);
      setSure(false);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={"rent-back" + (late ? " rent-back-late" : "") + (item.returnReqAt ? " rent-back-ask" : "")}>
      <div className="rent-back-top">
        <Slot wiki={wiki} item={item} />
        <span className="rent-nm">
          {item.weapon}
          <em>+{item.enhance}</em>
        </span>
        {/* 빌린 사람과 단추는 한 묶음: 폰 폭에서 자리가 모자라면 묶음째 다음 줄 오른쪽으로 (제작자 2026-11-02: 화면 폭을 넘었다) */}
        <span className="rent-back-side">
          <b className="rent-back-who">{item.renter}</b>
          <KakaoButton name={item.renter} />
          {!sure && (
            <span className="rent-back-acts">
              {app && (
                <button className={"pill" + (talkOpen ? " pill-on" : "")} onClick={() => setTalkOpen((v) => !v)}>
                  대화
                </button>
              )}
              <button className="pill" onClick={() => setSure(true)}>
                반납
              </button>
            </span>
          )}
        </span>
      </div>
      <p className="rent-back-info">
        {item.returnReqAt && <small className="rent-back-asked">반납 신청</small>} 
        {item.rentedAt ? `${md(item.rentedAt)} 대여` : "대여 중"}
        {" · "}
        {item.dueAt ? <span className={late ? "rent-late" : ""}>기한 {md(item.dueAt)}{late ? " 지남" : ""}</span> : "기한 없음"}
        {item.queue > 0 && ` · 대기 ${item.queue}`}
        {deposit && ` · 보증금 ${deposit}`}
      </p>
      {talkOpen && app && <Talk app={app} onDone={onDone} />}
      {sure && (
        <div className="rent-return">
          <p className="rent-muted">
            게임 안에서 돌려받았어요?
            {deposit && ` 보증금 돌려주기: ${[item.deposit?.dia ? `마일리지 💎${item.deposit.dia} (저절로)` : "", item.deposit?.gold ? `골드 ${manGold(item.deposit.gold)} (게임 안에서)` : ""].filter(Boolean).join(" · ")}`}
          </p>
          <div className="pill-row">
            <button className="pill pill-on" disabled={busy} onClick={() => void back()}>
              반납
            </button>
            <button className="pill" onClick={() => setSure(false)}>
              취소
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </li>
  );
}

/**
 * 기부 현황 (제작자 요청 2026-11-02: '마일리지가 아니라 기부 현황으로, 기부 현황을 보는 게 메인'): 위에 모두의 합, 사람마다 한 줄
 * (기부 건수, 기부로 적립한 💎, 남은 💎). 줄을 누르면 기부한 무기와 장부, 그 사람의 적립·고침·차감. '기부 적립'은 칸을 열어서
 */
function DonationPanel({ wiki, data, onDone }: { wiki: Wiki; data: RentData; onDone: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<{ who: string; mileage: number; ledger: LedgerLine[] } | null>(null);
  const [form, setForm] = useState<{ who: string; mode: DonationMode } | null>(null);
  const [error, setError] = useState("");
  const donors = data.balances ?? [];
  const show = async (name: string) => {
    setError("");
    try {
      setView(await fetchMileage(name));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggle = (name: string) => {
    if (open === name) return setOpen(null);
    setOpen(name);
    setView(null);
    void show(name);
  };
  const donated = donors.reduce((n, b) => n + Math.max(0, b.donated ?? 0), 0);
  const left = donors.reduce((n, b) => n + b.dia, 0);
  return (
    <div className="rent-don">
      <div className="rent-don-head">
        <span>
          기부 <b>{donors.filter((b) => b.count > 0).length}</b>명 · 적립 <b>💎{donated}</b> · 남은 <b>💎{left}</b>
        </span>
        <button className={"pill" + (form && !form.who ? " pill-on" : "")} onClick={() => setForm(form && !form.who ? null : { who: "", mode: "donate" })}>
          기부 적립
        </button>
      </div>
      {form && !form.who && (
        <DonationForm wiki={wiki} data={data} start={form} onClose={() => setForm(null)} onDone={(who) => (setForm(null), onDone(), setOpen(who), void show(who))} />
      )}
      {error && <p className="form-error">{error}</p>}
      <ul className="rent-don-list">
        {donors.map((b) => {
          const items = data.items.filter((i) => i.donor === b.person);
          return (
            <li key={b.person} className={open === b.person ? "rent-don-open" : ""}>
              <button className="rent-don-row" onClick={() => toggle(b.person)} aria-expanded={open === b.person}>
                <span className="rent-don-name">
                  {b.person} <KakaoButton name={b.person} nested />
                </span>
                <small>
                  기부 {b.count ?? 0}건 · 적립 💎{Math.max(0, b.donated ?? 0)}
                </small>
                <b className="rent-don-left">💎{b.dia}</b>
              </button>
              {open === b.person && (
                <div className="rent-don-detail">
                  {items.length > 0 && (
                    <p className="rent-don-items">
                      {items.map((i) => (
                        <span key={i.id} className="rent-don-item">
                          <Slot wiki={wiki} item={i} />
                          {i.weapon} +{i.enhance}
                        </span>
                      ))}
                    </p>
                  )}
                  {view?.who === b.person ? (
                    <Ledger
                      lines={view.ledger}
                      rate={data.rate}
                      onDelete={async (id) => {
                        setError("");
                        try {
                          await deleteMileageLine(id);
                          const left = view.ledger.filter((l) => l.id !== id);
                          // 줄이 다 없어지면 그 사람 카드도 없어진다 (목록을 다시 받는다)
                          if (!left.length) setOpen(null);
                          else void show(b.person);
                          onDone();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    />
                  ) : (
                    <p className="rent-muted">불러오는 중…</p>
                  )}
                  <div className="pill-row">
                    {(["donate", "adjust", "minus"] as const).map((m) => (
                      <button
                        key={m}
                        className={"pill" + (form?.who === b.person && form.mode === m ? " pill-on" : "")}
                        onClick={() => setForm(form?.who === b.person && form.mode === m ? null : { who: b.person, mode: m })}
                      >
                        {MODE_NAME[m]}
                      </button>
                    ))}
                  </div>
                  {form?.who === b.person && (
                    <DonationForm
                      key={form.mode}
                      wiki={wiki}
                      data={data}
                      start={form}
                      onClose={() => setForm(null)}
                      onDone={(who) => (setForm(null), onDone(), void show(who))}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!donors.length && <li className="rent-muted">아직 기부한 사람이 없어요</li>}
      </ul>
    </div>
  );
}

type DonationMode = "donate" | "adjust" | "minus";
const MODE_NAME: Record<DonationMode, string> = { donate: "기부 적립", adjust: "고침", minus: "차감" };

/**
 * 기부 적립·고침·차감 칸. 기부는 장비 이름을 위키에서 찾아 고르고, 위키에 없으면 적은 그대로 (제작자 요청 2026-11-02: 우리 데이터 넘겨서 검색,
 * 없으면 그냥 입력). 기부는 장비 이름이 있어야 적립된다 (서버도 막는다)
 */
function DonationForm({ wiki, data, start, onClose, onDone }: {
  wiki: Wiki;
  data: RentData;
  start: { who: string; mode: DonationMode };
  onClose: () => void;
  onDone: (who: string) => void;
}) {
  const [who, setWho] = useState(start.who);
  const [mode, setMode] = useState<DonationMode>(start.mode);
  const [item, setItem] = useState("");
  const [enhance, setEnhance] = useState(0);
  const [amount, setAmount] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 위키 장비 (무기, 갑옷, 장신구 …) 이름 찾기
  const gear = useMemo(
    () =>
      Object.values(wiki.items)
        .filter((it) => it.equip?.length)
        .map((it) => ({ name: it.name, level: Number(it.equip[0].info["레벨제한"]) || 0, slot: it.equip[0].slot })),
    [wiki],
  );
  const q = item.trim().replace(/\s+/g, "");
  const hits = q ? gear.filter((g) => g.name.replace(/\s+/g, "").includes(q) && g.name !== item.trim()).sort((a, b) => a.name.length - b.name.length || a.level - b.level).slice(0, 6) : [];
  const known = gear.some((g) => g.name === item.trim());
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const name = who.trim();
      const text = mode === "donate" ? `${enhance ? `+${enhance} ` : ""}${item.trim()}` : note.trim();
      await addMileage(name, mode === "minus" ? -amount : amount, mode === "donate" ? "donate" : "adjust", text);
      onDone(name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const ready = !!who.trim() && (mode !== "donate" || !!item.trim());
  return (
    <div className="mk-form rent-form rent-don-form">
      {!start.who && <NameInput value={who} onChange={setWho} members={data.members ?? []} placeholder="닉네임" />}
      {!start.who && (
        <div className="pill-row">
          {(["donate", "adjust", "minus"] as const).map((m) => (
            <button key={m} type="button" className={"pill" + (mode === m ? " pill-on" : "")} onClick={() => setMode(m)}>
              {MODE_NAME[m]}
            </button>
          ))}
        </div>
      )}
      {mode === "donate" && (
        <>
          <label className="mk-field">
            <span>기부한 장비{item.trim() && <small className="rent-muted">{known ? " · 위키 장비" : " · 위키에 없어서 적은 그대로"}</small>}</span>
            <input className="mk-input" placeholder="장비 이름" maxLength={30} value={item} onChange={(e) => setItem(e.target.value)} />
          </label>
          {hits.length > 0 && (
            <div className="mk-chips">
              {hits.map((g) => (
                <button key={g.name} type="button" className="pill" onClick={() => setItem(g.name)}>
                  {g.name} <small>{g.level ? `Lv.${g.level}` : g.slot}</small>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="rent-mile">
        {mode === "donate" && <Num label="+강" value={enhance} min={0} max={20} onChange={setEnhance} />}
        <Num label="💎" value={amount} min={1} max={9999} onChange={setAmount} />
        {mode !== "donate" && (
          <label className="mk-field">
            <span>까닭</span>
            <input className="mk-input" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
      </div>
      <div className="pill-row">
        <button className="pill pill-on" disabled={busy || !ready} onClick={() => void save()}>
          {MODE_NAME[mode]}
        </button>
        <button className="pill" onClick={onClose}>
          취소
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 장부 줄들 */
/** 장부 줄들. onDelete 를 주면(운영 '기부 현황') 줄마다 '삭제' (한 번 더 눌러 확인, 제작자 요청 2026-11-02: 시험으로 적립·차감한 줄을 지우게) */
function Ledger({ lines, rate, onDelete }: { lines: LedgerLine[]; rate: number; onDelete?: (id: number) => Promise<void> }) {
  const [sure, setSure] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!lines.length) return <p className="rent-muted">아직 기록이 없어요</p>;
  return (
    <ul className={"rent-ledger" + (onDelete ? " rent-ledger-edit" : "")}>
      {lines.map((l, n) => (
        <li key={l.id ?? n}>
          <span className={l.delta > 0 ? "rent-plus" : "rent-minus"}>
            💎{l.delta > 0 ? "+" : ""}
            {l.delta}
          </span>
          <span>
            {REASON[l.reason]}
            {/* 예전 줄은 메모 끝에 까닭이 한 번 더 적혀 있다 ('참나무지팡이 +6 대여 보증금') */}
            {l.note ? ` · ${l.note.replace(/ (대여 보증금|반납 · 보증금 돌려받음)$/, "")}` : ""}
            {l.gold ? ` · 골드 ${diaGold(l.gold / rate, rate)}` : ""}
          </span>
          <small>{md(l.at)}</small>
          {onDelete && l.id !== undefined && (
            <button
              className={"rent-x" + (sure === l.id ? " rent-x-sure" : "")}
              aria-label={sure === l.id ? "기록 삭제" : "삭제"}
              disabled={busy}
              onClick={async () => {
                if (sure !== l.id) return setSure(l.id!);
                setBusy(true);
                try {
                  await onDelete(l.id!);
                  setSure(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {sure === l.id ? "삭제" : "✕"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}


/**
 * 운영 '기록' (제작자 요청 2026-11-02: '누가 언제 대여하고 반납했었다 이런 기록을 다 남겨 주라, 장비 대여 기록도 지울 수 있게'):
 * 건넨 줄마다 무기, 빌린 사람, 대여한 날, 반납한 날(대여 중이면 '대여 중'), 보증금. 반납한 줄은 '삭제'(한 번 더 눌러 확인)로 지운다
 */
function RentLog({ wiki }: { wiki: Wiki }) {
  const [rows, setRows] = useState<RentLogRow[] | null>(null);
  const [error, setError] = useState("");
  const [sure, setSure] = useState<number | null>(null);
  const load = useCallback(() => {
    fetchRentLog().then(
      (r) => setRows(r.log),
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(load, [load]);
  if (!rows) return <Loading error={error || undefined} />;
  if (!rows.length) return <p className="rent-muted">아직 기록이 없어요</p>;
  const remove = async (id: number) => {
    setError("");
    try {
      await deleteRentLog(id);
      setSure(null);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const day = (t: number | null) => (t ? md(t) : "");
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {/* 한 줄에 한 건, 모든 줄이 같은 높이 (제작자 요청 2026-11-02: 줄 두께가 다르고 아래에 글로 늘어놓은 게 별로) */}
      <div className="rent-log" role="table">
        <div className="rent-log-row rent-log-head" role="row">
          <span />
          <span>무기</span>
          <span>빌린 사람</span>
          <span>대여</span>
          <span>반납</span>
          <span />
        </div>
        {rows.map((r) => (
          <div key={r.id} className={"rent-log-row" + (r.returnedAt ? "" : " rent-log-now")} role="row" title={r.by ? `건넨 사람 ${r.by}` : undefined}>
            <span>{r.weapon && <Slot wiki={wiki} item={{ weapon: r.weapon }} />}</span>
            <FitLine text={`${r.weapon ?? "지운 물건"}${r.enhance !== null ? ` +${r.enhance}` : ""}`} wrap={false} />
            <span className="rent-log-whoc">
              <FitLine className="rent-log-who" text={r.user} wrap={false} />
              <KakaoButton name={r.user} />
            </span>
            <span>{day(r.rentedAt)}</span>
            <span className={r.returnedAt ? "" : "rent-log-on"}>{r.returnedAt ? day(r.returnedAt) : "대여 중"}</span>
            {r.returnedAt ? (
              <button
                className={"rent-x" + (sure === r.id ? " rent-x-sure" : "")}
                aria-label={sure === r.id ? "기록 삭제" : "삭제"}
                onClick={() => (sure === r.id ? void remove(r.id) : setSure(r.id))}
              >
                {sure === r.id ? "삭제" : "✕"}
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
