// 강화 비교 (개발중, 제작자 요청 2026-11-04: '8윙의날개와 8헌터보우 입력하면 이제 몇 퍼센트가 강해지는지', 같은 날 '콤팩트하게, 고도화').
// 자료는 data/enhance.json (scripts/build_enhance.py: 카페 글 331665 첨부 '무기 강화수치 26.10' + 위키 장비 표).
// 강화 데미지 = 기본 데미지 x (1 + 가산값 / 100): 전사·레인저·무도가는 공통 가산치, 마법사는 무기마다 다른 가산치.
// 화면: 무기마다 한 줄(그림 · 이름 칸 · − +N +), 결과(평균 % 차이, 최소·최대, 같은 데미지가 되는 강화), 강화 곡선, 단계별 표, 톡방 시세(시세 동향 자료).
import { useCallback, useMemo, useState } from "react";
import type { Me } from "../auth";
import { loadEnhance, loadTrend, useAsync } from "../data";
import type { Enhance, EnhanceWeapon, Trend } from "../data";
import type { Wiki } from "../types";
import { Loading, PicImg, TopBar } from "../ui";

const KNUM: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10 };
const key = (s: string) => s.replace(/\s+/g, "");
/** 톡방 줄임말의 한 글자 (닼 = 다크, 롭 = 로브) */
const squeeze = (s: string) => s.replace(/닼/g, "다크").replace(/롭/g, "로브");
const JOB_OF: Record<string, string> = { warrior: "전사", ranger: "레인저", mage: "마법사", monk: "무도가" };

/** '8윙의날개', '+8 윙의날개', '8강 윙의날개', '팔헌보' -> 강화와 이름 */
function parse(text: string): { plus: number | null; name: string } {
  const m = text.trim().match(/^\+?\s*(\d{1,2}|[일이삼사오육칠팔구십](?=\s*강|[^\s]))?\s*강?\s*(.*)$/);
  if (!m) return { plus: null, name: text.trim() };
  const raw = m[1];
  const plus = raw === undefined ? null : raw in KNUM ? KNUM[raw] : Number(raw);
  return { plus, name: m[2].trim() };
}

/** 이름 찾기: 같음 > 앞이 같음 > 들어 있음 > 글자가 차례로 들어 있음 (헌보 = 헌터보우) */
function score(q: string, name: string): number {
  const n = key(name);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length && q.length >= 2 ? 40 : 0;
}

function bonusOf(d: Enhance, w: EnhanceWeapon): number[] | null {
  if (w.bonus === "common") return d.common;
  if (w.bonus === "mage") return d.mage[key(w.name)] ?? null;
  return null;
}
const maxPlus = (d: Enhance, w: EnhanceWeapon) => (bonusOf(d, w)?.length ?? 1) - 1;

function damage(d: Enhance, w: EnhanceWeapon, plus: number) {
  const b = bonusOf(d, w)?.[plus] ?? 0;
  const min = w.min * (1 + b / 100);
  const max = w.max * (1 + b / 100);
  return { min, max, avg: (min + max) / 2 };
}

/** 다른 무기가 이 평균 데미지에 닿는 가장 낮은 강화 (못 닿으면 null) */
function reach(d: Enhance, w: EnhanceWeapon, avg: number): number | null {
  for (let p = 0; p <= maxPlus(d, w); p++) if (damage(d, w, p).avg >= avg - 1e-9) return p;
  return null;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("ko-KR");
const pct = (a: number, b: number) => (a > 0 ? (b / a - 1) * 100 : 0);
const pctText = (p: number) => (p > 0 ? "+" : "") + (Math.round(p * 10) / 10).toFixed(1) + "%";
const tone = (p: number) => (p > 0.05 ? " enh-up" : p < -0.05 ? " enh-down" : "");
/** 만 원 -> '38만', '1.5만', '6700원' */
const won = (man: number) => (man >= 1 ? `${Math.round(man * 10) / 10}만` : `${Math.round(man * 10000).toLocaleString("ko-KR")}원`);
const label = (w: EnhanceWeapon, plus: number) => `+${plus} ${w.name}`;

interface Pick {
  q: string;
  w: EnhanceWeapon | null;
  plus: number;
}

function initial(d: Enhance | undefined, text: string | null): Pick {
  const p: Pick = { q: text ?? "", w: null, plus: 0 };
  if (!d || !text) return p;
  const { plus, name } = parse(text);
  const k = squeeze(key(name));
  const w = d.weapons.find((x) => key(x.name) === k) ?? null;
  return { q: text, w, plus: w ? Math.min(plus ?? 0, maxPlus(d, w)) : plus ?? 0 };
}

/** 무기 한 줄: 그림 · 이름 칸 · − +N +. 아래에 직업·레벨·기본 데미지와 다음 강화의 오름, 적는 동안 후보 */
function WeaponRow({ d, wiki, me, side, hint, pick, onPick }: { d: Enhance; wiki: Wiki; me: Me; side: "a" | "b"; hint: string; pick: Pick; onPick: (p: Pick) => void }) {
  const [focus, setFocus] = useState(false);
  const { name } = parse(pick.q);
  const q = squeeze(key(name));
  const hits = useMemo(() => {
    if (pick.w && key(pick.w.name) === q) return [];
    if (!q) {
      // 비어 있으면 내 직업의 내 레벨 근처 무기 (제작자 요청 2026-11-04 고도화)
      const job = me.job ? JOB_OF[me.job] : null;
      if (!focus || !job) return [];
      const lv = me.level ?? 30;
      return d.weapons
        .filter((w) => w.job === job && w.bonus)
        .sort((a, b) => Math.abs((a.lv ?? 0) - lv) - Math.abs((b.lv ?? 0) - lv))
        .slice(0, 6)
        .sort((a, b) => (a.lv ?? 0) - (b.lv ?? 0));
    }
    return d.weapons
      .map((w) => ({ w, s: score(q, w.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.w.lv ?? 0) - (b.w.lv ?? 0))
      .slice(0, 6)
      .map((x) => x.w);
  }, [d, q, pick.w, focus, me.job, me.level]);
  const type = (text: string) => {
    const r = parse(text);
    const k = squeeze(key(r.name));
    const w = d.weapons.find((x) => key(x.name) === k) ?? null;
    const plus = r.plus ?? pick.plus;
    onPick({ q: text, w, plus: w ? Math.min(plus, maxPlus(d, w)) : plus });
  };
  const set = (w: EnhanceWeapon, plus: number) => onPick({ q: `${plus ? `+${plus} ` : ""}${w.name}`, w, plus });
  const choose = (w: EnhanceWeapon) => set(w, Math.min(pick.plus, maxPlus(d, w)));
  const step = (n: number) => pick.w && set(pick.w, Math.max(0, Math.min(maxPlus(d, pick.w), pick.plus + n)));
  const pic = pick.w ? wiki.items[pick.w.name]?.icon : null;
  const top = pick.w ? maxPlus(d, pick.w) : 0;
  const cur = pick.w ? damage(d, pick.w, pick.plus) : null;
  const next = pick.w && pick.plus < top ? pct(cur!.avg, damage(d, pick.w, pick.plus + 1).avg) : null;
  return (
    <div className={"enh-pick enh-" + side}>
      <div className="enh-row">
        <span className="mk-slot enh-slot">{pic ? <PicImg pic={pic} max={26} /> : null}</span>
        <input
          className="enh-input"
          value={pick.q}
          placeholder={hint}
          onChange={(e) => type(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          enterKeyHint="done"
        />
        <span className="enh-step">
          <button type="button" className="pill" onClick={() => step(-1)} disabled={!pick.w || pick.plus <= 0}>
            −
          </button>
          <b>+{pick.plus}</b>
          <button type="button" className="pill" onClick={() => step(1)} disabled={!pick.w || pick.plus >= top}>
            +
          </button>
        </span>
      </div>
      {pick.w && cur && (
        <div className="enh-meta">
          Lv.{pick.w.lv ?? "?"} · {fmt(cur.min)}~{fmt(cur.max)}
          {top === 0 ? <span className="muted"> · 강화 수치 없음</span> : next !== null ? <span className="enh-up"> · 다음 {pctText(next)}</span> : null}
        </div>
      )}
      {hits.length > 0 && (
        <div className="enh-hits">
          {hits.map((w) => (
            <button key={w.name} type="button" className="enh-hit" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(w)}>
              {w.name}
              <small>Lv.{w.lv ?? "?"}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 강화 곡선: +0~+15 평균 데미지, 고른 강화에 점. 단계별 표의 '지금 대비'는 바꿀 무기 +N 이 지금 무기(고른 강화)보다 몇 % 센지 */
function Curve({ d, a, b }: { d: Enhance; a: Pick & { w: EnhanceWeapon }; b: Pick & { w: EnhanceWeapon } }) {
  const W = 300, H = 96, L = 4, R = 4, T = 8, B = 14;
  const top = Math.max(maxPlus(d, a.w), maxPlus(d, b.w), 1);
  const series = [a, b].map((p) => Array.from({ length: maxPlus(d, p.w) + 1 }, (_, i) => damage(d, p.w, i).avg));
  const ymax = Math.max(...series.flat()) * 1.05;
  const x = (i: number) => L + (i / top) * (W - L - R);
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  return (
    <svg className="enh-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="강화 곡선">
      {[0, 5, 10, 15].filter((i) => i <= top).map((i) => (
        <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} className="enh-grid" />
          <text x={x(i)} y={H - 3} className="enh-axis" textAnchor={i === 0 ? "start" : i === top ? "end" : "middle"}>
            +{i}
          </text>
        </g>
      ))}
      {series.map((s, k) => (
        <g key={k} className={k ? "enh-line-b" : "enh-line-a"}>
          <polyline fill="none" points={s.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
          {(() => {
            const p = k ? b.plus : a.plus;
            return <circle cx={x(p)} cy={y(s[p])} r={3.5} />;
          })()}
        </g>
      ))}
    </svg>
  );
}

/** 톡방 시세 (시세 동향 자료): 그 무기 그 강화의 팝니다 중간값 */
function priceOf(t: Trend | undefined, w: EnhanceWeapon, plus: number): { med: number; n: number } | null {
  if (!t) return null;
  const it = t.items.find((x) => key(x.name) === key(w.name));
  if (!it) return null;
  const g = it.groups.find((x) => x.label === `+${plus}` || (plus === 0 && x.label === "노강"));
  return g ? { med: g.med, n: g.n } : null;
}

function Result({ d, t, a, b }: { d: Enhance; t?: Trend; a: Pick; b: Pick }) {
  const [table, setTable] = useState(false);
  if (!a.w || !b.w) return null;
  const A = a as Pick & { w: EnhanceWeapon };
  const B = b as Pick & { w: EnhanceWeapon };
  const x = damage(d, A.w, A.plus);
  const y = damage(d, B.w, B.plus);
  const p = pct(x.avg, y.avg);
  const bReach = reach(d, B.w, x.avg);
  const aReach = reach(d, A.w, y.avg);
  const pa = priceOf(t, A.w, A.plus);
  const pb = priceOf(t, B.w, B.plus);
  const top = Math.max(maxPlus(d, A.w), maxPlus(d, B.w));
  return (
    <section className="enh-card enh-result">
      <div className="enh-head">
        <div className={"enh-big" + tone(p)}>{pctText(p)}</div>
        <div className="enh-headside">
          <div>
            평균 {fmt(x.avg)} → <b>{fmt(y.avg)}</b>
          </div>
          <div className="muted">
            최소 {fmt(x.min)} → {fmt(y.min)} <span className={tone(pct(x.min, y.min))}>{pctText(pct(x.min, y.min))}</span>
          </div>
          <div className="muted">
            최대 {fmt(x.max)} → {fmt(y.max)} <span className={tone(pct(x.max, y.max))}>{pctText(pct(x.max, y.max))}</span>
          </div>
        </div>
      </div>
      <div className="enh-eq">
        <div>
          <span className="enh-dot enh-dot-a" />
          {label(A.w, A.plus)} ≈ {B.w.name} {bReach === null ? <b className="enh-down">+{maxPlus(d, B.w)}로도 못 미침</b> : <b>+{bReach}</b>}
        </div>
        <div>
          <span className="enh-dot enh-dot-b" />
          {label(B.w, B.plus)} ≈ {A.w.name} {aReach === null ? <b className="enh-down">+{maxPlus(d, A.w)}로도 못 미침</b> : <b>+{aReach}</b>}
        </div>
      </div>
      <Curve d={d} a={A} b={B} />
      {(pa || pb) && (
        <div className="enh-price">
          <span className="muted">톡방 시세</span>
          <span>
            <span className="enh-dot enh-dot-a" />
            {pa ? `${won(pa.med)} (${pa.n})` : "글 없음"}
          </span>
          <span>
            <span className="enh-dot enh-dot-b" />
            {pb ? `${won(pb.med)} (${pb.n})` : "글 없음"}
          </span>
          {pa && pb && <span className="muted">차이 {won(Math.abs(pb.med - pa.med))}</span>}
        </div>
      )}
      <button type="button" className="enh-more" onClick={() => setTable(!table)} aria-expanded={table}>
        단계별 {table ? "▴" : "▾"}
      </button>
      {table && (
        <table className="enh-table">
          <thead>
            <tr>
              <th />
              <th>
                <span className="enh-dot enh-dot-a" />
                {A.w.name}
              </th>
              <th>
                <span className="enh-dot enh-dot-b" />
                {B.w.name}
              </th>
              <th>지금 대비</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: top + 1 }, (_, i) => {
              const u = i <= maxPlus(d, A.w) ? damage(d, A.w, i).avg : null;
              const v = i <= maxPlus(d, B.w) ? damage(d, B.w, i).avg : null;
              return (
                <tr key={i} className={i === A.plus || i === B.plus ? "enh-on" : ""}>
                  <th>+{i}</th>
                  <td className={i === A.plus ? "enh-cur-a" : ""}>{u === null ? "-" : fmt(u)}</td>
                  <td className={i === B.plus ? "enh-cur-b" : ""}>{v === null ? "-" : fmt(v)}</td>
                  <td className={v !== null ? tone(pct(x.avg, v)) : ""}>{v !== null ? pctText(pct(x.avg, v)) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** 고른 두 무기를 주소에 남겨 링크로 보낼 수 있게 (기록 칸을 늘리지 않는다) */
function keepInUrl(a: Pick, b: Pick) {
  const enc = (p: Pick) => (p.w ? encodeURIComponent(`${p.plus}${p.w.name}`) : "");
  const qs = [a.w && `a=${enc(a)}`, b.w && `b=${enc(b)}`].filter(Boolean).join("&");
  const to = "#/enhance" + (qs ? `?${qs}` : "");
  if (location.hash !== to) history.replaceState(history.state, "", to);
}

export function EnhancePage({ wiki, query, me }: { wiki: Wiki; query: URLSearchParams; me: Me }) {
  const { data: d, error } = useAsync(useCallback(() => loadEnhance(), []));
  const { data: t } = useAsync(useCallback(() => loadTrend().catch(() => undefined as unknown as Trend), []));
  const [a, setA] = useState<Pick | null>(null);
  const [b, setB] = useState<Pick | null>(null);
  const pa = a ?? initial(d, query.get("a"));
  const pb = b ?? initial(d, query.get("b"));
  const pickA = (p: Pick) => {
    setA(p);
    keepInUrl(p, pb);
  };
  const pickB = (p: Pick) => {
    setB(p);
    keepInUrl(pa, p);
  };
  const swap = () => {
    setA(pb);
    setB(pa);
    keepInUrl(pb, pa);
  };
  return (
    <>
      <TopBar title="강화 비교" right={<span className="pill trend-dev">개발중</span>} />
      {!d ? (
        <Loading error={error?.includes("404") ? "강화 자료가 아직 없어요" : error} />
      ) : (
        <div className="enh">
          <section className="enh-card enh-picks">
            <WeaponRow d={d} wiki={wiki} me={me} side="a" hint="지금 무기 (8헌터보우)" pick={pa} onPick={pickA} />
            <button type="button" className="enh-swap" onClick={swap} aria-label="위아래 바꾸기">
              ⇅
            </button>
            <WeaponRow d={d} wiki={wiki} me={me} side="b" hint="바꿀 무기 (8윙의날개)" pick={pb} onPick={pickB} />
          </section>
          <Result d={d} t={t} a={pa} b={pb} />
          <p className="trend-src muted">카페 '아이모 장비 강화 수치' 무기 강화수치(26.10)</p>
        </div>
      )}
    </>
  );
}
