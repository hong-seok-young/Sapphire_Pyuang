// 길드 통제 리스트 (제작자 2026-11-10 '우리 길드는 중립길드야, 이 몹들을 잡으면 안 되는 통제 리스트', '앱 스타일대로 이쁘게', '이미지도 우리 DB 에서 써도 돼').
// 자료는 meta.json 의 control (build_data.py control_list, 비공개 자료 길드/통제_리스트.json). 공지사항 글 본문의 '[[통제 리스트]]' 줄(Board.tsx),
// 사냥터 화면 맨 위(ControlPlaceBox), 몬스터 카드의 '통제' 표(ControlTag)와 몬스터 화면(ControlMonsterBox)이 같은 자료를 쓴다.
import { useEffect, useState } from "react";
import { loadWiki } from "../data";
import { PicImg } from "../ui";
import type { ControlList, ControlMob, Wiki } from "../types";

export const CONTROL_MARK = "[[통제 리스트]]";
const NOTICE = "#/board?cat=notice";

type Group = ControlList["groups"][number];

/** 이 몬스터(key)가 통제 리스트에 있으면 그 곳과 몹 */
export function controlOf(wiki: Wiki, key: string): { group: Group; mob: ControlMob } | null {
  for (const group of wiki.meta.control?.groups ?? []) {
    const mob = group.mobs.find((m) => m.key === key);
    if (mob) return { group, mob };
  }
  return null;
}

const dateText = (d: string) => d.replace(/-/g, ".");

function MobChip({ wiki, m }: { wiki: Wiki; m: ControlMob }) {
  const mon = m.key ? wiki.monsters[m.key] : undefined;
  const inner = (
    <>
      {mon ? <PicImg pic={mon.img} fit={26} alt="" className="ctl-mob-pic" /> : <span className="ctl-mob-x" aria-hidden />}
      <span className="ctl-mob-name">{m.name}</span>
      {m.note && <small className="ctl-mob-note">{m.note}</small>}
    </>
  );
  return mon ? (
    <a className="ctl-mob" href={"#/monster/" + encodeURIComponent(mon.name)}>
      {inner}
    </a>
  ) : (
    <span className={"ctl-mob" + (m.name.includes("통제") ? " ctl-mob-all" : "")}>{inner}</span>
  );
}

/** 공지 글의 한 곳: 원본 표처럼 작은 칸, 몹은 작은 그림과 이름 한 줄씩 (제작자 2026-11-10 '2열 구성하고 콤팩트하게, 그림 작아도 돼') */
function Cell({ wiki, g }: { wiki: Wiki; g: Group }) {
  const place = g.placeId ? wiki.places[g.placeId] : undefined;
  return (
    <div className={"ctl-cell" + (g.mark ? " ctl-cell-ban" : "")}>
      <div className="ctl-cell-head">
        {place ? <a href={"#/place/" + g.placeId}>{g.place}</a> : <span>{g.place}</span>}
        {g.mark && <span className="ctl-ban">{g.mark}</span>}
      </div>
      <ul className="ctl-cell-mobs">
        {g.mobs.map((m) => {
          const mon = m.key ? wiki.monsters[m.key] : undefined;
          const inner = (
            <>
              {mon ? <PicImg pic={mon.img} fit={18} alt="" className="ctl-mob-pic" /> : <span className="ctl-mob-x ctl-mob-x-sm" aria-hidden />}
              <span className="ctl-line-name">{m.name}</span>
              {m.note && <small className="ctl-mob-note">{m.note}</small>}
            </>
          );
          return (
            <li key={m.name}>
              {mon ? (
                <a className="ctl-line" href={"#/monster/" + encodeURIComponent(mon.name)}>
                  {inner}
                </a>
              ) : (
                <span className={"ctl-line" + (m.name.includes("통제") ? " ctl-line-all" : "")}>{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 통제 리스트 전체 (공지사항 글 안) */
export function ControlBoard() {
  const [wiki, setWiki] = useState<Wiki | null>(null);
  useEffect(() => {
    let alive = true;
    loadWiki().then((w) => alive && setWiki(w), () => {});
    return () => {
      alive = false;
    };
  }, []);
  const c = wiki?.meta.control;
  if (!wiki || !c) return null;
  const count = c.groups.reduce((n, g) => n + g.mobs.length, 0);
  return (
    <section className="ctl ctl-board">
      <div className="ctl-head">
        <span className="ctl-seal" aria-hidden>
          통제
        </span>
        <div className="ctl-title">
          <b>{c.title}</b>
          <small>통제 몹 {count}</small>
        </div>
      </div>
      <div className="ctl-grid">
        {c.groups.map((g) => (
          <Cell key={g.place} wiki={wiki} g={g} />
        ))}
      </div>
      <div className="ctl-foot">
        표 제작 {c.by} · 수정 {dateText(c.date)}
      </div>
    </section>
  );
}

/** 사냥터 화면 맨 위: 이곳의 통제 몹 */
export function ControlPlaceBox({ wiki, id }: { wiki: Wiki; id: string }) {
  const c = wiki.meta.control;
  const g = c?.groups.find((x) => x.placeId === id);
  if (!c || !g) return null;
  return (
    <section className="ctl ctl-small">
      <div className="ctl-head">
        <span className="ctl-seal" aria-hidden>
          통제
        </span>
        <div className="ctl-title">
          <b>{c.title}</b>
          <small>{g.mark ? g.mark : "잡지 않는 몹"}</small>
        </div>
        <a className="ctl-more" href={NOTICE}>
          공지 ›
        </a>
      </div>
      <div className="ctl-mobs ctl-mobs-pad">
        {g.mobs.map((m) => (
          <MobChip key={m.name} wiki={wiki} m={m} />
        ))}
      </div>
    </section>
  );
}

/** 몬스터 화면 맨 위: 통제 몹이면 */
export function ControlMonsterBox({ wiki, keys }: { wiki: Wiki; keys: string[] }) {
  const c = wiki.meta.control;
  const hits = keys.map((k) => controlOf(wiki, k)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!c || !hits.length) return null;
  return (
    <section className="ctl ctl-small">
      <div className="ctl-head">
        <span className="ctl-seal" aria-hidden>
          통제
        </span>
        <div className="ctl-title">
          <b>{c.server} 통제 몹 · 잡지 않아요</b>
          <small>
            {hits.map((h) => h.group.place + (h.mob.note ? ` · ${h.mob.note}` : "")).join(" / ")}
          </small>
        </div>
        <a className="ctl-more" href={NOTICE}>
          공지 ›
        </a>
      </div>
    </section>
  );
}

/** 몬스터 카드 이름 옆 작은 표 */
export function ControlTag({ wiki, monsterKey }: { wiki: Wiki; monsterKey: string }) {
  return controlOf(wiki, monsterKey) ? <span className="ctl-tag">통제</span> : null;
}
