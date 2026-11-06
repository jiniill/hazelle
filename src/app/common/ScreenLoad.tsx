import { Component, Suspense, type ReactNode } from 'react';
import { Button, Intro, Progress, Screen } from '../ui';

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
