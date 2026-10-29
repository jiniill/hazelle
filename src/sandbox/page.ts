import { connectApi, sourced } from './api';
import { installRisu, risuScript } from './risu';

declare const BACKGROUND_SOURCE: string;
let connected = false;
let worker: Worker | null = null;
let unload = () => {};
const ready = () => parent.postMessage({ kind: 'hazelle-ready' }, '*');
addEventListener('message', (event: MessageEvent) => {
  // An opaque document's origin is null. Only the embedding window supplies its port.
  if (event.source !== parent) return;
  if (event.data?.kind === 'hazelle-hello' && !connected) return ready();
  if (event.data?.kind === 'hazelle-stop') { worker?.terminate(); unload(); return; }
  const port = event.ports[0];
  if (connected || event.data?.kind !== 'hazelle-connect' || !port) return;
  connected = true;
  if (event.data.role === 'background') {
    const url = URL.createObjectURL(new Blob([BACKGROUND_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.postMessage(null, [port]);
    return;
  }
  // WebRTC bypasses connect-src in Chromium and Firefox; page code must never see these constructors.
  Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
  Reflect.deleteProperty(globalThis, 'webkitRTCPeerConnection');
  if (event.data.role === 'frame') {
    connectApi(port, (code, api) => {
      unload = installRisu(api, globalThis as unknown as Record<string, unknown>);
      return (0, eval)(risuScript(code)) as Promise<void>;
    });
    return;
  }
  connectApi(port, (code, api) => {
    Object.defineProperty(globalThis, 'hazelle', { value: api });
    if (api.page?.theme === 'light') document.documentElement.dataset.theme = 'light';
    return (0, eval)(sourced(code)) as void | Promise<void>;
  });
});
ready();
