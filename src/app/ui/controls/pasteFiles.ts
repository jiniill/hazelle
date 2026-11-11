// Files pasted with no text; office apps copy a picture of the text beside it, and the text is what was meant.
export function pasteFiles(event: ClipboardEvent, onFiles: (files: File[]) => void): boolean {
  const data = event.clipboardData;
  const files = [...(data?.files ?? [])];
  if (!files.length || data!.getData('text/plain')) return false;
  event.preventDefault();
  onFiles(files);
  return true;
}
