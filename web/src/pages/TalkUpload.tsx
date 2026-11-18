// 톡방 올리기 (#/talk, 앱개발자·길드마스터. 제작자 2026-11-18 '오픈톡방 대화 내보내기를 정기적으로', '깃 아이모 데이터에 쌓이게, 이전 톡방 일자 이후 것만',
// '여러 개 선택해서 올리게', '공유 사파이어 이딴 건 없어 카톡에'): 카톡 '대화 내보내기 → 텍스트만 저장'으로 폰에 저장한 파일을 여러 개 골라 한 번에 올린다.
// 올린 글은 서버(D1)에 잠깐 두었다가 자료 저장소(sapphire-imo-data)의 Actions(talk-import.yml, scripts/talk_import.mjs, 매시 7분 또는 세션이 바로 돌림)가
// 자료 저장소 카톡/ 에 그 방의 마지막 날짜부터의 글만 더하고 서버의 것은 지운다. 그 뒤 세션이 새 글을 읽어 시세 동향 답(시세/톡방_AI.json)을 더한다
import { useEffect, useRef, useState } from "react";
import { fileTexts, listTalkUploads, oneEachRoom, readTalk, uploadTalk } from "../talk";
import type { TalkFile, TalkUploadRow } from "../talk";
import { Loading, TopBar } from "../ui";

const STATUS: Record<TalkUploadRow["status"], string> = { wait: "기다림", done: "올림", same: "새 글 없음", fail: "실패" };
const fmtDay = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "?");
const fmtSize = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1000))}KB`);
const when = (t: number) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function TalkUploadPage() {
  const [files, setFiles] = useState<TalkFile[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const [rows, setRows] = useState<TalkUploadRow[] | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  const load = () => listTalkUploads().then((r) => setRows(r.uploads), () => setRows([]));
  useEffect(() => {
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 30_000);
    return () => window.clearInterval(t);
  }, []);

  async function open(list: File[]) {
    setSent(0);
    setError("");
    const got: TalkFile[] = [...files];
    let bad = 0;
    for (const f of list) {
      const texts = await fileTexts(f.name, f).catch(() => []);
      const read = texts.map((t) => readTalk(t.name, t.text)).filter((x): x is TalkFile => !!x);
      if (!read.length) bad++;
      got.push(...read);
    }
    setFiles(oneEachRoom(got));
    if (bad) setError(`카카오톡 대화 내보내기 글이 아닌 파일 ${bad}개는 뺐어요`);
  }

  async function sendAll() {
    if (!files.length || busy) return;
    setError("");
    let n = 0;
    const left: TalkFile[] = [];
    for (const f of files) {
      setBusy(f.title);
      try {
        await uploadTalk(f);
        n++;
      } catch (e) {
        left.push(f);
        setError(`${f.title}: ${e instanceof Error ? e.message : "올리지 못했어요"}`);
      }
    }
    setBusy(null);
    setFiles(left);
    setSent(n);
    void load();
  }

  return (
    <>
      <TopBar title="톡방 올리기" />
      <p className="tu-how">카톡 방 ≡ → 설정 → 대화 내보내기 → 텍스트만 저장 → 아래 파일 고르기 (여러 개 한 번에)</p>
      {files.length > 0 && (
        <div className="panel tu-file">
          <ul className="tu-list">
            {files.map((f) => (
              <li key={f.title} className="tu-row">
                <span className="tu-row-main">
                  <b className="tu-title">{f.title}</b>
                  <small>
                    {fmtDay(f.first)} ~ {fmtDay(f.last)} · 글 {f.lines.toLocaleString()} · {fmtSize(f.size)}
                    {busy === f.title ? " · 올리는 중…" : ""}
                  </small>
                </span>
                <button className="pill tu-x" disabled={!!busy} onClick={() => setFiles(files.filter((x) => x !== f))}>
                  빼기
                </button>
              </li>
            ))}
          </ul>
          <div className="pill-row">
            <button className="pill" disabled={!!busy} onClick={() => pick.current?.click()}>
              더 고르기
            </button>
            <button className="pill pill-on" disabled={!!busy} onClick={sendAll}>
              {busy ? "올리는 중…" : `모두 올리기 (${files.length})`}
            </button>
          </div>
        </div>
      )}
      {sent > 0 && <p className="tu-sent">{sent}개 올렸어요 · 한 시간 안에 자료 저장소에 새 날짜 것만 더해져요</p>}
      {error && <p className="form-error">{error}</p>}
      {!files.length && (
        <button className="btn tu-pick" onClick={() => pick.current?.click()}>
          파일 고르기
        </button>
      )}
      <input
        ref={pick}
        type="file"
        multiple
        accept=".txt,.zip,text/plain,application/zip"
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          if (list.length) void open(list);
        }}
      />
      <h3 className="tu-h">올린 기록</h3>
      {rows === null && <Loading />}
      {rows?.length === 0 && <p className="muted">아직 없어요</p>}
      <ul className="tu-list">
        {rows?.map((r) => (
          <li key={r.id} className="tu-row">
            <span className={"tu-st tu-st-" + r.status}>{STATUS[r.status]}</span>
            <span className="tu-row-main">
              <b>{r.title ?? r.name ?? "톡방"}</b>
              <small>
                {fmtDay(r.first_day)} ~ {fmtDay(r.last_day)} · {when(r.created_at)}
                {r.note ? ` · ${r.note}` : ""}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
