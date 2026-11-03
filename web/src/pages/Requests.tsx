import { useCallback, useEffect, useState } from "react";
import { useEntryState } from "../router";
import { KakaoButton, Nick } from "../kakao";
import type { FormEvent } from "react";
import { ApiError, RANK, errorText } from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import { isSample, sampleRequest } from "../sample";
import { useSample } from "../tutorialState";
import { MARKET_PIC, MAX_PRICE, ago, goldText, goldWords } from "../market";
import { MAX_DETAIL, MAX_NOTE, MAX_REWARD_TEXT, MAX_TITLE, STATUS_NAME, actOnRequest, createRequest, deleteRequest, fetchRequests, liveOffers } from "../requests";
import type { GuildRequest, RequestAction } from "../requests";
import { Loading, TopBar } from "../ui";

type Filter = "open" | "done" | "mine";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "모집 중" },
  { key: "done", label: "완료" },
  { key: "mine", label: "내 의뢰" },
];

const Coin = () => <img className="mk-coin" src={MARKET_PIC + "coin.png"} alt="" />;

/** 보상: 골드면 동전과 "5만 골드", 아니면 적은 글 */
function Reward({ r }: { r: GuildRequest }) {
  return r.rewardGold !== null ? (
    <span className="rq-reward">
      <Coin /> {goldWords(r.rewardGold)} 골드
    </span>
  ) : (
    <span className="rq-reward">🎁 {r.rewardText}</span>
  );
}

/** 의뢰 올리기: 무엇을 (자유롭게), 자세히 (수량·기한·조건을 글로), 보상(골드 또는 글) */
function RequestForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [kind, setKind] = useState<"gold" | "text">("gold");
  const [gold, setGold] = useState("");
  const [reward, setReward] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const goldN = Number(gold) || 0;
  const ok = title.trim().length > 0 && (kind === "gold" ? goldN >= 1 && goldN <= MAX_PRICE : reward.trim().length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await createRequest({
        title: title.trim(),
        detail: detail.trim() || null,
        rewardGold: kind === "gold" ? goldN : null,
        rewardText: kind === "text" ? reward.trim() : null,
      });
      onDone();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mk-form rq-form" onSubmit={submit}>
      <label className="mk-field">
        <span>의뢰</span>
        <input className="mk-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))} placeholder="예: 검은진액 100개 · 토요일 밤 인던 같이 가요" />
      </label>
      <label className="mk-field">
        <span>자세히 (안 적어도 돼요)</span>
        <textarea
          className="mk-input rq-detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value.slice(0, MAX_DETAIL))}
          placeholder="예: 이번 주말까지요. 20개씩 나눠서 줘도 돼요"
        />
      </label>
      <div className="mk-field">
        <span>보상</span>
        <div className="mk-chips">
          <button type="button" className={"pill" + (kind === "gold" ? " pill-on" : "")} onClick={() => setKind("gold")}>
            골드
          </button>
          <button type="button" className={"pill" + (kind === "text" ? " pill-on" : "")} onClick={() => setKind("text")}>
            기타 (직접 적기)
          </button>
        </div>
        {kind === "gold" ? (
          <>
            <input
              className="mk-input"
              inputMode="numeric"
              value={goldN ? goldText(goldN) : ""}
              onChange={(e) => setGold(e.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder="50,000"
              aria-label="보상 골드"
            />
            {goldN > 0 && <small className="mk-words">{goldWords(goldN)} 골드</small>}
          </>
        ) : (
          <input
            className="mk-input"
            value={reward}
            onChange={(e) => setReward(e.target.value.slice(0, MAX_REWARD_TEXT))}
            placeholder="예: 강화가죽벨트 1개 · 같이 가 주면 고마워요"
            aria-label="보상"
          />
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy ? "올리는 중…" : "의뢰 등록"}
      </button>
    </form>
  );
}

/**
 * 누른 의뢰: 자세히, 수락한 사람들과 한마디, 할 일 (수락, 포기, 완료, 다시 모집, 내리기).
 * 2026-11-03 제작자 요청: 여러 명이 수락하고 각자 게임 안에서 거래, 수량·기한은 앱이 세지 않고 올린 사람이 완료를 누르면 끝
 */
function RequestDetail({ me, r, onChanged, onStale }: { me: Me; r: GuildRequest; onChanged: (next: GuildRequest | null) => void; onStale?: () => void }) {
  const mine = r.owner === me.id;
  const manager = RANK[me.role] >= 1;
  const live = liveOffers(r);
  const myOffer = live.find((o) => o.user === me.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act(action: RequestAction, text?: string | null) {
    setBusy(true);
    setError("");
    try {
      onChanged(await actOnRequest(r.id, action, text));
      if (action === "accept") setNote("");
    } catch (x) {
      setError(errorText(x));
      // 그사이 끝났거나 이미 수락했으면 목록을 다시 받는다
      if (x instanceof ApiError && x.status === 409) onStale?.();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteRequest(r.id);
      onChanged(null);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mk-detail">
      {r.detail && <p className="mk-note rq-detail-text">{r.detail}</p>}
      <p className="mk-meta">
        {/* 의뢰한 사람과 카톡은 바로 위 목록 줄에 있어서 여기서는 뺀다 (제작자 요청 2026-11-02) */}
        {ago(r.createdAt)} 의뢰
        {live.length > 0 && ` · 수락 ${live.length}명`}
      </p>
      {live.length > 0 && (
        <ul className="rq-offers">
          {live.map((o) => (
            <li key={o.id} className="rq-offer">
              <Nick name={o.user} /> <KakaoButton name={o.user} mine={o.user === me.id} />
              {o.note && <span className="rq-offer-note">“{o.note}”</span>}
              <small>{ago(o.createdAt)}</small>
              {o.user === me.id && r.status === "open" && (
                <button className="pill rq-offer-btn" disabled={busy} onClick={() => act("giveup")}>
                  포기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!mine && !myOffer && r.status === "open" && (
        <form
          className="rq-accept"
          onSubmit={(e) => {
            e.preventDefault();
            void act("accept", note.trim() || null);
          }}
        >
          <input
            className="mk-input"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            placeholder="한마디 (예: 저 20개 있어요)"
            aria-label="한마디"
          />
          <button className="pill mk-want" disabled={busy}>
            ✋ 수락
          </button>
        </form>
      )}
      <div className="mk-actions">
        {mine && r.status === "open" && (
          <button className="pill" disabled={busy} onClick={() => act("done")}>
            ✔ 완료
          </button>
        )}
        {mine && r.status === "done" && (
          <button className="pill" disabled={busy} onClick={() => act("reopen")}>
            다시 모집
          </button>
        )}
        {(mine || manager) &&
          (confirmDelete ? (
            <button className="pill pill-danger" disabled={busy} onClick={remove}>
              삭제 확인
            </button>
          ) : (
            <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>
              {mine ? "삭제" : "내리기 (관리)"}
            </button>
          ))}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/**
 * 길드원 의뢰소: "검은진액 100개, 보상 5만 골드", "토요일 밤 인던 같이 가요" 같은 의뢰를 올리면 길드원이 한마디와 함께 수락하고
 * 게임 안에서 거래하거나 함께 한다. 여러 명이 수락할 수 있고, 올린 사람이 완료를 누르면 끝 (길드원 제안, 제작자 요청. 2026-11-03 주관식으로).
 */
export function RequestsPage({ me }: { me: Me }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchRequests(), [reload]));
  const [list, setList] = useState<GuildRequest[] | null>(null);
  const [filter, setFilter] = useEntryState<Filter>("filter", "open");
  const [writing, setWriting] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (data) setList(data);
  }, [data]);

  // 튜토리얼 동안은 맨 앞에 예시 의뢰 (src/sample.ts)
  const sample = useSample();
  const all = sample ? [sampleRequest(), ...(list ?? [])] : (list ?? []);
  const fits = (r: GuildRequest, f: Filter) => (f === "mine" ? r.owner === me.id || r.offers.some((o) => o.user === me.id) : r.status === f);
  const count = (f: Filter) => all.filter((r) => fits(r, f)).length;
  const shown = all.filter((r) => fits(r, filter));
  const changed = (id: number, next: GuildRequest | null) => setList((ls) => (ls ?? []).flatMap((r) => (r.id !== id ? [r] : next ? [next] : [])));

  return (
    <>
      <TopBar title="길드원 의뢰소" />
      <p className="growth-note">필요한 걸 자유롭게 올리면 길드원이 한마디와 함께 수락해요. 여러 명이 수락할 수 있고, 거래는 게임 안에서. 다 되면 올린 사람이 완료를 눌러요.</p>
      <div className="mk-cats">
        {FILTERS.map((f) => (
          <button key={f.key} className={"pill mk-chip" + (filter === f.key ? " pill-on" : "")} onClick={() => setFilter(f.key)}>
            {f.label} <small>{count(f.key)}</small>
          </button>
        ))}
        <button className={"pill mk-chip rq-write" + (writing ? " pill-on" : "")} onClick={() => setWriting((w) => !w)}>
          ＋ 의뢰 등록
        </button>
        <button className="pill mk-chip" onClick={() => setReload((n) => n + 1)} aria-label="새로 보기">
          ⟳
        </button>
      </div>
      {writing && (
        <RequestForm
          onDone={() => {
            setWriting(false);
            setFilter("mine");
            setReload((n) => n + 1);
          }}
        />
      )}
      {!list ? (
        <Loading error={error} />
      ) : shown.length === 0 ? (
        <div className="empty">{filter === "open" ? "모집 중인 의뢰가 없어요. 첫 의뢰를 올려 보세요!" : "없어요."}</div>
      ) : (
        <ul className="mk-list">
          {shown.map((r) => {
            const live = liveOffers(r);
            return (
              <li
                key={r.id}
                className={"mk-item" + (open === r.id ? " mk-open" : "") + (r.status === "done" ? " mk-done" : "")}
                data-tut-sample={isSample(r.id) ? "" : undefined}
              >
                <button className="mk-row" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className={"rq-status rq-status-" + r.status}>{STATUS_NAME[r.status]}</span>
                  <span className="mk-name">
                    <b>
                      {r.title}
                      {isSample(r.id) && <i className="sample-tag">예시</i>}
                    </b>
                    <small>
                      <Reward r={r} />
                      {live.length > 0 && (
                        <span className="rq-who">
                          ✋ <Nick name={live[0].user} />
                          {live.length > 1 && ` 외 ${live.length - 1}명`}
                        </span>
                      )}
                    </small>
                  </span>
                  <span className="mk-price">
                    <small>
                      <Nick name={r.owner} /> <KakaoButton name={r.owner} nested />
                    </small>
                    <small>{ago(r.createdAt)}</small>
                  </span>
                </button>
                {open === r.id && <RequestDetail me={me} r={r} onChanged={(next) => changed(r.id, next)} onStale={() => setReload((n) => n + 1)} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
