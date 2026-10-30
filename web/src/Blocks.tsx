import type { Block, Cell, Run } from "./types";

type PostLink = (postId: string) => string | null;

/**
 * 원글의 문단과 표를 그대로 보여 준다. 글쓴이가 쓴 색이 살도록 종이색 바탕 위에 그린다.
 * link 는 원글 속 다른 글 링크가 갈 위키 주소를 준다 (data.ts postLink).
 */
export function Blocks({ blocks, link }: { blocks: Block[]; link: PostLink }) {
  return (
    <div className="paper">
      {blocks.map((b, i) =>
        b.k === "p" ? (
          <p className="paper-p" key={i}>
            <Runs runs={b.r} link={link} />
          </p>
        ) : (
          <div className="paper-table-wrap" key={i}>
            <table className="paper-table">
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <CellView key={c} cell={cell} link={link} />
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

function CellView({ cell, link }: { cell: Cell; link: PostLink }) {
  return (
    <td colSpan={cell.cs} rowSpan={cell.rs} style={cell.bg ? { background: cell.bg } : undefined}>
      {cell.l.map((line, i) => (
        <div className="paper-line" key={i}>
          {line.length ? <Runs runs={line} link={link} /> : " "}
        </div>
      ))}
    </td>
  );
}

/** 원글 속 링크. 다른 글이면 위키 안으로 가고, 위키에 없는 카페 글은 글자만 보인다 (카페로 나가지 않는다) */
function href(to: string, link: PostLink): { href: string; external: boolean } | null {
  if (to.startsWith("post:")) {
    const target = link(to.slice(5));
    return target ? { href: target, external: false } : null;
  }
  return { href: to, external: true };
}

export function Runs({ runs, link }: { runs: Run[]; link: PostLink }) {
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
        const to = r.to ? href(r.to, link) : null;
        if (!to) return <span key={i}>{node}</span>;
        return (
          <a key={i} href={to.href} target={to.external ? "_blank" : undefined} rel={to.external ? "noreferrer" : undefined}>
            {node}
          </a>
        );
      })}
    </>
  );
}
