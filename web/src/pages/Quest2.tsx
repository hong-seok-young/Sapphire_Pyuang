import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { errorText } from "../auth";
import { useAsync } from "../data";
import { KakaoButton, Nick } from "../kakao";
import { goldWords } from "../market";
import {
  MAX_NOTE,
  REWARD_ITEMS,
  addTarget,
  deleteTarget,
  editTarget,
  fetchQuest2,
  openRound,
  payClaim,
  rejectClaim,
  requestClaim,
  rewardLedger,
  saveBands,
  totalReward,
} from "../quest2";
import type { Band, Quest2Data, Quest2Target } from "../quest2";
import { Loading, TopBar } from "../ui";
import { useBackClose } from "../backClose";

/** 레벨 하나마다 올린 보상 표 (제작자 요청: '1렙업마다' 보상을 공평하게, 대충 몇에서 몇 올리면 보상 뭐다) */
function Ledger({ from, to, bands }: { from: number; to: number; bands: Band[] }) {
  const rows = rewardLedger(from, to, bands);
  if (!rows.length) return null;
  return (
    <ul className="q2-ledger">
      {rows.map((r) => (
        <li key={r.level}>
          Lv.{r.level - 1} → Lv.{r.level} <b>{goldWords(r.gold)} 골드</b>
        </li>
      ))}
    </ul>
  );
}

/** 목표 하나: 진행 상태, 레벨대 사다리, 보상받기 신청 (본인), 지급·반려 (오피서 이상) */
function TargetRow({
  t,
  bands,
  canManage,
  onChanged,
}: {
  t: Quest2Target;
  bands: Band[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doping, setDoping] = useState(false);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [startLevel, setStartLevel] = useState(String(t.startLevel));
  const [endLevel, setEndLevel] = useState(String(t.endLevel));
  const [editNote, setEditNote] = useState(t.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function claim() {
    setBusy(true);
    setError("");
    try {
      await requestClaim(t.id, doping, note.trim() || null);
      setNote("");
      onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (!t.pending) return;
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
    if (!t.pending) return;
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

  const done = t.currentLevel !== null && t.currentLevel >= t.endLevel;
  const canClaim = t.mine && !t.pending && (t.claimableGold > 0 || t.doneAlready);

  return (
    <li className={"mk-item" + (open ? " mk-open" : "")}>
      <button className="mk-row" onClick={() => setOpen((o) => !o)}>
        <span className={"rq-status rq-status-" + (done ? "done" : "open")}>{t.doneAlready ? "목표 도달" : done ? "달성" : "진행 중"}</span>
        <span className="mk-name">
          <b>
            <Nick name={t.nickname} /> <KakaoButton name={t.nickname} nested />
          </b>
          <small>
            {t.doneAlready ? `Lv.${t.startLevel} (이미 목표 레벨)` : `Lv.${t.startLevel} → Lv.${t.endLevel}`}
            {t.currentLevel !== null ? ` · 지금 Lv.${t.currentLevel}` : " · 레벨 정보 없음"}
            {t.note && ` · ${t.note}`}
          </small>
        </span>
        <span className="mk-price">
          <small>{t.claimableGold > 0 ? <b>{goldWords(t.claimableGold)} 골드</b> : "—"}</small>
          {t.pending && <small>신청함</small>}
        </span>
      </button>
      {open && (
        <div className="mk-detail">
          {!t.doneAlready && t.paidToLevel < t.endLevel && (
            <>
              <p className="mk-meta">레벨 하나마다 쌓이는 보상 (지급 완료: Lv.{t.paidToLevel}까지 · 목표 전체 {goldWords(totalReward(t, bands))} 골드)</p>
              <Ledger from={t.paidToLevel} to={t.endLevel} bands={bands} />
              <p className="mk-meta">
                끝까지 올리면 앞으로 총 <b>{goldWords(rewardLedger(t.paidToLevel, t.endLevel, bands).reduce((s, r) => s + r.gold, 0))} 골드</b>
              </p>
            </>
          )}

          {t.pending && (
            <p className="mk-note">
              신청 중: {t.pending.gold > 0 ? `${goldWords(t.pending.gold)} 골드` : ""}
              {t.pending.doping ? " · 도핑 지원" : ""}
              {t.pending.note && ` · “${t.pending.note}”`}
            </p>
          )}

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

/** 새 라운드 열기 (오피서 이상): 목표 목록을 한 줄에 하나씩, '닉네임, 시작, 목표, 쪽지' 로 붙여 넣으면 한 번에 만든다 */
function NewRoundForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
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
        return { nickname, startLevel: Number(s), endLevel: Number(e), note: rest.join(",").trim() || null };
      });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const targets = parse();
    if (!title.trim() || !targets.length) return;
    setBusy(true);
    setError("");
    try {
      await openRound({ title: title.trim(), note: note.trim() || null, targets });
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
        <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 80))} placeholder="예: 일주일 안으로 달성하면 도핑 지원" />
      </label>
      <label className="mk-field">
        <span>목표 (한 줄에 하나: 닉네임, 시작 레벨, 목표 레벨, 쪽지)</span>
        <textarea className="mk-input rq-detail" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"펀취, 36, 37\n가져가, 33, 35, 길톡 들어오기"} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !title.trim() || !parse().length}>
        {busy ? "여는 중…" : "새 라운드 열기 (이전 라운드는 접혀요)"}
      </button>
    </form>
  );
}

/** 보상 레벨대 조정 (오피서 이상, '조정해도 됨'): 레벨이 높을수록 1레벨이 힘들어서 더 많이 주도록 */
function BandsForm({ bands, onDone }: { bands: Band[]; onDone: () => void }) {
  const [rows, setRows] = useState(bands.map((b) => ({ minLevel: String(b.minLevel), goldPerLevel: String(b.goldPerLevel) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveBands(rows.map((r) => ({ minLevel: Number(r.minLevel), goldPerLevel: Number(r.goldPerLevel) })));
      onDone();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mk-form" onSubmit={submit}>
      {rows.map((r, i) => (
        <div className="mk-chips" key={i}>
          <span>Lv.{r.minLevel || "?"} 부터</span>
          <input
            className="mk-input"
            inputMode="numeric"
            value={r.minLevel}
            onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, minLevel: e.target.value.replace(/\D/g, "").slice(0, 2) } : x)))}
          />
          <input
            className="mk-input"
            inputMode="numeric"
            value={r.goldPerLevel}
            onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, goldPerLevel: e.target.value.replace(/\D/g, "").slice(0, 9) } : x)))}
          />
          <small>골드/레벨</small>
          <button type="button" className="pill" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="pill" onClick={() => setRows((rs) => [...rs, { minLevel: "", goldPerLevel: "" }])}>
        ＋ 구간 추가
      </button>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy}>
        {busy ? "저장하는 중…" : "보상 레벨대 저장"}
      </button>
    </form>
  );
}

/**
 * 2군 성장 퀘스트 (개발중, 제작자 2026-11-09): 2군 캐릭터마다 목표 레벨까지 올리면 레벨 하나마다 정해진 골드가 쌓인다.
 * '보상받기 신청'을 누르면 오피서에게 알림이 가고 게임 안에서 실제로 준다. 격주로 라운드를 새로 연다.
 */
export function Quest2Page() {
  const [reload, setReload] = useState(0);
  const { data, error } = useAsync(useCallback(() => fetchQuest2(), [reload]), "quest2");
  const [current, setCurrent] = useState<Quest2Data | null>(null);
  const [addingTarget, setAddingTarget] = useState(false);
  const [newRound, setNewRound] = useState(false);
  const [editBands, setEditBands] = useState(false);
  const [showRef, setShowRef] = useState(false);
  useEffect(() => {
    if (data) setCurrent(data);
  }, [data]);
  const anyOpen = addingTarget || newRound || editBands;
  useBackClose(anyOpen, () => {
    setAddingTarget(false);
    setNewRound(false);
    setEditBands(false);
  });

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (!current) return <Loading error={error} />;
  const { round, targets, bands, canManage } = current;

  return (
    <>
      <TopBar title="2군 성장 퀘스트" />
      <p className="growth-note">
        목표 레벨을 1레벨씩 올릴 때마다 보상이 쌓여요. 다 쌓이면 '보상받기 신청'을 눌러요 · 오피서가 게임 안에서 준 뒤 지급을 완료해요.
      </p>

      {!round ? (
        <div className="empty">지금 열린 라운드가 없어요{canManage ? " · 아래에서 새로 열어 보세요" : ""}.</div>
      ) : (
        <div className="panel">
          <p className="mk-meta">
            <b>{round.title}</b>
          </p>
          {round.note && <p className="mk-note">{round.note}</p>}
        </div>
      )}

      {canManage && (
        <div className="mk-cats">
          <button className={"pill mk-chip" + (addingTarget ? " pill-on" : "")} onClick={() => setAddingTarget((v) => !v)} disabled={!round}>
            ＋ 목표 추가
          </button>
          <button className={"pill mk-chip" + (newRound ? " pill-on" : "")} onClick={() => setNewRound((v) => !v)}>
            🆕 새 라운드 열기
          </button>
          <button className={"pill mk-chip" + (editBands ? " pill-on" : "")} onClick={() => setEditBands((v) => !v)}>
            ⚙️ 보상 레벨대
          </button>
          <button className={"pill mk-chip" + (showRef ? " pill-on" : "")} onClick={() => setShowRef((v) => !v)}>
            🎁 예시 보상 아이템
          </button>
          <button className="pill mk-chip" onClick={refresh} aria-label="새로 보기">
            ⟳
          </button>
        </div>
      )}

      {showRef && (
        <ul className="q2-ledger">
          {REWARD_ITEMS.map((it) => (
            <li key={it.name}>
              {it.name} {it.unit} <b>{goldWords(it.gold)} 골드</b>
            </li>
          ))}
        </ul>
      )}
      {addingTarget && <AddTargetForm onDone={() => { setAddingTarget(false); refresh(); }} />}
      {newRound && <NewRoundForm onDone={() => { setNewRound(false); refresh(); }} />}
      {editBands && <BandsForm bands={bands} onDone={() => { setEditBands(false); refresh(); }} />}

      {round && (
        <>
          {!targets.length ? (
            <div className="empty">아직 목표가 없어요.</div>
          ) : (
            <ul className="mk-list">
              {targets.map((t) => (
                <TargetRow key={t.id} t={t} bands={bands} canManage={canManage} onChanged={refresh} />
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
                <Nick name={c.nickname} /> Lv.{c.fromLevel} → Lv.{c.toLevel} {c.gold > 0 && <b>{goldWords(c.gold)} 골드</b>}
                {c.doping && " · 도핑 지원"}
                {c.note && ` · “${c.note}”`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
