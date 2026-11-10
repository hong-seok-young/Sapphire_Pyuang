// 기부함 (개발중, 제작자 2026-11-10 길드 톡방: '모든 템을 골드로 환산하고 마일리지 환산', '기부하게 따로 기부함', 마을모금함 '마일리지 순위표, 명예의 전당').
// 칸: 명예의 전당(전체·이번 달) · 기부 내역 · 기부하기(신청과 내 기부) · 운영(신청 확정·직접 등록·받은 템). 서버 server/donate.ts
import { useCallback, useMemo, useState } from "react";
import { errorText } from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import { Nick } from "../kakao";
import { useEntryState } from "../router";
import { weaponOf } from "../rental";
import { ENCHANTS, ENCHANT_CATEGORIES, ENHANCE_CATEGORIES, categoryOf, inRoll, itemFacts, rollHint } from "../market";
import type { Enchant } from "../market";
import type { Item, Wiki } from "../types";
import { FitLine, Loading, PicImg, TopBar } from "../ui";
import {
  PLACE_NAME,
  STATUS_NAME,
  addDonate,
  askDonate,
  confirmDonate,
  dayText,
  diaText,
  mileText,
  donateExtra,
  donateLabel,
  editDonate,
  fetchDonate,
  goldText,
  placeDonate,
  rejectDonate,
  removeDonate,
  rentDonate,
} from "../donate";
import type { DonateData, DonateInput, DonateRow } from "../donate";

type Tab = "lines" | "give" | "staff";
type Staff = "pending" | "add" | "store";
type StoreFilter = "keep" | "rent" | "used" | "all";

/** 숫자 칸: 고치는 동안 비울 수 있게 글자로 둔다 (CLAUDE.md '숫자 칸') */
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,\s]/g, "")));

function ItemIcon({ wiki, name, size = 22 }: { wiki: Wiki | null; name: string; size?: number }) {
  const it = wiki ? weaponOf(wiki, name) : undefined;
  return <span className="dn-ic">{it?.icon ? <PicImg pic={it.icon} fit={size} /> : "🎁"}</span>;
}

/** 아이템 이름 칸과 위키 이름 고르기 (위키에 없으면 적은 그대로) */
function ItemName({ wiki, value, onChange }: { wiki: Wiki | null; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => {
    const q = value.replace(/\s+/g, "");
    if (!wiki || q.length < 1 || wiki.items[value]) return [] as Item[];
    return Object.values(wiki.items)
      .filter((it) => it.name.replace(/\s+/g, "").includes(q))
      .sort((a, b) => (a.name.replace(/\s+/g, "").startsWith(q) ? 0 : 1) - (b.name.replace(/\s+/g, "").startsWith(q) ? 0 : 1) || a.name.length - b.name.length)
      .slice(0, 6);
  }, [wiki, value]);
  return (
    <div className="dn-name">
      <input
        value={value}
        maxLength={40}
        placeholder="아이템 이름"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && hits.length > 0 && (
        <div className="dn-hits">
          {hits.map((it) => (
            <button
              key={it.name}
              type="button"
              onClick={() => {
                onChange(it.name);
                setOpen(false);
              }}
            >
              {it.icon ? <PicImg pic={it.icon} fit={18} /> : <span className="dn-ic">🎁</span>}
              {it.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FormState {
  item: string;
  qty: string;
  enhance: string;
  gold: string;
  note: string;
  /** 위키 장비의 범위 옵션마다 적은 값 (옵션 이름 -> 글자) */
  opts: Record<string, string>;
  /** 범위 옵션이 없는 것(위키에 없는 물건 등)의 옵션 줄글 ('지3 마재2', 서버가 '지능 3 · 마나재생 2' 로 통일) */
  optText: string;
  /** 속성부여 ('힘', 값) */
  ench: Enchant | null;
  enchVal: number | null;
}
const EMPTY: FormState = { item: "", qty: "1", enhance: "0", gold: "", note: "", opts: {}, optText: "", ench: null, enchVal: null };
/** '명중 9 · 크리티컬 4' -> { 명중: '9', 크리티컬: '4' } */
const optsOf = (s: string | null) =>
  Object.fromEntries(
    (s ?? "")
      .split("·")
      .map((p) => /^(.+?)\s*([\d.]+)%?$/.exec(p.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1].trim(), m[2]]),
  );
const fromRow = (r: DonateRow, gold: number | null): FormState => {
  const em = /^(\S+) (\d+)$/.exec(r.enchant ?? "");
  const ench = em ? ENCHANTS.find((e) => e.name === em[1]) : undefined;
  return {
    item: r.item,
    qty: String(r.qty),
    enhance: String(r.enhance),
    gold: gold === null ? "" : String(gold),
    note: r.note ?? "",
    opts: optsOf(r.options),
    optText: r.options ?? "",
    ench: ench?.key ?? null,
    enchVal: ench && em ? Number(em[2]) : null,
  };
};
/** 위키 장비면 그 장비의 종류·옵션 (강화·속성부여가 되는지, 범위 옵션) */
function gearOf(wiki: Wiki | null, name: string) {
  const it = wiki && name.trim() ? weaponOf(wiki, name.trim()) : undefined;
  const cat = categoryOf(it);
  if (!it || !cat) return null;
  const facts = itemFacts(it);
  return {
    it,
    cat,
    facts,
    enhance: ENHANCE_CATEGORIES.includes(cat) && !facts.options.notes.some((n) => n.includes("강화불가")),
    enchant: ENCHANT_CATEGORIES.includes(cat),
  };
}
function toInput(f: FormState, wiki: Wiki | null): DonateInput | string {
  const gear = gearOf(wiki, f.item);
  const qty = num(f.qty) ?? 1;
  const enhance = gear && !gear.enhance ? 0 : (num(f.enhance) ?? 0);
  const gold = num(f.gold);
  if (!f.item.trim()) return "아이템 이름을 적어 주세요";
  if (!Number.isInteger(qty) || qty < 1) return "개수가 맞지 않아요";
  if (!Number.isInteger(enhance) || enhance < 0 || enhance > 20) return "강화는 0~20 이에요";
  if (gold !== null && (!Number.isInteger(gold) || gold < 0)) return "골드 가치가 맞지 않아요";
  // 옵션은 위키 장비의 범위 옵션 중 적은 것만 (0 은 뺀다), 이름도 위키 이름으로
  const options = gear?.facts.options.rolls.length
    ? gear.facts.options.rolls
        .map((r) => [r.name, num(f.opts[r.name] ?? ""), r.unit] as const)
        .filter(([, v]) => v !== null && Number.isFinite(v) && v > 0)
        .map(([n, v, u]) => `${n} ${v}${u}`)
        .join(" · ")
    : f.optText.trim();
  const e = gear?.enchant && f.ench && f.enchVal !== null ? `${ENCHANTS.find((x) => x.key === f.ench)!.name} ${f.enchVal}` : "";
  return { item: gear ? gear.it.name : f.item.trim(), qty, enhance, gold, note: f.note.trim(), options, enchant: e };
}

/** 아이템 · 개수 · 강화 · 골드 가치 · 메모 칸 */
/**
 * 아이템 · 개수 · 강화 · 옵션 · 속성부여 · 골드 가치 · 메모 칸.
 * 위키 장비를 고르면 (제작자 2026-11-10 '헌터보우를 고르면 그 템의 옵션이 DB에 다 있으니까 옵션 적는 프리셋, 강화 정도, 속성부여 가능한 장신구면 그것도,
 * 아니면 옵션을 줄글로, 아이템 이름도 줄글로'): 그 장비에 뜨는 옵션마다 값 칸('명중 0~11'), 강화는 강화되는 부위만, 속성부여는 장신구만. 위키에 없으면 이름·옵션 모두 줄글
 */
function DonateFields({ wiki, f, set, goldLabel = "골드 가치" }: { wiki: Wiki | null; f: FormState; set: (f: FormState) => void; goldLabel?: string }) {
  const gold = num(f.gold);
  const gear = gearOf(wiki, f.item);
  const rolls = gear?.facts.options.rolls ?? [];
  const ench = f.ench ? ENCHANTS.find((e) => e.key === f.ench) : undefined;
  return (
    <div className="dn-fields">
      <div className="dn-row1">
        <ItemIcon wiki={wiki} name={f.item} />
        <ItemName wiki={wiki} value={f.item} onChange={(item) => set({ ...f, item })} />
      </div>
      {gear && (
        <p className="dn-gear">
          {[gear.facts.level && `Lv.${gear.facts.level}`, gear.cat, gear.facts.job, ...gear.facts.stats].filter(Boolean).join(" · ")}
          {gear.facts.options.fixed.length > 0 && <span> · {gear.facts.options.fixed.join(" · ")}</span>}
        </p>
      )}
      <div className="dn-row2">
        <label>
          개수
          <input inputMode="numeric" value={f.qty} onChange={(e) => set({ ...f, qty: e.target.value })} />
        </label>
        {(!gear || gear.enhance) && (
          <label>
            강화 +
            <input inputMode="numeric" value={f.enhance} onChange={(e) => set({ ...f, enhance: e.target.value })} />
          </label>
        )}
      </div>
      {rolls.length > 0 && (
        <div className="dn-opts">
          {rolls.map((r) => {
            const text = f.opts[r.name] ?? "";
            const off = text !== "" && !inRoll(r, Number(text));
            return (
              <label key={r.name} className="dn-opt">
                <b>{r.name}</b>
                <input
                  inputMode="decimal"
                  value={text}
                  placeholder="0"
                  aria-label={r.name}
                  onChange={(e) => set({ ...f, opts: { ...f.opts, [r.name]: e.target.value.replace(/[^\d.]/g, "").slice(0, 5) } })}
                />
                <small className={off ? "dn-opt-off" : ""}>{rollHint(r)}</small>
              </label>
            );
          })}
        </div>
      )}
      {gear?.enchant && (
        <div className="dn-ench">
          <span>속성부여</span>
          <div className="dn-chips">
            <button type="button" className={"pill" + (!f.ench ? " pill-on" : "")} onClick={() => set({ ...f, ench: null, enchVal: null })}>
              없음
            </button>
            {ENCHANTS.map((e) => (
              <button key={e.key} type="button" className={"pill" + (f.ench === e.key ? " pill-on" : "")} onClick={() => set({ ...f, ench: e.key, enchVal: null })}>
                {e.name}
              </button>
            ))}
          </div>
          {ench && (
            <div className="dn-chips">
              {ench.values.map((v) => (
                <button key={v} type="button" className={"pill" + (f.enchVal === v ? " pill-on" : "")} onClick={() => set({ ...f, enchVal: v })}>
                  {ench.name} {v}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <label className="dn-gold">
        {goldLabel}
        <span className="dn-gold-in">
          <input inputMode="numeric" value={f.gold} placeholder="예: 500000" onChange={(e) => set({ ...f, gold: e.target.value })} />
          골드
        </span>
        {gold !== null && Number.isFinite(gold) && gold > 0 && (
          <small>
            {goldText(gold)} · 💎 {diaText(gold)}
          </small>
        )}
      </label>
      {rolls.length === 0 && (
        <input className="dn-note" value={f.optText} maxLength={100} placeholder="옵션 (예: 지3 마재2)" onChange={(e) => set({ ...f, optText: e.target.value })} />
      )}
      <input className="dn-note" value={f.note} maxLength={100} placeholder="메모" onChange={(e) => set({ ...f, note: e.target.value })} />
    </div>
  );
}

/** 기부 내역: 기부함 확정과 장비대여 기부를 최근 것부터 */
function Lines({ data, wiki }: { data: DonateData; wiki: Wiki | null }) {
  if (!data.lines.length) return <p className="empty">아직 기부가 없어요</p>;
  return (
    <ul className="dn-list">
      {data.lines.map((l) => (
        <li key={l.id} className="dn-line">
          <span className="dn-day">{dayText(l.at)}</span>
          <ItemIcon wiki={wiki} name={l.label.replace(/^\+\d+ /, "").replace(/ x\d+$/, "")} size={20} />
          <span className="dn-line-name">
            <span className="dn-label">{l.label}</span>
            <small>
              <Nick name={l.who} />
              {l.from === "rent" && <em className="dn-tag">장비대여</em>}
              {l.place && l.place !== "keep" && <em className="dn-tag">{PLACE_NAME[l.place]}</em>}
            </small>
          </span>
          <span className="dn-line-gold">
            {l.gold < 0 ? "−" : ""}
            {goldText(Math.abs(l.gold))}
            <small>💎{l.dia > 0 ? "+" : ""}{mileText(l.dia)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 기부하기: 신청 폼과 내 기부 */
function Give({ data, wiki, me, done }: { data: DonateData; wiki: Wiki | null; me: Me; done: (msg: string) => void }) {
  const [f, setF] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<number | null>(null);
  const [ef, setEf] = useState<FormState>(EMPTY);
  const [sure, setSure] = useState<number | null>(null);
  async function send() {
    const v = toInput(f, wiki);
    if (typeof v === "string") return setErr(v);
    setBusy(true);
    setErr("");
    try {
      await askDonate(v);
      setF(EMPTY);
      done("기부 신청했어요 · 운영진이 확인하면 마일리지가 쌓여요");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(id: number) {
    const v = toInput(ef, wiki);
    if (typeof v === "string") return setErr(v);
    try {
      await editDonate(id, v);
      setEdit(null);
      done("고쳤어요");
    } catch (e) {
      setErr(errorText(e));
    }
  }
  const m = data.me;
  return (
    <>
      {/* 내 마일리지: 기부 골드 가치 x 0.6 이 쌓이고(소수 누적) 정수 부분만 쓴다 (제작자 2026-11-10) */}
      <div className="dn-mile">
        <span>
          <small>쌓인 마일리지</small>
          <b>{mileText(m?.earned ?? 0)}</b>
        </span>
        <span>
          <small>쓸 수 있는 💎</small>
          <b className="dn-mile-use">{m?.mileage ?? 0}</b>
        </span>
        <span>
          <small>기부 가치</small>
          <b>{goldText(m?.gold ?? 0)}</b>
        </span>
      </div>
      <section className="panel dn-form">
        <DonateFields wiki={wiki} f={f} set={setF} goldLabel="골드 가치 (내가 생각하는 값)" />
        {err && <p className="form-error">{err}</p>}
        <button className="pill pill-on dn-send" disabled={busy} onClick={() => void send()}>
          기부 신청
        </button>
      </section>
      <h3 className="dn-h">내 기부</h3>
      {!data.mine.length ? (
        <p className="empty">아직 기부가 없어요</p>
      ) : (
        <ul className="dn-list">
          {data.mine.map((r) => (
            <li key={r.id} className="dn-card">
              <div className="dn-line dn-line-flat">
                <ItemIcon wiki={wiki} name={r.item} size={20} />
                <span className="dn-line-name">
                  <span className="dn-label">{donateLabel(r)}</span>
                  {donateExtra(r) && <small className="dn-extra">{donateExtra(r)}</small>}
                  <small>
                    {dayText(r.created_at)}
                    {r.who !== me.id && <> · {r.who}</>}
                  </small>
                </span>
                <span className="dn-line-gold">
                  {r.status === "done" || r.status === "hall" ? goldText(r.gold ?? 0) : r.gold_ask !== null ? goldText(r.gold_ask) : "-"}
                  <small className={`dn-st dn-st-${r.status}`}>{STATUS_NAME[r.status]}</small>
                </span>
              </div>
              {r.status === "request" && r.created_by === me.id && (
                <div className="dn-acts">
                  {edit === r.id ? null : (
                    <>
                      <button
                        className="pill"
                        onClick={() => {
                          setEdit(r.id);
                          setEf(fromRow(r, r.gold_ask));
                        }}
                      >
                        수정
                      </button>
                      <button
                        className={"pill" + (sure === r.id ? " dn-danger" : "")}
                        onClick={async () => {
                          if (sure !== r.id) return setSure(r.id);
                          try {
                            await removeDonate(r.id);
                            done("신청을 취소했어요");
                          } catch (e) {
                            setErr(errorText(e));
                          }
                        }}
                      >
                        {sure === r.id ? "한 번 더" : "취소"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {edit === r.id && (
                <div className="dn-edit">
                  <DonateFields wiki={wiki} f={ef} set={setEf} goldLabel="골드 가치 (내가 생각하는 값)" />
                  <div className="dn-acts">
                    <button className="pill pill-on" onClick={() => void save(r.id)}>
                      저장
                    </button>
                    <button className="pill" onClick={() => setEdit(null)}>
                      닫기
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 운영 > 신청: 골드 가치를 고쳐 확정하거나 거절 */
function Pending({ rows, wiki, done }: { rows: DonateRow[]; wiki: Wiki | null; done: (msg: string) => void }) {
  const [open, setOpen] = useState<number | null>(rows[0]?.id ?? null);
  const [f, setF] = useState<FormState>(rows[0] ? fromRow(rows[0], rows[0].gold_ask) : EMPTY);
  const [err, setErr] = useState("");
  const [sure, setSure] = useState<number | null>(null);
  if (!rows.length) return <p className="empty">확인할 신청이 없어요</p>;
  return (
    <ul className="dn-list">
      {rows.map((r) => (
        <li key={r.id} className={"dn-card" + (open === r.id ? " dn-card-on" : "")}>
          <button
            className="dn-line dn-line-btn"
            onClick={() => {
              setOpen(open === r.id ? null : r.id);
              setF(fromRow(r, r.gold_ask));
              setErr("");
              setSure(null);
            }}
          >
            <ItemIcon wiki={wiki} name={r.item} size={20} />
            <span className="dn-line-name">
              <span className="dn-label">{donateLabel(r)}</span>
                  {donateExtra(r) && <small className="dn-extra">{donateExtra(r)}</small>}
              <small>
                <Nick name={r.who} /> · {dayText(r.created_at)}
              </small>
            </span>
            <span className="dn-line-gold">
              {r.gold_ask !== null ? goldText(r.gold_ask) : "-"}
              <small>적은 값</small>
            </span>
          </button>
          {open === r.id && (
            <div className="dn-edit">
              <DonateFields wiki={wiki} f={f} set={setF} goldLabel="확정 골드 가치" />
              {err && <p className="form-error">{err}</p>}
              <div className="dn-acts">
                <button
                  className="pill pill-on"
                  onClick={async () => {
                    const v = toInput(f, wiki);
                    if (typeof v === "string") return setErr(v);
                    if (v.gold === null) return setErr("골드 가치를 적어 주세요");
                    try {
                      const res = await confirmDonate(r.id, v);
                      done(`확정했어요 · ${r.who} 💎${res.dia >= 0 ? "+" : ""}${res.dia} (지금 💎${res.mileage})`);
                    } catch (e) {
                      setErr(errorText(e));
                    }
                  }}
                >
                  확정
                </button>
                <button
                  className={"pill" + (sure === r.id ? " dn-danger" : "")}
                  onClick={async () => {
                    if (sure !== r.id) return setSure(r.id);
                    try {
                      await rejectDonate(r.id);
                      done("거절했어요");
                    } catch (e) {
                      setErr(errorText(e));
                    }
                  }}
                >
                  {sure === r.id ? "한 번 더" : "거절"}
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 운영 > 직접 등록: 누가 무엇을 얼마 가치로 */
function AddByStaff({ wiki, done }: { wiki: Wiki | null; done: (msg: string) => void }) {
  const [who, setWho] = useState("");
  const [f, setF] = useState<FormState>(EMPTY);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel dn-form">
      <input className="dn-who" value={who} maxLength={20} placeholder="기부한 사람 닉네임" onChange={(e) => setWho(e.target.value)} />
      <DonateFields wiki={wiki} f={f} set={setF} goldLabel="확정 골드 가치" />
      {err && <p className="form-error">{err}</p>}
      <button
        className="pill pill-on dn-send"
        disabled={busy}
        onClick={async () => {
          const v = toInput(f, wiki);
          if (typeof v === "string") return setErr(v);
          if (!who.trim()) return setErr("기부한 사람을 적어 주세요");
          if (v.gold === null) return setErr("골드 가치를 적어 주세요");
          setBusy(true);
          setErr("");
          try {
            const res = await addDonate(who.trim(), v);
            setF(EMPTY);
            setWho("");
            done(`등록했어요 · ${who.trim()} 💎+${res.dia} (지금 💎${res.mileage})`);
          } catch (e) {
            setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        등록
      </button>
    </section>
  );
}

/** 운영 > 받은 템: 확정한 기부. 가치 고치기, 보관·나눔, 장비대여 운용(장비대여 '물건 추가' 목록으로 넘긴다), 지우기 */
function Store({ rows, wiki, done }: { rows: DonateRow[]; wiki: Wiki | null; done: (msg: string) => void }) {
  const [filter, setFilter] = useEntryState<StoreFilter>("dn.store", "keep");
  const [open, setOpen] = useState<number | null>(null);
  const [mode, setMode] = useState<"edit" | null>(null);
  const [f, setF] = useState<FormState>(EMPTY);
  const [err, setErr] = useState("");
  const [sure, setSure] = useState<number | null>(null);
  const shown = filter === "all" ? rows : rows.filter((r) => r.place === filter);
  const count = (p: StoreFilter) => (p === "all" ? rows.length : rows.filter((r) => r.place === p).length);
  return (
    <>
      <div className="dn-chips">
        {(["keep", "rent", "used", "all"] as const).map((p) => (
          <button key={p} className={"dn-chip" + (filter === p ? " dn-chip-on" : "")} onClick={() => setFilter(p)}>
            {p === "all" ? "전체" : PLACE_NAME[p]} {count(p)}
          </button>
        ))}
      </div>
      {!shown.length ? (
        <p className="empty">없어요</p>
      ) : (
        <ul className="dn-list">
          {shown.map((r) => (
            <li key={r.id} className={"dn-card" + (open === r.id ? " dn-card-on" : "")}>
              <button
                className="dn-line dn-line-btn"
                onClick={() => {
                  setOpen(open === r.id ? null : r.id);
                  setMode(null);
                  setErr("");
                  setSure(null);
                }}
              >
                <ItemIcon wiki={wiki} name={r.item} size={20} />
                <span className="dn-line-name">
                  <span className="dn-label">{donateLabel(r)}</span>
                  {donateExtra(r) && <small className="dn-extra">{donateExtra(r)}</small>}
                  <small>
                    <Nick name={r.who} /> · {dayText(r.done_at ?? r.created_at)}
                    {r.place !== "keep" && (
                      <em className="dn-tag">{r.place === "rent" ? (r.rental_id ? "장비대여 중" : "장비대여 대기") : PLACE_NAME[r.place]}</em>
                    )}
                  </small>
                </span>
                <span className="dn-line-gold">
                  {goldText(r.gold ?? 0)}
                  <small>💎{diaText(r.gold ?? 0)}</small>
                </span>
              </button>
              {open === r.id && (
                <div className="dn-edit">
                  <div className="dn-acts">
                    <button
                      className={"pill" + (mode === "edit" ? " pill-on" : "")}
                      onClick={() => {
                        setMode(mode === "edit" ? null : "edit");
                        setF(fromRow(r, r.gold));
                      }}
                    >
                      가치 수정
                    </button>
                    {!r.rental_id && (
                      <button
                        className={"pill" + (r.place === "rent" ? " pill-on" : "")}
                        onClick={async () => {
                          try {
                            await rentDonate(r.id, r.place === "rent");
                            done(r.place === "rent" ? "보관으로 돌렸어요" : "장비대여로 넘겼어요");
                          } catch (e) {
                            setErr(errorText(e));
                          }
                        }}
                      >
                        {r.place === "rent" ? "장비대여 취소" : "장비대여 운용"}
                      </button>
                    )}
                    {r.place !== "rent" && (
                      <button
                        className="pill"
                        onClick={async () => {
                          try {
                            await placeDonate(r.id, r.place === "used" ? "keep" : "used");
                            done(r.place === "used" ? "보관으로 돌렸어요" : "나눔·사용으로 옮겼어요");
                          } catch (e) {
                            setErr(errorText(e));
                          }
                        }}
                      >
                        {r.place === "used" ? "보관" : "나눔·사용"}
                      </button>
                    )}
                    <button
                      className={"pill" + (sure === r.id ? " dn-danger" : "")}
                      onClick={async () => {
                        if (sure !== r.id) return setSure(r.id);
                        try {
                          const res = await removeDonate(r.id);
                          done(`지웠어요${res.dia ? ` · ${r.who} 💎${res.dia}` : ""}`);
                        } catch (e) {
                          setErr(errorText(e));
                        }
                      }}
                    >
                      {sure === r.id ? "한 번 더" : "삭제"}
                    </button>
                  </div>
                  {mode === "edit" && (
                    <>
                      <DonateFields wiki={wiki} f={f} set={setF} goldLabel="확정 골드 가치" />
                      <button
                        className="pill pill-on dn-send"
                        onClick={async () => {
                          const v = toInput(f, wiki);
                          if (typeof v === "string") return setErr(v);
                          try {
                            const res = await editDonate(r.id, v);
                            done(`고쳤어요${res.dia ? ` · ${r.who} 💎${res.dia > 0 ? "+" : ""}${res.dia}` : ""}`);
                          } catch (e) {
                            setErr(errorText(e));
                          }
                        }}
                      >
                        저장
                      </button>
                    </>
                  )}
                  {err && <p className="form-error">{err}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function DonatePage({ wiki, me }: { wiki: Wiki | null; me: Me }) {
  const asked = new URLSearchParams(location.hash.split("?")[1] ?? "").get("t");
  const [tab, setTab] = useEntryState<Tab>("dn.tab", asked === "staff" ? "staff" : asked === "lines" ? "lines" : "give");
  const [staff, setStaff] = useEntryState<Staff>("dn.staff", "pending");
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const { data, error } = useAsync(
    useCallback(() => fetchDonate(), [reload]),
    "donate",
  );
  if (!data) return <Loading error={error} />;
  const pending = data.staff?.pending.length ?? 0;
  const tabs: { key: Tab; label: string }[] = [
    { key: "give", label: "기부하기" },
    { key: "lines", label: "기부 내역" },
    ...(data.manage ? [{ key: "staff" as Tab, label: `운영${pending ? ` ${pending}` : ""}` }] : []),
  ];
  const shown = tabs.some((t) => t.key === tab) ? tab : "give";
  const done = (msg: string) => {
    setNotice(msg);
    setReload((n) => n + 1);
  };
  return (
    <>
      <TopBar title="기부함" />
      <div className="pill-row dn-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={"pill" + (shown === t.key ? " pill-on" : "")}
            onClick={() => {
              setTab(t.key);
              setNotice("");
            }}
          >
            <FitLine text={t.label} wrap={false} />
          </button>
        ))}
      </div>
      {shown === "staff" && (
        <nav className="sub-tabs">
          {(
            [
              ["pending", `신청${pending ? ` ${pending}` : ""}`],
              ["add", "직접 등록"],
              ["store", "받은 템"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={"sub-tab" + (staff === k ? " sub-tab-on" : "")}
              onClick={() => {
                setStaff(k);
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {notice && <p className="form-note dn-notice">{notice}</p>}
      {shown === "lines" && <Lines data={data} wiki={wiki} />}
      {shown === "give" && <Give key={reload} data={data} wiki={wiki} me={me} done={done} />}
      {shown === "staff" && data.staff && staff === "pending" && <Pending key={reload} rows={data.staff.pending} wiki={wiki} done={done} />}
      {shown === "staff" && data.staff && staff === "add" && <AddByStaff wiki={wiki} done={done} />}
      {shown === "staff" && data.staff && staff === "store" && <Store key={reload} rows={data.staff.store} wiki={wiki} done={done} />}
    </>
  );
}
