import type { ProviderFit } from '../engine/prompt-budget';
import { unavailableCalibration } from '../model/token-calibration';
import { prepareChat, type ContextRefusal, type PreparedChat } from '../connectors/preparation';
import { resolveConnection, resolveModel, wireRoute } from '../connectors/registry';
import type { ModelSettings } from '../connectors/settings';
import type { Usage as ReportedUsage } from '../connectors/types';
import { Calibration, fitLimits, type Observation } from '../engine/token-calibration';
import type { CallCalibration, InputMeasurement, TokenFit, TokenLimits, TokenProjection, RequestClass } from '../model/token-calibration';
import type { Counted, UsageCall } from '../model/usage';
import type { ApiResult } from './api';
import type { Route } from './assignment';
import type { ObjectStore } from './store';
import type { Usage } from './usage';

const calibrationKey = (connection: string, requestClass: RequestClass, prepared: PreparedChat) => JSON.stringify([connection, requestClass, prepared.identity]);

export function providerFit(route: Route, settings: ModelSettings, allowance: number | null): ProviderFit {
  const resolved = resolveConnection(route.connection.value);
  if (!resolved) throw new Error('calibration-route');
  return { route: wireRoute(resolveModel(resolved, route.model)), model: route.model, settings, allowance };
}

export async function measureInput(store: ObjectStore, connection: string, requestClass: RequestClass, prepared: PreparedChat): Promise<InputMeasurement> {
  const counts = await store.evaluation.count(prepared.wire.segments.map(({ text }) => text)).catch(() => null);
  if (!Array.isArray(counts)) return { kind: 'unavailable', reason: 'tokenizer' };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(prepared.wire)));
  return { kind: 'measured', key: calibrationKey(connection, requestClass, prepared), at: Date.now(), fingerprint: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''), o200k: counts.reduce((sum, count) => sum + count, 0), messages: prepared.wire.messages, blocks: prepared.wire.segments.length, pictures: prepared.wire.pictures };
}

export function completedCalibration(calibration: CallCalibration, outcome: { state: string; cut: string | null; usage: ReportedUsage | null; inputComplete?: true }): CallCalibration {
  const { measurement } = calibration;
  const input = outcome.usage?.inputTokens;
  return { ...calibration, eligible: outcome.inputComplete === true && measurement.kind === 'measured' && measurement.pictures === 0 && measurement.o200k > 0 && typeof input === 'number' && Number.isFinite(input) && input > 0 && (outcome.state === 'done' || (outcome.state === 'cut' && outcome.cut === 'length')) };
}

export function tokenProjection(calibration: CallCalibration, usage: ReportedUsage | null): TokenProjection {
  const { measurement, fit, retries, eligible } = calibration;
  const reportedInput = usage?.inputTokens ?? null;
  const denominator = measurement.kind === 'measured' ? measurement.o200k : null;
  return {
    reportedInput, denominator, unavailable: measurement.kind === 'unavailable' ? measurement.reason : null,
    ineligible: measurement.kind === 'unavailable' ? null : measurement.pictures > 0 ? 'pictures' : denominator === 0 ? 'empty' : reportedInput === null || reportedInput <= 0 ? 'missing-input' : !eligible ? 'incomplete' : null,
    ratio: eligible && denominator !== null && reportedInput !== null ? reportedInput / denominator : null,
    source: fit?.source ?? 'unavailable', evidence: fit?.evidence ?? 0, bound: fit?.bound ?? null, multiplier: fit?.multiplier ?? null, allowance: fit?.allowance ?? null, retries,
  };
}

type Evidence = Omit<Observation, 'input'> & { input: number | null; id: string };
const learn = (index: Calibration, event: Evidence) => event.input === null ? index.invalidate(event.key, event.chat, event.at) : index.observe({ ...event, input: event.input });

function observations(calls: readonly Counted[]): Evidence[] {
  const observations: Evidence[] = [];
  for (const { call, chat } of calls) {
    const calibration = call.calibration;
    if (!calibration) continue;
    const add = (measurement: InputMeasurement, input: number | null, id: string) => {
      if (measurement.kind !== 'measured' || measurement.pictures > 0 || (input !== null && input <= 0) || measurement.o200k <= 0) return;
      observations.push({ id, key: measurement.key, chat, at: measurement.at, fingerprint: measurement.fingerprint, input, denominator: measurement.o200k });
    };
    if (calibration.refusal) add(calibration.measurement, calibration.refusal.actual, call.id);
    if (calibration.eligible && call.usage?.inputTokens != null) add(calibration.measurement, call.usage.inputTokens, call.id);
    calibration.retries.forEach((retry, index) => add(retry.measurement, retry.actual, `${call.id}:${index}`));
  }
  return observations.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export class Tokens {
  private events: Evidence[] = [];
  private rows: readonly Counted[] | null = null;
  private readonly byKey = new Map<string, Evidence[]>();
  private index = new Calibration();
  constructor(private readonly usage: Usage) {}

  async snapshot(route: Route, settings: ModelSettings, limits: TokenLimits, requestClass: RequestClass, chat: string | null, signal: AbortSignal): Promise<ApiResult<TokenSnapshot>> {
    const read = await this.usage.read(signal);
    if (!read.ok) { this.clear(); return read; }
    const rows = this.usage.calibrationRows();
    if (rows !== this.rows) {
      const events = observations(rows);
      // A late sync replays instead of merging nonlinear robust states.
      const prefix = this.events.length <= events.length && this.events.every((event, index) => JSON.stringify(event) === JSON.stringify(events[index]));
      if (!prefix) { this.index = new Calibration(); this.byKey.clear(); }
      const changed = new Set<string>();
      for (const event of events.slice(prefix ? this.events.length : 0)) {
        learn(this.index, event);
        // A snapshot may retry after later ledger reads; its evidence sequence must stay frozen.
        if (!changed.has(event.key)) {
          this.byKey.set(event.key, [...(this.byKey.get(event.key) ?? [])]);
          changed.add(event.key);
        }
        this.byKey.get(event.key)!.push(event);
      }
      this.events = events;
      this.rows = rows;
    }
    const resolved = resolveConnection(route.connection.value);
    if (!resolved) return { ok: false, error: 'calibration-route' };
    let prepared: PreparedChat;
    try { prepared = prepareChat(resolveModel(resolved, route.model), { model: route.model, settings, messages: [] }); }
    catch { return { ok: false, error: 'calibration-route' }; }
    const key = calibrationKey(route.connection.id, requestClass, prepared);
    return { ok: true, data: new TokenSnapshot(key, chat, limits, this.byKey.get(key) ?? [], this.index.estimate(key, chat, Date.now())) };
  }

  clear() { this.events = []; this.rows = null; this.byKey.clear(); this.index = new Calibration(); }
  call(call: UsageCall['call']) { return tokenProjection(call.calibration === undefined ? unavailableCalibration('historical') : call.calibration, call.usage); }
}

export class TokenSnapshot {
  readonly retries: CallCalibration['retries'] = [];
  fit: TokenFit;
  private index: Calibration | null = null;
  constructor(readonly key: string, private readonly chat: string | null, private readonly limits: TokenLimits, private readonly events: readonly Evidence[], readonly estimate: ReturnType<Calibration['estimate']>) {
    this.fit = fitLimits(limits, estimate);
  }

  refused(refusal: ContextRefusal, measurement: InputMeasurement): TokenFit | null {
    if (this.retries.length >= 2 || measurement.kind !== 'measured' || measurement.o200k <= 0) return null;
    if (!this.index) {
      this.index = new Calibration();
      for (const event of this.events) learn(this.index, event);
    }
    const previous = Math.min(this.fit.allowance ?? measurement.o200k, measurement.o200k);
    if (refusal.actual === null && measurement.pictures === 0) this.index.invalidate(this.key, this.chat, measurement.at);
    if (refusal.actual !== null && measurement.pictures === 0) this.index.observe({ key: this.key, chat: this.chat, at: measurement.at, fingerprint: measurement.fingerprint, input: refusal.actual, denominator: measurement.o200k });
    const limits = refusal.maximum === null ? this.limits : { ...this.limits, hard: Math.min(this.limits.hard ?? Infinity, refusal.maximum) };
    const learned = fitLimits(limits, this.index.estimate(this.key, this.chat, Date.now()));
    // Count-free refusals cannot supply an upper ratio. Two geometric cuts bracket a fourfold miss, not arbitrary routes.
    // Keep retries bounded and terminal refusals truthful.
    const shrink = Math.floor(previous / 2);
    const allowance = Math.min(previous - 1, learned.allowance ?? shrink, refusal.actual === null ? shrink : Infinity);
    if (allowance < 0) return null;
    this.retries.push({ measurement, actual: refusal.actual, maximum: refusal.maximum, allowance, at: Date.now() });
    this.fit = { ...learned, bound: allowance === learned.allowance ? learned.bound : 'refusal', allowance, multiplier: learned.inputLimit === null ? null : learned.inputLimit / Math.max(allowance, 1) };
    return this.fit;
  }
}
