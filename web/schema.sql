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
  push_at INTEGER                         -- 그 상태를 마지막으로 확인한 때
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
  mode TEXT NOT NULL DEFAULT 'sale',      -- sale 바로 판매 (흥정은 listing_wants.offer) | auction 경매 (price = 시작가)
  ends_at INTEGER,                        -- 경매가 끝나는 때
  auto_auction INTEGER,                   -- 바로 판매인데 '살래요'가 2명 이상이면 저절로 이 시간짜리 경매로 (올릴 때 정함)
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

-- 길드원 의뢰소: 의뢰를 올리고 모아 둔 길드원이 선착순으로 수락한 뒤 게임 안에서 거래한다 (server/requests.ts)
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,                    -- 의뢰한 길드원
  title TEXT NOT NULL,                    -- 의뢰 (예: 검은진액 100개)
  detail TEXT,                            -- 자세한 설명 (없어도 됨)
  reward_gold INTEGER,                    -- 보상 골드 (골드로 줄 때)
  reward_text TEXT,                       -- 보상 (골드가 아닐 때 자유롭게)
  status TEXT NOT NULL DEFAULT 'open',    -- open 모집 중 | accepted 진행 중 (이틀 지나면 다시 open) | done 완료 (30일 뒤 지운다)
  accepter TEXT,                          -- 수락한 길드원 (선착순 한 명)
  accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 길드원이 직접 올린 자기 캐릭터 그림 (랭킹 시상대에 선다). '내 정보'에서 사용자가 고른 스샷을 잘라 만든 PNG
CREATE TABLE IF NOT EXISTS avatars (
  user_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,            -- 올린 때. 화면이 그림 주소에 붙여 바뀌면 새로 받는다
  updated_by TEXT,
  png BLOB NOT NULL                       -- 맨 끝 칸 (랭킹은 updated_at 만 읽는다)
);

-- 사용 기록 (앱개발자만 본다, 60일 보관, server/activity.ts): 접속, 화면, 한 일.
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
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_at ON activity (at);
CREATE INDEX IF NOT EXISTS activity_user_at ON activity (user_id, at);

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
  done_by TEXT
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
  edited_at INTEGER
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
  created_at INTEGER NOT NULL
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

