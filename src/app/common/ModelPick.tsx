import { useMemo, useState } from 'react';
import { isFree } from '../../connectors/pricing';
import type { ConnectionType, Model } from '../../connectors/types';
import { Callout, List, ListItem, Progress, Stack, TextField } from '../ui';
import { searchOf } from './words';

export const Connecting = ({ type }: { type: ConnectionType }) => <Progress title="모델 불러오는 중" steps={[{ label: `${type.label} 연결` }]} />;

// A first model, after a first key: the caller orders the list (talkableModels leads with the free ones).
export function ModelPick({ models, failure, onPick }: { models: Model[]; failure: string | null; onPick: (model: Model) => void }) {
  const [search, setSearch] = useState('');
  const shown = useMemo(() => models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(search.trim().toLowerCase())), [models, search]);
  return (
    <Stack>
      <TextField label={searchOf('모델')} showLabel={false} placeholder={`모델 ${models.length}개 검색`} help={models.some(isFree) ? FREE_HELP : undefined} value={search} onChange={setSearch} />
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
      <List label="모델" box>
        {/* eslint-disable-next-line no-restricted-syntax -- a picker's first matches, which typing narrows */}
        {shown.slice(0, MODELS_SHOWN).map((model) => <ListItem key={model.id} title={model.name} code={model.id} tags={isFree(model) ? ['무료'] : undefined} onClick={() => onPick(model)} />)}
      </List>
    </Stack>
  );
}
const MODELS_SHOWN = 8;
// True of every provider's free models, not one's rule: a 0 price also comes from models.dev (Google, Mistral, Groq).
const FREE_HELP = '무료 모델은 제공자마다 사용 한도가 있고, 대화 내용이 학습에 쓰일 수 있어요.';
