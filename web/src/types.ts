// public/data/*.json 의 모양 (scripts/build_data.py 가 만든다)

export interface Pic {
  src: string;
  w: number;
  h: number;
}

/** 글 본문 조각: 글자 / 그림. to 가 있으면 링크 ("post:123" 은 위키 안의 글, 그 밖에는 바깥 주소) */
export type Run = ({ t: string; b?: 1; c?: string } | Pic) & { to?: string };

export interface Cell {
  l: Run[][]; // 줄마다 조각 목록
  cs?: number;
  rs?: number;
  bg?: string;
}

export type Block = { k: "p"; r: Run[] } | { k: "table"; rows: Cell[][] };

export interface Post {
  id: string;
  title: string;
  blocks: Block[];
  /** 본문에서 뺀 움짤 수 (원글 작성자가 찍은 것이라 원글에서 본다) */
  gifs?: number;
}

export interface MenuSection {
  title: string;
  index?: string | null;
  equip?: boolean;
  /** orig: 앱에 보일 것이 없는 글 (지도, 스샷뿐). 메뉴에서 누르면 바로 카페 원글 (build_data.py shows_something) */
  posts: { id: string; title: string; orig?: 1 }[];
}

export interface Region {
  name: string;
  pic: Pic | null;
  places: string[];
}

export interface Place {
  id: string;
  name: string;
  title: string;
  region: string;
  /** [30, null] = 'Lv.30 이상' (길드던전처럼 입장 레벨만 있는 곳, 자료 지도_목록.json 의 레벨) */
  level: [number, number | null] | null;
  desc: string | null;
  banner: Pic | null;
  monsters: string[];
  /** 원글(posts.json)에서 그대로 그릴 칸 번호. above 는 몬스터 위(옆 사냥터로 가는 길), below 는 아래(지도, 퀘스트, 참고 등) */
  above: number[];
  below: number[];
  /** 길드가 정한 자리 나누기 (비공개 자료 길드/사냥터_자리.json, build_data.py place_guides): 화면 맨 위 '자리 안내'와 챗봇 자료 */
  guide?: PlaceGuide;
}

export interface PlaceGuide {
  title: string;
  /** 누가 알렸는지 ('마을모금함 (길드 잡담방, 2026-11-10)') */
  by: string;
  notes: string[];
  /** 챗봇이 이 안내를 붙이는 말 ('신전', '루나프' …) */
  words: string[];
  pics: { src: string; w: number; h: number; caption: string }[];
}

export interface Monster {
  key: string;
  name: string;
  level: number | null;
  hp: number | null;
  traits: string;
  drops: string[];
  place: string;
  img: Pic | null;
  respawn?: string;
  skill?: string;
  note?: string;
  /** 헌팅그라운드처럼 단계가 둘인 몬스터: ['34', '49'] / ['2,050', '5,800'] */
  levels?: string[];
  hps?: string[];
}

export interface EquipInfo {
  slot: string;
  post: string;
  info: Record<string, string>;
}

export interface Item {
  name: string;
  icon: Pic | null;
  from: string[];
  equip: EquipInfo[];
}

export interface EquipTable {
  slot: string;
  post: string;
  headers: string[];
  /** h: 이 줄의 표가 글의 첫 표와 칸이 다를 때 그 표의 머리줄 */
  rows: { name: string; icon: Pic | null; cells: string[]; h?: string[]; jobIcon?: Pic | null }[];
}

export interface Meta {
  source: { 제목: string; 작성자: string; 글: string; 패치: string };
  built: string;
  counts: Record<string, number>;
  /** 길드 통제 리스트 (중립 길드라 잡지 않는 몹, 비공개 자료 길드/통제_리스트.json) */
  control?: ControlList;
}

/** 길드 통제 리스트 (meta.json control, build_data.py control_list): 중립 길드라 잡지 않는 몹 */
export interface ControlList {
  title: string;
  server: string;
  by: string;
  date: string;
  rule: string;
  groups: { place: string; mark: string; placeId: string; mobs: ControlMob[] }[];
}

/** name 리스트에 적힌 이름, note 덧붙인 말('하트 양보제'), key 위키 몬스터 (없으면 "") */
export interface ControlMob {
  name: string;
  note: string;
  key: string;
}

export interface Wiki {
  menu: MenuSection[];
  regions: Region[];
  places: Record<string, Place>;
  monsters: Record<string, Monster>;
  items: Record<string, Item>;
  equipment: EquipTable[];
  meta: Meta;
}
