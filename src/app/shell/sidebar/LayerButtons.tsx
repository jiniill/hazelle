import { PLACES } from '../../common/places';
import { useStanding } from '../../session';
import { IconButton, Row } from '../../ui';
import { navigate } from '../router';
import { settingsEntry } from '../settings/SettingsNav';
import { toolsEntry } from '../tools/ToolsNav';

// The ways into 게시판, 도구 and 설정 on phones, which have no rail.
export function LayerButtons() {
  const { unreadBoard } = useStanding();
  return (
    <Row kind="toolbar">
      <IconButton {...PLACES.board} size="sm" count={unreadBoard} onClick={() => navigate({ kind: 'board', operator: false })} />
      <IconButton {...PLACES.tools} size="sm" onClick={() => navigate(toolsEntry(false))} />
      <IconButton {...PLACES.settings} size="sm" onClick={() => navigate(settingsEntry(false))} />
    </Row>
  );
}
