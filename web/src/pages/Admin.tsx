import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ROLE_NAME, RANK, canManage, createAccount, deleteAccount, errorText, listAccounts, resetPassword, setRole,
} from "../auth";
import type { Account, Me, Role } from "../auth";
import { Loading, Panel, TopBar } from "../ui";

/** 이 역할로 만들거나 바꿀 수 있는 역할 (높은 것부터) */
const ASSIGNABLE: Role[] = ["master", "officer", "member"];

/** '오피서로', '길드원으로' 처럼 받침에 맞는 조사를 붙인다 (받침이 없거나 ㄹ 받침이면 '로') */
function toRoleText(name: string): string {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  const jong = code >= 0 && code <= 11171 ? code % 28 : 0;
  return name + (jong === 0 || jong === 8 ? "로" : "으로");
}

/**
 * 길드원 관리 (오피서 이상).
 * 오피서: 길드원 계정 만들기/지우기/비밀번호 초기화. 길드마스터: 거기에 오피서 임명/해제.
 * 앱개발자: 길드마스터까지 모두. 임시 비밀번호는 만들 때 한 번만 보여 준다.
 */
export function AdminPage({ me }: { me: Me }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ title: string; id: string; password: string } | null>(null);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);

  const creatable = ASSIGNABLE.filter((r) => canManage(me.role, r));

  const reload = useCallback(() => {
    listAccounts().then(setAccounts, (e) => setError(errorText(e)));
  }, []);
  useEffect(reload, [reload]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    const id = newId.trim();
    run(async () => {
      const made = await createAccount(id, newRole);
      setNotice({ title: `${ROLE_NAME[made.role]} 계정을 만들었어요`, id: made.id, password: made.tempPassword });
      setNewId("");
    });
  }

  return (
    <>
      <TopBar title="길드원 관리" />
      {notice && (
        <Panel title={notice.title} className="notice">
          <p className="app-note">
            아이디 <b>{notice.id}</b>
            <br />
            임시 비밀번호 <b className="temp-pw">{notice.password}</b>
          </p>
          <p className="form-note">
            이 비밀번호를 본인에게 따로 알려 주세요. 처음 로그인하면 자기 비밀번호로 바꾸게 돼요. 이 안내를 닫으면 다시 볼 수 없어요.
          </p>
          <div className="links">
            <button className="btn btn-ghost" onClick={() => setNotice(null)}>확인했어요</button>
          </div>
        </Panel>
      )}

      <form className="panel form" onSubmit={create}>
        <h2 className="panel-title">계정 만들기</h2>
        <label>
          아이디 (게임 닉네임)
          <input value={newId} onChange={(e) => setNewId(e.target.value)} autoCapitalize="off" />
        </label>
        {creatable.length > 1 && (
          <div className="role-pick">
            {creatable.map((r) => (
              <button key={r} type="button" className={"pill" + (newRole === r ? " pill-on" : "")} onClick={() => setNewRole(r)}>
                {ROLE_NAME[r]}
              </button>
            ))}
          </div>
        )}
        <button className="btn" disabled={busy || !newId.trim()}>
          {ROLE_NAME[creatable.includes(newRole) ? newRole : "member"]} 계정 만들기
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}

      {!accounts ? (
        <Loading />
      ) : (
        <ul className="list">
          {accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              me={me}
              busy={busy}
              onReset={() =>
                run(async () => {
                  const r = await resetPassword(a.id);
                  setNotice({ title: "비밀번호를 초기화했어요", id: r.id, password: r.tempPassword });
                })
              }
              onRole={(role) => run(async () => void (await setRole(a.id, role)))}
              onDelete={() => run(async () => void (await deleteAccount(a.id)))}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function AccountRow({
  account, me, busy, onReset, onRole, onDelete,
}: {
  account: Account;
  me: Me;
  busy: boolean;
  onReset: () => void;
  onRole: (role: Role) => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const manageable = account.id !== me.id && canManage(me.role, account.role);
  // 역할 바꾸기는 길드마스터 이상만 (오피서 임명/해제)
  const roleTargets = RANK[me.role] >= 2 ? ASSIGNABLE.filter((r) => r !== account.role && canManage(me.role, r)) : [];

  return (
    <li className="panel account">
      <div className="account-head">
        <span className="account-id">{account.id}</span>
        {account.mustChange && <span className="role-badge muted">임시 비밀번호</span>}
        <span className="role-badge">{ROLE_NAME[account.role]}</span>
      </div>
      {manageable && (
        <div className="account-actions">
          {roleTargets.map((r) => (
            <button key={r} className="pill" disabled={busy} onClick={() => onRole(r)}>
              {toRoleText(ROLE_NAME[r])}
            </button>
          ))}
          <button className="pill" disabled={busy} onClick={onReset}>비밀번호 초기화</button>
          {confirmDelete ? (
            <>
              <button className="pill pill-danger" disabled={busy} onClick={onDelete}>정말 삭제</button>
              <button className="pill" onClick={() => setConfirmDelete(false)}>취소</button>
            </>
          ) : (
            <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>계정 삭제</button>
          )}
        </div>
      )}
    </li>
  );
}
