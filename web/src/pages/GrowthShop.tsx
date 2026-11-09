import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JOB_NAME, avatarUrl, errorText } from "../auth";
import type { Me } from "../auth";
import { LevelEditor } from "./LevelEditor";
import {
  PrizeSheet,
  RaceBoard,
  RaceCard,
  TargetsTab,
  goldText,
} from "./GrowthRace";
import { JobEmblem } from "../emblems";
import { HeroHalo } from "../heroHalo";
import { GrowthChart } from "./GrowthChart";
import { useAsync } from "../data";
import { Nick } from "../kakao";
import { ago } from "../market";
import { useEntryState } from "../router";
import {
  SAMPLE_HISTORY,
  SAMPLE_WALLET,
  STATUS_NAME,
  actOrder,
  addGcItem,
  adjustCoin,
  buyItem,
  nextGoal,
  pctText,
  stepOf,
  curveRows,
  deleteGcItem,
  editGcItem,
  fetchGcoin,
  itemIcon,
  itemLabel,
  coinOfGold,
  itemInfo,
  itemPic,
  packOf,
  qtyOf,
  saveGcSettings,
  sampleRace,
} from "../gcoin";
import type {
  GcCurve,
  GcData,
  GcRace,
  GcRaceEntry,
  GcItem,
  GcOrder,
  GcRankEntry,
  GcWallet,
} from "../gcoin";
import { FitLine, Loading, TopBar } from "../ui";
import { useBackClose } from "../backClose";

type Tab = "status" | "shop" | "mine" | "staff";
/** 담당자 메뉴 안의 칸 */
type Staff = "orders" | "items" | "targets" | "members" | "coins";
const MEDAL = ["🥇", "🥈", "🥉"];

/** 바뀐 숫자가 톡 튄다 (처음 그릴 때는 안 튐) */
function PopNum({ n, className = "" }: { n: number; className?: string }) {
  const first = useRef(true);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setK((x) => x + 1);
  }, [n]);
  return (
    <b key={k} className={className + (k ? " gc-pop" : "")}>
      {n.toLocaleString("ko-KR")}
    </b>
  );
}

/** 성장코인 그림 (도트 동전) */
const Coin = ({ big = false }: { big?: boolean }) => (
  <i className={"gc-coin" + (big ? " gc-coin-big" : "")} aria-hidden="true" />
);

/** 맨 위 지갑 (한 칸에 촘촘히): 왼쪽 가진 코인, 오른쪽 지금 레벨 막대와 다 채우면 받을 코인, 끝에 작은 '코인표' 단추.
 * 번 것·쓴 것 줄과 연속·첫 달성 칩은 뺐다 (제작자 2026-11-09 '성장 보너스 이거는 뭐고 불꽃 모양은 또 뭐야': 자세한 것은 내 코인의 기록표에) */
function WalletCard({
  w,
  curve,
  sample,
  race,
  me,
  onMe,
  onSaved,
}: {
  w: GcWallet;
  curve: GcCurve[];
  sample: boolean;
  /** 시범운영(레벨 코인 끔): 2주 목표 판과 내 줄 */
  race?: { race: GcRace; mine: GcRaceEntry | null } | null;
  me: Me;
  onMe?: (p: Partial<Me>) => void;
  onSaved: () => void;
}) {
  const g = race ? null : nextGoal(w, curve);
  const [table, setTable] = useState(false);
  const [edit, setEdit] = useState(false);
  // 카드에는 내 코인과 다음 이정표만 (제작자 2026-11-09 '레벨업하면 몇이 오른다, 경험치 몇 퍼 올리면 코인 몇 개, 이 정도만',
  // '지금 2% 만 더 올리면 코인 얼마 얻어요, 다음 이정표로 안내'). 성장·보너스·사용 합계는 기록표에
  return (
    <div className={"gc-wallet" + (sample ? " gc-sample" : "")}>
      <div className="gc-wallet-main">
        <Coin big />
        <span className="gc-wallet-num">
          <PopNum n={w.balance} />
          {sample && <i className="sample-tag">예시</i>}
        </span>
        <button className="gc-table-btn" onClick={() => setTable(true)}>
          {race ? "보상표" : "코인표"}
        </button>
      </div>
      {/* 시범운영: 성장 카드 = 2주 목표 달성률 (제작자 2026-11-09 '상점의 성장 카드는 달성률이 나오게', '성장 반영 버튼, 길드 랭킹에도 연동') */}
      {race && (
        <RaceCard
          entry={race.mine}
          race={race.race}
          editing={edit}
          onEdit={() => setEdit((x) => !x)}
        />
      )}
      {edit && me.job && me.guild && (
        <LevelEditor
          me={me}
          onMe={onMe}
          onSaved={onSaved}
          onClose={() => setEdit(false)}
        />
      )}
      {/* 경험치 막대 위 이정표 (제작자 2026-11-09 '텍스트 말고 퍼센트마다 수직 막대나 이정표를 가시적으로, 최소 10퍼로 너무 많지 않게'):
          코인이 들어오는 칸마다 세로 표시와 그 칸의 코인, 지난 것은 금색, 다음 것은 깜박 */}
      {g && (
        <div className="gc-ms">
          <span className="gc-ms-lv">
            Lv.{g.level}
            <small>{Math.floor(g.pct * 10) / 10}%</small>
          </span>
          <span className="gc-ms-bar">
            <i style={{ transform: `scaleX(${g.pct / 100})` }} />
            {g.marks.map((m) => (
              <span
                key={m.at}
                className={"gc-ms-mark gc-ms-" + m.state}
                style={{ left: `${m.at}%` }}
              >
                {/* 글자는 다음 이정표에만 (다 달면 320px 에서 겹친다) */}
                {m.state === "next" && (
                  <em>
                    <Coin />+{m.coin}
                  </em>
                )}
              </span>
            ))}
          </span>
          <span className="gc-ms-lv gc-ms-to">Lv.{g.level + 1}</span>
        </div>
      )}
      {table &&
        (race ? (
          <PrizeSheet race={race.race} onClose={() => setTable(false)} />
        ) : (
          <CoinTable
            curve={curve}
            top={w.top}
            onClose={() => setTable(false)}
          />
        ))}
    </div>
  );
}

/** 레벨업 코인표 창: 지갑의 '코인표' 단추로 연다 (폰 뒤로 가기·바깥 누르기로 닫힘) */
/** '2.5% 마다 1' (레벨 코인을 나눈 칸) */
function stepText(c: number) {
  const st = stepOf(c);
  return st.pct >= 100 ? "레벨업 때" : `${pctText(st.pct)}마다 ${st.coin}`;
}

function CoinTable({
  curve,
  top,
  onClose,
}: {
  curve: GcCurve[];
  top: number | null;
  onClose: () => void;
}) {
  useBackClose(true, onClose);
  const rows = curveRows(curve);
  const myNext = top !== null ? top + 1 : null;
  const max = Math.max(1, ...rows.map((x) => x.coin));
  return createPortal(
    <div className="gc-sheet-back" onClick={onClose}>
      <div
        className="gc-curve gc-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <p className="gc-week-head">
          <b>레벨업 코인표</b>
          <button
            className="pill gc-mini gc-sheet-x"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </p>
        <ul>
          {rows.map((r) => {
            const me = myNext !== null && myNext >= r.from && myNext <= r.to;
            return (
              <li key={r.from} className={me ? "gc-curve-me" : ""}>
                <span>
                  {r.from === r.to ? `Lv.${r.from}` : `Lv.${r.from}~${r.to}`}
                </span>
                <span className="gc-curve-bar">
                  <i
                    style={{
                      transform: `scaleX(${Math.min(1, r.coin / max)})`,
                    }}
                  />
                </span>
                <b>
                  <Coin />
                  {r.coin}
                </b>
                <small className="gc-curve-step">{stepText(r.coin)}</small>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** 순위 표시: 1~3위 메달, 그 뒤는 숫자 */
const rankMark = (i: number) => MEDAL[i] ?? String(i + 1);

/** 한 주가 시작한 때 '11/5(목) 10:00' */
function weekText(ms: number): string {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]}) ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * 성장 현황 칸 (첫 칸, 제작자 2026-11-09 '상점에 랭킹을 나타내야 되나, 상점 누르자마자 첫 메뉴로 2군 성장 현황, 총 5위까지 추가 보상'):
 * 이번 주에 레벨·경험치로 성장코인을 번 2군 길드원 순서. 1~5위 자리는 비어도 늘 보이고 보너스 코인이 붙는다
 */
function StatusTab({ data, me }: { data: GcData; me: string }) {
  // 길드 랭킹의 성장 랭킹과 같은 모양 (제작자 2026-11-09 '이번 주 2군 성장 랭킹은 코인 획득이 많은 순서대로, 우리 길드 랭킹 디자인을 따오면 될 듯'):
  // 1위는 성장왕 카드(후광, 캐릭터 사진), 2위부터 한 줄씩, 1~5위는 보너스 코인. 닉네임을 누르면 레벨·경험치 그래프
  const list = data.week.top;
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId(openId === id ? null : id);
  const [first, ...rest] = list;
  const mine = list.findIndex((e) => e.id === me);
  const lv = (e: GcRankEntry) =>
    `${JOB_NAME[e.job]} · Lv.${e.fromLevel}${e.level !== e.fromLevel ? ` → ${e.level}` : ""}`;
  const bonus = (i: number) =>
    data.rank[i] ? (
      <small className="gc-st-bonus">
        보너스 <Coin />
        {data.rank[i]}
      </small>
    ) : null;
  return (
    <div className="gc-st">
      <p className="growth-note">
        {weekText(data.week.start)} ~{" "}
        {weekText(data.week.start + 7 * 86_400_000)}
      </p>
      {!first ? (
        <div className="empty">이번 주 아직 코인을 번 사람이 없어요</div>
      ) : (
        <>
          <div className="growth-hero">
            <span className="growth-crown">👑 이번 주 2군 성장왕</span>
            <span className="growth-hero-face">
              <HeroHalo />
              <span className="gh-who">
                <Face e={first} size={96} />
              </span>
            </span>
            <button
              className="growth-hero-name gc-st-nick"
              onClick={() => toggle(first.id)}
            >
              <Nick name={first.id} />
            </button>
            <span className="growth-hero-sub">{lv(first)}</span>
            <span className="growth-hero-value gc-st-value">
              <Coin big />+{first.coins}
            </span>
            {bonus(0)}
          </div>
          {openId === first.id && <GrowthChart id={first.id} />}
          {rest.length > 0 && (
            <ol className="growth-list">
              {rest.map((e, i) => (
                <Fragment key={e.id}>
                  <li
                    className={
                      "growth-row" +
                      (e.id === me ? " growth-mine" : "") +
                      (i < 2 ? ` gc-st-podium gc-st-podium-${i + 2}` : "")
                    }
                  >
                    <span className={"growth-rank growth-rank-" + (i + 2)}>
                      {i + 2}
                    </span>
                    <span className="growth-row-face">
                      <Face e={e} size={40} />
                    </span>
                    <span className="growth-row-name">
                      <button
                        className="growth-nick gc-st-nick"
                        onClick={() => toggle(e.id)}
                      >
                        <Nick name={e.id} />
                      </button>
                      <small>{lv(e)}</small>
                    </span>
                    <span className="growth-row-value gc-st-value">
                      <span>
                        <Coin />+{e.coins}
                      </span>
                      {bonus(i + 1)}
                    </span>
                  </li>
                  {openId === e.id && (
                    <li className="rank-chart">
                      <GrowthChart id={e.id} />
                    </li>
                  )}
                </Fragment>
              ))}
            </ol>
          )}
        </>
      )}
      {mine >= 0 && (
        <p className="growth-me">
          내 이번 주: {mine + 1}등 +{list[mine].coins}코인
        </p>
      )}
    </div>
  );
}

/** 캐릭터 사진이 있으면 사진, 없으면 직업 엠블럼 (길드 랭킹 Face 와 같다) */
function Face({ e, size }: { e: GcRankEntry; size: number }) {
  return e.avatar ? (
    <img
      className="growth-face"
      src={avatarUrl(e.id, e.avatar)}
      alt=""
      style={{ maxWidth: size, maxHeight: size }}
      draggable={false}
    />
  ) : (
    <JobEmblem job={e.job} level={e.level} size={size} />
  );
}

/** 상점 칸: 물건마다 한 줄, 그 안에 묶음(10개·20개·50개)이 줄을 꽉 채워 나란히. 고르면 아래에 개수와 신청 */
function ShopTab({
  data,
  wallet,
  member,
  onDone,
}: {
  data: GcData;
  wallet: GcWallet | null;
  member: boolean;
  onDone: (msg: string) => void;
}) {
  const [picked, setPicked] = useState<GcItem | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackClose(picked !== null, () => setPicked(null));
  const balance = wallet?.balance ?? 0;
  const total = picked ? picked.price * qty : 0;
  const groups = new Map<string, GcItem[]>();
  for (const it of data.items.filter((i) => i.active && i.price > 0))
    groups.set(it.name, [...(groups.get(it.name) ?? []), it]);
  for (const list of groups.values())
    list.sort((a, b) => qtyOf(a.unit) - qtyOf(b.unit));

  async function buy() {
    if (!picked) return;
    if (!member) {
      setError("2군 전용이에요");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await buyItem(picked.id, qty);
      setPicked(null);
      setQty(1);
      onDone(`${itemLabel({ ...picked, qty })} 신청했어요`);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!groups.size ? (
        <div className="empty">아직 파는 물건이 없어요</div>
      ) : (
        <ul className="gc-goods">
          {[...groups.values()].flat().map((it) => {
            const short = !!wallet && balance < it.price;
            return (
              <li key={it.id}>
                <button
                  className={
                    "gc-good" +
                    (picked?.id === it.id ? " gc-picked" : "") +
                    (short ? " gc-short" : "")
                  }
                  onClick={() => {
                    setPicked(picked?.id === it.id ? null : it);
                    setQty(1);
                    setError("");
                  }}
                >
                  <Pic name={it.name} />
                  <FitLine
                    className="gc-good-name"
                    text={it.name}
                    wrap={false}
                  />
                  <b className="gc-good-price">
                    <Coin />
                    {it.price}
                    <small>{qtyOf(it.unit)}개</small>
                  </b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picked && (
        <div className="gc-buy">
          <ItemInfo it={picked} />
          <span className="gc-step">
            <button
              className="pill"
              disabled={qty <= 1}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label="한 묶음 빼기"
            >
              −
            </button>
            <span>
              <PopNum n={qtyOf(picked.unit) * qty} />개
            </span>
            <button
              className="pill"
              disabled={qty >= 20}
              onClick={() => setQty((q) => Math.min(20, q + 1))}
              aria-label="한 묶음 더"
            >
              +
            </button>
          </span>
          <button
            className={
              "pill gc-buy-btn" +
              (wallet && total > balance ? " gc-over" : "") +
              (member ? "" : " gc-locked")
            }
            disabled={busy || (!!wallet && total > balance)}
            onClick={buy}
          >
            <Coin />
            <PopNum n={total} />
            &nbsp;{busy ? "…" : wallet && total > balance ? "부족" : "신청"}
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </>
  );
}

/** 내 코인 칸: 기록표 (들어오고 나간 것). 레벨업 코인표는 지갑의 '코인표' 단추로 */
function MineTab({
  w,
  history,
  sample,
  onChanged,
  levelCoins,
}: {
  levelCoins: boolean;
  w: GcWallet | null;
  history: GcData["history"];
  sample: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function cancel(o: GcOrder) {
    if (sample) return setError("예시예요");
    setBusy(true);
    setError("");
    try {
      await actOrder(o.id, "cancel");
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {/* 신청·코인 획득 기록 (제작자 2026-11-09 '사용 기록 코인 획득 기록 이런 거는 기록표라고 따로 헤더를 달아 줘') */}
      <div className="gc-log">
        <p className="gc-week-head">
          <b>기록표</b>
        </p>
        {/* 코인 합계는 카드가 아니라 기록표에 (제작자 2026-11-09 '성장으로 얼마, 소모 얼마 이런 거 그냥 기록에 다 정리') */}
        {w && (
          <div className="gc-sum">
            {levelCoins && (
              <span>
                <small>성장</small>
                <b className="gc-plus">+{w.earned}</b>
              </span>
            )}
            <span>
              <small>{levelCoins ? "보너스" : "상금"}</small>
              <b className="gc-plus">+{w.milestone + w.bonus + w.adjust}</b>
            </span>
            <span>
              <small>사용</small>
              <b className="gc-minus">−{w.spent}</b>
            </span>
            <span className="gc-sum-total">
              <small>지금</small>
              <b>
                <Coin />
                {w.balance}
              </b>
            </span>
          </div>
        )}
        <ul className="gc-hist">
          {history.orders.map((o) => (
            <li key={"o" + o.id} className={"gc-hist-row gc-hist-" + o.status}>
              <Pic name={o.name} small />
              <span className="gc-hist-main">
                {itemLabel(o)}
                <small>
                  {STATUS_NAME[o.status]} · {ago(o.at)}
                  {o.note && ` · “${o.note}”`}
                </small>
              </span>
              <span
                className={
                  "gc-delta" +
                  (o.status === "reject" || o.status === "cancel"
                    ? " gc-void"
                    : " gc-minus")
                }
              >
                −{o.price * o.qty}
              </span>
              {o.status === "pending" && (
                <button
                  className="pill gc-mini"
                  disabled={busy}
                  onClick={() => cancel(o)}
                >
                  취소
                </button>
              )}
            </li>
          ))}
          {history.ledger.map((l, i) => (
            <li key={"l" + i} className="gc-hist-row">
              <span className="gc-hist-icon">
                {l.kind === "rank" ? "🏆" : l.kind === "streak" ? "🔥" : "✏️"}
              </span>
              <span className="gc-hist-main">
                {l.note ?? (l.kind === "rank" ? "순위 보너스" : "조정")}
                <small>{ago(l.at)}</small>
              </span>
              <span
                className={
                  "gc-delta " + (l.delta >= 0 ? "gc-plus" : "gc-minus")
                }
              >
                {l.delta >= 0 ? `+${l.delta}` : l.delta}
              </span>
            </li>
          ))}
          {history.milestones.map((m) => (
            <li key={"m" + m.level} className="gc-hist-row gc-hist-ms">
              <span className="gc-hist-icon">🎉</span>
              <span className="gc-hist-main">{m.name} · 첫 달성 보너스</span>
              <span className="gc-delta gc-plus">+{m.coin}</span>
            </li>
          ))}
          {history.levels.map((l) => (
            <li key={"v" + l.level + (l.pct ?? "")} className="gc-hist-row">
              <span className="gc-hist-icon">
                {l.pct === null ? "⬆️" : "📈"}
              </span>
              <span className="gc-hist-main">
                {l.pct === null
                  ? `Lv.${l.level} 달성`
                  : `Lv.${l.level} 경험치 ${l.pct}% 까지`}
              </span>
              <span className="gc-delta gc-plus">+{l.coin}</span>
            </li>
          ))}
          {!history.orders.length &&
            !history.ledger.length &&
            !history.levels.length &&
            !history.milestones.length && (
              <li className="gc-hist-empty">아직 없어요</li>
            )}
        </ul>
      </div>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

/** 신청 칸 (오피서 이상): 게임 안에서 준 뒤 지급 완료, 아니면 반려 */
function OrdersTab({
  admin,
  onChanged,
}: {
  admin: NonNullable<GcData["admin"]>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [note, setNote] = useState("");
  async function act(o: GcOrder, action: "done" | "reject") {
    setBusy(true);
    setError("");
    try {
      await actOrder(
        o.id,
        action,
        action === "reject" ? note.trim() || null : undefined,
      );
      setRejecting(null);
      setNote("");
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {!admin.pending.length ? (
        <div className="empty">기다리는 신청이 없어요</div>
      ) : (
        <ul className="gc-hist">
          {admin.pending.map((o) => (
            <li key={o.id} className="gc-hist-row gc-order">
              <Pic name={o.name} small />
              <span className="gc-hist-main">
                <span>
                  <Nick name={o.user} /> · {itemLabel(o)}
                </span>
                <small>
                  <Coin />
                  {o.price * o.qty} · {ago(o.at)}
                </small>
              </span>
              <span className="gc-order-act">
                {rejecting === o.id ? (
                  <>
                    <input
                      className="mk-input"
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 60))}
                      placeholder="반려 의견"
                    />
                    <button
                      className="pill pill-danger gc-mini"
                      disabled={busy}
                      onClick={() => act(o, "reject")}
                    >
                      반려 확인
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="pill gc-mini gc-done-btn"
                      disabled={busy}
                      onClick={() => act(o, "done")}
                    >
                      지급 완료
                    </button>
                    <button
                      className="pill gc-mini"
                      disabled={busy}
                      onClick={() => setRejecting(o.id)}
                    >
                      반려
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {admin.recent.length > 0 && (
        <>
          <p className="gc-sub">최근 처리</p>
          <ul className="gc-hist">
            {admin.recent.slice(0, 20).map((o) => (
              <li key={o.id} className={"gc-hist-row gc-hist-" + o.status}>
                <Pic name={o.name} small />
                <span className="gc-hist-main">
                  <span>
                    <Nick name={o.user} /> · {itemLabel(o)}
                  </span>
                  <small>
                    {STATUS_NAME[o.status]}
                    {o.doneBy && ` · ${o.doneBy}`} · {ago(o.doneAt ?? o.at)}
                  </small>
                </span>
                <span
                  className={
                    "gc-delta" +
                    (o.status === "done" ? " gc-minus" : " gc-void")
                  }
                >
                  −{o.price * o.qty}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** 현황 칸 (오피서 이상): 2군 본캐 모두의 코인, 눌러서 손으로 더하거나 빼기 */
function MembersTab({
  admin,
  onChanged,
}: {
  admin: NonNullable<GcData["admin"]>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(id: string) {
    setBusy(true);
    setError("");
    try {
      await adjustCoin(id, sign * (Number(delta) || 0), note.trim());
      setDelta("");
      setNote("");
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const total = admin.members.reduce((s, m) => s + m.balance, 0);
  return (
    <>
      <p className="gc-note">
        2군 {admin.members.length}명 · 남은 코인 합{" "}
        {total.toLocaleString("ko-KR")}
      </p>
      <ul className="gc-hist">
        {admin.members.map((m) => (
          <li
            key={m.id}
            className={"gc-member" + (open === m.id ? " gc-member-open" : "")}
          >
            <button
              className="gc-hist-row gc-member-row"
              onClick={() => setOpen(open === m.id ? null : m.id)}
            >
              <span className="gc-hist-main">
                <Nick name={m.id} />
                <small>
                  Lv.{m.base}
                  {m.top !== m.base ? ` → ${m.top}` : ""}
                </small>
              </span>
              <span className="gc-balance">
                <Coin />
                {m.balance}
              </span>
            </button>
            {open === m.id && (
              <div className="gc-member-detail">
                <p className="gc-note">
                  레벨업 +{m.earned}
                  {m.milestone > 0 && ` · 첫 달성 +${m.milestone}`} · 보너스 +
                  {m.bonus} · 조정 {m.adjust >= 0 ? `+${m.adjust}` : m.adjust} ·
                  사용 −{m.spent}
                </p>
                <div className="gc-adjust">
                  <span className="mk-unit">
                    <button
                      className={sign === 1 ? "mk-unit-on" : ""}
                      onClick={() => setSign(1)}
                    >
                      더하기
                    </button>
                    <button
                      className={sign === -1 ? "mk-unit-on" : ""}
                      onClick={() => setSign(-1)}
                    >
                      빼기
                    </button>
                  </span>
                  <input
                    className="mk-input"
                    inputMode="numeric"
                    value={delta}
                    onChange={(e) =>
                      setDelta(e.target.value.replace(/\D/g, "").slice(0, 5))
                    }
                    placeholder="코인"
                  />
                  <input
                    className="mk-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 60))}
                    placeholder="메모"
                  />
                  <button
                    className="pill gc-mini"
                    disabled={busy || !Number(delta) || !note.trim()}
                    onClick={() => save(m.id)}
                  >
                    저장
                  </button>
                </div>
                {error && <p className="form-error">{error}</p>}
              </div>
            )}
          </li>
        ))}
        {!admin.members.length && (
          <li className="gc-hist-empty">2군 길드원이 아직 없어요</li>
        )}
      </ul>
    </>
  );
}

/** 담당자 > 코인표: 레벨업 코인표, 주간 순위 보너스 */
function CoinsTab({
  data,
  onChanged,
}: {
  data: GcData;
  onChanged: (msg: string) => void;
}) {
  const [rows, setRows] = useState(() =>
    [...data.curve]
      .sort((a, b) => a.minLevel - b.minLevel)
      .map((r) => ({ lv: String(r.minLevel), coin: String(r.coin) })),
  );
  const [rank, setRank] = useState(() => data.rank.map(String));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged(done);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {data.levelCoins && (
        <div className="panel gc-set">
          <p className="gc-week-head">
            <b>레벨업 코인</b>
          </p>
          {rows.map((r, i) => (
            <div className="gc-set-row" key={i}>
              <span>Lv.</span>
              <input
                className="mk-input"
                inputMode="numeric"
                value={r.lv}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((x, j) =>
                      j === i ? { ...x, lv: digits(e.target.value, 2) } : x,
                    ),
                  )
                }
              />
              <span>부터</span>
              <input
                className="mk-input"
                inputMode="numeric"
                value={r.coin}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((x, j) =>
                      j === i ? { ...x, coin: digits(e.target.value, 5) } : x,
                    ),
                  )
                }
              />
              <span>코인</span>
              <button
                className="pill gc-mini"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                aria-label="이 줄 빼기"
              >
                ✕
              </button>
              <span className="gc-set-gold">{goldText(Number(r.coin))}</span>
            </div>
          ))}
          <div className="gc-set-actions">
            <button
              className="pill gc-mini"
              onClick={() => setRows((rs) => [...rs, { lv: "", coin: "" }])}
            >
              ＋ 줄
            </button>
            <button
              className="pill gc-mini gc-done-btn"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    saveGcSettings({
                      levels: rows.map((r) => ({
                        minLevel: Number(r.lv),
                        coin: Number(r.coin),
                      })),
                    }),
                  "저장했어요",
                )
              }
            >
              저장
            </button>
          </div>
        </div>
      )}
      <div className="panel gc-set">
        <p className="gc-week-head">
          <b>
            {data.levelCoins ? "주간 1~5위 보너스" : "2주 목표 달성 1~5위 상금"}
          </b>
        </p>
        {rank.map((v, i) => (
          <div className="gc-set-row" key={i}>
            <span className="gc-st-rank">{rankMark(i)}</span>
            <input
              className="mk-input"
              inputMode="numeric"
              value={v}
              onChange={(e) =>
                setRank((rs) =>
                  rs.map((x, j) => (j === i ? digits(e.target.value, 5) : x)),
                )
              }
              aria-label={`${i + 1}위 상금`}
            />
            <span>코인</span>
            <span className="gc-set-gold">{goldText(Number(v))}</span>
          </div>
        ))}
        <div className="gc-set-actions">
          <button
            className="pill gc-mini gc-done-btn"
            disabled={busy}
            onClick={() =>
              run(
                () => saveGcSettings({ rank: rank.map(Number) }),
                "저장했어요",
              )
            }
          >
            저장
          </button>
        </div>
      </div>
    </>
  );
}

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

/** 물건 그림: 게임 거래소 칸 그림(개수 표가 한 통), 없으면 그림 글자 */
function Pic({ name, small }: { name: string; small?: boolean }) {
  const src = itemPic(name);
  const cls = "gc-pic" + (small ? " gc-pic-s" : "");
  return src ? (
    <img className={cls} src={src} alt="" loading="lazy" />
  ) : (
    <span className={cls + " gc-pic-emoji"}>{itemIcon(name)}</span>
  );
}

/** 물건을 누르면 보이는 정보창 (게임 정보창처럼: 이름, 쿨타임은 파란 글씨, 옵션 한 줄씩) */
function ItemInfo({ it }: { it: GcItem }) {
  const lines = itemInfo(it.name);
  return (
    <div className="gc-info">
      <Pic name={it.name} />
      <div className="gc-info-text">
        <b className="gc-info-name">{it.name}</b>
        {lines.map((l, i) => (
          <span
            key={i}
            className={
              /^(쿨타임|요구 레벨)/.test(l) ? "gc-info-cool" : "gc-info-line"
            }
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 담당자 > 물건 (제작자 2026-11-09 '템 뭐뭐를 골드 얼마의 가치인지, 50개에 얼마 20개에 얼마' -> '천 단위로 적게 하지 말고 그냥 원 단위로'):
 * 물건 이름마다 묶음(개수)과 골드 가치(원 단위 그대로)를 적는다. 코인은 1,000골드 = 1코인으로 반올림 (`coinOfGold`).
 * 골드 값을 아직 안 적은 묶음(0)은 상점에 안 보인다 (제작자 2026-11-09 '골드 값어치는 관리자가 쓸 거야, 그에 따라 몇 코인인지 네가 계산'). 옵션은 상점에서 누르면 보인다
 */
function ItemsTab({
  data,
  onChanged,
}: {
  data: GcData;
  onChanged: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nName, setNName] = useState("");
  const [nQty, setNQty] = useState("");
  const [nGold, setNGold] = useState("");
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged(done);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const groups = new Map<string, GcItem[]>();
  for (const it of data.items)
    groups.set(it.name, [...(groups.get(it.name) ?? []), it]);
  for (const list of groups.values())
    list.sort((a, b) => qtyOf(a.unit) - qtyOf(b.unit));
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {[...groups.entries()].map(([name, list]) => (
        <ItemGroup key={name} name={name} list={list} busy={busy} run={run} />
      ))}
      <div className="panel gc-item-new">
        <p className="gc-week-head">
          <b>새 물건</b>
        </p>
        <div className="gc-bundle">
          <input
            className="mk-input gc-in-name"
            value={nName}
            onChange={(e) => setNName(e.target.value.slice(0, 20))}
            placeholder="이름"
          />
          <input
            className="mk-input"
            inputMode="numeric"
            value={nQty}
            onChange={(e) => setNQty(digits(e.target.value, 4))}
            placeholder="개수"
          />
          <span>개</span>
          <input
            className="mk-input"
            inputMode="numeric"
            value={nGold}
            onChange={(e) => setNGold(digits(e.target.value, 9))}
            placeholder="골드"
          />
          <button
            className="pill gc-mini gc-done-btn"
            disabled={busy || !nName.trim() || !Number(nQty) || !Number(nGold)}
            onClick={() =>
              run(async () => {
                await addGcItem({
                  name: nName.trim(),
                  unit: `${Number(nQty)}개`,
                  gold: Number(nGold),
                });
                setNName("");
                setNQty("");
                setNGold("");
              }, "추가했어요")
            }
          >
            추가
          </button>
        </div>
      </div>
    </>
  );
}

/** 물건 하나: 이름, 묶음마다 '20개 = 35000 골드', 묶음 더하기 */
function ItemGroup({
  name,
  list,
  busy,
  run,
}: {
  name: string;
  list: GcItem[];
  busy: boolean;
  run: (fn: () => Promise<unknown>, done: string) => void;
}) {
  const [nm, setNm] = useState(name);
  // 저장한 뒤 새로 받은 값으로 맞춘다 (다시 열 때 예전 목록으로 먼저 그린다)
  useEffect(() => setNm(name), [name]);
  const [qty, setQty] = useState("");
  const [gold, setGold] = useState("");
  return (
    <div className="panel gc-item">
      <div className="gc-item-head">
        <Pic name={nm} small />
        <input
          className="mk-input gc-in-name"
          value={nm}
          onChange={(e) => setNm(e.target.value.slice(0, 20))}
          aria-label="물건 이름"
        />
        {nm.trim() && nm.trim() !== name && (
          <button
            className="pill gc-mini gc-done-btn"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  Promise.all(
                    list.map((it) => editGcItem(it.id, { name: nm.trim() })),
                  ),
                "이름을 바꿨어요",
              )
            }
          >
            저장
          </button>
        )}
      </div>
      {list.map((it) => (
        <Bundle key={it.id} it={it} busy={busy} run={run} />
      ))}
      <div className="gc-bundle gc-bundle-add">
        <input
          className="mk-input"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(digits(e.target.value, 4))}
          placeholder={String(packOf(name))}
        />
        <span>개</span>
        <input
          className="mk-input"
          inputMode="numeric"
          value={gold}
          onChange={(e) => setGold(digits(e.target.value, 9))}
          placeholder="골드"
        />
        <button
          className="pill gc-mini"
          disabled={busy || !Number(qty) || !Number(gold)}
          onClick={() =>
            run(async () => {
              await addGcItem({
                name,
                unit: `${Number(qty)}개`,
                gold: Number(gold),
              });
              setQty("");
              setGold("");
            }, "묶음을 더했어요")
          }
        >
          ＋ 묶음
        </button>
      </div>
    </div>
  );
}

/** 묶음 한 줄: [20]개 [35000] 골드 (= 35코인), 판매 중지, 삭제 */
function Bundle({
  it,
  busy,
  run,
}: {
  it: GcItem;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done: string) => void;
}) {
  const [qty, setQty] = useState(String(qtyOf(it.unit)));
  const gold0 = it.price ? String(it.gold) : "";
  const [gold, setGold] = useState(gold0);
  const qty0 = String(qtyOf(it.unit));
  useEffect(() => setGold(gold0), [gold0]);
  useEffect(() => setQty(qty0), [qty0]);
  const [del, setDel] = useState(false);
  const dirty = qty !== String(qtyOf(it.unit)) || gold !== gold0;
  return (
    <div
      className={
        "gc-bundle" +
        (it.active ? "" : " gc-off") +
        (it.price ? "" : " gc-need")
      }
    >
      <input
        className="mk-input"
        inputMode="numeric"
        value={qty}
        onChange={(e) => setQty(digits(e.target.value, 4))}
        aria-label="개수"
      />
      <span>개</span>
      <input
        className="mk-input"
        inputMode="numeric"
        value={gold}
        onChange={(e) => setGold(digits(e.target.value, 9))}
        placeholder="골드 값"
        aria-label="골드"
      />
      <span>골드</span>
      <small className="gc-bundle-coin">
        {Number(gold) ? (
          <>
            <Coin />
            {coinOfGold(Number(gold))}
          </>
        ) : (
          "미정"
        )}
      </small>
      {dirty ? (
        <button
          className="pill gc-mini gc-done-btn"
          disabled={busy || !Number(qty) || !Number(gold)}
          onClick={() =>
            run(
              () =>
                editGcItem(it.id, {
                  unit: `${Number(qty)}개`,
                  gold: Number(gold),
                }),
              "저장했어요",
            )
          }
        >
          저장
        </button>
      ) : (
        <>
          <button
            className="pill gc-mini"
            disabled={busy}
            onClick={() =>
              run(
                () => editGcItem(it.id, { active: !it.active }),
                it.active ? "판매 중지" : "다시 판매",
              )
            }
          >
            {it.active ? "중지" : "판매"}
          </button>
          {del ? (
            <button
              className="pill pill-danger gc-mini"
              disabled={busy}
              onClick={() => run(() => deleteGcItem(it.id), "삭제했어요")}
            >
              확인
            </button>
          ) : (
            <button
              className="pill gc-mini"
              onClick={() => setDel(true)}
              aria-label="삭제"
            >
              ✕
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 2군 성장코인샵 (개발중, 제작자 2026-11-09): 2군 본캐가 레벨업할 때마다 성장코인이 쌓이고(높은 레벨일수록 많이), 주간 2군 성장 1·2·3위는 보너스.
 * 코인으로 물건을 신청하면 오피서가 게임 안에서 주고 '지급 완료'를 누른다. 지금은 앱개발자만 본다
 */
export function GrowthShopPage({
  me: meInfo,
  onMe,
}: {
  me: Me;
  onMe?: (p: Partial<Me>) => void;
}) {
  const me = meInfo.id;
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(
    useCallback(() => fetchGcoin(), [reload]),
    "gcoin",
  );
  const [cur, setCur] = useState<GcData | null>(null);
  // 알림에서 '#/gcoin?t=orders' 로 오면 담당자 > 신청
  const asked = new URLSearchParams(location.hash.split("?")[1] ?? "").get("t");
  const [tab, setTab] = useEntryState<Tab>(
    "gc.tab",
    asked === "orders"
      ? "staff"
      : asked === "mine"
        ? "mine"
        : asked === "shop"
          ? "shop"
          : "status",
  );
  const [staff, setStaff] = useEntryState<Staff>("gc.staff", "orders");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (data) setCur(data);
  }, [data]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (!cur) return <Loading error={error} />;
  // 메뉴는 모두가 보고 신청은 2군 본캐만 (제작자 2026-11-09 '이 메뉴는 모두가 봐야 하지만 2군만 상점 등 구매 버튼이 활성화, 1군이 누르면 2군 전용이라고 안내').
  // 2군이 아닌 운영진은 화면을 보려고 예시 지갑을, 그 밖의 사람은 지갑과 내 코인 칸 없이 성장 현황·상점만
  const sample = !cur.member && cur.manage;
  const wallet = cur.wallet ?? (sample ? SAMPLE_WALLET : null);
  const history = cur.member ? cur.history : SAMPLE_HISTORY;
  const pending = cur.admin?.pending.length ?? 0;
  // 시범운영 2주 목표 선착순: 목표를 아무도 안 정했으면 예시 판 (제작자 2026-11-09 '테스트 데이터 몇 개 넣어 주고')
  const now = Date.now();
  const raceSample = !cur.race.list.length;
  // 예시는 판이 나흘쯤 지난 것처럼 (첫날이면 선이 안 보인다)
  const raceNow = raceSample ? cur.race.start + 4.2 * 86_400_000 : now;
  const race = raceSample ? sampleRace(cur.race.start, raceNow) : cur.race;
  const myRace = cur.levelCoins
    ? null
    : {
        race,
        mine:
          race.list.find((e) => e.id === me) ??
          (raceSample && sample ? race.list[1] : null),
      };
  const tabs: { key: Tab; label: string }[] = [
    { key: "status", label: "성장 현황" },
    { key: "shop", label: "상점" },
    ...(cur.member || sample ? [{ key: "mine" as Tab, label: "내 코인" }] : []),
    ...(cur.manage
      ? [
          {
            key: "staff" as Tab,
            label: `담당자${pending ? ` ${pending}` : ""}`,
          },
        ]
      : []),
  ];
  const shown = tabs.some((t) => t.key === tab) ? tab : "status";
  const staffTabs: { key: Staff; label: string }[] = [
    { key: "orders", label: `신청${pending ? ` ${pending}` : ""}` },
    { key: "items", label: "물건" },
    ...(cur.levelCoins ? [] : [{ key: "targets" as Staff, label: "목표" }]),
    { key: "members", label: "현황" },
    { key: "coins", label: cur.levelCoins ? "코인표" : "보상" },
  ];
  const saved = (m: string) => {
    setNotice(m);
    refresh();
  };

  return (
    <>
      <TopBar title="성장코인샵" />
      <div className="pill-row gc-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={"pill" + (shown === t.key ? " pill-on" : "")}
            aria-pressed={shown === t.key}
            onClick={() => {
              setTab(t.key);
              setNotice("");
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* 담당자 메뉴: 아래 단계는 어두운 띠의 작은 단추 (위 단추와 상하위 구분, 장비대여 운영과 같은 모양) */}
      {shown === "staff" && (
        <nav className="sub-tabs">
          {staffTabs.map((t) => (
            <button
              key={t.key}
              className={"sub-tab" + (staff === t.key ? " sub-tab-on" : "")}
              onClick={() => {
                setStaff(t.key);
                setNotice("");
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
      {notice && <p className="form-note gc-notice">{notice}</p>}

      {(shown === "shop" || shown === "mine") && wallet && (
        <WalletCard
          w={wallet}
          curve={cur.curve}
          sample={sample}
          race={myRace}
          me={meInfo}
          onMe={onMe}
          onSaved={refresh}
        />
      )}
      {shown === "shop" && (
        <ShopTab
          data={cur}
          wallet={cur.wallet}
          member={cur.member}
          onDone={saved}
        />
      )}
      {shown === "status" &&
        (cur.levelCoins ? (
          <StatusTab data={cur} me={me} />
        ) : (
          <RaceBoard race={race} me={me} sample={raceSample} now={raceNow} />
        ))}
      {shown === "mine" && (
        <MineTab
          w={wallet}
          history={history}
          sample={sample}
          onChanged={refresh}
          levelCoins={cur.levelCoins}
        />
      )}
      {shown === "staff" && cur.admin && staff === "orders" && (
        <OrdersTab admin={cur.admin} onChanged={refresh} />
      )}
      {shown === "staff" && cur.admin && staff === "targets" && (
        <TargetsTab
          key={reload}
          members={cur.admin.members}
          race={cur.race}
          onChanged={saved}
        />
      )}
      {shown === "staff" && cur.manage && staff === "items" && (
        <ItemsTab key={reload} data={cur} onChanged={saved} />
      )}
      {shown === "staff" && cur.admin && staff === "members" && (
        <MembersTab admin={cur.admin} onChanged={refresh} />
      )}
      {shown === "staff" && cur.manage && staff === "coins" && (
        <CoinsTab key={reload} data={cur} onChanged={saved} />
      )}
    </>
  );
}
