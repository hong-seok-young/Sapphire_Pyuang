// 확률 시뮬레이터 (개발중, 제작자 요청 2026-11-04). 자료와 규칙은 src/sim.ts (컴투스 공식 확률 표 106개).
// 맨 위 같은 폭 단추 강화 · 성장 · 옵션 · 보석 · 뽑기, 그 아래 어두운 띠에서 고르고, 해 보면서 확률을 몸으로 느끼게 결과마다 짧은 움직임(transform·opacity 만)을 준다.
// 아이템은 우리가 가진 그림으로 그린다 (제작자 2026-11-04 '텍스트 말고 우리 가지고 있는 이미지 써', src/simIcons.ts). 그림이 없는 것만 글자. 강화 장면 이미지·동영상을 받으면 sim-item 자리를 그 모양으로 바꾼다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAsync } from "../data";
import { loadOdds } from "../odds";
import type { Odds } from "../odds";
import { useEntryState } from "../router";
import { BOX_CATS, atLeast, boxFor, boxesOf, expectedTo, gemBox, gemIdOf, gemKinds, gemSynth, optTitle, optionFor, optionSources, pick, repairItems, scrollsOf, stepsExpected, stepsOf, tierOf } from "../sim";
import type { Box, Dist, OptItem, OptSource, Part, Scroll, Steps } from "../sim";
import { FitLine, Loading, PicImg, TopBar } from "../ui";
import { ARMOR_SLOTS, CLEAR_LV, GEAR_JOBS, canBuy, gearOf, gearPower, gearStat, gearValue, repairCost, spendRun, startRun, unlockCost } from "../simGear";
import type { ArmorSlot, Gear, GearJob, Held } from "../simGear";
import type { Wiki } from "../types";
import { JOB_NAME } from "../auth";
import type { Me } from "../auth";
import { Nick } from "../kakao";
import { CoinCtx, SpaceCtx, fetchBoard, luckOf, reachWithin, sendFeed, sendPromo, sendRecord, stepsWithin, upGame, useCoinState, useCoins, useRecord, weekGame } from "../simRank";
import type { Board, Cat, CoinState, FeedRow, SimRec, Space } from "../simRank";
import { BAG_MAX, SaveCtx, addGems, addOwned, expOf, gemOf, ownedGear, raiseExp, useKept, useSave, useSaveState } from "../simState";
import type { SimSave } from "../simState";
import { QuestCtx, kstDay, todayQuests, useQuest } from "../simQuest";
import type { SimEvent } from "../simQuest";
import { FEED_EVERY, GRADES, rankOf, tierAt, tierOfXp, tierProgress } from "../simTier";
import type { Tier } from "../simTier";
import { RankBadge, eraColor, fxOf } from "./SimBadge";
import { api } from "../auth";
import { fetchEventOdds } from "../official";
import { IconCtx, iconLookup, useIcon } from "../simIcons";
import { useBook } from "../data";
import { filterByName } from "../search";
import type { IconOf } from "../simIcons";
import type { Pic } from "../types";
import type { Book } from "../data";
import { useBackClose } from "../backClose";
import "./sim.css";

type Tab = "enhance" | "grow" | "option" | "gem" | "box" | "rank";
const TABS: { key: Tab; label: string }[] = [
  { key: "enhance", label: "강화" },
  { key: "grow", label: "속성" },
  { key: "option", label: "옵션" },
  { key: "gem", label: "보석" },
  { key: "box", label: "뽑기" },
  { key: "rank", label: "순위" },
];

/** 0.05 -> '5%', 0.00348 -> '0.348%', 아주 작으면 '0.0001% 미만' */
export function pctText(p: number): string {
  if (p >= 1) return "100%";
  if (p <= 0) return "0%";
  const v = p * 100;
  // 0.1% 보다 작으면 '1/66.7만' 처럼 (몇 번에 한 번인지가 더 와닿는다)
  if (p < 0.001) return `1/${n0(1 / p)}`;
  const d = v >= 10 ? 1 : v >= 1 ? 2 : 3;
  return `${Number(v.toFixed(d))}%`;
}
// 1억 ~ 10억은 '1.1억' (예전에는 '10667만'으로 보였다)
const n0 = (v: number) => (v >= 1e8 ? `${Number((v / 1e8).toFixed(v >= 1e9 ? 0 : 1))}억` : v >= 1e5 ? `${(v / 1e4).toFixed(v >= 1e6 ? 0 : 1)}만` : Math.round(v).toLocaleString());

/** 숫자가 바뀌면 잠깐 굴러가며 바뀐다 */
function Count({ value, ms = 500 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  // 지금 화면에 보이는 값: 굴러가는 도중에 값이 또 바뀌면 여기서부터 이어 간다.
  // (예전에는 굴러가기가 끝나야 시작 값을 바꿔서, 자동처럼 빨리 바뀌면 매번 옛 값으로 돌아갔다가 다시 올라가 숫자가 줄었다 늘었다 했다)
  const cur = useRef(value);
  useEffect(() => {
    const a = cur.current;
    if (a === value) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      cur.current = k < 1 ? a + (value - a) * e : value;
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{n0(shown)}</>;
}

/** 결과마다 한 번 터지는 조각 (자리와 방향은 CSS 변수로) */
function Sparks({ n = 10, kind }: { n?: number; kind: string }) {
  const parts = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
        const r = 38 + Math.random() * 34;
        return { dx: Math.cos(a) * r, dy: Math.sin(a) * r - 10, d: Math.random() * 0.12 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind],
  );
  return (
    <span className={`sim-sparks sim-sparks-${kind}`} aria-hidden>
      {parts.map((s, i) => (
        <i key={i} style={{ ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px`, animationDelay: `${s.d}s` }} />
      ))}
    </span>
  );
}

/** 이름으로 찾은 우리 그림 (없으면 아무것도 안 그린다) */
function NameIcon({ name, size = 24 }: { name: string; size?: number }) {
  const pic: Pic | null = useIcon()(name);
  return pic ? <PicImg pic={pic} fit={size} className="sim-pic" /> : null;
}

/** 그림 칸: 그림이 없으면 도트 보석 */
function IconBox({ name, size = 30 }: { name: string; size?: number }) {
  const pic: Pic | null = useIcon()(name);
  return <span className="sim-ib" style={{ width: size + 8, height: size + 8 }}>{pic ? <PicImg pic={pic} fit={size} className="sim-pic" /> : <i className="sim-ib-none" />}</span>;
}

/** 확률 막대: 칸마다 색 (ok 성공 · gold 대성공 · bad 파괴 · keep 그대로), 아래에 이름과 % */
function OddsBar({ parts }: { parts: { p: number; tone: "ok" | "gold" | "bad" | "keep"; label: string }[] }) {
  const shown = parts.filter((x) => x.p > 0);
  return (
    <div className="sim-odds">
      <div className="sim-odds-bar" aria-hidden>
        {shown.map((x, i) => (
          <i key={i} className={`sim-odds-${x.tone}`} style={{ flexGrow: Math.max(x.p, 0.012) }} />
        ))}
      </div>
      <div className="sim-odds-lab">
        {shown.map((x, i) => (
          <span key={i} className={`sim-odds-t-${x.tone}`}>
            {x.label} <b>{pctText(x.p)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 숫자 셋 한 줄 띠 */
function StatStrip({ items }: { items: { label: string; value: number; tone?: string; unit?: string }[] }) {
  return (
    <div className="sim-stats">
      {items.map((x) => (
        <span key={x.label}>
          <small>{x.label}</small>
          <b className={x.value ? (x.tone ?? "") : ""}>
            <Count value={x.value} ms={250} />
            {x.unit ?? ""}
          </b>
        </span>
      ))}
    </div>
  );
}

/** 접는 칸 (연 것은 기록 칸마다 기억) */
function Fold({ k, title, children }: { k: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useEntryState(`sim.fold.${k}`, false);
  return (
    <section className={"panel sim-fold" + (open ? " sim-fold-open" : "")}>
      <button type="button" className="sim-fold-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{title}</b>
        <i className="sim-chev" aria-hidden />
      </button>
      {open && <div className="sim-fold-b">{children}</div>}
    </section>
  );
}

/** 한 줄 단추 띠 (제작자 2026-11-19 '버튼들이 두 줄로 돼 있는 거 싹 한 줄로'): 칸이 같은 폭으로 한 줄에. 줄이 바뀌지 않는다 */
function Seg<T extends string | number>({ items, value, onPick, extra, className = "" }: { items: readonly (readonly [T, React.ReactNode])[]; value: T | null; onPick: (k: T) => void; extra?: React.ReactNode; className?: string }) {
  return (
    <div className={`sim-row sim-row-${Math.min(9, items.length + (extra ? 1 : 0))} ${className}`} role="tablist">
      {items.map(([k, l]) => (
        <button key={String(k)} type="button" role="tab" aria-selected={k === value} className={"sub-tab" + (k === value ? " sub-tab-on" : "")} onClick={() => onPick(k)}>
          {l}
        </button>
      ))}
      {extra}
    </div>
  );
}

/** 잠긴 단추를 누르면 잠깐 뜨는 안내 (제작자 2026-11-19 '비활성화 상태에서 누르면 안내가 뜨게 해야지'). 화면에 늘 적어 두는 설명 대신 눌렀을 때만 */
const TipCtx = createContext<(text: string) => void>(() => undefined);
const useTip = () => useContext(TipCtx);
const NO_COIN = "코인이 모자라요";
/** 단추 안의 코인 값 (제작자 2026-11-19 '비용 드는 모든 버튼은 들어가는 비용을 적어 줘야지'): 한 번 값, per 이면 한 번마다, avg 면 평균 */
function Cost({ n, per = false, avg = false }: { n: number; per?: boolean; avg?: boolean }) {
  return (
    <small className={"sim-cost" + (per || avg ? " sim-cost-sub" : "")}>
      {per ? "회당 " : avg ? "평균 " : ""}
      <i className="sim-c" aria-hidden />
      {n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}
    </small>
  );
}
/** 잠길 수 있는 단추: lock 에 까닭이 있으면 흐리게 보이고, 눌러도 일은 안 하고 그 까닭을 띄운다 (disabled 로 두면 눌러도 아무 일이 없어 왜 안 되는지 모른다) */
function Act({ lock, onClick, className = "btn", children, busy = false, ...rest }: { lock?: string | false | null; onClick: () => void; className?: string; children: React.ReactNode; busy?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className" | "children" | "disabled" | "type">) {
  const tip = useTip();
  return (
    <button type="button" {...rest} className={className + (lock ? " sim-lock" : "")} aria-disabled={lock ? true : undefined} disabled={busy} onClick={() => (lock ? tip(lock) : onClick())}>
      {children}
    </button>
  );
}

export function SimulatorPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const space: Space = "live";
  const { data: odds, error } = useAsync(useCallback(() => loadOdds(), []), "odds");
  const [tabRaw, setTab] = useEntryState<Tab>("sim.tab", "enhance");
  const tab: Tab = TABS.some((t) => t.key === tabRaw) ? tabRaw : "enhance";
  const coin = useCoinState();
  // 진행 상황 (장비, 보관함, 직접 겪은 것): 서버에 (src/simState.ts). 지갑을 받으면 시작, 쓴 코인과 같이 모아서 보낸다
  const saveState = useSaveState(coin.queueState, coin.wallet ? ((coin.wallet.state as SimSave | null) ?? null) : undefined);
  const today =
    (coin.wallet?.rules.reduce((t, r) => t + r.n * r.coin, 0) ?? 0) + (coin.wallet?.quests.filter(Boolean).length ?? 0) * (coin.wallet?.questCoin ?? 0) + (coin.wallet?.streak?.bonus ?? 0);
  // 오늘의 도전 (src/simQuest.ts): 결과마다 알리면 맞는 도전을 깨고 코인을 받는다.
  // 화면을 켜 둔 채 0시가 지나면 새 날의 도전으로 바꾼다 (예전에는 어제 도전을 깨면 오늘 같은 번호 도전의 코인이 들어갔다)
  const { reload } = coin;
  const [day, setDay] = useState(kstDay);
  const quests = useMemo(() => todayQuests(day), [day]);
  const [done, setDone] = useState<boolean[]>([false, false, false]);
  const doneRef = useRef(done);
  const doneDay = useRef(day);
  useEffect(() => {
    if (!coin.wallet) return;
    // 서버 값에 이 화면에서 막 깬 것을 더한다 (보낸 도전이 서버에 닿기 전에 지갑을 다시 받으면 깬 표시가 풀리고 축하가 또 떴다)
    const now = kstDay();
    const mine = doneDay.current === now ? doneRef.current : [false, false, false];
    doneDay.current = now;
    setDay(now);
    doneRef.current = coin.wallet.quests.map((x, i) => x || !!mine[i]);
    setDone(doneRef.current);
  }, [coin.wallet]);
  const [cheer, setCheer] = useState<{ text: string; n: number } | null>(null);
  const emit = useCallback(
    (e: SimEvent) => {
      if (kstDay() !== day) {
        reload();
        return;
      }
      quests.forEach((q, i) => {
        if (doneRef.current[i] || !q.done(e)) return;
        doneRef.current = doneRef.current.map((x, j) => x || j === i);
        setDone(doneRef.current);
        setCheer((c) => ({ text: q.text, n: (c?.n ?? 0) + 1 }));
        api<{ coins: number; got: boolean }>("/api/sim/wallet", "POST", { quest: i }).then(() => reload(), () => undefined);
      });
    },
    [quests, day, reload],
  );
  useEffect(() => {
    if (!cheer) return;
    const t = window.setTimeout(() => setCheer(null), 2600);
    return () => window.clearTimeout(t);
  }, [cheer]);
  // 전광판·오늘 번 코인은 2분마다 다시 (보고 있을 때만, 가벼운 답으로: docs/무료한도.md)
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && reload(), 120_000);
    return () => window.clearInterval(t);
  }, [reload]);
  // 계급 (src/simTier.ts): 명성(쓴 코인)이 오르면 그 자리에서 승급. 새 칭호(다섯 계급마다)는 크게 축하한다
  const tier = useMemo(() => tierOfXp(coin.xp), [coin.xp]);
  const seenTier = useRef<number | null>(null);
  const [promo, setPromo] = useState<{ n: number; k: number; big: boolean } | null>(null);
  useEffect(() => {
    if (!coin.wallet) return;
    const was = seenTier.current;
    seenTier.current = tier.n;
    if (was === null || tier.n <= was) return;
    // 한꺼번에 여러 계급을 넘었으면 그 사이에 새 칭호가 있었는지 본다
    const big = Math.floor(tier.n / GRADES) > Math.floor(was / GRADES);
    setPromo((p) => ({ n: tier.n, k: (p?.k ?? 0) + 1, big }));
    // 전광판에는 계급장 그림이 바뀔 때만 (칭호 넷마다: 칭호마다 알리면 전광판이 승급으로 찬다)
    if (Math.floor(tier.n / FEED_EVERY) > Math.floor(was / FEED_EVERY)) void sendPromo(Math.floor(tier.n / FEED_EVERY) * FEED_EVERY);
  }, [tier.n, coin.wallet]);
  useEffect(() => {
    if (!promo) return;
    const t = window.setTimeout(() => setPromo(null), promo.big ? 3400 : 1700);
    return () => window.clearTimeout(t);
  }, [promo]);
  const [earnOpen, setEarnOpen] = useState(false);
  // 잠긴 단추를 누르면 그 까닭이 잠깐 (같은 글을 또 눌러도 다시 톡 뜬다)
  const [tip, setTip] = useState<{ text: string; n: number } | null>(null);
  const showTip = useCallback((text: string) => setTip((t) => ({ text, n: (t?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!tip) return;
    const t = window.setTimeout(() => setTip(null), 2400);
    return () => window.clearTimeout(t);
  }, [tip]);
  // 위키에 없는 물건(코스튬 등)의 그림 목록 (시세 동향 그림, 없으면 위키 그림만)
  const [trendPics, setTrendPics] = useState<Record<string, [number, number]> | null>(null);
  useEffect(() => {
    fetch("/data/trend/index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => v && typeof v === "object" && setTrendPics(v))
      .catch(() => {});
  }, []);
  const book = useBook();
  const iconOf: IconOf = useMemo(() => iconLookup(wiki, trendPics, book), [wiki, trendPics, book]);
  return (
    <SpaceCtx.Provider value={space}>
    <SaveCtx.Provider value={saveState}>
    <CoinCtx.Provider value={coin}>
      <QuestCtx.Provider value={emit}>
      <IconCtx.Provider value={iconOf}>
      <TipCtx.Provider value={showTip}>
      <TopBar title="확률 시뮬레이터" />
      <div className="pill-row sim-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <SimHud coin={coin} tier={tier} up={promo?.k ?? 0} quests={quests} done={done} onRank={() => setTab("rank")} onCoin={() => setEarnOpen(true)} />
      {earnOpen && <CoinSheet coin={coin} today={today} onClose={() => setEarnOpen(false)} />}
      {cheer && (
        <div key={cheer.n} className="sim-cheer" role="status">
          <b>+{coin.wallet?.questCoin ?? 30}</b>
          <span>{cheer.text}</span>
        </div>
      )}
      {promo?.big && <PromoToast key={promo.k} n={promo.n} />}
      {tip && (
        <div key={tip.n} className="sim-tip" role="status">
          {tip.text}
        </div>
      )}
      {!odds || !saveState.ready ? (
        <Loading error={error} />
      ) : tab === "enhance" ? (
        <EnhanceTab odds={odds} wiki={wiki} me={me} />
      ) : tab === "grow" ? (
        <StatSim odds={odds} wiki={wiki} />
      ) : tab === "option" ? (
        <OptionSim odds={odds} wiki={wiki} me={me} />
      ) : tab === "gem" ? (
        <GemTab odds={odds} />
      ) : tab === "box" ? (
        <BoxSim odds={odds} />
      ) : (
        <RankTab me={me} />
      )}
      </TipCtx.Provider>
      </IconCtx.Provider>
      </QuestCtx.Provider>
    </CoinCtx.Provider>
    </SaveCtx.Provider>
    </SpaceCtx.Provider>
  );
}

/** 계급 이름 색과 테두리 단계 (계급장과 같은 재질 색) */
const tierStyle = (t: Tier) => {
  const c = eraColor(t.era);
  return { ["--rk-c" as string]: c.c, ["--rk-l" as string]: c.l } as React.CSSProperties;
};

/** 맨 위 한 줄: 코인(누르면 버는 곳) · 계급장과 계급, 다음 계급까지 막대(누르면 순위) · 오늘의 도전 점 셋(누르면 펼침), 그 아래 전광판 */
function SimHud({ coin, tier, up, quests, done, onRank, onCoin }: { coin: CoinState; tier: Tier; up: number; quests: { id: string; text: string }[]; done: boolean[]; onRank: () => void; onCoin: () => void }) {
  const w = coin.wallet;
  const empty = coin.coins === 0;
  const [open, setOpen] = useEntryState("sim.quests", false);
  // 코인이 바뀐 만큼 잠깐 떠오른다
  const prev = useRef<number | null>(coin.coins);
  const [delta, setDelta] = useState<{ v: number; n: number } | null>(null);
  useEffect(() => {
    const a = prev.current;
    prev.current = coin.coins;
    if (a === null || coin.coins === null || a === coin.coins) return;
    const v = coin.coins - a;
    setDelta((d) => ({ v, n: (d?.n ?? 0) + 1 }));
  }, [coin.coins]);
  return (
    <section className={"sim-hud" + (empty ? " sim-hud-empty" : "")}>
      <div className="sim-hud-row">
        <button type="button" className="sim-hud-coin" onClick={onCoin} aria-label="행운 코인">
          <span className="sim-coin-pic" aria-hidden>
            <i />
          </span>
          <b key={coin.coins ?? -1}>{coin.coins === null ? "…" : coin.coins.toLocaleString()}</b>
          {delta && (
            <em key={delta.n} className={"sim-hud-delta" + (delta.v > 0 ? " sim-hud-plus" : "")} aria-hidden>
              {delta.v > 0 ? "+" : ""}
              {delta.v.toLocaleString()}
            </em>
          )}
        </button>
        {/* 승급하면 그 자리에서 계급장과 이름이 톡 튄다 (새 칭호만 가운데 크게) */}
        <button key={up} type="button" className={"sim-hud-rank" + (up ? " sim-hud-up" : "")} onClick={onRank} aria-label={`계급 ${tier.name}`} style={tierStyle(tier)}>
          {w && <RankBadge n={tier.n} size={24} />}
          <span className="sim-hud-rk">
            <FitLine text={w ? tier.name : ""} wrap={false} className="sim-hud-rkname" />
            <i className="sim-hud-bar" aria-hidden>
              <i style={{ transform: `scaleX(${tierProgress(coin.xp, tier).toFixed(4)})` }} />
            </i>
          </span>
        </button>
        <button type="button" className="sim-hud-q" aria-expanded={open} aria-label="오늘의 도전" onClick={() => setOpen(!open)}>
          {quests.map((q, i) => (
            <i key={q.id} className={done[i] ? "on" : ""} />
          ))}
        </button>
      </div>
      {open && (
        <div className="sim-hud-quests">
          {quests.map((q, i) => (
            <span key={q.id} className={done[i] ? "sim-q-done" : ""}>
              <i className="sim-q-box" aria-hidden />
              {q.text}
              <small>+{w?.questCoin ?? 30}</small>
            </span>
          ))}
        </div>
      )}
      {w && w.feed.length > 0 && <Ticker feed={w.feed} />}
    </section>
  );
}

/** 전광판: 길드원들의 드문 결과와 승급이 오른쪽에서 왼쪽으로 흐른다 (닉네임 앞에 계급장) */
function Ticker({ feed }: { feed: FeedRow[] }) {
  const items = feed.map((f, i) => {
    if (f.game === "rank") {
      const t = tierAt(Number(f.label) || 0);
      return (
        <span key={i} className="sim-tick sim-tick-up" style={tierStyle(t)}>
          <RankBadge n={t.n} size={14} still />
          <Nick name={f.user_id} /> <b>{t.title}</b>
        </span>
      );
    }
    return (
      <span key={i} className="sim-tick">
        <RankBadge n={rankOf(f.xp ?? 0)} size={14} still />
        <Nick name={f.user_id} /> <b>{f.label}</b>
      </span>
    );
  });
  return (
    <div className="sim-ticker" aria-label="전광판">
      <div className="sim-ticker-run" style={{ animationDuration: `${Math.max(12, feed.length * 5)}s` }}>
        {items}
        {items}
      </div>
    </div>
  );
}

/** 새 칭호 (다섯 계급마다): 계급장이 가운데에 빛살과 함께 크게 떴다 사라진다. 그 사이 계급은 맨 위 줄에서 그 자리 그대로 톡 튄다 */
function PromoToast({ n }: { n: number }) {
  const t = tierAt(n);
  return (
    <div className="rk-promo rk-promo-big" role="status" style={tierStyle(t)}>
      <i className="rk-promo-rays" aria-hidden />
      <RankBadge n={n} size={64} />
      <span className="rk-promo-t">
        <small>새 칭호</small>
        <b>{t.name}</b>
      </span>
      <Sparks kind="plus2" n={22} />
    </div>
  );
}

/** 코인 버는 곳 (맨 위 코인을 누르면): 오늘 번 코인 · 연속 접속과 버는 일마다 +코인, 오늘 n/한도 (누르면 그 화면). 바깥·✕·폰 뒤로 가기로 닫는다 */
function CoinSheet({ coin, today, onClose }: { coin: CoinState; today: number; onClose: () => void }) {
  useBackClose(true, onClose);
  const w = coin.wallet;
  const streak = w?.streak;
  return createPortal(
    <div className="sim-sheet-back" onClick={onClose} role="presentation">
      <section className="sim-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="코인 벌기">
        <div className="sim-sheet-h">
          <span className="sim-coin-pic" aria-hidden>
            <i />
          </span>
          <b>{coin.coins === null ? "…" : coin.coins.toLocaleString()}</b>
          {today > 0 && <i className="sim-hud-today">+{today.toLocaleString()}</i>}
          {streak && streak.days >= 2 && <i className="sim-hud-streak">{streak.days}일</i>}
          <button type="button" className="sim-shop-x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {w && (
          <div className="sim-earn-grid">
            {streak && (
              <div className={"sim-earn-cell sim-earn-streak" + (streak.bonus ? "" : " sim-earn-wait")}>
                <span>연속 접속</span>
                <b>{streak.bonus ? `+${streak.bonus}` : `+${streak.step}`}</b>
                <small>{streak.days}일</small>
              </div>
            )}
            {w.rules.map((r) => {
              const body = (
                <>
                  <span>{r.label}</span>
                  <b>+{r.coin}</b>
                  <small>
                    {r.n}/{r.cap}
                  </small>
                  <i className="sim-earn-bar" aria-hidden>
                    <i style={{ transform: `scaleX(${Math.min(1, r.n / r.cap)})` }} />
                  </i>
                </>
              );
              const cls = "sim-earn-cell" + (r.n >= r.cap ? " sim-earn-done" : "");
              return r.to && r.n < r.cap ? (
                <a key={r.key} className={cls} href={r.to}>
                  {body}
                </a>
              ) : (
                <div key={r.key} className={cls}>
                  {body}
                </div>
              );
            })}
            {w.sold && (
              <div className={"sim-earn-cell" + (w.sold.n >= w.sold.cap ? " sim-earn-done" : "")}>
                <span>장비 팔기</span>
                <b>시세</b>
                <small>
                  {w.sold.n}/{w.sold.cap}
                </small>
                <i className="sim-earn-bar" aria-hidden>
                  <i style={{ transform: `scaleX(${Math.min(1, w.sold.n / w.sold.cap)})` }} />
                </i>
              </div>
            )}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** 시뮬레이터 안의 작은 순위: 이번 주 기록 3위까지와 내 기록 (제작자 2026-11-19 '한 번 1위 먹으면 무한정 1위는 안 되게': 주마다 새로).
 *  cost 면 쓴 코인(적을수록 위)과 마법서 수, 아니면 몇 번 만에. 기록이 없으면 그리지 않는다 (step 이 있으면 머리만: 강화도를 바꿔 볼 수 있게) */
export function RankBox({ rec, title, cost = false, step }: { rec: ReturnType<typeof useRecord>; title: string; cost?: boolean; step?: React.ReactNode }) {
  const d = rec.data;
  const top = d?.board.slice(0, 3) ?? [];
  const mine = d?.mine ?? null;
  if (!step && !top.length && !mine) return null;
  const row = (r: SimRec, rank: number, me = false) => (
    <div key={me ? "me" : r.user_id} className={`sim-rank-row sim-rank-${rank}` + (me ? " sim-rank-mine" : "")}>
      <em>{rank}</em>
      {!me && <RankBadge n={rankOf(r.xp ?? 0)} size={16} still />}
      <span className="sim-rank-who">{me ? "나" : <Nick name={r.user_id ?? ""} />}</span>
      <b className="sim-rank-v">
        {cost && <i className="sim-c" aria-hidden />}
        {cost ? (-r.score).toLocaleString() : `${r.tries.toLocaleString()}번`}
      </b>
    </div>
  );
  return (
    <section className="panel sim-rank">
      <div className="sim-head">
        <b>이번 주</b>
        <small>{title}</small>
        {step}
      </div>
      {top.map((r, i) => row(r, i + 1))}
      {mine && (mine.rank ?? 99) > 3 && row(mine, mine.rank ?? 99, true)}
    </section>
  );
}

const WEEKDAY = "일월화수목금토";
const dayText = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]})`;
};

/** 순위 한 줄: 등수 · 계급장 · 닉네임과 계급 이름. 재질이 오를수록 줄의 테두리와 움직임이 더해진다 (sim.css .rk-row) */
function RankRow({ pos, who, xp, gain, mine }: { pos: number | null; who: string; xp: number; gain?: number; mine?: boolean }) {
  const t = tierOfXp(xp);
  return (
    <div className={`rk-row rk-f${fxOf(t.era)} rk-e${t.era}` + (mine ? " rk-row-me" : "") + (pos !== null && pos <= 3 ? ` rk-top-${pos}` : "")} style={tierStyle(t)}>
      <i className="rk-row-fx" aria-hidden />
      <em className="rk-pos">{pos ?? "-"}</em>
      <RankBadge n={t.n} size={28} />
      <span className="rk-who">
        <span className="rk-nick">
          <Nick name={who} />
        </span>
        <small className="rk-name">{t.name}</small>
      </span>
      {gain !== undefined && <b className="rk-gain">+{gain.toLocaleString()}</b>}
    </div>
  );
}

/** 순위 칸 (제작자 2026-11-19 '종류별로 순위 다 만들지 말고 통합 랭킹', '계급으로만', '기간을 두든 무기한·기간으로 나누든'):
 *  내 계급 카드(계급장, 다음 계급까지)와 이번 주 · 전체 순위. 순위는 명성(쓴 코인) 하나로, 전체는 계급 순·이번 주는 이번 주에 쌓은 명성 순 */
function RankTab({ me }: { me: Me }) {
  const coin = useCoins() as CoinState;
  const [data, setData] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useEntryState<"week" | "all">("sim.rmode", "week");
  useEffect(() => {
    fetchBoard().then(setData, (e) => setErr(String(e)));
  }, []);
  const tier = tierOfXp(coin.xp);
  const next = tierAt(tier.n + 1);
  if (!data) return <Loading error={err} />;
  const rows = mode === "week" ? data.week : data.all;
  const inList = rows.some((r) => r.user_id === me.id);
  const myPos = mode === "week" ? data.me?.weekRank : data.me?.rank;
  const myGain = Math.max(coin.weekXp, data.me?.week ?? 0);
  return (
    <div className="sim">
      <section className={`panel rk-card rk-f${fxOf(tier.era)} rk-e${tier.era}`} style={tierStyle(tier)}>
        <i className="rk-row-fx" aria-hidden />
        <RankBadge n={tier.n} size={62} />
        <div className="rk-card-t">
          <b key={tier.n} className="rk-card-name">
            {tier.name}
          </b>
          <div className="rk-card-bar" aria-hidden>
            <i style={{ transform: `scaleX(${tierProgress(coin.xp, tier).toFixed(4)})` }} />
          </div>
          <small className="rk-card-xp">
            <b>{coin.xp.toLocaleString()}</b> / {next.from.toLocaleString()}
          </small>
        </div>
        <span className="rk-card-next" aria-label={`다음 계급 ${next.name}`}>
          <RankBadge n={next.n} size={26} still dim />
        </span>
      </section>
      <div className="mk-sub sim-strip">
        <Seg
          items={
            [
              ["week", "이번 주"],
              ["all", "전체"],
            ] as const
          }
          value={mode}
          onPick={setMode}
        />
      </div>
      {mode === "week" && (
        <p className="rk-period">
          {dayText(data.wk)} ~ {dayText(data.wk + 7 * 86_400_000)}
        </p>
      )}
      <div className="rk-list">
        {rows.map((r, i) => (
          <RankRow key={r.user_id} pos={i + 1} who={r.user_id} xp={mode === "week" ? (r.total ?? r.xp) : r.xp} gain={mode === "week" ? r.xp : undefined} mine={r.user_id === me.id} />
        ))}
        {!inList && data.me && (mode === "all" || myGain > 0) && <RankRow pos={myPos ?? null} who={me.id} xp={coin.xp} gain={mode === "week" ? myGain : undefined} mine />}
      </div>
    </div>
  );
}

/** 강화 도감 (2026-11-17 고도화): 장비마다 닿은 가장 높은 강화도 (팔거나 부서져도 남는다). 직업 · 부위를 한 줄씩 고른다 (강화 칸의 접는 칸 '도감') */
const DEX_SLOTS = ["무기", ...ARMOR_SLOTS] as const;
function GearDex({ gears, me, best }: { gears: Gear[]; me: Me; best: Record<string, number> }) {
  const myJob = (me.job ? JOB_NAME[me.job] : "전사") as GearJob;
  const [job, setJob] = useEntryState<GearJob>("sim.dexjob", myJob);
  const [slot, setSlot] = useEntryState<string>("sim.dexslot", "무기");
  const list = gears.filter((g) => g.jobs.includes(job) && (slot === "무기" ? g.part === "무기" : g.part === "갑옷" && g.kind === slot));
  return (
    <>
      <div className="mk-sub sim-strip sim-dex-strip">
        <Seg items={GEAR_JOBS.map((j) => [j, j] as const)} value={job} onPick={setJob} />
        <Seg items={DEX_SLOTS.map((x) => [x as string, x] as const)} value={slot} onPick={setSlot} />
      </div>
      <ul className="sim-dex-grid" aria-label={`${job} ${slot}`}>
        {list.map((g) => {
          const lv = best[g.name] ?? 0;
          return (
            <li key={g.name} className={lv ? `sim-dex-got sim-aura-${auraOf(lv)}` : "sim-dex-none"} title={`${g.name} Lv.${g.lv}`}>
              <span className="sim-dex-pic">{g.icon ? <PicImg pic={g.icon} fit={30} className="sim-pic" /> : <small>{g.name.slice(0, 3)}</small>}</span>
              <b>{lv ? `+${lv}` : "?"}</b>
              <small>Lv.{g.lv}</small>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ================================================================ 강화

/** 강화 칸: 맨 위 한 줄 무기 강화 · 방어구 강화. 수리는 따로 칸을 두지 않고 강화하다 부서진 장비에서 한다
 *  (제작자 2026-11-19 '강화하다 파괴된 것을 수리하게 하자, 파괴도 안 됐는데 수리할 수 없잖아': 예전에는 무기 수리 · 방어구 수리 칸에서 아무 때나 굴렸다) */
function EnhanceTab({ odds, wiki, me }: { odds: Odds; wiki: Wiki; me: Me }) {
  const [part, setPart] = useEntryState<Part>("sim.part", "무기");
  const head = <Seg items={[["무기", "무기 강화"] as const, ["갑옷", "방어구 강화"] as const]} value={part} onPick={setPart} />;
  // 부위를 바꾸면 그 부위의 장비·목표로 새로 시작한다 (key)
  return <EnhanceSim key={part} odds={odds} head={head} wiki={wiki} me={me} part={part} />;
}

interface Fx {
  /** ok 성공, keep 실패(그대로), break 파괴, plus2 대성공, buy 새로 산 장비 */
  kind: "ok" | "keep" | "break" | "plus2" | "buy";
  n: number;
  /** 크게 터뜨릴 성공 (드문 성공이나 높은 강화) */
  big?: boolean;
}
type LogDot = { to: number; ok: boolean; broke?: boolean; plus?: number };
/** 두근두근 한 번: 확률 p, 바늘이 멈출 자리(0~1, p 보다 왼쪽이면 성공), 걸리는 때 */
interface Charge {
  p: number;
  stop: number;
  dur: number;
  ok: boolean;
  n: number;
}
/** 모루 둘레에 떠오르는 불티 (가로 자리 %, 늦게 시작 s, 한 번 도는 때 s, 크기 px). 늘 도는 움직임이라 transform·opacity 만 */
const EMBERS: [number, number, number, number][] = [
  [8, 0, 5.2, 3], [18, 1.6, 6.1, 2], [31, 0.4, 4.6, 3], [44, 2.2, 5.8, 2], [57, 1.1, 5.1, 3], [69, 2.9, 6.4, 2], [82, 0.8, 4.9, 3], [93, 2.4, 5.5, 2], [25, 3.3, 7, 2], [75, 3.8, 6.8, 2],
];
/** 강화도마다 빛 단계: +4 파랑, +7 보라, +9 금빛, +11 무지개 */
const auraOf = (lv: number) => (lv >= 11 ? 4 : lv >= 9 ? 3 : lv >= 7 ? 2 : lv >= 4 ? 1 : 0);

/** 확률 게이지: 왼쪽 p 만큼이 성공 칸. 바늘이 흔들리다 점점 느려져 정해진 자리에 멈춘다 (결과는 누를 때 이미 정해져 있다) */
function Gauge({ c, keep, onDone }: { c: Charge; keep: boolean; onDone: () => void }) {
  const needle = useRef<HTMLElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => done.current(), 200);
      return () => window.clearTimeout(t);
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / c.dur);
      // 흔들림: 처음엔 크게 빠르게, 끝으로 갈수록 작고 느리게 멈출 자리로
      const amp = 0.55 * (1 - k) ** 1.6;
      const x = Math.min(1, Math.max(0, c.stop + amp * Math.sin(k * Math.PI * 2 * (5 - 3 * k))));
      if (needle.current) needle.current.style.transform = `translateX(${(x * 100).toFixed(2)}%)`;
      if (k < 1) raf = requestAnimationFrame(tick);
      else window.setTimeout(() => done.current(), 160);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [c]);
  return (
    <div className="sim-gauge" aria-hidden>
      <div className="sim-gauge-bar">
        <i className="sim-gauge-ok" style={{ width: `max(3px, ${(c.p * 100).toFixed(3)}%)` }} />
        <i className={"sim-gauge-no" + (keep ? " sim-gauge-keep" : "")} />
        <span className="sim-gauge-track">
          <b ref={needle} className="sim-needle" />
        </span>
      </div>
      <div className="sim-gauge-lab">
        <span className="sim-good">{pctText(c.p)}</span>
        <span className={keep ? "sim-muted" : "sim-bad"}>{keep ? "유지" : "파괴"}</span>
      </div>
    </div>
  );
}

/** 장비 상점: 실제 장비를 +0(노작)으로 산다. 레벨이 높을수록 비싸다 (src/simGear.ts) */
function GearShop({ gears, part, job, setJob, slot, setSlot, onBuy, coins, onClose, cleared, bag, onTake, valueOf, onSell }: {
  gears: Gear[];
  /** 내 장비 (보관함): 다른 장비를 사거나 꺼내도 남는다 (src/simState.ts) */
  bag: Held[];
  onTake: (i: number) => void;
  /** 장비 시세 (simGear.ts gearValue)와 보관함 장비 팔기 (2026-11-17) */
  valueOf: (g: Gear, lv: number) => number;
  onSell: (i: number, value: number) => void;
  cleared: Set<string>;
  part: Part;
  job: GearJob;
  setJob: (j: GearJob) => void;
  slot: ArmorSlot;
  setSlot: (s: ArmorSlot) => void;
  onBuy: (g: Gear) => void;
  coins: number | null;
  onClose?: () => void;
}) {
  const list = gears.filter((g) => g.part === part && g.jobs.includes(job) && (part === "무기" || g.kind === slot));
  // 보관함 장비 팔기는 두 번 눌러야 한다 (한 번 누르면 3초 동안 '정말 팔기')
  const [sellIdx, setSellIdx] = useState(-1);
  useEffect(() => {
    if (sellIdx < 0) return;
    const t = window.setTimeout(() => setSellIdx(-1), 3000);
    return () => window.clearTimeout(t);
  }, [sellIdx]);
  const openList = list.filter((_, i) => canBuy(list, i, cleared));
  const locked = list.filter((_, i) => !canBuy(list, i, cleared));
  const tip = useTip();
  return (
    <section className="panel sim-shop">
      <div className="mk-sub sim-shop-filter">
        <Seg
          items={GEAR_JOBS.map((j) => [j, j] as const)}
          value={job}
          onPick={setJob}
          className="sim-row-x"
          extra={
            onClose && (
              <button type="button" className="sim-shop-x" onClick={onClose} aria-label="닫기">
                ✕
              </button>
            )
          }
        />
        {part === "갑옷" && <Seg items={ARMOR_SLOTS.map((x) => [x, x] as const)} value={slot} onPick={setSlot} />}
      </div>
      {bag.length > 0 && (
        <>
          <div className="sim-head sim-head-sub">
            <b>내 장비</b>
            <small>{bag.length}</small>
          </div>
          <ul className="sim-shop-list sim-bag">
            {bag.map((h, i) => {
              const g = gears.find((x) => x.part === part && x.name === h.name);
              const v = g ? valueOf(g, h.lv) : 0;
              return (
                <li key={`${h.name}-${i}`} className={`sim-bag-${auraOf(h.lv)}`}>
                  <span className="sim-shop-pic">{g?.icon ? <PicImg pic={g.icon} fit={28} className="sim-pic" /> : null}</span>
                  <span className="sim-shop-name">
                    <b>
                      <em>+{h.lv}</em> {h.name}
                    </b>
                    <small>{g ? gearStat(g, h.lv) : ""}</small>
                  </span>
                  {v > 0 && (
                    <button type="button" className={"sim-mini sim-sell" + (sellIdx === i ? " sim-sell-sure" : "")} onClick={() => (sellIdx === i ? (setSellIdx(-1), onSell(i, v)) : setSellIdx(i))}>
                      {sellIdx === i ? "팔기?" : "팔기"} <small>{v.toLocaleString()}</small>
                    </button>
                  )}
                  <button type="button" className="sim-mini sim-take" onClick={() => onTake(i)}>
                    꺼내기
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="sim-head sim-head-sub">
            <b>상점</b>
          </div>
        </>
      )}
      <ul className="sim-shop-list">
        {openList.map((g) => (
          <li key={g.name}>
            <span className="sim-shop-pic">{g.icon ? <PicImg pic={g.icon} fit={28} className="sim-pic" /> : null}</span>
            <span className="sim-shop-name">
              <b>{g.name}</b>
              <small>
                Lv.{g.lv} · {gearStat(g, 0)}
              </small>
            </span>
            {cleared.has(g.name) && <span className="sim-shop-clear">+{CLEAR_LV[part]}</span>}
            <Act className="sim-buy" busy={coins === null} lock={coins !== null && coins < g.price && `코인이 ${(g.price - coins).toLocaleString()} 모자라요`} onClick={() => onBuy(g)}>
              <i className="sim-c" aria-hidden />
              {g.price}
            </Act>
          </li>
        ))}
        {!list.length && <li className="sim-muted">없음</li>}
      </ul>
      {locked.length > 0 && (
        <ul className="sim-locked" aria-label="잠김">
          {locked.map((g) => (
            <li key={g.name} title={`${g.name} Lv.${g.lv}`} onClick={() => tip(`${g.name} · ${list[list.indexOf(g) - 1]?.name ?? "앞 장비"} +${CLEAR_LV[part]} 먼저`)}>
              {g.icon ? <PicImg pic={g.icon} fit={24} className="sim-pic" /> : null}
              <small>{g.lv}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EnhanceSim({ odds, head, wiki, me, part }: { odds: Odds; head: React.ReactNode; wiki: Wiki; me: Me; part: Part }) {
  const all = useMemo(() => scrollsOf(odds), [odds]);
  const gears = useMemo(() => gearOf(wiki, odds), [wiki, odds]);
  const [name, setName] = useEntryState("sim.scroll", "일반");
  const [ev, setEv] = useEntryState("sim.ev", false);
  const myJob = (me.job ? JOB_NAME[me.job] : "전사") as GearJob;
  const [job, setJob] = useEntryState<GearJob>("sim.gjob", myJob);
  const [slot, setSlot] = useEntryState<ArmorSlot>("sim.gslot", "갑옷");
  const scroll = all.find((s) => s.part === part && s.name === name) ?? all.find((s) => s.part === part)!;
  const rates = ev && scroll.event ? scroll.event : scroll.rates;
  const rate = (lv: number) => rates[lv] ?? 0;
  // 들고 있는 장비·보관함·+8 기록·직접 겪은 것은 서버에 (src/simState.ts, 테스트판과 개발 중판 따로): 다시 열어도, 다른 폰에서도 그대로
  const { save, update } = useSave();
  const [held, setHeldState] = useState<Held | null>(() => save.held?.[part] ?? null);
  const heldRef = useRef(held);
  const setHeld = (h: Held | null, of: Part = part) => {
    heldRef.current = h;
    setHeldState(h);
    update((s) => ({ ...s, held: { ...(s.held ?? {}), [of]: h } }));
  };
  const gear = held ? gears.find((g) => g.part === part && g.name === held.name) : undefined;
  const bag = save.bag?.[part] ?? [];
  // 앞 장비를 +8(방어구 +6)까지 올려야 다음 장비를 산다 (simGear.ts CLEAR_LV)
  const cleared = useMemo(() => new Set(save.cleared ?? []), [save.cleared]);
  const shopList = (g: Gear) => gears.filter((x) => x.part === g.part && (g.part === "무기" ? x.kind === g.kind : x.kind === g.kind && x.jobs.includes(job)));
  const buyable = (g: Gear) => {
    const list = shopList(g);
    const i = list.findIndex((x) => x.name === g.name);
    return i >= 0 && canBuy(list, i, cleared);
  };
  const [shop, setShop] = useState(false);
  const lv = held?.lv ?? 0;
  const broken = held?.broken ?? false;
  // 장비 시세 (2026-11-17 고도화, simGear.ts gearValue): 지금 팔면, 다음 강화가 되면
  const valueOf = useCallback((g: Gear, k: number) => gearValue(g, k, all), [all]);
  const value = gear && !broken ? valueOf(gear, lv) : 0;
  const [selling, setSelling] = useState(false);
  useEffect(() => {
    if (!selling) return;
    const t = window.setTimeout(() => setSelling(false), 3000);
    return () => window.clearTimeout(t);
  }, [selling]);
  const [sold, setSold] = useState<{ name: string; lv: number; value: number; n: number } | null>(null);
  useEffect(() => {
    if (!sold) return;
    const t = window.setTimeout(() => setSold(null), 2600);
    return () => window.clearTimeout(t);
  }, [sold]);
  const afterSell = (h: Held, v: number) => {
    setSold((x) => ({ name: h.name, lv: h.lv, value: v, n: (x?.n ?? 0) + 1 }));
    update((s) => ({ ...s, sold: { n: (s.sold?.n ?? 0) + 1, coins: (s.sold?.coins ?? 0) + v } }));
  };
  // 들고 있는 장비 팔기 (두 번 눌러): 팔리면 빈손이 되어 상점이 열린다
  const sellHeld = async () => {
    const h = heldRef.current;
    if (!h || h.broken || !value) return;
    if (!selling) {
      setSelling(true);
      return;
    }
    setSelling(false);
    if (!(await coins.sell(value))) return;
    clearFx();
    heldRef.current = null;
    setHeldState(null);
    update((s) => ({ ...s, held: { ...(s.held ?? {}), [part]: null } }));
    afterSell(h, value);
  };
  const sellBag = async (i: number, v: number) => {
    const list = save.bag?.[part] ?? [];
    const h = list[i];
    if (!h || !(await coins.sell(v))) return;
    update((s) => ({ ...s, bag: { ...(s.bag ?? {}), [part]: (s.bag?.[part] ?? []).filter((_, j) => j !== i) } }));
    afterSell(h, v);
  };
  const [fx, setFx] = useState<Fx | null>(null);
  const [gain, setGain] = useState<{ from: string; to: string; pct: number; n: number } | null>(null);
  // 시도·부서진 장비·쓴 코인과 결과 점은 진행 상황에 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네')
  const [stats, setStats] = useKept((s) => s.enh?.n, (s, v) => ({ ...s, enh: { ...s.enh, n: v } }), { tries: 0, broke: 0, best: 0, coins: 0 });
  const [log, setLog] = useKept<LogDot[]>((s) => s.enh?.log, (s, v) => ({ ...s, enh: { ...s.enh, log: v } }), []);
  const [goal, setGoal] = useState(part === "무기" ? 8 : 6);
  // 자동은 직접 강화해 닿아 본 강화도까지만 (제작자 2026-11-04 '자동 강화는 우리가 강화해 본 곳까지만, 내가 수동으로 겪은 것만 자동으로')
  const expMax = held ? expOf(save, `enh:${held.name}`) : 0;
  const autoGoal = Math.min(goal, expMax);
  const [auto, setAuto] = useState(false);
  const coins = useCoins();
  // 장비마다 해금 (코인): 자동 강화, 자동 구매(자동 강화 중에 부서지면 같은 장비를 다시 사서 목표까지 이어 간다)
  // 자동 구매 켬/끔도 진행 상황에 (캐릭터마다)
  const autoBuy = !!save.autoBuy;
  const setAutoBuy = (v: boolean) => update((s) => ({ ...s, autoBuy: v }));
  const autoKey = held ? `auto:${held.name}` : "";
  const buyKey = held ? `buy:${held.name}` : "";
  const autoOn = !!held && coins.unlocks.has(autoKey);
  const buyOn = !!held && coins.unlocks.has(buyKey);
  const rebuyOn = autoOn && buyOn && autoBuy;
  const rebuyRef = useRef(rebuyOn);
  rebuyRef.current = rebuyOn;
  const brokeAt = useRef(0);
  const [unlocking, setUnlocking] = useState(false);
  const doUnlock = async (key: string, cost: number) => {
    setUnlocking(true);
    await coins.unlock(key, cost);
    setUnlocking(false);
  };
  // 이번 주 순위 (제작자 2026-11-19 '이 무기를 최저 비용으로 +8강까지 띄운 사람', '한 번 1위 먹으면 무한정 1위는 안 되게'): 장비 · 마법서(이벤트 확률은 따로) · 강화도마다,
  // 이번 주에 쓴 코인이 적은 순 (simRank.ts upGame: 이름 끝에 주 번호). 보는 강화도(rankLv)는 − + 로 바꾸고, 위험한 강화에 성공하면 그 강화도로 옮긴다
  const evOn = ev && !!scroll.event;
  const [rankLv, setRankLv] = useState(CLEAR_LV[part]);
  const game = held ? upGame(held.name, scroll.name, rankLv, evOn) : "";
  const rec = useRecord(game);
  const gameRef = useRef(game);
  gameRef.current = game;
  const emit = useQuest();
  // 수리하면 다시 정해지는 강화도 (공식 표 80101: 무기 · 방어구)
  const repairDist = useMemo(() => repairItems(odds).find((x) => x.name.startsWith(part === "무기" ? "무기" : "방어구"))?.opts[0] ?? null, [odds, part]);
  const [combo, setCombo] = useState(0);
  const comboRef = useRef(0);
  const [charge, setCharge] = useState<Charge | null>(null);

  const clearFx = () => {
    setFx(null);
    setGain(null);
    setSelling(false);
    setAuto(false);
    comboRef.current = 0;
    setCombo(0);
  };
  // 새로 사면 들고 있던 장비(부서지지 않은 것)는 보관함으로 (제작자 2026-11-04 '8강 참나무지팡이가 장비 바꾸기 누르니까 없어졌네')
  const buy = (g: Gear) => {
    if (!buyable(g) || coins.coins === null || coins.coins < g.price || coins.take(g.price) < g.price) return;
    clearFx();
    const cur = heldRef.current;
    const item: Held = { name: g.name, lv: 0, broken: false, tries: 0, tainted: false, ...startRun(g, cur) };
    heldRef.current = item;
    setHeldState(item);
    update((s) => {
      const list = s.bag?.[part] ?? [];
      return addOwned({ ...s, held: { ...(s.held ?? {}), [part]: item }, bag: { ...(s.bag ?? {}), [part]: cur && !cur.broken ? [cur, ...list].slice(0, BAG_MAX) : list } }, g.name);
    });
    setStats((s) => ({ ...s, coins: s.coins + g.price }));
    setShop(false);
    setFx((f) => ({ kind: "buy", n: (f?.n ?? 0) + 1 }));
  };
  // 보관함에서 꺼내기: 들고 있던 것(부서지지 않은 것)은 보관함으로
  const takeOut = (i: number) => {
    const list = [...bag];
    const [item] = list.splice(i, 1);
    if (!item) return;
    const cur = heldRef.current;
    if (cur && !cur.broken) list.unshift(cur);
    clearFx();
    heldRef.current = item;
    setHeldState(item);
    update((s) => ({ ...s, held: { ...(s.held ?? {}), [part]: item }, bag: { ...(s.bag ?? {}), [part]: list.slice(0, BAG_MAX) } }));
    setShop(false);
  };
  // 수리 (공식 표 80101 '무기/갑옷 수리 시 강화 수치 확률'): 부서진 장비를 고치면 강화도가 다시 정해진다 (무기 +1 ~ +6, 방어구 +1 ~ +4).
  // 값은 다시 사는 값의 1/4 (simGear.ts repairCost). 이번 도전의 비용은 이어서 센다
  const repair = () => {
    const h = heldRef.current;
    const g = h && gears.find((x) => x.part === part && x.name === h.name);
    if (!h || !h.broken || !g || !repairDist) return false;
    const c = repairCost(g);
    if (!coins.has(c) || coins.take(c) < c) return false;
    const got = pick(repairDist.vals);
    setHeld({ ...h, lv: got.n, broken: false, ...(h.cost === undefined ? {} : { cost: h.cost + c }) });
    setStats((s) => ({ ...s, coins: s.coins + c }));
    comboRef.current = 0;
    setCombo(0);
    setGain(null);
    setFx((f) => ({ kind: "buy", n: (f?.n ?? 0) + 1 }));
    emit({ kind: "repair", level: got.n });
    return true;
  };
  // 자동 구매: 자동 강화를 멈추지 않고 같은 장비를 다시 산다 (코인이 모자라거나 살 수 없으면 false)
  const rebuy = (g: Gear) => {
    if (!buyable(g) || !coins.has(g.price) || coins.take(g.price) < g.price) return false;
    setHeld({ name: g.name, lv: 0, broken: false, tries: 0, tainted: false, ...startRun(g, heldRef.current) });
    setStats((s) => ({ ...s, coins: s.coins + g.price }));
    comboRef.current = 0;
    setCombo(0);
    setGain(null);
    setFx((f) => ({ kind: "buy", n: (f?.n ?? 0) + 1 }));
    return true;
  };
  const choose = (s: Scroll) => {
    setName(s.name);
    const h = heldRef.current;
    if (h && h.lv > 0 && s.name !== scroll.name && !h.tainted) setHeld({ ...h, tainted: true });
  };

  const tryOnce = useCallback(
    (forced?: boolean, manual = false): boolean => {
      const h = heldRef.current;
      const g = h && gears.find((x) => x.part === scroll.part && x.name === h.name);
      if (!h || !g || h.broken) return false;
      const cur = h.lv;
      const p = rates[cur + 1] ?? 0;
      if (!(p > 0)) return false;
      if (coins.take(1) < 1) {
        setAuto(false);
        return false;
      }
      const tries = h.tries + 1;
      const ok = forced ?? Math.random() < p;
      if (p < 1) {
        comboRef.current = ok ? comboRef.current + 1 : 0;
        setCombo(comboRef.current);
      }
      // 비용 순위: 위험한 강화에 성공하면 그 강화도까지 쓴 코인을 내 최저 기록과 견주어, 더 적게 썼을 때만 보낸다
      const run = spendRun(h);
      if (ok && p < 1 && !h.tainted && run.cost !== undefined) {
        const key = upGame(g.name, scroll.name, cur + 1, evOn);
        const cost = run.cost;
        const used = run.used ?? tries;
        const best = save.cost?.[key];
        if (!best || cost < best[0] || (cost === best[0] && used < best[1])) {
          // 이번 주 기록만 남긴다 (지난주 이름의 기록은 버린다)
          const wk = key.slice(key.lastIndexOf("@"));
          update((s) => ({ ...s, cost: { ...Object.fromEntries(Object.entries(s.cost ?? {}).filter(([k]) => k.endsWith(wk))), [key]: [cost, used] } }));
          sendRecord(key, "enhance", { label: `+${cur + 1} ${g.name}`, score: -cost, tries: used, luck: luckOf(reachWithin((k) => rates[k] ?? 0, scroll.keep, cur + 1, tries)) }).then(
            () => gameRef.current === key && rec.reload(),
            () => undefined,
          );
        }
        setRankLv(cur + 1);
      }
      if (ok && !h.tainted) emit({ kind: "enh", part: scroll.part, scroll: scroll.name, level: cur + 1, combo: comboRef.current });
      setStats((s) => ({ ...s, tries: s.tries + 1, coins: s.coins + 1, broke: s.broke + (!ok && !scroll.keep && p < 1 ? 1 : 0), best: Math.max(s.best, ok ? cur + 1 : cur) }));
      setLog((l) => [...l.slice(-39), { to: cur + 1, ok, broke: !ok && !scroll.keep }]);
      // 강화 도감(best)에 닿은 강화도를 적고, 앞 장비 기준(+8·+6)에 닿으면 다음 장비를 연다
      if (ok)
        update((s) => {
          const b = s.best?.[g.name] ?? 0;
          const next = b >= cur + 1 ? s : { ...s, best: { ...(s.best ?? {}), [g.name]: cur + 1 } };
          return cur + 1 >= CLEAR_LV[scroll.part] && !(next.cleared ?? []).includes(g.name) ? { ...next, cleared: [...(next.cleared ?? []), g.name] } : next;
        });
      // 직접 눌러 닿은 강화도: 자동은 여기까지
      if (ok && manual) update((s) => raiseExp(s, `enh:${g.name}`, cur + 1));
      if (ok) {
        heldRef.current = { ...h, ...run, lv: cur + 1, tries };
        setHeld(heldRef.current, scroll.part);
        const big = p < 0.35 || cur + 1 >= (scroll.part === "무기" ? 8 : 6);
        setFx((f) => ({ kind: "ok", n: (f?.n ?? 0) + 1, big }));
        const a = gearPower(g, cur), b = gearPower(g, cur + 1);
        setGain((x) => ({ from: gearStat(g, cur), to: gearStat(g, cur + 1), pct: a ? Math.round(((b - a) / a) * 1000) / 10 : 0, n: (x?.n ?? 0) + 1 }));
      } else if (scroll.keep) {
        setHeld({ ...h, ...run, tries }, scroll.part);
        setFx((f) => ({ kind: "keep", n: (f?.n ?? 0) + 1 }));
      } else {
        brokeAt.current = Date.now();
        setHeld({ ...h, ...spendRun(h, true), tries, broken: true }, scroll.part);
        setFx((f) => ({ kind: "break", n: (f?.n ?? 0) + 1 }));
        setGain(null);
      }
      return ok || scroll.keep;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, scroll.keep, scroll.part, scroll.name, evOn, save.cost, coins, rec, emit, gears],
  );
  // 두근두근: 직접 누르면 결과를 먼저 정하고 게이지 바늘이 그 자리에 멈춘 뒤 보여 준다 (위험할수록 오래)
  const press = () => {
    const h = heldRef.current;
    if (charge || !h || h.broken || !coins.coins) return;
    const p = rates[h.lv + 1] ?? 0;
    if (!(p > 0)) return;
    if (p >= 1) {
      tryOnce(undefined, true);
      return;
    }
    const ok = Math.random() < p;
    const stop = ok ? p * (0.08 + Math.random() * 0.84) : p + (1 - p) * (0.04 + Math.random() * 0.92);
    setCharge((c) => ({ p, stop, ok, dur: p >= 0.5 ? 1000 : p >= 0.2 ? 1400 : 1900, n: (c?.n ?? 0) + 1 }));
  };
  const chargeRef = useRef<Charge | null>(null);
  chargeRef.current = charge;
  const landed = useCallback(() => {
    const c = chargeRef.current;
    chargeRef.current = null;
    setCharge(null);
    if (c) tryOnce(c.ok, true);
  }, [tryOnce]);

  // 목표까지 자동: 0.18초마다 한 번, 목표에 닿으면 멈춘다. 부서지면 멈추고, 자동 구매를 켰으면 부서지는 모습을 보인 뒤 다시 사서 이어 간다 (코인이 떨어질 때까지)
  // 타이머는 자동을 켤 때 한 번만 걸고 그때그때 가장 새 함수를 부른다 (다시 그릴 때마다 새로 걸면 간격이 들쭉날쭉해진다)
  const autoStep = useRef<() => void>(() => undefined);
  autoStep.current = () => {
    const h = heldRef.current;
    if (h?.broken) {
      const g = gears.find((x) => x.part === scroll.part && x.name === h.name);
      if (!rebuyRef.current || !g) setAuto(false);
      // 자동 수리: 부서지는 모습을 보인 뒤 수리해서 이어 간다 (수리 표가 없으면 예전처럼 다시 산다)
      else if (Date.now() - brokeAt.current >= 700 && !(repairDist ? repair() : rebuy(g))) setAuto(false);
      return;
    }
    if (!h || h.lv >= autoGoal || !(rates[h.lv + 1] > 0)) setAuto(false);
    else tryOnce();
  };
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => autoStep.current(), 180);
    return () => window.clearInterval(t);
  }, [auto]);

  const next = lv + 1;
  const p = rate(next);
  const ladder = Array.from({ length: 15 }, (_, i) => i + 1).filter((k) => rate(k) > 0);
  // 순위를 매기는 강화도: 성공이 정해져 있지 않은 곳
  const risky = ladder.filter((k) => rate(k) < 1);
  const showShop = !gear || shop;
  // 장비 바꾸기 칸은 폰 뒤로 가기로 닫는다 (들고 있는 장비가 있을 때만 닫을 수 있다, backClose.ts)
  useBackClose(!!gear && shop, () => setShop(false));
  const label = gear?.name ?? part;
  const pic = gear?.icon ?? null;
  const nameSize = pic ? " sim-icon-pic" : label.length > 7 ? " sim-icon-long" : "";

  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        {head}
        <Seg
          items={all.filter((s) => s.part === part).map((s) => [s.name, s.name] as const)}
          value={scroll.name}
          onPick={(k) => {
            const s = all.find((x) => x.part === part && x.name === k);
            if (s) choose(s);
          }}
          extra={
            <button
              type="button"
              aria-pressed={evOn}
              disabled={!scroll.event}
              className={"sub-tab sim-ev" + (evOn ? " sub-tab-on" : "")}
              onClick={() => {
                const h = heldRef.current;
                if (h && h.lv > 0 && !h.tainted) setHeld({ ...h, tainted: true });
                setEv(!ev);
              }}
            >
              이벤트
            </button>
          }
        />
      </div>

      {showShop ? (
        <GearShop
          gears={gears}
          part={part}
          job={job}
          setJob={setJob}
          slot={slot}
          setSlot={setSlot}
          onBuy={buy}
          coins={coins.coins}
          onClose={gear ? () => setShop(false) : undefined}
          cleared={cleared}
          bag={bag}
          onTake={takeOut}
          valueOf={valueOf}
          onSell={sellBag}
        />
      ) : (
        <>
          <section
            className={`panel sim-anvil${broken ? " sim-broken" : ""}${charge ? " sim-charging" : ""}${charge && charge.p < 0.2 ? " sim-risky" : ""}${fx?.big && fx.kind === "ok" ? " sim-anvil-big" : ""}${fx?.kind === "break" ? " sim-anvil-break" : ""}`}
            key={`a${fx?.kind === "break" || fx?.big ? fx.n : 0}`}
          >
            <span className="sim-rays" aria-hidden />
            <span className="sim-vignette" aria-hidden />
            <div className="sim-gearline">
              <span>
                Lv.{gear!.lv} {gear!.kind}
              </span>
              {combo >= 2 && (
                <span key={combo} className="sim-combo">
                  {combo}연속
                </span>
              )}
              {value > 0 && (
                <button type="button" className={"sim-change sim-sell" + (selling ? " sim-sell-sure" : "")} onClick={sellHeld} disabled={!!charge || auto}>
                  {selling ? "팔기?" : "팔기"} <small key={`v${lv}`} className="sim-value">{value.toLocaleString()}</small>
                </button>
              )}
              <button type="button" className="sim-change" onClick={() => setShop(true)} disabled={!!charge || auto}>
                바꾸기
              </button>
            </div>
            <span className="sim-embers" aria-hidden>
              {EMBERS.map((e, i) => (
                <i key={i} style={{ ["--x" as string]: `${e[0]}%`, ["--d" as string]: `${e[1]}s`, ["--t" as string]: `${e[2]}s`, ["--s" as string]: `${e[3]}px` }} />
              ))}
            </span>
            {fx?.kind === "ok" && fx.big && (
              <span key={`b${fx.n}`} className="sim-burst" aria-hidden>
                <i />
              </span>
            )}
            <div key={fx?.n ?? 0} className={`sim-item${fx ? ` sim-fx-${fx.kind}` : ""}`}>
              {fx && fx.kind !== "keep" && fx.kind !== "buy" && <Sparks kind={fx.big ? "plus2" : fx.kind} n={fx.kind === "break" ? 16 : fx.big ? 24 : 10} />}
              <span className="sim-ring" aria-hidden />
              <span className={`sim-frame sim-aura-${broken ? 0 : auraOf(lv)}`}>
                <i className="sim-aura" aria-hidden />
                <span key={charge ? `c${charge.n}` : "i"} className={`sim-icon${nameSize}`} style={charge ? { ["--hit" as string]: `${Math.round(charge.dur / 3)}ms` } : undefined} aria-hidden>
                  <span className="sim-half sim-half-a">{pic ? <PicImg pic={pic} fit={64} className="sim-pic" /> : label}</span>
                  <span className="sim-half sim-half-b">{pic ? <PicImg pic={pic} fit={64} className="sim-pic" /> : label}</span>
                  {broken && <i className="sim-crack" />}
                </span>
                {charge && (
                  <b key={`h${charge.n}`} className="sim-tang" style={{ ["--hit" as string]: `${Math.round(charge.dur / 3)}ms` }} aria-hidden>
                    탕!
                  </b>
                )}
              </span>
              <i className="sim-floor" aria-hidden />
              <span className="sim-nameline">
                <b key={`l${lv}${broken}`} className={"sim-lv" + (broken ? " sim-lv-dead" : "")}>
                  +{lv}
                </b>
                {pic && <span className="sim-name">{label}</span>}
              </span>
              {fx?.kind === "break" && (
                <b key={`s${fx.n}`} className="sim-stamp" aria-hidden>
                  파괴
                </b>
              )}
              {fx?.kind === "keep" && (
                <b key={`k${fx.n}`} className="sim-stamp sim-stamp-keep" aria-hidden>
                  실패
                </b>
              )}
              {fx?.kind === "ok" && fx.big && (
                <b key={`w${fx.n}`} className="sim-win" aria-hidden>
                  +{lv}
                </b>
              )}
            </div>
            {charge ? (
              <Gauge c={charge} keep={scroll.keep} onDone={landed} />
            ) : broken ? (
              repairDist && <OddsBar parts={repairDist.vals.map((x) => ({ p: x.p, tone: x.n >= 5 ? ("gold" as const) : x.n >= 4 ? ("ok" as const) : ("keep" as const), label: x.v }))} />
            ) : p > 0 ? (
              <OddsBar
                parts={[
                  { p, tone: "ok", label: `+${next}` },
                  { p: 1 - p, tone: scroll.keep ? "keep" : "bad", label: scroll.keep ? "유지" : "파괴" },
                ]}
              />
            ) : (
              <span className="sim-max">{lv >= 15 ? "MAX" : `+${next} 불가`}</span>
            )}
            {!broken && (
              <div className="sim-facts">
                <span key={gain?.n ?? 0} className={gain ? "sim-gain" : ""}>
                  <small>{part === "무기" ? "공격" : "방어"}</small>
                  <b>{gearStat(gear!, lv)}</b>
                  {gain && <em>+{gain.pct}%</em>}
                </span>
                {value > 0 && p > 0 && p < 1 && (
                  <span>
                    <small>+{next} 시세</small>
                    <b className="sim-gold">{valueOf(gear!, next).toLocaleString()}</b>
                  </span>
                )}
              </div>
            )}
          </section>

          {broken && !auto ? (
            <div className="sim-actions sim-actions-2">
              {repairDist && (
                <Act className="btn sim-go" busy={coins.coins === null} lock={(coins.coins ?? 0) < repairCost(gear!) && NO_COIN} onClick={repair}>
                  수리
                  <Cost n={repairCost(gear!)} />
                </Act>
              )}
              <Act
                className={"btn " + (repairDist ? "btn-ghost" : "sim-go")}
                busy={coins.coins === null}
                lock={!buyable(gear!) ? `앞 장비 +${CLEAR_LV[part]} 먼저` : (coins.coins ?? 0) < gear!.price && NO_COIN}
                onClick={() => buy(gear!)}
              >
                다시 사기
                <Cost n={gear!.price} />
              </Act>
              {!repairDist && (
                <button type="button" className="btn btn-ghost" onClick={() => setShop(true)}>
                  다른 장비
                </button>
              )}
            </div>
          ) : (
            <div className="sim-actions sim-actions-enh">
              <Act className="btn sim-go" busy={auto || !!charge} lock={!(p > 0) ? "더 올릴 수 없어요" : coins.coins === 0 && NO_COIN} onClick={press}>
                강화
                <Cost n={1} />
              </Act>
              {!autoOn ? (
                <Act className="btn btn-ghost sim-unlock" busy={unlocking || coins.coins === null} lock={(coins.coins ?? 0) < unlockCost(gear!, "auto") && `자동 강화 해금 · ${NO_COIN}`} onClick={() => doUnlock(autoKey, unlockCost(gear!, "auto"))}>
                  자동 해금
                  <Cost n={unlockCost(gear!, "auto")} />
                </Act>
              ) : (
                <span className="sim-goal">
                  <button type="button" className="pill" onClick={() => setGoal(Math.max(lv + 1, autoGoal - 1))} aria-label="목표 내리기">
                    −
                  </button>
                  <Act
                    className={"btn btn-ghost" + (auto ? " sim-running" : "")}
                    busy={!!charge}
                    lock={auto ? null : lv >= expMax ? `자동은 직접 띄워 본 강화까지만 · +${lv + 1} 을 직접 먼저` : lv >= autoGoal ? "목표를 올려요" : coins.coins === 0 && NO_COIN}
                    onClick={() => setAuto(!auto)}
                  >
                    {auto ? "멈춤" : lv >= expMax ? "자동" : `+${autoGoal} 자동`}
                    {!auto && <Cost n={1} per />}
                  </Act>
                  <button type="button" className="pill" onClick={() => setGoal(Math.min(15, expMax, autoGoal + 1))} aria-label="목표 올리기">
                    +
                  </button>
                </span>
              )}
              {autoOn &&
                (buyOn ? (
                  <button type="button" aria-pressed={autoBuy} className={"sim-autobuy sub-tab" + (autoBuy ? " sub-tab-on" : "")} onClick={() => setAutoBuy(!autoBuy)}>
                    자동 수리
                    <Cost n={repairDist ? repairCost(gear!) : gear!.price} per />
                  </button>
                ) : (
                  <Act className="sim-autobuy sim-unlock sub-tab" busy={unlocking || coins.coins === null} lock={(coins.coins ?? 0) < unlockCost(gear!, "buy") && `자동 수리 해금 · ${NO_COIN}`} onClick={() => doUnlock(buyKey, unlockCost(gear!, "buy"))}>
                    자동 수리 해금
                    <Cost n={unlockCost(gear!, "buy")} />
                  </Act>
                ))}
            </div>
          )}
        </>
      )}

      {sold && (
        <div key={sold.n} className="sim-cheer sim-sold" role="status">
          <b>+{sold.value.toLocaleString()}</b>
          <span>
            +{sold.lv} {sold.name}
          </span>
        </div>
      )}
      {/* 이번 도전의 비용 (제작자 2026-11-19 '+8강까지 든 비용'): 이 장비를 +0 부터 올리며 쓴 마법서 · 부서진 수 · 코인. 비용을 모르는 예전 장비는 지금까지의 합 */}
      <StatStrip
        items={
          held && held.cost !== undefined
            ? [
                { label: "마법서", value: held.used ?? 0 },
                { label: "파괴", value: held.broke ?? 0, tone: "sim-bad" },
                { label: "비용", value: held.cost, tone: "sim-gold" },
              ]
            : [
                { label: "시도", value: stats.tries },
                { label: "파괴", value: stats.broke, tone: "sim-bad" },
                { label: "코인", value: stats.coins },
              ]
        }
      />
      {log.length > 0 && (
        <div className="sim-log" aria-label="최근 결과">
          {log.map((d, i) => (
            <i key={i} className={d.ok ? "ok" : d.broke ? "bad" : "keep"} title={`+${d.to}`} />
          ))}
        </div>
      )}

      {gear && (
        <RankBox
          rec={rec}
          cost
          title={`${gear.name} · ${scroll.name}${evOn ? " 이벤트" : ""}`}
          step={
            <span className="sim-rank-step">
              <button type="button" className="pill" disabled={!risky.some((k) => k < rankLv)} onClick={() => setRankLv([...risky].reverse().find((k) => k < rankLv) ?? rankLv)} aria-label="강화도 내리기">
                −
              </button>
              <b key={rankLv}>+{rankLv}</b>
              <button type="button" className="pill" disabled={!risky.some((k) => k > rankLv)} onClick={() => setRankLv(risky.find((k) => k > rankLv) ?? rankLv)} aria-label="강화도 올리기">
                +
              </button>
            </span>
          }
        />
      )}
      <Fold k="chance" title="확률표">
        <ChanceTable rate={rate} keep={scroll.keep} ladder={ladder} from={broken ? 0 : lv} />
        <Thousand rate={rate} keep={scroll.keep} goal={goal} />
      </Fold>
      <Fold k="dex" title={`도감 ${gears.filter((g) => (save.best?.[g.name] ?? 0) > 0).length}/${gears.length}`}>
        <GearDex gears={gears} me={me} best={save.best ?? {}} />
      </Fold>
    </div>
  );
}

/** 지금 강화도에서 목표마다: 한 번에 성공할 확률, 평균 마법서, 평균 부서지는 장비 */
function ChanceTable({ rate, keep, ladder, from }: { rate: (lv: number) => number; keep: boolean; ladder: number[]; from: number }) {
  const rows = ladder
    .filter((k) => k > from && rate(k) < 1)
    .map((k) => ({ k, e: expectedTo(rate, keep, from, k) }))
    .filter((r): r is { k: number; e: NonNullable<ReturnType<typeof expectedTo>> } => !!r.e);
  if (!rows.length) return null;
  return (
    <div className="sim-table">
      <div className={"sim-th" + (keep ? " sim-tr-3" : "")}>
        <b>+{from} →</b>
        <span>한 번에</span>
        <span>마법서</span>
        {!keep && <span>파괴</span>}
      </div>
      {rows.map(({ k, e }) => (
        <div key={k} className={"sim-tr" + (keep ? " sim-tr-3" : "")}>
          <b>+{k}</b>
          <span className={tierClass(e.once)}>{pctText(e.once)}</span>
          <span>{n0(e.tries)}장</span>
          {!keep && <span className="sim-bad">{n0(e.broken)}개</span>}
        </div>
      ))}
    </div>
  );
}
const tierClass = (p: number) => `sim-t-${tierOf(p)}`;

/** +0 장비 1000개를 목표까지 강화해 보기 (한 번에 가는 것: 부서지면 그 장비는 끝) */
function Thousand({ rate, keep, goal }: { rate: (lv: number) => number; keep: boolean; goal: number }) {
  const [res, setRes] = useState<{ ok: number; broke: number; used: number; at: number[]; n: number } | null>(null);
  const run = () => {
    const N = 1000;
    let ok = 0;
    let broke = 0;
    let used = 0;
    const at: number[] = Array(16).fill(0);
    for (let i = 0; i < N; i++) {
      let lv = 0;
      for (;;) {
        if (lv >= goal) {
          ok++;
          break;
        }
        const p = rate(lv + 1);
        if (!(p > 0)) break;
        used++;
        if (Math.random() < p) lv++;
        else if (!keep) {
          broke++;
          at[lv + 1]++;
          break;
        }
        if (used > 5_000_000) break;
      }
    }
    setRes({ ok, broke, used, at, n: (res?.n ?? 0) + 1 });
  };
  return (
    <div className="sim-thousand">
      <button type="button" className="btn btn-ghost" onClick={run}>
        1000개 → +{goal}
      </button>
      {res && (
        <div key={res.n} className="sim-thousand-res">
          <span>
            <small>성공</small>
            <b className="sim-good">
              <Count value={res.ok} />개
            </b>
          </span>
          {!keep && (
            <span>
              <small>파괴</small>
              <b className="sim-bad">
                <Count value={res.broke} />개
              </b>
            </span>
          )}
          <span>
            <small>마법서</small>
            <b>
              <Count value={res.used} />장
            </b>
          </span>
          {!keep && res.broke > 0 && (
            <div className="sim-breakbars" aria-label="어디서 부서졌나">
              {res.at.map((v, k) =>
                v ? (
                  <span key={k} style={{ ["--w" as string]: `${Math.max(4, (v / res.broke) * 100)}%` }}>
                    <em>+{k}</em>
                    <i />
                    <small>{v}</small>
                  </span>
                ) : null,
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ================================================================ 스탯 부여 · 펫 추가 옵션

const STATS = [
  { k: "힘", per: 1 },
  { k: "민첩", per: 1 },
  { k: "지능", per: 1 },
  { k: "체력", per: 10 },
  { k: "마나", per: 10 },
];

/** 성장 칸의 실제 물건 (2026-11-17 고도화, 제작자 '너무 허접해': 글자 상자 '장신구'·'펫' 대신 위키 장신구(벨트·망토·목걸이·반지)와 아이템 책의 펫 그림) */
interface StatPick {
  name: string;
  icon: Pic;
  sub: string;
  lv: number;
}
const ACC_SLOTS = ["벨트", "망토", "목걸이", "반지"];
function accessoriesOf(wiki: Wiki): StatPick[] {
  const out: StatPick[] = [];
  const seen = new Set<string>();
  for (const t of wiki.equipment) {
    if (!ACC_SLOTS.includes(t.slot)) continue;
    for (const row of t.rows) {
      const name = row.name.trim();
      if (!name || !row.icon || seen.has(name) || /^\+|\[/.test(name)) continue;
      seen.add(name);
      const h = row.h ?? t.headers;
      const lv = Number(String(row.cells[h.indexOf("레벨제한")] ?? "").replace(/\D/g, "")) || 0;
      out.push({ name, icon: row.icon, sub: `${t.slot} · Lv.${lv}`, lv });
    }
  }
  return out.sort((a, b) => a.lv - b.lv || a.name.localeCompare(b.name, "ko"));
}
function petsOf(book: Book | null): StatPick[] {
  if (!book) return [];
  const out: StatPick[] = [];
  for (const [name, vs] of Object.entries(book.items)) {
    const v = vs.find((x) => x.t === "펫" && x.pic);
    if (v?.pic) out.push({ name, icon: v.pic, sub: `펫${v.g ? ` · ${v.g}` : ""}`, lv: v.lv ?? 0 });
  }
  // 옛날 펫부터: 게임 펫 도감 목록 차례 (book.pets), 거기 없는 펫은 뒤에 이름순
  const order = new Map((book.pets ?? []).map((n, i) => [n, i]));
  return out.sort((a, b) => (order.get(a.name) ?? 1e9) - (order.get(b.name) ?? 1e9) || a.name.localeCompare(b.name, "ko"));
}

function StatSim({ odds, wiki }: { odds: Odds; wiki: Wiki }) {
  const all = useMemo(() => stepsOf(odds), [odds]);
  const book = useBook();
  const accs = useMemo(() => accessoriesOf(wiki), [wiki]);
  const pets = useMemo(() => petsOf(book), [book]);
  const [key, setKey] = useEntryState("sim.steps", all[0]?.key ?? "");
  const st = all.find((s) => s.key === key) ?? all[0];
  const [stat, setStat] = useEntryState("sim.stat", "지능");
  // 표마다 지금 단계와 펫 옵션, 모든 표의 시도·성공 수는 진행 상황에 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네')
  const kept = useSave().save.stat?.[st?.key ?? ""];
  const [stage, setStage] = useState(() => kept?.stage ?? 0);
  const [type, setType] = useState<string | null>(() => kept?.type ?? null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [stats, setStats] = useKept((s) => s.statN, (s, v) => ({ ...s, statN: v }), { tries: 0, ok: 0, big: 0 });
  const [auto, setAuto] = useState(false);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  if (!st) return <div className="empty">스탯 부여 자료가 없어요</div>;
  return (
    <StatInner
      st={st}
      all={all}
      setKey={setKey}
      stat={stat}
      setStat={setStat}
      stage={stage}
      setStage={setStage}
      stageRef={stageRef}
      type={type}
      setType={setType}
      fx={fx}
      setFx={setFx}
      stats={stats}
      setStats={setStats}
      auto={auto}
      setAuto={setAuto}
      picks={st.types ? pets : accs}
    />
  );
}

function StatInner(p: {
  st: Steps;
  all: Steps[];
  setKey: (k: string) => void;
  stat: string;
  setStat: (k: string) => void;
  stage: number;
  setStage: (n: number) => void;
  stageRef: { current: number };
  type: string | null;
  setType: (t: string | null) => void;
  fx: Fx | null;
  setFx: (f: (x: Fx | null) => Fx | null) => void;
  stats: { tries: number; ok: number; big: number };
  setStats: (f: (s: { tries: number; ok: number; big: number }) => { tries: number; ok: number; big: number }) => void;
  auto: boolean;
  setAuto: (v: boolean) => void;
  /** 고를 수 있는 실제 물건 (장신구나 펫) */
  picks: StatPick[];
}) {
  const { st, stage, stageRef, setStage, setFx, setStats, setType, auto, setAuto, picks } = p;
  const pet = !!st.types;
  const step = st.steps[stage];
  const coins = useCoins();
  // 순위: 처음부터 몇 번 만에 끝 단계
  const rec = useRecord(weekGame(`stat:${st.key}`));
  // 자동은 직접 닿아 본 단계까지만 (제작자 2026-11-04 '내가 수동으로 겪은 것만 자동으로')
  const { save, update } = useSave();
  // 처음부터 센 시도 (순위): 단계와 함께 진행 상황에 두어 다시 열어도 이어서 센다
  const since = useRef(save.stat?.[st.key]?.since ?? 0);
  const emit = useQuest();
  const expStage = expOf(save, `stat:${st.key}`);
  const cap = Math.min(st.max, expStage);
  // 고른 물건 (진행 상황에, 표마다): 없으면 처음 것
  const [itemName, setItemName] = useState<string>(() => save.stat?.[st.key]?.item ?? "");
  const [picking, setPicking] = useState(false);
  const [pq, setPq] = useState("");
  // 차례대로 (제작자 2026-11-19 '낮은 거부터 3 찍으면 다음 걸로 넘어가게', '펫도 옛날 펫부터 순서대로'): 장신구는 요구 레벨 낮은 것부터, 펫은 펫 도감 차례.
  // 끝 단계까지 올린 것(진행 상황 exp 'statc:<표>:<이름>')의 다음 것만 열린다. 처음 것은 늘 열려 있다
  const doneKey = (name: string) => `statc:${st.key}:${name}`;
  const isDone = (name: string) => expOf(save, doneKey(name)) > 0;
  const openAt = (i: number) => i === 0 || isDone(picks[i - 1].name);
  const pickedAt = picks.findIndex((x) => x.name === itemName);
  // 고른 것이 없거나 아직 잠긴 것이면 지금 할 차례(열린 것 중 아직 안 끝낸 처음 것)
  const turn = picks.findIndex((x, i) => openAt(i) && !isDone(x.name));
  const idx = pickedAt >= 0 && openAt(pickedAt) ? pickedAt : turn >= 0 ? turn : Math.max(0, picks.length - 1);
  const item = picks[idx] ?? null;
  const found = pq.trim() ? filterByName(picks, pq, (x) => [x.name]) : picks;
  const tip = useTip();
  useBackClose(picking, () => setPicking(false));
  const keep = (key: string, v: { stage: number; type: string | null; since: number; item?: string }) => update((s) => ({ ...s, stat: { ...s.stat, [key]: v } }));
  // 단계·펫 옵션이 바뀌거나 한 번 시도할 때마다 적는다 (처음 그릴 때는 그대로)
  const firstKeep = useRef(true);
  useEffect(() => {
    if (firstKeep.current) {
      firstKeep.current = false;
      return;
    }
    keep(st.key, { stage, type: p.type, since: since.current, item: itemName || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.key, stage, p.type, p.stats.tries, itemName]);
  const reset = () => {
    setStage(0);
    stageRef.current = 0;
    setType(null);
    setFx(() => null);
    setAuto(false);
    since.current = 0;
    keep(st.key, { stage: 0, type: null, since: 0, item: itemName || undefined });
  };
  // 다른 표로 바꾸면 그 표에서 하던 단계로 (예전에는 늘 0 부터)
  const load = (key: string) => {
    const k = save.stat?.[key];
    setStage(k?.stage ?? 0);
    stageRef.current = k?.stage ?? 0;
    setType(k?.type ?? null);
    setFx(() => null);
    setAuto(false);
    since.current = k?.since ?? 0;
    setItemName(k?.item ?? "");
    setPicking(false);
  };
  // 다른 물건으로: 0단계부터 새로
  const goItem = (name: string) => {
    setItemName(name);
    setStage(0);
    stageRef.current = 0;
    setType(null);
    setAuto(false);
    since.current = 0;
  };
  // 끝 단계에 닿으면 끝낸 것으로 적고, 잠깐 보여 준 뒤 다음 차례로 넘어간다
  const nextItem = picks[idx + 1] ?? null;
  useEffect(() => {
    if (stage < st.max || !item) return;
    // 지금 물건을 붙잡아 둔다: 고른 것이 없을 때는 '지금 차례'를 보여 주는데, 끝냈다고 적는 순간 차례가 다음 것으로 넘어가 그것까지 끝낸 것으로 적힌다
    if (itemName !== item.name) setItemName(item.name);
    if (!isDone(item.name)) update((s) => raiseExp(s, doneKey(item.name), 1));
    if (!nextItem) return;
    const t = window.setTimeout(() => {
      goItem(nextItem.name);
      setFx(() => ({ kind: "buy", n: Date.now() % 100000 }));
    }, 1400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, st.max, item?.name, nextItem?.name]);
  const tryOnce = useCallback((manual = false) => {
    const cur = stageRef.current;
    const s = st.steps[cur];
    if (!s || cur >= st.max) return;
    if (coins.take(1) < 1) {
      setAuto(false);
      return;
    }
    since.current++;
    const r = Math.random();
    const up = r < s.b ? 2 : r < s.a + s.b ? 1 : 0;
    setStats((x) => ({ tries: x.tries + 1, ok: x.ok + (up ? 1 : 0), big: x.big + (up === 2 ? 1 : 0) }));
    if (up) {
      const to = Math.min(st.max, cur + up);
      stageRef.current = to;
      setStage(to);
      if (manual) update((s) => raiseExp(s, `stat:${st.key}`, to));
      if (to >= st.max) {
        const n = since.current;
        rec.submit("grow", { label: `${st.max}단계`, score: st.max, tries: n, luck: luckOf(stepsWithin(st, n)) });
      }
      emit({ kind: "stat", key: st.key, stage: to, max: st.max });
      if (cur === 0 && st.types) setType(pick(st.types).name);
      setFx((f) => ({ kind: up === 2 ? "plus2" : "ok", n: (f?.n ?? 0) + 1 }));
    } else setFx((f) => ({ kind: "keep", n: (f?.n ?? 0) + 1 }));
  }, [st, stageRef, setStage, setStats, setType, setFx, coins, rec, setAuto, emit, update]);
  // 자동: 0.12초마다 한 번. 타이머는 자동을 켤 때 한 번만 걸고 그때그때 가장 새 함수를 부른다
  // (예전에는 화면을 다시 그릴 때마다 타이머를 새로 걸어서, 다시 그리는 일이 잦으면 간격이 들쭉날쭉했다)
  const autoStep = useRef<() => void>(() => undefined);
  autoStep.current = () => {
    if (stageRef.current >= cap) setAuto(false);
    else tryOnce();
  };
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => autoStep.current(), 120);
    return () => window.clearInterval(t);
  }, [auto]);

  // 펫 스탯 리셋 (공식 표 40300): 지금 옵션을 뺀 다른 넷 중 하나로, 단계는 그대로
  const resetStat = () => {
    const others = (st.types ?? []).filter((x) => x.name !== p.type).map((x) => ({ ...x, p: 1 }));
    if (!others.length || coins.take(1) < 1) return;
    setType(pick(others).name);
    setFx((f) => ({ kind: "ok", n: (f?.n ?? 0) + 1 }));
  };
  // 체력·마나는 한 단계에 10씩 (힘·민첩·지능은 1씩). 펫은 옵션 종류가 정해진 뒤에
  const per = STATS.find((x) => x.k === (pet ? p.type : p.stat))?.per ?? 1;
  const shown = pet ? (p.type ? `${p.type} +${stage * per}` : stage ? `+${stage}` : "옵션 없음") : `${p.stat} +${stage * per}`;
  const left = stepsExpected(st, stage);
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        <Seg
          items={p.all.map((s) => [s.key, s.name] as const)}
          value={st.key}
          onPick={(k) => {
            if (k === st.key) return;
            p.setKey(k);
            load(k);
          }}
        />
        {!pet && <Seg items={STATS.map((x) => [x.k, x.k] as const)} value={p.stat} onPick={p.setStat} />}
      </div>

      {picking ? (
        <section className="panel sim-shop">
          <div className="sim-search-row">
            <input className="sim-search" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="이름" aria-label={pet ? "펫 찾기" : "장신구 찾기"} />
            <button type="button" className="sim-shop-x" onClick={() => setPicking(false)} aria-label="닫기">
              ✕
            </button>
          </div>
          <div className="sim-items sim-pick-list">
            {found.slice(0, 160).map((x) => (
              <button
                key={x.name}
                type="button"
                className={"sim-pick" + (item?.name === x.name ? " sim-pick-on" : "") + (openAt(picks.indexOf(x)) ? "" : " sim-lock")}
                aria-disabled={openAt(picks.indexOf(x)) ? undefined : true}
                onClick={() => {
                  const i = picks.indexOf(x);
                  if (!openAt(i)) return tip(`${picks[i - 1].name} ${st.max}단계 먼저`);
                  goItem(x.name);
                  setPicking(false);
                }}
              >
                <span className="sim-ib" style={{ width: 36, height: 36 }}>
                  <PicImg pic={x.icon} fit={28} className="sim-pic" />
                </span>
                <span className="sim-pick-t">
                  <b>{x.name}</b>
                  <small>{x.sub}</small>
                </span>
                {isDone(x.name) && <em className="sim-shop-clear">{st.max}</em>}
              </button>
            ))}
            {!found.length && <p className="sim-muted">없음</p>}
          </div>
        </section>
      ) : (
      <section className="panel sim-anvil sim-anvil-grow">
        <span className="sim-rays" aria-hidden />
        <div className="sim-gearline">
          <span>{item ? item.sub : pet ? "펫" : "장신구"}</span>
          {picks.length > 1 && (
            <span className="sim-avg">
              {idx + 1}/{picks.length}
            </span>
          )}
          {since.current > 0 && <span className="sim-avg sim-avg-now">{n0(since.current)}번</span>}
          {left !== null && stage < st.max && <span className="sim-avg">평균 {n0(left)}번</span>}
          {picks.length > 0 && (
            <button type="button" className="sim-change" onClick={() => setPicking(true)} disabled={auto}>
              바꾸기
            </button>
          )}
        </div>
        <div key={p.fx?.n ?? 0} className={`sim-item${p.fx ? ` sim-fx-${p.fx.kind}` : ""}`}>
          {p.fx && p.fx.kind !== "keep" && <Sparks kind={p.fx.kind} n={p.fx.kind === "plus2" ? 16 : 10} />}
          <span className="sim-ring" aria-hidden />
          <span className={`sim-frame sim-aura-${Math.min(4, stage + (stage >= st.max ? 1 : 0))}`}>
            <i className="sim-aura" aria-hidden />
            <span className={`sim-icon${item ? " sim-icon-pic" : ""}`} aria-hidden>
              <span className="sim-half sim-half-a">{item ? <PicImg pic={item.icon} fit={64} className="sim-pic" /> : pet ? "펫" : "장신구"}</span>
            </span>
          </span>
          <i className="sim-floor" aria-hidden />
          <span className="sim-nameline">
            <b key={`s${stage}${p.type ?? ""}`} className="sim-lv sim-lv-sm">{shown}</b>
            {item && <span className="sim-name">{item.name}</span>}
          </span>
        </div>
        <div className="sim-steps" aria-label="단계">
          {Array.from({ length: st.max }, (_, i) => (
            <i key={i} className={i < stage ? "on" : i === stage ? "next" : ""} />
          ))}
        </div>
        {step && stage < st.max ? (
          <OddsBar
            parts={[
              { p: step.a, tone: "ok", label: `+${per}` },
              { p: step.b, tone: "gold", label: `+${per * 2}` },
              { p: 1 - step.a - step.b, tone: "keep", label: "유지" },
            ]}
          />
        ) : (
          <span className="sim-max">MAX</span>
        )}
      </section>
      )}

      <div className="sim-actions sim-actions-grow">
        <Act className="btn sim-go" busy={auto} lock={stage >= st.max ? "끝 단계예요" : coins.coins === 0 && NO_COIN} onClick={() => tryOnce(true)}>
          {pet ? "강화" : "부여"}
          <Cost n={1} />
        </Act>
        <Act
          className={"btn btn-ghost" + (auto ? " sim-running" : "")}
          lock={auto ? null : stage >= st.max ? "끝 단계예요" : stage >= cap ? `자동은 직접 올려 본 단계까지만 · ${stage + 1}단계를 직접 먼저` : coins.coins === 0 && NO_COIN}
          onClick={() => setAuto(!auto)}
        >
          {auto ? "멈춤" : stage >= cap ? "자동" : `${cap}단계 자동`}
          {!auto && <Cost n={1} per />}
        </Act>
        {pet && p.type && st.types && (
          <Act className="btn btn-ghost" lock={coins.coins === 0 && NO_COIN} onClick={resetStat}>
            리셋
            <Cost n={1} />
          </Act>
        )}
        <button type="button" className="btn btn-ghost sim-again" onClick={reset} aria-label="처음부터">
          ↺
        </button>
      </div>
      <StatStrip
        items={[
          { label: "시도", value: p.stats.tries },
          { label: "성공", value: p.stats.ok, tone: "sim-good" },
          { label: `+${per * 2}`, value: p.stats.big, tone: "sim-gold" },
        ]}
      />
      <RankBox rec={rec} title={st.name} />
    </div>
  );
}

// ================================================================ 옵션

/** 옵션 표의 장비가 어느 직업·부위 것인지 (장비 표에서): 띄어쓰기 뺀 이름 -> 부위, 직업, 요구 레벨 */
interface EquipInfo {
  slot: string;
  jobs: GearJob[];
  lv: number;
}
function equipIndex(wiki: Wiki): Map<string, EquipInfo> {
  const out = new Map<string, EquipInfo>();
  for (const t of wiki.equipment) {
    const weaponJob = GEAR_JOBS.find((j) => t.slot === `${j} 무기`);
    const slot = weaponJob ? "무기" : t.slot;
    for (const row of t.rows) {
      const key = row.name.replace(/\s+/g, "");
      if (!key || out.has(key)) continue;
      const h = row.h ?? t.headers;
      const job = String(row.cells[h.indexOf("직업")] ?? "");
      const jobs = GEAR_JOBS.filter((j) => job.includes(j));
      out.set(key, { slot, jobs: jobs.length ? jobs : weaponJob ? [weaponJob] : [...GEAR_JOBS], lv: Number(String(row.cells[h.indexOf("레벨제한")] ?? "").replace(/\D/g, "")) || 0 });
    }
  }
  return out;
}
/** 맨 위 한 줄에 들어가게 줄인 이름 */
const SRC_SHORT: Record<string, string> = { "옵션 재설정": "재설정", "과거의 유물": "유물", "이노티아의 축복": "이노티아", "조합 반지 · 의상": "조합", "코스튬 옵션": "코스튬" };
const SLOT_ORDER = ["무기", "보조 장비", "투구", "갑옷", "장갑", "신발", "망토", "벨트", "목걸이", "반지"];

/** 옵션 칸 (2026-11-19 제작자 '장비 리스트도 재점검, 무기별로 직업별로, 너무 목록만 쭉 떠 있으면 어떡하냐, 카테고리 나눌 거 나누고'):
 *  한 줄씩 고른다: 어디서(재설정 · 유물 · 이노티아 · 조합 · 코스튬) → 직업 → 부위(이노티아는 Lv 묶음). 목록은 그 직업·부위 것만 레벨 순으로 두 칸씩 */
function OptionSim({ odds, wiki, me }: { odds: Odds; wiki: Wiki; me: Me }) {
  // 이노티아의 축복은 장비를 골라 옵션을 굴리는 것이 아니라 상자에서 장비가 뜨고 강화도·옵션이 붙어 나오는 것이라 뽑기 칸에서 한다
  // (제작자 2026-11-19 '이노티아는 저 장비들 중에 뭐가 뜨나가 아니야?')
  // 과거의 유물도 같다 (제작자 같은 날 '유물도 그렇지 않나? 뽑기로 가야 돼': 과거의 기억 -> 유물 -> 장비가 뜨고 옵션이 붙어 나온다). 옵션 칸에는 재설정 · 조합 · 코스튬만
  const sources = useMemo(() => optionSources(odds).filter((x) => x.name !== "이노티아의 축복" && x.name !== "과거의 유물"), [odds]);
  const eq = useMemo(() => equipIndex(wiki), [wiki]);
  // 옵션 재설정은 장비 강화에서 한 번이라도 산 장비만 (제작자 2026-11-19 '장비 구매 쪽에서 구매해야 옵션 쪽에서 그 장비만, 한 번이라도 구매한 적이 있으면 해금').
  // 장비 상점에 없는 장비(장신구, 거래불가, 상인 장비)는 목록에 두지 않는다
  const shopNames = useMemo(() => new Set(gearOf(wiki, odds).map((g) => g.name.replace(/\s+/g, ""))), [wiki, odds]);
  const { save } = useSave();
  const owned = useMemo(() => ownedGear(save), [save]);
  const tip = useTip();
  const [src, setSrc] = useEntryState("sim.osrc", sources[0]?.key ?? "");
  const source = sources.find((s) => s.key === src) ?? sources[0];
  const [picked, setPicked] = useEntryState("sim.oitem", "");
  const [jobSel, setJob] = useEntryState("sim.ojob", "");
  const [slotSel, setSlot] = useEntryState("sim.oslot", "");
  const [bandSel, setBand] = useEntryState("sim.oband", "");
  const items = source?.items ?? [];
  const idOf = (x: OptItem) => x.id ?? x.name;
  const gearOnly = source?.name === "옵션 재설정";
  const rows = useMemo(
    () =>
      items
        .map((x) => {
          const [title, tag] = optTitle(x.name);
          const key = title.replace(/\s+/g, "");
          const e = eq.get(key);
          // 표가 직업마다 나뉜 곳(이노티아의 축복)은 그 표의 직업, 아니면 장비 표의 직업
          const tableJob = GEAR_JOBS.find((j) => j === x.group);
          return { x, title, tag, key, jobs: tableJob ? [tableJob] : (e?.jobs ?? null), slot: e?.slot ?? "", lv: e?.lv ?? 0, open: !gearOnly || owned.has(key) };
        })
        .filter((r) => !gearOnly || shopNames.has(r.key)),
    [items, eq, gearOnly, owned, shopNames],
  );
  const item = rows.find((r) => r.open && idOf(r.x) === picked)?.x ?? null;
  // 몇 개 안 되는 곳(조합, 코스튬)은 고르는 줄 없이 그대로
  const many = rows.length > 8;
  const useJob = many && rows.some((r) => r.jobs && r.jobs.length < GEAR_JOBS.length);
  const myJob = (me.job ? JOB_NAME[me.job] : "") as GearJob;
  const job = GEAR_JOBS.includes(jobSel as GearJob) ? (jobSel as GearJob) : GEAR_JOBS.includes(myJob) ? myJob : GEAR_JOBS[0];
  const ofJob = useJob ? rows.filter((r) => !r.jobs || r.jobs.includes(job)) : rows;
  const bands = many ? [...new Set(ofJob.map((r) => r.tag).filter(Boolean))] : [];
  const band = bands.includes(bandSel) ? bandSel : (bands[0] ?? "");
  const slots = many && !bands.length ? SLOT_ORDER.filter((x) => ofJob.some((r) => r.slot === x)) : [];
  const slot = slots.includes(slotSel) ? slotSel : (slots[0] ?? "");
  const list = ofJob
    .filter((r) => (!bands.length || r.tag === band) && (!slots.length || r.slot === slot))
    .sort((a, b) => Number(b.open) - Number(a.open) || (many ? a.lv - b.lv || a.title.localeCompare(b.title, "ko") : 0));
  if (!source) return <div className="empty">옵션 자료가 없어요</div>;
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        <Seg
          items={sources.map((s) => [s.key, SRC_SHORT[s.name] ?? s.name] as const)}
          value={source.key}
          onPick={(k) => {
            setSrc(k);
            setPicked("");
          }}
        />
        {!item && useJob && <Seg items={GEAR_JOBS.map((j) => [j as string, j] as const)} value={job} onPick={setJob} />}
        {!item && bands.length > 1 && <Seg items={bands.map((b) => [b, b] as const)} value={band} onPick={setBand} />}
        {!item && slots.length > 1 && <Seg items={slots.map((x) => [x, x] as const)} value={slot} onPick={setSlot} />}
      </div>
      {item ? (
        <OptionRoller key={source.key + idOf(item)} item={item} onBack={() => setPicked("")} verb={source.name === "옵션 재설정" ? "재설정" : "굴리기"} reset={source.name === "옵션 재설정"} game={`opt:${source.key}:${item.name}`.slice(0, 60)} />
      ) : (
        <div className="sim-items sim-items-2">
          {list.map((r) => (
            <button
              key={idOf(r.x)}
              type="button"
              className={"sim-pick" + (r.open ? "" : " sim-lock")}
              aria-disabled={r.open ? undefined : true}
              onClick={() => (r.open ? setPicked(idOf(r.x)) : tip(`${r.title} · 장비 강화에서 한 번 사면 열려요`))}
            >
              <IconBox name={r.x.icon ?? r.x.name} size={26} />
              <span className="sim-pick-t">
                <b>{r.title}</b>
                <small>{r.lv ? `Lv.${r.lv}` : r.x.opts.map((o) => o.label).join(" · ")}</small>
              </span>
            </button>
          ))}
          {!list.length && <p className="sim-muted">없음</p>}
        </div>
      )}
    </div>
  );
}

type Val = Dist["vals"][number];
/** 한꺼번에 나온 옵션이 이만큼(이상) 나올 확률 (값이 하나뿐인 옵션은 뺀다): 작을수록 드물고 좋다 */
const jointP = (item: OptItem, vals: Val[]) => item.opts.reduce((p, d, i) => (d.vals.length > 1 ? p * atLeast(d, vals[i].n) : p), 1);

/** 옵션 굴리기. reset(옵션 재설정)이면 전 · 후 두 칸: 굴린 값은 '후'에 뜨고, 전이나 후를 누르면 그쪽이 내 옵션이 된다 (다음에 굴릴 때 '전' 자리로).
 *  아이템 이름 오른쪽 체크 '옵션 자동선택'(2026-11-19 제작자 '아이템명 우측에 체크박스, 옵션 자동선택이라고')을 켜면 더 드문(좋은) 쪽을 저절로 고른다 (제작자 2026-11-19 '팝업 띄우지 말고 앱 화면에 전 후 정도만, 전이나 후 고르면 선택, 체크박스로 자동으로 더 희박한 더 좋은 옵션 선택').
 *  순위는 없고 1/100 보다 드문 결과만 전광판에 남긴다 */
function OptionRoller({ item, onBack, verb, game, reset }: { item: OptItem; onBack?: () => void; verb: string; game?: string; reset?: boolean }) {
  const roll = useCallback(() => item.opts.map((d) => pick(d.vals)), [item]);
  // cur = 전(지금 옵션), next = 후(방금 굴린 것, 아직 안 굴렸으면 null), side = 고른 쪽 (안 골랐으면 전 그대로)
  const [cur, setCur] = useState(roll);
  const [next, setNext] = useState<Val[] | null>(null);
  const [side, setSide] = useState<"cur" | "new" | null>(null);
  const [n, setN] = useState(1);
  const [aim, setAim] = useState<{ i: number; min: number }>(() => ({ i: 0, min: Math.max(...item.opts[0].vals.map((v) => v.n)) }));
  const [hunt, setHunt] = useState<{ tries: number; expect: number; k: number; short: boolean } | null>(null);
  const coins = useCoins();
  const emit = useQuest();
  // 나올 때까지는 직접 굴려 본 값까지만 (제작자 2026-11-04 '내가 수동으로 겪은 것만 자동으로'): 옵션마다 직접 본 가장 높은 값
  const { save, update } = useSave();
  const autoPick = !!save.optAuto;
  const seenKey = (i: number) => `opt:${item.name}:${i}`;
  // 지금 내 옵션: 후를 골랐으면 후, 아니면 전
  const mine = reset && next && side === "new" ? next : cur;
  const report = (got: Val[]) => {
    if (!game) return;
    const luck = luckOf(jointP(item, got));
    if (game.startsWith("repair:")) emit({ kind: "repair", level: got[0]?.n ?? 0 });
    else emit({ kind: "opt", luck });
    sendFeed(game, `${optTitle(item.name)[0]} ${item.opts.map((o, i) => `${o.label} ${got[i].v}`).join(" ")}`, luck);
  };
  // 굴린 값을 화면에: 재설정은 후 칸에 (앞에서 고른 쪽이 전이 된다), 나머지는 그대로 바뀐다
  const land = (got: Val[]) => {
    if (reset) {
      const base = mine;
      setCur(base);
      setNext(got);
      setSide(autoPick ? (jointP(item, got) < jointP(item, base) ? "new" : "cur") : null);
    } else setCur(got);
    setN((x) => x + 1);
  };
  const again = () => {
    if (coins.take(1) < 1) return;
    const got = roll();
    update((s) => got.reduce((acc, v, i) => raiseExp(acc, seenKey(i), v.n), s));
    setHunt(null);
    report(got);
    land(got);
  };
  const huntGoal = () => {
    const d = item.opts[aim.i];
    const P = atLeast(d, aim.min);
    const can = coins.coins ?? 0;
    if (!(P > 0) || can < 1) return;
    let tries = 0;
    let got = cur;
    let best = cur;
    let bestP = 2;
    for (;;) {
      tries++;
      got = roll();
      const jp = jointP(item, got);
      if (jp < bestP) {
        bestP = jp;
        best = got;
      }
      if (got[aim.i].n >= aim.min || tries >= can) break;
    }
    coins.take(tries);
    setHunt({ tries, expect: 1 / P, k: (hunt?.k ?? 0) + 1, short: got[aim.i].n < aim.min });
    report(best);
    land(got);
    // 나올 때까지 굴린 것은 그 값을 얻으려던 것이라 후를 고른 것으로
    if (reset) setSide("new");
  };
  const d = item.opts[aim.i];
  const nums = [...new Set(d.vals.map((v) => v.n))].sort((a, b) => a - b);
  const P = atLeast(d, aim.min);
  const seen = expOf(save, seenKey(aim.i));
  const canHunt = aim.min <= seen;
  // 이번 결과가 얼마나 드문지 (모든 옵션이 이만큼 이상 나올 확률)
  const joint = jointP(item, mine);
  const step = (dir: number) => setAim({ ...aim, min: nums[Math.min(nums.length - 1, Math.max(0, nums.indexOf(aim.min) + dir))] ?? aim.min });
  const [title, tag] = optTitle(item.name);
  // 전 · 후 한 칸
  const card = (key: "cur" | "new", vals: Val[] | null) => {
    const jp = vals ? jointP(item, vals) : 1;
    // 아직 안 골랐으면 둘 다 그대로 보이고(후가 '골라 보라'고 숨 쉰다), 고르면 고른 쪽에 금색 테두리·다른 쪽은 흐리게
    const on = !!next && side === key;
    return (
      <button
        key={key === "new" ? `new${n}` : "cur"}
        type="button"
        className={`sim-ba-card sim-ba-${key} sim-ba-${vals ? tierOf(jp) : "n"}` + (on ? " sim-ba-on" : "") + (next && side && !on ? " sim-ba-off" : "") + (next && !side ? " sim-ba-ask" : "")}
        disabled={!next}
        aria-pressed={on}
        onClick={() => setSide(key)}
      >
        <i className="sim-ba-h">{key === "cur" ? "전" : "후"}</i>
        {item.opts.map((o, i) => (
          <span key={i} className="sim-ba-row" style={{ animationDelay: `${0.05 + i * 0.07}s` }}>
            <span>{o.label}</span>
            <b>{vals ? vals[i]?.v : "?"}</b>
          </span>
        ))}
        {vals && jp < 1 && <small className={`sim-ba-p ${tierClass(jp)}`}>상위 {pctOnly(jp)}</small>}
        {on && <i className="sim-ba-ok" aria-hidden />}
      </button>
    );
  };
  // 값 칸에 보일 것: 재설정은 방금 굴린 후(없으면 전), 전 값에는 작은 표시
  const shown = reset && next ? next : cur;
  return (
    <>
      <section className={`panel sim-opt sim-opt-${tierOf(joint)}`}>
        <div className="sim-opt-head">
          {onBack && (
            <button type="button" className="sim-back" onClick={onBack} aria-label="다른 아이템">
              ◀
            </button>
          )}
          <IconBox name={item.icon ?? item.name} size={28} />
          <b>
            {title}
            {tag && <i className="sim-pick-tag">{tag}</i>}
          </b>
          {!reset && joint < 1 && (
            <em key={n} className={`sim-luck ${tierClass(joint)}`}>
              상위 {pctOnly(joint)}
            </em>
          )}
          {reset && (
            <button type="button" className={"sim-check sim-check-head" + (autoPick ? " sim-check-on" : "")} aria-pressed={autoPick} onClick={() => update((s) => ({ ...s, optAuto: !s.optAuto }))}>
              <i className="sim-check-box" aria-hidden />
              옵션 자동선택
            </button>
          )}
        </div>
        {reset && (
          <div className="sim-ba">
            {card("cur", cur)}
            <i className="sim-ba-arrow" aria-hidden />
            {card("new", next)}
          </div>
        )}
        {item.opts.map((o, i) => (
          <OptLine key={i} d={o} v={shown[i]} n={n} i={i} aim={aim.i === i ? aim.min : null} onAim={(min) => setAim({ i, min })} compact={!!reset} mark={reset && next ? cur[i]?.n : undefined} />
        ))}
      </section>
      {reset ? (
        <div className="sim-actions sim-actions-1">
          <Act className="btn sim-go" lock={coins.coins === 0 && NO_COIN} onClick={again}>
            {verb}
            <Cost n={1} />
          </Act>
        </div>
      ) : null}
      <div className={"sim-actions " + (reset ? "sim-actions-hunt" : "sim-actions-opt")}>
        {!reset && (
          <Act className="btn sim-go" lock={coins.coins === 0 && NO_COIN} onClick={again}>
            {verb}
            <Cost n={1} />
          </Act>
        )}
        <span className="sim-aim">
          <button type="button" className="pill" onClick={() => step(-1)} aria-label="목표 내리기">
            −
          </button>
          <span className="sim-aim-t">
            <b>
              {d.label} {aim.min}↑
            </b>
            <small className={tierClass(P)}>{pctOnly(P)}</small>
          </span>
          <button type="button" className="pill" onClick={() => step(1)} aria-label="목표 올리기">
            +
          </button>
        </span>
        <Act
          className="btn btn-ghost sim-hunt-go"
          lock={!(P > 0) ? "나올 수 없는 값이에요" : !canHunt ? `자동은 직접 굴려 본 값까지만 · ${d.label} ${aim.min} 이상을 직접 먼저` : coins.coins === 0 && NO_COIN}
          onClick={huntGoal}
        >
          자동 굴리기
          {P > 0 && <Cost n={1 / P} avg />}
        </Act>
      </div>
      {hunt && (
        <p key={hunt.k} className={"sim-hunt" + (hunt.short ? " sim-hunt-short" : "")}>
          <b>
            <Count value={hunt.tries} ms={700} />번
          </b>
          <small>평균 {n0(hunt.expect)}번</small>
        </p>
      )}
    </>
  );
}

/** 값마다 확률은 늘 % 로 (1/N 으로 바꾸지 않는다): 91.5%, 2.69%, 0.052% */
const pctOnly = (p: number) => {
  const v = p * 100;
  const t = v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4);
  return `${t.replace(/\.?0+$/, "")}%`;
};

/** 좁은 칸에 넣는 확률: % 없이 짧게 (50 · 6.5 · .79) */
const pctTiny = (p: number) => {
  const x = p * 100;
  return x < 0.005 ? "0" : x >= 9.95 ? String(Math.round(x)) : x >= 0.995 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2).replace(/^0/, "");
};

/** 칸이 7~9개일 때: 앞의 0 을 떼고 다섯 글자 안으로 (.523% · 3.29% · 21.7%) */
const pctMid = (p: number) => {
  const x = p * 100;
  return x < 0.1 ? `${x.toFixed(2).replace(/^0/, "")}%` : pctOnly(p).replace(/^0\./, ".");
};

/** 옵션 한 줄: 이름 · 큰 값 · 등급, 그 아래 값마다 막대 하나인 분포 그래프 (막대 높이 = 확률, 아래에 값과 %).
    2026-11-19 제작자 '옵션 숫자 쭉 나열한 게 가시성이 떨어져, 너저분, 확률도 한눈에 보이면서 집약적으로': 값마다 네모 칸이던 것을 한 줄 그래프로.
    굴리면 불빛이 막대를 차례로 돌다가 느려지며 나온 값에 멈춘다. 막대를 누르면 그 값 이상이 목표 */
function OptLine({ d, v, n, i, aim, onAim, compact = false, mark }: { d: Dist; v: Dist["vals"][number]; n: number; i: number; aim: number | null; onAim: (min: number) => void; compact?: boolean; mark?: number }) {
  const at = Math.max(0, d.vals.indexOf(v));
  const [hot, setHot] = useState(at);
  const [rolling, setRolling] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    // 처음 그릴 때와 움직임 줄이기에서는 돌리지 않는다
    if (first.current || d.vals.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      first.current = false;
      setHot(at);
      setRolling(false);
      return;
    }
    const len = d.vals.length;
    const hops = Math.max(len, 9) + i * 5;
    let k = 0;
    let t = 0;
    setRolling(true);
    const tick = () => {
      k++;
      setHot((((at - (hops - k)) % len) + len) % len);
      if (k >= hops) {
        setRolling(false);
        return;
      }
      // 끝으로 갈수록 느리게
      t = window.setTimeout(tick, 26 + (k / hops) ** 3 * 150);
    };
    t = window.setTimeout(tick, 26);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, at]);
  const top = Math.max(...d.vals.map((x) => x.p)) || 1;
  const total = d.vals.reduce((a, x) => a + x.p, 0) || 1;
  const P = atLeast(d, v.n);
  // 한 줄에 넣는 막대 수: 값 글자가 짧으면 18개, 길면 8개까지. 넘으면 줄을 고르게 나눈다
  const wide = d.vals.some((x) => String(x.v).length > 2);
  const lines = Math.ceil(d.vals.length / (wide ? 8 : 18));
  const per = Math.ceil(d.vals.length / lines);
  const chunks = Array.from({ length: lines }, (_, k) => d.vals.slice(k * per, (k + 1) * per));
  const shown = d.vals[hot] ?? v;
  return (
    <div className={"sim-oline" + (rolling ? " sim-rolling" : "") + (compact ? " sim-oline-c" : "")}>
      <div className="sim-ohead">
        <span className="sim-oname">{d.label}</span>
        {!compact && (
          <b key={rolling ? "r" : `v${n}`} className={`sim-oval ${rolling ? "" : tierClass(P)}`}>
            {shown.v}
          </b>
        )}
        {!rolling && n > 1 && P <= 0.05 && <Sparks key={n} kind={P <= 0.01 ? "plus2" : "box-r"} n={P <= 0.01 ? 16 : 9} />}
        {!compact && !rolling && P < 1 && <small className={`sim-otop ${tierClass(P)}`}>상위 {pctOnly(P)}</small>}
        {compact && d.vals.length > 1 && (
          <small className="sim-oread">
            <b>{shown.v}</b>
            {pctOnly(shown.p / total)}
          </small>
        )}
      </div>
      {d.vals.length > 1 &&
        chunks.map((row, r) => (
          <div key={r} className={"sim-hist" + (per > 9 ? " sim-hist-n" : "") + (per > 14 ? " sim-hist-x" : "")}>
            {row.map((x, c) => {
              const j = r * per + c;
              const p = x.p / total;
              return (
                <button
                  key={j}
                  type="button"
                  className={`sim-col sim-col-${tierOf(p)}` + (j === hot ? (rolling ? " sim-col-run" : " sim-col-on") : "") + (aim !== null && x.n >= aim ? " sim-col-aim" : "") + (mark !== undefined && x.n === mark ? " sim-col-was" : "")}
                  onClick={() => onAim(x.n)}
                  aria-label={`${d.label} ${x.v} ${pctOnly(p)}`}
                >
                  <span className="sim-col-bar" aria-hidden>
                    <i style={{ transform: `scaleY(${Math.max(0.07, Math.sqrt(x.p / top)).toFixed(3)})` }} />
                  </span>
                  <b>{x.v}</b>
                  <small>{per > 9 ? pctTiny(p) : per > 6 ? pctMid(p) : pctOnly(p)}</small>
                </button>
              );
            })}
          </div>
        ))}
    </div>
  );
}

// ================================================================ 상자

/** 묶음 이름들에서 모두 같은 앞 낱말(lead)과 뒤 낱말을 뗀다. 'A -> B' 는 'A→B' */
/** '나올 때까지'의 평균 값: 그것 하나가 나올 확률의 역수 */
function TargetCost({ items, total, name }: { items: { name: string; p: number }[]; total: number; name: string }) {
  const g = items.find((x) => x.name === name);
  return g && g.p > 0 ? <Cost n={total / g.p} avg /> : null;
}

function trimNames(names: string[]): { lead: string; short: string[] } {
  const words = names.map((n) => n.replace(/\s*->\s*/g, "→").trim().split(/\s+/));
  const w0 = words[0] ?? [];
  let a = 0;
  while (words.every((w) => w.length > a + 1 && w[a] === w0[a])) a++;
  let z = 0;
  while (words.every((w) => w.length - a - z > 1 && w[w.length - 1 - z] === w0[w0.length - 1 - z])) z++;
  return { lead: w0.slice(0, a).join(" "), short: words.map((w) => w.slice(a, w.length - z).join(" ")) };
}

/** 공식 이벤트 글 그림 속 확률표 상자 (제작자 2026-11-06 '시너지 다 하자', '이벤트 공지' 칸). 못 받으면 없이 */
const eventBoxCache = new Map<string, Box>();
function useEventBoxes(): Box[] {
  const [boxes, setBoxes] = useState<Box[]>(() => [...eventBoxCache.values()]);
  useEffect(() => {
    let alive = true;
    fetchEventOdds().then(
      (r) => {
        for (const b of r) eventBoxCache.set(b.key, b);
        if (alive) setBoxes(r);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return boxes;
}

/** 맨 위 한 줄에 들어가게 줄인 이름 */
const BOX_SHORT: Record<string, string> = { 가챠샵: "가챠", 랜덤상자: "상자", "랜덤 코스튬": "코스튬", "이벤트 공지": "공지", "외형 · 염색": "외형" };
function BoxSim({ odds }: { odds: Odds }) {
  const official = useMemo(() => boxesOf(odds), [odds]);
  const events = useEventBoxes();
  const boxes = useMemo(() => [...official, ...events], [official, events]);
  const sources = useMemo(() => optionSources(odds), [odds]);
  const cats = BOX_CATS.filter((c) => boxes.some((b) => b.cat === c));
  const [catRaw, setCat] = useEntryState("sim.bcat", cats[0] ?? "");
  // 빠진 묶음(외형 · 기타)을 보던 사람은 처음 묶음으로
  const cat = cats.includes(catRaw) ? catRaw : (cats[0] ?? "");
  const [key, setKey] = useEntryState("sim.box", "");
  const box = boxes.find((b) => b.key === key && cats.includes(b.cat)) ?? null;
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        <Seg
          items={cats.map((c) => [c, BOX_SHORT[c] ?? c] as const)}
          value={cat}
          onPick={(c) => {
            setCat(c);
            setKey("");
          }}
        />
      </div>
      {box ? (
        <BoxOpener
          key={box.key}
          box={box}
          onBack={() => setKey("")}
          boxes={boxes}
          sources={sources}
          onOpen={(b) => {
            setCat(b.cat);
            setKey(b.key);
          }}
        />
      ) : (
        <div className="sim-items sim-items-2">
          {boxes
            .filter((b) => b.cat === cat)
            .map((b) => (
              <button key={b.key} type="button" className="sim-pick" onClick={() => setKey(b.key)}>
                <IconBox name={b.name} size={28} />
                <span className="sim-pick-t">
                  <b>{b.name}</b>
                  <small>
                    {b.date ? `${b.date} · ` : ""}
                    {b.sections.length > 1 ? `${b.sections.length}종 · ` : ""}
                    {b.sections.reduce((s, x) => s + x.items.length, 0)}
                  </small>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

interface Pull {
  name: string;
  p: number;
  id: number;
  /** 옵션 표가 있는 장비(이노티아의 축복, 과거의 유물)는 뜰 때 강화도와 옵션이 같이 정해진다: '+6', '힘 2 · 명중 7' */
  lv?: string;
  opts?: string;
}
function BoxOpener({
  box,
  onBack,
  boxes,
  sources,
  onOpen,
  cat = "box",
}: {
  box: Box;
  onBack?: () => void;
  boxes?: Box[];
  sources?: OptSource[];
  onOpen?: (b: Box) => void;
  cat?: Cat;
}) {
  const [si, setSi] = useState(0);
  const sec = box.sections[Math.min(si, box.sections.length - 1)];
  const total = sec.items.reduce((s, x) => s + x.p, 0) || 1;
  const [pulls, setPulls] = useState<Pull[]>([]);
  // 이번에 처음 나온 것 (2026-11-17: 카드에 NEW)
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  // 상자·묶음마다 연 수와 나온 것은 진행 상황에 (제작자 2026-11-06 '껐다가 다시 오면 기록이 사라지네')
  const keptBox = useSave().save.box;
  const keptOf = (i: number) => keptBox?.[`${box.key}:${i}`];
  const [tally, setTally] = useState<Map<string, number>>(() => new Map(Object.entries(keptOf(0)?.tally ?? {})));
  const [opened, setOpened] = useState(() => keptOf(0)?.opened ?? 0);
  const [shake, setShake] = useState(0);
  // 표의 줄을 누르면 그것이 나올 때까지 열어 본다
  const [target, setTarget] = useState<string | null>(null);
  const [hunt, setHunt] = useState<{ name: string; tries: number; expect: number; k: number; short: boolean } | null>(null);
  const seq = useRef(0);
  const prefix = sec.title.match(/^(Lv\.\S+)/)?.[1] ?? "";
  // 뜬 것 하나: 옵션 표가 있는 장비면 강화도와 옵션을 그 자리에서 굴려 붙인다 (다음 상자로 이어지는 것은 빼고)
  const pullOf = (x: { name: string; p: number }): Pull => {
    const base: Pull = { name: x.name, p: x.p / total, id: seq.current++ };
    const o = sources && !(boxes && boxFor(boxes, x.name, box.key)) ? optionFor(sources, x.name, prefix) : null;
    if (!o) return base;
    const parts: string[] = [];
    let lv: string | undefined;
    for (const d of o.opts) {
      if (!d.vals.length) continue;
      const v = pick(d.vals);
      if (d.label === "강화도") lv = v.v;
      else if (v.n !== 0) parts.push(`${d.label} ${v.v}`);
    }
    return { ...base, lv, opts: parts.join(" · ") };
  };
  // 보석이 나왔으면 보석 칸에 넣는다 (영웅의 보석상자, 이노티아의 축복 보석 …)
  const keepGems = (got: Pull[]) => {
    const ids = got.map((x) => gemIdOf(x.name)).filter((x): x is string => !!x);
    if (ids.length) update((s) => addGems(s, ids));
  };
  const coins = useCoins();
  const iconOf = useIcon();
  const chestPic = iconOf(box.name);
  // 나올 때까지는 직접 열어서 나온 것만 (제작자 2026-11-04 '내가 수동으로 겪은 것만 자동으로')
  const { save, update } = useSave();
  const gotKey = (name: string) => `box:${box.key}:${si}:${name}`;
  const emit = useQuest();
  // 두근두근: 1·10회는 상자가 0.6초 흔들린 뒤 열린다
  const [charging, setCharging] = useState(false);
  const openFx = (k: number) => {
    if (charging) return;
    if (k > 10) return open(k);
    setCharging(true);
    window.setTimeout(() => {
      setCharging(false);
      open(k);
    }, 600);
  };
  const boxKey = `${box.key}:${si}`;
  const record = (got: Pull[], k: number) => {
    const t = new Map(tally);
    for (const x of got) t.set(x.name, (t.get(x.name) ?? 0) + 1);
    setTally(t);
    setOpened(opened + k);
    update((s) => ({ ...s, box: { ...s.box, [boxKey]: { opened: opened + k, tally: Object.fromEntries(t) } } }));
    setShake((s) => s + 1);
    const rare = got.reduce<Pull | null>((m, x) => (!m || x.p < m.p ? x : m), null);
    if (rare && cat === "box") emit({ kind: "box", p: rare.p });
    // 1/100 보다 드문 것은 전광판에
    if (rare) sendFeed(`box:${box.key}`, rare.name, luckOf(rare.p));
  };
  const open = (want: number) => {
    const k = coins.take(want);
    if (k < 1) return;
    const got: Pull[] = [];
    for (let i = 0; i < k; i++) {
      got.push(pullOf(pick(sec.items)));
    }
    keepGems(got);
    setFresh(new Set(got.filter((x) => !expOf(save, gotKey(x.name))).map((x) => x.name)));
    update((s) => got.reduce((acc, x) => raiseExp(acc, gotKey(x.name), 1), s));
    // 많이 열면 드문 것부터 10개만 카드로
    setPulls(k > 10 ? [...got].sort((a, b) => a.p - b.p).slice(0, 10) : got);
    setHunt(null);
    record(got, k);
  };
  const untilTarget = () => {
    const goal = sec.items.find((x) => x.name === target);
    const can = coins.coins ?? 0;
    if (!goal || can < 1) return;
    const got: Pull[] = [];
    let tries = 0;
    let hit = false;
    for (;;) {
      tries++;
      const x = pick(sec.items);
      got.push(pullOf(x));
      if (x.name === goal.name) hit = true;
      if (hit || tries >= can) break;
    }
    coins.take(tries);
    keepGems(got);
    setFresh(new Set(got.filter((x) => !expOf(save, gotKey(x.name))).map((x) => x.name)));
    update((s) => got.reduce((acc, x) => raiseExp(acc, gotKey(x.name), 1), s));
    setPulls([...got].sort((a, b) => a.p - b.p).slice(0, 10));
    setHunt({ name: goal.name, tries, expect: total / goal.p, k: (hunt?.k ?? 0) + 1, short: !hit });
    record(got, tries);
  };
  // wipe: '지우기'를 눌렀을 때는 저장한 것도 지운다 (묶음을 바꿀 때는 그 묶음의 기록을 불러온다)
  const clear = (wipe = true) => {
    setPulls([]);
    setTally(new Map());
    setOpened(0);
    setHunt(null);
    if (wipe)
      update((s) => {
        const b = { ...s.box };
        delete b[boxKey];
        return { ...s, box: b };
      });
  };
  const best = pulls.reduce((m, x) => Math.min(m, x.p), 1);
  const rows = [...sec.items].sort((a, b) => a.p - b.p);
  const topP = Math.max(...sec.items.map((x) => x.p)) || 1;
  const tier = tierOf(best);
  // 묶음이 다섯 넘으면 모두 같은 앞말·뒷말을 떼고 한 줄로 ('랜덤 코스튬 A' … 'M' -> A … M, 앞말은 이름 옆 작은 표)
  const many = box.sections.length > 4;
  const secNames = many ? trimNames(box.sections.map((s) => s.title)) : null;
  return (
    <>
      <section className="panel sim-box">
        <div className="sim-opt-head">
          {onBack && (
            <button type="button" className="sim-back" onClick={onBack} aria-label="다른 상자">
              ◀
            </button>
          )}
          <b>
            {box.name}
            {secNames?.lead && <em className="sim-pick-tag">{secNames.lead}</em>}
          </b>
          {opened > 0 && <em className="sim-luck">{opened.toLocaleString()}회</em>}
          {box.post && (
            <a className="sim-post" href={`#/official/${box.post}`}>
              공식 ›
            </a>
          )}
        </div>
        {box.sections.length > 1 && (
          <div className={many ? "sim-secs sim-secs-many" : `sim-secs sim-secs-${box.sections.length}`}>
            {box.sections.map((s, i) => (
              <button
                key={i}
                type="button"
                className={"sub-tab" + (i === si ? " sub-tab-on" : "")}
                onClick={() => {
                  setSi(i);
                  setTarget(null);
                  clear(false);
                  setTally(new Map(Object.entries(keptOf(i)?.tally ?? {})));
                  setOpened(keptOf(i)?.opened ?? 0);
                }}
              >
                {secNames ? secNames.short[i] : s.title}
              </button>
            ))}
          </div>
        )}
        <div key={charging ? "c" : shake} className={`sim-chest${charging ? " sim-charging" : shake ? ` sim-chest-open sim-chest-${tier}` : ""}`} aria-hidden>
          <span className="sim-rays" />
          <span className="sim-chest-t">{chestPic ? <PicImg pic={chestPic} fit={48} className="sim-pic" /> : <i className="sim-chest-box" />}</span>
          <i className="sim-floor" />
          {!charging && shake > 0 && tier !== "n" && tier !== "u" && <b className="sim-chest-tag">{tier === "sr" ? "대박" : "희귀"}</b>}
          {shake > 0 && !charging && <Sparks kind={`box-${tier}`} n={tier === "sr" ? 18 : 10} />}
        </div>
        {/* 100회는 뺐다 (제작자 2026-11-19 '100회 없애, 100개 보이지도 않는구만': 나온 것은 열 개까지만 보인다) */}
        <div className="sim-actions sim-actions-2 sim-actions-w">
          {[1, 10].map((k) => (
            <Act key={k} className={"btn" + (k === 1 ? " sim-go" : " btn-ghost")} busy={charging} lock={coins.coins === 0 && NO_COIN} onClick={() => openFx(k)}>
              {k}회
              <Cost n={k} />
            </Act>
          ))}
        </div>
        {target && (
          <Act className="btn btn-ghost sim-until" lock={!expOf(save, gotKey(target)) ? "자동은 직접 열어서 나온 것만 · 직접 먼저 뽑아요" : coins.coins === 0 && NO_COIN} onClick={untilTarget}>
            <NameIcon name={target} size={16} />
            {target}
            <small>
              나올 때까지 <TargetCost items={sec.items} total={total} name={target} />
            </small>
          </Act>
        )}
        {hunt && (
          <p key={hunt.k} className={"sim-hunt" + (hunt.short ? " sim-hunt-short" : "")}>
            <b>
              <Count value={hunt.tries} ms={700} />번
            </b>
            <small>평균 {n0(hunt.expect)}번</small>
          </p>
        )}
        {pulls.length > 0 && (
          <div key={`p${shake}`} className="sim-pulls">
            {pulls.map((x, i) => {
              const next = boxes ? boxFor(boxes, x.name, box.key) : null;
              const xp = iconOf(x.name);
              const body = (
                <>
                  <span className="sim-card-pic">{xp ? <PicImg pic={xp} fit={30} className="sim-pic" /> : <i className="sim-ib-none" />}</span>
                  <span className="sim-card-name">
                    {x.lv && <em className="sim-card-lv">{x.lv}</em>}
                    {x.name}
                  </span>
                  <small>
                    {pctText(x.p)}
                    {next ? " · 열기 ›" : x.opts ? ` · ${x.opts}` : ""}
                  </small>
                  {fresh.has(x.name) && <em className="sim-new">NEW</em>}
                </>
              );
              const cls = `sim-card sim-t-${tierOf(x.p)}`;
              const style = { animationDelay: `${0.25 + i * 0.06}s` };
              return next ? (
                <button key={x.id} type="button" className={cls} style={style} onClick={() => onOpen?.(next)}>
                  {body}
                </button>
              ) : (
                <span key={x.id} className={cls} style={style}>
                  {body}
                </span>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel sim-tally">
        {rows.map((x) => {
          const got = tally.get(x.name) ?? 0;
          const p = x.p / total;
          return (
            <button
              key={x.name}
              type="button"
              aria-pressed={target === x.name}
              className={`sim-trow sim-t-${tierOf(p)}` + (got ? " sim-got" : "") + (target === x.name ? " sim-target" : "")}
              onClick={() => setTarget(target === x.name ? null : x.name)}
            >
              <i className="sim-trow-bar" style={{ transform: `scaleX(${Math.max(0.02, Math.sqrt(x.p / topP)).toFixed(3)})` }} aria-hidden />
              <span className="sim-tname">
                <NameIcon name={x.name} size={18} />
                {x.name}
              </span>
              <b>{pctText(p)}</b>
              <em>{got ? `${got.toLocaleString()}` : ""}</em>
            </button>
          );
        })}
        {opened > 0 && (
          <button type="button" className="sim-reset" onClick={() => clear()} aria-label="처음부터">
            ↺
          </button>
        )}
      </section>
    </>
  );
}

// ================================================================ 보석 (뽑기 · 합성 · 세공 · 분해)
// 게임 '보석관리' 창과 같은 흐름 (제작자 2026-11-19 녹화 '이런 식이야', '세공은 가지고 있는 보석 안에서 같은 등급 안에서 종류만 바꾸는 거',
// '보석도 뽑아야 그걸로 세공이든 분해든 합성이든 하게 하자', '가지고 있는 보석 재고가 보이게'):
// 뽑기 = 영웅의 보석상자(공식 표 20101, 1단계 75 · 2단계 20 · 3단계 4.5 · 4단계 0.5%)에서 보석 하나, 분해 = 보석 -> 그 단계 보석결정,
// 합성 = 보석결정 3개 -> 그 단계·한 단계 위·두 단계 위, 세공 = 보석결정 1개 -> 같은 단계의 보석 스무 가지 중 하나.
// 공짜로 주는 보석결정은 없다: 뽑은 보석만 가지고 한다. 네 칸이 같은 보석결정과 보석(진행 상황 save.gem, simState.ts gemOf)을 쓴다.

type GemMode = "draw" | "synth" | "polish" | "break";
const GEM_MODES: readonly (readonly [GemMode, string])[] = [
  ["draw", "보석 뽑기"],
  ["synth", "보석 합성"],
  ["polish", "보석 세공"],
  ["break", "보석 분해"],
];
/** 보석결정 그림 (게임 보석관리 창에서 오린 것, data/sim/crystalN.png). 못 받으면 그 색의 도트 보석 */
function Crystal({ st, size = 30 }: { st: number; size?: number }) {
  const [bad, setBad] = useState(false);
  if (bad) return <i className={`sim-gem-dot sim-gem-dot-${st}`} />;
  return <img className="sim-crystal" src={`/data/sim/crystal${st}.png?v=1`} alt="" style={{ height: size }} onError={() => setBad(true)} />;
}

const GEM_STATS = ["힘", "민첩", "지능", "체력"];
function GemTab({ odds }: { odds: Odds }) {
  const [modeRaw, setMode] = useEntryState<GemMode>("sim.gmode", "draw");
  const mode: GemMode = GEM_MODES.some(([k]) => k === modeRaw) ? modeRaw : "draw";
  const kinds = useMemo(() => gemKinds(odds), [odds]);
  const rules = useMemo(() => gemSynth(odds), [odds]);
  const box = useMemo(() => gemBox(odds), [odds]);
  const { save, update } = useSave();
  const coins = useCoins();
  const tip = useTip();
  const iconOf = useIcon();
  const emit = useQuest();
  const g = gemOf(save);
  const { inv, gems } = g;
  const [stRaw, setSt] = useEntryState("sim.gcut", 1);
  const st = stRaw >= 1 && stRaw <= 4 ? stRaw : 1;
  const [want, setWant] = useState(1);
  // 방금 일어난 일이 톡 튄다: 얻은 보석(칸마다), 단계마다 늘어난 보석·보석결정
  const [fx, setFx] = useState<{ got: Record<string, number>; gem: number[]; inv: number[]; n: number } | null>(null);
  const flash = (got: Record<string, number>, dInv: number[] = []) =>
    setFx((f) => {
      const gem = [0, 0, 0, 0, 0];
      for (const [id, c] of Object.entries(got)) if (c > 0) gem[Number(id[0])] += c;
      return { got, gem, inv: [0, 1, 2, 3, 4].map((k) => dInv[k] ?? 0), n: (f?.n ?? 0) + 1 };
    });
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = window.setTimeout(() => setSure(false), 3000);
    return () => window.clearTimeout(t);
  }, [sure]);
  const [avg, setAvg] = useState<number[] | null>(null);
  const [charging, setCharging] = useState(false);
  const list = kinds[st] ?? [];
  const families = [...new Set(list.map((k) => k.family))];
  const have = inv[st] ?? 0;
  const gemsAt = (k: number) => (kinds[k] ?? []).reduce((t, x) => t + (gems[x.id] ?? 0), 0);
  const owned = gemsAt(st);
  /** 보석결정과 보석을 한꺼번에 고친다 (dInv: 단계마다 더할 수, dGems: 보석마다 더할 수) */
  const change = (dInv: number[], dGems: Record<string, number>, more: Partial<{ runs: number; cuts: number; pulls: number; best: number }> = {}) =>
    update((s) => {
      const b = gemOf(s);
      const nextInv = b.inv.map((v, k) => Math.max(0, v + (dInv[k] ?? 0)));
      const gg = { ...b.gems };
      for (const [id, c] of Object.entries(dGems)) {
        const v = (gg[id] ?? 0) + c;
        if (v > 0) gg[id] = v;
        else delete gg[id];
      }
      return { ...s, gem: { ...b, inv: nextInv, gems: gg, runs: b.runs + (more.runs ?? 0), cuts: b.cuts + (more.cuts ?? 0), pulls: b.pulls + (more.pulls ?? 0), best: Math.max(b.best, more.best ?? 0) } };
    });

  // ---- 뽑기: 영웅의 보석상자
  const draw = (k: number) => {
    const n = coins.take(k);
    if (n < 1 || !box.length) return;
    const got: Record<string, number> = {};
    let top = 0;
    for (let i = 0; i < n; i++) {
      const x = pick(box);
      got[x.id] = (got[x.id] ?? 0) + 1;
      top = Math.max(top, x.st);
    }
    change([], got, { pulls: n });
    flash(got);
    if (top) setSt(top);
    // 4단계 보석(0.5%)은 전광판에
    const rare = Object.keys(got).find((id) => id[0] === "4");
    if (rare) sendFeed("box:20101", `${kinds[4]?.find((x) => x.id === rare)?.name ?? "4단계 보석"}`, luckOf(0.005));
  };
  const drawFx = (k: number) => {
    if (charging || !coins.coins) return;
    setCharging(true);
    window.setTimeout(() => {
      setCharging(false);
      draw(k);
    }, 450);
  };

  // ---- 합성: 같은 단계 보석결정 3개
  const can = (k: number, v = inv) => v[k] >= 3 && !!rules[k];
  const tried = (k: number) => expOf(save, `gem:${k}`) > 0;
  const synthOnce = (k: number) => {
    if (!can(k) || coins.take(1) < 1) return;
    update((s) => raiseExp(s, `gem:${k}`, 1));
    const r = pick(rules[k]);
    const d = [0, 0, 0, 0, 0];
    d[k] -= 3;
    d[r.to] += 1;
    change(d, {}, { runs: 1, best: r.to });
    setSt(r.to);
    flash({}, [0, 1, 2, 3, 4].map((x) => (x === r.to && r.to > k ? 1 : 0)));
    emit({ kind: "gem", stage: r.to });
    if (r.to - k >= 2) sendFeed("gem:synth", `보석결정 ${r.to}단계 · ${k}단계 3개로`, luckOf(r.p));
  };
  function synthAll(v: number[], limit = Infinity, only: (k: number) => boolean = () => true) {
    const next = [...v];
    let n = 0;
    let best = 0;
    for (;;) {
      const k = n < limit ? [1, 2, 3].find((x) => only(x) && can(x, next)) : undefined;
      if (!k) break;
      const r = pick(rules[k]);
      next[k] -= 3;
      next[r.to] += 1;
      n++;
      best = Math.max(best, r.to);
    }
    return { next, n, best };
  }
  const synthEvery = () => {
    const { next, n, best } = synthAll(inv, coins.coins ?? 0, tried);
    if (!n) return;
    coins.take(n);
    change(next.map((v, k) => v - inv[k]), {}, { runs: n, best });
    flash({}, next.map((v, k) => Math.max(0, v - inv[k])));
    emit({ kind: "gem", stage: best });
  };
  // 지금 가진 보석결정으로 1000번 해 본 평균 (단계마다 남는 수)
  const average = () => {
    const sum = [0, 0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      const { next } = synthAll(inv);
      for (let k = 1; k <= 4; k++) sum[k] += next[k];
    }
    setAvg(sum.map((x) => x / 1000));
  };

  // ---- 세공: 보석결정 n개 -> 그 단계 보석
  const n = Math.max(1, Math.min(want, have, coins.coins ?? 1));
  const cut = () => {
    const k = coins.take(Math.min(n, have));
    if (k < 1) return;
    const got: Record<string, number> = {};
    for (let i = 0; i < k; i++) {
      const x = pick(list);
      got[x.id] = (got[x.id] ?? 0) + 1;
    }
    const d = [0, 0, 0, 0, 0];
    d[st] = -k;
    change(d, got, { cuts: k });
    flash(got);
  };

  // ---- 분해: 보석 -> 그 단계 보석결정 (코인 없이)
  const breakOne = (id: string) => {
    if (!(gems[id] > 0)) return tip("가진 보석만 분해돼요");
    const d = [0, 0, 0, 0, 0];
    d[st] = 1;
    change(d, { [id]: -1 });
    flash({}, d);
  };
  const breakAll = () => {
    if (!sure) return setSure(true);
    setSure(false);
    const d = [0, 0, 0, 0, 0];
    d[st] = owned;
    change(d, Object.fromEntries(list.filter((k) => gems[k.id] > 0).map((k) => [k.id, -gems[k.id]])));
    flash({}, d);
  };

  const TONE = ["keep", "ok", "gold"] as const;
  const undo = mode === "break";
  const totalGems = [1, 2, 3, 4].reduce((t, k) => t + gemsAt(k), 0);
  const totalInv = inv.reduce((a, b) => a + b, 0);
  return (
    <div className="sim">
      <div className="mk-sub sim-strip">
        <Seg items={GEM_MODES} value={mode} onPick={setMode} />
      </div>
      {/* 가진 것: 단계마다 보석결정(큰 숫자)과 보석 수. 누르면 그 단계의 보석 스무 가지가 아래에 */}
      <section className={"panel sim-gems sim-gems-pick" + (mode === "synth" ? " sim-gems-synth" : "")} role="tablist">
        {[1, 2, 3, 4].map((k) => {
          const upInv = fx?.inv[k] ?? 0;
          const upGem = fx?.gem[k] ?? 0;
          return (
            <div key={k} className={`sim-gem sim-gem-${k}` + (k === st ? " sim-gem-on" : "") + (inv[k] || gemsAt(k) ? "" : " sim-gem-zero")}>
              <button type="button" role="tab" aria-selected={k === st} className="sim-gem-tap" onClick={() => setSt(k)}>
                <small className="sim-gem-st">{k}단계</small>
                <span key={upInv ? fx!.n : 0} className={"sim-gem-pic" + (upInv ? " sim-gem-pop" : "")} aria-hidden>
                  <Crystal st={k} />
                  {upInv > 0 && mode === "synth" && <Sparks kind="ok" n={8} />}
                </span>
                <b key={`n${upInv ? fx!.n : 0}`} className={"sim-gem-n" + (upInv ? " sim-gem-back" : "")}>
                  <Count value={inv[k] ?? 0} ms={300} />
                </b>
                <span key={`g${upGem ? fx!.n : 0}`} className={"sim-gem-own" + (upGem ? " sim-gem-own-up" : "")}>
                  <i className={`sim-gem-dot sim-gem-dot-${k}`} aria-hidden />
                  <Count value={gemsAt(k)} ms={300} />
                  {upGem > 0 && <em>+{upGem}</em>}
                </span>
              </button>
              {mode === "synth" &&
                (rules[k] ? (
                  <>
                    <span className="sim-gem-odds" aria-label={rules[k].map((r) => `${r.to}단계 ${pctText(r.p)}`).join(" ")}>
                      {rules[k].map((r) => (
                        <i key={r.to} className={`sim-odds-${TONE[Math.min(2, r.to - k)]}`} style={{ flexGrow: Math.max(r.p, 0.06) }} />
                      ))}
                    </span>
                    <small className="sim-gem-pct">{rules[k].map((r) => Math.round(r.p * 100)).join("·")}</small>
                    <Act className="sim-mini sim-gem-go" lock={!can(k) ? `${k}단계 보석결정 3개가 있어야 해요 · 보석을 분해하면 생겨요` : coins.coins === 0 && NO_COIN} onClick={() => synthOnce(k)}>
                      합성
                      <small>
                        3개 · <i className="sim-c" aria-hidden />1
                      </small>
                    </Act>
                  </>
                ) : (
                  <span className="sim-max">MAX</span>
                ))}
            </div>
          );
        })}
      </section>
      {list.length ? (
        <section className={"panel sim-kinds" + (undo ? " sim-kinds-undo" : "")}>
          <span />
          {GEM_STATS.map((x) => (
            <small key={x} className="sim-kinds-h">
              {x} {list.find((k) => k.stat === x)?.value}
            </small>
          ))}
          {families.map((f) => {
            const row = list.filter((k) => k.family === f);
            return (
              <div key={f} className="sim-kinds-row">
                <span className="sim-kind-fam">
                  {iconOf(row[0].name) ? <NameIcon name={row[0].name} size={20} /> : <i className={`sim-gem-dot sim-gem-dot-${st}`} />}
                  <span>
                    <b>{f}</b>
                    <small>{row[0].skill}</small>
                  </span>
                </span>
                {GEM_STATS.map((x) => {
                  const k = row.find((r) => r.stat === x);
                  if (!k) return <span key={x} />;
                  const c = gems[k.id] ?? 0;
                  const hit = fx?.got[k.id] ?? 0;
                  const cls = "sim-kind" + (c ? "" : " sim-kind-zero") + (hit > 0 ? " sim-kind-hit" : "");
                  const body = (
                    <>
                      <b>{c}</b>
                      {hit > 0 && <em>+{hit}</em>}
                    </>
                  );
                  return undo ? (
                    <button key={x} type="button" className={cls} onClick={() => breakOne(k.id)} aria-label={`${k.name} ${k.stat} ${k.value} 분해 (${c}개)`}>
                      {body}
                    </button>
                  ) : (
                    <span key={`${x}-${hit > 0 ? fx!.n : 0}`} className={cls} aria-label={`${k.name} ${k.stat} ${k.value} ${c}개`}>
                      {body}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </section>
      ) : (
        <div className="empty">보석 자료가 없어요</div>
      )}
      {mode === "draw" ? (
        <div className={"sim-actions sim-actions-2" + (charging ? " sim-gem-charging" : "")}>
          {[1, 10].map((k) => (
            <Act key={k} className={"btn" + (k === 1 ? " sim-go" : " btn-ghost")} busy={charging} lock={!box.length ? "보석상자 자료가 없어요" : coins.coins === 0 && NO_COIN} onClick={() => drawFx(k)}>
              {k}회
              <Cost n={k} />
            </Act>
          ))}
        </div>
      ) : mode === "synth" ? (
        <div className="sim-actions sim-actions-grow">
          <Act
            className="btn sim-go"
            lock={![1, 2, 3].some((k) => can(k)) ? "합성할 보석결정이 없어요 · 보석을 분해하면 생겨요" : ![1, 2, 3].some((k) => tried(k) && can(k)) ? "모두 합성은 직접 합성해 본 단계만 · 직접 먼저 합성해요" : coins.coins === 0 && NO_COIN}
            onClick={synthEvery}
          >
            모두 합성
            <Cost n={1} per />
          </Act>
          <button type="button" className="btn btn-ghost" onClick={average}>
            1000번 평균
          </button>
        </div>
      ) : mode === "polish" ? (
        <div className="sim-actions sim-actions-cut">
          <span className="sim-aim">
            <button type="button" className="pill" onClick={() => setWant(Math.max(1, n - 1))} aria-label="개수 줄이기">
              −
            </button>
            <span className="sim-aim-t">
              <b>{n}개</b>
            </span>
            <button type="button" className="pill" onClick={() => setWant(n >= have ? 1 : Math.min(have, n < 10 ? n + 1 : n + 10))} aria-label="개수 늘리기">
              +
            </button>
          </span>
          <Act className="btn sim-go" lock={!have ? `${st}단계 보석결정이 없어요 · 보석을 분해하면 생겨요` : coins.coins === 0 && NO_COIN} onClick={cut}>
            세공
            <Cost n={n} />
          </Act>
        </div>
      ) : (
        <div className="sim-actions sim-actions-1">
          <Act className={"btn btn-ghost" + (sure ? " sim-sell-sure" : "")} lock={!owned && `${st}단계 보석이 없어요 · 뽑기나 세공으로 생겨요`} onClick={breakAll}>
            {sure ? `${st}단계 모두 분해?` : `${st}단계 모두 분해`}
            {owned > 0 && <small>{owned.toLocaleString()}</small>}
          </Act>
        </div>
      )}
      {mode === "synth" && avg && (
        <div className="sim-avgs">
          {[1, 2, 3, 4]
            .filter((k) => avg[k] >= 0.005)
            .map((k) => (
              <span key={k} className={`sim-gem-${k}`}>
                <Crystal st={k} size={18} />
                <b>{avg[k] >= 10 ? avg[k].toFixed(0) : avg[k].toFixed(2)}</b>
              </span>
            ))}
        </div>
      )}
      <StatStrip
        items={[
          { label: "보석", value: totalGems },
          { label: "보석결정", value: totalInv },
          mode === "draw" ? { label: "뽑기", value: g.pulls } : mode === "polish" ? { label: "세공", value: g.cuts } : mode === "synth" ? { label: "합성", value: g.runs } : { label: "최고", value: Math.max(g.best, [4, 3, 2, 1].find((k) => inv[k] > 0 || gemsAt(k) > 0) ?? 0), tone: "sim-good", unit: "단계" },
        ]}
      />
    </div>
  );
}
