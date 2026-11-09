import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { errorText } from "../auth";
import type { Me } from "../auth";
import { useAsync } from "../data";
import { KakaoButton, Nick } from "../kakao";
import { goldWords } from "../market";
import {
  DEFAULT_BONUS_REWARD,
  DEFAULT_BONUS_SLOTS,
  DEFAULT_STANDARD_REWARD,
  MAX_NOTE,
  MAX_REWARD,
  REWARD_ITEMS,
  addBracket,
  addTarget,
  deleteBracket,
  deleteTarget,
  editBracket,
  editTarget,
  fetchQuest2,
  openRound,
  payClaim,
  progressOf,
  rejectClaim,
  requestClaim,
} from "../quest2";
import type { Quest2Bracket, Quest2Data, Quest2Target } from "../quest2";
import { Loading, TopBar } from "../ui";
import { useBackClose } from "../backClose";

/** 개발자 혼자 볼 샘플 (실제 서버에는 안 가고 화면에만, id 는 음수) */
const SAMPLE_TARGETS: Quest2Target[] = [
  {
    id: -1,
    nickname: "예시길동",
    startLevel: 31,
    endLevel: 33,
    note: null,
    currentLevel: 33,
    doneAlready: false,
    done: true,
    mine: false,
    claimed: false,
    pending: { id: -1, reward: DEFAULT_BONUS_REWARD, doping: false, note: "먼저 도착했어요!", requestedAt: Date.now() - 3_600_000 },
  },
  {
    id: -2,
    nickname: "예시춘향",
    startLevel: 34,
    endLevel: 36,
    note: null,
    currentLevel: 36,
    doneAlready: false,
    done: true,
    mine: false,
    claimed: true,
    pending: null,
  },
  {
    id: -3,
    nickname: "예시철수",
    startLevel: 36,
    endLevel: 37,
    note: null,
    currentLevel: 36,
    doneAlready: false,
    done: false,
    mine: true,
    claimed: false,
    pending: null,
  },
];
const isSampleId = (id: number) => id < 0;

/** 목표 하나: 진행 상태, 보상받기 신청 (본인, 완주해야만), 지급·반려·수정·내리기 (오피서 이상) */
function TargetRow({
  t,
  canManage,
  onChanged,
}: {
  t: Quest2Target;
  canManage: boolean;
  onChanged: () => void;
}) {
  const sample = isSampleId(t.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justClaimed, setJustClaimed] = useState(false);
  const [doping, setDoping] = useState(false);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [startLevel, setStartLevel] = useState(String(t.startLevel));
  const [endLevel, setEndLevel] = useState(String(t.endLevel));
  const [editNote, setEditNote] = useState(t.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  function blockSample(): boolean {
    if (!sample) return false;
    setError("예시 자료예요 · 실제로 신청·처리되지 않아요");
    return true;
  }

  async function claim() {
    if (blockSample()) return;
    setBusy(true);
    setError("");
    try {
      await requestClaim(t.id, doping, note.trim() || null);
      setNote("");
      setJustClaimed(true);
      window.setTimeout(() => setJustClaimed(false), 900);
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (blockSample() || !t.pending) return;
    setBusy(true);
    setError("");
    try {
      await payClaim(t.pending.id);
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    if (blockSample() || !t.pending) return;
    setBusy(true);
    setError("");
    try {
      await rejectClaim(t.pending.id, rejectNote.trim() || null);
      setRejecting(false);
      setRejectNote("");
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function saveEdit() {
    if (blockSample()) return;
    setBusy(true);
    setError("");
    try {
      await editTarget(t.id, { startLevel: Number(startLevel), endLevel: Number(endLevel), note: editNote.trim() || null });
      setEditing(false);
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (blockSample()) return;
    setBusy(true);
    setError("");
    try {
      await deleteTarget(t.id);
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const canClaim = t.mine && !t.pending && !t.claimed && (t.done || t.doneAlready);
  // 상태 표는 짧게 (54px 칸에서 세 줄로 접혔다)
  const status = t.doneAlready ? "도달" : t.claimed ? "받음" : t.pending ? "신청함" : t.done ? "완주" : "진행 중";
  const tone = t.claimed || t.doneAlready ? "q2-st-done" : t.pending ? "q2-st-wait" : t.done ? "q2-st-clear" : "q2-st-run";
  const pct = Math.round(progressOf(t) * 100);

  return (
    <li className={"mk-item q2-item" + (open ? " mk-open" : "") + (justClaimed ? " q2-pop" : "") + (canClaim ? " q2-ready" : "")}>
      <button className="mk-row" onClick={() => setOpen((o) => !o)}>
        <span className={"rq-status q2-st " + tone + (t.pending ? " q2-pending-dot" : "")}>{status}</span>
        <span className="mk-name">
          <b>
            <Nick name={t.nickname} /> <KakaoButton name={t.nickname} nested />
            {sample && <i className="sample-tag">예시</i>}
          </b>
          <small>
            {t.doneAlready ? `Lv.${t.startLevel}` : `Lv.${t.startLevel} → ${t.endLevel}`}
            {!t.doneAlready && (t.currentLevel !== null ? ` · 지금 ${t.currentLevel}` : " · 레벨 모름")}
            {t.note && ` · ${t.note}`}
          </small>
          {!t.doneAlready && (
            <span className="q2-bar" aria-label={`진행 ${pct}%`}>
              <i style={{ transform: `scaleX(${pct / 100})` }} />
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="mk-detail">
          {t.pending && (
            <p className="mk-note">
              신청 중{t.pending.reward && `: ${t.pending.reward}`}
              {t.pending.doping ? " · 도핑 지원" : ""}
              {t.pending.note && ` · “${t.pending.note}”`}
            </p>
          )}
          {!t.pending && t.claimed && <p className="mk-note">완주 보상을 받았어요.</p>}

          {canClaim && (
            <form
              className="rq-accept"
              onSubmit={(e) => {
                e.preventDefault();
                void claim();
              }}
            >
              <input
                className="mk-input"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                placeholder="한마디 (안 적어도 돼요)"
                aria-label="한마디"
              />
              <label className="q2-doping">
                <input type="checkbox" checked={doping} onChange={(e) => setDoping(e.target.checked)} /> 도핑 지원도 필요해요
              </label>
              <button className="pill mk-want" disabled={busy}>
                🎯 보상받기 신청
              </button>
            </form>
          )}
          {t.doneAlready && !canClaim && !t.pending && !t.claimed && t.mine === false && (
            <p className="mk-meta">본인만 도핑 지원을 신청할 수 있어요.</p>
          )}

          {canManage && t.pending && (
            <div className="mk-actions">
              <button className="pill" disabled={busy} onClick={pay}>
                지급 완료
              </button>
              {rejecting ? (
                <form
                  className="rq-accept"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void reject();
                  }}
                >
                  <input
                    className="mk-input"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value.slice(0, MAX_NOTE))}
                    placeholder="반려 의견 (안 적어도 돼요)"
                  />
                  <button className="pill pill-danger" disabled={busy}>
                    반려 확인
                  </button>
                </form>
              ) : (
                <button className="pill" disabled={busy} onClick={() => setRejecting(true)}>
                  반려
                </button>
              )}
            </div>
          )}

          {canManage && (
            <div className="mk-actions">
              {editing ? (
                <form
                  className="panel mk-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit();
                  }}
                >
                  <label className="mk-field">
                    <span>레벨 Lv.{startLevel} → Lv.{endLevel}</span>
                    <div className="mk-chips">
                      <input className="mk-input" inputMode="numeric" value={startLevel} onChange={(e) => setStartLevel(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                      <input className="mk-input" inputMode="numeric" value={endLevel} onChange={(e) => setEndLevel(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                    </div>
                  </label>
                  <label className="mk-field">
                    <span>쪽지</span>
                    <input className="mk-input" value={editNote} onChange={(e) => setEditNote(e.target.value.slice(0, MAX_NOTE))} />
                  </label>
                  <button className="btn" disabled={busy}>
                    저장
                  </button>
                </form>
              ) : (
                <button
                  className="pill"
                  onClick={() => {
                    setStartLevel(String(t.startLevel));
                    setEndLevel(String(t.endLevel));
                    setEditNote(t.note ?? "");
                    setEditing(true);
                  }}
                >
                  목표 수정
                </button>
              )}
              {confirmDelete ? (
                <button className="pill pill-danger" disabled={busy} onClick={remove}>
                  삭제 확인
                </button>
              ) : (
                <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  내리기
                </button>
              )}
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </li>
  );
}

/** 새 목표 추가 (오피서 이상, 라운드 안에 하나씩) */
function AddTargetForm({ onDone }: { onDone: () => void }) {
  const [nickname, setNickname] = useState("");
  const [startLevel, setStartLevel] = useState("");
  const [endLevel, setEndLevel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = nickname.trim() && Number(startLevel) >= 1 && Number(endLevel) >= Number(startLevel);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await addTarget({ nickname: nickname.trim(), startLevel: Number(startLevel), endLevel: Number(endLevel), note: note.trim() || null });
      setNickname("");
      setStartLevel("");
      setEndLevel("");
      setNote("");
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
        <span>닉네임</span>
        <input className="mk-input" value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 20))} placeholder="예: 펀취" />
      </label>
      <label className="mk-field">
        <span>시작 레벨 → 목표 레벨</span>
        <div className="mk-chips">
          <input className="mk-input" inputMode="numeric" value={startLevel} onChange={(e) => setStartLevel(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="36" />
          <input className="mk-input" inputMode="numeric" value={endLevel} onChange={(e) => setEndLevel(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="37" />
        </div>
      </label>
      <label className="mk-field">
        <span>쪽지 (안 적어도 돼요)</span>
        <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))} placeholder="예: 길톡 들어오기" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !ok}>
        {busy ? "넣는 중…" : "목표 추가"}
      </button>
    </form>
  );
}

/** 새 라운드 열기 (오피서 이상): 목표 목록을 한 줄에 하나씩 붙여 넣고, 선착순·완주 보상 글을 같이 정한다 */
function NewRoundForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [bonusSlots, setBonusSlots] = useState(String(DEFAULT_BONUS_SLOTS));
  const [bonusReward, setBonusReward] = useState(DEFAULT_BONUS_REWARD);
  const [standardReward, setStandardReward] = useState(DEFAULT_STANDARD_REWARD);
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function parse() {
    return bulk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [nickname, s, e, ...rest] = line.split(",").map((v) => v.trim());
        return { nickname, startLevel: Number(s), endLevel: Number(e || s), note: rest.join(",").trim() || null };
      });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const targets = parse();
    if (!title.trim() || !targets.length) return;
    setBusy(true);
    setError("");
    try {
      await openRound({
        title: title.trim(),
        note: note.trim() || null,
        bonusSlots: Number(bonusSlots) || 0,
        bonusReward: bonusReward.trim() || DEFAULT_BONUS_REWARD,
        standardReward: standardReward.trim() || DEFAULT_STANDARD_REWARD,
        targets,
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
        <span>라운드 이름</span>
        <input className="mk-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 40))} placeholder="예: 11월 2주차 성장 퀘스트" />
      </label>
      <label className="mk-field">
        <span>안내 (안 적어도 돼요)</span>
        <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 80))} placeholder="예: 절대 강요 아니에요, 못해도 불이익 없어요" />
      </label>
      <label className="mk-field">
        <span>선착 몇 명까지 보너스 보상</span>
        <input className="mk-input" inputMode="numeric" value={bonusSlots} onChange={(e) => setBonusSlots(e.target.value.replace(/\D/g, "").slice(0, 2))} />
      </label>
      <label className="mk-field">
        <span>선착순 보상</span>
        <input className="mk-input" value={bonusReward} onChange={(e) => setBonusReward(e.target.value.slice(0, MAX_REWARD))} />
      </label>
      <label className="mk-field">
        <span>나머지 완주 보상</span>
        <input className="mk-input" value={standardReward} onChange={(e) => setStandardReward(e.target.value.slice(0, MAX_REWARD))} />
      </label>
      <label className="mk-field">
        <span>목표 (한 줄에 하나: 닉네임, 시작 레벨, 목표 레벨, 쪽지)</span>
        <textarea className="mk-input rq-detail" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"펀취, 36, 37\n공포티모, 48, 48"} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !title.trim() || !parse().length}>
        {busy ? "여는 중…" : "새 라운드 열기 (이전 라운드는 접혀요)"}
      </button>
    </form>
  );
}

/** 레벨 구간 참고표 (오피서 이상이 조정): 명단에 없는 2군 길드원을 위한 대략적인 안내일 뿐, 신청·지급과는 따로다 */
function BracketTable({
  brackets,
  canManage,
  myLevel,
  onChanged,
}: {
  brackets: Quest2Bracket[];
  canManage: boolean;
  /** 내 지금 레벨 (그 구간을 금색으로) */
  myLevel: number | null;
  onChanged: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [adding, setAdding] = useState(false);
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNote, setEditNote] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await addBracket({ minLevel: Number(minLevel), maxLevel: Number(maxLevel), note: note.trim() });
      setMinLevel("");
      setMaxLevel("");
      setNote("");
      setAdding(false);
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function saveNote(id: number) {
    setBusy(true);
    setError("");
    try {
      await editBracket(id, { note: editNote.trim() });
      setEditingId(null);
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: number) {
    setBusy(true);
    try {
      await deleteBracket(id);
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel q2-panel">
      <p className="q2-head">
        <b>레벨 구간 참고표</b>
        <small>만렙 55 · 20 아래는 안 봐도 돼요</small>
        {canManage && (
          <button type="button" className={"pill q2-mini" + (editMode ? " pill-on" : "")} onClick={() => setEditMode((v) => !v)}>
            {editMode ? "완료" : "편집"}
          </button>
        )}
      </p>
      <ul className="q2-brackets">
        {brackets.map((b) => (
          <li key={b.id} className={myLevel !== null && myLevel >= b.minLevel && myLevel <= b.maxLevel ? "q2-br-me" : ""}>
            <span className="q2-br-lv">{b.minLevel === b.maxLevel ? `Lv.${b.minLevel}` : `Lv.${b.minLevel}~${b.maxLevel}`}</span>
            {editingId === b.id ? (
              <span className="q2-br-edit">
                <input className="mk-input" value={editNote} onChange={(e) => setEditNote(e.target.value.slice(0, MAX_REWARD))} />
                <button type="button" className="pill q2-mini" disabled={busy} onClick={() => saveNote(b.id)}>
                  저장
                </button>
              </span>
            ) : (
              <span className="q2-br-note">{b.note}</span>
            )}
            {editMode && editingId !== b.id && (
              <span className="q2-br-act">
                <button
                  type="button"
                  className="pill q2-mini"
                  onClick={() => {
                    setEditingId(b.id);
                    setEditNote(b.note);
                  }}
                >
                  수정
                </button>
                <button type="button" className="pill q2-mini" disabled={busy} onClick={() => remove(b.id)}>
                  삭제
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editMode &&
        (adding ? (
          <form className="mk-form" onSubmit={submit}>
            <div className="mk-chips">
              <input className="mk-input" inputMode="numeric" value={minLevel} onChange={(e) => setMinLevel(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="시작" />
              <input className="mk-input" inputMode="numeric" value={maxLevel} onChange={(e) => setMaxLevel(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="끝" />
            </div>
            <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, MAX_REWARD))} placeholder="안내 글" />
            {error && <p className="form-error">{error}</p>}
            <button className="btn" disabled={busy}>
              구간 추가
            </button>
          </form>
        ) : (
          <button className="pill" onClick={() => setAdding(true)}>
            ＋ 구간 추가
          </button>
        ))}
    </div>
  );
}

/**
 * 2군 성장 퀘스트 (개발중, 제작자 2026-11-09): 2군 캐릭터마다 목표 레벨까지 다 올리면 보상을 신청할 수 있다. 먼저 완주한 몇 명은 더 큰 보상,
 * 나머지 완주자는 보통 보상 (둘 다 글로 적은 실제 게임 안 물건). 오피서에게 알림이 가고 게임 안에서 실제로 준 뒤 지급 완료를 누른다.
 */
export function Quest2Page({ me }: { me: Me }) {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchQuest2(), [reload]), "quest2");
  const [current, setCurrent] = useState<Quest2Data | null>(null);
  const [addingTarget, setAddingTarget] = useState(false);
  const [newRound, setNewRound] = useState(false);
  const [showBrackets, setShowBrackets] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const [showSample, setShowSample] = useState(true);
  useEffect(() => {
    if (data) setCurrent(data);
  }, [data]);
  const anyOpen = addingTarget || newRound || showBrackets;
  useBackClose(anyOpen, () => {
    setAddingTarget(false);
    setNewRound(false);
    setShowBrackets(false);
  });

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (!current) return <Loading error={error} />;
  const { round, targets, brackets, canManage, payoutNote } = current;
  const shown = showSample ? [...targets, ...SAMPLE_TARGETS] : targets;
  const left = round ? Math.max(0, round.bonusSlots - round.completed) : 0;

  return (
    <>
      <TopBar title="2군 성장 퀘스트" />

      {!round ? (
        <div className="empty">지금 열린 라운드가 없어요{canManage ? " · 아래에서 새로 열어 보세요" : ""}.</div>
      ) : (
        <div className="panel q2-panel q2-round">
          <p className="q2-head">
            <b>{round.title}</b>
            <small>완주 {round.completed}명</small>
          </p>
          {round.note && <p className="q2-round-note">{round.note}</p>}
          <div className="q2-rewards">
            <div className={"q2-reward q2-reward-bonus" + (left > 0 ? " q2-live" : "")}>
              <span className="q2-reward-tag">
                선착 {round.bonusSlots}명 · {left > 0 ? `남은 자리 ${left}` : "마감"}
              </span>
              <span>{round.bonusReward}</span>
            </div>
            <div className="q2-reward">
              <span className="q2-reward-tag">나머지 완주</span>
              <span>{round.standardReward}</span>
            </div>
          </div>
          <p className="q2-round-foot">목표 레벨에 닿으면 내 줄을 눌러 신청 · {payoutNote}</p>
        </div>
      )}

      <div className="mk-cats">
        {canManage && (
          <>
            <button className={"pill mk-chip" + (addingTarget ? " pill-on" : "")} onClick={() => setAddingTarget((v) => !v)} disabled={!round}>
              ＋ 목표 추가
            </button>
            <button className={"pill mk-chip" + (newRound ? " pill-on" : "")} onClick={() => setNewRound((v) => !v)}>
              🆕 새 라운드 열기
            </button>
          </>
        )}
        <button className={"pill mk-chip" + (showBrackets ? " pill-on" : "")} onClick={() => setShowBrackets((v) => !v)}>
          📊 레벨 구간표
        </button>
        <button className={"pill mk-chip" + (showRef ? " pill-on" : "")} onClick={() => setShowRef((v) => !v)}>
          🎁 예시 보상 아이템
        </button>
        <button className={"pill mk-chip" + (showSample ? " pill-on" : "")} onClick={() => setShowSample((v) => !v)}>
          {showSample ? "예시 숨기기" : "예시 보기"}
        </button>
        <button className="pill mk-chip" onClick={refresh} aria-label="새로 보기">
          ⟳
        </button>
      </div>

      {showRef && (
        <ul className="q2-ledger">
          {REWARD_ITEMS.map((it) => (
            <li key={it.name}>
              <span>
                {it.name} {it.unit}
              </span>
              <span>
                <b>{goldWords(it.gold)} 골드</b>
              </span>
            </li>
          ))}
        </ul>
      )}
      {showBrackets && <BracketTable brackets={brackets} canManage={canManage} myLevel={me.level} onChanged={refresh} />}
      {addingTarget && (
        <AddTargetForm
          onDone={() => {
            setAddingTarget(false);
            refresh();
          }}
        />
      )}
      {newRound && (
        <NewRoundForm
          onDone={() => {
            setNewRound(false);
            refresh();
          }}
        />
      )}

      {round && (
        <>
          {!shown.length ? (
            <div className="empty">아직 목표가 없어요.</div>
          ) : (
            <ul className="mk-list">
              {shown.map((t) => (
                <TargetRow key={t.id} t={t} canManage={canManage} onChanged={refresh} />
              ))}
            </ul>
          )}
        </>
      )}

      {canManage && current.pendingClaims && current.pendingClaims.length > 0 && (
        <div className="panel">
          <p className="mk-meta">
            <b>처리할 신청 {current.pendingClaims.length}건</b>
          </p>
          <ul className="q2-ledger">
            {current.pendingClaims.map((c) => (
              <li key={c.id}>
                <span>
                  <Nick name={c.nickname} /> {c.rank && `· 완주 ${c.rank}번째`}
                  {c.doping && " · 도핑 지원"}
                </span>
                <span>
                  {c.reward}
                  {c.note && ` · “${c.note}”`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
