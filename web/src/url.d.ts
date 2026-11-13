// Vite 의 '?url' 가져오기 (파일 주소만 받는다)
declare module "*?url" {
  const url: string;
  export default url;
}
