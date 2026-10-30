import type { Block, Cell, Run } from "./types";

/** 원글의 문단과 표를 그대로 보여 준다. 글쓴이가 쓴 색이 살도록 종이색 바탕 위에 그린다 */
export function Blocks({ blocks, known }: { blocks: Block[]; known: (postId: string) => boolean }) {
  return (
    <div className="paper">
      {blocks.map((b, i) =>
        b.k === "p" ? (
          <p className="paper-p" key={i}>
            <Runs runs={b.r} known={known} />
          </p>
        ) : (
          <div className="paper-table-wrap" key={i}>
            <table className="paper-table">
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <CellView key={c} cell={cell} known={known} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  );
}

function CellView({ cell, known }: { cell: Cell; known: (postId: string) => boolean }) {
  return (
    <td colSpan={cell.cs} rowSpan={cell.rs} style={cell.bg ? { background: cell.bg } : undefined}>
      {cell.l.map((line, i) => (
        <div className="paper-line" key={i}>
          {line.length ? <Runs runs={line} known={known} /> : " "}
        </div>
      ))}
    </td>
  );
}

/** 원글 속 링크. 위키에 있는 글이면 그 글로 가고, 위키에 없는 카페 글은 글자만 보인다 (카페로 나가지 않는다) */
function href(to: string, known: (postId: string) => boolean): { href: string; external: boolean } | null {
  if (to.startsWith("post:")) {
    const id = to.slice(5);
    return known(id) ? { href: "#/post/" + id, external: false } : null;
  }
  return { href: to, external: true };
}

export function Runs({ runs, known }: { runs: Run[]; known: (postId: string) => boolean }) {
  return (
    <>
      {runs.map((r, i) => {
        let node;
        if ("src" in r) {
          const small = r.h <= 24;
          node = (
            <img
              className={small ? "inline-icon" : "inline-pic"}
              src={r.src}
              width={small ? r.w * 2 : r.w}
              height={small ? r.h * 2 : r.h}
              alt=""
              loading="lazy"
              decoding="async"
            />
          );
        } else {
          const style = r.c ? { color: r.c } : undefined;
          node = r.b ? <b style={style}>{r.t}</b> : style ? <span style={style}>{r.t}</span> : r.t;
        }
        const link = r.to ? href(r.to, known) : null;
        if (!link) return <span key={i}>{node}</span>;
        return (
          <a key={i} href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined}>
            {node}
          </a>
        );
      })}
    </>
  );
}
