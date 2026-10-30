import type { ComponentProps } from 'react';
import { MarkupArea, TextField } from '../ui';
import { textTokens } from './receipt';
import { useTokens } from './useTokens';

// For text a model reads: the field with its rough length in tokens, before any tag in it is filled in.
export function CountedField(props: ComponentProps<typeof TextField>) {
  return <TextField {...props} count={textTokens(useTokens([props.value]))} />;
}

export function CountedMarkup(props: ComponentProps<typeof MarkupArea>) {
  return <MarkupArea {...props} count={textTokens(useTokens([props.value]))} />;
}
