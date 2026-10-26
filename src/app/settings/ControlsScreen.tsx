import { ReplyRow } from '../common/ReadingRows';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { runShortcut } from '../shortcuts';
import { Button, Disclosure, NavBar, Screen, Section, SettingGroup, SettingRow, Switch } from '../ui';

export function ControlsScreen({ back }: { back: Back | null }) {
  const { display, changeDisplay } = useDisplay();
  return (
    <Screen width="page" top={<NavBar title={PAGES.controls} {...backBar(back)} />}>
      <Section title="스크롤할 때">
        <SettingGroup label="스크롤할 때">
          <ReplyRow />
          <SettingRow
            label="헤더 숨기기"
            help="아래로 스크롤하면 숨기고, 위로 스크롤하면 다시 보여요."
            control={<Switch label="헤더 숨기기" checked={display.hideHeader} onChange={(hideHeader) => changeDisplay({ hideHeader })} />}
          />
          <SettingRow
            label="입력창 접기"
            help="위로 스크롤하면 한 줄로 접고, 맨 아래로 내려가면 다시 펼쳐요."
            control={<Switch label="입력창 접기" checked={display.foldComposer} onChange={(foldComposer) => changeDisplay({ foldComposer })} />}
          />
          <SettingRow
            label="빠른 스크롤 막대"
            help="오른쪽 막대를 끌면 메시지마다 멈춰요."
            control={<Switch label="빠른 스크롤 막대" checked={display.scrubber} onChange={(scrubber) => changeDisplay({ scrubber })} />}
          />
          <SettingRow
            label="메시지 이동 버튼"
            help="누르면 메시지 처음이나 끝으로, 길게 누르면 채팅 맨 위나 맨 아래로 가요."
            control={<Switch label="메시지 이동 버튼" checked={display.stepButtons} onChange={(stepButtons) => changeDisplay({ stepButtons })} />}
          />
        </SettingGroup>
        {(display.scrubber || display.stepButtons) && (
          <Disclosure label="세부 설정">
            <SettingGroup label="세부 설정">
              <SettingRow
                label="내 메시지에서도 멈추기"
                help="끄면 캐릭터 메시지에서만 멈춰요. 읽던 메시지의 처음과 끝에는 늘 멈춰요."
                control={<Switch label="내 메시지에서도 멈추기" checked={display.userStops} onChange={(userStops) => changeDisplay({ userStops })} />}
              />
            </SettingGroup>
          </Disclosure>
        )}
      </Section>
      <Section title="입력창">
        <SettingGroup label="입력창">
          <SettingRow
            label="Enter로 보내기"
            help="끄면 Enter는 줄을 바꾸고, Ctrl+Enter로 보내요."
            control={<Switch label="Enter로 보내기" checked={display.enterSends} onChange={(enterSends) => changeDisplay({ enterSends })} />}
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
