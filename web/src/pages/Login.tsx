import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { changePassword, errorText, login, logout, requestSignup } from "../auth";
import type { Me } from "../auth";
import { HeroTitle, TopBar } from "../ui";
import { appMenu } from "../platform";

/** 길드원 로그인. 아이디는 길드마스터나 오피서가 만들어 주거나, 여기서 본인이 요청하고 운영진이 승낙한다 */
export function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await login(id.trim(), password));
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <main className="page">
        <header className="hero">
          <img className="hero-mark" src="guild-mark.png" alt="" width={72} height={72} />
          <div>
            <HeroTitle />
            <p className="hero-sub">길드원 로그인</p>
          </div>
        </header>
        {asking ? (
          <SignupForm onDone={(newId) => {
            setAsking(false);
            setId(newId);
          }} onCancel={() => setAsking(false)} />
        ) : (
        <form className="panel form" onSubmit={submit}>
          <label>
            아이디 (게임 닉네임)
            <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoCapitalize="off" />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn" disabled={busy || !id.trim() || !password}>
            {busy ? "확인하는 중…" : "로그인"}
          </button>
          {/* 아이디가 없으면 본인이 요청하고 길드마스터·오피서가 승낙한다 (제작자 요청 2026-11-01) */}
          <button type="button" className="btn btn-ghost" onClick={() => setAsking(true)}>
            아이디 생성 요청
          </button>
        </form>
        )}
        <p className="form-note">이 위키는 길드 Sapphire 길드원만 볼 수 있어요.</p>
        {appMenu && (
          // 시계는 위키 로그인과 상관없이 쓴다 (안드로이드 앱이 sapphire:// 주소를 받아 시계 설정을 연다)
          <div className="links">
            <a className="btn btn-ghost" href="sapphire://clock">⏰ 시계 설정</a>
          </div>
        )}
      </main>
    </div>
  );
}

/** 아이디 생성 요청: 게임 닉네임과 쓸 비밀번호. 운영진이 '길드원 관리'에서 승낙하면 그대로 로그인한다 */
function SignupForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) return setError("비밀번호 두 칸이 달라요");
    setBusy(true);
    setError("");
    try {
      await requestSignup(id.trim(), password);
      setSent(id.trim());
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="panel form">
        <h2 className="panel-title">요청했어요</h2>
        <p className="app-note">
          <b>{sent}</b> 님의 요청을 길드마스터·오피서가 승낙하면 이 닉네임과 비밀번호로 로그인할 수 있어요.
        </p>
        <button className="btn" onClick={() => onDone(sent)}>
          로그인 화면
        </button>
      </div>
    );
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <h2 className="panel-title">아이디 생성 요청</h2>
      <label>
        게임 닉네임
        <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoCapitalize="off" maxLength={20} />
      </label>
      <label>
        비밀번호 (6자 이상)
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        비밀번호 확인
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !id.trim() || password.length < 6 || !again}>
        {busy ? "보내는 중…" : "요청"}
      </button>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        취소
      </button>
    </form>
  );
}

/**
 * 로그인 바로 뒤의 화면(비밀번호 바꾸기, 직업과 레벨 정하기)에서 로그인 화면으로 돌아가는 길.
 * 화면의 '◀ 다른 아이디로 로그인'(history.back())과 폰의 뒤로 가기 모두: 기록을 하나 넣어 두고,
 * 뒤로 가서 그 기록이 빠지면(popstate) 로그아웃한 뒤 onBack 을 부른다.
 */
export function useBackToLogin(active: boolean, onBack?: () => void) {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    if (!active) return;
    history.pushState({ backToLogin: true }, "");
    const onPop = () => {
      void logout()
        .catch(() => undefined)
        .then(() => backRef.current?.());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [active]);
}

/**
 * 비밀번호 바꾸기. forced 면 임시 비밀번호(새 계정, 초기화)로 처음 로그인한 뒤라 이 화면만 보인다.
 * forced 일 때 '◀ 다른 아이디로 로그인'이나 폰의 뒤로 가기는 로그아웃하고 로그인 화면으로 돌아간다
 * (다른 아이디로 잘못 들어왔을 때). 비밀번호를 안 바꾸고 위키로 들어가는 길은 아니다.
 */
export function PasswordPage({ forced = false, onDone, onBack }: { forced?: boolean; onDone: () => void; onBack?: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackToLogin(forced, onBack);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 6) return setError("새 비밀번호는 6자 이상으로 해 주세요");
    if (next !== again) return setError("새 비밀번호 두 칸이 서로 달라요");
    setBusy(true);
    setError("");
    try {
      await changePassword(current, next);
      onDone();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="panel form" onSubmit={submit}>
      {forced && <p className="form-note">앞으로 쓸 비밀번호로 바꿔 주세요. 받은 임시 비밀번호로 들어왔다면 '지금 비밀번호'에 그걸 적어요.</p>}
      <label>
        지금 비밀번호
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </label>
      <label>
        새 비밀번호 (6자 이상)
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        새 비밀번호 한 번 더
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn" disabled={busy || !current || !next || !again}>
        {busy ? "바꾸는 중…" : "비밀번호 변경"}
      </button>
    </form>
  );

  if (!forced) {
    return (
      <>
        <TopBar title="비밀번호 변경" />
        {form}
      </>
    );
  }
  return (
    <div className="app">
      <main className="page">
        <header className="hero">
          <img className="hero-mark" src="guild-mark.png" alt="" width={72} height={72} />
          <div>
            <HeroTitle />
            <p className="hero-sub">비밀번호 변경</p>
          </div>
        </header>
        {form}
        {onBack && (
          <div className="links">
            <button type="button" className="btn btn-ghost" onClick={() => history.back()}>
              ◀ 다른 아이디로 로그인
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
