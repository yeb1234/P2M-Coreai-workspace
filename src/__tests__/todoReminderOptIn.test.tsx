import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoForm } from '../components/todo/TodoForm';
import { InlineAddInput } from '../components/todo/InlineAddInput';
import { useScheduleStore } from '../stores/scheduleStore';
import { useUIStore } from '../stores/uiStore';

vi.mock('../lib/sounds', () => ({
  playInteractionSound: vi.fn(),
}));

describe('todo reminder opt-in', () => {
  beforeEach(() => {
    useScheduleStore.setState({
      items: {},
      itemOrder: [],
      pendingTodoDate: null,
      pendingTodoPriority: null,
    });
    useUIStore.setState({ noteEnterBehavior: 'enter_save' });
  });

  it('creates a todo without reminder by default', () => {
    render(<TodoForm defaultDate="2026-05-12" onClose={() => undefined} />);

    fireEvent.change(screen.getByPlaceholderText(/输入标题/), { target: { value: '默认不提醒' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    const todo = Object.values(useScheduleStore.getState().items)[0];
    expect(todo.startAt).toBeNull();
    expect(todo.dueAt).toBeNull();
    expect(todo.reminderAt).toBeNull();
    expect(todo.pomodoroRounds).toBe(1);
  });

  it('writes reminder time only after enabling the reminder switch', () => {
    render(<TodoForm defaultDate="2026-05-12" onClose={() => undefined} />);

    fireEvent.change(screen.getByPlaceholderText(/输入标题/), { target: { value: '打开提醒' } });
    fireEvent.click(screen.getByLabelText('是否提醒'));
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    const todo = Object.values(useScheduleStore.getState().items)[0];
    expect(todo.reminderAt).toBe('2026-05-12T01:00:00.000Z');
  });

  it('defaults enabled reminder to half an hour before the start time', () => {
    const { container } = render(<TodoForm onClose={() => undefined} />);

    fireEvent.change(screen.getByPlaceholderText(/输入标题/), { target: { value: '提前提醒' } });
    const dateInputs = container.querySelectorAll('input[type="date"]');
    const timeInputs = container.querySelectorAll('input[type="time"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-05-12' } });
    fireEvent.change(timeInputs[0], { target: { value: '09:00' } });
    fireEvent.click(screen.getByLabelText('是否提醒'));

    const updatedDateInputs = container.querySelectorAll('input[type="date"]');
    const updatedTimeInputs = container.querySelectorAll('input[type="time"]');
    expect((updatedDateInputs[2] as HTMLInputElement).value).toBe('2026-05-12');
    expect((updatedTimeInputs[2] as HTMLInputElement).value).toBe('08:30');

    fireEvent.change(updatedDateInputs[1], { target: { value: '2026-05-12' } });
    fireEvent.change(updatedTimeInputs[1], { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    const todo = Object.values(useScheduleStore.getState().items)[0];
    expect(todo.reminderAt).toBe('2026-05-12T00:30:00.000Z');
  });

  it('writes schedule times only when date and time fields are complete', () => {
    const { container } = render(<TodoForm onClose={() => undefined} />);

    fireEvent.change(screen.getByPlaceholderText(/输入标题/), { target: { value: '有排期' } });
    const dateInputs = container.querySelectorAll('input[type="date"]');
    const timeInputs = container.querySelectorAll('input[type="time"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-05-12' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-05-12' } });
    fireEvent.change(timeInputs[0], { target: { value: '09:00' } });
    fireEvent.change(timeInputs[1], { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    const todo = Object.values(useScheduleStore.getState().items)[0];
    expect(todo.startAt).toBe('2026-05-12T01:00:00.000Z');
    expect(todo.dueAt).toBe('2026-05-12T02:00:00.000Z');
  });

  it('keeps inline add todos reminder-free because there is no reminder switch there', () => {
    render(<InlineAddInput />);

    fireEvent.click(screen.getByRole('button', { name: /新提醒事项/ }));
    fireEvent.change(screen.getByPlaceholderText(/输入待办/), { target: { value: '整理资料 下午6点' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/输入待办/), { key: 'Enter' });

    const todo = Object.values(useScheduleStore.getState().items)[0];
    expect(todo.reminderAt).toBeNull();
  });
});
