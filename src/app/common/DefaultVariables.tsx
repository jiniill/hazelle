import { EntryList } from './EntryList';
import { DEFAULT_VARIABLES, FIELD_ERRORS } from './words';
import { FieldRow, Section, TextField } from '../ui';
import { addOf } from './acts';

// Keep variable fields single-line and names free of = so Risu name=value export round-trips.
// A blank name says so once its value is typed, not on a row just added.
const variableError = (variables: [string, string][], index: number) => {
  const [name, value] = variables[index]!;
  if (!name) return value ? FIELD_ERRORS.name : undefined;
  if (name.includes('=')) return '이름에 =는 쓸 수 없어요.';
  return variables.some(([other], at) => at > index && other === name) ? '아래에 같은 이름이 있어서 이 값은 쓰이지 않아요.' : undefined;
};

// A character's or a prompt's 기본 변수.
export function DefaultVariables({ variables, help, onChange }: { variables: [string, string][]; help: string; onChange: (variables: [string, string][]) => void }) {
  return (
    <Section title={DEFAULT_VARIABLES} help={help}>
      <EntryList
        entries={variables}
        onChange={onChange}
        name={(index) => `변수 ${index + 1}`}
        blank={['', ''] as [string, string]}
        addLabel={addOf('변수')}
        empty="변수가 없어요."
        removed={(index) => `${index + 1}번째 변수를 삭제했어요.`}
      >
        {({ value: [name, value], index, name: label, set, remove }) => (
          <FieldRow
            name={<TextField label={`${label} 이름`} showLabel={false} placeholder="이름" kind="key" value={name} onChange={(next) => set([next, value])} error={variableError(variables, index)} />}
            value={<TextField label={`${label} 값`} showLabel={false} placeholder="값" kind="key" value={value} onChange={(next) => set([name, next])} />}
            action={remove}
          />
        )}
      </EntryList>
    </Section>
  );
}
