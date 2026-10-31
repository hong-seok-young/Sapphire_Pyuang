import { useState } from "react";
import { OriginalLink } from "../Blocks";
import type { Wiki } from "../types";
import { PicImg, TopBar, NotFound } from "../ui";

export function EquipSlots({ wiki }: { wiki: Wiki }) {
  return (
    <>
      <TopBar title="장비" />
      <nav className="tiles tiles-3">
        {wiki.equipment.map((e) => (
          <a key={e.slot} className="tile" href={"#/equip/" + encodeURIComponent(e.slot)}>
            <span className="tile-icon">
              <PicImg pic={e.rows.find((r) => r.icon)?.icon} fit={32} />
            </span>
            <span className="tile-title">{e.slot}</span>
            <span className="tile-count">{e.rows.length}</span>
          </a>
        ))}
      </nav>
    </>
  );
}

const JOBS = ["전체", "전사", "레인저", "마법사", "무도가", "공용"];

export function EquipSlot({ wiki, slot }: { wiki: Wiki; slot: string }) {
  const [job, setJob] = useState("전체");
  const table = wiki.equipment.find((e) => e.slot === slot);
  if (!table) return <NotFound what="장비" />;
  // 한 글 안에서도 표마다 칸이 다를 수 있어서 (보조 장비: 방패 / 마법 / 정밀) 줄마다 자기 머리줄로 읽는다
  const fieldsOf = (r: (typeof table.rows)[number]) =>
    Object.fromEntries((r.h ?? table.headers).map((h, i) => [h, r.cells[i] ?? ""])) as Record<string, string>;
  const hasJob = table.headers.includes("직업");
  const shown = table.rows.filter((r) => job === "전체" || !hasJob || (fieldsOf(r)["직업"] ?? "").includes(job));
  const HIDDEN = ["이미지", "아이템명", "직업", "옵션", "획득처", "레벨제한"];

  return (
    <>
      <TopBar title={slot} />
      <OriginalLink postId={table.post} />
      {hasJob && (
        <div className="filter">
          {JOBS.map((j) => (
            <button key={j} className={"pill" + (j === job ? " pill-on" : "")} onClick={() => setJob(j)}>
              {j}
            </button>
          ))}
        </div>
      )}
      <ul className="equip-list">
        {shown.map((r, i) => {
          const f = fieldsOf(r);
          const shownValue = (v: string | undefined) => v && v !== "-";
          return (
            <li key={r.name + i}>
              <a className="equip card" href={"#/item/" + encodeURIComponent(r.name)}>
                <span className="equip-icon">
                  <PicImg pic={r.icon ?? wiki.items[r.name]?.icon} fit={40} />
                </span>
                <span className="equip-main">
                  <span className="equip-name">
                    {r.name} {shownValue(f["레벨제한"]) && <span className="lv">Lv.{f["레벨제한"]}</span>}
                  </span>
                  <span className="equip-stats">
                    {Object.entries(f)
                      .filter(([h, v]) => !HIDDEN.includes(h) && shownValue(v))
                      .map(([h, v]) => <span key={h}>{h} {v}</span>)}
                    {shownValue(f["직업"]) && <span>{f["직업"]}</span>}
                  </span>
                  {shownValue(f["옵션"]) && <span className="equip-opt">{f["옵션"]}</span>}
                  {shownValue(f["획득처"]) && <span className="equip-from">📍 {f["획득처"]}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
