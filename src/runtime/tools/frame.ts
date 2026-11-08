import { TOOL_ALLOW, TOOL_SANDBOX } from '../../contracts/sandbox';
import type { Port, Role } from '../../tool-api/protocol';
import { ToolStopped } from '../scripts/binding';
import type { ToolPage } from './facade';

// frame: the iframe a frame tool's document runs in, which its page shows. close: resolves once the port is closed.
export type Connection = { port: Port; ready: Promise<void>; close(): Promise<void>; frame: HTMLIFrameElement | null };
// network: the frame is served the sandbox's network variant (server/static), only under the module's consent.
export type Opening = { role: 'background' } | { role: 'frame'; network: boolean } | { role: 'page'; page: ToolPage };
export type OpenFrame = (opening: Opening) => Connection;
// How long a stopped frame tool's onUnload callbacks run with its port open, their calls answered, before it is removed.
export const UNLOAD_MS = 1000;

export const toolFrame: OpenFrame = (opening) => {
  const page = opening.role === 'page' ? opening.page : null;
  const role: Role = opening.role;
  const frame = page ? null : document.createElement('iframe');
  const channel = new MessageChannel();
  let target = page?.window ?? null;
  let connected = false;
  let closed = false;
  let reject!: (error: Error) => void;
  let loaded!: () => void;
  const ready = new Promise<void>((resolve, failed) => { loaded = resolve; reject = failed; });
  const receive = (event: MessageEvent) => {
    if (closed || connected || event.source !== target || event.data?.kind !== 'hazelle-ready') return;
    connected = true;
    window.removeEventListener('message', receive);
    target!.postMessage({ kind: 'hazelle-connect', role }, '*', [channel.port2]);
    loaded();
  };
  window.addEventListener('message', receive);
  if (frame) {
    frame.hidden = true;
    frame.setAttribute('sandbox', TOOL_SANDBOX);
    frame.allow = TOOL_ALLOW;
    frame.src = `/sandbox.html?role=${role}${opening.role === 'frame' && opening.network ? '&network=1' : ''}`;
    document.body.append(frame);
    target = frame.contentWindow;
  }
  // A visible frame may already have loaded before React hands over its window.
  target?.postMessage({ kind: 'hazelle-hello' }, '*');
  return {
    port: channel.port1, ready, frame: role === 'frame' ? frame : null,
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      window.removeEventListener('message', receive);
      target?.postMessage({ kind: 'hazelle-stop' }, '*');
      if (!connected) reject(new ToolStopped());
      const end = () => {
        frame?.remove();
        channel.port1.close();
        channel.port2.close();
      };
      if (role !== 'frame' || !frame) {
        end();
        return Promise.resolve();
      }
      frame.hidden = true;
      return new Promise<void>((resolve) => setTimeout(() => { end(); resolve(); }, UNLOAD_MS));
    },
  };
};
