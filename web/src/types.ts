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
  info: string;
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
  rows: { name: string; icon: Pic | null; cells: string[] }[];
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
