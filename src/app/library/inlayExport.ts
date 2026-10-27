// Run unbuilt on the Risu page as console code/bookmark. IndexedDB inlay/inlay holds Blob or legacy data-URL bytes.
// Keep layout synchronized with engine/import/backup readInlays: little-endian u32 name length/name/u32 data length/data;
// inlay_skipped.json first for omitted audio/video, then inlay_<id> picture/signature JSON.
// Build one Blob from parts, never concatenate all picture bytes into a string.
export const INLAY_EXPORT = `(async () => {
  const text = new TextEncoder();
  const u32 = (value) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
  };
  const entry = (name, data) => {
    const named = text.encode(name);
    return [u32(named.length), named, u32(data.size), data];
  };
  const decoded = (url) => {
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes]);
  };
  const skipped = {};
  const parts = [];
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('inlay');
      open.onupgradeneeded = () => open.transaction.abort();
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  } catch {
    alert('이 페이지에는 Risu 이미지가 없어요. Risu 웹 페이지에서 실행해 주세요.');
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const cursor = db.transaction('inlay').objectStore('inlay').openCursor();
      cursor.onsuccess = () => {
        try {
          const at = cursor.result;
          if (!at) return resolve();
          const item = at.value;
          if (item.type === 'video' || item.type === 'audio') skipped[at.key] = item.type;
          else parts.push(...entry('inlay_' + at.key, item.type === 'signature' ? new Blob([JSON.stringify(item)]) : item.data instanceof Blob ? item.data : decoded(item.data)));
          at.continue();
        } catch (error) {
          reject(error);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  } catch (error) {
    alert('Risu 이미지를 읽지 못했어요. ' + error);
    return;
  } finally {
    db.close();
  }
  const file = new Blob([...entry('inlay_skipped.json', new Blob([JSON.stringify(skipped)])), ...parts]);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = 'risu-inlays.bin';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
})();`;

export const INLAY_BOOKMARK = `javascript:${encodeURIComponent(INLAY_EXPORT)}`;
