import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEntryState } from "../router";
import type { FormEvent, ReactNode } from "react";
import {
  ApiError,
  JOB_NAME,
  RANK,
  ROLE_NAME,
  errorText,
  positionOf,
} from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import {
  AUCTION_HOURS,
  CATEGORIES,
  ENCHANTS,
  ENCHANT_CATEGORIES,
  ENHANCE_CATEGORIES,
  MARKET_PIC,
  OTHER_CATEGORIES,
  auctionOver,
  bidListing,
  cashText,
  currentPrice,
  deleteTalk,
  fetchTalk,
  nextBid,
  postTalk,
  MAX_ENHANCE,
  MAX_NOTE,
  MAX_PRICE,
  MAX_QTY,
  ago,
  categoryOf,
  createListing,
  deleteListing,
  enchantText,
  fetchMarket,
  goldText,
  goldWords,
  inRoll,
  itemFacts,
  jobsFor,
  listingName,
  rollHint,
  unwantListing,
  updateListing,
  wantListing,
  wikiItem,
  WANTS_FOR_AUCTION,
  toAuction,
  shotUrl,
  MAX_WHEN,
  SIDE_NAME,
  wantVerb,
} from "../market";
import { readShot, shrinkShot } from "../shot";
import { isSample, sampleListing } from "../sample";
import { useSample } from "../tutorialState";
import { KakaoButton, Nick } from "../kakao";
import type { Shot } from "../shot";
import type {
  Category,
  Enchant,
  Listing,
  ListingMode,
  ListingOption,
  Side,
  TalkLine,
} from "../market";
import type { Wiki } from "../types";
import { Loading, NewsDot, PicImg, TopBar } from "../ui";
import { useNews, useNewsSeen } from "../news";
import { timeLeft } from "../requests";
import { GoldBoard, GoldRows } from "./GoldBoard";
import { fetchGold } from "../gold";
import type { GoldOffer } from "../gold";
import { useBackClose } from "../backClose";

/** 맨 위 같은 폭 단추 넷 (제작자 2026-11-03 '이모지 다 빼', '버튼 상하위 개념': 그림 없이 글자만, 그 아래 팝니다·삽니다와 종류는 어두운 띠 안에) */
type Tab = "list" | "mine" | "post" | "gold";
const TABS: { key: Tab; label: string }[] = [
  { key: "list", label: "목록" },
  { key: "mine", label: "내 글" },
  { key: "post", label: "올리기" },
  { key: "gold", label: "골드" },
];

const Coin = () => (
  <img className="mk-coin" src={MARKET_PIC + "coin.png"} alt="골드" />
);

/** 아이템 칸: 위키 그림, 오른쪽 위 +강화, 오른쪽 아래 수량 (게임 거래소처럼) */
function Slot({
  wiki,
  l,
  size = 36,
}: {
  wiki: Wiki;
  l: {
    id?: number;
    item: string;
    enhance: number;
    qty: number;
    shot?: boolean;
  };
  size?: number;
}) {
  const it = wikiItem(wiki, l.item);
  return (
    <span className="mk-slot" style={{ width: size + 10, height: size + 10 }}>
      {it?.icon ? (
        <PicImg pic={it.icon} fit={size} />
      ) : l.shot && l.id ? (
        // 위키에 없는 물건: 판 사람이 붙인 스샷 (제작자 요청 2026-11-02)
        <img
          className="mk-slot-shot"
          src={shotUrl(l.id)}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="mk-slot-none">?</span>
      )}
      {l.enhance > 0 && <b className="mk-plus">+{l.enhance}</b>}
      {l.qty > 1 && <b className="mk-qty">{l.qty}</b>}
    </span>
  );
}

/** 누른 글의 정보창과 할 일: 살래요(흥정 가격), 경매 입찰, (내 글) 살래요 명단, 입찰 명단, 거래 완료, 가격 바꾸기, 내리기 */
function Detail({
  wiki,
  me,
  l,
  rate,
  onChanged,
}: {
  wiki: Wiki;
  me: Me;
  l: Listing;
  rate: number;
  onChanged: (next: Listing | null) => void;
}) {
  const facts = itemFacts(wikiItem(wiki, l.item));
  const rolled = new Map((l.options ?? []).map((o) => [o.name, o]));
  const mine = l.seller === me.id;
  const manager = RANK[me.role] >= 1;
  const auction = l.mode === "auction";
  const over = auctionOver(l);
  // 삽니다 글 (제작자 2026-11-03): 가격은 희망가, 남은 '팔래요' (살래요와 같은 방식, 흥정 가격·한마디는 올린 사람만)
  const buy = l.side === "buy";
  const verb = wantVerb(l);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [offer, setOffer] = useState("");
  const [bid, setBid] = useState(String(nextBid(l)));
  const [price, setPrice] = useState<string | null>(null);
  const [convHours, setConvHours] = useState(24);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  useBackClose(talkOpen, () => setTalkOpen(false));
  const [talkCount, setTalkCount] = useState(l.talkCount);
  // 종목 토론방 단추: 할 일 단추와 같은 줄 오른쪽 끝에 작은 말풍선으로 (제작자 요청: 줄을 따로 만들지 않게)
  const talkButton = (
    <button
      className={"mk-talk-btn" + (talkOpen ? " mk-talk-on" : "")}
      onClick={() => setTalkOpen((v) => !v)}
      aria-expanded={talkOpen}
    >
      토론방
      {talkCount > 0 && <b>{talkCount}</b>}
    </button>
  );

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
  /** 할 일 단추 줄이 보이는지 (토론방 단추를 그 줄 끝에 둔다) */
  const actionRow = mine ? price === null : l.status === "selling";
  const offerN = Number(offer) || 0;
  const bidN = Number(bid) || 0;
  const remove = () =>
    run(async () => {
      await deleteListing(l.id);
      onChanged(null);
    });

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
        {facts.options.notes.length > 0 && (
          <p className="mk-tip-dim">{facts.options.notes.join(" · ")}</p>
        )}
        {facts.job && (
          <div className="mk-tip-jobs" aria-label={`직업 ${facts.job}`}>
            {jobsFor(facts.job).map((j) => (
              <img
                key={j}
                src={`${MARKET_PIC}job_${j}.png`}
                alt={JOB_NAME[j]}
                title={JOB_NAME[j]}
              />
            ))}
          </div>
        )}
        {/* 위키에 없는 물건: 판 사람이 붙인 스샷을 게임 정보창처럼 (옵션은 데이터로 만들지 않는다, 제작자 요청 2026-11-02) */}
        {l.shot && !wikiItem(wiki, l.item) && (
          <img
            className="mk-shot"
            src={shotUrl(l.id)}
            alt={`${l.item} 정보창`}
          />
        )}
        {!facts.level &&
          !facts.stats.length &&
          !l.options?.length &&
          !l.shot && <p className="mk-tip-dim">{l.category}</p>}
      </div>
      {l.note && <p className="mk-note">“{l.note}”</p>}
      <p className="mk-meta">
        {/* 판 사람과 카톡은 바로 위 목록 줄에 있어서 여기서는 뺀다 (제작자 요청 2026-11-02) */}
        {ago(l.createdAt)} 올림{l.qty > 1 && (buy ? ` · ${l.qty}개 구해요` : ` · ${l.qty}개 한꺼번에`)}
        {l.status === "sold" && " · 거래 완료"}
      </p>
      {auction ? (
        <p className="mk-deal">
          {l.highestBid !== null ? "지금 최고가" : "시작가"} <Coin />{" "}
          {goldText(currentPrice(l))}{" "}
          <small>{cashText(currentPrice(l), rate)}</small>
          <br />
          <small>
            입찰 {l.bidCount}번 ·{" "}
            {over
              ? "경매가 끝났어요"
              : l.endsAt
                ? `${timeLeft(l.endsAt)} 남음`
                : ""}
            {l.highestBid !== null && ` · 시작가 ${goldText(l.price)}`}
          </small>
        </p>
      ) : (
        <p className="mk-deal">
          {buy && <span className="mk-buy-tag">희망가 </span>}
          <Coin /> {goldText(l.price)}{" "}
          <small>
            {cashText(l.price, rate)} (골드 시세 {rate}:1)
          </small>
          {l.mode === "reserve" && (
            <>
              <br />
              <small className="mk-reserve-tag">예약 판매 · {l.saleWhen}</small>
            </>
          )}
        </p>
      )}

      {mine ? (
        <>
          {auction ? (
            (l.bids?.length ?? 0) > 0 ? (
              <ul className="mk-wanters">
                {l.bids!.map((b, i) => (
                  <li key={b.id + b.at}>
                    {i === 0 ? (over ? "낙찰 " : "최고 ") : "· "}
                    <b>
                      <Nick name={b.id} />
                    </b>{" "}
                    <KakaoButton name={b.id} /> <Coin /> {goldText(b.amount)}{" "}
                    <small>{ago(b.at)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mk-meta">아직 입찰한 사람이 없어요.</p>
            )
          ) : (l.wanters?.length ?? 0) > 0 ? (
            <ul className="mk-wanters">
              {l.wanters!.map((w) => (
                <li key={w.id}>
                  <b>
                    <Nick name={w.id} />
                  </b>{" "}
                  <KakaoButton name={w.id} /> <small>{ago(w.at)}</small>
                  {w.offer ? (
                    <span className="mk-offer">
                      {" "}
                      흥정 <Coin /> {goldText(w.offer)}{" "}
                      <small>{cashText(w.offer, rate)}</small>
                    </span>
                  ) : null}
                  {w.note && <span> “{w.note}”</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mk-meta">아직 '{verb}'를 누른 사람이 없어요.</p>
          )}
          {/* '살래요'가 여러 명이면 경매로 (제작자 요청): 올릴 때 정해 두지 않았으면 여기서 묻는다 (팝니다 글만) */}
          {!buy &&
            l.mode === "sale" &&
            l.status === "selling" &&
            l.wants >= WANTS_FOR_AUCTION && (
              <div className="mk-convert">
                <b>살래요 {l.wants}명 · 경매로 바꿀까요?</b>
                <div className="mk-chips">
                  {AUCTION_HOURS.map((h) => (
                    <button
                      key={h.hours}
                      type="button"
                      className={
                        "pill" + (convHours === h.hours ? " pill-on" : "")
                      }
                      onClick={() => setConvHours(h.hours)}
                    >
                      {h.label}
                    </button>
                  ))}
                  <button
                    className="pill pill-gold"
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        onChanged({
                          ...l,
                          ...(await toAuction(l.id, convHours)),
                        }),
                      )
                    }
                  >
                    경매 전환
                  </button>
                </div>
                <small className="mk-meta">
                  지금 가격이 시작가가 되고, 살래요 누른 사람들에게 입찰 알림이
                  가요.
                </small>
              </div>
            )}
          {!buy &&
            l.mode === "sale" &&
            l.status === "selling" &&
            l.autoAuction &&
            l.wants < WANTS_FOR_AUCTION && (
              <p className="mk-meta">
                살래요 {WANTS_FOR_AUCTION}명이 되면{" "}
                {AUCTION_HOURS.find((h) => h.hours === l.autoAuction)?.label ??
                  `${l.autoAuction}시간`}{" "}
                경매로 바뀌어요
              </p>
            )}
          {price !== null ? (
            <div className="mk-actions">
              <input
                className="mk-input"
                inputMode="numeric"
                value={newPrice ? goldText(newPrice) : ""}
                onChange={(e) =>
                  setPrice(e.target.value.replace(/\D/g, "").slice(0, 11))
                }
                placeholder="새 가격"
                aria-label="새 가격"
              />
              <button
                className="pill"
                disabled={busy || newPrice < 1 || newPrice > MAX_PRICE}
                onClick={() =>
                  run(async () => {
                    onChanged({
                      ...l,
                      ...(await updateListing(l.id, { price: newPrice })),
                    });
                    setPrice(null);
                  })
                }
              >
                변경
              </button>
              <button className="pill" onClick={() => setPrice(null)}>
                취소
              </button>
            </div>
          ) : (
            <div className="mk-actions">
              {l.status === "selling" ? (
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      onChanged({
                        ...l,
                        ...(await updateListing(l.id, { status: "sold" })),
                      }),
                    )
                  }
                >
                  거래 완료
                </button>
              ) : (
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      onChanged({
                        ...l,
                        ...(await updateListing(l.id, { status: "selling" })),
                      }),
                    )
                  }
                >
                  다시 판매
                </button>
              )}
              {l.status === "selling" && !auction && (
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() => setPrice(String(l.price))}
                >
                  가격 변경
                </button>
              )}
              {confirmDelete ? (
                <button
                  className="pill pill-danger"
                  disabled={busy}
                  onClick={remove}
                >
                  삭제 확인
                </button>
              ) : (
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  삭제
                </button>
              )}
              {talkButton}
            </div>
          )}
        </>
      ) : (
        l.status === "selling" && (
          <div className="mk-actions">
            {auction ? (
              over ? (
                <p className="mk-meta">
                  경매가 끝났어요.
                  {l.myBid !== null &&
                    l.myBid === l.highestBid &&
                    " 내가 낙찰받았어요! 판 사람과 게임에서 거래해요."}
                </p>
              ) : (
                <>
                  {l.myBid !== null && (
                    <p className="mk-meta mk-full">
                      내 입찰 <Coin /> {goldText(l.myBid)}{" "}
                      {l.myBid === l.highestBid
                        ? "· 지금 내가 최고가예요"
                        : "· 다른 사람이 더 높게 불렀어요"}
                    </p>
                  )}
                  <input
                    className="mk-input"
                    inputMode="numeric"
                    value={bidN ? goldText(bidN) : ""}
                    onChange={(e) =>
                      setBid(e.target.value.replace(/\D/g, "").slice(0, 11))
                    }
                    aria-label="입찰가"
                  />
                  <button
                    className="pill mk-want"
                    disabled={busy || bidN <= (l.highestBid ?? l.price - 1)}
                    onClick={() =>
                      run(async () => {
                        try {
                          const r = await bidListing(l.id, bidN);
                          const next = { ...l, ...r };
                          onChanged(next);
                          setBid(String(nextBid(next)));
                        } catch (x) {
                          // 그사이 누가 더 높게 불렀으면 지금 최고가로 바꾸고 다음 입찰가를 다시 권한다
                          const top =
                            x instanceof ApiError
                              ? x.data?.highestBid
                              : undefined;
                          if (typeof top === "number") {
                            const next = { ...l, highestBid: top };
                            onChanged(next);
                            setBid(String(nextBid(next)));
                          }
                          throw x;
                        }
                      })
                    }
                  >
                    입찰
                  </button>
                  <small className="mk-meta mk-full">
                    {bidN > 0 && `${cashText(bidN, rate)} · `}지금 최고가보다
                    높게 불러야 해요. 누가 불렀는지는 판 사람만 봐요.
                  </small>
                </>
              )
            ) : l.wanted ? (
              <>
                {l.myOffer !== null && (
                  <p className="mk-meta mk-full">
                    내가 부른 흥정 가격 <Coin /> {goldText(l.myOffer)}{" "}
                    <small>{cashText(l.myOffer, rate)}</small>
                  </p>
                )}
                <button
                  className="pill pill-on"
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      onChanged({
                        ...l,
                        ...(await unwantListing(l.id)),
                        myOffer: null,
                      }),
                    )
                  }
                >
                  {verb} 취소
                </button>
              </>
            ) : (
              <>
                <input
                  className="mk-input mk-full"
                  inputMode="numeric"
                  value={offerN ? goldText(offerN) : ""}
                  onChange={(e) =>
                    setOffer(e.target.value.replace(/\D/g, "").slice(0, 11))
                  }
                  placeholder="흥정 가격 (안 적어도 돼요)"
                  aria-label="흥정 가격"
                />
                <input
                  className="mk-input mk-full"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                  placeholder={(buy ? "구하는 사람" : "판 사람") + "에게 한마디 (안 적어도 돼요)"}
                  aria-label="한마디"
                />
                <button
                  className="pill mk-want"
                  disabled={busy || offerN > MAX_PRICE}
                  onClick={() =>
                    run(async () =>
                      onChanged({
                        ...l,
                        ...(await wantListing(
                          l.id,
                          note.trim() || null,
                          offerN || null,
                        )),
                      }),
                    )
                  }
                >
                  {verb}
                </button>
                <small className="mk-meta mk-full">
                  {offerN > 0 && `${cashText(offerN, rate)} · `}흥정 가격과
                  한마디는 올린 사람만 봐요.
                </small>
              </>
            )}
            {manager &&
              (confirmDelete ? (
                <button
                  className="pill pill-danger"
                  disabled={busy}
                  onClick={remove}
                >
                  삭제 확인
                </button>
              ) : (
                <button
                  className="pill"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  삭제(관리)
                </button>
              ))}
            {talkButton}
          </div>
        )
      )}
      {error && <p className="form-error">{error}</p>}
      {/* 할 일 줄이 없을 때(가격 변경 중, 거래 끝난 글)만 토론방 단추를 따로 둔다 */}
      {!actionRow && <div className="mk-talk-bar">{talkButton}</div>}
      {talkOpen && <Talk l={l} me={me} onCount={setTalkCount} />}
    </div>
  );
}

/** '12:41', 오늘이 아니면 '10/29 12:41' */
function talkTime(t: number): string {
  const d = new Date(t);
  const hm = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/**
 * 종목 토론방 (제작자 요청): 이 물건에 대해 댓글처럼 쓰는 방. 글마다 '답글'(한 단계)을 달면 원래 글쓴이에게 알림이 간다. 판 사람 글에는 '판매자', 길드마스터와 오피서는 표시를 붙이고
 * 쓴 시각을 보인다. 열려 있는 동안 20초마다 새 글을 본다. 자기 글은 지우고, 오피서 이상은 남의 글도 지운다
 */
function Talk({
  l,
  me,
  onCount,
}: {
  l: Listing;
  me: Me;
  onCount: (n: number) => void;
}) {
  const [talk, setTalk] = useState<TalkLine[] | null>(null);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      fetchTalk(l.id).then(
        (t) => {
          setTalk(t);
          onCount(t.length);
        },
        (x) => setError(errorText(x)),
      ),
    [l.id, onCount],
  );
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await postTalk(l.id, text.trim(), replyTo);
      setText("");
      setReplyTo(null);
      await load();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const tops = (talk ?? []).filter((t) => t.parent === null);
  const repliesOf = (id: number) => (talk ?? []).filter((t) => t.parent === id);
  const replyName = talk?.find((t) => t.id === replyTo)?.user;

  function line(t: TalkLine, reply: boolean) {
    const position = t.role ? positionOf(t.role) : "member";
    return (
      <li
        key={t.id}
        className={
          (reply ? "mk-talk-reply" : "") +
          (t.user === l.seller ? " mk-talk-seller" : "")
        }
      >
        <b>
          <Nick name={t.user} />
        </b>
        <KakaoButton name={t.user} />
        {t.user === l.seller && <span className="mk-talk-tag">판매자</span>}
        {position !== "member" && (
          <span className="mk-talk-tag mk-talk-staff">
            {ROLE_NAME[position]}
          </span>
        )}
        <span className="mk-talk-text">{t.text}</span>
        <time>{talkTime(t.at)}</time>
        {!reply && (
          <button className="mk-talk-act" onClick={() => setReplyTo(t.id)}>
            답글
          </button>
        )}
        {(t.user === me.id || RANK[me.role] >= 1) && (
          <button
            className="mk-talk-act"
            aria-label="삭제"
            onClick={async () => {
              try {
                await deleteTalk(l.id, t.id);
                await load();
              } catch (x) {
                setError(errorText(x));
              }
            }}
          >
            삭제
          </button>
        )}
      </li>
    );
  }

  return (
    <div className="mk-talk">
      {talk === null ? (
        <p className="mk-meta">불러오는 중…</p>
      ) : talk.length === 0 ? (
        <p className="mk-meta">아직 글이 없어요.</p>
      ) : (
        <ul className="mk-talk-list">
          {tops.flatMap((t) => [
            line(t, false),
            ...repliesOf(t.id).map((r) => line(r, true)),
          ])}
        </ul>
      )}
      {replyTo !== null && (
        <p className="mk-talk-replying">
          {replyName}에게 답글
          <button
            className="mk-talk-act"
            onClick={() => setReplyTo(null)}
            aria-label="답글 취소"
          >
            취소
          </button>
        </p>
      )}
      <form className="mk-talk-form" onSubmit={send}>
        <input
          className="mk-input"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          placeholder={replyTo !== null ? "답글 쓰기" : "글 쓰기"}
          aria-label="토론방 글"
        />
        <button className="pill" disabled={busy || !text.trim()}>
          등록
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function Rows({
  wiki,
  me,
  list,
  rate,
  onChanged,
  empty,
}: {
  wiki: Wiki;
  me: Me;
  list: Listing[];
  rate: number;
  onChanged: (id: number, next: Listing | null) => void;
  empty: ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // 폰 뒤로 가기로 펼친 정보창을 닫는다 (backClose.ts)
  useBackClose(open !== null, () => setOpen(null));
  // 가격(경매는 최고가)이 바뀐 줄만 숫자를 한 번 반짝인다
  const seen = useRef(new Map<number, number>());
  useEffect(() => {
    for (const l of list)
      seen.current.set(l.id, l.mode === "auction" ? currentPrice(l) : l.price);
  });
  if (!list.length) return <div className="empty">{empty}</div>;
  return (
    <ul className="mk-list">
      {list.map((l) => {
        const auction = l.mode === "auction";
        const shownPrice = auction ? currentPrice(l) : l.price;
        const before = seen.current.get(l.id);
        const changed = before !== undefined && before !== shownPrice;
        const ending =
          auction &&
          !auctionOver(l) &&
          l.endsAt !== null &&
          l.endsAt - Date.now() < 3_600_000;
        return (
          <li
            key={l.id}
            className={
              "mk-item" +
              (open === l.id ? " mk-open" : "") +
              (l.status === "sold" ? " mk-done" : "")
            }
            data-tut-sample={isSample(l.id) ? "" : undefined}
          >
            <button
              className="mk-row"
              onClick={() => setOpen(open === l.id ? null : l.id)}
            >
              <Slot wiki={wiki} l={l} />
              <span className="mk-name">
                <b>
                  {listingName(l)}
                  {isSample(l.id) && <i className="sample-tag">예시</i>}
                </b>
                <small>
                  {/* 삽니다 글: 하늘색 '삽니다' 표와 조건 (제작자 2026-11-03) */}
                  {l.side === "buy" && (
                    <span className="mk-buy-tag">삽니다</span>
                  )}
                  {l.side === "buy" && l.note && (
                    <span className="mk-row-note">{l.note}</span>
                  )}
                  {auction && (
                    <span
                      className={
                        "mk-auction-tag" + (ending ? " mk-ending" : "")
                      }
                    >
                      경매
                      {auctionOver(l)
                        ? " 끝"
                        : l.endsAt
                          ? ` ${timeLeft(l.endsAt)}`
                          : ""}
                    </span>
                  )}
                  {l.mode === "reserve" && (
                    <span className="mk-reserve-tag">예약 · {l.saleWhen}</span>
                  )}
                  {l.enchant && (
                    <span className="mk-ench">{enchantText(l)}</span>
                  )}
                  {auction
                    ? l.bidCount > 0 && <span>입찰 {l.bidCount}</span>
                    : l.wants > 0 && (
                        <span
                          className={
                            "mk-wants" + (l.wanted ? " mk-wants-me" : "")
                          }
                        >
                          {wantVerb(l)} {l.wants}
                        </span>
                      )}
                  {l.talkCount > 0 && (
                    <span className="mk-talk-count">토론 {l.talkCount}</span>
                  )}
                  {l.status === "sold" && <span>거래 완료</span>}
                  {!auction &&
                    !l.enchant &&
                    !l.wants &&
                    l.status !== "sold" && <span>{ago(l.createdAt)}</span>}
                </small>
              </span>
              <span className="mk-price">
                <small>
                  <Nick name={l.seller} />{" "}
                  <KakaoButton name={l.seller} nested />
                </small>
                <b
                  key={shownPrice}
                  className={changed ? "mk-flash" : undefined}
                >
                  <Coin /> {goldText(shownPrice)}
                </b>
                <small className="mk-cash">
                  {l.side === "buy" && "희망가 · "}
                  {cashText(shownPrice, rate)}
                </small>
              </span>
            </button>
            {open === l.id && (
              <Detail
                wiki={wiki}
                me={me}
                l={l}
                rate={rate}
                onChanged={(next) => onChanged(l.id, next)}
              />
            )}
          </li>
        );
      })}
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
function SellForm({
  wiki,
  rate,
  onDone,
}: {
  wiki: Wiki;
  rate: number;
  onDone: () => void;
}) {
  /** 팝니다 | 삽니다 (제작자 2026-11-03): 삽니다는 희망가와 조건·한마디만 적는다 (예약·경매·옵션 값·자동 경매 없음) */
  const [side, setSide] = useState<Side>("sell");
  const buy = side === "buy";
  const [mode, setMode] = useState<ListingMode>("sale");
  /** 예약 판매의 판매 조건 (제작자 요청 2026-11-02: 판매 예정 일자, 특정 레벨 찍으면, 다음 무기 구해지면 …) */
  const [saleWhen, setSaleWhen] = useState("");
  const [hours, setHours] = useState(24);
  /** 바로 판매인데 '살래요'가 2명 이상이면 저절로 경매로 (시간, null 이면 끔. 끄면 그때 판 사람에게 묻는다) */
  const [autoHours, setAutoHours] = useState<number | null>(null);
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
  /** 위키에 없는 물건의 스샷 (제작자 요청 2026-11-02): 읽은 값으로 이름·종류·강화·속성부여를 채우고, 그림은 정보창처럼 보인다 */
  const [shot, setShot] = useState<Shot | null>(null);
  const [reading, setReading] = useState(false);

  const name = item.trim();
  const known = name ? wikiItem(wiki, name) : undefined;
  const facts = itemFacts(known);
  const rolls = facts.options.rolls;
  const noTrade = facts.options.notes.includes("거래불가");
  // 위키 장비: 부위로 정해진 종류. 위키에 있지만 장비가 아님: 장비가 아닌 종류 중에서 (처음엔 기타).
  // 위키에 없음: 직접 고른 종류
  const wikiCat = categoryOf(known);
  const choices: readonly Category[] = known ? OTHER_CATEGORIES : CATEGORIES;
  const cat =
    wikiCat ??
    (category && choices.includes(category) ? category : known ? "기타" : null);
  const enhanceOk =
    cat !== null &&
    ENHANCE_CATEGORIES.includes(cat) &&
    !facts.options.notes.includes("강화불가");
  const enchantOk = cat !== null && ENCHANT_CATEGORIES.includes(cat);
  // 가격은 골드나 현금(원)으로 적는다 (제작자 요청). 현금이면 시세로 골드를 계산해 골드로 올린다
  const [unit, setUnit] = useState<"gold" | "won">("gold");
  const [won, setWon] = useState("");
  const priceN =
    unit === "won" ? Math.round((Number(won) || 0) * rate) : Number(price) || 0;
  function switchUnit(next: "gold" | "won") {
    if (next === unit) return;
    if (next === "won") setWon(priceN ? String(Math.round(priceN / rate)) : "");
    else setPrice(priceN ? String(priceN) : "");
    setUnit(next);
  }
  const qtyN = Number(qty);
  const suggestions = useMemo(() => {
    const q = squash(name);
    if (!q) return [];
    return Object.values(wiki.items)
      .filter((it) => squash(it.name).includes(q))
      .sort(
        (a, b) =>
          Number(!squash(a.name).startsWith(q)) -
            Number(!squash(b.name).startsWith(q)) ||
          a.name.length - b.name.length,
      )
      .slice(0, 12);
  }, [wiki, name]);
  const optionsFilled = buy || rolls.every((r) => (optionText[r.name] ?? "") !== "");
  const ok =
    name.length > 0 &&
    cat !== null &&
    priceN >= 1 &&
    priceN <= MAX_PRICE &&
    Number.isInteger(qtyN) &&
    qtyN >= 1 &&
    qtyN <= MAX_QTY &&
    (!enchantOk || !enchant || enchantValue !== null) &&
    optionsFilled &&
    (buy || mode !== "reserve" || saleWhen.trim().length > 0);
  const options: ListingOption[] | null = !buy && rolls.length
    ? rolls.map((r) => ({
        name: r.name,
        value: Number(optionText[r.name]),
        unit: r.unit,
      }))
    : null;

  async function pickShot(file: File | undefined) {
    if (!file) return;
    setError("");
    setReading(true);
    try {
      const next = await shrinkShot(file);
      setShot(next);
      const r = await readShot("market", next);
      if (r.name) {
        setItem(r.name);
        setTyping(false);
        setOptionText({});
      }
      if (r.category) setCategory(r.category as Category);
      if (r.enhance !== null) setEnhance(r.enhance);
      const ench = ENCHANTS.find((x) => x.name === r.enchant);
      if (ench && r.enchantValue !== null) {
        setEnchant(ench.key);
        setEnchantValue(r.enchantValue);
      }
    } catch (x) {
      // 읽지 못해도 그림은 붙인 채로 두고 직접 적게 한다
      setError(errorText(x));
    } finally {
      setReading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok || cat === null) return;
    setBusy(true);
    setError("");
    try {
      await createListing({
        side,
        item: name,
        category: cat,
        enhance: enhanceOk ? enhance : 0,
        enchant: enchantOk ? enchant : null,
        enchantValue: enchantOk && enchant ? enchantValue : null,
        qty: qtyN,
        price: priceN,
        note: note.trim() || null,
        options,
        mode: buy ? "sale" : mode,
        saleWhen: !buy && mode === "reserve" ? saleWhen.trim() : null,
        hours: !buy && mode === "auction" ? hours : null,
        autoAuction: !buy && mode === "sale" ? autoHours : null,
        // 스샷은 위키에 없는 물건일 때만 (위키 물건은 위키 정보창으로 보인다)
        shot: shot && !known ? { type: shot.type, data: shot.data } : null,
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
      {/* 팝니다 | 삽니다 (제작자 2026-11-03). 삽니다는 아래 판매 방식 줄이 없다 */}
      <div className="mk-field">
        <span>무엇을</span>
        <div className="pill-row mk-side-pick">
          {(["sell", "buy"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={"pill" + (side === s ? " pill-on" : "")}
              onClick={() => setSide(s)}
            >
              {SIDE_NAME[s]}
            </button>
          ))}
        </div>
      </div>
      {!buy && (
      <div className="mk-chips">
        <button
          type="button"
          className={"pill" + (mode === "sale" ? " pill-on" : "")}
          onClick={() => setMode("sale")}
        >
          바로 판매
        </button>
        {/* 예약 판매 (제작자 요청 2026-11-02): 화면은 바로 판매와 같고 판매 조건만 적는다 */}
        <button
          type="button"
          className={"pill" + (mode === "reserve" ? " pill-on" : "")}
          onClick={() => setMode("reserve")}
        >
          예약 판매
        </button>
        <button
          type="button"
          className={"pill" + (mode === "auction" ? " pill-on" : "")}
          onClick={() => setMode("auction")}
        >
          경매
        </button>
      </div>
      )}
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
      {typing &&
        suggestions.length > 0 &&
        !(known && suggestions.length === 1) && (
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
      {/* 위키에 없는 물건: 한 줄에 스샷 단추만 (제작자 요청 2026-11-02: UI 덕지덕지 없이). 고르면 읽어서 칸을 채운다 */}
      {name && !known && !(typing && suggestions.length > 0) && (
        <div className="mk-shot-row">
          {shot && (
            <span className="mk-shot-thumb">
              <img src={shot.preview} alt="" />
              <button
                type="button"
                aria-label="스샷 빼기"
                onClick={() => setShot(null)}
              >
                빼기
              </button>
            </span>
          )}
          <small>
            {reading
              ? "스샷 읽는 중…"
              : shot
                ? "스샷이 정보창으로 보여요"
                : "위키에 없는 아이템이에요"}
          </small>
          <label className={"pill mk-shot-btn" + (reading ? " pill-off" : "")}>
            {shot ? "스샷 바꾸기" : "스샷 올리기"}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={reading}
              onChange={(e) => (
                void pickShot(e.target.files?.[0]),
                (e.target.value = "")
              )}
            />
          </label>
        </div>
      )}
      {known && (
        <div className="mk-picked">
          <Slot
            wiki={wiki}
            l={{
              item: known.name,
              enhance: enhanceOk ? enhance : 0,
              qty: qtyN > 1 ? qtyN : 1,
            }}
            size={40}
          />
          <span>
            <b>
              {(enhanceOk && enhance > 0 ? `+${enhance}` : "") + known.name}
            </b>
            <small>
              {[facts.level && `요구 레벨 ${facts.level}`, facts.job]
                .filter(Boolean)
                .join(" · ") || "위키 아이템"}
            </small>
          </span>
        </div>
      )}
      {noTrade && (
        <p className="form-error">
          위키에 '거래불가'로 나온 아이템이에요. 게임에서 거래가 되는지 확인해
          주세요.
        </p>
      )}
      {!buy && rolls.length > 0 && (
        <div className="mk-field">
          <span>
            옵션 (이 아이템은 옵션이 범위에서 떠요. 내 아이템에 뜬 값을 적어
            주세요. 0도 돼요)
          </span>
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
                  onChange={(e) =>
                    setOptionText((t) => ({
                      ...t,
                      [r.name]: e.target.value.replace(/\D/g, "").slice(0, 5),
                    }))
                  }
                  placeholder="0"
                  aria-label={r.name}
                />
                <small className={off ? "mk-opt-off" : ""}>
                  {off
                    ? `위키 범위(${rollHint(r)})와 달라요`
                    : `위키 ${rollHint(r)}${r.unsure ? " (정확하지 않음)" : ""}`}
                </small>
              </label>
            );
          })}
        </div>
      )}
      {known &&
        (facts.options.fixed.length > 0 || facts.options.sets.length > 0) && (
          <p className="mk-meta">
            정해진 옵션:{" "}
            {[...facts.options.fixed, ...facts.options.sets].join(" · ")}
          </p>
        )}

      <div className="mk-field">
        <span>종류</span>
        {wikiCat && known ? (
          <p className="mk-fixed-cat">
            {wikiCat}
            <small>({known.equip[0]?.slot}, 위키에서 정해져요)</small>
          </p>
        ) : (
          <div className="mk-chips">
            {choices.map((c) => (
              <button
                key={c}
                type="button"
                className={"pill mk-chip" + (cat === c ? " pill-on" : "")}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {cat !== null && (
          <p className="mk-meta">
            {enhanceOk
              ? "강화만 되는 종류예요."
              : enchantOk
                ? "속성부여만 되는 종류예요."
                : "강화와 속성부여가 없는 종류예요."}
          </p>
        )}
      </div>

      {enhanceOk && (
        <div className="mk-field">
          <span>강화</span>
          <div className="level-row">
            <button
              type="button"
              className="pill level-step"
              onClick={() => setEnhance((v) => Math.max(0, v - 1))}
              aria-label="강화 내리기"
            >
              −
            </button>
            <span className="mk-enhance">
              {enhance > 0 ? `+${enhance}` : "없음"}
            </span>
            <button
              type="button"
              className="pill level-step"
              onClick={() => setEnhance((v) => Math.min(MAX_ENHANCE, v + 1))}
              aria-label="강화 올리기"
            >
              +
            </button>
          </div>
        </div>
      )}
      {enchantOk && (
        <div className="mk-field">
          <span>속성부여</span>
          <div className="mk-chips">
            <button
              type="button"
              className={"pill" + (enchant === null ? " pill-on" : "")}
              onClick={() => {
                setEnchant(null);
                setEnchantValue(null);
              }}
            >
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
                <button
                  key={v}
                  type="button"
                  className={
                    "pill mk-ench-pill" + (enchantValue === v ? " pill-on" : "")
                  }
                  onClick={() => setEnchantValue(v)}
                >
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
          <input
            className="mk-input"
            inputMode="numeric"
            value={qty}
            onChange={(e) =>
              setQty(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
          />
        </label>
        <label className="mk-field">
          <span className="mk-price-label">
            {buy ? "희망가" : mode === "auction" ? "시작가" : "가격"}
            <span className="mk-unit">
              <button
                type="button"
                className={unit === "gold" ? "mk-unit-on" : ""}
                onClick={() => switchUnit("gold")}
              >
                골드
              </button>
              <button
                type="button"
                className={unit === "won" ? "mk-unit-on" : ""}
                onClick={() => switchUnit("won")}
              >
                현금
              </button>
            </span>
          </span>
          {unit === "gold" ? (
            <input
              className="mk-input"
              inputMode="numeric"
              value={priceN ? goldText(priceN) : ""}
              onChange={(e) =>
                setPrice(e.target.value.replace(/\D/g, "").slice(0, 11))
              }
              placeholder="3,800,000"
            />
          ) : (
            <input
              className="mk-input"
              inputMode="numeric"
              value={won ? Number(won).toLocaleString("ko-KR") : ""}
              onChange={(e) =>
                setWon(e.target.value.replace(/\D/g, "").slice(0, 9))
              }
              placeholder="50,000 (원)"
            />
          )}
          {priceN > 0 && (
            <b className="mk-words">
              {unit === "won"
                ? `= ${goldWords(priceN)} 골드 (시세 ${rate}:1)`
                : `${goldWords(priceN)} ${cashText(priceN, rate)}`}
            </b>
          )}
        </label>
      </div>
      {!buy && mode === "sale" && (
        <div className="mk-field">
          <span>살래요 {WANTS_FOR_AUCTION}명 이상이면 경매로</span>
          <div className="mk-chips">
            <button
              type="button"
              className={"pill" + (autoHours === null ? " pill-on" : "")}
              onClick={() => setAutoHours(null)}
            >
              끔
            </button>
            {AUCTION_HOURS.map((h) => (
              <button
                key={h.hours}
                type="button"
                className={"pill" + (autoHours === h.hours ? " pill-on" : "")}
                onClick={() => setAutoHours(h.hours)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!buy && mode === "reserve" && (
        <label className="mk-field">
          <span>판매 조건</span>
          <input
            className="mk-input"
            value={saleWhen}
            onChange={(e) => setSaleWhen(e.target.value.slice(0, MAX_WHEN))}
            placeholder="예: 11/10 저녁, 50레벨 찍으면, 다음 무기 구하면"
          />
        </label>
      )}
      {!buy && mode === "auction" && (
        <div className="mk-field">
          <span>
            경매 시간 (시작가부터 남들이 점점 높게 불러요. 끝나면 가장 높게 부른
            사람에게 팔아요)
          </span>
          <div className="mk-chips">
            {AUCTION_HOURS.map((h) => (
              <button
                key={h.hours}
                type="button"
                className={"pill" + (hours === h.hours ? " pill-on" : "")}
                onClick={() => setHours(h.hours)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="mk-field">
        <span>{buy ? "조건 · 한마디 (안 적어도 돼요)" : "한마디 (안 적어도 돼요)"}</span>
        <input
          className="mk-input"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
          placeholder={buy ? "예: 명중 9 이상, 저녁에 거래해요" : "예: 저녁 9시 이후 접속해요"}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy
          ? "올리는 중…"
          : buy
            ? "삽니다 등록"
            : mode === "auction"
              ? "경매 등록"
              : mode === "reserve"
                ? "예약 등록"
                : "등록"}
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
  const { data, error } = useAsync(useCallback(() => fetchMarket(), [reload]), "market");
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [rate, setRate] = useState(75);
  // 내 골드 글도 '내 글' 칸에 (제작자 2026-11-03 '골드 메뉴도 통일감 있게'). 골드 칸 자체는 GoldBoard 가 따로 받는다
  const { data: goldData } = useAsync(useCallback(() => fetchGold(), [reload]), "gold");
  const [gold, setGold] = useState<GoldOffer[]>([]);
  useEffect(() => {
    if (goldData) setGold(goldData);
  }, [goldData]);
  const myGold = gold
    .filter((o) => o.owner === me.id)
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.createdAt - a.createdAt);
  const goldChanged = (id: number, next: GoldOffer | null) => setGold((os) => os.flatMap((o) => (o.id !== id ? [o] : next ? [next] : [])));
  const [onlyAuction, setOnlyAuction] = useEntryState("onlyAuction", false);
  const [tab, setTab] = useEntryState<Tab>("tab", "list");
  /** 목록의 팝니다 | 삽니다 (제작자 2026-11-03) */
  const [side, setSide] = useEntryState<Side>("side", "sell");
  // 새 물건·새 골드 글 수는 '목록'과 '골드' 단추에 (news.ts, 제작자 요청 2026-11-02). 보고 있는 칸은 본 것으로
  const news = useNews();
  useNewsSeen(
    tab === "list" ? ["market.items"] : tab === "gold" ? ["market.gold"] : [],
  );
  const [query, setQuery] = useEntryState("query", "");
  const [cat, setCat] = useEntryState<Category | "전체">("cat", "전체");
  const [onlyWanted, setOnlyWanted] = useEntryState("onlyWanted", false);
  useEffect(() => {
    if (data) {
      setListings(data.listings);
      setRate(data.goldRate);
    }
  }, [data]);

  // 튜토리얼 동안은 맨 앞에 예시 물건 (src/sample.ts)
  const sample = useSample();
  const all = sample
    ? [sampleListing(), ...(listings ?? [])]
    : (listings ?? []);
  const selling = all.filter((l) => l.status === "selling");
  const mine = all
    .filter((l) => l.seller === me.id)
    .sort(
      (a, b) =>
        Number(a.status === "sold") - Number(b.status === "sold") ||
        b.createdAt - a.createdAt,
    );
  const wantsOnMine =
    mine.filter((l) => l.status === "selling").reduce((s, l) => s + l.wants, 0) +
    myGold.filter((o) => o.status === "open").reduce((s, o) => s + o.wants, 0);
  const q = squash(query);
  // 팝니다 / 삽니다 는 따로 센다 (제작자 2026-11-03)
  const sideList = selling.filter((l) => l.side === side);
  const shown = sideList.filter(
    (l) =>
      (cat === "전체" || l.category === cat) &&
      (!onlyWanted || l.wanted) &&
      (!onlyAuction || l.mode === "auction") &&
      (!q || squash(listingName(l)).includes(q)),
  );
  const cats = CATEGORIES.filter((c) => sideList.some((l) => l.category === c));
  const auctions = sideList.filter((l) => l.mode === "auction").length;
  const wanted = sideList.filter((l) => l.wanted).length;
  const countOf = (s: Side) => selling.filter((l) => l.side === s).length;
  const changed = (id: number, next: Listing | null) =>
    setListings((ls) =>
      (ls ?? []).flatMap((l) => (l.id !== id ? [l] : next ? [next] : [])),
    );

  return (
    <>
      <TopBar title="사파이어 중개인" />
      {/* 맨 위 같은 폭 단추 넷, 그림·이모지 없이 (제작자 2026-11-03). 내 글의 숫자는 내 팝니다·삽니다 글에 온 살래요·팔래요 수 */}
      <nav className="pill-row mk-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={"pill" + (tab === t.key ? " pill-on" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "mine" && wantsOnMine > 0 && (
              <span className="mk-badge">{wantsOnMine}</span>
            )}
            {t.key === "list" && <NewsDot n={news["market.items"]} />}
            {t.key === "gold" && <NewsDot n={news["market.gold"]} />}
          </button>
        ))}
      </nav>

      {tab === "gold" ? (
        <GoldBoard me={me} />
      ) : !listings ? (
        <Loading error={error} />
      ) : tab === "list" ? (
        <>
          <div className="mk-search">
            <input
              className="mk-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="아이템 이름"
              aria-label="아이템 찾기"
            />
            {query && (
              <button className="pill" onClick={() => setQuery("")}>
                지우기
              </button>
            )}
            <button className="pill" onClick={() => setReload((n) => n + 1)}>
              새로고침
            </button>
          </div>
          {/* 아래 단계: 어두운 띠 안에 팝니다 · 삽니다 와 종류·경매·관심 물건 (제작자 2026-11-03 '버튼 상하위 개념', 장비대여의 .sub-tabs 와 같은 구분) */}
          <div className="mk-sub">
            <div className="mk-side" role="tablist">
              {(["sell", "buy"] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={side === s}
                  className={"sub-tab" + (side === s ? " sub-tab-on" : "")}
                  onClick={() => setSide(s)}
                >
                  {SIDE_NAME[s]} <small>{countOf(s)}</small>
                </button>
              ))}
            </div>
            <div className="mk-cats">
              {(["전체", ...cats] as const).map((c) => (
                <button
                  key={c}
                  className={"sub-tab" + (cat === c ? " sub-tab-on" : "")}
                  onClick={() => setCat(c)}
                >
                  {c}{" "}
                  <small>
                    {c === "전체"
                      ? sideList.length
                      : sideList.filter((l) => l.category === c).length}
                  </small>
                </button>
              ))}
              {/* 경매(팝니다만), 내가 살래요·팔래요를 누른 글: 있을 때만 (켜 둔 채 없어지면 끌 수 있게 그대로 둔다) */}
              {side === "sell" && (auctions > 0 || onlyAuction) && (
                <button
                  className={"sub-tab" + (onlyAuction ? " sub-tab-on" : "")}
                  onClick={() => setOnlyAuction((v) => !v)}
                >
                  경매 <small>{auctions}</small>
                </button>
              )}
              {(wanted > 0 || onlyWanted) && (
                <button
                  className={"sub-tab" + (onlyWanted ? " sub-tab-on" : "")}
                  onClick={() => setOnlyWanted((v) => !v)}
                >
                  관심 물건 <small>{wanted}</small>
                </button>
              )}
            </div>
          </div>
          <Rows
            wiki={wiki}
            me={me}
            list={shown}
            rate={rate}
            onChanged={changed}
            empty={
              sideList.length
                ? "찾는 물건이 없어요."
                : side === "buy"
                  ? "아직 삽니다 글이 없어요. '올리기'에서 삽니다를 골라 올려요."
                  : "아직 올라온 물건이 없어요. '올리기'에서 첫 물건을 올려 보세요!"
            }
          />
        </>
      ) : tab === "mine" ? (
        <>
          {(mine.length > 0 || myGold.length === 0) && (
            <Rows
              wiki={wiki}
              me={me}
              list={mine}
              rate={rate}
              onChanged={changed}
              empty="아직 올린 글이 없어요. '올리기'나 골드 칸의 '골드 글쓰기'에서 올려요."
            />
          )}
          {myGold.length > 0 && (
            <>
              <h2 className="panel-title mk-mine-head">골드</h2>
              <GoldRows me={me} list={myGold} onChanged={goldChanged} empty="" />
            </>
          )}
        </>
      ) : (
        <SellForm
          wiki={wiki}
          rate={rate}
          onDone={() => {
            setReload((n) => n + 1);
            setTab("mine");
          }}
        />
      )}
      {tab !== "gold" && (
        <p className="mk-hint">물건 거래는 게임 안에서 직접 해요.</p>
      )}
    </>
  );
}
