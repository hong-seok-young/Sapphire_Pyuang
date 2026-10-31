import { useCallback } from "react";
import type { Wiki } from "../types";
import { TopBar, Loading, NotFound } from "../ui";
import { Blocks, OriginalLink } from "../Blocks";
import { loadPosts, postLink, useAsync } from "../data";
import { isGuidePost } from "../cafe";

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
        <OriginalLink postId={id} title={title} />
      </>
    );
  }
  return (
    <>
      <TopBar title={title} />
      <OriginalLink postId={id} />
      <Blocks blocks={post.blocks} link={postLink(wiki, posts)} postId={id} />
    </>
  );
}
