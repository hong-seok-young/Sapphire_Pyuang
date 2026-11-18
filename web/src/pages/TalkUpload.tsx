// 톡방 올리기 (#/talk, 앱개발자·길드마스터. 제작자 2026-11-18 '오픈톡방 대화 내보내기를 공유 한 번으로', '깃 아이모 데이터에 쌓이게, 이전 톡방 일자 이후 것만').
// 카톡 '대화 내보내기 → 공유 → Sapphire'(manifest share_target, public/sw.js) 로 오거나 파일을 골라 올린다.
// 올린 글은 30분 안에 GitHub Actions(scripts/talk-import.mjs)가 자료 저장소 카톡/ 에 새 날짜 것만 더하고, 그 뒤 배포가 시세 동향·챗봇에 넣는다
import { useEffect, useRef, useState } from "react";
import { fileText, listTalkUploads, readTalk, takeShared, uploadTalk } from "../talk";
import type { TalkFile, TalkUploadRow } from "../talk";
import { Loading, TopBar } from "../ui";

const STATUS: Record<TalkUploadRow["status"], string> = { wait: "기다림", done: "올림", same: "새 글 없음", fail: "실패" };
const fmtDay = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "?");
const fmtSize = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1000))}KB`);
const when = (t: number) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function TalkUploadPage({ query }: { query: URLSearchParams }) {
  const [file, setFile] = useState<TalkFile | null>(null);
  const [error, setError] = useState(query.get("sw") === "0" ? "공유로 받은 파일을 못 읽었어요 · 파일 고르기로 올려 주세요" : "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [rows, setRows] = useState<TalkUploadRow[] | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  const load = () => listTalkUploads().then((r) => setRows(r.uploads), () => setRows([]));
  async function open(name: string, blob: Blob) {
    setSent(false);
    setError("");
    const t = await fileText(name, blob).catch(() => null);
    const f = t && readTalk(t.name, t.text);
    if (!f) {
      setFile(null);
      setError("카카오톡 대화 내보내기 글이 아니에요");
      return;
    }
    setFile(f);
  }
  useEffect(() => {
    void load();
    if (query.get("shared"))
      void takeShared().then((s) => (s ? open(s.name, s.blob) : setError("공유로 받은 파일이 없어요 · 파일 고르기로 올려 주세요")));
    const t = window.setInterval(() => !document.hidden && void load(), 30_000);
    return () => window.clearInterval(t);
  }, []);

  async function send() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      await uploadTalk(file);
      setSent(true);
      setFile(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "올리지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="톡방 올리기" />
      <p className="tu-how">카톡 방 ≡ → 설정 → 대화 내보내기 → 텍스트만 → 공유 → Sapphire</p>
      {file && (
        <div className="panel tu-file">
          <b className="tu-title">{file.title}</b>
          <span className="tu-meta">
            {fmtDay(file.first)} ~ {fmtDay(file.last)} · 글 {file.lines.toLocaleString()} · {fmtSize(file.size)}
          </span>
          <div className="pill-row">
            <button className="pill" onClick={() => setFile(null)}>
              취소
            </button>
            <button className="pill pill-on" disabled={busy} onClick={send}>
              {busy ? "올리는 중…" : "올리기"}
            </button>
          </div>
        </div>
      )}
      {sent && <p className="tu-sent">올렸어요 · 30분 안에 자료 저장소에 새 날짜 것만 더해져요</p>}
      {error && <p className="form-error">{error}</p>}
      {!file && (
        <button className="btn tu-pick" onClick={() => pick.current?.click()}>
          파일 고르기
        </button>
      )}
      <input
        ref={pick}
        type="file"
        accept=".txt,.zip,text/plain,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void open(f.name, f);
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
