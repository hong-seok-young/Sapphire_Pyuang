// 부캐 묶기 (제작자 요청 2026-11-01): 같은 사람의 캐릭터들. 본캐 아이디와 비밀번호로 로그인하고 👤 에서 캐릭터를 바꾼다.
// 👤 단추(ui.tsx MeButton)가 어느 화면에서든 목록을 보도록 App 이 로그인한 사람의 캐릭터를 여기 넣어 둔다
import { useSyncExternalStore } from "react";
import { switchCharacter } from "./auth";
import type { Character, Me } from "./auth";

interface Mine {
  current: string;
  list: Character[];
}

let mine: Mine = { current: "", list: [] };
const subs = new Set<() => void>();

export function setMyCharacters(me: Me) {
  const list = me.characters ?? [];
  if (mine.current === me.id && JSON.stringify(mine.list) === JSON.stringify(list)) return;
  mine = { current: me.id, list };
  for (const s of subs) s();
}

export function useMyCharacters(): Mine {
  return useSyncExternalStore(
    (s) => {
      subs.add(s);
      return () => subs.delete(s);
    },
    () => mine,
  );
}

const SWITCHED = "sapphire.charSwitched";

/** 그 캐릭터로 바꾸고 to 화면을 새로 연다 (알림, 새 글 숫자, 배치가 모두 그 캐릭터 것으로 바뀌게 새로고침) */
export async function goCharacter(id: string, to = "#/me"): Promise<void> {
  if (id !== mine.current) await switchCharacter(id);
  try {
    sessionStorage.setItem(SWITCHED, "1");
  } catch {
    // 못 적으면 오픈 축하가 한 번 더 뜰 뿐
  }
  history.replaceState(null, "", to);
  location.reload();
}

/** 방금 캐릭터를 바꿔서 새로 연 것인지 (한 번 읽으면 지운다). 캐릭터를 바꾼 것은 새로 들어온 것이 아니라 오픈 축하를 다시 띄우지 않는다 */
export function justSwitched(): boolean {
  try {
    const v = sessionStorage.getItem(SWITCHED);
    sessionStorage.removeItem(SWITCHED);
    return v === "1";
  } catch {
    return false;
  }
}

/** 그 사람(본캐) 아이디: 기기에 사람마다 적는 것('더 이상 보지 않기')은 캐릭터를 바꿔도 같게 */
export const personOf = (me: Me) => me.characters?.find((c) => c.main)?.id ?? me.id;
