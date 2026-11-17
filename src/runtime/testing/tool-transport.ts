import { connectApi } from '../../sandbox/api';
import { pageLayer } from '../../sandbox/layer';
import { installRisu } from '../../sandbox/risu';
import type { Up } from '../../tool-api/protocol';
import { UNLOAD_MS, type OpenFrame, type Opening } from '../tools/frame';

class LocalPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  peer: LocalPort | null = null;
  readonly sent: unknown[] = [];
  silent = false;
  postMessage(message: unknown) {
    if (this.closed || this.silent) return;
    const data: unknown = structuredClone(message);
    this.sent.push(data);
    queueMicrotask(() => { if (!this.peer?.closed) this.peer?.onmessage?.(new MessageEvent('message', { data })); });
  }
  start() {}
  close() { this.closed = true; }
}

// stop: what the frame runs when told to stop (sandbox/page.ts), its port kept open for UNLOAD_MS as toolFrame keeps it.
export type InProcessFrame = { host: LocalPort; sandbox: LocalPort; api: Hazelle.Api | null; page: boolean; opening: Opening; emit(message: Up): void; stop?: () => void };
export function inProcessTools(execute: (api: Hazelle.Api, code: string, frame: InProcessFrame) => void | Promise<void>) {
  const frames: InProcessFrame[] = [];
  const open: OpenFrame = (opening) => {
    const host = new LocalPort();
    const sandbox = new LocalPort();
    host.peer = sandbox;
    sandbox.peer = host;
    const frame: InProcessFrame = { host, sandbox, api: null, page: opening.role === 'page', opening, emit: (message) => sandbox.postMessage(message) };
    frames.push(frame);
    const close = connectApi(sandbox, (code, api) => { frame.api = api; return execute(api, code, frame); });
    const end = () => { host.close(); close(); };
    return {
      port: host, ready: Promise.resolve(), frame: null,
      close: async () => {
        if (opening.role === 'frame') {
          frame.stop?.();
          await new Promise((resolve) => setTimeout(resolve, UNLOAD_MS));
        }
        end();
      },
    };
  };
  return { open, frames };
}

// A Risu plugin's frame: plugin runs with Risuai, risuai and the dialog shims in scope, handed the code the host loaded.
export const inProcessRisu = (plugin: (scope: Record<string, unknown>, code: string) => void) => inProcessTools((api, code, frame) => {
  const scope: Record<string, unknown> = {};
  frame.stop = installRisu(api, scope, pageLayer);
  plugin(scope, code);
});
