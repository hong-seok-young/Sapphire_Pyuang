// 오류·개선 접수 창 (제작자 2026-11-18): 메뉴 위 줄 경광등 단추(ui.tsx FixButton)로 연다.
// 지금 화면(메뉴·칸)과 기기·앱 판·직전 화면은 저절로, 종류 · 내용 · 스샷(사용자가 고른 그림만, 앱은 화면을 찍지 않는다)
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "../backClose";
import { FIX_KINDS, SHOTS_MAX, errorText, sendFix, whereNow } from "../fix";
import type { FixKind } from "../fix";
import { useNews } from "../news";
import { isFixStaff } from "../fixState";
import { inFloat } from "../platform";
import { PATCHES } from "../patchnotes";

const HINT: Record<FixKind, string> = {
  bug: "무엇이 틀렸거나 안 되나요? (예: 이 템 가격이 실제와 달라요, 누르면 화면이 멈춰요)",
  ux: "무엇이 불편한가요? (예: 단추가 너무 작아요, 찾기가 어려워요)",
  idea: "이런 게 있으면 좋겠어요 (예: 이 표에 옵션도 보이게)",
};

export default function FixReport({ onClose }: { onClose: () => void }) {
  const where = useMemo(whereNow, []);
  const [kind, setKind] = useState<FixKind>("bug");
  const [text, setText] = useState("");
  const [shots, setShots] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: number; failed: number } | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const news = useNews();
  const staff = isFixStaff();
  useBackClose(true, onClose);
  const urls = useMemo(() => shots.map((f) => URL.createObjectURL(f)), [shots]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  async function submit() {
    if (busy) return;
    if (text.trim().length < 2) {
      setError("내용을 적어 주세요");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDone(await sendFix(kind, text.trim(), shots, where));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // 화면을 먼저 옮기고 닫는다 (창 기록은 남았다가 뒤로 가다 닿으면 건너뛴다, backClose.ts)
  const go = (to: string) => {
    location.hash = to;
    onClose();
  };

  return createPortal(
    <div className="fx-back" onClick={onClose}>
      <div className="fx-sheet" role="dialog" aria-label="오류·개선 접수" onClick={(e) => e.stopPropagation()}>
        <div className="fx-head">
          <img className="px-icon fx-siren" src="/icons/report.png" width={22} height={22} alt="" />
          <b>오류·개선 접수</b>
          <button className="fx-mine" onClick={() => go(staff ? "#/gaps" : "#/fix")}>
            {staff ? "개선 접수" : "내 접수"} ›{!staff && news["fix.talk"] > 0 && <i className="news-badge in-news">{news["fix.talk"]}</i>}
          </button>
          <button className="fx-x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {done ? (
          <div className="fx-done">
            <p className="fx-done-big">접수했어요 ✓</p>
            <p className="muted">
              운영진이 확인하면 알림을 드려요.
              <br />내 접수에서 진행 상황과 대화를 볼 수 있어요.
            </p>
            {done.failed > 0 && <p className="form-error">스샷 {done.failed}장은 올리지 못했어요</p>}
            <div className="pill-row">
              <button className="pill" onClick={onClose}>
                닫기
              </button>
              <button className="pill pill-on" onClick={() => go(`#/fix?r=${done.id}`)}>
                내 접수 보기
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="fx-where">
              <span className="fx-where-k">어디서</span>
              <span className="fx-where-v">{where.menu}</span>
            </div>
            <div className="pill-row fx-kinds">
              {(Object.keys(FIX_KINDS) as FixKind[]).map((k) => (
                <button key={k} className={"pill" + (kind === k ? " pill-on" : "")} onClick={() => setKind(k)}>
                  {FIX_KINDS[k]}
                </button>
              ))}
            </div>
            <textarea className="fx-text" value={text} maxLength={2000} placeholder={HINT[kind]} onChange={(e) => setText(e.target.value)} />
            {!inFloat && (
              <div className="fx-shots">
                {urls.map((u, i) => (
                  <span key={u} className="fx-shot">
                    <img src={u} alt="" />
                    <button onClick={() => setShots(shots.filter((_, j) => j !== i))} aria-label="스샷 빼기">
                      ✕
                    </button>
                  </span>
                ))}
                {shots.length < SHOTS_MAX && (
                  <button className="fx-add" onClick={() => pick.current?.click()}>
                    + 스샷
                    <small>
                      {shots.length}/{SHOTS_MAX}
                    </small>
                  </button>
                )}
                <input
                  ref={pick}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith("image/"));
                    setShots([...shots, ...files].slice(0, SHOTS_MAX));
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            <p className="fx-auto">같이 보내요 · 화면 주소 · 기기 · 앱 v{PATCHES[0]?.version ?? ""} · 직전 화면</p>
            {error && <p className="form-error">{error}</p>}
            <button className="btn fx-send" disabled={busy} onClick={submit}>
              {busy ? "보내는 중…" : "접수하기"}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
