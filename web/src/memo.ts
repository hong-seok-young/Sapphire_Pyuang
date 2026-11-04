// 이번에 연 동안 받은 목록 (제작자 2026-11-04 '화면 전환이나 버튼 동작별로 반응이 늦다'): 같은 화면에 다시 들어오면 새로 받는 동안 지난번 것을 바로 보인다.
// 읽기만 하는 목록에만 쓴다 (칠하기·체크처럼 받은 값으로 고치는 화면은 옛 값으로 고칠 수 있어 쓰지 않는다). 로그아웃하면 비운다
const memo = new Map<string, unknown>();

export const peekMemo = <T>(key: string | undefined): T | undefined => (key === undefined ? undefined : (memo.get(key) as T | undefined));
export const putMemo = (key: string | undefined, value: unknown) => {
  if (key !== undefined) memo.set(key, value);
};
export const clearMemo = () => memo.clear();
