import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface VideoErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class VideoErrorBoundary extends React.Component<React.PropsWithChildren, VideoErrorBoundaryState> {
  state: VideoErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): VideoErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : '视频模块发生未知错误',
    };
  }

  componentDidCatch(error: unknown) {
    console.error('Video module error:', error);
  }

  reset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="rounded-xl border border-[#fecaca] bg-[var(--danger-bg)] p-5 text-[#7f1d1d]">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">视频模块出错了</h3>
            <p className="mt-1 break-words text-xs leading-5 text-[#991b1b]">{this.state.message}</p>
            <button
              onClick={this.reset}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#991b1b] shadow-sm hover:bg-[#fff7f7]"
            >
              <RotateCcw size={13} />
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }
}
