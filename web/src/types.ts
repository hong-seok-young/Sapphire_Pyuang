// public/data/*.json 의 모양 (scripts/build_data.py 가 만든다)

export interface Pic {
  src: string;
  w: number;
  h: number;
  /** 본문에서 뺀 움짤 자리 (그림 파일 없이 화면이 '원글 보기' 줄만 단다) */
  gif?: 1;
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
  posts: { id: string; title: string }[];
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
  level: [number, number] | null;
  desc: string | null;
  banner: Pic | null;
  monsters: string[];
  /** 원글(posts.json)에서 그대로 그릴 칸 번호. above 는 몬스터 위(옆 사냥터로 가는 길), below 는 아래(지도, 퀘스트, 참고 등) */
  above: number[];
  below: number[];
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
