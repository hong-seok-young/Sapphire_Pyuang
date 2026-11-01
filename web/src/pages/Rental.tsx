// 장비대여 (#/rent, 제작자 요청 2026-11-01): 대여 담당 성민 님의 카카오톡 대여무기 목록을 그대로 옮겼다.
// 직업마다 기한(없음, 4주, 2주) 칸에 무기를 레벨 순서로: 위키 그림, +강, 옵션(명중 6 · 크리티컬 3), 💎 가격과 골드, 대여 가능 / 대여 중(누가, 언제까지).
// 길드원: 내 마일리지 💎, 대여 신청(마일리지에서 쓸 💎 를 고른다, 나머지는 골드). 운영진: 신청 승인·거절, 직접 대여, 반납, 물건 더하기·고치기·내리기,
// 카톡 목록 붙여넣기, 마일리지 적립·차감. 실제 주고받기는 게임 안에서. 지금은 개발 중이라 앱개발자만 들어온다 (src/launcher.ts, server/rental.ts)
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useEntryState } from "../router";
import { JOBS, JOB_NAME, errorText } from "../auth";
import type { Job, Me } from "../auth";
import type { Wiki } from "../types";
import { Loading, PicImg, TopBar } from "../ui";
import {
  TERMS,
  TERM_NAME,
  addMileage,
  addRent,
  cancelRent,
  diaGold,
  editRent,
  fetchMileage,
  fetchRent,
  importRent,
  lendRent,
  levelOf,
  md,
  optionParts,
  rejectRent,
  removeRent,
  requestRent,
  returnRent,
  weaponOf,
} from "../rental";
import type { ImportSummary, LedgerLine, RentData, RentFields, RentItem, RentTerm } from "../rental";

const REASON: Record<LedgerLine["reason"], string> = { donate: "기부", rent: "대여", adjust: "고침" };

export function RentalPage({ wiki, me }: { wiki: Wiki; me: Me }) {
  const [data, setData] = useState<RentData | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useEntryState<Job>("job", me.job ?? "warrior");
  const [onlyFree, setOnlyFree] = useEntryState("free", false);
  const [open, setOpen] = useState<number | null>(null);
  const [panel, setPanel] = useState<"" | "add" | "paste" | "mileage">("");
  const [showLedger, setShowLedger] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchRent());
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (!data) return (
    <>
      <TopBar title="장비대여" />
      <Loading error={error || undefined} onRetry={() => void load()} />
    </>
  );

  const now = Date.now();
  const mine = new Set(data.mine);
  const myRented = data.items.filter((i) => i.renter && mine.has(i.renter));
  const myWaiting = data.items.filter((i) => i.mine);
  const waitingAll = data.manager ? data.items.filter((i) => i.requests?.length) : [];
  const ofJob = data.items.filter((i) => i.job === job && (!onlyFree || !i.renter));

  return (
    <>
      <TopBar title="장비대여" />
      {error && <p className="form-error">{error}</p>}

      {/* 내 마일리지와 내 대여 */}
      <section className="panel rent-me">
        <div className="rent-me-top">
          <span className="rent-dia">💎 {data.mileage.toLocaleString()}</span>
          <small>마일리지 · {diaGold(data.mileage, data.rate)} 골드</small>
          <button className="pill" onClick={() => setShowLedger((v) => !v)}>
            장부
          </button>
        </div>
        {myRented.map((i) => (
          <p key={i.id} className="rent-me-line">
            🤝 {i.weapon} +{i.enhance} · {i.dueAt ? `${md(i.dueAt)}까지` : "기한 없음"}
          </p>
        ))}
        {myWaiting.map((i) => (
          <p key={i.id} className="rent-me-line rent-muted">
            ⏳ {i.weapon} +{i.enhance} 신청{i.mine!.useDia ? ` · 마일리지 💎${i.mine!.useDia}` : ""}
          </p>
        ))}
        {showLedger && <Ledger lines={data.ledger} rate={data.rate} />}
      </section>

      {/* 운영진: 기다리는 신청, 물건 더하기, 카톡 목록 붙여넣기, 마일리지 */}
      {data.manager && (
        <section className="panel rent-admin">
          <div className="mk-chips">
            <b className="rent-admin-title">운영</b>
            {(["add", "paste", "mileage"] as const).map((p) => (
              <button key={p} className={"pill" + (panel === p ? " pill-on" : "")} onClick={() => setPanel(panel === p ? "" : p)}>
                {p === "add" ? "+ 물건" : p === "paste" ? "목록 붙여넣기" : "마일리지"}
              </button>
            ))}
          </div>
          {waitingAll.length > 0 && (
            <ul className="rent-waits">
              {waitingAll.map((i) => (
                <li key={i.id}>
                  <button
                    className="rent-wait"
                    onClick={() => {
                      setJob(i.job);
                      setOpen(i.id);
                    }}
                  >
                    ⏳ {JOB_NAME[i.job]} {i.weapon} +{i.enhance} · 신청 {i.requests!.length} ({i.requests!.map((r) => r.user).join(", ")})
                  </button>
                </li>
              ))}
            </ul>
          )}
          {panel === "add" && <ItemForm wiki={wiki} start={{ job }} onDone={() => (setPanel(""), void load())} />}
          {panel === "paste" && <PasteImport onDone={() => void load()} />}
          {panel === "mileage" && <MileagePanel data={data} onDone={() => void load()} />}
        </section>
      )}

      {/* 직업 고르기 */}
      <div className="mk-chips rent-jobs">
        {JOBS.map((j) => (
          <button key={j} className={"pill" + (job === j ? " pill-on" : "")} onClick={() => setJob(j)}>
            {JOB_NAME[j]}
          </button>
        ))}
        <button className={"pill rent-free" + (onlyFree ? " pill-on" : "")} onClick={() => setOnlyFree((v) => !v)}>
          대여 가능만
        </button>
      </div>

      {TERMS.map((term) => {
        const list = ofJob.filter((i) => i.term === term).sort((a, b) => levelOf(wiki, a) - levelOf(wiki, b) || a.weapon.localeCompare(b.weapon) || a.enhance - b.enhance);
        if (!list.length) return null;
        const free = list.filter((i) => !i.renter).length;
        return (
          <section key={term} className="rent-term">
            <h2 className="rent-term-head">
              <span>{TERM_NAME[term]}</span>
              <small>
                대여 가능 {free}/{list.length}
              </small>
            </h2>
            <ul className="mk-list">
              {list.map((i) => (
                <li key={i.id} className={"mk-item" + (open === i.id ? " mk-open" : "") + (i.renter ? " rent-out" : "")}>
                  <button className="mk-row" onClick={() => setOpen(open === i.id ? null : i.id)}>
                    <Slot wiki={wiki} item={i} />
                    <span className="mk-name">
                      <b>
                        {i.weapon} <span className="rent-lv">Lv.{levelOf(wiki, i)}</span>
                      </b>
                      <small>
                        <span className="mk-ench">{optionParts(i.options).map(([n, v]) => `${n} ${v}`).join(" · ") || i.options || "옵션 없음"}</span>
                      </small>
                      <small>
                        <Status item={i} now={now} mine={mine} />
                        {i.donor && <span>기부 {i.donor}</span>}
                      </small>
                    </span>
                    <span className="mk-price">
                      <b>💎{i.price}</b>
                      <small>{diaGold(i.price, data.rate)}</small>
                    </span>
                  </button>
                  {open === i.id && <Detail wiki={wiki} item={i} data={data} onDone={() => void load()} />}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!ofJob.length && <div className="empty">{onlyFree ? "지금 대여 가능한 무기가 없어요" : "대여 무기가 없어요"}</div>}
    </>
  );
}

/** 무기 그림 칸 (+강 표) */
function Slot({ wiki, item }: { wiki: Wiki; item: RentItem }) {
  const it = weaponOf(wiki, item.weapon);
  return (
    <span className="mk-slot" style={{ width: 42, height: 42 }}>
      {it?.icon ? <PicImg pic={it.icon} fit={32} /> : <span className="mk-slot-none">?</span>}
      <b className="mk-plus">+{item.enhance}</b>
    </span>
  );
}

/** 대여 가능 / 대여 중 (누가, 언제까지, 지나면 빨갛게) / 신청 수 */
function Status({ item, now, mine }: { item: RentItem; now: number; mine: Set<string> }) {
  if (item.renter) {
    const late = item.dueAt !== null && item.dueAt < now;
    return (
      <span className={late ? "rent-late" : "rent-busy"}>
        대여 중 · {mine.has(item.renter) ? "나" : item.renter}
        {item.dueAt ? ` · ${md(item.dueAt)}${late ? " 지남" : "까지"}` : ""}
      </span>
    );
  }
  return (
    <span className="rent-free-text">
      대여 가능{item.waiting ? ` · 신청 ${item.waiting}` : ""}
      {item.mine ? " · 내 신청" : ""}
    </span>
  );
}

/** 펼친 칸: 위키 정보, 신청(길드원), 운영진 일 */
function Detail({ wiki, item, data, onDone }: { wiki: Wiki; item: RentItem; data: RentData; onDone: () => void }) {
  const info = weaponOf(wiki, item.weapon)?.equip?.[0]?.info;
  const [editing, setEditing] = useState(false);
  return (
    <div className="mk-detail">
      {info && (
        <p className="mk-meta">
          {[info["공격"] && `공격 ${info["공격"]}`, info["속도"] && `속도 ${info["속도"]}`, info["옵션"] && `옵션 범위 ${info["옵션"]}`].filter(Boolean).join(" · ")}
        </p>
      )}
      {item.renter && item.rentedAt && (
        <p className="mk-meta">
          {item.renter} · {md(item.rentedAt)}부터{item.dueAt ? ` ${md(item.dueAt)}까지` : ""}
        </p>
      )}
      {item.note && <p className="mk-note">{item.note}</p>}
      {!item.renter && <RequestBox item={item} data={data} onDone={onDone} />}
      {data.manager &&
        (editing ? (
          <ItemForm wiki={wiki} start={item} onDone={() => (setEditing(false), onDone())} />
        ) : (
          <ManagerBox item={item} data={data} onEdit={() => setEditing(true)} onDone={onDone} />
        ))}
    </div>
  );
}

/** 대여 신청 (마일리지에서 쓸 💎 를 고르고, 나머지는 골드) / 내 신청 취소 */
function RequestBox({ item, data, onDone }: { item: RentItem; data: RentData; onDone: () => void }) {
  const max = Math.min(item.price, data.mileage);
  const [use, setUse] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (item.mine) {
    return (
      <div className="mk-actions">
        <span className="rent-muted">신청함{item.mine.useDia ? ` · 마일리지 💎${item.mine.useDia}` : ""}</span>
        <button className="pill" disabled={busy} onClick={() => run(() => cancelRent(item.id))}>
          신청 취소
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
    );
  }
  return (
    <div className="rent-ask">
      <div className="mk-actions">
        <span className="rent-muted">마일리지</span>
        <button className="pill" disabled={use <= 0} onClick={() => setUse((v) => Math.max(0, v - 1))}>
          −
        </button>
        <b className="rent-use">💎{use}</b>
        <button className="pill" disabled={use >= max} onClick={() => setUse((v) => Math.min(max, v + 1))}>
          +
        </button>
        <span className="rent-muted">
          골드 {diaGold(item.price - use, data.rate)}
        </span>
      </div>
      <input className="mk-input" placeholder="한마디 (선택)" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" disabled={busy} onClick={() => run(() => requestRent(item.id, use, note.trim()))}>
        대여 신청
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 운영진: 신청 승인·거절, 직접 대여, 반납, 고치기, 내리기 */
function ManagerBox({ item, data, onEdit, onDone }: { item: RentItem; data: RentData; onEdit: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lending, setLending] = useState(false);
  const [sure, setSure] = useState<"" | "return" | "remove">("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setSure("");
      setLending(false);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rent-manage">
      {(item.requests ?? []).map((r) => (
        <div key={r.id} className="mk-actions rent-req">
          <span>
            ⏳ {r.user}
            {r.useDia ? ` · 마일리지 💎${r.useDia}` : ""}
            {r.note ? ` · ${r.note}` : ""}
          </span>
          {!item.renter && (
            <button className="pill pill-on" disabled={busy} onClick={() => run(() => lendRent(item.id, { requestId: r.id }))}>
              대여 처리
            </button>
          )}
          <button className="pill" disabled={busy} onClick={() => run(() => rejectRent(r.id))}>
            거절
          </button>
        </div>
      ))}
      <div className="mk-actions">
        {item.renter ? (
          sure === "return" ? (
            <>
              <span className="rent-muted">게임 안에서 돌려받았어요?</span>
              <button className="pill pill-on" disabled={busy} onClick={() => run(() => returnRent(item.id))}>
                반납
              </button>
              <button className="pill" onClick={() => setSure("")}>
                취소
              </button>
            </>
          ) : (
            <button className="pill" onClick={() => setSure("return")}>
              반납
            </button>
          )
        ) : (
          <button className={"pill" + (lending ? " pill-on" : "")} onClick={() => setLending((v) => !v)}>
            직접 대여
          </button>
        )}
        <button className="pill" onClick={onEdit}>
          정보 수정
        </button>
        {!item.renter &&
          (sure === "remove" ? (
            <>
              <button className="pill pill-danger" disabled={busy} onClick={() => run(() => removeRent(item.id))}>
                내리기
              </button>
              <button className="pill" onClick={() => setSure("")}>
                취소
              </button>
            </>
          ) : (
            <button className="pill" onClick={() => setSure("remove")}>
              내리기
            </button>
          ))}
      </div>
      {lending && <LendForm item={item} data={data} busy={busy} onLend={(body) => run(() => lendRent(item.id, body))} />}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 직접 대여: 카톡 등으로 따로 받은 것을 닉네임으로 적는다 (마일리지를 쓰면 그 사람 장부에서 뺀다, 날짜를 고르면 그날 빌려 간 것으로) */
function LendForm({ item, data, busy, onLend }: { item: RentItem; data: RentData; busy: boolean; onLend: (b: { renter: string; useDia: number; date?: string }) => void }) {
  const [renter, setRenter] = useState("");
  const [use, setUse] = useState(0);
  const [date, setDate] = useState("");
  return (
    <div className="rent-ask">
      <NameInput value={renter} onChange={setRenter} members={data.members ?? []} placeholder="빌려 갈 사람 닉네임" />
      <div className="mk-actions">
        <span className="rent-muted">마일리지</span>
        <button className="pill" disabled={use <= 0} onClick={() => setUse((v) => Math.max(0, v - 1))}>
          −
        </button>
        <b className="rent-use">💎{use}</b>
        <button className="pill" disabled={use >= item.price} onClick={() => setUse((v) => Math.min(item.price, v + 1))}>
          +
        </button>
        <span className="rent-muted">골드 {diaGold(item.price - use, data.rate)}</span>
      </div>
      <label className="mk-field">
        <span>빌려 간 날 (비우면 오늘)</span>
        <input className="mk-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button className="btn" disabled={busy || !renter.trim()} onClick={() => onLend({ renter: renter.trim(), useDia: use, ...(date ? { date } : {}) })}>
        대여 처리
      </button>
    </div>
  );
}

/** 닉네임 칸: 적는 대로 길드원 닉네임을 칩으로 보여 준다 (앱에 없는 사람도 그대로 적을 수 있다) */
function NameInput({ value, onChange, members, placeholder }: { value: string; onChange: (v: string) => void; members: string[]; placeholder: string }) {
  const q = value.trim().toLowerCase();
  const hits = q ? members.filter((m) => m.toLowerCase().includes(q) && m !== value).slice(0, 6) : [];
  return (
    <>
      <input className="mk-input" placeholder={placeholder} maxLength={20} value={value} onChange={(e) => onChange(e.target.value)} />
      {hits.length > 0 && (
        <div className="mk-chips">
          {hits.map((m) => (
            <button key={m} type="button" className="pill" onClick={() => onChange(m)}>
              {m}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** 물건 더하기·고치기 */
function ItemForm({ wiki, start, onDone }: { wiki: Wiki; start: Partial<RentItem>; onDone: () => void }) {
  const [f, setF] = useState<RentFields>({
    job: start.job ?? "warrior",
    level: start.level ?? 1,
    weapon: start.weapon ?? "",
    options: start.options ?? "",
    enhance: start.enhance ?? 6,
    term: start.term ?? "none",
    price: start.price ?? 1,
    donor: start.donor ?? "",
    note: start.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof RentFields>(k: K, v: RentFields[K]) => setF((cur) => ({ ...cur, [k]: v }));
  // 그 직업의 위키 무기 (이름을 누르면 레벨도 위키 값으로)
  const weapons = useMemo(
    () =>
      Object.values(wiki.items)
        .filter((it) => it.equip?.some((e) => e.slot === `${JOB_NAME[f.job]} 무기`))
        .map((it) => ({ name: it.name, level: Number(it.equip[0].info["레벨제한"]) || 1 }))
        .sort((a, b) => a.level - b.level),
    [wiki, f.job],
  );
  const q = f.weapon.trim().replace(/\s+/g, "");
  const hits = q ? weapons.filter((w) => w.name.replace(/\s+/g, "").includes(q) && w.name !== f.weapon).slice(0, 6) : [];
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (start.id) await editRent(start.id, f);
      else await addRent(f);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-form rent-form">
      <div className="mk-chips">
        {JOBS.map((j) => (
          <button key={j} type="button" className={"pill" + (f.job === j ? " pill-on" : "")} onClick={() => set("job", j)}>
            {JOB_NAME[j]}
          </button>
        ))}
      </div>
      <div className="mk-chips">
        {TERMS.map((t) => (
          <button key={t} type="button" className={"pill" + (f.term === t ? " pill-on" : "")} onClick={() => set("term", t as RentTerm)}>
            {TERM_NAME[t]}
          </button>
        ))}
      </div>
      <label className="mk-field">
        <span>무기</span>
        <input className="mk-input" maxLength={30} value={f.weapon} onChange={(e) => set("weapon", e.target.value)} />
      </label>
      {hits.length > 0 && (
        <div className="mk-chips">
          {hits.map((w) => (
            <button
              key={w.name}
              type="button"
              className="pill"
              onClick={() => setF((cur) => ({ ...cur, weapon: w.name, level: w.level }))}
            >
              {w.name} <small>Lv.{w.level}</small>
            </button>
          ))}
        </div>
      )}
      <div className="rent-grid">
        <Num label="레벨" value={f.level} min={1} max={200} onChange={(v) => set("level", v)} />
        <Num label="+강" value={f.enhance} min={0} max={20} onChange={(v) => set("enhance", v)} />
        <Num label="💎" value={f.price} min={0} max={9999} onChange={(v) => set("price", v)} />
      </div>
      <label className="mk-field">
        <span>옵션 (명6크3, 지4마11마재1)</span>
        <input className="mk-input" maxLength={30} value={f.options} onChange={(e) => set("options", e.target.value)} />
      </label>
      <label className="mk-field">
        <span>기부</span>
        <input className="mk-input" maxLength={20} value={f.donor} onChange={(e) => set("donor", e.target.value)} />
      </label>
      <label className="mk-field">
        <span>메모</span>
        <input className="mk-input" maxLength={100} value={f.note} onChange={(e) => set("note", e.target.value)} />
      </label>
      <div className="mk-actions">
        <button className="btn" disabled={busy || !f.weapon.trim()} onClick={() => void save()}>
          {start.id ? "저장" : "물건 추가"}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>
          취소
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function Num({ label, value, min, max, onChange }: { label: ReactNode; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="mk-field">
      <span>{label}</span>
      <input
        className="mk-input"
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)));
        }}
      />
    </label>
  );
}

/** 카톡 목록 붙여넣기: 미리 보기(새로, 그대로, 내림) 뒤 적용 */
function PasteImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [sum, setSum] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (apply: boolean) => {
    setBusy(true);
    setError("");
    try {
      const r = await importRent(text, apply);
      setSum(r);
      if (r.applied) onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-form rent-form">
      <textarea
        className="mk-input rent-paste"
        placeholder="[sapphire 대여무기 목록] 전사 … 카톡 목록 글을 그대로"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSum(null);
        }}
      />
      {sum && (
        <p className="mk-meta">
          {sum.jobs.map((j) => JOB_NAME[j]).join(", ")} · 새로 {sum.add} · 그대로 {sum.keep} · 내림 {sum.gone}
          {sum.goneRented ? ` (대여 중 ${sum.goneRented})` : ""}
          {sum.skipped.length ? ` · 읽지 못한 줄 ${sum.skipped.length}: ${sum.skipped.slice(0, 3).join(" / ")}` : ""}
          {sum.applied ? " · 적용했어요" : ""}
        </p>
      )}
      <div className="mk-actions">
        <button className="btn btn-ghost" disabled={busy || !text.trim()} onClick={() => void run(false)}>
          미리 보기
        </button>
        <button className="btn" disabled={busy || !sum || !!sum.applied} onClick={() => void run(true)}>
          적용
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** 마일리지: 사람마다 남은 💎, 적립(기부)·차감, 그 사람 장부 */
function MileagePanel({ data, onDone }: { data: RentData; onDone: () => void }) {
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState<"donate" | "adjust">("donate");
  const [minus, setMinus] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<{ who: string; mileage: number; ledger: LedgerLine[] } | null>(null);
  const show = async (name: string) => {
    try {
      setView(await fetchMileage(name));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await addMileage(who.trim(), minus ? -amount : amount, reason, note.trim());
      setNote("");
      onDone();
      void show(who.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-form rent-form">
      <NameInput value={who} onChange={setWho} members={data.members ?? []} placeholder="닉네임" />
      <div className="mk-chips">
        <button type="button" className={"pill" + (!minus && reason === "donate" ? " pill-on" : "")} onClick={() => (setMinus(false), setReason("donate"))}>
          + 기부 적립
        </button>
        <button type="button" className={"pill" + (!minus && reason === "adjust" ? " pill-on" : "")} onClick={() => (setMinus(false), setReason("adjust"))}>
          + 고침
        </button>
        <button type="button" className={"pill" + (minus ? " pill-on" : "")} onClick={() => (setMinus(true), setReason("adjust"))}>
          − 차감
        </button>
      </div>
      <div className="rent-grid">
        <Num label="💎" value={amount} min={1} max={9999} onChange={setAmount} />
      </div>
      <input className="mk-input" placeholder={reason === "donate" ? "기부한 장비 (+8 글라디우스)" : "까닭"} maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" disabled={busy || !who.trim()} onClick={() => void save()}>
        {minus ? `💎${amount} 빼기` : `💎${amount} 더하기`}
      </button>
      {error && <p className="form-error">{error}</p>}
      {view && (
        <div className="rent-view">
          <b>
            {view.who} 💎{view.mileage}
          </b>
          <Ledger lines={view.ledger} rate={data.rate} />
        </div>
      )}
      <ul className="rent-balances">
        {(data.balances ?? []).map((b) => (
          <li key={b.person}>
            <button className="rent-balance" onClick={() => (setWho(b.person), void show(b.person))}>
              <span>{b.person}</span>
              <b>💎{b.dia}</b>
            </button>
          </li>
        ))}
        {!(data.balances ?? []).length && <li className="rent-muted">아직 적립한 사람이 없어요</li>}
      </ul>
    </div>
  );
}

/** 장부 줄들 */
function Ledger({ lines, rate }: { lines: LedgerLine[]; rate: number }) {
  if (!lines.length) return <p className="rent-muted">아직 기록이 없어요</p>;
  return (
    <ul className="rent-ledger">
      {lines.map((l, n) => (
        <li key={n}>
          <span className={l.delta > 0 ? "rent-plus" : "rent-minus"}>
            💎{l.delta > 0 ? "+" : ""}
            {l.delta}
          </span>
          <span>
            {REASON[l.reason]}
            {l.note ? ` · ${l.note}` : ""}
            {l.gold ? ` · 골드 ${diaGold(l.gold / rate, rate)}` : ""}
          </span>
          <small>{md(l.at)}</small>
        </li>
      ))}
    </ul>
  );
}

