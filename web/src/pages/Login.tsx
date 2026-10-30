import { useState } from "react";
import type { FormEvent } from "react";
import { changePassword, errorText, login } from "../auth";
import type { Me } from "../auth";
import { TopBar } from "../ui";

/** 길드원 로그인. 아이디는 길드마스터나 오피서가 만들어 준다 */
export function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
          <img className="hero-mark" src="icon-192.png" alt="" width={72} height={72} />
          <div>
            <h1 className="hero-title">Sapphire</h1>
            <p className="hero-sub">길드원 로그인</p>
          </div>
        </header>
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
        </form>
        <p className="form-note">
          이 위키는 길드 Sapphire 길드원만 볼 수 있어요. 아이디는 길드마스터나 오피서에게 받으세요.
        </p>
      </main>
    </div>
  );
}

/** 비밀번호 바꾸기. forced 면 임시 비밀번호로 처음 로그인한 뒤라 이 화면만 보인다 */
export function PasswordPage({ forced = false, onDone }: { forced?: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      {forced && <p className="form-note">임시 비밀번호로 들어왔어요. 앞으로 쓸 비밀번호로 바꿔 주세요.</p>}
      <label>
        {forced ? "임시 비밀번호" : "지금 비밀번호"}
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
        {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </button>
    </form>
  );

  if (!forced) {
    return (
      <>
        <TopBar title="비밀번호 바꾸기" />
        {form}
      </>
    );
  }
  return (
    <div className="app">
      <main className="page">
        <header className="hero">
          <img className="hero-mark" src="icon-192.png" alt="" width={72} height={72} />
          <div>
            <h1 className="hero-title">Sapphire</h1>
            <p className="hero-sub">비밀번호 바꾸기</p>
          </div>
        </header>
        {form}
      </main>
    </div>
  );
}
