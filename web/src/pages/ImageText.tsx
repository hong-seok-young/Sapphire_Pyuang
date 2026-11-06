import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * 공식 글 그림 속 표·글자 (scripts/read-official-images.mjs 가 옮긴 글: 마크다운 표, '- ' 줄, '(빨간 글씨)', '~~취소선~~').
 * 공식 글 화면의 그림 아래 '글자로 보기'와 아이템 화면의 '이벤트에서 얻기'가 쓴다 (제작자 2026-11-06 '시너지 다 하자').
 * 직업마다 표가 따로 있으면(직업이 전사일 경우 …) 직업 탭으로 묶고 내 직업을 앞에 둔다
 */
const JOBS = ["전사", "레인저", "마법사", "무도가"] as const;
const RED = /\s*\(빨간 글씨\)/g;

const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c));

/** 찾는 이름이 든 칸 (아이템 화면: 그 아이템 칸을 금색으로) */
const bare = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const marks = (cell: string, mark: string | undefined) => !!mark && bare(cell).includes(bare(mark));

/** 굵게(**), 취소선(~~), 빨간 글씨 */
function inline(text: string, key: string): ReactNode {
  const red = RED.test(text);
  RED.lastIndex = 0;
  const t = text.replace(RED, "");
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|~~([^~]+)~~/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(t))) {
    if (m.index > last) parts.push(t.slice(last, m.index));
    parts.push(m[1] !== undefined ? <b key={`${key}b${n++}`}>{m[1]}</b> : <s key={`${key}s${n++}`}>{m[2]}</s>);
    last = m.index + m[0].length;
  }
  if (last < t.length) parts.push(t.slice(last));
  return red ? <span className="it-red">{parts}</span> : parts;
}

function blocksOf(lines: string[], base: string, mark?: string): ReactNode[] {
  const out: ReactNode[] = [];
  let table: string[][] | null = null;
  let list: ReactNode[] | null = null;
  const flush = (i: number) => {
    if (list) out.push(<ul key={`${base}l${i}`} className="it-list">{list}</ul>);
    list = null;
    if (table) {
      const rows = table.filter((r) => !isRule(r));
      table = null;
      if (rows.length) {
        const [head, ...body] = rows;
        const cols = Math.max(...rows.map((r) => r.length));
        out.push(
          <div key={`${base}t${i}`} className="ans-table it-table">
            <table>
              <thead>
                <tr>
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c}>{inline(head[c] ?? "", `${base}h${i}${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: cols }, (_, c) => (
                      <td key={c} className={marks(r[c] ?? "", mark) ? "it-mark" : undefined}>
                        {inline(r[c] ?? "", `${base}r${i}-${ri}-${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (isTableLine(line)) {
      if (list) flush(i);
      (table ??= []).push(cellsOf(line));
      return;
    }
    if (table) flush(i);
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    if (bullet) {
      (list ??= []).push(<li key={`${base}i${i}`}>{inline(bullet[1], `${base}i${i}`)}</li>);
      return;
    }
    flush(i);
    if (!line.trim()) return;
    const head = line.match(/^#{1,4}\s+(.*)$/);
    out.push(
      head ? (
        <b key={`${base}h${i}`} className="it-h">
          {inline(head[1], `${base}h${i}`)}
        </b>
      ) : (
        <p key={`${base}p${i}`} className="it-p">
          {inline(line, `${base}p${i}`)}
        </p>
      ),
    );
  });
  flush(lines.length);
  return out;
}

/** 직업 하나만 든 짧은 머리 줄 (바로 아래에 표가 온다) */
function jobHead(lines: string[], i: number): string | null {
  const l = lines[i].trim();
  if (!l || isTableLine(l) || l.length > 40) return null;
  const jobs = JOBS.filter((j) => l.includes(j));
  if (jobs.length !== 1) return null;
  for (let k = i + 1; k < Math.min(lines.length, i + 4); k++) if (isTableLine(lines[k])) return jobs[0];
  return null;
}

function JobTabs({ panels, job }: { panels: { name: string; nodes: ReactNode[] }[]; job: string | null }) {
  const first = Math.max(0, panels.findIndex((p) => p.name === job));
  const [on, setOn] = useState(first);
  const cur = panels[Math.min(on, panels.length - 1)];
  return (
    <div className="ans-tabs it-tabs">
      <div className="ans-tabs-bar" role="tablist">
        {panels.map((p, i) => (
          <button key={p.name} role="tab" aria-selected={i === on} className={"ans-tab" + (i === on ? " ans-tab-on" : "")} onClick={() => setOn(i)}>
            {p.name}
            {p.name === job && <small className="it-mine">내 직업</small>}
          </button>
        ))}
      </div>
      <div className="ans-tabs-body" role="tabpanel">
        {cur?.nodes}
      </div>
    </div>
  );
}

/** 찾은 칸이 표 오른쪽에 가려 있으면 그 칸이 보이게 표를 옆으로 민다 (첫 칸은 고정이라 그 폭만큼 덜) */
function useShowMark(mark: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!mark) return;
    for (const wrap of ref.current?.querySelectorAll<HTMLElement>(".it-table") ?? []) {
      const cell = wrap.querySelector<HTMLElement>("td.it-mark:not(:first-child)");
      const first = wrap.querySelector<HTMLElement>("td:first-child");
      if (!cell) continue;
      const right = cell.offsetLeft + cell.offsetWidth;
      if (right > wrap.clientWidth) wrap.scrollLeft = Math.max(0, cell.offsetLeft - (first?.offsetWidth ?? 0) - 8);
    }
  });
  return ref;
}

export function ImageText({ text, job, mark }: { text: string; job: string | null; mark?: string }) {
  const ref = useShowMark(mark);
  const lines = text.replace(/\r/g, "").split("\n");
  const heads = lines.map((_, i) => jobHead(lines, i));
  const starts = heads.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
  const names = [...new Set(starts.map((i) => heads[i]!))];
  if (names.length < 2)
    return (
      <div className="it" ref={ref}>
        {blocksOf(lines, "a", mark)}
      </div>
    );
  // 직업마다 탭: 첫 직업 머리 앞은 위에, 그 뒤는 직업마다 (같은 직업 머리가 또 나오면 그 탭에 이어 붙인다), 내 직업이 앞
  const pre = lines.slice(0, starts[0]);
  const byJob = new Map<string, string[]>();
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const name = heads[s]!;
    byJob.set(name, [...(byJob.get(name) ?? []), ...lines.slice(s, end)]);
  });
  const order = [...names].sort((a, b) => (a === job ? -1 : b === job ? 1 : 0));
  const panels = order.map((name, k) => ({ name, nodes: blocksOf(byJob.get(name)!, `j${k}`, mark) }));
  return (
    <div className="it" ref={ref}>
      {blocksOf(pre, "pre", mark)}
      <JobTabs panels={panels} job={job} />
    </div>
  );
}
