import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { errorText } from "../auth";
import { ago, goldText, goldWords } from "../market";
import { SHOP_PIC, actOrder, discount, fetchShop, orderItem, saveShopItem, saveShopSettings } from "../platshop";
import type { ShopData, ShopItem, ShopOrder, ShopSettings } from "../platshop";
import { Loading, TopBar } from "../ui";

type Tab = "shop" | "mine" | "pending" | "ledger" | "settings";
const STATUS: Record<ShopOrder["status"], string> = { requested: "신청함", done: "거래 완료", cancelled: "취소" };

/** 25만 골드처럼 */
const gold = (n: number) => `${goldWords(n)} 골드`;

/**
 * 1군 전용 플래티넘 할인 상점 (제작자 요청). 게임 상점의 물건 칸(스샷에서 자른 그림)을 세로 화면에 3칸씩 놓고,
 * 시중가(7:100)에 줄을 긋고 길드 할인가와 할인율을 보인다. 1군 길드원이 '구매 신청'을 하면 오피서에게 알림이 가고,
 * 게임에서 물건을 주고 골드를 받은 뒤 오피서가 '거래 완료'를 누른다. 오피서 이상은 신청, 정산, 설정을 본다.
 * 열기 전에는 오피서 이상만 들어오고 길드원에게는 '준비 중이에요'.
 */
export function PlatShopPage() {
  const [data, setData] = useState<ShopData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("shop");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    fetchShop().then(setData, (x) => setError(errorText(x)));
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      load();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <>
        <TopBar title="플래티넘 할인 상점" />
        <Loading error={error} />
      </>
    );
  }
  if (!data.open && !data.manager) {
    return (
      <>
        <TopBar title="플래티넘 할인 상점" />
        <div className="empty">준비 중이에요.</div>
      </>
    );
  }

  const items = data.items ?? [];
  const s = data.settings!;
  const item = items.find((it) => it.id === picked) ?? null;
  const pending = data.manage?.pending.length ?? 0;
  const tabs: { key: Tab; label: string }[] = [
    { key: "shop", label: "상점" },
    { key: "mine", label: "내 신청" },
    ...(data.manager
      ? [
          { key: "pending" as Tab, label: `신청${pending ? ` ${pending}` : ""}` },
          { key: "ledger" as Tab, label: "정산" },
          { key: "settings" as Tab, label: "설정" },
        ]
      : []),
  ];

  return (
    <>
      <TopBar title="플래티넘 할인 상점" />
      <div className="rank-banner">
        <span className="rank-banner-en">PLATINUM SHOP</span>
        <span className="rank-banner-ko">1군 전용 할인 상점</span>
      </div>
      {!data.open && <p className="ps-closed">오픈 전 · 오피서 이상만 보여요</p>}
      <p className="ps-rate">
        <img src={SHOP_PIC + "plat.png"} alt="플래티넘" /> 100 = <b>{s.ratio}만</b> 골드 <s>{s.market}만</s>
      </p>
      <div className="filter">
        {tabs.map((t) => (
          <button key={t.key} className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-note">{notice}</p>}

      {tab === "shop" && (
        <>
          <ul className="ps-grid">
            {items.map((it) => (
              <li key={it.id}>
                <button className={"ps-card" + (picked === it.id ? " ps-picked" : "") + (it.enabled ? "" : " ps-off")} onClick={() => setPicked(picked === it.id ? null : it.id)}>
                  <img src={SHOP_PIC + it.tile} alt={it.name} loading="lazy" />
                  <span className="ps-price">
                    <s>{goldWords(it.marketGold)}</s> <b>{goldWords(it.gold)}</b>
                    <em>-{discount(it)}%</em>
                  </span>
                  <small className="ps-limit">
                    {!it.enabled ? "판매 안 함" : it.used >= it.limitCount ? "한도 다 씀" : `${it.limitWeeks}주 ${it.limitCount}개`}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {item && (
            <div className="ps-buy">
              <img src={SHOP_PIC + item.tile} alt="" />
              <span className="ps-buy-name">
                <b>
                  {item.name}
                  {item.count > 1 && ` ×${item.count}`}
                </b>
                <small>
                  플래티넘 {item.plat.toLocaleString("ko-KR")} · <s>{gold(item.marketGold)}</s> → <b>{goldText(item.gold)} 골드</b>
                </small>
                <small>
                  {item.limitWeeks}주에 {item.limitCount}개 · 남은 {Math.max(0, item.limitCount - item.used)}개
                </small>
              </span>
              <button
                className="pill pill-on"
                disabled={busy || !data.main || !item.enabled || item.used >= item.limitCount}
                onClick={() => run(() => orderItem(item.id), "구매 신청했어요. 오피서가 게임에서 거래해 줄 거예요.")}
              >
                {!data.main ? "1군 전용" : item.used >= item.limitCount ? "한도 다 씀" : "구매 신청"}
              </button>
            </div>
          )}
        </>
      )}

      {tab === "mine" && (
        <OrderList
          orders={data.orders ?? []}
          empty="아직 신청한 게 없어요."
          action={(o) =>
            o.status === "requested" && (
              <button className="pill" disabled={busy} onClick={() => run(() => actOrder(o.id, "cancel"))}>
                취소
              </button>
            )
          }
        />
      )}

      {tab === "pending" && data.manage && (
        <OrderList
          orders={data.manage.pending}
          empty="처리할 신청이 없어요."
          action={(o) => (
            <>
              <button className="pill pill-on" disabled={busy} onClick={() => run(() => actOrder(o.id, "done"), "거래 완료로 기록했어요.")}>
                거래 완료
              </button>
              <button className="pill" disabled={busy} onClick={() => run(() => actOrder(o.id, "cancel"))}>
                취소
              </button>
            </>
          )}
        />
      )}

      {tab === "ledger" && data.manage && (
        <>
          <div className="ps-ledger">
            {[
              { label: "이번 달", v: data.manage.month },
              { label: "전체", v: data.manage.total },
            ].map((x) => (
              <div key={x.label} className="panel">
                <b>{x.label}</b>
                <span>거래 {x.v.n}건</span>
                <span>
                  <img src={SHOP_PIC + "plat.png"} alt="" /> {x.v.plat.toLocaleString("ko-KR")}
                </span>
                <span className="ps-gold">{goldText(x.v.gold)} 골드</span>
              </div>
            ))}
          </div>
          <OrderList orders={data.manage.recent} empty="아직 기록이 없어요." />
        </>
      )}

      {tab === "settings" && data.manage && (
        <ShopSettingsPanel settings={s} items={items} busy={busy} run={run} />
      )}
    </>
  );
}

function OrderList({ orders, empty, action }: { orders: ShopOrder[]; empty: string; action?: (o: ShopOrder) => ReactNode }) {
  if (!orders.length) return <div className="empty">{empty}</div>;
  return (
    <ul className="ps-orders">
      {orders.map((o) => (
        <li key={o.id} className={"panel ps-order ps-" + o.status}>
          <span className="ps-order-main">
            <b>{o.itemName}</b>
            <small>
              {o.user && `${o.user} · `}
              {goldText(o.gold)} 골드 · 플래티넘 {o.plat.toLocaleString("ko-KR")} · {ago(o.doneAt ?? o.at)}
              {o.doneBy && ` · ${o.doneBy}`}
            </small>
          </span>
          <span className="ps-order-side">
            <small className="ps-status">{STATUS[o.status]}</small>
            {action?.(o)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 통 설정 (비율, 시중가, 한도, 오픈)과 물건마다 판매 여부, 따로 정한 비율과 한도 */
function ShopSettingsPanel({ settings, items, busy, run }: {
  settings: ShopSettings;
  items: ShopItem[];
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => void;
}) {
  const [s, setS] = useState(settings);
  const num = (v: string) => (v === "" ? NaN : Number(v));
  return (
    <>
      <section className="panel ps-settings">
        <h2 className="panel-title">통 설정</h2>
        <label>
          할인 <input inputMode="decimal" value={s.ratio} onChange={(e) => setS({ ...s, ratio: num(e.target.value) })} /> : 100
        </label>
        <label>
          시중 <input inputMode="decimal" value={s.market} onChange={(e) => setS({ ...s, market: num(e.target.value) })} /> : 100
        </label>
        <label>
          한도 <input inputMode="numeric" value={s.limitWeeks} onChange={(e) => setS({ ...s, limitWeeks: num(e.target.value) })} /> 주에
          <input inputMode="numeric" value={s.limitCount} onChange={(e) => setS({ ...s, limitCount: num(e.target.value) })} /> 개
        </label>
        <div className="mk-chips">
          <button className={"pill" + (s.open ? " pill-on" : "")} onClick={() => setS({ ...s, open: !s.open })}>
            {s.open ? "오픈" : "오픈 전"}
          </button>
          <button className="pill pill-on" disabled={busy} onClick={() => run(() => saveShopSettings(s), "저장했어요.")}>
            저장
          </button>
        </div>
      </section>
      <ul className="ps-item-rules">
        {items.map((it) => (
          <ItemRule key={it.id} it={it} settings={settings} busy={busy} run={run} />
        ))}
      </ul>
    </>
  );
}

function ItemRule({ it, settings, busy, run }: {
  it: ShopItem;
  settings: ShopSettings;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => void;
}) {
  const [enabled, setEnabled] = useState(it.enabled);
  const [ratio, setRatio] = useState(it.ratio !== settings.ratio ? String(it.ratio) : "");
  const [count, setCount] = useState(it.limitCount !== settings.limitCount ? String(it.limitCount) : "");
  const [weeks, setWeeks] = useState(it.limitWeeks !== settings.limitWeeks ? String(it.limitWeeks) : "");
  const opt = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <li className="panel ps-rule">
      <img src={SHOP_PIC + it.tile} alt="" />
      <span className="ps-rule-main">
        <b>
          {it.name}
          {it.count > 1 && ` ×${it.count}`}
        </b>
        <span className="ps-rule-inputs">
          <input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder={String(settings.ratio)} aria-label="비율" />
          :100
          <input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder={String(settings.limitWeeks)} aria-label="주" />주
          <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder={String(settings.limitCount)} aria-label="개" />개
        </span>
      </span>
      <span className="ps-rule-side">
        <button className={"pill" + (enabled ? " pill-on" : "")} onClick={() => setEnabled(!enabled)}>
          {enabled ? "판매" : "판매 안 함"}
        </button>
        <button
          className="pill"
          disabled={busy}
          onClick={() => run(() => saveShopItem(it.id, { enabled, ratio: opt(ratio), limitCount: opt(count), limitWeeks: opt(weeks) }), `${it.name} 저장했어요.`)}
        >
          저장
        </button>
      </span>
    </li>
  );
}
