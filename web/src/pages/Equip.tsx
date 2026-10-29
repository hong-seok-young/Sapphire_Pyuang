import { useState } from "react";
import type { Wiki } from "../types";
import { PicImg, TopBar, NotFound } from "../ui";
import { cafeUrl } from "../data";

export function EquipSlots({ wiki }: { wiki: Wiki }) {
  return (
    <>
      <TopBar title="장비" />
      <nav className="tiles tiles-3">
        {wiki.equipment.map((e) => (
          <a key={e.slot} className="tile" href={"#/equip/" + encodeURIComponent(e.slot)}>
            <span className="tile-icon">
              <PicImg pic={e.rows.find((r) => r.icon)?.icon} scale={2} max={32} />
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
  const col = (name: string) => table.headers.indexOf(name);
  const jobCol = col("직업");
  const shown = table.rows.filter((r) => job === "전체" || jobCol < 0 || (r.cells[jobCol] ?? "").includes(job));
  const statCols = table.headers
    .map((h, i) => [h, i] as const)
    .filter(([h]) => !["이미지", "아이템명", "직업", "옵션", "획득처", "레벨제한"].includes(h));

  return (
    <>
      <TopBar title={slot} />
      {jobCol >= 0 && (
        <div className="filter">
          {JOBS.map((j) => (
            <button key={j} className={"pill" + (j === job ? " pill-on" : "")} onClick={() => setJob(j)}>
              {j}
            </button>
          ))}
        </div>
      )}
      <ul className="equip-list">
        {shown.map((r, i) => (
          <li key={r.name + i}>
            <a className="equip card" href={"#/item/" + encodeURIComponent(r.name)}>
              <span className="equip-icon">
                <PicImg pic={r.icon ?? wiki.items[r.name]?.icon} scale={2} max={48} />
              </span>
              <span className="equip-main">
                <span className="equip-name">
                  {r.name} {col("레벨제한") >= 0 && <span className="lv">Lv.{r.cells[col("레벨제한")]}</span>}
                </span>
                <span className="equip-stats">
                  {statCols.map(([h, i]) => r.cells[i] && r.cells[i] !== "-" && <span key={h}>{h} {r.cells[i]}</span>)}
                  {jobCol >= 0 && <span>{r.cells[jobCol]}</span>}
                </span>
                {col("옵션") >= 0 && r.cells[col("옵션")] && r.cells[col("옵션")] !== "-" && (
                  <span className="equip-opt">{r.cells[col("옵션")]}</span>
                )}
                {col("획득처") >= 0 && r.cells[col("획득처")] && <span className="equip-from">📍 {r.cells[col("획득처")]}</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <div className="links">
        <a className="btn" href={"#/post/" + table.post}>원글 표 그대로 보기</a>
        <a className="btn btn-ghost" href={cafeUrl(table.post)} target="_blank" rel="noreferrer">카페에서 보기</a>
      </div>
    </>
  );
}
