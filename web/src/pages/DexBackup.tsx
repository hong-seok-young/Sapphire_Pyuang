// 도감 계산기 완료 체크 백업 (제작자 2026-11-19 '섬예님이 어디든 접속하면 안내 뜨게', '체크한 기기로 들어오면 모두 저절로 백업': server/dexBackup.ts)
// 모든 길드원: 이 기기에 서버 저장 전에 체크한 기록(고친 때 없음)이 있으면 어느 화면이든 들어오자마자 서버 것과 합쳐 올린다 (안내 없이, 한 번).
// 백업을 기다리는 명단의 사람(/api/me 의 dexBackupAsk)은 올린 뒤 '백업했어요' 띠, 이 기기에 기록이 없으면 'PC로 한 번만 열어 주세요' 안내 (열 때마다 한 번).
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
    let dead = false;
    const names = localDone(me.id);
    let at0 = 0;
    try {
      at0 = Number(localStorage.getItem(`sapphire.dex.doneAt.${me.id}`)) || 0;
    } catch {
      /* 못 읽으면 0 */
    }
    if (names.length && !at0) {
      // 서버 저장 전 기록: 서버 것과 합쳐 올린다 (다른 기기 체크를 지우지 않게)
      (async () => {
        const srv = await api<{ names: string[]; at: number }>("/api/dex/done").catch(() => null);
        if (!srv || dead) return;
        const all = new Set([...srv.names, ...names]);
        let at = srv.at;
        if (all.size > srv.names.length) {
          at = Date.now();
          const ok = await api("/api/dex/done", "PUT", { names: [...all], at }).then(() => true).catch(() => false);
          if (!ok) return;
        }
        try {
          localStorage.setItem(`sapphire.dex.done.${me.id}`, JSON.stringify([...all]));
          localStorage.setItem(`sapphire.dex.doneAt.${me.id}`, String(at || Date.now()));
        } catch {
          /* 저장소가 막혀도 서버에는 올라갔다 */
        }
        if (dead || !me.dexBackupAsk) return;
        setSaved(all.size);
        window.setTimeout(() => setSaved(0), 5000);
      })();
      return () => {
        dead = true;
      };
    }
    if (!me.dexBackupAsk || names.length) return;
    try {
      if (sessionStorage.getItem(SEEN)) return;
    } catch {
      /* 못 읽으면 그냥 띄운다 */
    }
    const t = window.setTimeout(() => {
      if (!tutorialOpen()) setAsk(true);
    }, 1500);
    return () => {
      dead = true;
      clearTimeout(t);
    };
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
