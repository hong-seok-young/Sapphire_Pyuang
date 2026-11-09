// 레벨·경험치 한 줄 입력 칸 (길드 랭킹 맨 아래 '성장반영'과 성장코인샵 성장 카드의 '성장반영'이 같이 쓴다. 저장하면 길드 랭킹과 같은 내 프로필에 들어간다)
import { useState } from "react";
import { errorText, saveMyProfile } from "../auth";
import type { ChangeKind, Me } from "../auth";
import { useBackClose } from "../backClose";

/**
 * 맨 아래 '성장반영' 칸 (제작자 2026-11-09 '랭킹에서 레벨업 버튼을 성장반영으로'): 레벨(− +)과 경험치를 랭킹에서 바로 적는다 (제작자 2026-11-09 '여기 자체에서 레벨업과 경치 둘 다 적게해줘, 내정보로 가게 하지말고').
 * 레벨을 올리면 경험치는 0% 로 바뀐다 (그 레벨에서 다시 시작하니까). 이미 적은 값을 바꾸면 내 정보처럼 '실제 성장 / 오타 수정'을 묻는다
 */
export function LevelEditor({
  me,
  onMe,
  onSaved,
  onClose,
}: {
  me: Me;
  onMe?: (p: Partial<Me>) => void;
  onSaved?: () => void;
  onClose: () => void;
}) {
  const cur = me.level ?? 1;
  const [level, setLevel] = useState(cur);
  const [text, setText] = useState(
    me.exp !== null ? (me.exp / 1000).toFixed(3) : "",
  );
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackClose(true, onClose);
  const validExp =
    text.trim() === "" || /^\d{1,2}(\.\d{1,3})?$/.test(text.trim());
  const exp = text.trim() === "" ? null : Math.round(Number(text) * 1000);
  const changed = level !== cur || exp !== me.exp;

  function step(d: number) {
    const next = Math.min(99, Math.max(1, level + d));
    setLevel(next);
    setAsking(false);
    // 레벨이 바뀌면 경험치는 그 레벨의 0% 부터 (원래 레벨로 돌아오면 원래 경험치)
    setText(
      next === cur
        ? me.exp !== null
          ? (me.exp / 1000).toFixed(3)
          : ""
        : "0.000",
    );
  }

  async function save(change?: ChangeKind) {
    if (!me.job || !me.guild || !validExp || !changed) return;
    // 이미 적은 값이 있었으면 실제로 오른 것인지 잘못 쓴 것을 고친 것인지 묻는다 (제작자 요청, 내 정보와 같다)
    if (!change && (me.level !== null || me.exp !== null)) {
      setAsking(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveMyProfile(me.job, level, exp, me.guild, change);
      onMe?.({ level, exp });
      onSaved?.();
      onClose();
    } catch (x) {
      setError(errorText(x));
      setAsking(false);
    } finally {
      setBusy(false);
    }
  }

  // 한 줄로 촘촘히 (제작자 2026-11-09 '성장치 적는 팝업 좀 더 콤팩트하게, 큼직하고 너저분해', '0퍼부터 이런 설명 빼고'): Lv − 36 + · 경험치 % · 저장 ✕.
  // 저장을 누르면 그 자리가 '실제 성장 / 오타 수정' 두 단추로 바뀐다
  return (
    <div className="rank-lv-edit">
      <span className="rank-lv-step">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={busy || level <= 1}
          aria-label="레벨 내리기"
        >
          −
        </button>
        <b key={level} className={level > cur ? "rank-lv-up" : ""}>
          <small>Lv</small>
          {level}
        </b>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={busy || level >= 99}
          aria-label="레벨 올리기"
        >
          +
        </button>
      </span>
      <span className="rank-lv-exp">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value.replace(/[^\d.]/g, "").slice(0, 6));
            setAsking(false);
          }}
          placeholder="0.000"
          aria-label="경험치 퍼센트"
        />
        <b>%</b>
      </span>
      <span className="rank-lv-actions">
        {asking ? (
          <>
            <button
              type="button"
              className="rank-lv-save"
              disabled={busy}
              onClick={() => save("grow")}
            >
              실제 성장
            </button>
            <button type="button" disabled={busy} onClick={() => save("fix")}>
              오타 수정
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rank-lv-save"
            disabled={busy || !validExp || !changed}
            onClick={() => save()}
          >
            {busy ? "…" : "저장"}
          </button>
        )}
        <button
          type="button"
          className="rank-lv-x"
          onClick={asking ? () => setAsking(false) : onClose}
          aria-label={asking ? "취소" : "닫기"}
        >
          ✕
        </button>
      </span>
      {error && <small className="rank-exp-error">{error}</small>}
    </div>
  );
}
