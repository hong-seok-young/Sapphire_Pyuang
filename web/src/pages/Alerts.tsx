import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { ALERT_GROUPS, clearUnread, fetchAlerts, readAllAlerts, setAlertPref } from "../alerts";
import type { Alert, AlertKind } from "../alerts";
import { ago } from "../market";
import { Loading, TopBar } from "../ui";

/** 알림함 (제작자 요청): 나와 관련된 일 목록. 열면 모두 읽음이 된다. 아래에서 메뉴별로 켜고 끈다 */
export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [prefs, setPrefs] = useState<Record<AlertKind, boolean> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAlerts().then(
      (r) => {
        setAlerts(r.alerts);
        setPrefs(r.prefs);
        if (r.unread > 0) readAllAlerts().then(clearUnread, () => undefined);
      },
      (x) => setError(errorText(x)),
    );
  }, []);

  async function toggle(kind: AlertKind) {
    if (!prefs) return;
    const on = !prefs[kind];
    setPrefs({ ...prefs, [kind]: on });
    try {
      await setAlertPref(kind, on);
    } catch (x) {
      setPrefs({ ...prefs, [kind]: !on });
      setError(errorText(x));
    }
  }

  return (
    <>
      <TopBar title="알림" />
      {!alerts ? (
        <Loading error={error} />
      ) : alerts.length === 0 ? (
        <div className="empty">알림이 없어요.</div>
      ) : (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id} className={a.readAt ? "" : "alert-new"}>
              <a href={a.link ?? "#/alerts"}>
                <span>{a.text}</span>
                <small>{ago(a.at)}</small>
              </a>
            </li>
          ))}
        </ul>
      )}
      {prefs && (
        <section className="panel alert-prefs">
          <h2 className="panel-title">알림 설정</h2>
          {ALERT_GROUPS.map((g) => (
            <div key={g.menu} className="alert-pref-row">
              <span>{g.menu}</span>
              <div className="mk-chips">
                {g.kinds.map((k) => (
                  <button key={k.kind} className={"pill" + (prefs[k.kind] ? " pill-on" : "")} onClick={() => toggle(k.kind)}>
                    {k.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      {error && alerts && <p className="form-error">{error}</p>}
    </>
  );
}
