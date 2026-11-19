// 도감 계산기 완료 체크 백업 (제작자 2026-11-19 '섬예님이 어디든 접속하면 안내 뜨게'. server/dexBackup.ts)
// 백업을 기다리는 사람(/api/me 의 dexBackupAsk)이 어느 화면으로 들어오든:
// - 이 기기에 체크해 둔 기록이 있으면(체크한 PC) 그 자리에서 서버로 올리고 '백업했어요'를 잠깐 보인다.
// - 없으면 '체크해 둔 PC로 한 번만 열어 주세요' 안내 (열 때마다 한 번, 백업되면 더 안 뜬다).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../auth";
import type { Me } from "../auth";
import { tutorialOpen } from "../tutorialState";
import { useBackClose } from "../backClose";

const SEEN = "sapphire.dexAsk.seen";

function localDone(id: string): string[] {
  try {
    const raw = localStorage.getItem(`sapphire.dex.done.${id}`);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function DexBackupNotice({ me }: { me: Me }) {
  const [ask, setAsk] = useState(false);
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    if (!me.dexBackupAsk) return;
    const names = localDone(me.id);
    if (names.length) {
      const at = Date.now();
      api("/api/dex/done", "PUT", { names, at })
        .then(() => {
          try {
            localStorage.setItem(`sapphire.dex.doneAt.${me.id}`, String(at));
          } catch {
            /* 저장소가 막혀도 서버에는 올라갔다 */
          }
          setSaved(names.length);
          window.setTimeout(() => setSaved(0), 5000);
        })
        .catch(() => undefined);
      return;
    }
    try {
      if (sessionStorage.getItem(SEEN)) return;
    } catch {
      /* 못 읽으면 그냥 띄운다 */
    }
    const t = window.setTimeout(() => {
      if (!tutorialOpen()) setAsk(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [me.id, me.dexBackupAsk]);
  const close = () => {
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {
      /* 이번만 닫힘 */
    }
    setAsk(false);
  };
  useBackClose(ask, close);
  if (saved)
    return createPortal(
      <div className="dexbk-toast" role="status" onClick={() => setSaved(0)}>
        도감 완료 체크 {saved.toLocaleString()}개를 백업했어요 · 이제 폰에서도 같이 보여요
      </div>,
      document.body,
    );
  if (!ask) return null;
  return createPortal(
    <div className="rn-back" onClick={close}>
      <div className="rn-card dexbk" role="dialog" aria-modal="true" aria-label="도감 계산기 백업" onClick={(e) => e.stopPropagation()}>
        <p className="rn-say">PC로 도감 계산기를 한 번만 열어 주세요</p>
        <p className="bg-notice-sub">
          완료 체크해 두신 기록이 그 PC에만 있어요. 그 PC로 이 사이트를 한 번 열면 저절로 백업돼서 폰에서도 같이 보여요.
        </p>
        <div className="pill-row">
          <button type="button" className="pill pill-on" onClick={close}>
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
