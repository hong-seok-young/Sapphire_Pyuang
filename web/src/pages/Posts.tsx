import { useCallback } from "react";
import type { Wiki } from "../types";
import { TopBar, Loading, NotFound } from "../ui";
import { Blocks } from "../Blocks";
import { loadPosts, useAsync } from "../data";

export function MenuPage({ wiki, title }: { wiki: Wiki; title: string }) {
  const sec = wiki.menu.find((m) => m.title === title);
  if (!sec) return <NotFound what="메뉴" />;
  return (
    <>
      <TopBar title={title} />
      <ul className="list">
        {sec.posts.map((p) => (
          <li key={p.id}>
            <a className="row" href={"#/post/" + p.id}>
              <span className="row-main">
                <span className="row-title">{p.title.replace(/\s*_ReMAKE$/, "")}</span>
              </span>
              <span className="row-arrow">▶</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PostPage({ id }: { id: string }) {
  const { data: posts, error } = useAsync(useCallback(() => loadPosts(), []));
  if (!posts) return <Loading error={error} />;
  const post = posts[id];
  if (!post) return <NotFound what="글" />;
  return (
    <>
      <TopBar title={post.title.replace(/\s*_ReMAKE$/, "")} />
      <Blocks blocks={post.blocks} known={(pid) => pid in posts} />
    </>
  );
}

export function Soon({ what }: { what: "chat" | "timer" }) {
  const text =
    what === "chat"
      ? {
          title: "AI 챗봇",
          body: "위키 자료로 육성법, 장비, 드랍 질문에 답하고, 갤러리에서 고른 게임 스샷을 보고 조언해 주는 챗봇이에요. 중계 서버와 API 키를 준비하면 열려요.",
        }
      : {
          title: "타이머",
          body: "보스 타이머와 매일 정해진 시각 알림이 들어올 자리예요. 안드로이드 앱에서는 게임 위 시계와 함께 쓸 수 있어요.",
        };
  return (
    <>
      <TopBar title={text.title} />
      <div className="soon">
        <div className="soon-badge">준비 중</div>
        <p>{text.body}</p>
      </div>
    </>
  );
}
