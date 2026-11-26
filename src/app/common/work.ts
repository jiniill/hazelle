import { workEnd, type ServerWork } from '../../contracts/work';
import { moment, timeOfDay } from './time';

export const WORK = '서버 작업';
export const WORK_OFF = `예고한 ${WORK}이 취소됐어요`;

// Today's by its time alone.
export const workStart = (at: number, now: number) => (new Date(at).toDateString() === new Date(now).toDateString() ? timeOfDay(at) : moment(at, now));
export const workSpan = ({ at, minutes }: ServerWork, now: number) => `${workStart(at, now)}부터 약 ${minutes}분간`;
export const workAhead = (work: ServerWork, now: number) => ({ message: `${workSpan(work, now)} ${WORK}이 있어요`, detail: '그동안은 접속할 수 없어요.' });
const ends = (work: ServerWork) => `${timeOfDay(workEnd(work))}쯤 끝날 예정이에요.`;
export const workUnderWay = (work: ServerWork) => ({ message: `${WORK} 중이에요`, detail: ends(work) });
export const workOffline = (work: ServerWork) => `${WORK} 중이라 연결하지 못했어요. ${ends(work)}`;
