import { peekMemo, putMemo } from "../memo";
import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { clearUnread, fetchAlerts, readAllAlerts } from "../alerts";
import type { Alert } from "../alerts";
import { ago } from "../market";
import { Loading, TopBar } from "../ui";

/**
 * 알림함 (제작자 요청): 나와 관련된 일 목록. 열면 모두 읽음이 된다.
 * 메뉴별 켜고 끄기는 내 정보 > 계정 > 알림 설정으로 옮겼다 (제작자 2026-11-10 '알림 설정을 프로필 계정 설정 안으로', pages/AlertSettings.tsx). 맨 위 '알림 설정 ›' 로 간다
 */
export function AlertsPage() {
  // 이번에 연 동안 본 알림은 새로 받는 동안 바로 보인다 (src/memo.ts)
  const had = peekMemo<Awaited<ReturnType<typeof fetchAlerts>>>("alerts");
  const [alerts, setAlerts] = useState<Alert[] | null>(had?.alerts ?? null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAlerts().then(
      (r) => {
        putMemo("alerts", r);
        setAlerts(r.alerts);
        if (r.unread > 0) readAllAlerts().then(clearUnread, () => undefined);
      },
      (x) => setError(errorText(x)),
    );
  }, []);

  return (
    <>
      <TopBar title="알림" />
      <div className="alert-tools">
        <a className="alert-settings-link" href="#/me?open=alerts">
          알림 설정 <span aria-hidden>›</span>
        </a>
      </div>
      {!alerts ? (
        <Loading error={error} />
      ) : alerts.length === 0 ? (
        <div className="empty">알림이 없어요.</div>
      ) : (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id} className={a.readAt ? "" : "alert-new"}>
              <a href={a.link ?? "#/alerts"}>
                <span className="alert-text">
                  {/* 묶은 부캐의 알림: 어느 캐릭터 것인지 (누르면 그 캐릭터로 바꿔서 연다) */}
                  {a.who && <span className="alert-who">{a.who}</span>}
                  {a.text}
                </span>
                <small>{ago(a.at)}</small>
              </a>
            </li>
          ))}
        </ul>
      )}
      {error && alerts && <p className="form-error">{error}</p>}
    </>
  );
}
