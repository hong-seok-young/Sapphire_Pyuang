import { useState } from "react";
import type { Block, Cell, Run } from "./types";
import { cafeUrl, isBigPicture } from "./cafe";

type PostLink = (postId: string) => string | null;

const runsOf = (b: Block): Run[] => (b.k === "p" ? b.r : b.rows.flatMap((row) => row.flatMap((c) => c.l.flat())));
const hasBigPicture = (b: Block) => runsOf(b).some((r) => "src" in r && isBigPicture(r.w, r.h));
/** 그림을 뺀 뒤 남은 글이 그림 안내뿐인지 ('지도 클릭 시 고화질 확대' 같은) */
const onlyPictureNote = (b: Block) =>
  runsOf(b)
    .filter((r) => !("src" in r))
    .map((r) => ("t" in r ? r.t : ""))
    .join("")
    .replace(/\(?\s*지도\s*클릭[^)]*\)?/g, "")
    .trim() === "";

/**
 * 카페 원글로 가는 카드 (제작자 요청: 직접 만든 지도, 스샷, 공략은 원글에서 본다).
 * 누르면 '카페 원글로 이동해요' 안내가 그 자리에 뜨고, '이동'을 누르면 원글이 열린다 (앱과 홈 화면 웹앱은 브라우저나 카페 앱으로)
 */
export function CafeLink({ postId, what, title }: { postId: string; what: string; title?: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="cafe-link">
      <div className="cafe-link-head">
        <span className="cafe-link-icon">{what === "지도" ? "🗺️" : what === "공략" ? "📜" : "🖼️"}</span>
        <span className="cafe-link-text">
          <b>{title ?? what}</b>
          <small>길드원이 직접 만든 {what}라 아이모 카페 원글에서 봐요</small>
        </span>
        {!asking && (
          <button className="pill" onClick={() => setAsking(true)}>
            원글 보기
          </button>
        )}
      </div>
      {asking && (
        <div className="cafe-link-ask">
          <p>아이모 카페 원글로 이동해요. 원글의 '{what}' 부분을 보세요.</p>
          <div className="cafe-link-buttons">
            <a className="pill pill-on" href={cafeUrl(postId)} target="_blank" rel="noopener noreferrer" onClick={() => setAsking(false)}>
              이동
            </a>
            <button className="pill" onClick={() => setAsking(false)}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 원글의 문단과 표를 그대로 보여 준다. 글쓴이가 쓴 색이 살도록 종이색 바탕 위에 그린다.
 * link 는 원글 속 다른 글 링크가 갈 위키 주소를 준다 (data.ts postLink).
 * 큰 그림(이어 붙인 지도, 스샷)은 앱에 띄우지 않고 그 자리에 카페 원글 카드를 둔다 (postId 가 있을 때, 제작자 요청)
 */
export function Blocks({ blocks, link, postId, what = "그림" }: { blocks: Block[]; link: PostLink; postId?: string; what?: string }) {
  return (
    <div className="paper">
      {blocks.map((b, i) => {
        const big = !!postId && hasBigPicture(b);
        if (big && onlyPictureNote(b)) return <CafeLink key={i} postId={postId!} what={what} />;
        const body =
          b.k === "p" ? (
            <p className="paper-p" key={i}>
              <Runs runs={b.r} link={link} hideBig={big} />
            </p>
          ) : (
            <div className="paper-table-wrap" key={i}>
              <table className="paper-table">
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <CellView key={c} cell={cell} link={link} hideBig={big} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return big ? (
          <div key={i}>
            {body}
            <CafeLink postId={postId!} what={what} />
          </div>
        ) : (
          body
        );
      })}
    </div>
  );
}

function CellView({ cell, link, hideBig }: { cell: Cell; link: PostLink; hideBig?: boolean }) {
  return (
    <td colSpan={cell.cs} rowSpan={cell.rs} style={cell.bg ? { background: cell.bg } : undefined}>
      {cell.l.map((line, i) => (
        <div className="paper-line" key={i}>
          {line.length ? <Runs runs={line} link={link} hideBig={hideBig} /> : " "}
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

export function Runs({ runs, link, hideBig }: { runs: Run[]; link: PostLink; hideBig?: boolean }) {
  return (
    <>
      {runs.map((r, i) => {
        let node;
        if ("src" in r && hideBig && isBigPicture(r.w, r.h)) return null; // 원글 카드가 대신한다
        if ("t" in r && hideBig && /지도\s*클릭/.test(r.t)) return null;
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
