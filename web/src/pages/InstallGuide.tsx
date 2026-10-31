import { useEffect, useState } from "react";
import { ICON_VERSION, WEB_URL, inKakao, inNaver, inSamsung, isAndroid, isIOS, standalone } from "../platform";

/** 브라우저가 미리 잡아 둔 설치 창 (index.html 머리 스크립트가 beforeinstallprompt 를 받아 둔다) */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
declare global {
  interface Window {
    __installPrompt?: InstallPrompt | null;
  }
}

/** 주소 복사 (WebView 에 clipboard API 가 없으면 예전 방식으로) */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

function CopyAddress({ url = WEB_URL }: { url?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="guide-url">
      <b>{WEB_URL.replace(/^https:\/\//, "")}</b>
      <button className="pill" onClick={async () => setCopied(await copyText(url))}>
        {copied ? "복사됨" : "주소 복사"}
      </button>
    </div>
  );
}

/**
 * 안드로이드 앱은 검토 후 오픈 (제작자 요청 2026-10-31: 지금은 웹만 쓴다).
 * 이미 앱을 깐 사람에게는 앱(과 게임 위 위키 창) 안에서 이 안내만 보이고 웹 주소로 보낸다.
 * 앱은 같은 주소를 앱 안에서 열기 때문에, 크롬과 삼성 인터넷을 여는 주소(googlechrome://, samsunginternet://)로 바깥 브라우저를 연다.
 */
export function AppClosedPage({ onLogin }: { onLogin?: () => void }) {
  const target = encodeURIComponent(WEB_URL);
  return (
    <div className="guide">
      <img className="guide-mark" src="guild-mark.png" alt="" width={72} height={72} />
      <b className="guide-name">Sapphire</b>
      <h1 className="guide-title">앱은 검토 후 오픈해요</h1>
      <p className="guide-text">지금은 웹으로 써 주세요. 브라우저로 열고 홈 화면에 추가하면 앱처럼 써요.</p>
      <div className="guide-buttons">
        <a className="btn" href={`googlechrome://navigate?url=${target}`}>
          크롬으로 열기
        </a>
        <a className="btn" href={`samsunginternet://open?url=${target}`}>
          삼성 인터넷으로 열기
        </a>
      </div>
      <CopyAddress />
      {/* 앱은 스스로 지워지지 않는다 (안드로이드 규칙). 웹으로 옮긴 뒤 지우라고 알린다 (제작자 요청) */}
      <p className="guide-text">웹을 홈 화면에 설치했으면 이 앱은 지워 주세요. 앱 아이콘을 길게 눌러 '삭제'(또는 '제거')를 누르면 돼요.</p>
      {/* 앱개발자는 앱을 그대로 쓴다: 로그아웃돼 있으면 여기서 로그인 */}
      {onLogin && (
        <button className="btn btn-ghost guide-later" onClick={onLogin}>
          개발자 로그인
        </button>
      )}
    </div>
  );
}

/** 지금 브라우저에서 홈 화면에 추가하는 법 */
function steps(): { how: string; fix?: { label: string; href: string } } {
  if (inKakao) {
    return {
      how: "카카오톡 안에서는 설치가 안 돼요. 오른쪽 아래 ⋮ → '다른 브라우저로 열기'를 눌러 주세요.",
      fix: isIOS ? undefined : { label: "브라우저로 열기", href: `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}` },
    };
  }
  if (inNaver) return { how: "네이버 앱 안에서는 설치가 안 돼요. 아래 ⋮ → '기본 브라우저로 열기'를 눌러 주세요." };
  if (isIOS) return { how: "아래 공유 버튼(□↑) → '홈 화면에 추가' → '추가'를 눌러 주세요." };
  if (inSamsung) return { how: "아래 메뉴(≡) → '현재 페이지 추가' → '홈 화면'을 눌러 주세요." };
  return { how: "오른쪽 위 ⋮ → '홈 화면에 추가' 또는 '앱 설치'를 눌러 주세요." };
}

/**
 * 폰 브라우저로 열면 처음에 홈 화면에 설치하라고 안내한다 (제작자 요청: 안드로이드, 갤럭시, 아이폰).
 * 크롬처럼 설치 창을 띄울 수 있는 브라우저면 '설치' 단추 하나로, 아니면 그 브라우저의 메뉴 순서를 보인다.
 * '나중에'를 누르면 이번에 연 동안은 다시 보이지 않는다.
 */
export function InstallGuide({ onLater }: { onLater: () => void }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(() => window.__installPrompt ?? null);
  useEffect(() => {
    const ready = () => setPrompt(window.__installPrompt ?? null);
    const done = () => onLater();
    window.addEventListener("sapphire-installable", ready);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("sapphire-installable", ready);
      window.removeEventListener("appinstalled", done);
    };
  }, [onLater]);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    window.__installPrompt = null;
    setPrompt(null);
    if (outcome === "accepted") onLater();
  }

  const { how, fix } = steps();
  return (
    <div className="guide">
      <img className="guide-mark" src="guild-mark.png" alt="" width={72} height={72} />
      <b className="guide-name">Sapphire</b>
      <h1 className="guide-title">홈 화면에 설치해 주세요</h1>
      <p className="guide-text">설치하면 앱처럼 바로 열리고 로그인도 계속 유지돼요.</p>
      {prompt && !inKakao && !inNaver ? (
        <div className="guide-buttons">
          <button className="btn" onClick={install}>
            📲 설치
          </button>
        </div>
      ) : (
        <>
          <p className="guide-how">{how}</p>
          {fix && (
            <div className="guide-buttons">
              <a className="btn" href={fix.href}>
                {fix.label}
              </a>
            </div>
          )}
        </>
      )}
      <button className="btn btn-ghost guide-later" onClick={onLater}>
        나중에
      </button>
    </div>
  );
}

const ICON_LATER = "sapphire-icon-later";
/** '재설치 완료'를 누른 판 (이 폰에서는 다시 안 뜬다) */
const ICON_DONE = "sapphire.iconReinstalled";

/**
 * 홈 화면 아이콘이 바뀌었으니 지우고 다시 설치하라는 안내를 보일지 (제작자 요청: 다시 깐 사람에게는 안 뜨고, 안 깐 사람에게는 계속).
 * 새로 깐 홈 화면 웹앱은 시작 주소에 ?icon=지금 판 이 붙어 열린다 (manifest start_url). 브라우저에서는 '홈 화면에 추가'가
 * 지금 주소로 깔리기도 하므로 주소에 판을 붙여 둔다. '나중에'는 이번에 연 동안만 닫는다
 */
export function iconNoticeNeeded(): boolean {
  const fresh = new URLSearchParams(location.search).get("icon") === ICON_VERSION;
  if (!standalone()) {
    if (!fresh) {
      const u = new URL(location.href);
      u.searchParams.set("icon", ICON_VERSION);
      history.replaceState(history.state, "", u);
    }
    return false;
  }
  if (fresh) return false;
  try {
    if (localStorage.getItem(ICON_DONE) === ICON_VERSION) return false;
    if (sessionStorage.getItem(ICON_LATER)) return false;
  } catch {
    // 못 읽으면 안내를 보인다
  }
  return isAndroid || isIOS;
}

export function IconChangedPage({ onDone }: { onDone: () => void }) {
  const later = () => {
    try {
      sessionStorage.setItem(ICON_LATER, "1");
    } catch {
      // 못 적어도 이번에는 닫힌다
    }
    onDone();
  };
  // 다시 깔았는데도 안내가 뜨면 (삼성 인터넷 바로가기 등) 눌러서 이 폰에서는 끈다 (제작자 요청)
  const reinstalled = () => {
    try {
      localStorage.setItem(ICON_DONE, ICON_VERSION);
    } catch {
      // 못 적어도 이번에는 닫힌다
    }
    onDone();
  };
  return (
    <div className="guide">
      <img className="guide-icon" src="icon-192.png" alt="" width={84} height={84} />
      <h1 className="guide-title">앱 아이콘이 바뀌었어요</h1>
      <p className="guide-text">지금 홈 화면 아이콘은 예전 것이에요. 지우고 다시 설치해 주세요. 다시 설치하면 이 안내는 더 안 떠요.</p>
      <ol className="guide-steps">
        <li>홈 화면의 Sapphire 아이콘을 길게 눌러 {isIOS ? "'앱 제거' → '홈 화면에서 제거'" : "'삭제'(또는 '제거')"}</li>
        <li>{isIOS ? "사파리" : "크롬이나 삼성 인터넷"}에서 아래 주소 열기</li>
        <li>{isIOS ? "공유 버튼(□↑) → '홈 화면에 추가'" : "메뉴 → '홈 화면에 추가'(또는 '앱 설치')"}</li>
      </ol>
      <CopyAddress url={`${WEB_URL}/?icon=${ICON_VERSION}`} />
      {isIOS && <p className="guide-text">다시 설치하면 로그인을 한 번 더 해야 할 수 있어요.</p>}
      <div className="guide-buttons">
        <button className="btn" onClick={reinstalled}>
          재설치 완료
        </button>
        <button className="btn btn-ghost" onClick={later}>
          나중에
        </button>
      </div>
    </div>
  );
}

