// 배포 전에 위키 자료(public/data)가 있고 지금 코드와 모양이 맞는지 확인한다 (npm run deploy 가 먼저 부른다).
// 자료 없이 배포하면 사이트 자료가 빠지고, 예전 자료면 사냥터 화면에 지도와 안내가 안 보인다.
// 자료는 python web/scripts/build_data.py 가 ../자료 에서 만든다.
import { existsSync, readFileSync } from "node:fs";

const dir = new URL("../public/data/", import.meta.url);
const need = ["menu", "regions", "places", "monsters", "items", "equipment", "meta", "posts"];
const missing = need.filter((n) => !existsSync(new URL(n + ".json", dir)));
let problem = missing.length ? "없는 파일: " + missing.join(", ") : "";
if (!problem) {
  const places = Object.values(JSON.parse(readFileSync(new URL("places.json", dir), "utf8")));
  if (!places.length || !places.every((p) => Array.isArray(p.above) && Array.isArray(p.below))) {
    problem = "예전 모양의 자료 (사냥터에 above, below 가 없음)";
  }
}
if (problem) {
  console.error("위키 자료를 먼저 새로 만들어 주세요: python web/scripts/build_data.py\n(" + problem + ")");
  process.exit(1);
}
console.log("위키 자료 확인 완료");
