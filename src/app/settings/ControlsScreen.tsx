import { DetailFold } from '../common/DetailFold';
import { ReplyRow } from '../common/ReadingRows';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { runShortcut } from '../shortcuts';
import { Button, NavBar, Screen, Section, SettingGroup, SettingRow, Switch } from '../ui';

export function ControlsScreen({ back }: { back: Back | null }) {
  const { display, changeDisplay } = useDisplay();
  return (
    <Screen width="form" top={<NavBar title={PAGES.controls} {...backBar(back)} />}>
      <Section title="스크롤할 때">
        <SettingGroup label="스크롤할 때">
          <ReplyRow />
          <SettingRow
            label="헤더 숨기기"
            help={{ text: '아래로 스크롤하면 숨기고, 위로 스크롤하면 다시 보여요.', demo: { name: 'hideHeader', ways: { on: display.hideHeader } } }}
            control={<Switch label="헤더 숨기기" checked={display.hideHeader} onChange={(hideHeader) => changeDisplay({ hideHeader })} />}
          />
          <SettingRow
            label="입력창 접기"
            help={{ text: '위로 스크롤하면 쓰던 글도 한 줄로 접고, 누르거나 맨 아래로 내려가면 다시 펼쳐요.', demo: { name: 'foldComposer', ways: { on: display.foldComposer } } }}
            control={<Switch label="입력창 접기" checked={display.foldComposer} onChange={(foldComposer) => changeDisplay({ foldComposer })} />}
          />
          <SettingRow
            label="메시지 도구 따라오기"
            help={{ text: '긴 메시지를 읽는 동안 메시지 도구를 입력창 위에 붙여 둬요.' }}
            control={<Switch label="메시지 도구 따라오기" checked={display.toolsFollow} onChange={(toolsFollow) => changeDisplay({ toolsFollow })} />}
          />
          <SettingRow
            label="빠른 스크롤 막대"
            help={{ text: '오른쪽 막대를 끌면 메시지마다 멈춰요.', demo: { name: 'scrubber' } }}
            control={<Switch label="빠른 스크롤 막대" checked={display.scrubber} onChange={(scrubber) => changeDisplay({ scrubber })} />}
          />
          <SettingRow
            label="메시지 이동 버튼"
            help={{ text: '누르면 메시지 처음이나 끝으로, 길게 누르면 채팅 맨 위나 맨 아래로 가요.', demo: { name: 'stepButtons' } }}
            control={<Switch label="메시지 이동 버튼" checked={display.stepButtons} onChange={(stepButtons) => changeDisplay({ stepButtons })} />}
          />
        </SettingGroup>
        {(display.scrubber || display.stepButtons) && (
          <DetailFold set={0}>
            <SettingRow
              label="내 메시지에서도 멈추기"
              help={{ text: '끄면 캐릭터 메시지에서만 멈추고 내 메시지는 건너뛰어요. 현재 읽고 있는 메시지의 처음과 끝에서는 항상 멈춰요.', demo: { name: 'userStops', ways: { on: display.userStops } } }}
              control={<Switch label="내 메시지에서도 멈추기" checked={display.userStops} onChange={(userStops) => changeDisplay({ userStops })} />}
            />
          </DetailFold>
        )}
      </Section>
      <Section title="입력창">
        <SettingGroup label="입력창">
          <SettingRow
            label="Enter로 보내기"
            help={{ text: '끄면 Enter로 줄을 바꾸고, Ctrl+Enter나 보내기 버튼으로 보내요.', demo: { name: 'enterSends', ways: { on: display.enterSends } } }}
            control={<Switch label="Enter로 보내기" checked={display.enterSends} onChange={(enterSendsChoice) => changeDisplay({ enterSendsChoice })} />}
          />
        </SettingGroup>
      </Section>
      <Section title="단축키">
        <SettingGroup label="단축키">
          <SettingRow
            label="단축키 목록"
            control={
              <Button variant="secondary" size="sm" onClick={() => runShortcut('shortcutList')}>
                보기
              </Button>
            }
          />
        </SettingGroup>
      </Section>
    </Screen>
  );
}
