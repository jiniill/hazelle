import { MAX_NOTICE_LENGTH } from '../../contracts/admin';
import { count } from '../common/typedNumber';

// Every notice the operator writes in a TextDialog, sent as typed (no trim).
export const NOTICE_TEXT = { lines: 5, max: MAX_NOTICE_LENGTH, tooLong: `최대 ${count(MAX_NOTICE_LENGTH)}자까지 보낼 수 있어요.` };
