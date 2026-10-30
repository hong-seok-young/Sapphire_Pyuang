import { Panel, TopBar } from "../ui";
import { APK_URL, appMenu, isAndroid } from "../platform";

/**
 * 앱 안에서 누르는 앱 기능. sapphire:// 주소는 안드로이드 앱(MainActivity)이 받아서 그 기능을 연다.
 * 앱의 맨 윗줄 메뉴를 없애고 아래 탭 '앱'으로 옮겼다.
 */
const APP_ACTIONS = [
  { href: "sapphire://clock", icon: "⏰", title: "시계 설정", sub: "시계 켜기, 게임 연동, 모양, 위치" },
  { href: "sapphire://float", icon: "📖", title: "게임 위에 띄우기", sub: "게임을 끄지 않고 위키를 작은 창으로 봐요" },
  { href: "sapphire://timer", icon: "⏱️", title: "타이머 설정", sub: "보스·네임드 목록, 내가 만든 타이머, 시각 알림" },
  { href: "sapphire://share", icon: "🔗", title: "웹앱 링크 보내기", sub: "카톡 등으로 길드원에게 위키 주소 보내기" },
  { href: "sapphire://reload", icon: "🔄", title: "새로고침", sub: "위키를 다시 불러와요" },
];

/**
 * 앱 안에서는 앱 기능 목록, 브라우저에서는 안드로이드 앱 받기.
 * 웹앱은 위키와 챗봇만 맡고, 게임 위에 뜨는 기능은 안드로이드 앱에만 있다.
 * 웹앱만 쓰는 사람은 폰에 아무것도 깔지 않는다. (CLAUDE.md 앱 구성)
 */
export function AppPage() {
  if (appMenu) {
    return (
      <>
        <TopBar title="앱 기능" />
        <ul className="list">
          {APP_ACTIONS.map((a) => (
            <li key={a.href}>
              <a className="row" href={a.href}>
                <span className="row-pic">{a.icon}</span>
                <span className="row-main">
                  <span className="row-title">{a.title}</span>
                  <span className="row-sub">{a.sub}</span>
                </span>
                <span className="row-arrow">▶</span>
              </a>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <>
      <TopBar title="안드로이드 앱" />
      <Panel title="앱에서만 되는 것">
        <ul className="app-list">
          <li>⏰ 게임 위에 초 단위 시계</li>
          <li>⏱ 보스·네임드 젠 타이머: 잡은 뒤 직접 누르면 다시 나올 때까지 세 줘요</li>
          <li>📖 게임을 끄지 않고 게임 화면 위 작은 창으로 위키 보기</li>
          <li>위키 내용은 이 웹앱과 똑같아요</li>
        </ul>
      </Panel>
      <Panel title="게임은 건드리지 않아요">
        <p className="app-note">
          게임 화면을 읽거나 터치를 대신 보내지 않고, 게임 파일이나 통신에도 손대지 않아요. 화면 위에 시계와 창을
          따로 그릴 뿐이에요. 그래도 걱정되면 이 웹앱만 쓰면 돼요.
        </p>
      </Panel>
      {isAndroid ? (
        <>
          <div className="links">
            <a className="btn" href={APK_URL}>📲 앱 받기</a>
          </div>
          <Panel title="설치할 때">
            <p className="app-note">
              받을 때 브라우저가 해로울 수 있는 파일이라고 경고하면 그래도 받기를 누르세요. 처음 한 번은 '출처를 알 수
              없는 앱 설치'를 허용해야 해요. 설치한 뒤에는 앱 안에서 새 버전을 알려 줘요.
            </p>
          </Panel>
        </>
      ) : (
        <div className="soon">
          <p>안드로이드 전용이에요. 아이폰은 이 웹앱을 Safari 에서 열고 '홈 화면에 추가'해서 쓰면 돼요.</p>
        </div>
      )}
    </>
  );
}
