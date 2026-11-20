import { describe, expect, it } from 'vitest';
import { groupNavOrder, type NavGroup } from '../components/layout/navOrder';

type TestView = 'dashboard' | 'todo' | 'notes' | 'video' | 'reader' | 'tools';

const GROUPS: NavGroup<TestView>[] = [
  { label: '日常', ids: ['dashboard', 'todo', 'notes'] },
  { label: '学习', ids: ['video', 'reader'] },
  { label: '工具', ids: ['tools'] },
];

describe('sidebar nav grouping', () => {
  it('keeps section order but applies the dragged order inside each section', () => {
    const navOrder: TestView[] = ['notes', 'todo', 'dashboard', 'video', 'reader', 'tools'];

    expect(groupNavOrder(navOrder, GROUPS)).toEqual([
      'notes', 'todo', 'dashboard',
      'video', 'reader',
      'tools',
    ]);
  });

  it('keeps an unknown item visible at the end', () => {
    const navOrder: TestView[] = ['todo', 'dashboard', 'notes', 'video', 'reader', 'tools'];
    const groups: NavGroup<TestView>[] = [
      { label: '日常', ids: ['dashboard', 'todo', 'notes'] },
      { label: '学习', ids: ['video', 'reader'] },
    ];

    expect(groupNavOrder(navOrder, groups)).toEqual([
      'todo', 'dashboard', 'notes',
      'video', 'reader',
      'tools',
    ]);
  });
});
