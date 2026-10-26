import type { Feature, FeatureSwitches as Switches } from '../../model/features';
import { availableFeatures, above, inherited, setFeatureAt, type FeatureOwner } from '../../runtime/features';
import { SETTINGS_ID } from '../../model/settings';
import type { ObjectStore } from '../../runtime/store';
import { useLibrary, usePrompts, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { ChoiceGroup, Section, SettingGroup, SettingRow } from '../ui';
import { FEATURE_NAMES, FEATURES_TITLE, follows, SCOPE, scopeTag } from './words';

type Owner = Exclude<FeatureOwner, { kind: 'settings' }>;
type Choice = 'default' | 'on' | 'off';

const WORKS: Record<Owner['kind'], string> = {
  prompt: '이 프롬프트를 쓰는 채팅에 적용돼요.',
  character: '이 캐릭터의 모든 채팅에 적용돼요.',
  chat: '지금 이 채팅에만 적용돼요.',
};

// Not 공용 for every layer: a character's follows the prompt, a chat's its character.
const ABOVE: Record<ReturnType<typeof above>, string> = { settings: SCOPE.default, prompt: '프롬프트', character: '캐릭터' };
const followsAbove = (store: ObjectStore, owner: Owner) => follows(ABOVE[above(store, owner)]);

// A layer's line in a list of parts: what it follows while it sets nothing shown, else what it sets, 번역 끔 · 삽화 켬.
export const featureHolds = (store: ObjectStore, owner: Owner, own: Switches | undefined) =>
  availableFeatures(store.get('settings', SETTINGS_ID)?.value).flatMap((feature) => (own?.[feature] === undefined ? [] : [`${FEATURE_NAMES[feature]} ${own[feature] ? '켬' : '끔'}`])).join(' · ') || followsAbove(store, owner);

const choiceOf = (value: boolean | undefined): Choice => (value === undefined ? 'default' : value ? 'on' : 'off');

// own: the owner's features as stored. 공용's own switches are settings/FeatureDefaults' FeatureSwitch, which follows nothing.
export function FeatureSwitches({ owner, own }: { owner: Owner; own: Switches | undefined }) {
  const store = useStore();
  const toast = useToast();
  // Subscribed for inherited, which reads the farther layers from the store.
  const settings = useSettings();
  usePrompts();
  useLibrary();
  const from = inherited(store, owner);

  async function change(feature: Feature, choice: Choice) {
    const saved = await setFeatureAt(store, owner, feature, choice === 'default' ? null : choice === 'on');
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  return (
    <Section level={owner.kind === 'chat' ? 3 : undefined} title={FEATURES_TITLE} help={WORKS[owner.kind]} tag={owner.kind === 'prompt' || !own ? undefined : scopeTag(owner.kind)}>
      <SettingGroup label={FEATURES_TITLE}>
        {availableFeatures(settings).map((feature) => (
          <SettingRow
            key={feature}
            label={FEATURE_NAMES[feature]}
            control={
              <ChoiceGroup
                layout="fit"
                label={FEATURE_NAMES[feature]}
                options={[
                  { value: 'default', label: `${followsAbove(store, owner)} (${from[feature] ? '켜짐' : '꺼짐'})` },
                  { value: 'on', label: '켜기' },
                  { value: 'off', label: '끄기' },
                ]}
                value={choiceOf(own?.[feature])}
                onChange={(choice) => void change(feature, choice)}
              />
            }
          />
        ))}
      </SettingGroup>
    </Section>
  );
}
