// 튜토리얼 동안만 화면에 보이는 예시 자료 (제작자 2026-11-03: '화면 예시는 튜토리얼 전용 가상 데이터로 하는 게 좋지 않나').
// 번호는 음수(SAMPLE_ID)라 서버로 가지 않고, 줄에는 '예시' 표(.sample-tag)와 data-tut-sample 이 붙어 튜토리얼이 그 줄을 먼저 비춘다.
// 튜토리얼이 끝나면 useSample 이 false 가 되어 그대로 사라진다. 각 화면은 목록 맨 앞에 끼워 넣기만 한다 (실제 자료는 손대지 않는다).
import { JOB_NAME } from "./auth";
import type { Job } from "./auth";
import type { ChatGap } from "./chat";
import { EMPTY, slotOf } from "./gdungeon";
import type { PartyState } from "./gdungeon";
import type { Listing } from "./market";
import type { RentItem } from "./rental";
import type { GuildRequest } from "./requests";
import type { TodoItem } from "./todo";
import type { Wiki } from "./types";

export const SAMPLE_ID = -1;
/** 예시 자료의 사람 이름 */
export const SAMPLE_NAME = "길잡이";
export const isSample = (id: number) => id < 0;

/** 중개인 예시 물건 */
export function sampleListing(now = Date.now()): Listing {
  return {
    id: SAMPLE_ID,
    seller: SAMPLE_NAME,
    item: "고대의봉",
    category: "주장비",
    enhance: 8,
    enchant: null,
    enchantValue: null,
    qty: 1,
    price: 2_000_000,
    note: "예시 물건이에요",
    options: null,
    status: "selling",
    mode: "sale",
    saleWhen: null,
    endsAt: null,
    autoAuction: null,
    createdAt: now - 3_600_000,
    updatedAt: now - 3_600_000,
    wants: 2,
    wanted: false,
    myOffer: null,
    bidCount: 0,
    talkCount: 1,
    highestBid: null,
    myBid: null,
  };
}

/** 의뢰소 예시 의뢰 */
export function sampleRequest(now = Date.now()): GuildRequest {
  return {
    id: SAMPLE_ID,
    owner: SAMPLE_NAME,
    title: "검은진액 100개 (예시)",
    detail: "다 모으면 게임 안에서 거래해요",
    rewardGold: 50_000,
    rewardText: null,
    status: "open",
    accepter: null,
    acceptedAt: null,
    dueAt: null,
    createdAt: now - 7_200_000,
    updatedAt: now - 7_200_000,
  };
}

/** 그 직업의 위키 무기 중 레벨 30 아래에서 가장 높은 것 (없으면 아무 무기) */
function pickWeapon(wiki: Wiki, job: Job): { name: string; level: number } {
  const slot = `${JOB_NAME[job]} 무기`;
  let best: { name: string; level: number } | null = null;
  for (const it of Object.values(wiki.items)) {
    for (const e of it.equip ?? []) {
      if (e.slot !== slot) continue;
      const lv = Number(e.info["레벨제한"]) || 0;
      if (lv <= 30 && (!best || lv > best.level))
        best = { name: it.name, level: lv };
    }
  }
  return best ?? { name: "예시 무기", level: 30 };
}

/** 장비대여 예시 무기 (지금 보는 직업 칸에) */
export function sampleRentItem(wiki: Wiki, job: Job): RentItem {
  const w = pickWeapon(wiki, job);
  return {
    id: SAMPLE_ID,
    job,
    level: w.level,
    weapon: w.name,
    options: "명6크3",
    enhance: 7,
    term: "4w",
    price: 12,
    donor: SAMPLE_NAME,
    note: null,
    renter: null,
    rentedAt: null,
    dueAt: null,
    queue: 1,
    next: null,
    mine: null,
  };
}

/** 길드 던전 예시 파티: 나와 길잡이 셋, 금요일 21:00 이 1번 후보 (길잡이 한 명은 확정한 상태) */
export function sampleParty(me: string): PartyState {
  const members = [me, SAMPLE_NAME, "길잡이2", "길잡이3"];
  const cands = [slotOf(1, 24), slotOf(2, 24), slotOf(5, 22)]; // 금 21:00, 토 21:00, 화 20:00
  const mark = (extra: number[]) => {
    const a = EMPTY.split("");
    for (const s of [...cands, ...extra]) a[s] = "1";
    return a.join("");
  };
  const avail: Record<string, string> = {};
  members.forEach(
    (m, k) =>
      (avail[m] = mark([slotOf(1, 22 + k), slotOf(2, 26 + k), slotOf(6, 24)])),
  );
  return {
    id: SAMPLE_ID,
    name: `${SAMPLE_NAME} 팀 (예시)`,
    leader: SAMPLE_NAME,
    members: members.map((id) => ({ id, filled: true })),
    avail,
    candidates: cands,
    rejected: [],
    current: cands[0],
    yes: [SAMPLE_NAME],
    confirmed: null,
  };
}

/** 챗봇 개선 예시 */
export function sampleGap(now = Date.now()): ChatGap {
  return {
    id: SAMPLE_ID,
    user_id: SAMPLE_NAME,
    thread_id: 0,
    question: "예시: 고대의봉은 어디서 구해요?",
    answer: null,
    reason: "자료에 획득처가 없어요 (예시)",
    kind: "bot",
    status: "open",
    note: null,
    created_at: now - 1_800_000,
    fixed_at: null,
  };
}

/** To do 예시 이벤트 할 일 (펼치면 할 것과 손해 주의가 보인다) */
export function sampleTodo(): TodoItem {
  return {
    key: "sample:event",
    text: "예시 이벤트 퀘스트",
    note: "NPC 길잡이",
    right: "~11/30",
    tag: "주간",
    steps: ["NPC 길잡이에게 퀘스트 받기", "재료 10개 모아 보상 상자 열기"],
    warns: ["교환 마감이 이벤트 끝보다 빨라요"],
  };
}
