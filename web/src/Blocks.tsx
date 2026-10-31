import type { ReactNode } from "react";
import type { Block, Cell, Run } from "./types";
import { cafeUrl, isBigPicture } from "./cafe";

type PostLink = (postId: string) => string | null;

const runsOf = (b: Block): Run[] => (b.k === "p" ? b.r : b.rows.flatMap((row) => row.flatMap((c) => c.l.flat())));

/**
 * 원글의 글자색: 밝은 종이 위에 쓴 색이라 어두운 바탕(앱)에서 안 보이는 어두운 색은 버리고(앱 글자색), 빨강·주황 같은 강조색만 남긴다
 * (제작자 요청: 원글에서 따온 듯한 모양 말고 우리 앱 모양으로)
 */
function appColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  let r = 0, g = 0, b = 0;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const rgb = c.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) {
    [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
  } else return undefined;
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const saturated = Math.max(r, g, b) - Math.min(r, g, b) > 90;
  return light >= 0.5 || (saturated && light >= 0.3) ? c : undefined;
}

/** 옆 사냥터로 가는 줄 (◀ 왼쪽 칸 | 오른쪽 칸 ▶): 링크만 모아 단추로 */
function navLinks(b: Block, link: PostLink): { left: { label: string; to: string }[]; right: { label: string; to: string }[] } | null {
  if (b.k !== "table" || b.rows.length !== 1 || b.rows[0].length !== 2) return null;
  const all = runsOf(b).map((r) => ("t" in r ? r.t : "")).join("");
  if (!/[◀▶]/.test(all)) return null;
  const side = (i: number) =>
    b.rows[0][i].l
      .map((line) => {
        const r = line.find((x) => "to" in x && x.to && "t" in x && x.t.trim());
        const to = r && r.to?.startsWith("post:") ? link(r.to.slice(5)) : null;
        const label = line.map((x) => ("t" in x ? x.t : "")).join("").replace(/[◀▶️\s]+/g, " ").trim();
        return to && label ? { label, to } : null;
      })
      .filter((x): x is { label: string; to: string } => x !== null);
  const left = side(0);
  const right = side(1);
  return left.length || right.length ? { left, right } : null;
}
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
 * 화면 맨 위 '원글 보기' 줄, 글마다 하나 (제작자 요청 2026-11-01: '그림은 원글 봐라, 지도는 원글 봐라' 말고 원글 보기 하나만).
 * 누르면 바로 카페 원글이 새 창으로. title: 공략 글처럼 글 전체를 원글에서 볼 때 제목
 */
export function OriginalLink({ postId, title }: { postId: string; title?: string }) {
  return (
    <a className="orig-link" href={cafeUrl(postId)} target="_blank" rel="noopener noreferrer">
      <span>📄 {title ?? "카페 원글"}</span>
      <b>원글 보기 ↗</b>
    </a>
  );
}

/**
 * 원글의 문단과 표를 그대로 보여 준다. 글쓴이가 쓴 색이 살도록 종이색 바탕 위에 그린다.
 * link 는 원글 속 다른 글 링크가 갈 위키 주소를 준다 (data.ts postLink).
 * 큰 그림(이어 붙인 지도, 스샷)은 앱에 띄우지 않는다 (postId 가 있을 때). 원글 링크는 화면 맨 위 '원글 보기' 하나뿐이다
 * (제작자 요청 2026-11-01: '원글 보기는 하나만 해도 되지 않냐', 그림·지도 자리마다 달았던 줄은 뺐다)
 */
export function Blocks({ blocks, link, postId }: { blocks: Block[]; link: PostLink; postId?: string }) {
  return (
    <div className="paper">
      {blocks.map((b, i) => {
        const nav = navLinks(b, link);
        if (nav) {
          return (
            <nav className="post-nav" key={i}>
              <span>
                {nav.left.map((n) => (
                  <a key={n.to} className="pill" href={n.to}>
                    ◀ {n.label}
                  </a>
                ))}
              </span>
              <span className="post-nav-right">
                {nav.right.map((n) => (
                  <a key={n.to} className="pill" href={n.to}>
                    {n.label} ▶
                  </a>
                ))}
              </span>
            </nav>
          );
        }
        const big = !!postId && hasBigPicture(b);
        if (big && onlyPictureNote(b)) return null; // 그림뿐인 칸은 통째로 뺀다
        return b.k === "p" ? (
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
      })}
    </div>
  );
}

function CellView({ cell, link, hideBig }: { cell: Cell; link: PostLink; hideBig?: boolean }) {
  return (
    <td colSpan={cell.cs} rowSpan={cell.rs}>
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

/** 아이템 아이콘으로 보는 작은 그림 (build_data.py 의 ICON_SIDE 와 같다. 흰 바탕을 빼고 여백을 잘라 둔다) */
const ICON_SIDE = 64;
/** 아이콘은 모두 이 높이로 (제작자 요청: 크기 통일) */
const ICON_H = 26;
const isIcon = (r: Run) => "src" in r && Math.max(r.w, r.h) <= ICON_SIDE;

export function Runs({ runs, link, hideBig }: { runs: Run[]; link: PostLink; hideBig?: boolean }) {
  const textNode = (r: { t: string; b?: 1; c?: string }, t: string) => {
    const color = appColor(r.c);
    const style = color ? { color } : undefined;
    return r.b ? <b style={style}>{t}</b> : style ? <span style={style}>{t}</span> : t;
  };
  const out: ReactNode[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    let node: ReactNode;
    if ("src" in r && hideBig && isBigPicture(r.w, r.h)) continue; // 원글에서 본다 (화면 맨 위 '원글 보기')
    if ("t" in r && hideBig && /지도\s*클릭/.test(r.t)) continue;
    if ("src" in r) {
      const icon = isIcon(r);
      const h = icon ? ICON_H : r.h;
      const w = icon ? Math.round((r.w * ICON_H) / r.h) : r.w;
      node = <img className={icon ? "inline-icon" : "inline-pic"} src={r.src} width={w} height={h} alt="" loading="lazy" decoding="async" />;
      // 아이콘과 바로 뒤의 이름(첫 낱말, 예: '코스튬코인x30')은 한 덩어리로 (제작자 요청: 줄이 그 사이에서 끊기지 않게)
      const next = runs[i + 1];
      if (icon && !r.to && next && "t" in next && !next.to) {
        const m = next.t.match(/^(\s*)(\S+)([\s\S]*)$/);
        if (m && m[2].length <= 24) {
          out.push(
            <span key={i} className="post-ing">
              {node}
              {textNode(next, m[2])}
            </span>,
          );
          if (m[3]) out.push(<span key={i + "r"}>{textNode(next, m[3])}</span>);
          i++;
          continue;
        }
      }
    } else {
      node = textNode(r, r.t);
    }
    const to = r.to ? href(r.to, link) : null;
    if (!to) {
      out.push(<span key={i}>{node}</span>);
      continue;
    }
    out.push(
      <a key={i} href={to.href} target={to.external ? "_blank" : undefined} rel={to.external ? "noreferrer" : undefined}>
        {node}
      </a>,
    );
  }
  return <>{out}</>;
}
