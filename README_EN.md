# P2M - Personal Productivity Workstation

> An all-in-one personal productivity tool integrating todo management, pomodoro timer, calendar, notes, and data analytics.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | React 19 + TypeScript 6 |
| Build Tool | Vite 8 |
| State Management | Zustand 5 |
| Styling | Tailwind CSS 3 |
| Date Utilities | date-fns 4 |
| Icons | lucide-react |
| Persistence | localStorage (zustand persist) |
| Testing | Vitest + @testing-library/react |

## Project Structure

```
src/
├── components/          # UI components
│   ├── layout/          # Layout: Header, Sidebar, AppLayout, NotificationPanel
│   ├── dashboard/       # Dashboard: PluginCard, module Summary cards
│   ├── todo/            # Todo: TodoList, TodoItem, TodoForm, TodoFilters
│   ├── calendar/        # Calendar: CalendarGrid, DayCell, WeekView
│   ├── pomodoro/        # Pomodoro: Timer, Stats, SessionList
│   ├── notes/           # Notes: NotesPage
│   ├── stats/           # Data Center: StatsPage
│   ├── settings/        # Settings: SettingsPage
│   └── shared/          # Shared: Modal, Badge, PageTitle, EmptyState, ConfirmDialog
├── stores/              # Zustand state management
│   ├── todoStore.ts     # Todo CRUD + undo/redo + filtering
│   ├── pomodoroStore.ts # Pomodoro timer + session management
│   ├── calendarStore.ts # Calendar events + heat map
│   ├── notesStore.ts    # Notes CRUD
│   ├── uiStore.ts       # UI state: view switching, sidebar, nav ordering
│   ├── pluginStore.ts   # Plugin layout management
│   └── notificationStore.ts # Notification system
├── hooks/               # Custom hooks
│   └── useCrossModuleSync.ts # Cross-module data synchronization
├── lib/                 # Utility functions
│   ├── date.ts          # Date formatting
│   ├── id.ts            # ID generation (nanoid)
│   └── sounds.ts        # Web Audio sound effects
├── types/               # TypeScript type definitions
├── plugins/             # Plugin registration system
└── __tests__/           # Unit tests
```

## Core Features

### Todo Management
- Create, edit, delete, drag-to-reorder
- Priority levels (High / Medium / Low / Green)
- Due dates, tag filtering
- Undo/Redo (Ctrl+Z / Ctrl+Y)
- Trash bin with restore
- Integrates with Calendar and Pomodoro

### Pomodoro Timer
- 25-minute focus + 5-minute short break + 15-minute long break
- Customizable duration and daily goals
- Link to todo items
- Ambient white noise (Rain, Cafe, Fireplace, Forest)
- Focus statistics and timeline

### Calendar
- Month view / Week view
- Calendar heat map (pomodoro density)
- Double-click date to quickly create a todo
- Event management

### Notes
- 6 sticky note colors
- Pin, tags, search
- Markdown content support

### Data Center
- Today / This week pomodoro stats
- Todo completion rate
- Focus streak days
- Achievement badge system
- Weekly focus trend chart

### Notification System
- Pomodoro completion notifications
- Todo due reminders
- System messages
- Unread count badge

### Settings
- Pomodoro parameter tuning (functional)
- Profile, Notifications, Appearance, Privacy, Data Management (placeholder)

## Architecture

### State Management
Uses a **Zustand + localStorage** dual-layer architecture:
- Zustand handles reactive state
- `persist` middleware auto-persists to localStorage
- Each store uses `partialize` to persist only necessary data
- `merge` function handles field merging during version upgrades

### Performance Optimizations
- **Zustand selectors**: All components use precise selectors to avoid unnecessary re-renders
- **React.memo**: Pure display components wrapped with memo
- **useMemo/useCallback**: Expensive computations and callbacks are memoized
- **Portal**: Notification panel uses React Portal for correct z-index layering
- **Constant extraction**: Module-level constants avoid recreation on every render

### Cross-Module Sync
`useCrossModuleSync` hook handles:
- Pomodoro global tick (every second)
- Pomodoro completion → auto-create calendar event
- Todo with due date → auto-create calendar event
- Pomodoro completion → push notification

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Lint code
npm run lint
```

## Testing

```bash
npm test              # Run once
npm run test:watch    # Watch mode
```

Test coverage:
- `todoStore`: CRUD, undo/redo, filtering, date queries
- `notesStore`: CRUD, pinning, defaults
- `notificationStore`: Add, read, clear, limits
- `date.ts`: Date formatting, time formatting, duration formatting
- `id.ts`: Uniqueness, non-empty

## License

MIT
