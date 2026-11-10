// 알림 설정 (제작자 2026-11-10 '알림 누르면 알림 설정이 맨 밑으로 가 있잖아, 아예 프로필 누르면 그 계정 설정 안으로 편입', 'UI 개선, 지금 버튼만 엄청 나열'):
// 내 정보 > 계정 > '알림 설정' 줄을 펼치면 보인다 (예전에는 알림함 맨 아래 단추 묶음). 맨 위 이 폰의 폰 알림 스위치, 그 아래 메뉴마다 묶어
// 종류마다 한 줄: 이름 · 알림함 스위치 · 폰 스위치. 알림함을 끄면 폰 알림도 안 가서 폰 스위치는 꺼진 모양으로 잠긴다. 저장은 누르는 대로 (서버 /api/alerts/prefs).
import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { ALERT_GROUPS, fetchAlerts, setAlertPref, setPushPref } from "../alerts";
import type { AlertKind } from "../alerts";
import { peekMemo, putMemo } from "../memo";
import { disablePush, enablePush, markPushOff, pushState, reportPush } from "../push";
import type { PushState } from "../push";

type Loaded = Awaited<ReturnType<typeof fetchAlerts>>;

/** 켜고 끄는 스위치 (도트 모양 네모 손잡이) */
function Switch({ on, disabled, label, onClick }: { on: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={"ns-sw" + (on ? " ns-sw-on" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      <i />
    </button>
  );
}

const PHONE_TEXT: Record<PushState, string> = {
  on: "이 폰으로 받아요",
  off: "이 폰은 꺼져 있어요",
  denied: "폰 설정에서 이 앱의 알림을 허용해 주세요",
  "ios-install": "아이폰은 홈 화면에 설치한 앱에서만 돼요",
  unsupported: "이 브라우저는 폰 알림을 못 받아요",
};

/** 이 폰의 폰 알림 (갤럭시·아이폰 알림으로 간략 내용과 함께). 이 폰에만 해당한다 */
function PhoneSwitch({ state, onState }: { state: PushState | null; onState: (s: PushState) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state) return null;
  const can = state === "on" || state === "off";
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      markPushOff(next !== "on"); // 직접 끈 폰은 앱을 열 때 저절로 다시 켜지 않는다
      onState(next);
      void reportPush("", true);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={"ns-phone" + (state === "on" ? " ns-phone-on" : "")}>
      <span className="ns-phone-text">
        <b>폰 알림</b>
        <small>{PHONE_TEXT[state]}</small>
        {error && <small className="form-error">{error}</small>}
      </span>
      {can && <Switch on={state === "on"} disabled={busy} label="이 폰의 폰 알림" onClick={() => void toggle()} />}
    </div>
  );
}

export function AlertSettings({ developer, preview }: { developer: boolean; preview: boolean }) {
  const had = peekMemo<Loaded>("alerts");
  const [prefs, setPrefs] = useState<Record<AlertKind, boolean> | null>(had?.prefs ?? null);
  const [pushPrefs, setPushPrefs] = useState<Partial<Record<AlertKind, boolean>>>(had?.pushPrefs ?? {});
  const [phone, setPhone] = useState<PushState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    pushState().then(setPhone, () => setPhone("unsupported"));
    fetchAlerts().then(
      (r) => {
        putMemo("alerts", r);
        setPrefs(r.prefs);
        setPushPrefs(r.pushPrefs ?? {});
      },
      (x) => setError(errorText(x)),
    );
  }, []);

  async function toggle(kind: AlertKind) {
    if (!prefs) return;
    const on = !prefs[kind];
    setPrefs({ ...prefs, [kind]: on });
    setError("");
    try {
      await setAlertPref(kind, on);
    } catch (x) {
      setPrefs((p) => (p ? { ...p, [kind]: !on } : p));
      setError(errorText(x));
    }
  }

  /** 그 종류의 폰 알림(팝업)만 켜고 끄기. 없으면 켜짐 */
  async function togglePush(kind: AlertKind) {
    const on = pushPrefs[kind] === false;
    setPushPrefs({ ...pushPrefs, [kind]: on });
    setError("");
    try {
      await setPushPref(kind, on);
    } catch (x) {
      setPushPrefs((p) => ({ ...p, [kind]: !on }));
      setError(errorText(x));
    }
  }

  const groups = ALERT_GROUPS.map((g) => ({ ...g, kinds: g.kinds.filter((k) => (!k.developer || developer) && (!k.preview || preview)) })).filter(
    (g) => g.kinds.length,
  );
  const phoneOn = phone === "on";
  return (
    <div className="ns">
      <PhoneSwitch state={phone} onState={setPhone} />
      {!prefs ? (
        error ? <p className="form-error">{error}</p> : <p className="ns-loading">불러오는 중…</p>
      ) : (
        <>
          <div className="ns-head" aria-hidden>
            <span />
            <span>알림함</span>
            <span>폰</span>
          </div>
          {groups.map((g) => {
            const count = g.kinds.filter((k) => prefs[k.kind]).length;
            return (
              <div key={g.menu} className="ns-group">
                <div className="ns-group-title">
                  {g.menu}
                  <small className={count === g.kinds.length ? "ns-all" : count === 0 ? "ns-none" : ""}>
                    {count}/{g.kinds.length}
                  </small>
                </div>
                {g.kinds.map((k) => {
                  const on = !!prefs[k.kind];
                  const push = on && pushPrefs[k.kind] !== false;
                  return (
                    <div key={k.kind} className={"ns-row" + (on ? "" : " ns-row-off")}>
                      <span className="ns-name">{k.name}</span>
                      <Switch on={on} label={`${g.menu} ${k.name} 알림함`} onClick={() => void toggle(k.kind)} />
                      <span className={"ns-push" + (phoneOn ? "" : " ns-push-dim")}>
                        <Switch on={push} disabled={!on} label={`${g.menu} ${k.name} 폰 알림`} onClick={() => void togglePush(k.kind)} />
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {error && <p className="form-error">{error}</p>}
        </>
      )}
    </div>
  );
}
