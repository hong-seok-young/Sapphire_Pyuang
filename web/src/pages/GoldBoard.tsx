import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { RANK, errorText } from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import {
  MAX_GOLD, MAX_RATE, SIDE_NAME, USUAL_RATE, createGold, deleteGold, fetchGold, goldAmountText, unwantGold, updateGold,
  wantGold, wonOf, wonText,
} from "../gold";
import type { GoldOffer, GoldSide } from "../gold";
import { MARKET_PIC, MAX_NOTE, ago } from "../market";
import { Loading } from "../ui";

type Filter = "all" | GoldSide | "mine";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "sell", label: "팝니다" },
  { key: "buy", label: "삽니다" },
  { key: "mine", label: "내 글" },
];

const Coin = () => <img className="mk-coin" src={MARKET_PIC + "coin.png"} alt="" />;

/** 숫자만 남긴다 */
const digits = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);

/** 올라와 있는 글의 평균 시세 */
function averageRate(list: GoldOffer[]): number | null {
  return list.length ? Math.round((list.reduce((s, o) => s + o.rate, 0) / list.length) * 10) / 10 : null;
}

/** 골드 글 올리기: 팝니다/삽니다, 양(만 골드), 시세(1만 원에 몇 만 골드), 한마디. 원화는 저절로 계산 */
function GoldForm({ onDone }: { onDone: () => void }) {
  const [side, setSide] = useState<GoldSide>("sell");
  const [gold, setGold] = useState("");
  const [rate, setRate] = useState(String(USUAL_RATE));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const goldN = Number(gold) || 0;
  const rateN = Number(rate) || 0;
  const ok = goldN >= 1 && goldN <= MAX_GOLD && rateN >= 1 && rateN <= MAX_RATE;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await createGold({ side, gold: goldN, rate: rateN, note: note.trim() || null });
      onDone();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mk-form" onSubmit={submit}>
      <div className="mk-chips">
        {(["sell", "buy"] as const).map((s) => (
          <button key={s} type="button" className={"pill" + (side === s ? " pill-on" : "")} onClick={() => setSide(s)}>
            골드 {SIDE_NAME[s]}
          </button>
        ))}
      </div>
      <label className="mk-field">
        <span>골드 (만 골드 단위: 750 = 750만 골드)</span>
        <input className="mk-input" inputMode="numeric" value={gold} onChange={(e) => setGold(digits(e.target.value, 7))} placeholder="750" />
      </label>
      <div className="mk-field">
        <span>시세 (1만 원에 몇 만 골드: 75 = 75:1)</span>
        <div className="level-row">
          <button type="button" className="pill level-step" onClick={() => setRate(String(Math.max(1, rateN - 1)))} aria-label="시세 내리기">
            −
          </button>
          <input className="level-input gold-rate" inputMode="numeric" value={rate} onChange={(e) => setRate(digits(e.target.value, 4))} aria-label="시세" />
          <span className="gold-rate-unit">: 1</span>
          <button type="button" className="pill level-step" onClick={() => setRate(String(Math.min(MAX_RATE, rateN + 1)))} aria-label="시세 올리기">
            +
          </button>
        </div>
      </div>
      {ok && (
        <p className="gold-sum">
          <Coin /> {goldAmountText(goldN)} = <b>{wonText(wonOf(goldN, rateN))}</b>
        </p>
      )}
      <label className="mk-field">
        <span>한마디 (안 적어도 돼요)</span>
        <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))} placeholder="예: 나눠서도 거래해요" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy ? "올리는 중…" : `골드 ${SIDE_NAME[side]} 올리기`}
      </button>
    </form>
  );
}

/** 누른 골드 글: 한마디, 거래할래요 / (내 글) 누른 사람, 거래 완료, 시세 바꾸기, 내리기 */
function GoldDetail({ me, o, onChanged }: { me: Me; o: GoldOffer; onChanged: (next: GoldOffer | null) => void }) {
  const mine = o.owner === me.id;
  const manager = RANK[me.role] >= 1;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [rate, setRate] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const want = o.side === "sell" ? "살래요" : "팔래요";

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
  const remove = () =>
    run(async () => {
      await deleteGold(o.id);
      onChanged(null);
    });
  const newRate = rate === null ? 0 : Number(rate) || 0;

  return (
    <div className="mk-detail">
      {o.note && <p className="mk-note">“{o.note}”</p>}
      <p className="mk-meta">
        {o.owner} · {ago(o.createdAt)} 올림 · 시세 {o.rate}:1{o.status === "done" && " · 거래 완료"}
      </p>
      {mine ? (
        <>
          {(o.wanters?.length ?? 0) > 0 ? (
            <ul className="mk-wanters">
              {o.wanters!.map((w) => (
                <li key={w.id}>
                  ♥ <b>{w.id}</b> <small>{ago(w.at)}</small>
                  {w.note && <span> “{w.note}”</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mk-meta">아직 '{want}'를 누른 사람이 없어요.</p>
          )}
          {rate !== null ? (
            <div className="mk-actions">
              <input className="mk-input" inputMode="numeric" value={rate} onChange={(e) => setRate(digits(e.target.value, 4))} aria-label="새 시세" />
              <span className="gold-rate-unit">: 1</span>
              <button
                className="pill"
                disabled={busy || newRate < 1 || newRate > MAX_RATE}
                onClick={() =>
                  run(async () => {
                    onChanged({ ...o, ...(await updateGold(o.id, { rate: newRate })) });
                    setRate(null);
                  })
                }
              >
                바꾸기
              </button>
              <button className="pill" onClick={() => setRate(null)}>
                취소
              </button>
            </div>
          ) : (
            <div className="mk-actions">
              {o.status === "open" ? (
                <button className="pill" disabled={busy} onClick={() => run(async () => onChanged({ ...o, ...(await updateGold(o.id, { status: "done" })) }))}>
                  ✔ 거래 완료
                </button>
              ) : (
                <button className="pill" disabled={busy} onClick={() => run(async () => onChanged({ ...o, ...(await updateGold(o.id, { status: "open" })) }))}>
                  다시 올리기
                </button>
              )}
              {o.status === "open" && (
                <button className="pill" disabled={busy} onClick={() => setRate(String(o.rate))}>
                  시세 바꾸기
                </button>
              )}
              {confirmDelete ? (
                <button className="pill pill-danger" disabled={busy} onClick={remove}>
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
        o.status === "open" && (
          <div className="mk-actions">
            {o.wanted ? (
              <button className="pill pill-on" disabled={busy} onClick={() => run(async () => onChanged({ ...o, ...(await unwantGold(o.id)) }))}>
                ♥ {want} 취소
              </button>
            ) : (
              <>
                <input
                  className="mk-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                  placeholder="올린 사람에게 한마디 (안 적어도 돼요)"
                  aria-label="한마디"
                />
                <button className="pill mk-want" disabled={busy} onClick={() => run(async () => onChanged({ ...o, ...(await wantGold(o.id, note.trim() || null)) }))}>
                  ♥ {want}
                </button>
              </>
            )}
            {manager &&
              (confirmDelete ? (
                <button className="pill pill-danger" disabled={busy} onClick={remove}>
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

/**
 * 골드 거래: 골드 팝니다 / 삽니다 글과 '살래요'(팝니다 글), '팔래요'(삽니다 글). 시세는 1만 원에 몇 만 골드(75:1).
 * 앱은 돈을 받거나 보내지 않는다. 현금거래는 계정 정지 위험이 있어 화면 맨 위에 알린다 (제작자 결정, CLAUDE.md).
 */
export function GoldBoard({ me }: { me: Me }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchGold(), [reload]));
  const [offers, setOffers] = useState<GoldOffer[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [writing, setWriting] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (data) setOffers(data);
  }, [data]);

  const all = offers ?? [];
  const live = all.filter((o) => o.status === "open");
  const sells = live.filter((o) => o.side === "sell");
  const buys = live.filter((o) => o.side === "buy");
  const shown =
    filter === "mine"
      ? all.filter((o) => o.owner === me.id).sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.createdAt - a.createdAt)
      : live.filter((o) => filter === "all" || o.side === filter);
  const changed = (id: number, next: GoldOffer | null) => setOffers((os) => (os ?? []).flatMap((o) => (o.id !== id ? [o] : next ? [next] : [])));
  const avgSell = averageRate(sells);
  const avgBuy = averageRate(buys);

  return (
    <>
      <p className="gold-warn">
        ⚠ 골드 현금거래는 게임 운영정책에 걸리면 계정이 정지될 수 있어요. 앱은 돈을 받거나 보내지 않고, 거래는 각자 책임이에요.
        먼저 보내는 쪽이 사기를 당하지 않게 조심해 주세요.
      </p>
      <div className="gold-market">
        <span>
          팝니다 <b>{sells.length}</b>
          {avgSell !== null && ` · 평균 ${avgSell}:1`}
        </span>
        <span>
          삽니다 <b>{buys.length}</b>
          {avgBuy !== null && ` · 평균 ${avgBuy}:1`}
        </span>
      </div>
      <div className="mk-cats">
        {FILTERS.map((f) => (
          <button key={f.key} className={"pill mk-chip" + (filter === f.key ? " pill-on" : "")} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
        <button className={"pill mk-chip" + (writing ? " pill-on" : "")} onClick={() => setWriting((w) => !w)}>
          ＋ 글 올리기
        </button>
        <button className="pill mk-chip" onClick={() => setReload((n) => n + 1)} aria-label="새로 보기">
          ⟳
        </button>
      </div>
      {writing && (
        <GoldForm
          onDone={() => {
            setWriting(false);
            setFilter("mine");
            setReload((n) => n + 1);
          }}
        />
      )}
      {!offers ? (
        <Loading error={error} />
      ) : shown.length === 0 ? (
        <div className="empty">{filter === "mine" ? "아직 올린 골드 글이 없어요." : "아직 올라온 골드 글이 없어요."}</div>
      ) : (
        <ul className="mk-list">
          {shown.map((o) => (
            <li key={o.id} className={"mk-item" + (open === o.id ? " mk-open" : "") + (o.status === "done" ? " mk-done" : "")}>
              <button className="mk-row" onClick={() => setOpen(open === o.id ? null : o.id)}>
                <span className={"gold-side gold-side-" + o.side}>{SIDE_NAME[o.side]}</span>
                <span className="mk-name">
                  <b>
                    <Coin /> {goldAmountText(o.gold)}
                  </b>
                  <small>
                    <span>{o.rate}:1</span>
                    {o.wants > 0 && <span className={"mk-wants" + (o.wanted ? " mk-wants-me" : "")}>♥ {o.wants}</span>}
                    {o.status === "done" && <span>거래 완료</span>}
                  </small>
                </span>
                <span className="mk-price">
                  <small>{o.owner}</small>
                  <b className="gold-won">{wonText(wonOf(o.gold, o.rate))}</b>
                </span>
              </button>
              {open === o.id && <GoldDetail me={me} o={o} onChanged={(next) => changed(o.id, next)} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
