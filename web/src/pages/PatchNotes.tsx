import { useEffect, useState } from "react";
import { extraPatchLines } from "../fix";
import { PATCHES } from "../patchnotes";
import { TopBar } from "../ui";

/** 패치 내역 (#/patch, 제작자 요청): 처음 버전부터 지금까지, 새 버전이 위.
 *  개선 접수에서 '고침'을 누르면 그 한 줄이 그 판에 저절로 더해진다 (제작자 2026-11-18 '고친 뒤 처리는 쓴 사람 + 패치 내역', /api/fix/patch) */
export function PatchNotesPage() {
  const [extra, setExtra] = useState<{ version: string; text: string }[]>([]);
  useEffect(() => {
    void extraPatchLines().then(setExtra);
  }, []);
  return (
    <>
      <TopBar title="패치 내역" />
      <ol className="patch-list">
        {PATCHES.map((p, i) => {
          const more = extra.filter((x) => x.version === p.version && !p.items.includes(x.text)).map((x) => x.text);
          return (
            <li key={p.version} className={"panel patch" + (i === 0 ? " patch-now" : "")}>
              <h2 className="patch-head">
                <b>v{p.version}</b>
                {i === 0 && <span className="patch-tag">지금</span>}
                <small>{p.date}</small>
              </h2>
              <ul>
                {[...p.items, ...more].map((t, j) => (
                  <li key={j}>{t}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </>
  );
}
