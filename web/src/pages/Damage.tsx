// 데미지 계산기 (개발중, 제작자 요청 2026-11-11 '데미지 계산기' + 카페 글 331187 '직업별 무기 강화도에 따른 기본 데미지 산출공식' -> '새 메뉴로').
// 자료: data/enhance.json (scripts/build_enhance.py: 무기 42개, 강화 가산값, 방어구 기본 방어도마다 +0~+15 방어도) + 위키 장비 표의 방어구 방어력.
// 공식 (컴투스 공식 강화 효과 페이지, 글 331187 · 331665 엑셀과 같은 값):
//   기본 데미지 = 무기 기본 데미지 x (1 + 강화도 가산값 / 100)
//   근접·원거리 데미지는 상대 방어도 / 5 만큼 빠진다 (마법 데미지는 이 규칙에 없다: 마법사는 빼지 않는다).
// 힘·민첩·지능, 스킬 계수가 들어간 최종 데미지 공식은 공개되지 않아 '기본 데미지' 기준이다.
// 화면: 내 무기(강화 비교의 무기 칸 그대로) · 상대 방어구(부위마다 장비와 강화, 장신구는 방어력 그대로, 기타 방어도 직접) · 결과(방어 전·후 막대) · 강화별 표.
import { useCallback, useState } from "react";
import type { Me } from "../auth";
import { loadEnhance, useAsync } from "../data";
import type { Enhance } from "../data";
import type { Pic, Wiki } from "../types";
import { useEntryState } from "../router";
import { FlowLine, Loading, PicImg, TopBar } from "../ui";
import { EMPTY, JOBS, JOB_OF, Pop, WeaponCard, WeaponList, damage, fmt, initial, listFor, maxPlus } from "./Enhance";
import type { Pick } from "./Enhance";

/** 상대 방어구 칸: 강화되는 부위(− +)와 장신구(방어력 그대로) */
const SLOTS: { slot: string; name: string; enhance: boolean }[] = [
  { slot: "투구", name: "투구", enhance: true },
  { slot: "갑옷", name: "갑옷", enhance: true },
  { slot: "장갑", name: "장갑", enhance: true },
  { slot: "신발", name: "신발", enhance: true },
  { slot: "보조 장비", name: "보조", enhance: true },
  { slot: "망토", name: "망토", enhance: false },
  { slot: "벨트", name: "벨트", enhance: false },
  { slot: "목걸이", name: "목걸이", enhance: false },
  { slot: "반지", name: "반지", enhance: false },
];
const ARMOR_JOBS = ["전체", ...JOBS] as const;
const MAGE_DMG_NOTE = "마법 데미지는 방어도로 빠지지 않아요 · 근접·원거리만 방어도/5 만큼 빠져요";
const ROWS = [6, 7, 8, 9, 10];

interface ArmorItem {
  name: string;
  lv: number;
  def: number;
  job: string;
  icon: Pic | null;
}

const num = (s: string | undefined) => {
  const v = Number(String(s ?? "").replace(/[^\d.]/g, ""));
  return String(s ?? "").trim() && Number.isFinite(v) ? v : NaN;
};

/** 위키 장비 표에서 부위마다 방어력이 있는 장비 (높은 레벨부터: 낮은 쪽은 Lv.1 코스튬이 많다). 이미 강화된 이벤트 장비('+7…')는 뺀다 */
function armorItems(wiki: Wiki): Record<string, ArmorItem[]> {
  const out: Record<string, ArmorItem[]> = {};
  for (const t of wiki.equipment) {
    if (!SLOTS.some((s) => s.slot === t.slot)) continue;
    const list = (out[t.slot] ??= []);
    for (const row of t.rows) {
      const h = row.h ?? t.headers;
      const cell = (n: string) => (h.indexOf(n) >= 0 ? row.cells[h.indexOf(n)] : undefined);
      const name = row.name.trim();
      const def = num(cell("방어력"));
      if (!name || /^\+/.test(name) || !Number.isFinite(def) || def < 1 || list.some((x) => x.name === name)) continue;
      list.push({ name, lv: num(cell("레벨제한")) || 0, def, job: cell("직업") ?? "", icon: row.icon });
    }
    list.sort((a, b) => b.lv - a.lv || b.def - a.def || a.name.localeCompare(b.name, "ko"));
  }
  return out;
}

/** 강화한 방어도: 기본 방어도 표(1~30), 표에 없으면 강화마다 +1 */
function armorAt(d: Enhance, def: number, plus: number): number {
  const t = d.armor?.[String(def)];
  return t ? t[Math.min(plus, t.length - 1)] ?? def : def + plus;
}

/** 고른 방어구: 부위 -> [이름, 강화] */
type Worn = Record<string, [string, number]>;

function ArmorRow({ d, slot, items, worn, job, open, onOpen, onSet }: {
  d: Enhance;
  slot: (typeof SLOTS)[number];
  items: ArmorItem[];
  worn: [string, number] | undefined;
  job: string;
  open: boolean;
  onOpen: () => void;
  onSet: (v: [string, number] | null) => void;
}) {
  const it = worn ? items.find((x) => x.name === worn[0]) : undefined;
  const plus = worn?.[1] ?? 0;
  const value = it ? (slot.enhance ? armorAt(d, it.def, plus) : it.def) : 0;
  const shown = job === "전체" ? items : items.filter((x) => !x.job || x.job.includes(job) || x.job.includes("공용"));
  return (
    <>
      <div className={"dmg-row" + (open ? " dmg-row-on" : "")}>
        <span className="dmg-slot">{slot.name}</span>
        <button type="button" className={"dmg-item" + (it ? "" : " dmg-item-empty")} onClick={onOpen} aria-expanded={open}>
          {it?.icon ? <PicImg pic={it.icon} max={18} /> : null}
          <span>{it ? it.name : "없음"}</span>
        </button>
        {slot.enhance && it ? (
          <span className="enh-step dmg-step">
            <button type="button" className="pill" onClick={() => onSet([it.name, Math.max(0, plus - 1)])} disabled={plus <= 0} aria-label={`${slot.name} 강화 내리기`}>
              −
            </button>
            <b>
              <Pop value={plus}>+{plus}</Pop>
            </b>
            <button type="button" className="pill" onClick={() => onSet([it.name, Math.min(15, plus + 1)])} disabled={plus >= 15} aria-label={`${slot.name} 강화 올리기`}>
              +
            </button>
          </span>
        ) : (
          <span />
        )}
        <span className="dmg-def">
          <Pop value={value}>{value || "-"}</Pop>
        </span>
      </div>
      {open && (
        <div className="dmg-list">
          <button type="button" className={"dmg-opt" + (it ? "" : " dmg-opt-on")} onClick={() => onSet(null)}>
            없음
          </button>
          {shown.map((x) => (
            <button key={x.name} type="button" className={"dmg-opt" + (it?.name === x.name ? " dmg-opt-on" : "")} onClick={() => onSet([x.name, it?.name === x.name ? plus : slot.enhance ? Math.min(plus, 15) : 0])}>
              {x.icon ? <PicImg pic={x.icon} max={16} /> : null}
              <span>{x.name}</span>
              <small>
                Lv.{x.lv} · 방어 {x.def}
              </small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Result({ d, pick, armor }: { d: Enhance; pick: Pick; armor: number }) {
  if (!pick.w) return null;
  const magic = pick.w.job === "마법사";
  const cut = magic ? 0 : armor / 5;
  const base = damage(d, pick.w, pick.plus);
  const after = { min: Math.max(0, base.min - cut), max: Math.max(0, base.max - cut), avg: Math.max(0, base.avg - cut) };
  const loss = base.avg > 0 ? ((base.avg - after.avg) / base.avg) * 100 : 0;
  const hi = base.max || 1;
  const at = (v: number) => (v / hi) * 100;
  const bars = [
    { s: base, side: "a", name: "방어 전" },
    { s: after, side: "b", name: "방어 후" },
  ];
  return (
    <section className="enh-card dmg-result">
      <div className="dmg-res-top">
        <div className="enh-res-mid">
          <small>빠지는 데미지</small>
          <div className={"enh-big" + (cut > 0 ? " enh-down" : "")}>
            <Pop value={fmt(cut)}>{cut > 0 ? "−" + fmt(cut) : "0"}</Pop>
          </div>
        </div>
        <div className="enh-res-mid">
          <small>중앙값</small>
          <div className="enh-big">
            <Pop value={fmt(after.avg)}>{fmt(after.avg)}</Pop>
          </div>
        </div>
        <div className="enh-res-mid">
          <small>줄어듦</small>
          <div className={"enh-big" + (loss > 0.05 ? " enh-down" : "")}>
            <Pop value={loss.toFixed(1)}>{loss > 0.05 ? "−" + loss.toFixed(1) + "%" : "0%"}</Pop>
          </div>
        </div>
      </div>
      <div className="dmg-bars">
        {bars.map(({ s, side, name }) => (
          <div key={side} className={"dmg-bar enh-rbar-" + side}>
            <small>{name}</small>
            <span className="enh-rbar-n">{fmt(s.min)}</span>
            <span className="enh-rbar-track">
              <i className="enh-rbar-fill" style={{ left: `${at(s.min)}%`, width: `${Math.max(0, at(s.max) - at(s.min))}%` }} />
              <i className="enh-rbar-avg" style={{ left: `${at(s.avg)}%` }} />
            </span>
            <span className="enh-rbar-n">{fmt(s.max)}</span>
          </div>
        ))}
      </div>
      <table className="dmg-table">
        <thead>
          <tr>
            <th>강화</th>
            <th>방어 전</th>
            <th>방어 후</th>
            <th>줄어듦</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.filter((k) => k <= maxPlus(d, pick.w!)).map((k) => {
            const b = damage(d, pick.w!, k);
            const a = Math.max(0, b.avg - cut);
            return (
              <tr key={k} className={k === pick.plus ? "dmg-tr-on" : ""}>
                <td>+{k}</td>
                <td>{fmt(b.avg)}</td>
                <td>{fmt(a)}</td>
                <td>{b.avg > 0 && cut > 0 ? "−" + (((b.avg - a) / b.avg) * 100).toFixed(1) + "%" : "0%"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function DamagePage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const { data: d, error } = useAsync(useCallback(() => loadEnhance(), []));
  const [saved, setSaved] = useEntryState<string | null>("dmg.w", null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [jobPick, setJob] = useEntryState<string | null>("dmg.job", null);
  const [worn, setWorn] = useEntryState<Worn>("dmg.armor", {});
  const [extra, setExtra] = useEntryState<string>("dmg.extra", "");
  const [armorJob, setArmorJob] = useEntryState<string>("dmg.ajob", "전체");
  const [listOpen, setListOpen] = useState<boolean | null>(null);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const items = useState(() => armorItems(wiki))[0];
  const p = pick ?? initial(d, saved);
  const job = jobPick ?? p.w?.job ?? (me.job ? JOB_OF[me.job] : null) ?? "전사";
  const open = listOpen ?? !p.w;
  const shown = d ? listFor(d, p, job, open) : [];
  const choose = (n: Pick) => {
    setPick(n);
    if (n.w) {
      setSaved(`${n.plus}${n.w.name}`);
      if (n.w.job !== job) setJob(n.w.job);
      if (n.w !== p.w) setListOpen(false);
    }
  };
  const pickJob = (j: string) => {
    setJob(j);
    if (j !== job) {
      setPick(EMPTY);
      setSaved(null);
    }
    setListOpen(true);
  };
  const extraN = Math.max(0, Math.min(9999, Number(extra) || 0));
  const total =
    (d
      ? SLOTS.reduce((sum, s) => {
          const w = worn[s.slot];
          const it = w ? items[s.slot]?.find((x) => x.name === w[0]) : undefined;
          return sum + (it ? (s.enhance ? armorAt(d, it.def, w![1]) : it.def) : 0);
        }, 0)
      : 0) + extraN;
  const setSlot = (slot: string, v: [string, number] | null) => {
    setWorn((prev) => {
      const next = { ...prev };
      if (v) next[slot] = v;
      else delete next[slot];
      return next;
    });
    if (!v || v[0] !== worn[slot]?.[0]) setOpenSlot(null);
  };
  return (
    <>
      <TopBar title="데미지 계산기" />
      {!d ? (
        <Loading error={error?.includes("404") ? "강화 자료가 아직 없어요" : error} />
      ) : (
        <div className="enh dmg">
          {job === "마법사" && (
            <div className="maint-wrap enh-note">
              <div className="maint" role="note">
                <span className="maint-dot" aria-hidden />
                <FlowLine text={MAGE_DMG_NOTE} />
              </div>
            </div>
          )}
          <section className={"enh-card enh-picks" + (shown.length ? " enh-tab enh-on-a" : "")}>
            <div className="mk-sub enh-jobs" role="tablist">
              {JOBS.map((j) => (
                <button key={j} type="button" role="tab" aria-selected={job === j} className={"sub-tab" + (job === j ? " sub-tab-on" : "")} onClick={() => pickJob(j)}>
                  {j}
                </button>
              ))}
            </div>
            <WeaponCard d={d} wiki={wiki} side="a" hint="내 무기" pick={p} onPick={choose} open={shown.length > 0} onOpen={() => setListOpen(true)} />
            <WeaponList d={d} side="a" pick={p} shown={shown} onPick={choose} />
          </section>
          <section className="enh-card dmg-armor">
            <div className="dmg-head">
              <b>상대 방어도</b>
              <b className="dmg-total">
                <Pop value={total}>{total}</Pop>
              </b>
              <button
                type="button"
                className="pill dmg-clear"
                onClick={() => {
                  setWorn({});
                  setExtra("");
                  setOpenSlot(null);
                }}
                disabled={total === 0}
              >
                지우기
              </button>
            </div>
            <div className="mk-sub dmg-jobs" role="tablist">
              {ARMOR_JOBS.map((j) => (
                <button key={j} type="button" role="tab" aria-selected={armorJob === j} className={"sub-tab" + (armorJob === j ? " sub-tab-on" : "")} onClick={() => setArmorJob(j)}>
                  {j}
                </button>
              ))}
            </div>
            <div className="dmg-rows">
              {SLOTS.map((s) => (
                <ArmorRow
                  key={s.slot}
                  d={d}
                  slot={s}
                  items={items[s.slot] ?? []}
                  worn={worn[s.slot]}
                  job={armorJob}
                  open={openSlot === s.slot}
                  onOpen={() => setOpenSlot(openSlot === s.slot ? null : s.slot)}
                  onSet={(v) => setSlot(s.slot, v)}
                />
              ))}
              <div className="dmg-row">
                <span className="dmg-slot">기타</span>
                <input
                  className="dmg-extra"
                  inputMode="numeric"
                  placeholder="세트·버프 방어도"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                />
                <span />
                <span className="dmg-def">{extraN || "-"}</span>
              </div>
            </div>
          </section>
          <Result d={d} pick={p} armor={total} />
        </div>
      )}
    </>
  );
}
