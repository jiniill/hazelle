import { useEffect, useMemo, useState } from 'react';
import type { CacheDiagnosis, CachePrescription, CacheRecurrence, Forecast } from '../../model/cache';
import { cacheRecurrence, diagnoseCache, needsDiagnosis } from '../../runtime/cache-diagnosis';
import { priceCachePrescriptions } from '../../runtime/cache-prescriptions';
import type { Chat } from '../../model/chat';
import type { Memory } from '../../model/memory';
import type { Route } from '../../runtime/assignment';
import { breakCost, forecast, lastCache, prior } from '../../runtime/cache';
import { leaving } from '../../runtime/memory-view';
import type { Shown } from '../../runtime/talk';
import type { SentRequest } from '../../runtime/request-log';
import { cacheSend, forecastSend, previewRequest, type Sending, type Unsendable, type Unsaved } from '../../runtime/turn-context';
import { useLab } from '../common/labs';
import { useSession } from '../session';

const SETTLE_MS = 400;

// unseen: the pictures the chat's messages hold that the model, seeing none, is not sent (engine/pipeline Assembled).
export type SendNotes = { cache: CacheNotes; leaving: number | null; unseen: number; sending: Sending | Unsendable | null | undefined; request: () => SentRequest | null };

// until: when the last call's cache runs out, null when it cached nothing. next: the draft's forecast against the
// chat's stored last call (runtime/cache), with what a break costs where the model is priced and the model it was worked
// out for; undefined until it is worked out after the chat opens or a reply ends. recurrence: the chat's recent replies'
// stored forecasts. prescriptions: undefined while pending, null on evaluation failure, [] when no edit qualifies.
export type CacheNotes = { until: number | null; recurrence: CacheRecurrence; next: { forecast: Forecast; diagnosis: CacheDiagnosis | null | undefined; prescriptions: CachePrescription[] | null | undefined; cost: ReturnType<typeof breakCost>; route: Route } | null | undefined };

// The draft is read again after any store change settles, so an edit to the prompt, a lorebook or the model shows in
// the forecast while it is open. unsaved: a new chat not saved yet, forecast as its first save will write it.
export function useSendNotes(id: string, unsaved: Unsaved | null, chat: Chat, messages: Shown[], memory: Memory | null, text: string, busy: boolean): SendNotes {
  const session = useSession();
  const guard = useLab('cacheguard');
  const last = useMemo(() => lastCache(messages), [messages]);
  const [next, setNext] = useState<CacheNotes['next']>(undefined);
  const [sending, setSending] = useState<SendNotes['sending']>(undefined);
  const [left, setLeft] = useState<number | null>(null);
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    const stop = session.store.subscribe(() => setChanges((count) => count + 1));
    return () => void stop();
  }, []);

  useEffect(() => {
    if (busy) {
      setNext(undefined);
      setSending(undefined);
      return setLeft(null);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // A message sent translated goes out as its translation, which is not made yet, so it stands in as typed. Nothing
      // typed sends 응답 받기.
      void forecastSend(session, id, text.trim() ? { kind: 'send', text } : { kind: 'answer' }, controller.signal, 'forecast', unsaved).then((result) => {
        if (controller.signal.aborted) return;
        setSending(result);
        const sending = result && 'turn' in result ? result : null;
        setLeft(sending && leaving(sending.prompt));
        const account = sending ? session.credentials.pool.peek(sending.turn.route.connection.value)?.id ?? null : null;
        const send = sending && cacheSend(sending, account);
        const before = session.store.scopeState(id) === 'loaded' ? prior(session.store, id, messages, Date.now()) : null;
        const made = send && forecast(before, send);
        if (!made || !sending || !send) return setNext(null);
        const pending = needsDiagnosis(made);
        const next = { forecast: made, diagnosis: pending ? undefined : null, prescriptions: pending ? undefined : [], cost: breakCost(sending.turn.route.connection.value, sending.turn.route.model, made, sending.calibration.estimate.centre), route: sending.turn.route };
        setNext(next);
        if (pending) void diagnoseCache(session.store.evaluation, id, sending.turn.scope, made, before ? session.log.entry(id, before.print.call) : null, sending.prompt, send.wire, controller.signal).then(async (diagnosis) => {
          if (controller.signal.aborted) return;
          setNext({ ...next, diagnosis, prescriptions: diagnosis && guard ? undefined : [] });
          if (!diagnosis || !guard) return;
          const prescriptions = await priceCachePrescriptions(session.store, id, sending, diagnosis, made, before, account, controller.signal);
          if (!controller.signal.aborted) setNext({ ...next, diagnosis, prescriptions });
        });
      }, () => {
        if (controller.signal.aborted) return;
        setNext(null);
        setSending(null);
        setLeft(null);
      });
    }, SETTLE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [id, unsaved, chat, messages, memory, text, busy, changes, guard]);

  const recurrence = useMemo(() => cacheRecurrence(messages), [messages]);
  const cache = useMemo((): CacheNotes => ({ until: last?.until ?? null, recurrence, next }), [last, recurrence, next]);
  const request = useMemo(() => {
    let wire: SentRequest | null | undefined;
    return () => {
      if (wire === undefined) wire = sending && 'turn' in sending ? previewRequest(sending) : null;
      return wire;
    };
  }, [sending]);
  return { cache, leaving: left, unseen: sending && 'turn' in sending ? sending.prompt.unseen : 0, sending, request };
}
