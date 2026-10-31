import { useCallback } from "react";
import type { Wiki } from "../types";
import { TopBar, Loading, NotFound } from "../ui";
import { Blocks, CafeLink } from "../Blocks";
import { loadPosts, postLink, useAsync } from "../data";
import { isGuidePost } from "../cafe";

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

export function PostPage({ wiki, id }: { wiki: Wiki; id: string }) {
  const { data: posts, error } = useAsync(useCallback(() => loadPosts(), []));
  if (!posts) return <Loading error={error} />;
  const post = posts[id];
  if (!post) return <NotFound what="글" />;
  const title = post.title.replace(/\s*_ReMAKE$/, "");
  // 직접 쓴 공략 글은 앱에 띄우지 않고 카페 원글에서 본다 (제작자 요청. 챗봇은 그대로 이 자료로 답한다)
  if (isGuidePost(wiki, id)) {
    return (
      <>
        <TopBar title={title} />
        <CafeLink postId={id} what="공략" title={title} />
      </>
    );
  }
  return (
    <>
      <TopBar title={title} />
      <Blocks blocks={post.blocks} link={postLink(wiki, posts)} postId={id} what={/지도/.test(title) ? "지도" : "그림"} />
    </>
  );
}
