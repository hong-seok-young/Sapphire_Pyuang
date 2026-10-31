import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { errorText } from "../auth";
import { ago, goldText, goldWords } from "../market";
import { SHOP_PIC, actOrder, budget, discount, fetchShop, orderItem, platWorth, saveShopItem, saveShopSettings } from "../platshop";
import type { ShopData, ShopItem, ShopOrder, ShopSettings } from "../platshop";
import { Loading, TopBar } from "../ui";

type Tab = "shop" | "mine" | "pending" | "ledger" | "settings" | "budget";
const STATUS: Record<ShopOrder["status"], string> = { requested: "신청함", done: "거래 완료", cancelled: "취소" };

/** 25만 골드처럼 (만 골드 아래는 반올림) */
const gold = (n: number) => `${goldWords(Math.round(n / 10_000) * 10_000)} 골드`;

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
  const high = !!data.highSpec;
  /** 내가 사는 값: 고스펙이면 고스펙 할인가 */
  const myGold = (it: ShopItem) => (high ? it.highGold : it.gold);
  const myRatio = (it: ShopItem) => (high ? it.highRatio : it.ratio);
  const pending = data.manage?.pending.length ?? 0;
  const tabs: { key: Tab; label: string }[] = [
    { key: "shop", label: "상점" },
    { key: "mine", label: "내 신청" },
    ...(data.manager
      ? [
          { key: "pending" as Tab, label: `신청${pending ? ` ${pending}` : ""}` },
          { key: "ledger" as Tab, label: "정산" },
          { key: "settings" as Tab, label: "설정" },
          { key: "budget" as Tab, label: "예산" },
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
        <img src={SHOP_PIC + "plat.png"} alt="플래티넘" /> 100 = <s>{s.market}만</s> <span className={high ? "ps-dim" : "ps-strong"}>1군 {s.ratio}만</span>{" "}
        <span className={high ? "ps-strong" : "ps-dim"}>고스펙 {s.highRatio}만</span>
      </p>
      <div className="filter ps-tabs">
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
            {/* 판매 중지한 물건은 상점에 안 나온다 (설정의 '판매 중지된 물건'에서 다시 판매) */}
            {items.filter((it) => it.enabled).map((it) => (
              <li key={it.id}>
                <button className={"ps-card" + (picked === it.id ? " ps-picked" : "")} onClick={() => setPicked(picked === it.id ? null : it.id)}>
                  {/* 그림 속 플래티넘 값에 줄을 긋고, 할인가를 시중 비율로 친 플래티넘을 위에 붙인다 (제작자 요청) */}
                  <span className="ps-tile">
                    <img src={SHOP_PIC + it.tile} alt={it.name} loading="lazy" />
                    <i className="ps-strike" />
                    <b className="ps-worth">
                      <img src={SHOP_PIC + "plat.png"} alt="" />
                      {platWorth({ plat: it.plat, ratio: myRatio(it) }, s.market).toLocaleString("ko-KR")}
                    </b>
                  </span>
                  {/* 시중가에 줄, 1군 할인가와 고스펙 할인가. 내게 맞는 값만 진하게 (제작자 요청) */}
                  <span className="ps-price">
                    <s>{goldWords(it.marketGold)}</s>
                    <em>-{discount(myGold(it), it.marketGold)}%</em>
                  </span>
                  <span className={"ps-price-row" + (high ? " ps-dim" : " ps-strong")}>1군 {goldWords(it.gold)}</span>
                  <span className={"ps-price-row" + (high ? " ps-strong" : " ps-dim")}>고스펙 {goldWords(it.highGold)}</span>
                  <small className="ps-limit">{it.used >= it.limitCount ? "한도 다 씀" : `${it.limitWeeks}주 ${it.limitCount}개`}</small>
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
                  플래티넘 <s>{item.plat.toLocaleString("ko-KR")}</s> → {platWorth({ plat: item.plat, ratio: myRatio(item) }, s.market).toLocaleString("ko-KR")} 어치 ·{" "}
                  <s>{gold(item.marketGold)}</s> → <b>{goldText(myGold(item))} 골드</b>
                  {high && " (고스펙)"}
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

      {tab === "budget" && data.manage && <BudgetPanel items={items} />}
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
          고스펙 <input inputMode="decimal" value={s.highRatio} onChange={(e) => setS({ ...s, highRatio: num(e.target.value) })} /> : 100
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
      <h2 className="panel-title ps-rules-title">판매 중 {items.filter((it) => it.enabled).length}</h2>
      <ul className="ps-item-rules">
        {items
          .filter((it) => it.enabled)
          .map((it) => (
            <ItemRule key={it.id} it={it} settings={settings} busy={busy} run={run} />
          ))}
      </ul>
      {items.some((it) => !it.enabled) && (
        <>
          <h2 className="panel-title ps-rules-title">판매 중지 {items.filter((it) => !it.enabled).length}</h2>
          <ul className="ps-item-rules">
            {items
              .filter((it) => !it.enabled)
              .map((it) => (
                <li key={it.id} className="panel ps-rule ps-rule-off">
                  <img src={SHOP_PIC + it.tile} alt="" />
                  <span className="ps-rule-main">
                    <b>
                      {it.name}
                      {it.count > 1 && ` ×${it.count}`}
                    </b>
                  </span>
                  <button
                    className="pill pill-on"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          saveShopItem(it.id, {
                            enabled: true,
                            ratio: it.custom ? it.ratio : null,
                            highRatio: it.custom ? it.highRatio : null,
                            limitCount: it.custom ? it.limitCount : null,
                            limitWeeks: it.custom ? it.limitWeeks : null,
                          }),
                        `${it.name} 다시 판매해요.`,
                      )
                    }
                  >
                    다시 판매
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}

function ItemRule({ it, settings, busy, run }: {
  it: ShopItem;
  settings: ShopSettings;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => void;
}) {
  const [ratio, setRatio] = useState(it.ratio !== settings.ratio ? String(it.ratio) : "");
  const [highRatio, setHighRatio] = useState(it.highRatio !== settings.highRatio ? String(it.highRatio) : "");
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
        {/* 첫 줄은 비율 ('1군 5 : 100'처럼 무엇인지 보이게), 둘째 줄은 한도와 단추 (제작자 요청) */}
        <span className="ps-rule-inputs">
          1군
          <input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder={String(settings.ratio)} aria-label="1군 비율" />: 100
          <i className="ps-rule-gap" />
          고스펙
          <input inputMode="decimal" value={highRatio} onChange={(e) => setHighRatio(e.target.value)} placeholder={String(settings.highRatio)} aria-label="고스펙 비율" />: 100
        </span>
        <span className="ps-rule-inputs">
          <input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder={String(settings.limitWeeks)} aria-label="주" />주에
          <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder={String(settings.limitCount)} aria-label="개" />개
          <span className="ps-rule-side">
            <button
              className="pill"
              disabled={busy}
              onClick={() => run(() => saveShopItem(it.id, { enabled: true, ratio: opt(ratio), highRatio: opt(highRatio), limitCount: opt(count), limitWeeks: opt(weeks) }), `${it.name} 저장했어요.`)}
            >
              저장
            </button>
            <button
              className="pill"
              disabled={busy}
              onClick={() => run(() => saveShopItem(it.id, { enabled: false, ratio: opt(ratio), highRatio: opt(highRatio), limitCount: opt(count), limitWeeks: opt(weeks) }), `${it.name} 판매를 멈췄어요.`)}
            >
              판매 중지
            </button>
          </span>
        </span>
      </span>
    </li>
  );
}

/**
 * 예산 (오피서 이상, 제작자 요청): 오픈 전에 길드 자금이 얼마나 들지 미리 본다. 1군, 고스펙 인원과 기간을 적으면
 * 모두 판매 중인 물건을 한도까지 산다고 치고, 길드가 내는 몫(시중가 - 할인가)과 자금이 몇 주 버티는지 보인다
 */
function BudgetPanel({ items }: { items: ShopItem[] }) {
  const [fund, setFund] = useState("");
  const [n, setN] = useState("20");
  const [h, setH] = useState("3");
  const [weeks, setWeeks] = useState("4");
  const int = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const b = budget(items, int(n), int(h), Math.max(1, int(weeks)));
  const fundGold = int(fund) * 10_000;
  const lasts = b.perWeek > 0 && fundGold > 0 ? fundGold / b.perWeek : null;
  return (
    <>
      <section className="panel ps-settings">
        <h2 className="panel-title">예산 계산</h2>
        <p className="form-note">
          시중가 100만 골드 물건을 80만 골드에 넘기면 80만 골드는 길드에 다시 들어와요. 그래서 길드 자금에서 줄어드는 건 차액 20만 골드뿐이고, 아래 부담은 이 차액만 더한 값이에요.
        </p>
        <label>
          길드 자금 <input className="ps-wide" inputMode="numeric" value={fund} onChange={(e) => setFund(e.target.value.replace(/\D/g, ""))} placeholder="5000" /> 만 골드
        </label>
        <label>
          1군 <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} /> 명 · 고스펙
          <input inputMode="numeric" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ""))} /> 명
        </label>
        <label>
          기간 <input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value.replace(/\D/g, ""))} /> 주
        </label>
      </section>
      <div className="ps-ledger">
        <div className="panel">
          <b>{int(weeks) || 1}주 동안 길드 부담 (차액)</b>
          <span className="ps-gold">{gold(b.cost)}</span>
          <small>시중가로 {gold(b.market)} - 받는 골드 {gold(b.gold)}</small>
          <small>주당 {gold(Math.round(b.perWeek))}</small>
        </div>
        <div className="panel">
          <b>자금이 버티는 기간</b>
          <span className="ps-gold">{lasts === null ? "-" : `${lasts >= 100 ? "100주 넘게" : `${lasts.toFixed(1)}주`}`}</span>
          <small>
            쓰는 플래티넘 <img src={SHOP_PIC + "plat.png"} alt="" /> {b.plat.toLocaleString("ko-KR")}
          </small>
        </div>
      </div>
      <ul className="ps-orders">
        {b.rows.slice(0, 15).map((r) => (
          <li key={r.it.id} className="panel ps-order">
            <span className="ps-order-main">
              <b>
                {r.it.name}
                {r.it.count > 1 && ` ×${r.it.count}`}
              </b>
              <small>
                한 사람 {r.buys}개 · {r.it.limitWeeks}주에 {r.it.limitCount}개
              </small>
              <small>
                한 개 시중 {goldWords(r.it.marketGold)} → 1군 {goldWords(r.it.gold)} · 고스펙 {goldWords(r.it.highGold)}
              </small>
            </span>
            <span className="ps-gold">-{gold(Math.round(r.cost))}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
