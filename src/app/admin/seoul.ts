// The server counts its days in Korea's time, so 운영's figures name them so whatever the operator's zone.
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

export const seoulDate = (at: number) => date.format(at);
export const seoulMonthDay = (at: number) => date.format(at).slice(5);
