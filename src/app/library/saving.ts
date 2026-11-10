import type { Progress } from '../../runtime/library/characters';
import type { ProgressStep } from '../ui';

// One reading of a character import's step, for a Progress row (ImportFlow) and for a card's busy words (a copy).
export function stepOf(step: Parameters<Progress>[0]): ProgressStep {
  if (step.kind === 'picture') return { label: '이미지 올리는 중' };
  return { label: step.kind === 'assets' ? '에셋 올리는 중' : step.kind === 'original' ? '원본 보관 중' : '저장 중', done: step.done, total: step.total };
}

export function describeStep(step: Parameters<Progress>[0]): string {
  const { label, done, total } = stepOf(step);
  return total === undefined ? label : `${label} · ${done} / ${total}`;
}
