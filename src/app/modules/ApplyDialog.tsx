import { useEffect, useState } from 'react';
import type { ToolDraft } from '../../model/tool';
import { applyDraft, applyPreview, installedDiffers } from '../../runtime/tools/drafts';
import { setModuleAt } from '../../runtime/modules';
import { undoToolImport } from '../../runtime/tools/store';
import { describeImportFailure } from '../common/importFailure';
import { TOOL, toolVersion } from '../common/words';
import { useFiles, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Dialog, Facts, Row, SettingGroup, SettingRow, Tag } from '../ui';
import { USE_TAGS } from './studio';

type Where = 'always' | 'none';

// 적용 is importTool with the draft's bytes: an update when a plugin of the same name and author is installed, else a
// new one, whose place is asked here once (ruled 2026-10-29: an update keeps where the plugin is on).
export function ApplyDialog({ id, draft, onClose }: { id: string; draft: ToolDraft; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const [where, setWhere] = useState<Where>('always');
  const [busy, setBusy] = useState(false);
  const [replaces, setReplaces] = useState(false);
  const preview = applyPreview(store, draft);
  useEffect(() => { void installedDiffers(store, files, draft).then(setReplaces); }, [store, files, draft]);

  async function apply() {
    setBusy(true);
    const applied = await applyDraft(store, files, id);
    setBusy(false);
    if (!applied.ok) return toast.failed(applied, '적용하지 못했어요.');
    onClose();
    const { id: module, previous } = applied.data;
    const name = preview.ok ? preview.manifest.displayName : TOOL;
    if (previous) return toast.undoable(`'${name}' ${TOOL}을 적용했어요.`, () => undoToolImport(store, module, previous));
    const placed = where === 'always' ? await setModuleAt(store, { kind: 'always' }, module, true) : null;
    if (placed && !placed.ok) return toast.failed(placed, `'${name}' ${TOOL}을 설치했지만 켜지 못했어요.`);
    toast.show(`'${name}' ${TOOL}을 설치했어요.`);
  }

  const unnamed = !draft.identity.displayName.trim();
  if (!preview.ok || unnamed) {
    return (
      <Dialog title="적용할 수 없어요" onClose={onClose} actions={<Button variant="secondary" onClick={onClose}>닫기</Button>}>
        <Callout tone="warn">{preview.ok ? '정보 탭에서 이름을 적어 주세요.' : describeImportFailure(preview.failure)}</Callout>
      </Dialog>
    );
  }
  const { manifest, previous, added } = preview;
  return (
    <Dialog
      title={previous ? '적용할까요?' : `새 ${TOOL}으로 설치할까요?`}
      onClose={onClose}
      onSubmit={() => void apply()}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button variant="primary" type="submit" busy={busy}>적용</Button>
        </>
      }
    >
      {replaces && <Callout tone="warn">마지막으로 적용한 뒤 설치된 코드가 바뀌었어요. 적용하면 바뀐 코드를 덮어써요.</Callout>}
      <Facts items={[{ label: '버전', value: previous ? `${toolVersion(previous.manifest.version)} → ${toolVersion(manifest.version)}` : toolVersion(manifest.version) }]} />
      {added.length > 0 && (
        <SettingGroup label="새 권한">
          <SettingRow label="새 권한" help="처음 쓰는 채팅에서 한 번 물어봐요." control={<Row kind="tags">{added.map((use) => <Tag key={use} tone="accent">{USE_TAGS[use]}</Tag>)}</Row>} />
        </SettingGroup>
      )}
      {!previous && (
        <SettingGroup label="사용처">
          <SettingRow
            label="사용처"
            help="항상 켜 두면 모든 채팅에 적용돼요. 나중에 플러그인 화면에서 바꿀 수 있어요."
            control={<ChoiceGroup label="사용처" layout="segmented" options={[{ value: 'always', label: '항상' }, { value: 'none', label: '사용 안 함' }]} value={where} onChange={setWhere} />}
          />
        </SettingGroup>
      )}
    </Dialog>
  );
}
