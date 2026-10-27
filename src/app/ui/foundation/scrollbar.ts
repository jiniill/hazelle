// Style classic scrollbars only: custom styling turns hidden platform overlays into space-taking classic bars.
export function markScrollbars() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position: absolute; visibility: hidden; width: 100px; height: 100px; overflow: scroll';
  document.body.append(probe);
  if (probe.offsetWidth > probe.clientWidth) document.documentElement.dataset.scrollbars = 'classic';
  probe.remove();
}

// For a shadow root's host, which scrollbar.css reads as the document's root is read outside it.
export const scrollbarKind = () => document.documentElement.dataset.scrollbars;
