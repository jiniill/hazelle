import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Button, Intro, Progress, Screen } from '../ui';

type Loaded<P> = { default: ComponentType<P> };

// A lazy screen whose chunk can be started before it is drawn. lazy() suspends once even for a chunk that has arrived,
// and React then holds the fallback it showed for 300 ms; a started chunk that has arrived is handed over at once, so
// nothing suspends. A failed start is forgotten: the draw loads again, and its failure reaches ScreenLoad.
export function screenChunk<M, P extends object>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>) {
  let arrived: M | null = null;
  let loading: Promise<M> | null = null;
  const fetch = () => (loading ??= load().then(
    (module) => (arrived = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));
  const drawn = lazy(() => {
    const module = arrived;
    if (!module) return fetch().then((module) => ({ default: pick(module) }));
    // A thenable that answers inside then(), which lazy reads before it would suspend.
    const now = { then: (done: (loaded: Loaded<P>) => void) => done({ default: pick(module) }) };
    return now as unknown as Promise<Loaded<P>>;
  });
  return { Screen: drawn, start: () => fetch().then(() => {}, () => {}) };
}

// at: the place the screen stands for. A failure is that place's, so another place is tried anew.
export class ScreenLoad extends Component<{ at?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { at?: string }) {
    if (this.state.failed && previous.at !== this.props.at) this.setState({ failed: false });
  }

  render() {
    if (this.state.failed) return (
      <Screen align="center">
        <Intro title="화면을 열지 못했어요">새로고침한 뒤 다시 시도해 주세요.</Intro>
        <Button onClick={() => location.reload()}>새로고침</Button>
      </Screen>
    );
    return (
      <Suspense fallback={<Screen align="center"><Progress steps={[{ label: '화면을 불러오는 중' }]} /></Screen>}>
        {this.props.children}
      </Suspense>
    );
  }
}
