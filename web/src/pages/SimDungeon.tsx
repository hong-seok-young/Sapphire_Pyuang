// 확률 시뮬레이터 '던전' 칸 (제작자 요청 2026-11-04 '내가 강화한 거 입히는 거임', '디자인은 우리랑 어울리게').
// 강화 칸에서 들고 있는 무기·방어구를 입은 도트 용사가 1층부터 위키 몬스터와 싸우며 내려간다. 셈은 src/simDungeon.ts.
// 그림: 용사는 이 앱이 그린 도트(직업 색), 손에 든 무기와 몬스터는 위키 그림. 움직임은 transform·opacity 만.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Odds } from "../odds";
import type { Wiki } from "../types";
import type { Me } from "../auth";
import { JOB_NAME } from "../auth";
import { useEntryState } from "../router";
import { PicImg } from "../ui";
import { Nick } from "../kakao";
import { gearOf, loadHeld } from "../simGear";
import type { Gear, GearJob } from "../simGear";
import type { Part } from "../sim";
import { useCoins, useRecord } from "../simRank";
import { useQuest } from "../simQuest";
import { RankBox } from "./Simulator";
import { BOSS_EVERY, HERO_GAP, HERO_HP, MON_GAP, bandsOf, foeFor, heroHit, refsOf, regenAfter } from "../simDungeon";
import type { DunGear, Foe, Hero } from "../simDungeon";

/** 강화도 k 의 무기 데미지·방어구 방어도 (simGear 의 표 그대로) */
function dunGear(g: Gear, k: number): DunGear {
  const b = g.table[Math.min(15, k)] ?? 0;
  if (g.part === "무기") return { name: g.name, lv: g.lv, min: ((g.min ?? 0) * (100 + b)) / 100, max: ((g.max ?? 0) * (100 + b)) / 100, def: 0 };
  return { name: g.name, lv: g.lv, min: 0, max: 0, def: b };
}
const short = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}만` : Math.round(n).toLocaleString());
const num1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---------------------------------------------------------------- 도트 용사 (이 앱이 그린 것, 직업마다 색)

const HERO_MAP = [
  "....HHHH....",
  "...HHHHHH...",
  "..HHHHHHHH..",
  "..KKKKKKKK..",
  "..KSSSSSSK..",
  "..SSESSESS..",
  "..SSSSSSSS..",
  "...SSSSSS...",
  ".CAAAAAAAAC.",
  "CCAAAAAAAACC",
  "CCAAGAAGAACC",
  "CSAAAAAAAASC",
  ".CAAAAAAAAC.",
  "..BBB..BBB..",
  "..BBB..BBB..",
  ".BBBB..BBBB.",
];
const JOB_COLOR: Record<GearJob, { h: string; c: string }> = {
  전사: { h: "#c94f4f", c: "#8f2e3a" },
  레인저: { h: "#3f9e6a", c: "#2b6b4a" },
  마법사: { h: "#7b5bd6", c: "#4a3590" },
  무도가: { h: "#e08a3c", c: "#9c5a22" },
};
/** 방어구 강화도마다 몸통 색 (없으면 천옷) */
const armorColor = (k: number | null) => (k === null ? "#7a6a58" : k >= 9 ? "#f2b84b" : k >= 6 ? "#a77bff" : k >= 4 ? "#6f8fff" : "#9aa3b8");

function HeroSprite({ job, armorLv }: { job: GearJob; armorLv: number | null }) {
  const col = JOB_COLOR[job];
  const fill: Record<string, string> = { H: col.h, K: "#2a2140", S: "#f3cfa7", E: "#1a1426", C: col.c, A: armorColor(armorLv), G: "#ffffff", B: "#3a2f4f" };
  const px = 5;
  return (
    <svg className="dun-sprite" viewBox={`0 0 ${12 * px} ${16 * px}`} width={12 * px} height={16 * px} shapeRendering="crispEdges" aria-hidden>
      {HERO_MAP.flatMap((row, y) =>
        [...row].map((ch, x) => (ch === "." ? null : <rect key={`${x}-${y}`} x={x * px} y={y * px} width={px} height={px} fill={fill[ch]} opacity={ch === "G" ? 0.55 : 1} />)),
      )}
    </svg>
  );
}

// ---------------------------------------------------------------- 싸움

interface Pop {
  id: number;
  side: "hero" | "mon";
  text: string;
  kind: "hit" | "crit" | "hurt" | "heal";
  dx: number;
}
interface Run {
  floor: number;
  hp: number;
  foe: Foe;
  mhp: number;
  kills: number;
  /** 몬스터가 쓰러져 다음 층으로 가는 중 */
  dying: boolean;
  over: boolean;
  t: number;
  nextHero: number;
  nextMon: number;
  started: number;
}

export function DungeonTab({ odds, wiki, me, goEnhance }: { odds: Odds; wiki: Wiki; me: Me; goEnhance: (p: Part) => void }) {
  const gears = useMemo(() => gearOf(wiki, odds), [wiki, odds]);
  const bands = useMemo(
    () => bandsOf(Object.values(wiki.monsters).map((m) => ({ name: m.name, level: m.level ?? 0, hp: m.hp ?? 0, img: m.img }))),
    [wiki],
  );
  // 입은 장비: 강화 칸에서 들고 있는 것 중 부서지지 않은 것
  const held = useMemo(() => ({ w: loadHeld(me.id, "무기"), a: loadHeld(me.id, "갑옷") }), [me.id]);
  const wGear = held.w && !held.w.broken ? gears.find((g) => g.part === "무기" && g.name === held.w!.name) : undefined;
  const aGear = held.a && !held.a.broken ? gears.find((g) => g.part === "갑옷" && g.name === held.a!.name) : undefined;
  const hero: Hero = useMemo(
    () => ({ weapon: wGear ? dunGear(wGear, held.w!.lv) : null, armor: aGear ? dunGear(aGear, held.a!.lv) : null }),
    [wGear, aGear, held],
  );
  const job = ((wGear?.kind as GearJob) || (me.job ? (JOB_NAME[me.job] as GearJob) : "전사")) as GearJob;
  const refs = useMemo(() => {
    const ws = gears.filter((g) => g.part === "무기" && g.kind === job).map((g) => ({ lv: g.lv, avg: ((g.min ?? 0) + (g.max ?? 0)) / 2 }));
    const slot = aGear?.kind ?? "갑옷";
    const as = gears.filter((g) => g.part === "갑옷" && g.kind === slot && g.jobs.includes(job)).map((g) => ({ lv: g.lv, def: g.table[0] ?? 0 }));
    return refsOf(ws, as);
  }, [gears, job, aGear]);

  const coins = useCoins();
  const rec = useRecord("dun");
  const emit = useQuest();
  const [speed, setSpeed] = useEntryState<number>("sim.dun.speed", 1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const runRef = useRef<Run | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [hitKey, setHitKey] = useState({ hero: 0, mon: 0, swing: 0 });
  const popId = useRef(0);
  const best = Math.max(rec.data?.mine?.score ?? 0, 0);
  const wLabel = wGear ? `+${held.w!.lv} ${wGear.name}` : "맨손";

  const pop = useCallback((side: Pop["side"], text: string, kind: Pop["kind"]) => {
    const id = ++popId.current;
    setPops((ps) => [...ps.slice(-10), { id, side, text, kind, dx: Math.round((Math.random() - 0.5) * 36) }]);
    window.setTimeout(() => setPops((ps) => ps.filter((p) => p.id !== id)), 900);
  }, []);

  const start = () => {
    if (!coins.coins || coins.take(1) < 1) return;
    const foe = foeFor(1, bands, refs, hero);
    runRef.current = { floor: 1, hp: HERO_HP, foe, mhp: foe.hp, kills: 0, dying: false, over: false, t: 0, nextHero: 350, nextMon: MON_GAP, started: Date.now() };
    setRun({ ...runRef.current });
    setPops([]);
  };
  const stop = () => {
    const r = runRef.current;
    if (r && !r.over) finish(r);
  };
  const finish = (r: Run) => {
    r.over = true;
    setRun({ ...r });
    const floor = r.floor;
    emit({ kind: "dun", floor });
    rec.submit("enhance", { label: `${floor}층 · ${wLabel}`, score: floor, tries: Math.max(1, Math.round((Date.now() - r.started) / 1000)), luck: 0 });
  };

  // 50ms 마다 시간을 흘려 보낸다 (배속, 다른 앱에 가 있으면 한 번에 0.2초까지만)
  useEffect(() => {
    if (!run || run.over) return;
    let last = performance.now();
    const t = window.setInterval(() => {
      const r = runRef.current;
      if (!r || r.over || r.dying) {
        last = performance.now();
        return;
      }
      const now = performance.now();
      r.t += Math.min(200, now - last) * speedRef.current;
      last = now;
      let changed = false;
      while (!r.over && !r.dying && (r.t >= r.nextHero || r.t >= r.nextMon)) {
        changed = true;
        if (r.nextHero <= r.nextMon) {
          const h = heroHit(hero, r.foe);
          r.mhp -= h.dmg;
          r.nextHero += HERO_GAP;
          pop("mon", short(h.dmg), h.crit ? "crit" : "hit");
          setHitKey((k) => ({ ...k, swing: k.swing + 1, mon: k.mon + 1 }));
          if (r.mhp <= 0) {
            r.mhp = 0;
            r.dying = true;
            r.kills++;
            const foe = r.foe;
            window.setTimeout(() => {
              const cur = runRef.current;
              if (!cur || cur !== r || cur.over) return;
              const before = cur.hp;
              cur.hp = regenAfter(foe, cur.hp);
              if (cur.hp > before) pop("hero", `+${Math.round(cur.hp - before)}`, "heal");
              cur.floor++;
              cur.foe = foeFor(cur.floor, bands, refs, hero);
              cur.mhp = cur.foe.hp;
              cur.dying = false;
              cur.t = 0;
              cur.nextHero = 350;
              cur.nextMon = MON_GAP;
              setRun({ ...cur });
            }, 520 / speedRef.current);
          }
        } else {
          r.hp -= r.foe.hit;
          r.nextMon += MON_GAP;
          pop("hero", `-${Math.round(r.foe.hit)}`, "hurt");
          setHitKey((k) => ({ ...k, hero: k.hero + 1 }));
          if (r.hp <= 0) {
            r.hp = 0;
            finish(r);
          }
        }
      }
      if (changed) setRun({ ...r });
    }, 50);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.over, run?.floor, hero, bands, refs]);
  // 칸을 떠나면 그만
  useEffect(() => () => {
    const r = runRef.current;
    if (r && !r.over) finish(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const foe = run?.foe;
  const boss = !!foe?.boss;
  const aura = wGear ? (held.w!.lv >= 11 ? 4 : held.w!.lv >= 9 ? 3 : held.w!.lv >= 7 ? 2 : held.w!.lv >= 4 ? 1 : 0) : 0;
  const hpPct = run ? Math.max(0, run.hp / HERO_HP) : 1;
  const cycle = run ? ((run.floor - 1) % BOSS_EVERY) + 1 : 0;

  return (
    <div className="sim dun">
      <section className={`panel dun-scene${boss ? " dun-boss" : ""}${run?.over ? " dun-over" : ""}`}>
        <div className="dun-bg" aria-hidden>
          <i className="dun-torch dun-torch-l" />
          <i className="dun-torch dun-torch-r" />
          <div key={run?.floor ?? 0} className="dun-ground">
            <span />
          </div>
        </div>
        <div className="dun-hud">
          <b className="dun-floor">
            <i>◆</i>
            {run ? `${run.floor}층` : "던전"}
          </b>
          <span className="dun-pips" aria-hidden>
            {Array.from({ length: BOSS_EVERY }, (_, i) => (
              <i key={i} className={(i < cycle - 1 ? "done" : i === cycle - 1 ? "now" : "") + (i === BOSS_EVERY - 1 ? " boss" : "")} />
            ))}
          </span>
          <span className="dun-speed">
            {[1, 2, 4].map((x) => (
              <button key={x} type="button" className={speed === x ? "on" : ""} onClick={() => setSpeed(x)}>
                x{x}
              </button>
            ))}
          </span>
        </div>
        {boss && run && !run.over && (
          <b key={run.floor} className="dun-bossbar">
            BOSS
          </b>
        )}

        <div className="dun-stage">
          {/* 용사 */}
          <div className="dun-hero">
            <div key={`h${hitKey.hero}`} className={"dun-hero-body" + (hitKey.hero ? " dun-hurt" : "")}>
              <div key={`s${hitKey.swing}`} className={"dun-lunge" + (hitKey.swing ? " dun-swing" : "")}>
                <HeroSprite job={job} armorLv={aGear ? held.a!.lv : null} />
                {wGear?.icon && (
                  <span className={`dun-weapon dun-aura-${aura}`}>
                    <i className="dun-weapon-glow" aria-hidden />
                    <PicImg pic={wGear.icon} max={26} />
                  </span>
                )}
              </div>
            </div>
            <div className="dun-hpbar dun-hpbar-hero">
              <i style={{ transform: `scaleX(${hpPct})` }} className={hpPct < 0.3 ? "low" : hpPct < 0.6 ? "mid" : ""} />
            </div>
            <small className="dun-name">
              <Nick name={me.id} />
            </small>
          </div>

          {/* 몬스터 */}
          {foe && (
            <div key={`m${run!.floor}`} className={"dun-mon" + (run!.dying ? " dun-dead" : "") + (boss ? " dun-mon-boss" : "")}>
              <div className="dun-hpbar dun-hpbar-mon">
                <i style={{ transform: `scaleX(${Math.max(0, run!.mhp / foe.hp)})` }} />
                <small>{short(Math.max(0, run!.mhp))}</small>
              </div>
              <div key={`f${hitKey.mon}`} className={"dun-mon-body" + (hitKey.mon ? " dun-flash" : "")}>
                {foe.img ? <PicImg pic={foe.img} max={boss ? 72 : 52} /> : <b className="dun-noimg">?</b>}
              </div>
              <small className="dun-name">
                {foe.name} <em>Lv.{foe.level}</em>
              </small>
            </div>
          )}

          {pops.map((p) => (
            <b key={p.id} className={`dun-pop dun-pop-${p.side} dun-pop-${p.kind}`} style={{ ["--dx" as string]: `${p.dx}px` }} aria-hidden>
              {p.text}
            </b>
          ))}
        </div>

        {(!run || run.over) && (
          <div className="dun-overlay">
            {run?.over ? (
              <>
                <b className="dun-result">{run.floor}층</b>
                <small>
                  몬스터 {run.kills} · 최고 {Math.max(best, run.floor)}층
                </small>
              </>
            ) : (
              <>
                <b className="dun-result dun-result-sm">{best ? `최고 ${best}층` : "1층부터"}</b>
                <small>{wLabel}</small>
              </>
            )}
            <button type="button" className="btn sim-go" disabled={!coins.coins} onClick={start}>
              {run?.over ? "다시 도전" : "도전"} <small>1코인</small>
            </button>
          </div>
        )}
        {run && !run.over && (
          <button type="button" className="dun-stop" onClick={stop}>
            그만
          </button>
        )}
      </section>

      <div className="dun-gear">
        <GearSlot label="무기" gear={wGear} lv={held.w?.lv ?? 0} broken={!!held.w?.broken} stat={hero.weapon ? `공격 ${num1(hero.weapon.min)}~${num1(hero.weapon.max)}` : "공격 1~3"} onGo={() => goEnhance("무기")} />
        <GearSlot label="방어구" gear={aGear} lv={held.a?.lv ?? 0} broken={!!held.a?.broken} stat={hero.armor ? `방어 ${hero.armor.def}` : "방어 0"} onGo={() => goEnhance("갑옷")} />
      </div>
      <RankBox rec={rec} title="던전 · 최고 층" unit="sec" />
    </div>
  );
}

function GearSlot({ label, gear, lv, broken, stat, onGo }: { label: string; gear?: Gear; lv: number; broken: boolean; stat: string; onGo: () => void }) {
  return (
    <button type="button" className={"dun-slot" + (gear ? "" : " dun-slot-empty")} onClick={onGo}>
      <span className="dun-slot-pic">{gear?.icon ? <PicImg pic={gear.icon} max={28} /> : null}</span>
      <span className="dun-slot-txt">
        <small>{label}</small>
        <b>{gear ? `+${lv} ${gear.name}` : broken ? "부서짐" : "없음"}</b>
        <em>{stat}</em>
      </span>
      <span className="dun-slot-go">강화 ›</span>
    </button>
  );
}
