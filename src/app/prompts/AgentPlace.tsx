import type { AgentPlace as Place } from '../../model/prompt';
import { ChoiceGroup, Section } from '../ui';

type Choice = Place | 'rewrite';
const OPTIONS: { value: Choice; label: string; sub: string }[] = [
  { value: 'rewrite', label: '전체 다시 쓰기', sub: '응답 전체를 이 에이전트가 다시 작성해요.' },
  { value: 'before', label: '앞에 추가', sub: '기존 응답 앞에 에이전트가 작성한 내용을 붙여요.' },
  { value: 'after', label: '뒤에 추가', sub: '기존 응답 뒤에 에이전트가 작성한 내용을 붙여요.' },
];

// A post agent's: where its answer goes beside the reply (AgentPrompt place).
export function AgentPlace({ place, onChange }: { place: Place | undefined; onChange: (place: Place | undefined) => void }) {
  return (
    <Section title="응답 반영 방식" level={3}>
      <ChoiceGroup<Choice> label="응답 반영 방식" layout="list" options={OPTIONS} value={place ?? 'rewrite'} onChange={(value) => onChange(value === 'rewrite' ? undefined : value)} />
    </Section>
  );
}
