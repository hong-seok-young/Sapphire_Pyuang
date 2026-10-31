import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { ALERT_GROUPS, clearUnread, fetchAlerts, readAllAlerts, setAlertPref, setPushPref } from "../alerts";
import { disablePush, enablePush, markPushOff, pushState } from "../push";
import type { PushState } from "../push";
import type { Alert, AlertKind } from "../alerts";
import { ago } from "../market";
import { Loading, TopBar } from "../ui";

/** 알림함 (제작자 요청): 나와 관련된 일 목록. 열면 모두 읽음이 된다. 아래에서 메뉴별로 켜고 끈다 */
export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [prefs, setPrefs] = useState<Record<AlertKind, boolean> | null>(null);
  const [pushPrefs, setPushPrefs] = useState<Partial<Record<AlertKind, boolean>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAlerts().then(
      (r) => {
        setAlerts(r.alerts);
        setPrefs(r.prefs);
        setPushPrefs(r.pushPrefs ?? {});
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

  /** 폰 알림(팝업)만 켜고 끄기. 없으면 켜짐 */
  async function togglePush(kind: AlertKind) {
    const on = pushPrefs[kind] === false;
    setPushPrefs({ ...pushPrefs, [kind]: on });
    try {
      await setPushPref(kind, on);
    } catch (x) {
      setPushPrefs({ ...pushPrefs, [kind]: !on });
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
                <span className="alert-text">{a.text}</span>
                <small>{ago(a.at)}</small>
              </a>
            </li>
          ))}
        </ul>
      )}
      {prefs && (
        <section className="panel alert-prefs">
          <h2 className="panel-title">알림 설정</h2>
          <PhonePush />
          {ALERT_GROUPS.map((g) => (
            <div key={g.menu} className="alert-pref-row">
              <span>{g.menu}</span>
              <div className="mk-chips">
                {/* 앞은 앱 알림함, 옆 📱 는 폰 알림(팝업) (제작자 요청: 폰 팝업은 따로) */}
                {g.kinds.map((k) => (
                  <span key={k.kind} className="pref-pair">
                    <button className={"pill" + (prefs[k.kind] ? " pill-on" : "")} onClick={() => toggle(k.kind)}>
                      {k.name}
                    </button>
                    <button
                      className={"pill pref-push" + (prefs[k.kind] && pushPrefs[k.kind] !== false ? " pill-on" : "")}
                      disabled={!prefs[k.kind]}
                      onClick={() => togglePush(k.kind)}
                      aria-label={`${k.name} 폰 알림`}
                    >
                      📱
                    </button>
                  </span>
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

/** 폰 자체 알림 켜고 끄기 (제작자 요청: 갤럭시·아이폰 알림으로 간략 내용과 함께). 이 폰에만 해당한다 */
function PhonePush() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      markPushOff(next !== "on"); // 직접 끈 폰은 앱을 열 때 저절로 다시 켜지 않는다
      setState(next);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  if (!state) return null;
  return (
    <div className="alert-pref-group phone-push">
      <b>📱 폰 알림</b>
      {state === "on" || state === "off" ? (
        <button className={"pill" + (state === "on" ? " pill-on" : "")} disabled={busy} onClick={toggle}>
          {state === "on" ? "켜짐" : "꺼짐"}
        </button>
      ) : (
        <small>
          {state === "ios-install"
            ? "아이폰은 홈 화면에 설치한 앱에서만 돼요"
            : state === "denied"
              ? "폰 설정에서 이 앱의 알림을 허용해 주세요"
              : "이 브라우저는 폰 알림을 못 받아요"}
        </small>
      )}
      {error && <small className="form-error">{error}</small>}
    </div>
  );
}

