// 강화 비교 (개발중, 제작자 요청 2026-11-04: '8윙의날개와 8헌터보우 입력하면 이제 몇 퍼센트가 강해지는지').
// 자료는 data/enhance.json (scripts/build_enhance.py: 카페 글 331665 첨부 '무기 강화수치 26.10' + 위키 장비 표).
// 강화 데미지 = 기본 데미지 x (1 + 가산값 / 100): 전사·레인저·무도가는 공통 가산치, 마법사는 무기마다 다른 가산치.
import { useCallback, useMemo, useState } from "react";
import { loadEnhance, useAsync } from "../data";
import type { Enhance, EnhanceWeapon } from "../data";
import type { Wiki } from "../types";
import { Loading, PicImg, TopBar } from "../ui";

const KNUM: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10 };
const key = (s: string) => s.replace(/\s+/g, "");
/** 톡방 줄임말의 한 글자 (닼 = 다크, 롭 = 로브) */
const squeeze = (s: string) => s.replace(/닼/g, "다크").replace(/롭/g, "로브");

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

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("ko-KR");
const pct = (a: number, b: number) => (a > 0 ? (b / a - 1) * 100 : 0);
const pctText = (p: number) => (p > 0 ? "+" : "") + (Math.round(p * 10) / 10).toFixed(1) + "%";

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

function WeaponPick({ d, wiki, label, hint, pick, onPick }: { d: Enhance; wiki: Wiki; label: string; hint: string; pick: Pick; onPick: (p: Pick) => void }) {
  const { name } = parse(pick.q);
  const q = squeeze(key(name));
  const hits = useMemo(() => {
    if (!q || (pick.w && key(pick.w.name) === q)) return [];
    return d.weapons
      .map((w) => ({ w, s: score(q, w.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.w.lv ?? 0) - (b.w.lv ?? 0))
      .slice(0, 6);
  }, [d, q, pick.w]);
  const type = (text: string) => {
    const r = parse(text);
    const k = squeeze(key(r.name));
    const w = d.weapons.find((x) => key(x.name) === k) ?? null;
    const plus = r.plus ?? pick.plus;
    onPick({ q: text, w, plus: w ? Math.min(plus, maxPlus(d, w)) : plus });
  };
  const choose = (w: EnhanceWeapon) => {
    const plus = Math.min(pick.plus, maxPlus(d, w));
    onPick({ q: (plus ? `+${plus} ` : "") + w.name, w, plus });
  };
  const step = (n: number) => {
    if (!pick.w) return;
    const plus = Math.max(0, Math.min(maxPlus(d, pick.w), pick.plus + n));
    onPick({ q: (plus ? `+${plus} ` : "") + pick.w.name, w: pick.w, plus });
  };
  const pic = pick.w ? wiki.items[pick.w.name]?.icon : null;
  const top = pick.w ? maxPlus(d, pick.w) : 0;
  return (
    <section className="enh-card">
      <div className="enh-label">{label}</div>
      <input className="enh-input" value={pick.q} placeholder={hint} onChange={(e) => type(e.target.value)} enterKeyHint="done" />
      {hits.length > 0 && (
        <div className="enh-hits">
          {hits.map(({ w }) => (
            <button key={w.name} type="button" className="enh-hit" onClick={() => choose(w)}>
              {w.name}
              <small>
                {w.job} · Lv.{w.lv ?? "?"}
              </small>
            </button>
          ))}
        </div>
      )}
      {pick.w && (
        <div className="enh-chosen">
          <span className="mk-slot enh-slot">{pic ? <PicImg pic={pic} max={30} /> : null}</span>
          <span className="enh-name">
            <b>{pick.w.name}</b>
            <small>
              {pick.w.job} · Lv.{pick.w.lv ?? "?"}
            </small>
          </span>
          {top > 0 ? (
            <span className="enh-step">
              <button type="button" className="pill" onClick={() => step(-1)} disabled={pick.plus <= 0}>
                −
              </button>
              <b>+{pick.plus}</b>
              <button type="button" className="pill" onClick={() => step(1)} disabled={pick.plus >= top}>
                +
              </button>
            </span>
          ) : (
            <small className="muted">강화 수치 없음</small>
          )}
        </div>
      )}
    </section>
  );
}

function Result({ d, a, b }: { d: Enhance; a: Pick; b: Pick }) {
  if (!a.w || !b.w) return null;
  const x = damage(d, a.w, a.plus);
  const y = damage(d, b.w, b.plus);
  const p = pct(x.avg, y.avg);
  const tone = p > 0.05 ? " enh-up" : p < -0.05 ? " enh-down" : "";
  const rows: [string, number, number][] = [
    ["최소", x.min, y.min],
    ["최대", x.max, y.max],
    ["평균", x.avg, y.avg],
  ];
  return (
    <section className="enh-card enh-result">
      <div className={"enh-big" + tone}>{pctText(p)}</div>
      <div className="enh-sub">
        +{a.plus} {a.w.name} → +{b.plus} {b.w.name}
      </div>
      <table className="enh-table">
        <thead>
          <tr>
            <th />
            <th>지금</th>
            <th>바꿀 무기</th>
            <th>차이</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([n, u, v]) => (
            <tr key={n}>
              <th>{n}</th>
              <td>{fmt(u)}</td>
              <td>{fmt(v)}</td>
              <td className={v > u ? "enh-up" : v < u ? "enh-down" : ""}>{pctText(pct(u, v))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function EnhancePage({ wiki, query }: { wiki: Wiki; query: URLSearchParams }) {
  const { data: d, error } = useAsync(useCallback(() => loadEnhance(), []));
  const [a, setA] = useState<Pick | null>(null);
  const [b, setB] = useState<Pick | null>(null);
  const pa = a ?? initial(d, query.get("a"));
  const pb = b ?? initial(d, query.get("b"));
  return (
    <>
      <TopBar title="강화 비교" right={<span className="pill trend-dev">개발중</span>} />
      {!d ? (
        <Loading error={error?.includes("404") ? "강화 자료가 아직 없어요" : error} />
      ) : (
        <div className="enh">
          <WeaponPick d={d} wiki={wiki} label="지금 무기" hint="8헌터보우" pick={pa} onPick={setA} />
          <WeaponPick d={d} wiki={wiki} label="바꿀 무기" hint="8윙의날개" pick={pb} onPick={setB} />
          <Result d={d} a={pa} b={pb} />
          <p className="trend-src muted">카페 '아이모 장비 강화 수치' 무기 강화수치(26.10)</p>
        </div>
      )}
    </>
  );
}
