import { Panel, TopBar } from "../ui";
import { APK_URL, inApp, isAndroid } from "../platform";

/**
 * 안드로이드 앱 받기. 웹앱은 위키와 챗봇만 맡고, 게임 위에 뜨는 기능은 안드로이드 앱에만 있다.
 * 웹앱만 쓰는 사람은 폰에 아무것도 깔지 않는다. (CLAUDE.md 앱 구성)
 */
export function AppPage() {
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
      {inApp ? (
        <div className="soon">
          <p>지금 앱으로 보고 있어요. 위쪽 ⏰ 시계 메뉴에서 시계와 타이머를 쓸 수 있어요.</p>
        </div>
      ) : isAndroid ? (
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
