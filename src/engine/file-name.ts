const UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;

export const fileStem = (name: string, fallback: string) => name.replace(UNSAFE, '').trim() || fallback;
