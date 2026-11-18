// 오류·개선 접수 단추(ui.tsx FixButton)가 알아야 하는 것: 지금 사람이 접수를 처리하는 운영진(오피서 이상)인지. App 이 로그인할 때 적는다
let staff = false;
export const setFixStaff = (on: boolean) => {
  staff = on;
};
export const isFixStaff = () => staff;
