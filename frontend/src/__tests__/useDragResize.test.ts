import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { useDragResize } from '../hooks/useDragResize';

function fireMouse(type: 'mousemove' | 'mouseup' | 'pointerup', init: MouseEventInit = {}) {
  window.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
}

describe('useDragResize selection cleanup', () => {
  beforeEach(() => {
    document.body.style.userSelect = 'text';
  });

  afterEach(() => {
    document.body.style.userSelect = '';
  });

  it('restores the previous body user-select after mouseup', () => {
    const hook = renderHook(() => useDragResize({
      initialWidth: 320,
      minWidth: 300,
      maxWidth: 640,
      side: 'left',
    }));

    act(() => hook.result.current.startResize(400));
    act(() => fireMouse('mousemove', { buttons: 1, clientX: 500 }));
    expect(document.body.style.userSelect).toBe('none');

    act(() => fireMouse('mouseup', { clientX: 500 }));
    expect(document.body.style.userSelect).toBe('text');
    hook.unmount();
  });

  it('recovers when the mouse was released outside the window', () => {
    const hook = renderHook(() => useDragResize({
      initialWidth: 320,
      minWidth: 300,
      maxWidth: 640,
      side: 'left',
    }));

    act(() => hook.result.current.startResize(400));
    act(() => fireMouse('mousemove', { buttons: 1, clientX: 500 }));
    expect(document.body.style.userSelect).toBe('none');

    // 窗口外松开后，下一次 mousemove 的 buttons=0 就是结束信号。
    act(() => fireMouse('mousemove', { buttons: 0, clientX: 500 }));
    expect(document.body.style.userSelect).toBe('text');
    hook.unmount();
  });

  it('restores on blur even if no mouseup arrives', () => {
    const hook = renderHook(() => useDragResize({
      initialWidth: 320,
      minWidth: 300,
      maxWidth: 640,
      side: 'left',
    }));

    act(() => hook.result.current.startResize(400));
    act(() => fireMouse('mousemove', { buttons: 1, clientX: 500 }));
    expect(document.body.style.userSelect).toBe('none');

    act(() => window.dispatchEvent(new Event('blur')));
    expect(document.body.style.userSelect).toBe('text');
    hook.unmount();
  });

  it('restores on unmount while dragging', () => {
    document.body.style.userSelect = 'text';
    const hook = renderHook(() => useDragResize({
      initialWidth: 320,
      minWidth: 300,
      maxWidth: 640,
      side: 'left',
    }));

    act(() => hook.result.current.startResize(400));
    act(() => fireMouse('mousemove', { buttons: 1, clientX: 500 }));
    expect(document.body.style.userSelect).toBe('none');

    hook.unmount();
    expect(document.body.style.userSelect).toBe('text');
  });
});
