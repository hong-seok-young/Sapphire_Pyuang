import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { RANK, errorText } from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import { MARKET_PIC, MAX_PRICE, ago, goldText, goldWords } from "../market";
import {
  MAX_DETAIL, MAX_REWARD_TEXT, MAX_TITLE, STATUS_NAME, actOnRequest, createRequest, deleteRequest, fetchRequests, timeLeft,
} from "../requests";
import type { GuildRequest, RequestAction } from "../requests";
import { Loading, TopBar } from "../ui";

type Filter = "open" | "accepted" | "done" | "mine";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "모집 중" },
  { key: "accepted", label: "진행 중" },
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

/** 의뢰 올리기: 무엇을 (자유롭게), 자세히, 보상(골드 또는 글) */
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
        title: title.trim(), detail: detail.trim() || null,
        rewardGold: kind === "gold" ? goldN : null, rewardText: kind === "text" ? reward.trim() : null,
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
        <span>의뢰</span>
        <input className="mk-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))} placeholder="예: 검은진액 100개" />
      </label>
      <label className="mk-field">
        <span>자세히 (안 적어도 돼요)</span>
        <textarea className="mk-input rq-detail" value={detail} onChange={(e) => setDetail(e.target.value.slice(0, MAX_DETAIL))} placeholder="예: 이번 주말까지요. 나눠서 줘도 돼요" />
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
          <input className="mk-input" value={reward} onChange={(e) => setReward(e.target.value.slice(0, MAX_REWARD_TEXT))} placeholder="예: 강화가죽벨트 1개" aria-label="보상" />
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy ? "올리는 중…" : "의뢰 등록"}
      </button>
    </form>
  );
}

/** 누른 의뢰: 자세히, 진행 상황, 할 일 (수락, 포기, 수락 취소, 완료, 다시 모집, 내리기) */
function RequestDetail({ me, r, onChanged }: { me: Me; r: GuildRequest; onChanged: (next: GuildRequest | null) => void }) {
  const mine = r.owner === me.id;
  const accepter = r.accepter === me.id;
  const manager = RANK[me.role] >= 1;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act(action: RequestAction) {
    setBusy(true);
    setError("");
    try {
      onChanged(await actOnRequest(r.id, action));
    } catch (x) {
      setError(errorText(x));
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
        {r.owner} · {ago(r.createdAt)} 의뢰
        {r.status === "accepted" && r.accepter && r.dueAt && ` · ${r.accepter} 수락 (${timeLeft(r.dueAt)} 남음)`}
        {r.status === "done" && r.accepter && ` · ${r.accepter} 님이 해냈어요`}
      </p>
      <div className="mk-actions">
        {!mine && r.status === "open" && (
          <>
            <button className="pill mk-want" disabled={busy} onClick={() => act("accept")}>
              ✋ 수락
            </button>
            <small className="mk-meta">다 모아 두고 눌러 주세요. 수락하면 이틀 안에 게임에서 전해 주세요.</small>
          </>
        )}
        {accepter && r.status === "accepted" && (
          <button className="pill" disabled={busy} onClick={() => act("giveup")}>
            포기
          </button>
        )}
        {mine && r.status === "accepted" && (
          <>
            <button className="pill" disabled={busy} onClick={() => act("done")}>
              ✔ 완료 (거래했어요)
            </button>
            <button className="pill" disabled={busy} onClick={() => act("release")}>
              수락 취소
            </button>
          </>
        )}
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
 * 길드원 의뢰소: "검은진액 100개, 보상 5만 골드" 같은 의뢰를 올리면, 모아 둔 길드원이 선착순으로 수락하고
 * 게임 안에서 거래한다. 수락하고 이틀 안에 안 끝나면 다시 모집 중이 된다 (길드원 제안, 제작자 요청).
 */
export function RequestsPage({ me }: { me: Me }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchRequests(), [reload]));
  const [list, setList] = useState<GuildRequest[] | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [writing, setWriting] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (data) setList(data);
  }, [data]);

  const all = list ?? [];
  const count = (f: Filter) => all.filter((r) => (f === "mine" ? r.owner === me.id || r.accepter === me.id : r.status === f)).length;
  const shown = all.filter((r) => (filter === "mine" ? r.owner === me.id || r.accepter === me.id : r.status === filter));
  const changed = (id: number, next: GuildRequest | null) => setList((ls) => (ls ?? []).flatMap((r) => (r.id !== id ? [r] : next ? [next] : [])));

  return (
    <>
      <TopBar title="길드원 의뢰소" />
      <div className="rank-banner">
        <span className="rank-banner-en">GUILD REQUESTS</span>
        <span className="rank-banner-ko">길드원 의뢰소</span>
      </div>
      <p className="growth-note">
        필요한 걸 의뢰로 올리면, 다 모은 길드원이 선착순으로 수락해요. 수락하면 이틀 안에 게임에서 거래해 주세요 (지나면 다시 모집 중).
      </p>
      <div className="mk-cats">
        {FILTERS.map((f) => (
          <button key={f.key} className={"pill mk-chip" + (filter === f.key ? " pill-on" : "")} onClick={() => setFilter(f.key)}>
            {f.label} <small>{count(f.key)}</small>
          </button>
        ))}
        <button className={"pill mk-chip" + (writing ? " pill-on" : "")} onClick={() => setWriting((w) => !w)}>
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
          {shown.map((r) => (
            <li key={r.id} className={"mk-item" + (open === r.id ? " mk-open" : "") + (r.status === "done" ? " mk-done" : "")}>
              <button className="mk-row" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className={"rq-status rq-status-" + r.status}>{STATUS_NAME[r.status]}</span>
                <span className="mk-name">
                  <b>{r.title}</b>
                  <small>
                    <Reward r={r} />
                    {r.status === "accepted" && r.accepter && <span>✋ {r.accepter}</span>}
                  </small>
                </span>
                <span className="mk-price">
                  <small>{r.owner}</small>
                  <small>{ago(r.createdAt)}</small>
                </span>
              </button>
              {open === r.id && <RequestDetail me={me} r={r} onChanged={(next) => changed(r.id, next)} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
