import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { errorText } from "../auth";
import { ago, goldText, goldWords } from "../market";
import { PLAT_PACKS, SHOP_PIC, actOrder, adviseShop, budget, discount, fetchShop, goldOf, orderItem, packsFor, packsOf, packsWithin, saveShopItem, saveShopSettings } from "../platshop";
import type { ShopData, ShopItem, ShopOption, ShopOrder, ShopSettings, Wallet } from "../platshop";
import { Loading, TopBar } from "../ui";
import { WEEK } from "../week";

type Tab = "shop" | "mine" | "pending" | "ledger" | "settings" | "budget";
const STATUS: Record<ShopOrder["status"], string> = { requested: "신청함", done: "거래 완료", cancelled: "취소" };

/** 25만 골드처럼 (만 골드 아래는 반올림) */
const gold = (n: number) => `${goldWords(Math.round(n / 10_000) * 10_000)} 골드`;

/** 남은 때: '3일 13시간 20분' (1분 아래는 '곧') */
function leftText(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  if (m <= 0) return "곧";
  const parts = [[Math.floor(m / 1440), "일"], [Math.floor((m % 1440) / 60), "시간"], [m % 60, "분"]] as const;
  return parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`).join(" ");
}

/**
 * 내 플래티넘 지갑 (제작자 요청: 말 대신 눈으로). 남은 플래티넘, 그리고 다음 지급(목요일 오전 10시)까지 지난 만큼 차는 막대와
 * '3일 13시간 20분 뒤 +300'. 30초마다 다시 세고, 지급 때가 지나면 상점을 다시 불러 늘어난 플래티넘을 보인다
 */
function WalletBox({ wallet, high, onDue }: { wallet: Wallet; high: boolean; onDue: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= wallet.nextAt) onDue();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [wallet.nextAt, onDue]);
  const left = wallet.nextAt - now;
  const done = Math.min(1, Math.max(0, 1 - left / WEEK));
  const gem = <img src={SHOP_PIC + "plat.png"} alt="플래티넘" />;
  return (
    <div className="ps-week">
      <span className="ps-week-top">
        내 플래티넘 {gem} <b className="ps-week-balance">{wallet.balance.toLocaleString("ko-KR")}</b>
        {high && <em className="ps-week-tag">고스펙</em>}
      </span>
      {wallet.weekly > 0 ? (
        <>
          <span className="ps-week-next">
            <span className="ps-week-bar" role="progressbar" aria-label="다음 지급까지" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
              <i style={{ width: `${done * 100}%` }} />
            </span>
            <b className="ps-week-gift">
              {gem}+{wallet.weekly.toLocaleString("ko-KR")}
            </b>
          </span>
          <small className="ps-week-left">
            <b>{leftText(left)}</b> 뒤 +{wallet.weekly.toLocaleString("ko-KR")} · 목요일 오전 10시
          </small>
        </>
      ) : (
        <small className="ps-week-left">1군 길드원에게 매주 목요일 오전 10시에 지급돼요</small>
      )}
    </div>
  );
}

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
      {/* 내 플래티넘 지갑 (제작자 요청: 1군에게 매주 300씩 가상 플래티넘을 지급하고 쌓인다. 고스펙은 따로) */}
      {data.wallet && <WalletBox wallet={data.wallet} high={high} onDue={load} />}
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
                  {/* 플래티넘은 그림에 적힌 값 그대로 지갑에서 빠지고 게임에서는 할인된 골드만 내서, 그림 값은 그대로 둔다 (제작자 요청) */}
                  <span className="ps-tile">
                    <img src={SHOP_PIC + it.tile} alt={it.name} loading="lazy" />
                  </span>
                  {/* 시중가에 줄, 1군 할인가와 고스펙 할인가. 내게 맞는 값만 진하게 (제작자 요청) */}
                  <span className="ps-price">
                    <s>{goldWords(it.marketGold)}</s>
                    <em>-{discount(myGold(it), it.marketGold)}%</em>
                  </span>
                  <span className={"ps-price-row" + (high ? " ps-dim" : " ps-strong")}>1군 {goldWords(it.gold)}</span>
                  <span className={"ps-price-row" + (high ? " ps-strong" : " ps-dim")}>고스펙 {goldWords(it.highGold)}</span>
                  {data.wallet && it.plat > data.wallet.balance && <small className="ps-limit">플래티넘 부족</small>}
                </button>
              </li>
            ))}
          </ul>
          {item && (
            <div className="ps-buy">
              {/* 게임의 'i' 정보창처럼 들어 있는 아이템 (제작자가 준 스샷에서 칸을 그대로 잘랐다) */}
              {item.contents && (
                <div className="ps-contents">
                  <b>
                    획득 가능한 아이템
                    {item.contents.note && <small> · {item.contents.note}</small>}
                  </b>
                  <span className="ps-contents-grid">
                    {item.contents.tiles.map((t) => (
                      <img key={t} src={SHOP_PIC + t} alt="" loading="lazy" />
                    ))}
                  </span>
                </div>
              )}
              <div className="ps-buy-row">
              <img src={SHOP_PIC + item.tile} alt="" />
              <span className="ps-buy-name">
                <b>
                  {item.name}
                  {item.count > 1 && ` ×${item.count}`}
                </b>
                <small>
                  플래티넘 {item.plat.toLocaleString("ko-KR")} · <s>{gold(item.marketGold)}</s> → <b>{goldText(myGold(item))} 골드</b>
                  {high && " (고스펙)"}
                </small>
                {data.wallet && (
                  <small>
                    내 플래티넘 {data.wallet.balance.toLocaleString("ko-KR")} → 사면 {Math.max(0, data.wallet.balance - item.plat).toLocaleString("ko-KR")}
                  </small>
                )}
              </span>
              <button
                className="pill pill-on"
                disabled={busy || !data.main || !item.enabled || (!!data.wallet && item.plat > data.wallet.balance)}
                onClick={() => run(() => orderItem(item.id), "구매 신청했어요. 오피서가 게임에서 거래해 줄 거예요.")}
              >
                {!data.main ? "1군 전용" : data.wallet && item.plat > data.wallet.balance ? "플래티넘 부족" : "구매 신청"}
              </button>
              </div>
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

      {tab === "budget" && data.manage && <BudgetPanel settings={s} busy={busy} run={run} />}
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

/** 통 설정 (비율, 시중가, 주당 플래티넘, 오픈)과 물건마다 판매 여부, 따로 정한 비율 */
function ShopSettingsPanel({ settings, items, busy, run }: {
  settings: ShopSettings;
  items: ShopItem[];
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => void;
}) {
  // 칸에는 적은 글자를 그대로 둔다 (숫자로 바로 바꾸면 칸을 비울 때 'NaN' 이 되어 다시 적을 수 없었다). 저장할 때 숫자로 바꾼다
  const [f, setF] = useState({
    ratio: String(settings.ratio),
    highRatio: String(settings.highRatio),
    market: String(settings.market),
    weekPlat: String(settings.weekPlat),
    highWeekPlat: String(settings.highWeekPlat),
  });
  const [open, setOpen] = useState(settings.open);
  const field = (k: keyof typeof f, decimal = true) => ({
    inputMode: decimal ? ("decimal" as const) : ("numeric" as const),
    value: f[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(decimal ? /[^\d.]/g : /\D/g, "") }),
  });
  function save() {
    run(async () => {
      if (Object.values(f).some((v) => v.trim() === "")) throw new Error("빈 칸을 채워 주세요");
      const n = (v: string) => Number(v);
      return saveShopSettings({
        ...settings,
        ratio: n(f.ratio),
        highRatio: n(f.highRatio),
        market: n(f.market),
        weekPlat: n(f.weekPlat),
        highWeekPlat: n(f.highWeekPlat),
        open,
      });
    }, "저장했어요.");
  }
  return (
    <>
      <section className="panel ps-settings">
        <h2 className="panel-title">통 설정</h2>
        <p className="form-note">비율은 플래티넘 100을 몇 만 골드에 넘기는지예요.</p>
        <label>
          1군 <input {...field("ratio")} /> : 100
        </label>
        <label>
          고스펙 <input {...field("highRatio")} /> : 100
        </label>
        <label>
          시중 <input {...field("market")} /> : 100
        </label>
        {/* 매주 지급하는 가상 플래티넘 (제작자 요청: 1군 300, 고스펙은 따로) */}
        <label>
          주당 지급 1군 <input {...field("weekPlat", false)} /> · 고스펙
          <input {...field("highWeekPlat", false)} /> 플래티넘
        </label>
        <div className="mk-chips">
          <button className={"pill" + (open ? " pill-on" : "")} onClick={() => setOpen(!open)}>
            {open ? "오픈" : "오픈 전"}
          </button>
          <button className="pill pill-on" disabled={busy} onClick={save}>
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
  const opt = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <li className="panel ps-rule">
      <img src={SHOP_PIC + it.tile} alt="" />
      <span className="ps-rule-main">
        <b>
          {it.name}
          {it.count > 1 && ` ×${it.count}`}
        </b>
        {/* 첫 줄은 비율 ('1군 5 : 100'처럼 무엇인지 보이게), 둘째 줄은 단추 (제작자 요청) */}
        <span className="ps-rule-inputs">
          1군
          <input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder={String(settings.ratio)} aria-label="1군 비율" />: 100
          <i className="ps-rule-gap" />
          고스펙
          <input inputMode="decimal" value={highRatio} onChange={(e) => setHighRatio(e.target.value)} placeholder={String(settings.highRatio)} aria-label="고스펙 비율" />: 100
        </span>
        <span className="ps-rule-inputs">
          <span className="ps-rule-side">
            <button
              className="pill"
              disabled={busy}
              onClick={() => run(() => saveShopItem(it.id, { enabled: true, ratio: opt(ratio), highRatio: opt(highRatio) }), `${it.name} 저장했어요.`)}
            >
              저장
            </button>
            <button
              className="pill"
              disabled={busy}
              onClick={() => run(() => saveShopItem(it.id, { enabled: false, ratio: opt(ratio), highRatio: opt(highRatio) }), `${it.name} 판매를 멈췄어요.`)}
            >
              판매 중지
            </button>
          </span>
        </span>
      </span>
    </li>
  );
}

/** 원스토어 할인율 빠른 고르기 (그때그때 달라서 직접 적을 수도 있다) */
const STORE_OFFS = [18, 20, 30];
const OFF_KEY = "sapphire-store-off";
/** 현금 1원이 몇 골드인지 (제작자 요청: 처음 75) */
const RATE_KEY = "sapphire-won-gold";
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const man = (n: number) => `${goldWords(Math.round(n / 10_000) * 10_000)} 골드`;

function saved(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 못 적어도 지금 화면에서는 그대로 쓴다
  }
}

/** 손익: +면 이득(초록), -면 손해(빨강) */
function Gain({ v, className = "" }: { v: number; className?: string }) {
  const r = Math.round(v / 10_000) * 10_000;
  if (r === 0) return <b className={"ps-review-gain " + className}>0</b>;
  return (
    <b className={"ps-review-gain " + className + (r > 0 ? " ps-up" : " ps-down")}>
      {r > 0 ? "+" : "-"}
      {man(Math.abs(r))} {r > 0 ? "이득" : "손해"}
    </b>
  );
}

/**
 * 예산 검토 (오피서 이상, 제작자 요청 2026-10-31). 맨 위에서 충전할 양을 정한다: 현금(게임 상점 정가로 얼마어치 충전) 또는 플래티넘 몇 개.
 * 상점 상품마다 충전 비율이 달라서 현금이면 그 돈 안에서 플래티넘이 가장 많은 상품 조합(packsWithin), 개수면 그만큼을 가장 싸게(packsFor).
 * 비우면 길드원이 사 갈 만큼. 원스토어 할인(그때그때 다르다)은 실제 결제액에만 든다. 1군과 고스펙이 지금 설정대로 주당 플래티넘을 다 사 가면:
 * 구매(플래티넘, 쓴 돈) | 판매(들어오는 골드, 남는 플래티넘은 1군 비율로 골드로) | 손익(쓴 돈을 1원 = 75골드처럼 골드로 바꿔 견준다).
 * 할인율과 골드 비율은 이 폰에 기억한다. 아래 AI 도우미에게 상황을 말하면 통 설정 안을 몇 개 내고, 고르면 상점이 그대로 설정된다
 */
function BudgetPanel({ settings, busy, run }: { settings: ShopSettings; busy: boolean; run: (fn: () => Promise<unknown>, done?: string) => void }) {
  const [n, setN] = useState("20");
  const [h, setH] = useState("3");
  const [weeks, setWeeks] = useState("4");
  const [off, setOff] = useState(() => saved(OFF_KEY, "20"));
  const [goldRate, setGoldRate] = useState(() => saved(RATE_KEY, "75"));
  /** 충전할 양: 현금(상점 정가, 비우면 길드원이 사 갈 만큼) 또는 상품마다 − + 로 개수 고르기 (제작자 요청) */
  const [mode, setMode] = useState<"won" | "pick">("won");
  const [amount, setAmount] = useState("");
  const [counts, setCounts] = useState<number[]>(() => PLAT_PACKS.map(() => 0));
  /** AI 도우미 (제작자 요청): 물은 글, 받은 조언과 안 */
  const [question, setQuestion] = useState("");
  const [advice, setAdvice] = useState<{ answer: string; options: ShopOption[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const int = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const w = Math.max(1, int(weeks));
  const rate = Math.min(90, Math.max(0, Number(off) || 0));
  const perWon = Math.max(0, Number(goldRate) || 0);
  const want = int(amount);
  /** 통 설정 하나로 셈한 결과 (지금 설정, 그리고 AI 안마다 같은 셈) */
  const review = (st: ShopSettings) => {
    const bb = budget(st, int(n), int(h), w);
    const by = mode === "pick" ? packsOf(counts) : want > 0 ? packsWithin(want) : packsFor(bb.plat);
    const pd = Math.round(by.won * (1 - rate / 100));
    const sd = Math.min(by.plat, bb.plat);
    const part = bb.plat > 0 ? sd / bb.plat : 0;
    const lg = goldOf(by.plat - sd, st.ratio);
    return { b: bb, buy: by, paid: pd, spentGold: pd * perWon, sold: sd, soldPart: part, left: by.plat - sd, leftGold: lg, inGold: bb.gold * part + lg };
  };
  const now = review(settings);
  const b = now.b;
  const buy = now.buy;
  /** 상품 고르기로 넘어가면 지금 조합의 개수를 그대로 가져와 거기서 손본다 */
  const pick = () => {
    setCounts(PLAT_PACKS.map((k) => buy.packs.find((p) => p.plat === k.plat)?.count ?? 0));
    setMode("pick");
  };
  const step = (i: number, d: number) => setCounts(counts.map((c, j) => (j === i ? Math.max(0, Math.min(99, c + d)) : c)));
  /** 쓴 돈과 그 골드, 길드원이 사 가는 만큼(산 것보다 많이는 못 산다)과 남는 플래티넘(1군 비율로 골드로, 제작자 요청) */
  const { paid, spentGold, soldPart, left, leftGold, inGold } = now;
  const optionSettings = (o: ShopOption): ShopSettings => ({ ...settings, ratio: o.ratio, highRatio: o.highRatio, weekPlat: o.weekPlat, highWeekPlat: o.highWeekPlat });
  const isNow = (o: ShopOption) =>
    o.ratio === settings.ratio && o.highRatio === settings.highRatio && o.weekPlat === settings.weekPlat && o.highWeekPlat === settings.highWeekPlat;
  async function ask() {
    setAsking(true);
    setAskError("");
    try {
      setAdvice(
        await adviseShop(question, {
          일군_인원: int(n), 고스펙_인원: int(h), 기간_주: w, 원스토어_할인_퍼센트: rate, 현금1원당_골드: perWon,
          사는_플래티넘: buy.plat, 정가_원: buy.won, 결제액_원: paid, 길드원이_사_갈_플래티넘: b.plat, 남는_플래티넘: left,
          들어오는_골드: Math.round(inGold), 쓴_돈_골드: spentGold, 손익_골드: Math.round(inGold - spentGold),
        }),
      );
    } catch (x) {
      setAskError(errorText(x));
    } finally {
      setAsking(false);
    }
  }
  /** 1군, 고스펙 따로: 쓴 돈을 산 플래티넘 중 그쪽이 사 간 만큼으로 나눠 친다 */
  const share = (plat: number) => (buy.plat > 0 ? (paid * plat) / buy.plat : 0);
  const gem = <img src={SHOP_PIC + "plat.png"} alt="" />;
  return (
    <>
      <section className="panel ps-settings">
        <h2 className="panel-title">예산 검토</h2>
        {/* 충전할 양이 맨 위 (제작자 요청): 현금으로 얼마어치, 또는 상품마다 개수 고르기 */}
        <div className="mk-chips">
          <button className={"pill" + (mode === "won" ? " pill-on" : "")} onClick={() => setMode("won")}>
            현금으로 충전
          </button>
          <button className={"pill" + (mode === "pick" ? " pill-on" : "")} onClick={pick}>
            상품 고르기
          </button>
        </div>
        {mode === "won" ? (
          <>
            <label className="ps-charge">
              충전
              <input
                className="ps-charge-input"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="110000"
              />{" "}
              원어치
              {/* 바로 오른쪽에 원스토어 할인 뒤 실제로 내는 돈 (제작자 요청) */}
              <b className="ps-charge-paid">→ {won(paid)}</b>
            </label>
            <small className="ps-charge-sum">
              {want > 0 ? `원스토어 ${rate}% 할인 뒤 결제액` : "비우면 길드원이 사 갈 만큼"}
              {want > buy.won && ` · 남는 돈 ${won(want - buy.won)}`}
            </small>
          </>
        ) : (
          <>
            {/* 게임 상점 상품마다 − + (제작자 요청) */}
            <ul className="ps-packs ps-pick">
              {PLAT_PACKS.map((k, i) => (
                <li key={k.plat} className={counts[i] ? "ps-pick-on" : ""}>
                  <span>
                    {gem}
                    {k.plat.toLocaleString("ko-KR")}개
                  </span>
                  <b>{won(k.won)}</b>
                  <span className="ps-step">
                    <button onClick={() => step(i, -1)} disabled={!counts[i]} aria-label={`${k.plat}개 하나 빼기`}>
                      −
                    </button>
                    <em>{counts[i]}</em>
                    <button onClick={() => step(i, 1)} aria-label={`${k.plat}개 하나 더`}>
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="ps-charge">
              {gem}
              {buy.plat.toLocaleString("ko-KR")} · 정가 {won(buy.won)}
              <b className="ps-charge-paid">→ {won(paid)}</b>
            </p>
          </>
        )}
        <label>
          원스토어 할인
          <input
            inputMode="decimal"
            value={off}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, "").slice(0, 4);
              setOff(v);
              remember(OFF_KEY, v);
            }}
          />{" "}
          %
        </label>
        <div className="mk-chips">
          {STORE_OFFS.map((v) => (
            <button
              key={v}
              className={"pill" + (rate === v ? " pill-on" : "")}
              onClick={() => {
                setOff(String(v));
                remember(OFF_KEY, String(v));
              }}
            >
              {v}%
            </button>
          ))}
        </div>
        <label>
          1군 <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} /> 명 · 고스펙
          <input inputMode="numeric" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ""))} /> 명
        </label>
        <label>
          기간 <input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value.replace(/\D/g, ""))} /> 주
        </label>
        <label>
          현금 : 골드 = 1 :
          <input
            inputMode="decimal"
            value={goldRate}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, "").slice(0, 6);
              setGoldRate(v);
              remember(RATE_KEY, v);
            }}
          />
        </label>
      </section>
      <div className="ps-review">
        <div className="panel">
          <b>구매</b>
          <span>
            {gem}
            {buy.plat.toLocaleString("ko-KR")}
          </span>
          <span className="ps-review-big">{won(paid)}</span>
          <small>
            원스토어 {rate}% · 정가 {won(buy.won)}
          </small>
        </div>
        <div className="panel">
          <b>판매</b>
          <span>길드원이 다 사 가면</span>
          <span className="ps-review-big">{man(inGold)}</span>
          {left > 0 && (
            <small>
              남는 {gem}
              {left.toLocaleString("ko-KR")} = {man(leftGold)} 포함
            </small>
          )}
          {buy.plat < b.plat && (
            <small className="ps-down">
              {gem}
              {(b.plat - buy.plat).toLocaleString("ko-KR")} 모자라요
            </small>
          )}
        </div>
        <div className="panel">
          <b>손익</b>
          <span>쓴 돈 = {man(spentGold)}</span>
          <Gain v={inGold - spentGold} className="ps-review-big" />
          <small>1원 = {perWon}골드</small>
        </div>
      </div>
      {/* 사는 상품: 결과 카드 바로 아래, 게임 상점 칸처럼 '13,000개 ×7' (제작자 요청) */}
      <section className="panel ps-buy-packs">
        <h3>
          사는 상품 <small>{gem}
          {buy.plat.toLocaleString("ko-KR")} · 정가 {won(buy.won)}</small>
        </h3>
        <ul className="ps-packs">
          {buy.packs.map((k) => (
            <li key={k.plat}>
              <span>
                {gem}
                {k.plat.toLocaleString("ko-KR")}개
              </span>
              <b>{won(k.won)}</b>
              <em>×{k.count}</em>
            </li>
          ))}
        </ul>
      </section>
      {/* AI 도우미 (제작자 요청): 상황을 말하면 설정 안을 몇 개 내고, 고르면 상점이 그대로 설정된다. 손익은 화면이 같은 셈으로 다시 계산 */}
      <section className="panel ps-ai">
        <h3>AI 도우미</h3>
        <textarea
          className="mk-input ps-ai-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, 1000))}
          placeholder="예: 이번에 현금 60만 원 결제하고 플래티넘이 3,000개 남아 있어요. 고스펙 혜택은 늘리되 손해는 안 보게 맞춰 줘"
        />
        <button className="pill pill-on" disabled={asking || !question.trim()} onClick={ask}>
          {asking ? "생각하는 중…" : "물어보기"}
        </button>
        {askError && <p className="form-error">{askError}</p>}
        {advice && (
          <>
            <p className="ps-ai-answer">{advice.answer}</p>
            <ul className="ps-ai-options">
              {advice.options.map((o, i) => {
                const r = review(optionSettings(o));
                const current = isNow(o);
                return (
                  <li key={i} className={"panel" + (current ? " ps-ai-now" : "")}>
                    <b>{o.label}</b>
                    <span>
                      1군 {o.ratio}:100 · 고스펙 {o.highRatio}:100
                    </span>
                    <span>
                      주당 {gem}
                      {o.weekPlat.toLocaleString("ko-KR")} · 고스펙 {gem}
                      {o.highWeekPlat.toLocaleString("ko-KR")}
                    </span>
                    <Gain v={r.inGold - r.spentGold} />
                    <small>{o.reason}</small>
                    <button
                      className="pill pill-on"
                      disabled={busy || current}
                      onClick={() => run(() => saveShopSettings(optionSettings(o)), `'${o.label}' 안으로 상점을 설정했어요.`)}
                    >
                      {current ? "지금 설정" : "이 안으로 설정"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <ul className="ps-review-groups">
        {b.rows.map((r) => (
          <li key={r.name} className="panel">
            <b>
              {r.name} {r.people}명
            </b>
            <small>
              {gem}
              {Math.round(r.plat * soldPart).toLocaleString("ko-KR")} · {r.ratio}:100 · 들어오는 골드 {man(r.gold * soldPart)}
            </small>
            <Gain v={r.gold * soldPart - share(r.plat * soldPart) * perWon} />
          </li>
        ))}
      </ul>
    </>
  );
}
