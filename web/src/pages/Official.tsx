import { useEffect, useState } from "react";
import { errorText } from "../auth";
import { OFFICIAL_TABS, TYPE_NAME, fetchOfficial, officialUrl } from "../official";
import type { OfficialItem, OfficialTab } from "../official";
import { go } from "../router";
import { Loading, TopBar } from "../ui";

/** 한국 날짜 'YYYY-MM-DD' (며칠 전) */
const kstDay = (daysAgo = 0) => new Date(Date.now() + 9 * 3_600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);

/**
 * 공식 소식 (제작자 요청 2026-11-01): 아이모 공식 홈페이지의 공지사항, 점검, 이벤트 (정보 안의 칸).
 * 제목과 날짜만 보이고 누르면 공식 페이지가 새 창으로 열린다. 고른 칸은 주소 ?t= 에 남는다
 */
export function OfficialPage({ tab }: { tab: OfficialTab }) {
  const [items, setItems] = useState<OfficialItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError("");
    fetchOfficial(tab).then(
      (r) => {
        if (!alive) return;
        setItems(r.items);
        setMore(r.more);
      },
      (x) => alive && setError(errorText(x)),
    );
    return () => {
      alive = false;
    };
  }, [tab]);

  async function loadMore() {
    if (!items?.length) return;
    setBusy(true);
    try {
      const r = await fetchOfficial(tab, items[items.length - 1].id);
      setItems([...items, ...r.items.filter((it) => !items.some((x) => x.id === it.id))]);
      setMore(r.more);
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const today = kstDay();
  const fresh = kstDay(2);
  return (
    <>
      <TopBar title="공식 소식" />
      <div className="filter">
        {OFFICIAL_TABS.map((t) => (
          <button key={t.key} className={"pill" + (tab === t.key ? " pill-on" : "")} onClick={() => go(`#/official?t=${t.key}`, true)}>
            {t.label}
          </button>
        ))}
      </div>
      {!items ? (
        <Loading error={error} />
      ) : items.length === 0 ? (
        <div className="empty">아직 받아 온 소식이 없어요.</div>
      ) : (
        <ul className="off-list">
          {items.map((it) => {
            const ended = !!it.end && it.end < today;
            return (
              <li key={it.id}>
                <a className={"off-row" + (ended ? " off-ended" : "")} href={officialUrl(it)} target="_blank" rel="noopener noreferrer">
                  {it.image && <img className="off-thumb" src={it.image} alt="" loading="lazy" decoding="async" width={84} height={47} />}
                  <span className="off-main">
                    <span className="off-head">
                      <span className={"off-type off-type-" + it.type}>{TYPE_NAME[it.type] ?? it.type}</span>
                      {!ended && it.start && it.start >= fresh && <span className="off-new">NEW</span>}
                    </span>
                    <b className="off-title">{it.title}</b>
                    <small>
                      {it.start}
                      {it.end ? ` ~ ${it.end}` : ""}
                      {it.end ? (ended ? " · 종료" : " · 진행 중") : ""}
                    </small>
                  </span>
                  <span className="off-go" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {error && items && <p className="form-error">{error}</p>}
      {more && (
        <div className="links">
          <button className="btn btn-ghost" disabled={busy} onClick={loadMore}>
            더 보기
          </button>
        </div>
      )}
    </>
  );
}
