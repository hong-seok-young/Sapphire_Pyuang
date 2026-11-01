import { useCallback, useEffect, useState } from "react";
import { useEntryState } from "../router";
import type { FormEvent } from "react";
import {
  RANK, ROLE_NAME, canManage, createAccount, decideSignup, deleteAccount, errorText, linkAccounts, listAccounts, listSignups, positionOf, renameAccount,
  resetPassword, setMainCharacter, setRole, unlinkAccount,
} from "../auth";
import type { SignupRequest } from "../auth";
import type { Account, Me, Role } from "../auth";
import { GUILD_NAME, GUILD_TIER, JOB_NAME, clearLevelBadge, deleteAvatarOf, deleteLevelLog, expText, fetchLevelLog, saveProfileOf, setHighSpec } from "../auth";
import type { LevelLogEntry } from "../auth";
import { JobEmblem } from "../emblems";
import { refreshMe } from "../characters";
import { ProfileForm } from "./Profile";
import { Loading, Panel, TopBar } from "../ui";

/** 새 계정과 비밀번호 초기화의 처음 비밀번호 (제작자 요청: 칸 없이 늘 123123). 다음 로그인 때 바꾸게 한다 */
const FIRST_PASSWORD = "123123";

/** 길드원이 몇백 명이어도 처음엔 이만큼만 그리고 '더 보기' */
const PAGE_SIZE = 50;

type FilterKey = "all" | "main" | "second" | "staff" | "pw" | "noprofile";
/** 목록 거르기 칩 (제작자 요청: 길드원이 많아지면 찾기) */
const FILTERS: { key: FilterKey; label: string; test: (a: Account) => boolean }[] = [
  { key: "all", label: "전체", test: () => true },
  { key: "main", label: "1군", test: (a) => a.guild === "main" },
  { key: "second", label: "2군", test: (a) => a.guild === "second" },
  { key: "staff", label: "오피서 이상", test: (a) => a.role === "master" || a.role === "officer" },
  { key: "pw", label: "비밀번호 바꾸기 전", test: (a) => a.mustChange },
  { key: "noprofile", label: "직업·레벨 안 정함", test: (a) => !a.job || !a.level || !a.guild },
  // 폰 알림 켬/꺼짐은 보이지 않는다 (제작자 요청 2026-11-01: 제대로 모이지 않는 것 같다)
];

/** 이 역할로 만들거나 바꿀 수 있는 역할 (높은 것부터) */
const ASSIGNABLE: Role[] = ["master", "officer", "member"];


/**
 * 길드원 관리 (오피서 이상).
 * 길드마스터와 오피서: 오피서와 길드원 계정 만들기/지우기/비밀번호 초기화, 오피서 임명/해제 (제작자 요청 2026-11-01: 둘이 같은 권한).
 * 앱개발자: 길드마스터까지 모두. 처음 비밀번호는 만들 때 한 번만 보여 준다.
 * '처음 비밀번호'를 정하면(예: 123123) 새 계정과 비밀번호 초기화에 그걸 쓰고, 비우면 임시 비밀번호를 만든다.
 * 어느 쪽이든 그 사람은 처음 로그인할 때 비밀번호를 바꾼다.
 * 비밀번호 초기화는 '처음 비밀번호'를 비워 두면 123123 으로 한다 (제작자 요청). 그 사람은 다음 로그인 때 바꾼다.
 * 오피서 이상은 누구든 잘못 고른 직업과 레벨을 고치고, 캐릭터가 아닌 사진이 올라왔으면 내릴 수 있다 (길드 랭킹).
 * 경험치 %는 랭킹에서 모두에게 보인다 (제작자 요청).
 */
export function AdminPage({ me }: { me: Me }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ title: string; id: string; password: string } | null>(null);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);

  const creatable = ASSIGNABLE.filter((r) => canManage(me.role, r));
  const [query, setQuery] = useEntryState("query", "");
  const [filter, setFilter] = useEntryState<FilterKey>("filter", "all");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const q = query.replace(/\s+/g, "").toLowerCase();
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const shown = (accounts ?? []).filter((a) => test(a) && (!q || a.id.replace(/\s+/g, "").toLowerCase().includes(q)));
  // 부캐 묶기: 부캐는 본캐 바로 아래에 (본캐가 목록에 있을 때)
  const altsOf = new Map<string, Account[]>();
  for (const a of accounts ?? []) if (a.mainId) altsOf.set(a.mainId, [...(altsOf.get(a.mainId) ?? []), a]);
  const shownIds = new Set(shown.map((a) => a.id));
  const ordered: Account[] = [];
  for (const a of shown) {
    if (a.mainId && shownIds.has(a.mainId)) continue;
    ordered.push(a);
    for (const s of altsOf.get(a.id) ?? []) if (shownIds.has(s.id)) ordered.push(s);
  }

  const [signups, setSignups] = useState<SignupRequest[]>([]);
  const reload = useCallback(
    () =>
      Promise.all([
        listAccounts().then(setAccounts, (e) => setError(errorText(e))),
        listSignups().then(setSignups, () => setSignups([])),
      ]).then(() => undefined),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
      refreshMe(); // 내 캐릭터를 묶거나 뗐을 수도 있다 (👤, 내 캐릭터 목록을 맞춘다)
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
      const made = await createAccount(id, newRole, FIRST_PASSWORD);
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
            <button className="btn btn-ghost" onClick={() => setNotice(null)}>확인</button>
          </div>
        </Panel>
      )}

      {/* 로그인 화면에서 본인이 보낸 아이디 생성 요청 (제작자 요청 2026-11-01). 승낙하면 그 비밀번호로 길드원 계정이 생긴다 */}
      {signups.length > 0 && (
        <section className="panel signup-requests">
          <h2 className="panel-title">아이디 생성 요청 {signups.length}</h2>
          {signups.map((s) => (
            <div key={s.id} className="signup-row">
              <span className="signup-who">
                <b>{s.id}</b>
                {/* '내 정보'의 캐릭터 추가 요청: 승낙하면 그 사람의 부캐 */}
                {s.owner && <small className="account-link">{s.owner}의 부캐</small>}
              </span>
              <small>{new Date(s.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
              <button className="pill pill-on" disabled={busy} onClick={() => run(() => decideSignup(s.id, "approve").then(() => undefined))}>
                승낙
              </button>
              <button className="pill" disabled={busy} onClick={() => run(() => decideSignup(s.id, "reject").then(() => undefined))}>
                거절
              </button>
            </div>
          ))}
        </section>
      )}

      <form className="panel form" onSubmit={create}>
        <h2 className="panel-title">계정 생성</h2>
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
        <>
          <h2 className="panel-title admin-count">
            길드원 {accounts.length}명{shown.length !== accounts.length && ` 중 ${shown.length}명`}
          </h2>
          <input className="mk-input admin-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 닉네임 찾기" aria-label="닉네임 찾기" />
          <div className="filter">
            {FILTERS.map((f) => (
              <button key={f.key} className={"pill" + (filter === f.key ? " pill-on" : "")} onClick={() => setFilter(f.key)}>
                {f.label} <small>{accounts.filter(f.test).length}</small>
              </button>
            ))}
          </div>
          <ul className="list account-list">
            {ordered.slice(0, limit).map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                accounts={accounts}
                alts={altsOf.get(a.id)?.length ?? 0}
                me={me}
                busy={busy}
                open={open === a.id}
                onOpen={() => setOpen(open === a.id ? null : a.id)}
                onReset={() =>
                  run(async () => {
                    const r = await resetPassword(a.id, FIRST_PASSWORD);
                    setNotice({ title: "비밀번호를 초기화했어요", id: r.id, password: r.tempPassword });
                  })
                }
                onRole={(role) => run(async () => void (await setRole(a.id, role)))}
                onDelete={() => run(async () => void (await deleteAccount(a.id)))}
                onLink={(other, main) => run(async () => void (await linkAccounts(a.id, other, main)))}
                onUnlink={() =>
                  run(async () => {
                    const r = await unlinkAccount(a.id);
                    setNotice({ title: "통합을 해제했어요", id: r.id, password: r.tempPassword });
                  })
                }
                onChanged={reload}
              />
            ))}
          </ul>
          {shown.length > limit && (
            <div className="links">
              <button className="btn btn-ghost" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                더 보기 ({shown.length - limit}명 더)
              </button>
            </div>
          )}
          {shown.length === 0 && <div className="empty">찾는 길드원이 없어요.</div>}
        </>
      )}
    </>
  );
}

/**
 * 계정 한 줄: 엠블럼, 닉네임, 길드와 레벨, 표시. 누르면 그 줄 아래로만 관리 칸이 펼쳐진다 (제작자 요청: 한 행으로).
 * 역할은 드롭다운 대신 세 칸 단추 (게임 위 위키 창 WebView 에서는 <select> 가 안 열려서)
 */
function AccountRow({
  account, accounts, alts, me, busy, open, onOpen, onReset, onRole, onDelete, onLink, onUnlink, onChanged,
}: {
  account: Account;
  accounts: Account[];
  /** 이 본캐에 묶인 부캐 수 */
  alts: number;
  me: Me;
  busy: boolean;
  open: boolean;
  onOpen: () => void;
  onReset: () => void;
  onRole: (role: Role) => void;
  onDelete: () => void;
  onLink: (other: string, main: string) => void;
  onUnlink: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  // 이 줄에서 하는 일 (고스펙, 사진 삭제, 본캐 지정, 닉네임 변경): 끝나고 목록을 다시 받을 때까지 단추를 막는다
  const [acting, setActing] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setActing(true);
    setPhotoError("");
    try {
      await fn();
      await onChanged();
      refreshMe();
    } catch (x) {
      setPhotoError(errorText(x));
    } finally {
      setActing(false);
    }
  }
  const [growthLog, setGrowthLog] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newId, setNewId] = useState("");
  // 내 캐릭터(부캐 묶기)는 내 계정처럼 다루지 못한다
  const isMine = (a: Account) => (me.characters?.some((c) => c.id === a.id) ?? false) || a.id === me.id;
  // 다룰 수 있는지는 그 사람(묶인 캐릭터) 중 가장 높은 역할로 (서버 canManageUser 와 같다: 길드마스터의 부캐를 오피서가 가로채지 못하게)
  const topRole = (a: Account): Role => {
    const owner = a.mainId ?? a.id;
    return accounts
      .filter((x) => (x.mainId ?? x.id) === owner)
      .reduce<Role>((top, x) => (RANK[x.role] > RANK[top] ? x.role : top), a.role);
  };
  const manageable = !isMine(account) && canManage(me.role, topRole(account));
  // 계정 통합 (부캐 묶기): 내 캐릭터이거나 다룰 수 있는 계정끼리. 부캐는 본캐를 골라서 묶는다
  const linkable = (a: Account) => !a.mainId && (isMine(a) || canManage(me.role, topRole(a)));
  const [linking, setLinking] = useState(false);
  // 역할 바꾸기 (오피서 임명/해제): 다룰 수 있는 사람이면 된다 (오피서도 길드마스터와 같다)
  const canRole = manageable;

  return (
    <li className={"account" + (open ? " account-open" : "") + (account.mainId ? " account-alt" : "")}>
      <button className="account-row" onClick={onOpen} aria-expanded={open}>
        {account.job && account.level ? <JobEmblem job={account.job} level={account.level} size={30} /> : <span className="account-noemblem" />}
        <span className="account-main">
          <b className={account.highSpec ? "hs-text" : undefined}>{account.id}</b>
          {/* 부캐 묶기: 부캐는 본캐 아이디, 본캐는 부캐 수 */}
          {account.mainId ? <small className="account-link">↳ {account.mainId}의 부캐</small> : alts > 0 && <small className="account-link">본캐 · 부캐 {alts}</small>}
          <small>
            {account.guild ? `${GUILD_TIER[account.guild]} ${GUILD_NAME[account.guild]}` : "길드 안 정함"}
            {account.job && account.level ? ` · Lv.${account.level} ${JOB_NAME[account.job]}` : " · 직업·레벨 안 정함"}
          </small>
        </span>
        <span className="account-tags">
          {account.mustChange && <span className="role-badge muted">비밀번호 바꾸기 전</span>}
          {/* 앱개발자는 길드 직책이 아니라서 그냥 길드원으로 보인다 (제작자 요청: 앱 관리 표시도 빼고 순서도 길드원 자리) */}
          <span className="role-badge">{ROLE_NAME[positionOf(account.role)]}</span>
        </span>
        <span className="account-more" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="account-panel">
          {canRole && (
            <div className="account-field">
              <span>역할</span>
              <div className="account-roles">
                {ASSIGNABLE.map((r) => (
                  <button
                    key={r}
                    className={"pill" + (account.role === r ? " pill-on" : "")}
                    disabled={busy || account.role === r || !canManage(me.role, r)}
                    onClick={() => onRole(r)}
                  >
                    {ROLE_NAME[r]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="account-actions">
            <button className="pill" disabled={busy} onClick={() => setEditing((e) => !e)}>
              {editing ? "닫기" : "정보 수정"}
            </button>
            {account.level && (
              <button className={"pill" + (growthLog ? " pill-on" : "")} disabled={busy} onClick={() => setGrowthLog((g) => !g)}>
                성장 기록
              </button>
            )}
            {/* 고스펙 표시: 랭킹에 '고스펙', 플래티넘 상점에서 고스펙 할인가 (제작자 요청) */}
            <button
              className={"pill" + (account.highSpec ? " pill-on" : "")}
              disabled={busy || acting}
              onClick={() => act(() => setHighSpec(account.id, !account.highSpec))}
            >
              고스펙
            </button>
            {account.avatar && (
              <button
                className="pill"
                disabled={busy || acting}
                onClick={() => act(() => deleteAvatarOf(account.id))}
              >
                사진 삭제
              </button>
            )}
            {linkable(account) && (
              <button className={"pill" + (linking ? " pill-on" : "")} disabled={busy} onClick={() => setLinking((v) => !v)}>
                계정 통합
              </button>
            )}
            {account.mainId && (isMine(account) || canManage(me.role, topRole(account))) && (
              <>
                {/* 주력 캐릭터가 바뀌면 이 부캐를 본캐로 (비밀번호는 그대로, 로그인 아이디만 바뀐다) */}
                <button
                  className="pill"
                  disabled={busy || acting}
                  onClick={() => act(() => setMainCharacter(account.id))}
                >
                  본캐 지정
                </button>
                <button className="pill" disabled={busy} onClick={onUnlink}>
                  통합 해제
                </button>
              </>
            )}
            {manageable && (
              <>
                <button className="pill" disabled={busy} onClick={() => setRenaming((v) => !v)}>
                  닉네임 변경
                </button>
                {/* 부캐는 로그인이 없다: 비밀번호 초기화는 본캐 줄에서 */}
                {!account.mainId && (
                  <button className="pill" disabled={busy} onClick={onReset}>
                    비밀번호 초기화
                  </button>
                )}
                {confirmDelete ? (
                  <>
                    <button className="pill pill-danger" disabled={busy} onClick={onDelete}>
                      삭제 확인
                    </button>
                    <button className="pill" onClick={() => setConfirmDelete(false)}>
                      취소
                    </button>
                  </>
                ) : (
                  <button className="pill" disabled={busy} onClick={() => setConfirmDelete(true)}>
                    계정 삭제
                  </button>
                )}
              </>
            )}
          </div>
          {renaming && (
            <div className="mk-actions">
              <input
                className="mk-input"
                value={newId}
                onChange={(e) => setNewId(e.target.value.slice(0, 20))}
                placeholder="새 닉네임"
                aria-label="새 닉네임"
                autoCapitalize="off"
              />
              <button
                className="pill"
                disabled={busy || acting || !newId.trim()}
                onClick={() =>
                  act(async () => {
                    await renameAccount(account.id, newId.trim());
                    setRenaming(false);
                  })
                }
              >
                변경
              </button>
            </div>
          )}
          {linking && (
            <LinkPicker
              account={account}
              candidates={accounts.filter((a) => a.id !== account.id && linkable(a))}
              busy={busy}
              onLink={(other, main) => {
                setLinking(false);
                onLink(other, main);
              }}
            />
          )}
          {photoError && <p className="form-error">{photoError}</p>}
          {growthLog && <GrowthLog id={account.id} onChanged={onChanged} />}
          {editing && (
            <ProfileForm
              guild={account.guild}
              job={account.job}
              level={account.level}
              askChange
              submitLabel={`${account.id} 저장`}
              onSave={async (job, level, _exp, guild, change) => {
                await saveProfileOf(account.id, job, level, guild, change);
                setEditing(false);
                await onChanged();
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * 계정 통합 (부캐 묶기, 제작자 요청 2026-11-01): 같은 사람의 다른 계정을 고르고, 무엇을 본캐로 할지 고른다.
 * 본캐 아이디와 비밀번호로 로그인하고, 부캐가 된 쪽의 로그인은 끝난다. 캐릭터(랭킹, 거래, 글)는 그대로 따로 있다
 */
function LinkPicker({ account, candidates, busy, onLink }: {
  account: Account;
  candidates: Account[];
  busy: boolean;
  onLink: (other: string, main: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [other, setOther] = useState<Account | null>(null);
  const q = query.replace(/\s+/g, "").toLowerCase();
  const found = candidates.filter((a) => !q || a.id.replace(/\s+/g, "").toLowerCase().includes(q)).slice(0, 20);
  const label = (a: Account) => `${a.id}${a.level ? ` · Lv.${a.level}` : ""}${a.job ? ` ${JOB_NAME[a.job]}` : ""}`;
  if (other) {
    return (
      <div className="link-picker">
        <b>무엇을 본캐로 할까요?</b>
        <small>본캐 아이디와 비밀번호로 로그인해요</small>
        <div className="link-list">
          {[account, other].map((a) => (
            <button key={a.id} className="pill" disabled={busy} onClick={() => onLink(other.id, a.id)}>
              {label(a)}
            </button>
          ))}
        </div>
        <button className="pill" disabled={busy} onClick={() => setOther(null)}>
          ◀ 다른 계정
        </button>
      </div>
    );
  }
  return (
    <div className="link-picker">
      <b>통합할 계정</b>
      <input className="mk-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 닉네임 찾기" aria-label="통합할 닉네임 찾기" />
      <div className="link-list">
        {found.map((a) => (
          <button key={a.id} className="pill" disabled={busy} onClick={() => setOther(a)}>
            {label(a)}
          </button>
        ))}
        {found.length === 0 && <small className="muted">고를 수 있는 계정이 없어요</small>}
      </div>
    </div>
  );
}

const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`;
};

/**
 * 성장 기록 바로잡기 (제작자 요청: 잘못 쓴 것을 고쳤는데 레벨업·경험치 오름으로 잡힌 기록).
 * 레벨·경험치를 저장한 기록을 최근 것부터 보이고, 잘못 들어간 기록을 지우면 성장 랭킹이 다시 계산된다. 레벨업 ▲ 표시도 지울 수 있다
 */
function GrowthLog({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const [log, setLog] = useState<LevelLogEntry[] | null>(null);
  const [badge, setBadge] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetchLevelLog(id).then(
      (r) => {
        setLog(r.log);
        setBadge(r.profile && r.profile.prevLevel !== null && r.profile.prevLevel < r.profile.level ? r.profile.level - r.profile.prevLevel : null);
      },
      (x) => setError(errorText(x)),
    );
  }, [id]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      load();
      await onChanged();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  if (!log) return <Loading error={error} />;
  return (
    <div className="growth-log">
      {badge !== null && (
        <button className="pill" disabled={busy} onClick={() => run(() => clearLevelBadge(id))}>
          ▲{badge} 표시 삭제
        </button>
      )}
      <ul className="lv-log">
        {log.map((e, i) => (
          <li key={e.at}>
            <span>
              {stamp(e.at)} · Lv.{e.level} {e.exp !== null ? expText(e.exp) : ""}
              {i === 0 && " (지금)"}
            </span>
            {i > 0 && (
              <button disabled={busy} onClick={() => run(() => deleteLevelLog(id, e.at))} aria-label="이 기록 삭제">
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

