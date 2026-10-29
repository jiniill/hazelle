import { connectApi, sourced } from './api';

let connected = false;
addEventListener('message', (event: MessageEvent) => {
  const port = event.ports[0];
  if (connected || !port) return;
  connected = true;
  connectApi(port, (code, api) => {
    Object.defineProperty(globalThis, 'hazelle', { value: api });
    return (0, eval)(sourced(code)) as void | Promise<void>;
  });
});
