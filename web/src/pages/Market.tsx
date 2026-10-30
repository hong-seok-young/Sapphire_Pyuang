import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { JOB_NAME, RANK, errorText } from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import {
  CATEGORIES, ENCHANTS, ENCHANT_CATEGORIES, ENHANCE_CATEGORIES, MARKET_PIC, OTHER_CATEGORIES, MAX_ENHANCE, MAX_NOTE, MAX_PRICE, MAX_QTY, ago, categoryOf, categoryPic, createListing,
  deleteListing, enchantText, fetchMarket, goldText, goldWords, inRoll, itemFacts, jobsFor, listingName, rollHint, unwantListing,
  updateListing, wantListing, wikiItem,
} from "../market";
import type { Category, Enchant, Listing, ListingOption } from "../market";
import type { Wiki } from "../types";
import { Loading, PicImg, TopBar } from "../ui";
import { GoldBoard } from "./GoldBoard";

type Tab = "buy" | "mine" | "sell" | "gold";
const TABS: { key: Tab; label: string }[] = [
  { key: "buy", label: "사기" },
  { key: "mine", label: "내 판매" },
  { key: "sell", label: "팔기" },
  { key: "gold", label: "골드" },
];

/** 게임 거래소의 흰 그림을 글자 색으로 칠한다 (종류 그림) */
function MaskIcon({ src, size }: { src: string; size: number }) {
  const mask = `url(${src})`;
  return <span className="mask-icon" style={{ width: size, height: size, WebkitMaskImage: mask, maskImage: mask }} aria-hidden="true" />;
}

const Coin = () => <img className="mk-coin" src={MARKET_PIC + "coin.png"} alt="골드" />;

/** 아이템 칸: 위키 그림, 오른쪽 위 +강화, 오른쪽 아래 수량 (게임 거래소처럼) */
function Slot({ wiki, l, size = 36 }: { wiki: Wiki; l: { item: string; enhance: number; qty: number }; size?: number }) {
  const it = wikiItem(wiki, l.item);
  return (
    <span className="mk-slot" style={{ width: size + 10, height: size + 10 }}>
      {it?.icon ? <PicImg pic={it.icon} fit={size} /> : <span className="mk-slot-none">?</span>}
      {l.enhance > 0 && <b className="mk-plus">+{l.enhance}</b>}
      {l.qty > 1 && <b className="mk-qty">{l.qty}</b>}
    </span>
  );
}

/** 누른 글의 정보창과 할 일 (살래요, 거래 완료, 가격 바꾸기, 내리기) */
function Detail({ wiki, me, l, onChanged }: { wiki: Wiki; me: Me; l: Listing; onChanged: (next: Listing | null) => void }) {
  const facts = itemFacts(wikiItem(wiki, l.item));
  const rolled = new Map((l.options ?? []).map((o) => [o.name, o]));
  const mine = l.seller === me.id;
  const manager = RANK[me.role] >= 1;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  const newPrice = price === null ? 0 : Number(price.replace(/\D/g, ""));

  return (
    <div className="mk-detail">
      <div className="mk-tip">
        <b className="mk-tip-name">{listingName(l)}</b>
        {facts.level && <p className="mk-tip-lv">요구 레벨 {facts.level}</p>}
        {facts.stats.map((s) => (
          <p key={s}>{s}</p>
        ))}
        {/* 옵션은 한 줄에 하나씩: 판 사람이 적은 값, 위키의 정해진 값, 속성부여(주황), 세트 효과 */}
        {facts.options.rolls.map((r) => {
          const o = rolled.get(r.name);
          return o ? (
            <p key={r.name}>
              {r.name} {o.value}
              {o.unit}
            </p>
          ) : (
            <p key={r.name} className="mk-tip-dim">
              {r.name} {rollHint(r)}
            </p>
          );
        })}
        {(l.options ?? [])
          .filter((o) => !facts.options.rolls.some((r) => r.name === o.name))
          .map((o) => (
            <p key={"own-" + o.name}>
              {o.name} {o.value}
              {o.unit}
            </p>
          ))}
        {facts.options.fixed.map((f) => (
          <p key={f}>{f}</p>
        ))}
        {l.enchant && <p className="mk-tip-ench">{enchantText(l)}</p>}
        {facts.options.sets.map((s) => (
          <p key={s} className="mk-tip-dim">
            {s}
          </p>
        ))}
        {facts.options.notes.length > 0 && <p className="mk-tip-dim">{facts.options.notes.join(" · ")}</p>}
        {facts.job && (
          <div className="mk-tip-jobs" aria-label={`직업 ${facts.job}`}>
            {jobsFor(facts.job).map((j) => (
              <img key={j} src={`${MARKET_PIC}job_${j}.png`} alt={JOB_NAME[j]} title={JOB_NAME[j]} />
            ))}
          </div>
        )}
        {!facts.level && !facts.stats.length && !l.options?.length && <p className="mk-tip-dim">{l.category}</p>}
      </div>
      {l.note && <p className="mk-note">“{l.note}”</p>}
      <p className="mk-meta">
        {l.seller} · {ago(l.createdAt)} 올림{l.qty > 1 && ` · ${l.qty}개 한꺼번에`} · <Coin /> {goldText(l.price)}
        {l.status === "sold" && " · 거래 완료"}
      </p>

      {mine ? (
        <>
          {(l.wanters?.length ?? 0) > 0 ? (
            <ul className="mk-wanters">
              {l.wanters!.map((w) => (
                <li key={w.id}>
                  ♥ <b>{w.id}</b> <small>{ago(w.at)}</small>
                  {w.note && <span> “{w.note}”</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mk-meta">아직 '살래요'를 누른 사람이 없어요.</p>
          )}
          {price !== null ? (
            <div className="mk-actions">
              <input
                className="mk-input"
                inputMode="numeric"
                value={newPrice ? goldText(newPrice) : ""}
                onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="새 가격"
                aria-label="새 가격"
              />
              <button
                className="pill"
                disabled={busy || newPrice < 1 || newPrice > MAX_PRICE}
                onClick={() =>
                  run(async () => {
                    onChanged({ ...l, ...(await updateListing(l.id, { price: newPrice })) });
                    setPrice(null);
                  })
                }
              >
                바꾸기
              </button>
              <button className="pill" onClick={() => setPrice(null)}>
                취소
              </button>
            </div>
          ) : (
            <div className="mk-actions">
              {l.status === "selling" ? (
                <button className="pill" disabled={busy} onClick={() => run(async () => onChanged({ ...l, ...(await updateListing(l.id, { status: "sold" })) }))}>
                  ✔ 거래 완료
                </button>
              ) : (
                <button className="pill" disabled={busy} onClick={() => run(async () => onChanged({ ...l, ...(await updateListing(l.id, { status: "selling" })) }))}>
                  다시 판매
                </button>
              )}
              {l.status === "selling" && (
                <button className="pill" disabled={busy} onClick={() => setPrice(String(l.price))}>
                  가격 바꾸기
                </button>
              )}
              {confirmDelete ? (
                <button className="pill pill-danger" disabled={busy} onClick={() => run(async () => { await deleteListing(l.id); onChanged(null); })}>
                  정말 내리기
                </button>
              ) : (
                <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  내리기
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        l.status === "selling" && (
          <div className="mk-actions">
            {l.wanted ? (
              <button className="pill pill-on" disabled={busy} onClick={() => run(async () => onChanged({ ...l, ...(await unwantListing(l.id)) }))}>
                ♥ 살래요 취소
              </button>
            ) : (
              <>
                <input
                  className="mk-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                  placeholder="판 사람에게 한마디 (안 적어도 돼요)"
                  aria-label="한마디"
                />
                <button
                  className="pill mk-want"
                  disabled={busy}
                  onClick={() => run(async () => onChanged({ ...l, ...(await wantListing(l.id, note.trim() || null)) }))}
                >
                  ♥ 살래요
                </button>
              </>
            )}
            {manager &&
              (confirmDelete ? (
                <button className="pill pill-danger" disabled={busy} onClick={() => run(async () => { await deleteListing(l.id); onChanged(null); })}>
                  정말 내리기
                </button>
              ) : (
                <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  내리기 (관리)
                </button>
              ))}
          </div>
        )
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function Rows({ wiki, me, list, onChanged, empty }: {
  wiki: Wiki;
  me: Me;
  list: Listing[];
  onChanged: (id: number, next: Listing | null) => void;
  empty: ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!list.length) return <div className="empty">{empty}</div>;
  return (
    <ul className="mk-list">
      {list.map((l) => (
        <li key={l.id} className={"mk-item" + (open === l.id ? " mk-open" : "") + (l.status === "sold" ? " mk-done" : "")}>
          <button className="mk-row" onClick={() => setOpen(open === l.id ? null : l.id)}>
            <Slot wiki={wiki} l={l} />
            <span className="mk-name">
              <b>{listingName(l)}</b>
              <small>
                {l.enchant && <span className="mk-ench">{enchantText(l)}</span>}
                {l.wants > 0 && <span className={"mk-wants" + (l.wanted ? " mk-wants-me" : "")}>♥ {l.wants}</span>}
                {l.status === "sold" && <span>거래 완료</span>}
                {!l.enchant && !l.wants && l.status !== "sold" && <span>{ago(l.createdAt)}</span>}
              </small>
            </span>
            <span className="mk-price">
              <small>{l.seller}</small>
              <b>
                <Coin /> {goldText(l.price)}
              </b>
            </span>
          </button>
          {open === l.id && <Detail wiki={wiki} me={me} l={l} onChanged={(next) => onChanged(l.id, next)} />}
        </li>
      ))}
    </ul>
  );
}

/** 이름 찾기: 띄어쓰기 상관없이 */
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * 팔기: 아이템 이름을 치면 위키 아이템이 그림과 함께 뜬다. 위키 장비는 부위로 종류가 저절로 정해지고(무기는 주장비),
 * 위키에 없는 아이템은 이름을 그대로 적고 종류를 직접 고른다 (나중에 위키 자료에 넣으면 그림이 붙는다).
 * 강화는 갑옷~신발, 속성부여는 벨트~반지만 적는다.
 */
function SellForm({ wiki, onDone }: { wiki: Wiki; onDone: () => void }) {
  const [item, setItem] = useState("");
  const [typing, setTyping] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [enhance, setEnhance] = useState(0);
  const [enchant, setEnchant] = useState<Enchant | null>(null);
  const [enchantValue, setEnchantValue] = useState<number | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  /** 범위에서 뜨는 옵션에 적은 값 (옵션 이름 -> 글자) */
  const [optionText, setOptionText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const name = item.trim();
  const known = name ? wikiItem(wiki, name) : undefined;
  const facts = itemFacts(known);
  const rolls = facts.options.rolls;
  const noTrade = facts.options.notes.includes("거래불가");
  // 위키 장비: 부위로 정해진 종류. 위키에 있지만 장비가 아님: 장비가 아닌 종류 중에서 (처음엔 기타).
  // 위키에 없음: 직접 고른 종류
  const wikiCat = categoryOf(known);
  const choices: readonly Category[] = known ? OTHER_CATEGORIES : CATEGORIES;
  const cat = wikiCat ?? (category && choices.includes(category) ? category : known ? "기타" : null);
  const enhanceOk = cat !== null && ENHANCE_CATEGORIES.includes(cat) && !facts.options.notes.includes("강화불가");
  const enchantOk = cat !== null && ENCHANT_CATEGORIES.includes(cat);
  const priceN = Number(price) || 0;
  const qtyN = Number(qty);
  const suggestions = useMemo(() => {
    const q = squash(name);
    if (!q) return [];
    return Object.values(wiki.items)
      .filter((it) => squash(it.name).includes(q))
      .sort((a, b) => Number(!squash(a.name).startsWith(q)) - Number(!squash(b.name).startsWith(q)) || a.name.length - b.name.length)
      .slice(0, 12);
  }, [wiki, name]);
  const optionsFilled = rolls.every((r) => (optionText[r.name] ?? "") !== "");
  const ok =
    name.length > 0 && cat !== null && priceN >= 1 && priceN <= MAX_PRICE && Number.isInteger(qtyN) && qtyN >= 1 && qtyN <= MAX_QTY &&
    (!enchantOk || !enchant || enchantValue !== null) && optionsFilled;
  const options: ListingOption[] | null = rolls.length
    ? rolls.map((r) => ({ name: r.name, value: Number(optionText[r.name]), unit: r.unit }))
    : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok || cat === null) return;
    setBusy(true);
    setError("");
    try {
      await createListing({
        item: name, category: cat, enhance: enhanceOk ? enhance : 0, enchant: enchantOk ? enchant : null,
        enchantValue: enchantOk && enchant ? enchantValue : null, qty: qtyN, price: priceN, note: note.trim() || null, options,
      });
      onDone();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mk-form" onSubmit={submit}>
      <label className="mk-field">
        <span>아이템 이름</span>
        <input
          className="mk-input"
          value={item}
          onChange={(e) => {
            setItem(e.target.value.slice(0, 30));
            setCategory(null);
            setOptionText({});
            setTyping(true);
          }}
          placeholder="예: 고대의반지"
        />
      </label>
      {typing && suggestions.length > 0 && !(known && suggestions.length === 1) && (
        <ul className="mk-suggest">
          {suggestions.map((it) => (
            <li key={it.name}>
              <button
                type="button"
                onClick={() => {
                  setItem(it.name);
                  setCategory(null);
                  setOptionText({});
                  setTyping(false);
                }}
              >
                <PicImg pic={it.icon} fit={28} />
                <span>{it.name}</span>
                <small>{it.equip[0]?.slot ?? ""}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {name && !known && !(typing && suggestions.length > 0) && (
        <p className="mk-meta">위키에 없는 아이템이에요. 적은 이름 그대로 올라가고, 종류는 직접 골라 주세요. 위키 자료에 넣으면 그림이 붙어요.</p>
      )}
      {known && (
        <div className="mk-picked">
          <Slot wiki={wiki} l={{ item: known.name, enhance: enhanceOk ? enhance : 0, qty: qtyN > 1 ? qtyN : 1 }} size={40} />
          <span>
            <b>{(enhanceOk && enhance > 0 ? `+${enhance}` : "") + known.name}</b>
            <small>
              {[facts.level && `요구 레벨 ${facts.level}`, facts.job].filter(Boolean).join(" · ") || "위키 아이템"}
            </small>
          </span>
        </div>
      )}
      {noTrade && <p className="form-error">위키에 '거래불가'로 나온 아이템이에요. 게임에서 거래가 되는지 확인해 주세요.</p>}
      {rolls.length > 0 && (
        <div className="mk-field">
          <span>옵션 (이 아이템은 옵션이 범위에서 떠요. 내 아이템에 뜬 값을 적어 주세요. 0도 돼요)</span>
          {rolls.map((r) => {
            const text = optionText[r.name] ?? "";
            const off = text !== "" && !inRoll(r, Number(text));
            return (
              <label key={r.name} className="mk-opt">
                <b>
                  {r.name}
                  {r.unit && " (%)"}
                </b>
                <input
                  className="mk-input"
                  inputMode="numeric"
                  value={text}
                  onChange={(e) => setOptionText((t) => ({ ...t, [r.name]: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                  placeholder="0"
                  aria-label={r.name}
                />
                <small className={off ? "mk-opt-off" : ""}>
                  {off ? `위키 범위(${rollHint(r)})와 달라요` : `위키 ${rollHint(r)}${r.unsure ? " (정확하지 않음)" : ""}`}
                </small>
              </label>
            );
          })}
        </div>
      )}
      {known && (facts.options.fixed.length > 0 || facts.options.sets.length > 0) && (
        <p className="mk-meta">
          정해진 옵션: {[...facts.options.fixed, ...facts.options.sets].join(" · ")}
        </p>
      )}

      <div className="mk-field">
        <span>종류</span>
        {wikiCat && known ? (
          <p className="mk-fixed-cat">
            <MaskIcon src={categoryPic(wikiCat)} size={16} /> {wikiCat}
            <small>
              ({known.equip[0]?.slot}, 위키에서 정해져요)
            </small>
          </p>
        ) : (
          <div className="mk-chips">
            {choices.map((c) => (
              <button key={c} type="button" className={"pill mk-chip" + (cat === c ? " pill-on" : "")} onClick={() => setCategory(c)}>
                <MaskIcon src={categoryPic(c)} size={16} /> {c}
              </button>
            ))}
          </div>
        )}
        {cat !== null && (
          <p className="mk-meta">
            {enhanceOk ? "강화만 되는 종류예요." : enchantOk ? "속성부여만 되는 종류예요." : "강화와 속성부여가 없는 종류예요."}
          </p>
        )}
      </div>

      {enhanceOk && (
        <div className="mk-field">
          <span>강화</span>
          <div className="level-row">
            <button type="button" className="pill level-step" onClick={() => setEnhance((v) => Math.max(0, v - 1))} aria-label="강화 내리기">
              −
            </button>
            <span className="mk-enhance">{enhance > 0 ? `+${enhance}` : "없음"}</span>
            <button type="button" className="pill level-step" onClick={() => setEnhance((v) => Math.min(MAX_ENHANCE, v + 1))} aria-label="강화 올리기">
              +
            </button>
          </div>
        </div>
      )}
      {enchantOk && (
        <div className="mk-field">
          <span>속성부여</span>
          <div className="mk-chips">
            <button type="button" className={"pill" + (enchant === null ? " pill-on" : "")} onClick={() => { setEnchant(null); setEnchantValue(null); }}>
              없음
            </button>
            {ENCHANTS.map((e) => (
              <button
                key={e.key}
                type="button"
                className={"pill" + (enchant === e.key ? " pill-on" : "")}
                onClick={() => {
                  setEnchant(e.key);
                  setEnchantValue(null);
                }}
              >
                {e.name}
              </button>
            ))}
          </div>
          {enchant && (
            <div className="mk-chips">
              {ENCHANTS.find((e) => e.key === enchant)!.values.map((v) => (
                <button key={v} type="button" className={"pill mk-ench-pill" + (enchantValue === v ? " pill-on" : "")} onClick={() => setEnchantValue(v)}>
                  {ENCHANTS.find((e) => e.key === enchant)!.name} {v}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mk-field mk-two">
        <label className="mk-field">
          <span>수량</span>
          <input className="mk-input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </label>
        <label className="mk-field">
          <span>
            가격 (골드){priceN > 0 && <b className="mk-words"> {goldWords(priceN)}</b>}
          </span>
          <input
            className="mk-input"
            inputMode="numeric"
            value={priceN ? goldText(priceN) : ""}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder="3,800,000"
          />
        </label>
      </div>
      <label className="mk-field">
        <span>한마디 (안 적어도 돼요)</span>
        <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))} placeholder="예: 저녁 9시 이후 접속해요" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy ? "올리는 중…" : "올리기"}
      </button>
    </form>
  );
}

/**
 * 사파이어 중개인: 길드원끼리 무엇을 얼마에 파는지 올리고, 사고 싶은 사람이 '살래요'를 누른다. '골드' 칸은 골드 거래 (GoldBoard).
 * 실제 거래는 게임 안에서 한다 (이 화면은 게임에 아무것도 보내지 않는다). 이 앱 디자인으로 그리고,
 * 게임 거래소 스샷에서는 동전, 종류 그림, 단추 그림만 잘라 쓴다 (자료/scripts/make_market_marks.py).
 */
export function MarketPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchMarket(), [reload]));
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [tab, setTab] = useState<Tab>("buy");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<Category | "전체">("전체");
  const [onlyWanted, setOnlyWanted] = useState(false);
  useEffect(() => {
    if (data) setListings(data);
  }, [data]);

  const all = listings ?? [];
  const selling = all.filter((l) => l.status === "selling");
  const mine = all
    .filter((l) => l.seller === me.id)
    .sort((a, b) => Number(a.status === "sold") - Number(b.status === "sold") || b.createdAt - a.createdAt);
  const wantsOnMine = mine.filter((l) => l.status === "selling").reduce((s, l) => s + l.wants, 0);
  const q = squash(query);
  const shown = selling.filter(
    (l) => (cat === "전체" || l.category === cat) && (!onlyWanted || l.wanted) && (!q || squash(listingName(l)).includes(q)),
  );
  const cats = CATEGORIES.filter((c) => selling.some((l) => l.category === c));
  const changed = (id: number, next: Listing | null) =>
    setListings((ls) => (ls ?? []).flatMap((l) => (l.id !== id ? [l] : next ? [next] : [])));

  return (
    <>
      <TopBar title="사파이어 중개인" />
      <div className="rank-banner">
        <span className="rank-banner-en">SAPPHIRE BROKER</span>
        <span className="rank-banner-ko">사파이어 중개인</span>
      </div>
      <div className="mk-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={"pill mk-tab" + (tab === t.key ? " pill-on" : "")} onClick={() => setTab(t.key)}>
            <img src={t.key === "gold" ? `${MARKET_PIC}coin.png` : `${MARKET_PIC}tab_${t.key}_${tab === t.key ? "on" : "off"}.png`} alt="" />
            {t.label}
            {t.key === "mine" && wantsOnMine > 0 && <span className="mk-badge">♥{wantsOnMine}</span>}
          </button>
        ))}
      </div>

      {tab === "gold" ? (
        <GoldBoard me={me} />
      ) : !listings ? (
        <Loading error={error} />
      ) : tab === "buy" ? (
        <>
          <div className="mk-search">
            <input className="mk-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 아이템 이름" aria-label="아이템 찾기" />
            {query && (
              <button className="pill" onClick={() => setQuery("")} aria-label="지우기">
                ✕
              </button>
            )}
            <button className="pill" onClick={() => setReload((n) => n + 1)} aria-label="새로 보기">
              ⟳
            </button>
          </div>
          <div className="mk-cats">
            {(["전체", ...cats] as const).map((c) => (
              <button key={c} className={"pill mk-chip" + (cat === c ? " pill-on" : "")} onClick={() => setCat(c)}>
                <MaskIcon src={categoryPic(c)} size={16} /> {c}{" "}
                <small>{c === "전체" ? selling.length : selling.filter((l) => l.category === c).length}</small>
              </button>
            ))}
            <button className={"pill mk-chip" + (onlyWanted ? " pill-on" : "")} onClick={() => setOnlyWanted((v) => !v)}>
              ♥ 살래요 한 것
            </button>
          </div>
          <Rows
            wiki={wiki}
            me={me}
            list={shown}
            onChanged={changed}
            empty={selling.length ? "찾는 물건이 없어요." : "아직 올라온 물건이 없어요. '팔기'에서 첫 물건을 올려 보세요!"}
          />
        </>
      ) : tab === "mine" ? (
        <Rows wiki={wiki} me={me} list={mine} onChanged={changed} empty="아직 판 물건이 없어요. '팔기'에서 올려요." />
      ) : (
        <SellForm
          wiki={wiki}
          onDone={() => {
            setReload((n) => n + 1);
            setTab("mine");
          }}
        />
      )}
      {tab !== "gold" && <p className="mk-hint">물건 거래는 게임 안에서 직접 해요.</p>}
    </>
  );
}
