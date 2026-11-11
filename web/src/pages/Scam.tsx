// 아이모 사기꾼 명단 (제작자 2026-11-11 '거래 전 더치트 조회 & 실물 확인! 사기꾼 리스트, 우리 DB 에 넣고 업데이트되면 반영'). #/scam
// 자료는 GET /api/scam (server/scam.ts, D1 scam_list: 카카오 포스트의 표 그림을 옮긴 것, 30분마다 그림이 바뀌었는지 본다).
// 이름·닉네임·폰 뒷자리·계좌 숫자로 찾는다. 원본이 가린 글자(x)는 그대로.
import { api } from "../auth";
import { useAsync } from "../data";
import { useEntryState } from "../router";
import { Loading, TopBar } from "../ui";

export interface ScamRow {
  no: number;
  name: string;
  nicks: string[];
  phones: string[];
  accounts: string[];
  note: string;
  note2: string;
}
export interface ScamList {
  title: string;
  by: string;
  post: string;
  rule: string;
  rows: ScamRow[];
  made: "person" | "ai";
  updatedAt: number;
  checkedAt: number;
}

export const fetchScam = () => api<{ list: ScamList | null }>("/api/scam");

const digits = (s: string) => s.replace(/\D/g, "");
const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function matches(r: ScamRow, query: string): boolean {
  const t = flat(query);
  if (!t) return true;
  const d = digits(query);
  const words = [r.name, ...r.nicks, r.note, r.note2, ...r.accounts.map((a) => a.replace(/[\d x]+/gi, ""))].map(flat);
  if (words.some((w) => w.includes(t))) return true;
  if (d.length >= 3 && d === t.replace(/[-\s]/g, "")) {
    if (r.phones.some((p) => p.includes(d) || (d.length >= 4 && d.endsWith(p)))) return true;
    // 계좌: 원본이 끝 몇 자리를 가렸으므로 적은 숫자의 앞부분이 맞으면
    return r.accounts.some((a) => {
      const ad = digits(a);
      return ad.length >= 4 && (ad.includes(d) || (d.length >= 8 && d.startsWith(ad.slice(0, Math.min(ad.length, d.length)))));
    });
  }
  return false;
}

const dayText = (ms: number) => {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export function ScamPage() {
  const { data, error } = useAsync(fetchScam, "scam");
  const [query, setQuery] = useEntryState("scam.q", "");
  const list = data?.list;
  const rows = list?.rows.filter((r) => matches(r, query)) ?? [];
  return (
    <div className="page scam">
      <TopBar title="사기꾼 명단" />
      {!data ? (
        <Loading error={error} />
      ) : !list ? (
        <p className="empty">아직 명단이 없어요</p>
      ) : (
        <>
          <div className="scam-rule">
            <span className="scam-rule-dot" aria-hidden />
            <span className="scam-rule-text">{list.rule || "거래 전 더치트 조회 & 아이템 실물 확인 필수"}</span>
            <a className="scam-cheat" href="https://thecheat.co.kr" target="_blank" rel="noreferrer">
              더치트 ↗
            </a>
          </div>
          <input
            className="scam-find"
            type="search"
            value={query}
            placeholder="이름 · 닉네임 · 폰 뒷자리 · 계좌번호"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="scam-count">
            {query.trim() ? (rows.length ? `맞는 줄 ${rows.length}` : "명단에 없어요 · 그래도 더치트 조회와 실물 확인") : `${list.rows.length}줄`}
          </div>
          <ul className="scam-list">
            {rows.map((r) => (
              <li key={r.no + r.name + r.phones.join()} className="scam-row">
                <span className="scam-no">{r.no}</span>
                <div className="scam-main">
                  <div className="scam-top">
                    <b className="scam-name">{r.name}</b>
                    {r.nicks.map((n) => (
                      <span key={n} className="scam-nick">
                        {n}
                      </span>
                    ))}
                    {r.phones.length > 0 && <span className="scam-phone">폰 {r.phones.join(", ")}</span>}
                  </div>
                  {r.accounts.map((a) => (
                    <div key={a} className="scam-acc">
                      {a}
                    </div>
                  ))}
                  {(r.note || r.note2) && (
                    <div className="scam-tags">
                      {[r.note, r.note2].filter(Boolean).map((t) => (
                        <span key={t} className={"scam-tag" + (/활동|악질|다수/.test(t) ? " scam-tag-hot" : "")}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="scam-foot">
            Made by. {list.by} · {dayText(list.updatedAt)} 반영{list.made === "ai" ? " (AI 옮김)" : ""}
            {list.post && (
              <>
                {" · "}
                <a href={list.post} target="_blank" rel="noreferrer">
                  원본 ↗
                </a>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
