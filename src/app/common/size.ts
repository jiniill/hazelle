const KB = 1_000;
export const MB = 1_000_000;
const GB = 1_000_000_000;

const amount = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 1 });

export const sizeText = (bytes: number) => (bytes >= GB ? `${amount(bytes / GB)} GB` : bytes >= MB ? `${amount(bytes / MB)} MB` : `${amount(bytes / KB)} KB`);
