import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../auth";
import type { Me } from "../auth";
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
  coinFor,
  curveRows,
  deleteGcItem,
  editGcItem,
  fetchGcoin,
  itemIcon,
  itemLabel,
  saveGcSettings,
} from "../gcoin";
import type { GcCurve, GcData, GcItem, GcOrder, GcWallet } from "../gcoin";
import { Loading, TopBar } from "../ui";
import { useBackClose } from "../backClose";

type Tab = "shop" | "mine" | "orders" | "members" | "settings";
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
const Coin = ({ big = false }: { big?: boolean }) => <i className={"gc-coin" + (big ? " gc-coin-big" : "")} aria-hidden="true" />;

/** 맨 위 지갑: 가진 코인, 번 것·쓴 것, 다음 레벨에 받을 코인 */
function WalletCard({ w, curve, sample }: { w: GcWallet; curve: GcCurve[]; sample: boolean }) {
  const next = w.top !== null ? coinFor(w.top + 1, curve) : 0;
  // 지금 채우는 레벨: 남은 % 와 다 채우면 받을 코인 (경험치도 코인이 된다)
  const pct = (w.topExp ?? 0) / 1000;
  const left = Math.max(0, Math.floor(next * (1 - pct / 100)));
  return (
    <div className={"gc-wallet" + (sample ? " gc-sample" : "")}>
      <div className="gc-wallet-top">
        <Coin big />
        <span className="gc-wallet-num">
          <PopNum n={w.balance} />
          <small>성장코인</small>
        </span>
        {sample && <i className="sample-tag">예시</i>}
      </div>
      <div className="gc-wallet-rows">
        <span>
          레벨·경험치 <b>+{w.earned}</b>
        </span>
        <span>
          순위 보너스 <b>+{w.bonus}</b>
        </span>
        {w.adjust !== 0 && (
          <span>
            조정 <b>{w.adjust > 0 ? `+${w.adjust}` : w.adjust}</b>
          </span>
        )}
        <span>
          사용 <b>−{w.spent}</b>
        </span>
      </div>
      {w.top !== null && next > 0 && (
        <div className="gc-next">
          <span>
            Lv.{w.top} {pct.toFixed(1)}% → Lv.{w.top + 1} 까지 <Coin />
            <b>+{left}</b>
          </span>
          <span className="gc-next-bar">
            <i style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
          <small>경험치 1% 마다 {(next / 100).toFixed(1)}코인 · 랭킹이나 내 정보에 적으면 바로 쌓여요</small>
        </div>
      )}
    </div>
  );
}

/** 이번 주 2군 성장 순위 (이번 주 레벨·경험치로 코인을 많이 번 순) */
function WeekRank({ data }: { data: GcData }) {
  const top = data.week.top;
  return (
    <div className="gc-week">
      <p className="gc-week-head">
        <b>이번 주 2군 성장 순위</b>
        <small>이번 주 번 코인 순 · 목 10시에 1·2·3위 보너스</small>
      </p>
      {!top.length ? (
        <p className="gc-week-empty">아직 이번 주에 레벨·경험치를 올린 2군이 없어요</p>
      ) : (
        <ol className="gc-week-list">
          {top.slice(0, 3).map((e, i) => (
            <li key={e.id} className={"gc-week-row gc-week-" + (i + 1)}>
              <span className="gc-medal">{MEDAL[i]}</span>
              <span className="gc-week-name">
                <Nick name={e.id} />
                <small>
                  Lv.{e.fromLevel}
                  {e.level !== e.fromLevel ? ` → ${e.level}` : ""} · 이번 주 +{e.coins}코인
                </small>
              </span>
              <span className="gc-week-bonus">
                <Coin />+{data.rank[i]}
              </span>
            </li>
          ))}
        </ol>
      )}
      {data.lastWinners.length > 0 && (
        <p className="gc-week-last">
          지난 보너스: {data.lastWinners.map((w, i) => `${MEDAL[i] ?? ""}${w.id} +${w.delta}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** 상점 칸: 물건 카드 2줄, 고르면 아래에 개수와 신청 */
function ShopTab({ data, wallet, sample, onDone }: { data: GcData; wallet: GcWallet | null; sample: boolean; onDone: (msg: string) => void }) {
  const [picked, setPicked] = useState<GcItem | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackClose(picked !== null, () => setPicked(null));
  const items = data.items.filter((i) => i.active);
  const balance = wallet?.balance ?? 0;
  const total = picked ? picked.price * qty : 0;

  async function buy() {
    if (!picked) return;
    if (sample) {
      setError("예시 지갑이라 신청되지 않아요");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await buyItem(picked.id, qty);
      setPicked(null);
      setQty(1);
      onDone(`${itemLabel({ ...picked, qty })} 신청했어요 · 오피서가 게임 안에서 줘요 (1~2일 걸릴 수 있어요)`);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <WeekRank data={data} />
      {!items.length ? (
        <div className="empty">아직 파는 물건이 없어요</div>
      ) : (
        <ul className="gc-grid">
          {items.map((it) => {
            const short = wallet ? balance < it.price : true;
            return (
              <li key={it.id}>
                <button
                  className={"gc-card" + (picked?.id === it.id ? " gc-picked" : "") + (short ? " gc-short" : "")}
                  onClick={() => {
                    setPicked(picked?.id === it.id ? null : it);
                    setQty(1);
                    setError("");
                  }}
                >
                  <span className="gc-card-icon">{itemIcon(it.name)}</span>
                  <span className="gc-card-name">{it.name}</span>
                  {it.unit && <small className="gc-card-unit">{it.unit}</small>}
                  <span className="gc-price">
                    <Coin />
                    {it.price}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picked && (
        <div className="gc-buy">
          <div className="gc-buy-row">
            <span className="gc-buy-name">
              {itemIcon(picked.name)} {itemLabel(picked)}
            </span>
            <span className="gc-step">
              <button className="pill" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="하나 빼기">
                −
              </button>
              <b>{qty}</b>
              <button className="pill" disabled={qty >= 20} onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="하나 더">
                +
              </button>
            </span>
          </div>
          <div className="gc-buy-row">
            <span className={"gc-buy-total" + (wallet && total > balance ? " gc-over" : "")}>
              <Coin />
              {total} <small>/ 가진 {balance}</small>
            </span>
            <button className="pill gc-buy-btn" disabled={busy || !wallet || total > balance} onClick={buy}>
              {busy ? "신청하는 중…" : !wallet ? "2군 본캐만" : total > balance ? "코인 부족" : "구매 신청"}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </>
  );
}

/** 내 코인 칸: 들어오고 나간 것, 레벨업 코인표 */
function MineTab({ data, wallet, history, sample, onChanged }: { data: GcData; wallet: GcWallet | null; history: GcData["history"]; sample: boolean; onChanged: () => void }) {
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
  const rows = curveRows(data.curve);
  const myNext = wallet?.top !== null && wallet?.top !== undefined ? wallet.top + 1 : null;
  return (
    <>
      <ul className="gc-hist">
        {history.orders.map((o) => (
          <li key={"o" + o.id} className={"gc-hist-row gc-hist-" + o.status}>
            <span className="gc-hist-icon">{itemIcon(o.name)}</span>
            <span className="gc-hist-main">
              {itemLabel(o)}
              <small>
                {STATUS_NAME[o.status]} · {ago(o.at)}
                {o.note && ` · “${o.note}”`}
              </small>
            </span>
            <span className={"gc-delta" + (o.status === "reject" || o.status === "cancel" ? " gc-void" : " gc-minus")}>−{o.price * o.qty}</span>
            {o.status === "pending" && (
              <button className="pill gc-mini" disabled={busy} onClick={() => cancel(o)}>
                취소
              </button>
            )}
          </li>
        ))}
        {history.ledger.map((l, i) => (
          <li key={"l" + i} className="gc-hist-row">
            <span className="gc-hist-icon">{l.kind === "rank" ? "🏆" : "✏️"}</span>
            <span className="gc-hist-main">
              {l.note ?? (l.kind === "rank" ? "순위 보너스" : "조정")}
              <small>{ago(l.at)}</small>
            </span>
            <span className={"gc-delta " + (l.delta >= 0 ? "gc-plus" : "gc-minus")}>{l.delta >= 0 ? `+${l.delta}` : l.delta}</span>
          </li>
        ))}
        {history.levels.map((l) => (
          <li key={"v" + l.level + (l.pct ?? "")} className="gc-hist-row">
            <span className="gc-hist-icon">{l.pct === null ? "⬆️" : "📈"}</span>
            <span className="gc-hist-main">{l.pct === null ? `Lv.${l.level} 달성` : `Lv.${l.level} 경험치 ${l.pct}% 까지`}</span>
            <span className="gc-delta gc-plus">+{l.coin}</span>
          </li>
        ))}
        {!history.orders.length && !history.ledger.length && !history.levels.length && (
          <li className="gc-hist-empty">{wallet ? "아직 없어요 · 레벨이 오르면 여기에 쌓여요" : "2군 본캐만 코인이 쌓여요"}</li>
        )}
      </ul>
      {wallet && wallet.base !== null && (
        <p className="gc-note">
          Lv.{wallet.base} {((wallet.baseExp ?? 0) / 1000).toFixed(1)}% 부터 오른 만큼 쌓여요 · 길드 랭킹이나 내 정보에 레벨·경험치를 적으면 바로
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="gc-curve">
        <p className="gc-week-head">
          <b>레벨업 코인표</b>
          <small>레벨 하나 오를 때 · 경험치 % 는 그만큼 나눠서 · 높을수록 많이</small>
        </p>
        <ul>
          {rows.map((r) => {
            const me = myNext !== null && myNext >= r.from && myNext <= r.to;
            return (
              <li key={r.from} className={me ? "gc-curve-me" : ""}>
                <span>{r.from === r.to ? `Lv.${r.from}` : `Lv.${r.from}~${r.to}`}</span>
                <span className="gc-curve-bar">
                  <i style={{ transform: `scaleX(${Math.min(1, r.coin / Math.max(...rows.map((x) => x.coin)))})` }} />
                </span>
                <b>
                  <Coin />
                  {r.coin}
                </b>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/** 신청 칸 (오피서 이상): 게임 안에서 준 뒤 지급 완료, 아니면 반려 */
function OrdersTab({ admin, onChanged }: { admin: NonNullable<GcData["admin"]>; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [note, setNote] = useState("");
  async function act(o: GcOrder, action: "done" | "reject") {
    setBusy(true);
    setError("");
    try {
      await actOrder(o.id, action, action === "reject" ? note.trim() || null : undefined);
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
              <span className="gc-hist-icon">{itemIcon(o.name)}</span>
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
                    <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 60))} placeholder="반려 의견 (안 적어도 돼요)" />
                    <button className="pill pill-danger gc-mini" disabled={busy} onClick={() => act(o, "reject")}>
                      반려 확인
                    </button>
                  </>
                ) : (
                  <>
                    <button className="pill gc-mini gc-done-btn" disabled={busy} onClick={() => act(o, "done")}>
                      지급 완료
                    </button>
                    <button className="pill gc-mini" disabled={busy} onClick={() => setRejecting(o.id)}>
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
                <span className="gc-hist-icon">{itemIcon(o.name)}</span>
                <span className="gc-hist-main">
                  <span>
                    <Nick name={o.user} /> · {itemLabel(o)}
                  </span>
                  <small>
                    {STATUS_NAME[o.status]}
                    {o.doneBy && ` · ${o.doneBy}`} · {ago(o.doneAt ?? o.at)}
                  </small>
                </span>
                <span className={"gc-delta" + (o.status === "done" ? " gc-minus" : " gc-void")}>−{o.price * o.qty}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** 현황 칸 (오피서 이상): 2군 본캐 모두의 코인, 눌러서 손으로 더하거나 빼기 */
function MembersTab({ admin, onChanged }: { admin: NonNullable<GcData["admin"]>; onChanged: () => void }) {
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
        2군 본캐 {admin.members.length}명 · 남은 코인 합 {total.toLocaleString("ko-KR")}
      </p>
      <ul className="gc-hist">
        {admin.members.map((m) => (
          <li key={m.id} className={"gc-member" + (open === m.id ? " gc-member-open" : "")}>
            <button className="gc-hist-row gc-member-row" onClick={() => setOpen(open === m.id ? null : m.id)}>
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
                  레벨업 +{m.earned} · 순위 +{m.bonus} · 조정 {m.adjust >= 0 ? `+${m.adjust}` : m.adjust} · 사용 −{m.spent}
                </p>
                <div className="gc-adjust">
                  <span className="mk-unit">
                    <button className={sign === 1 ? "mk-unit-on" : ""} onClick={() => setSign(1)}>
                      더하기
                    </button>
                    <button className={sign === -1 ? "mk-unit-on" : ""} onClick={() => setSign(-1)}>
                      빼기
                    </button>
                  </span>
                  <input className="mk-input" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="코인" />
                  <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 60))} placeholder="왜 (예: 레벨 잘못 적음)" />
                  <button className="pill gc-mini" disabled={busy || !Number(delta) || !note.trim()} onClick={() => save(m.id)}>
                    저장
                  </button>
                </div>
                {error && <p className="form-error">{error}</p>}
              </div>
            )}
          </li>
        ))}
        {!admin.members.length && <li className="gc-hist-empty">2군 본캐가 아직 없어요 (길드원 관리에서 2군으로 정한 사람)</li>}
      </ul>
    </>
  );
}

/** 설정 칸 (오피서 이상): 레벨업 코인표, 순위 보너스, 상점 물건 */
function SettingsTab({ data, onChanged }: { data: GcData; onChanged: (msg: string) => void }) {
  const [rows, setRows] = useState(() => [...data.curve].sort((a, b) => a.minLevel - b.minLevel).map((r) => ({ lv: String(r.minLevel), coin: String(r.coin) })));
  const [rank, setRank] = useState(() => data.rank.map(String));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nName, setNName] = useState("");
  const [nUnit, setNUnit] = useState("");
  const [nPrice, setNPrice] = useState("");

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
  const num = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <div className="panel gc-set">
        <p className="gc-week-head">
          <b>레벨업 코인표</b>
          <small>그 레벨부터 다음 줄 전까지, 레벨 하나에</small>
        </p>
        {rows.map((r, i) => (
          <div className="gc-set-row" key={i}>
            <span>Lv.</span>
            <input className="mk-input" inputMode="numeric" value={r.lv} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, lv: num(e.target.value, 2) } : x)))} />
            <span>부터</span>
            <input className="mk-input" inputMode="numeric" value={r.coin} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, coin: num(e.target.value, 5) } : x)))} />
            <span>코인</span>
            <button className="pill gc-mini" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="이 줄 빼기">
              ✕
            </button>
          </div>
        ))}
        <div className="gc-set-actions">
          <button className="pill gc-mini" onClick={() => setRows((rs) => [...rs, { lv: "", coin: "" }])}>
            ＋ 줄 추가
          </button>
          <button
            className="pill gc-mini gc-done-btn"
            disabled={busy}
            onClick={() => run(() => saveGcSettings({ levels: rows.map((r) => ({ minLevel: Number(r.lv), coin: Number(r.coin) })) }), "레벨업 코인표를 저장했어요")}
          >
            저장
          </button>
        </div>
      </div>

      <div className="panel gc-set">
        <p className="gc-week-head">
          <b>주간 2군 성장 보너스</b>
          <small>목 10시, 지난주 1·2·3위</small>
        </p>
        <div className="gc-set-row">
          {rank.map((v, i) => (
            <label key={i} className="gc-rank-in">
              {MEDAL[i]}
              <input className="mk-input" inputMode="numeric" value={v} onChange={(e) => setRank((rs) => rs.map((x, j) => (j === i ? num(e.target.value, 5) : x)))} />
            </label>
          ))}
          <button className="pill gc-mini gc-done-btn" disabled={busy} onClick={() => run(() => saveGcSettings({ rank: rank.map(Number) }), "순위 보너스를 저장했어요")}>
            저장
          </button>
        </div>
      </div>

      <div className="panel gc-set">
        <p className="gc-week-head">
          <b>상점 물건</b>
          <small>코인 1개 = 1,000골드쯤</small>
        </p>
        {data.items.map((it) => (
          <ItemEdit key={it.id} it={it} busy={busy} run={run} />
        ))}
        <div className="gc-set-row">
          <input className="mk-input gc-in-name" value={nName} onChange={(e) => setNName(e.target.value.slice(0, 20))} placeholder="이름 (예: 우파노래)" />
          <input className="mk-input" value={nUnit} onChange={(e) => setNUnit(e.target.value.slice(0, 10))} placeholder="단위" />
          <input className="mk-input" inputMode="numeric" value={nPrice} onChange={(e) => setNPrice(num(e.target.value, 6))} placeholder="코인" />
          <button
            className="pill gc-mini gc-done-btn"
            disabled={busy || !nName.trim() || !Number(nPrice)}
            onClick={() =>
              run(async () => {
                await addGcItem({ name: nName.trim(), unit: nUnit.trim() || null, price: Number(nPrice) });
                setNName("");
                setNUnit("");
                setNPrice("");
              }, "물건을 더했어요")
            }
          >
            추가
          </button>
        </div>
      </div>
    </>
  );
}

function ItemEdit({ it, busy, run }: { it: GcItem; busy: boolean; run: (fn: () => Promise<unknown>, done: string) => void }) {
  const [name, setName] = useState(it.name);
  const [unit, setUnit] = useState(it.unit ?? "");
  const [price, setPrice] = useState(String(it.price));
  const [del, setDel] = useState(false);
  const dirty = name !== it.name || unit !== (it.unit ?? "") || price !== String(it.price);
  return (
    <div className={"gc-set-row" + (it.active ? "" : " gc-off")}>
      <span className="gc-hist-icon">{itemIcon(name)}</span>
      <input className="mk-input gc-in-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} />
      <input className="mk-input" value={unit} onChange={(e) => setUnit(e.target.value.slice(0, 10))} />
      <input className="mk-input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      {dirty && (
        <button className="pill gc-mini gc-done-btn" disabled={busy} onClick={() => run(() => editGcItem(it.id, { name, unit: unit.trim() || null, price: Number(price) }), "물건을 고쳤어요")}>
          저장
        </button>
      )}
      <button className="pill gc-mini" disabled={busy} onClick={() => run(() => editGcItem(it.id, { active: !it.active }), it.active ? "판매를 멈췄어요" : "다시 팔아요")}>
        {it.active ? "판매 중지" : "다시 판매"}
      </button>
      {del ? (
        <button className="pill pill-danger gc-mini" disabled={busy} onClick={() => run(() => deleteGcItem(it.id), "물건을 지웠어요")}>
          삭제 확인
        </button>
      ) : (
        <button className="pill gc-mini" onClick={() => setDel(true)}>
          삭제
        </button>
      )}
    </div>
  );
}

/**
 * 2군 성장코인샵 (개발중, 제작자 2026-11-09): 2군 본캐가 레벨업할 때마다 성장코인이 쌓이고(높은 레벨일수록 많이), 주간 2군 성장 1·2·3위는 보너스.
 * 코인으로 물건을 신청하면 오피서가 게임 안에서 주고 '지급 완료'를 누른다. 지금은 앱개발자만 본다
 */
export function GrowthShopPage({ me }: { me: Me }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchGcoin(), [reload]), "gcoin");
  const [cur, setCur] = useState<GcData | null>(null);
  const [tab, setTab] = useEntryState<Tab>("gc.tab", (new URLSearchParams(location.hash.split("?")[1] ?? "").get("t") as Tab) || "shop");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (data) setCur(data);
  }, [data]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (!cur) return <Loading error={error} />;
  const sample = !cur.member;
  const wallet = cur.wallet ?? (sample ? SAMPLE_WALLET : null);
  const history = cur.member ? cur.history : SAMPLE_HISTORY;
  const pending = cur.admin?.pending.length ?? 0;
  const tabs: { key: Tab; label: string }[] = [
    { key: "shop", label: "상점" },
    { key: "mine", label: "내 코인" },
    ...(cur.manage
      ? [
          { key: "orders" as Tab, label: `신청${pending ? ` ${pending}` : ""}` },
          { key: "members" as Tab, label: "현황" },
          { key: "settings" as Tab, label: "설정" },
        ]
      : []),
  ];
  const shown = tabs.some((t) => t.key === tab) ? tab : "shop";

  return (
    <>
      <TopBar title="2군 성장코인샵" />
      <div className="pill-row gc-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={"pill" + (shown === t.key ? " pill-on" : "")} aria-pressed={shown === t.key} onClick={() => { setTab(t.key); setNotice(""); }}>
            {t.label}
          </button>
        ))}
      </div>
      {!cur.open && <p className="gc-closed">개발 중 · 나만 보여요{me.role === "developer" && sample ? " · 내 캐릭터는 2군 본캐가 아니라 지갑은 예시예요" : ""}</p>}
      {notice && <p className="form-note gc-notice">{notice}</p>}

      {(shown === "shop" || shown === "mine") && wallet && <WalletCard w={wallet} curve={cur.curve} sample={sample} />}
      {shown === "shop" && (
        <ShopTab
          data={cur}
          wallet={cur.wallet}
          sample={sample}
          onDone={(m) => {
            setNotice(m);
            refresh();
          }}
        />
      )}
      {shown === "mine" && <MineTab data={cur} wallet={wallet} history={history} sample={sample} onChanged={refresh} />}
      {shown === "orders" && cur.admin && <OrdersTab admin={cur.admin} onChanged={refresh} />}
      {shown === "members" && cur.admin && <MembersTab admin={cur.admin} onChanged={refresh} />}
      {shown === "settings" && cur.manage && (
        <SettingsTab
          key={reload}
          data={cur}
          onChanged={(m) => {
            setNotice(m);
            refresh();
          }}
        />
      )}
    </>
  );
}
