// 계정 지우기 (길드원 관리의 '계정 삭제'와, 본인이 '내 정보'에서 요청한 계정 삭제를 운영진이 승낙할 때 같이 쓴다)
// 본캐를 지우는데 부캐가 있으면 가장 먼저 묶은 부캐가 본캐가 되고 비밀번호를 이어받는다. 기록은 그 사람 것만 지우고 길드 장부(장비대여)는 남긴다
import type { Env } from "./auth";
import { eachLog } from "./logdb";

export async function deleteAccountData(env: Env, user: { id: string; main_id: string | null }): Promise<void> {
  // 본캐를 지우는데 부캐가 있으면: 가장 먼저 묶은 부캐가 본캐가 되고 비밀번호를 이어받는다 (그 사람은 새 본캐 아이디로 로그인)
  const heir = user.main_id
    ? null
    : await env.DB.prepare("SELECT id FROM users WHERE main_id = ? ORDER BY created_at LIMIT 1").bind(user.id).first<{ id: string }>();
  const promote = heir
    ? [
        env.DB.prepare(
          "UPDATE users SET main_id = NULL, pw_hash = (SELECT pw_hash FROM users WHERE id = ?1), pw_salt = (SELECT pw_salt FROM users WHERE id = ?1), " +
            "pw_iter = (SELECT pw_iter FROM users WHERE id = ?1), must_change = (SELECT must_change FROM users WHERE id = ?1) WHERE id = ?2",
        ).bind(user.id, heir.id),
        env.DB.prepare("UPDATE users SET main_id = ? WHERE main_id = ?").bind(heir.id, user.id),
        env.DB.prepare("UPDATE signup_requests SET owner = ? WHERE owner = ?").bind(heir.id, user.id),
      ]
    : [env.DB.prepare("DELETE FROM signup_requests WHERE owner = ?").bind(user.id)];
  await env.DB.batch([
    ...promote,
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM level_log WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM level_log_archive WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM activity WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM alerts WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM alert_prefs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM push_subs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM cutout_log WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM favorites WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM bday_combo WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM bday_resume WHERE user_id = ?").bind(user.id),
    // 운영진 때리기: 그 사람이 때린 기록과 그 사람이 맞은 기록 (본캐를 지워 부캐가 이어받으면 맞은 기록은 새 본캐로)
    env.DB.prepare("DELETE FROM smack_stats WHERE hitter = ?").bind(user.id),
    env.DB.prepare("DELETE FROM gc_targets WHERE user_id = ?").bind(user.id),
    // 기부함: 확인 전 신청만 지우고 확정한 기부와 마일리지 장부는 남긴다 (장비대여 장부와 같다, 같은 닉네임으로 다시 오면 이어진다)
    env.DB.prepare("DELETE FROM donate_items WHERE created_by = ? AND status = 'request'").bind(user.id),
    ...(heir ? [env.DB.prepare("UPDATE OR IGNORE smack_stats SET target = ? WHERE target = ?").bind(heir.id, user.id)] : []),
    env.DB.prepare("DELETE FROM smack_stats WHERE target = ?").bind(user.id),
    env.DB.prepare("DELETE FROM todo_checks WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM todo_custom WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM todo_edits WHERE user_id = ?").bind(user.id),
    // 함께 하는 할 일: 그 사람이 만든 것은 끄고, 다른 사람 것에서는 빠진다
    env.DB.prepare("DELETE FROM todo_share_members WHERE user_id = ? OR share_id IN (SELECT id FROM todo_shares WHERE owner = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM todo_shares WHERE owner = ?").bind(user.id),
    // 장비대여: 기다리는 신청과 대화창의 그 사람 글만 지운다 (대여 기록과 마일리지 장부는 길드 장부라 남긴다, 같은 닉네임으로 다시 오면 이어진다)
    env.DB.prepare("DELETE FROM rental_requests WHERE user_id = ? AND status IN ('wait', 'ok')").bind(user.id),
    env.DB.prepare("DELETE FROM rental_talk WHERE user_id = ?").bind(user.id),
    // 개발 요청: 그 사람의 요청(결재 이력, 대화까지)과 다른 요청에 쓴 대화. 남의 요청에 남긴 결재 이력은 남긴다
    env.DB.prepare("DELETE FROM dev_request_steps WHERE req_id IN (SELECT id FROM dev_requests WHERE user_id = ?)").bind(user.id),
    env.DB.prepare("DELETE FROM dev_request_talk WHERE user_id = ? OR req_id IN (SELECT id FROM dev_requests WHERE user_id = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM dev_requests WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_msgs WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id = ?)").bind(user.id),
    env.DB.prepare("DELETE FROM chat_threads WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_gaps WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM plat_wallets WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM layouts WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM chat_usage WHERE user_id = ?").bind(user.id),
    // 게시판: 그 사람의 글(과 거기 딸린 사진, 댓글, 좋아요), 다른 글에 단 댓글과 좋아요
    env.DB.prepare("DELETE FROM board_files WHERE post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id),
    env.DB.prepare("DELETE FROM board_comments WHERE user_id = ? OR post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM board_likes WHERE user_id = ? OR post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM board_views WHERE user_id = ? OR post_id IN (SELECT id FROM board_posts WHERE author = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM official_comments WHERE user_id = ? OR parent_id IN (SELECT id FROM official_comments WHERE user_id = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM official_likes WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM official_views WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM board_posts WHERE author = ?").bind(user.id),
    env.DB.prepare(
      "DELETE FROM listing_wants WHERE user_id = ? OR listing_id IN (SELECT id FROM listings WHERE seller = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare(
      "DELETE FROM listing_bids WHERE user_id = ? OR listing_id IN (SELECT id FROM listings WHERE seller = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare(
      "DELETE FROM listing_talk WHERE user_id = ? OR listing_id IN (SELECT id FROM listings WHERE seller = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare("DELETE FROM listing_shots WHERE listing_id IN (SELECT id FROM listings WHERE seller = ?)").bind(user.id),
    env.DB.prepare("DELETE FROM listings WHERE seller = ?").bind(user.id),
    env.DB.prepare(
      "DELETE FROM gold_wants WHERE user_id = ? OR offer_id IN (SELECT id FROM gold_offers WHERE owner = ?)",
    ).bind(user.id, user.id),
    env.DB.prepare("DELETE FROM gold_offers WHERE owner = ?").bind(user.id),
    env.DB.prepare("DELETE FROM request_offers WHERE request_id IN (SELECT id FROM requests WHERE owner = ?)").bind(user.id),
    env.DB.prepare("DELETE FROM requests WHERE owner = ?").bind(user.id),
    // 의뢰소: 기다리던 내 수락은 포기로 (받은 것은 기록으로 남긴다)
    env.DB.prepare("UPDATE request_offers SET status = 'giveup' WHERE user_id = ? AND status = 'pledged'").bind(user.id),
    env.DB.prepare("DELETE FROM delete_requests WHERE user_id = ?").bind(user.id),
    // 길드 던전: 파티에서 빼고, 파티장이었으면 먼저 들어온 사람에게 넘긴다 (아무도 없으면 파티를 지운다)
    env.DB.prepare("DELETE FROM gd_members WHERE user_id = ?").bind(user.id),
    env.DB.prepare(
      "UPDATE gd_parties SET leader = COALESCE((SELECT m.user_id FROM gd_members m WHERE m.party_id = gd_parties.id ORDER BY m.joined_at LIMIT 1), leader) WHERE leader = ?",
    ).bind(user.id),
    env.DB.prepare("DELETE FROM gd_parties WHERE id NOT IN (SELECT party_id FROM gd_members)"),
    env.DB.prepare("DELETE FROM gd_avail WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM gd_answers WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sim_records WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sim_wallet WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sim_earn WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sim_feed WHERE user_id = ?").bind(user.id),
    // 헬스 루틴 (개인 운동 기록, server/fit.ts)
    ...["exercises", "routines", "workouts", "drafts"].map((t) => env.DB.prepare(`DELETE FROM fit_${t} WHERE user_id = ?`).bind(user.id)),
    ...["unlocks", "state", "t_records", "t_wallet", "t_earn", "t_feed", "t_unlocks", "t_state"].map((t) => env.DB.prepare(`DELETE FROM sim_${t} WHERE user_id = ?`).bind(user.id)),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  // 사용 기록 DB 2~10 의 그 사람 기록 (server/logdb.ts)
  await eachLog(env, "DELETE FROM activity WHERE user_id = ?", user.id);
}
