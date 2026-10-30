import { useCallback } from "react";
import type { Wiki } from "../types";
import { TopBar, Loading, NotFound } from "../ui";
import { Blocks } from "../Blocks";
import { loadPosts, postLink, useAsync } from "../data";

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
  return (
    <>
      <TopBar title={post.title.replace(/\s*_ReMAKE$/, "")} />
      <Blocks blocks={post.blocks} link={postLink(wiki, posts)} />
    </>
  );
}
