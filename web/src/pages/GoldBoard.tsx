import { useCallback, useEffect, useState } from "react";
import { useEntryState } from "../router";
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
import { KakaoButton, Nick } from "../kakao";
import { useBackClose } from "../backClose";

const Coin = () => <img className="mk-coin" src={MARKET_PIC + "coin.png"} alt="" />;

/** 숫자만 남긴다 */
const digits = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);

/** 올라와 있는 글의 평균 시세 */
function averageRate(list: GoldOffer[]): number | null {
  return list.length ? Math.round((list.reduce((s, o) => s + o.rate, 0) / list.length) * 10) / 10 : null;
}

/** 골드 글 올리기: 팝니다/삽니다, 양(만 골드), 시세(1만 원에 몇 만 골드), 한마디. 원화는 저절로 계산 */
function GoldForm({ onDone }: { onDone: (side: GoldSide) => void }) {
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
      onDone(side);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mk-form" onSubmit={submit}>
      {/* 물건 올리기의 '무엇을: 팝니다 | 삽니다' 와 같은 모양 (제작자 2026-11-03 '골드 메뉴도 통일감 있게') */}
      <div className="mk-field">
        <span>무엇을</span>
        <div className="pill-row mk-side-pick">
          {(["sell", "buy"] as const).map((s) => (
            <button key={s} type="button" className={"pill" + (side === s ? " pill-on" : "")} onClick={() => setSide(s)}>
              골드 {SIDE_NAME[s]}
            </button>
          ))}
        </div>
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
        {busy ? "올리는 중…" : `골드 ${SIDE_NAME[side]} 등록`}
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
        {/* 올린 사람과 카톡은 바로 위 목록 줄에 있어서 여기서는 뺀다 (제작자 요청 2026-11-02) */}
        {ago(o.createdAt)} 올림 · 시세 {o.rate}:1{o.status === "done" && " · 거래 완료"}
      </p>
      {mine ? (
        <>
          {(o.wanters?.length ?? 0) > 0 ? (
            <ul className="mk-wanters">
              {o.wanters!.map((w) => (
                <li key={w.id}>
                  <b>
                    <Nick name={w.id} />
                  </b>{" "}
                  <KakaoButton name={w.id} /> <small>{ago(w.at)}</small>
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
                변경
              </button>
              <button className="pill" onClick={() => setRate(null)}>
                취소
              </button>
            </div>
          ) : (
            <div className="mk-actions">
              {o.status === "open" ? (
                <button className="pill" disabled={busy} onClick={() => run(async () => onChanged({ ...o, ...(await updateGold(o.id, { status: "done" })) }))}>
                  거래 완료
                </button>
              ) : (
                <button className="pill" disabled={busy} onClick={() => run(async () => onChanged({ ...o, ...(await updateGold(o.id, { status: "open" })) }))}>
                  다시 등록
                </button>
              )}
              {o.status === "open" && (
                <button className="pill" disabled={busy} onClick={() => setRate(String(o.rate))}>
                  시세 변경
                </button>
              )}
              {confirmDelete ? (
                <button className="pill pill-danger" disabled={busy} onClick={remove}>
                  삭제 확인
                </button>
              ) : (
                <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  삭제
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
                {want} 취소
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
                  {want}
                </button>
              </>
            )}
            {manager &&
              (confirmDelete ? (
                <button className="pill pill-danger" disabled={busy} onClick={remove}>
                  삭제 확인
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

/** 골드 글 줄들 (물건 줄과 같은 .mk-list 모양: 왼쪽 동전 칸, 이름 자리에 양, 오른쪽에 올린 사람과 원화. 중개인 '내 글' 칸도 쓴다) */
export function GoldRows({
  me,
  list,
  onChanged,
  empty,
}: {
  me: Me;
  list: GoldOffer[];
  onChanged: (id: number, next: GoldOffer | null) => void;
  empty: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // 폰 뒤로 가기로 펼친 정보창을 닫는다 (backClose.ts)
  useBackClose(open !== null, () => setOpen(null));
  if (!list.length) return <div className="empty">{empty}</div>;
  return (
    <ul className="mk-list">
      {list.map((o) => (
        <li key={o.id} className={"mk-item" + (open === o.id ? " mk-open" : "") + (o.status === "done" ? " mk-done" : "")}>
          <button className="mk-row" onClick={() => setOpen(open === o.id ? null : o.id)}>
            <span className="mk-slot gold-slot" style={{ width: 46, height: 46 }}>
              <img src={MARKET_PIC + "coin.png"} alt="" />
            </span>
            <span className="mk-name">
              <b>{goldAmountText(o.gold)}</b>
              <small>
                {o.side === "buy" && <span className="mk-buy-tag">삽니다</span>}
                {o.wants > 0 && <span className={"mk-wants" + (o.wanted ? " mk-wants-me" : "")}>{o.side === "sell" ? "살래요" : "팔래요"} {o.wants}</span>}
                {o.status === "done" && <span>거래 완료</span>}
                {!o.wants && o.status !== "done" && <span>{ago(o.createdAt)}</span>}
              </small>
            </span>
            <span className="mk-price">
              <small>
                <Nick name={o.owner} /> <KakaoButton name={o.owner} nested />
              </small>
              <b className="gold-won">{wonText(wonOf(o.gold, o.rate))}</b>
              <small className="mk-cash">{o.rate}:1</small>
            </span>
          </button>
          {open === o.id && <GoldDetail me={me} o={o} onChanged={(next) => onChanged(o.id, next)} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * 골드 거래: 골드 팝니다 / 삽니다 글과 '살래요'(팝니다 글), '팔래요'(삽니다 글). 시세는 1만 원에 몇 만 골드(75:1).
 * 앱은 돈을 받거나 보내지 않는다. 현금거래의 계정 정지 위험은 제작자에게 알렸고, 화면의 주의 문구는 뺐다 (제작자 2026-11-03 '조잡하다', CLAUDE.md).
 * 모양은 물건 칸과 같다 (제작자 2026-11-03 '골드 메뉴도 통일감 있게'): 위 줄에 글쓰기·새로고침, 어두운 띠 안에 팝니다 N·삽니다 N(평균 시세), 아래 줄 목록.
 * 내 골드 글은 중개인 맨 위 '내 글' 칸에 물건과 같이 보인다 (MarketPage).
 */
export function GoldBoard({ me }: { me: Me }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchGold(), [reload]), "gold");
  const [offers, setOffers] = useState<GoldOffer[] | null>(null);
  const [side, setSide] = useEntryState<GoldSide>("gside", "sell");
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (data) setOffers(data);
  }, [data]);

  const live = (offers ?? []).filter((o) => o.status === "open");
  const ofSide = (s: GoldSide) => live.filter((o) => o.side === s);
  const changed = (id: number, next: GoldOffer | null) => setOffers((os) => (os ?? []).flatMap((o) => (o.id !== id ? [o] : next ? [next] : [])));

  return (
    <>
      <div className="mk-search">
        <button className={"pill mk-grow" + (writing ? " pill-on" : "")} onClick={() => setWriting((w) => !w)} aria-expanded={writing}>
          골드 글쓰기
        </button>
        <button className="pill" onClick={() => setReload((n) => n + 1)}>
          새로고침
        </button>
      </div>
      {writing && (
        <GoldForm
          onDone={(s) => {
            setWriting(false);
            setSide(s);
            setReload((n) => n + 1);
          }}
        />
      )}
      <div className="mk-sub">
        <div className="mk-side" role="tablist">
          {(["sell", "buy"] as const).map((s) => {
            const avg = averageRate(ofSide(s));
            return (
              <button key={s} role="tab" aria-selected={side === s} className={"sub-tab" + (side === s ? " sub-tab-on" : "")} onClick={() => setSide(s)}>
                {SIDE_NAME[s]} <small>{ofSide(s).length}{avg !== null ? ` · ${avg}:1` : ""}</small>
              </button>
            );
          })}
        </div>
      </div>
      {!offers ? (
        <Loading error={error} />
      ) : (
        <GoldRows me={me} list={ofSide(side)} onChanged={changed} empty={side === "sell" ? "아직 골드 팝니다 글이 없어요." : "아직 골드 삽니다 글이 없어요."} />
      )}
    </>
  );
}
