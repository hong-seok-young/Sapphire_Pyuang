import { PATCHES } from "../patchnotes";
import { TopBar } from "../ui";

/** 패치 내역 (#/patch, 제작자 요청): 처음 버전부터 지금까지, 새 버전이 위 */
export function PatchNotesPage() {
  return (
    <>
      <TopBar title="패치 내역" />
      <ol className="patch-list">
        {PATCHES.map((p, i) => (
          <li key={p.version} className={"panel patch" + (i === 0 ? " patch-now" : "")}>
            <h2 className="patch-head">
              <b>v{p.version}</b>
              {i === 0 && <span className="patch-tag">지금</span>}
              <small>{p.date}</small>
            </h2>
            <ul>
              {p.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </>
  );
}
