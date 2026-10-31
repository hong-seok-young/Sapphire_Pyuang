import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ROLE_NAME, RANK, canManage, createAccount, deleteAccount, errorText, listAccounts, positionOf, requirePasswordChange, resetPassword, setRole,
} from "../auth";
import type { Account, Me, Role } from "../auth";
import { GUILD_NAME, GUILD_TIER, JOB_NAME, avatarUrl, deleteAvatarOf, saveProfileOf } from "../auth";
import { JobEmblem } from "../emblems";
import { ProfileForm } from "./Profile";
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
 * 앱개발자: 길드마스터까지 모두. 처음 비밀번호는 만들 때 한 번만 보여 준다.
 * '처음 비밀번호'를 정하면(예: 123123) 새 계정과 비밀번호 초기화에 그걸 쓰고, 비우면 임시 비밀번호를 만든다.
 * 어느 쪽이든 그 사람은 처음 로그인할 때 비밀번호를 바꾼다.
 * '비밀번호 바꾸게 하기'는 지금 비밀번호와 로그인은 그대로 두고, 그 사람이 다음에 들어올 때 비밀번호 바꾸기 화면을 한 번 보게 한다.
 * 오피서 이상은 누구든 잘못 고른 직업과 레벨을 고치고, 캐릭터가 아닌 사진이 올라왔으면 내릴 수 있다 (길드 랭킹).
 * 경험치 %는 본인만 아는 값이라 여기에 보이지 않는다.
 */
export function AdminPage({ me }: { me: Me }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ title: string; id: string; password: string } | null>(null);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [firstPw, setFirstPw] = useState("");
  const [busy, setBusy] = useState(false);

  const creatable = ASSIGNABLE.filter((r) => canManage(me.role, r));

  const reload = useCallback(() => {
    listAccounts().then(setAccounts, (e) => setError(errorText(e)));
  }, []);
  useEffect(reload, [reload]);

  /** 정한 처음 비밀번호 (비웠으면 undefined: 서버가 임시 비밀번호를 만든다) */
  function chosenPassword(): string | undefined {
    if (firstPw && firstPw.length < 6) throw new Error("처음 비밀번호는 6자 이상으로 해 주세요");
    return firstPw || undefined;
  }

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
      const made = await createAccount(id, newRole, chosenPassword());
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
            처음 비밀번호 <b className="temp-pw">{notice.password}</b>
          </p>
          <p className="form-note">
            이 비밀번호를 본인에게 따로 알려 주세요. 처음 로그인하면 자기 비밀번호로 바꾸게 돼요.
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
        <label>
          처음 비밀번호 (비워 두면 자동으로 만들어요)
          <input value={firstPw} onChange={(e) => setFirstPw(e.target.value)} autoCapitalize="off" autoComplete="off" />
        </label>
        <p className="form-note">
          정하면 새 계정과 비밀번호 초기화에 이 비밀번호를 써요 (6자 이상). 받은 사람은 처음 로그인할 때 자기 비밀번호로 바꿔요.
        </p>
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
                  const r = await resetPassword(a.id, chosenPassword());
                  setNotice({ title: "비밀번호를 초기화했어요", id: r.id, password: r.tempPassword });
                })
              }
              onMustChange={() => run(async () => void (await requirePasswordChange(a.id)))}
              onRole={(role) => run(async () => void (await setRole(a.id, role)))}
              onDelete={() => run(async () => void (await deleteAccount(a.id)))}
              onChanged={reload}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function AccountRow({
  account, me, busy, onReset, onMustChange, onRole, onDelete, onChanged,
}: {
  account: Account;
  me: Me;
  busy: boolean;
  onReset: () => void;
  onMustChange: () => void;
  onRole: (role: Role) => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const manageable = account.id !== me.id && canManage(me.role, account.role);
  // 역할 바꾸기는 길드마스터 이상만 (오피서 임명/해제)
  const roleTargets = RANK[me.role] >= 2 ? ASSIGNABLE.filter((r) => r !== account.role && canManage(me.role, r)) : [];

  return (
    <li className="panel account">
      <div className="account-head">
        {account.job && account.level ? <JobEmblem job={account.job} level={account.level} size={30} /> : null}
        {account.avatar && <img className="account-avatar" src={avatarUrl(account.id, account.avatar)} alt="" />}
        <span className="account-id">{account.id}</span>
        {account.mustChange && <span className="role-badge muted">비밀번호 바꾸기 전</span>}
        {/* 앱개발자는 길드 직책이 아니라서 길드원으로 보이고, 앱 관리 권한은 따로 적는다 */}
        <span className="role-badge">{ROLE_NAME[positionOf(account.role)]}</span>
        {account.role === "developer" && <span className="role-badge muted">앱 관리</span>}
      </div>
      <div className="account-sub">
        <span className="muted">
          {account.guild ? `${GUILD_TIER[account.guild]} ${GUILD_NAME[account.guild]} · ` : "길드 안 정함 · "}
          {account.job && account.level ? `Lv.${account.level} ${JOB_NAME[account.job]}` : "직업, 레벨 아직 안 정함"}
        </span>
        <span className="account-sub-actions">
          {account.avatar && (
            <button
              className="pill"
              disabled={busy}
              onClick={async () => {
                setPhotoError("");
                try {
                  await deleteAvatarOf(account.id);
                  onChanged();
                } catch (x) {
                  setPhotoError(errorText(x));
                }
              }}
            >
              사진 내리기
            </button>
          )}
          <button className="pill" disabled={busy} onClick={() => setEditing((e) => !e)}>
            {editing ? "닫기" : "레벨·직업 고치기"}
          </button>
        </span>
      </div>
      {photoError && <p className="form-error">{photoError}</p>}
      {editing && (
        <ProfileForm
          guild={account.guild}
          job={account.job}
          level={account.level}
          submitLabel={`${account.id} 저장`}
          onSave={async (job, level, _exp, guild) => {
            await saveProfileOf(account.id, job, level, guild);
            setEditing(false);
            onChanged();
          }}
        />
      )}
      {manageable && (
        <div className="account-actions">
          {roleTargets.map((r) => (
            <button key={r} className="pill" disabled={busy} onClick={() => onRole(r)}>
              {toRoleText(ROLE_NAME[r])}
            </button>
          ))}
          <button className="pill" disabled={busy} onClick={onReset}>비밀번호 초기화</button>
          {!account.mustChange && (
            <button className="pill" disabled={busy} onClick={onMustChange}>
              비밀번호 바꾸게 하기
            </button>
          )}
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
