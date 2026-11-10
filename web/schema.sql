-- 길드 계정 (Cloudflare D1 데이터베이스 sapphire-accounts). 처음 한 번 실행한다:
--   npx wrangler d1 execute sapphire-accounts --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- 로그인 아이디 = 게임 닉네임
  role TEXT NOT NULL,                     -- developer | master | officer | member
  pw_hash TEXT NOT NULL,                  -- PBKDF2-SHA256 해시 (base64). 비밀번호 원문은 저장하지 않는다
  pw_salt TEXT NOT NULL,                  -- base64
  pw_iter INTEGER NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1, -- 임시 비밀번호면 1. 로그인하면 먼저 바꾸게 한다
  created_at INTEGER NOT NULL,
  created_by TEXT,
  high_spec INTEGER NOT NULL DEFAULT 0,   -- 고스펙 길드원 (길드마스터, 오피서가 표시. 플래티넘 상점에서 더 할인)
  push_perm TEXT,                         -- 폰 알림 허용 상태 (functions/api/alerts/device.ts): on / app_off / denied / ask / none
  push_at INTEGER,                        -- 그 상태를 마지막으로 확인한 때
  main_id TEXT,                           -- 부캐면 본캐 아이디 (부캐 묶기, 본캐 아이디와 비밀번호로 로그인). 본캐와 혼자인 계정은 비어 있다
  kakao TEXT                              -- 카톡 오픈프로필·1:1 오픈채팅 링크 (https://open.kakao.com/..., 본인이 내 정보에서, 운영진이 길드원 관리에서. 2026-11-02)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,            -- 로그인 쿠키 토큰의 SHA-256. 토큰 자체는 저장하지 않는다
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- 챗봇 하루 질문 수 (functions/api/chat.ts). day 는 한국 날짜 YYYY-MM-DD
CREATE TABLE IF NOT EXISTS chat_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- AI 기능을 하루에 몇 번 썼는지 (2026-11-02: 스샷 읽기 read_market / read_rental, 공지 다듬기 polish, functions/api/ai/read.ts, board/polish.ts)
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                      -- 한국 시간 'YYYY-MM-DD'
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);

-- 배포 때 한 번만 하는 일 기록 (web/scripts/ci-d1.mjs). starting_accounts: 시작 계정을 만들었다
CREATE TABLE IF NOT EXISTS setup (
  key TEXT PRIMARY KEY,
  done_at INTEGER NOT NULL
);

-- 길드원 직업과 레벨 (길드 랭킹). 본인이 '내 정보'에서 정하고, 오피서 이상은 다른 사람 것도 고친다
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  job TEXT NOT NULL,                      -- warrior 전사 | ranger 레인저 | mage 마법사 | monk 무도가
  level INTEGER NOT NULL,
  prev_level INTEGER,                     -- 레벨이 바뀌기 바로 전 레벨 (랭킹의 레벨업 표시)
  level_at INTEGER NOT NULL,              -- 레벨이 마지막으로 바뀐 때 (같은 레벨, 같은 경험치면 먼저 오른 사람이 위)
  updated_by TEXT,
  exp INTEGER,                            -- 경험치 % x 1000 (12.345% -> 12345). 본인만 적고 본인만 본다. 같은 레벨이면 높은 쪽이 위
  guild TEXT                              -- main 1군 Sapphire | second 2군 FairyTale. 처음 들어올 때 고르고 오피서 이상이 고친다
);
-- 나중에 더한 칸(exp, guild)은 이미 있던 DB 에 scripts/ci-d1.mjs 가 ALTER TABLE 로 넣는다

-- 레벨, 경험치를 적을 때마다 남기는 기록 (성장 랭킹: 오늘, 이번 주, 이번 달에 오른 만큼). server/auth.ts saveProfile
CREATE TABLE IF NOT EXISTS level_log (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  level INTEGER NOT NULL,
  exp INTEGER,                            -- 경험치 % x 1000. 안 적었으면 null (0 으로 센다)
  PRIMARY KEY (user_id, at)
);
-- level_log 에서 빠진 기록을 지우지 않고 옮겨 둔다 (제작자 요청 2026-11-01: 레벨과 경험치 추이는 평생 기록).
-- reason: character 닉네임 바꾸기에서 '다른 캐릭터로 바꿨어요' / removed 오피서가 '성장 기록'에서 뺀 줄
CREATE TABLE IF NOT EXISTS level_log_archive (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  level INTEGER NOT NULL,
  exp INTEGER,
  archived_at INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS level_log_archive_user ON level_log_archive (user_id, at);

-- 사파이어 중개인: 길드원끼리 파는 물건 (게임 밖의 약속, 실제 거래는 게임 안에서). server/market.ts
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller TEXT NOT NULL,                   -- 올린 길드원
  item TEXT NOT NULL,                     -- 아이템 이름 (위키에 있는 이름이면 화면이 그림과 정보를 붙인다)
  category TEXT NOT NULL,                 -- 갑옷, 주장비, ... 기타 (게임 거래소 종류)
  enhance INTEGER NOT NULL DEFAULT 0,     -- 강화 +N (0 = 없음)
  enchant TEXT,                           -- 속성부여: str 힘 | dex 민첩 | int 지능 | hp 체력 | mp 마나
  enchant_value INTEGER,                  -- 힘/민첩/지능 1~3, 체력/마나 10/20/30
  qty INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL,                 -- 골드 (올린 수량 전체 값)
  note TEXT,                              -- 한마디
  status TEXT NOT NULL DEFAULT 'selling', -- selling 판매 중 | sold 거래 완료 (30일 뒤 지운다)
  options TEXT,                           -- 판 사람이 적은 옵션 값 JSON [{name, value, unit}] (옵션이 범위에서 뜨는 아이템)
  mode TEXT NOT NULL DEFAULT 'sale',      -- sale 바로 판매 (흥정은 listing_wants.offer) | reserve 예약 판매 (sale_when) | auction 경매 (price = 시작가)
  ends_at INTEGER,                        -- 경매가 끝나는 때
  auto_auction INTEGER,                   -- 바로 판매인데 '살래요'가 2명 이상이면 저절로 이 시간짜리 경매로 (올릴 때 정함)
  sale_when TEXT,                         -- 예약 판매(mode reserve)의 판매 조건: '11/10 저녁', '50레벨 찍으면', '다음 무기 구하면' (제작자 요청 2026-11-02)
  side TEXT NOT NULL DEFAULT 'sell',      -- sell 팝니다 | buy 삽니다 (price 는 희망가, note 는 조건, '팔래요'는 listing_wants. 제작자 2026-11-03)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_seller ON listings (seller, status);

-- '살래요'를 누른 길드원 (이름, 한마디, 흥정 가격은 판 사람에게만 보인다)
CREATE TABLE IF NOT EXISTS listing_wants (
  listing_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  offer INTEGER,                          -- 흥정 가격 (골드, 안 적으면 null)
  PRIMARY KEY (listing_id, user_id)
);

-- 경매 입찰 (최고가와 입찰 수는 모두에게, 누가 얼마를 불렀는지는 판 사람에게만)
CREATE TABLE IF NOT EXISTS listing_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_bids_listing ON listing_bids (listing_id, amount);

-- 골드 거래: 게임 골드를 원화로 사고팔려는 글 (server/gold.ts). 현금거래 위험을 알린 뒤 제작자가 만들라고 했다.
-- 앱은 돈을 받거나 보내지 않는다
CREATE TABLE IF NOT EXISTS gold_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,                    -- 올린 길드원
  side TEXT NOT NULL,                     -- sell 골드 팝니다 | buy 골드 삽니다
  gold INTEGER NOT NULL,                  -- 만 골드 단위 (750 = 750만 골드)
  rate INTEGER NOT NULL,                  -- 시세: 1만 원에 몇 만 골드 (75 = 75:1)
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',    -- open 올라와 있음 | done 거래 완료 (30일 뒤 지운다)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gold_offers_owner ON gold_offers (owner, status);

-- 골드 글에 '거래할래요'를 누른 길드원 (이름과 한마디는 올린 사람에게만 보인다)
CREATE TABLE IF NOT EXISTS gold_wants (
  offer_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (offer_id, user_id)
);

-- 길드원 의뢰소: 의뢰를 자유롭게 올리고 길드원이 수락한 뒤 게임 안에서 거래하거나 함께 한다 (server/requests.ts).
-- 2026-11-03: 상태는 모집 중·완료 둘뿐(의뢰한 사람이 완료를 누르면 끝), 수락은 request_offers 에 사람마다 한 줄(한마디). 예전 accepter 칸은 안 쓴다
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,                    -- 의뢰한 길드원
  title TEXT NOT NULL,                    -- 의뢰 (예: 검은진액 100개, 토요일 밤 인던 같이 가요)
  detail TEXT,                            -- 자세히 (없어도 됨. 수량, 기한, 나눠 줘도 되는지 같은 조건을 글로)
  reward_gold INTEGER,                    -- 보상 골드 (골드로 줄 때)
  reward_text TEXT,                       -- 보상 (골드가 아닐 때 자유롭게)
  status TEXT NOT NULL DEFAULT 'open',    -- open 모집 중 | done 완료 (30일 동안만 보이고 지우지 않는다). accepted 는 예전 '진행 중' (배포가 open 으로)
  accepter TEXT,                          -- (예전) 수락한 길드원. 2026-11-03 부터 request_offers
  accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 의뢰 수락: 여러 사람이 할 수 있고 한 사람은 한 의뢰에 한 번. 한마디에 '저 20개 있어요', '토요일 밤 돼요' 같은 것을 자유롭게 (앱은 세지 않는다)
CREATE TABLE IF NOT EXISTS request_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,                  -- 수락한 길드원
  note TEXT,                              -- 한마디 (예: 저 20개 있어요)
  status TEXT NOT NULL DEFAULT 'pledged', -- pledged 수락함 | giveup 포기
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS request_offers_req ON request_offers (request_id, status);

-- 길드원이 직접 올린 자기 캐릭터 그림 (랭킹 시상대에 선다). '내 정보'에서 사용자가 고른 스샷을 잘라 만든 PNG
CREATE TABLE IF NOT EXISTS avatars (
  user_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,            -- 올린 때. 화면이 그림 주소에 붙여 바뀌면 새로 받는다
  updated_by TEXT,
  png BLOB NOT NULL                       -- 맨 끝 칸 (랭킹은 updated_at 만 읽는다)
);

-- 사용 기록 (앱개발자만 본다, 지우지 않음, server/activity.ts): 접속, 화면, 한 일.
-- 제작자 요청으로 비밀번호만 빼고 보낸 내용, IP, 대략의 위치, 기기를 모두 남긴다
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,   -- visit 접속 | view 화면 | act 한 일
  what TEXT NOT NULL,   -- 화면 주소(#/market) 또는 한 일(POST /api/market)
  detail TEXT,          -- 한 일의 내용 JSON (보낸 본문에서 비밀번호만 뺀 것, 무엇에 했는지)
  via TEXT,             -- app 앱 | float 게임 위 창 | ios, android, pc 웹
  ip TEXT,
  place TEXT,           -- Cloudflare 가 아는 도시, 지역, 나라
  device TEXT,          -- User-Agent 에서 읽은 기기와 브라우저
  dev TEXT,             -- 기기 표 (브라우저마다 무작위 글, 같은 기기인지 알려고. 2026-11-02 부터)
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_at ON activity (at);
CREATE INDEX IF NOT EXISTS activity_user_at ON activity (user_id, at);

-- 사용 기록 DB 2~10 (server/logdb.ts, 제작자 요청 2026-11-02: '1부터 채우고 2 3 4 진행하고 10까지 차면 1을 비우고').
-- 위 activity 는 이 기능 전의 기록만 남고, 새 기록은 sapphire-log-2 부터 차례로 쓴다. 쓰기 시작한 때와 그 DB 의 첫 기록 번호(base 보다 크다).
-- 자동 배포가 가장 오래된 DB 를 비우면 started_at, base 를 비우고 cleared_at 을 적는다
CREATE TABLE IF NOT EXISTS log_ring (
  n INTEGER PRIMARY KEY,                  -- DB 번호 2~10 (wrangler.toml LOG2 ~ LOG10)
  started_at INTEGER,
  base INTEGER,
  cleared_at INTEGER
);

-- 알림 (server/alerts.ts, 30일 보관): 나와 관련된 일 (살래요, 입찰, 의뢰 수락 ...). read_at 이 없으면 안 읽음
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  link TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_user ON alerts (user_id, id);

-- 알림 종류별 켜고 끄기 (줄이 없으면 그 종류의 기본값)
CREATE TABLE IF NOT EXISTS alert_prefs (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  push INTEGER,               -- 폰 알림(푸시)을 이 종류에 보낼지. 없으면 켜짐
  PRIMARY KEY (user_id, kind)
);

-- 종목 토론방 (중개인 물건마다 댓글, functions/api/market/[id]/talk.ts). 물건을 내리면 같이 지운다
CREATE TABLE IF NOT EXISTS listing_talk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  parent_id INTEGER                       -- 답글이면 원래 글 (한 단계만)
);
CREATE INDEX IF NOT EXISTS listing_talk_listing ON listing_talk (listing_id, id);
-- 위키에 없는 물건의 스샷 (제작자 요청 2026-11-02: 옵션은 데이터로 만들지 않고 그림을 게임 정보창처럼 보여 준다). 판 사람이 갤러리에서 고른 그림
CREATE TABLE IF NOT EXISTS listing_shots (
  listing_id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,                     -- image/jpeg
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

-- 1군 전용 플래티넘 할인 상점 (server/platshop.ts). 통 설정 한 줄: 비율은 '플래티넘 100당 몇 만 골드'
CREATE TABLE IF NOT EXISTS plat_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ratio REAL NOT NULL DEFAULT 5,          -- 길드 할인가 (처음 5:100)
  high_ratio REAL NOT NULL DEFAULT 4,     -- 고스펙 할인가 (처음 4:100)
  market REAL NOT NULL DEFAULT 7,         -- 시중가 (줄 그어 보이는 값, 7:100)
  limit_count INTEGER NOT NULL DEFAULT 1, -- 한 사람이 물건마다 limit_weeks 주에 몇 개
  limit_weeks INTEGER NOT NULL DEFAULT 2,
  open INTEGER NOT NULL DEFAULT 0,        -- 1 이면 길드원에게 연다 (그 전에는 오피서 이상만 들어간다)
  week_plat INTEGER NOT NULL DEFAULT 300,      -- 1군 한 사람에게 매주(월요일 0시) 지급하는 가상 플래티넘 (제작자 요청, 쌓인다)
  high_week_plat INTEGER NOT NULL DEFAULT 300, -- 고스펙 한 사람의 주당 지급 (길드 자금을 보고 오피서가 조정)
  updated_by TEXT,
  updated_at INTEGER
);

-- 물건마다 따로 정한 것 (줄이 없으면 판매 중이고 통 설정을 따른다. null 도 통 설정)
CREATE TABLE IF NOT EXISTS plat_items (
  item_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  ratio REAL,
  high_ratio REAL,
  limit_count INTEGER,
  limit_weeks INTEGER
);

-- 구매 신청과 정산 기록 (거래 완료된 것의 플래티넘과 골드를 쌓아 본다. 오피서 이상만 본다)
CREATE TABLE IF NOT EXISTS plat_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  plat INTEGER NOT NULL,                  -- 길드가 쓰는 플래티넘
  gold INTEGER NOT NULL,                  -- 길드가 받는 골드 (신청 때 비율로)
  ratio REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested', -- requested 신청 | done 거래 완료 | cancelled 취소
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  done_by TEXT,
  voided_at INTEGER,                      -- 정산에서 지운 때 (시험 거래 등, 오피서 이상. 기록은 남기고 정산과 이용한도에서 뺀다, 복구할 수 있다)
  voided_by TEXT,
  gold_paid INTEGER                       -- 실제로 받은 골드 (오피서 이상이 적는다. 비면 신청 때 골드)
);
CREATE INDEX IF NOT EXISTS plat_orders_user ON plat_orders (user_id, item_id, created_at);

-- 즐겨찾기 (제작자 요청, functions/api/favorites.ts): 아이템, 몬스터, 사냥터. 한 사람 200개까지
CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,   -- item | monster | place
  key TEXT NOT NULL,    -- 아이템·몬스터 이름, 사냥터 id
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key)
);

-- 캐릭터 사진 AI 지우기 (functions/api/avatar/cutout): Cloudflare 이미지 변환이 읽어 가는 동안만 두는 그림, 하루 횟수
CREATE TABLE IF NOT EXISTS cutout_tmp (
  id TEXT PRIMARY KEY,
  img BLOB NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cutout_log (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cutout_log_user ON cutout_log (user_id, at);

-- 게시판 (제작자 요청, server/board.ts): 공지사항(notice), 길드 이벤트(event), 자유(free). 사진과 첨부 파일, 댓글, 좋아요, 본 사람
CREATE TABLE IF NOT EXISTS board_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  -- 건의함 익명 글 (2026-11-09): 쓴 사람은 author 에 그대로 두고, 앱개발자와 유어아너 말고는 '익명'으로 보인다 (server/board.ts canSeeAnon)
  anon INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS board_posts_cat ON board_posts (cat, id);
CREATE TABLE IF NOT EXISTS board_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  image INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS board_files_post ON board_files (post_id);
CREATE TABLE IF NOT EXISTS board_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  parent_id INTEGER,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  anon INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS board_comments_post ON board_comments (post_id, id);
CREATE TABLE IF NOT EXISTS board_likes (
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS board_views (
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
-- 글 속 링크 미리보기 (functions/api/board/preview.ts), 7일 동안 다시 쓴다
CREATE TABLE IF NOT EXISTS link_previews (
  url TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  image TEXT,
  site TEXT,
  fetched_at INTEGER NOT NULL
);

-- 폰 자체 알림 (웹 푸시, server/push.ts): 알림을 받을 폰. 한 사람 5대까지
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
-- 모두에게 가는 알림처럼 40대 넘게 보낼 폰 알림 (server/push.ts drainPushQueue): /api/news 가 40대씩 이어 보낸다. last = 마지막으로 보낸 폰 주소
CREATE TABLE IF NOT EXISTS push_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last TEXT NOT NULL,
  claimed_at INTEGER
);
-- 폰 알림 서명 키 (서버가 처음 쓸 때 만든다. 한 줄)
CREATE TABLE IF NOT EXISTS push_keys (
  id INTEGER PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL
);

-- 챗봇 대화 기록 (functions/api/chat, server/chatlog.ts, 제작자 요청: 클로드·GPT 처럼 대화 목록과 이어 하기).
-- 그 길드원만 본다. 사진은 저장하지 않고 장 수만. 한 사람 300개까지 (넘으면 고정 안 한 오래된 것부터 지운다)
CREATE TABLE IF NOT EXISTS chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_threads_user ON chat_threads (user_id, updated_at);
CREATE TABLE IF NOT EXISTS chat_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  role TEXT NOT NULL,           -- user / assistant
  text TEXT NOT NULL,
  photos INTEGER NOT NULL DEFAULT 0,
  thinking TEXT,                -- 답하기 전 생각 (요약, 화면의 '생각' 칸)
  think_ms INTEGER,
  found TEXT,                   -- 화면이 찾은 위키 자료 이름 (' · ')
  attach TEXT,                  -- 첨부 이름 JSON (사진, 파일 이름. 내용은 저장하지 않는다)
  steps TEXT,                   -- 답하며 한 일 JSON (웹 찾기, 글 읽기)
  sources TEXT,                 -- 웹 출처 JSON [{url, title}]
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_msgs_thread ON chat_msgs (thread_id, id);

-- 챗봇이 모르는 질문 (제작자 요청): 길잡이가 짐작하거나 자료가 없다고 표시한 답([[모름:...]])과 길드원의 '👎 별로'.
-- 앱개발자에게 알리고(#/gaps), 개선 완료를 누르면 물은 사람에게 알린다. status: open / fixed
CREATE TABLE IF NOT EXISTS chat_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  msg_id INTEGER,
  question TEXT NOT NULL,
  answer TEXT,
  reason TEXT NOT NULL,
  kind TEXT NOT NULL,            -- bot (길잡이가 모름) / user (길드원이 별로라고 함)
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,                     -- 무엇을 고쳤는지
  created_at INTEGER NOT NULL,
  fixed_at INTEGER
);
CREATE INDEX IF NOT EXISTS chat_gaps_status ON chat_gaps (status, created_at);

-- 플래티넘 상점 지갑 (제작자 요청 2026-10-31): 1군 길드원에게 매주(한국 시간 월요일 0시) 가상 플래티넘을 지급하고 쌓인다.
-- 남은 플래티넘 = granted - (started_at 뒤의 취소 안 한 신청의 플래티넘 합). 지급은 들어올 때 밀린 주만큼 한꺼번에 (server/platshop.ts wallet)
CREATE TABLE IF NOT EXISTS plat_wallets (
  user_id TEXT PRIMARY KEY,
  granted INTEGER NOT NULL DEFAULT 0,    -- 지금까지 지급한 가상 플래티넘 합
  granted_until INTEGER NOT NULL,        -- 이 주(월요일 0시)까지 지급함
  started_at INTEGER NOT NULL            -- 지갑을 연 때 (이 뒤의 신청만 쓴 것으로 센다)
);


-- 홈 칸과 아래 탭 배치 (src/launcher.ts, functions/api/layout.ts, 제작자 요청 2026-11-01: 폰 홈 화면처럼 각자 옮기기)
CREATE TABLE IF NOT EXISTS layouts (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,                     -- {"dock": [...], "grid": [...]} 칸 이름 (launcher.ts ITEMS 의 key)
  updated_at INTEGER NOT NULL
);

-- 아이디 생성 요청 (functions/api/signup, 제작자 요청 2026-11-01): 로그인 화면에서 본인이 닉네임과 비밀번호를 넣어 요청하고
-- 길드마스터·오피서가 '길드원 관리'에서 승낙하면 이 해시 그대로 users 에 계정을 만든다. 비밀번호 원문은 두지 않는다
-- 계정 삭제 요청 (제작자 요청 2026-11-02: '내 정보'의 로그아웃 아래 '계정 삭제'로 본인이 요청하고 길드마스터·오피서가 승낙하면 지운다).
-- 캐릭터마다 (요청한 캐릭터만 지운다). 승낙하면 계정과 함께 이 줄도 지우고, 거절하면 이 줄만 지운다
CREATE TABLE IF NOT EXISTS delete_requests (
  user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signup_requests (
  id TEXT PRIMARY KEY,                    -- 바라는 아이디 (게임 닉네임)
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iter INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  owner TEXT                              -- '내 정보'의 캐릭터 추가 요청이면 요청한 사람의 본캐 (승낙하면 그 사람의 부캐가 된다)
);

-- 컴투스 공식 소식 (제작자 요청 2026-11-01): withhive.com 아이모 공지사항·점검·이벤트. scripts/fetch-official.mjs 가 30분마다 받아 넣고
-- (.github/workflows/official-news.yml), 점검 글은 서버가 2분마다 새로 받는다 (점검 전광판). 게시판 '아이모 소식'에서 읽고, 챗봇은 본문 글자로 답한다. 지우지 않는다
CREATE TABLE IF NOT EXISTS official_news (
  id INTEGER PRIMARY KEY,                 -- withhive 글 번호 (공식 페이지 주소의 번호)
  kind TEXT NOT NULL,                     -- notice | event
  type TEXT NOT NULL,                     -- N 공지사항, C 점검, I 안내, D 오류, E 이벤트
  title TEXT NOT NULL,
  start_date TEXT,                        -- 'YYYY-MM-DD' 올린 날 (이벤트는 시작일)
  end_date TEXT,                          -- 이벤트 끝나는 날 (있으면)
  image TEXT,                             -- 대표 그림 주소 (이벤트)
  body TEXT NOT NULL,                     -- 본문 글자만 (그림, 꾸밈은 뺐다. 3만 자까지)
  fetched_at INTEGER NOT NULL,            -- 받거나 바뀐 때
  html TEXT,                              -- 간단히 한 본문 HTML (문단, 굵게, 표, 목록, 그림, 링크만. 게시판 '아이모 소식'에서 읽는다, 58KB 넘으면 비움)
  src TEXT,                               -- 원문(제목+본문)의 해시와 바꾼 방법의 판 (server/officialText.ts): 같으면 다시 쓰지 않는다
  added_at INTEGER                        -- 우리 표에 처음 들어온 때 (새 글 숫자 배지는 이것으로 센다. 고쳐 받아도 그대로, 예전 글은 NULL)
);
-- 공식 글 속 그림을 글자로 (제작자 요청 2026-11-06 '이벤트에 있는 모든 데이터 이미지 포함해서 싹 다 데이터화'). scripts/read-official-images.mjs 가 채우고
-- 챗봇이 본문과 합쳐 읽는다 (server/officialImages.ts, server/official.ts officialContext). 지우지 않는다
CREATE TABLE IF NOT EXISTS official_img (
  key TEXT PRIMARY KEY,                   -- 그림 주소 (본문에 통째로 든 그림은 'data:' + 내용 해시). 같은 그림을 쓰는 글끼리 같이 쓴다
  text TEXT NOT NULL,                     -- 그림 속 글자·표를 옮긴 것 (마크다운 표). 글자 없는 그림·아이콘은 ''
  made_at INTEGER NOT NULL,
  model TEXT                              -- 'manual' (사람이 확인, 비공개 자료 공식/그림글.json) · 옮긴 모델#판 · small · gone · refused
);
CREATE TABLE IF NOT EXISTS official_rich (
  id INTEGER PRIMARY KEY,                 -- official_news.id
  src TEXT,                               -- 이걸 만든 원문 표시 (official_news.src 와 다르면 다시 만든다)
  v TEXT,                                 -- 만든 방법의 판 (RICH_V, 끝에 p 면 본문 속 그림 자료를 다 못 옮겨서 다음에 원문을 다시 받는다)
  text TEXT,                              -- 본문 글자 (자르지 않은 원문에서, 9만 바이트까지), 그림 자리에 ⟦그림 N⟧. 원문을 못 받았으면 NULL (그때는 body)
  keys TEXT NOT NULL DEFAULT '[]',        -- 그림 N 의 official_img.key 목록 (JSON)
  made_at INTEGER NOT NULL
);
-- 아이모 소식 글의 본 사람·좋아요·댓글 (제작자 2026-11-06 '아이모 소식에서도 조회수 댓글 등등 달게, 일반 게시판이랑 똑같이'). 게시판의 board_views·board_likes·board_comments 와 같은 모양,
-- 글 번호는 공식 글 번호(official_news.id). 본 사람은 처음 배포 때 사용 기록의 '#/official/<글>' 화면 기록으로 채웠다 (scripts/ci-d1.mjs, setup 'official_views_backfill')
CREATE TABLE IF NOT EXISTS official_views (
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS official_likes (
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS official_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  parent_id INTEGER,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS official_comments_post ON official_comments (post_id, id);
CREATE INDEX IF NOT EXISTS official_comments_at ON official_comments (created_at);
-- 아이모 소식 글의 핵심 요약과 패치노트 직업별 변경점 (제작자 요청 2026-11-02, server/officialSummary.ts). 글을 처음 열 때 만들고 원문(src)이 바뀌면 다시
CREATE TABLE IF NOT EXISTS official_summary (
  id INTEGER PRIMARY KEY,                 -- official_news.id
  src TEXT,                               -- 요약할 때의 official_news.src
  lines TEXT,                             -- JSON ["…", "…", "…"] (만드는 중이면 NULL)
  jobs TEXT,                              -- JSON { "전사": ["…"], … } (패치노트가 아니면 비어 있다)
  claimed_at INTEGER,                     -- 만들기 시작한 때 (여럿이 같이 열어도 한 번만)
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS official_news_kind ON official_news (kind, id);
CREATE INDEX IF NOT EXISTS official_news_type ON official_news (type, id);          -- 점검 전광판 (2분마다 최근 점검 글 3개)
CREATE INDEX IF NOT EXISTS official_news_date ON official_news (kind, start_date);  -- To do 로 정리할 최근 글
-- 새 글 숫자 배지(/api/news, 2분마다)의 색인 official_news_added (added_at) 는 칸을 더한 뒤에 scripts/ci-d1.mjs 가 만든다 (이미 있는 표에서는 여기서 못 만든다)

-- To do 의 이벤트 할 일 (제작자 요청 2026-11-01: 이벤트를 안 읽어도 본인 직업·레벨에 맞는 할 일). 공식 글 하나를 Claude 가 읽고 뽑은 것
-- (server/todoDigest.ts, 주로 GitHub Actions 의 scripts/digest-official.mjs, 새 글은 서버 /api/todo/digest). 원문(src)이 바뀌면 다시 정리한다. 지우지 않는다
CREATE TABLE IF NOT EXISTS official_todo (
  id INTEGER PRIMARY KEY,                 -- official_news.id
  src TEXT,                               -- 정리한 원문의 표시 (official_news.src)
  tasks TEXT NOT NULL,                    -- JSON [{t 할 일, n 어디서, c d|w|o, days 요일, at 시각, s 시작, e 끝, lv [최소, 최대], jobs, d 할 것, w 손해 주의}]
  until INTEGER NOT NULL,                 -- 할 일이 끝나는 가장 늦은 때 (없으면 0): To do 는 이것이 지금보다 뒤인 글만 읽는다
  made_at INTEGER NOT NULL,               -- 정리한 때 (0 이면 아직)
  claimed_at INTEGER,                     -- 정리를 맡은 때 (10분 안이면 다른 곳이 손대지 않는다)
  model TEXT                              -- 정리한 모델
);
CREATE INDEX IF NOT EXISTS official_todo_until ON official_todo (until);

-- To do 체크 (제작자 요청 2026-11-01). 그 주기 안에서만 보인다: period 'd2026-11-01' 오늘(한국 시간 0시), 'w2026-10-29' 이번 주(목요일 오전 10시), 'o' 계속.
-- item: 'd:guild-attend', 'w:dungeon:342379', 'o:95976:abc' (주기:무엇). 사람이 푸는 것만 지운다. 닉네임 바꾸기와 계정 삭제에 따라간다
CREATE TABLE IF NOT EXISTS todo_checks (
  user_id TEXT NOT NULL,
  item TEXT NOT NULL,
  period TEXT NOT NULL,
  done_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item, period)
);

-- To do 내 할 일 (제작자 요청 2026-11-02: 할 일을 직접 더하고 고치고 지우기). 캐릭터마다, 30개까지. 할 일 키는 '<cycle>:c:<id>'.
-- 본인이 지우는 것만 지운다. 닉네임 바꾸기와 계정 삭제에 따라간다
CREATE TABLE IF NOT EXISTS todo_custom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  cycle TEXT NOT NULL,                    -- d 매일 | w 매주 | o 한 번
  text TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS todo_custom_user ON todo_custom (user_id);

-- 늘 하는 일·이벤트 할 일을 그 사람만 숨기거나 이름·어디서를 고친 것 (item 은 할 일 키). '원래대로'를 누르면 지운다
CREATE TABLE IF NOT EXISTS todo_edits (
  user_id TEXT NOT NULL,
  item TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  text TEXT,
  note TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item)
);

-- 함께 하는 할 일 (제작자 요청 2026-11-02: 길드던전 고정 멤버처럼 같이 하는 사람과 공유하고 언제 하자고 적는다).
-- 할 일 하나(item 키)에 사람들을 묶는다. 만든 사람(owner)도 todo_share_members 에 있다. 체크는 각자 todo_checks 에 하고 서로의 체크가 보인다.
-- 만든 사람이 끄거나 계정을 지우면 지운다
CREATE TABLE IF NOT EXISTS todo_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  item TEXT NOT NULL,                     -- 할 일 키 ('w:guild-dungeon', 내 할 일이면 'w:c:12')
  text TEXT NOT NULL,                     -- 그 할 일이 없는 사람에게 보일 이름 (내 할 일, 레벨이 안 맞는 이벤트)
  note TEXT,
  at_text TEXT,                           -- 언제 ('토 21:00'), 함께 하는 사람 누구나 고친다
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS todo_shares_owner ON todo_shares (owner, item);
CREATE TABLE IF NOT EXISTS todo_share_members (
  share_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, user_id)
);
CREATE INDEX IF NOT EXISTS todo_share_members_user ON todo_share_members (user_id);

-- 장비대여 (제작자 요청 2026-11-01): 길드가 기부받은 무기를 길드원에게 빌려준다. 실제로 주고받는 것은 게임 안에서 하고 앱은 목록과 장부만.
-- 가격은 💎 (1개 = 10만 골드). 장비를 기부하면 대여 담당이 옵션 시세를 보고 마일리지 💎 를 적립하고, 빌릴 때 골드 대신 쓴다.
-- 처음 목록은 카카오톡 목록 글(비공개 자료 길드/장비대여)로 채운다 (scripts/rental-seed.mjs). 지우지 않고 내린 물건은 status 'gone'
CREATE TABLE IF NOT EXISTS rental_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,                      -- warrior | ranger | mage | monk
  level INTEGER NOT NULL,                 -- 요구 레벨 (목록에 적힌 것. 화면은 위키 레벨제한을 먼저 쓴다)
  weapon TEXT NOT NULL,                   -- 무기 이름 (위키 아이템 이름과 같으면 그림과 옵션 범위가 붙는다)
  options TEXT NOT NULL,                  -- 옵션 줄임말 그대로 ('명6크3', '지4마11마재1'), 화면이 명중 6 · 크리티컬 3 으로
  enhance INTEGER NOT NULL,               -- +강
  term TEXT NOT NULL,                     -- none 기한 없음 | <N>w N주 (1~52주, 예 3w)
  price INTEGER NOT NULL,                 -- 💎
  donor TEXT,                             -- 기부한 사람 (닉네임 글자, 앱 계정이 아닐 수도 있다)
  renter TEXT,                            -- 지금 빌려 간 사람 (닉네임 글자). 비면 대여 가능
  rented_at INTEGER,
  due_at INTEGER,                         -- 돌려줄 때 (기한 없음이면 NULL)
  return_req_at INTEGER,                  -- 빌린 사람이 '반납 신청'을 누른 때 (제작자 요청 2026-11-02). 반납하면 비운다
  return_app_id INTEGER,                  -- 반납 날짜를 정하는 대화창 (rental_apps, 빌린 신청서가 있으면 그것, 없으면 새로). 반납하면 비운다
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',    -- open | gone (내림)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS rental_items_status ON rental_items (status, job);

-- 신청서: 한 번에 무기 여러 개를 신청한다 (제작자 요청 2026-11-02). 운영진은 무기마다 수락·거절하고, 신청서마다 대화창(rental_talk)이 있다
CREATE TABLE IF NOT EXISTS rental_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,                  -- 신청한 사람 (닉네임)
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL             -- 마지막으로 무엇이 바뀐 때 (대화, 수락 등)
);
CREATE INDEX IF NOT EXISTS rental_apps_user ON rental_apps (user_id, created_at);

-- 무기마다의 신청과 대여 기록. 무기마다 선착순으로 줄을 선다 (wait, ok 를 신청한 순서로). 운영진이 직접 빌려준 것도 status 'done' 으로 남긴다. 운영진이 '기록'에서 직접 지우는 것만 지운다
CREATE TABLE IF NOT EXISTS rental_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,                  -- 빌리는 사람 (닉네임)
  use_dia INTEGER NOT NULL DEFAULT 0,     -- 대여 완료 때 보증금으로 쓴 마일리지 💎 (반납하면 돌려준다)
  gold INTEGER,                           -- 대여 완료 때 보증금으로 받은 골드 (반납하면 게임 안에서 돌려준다, 제작자 요청 2026-11-02 '보증금 개념')
  note TEXT,
  status TEXT NOT NULL DEFAULT 'wait',    -- wait 신청(확인 전) | ok 수락(차례 기다림) | done 건네받음 | no 거절 | cancel 취소
  created_at INTEGER NOT NULL,
  done_at INTEGER,                        -- 건넨 때 (거절·취소면 그때)
  done_by TEXT,
  returned_at INTEGER,                    -- 돌려받은 때
  app_id INTEGER                          -- 신청서 (처음 목록과 직접 대여는 없다)
);
CREATE INDEX IF NOT EXISTS rental_requests_item ON rental_requests (item_id, status);
CREATE INDEX IF NOT EXISTS rental_requests_user ON rental_requests (user_id, status);
CREATE INDEX IF NOT EXISTS rental_requests_status ON rental_requests (status, created_at);

-- 신청서 대화창: 신청한 사람과 운영진이 건네받을 때, 마일리지 같은 것을 이야기한다. 지우지 않는다 (계정을 지우면 그 사람 글만)
CREATE TABLE IF NOT EXISTS rental_talk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_talk_app ON rental_talk (app_id, id);

-- 마일리지 장부: 줄마다 더하거나 뺀 💎 (합이 그 사람의 마일리지, 묶은 캐릭터는 합쳐서). 닉네임 글자로 두어 아직 앱에 없는 기부자도 적립할 수 있다. 운영진이 기부 현황에서 직접 지우는 것만 지운다
CREATE TABLE IF NOT EXISTS rental_mileage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,                      -- 길드원 닉네임
  delta INTEGER NOT NULL,                 -- 💎 (+ 기부 적립, - 대여에 씀, 운영진 고침)
  gold INTEGER,                           -- 대여 때 골드로 낸 몫 (골드)
  reason TEXT NOT NULL,                   -- donate | rent | adjust
  item_id INTEGER,
  note TEXT,
  by_user TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_mileage_who ON rental_mileage (who, created_at);

-- 자주 부르는 곳이 표 전체를 읽지 않게 하는 색인 (2026-11-01 오픈 전 검토: D1 무료 한도 하루 500만 줄 읽기)
CREATE INDEX IF NOT EXISTS users_main ON users (main_id);                          -- 로그인 확인마다 같은 사람의 캐릭터 찾기
CREATE INDEX IF NOT EXISTS alerts_created ON alerts (created_at, kind);            -- 알림을 넣은 뒤 폰 알림 보낼 곳 찾기
CREATE INDEX IF NOT EXISTS alerts_unread ON alerts (user_id) WHERE read_at IS NULL; -- 안 읽은 알림 수 (1분마다)
CREATE INDEX IF NOT EXISTS board_posts_created ON board_posts (created_at);        -- 새 글 숫자 배지 (2분마다)
CREATE INDEX IF NOT EXISTS board_posts_author ON board_posts (author, created_at); -- 1분에 글 수 제한
CREATE INDEX IF NOT EXISTS listings_status_created ON listings (status, created_at);
CREATE INDEX IF NOT EXISTS gold_offers_status_created ON gold_offers (status, created_at);
CREATE INDEX IF NOT EXISTS requests_created ON requests (created_at);
CREATE INDEX IF NOT EXISTS board_comments_user ON board_comments (user_id, created_at);
CREATE INDEX IF NOT EXISTS listing_talk_user ON listing_talk (user_id, created_at);
CREATE INDEX IF NOT EXISTS listing_wants_user ON listing_wants (user_id);
CREATE INDEX IF NOT EXISTS listing_bids_user ON listing_bids (user_id);

-- 길드 던전 (server/gdungeon.ts, 제작자 요청 2026-11-02, 1군 전용): 4인 파티와 이번 주(목 10시부터) 가능한 때, 후보마다 확정·불참. 지우지 않는다
CREATE TABLE IF NOT EXISTS gd_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  leader TEXT NOT NULL,                   -- 파티장 (만든 사람. 나가면 먼저 들어온 사람)
  created_at INTEGER NOT NULL,
  stage INTEGER                           -- 길드던전 단계 (1~9, 파티장·운영진이 정한다. 제작자 2026-11-03: 파티마다 '4단계' 같은 단계가 있다)
);
CREATE TABLE IF NOT EXISTS gd_members (
  user_id TEXT PRIMARY KEY,               -- 한 캐릭터는 파티 하나에만
  party_id INTEGER NOT NULL,
  joined_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gd_members_party ON gd_members (party_id);
CREATE TABLE IF NOT EXISTS gd_avail (
  user_id TEXT NOT NULL,
  week INTEGER NOT NULL,                  -- 그 주가 시작한 때 (목 10시, server/week.ts weekStart)
  slots TEXT NOT NULL,                    -- 30분 칸마다 '0'/'1' 336자 (목 10:30 부터, 하루 09:00 ~ 02:00 만 쓴다)
  updated_at INTEGER NOT NULL,
  confirmed_at INTEGER,                   -- '확정'을 처음 누른 때 (그때 아직 안 칠한 파티원에게 알림, 한 주에 한 번. 제작자 2026-11-03)
  PRIMARY KEY (user_id, week)
);
CREATE INDEX IF NOT EXISTS gd_avail_week ON gd_avail (week);
CREATE TABLE IF NOT EXISTS gd_answers (
  party_id INTEGER NOT NULL,
  week INTEGER NOT NULL,
  slot INTEGER NOT NULL,                  -- 후보 칸 번호 (gd_avail.slots 의 자리)
  user_id TEXT NOT NULL,
  answer TEXT NOT NULL,                   -- yes 확정 | no 불참 (불참이 하나라도 있으면 그 후보는 무산)
  at INTEGER NOT NULL,
  PRIMARY KEY (party_id, week, slot, user_id)
);
CREATE INDEX IF NOT EXISTS gd_answers_week ON gd_answers (week);

-- 확률 시뮬레이터 순위 (개발중, 제작자 요청 2026-11-04 '시뮬레이터별로 몇 번 만에 몇 강을 했는지 순위, 도박왕 통합 랭킹, 재미로'):
-- 사람마다 시뮬레이터(game)마다 가장 좋은 기록 하나. score 가 높을수록, 같으면 tries 가 적을수록 위. luck = log10(1/그만큼 나올 확률), 도박왕은 묶음(cat)마다 가장 큰 luck 의 합
CREATE TABLE IF NOT EXISTS sim_records (
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,                     -- enh:무기:일반, stat:50100, repair:무기 수리, opt:130101, gem:synth, box:20101 …
  cat TEXT NOT NULL,                      -- enhance | grow | option | gem | box
  label TEXT NOT NULL,                    -- '+9', '3단계', '헌터보우 명중 11', '베루아'
  score REAL NOT NULL,
  tries INTEGER NOT NULL,
  luck REAL NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);
CREATE INDEX IF NOT EXISTS sim_records_game ON sim_records (game, score);
-- 시뮬레이터 행운 코인 (제작자 요청 2026-11-04 '시도 횟수는 게시판 글쓰기나 길드던전 시간표 확정, 챗봇 활용 등 웹에서 유의미한 행동을 할 때마다 재화를 주고 그걸로 트라이'):
-- 캐릭터마다 지갑 하나 (처음 100), 버는 일은 하루 횟수 한도 (server/simcoin.ts EARN)
CREATE TABLE IF NOT EXISTS sim_wallet (
  user_id TEXT PRIMARY KEY,
  coins INTEGER NOT NULL,
  earned INTEGER NOT NULL,
  spent INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sim_earn (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                      -- 한국 날짜 2026-11-04
  key TEXT NOT NULL,                      -- board, chat, gd …
  n INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, key)
);
-- 시뮬레이터 전광판 (제작자 요청 2026-11-04 '조금 재밌는 미니게임처럼'): 1/100 보다 드문 결과를 낸 때. 화면 맨 위에 흘러간다
CREATE TABLE IF NOT EXISTS sim_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  label TEXT NOT NULL,
  luck REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sim_feed_at ON sim_feed (at);
-- 시뮬레이터 해금 (제작자 2026-11-04 '자동 강화도 무기별로 각각 다 해금하게, 해금 비용은 코인으로', '자동 구매도'): 'auto:장비 이름', 'buy:장비 이름'
CREATE TABLE IF NOT EXISTS sim_unlocks (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  cost INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
-- 시뮬레이터 진행 상황 (제작자 2026-11-04 '8강 참나무지팡이가 장비 바꾸기 누르니까 없어졌네'): 들고 있는 장비, 보관함, 직접 겪은 것 (JSON, 화면 src/simState.ts)
CREATE TABLE IF NOT EXISTS sim_state (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 앱개발자 테스트판 (제작자 2026-11-04 '내가 테스트하는 공간을 따로 도플갱어로, 개발 중판은 깨끗한 버전으로'): 위 sim_* 와 같은 모양, ?space=test (server/simcoin.ts tbl)
CREATE TABLE IF NOT EXISTS sim_t_records (
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  cat TEXT NOT NULL,
  label TEXT NOT NULL,
  score REAL NOT NULL,
  tries INTEGER NOT NULL,
  luck REAL NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);
CREATE INDEX IF NOT EXISTS sim_t_records_game ON sim_t_records (game, score);
CREATE TABLE IF NOT EXISTS sim_t_wallet (
  user_id TEXT PRIMARY KEY,
  coins INTEGER NOT NULL,
  earned INTEGER NOT NULL,
  spent INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sim_t_earn (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, key)
);
CREATE TABLE IF NOT EXISTS sim_t_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  label TEXT NOT NULL,
  luck REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sim_t_feed_at ON sim_t_feed (at);
CREATE TABLE IF NOT EXISTS sim_t_unlocks (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  cost INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS sim_t_state (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 개발 요청 (개발중, 제작자 요청 2026-11-05 '개발자한테 자유롭게 신청, 범위는 나·특정 인원·길드 전체, 개발 가능 → 합의 1명 이상 → 길마 최종 결재 → 개발, 반려되면 고쳐서 다시 신청')
-- status: review(개발 검토) | agree(합의·결재 대기) | dev(개발 중) | done(완료) | rejected(반려). round 는 다시 신청할 때마다 1씩 (server/devreq.ts)
CREATE TABLE IF NOT EXISTS dev_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'me',
  people TEXT,
  status TEXT NOT NULL DEFAULT 'review',
  round INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dev_requests_updated ON dev_requests (updated_at);
-- 결재 이력: submit | resubmit | feasible(개발 가능) | agree(합의) | approve(길마 결재) | reject(반려) | done(개발 완료). note 는 결재 의견 (지우지 않는다)
CREATE TABLE IF NOT EXISTS dev_request_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dev_request_steps_req ON dev_request_steps (req_id, round);
-- 요청마다 대화 (개발자와 신청한 사람이 개발할 수 있는지 이야기한다)
CREATE TABLE IF NOT EXISTS dev_request_talk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dev_request_talk_req ON dev_request_talk (req_id, id);

-- 생일 스티커 최대 콤보 (제작자 요청 2026-11-07 '최대 콤보 순위도 어딘가에 나열', src/birthday.tsx, functions/api/bday.ts).
-- 생일(bday)마다 캐릭터마다 가장 높은 콤보 하나. 지우지 않는다 (기록은 평생)
CREATE TABLE IF NOT EXISTS bday_combo (
  bday TEXT NOT NULL,
  user_id TEXT NOT NULL,
  best INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (bday, user_id)
);
CREATE INDEX IF NOT EXISTS bday_combo_rank ON bday_combo (bday, best);
-- 생일 콤보 이어서 하기 (제작자 2026-11-08 '쿨쿨 쿠루미는 억울하게 끊겼으니까 11700 에서 이어서 할 수 있게, 그 사람 웹 들어가면 이어서 하기 버튼'):
-- 끊긴 콤보를 그 사람이 단추로 이어 간다. 누르면 used_at 을 적어 한 번만
CREATE TABLE IF NOT EXISTS bday_resume (
  bday TEXT NOT NULL,
  user_id TEXT NOT NULL,
  combo INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (bday, user_id)
);

-- 헬스 루틴 (개발중, 길드원 완뻔치 님 개발 요청 #8, 제작자 2026-11-09 '플릭 같은 헬스 어플'): 실제 헬스장 운동 기록. 캐릭터마다 자기 것만 (server/fit.ts).
-- 기록은 저절로 지우지 않는다 (사람이 지우는 것만)
-- 내 종목 (기본 종목은 화면 src/fit.ts 의 LIBRARY, 키는 'c<번호>')
CREATE TABLE IF NOT EXISTS fit_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  part TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fit_exercises_user ON fit_exercises (user_id);
-- 루틴: 종목 목록 JSON [{ key, name, part, kind, sets, goal }]
CREATE TABLE IF NOT EXISTS fit_routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fit_routines_user ON fit_routines (user_id, sort);
-- 끝낸 운동 하나에 한 줄: day 는 한국 날짜, data 는 { title, started, ended, memo?, entries: [{ key, name, part, kind, sets: [{ kg, reps | sec | min, km }] }] } (끝낸 세트만)
CREATE TABLE IF NOT EXISTS fit_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  volume REAL NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fit_workouts_user ON fit_workouts (user_id, started_at);
-- 하는 중인 운동 (사람마다 한 줄, 새로 고쳐도 이어서)
CREATE TABLE IF NOT EXISTS fit_drafts (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 운영진 때리기 (개발 요청 #10, 제작자 2026-11-09, server/smack.ts, src/pages/Smack.tsx): 때린 사람(캐릭터)마다 맞은 운영진(그 역할의 캐릭터)마다 한 줄.
-- 화면이 3초마다 모아 더한다. 지우지 않는다 (기록은 평생). 닉네임 바꾸기·계정 삭제에 따라간다
CREATE TABLE IF NOT EXISTS smack_stats (
  hitter TEXT NOT NULL,
  target TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  damage INTEGER NOT NULL DEFAULT 0,
  kos INTEGER NOT NULL DEFAULT 0,
  crits INTEGER NOT NULL DEFAULT 0,       -- 크리티컬 수
  deadly INTEGER NOT NULL DEFAULT 0,      -- 죽음의 일격 수
  best INTEGER NOT NULL DEFAULT 0,        -- 최고 콤보
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (hitter, target)
);
CREATE INDEX IF NOT EXISTS smack_stats_target ON smack_stats (target);


-- 2군 성장코인샵 (개발중, 제작자 2026-11-09 '골드말고 성장코인이 쌓이게, 성장코인샵에서 구매', '대상은 2군 전원', '렙업당 성장코인', '성장 123위는 더 주자',
-- server/gcoin.ts, src/pages/GrowthShop.tsx). 레벨업으로 버는 코인은 표에 쌓지 않고 level_log 로 그때그때 센다 (시작 때 레벨부터 오른 레벨마다 gc_levels 의 값).
-- 오타 수정은 level_log 의 마지막 줄을 고치므로 저절로 빠진다. 시작 때는 setup 'gcoin_start'
-- 레벨 하나 오를 때 주는 코인: 오른 레벨이 min_level 이상이고 다음 줄의 min_level 보다 작으면 coin (오피서가 조정)
CREATE TABLE IF NOT EXISTS gc_levels (
  min_level INTEGER PRIMARY KEY,
  coin INTEGER NOT NULL
);
-- 그 밖의 설정 (rank1, rank2, rank3: 주간 2군 성장 1·2·3위 보너스 코인)
CREATE TABLE IF NOT EXISTS gc_settings (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
-- 상점 물건 (실제로는 오피서가 게임 안에서 준다). price 는 성장코인
CREATE TABLE IF NOT EXISTS gc_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT,                              -- 예: 20개 (자몽주스·자몽케이크는 50개)
  price INTEGER NOT NULL,                 -- 성장코인 = gold / 1000 (반올림). 0 이면 값을 정하기 전 (상점에 안 보인다)
  gold INTEGER,                           -- 담당자가 적은 골드 가치 (원 단위 그대로, 없던 예전 줄은 price x 1000)
  info TEXT,                              -- 안 씀 (옵션은 고정이라 화면 src/gcoin.ts ITEM_INFO)
  active INTEGER NOT NULL DEFAULT 1,      -- 0 이면 판매 중지 (상점에 안 보인다)
  sort INTEGER NOT NULL DEFAULT 0
);
-- 구매 신청: 이름·단위·값은 신청 때 그대로 남긴다. 코인은 pending·done 인 동안 빠진다 (cancel·reject 면 돌아온다)
CREATE TABLE IF NOT EXISTS gc_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_id INTEGER,
  name TEXT NOT NULL,
  unit TEXT,
  price INTEGER NOT NULL,                 -- 하나 값
  qty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | reject | cancel
  note TEXT,                              -- 반려 의견
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  done_by TEXT
);
CREATE INDEX IF NOT EXISTS gc_orders_user ON gc_orders (user_id, status);
CREATE INDEX IF NOT EXISTS gc_orders_status ON gc_orders (status, created_at);
-- 레벨업 말고 들어오고 나간 코인: rank (주간 성장 순위 보너스, ref 'w<주 시작 ms>'), adjust (오피서가 손으로 더하거나 뺌). 지우지 않는다
CREATE TABLE IF NOT EXISTS gc_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  note TEXT,
  by_user TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS gc_ledger_once ON gc_ledger (user_id, kind, ref);
-- 2주 목표 선착순 (시범운영, server/gcrace.ts): 판(시작 ms)마다 사람마다 목표 레벨. from_level 은 정할 때 레벨 (달성률 0%). 달성은 level_log 로 센다
-- 주간 목표 판의 기간 (담당자가 '며칠 00시 ~ 며칠 24시'로 정한다, server/gcrace.ts). id 는 처음 정한 시작 때, 목표·상금이 id 로 잇는다. 없으면 기본 판(1주 진행 1주 휴식)
CREATE TABLE IF NOT EXISTS gc_rounds (
  id INTEGER PRIMARY KEY,
  start INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  set_at INTEGER NOT NULL,
  set_by TEXT
);
-- 끝난 주간 목표 판의 결과 (담당자 > 기록). 판이 끝나면 한 번 남기고 지우지 않는다 (계정을 지워도 남음)
CREATE TABLE IF NOT EXISTS gc_round_results (
  round INTEGER NOT NULL,
  start INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  from_level INTEGER NOT NULL,
  target INTEGER NOT NULL,
  level INTEGER NOT NULL,
  exp INTEGER,
  done_at INTEGER,
  pct REAL NOT NULL,
  coins INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (round, user_id)
);
CREATE TABLE IF NOT EXISTS gc_targets (
  round INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  from_level INTEGER NOT NULL,
  target INTEGER NOT NULL,
  set_at INTEGER NOT NULL,
  set_by TEXT,
  PRIMARY KEY (round, user_id)
);
-- 연속 성장 (server/gcoin.ts settleWeeks): 사람마다 마지막으로 코인을 번 주(시작 ms)와 그때까지 이어진 주 수. 2주째부터 연속 보너스 (gc_ledger kind streak)
CREATE TABLE IF NOT EXISTS gc_streak (
  user_id TEXT PRIMARY KEY,
  week INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- 기부함 (개발중, 제작자 2026-11-10 길드 톡방 '모든 템을 골드로 환산하고 마일리지 환산', '기부하게 따로 기부함 만들게', 마을모금함 '마일리지 순위표, 명예의 전당'):
-- 길드원이 게임 안에서 운영진에게 넘긴 템(장비만이 아니라 모든 템)을 골드 가치로 매겨 장비대여와 같은 마일리지(💎 1 = 10만 골드, rental_mileage)로 쌓는다.
-- 길드원이 기부 신청(가치를 적어서)하면 운영진이 고쳐 확정하거나, 운영진이 바로 적는다. 💎 는 그 사람이 확정받은 골드 합의 내림 (dia 는 이 줄로 장부에 넣은 몫)
CREATE TABLE IF NOT EXISTS donate_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,                      -- 기부한 사람 닉네임 (앱에 없는 사람도)
  item TEXT NOT NULL,                     -- 아이템 이름
  qty INTEGER NOT NULL DEFAULT 1,
  enhance INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  options TEXT,                           -- 위키 장비에 뜬 옵션 '명중 9 · 크리티컬 4' (ci-d1 ADDED_COLUMNS 로 더한 칸)
  enchant TEXT,                           -- 장신구 속성부여 '힘 3'
  gold_ask INTEGER,                       -- 기부한 사람이 적은 골드 가치
  gold INTEGER,                           -- 운영진이 확정한 골드 가치
  dia INTEGER NOT NULL DEFAULT 0,         -- 이 줄로 rental_mileage 에 넣은 💎 (같은 사람 줄의 합 = 확정 골드 합 / 10만 내림)
  status TEXT NOT NULL,                   -- request(확인 전) | done(확정) | rejected | removed(지움)
  place TEXT NOT NULL DEFAULT 'keep',     -- keep(보관) | rent(장비대여로 넘김) | used(나눔·사용)
  rental_id INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  done_at INTEGER,
  done_by TEXT
);
CREATE INDEX IF NOT EXISTS donate_items_status ON donate_items (status, created_at);
CREATE INDEX IF NOT EXISTS donate_items_who ON donate_items (who);

-- 건의 결재선 이력 (server/suggest.ts, 제작자 2026-11-10 '건의함이 게시판이 아니잖아, 결재선'). 상태는 board_posts.sg_status (ci-d1 ADDED_COLUMNS), 지우지 않는다 (글을 지우면 같이)
CREATE TABLE IF NOT EXISTS suggest_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- agree | approve | skip(길마 직권) | force(반려 뒤 강제) | reject | done(반영 완료)
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS suggest_steps_post ON suggest_steps (post_id, id);

-- 장비대여에만 있는 기부자의 마일리지 (제작자 2026-11-10 '장비대여에만 있는 기부자, 웹 로그인 했을 때 줘', server/donate.ts grantRentDonation):
-- who = 명예의 전당 장비대여 기부(status 'honor')의 기부자 이름. 그 이름의 캐릭터가 앱을 열면(/api/me) 한 번 마일리지를 넣고 granted_at 을 적는다
CREATE TABLE IF NOT EXISTS donate_grants (
  who TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  granted_at INTEGER,
  granted_to TEXT,
  dia INTEGER
);

-- 자료 저장소 전체를 챗봇이 읽게 (제작자 2026-11-10, scripts/library-sync.mjs 가 채우고 server/library.ts 가 찾는다). 길드/ 아래는 staff 1 (오피서 이상)
CREATE TABLE IF NOT EXISTS lib_files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, parts INTEGER NOT NULL, staff INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lib_chunks (path TEXT NOT NULL, part INTEGER NOT NULL, staff INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, PRIMARY KEY (path, part));
