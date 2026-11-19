import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_PRESETS } from '../../src/lib/themes';

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8');
}

describe('regression contracts', () => {
  it('keeps responsive grids based on container width', () => {
    const css = readRepoFile('src/index.css');

    for (const className of ['auto-grid-cards', 'auto-grid-panels', 'auto-grid-wide', 'auto-grid-video', 'auto-grid-compact']) {
      const block = css.match(new RegExp(`\\.${className}\\s*\\{[\\s\\S]*?\\}`))?.[0] ?? '';

      expect(block, `${className} should exist`).toContain('display: grid');
      expect(block, `${className} should use minmax`).toContain('minmax');
      expect(block, `${className} should guard against narrow containers`).toContain('min(100%');
    }
  });

  it('keeps video card columns user-controlled and mobile-safe', () => {
    const css = readRepoFile('src/index.css');
    const block = css.match(/\.video-card-grid\s*\{[\s\S]*?\}/)?.[0] ?? '';

    expect(block).toContain('--video-grid-columns');
    expect(block).toContain('minmax(0, 1fr)');
    expect(block).toContain('justify-content: start');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('grid-template-columns: 1fr');
  });

  it('keeps plugin pages lazy loaded with hover preloading', () => {
    const registry = readRepoFile('src/config/pageRegistry.tsx');
    const sidebar = readRepoFile('src/components/layout/Sidebar.tsx');
    const mobileTabBar = readRepoFile('src/components/layout/MobileTabBar.tsx');

    expect(registry).toContain('React.lazy');
    expect(registry).toContain('preloadPage');
    expect(registry).toContain('PAGE_LOADERS');
    expect(sidebar).toContain('onMouseEnter={() => preloadPage(id)}');
    expect(mobileTabBar).toContain('onTouchStart={() => preloadPage(tab.id)}');
  });

  it('keeps todo reminders scheduled without fixed polling', () => {
    const syncHook = readRepoFile('src/hooks/useCrossModuleSync.ts');
    const reminderBlock = syncHook.match(/const runReminderCheck = \(\) => \{[\s\S]*?const unsubTodos = useScheduleStore\.subscribe/)?.[0] ?? '';
    const appLayout = readRepoFile('src/components/layout/AppLayout.tsx');
    const popup = readRepoFile('src/components/layout/TodoReminderPopup.tsx');

    expect(reminderBlock).toContain('nextReminderAt');
    expect(reminderBlock).toContain('setTimeout(runReminderCheck');
    expect(reminderBlock).toContain("todo.type !== 'todo'");
    expect(reminderBlock).not.toContain('setInterval');
    expect(syncHook).not.toContain('15000');
    expect(appLayout).toContain('TodoReminderPopup');
    expect(popup).toContain("item.type === 'todo' && item.title === '待办提醒' && !item.read");
    expect(popup).toContain('activeReminder.message');
    expect(popup).toContain('markAsRead(activeReminder.id)');
  });

  it('keeps pomodoro remote sync on explicit runtime actions instead of every tick', () => {
    const store = readRepoFile('src/stores/pomodoroStore.ts');
    const tickBlock = store.match(/tick: \(\) => \{[\s\S]*?\n      \},\n\n      completePhase:/)?.[0] ?? '';

    expect(store).toContain("syncPomodoroRuntime('start'");
    expect(store).toContain("syncPomodoroRuntime('pause'");
    expect(store).toContain("syncPomodoroRuntime('resume'");
    expect(store).toContain("syncPomodoroRuntime('reset'");
    expect(store).toContain("syncPomodoroRuntime('complete-phase'");
    expect(tickBlock).not.toContain('syncPomodoroRuntime');
    expect(tickBlock).not.toContain('savePomodoroRemoteRuntime');
  });

  it('keeps todos and calendars on unified schedule items instead of mirrored sync', () => {
    const syncHook = readRepoFile('src/hooks/useCrossModuleSync.ts');
    const scheduleStore = readRepoFile('src/stores/scheduleStore.ts');
    const calendar2 = readRepoFile('src/components/calendar2/Calendar2Page.tsx');

    expect(scheduleStore).toContain('addTodo');
    expect(scheduleStore).toContain('addEvent');
    expect(scheduleStore).toContain('startAt');
    expect(scheduleStore).toContain('dueAt');
    expect(calendar2).toContain("event.dataTransfer.setData('application/x-calendar2-item'");
    expect(calendar2).toContain('dragOffsetRef');
    expect(syncHook).not.toContain('buildTodoCalendarSyncPlan');
    expect(syncHook).not.toContain('plan.add.forEach');
    expect(syncHook).not.toContain('const dueData =');
    expect(syncHook).not.toContain('const reminderData =');
  });

  it('keeps todo pomodoro starts derived from schedule time ranges', () => {
    const todoForm = readRepoFile('src/components/todo/TodoForm.tsx');
    const todoItem = readRepoFile('src/components/todo/TodoItem.tsx');
    const pomodoroStore = readRepoFile('src/stores/pomodoroStore.ts');

    expect(todoForm).not.toContain('这是番茄钟时间');
    expect(todoForm).not.toContain('setIsPomodoro');
    expect(todoItem).toContain('getSchedulePomodoroPlan');
    expect(todoItem).toContain('effectiveRounds');
    expect(pomodoroStore).toContain('calculateSchedulePomodoroRounds');
    expect(pomodoroStore).toContain('useScheduleStore.getState().items');
  });

  it('keeps calendar2 overlapping events visibly separated', () => {
    const calendar2 = readRepoFile('src/components/calendar2/Calendar2Page.tsx');

    expect(calendar2).toContain('layoutWeekEvents');
    expect(calendar2).toContain('data-conflict-column');
    expect(calendar2).toContain('data-conflict-columns');
    expect(calendar2).toContain('event.conflictColumn * (eventLaneWidth + EVENT_OVERLAP_GAP)');
  });

  it('keeps time center on the shared clock without an extra stopwatch interval', () => {
    // 2026-11 清理时删掉了 TimeCenterPage.tsx（零引用，路由用的是 Page2）。
    // 契约本身没变，改成检查真正在跑的那一版。
    // 秒表状态字段名从 stopwatchBaseElapsed 变成了 swStartAt / swBase，
    // 但它仍然提升在页面级（注释写着「page-level so it survives widget hide/show」），
    // 这正是这条契约要守的东西。
    const timeCenter = readRepoFile('src/components/timecenter/TimeCenterPage2.tsx');

    expect(timeCenter).toContain('useClockNow');
    expect(timeCenter).not.toContain('setInterval');
    expect(timeCenter).toContain('swStartAt');
    expect(timeCenter).toContain('pauseStopwatch');
  });

  it('keeps AI job polling adaptive to page visibility', () => {
    const aiJobCenter = readRepoFile('src/hooks/useAiJobCenter.ts');

    expect(aiJobCenter).toContain("document.visibilityState === 'visible' ? 5000 : 20000");
    expect(aiJobCenter).toContain('document.addEventListener(\'visibilitychange\'');
    expect(aiJobCenter).toContain('window.setTimeout(tick');
    expect(aiJobCenter).not.toContain('window.setInterval');
  });

  it('keeps assistant page context updates state-driven', () => {
    const chatPanel = readRepoFile('src/components/layout/AIChatPanel.tsx');
    const contextHook = readRepoFile('src/hooks/useAssistantPageContext.ts');

    expect(chatPanel).toContain('useAssistantPageContext(chatOpen)');
    expect(chatPanel).not.toContain('window.setInterval');
    expect(chatPanel).not.toContain('1500');
    expect(contextHook).toContain('useVideoStore');
    expect(contextHook).toContain('useNotesStore');
    expect(contextHook).toContain('useUIStore');
    expect(contextHook).toContain('getAssistantPageContext()');
  });

  it('keeps stored theme applied from hydrated UI state', () => {
    const app = readRepoFile('src/App.tsx');
    const themeHook = readRepoFile('src/hooks/useApplyStoredTheme.ts');

    expect(app).toContain('useApplyStoredTheme(initialized)');
    expect(app).not.toContain('setTimeout(() =>');
    expect(themeHook).toContain('useUIStore');
    expect(themeHook).toContain('themeId');
    expect(themeHook).toContain('customTheme');
    expect(themeHook).toContain('applyTheme');
  });

  it('keeps todo list filtering memoized from subscribed state', () => {
    const todoList = readRepoFile('src/components/todo/TodoList.tsx');

    expect(todoList).toContain('const filteredTodos = useMemo');
    expect(todoList).toContain('const orderIndex = new Map');
    expect(todoList).toContain('const trashedTodos = useMemo');
    expect(todoList).not.toContain('getFilteredTodos()');
    expect(todoList).not.toContain('getTrashedTodos()');
  });

  it('keeps todo items from rerendering on every pomodoro tick', () => {
    const todoItem = readRepoFile('src/components/todo/TodoItem.tsx');

    expect(todoItem).toContain('timer.status');
    expect(todoItem).toContain('timer.linkedTodoId');
    expect(todoItem).toContain('linkedTodoTitle');
    expect(todoItem).not.toContain('const timerStatus = usePomodoroStore((s) => s.timer)');
    expect(todoItem).not.toContain('const timer = usePomodoroStore');
    expect(todoItem).not.toContain('const todos = useTodoStore');
  });

  it('keeps notes manually reorderable with drag affordances', () => {
    const notesStore = readRepoFile('src/stores/notesStore.ts');
    const notesPage = readRepoFile('src/components/notes/NotesPage.tsx');

    expect(notesStore).toContain('reorderNotes');
    expect(notesStore).toContain("export type NoteInsertPosition = 'before' | 'after'");
    expect(notesStore).toContain('notes.splice(insertIndex, 0, moved)');
    expect(notesStore).toContain('partialize: (state) => ({ notes: state.notes');
    expect(notesPage).toContain('data-note-card');
    expect(notesPage).toContain('event.clientX < rect.left + rect.width / 2');
    expect(notesPage).not.toContain('event.clientY < rect.top + rect.height / 2');
    expect(notesPage).toContain('setDragImage');
    expect(notesPage).toContain('GripVertical');
    expect(notesPage).toContain("insertPosition === 'before'");
    expect(notesPage).toContain('bg-gradient-to-b from-transparent via-[#f59e0b] to-transparent');
  });

  it('keeps note editor enter behavior configurable', () => {
    const uiStore = readRepoFile('src/stores/uiStore.ts');
    const notesPage = readRepoFile('src/components/notes/NotesPage.tsx');
    const todoForm = readRepoFile('src/components/todo/TodoForm.tsx');
    const settingsPage = readRepoFile('src/components/settings/SettingsPage.tsx');

    expect(uiStore).toContain("export type NoteEnterBehavior = 'enter_save' | 'enter_newline'");
    expect(uiStore).toContain("noteEnterBehavior: 'enter_save'");
    expect(uiStore).toContain('setNoteEnterBehavior');
    expect(notesPage).toContain('handleEditContentKeyDown');
    expect(notesPage).toContain('handleEditTitleKeyDown');
    expect(notesPage).toContain('contentInputRef.current?.focus()');
    expect(notesPage).toContain("noteEnterBehavior === 'enter_save' ? !event.altKey : event.altKey");
    expect(notesPage).toContain('Enter 保存，Alt+Enter 换行');
    expect(todoForm).toContain('handleDescriptionKeyDown');
    expect(todoForm).toContain('handleTitleKeyDown');
    expect(todoForm).toContain('descriptionInputRef.current?.focus()');
    expect(todoForm).toContain("noteEnterBehavior === 'enter_save' ? !event.altKey : event.altKey");
    expect(settingsPage).toContain('编辑回车行为');
    expect(settingsPage).toContain('setNoteEnterBehavior');
  });

  it('keeps calendar todo/event derived data centralized', () => {
    const helper = readRepoFile('src/components/calendar/calendarDerivedData.ts');
    const calendarGrid = readRepoFile('src/components/calendar/CalendarGrid.tsx');
    const weekView = readRepoFile('src/components/calendar/WeekView.tsx');
    const calendarPage = readRepoFile('src/components/calendar/CalendarPage.tsx');

    expect(helper).toContain('groupScheduleItemsByDate');
    expect(helper).toContain('getItemsForCalendarMonth');
    expect(helper).toContain('getItemsForCalendarDates');
    expect(helper).toContain('getScheduleItemsForDate');
    expect(calendarGrid).toContain('scheduleItems');
    expect(calendarGrid).toContain('groupScheduleItemsByDate');
    expect(weekView).toContain('scheduleItems');
    expect(weekView).toContain('groupScheduleItemsByDate');
    expect(calendarPage).toContain('getScheduleItemsForDate');
    expect(calendarPage).not.toContain('Object.values(calendarEvents)');
    expect(calendarGrid).toContain('useMemo(() => getMonthDays(currentMonth)');
    expect(weekView).toContain('useMemo(() => getWeekDays(currentMonth)');
  });

  it('keeps selected calendar todos deletable into todo trash', () => {
    const calendarPage = readRepoFile('src/components/calendar/CalendarPage.tsx');
    const helper = readRepoFile('src/components/calendar/calendarDerivedData.ts');

    expect(calendarPage).toContain('getScheduleItemsForDate');
    expect(calendarPage).toContain('handleDelete');
    expect(calendarPage).toContain('deleteItem(id)');
    expect(calendarPage).toContain('playInteractionSound(\'delete\')');
    expect(calendarPage).toContain('移入垃圾箱');
    expect(helper).toContain('groupScheduleItemsByDate');
  });

  it('keeps calendar todo planning modal local to calendar views', () => {
    const calendarPage = readRepoFile('src/components/calendar/CalendarPage.tsx');
    const calendarGrid = readRepoFile('src/components/calendar/CalendarGrid.tsx');
    const weekView = readRepoFile('src/components/calendar/WeekView.tsx');

    expect(calendarPage).toContain('todoPlanDate');
    expect(calendarPage).toContain('setTodoPlanDate(date)');
    expect(calendarPage).toContain('<TodoForm');
    expect(calendarPage).toContain('defaultPriority="medium"');
    expect(calendarPage).not.toContain('setActiveView(\'todo\')');
    expect(calendarGrid).toContain('<WeekView onDayDoubleClick={onDayDoubleClick} />');
    expect(weekView).toContain('onDayDoubleClick?: (date: ISODateString) => void');
    expect(weekView).toContain('onDoubleClick={() => onDayDoubleClick?.(dateStr)}');
  });

  it('keeps media query listeners centralized in shared hooks', () => {
    const mediaHook = readRepoFile('src/hooks/useMediaQuery.ts');
    const appLayout = readRepoFile('src/components/layout/AppLayout.tsx');
    const calendarGrid = readRepoFile('src/components/calendar/CalendarGrid.tsx');
    const todoFilters = readRepoFile('src/components/todo/TodoFilters.tsx');
    const videoPage = readRepoFile('src/components/video/VideoPage.tsx');
    const playlistPanel = readRepoFile('src/components/video/VideoPlaylistPanel.tsx');

    expect(mediaHook).toContain('export function useMediaQuery');
    expect(mediaHook).toContain('export function useIsMobile');
    expect(mediaHook).toContain('export function useWindowWidth');
    expect(appLayout).toContain('useIsMobile');
    expect(calendarGrid).toContain('useIsMobile');
    expect(todoFilters).toContain('useIsMobile');
    expect(videoPage).toContain('useWindowWidth');
    expect(playlistPanel).toContain('useIsMobile(1024)');
    expect(appLayout).not.toContain('window.matchMedia');
    expect(calendarGrid).not.toContain('window.innerWidth');
    expect(todoFilters).not.toContain('window.matchMedia');
    expect(videoPage).not.toContain('window.matchMedia');
    expect(playlistPanel).not.toContain('window.matchMedia');
  });

  it('keeps notification panel positioning in small pure helpers', () => {
    const notificationPanel = readRepoFile('src/components/layout/NotificationPanel.tsx');
    const positionHelper = readRepoFile('src/components/layout/notificationPanelPosition.ts');

    expect(positionHelper).toContain('export function getPanelOpenPosition');
    expect(positionHelper).toContain('export function clampPanelPosition');
    expect(positionHelper).toContain('NOTIFICATION_PANEL_WIDTH = 384');
    expect(notificationPanel).toContain('from \'./notificationPanelPosition\'');
    expect(notificationPanel).toContain('setPosition(getPanelOpenPosition');
    expect(notificationPanel).toContain('setPosition(clampPanelPosition');
  });

  it('keeps video progress scrubbing in a focused hook', () => {
    const videoPage = readRepoFile('src/components/video/VideoPage.tsx');
    const scrubberHook = readRepoFile('src/components/video/useVideoProgressScrubber.ts');

    expect(scrubberHook).toContain('export function useVideoProgressScrubber');
    expect(scrubberHook).toContain('getRatioFromClientX');
    expect(scrubberHook).toContain('touchmove');
    expect(videoPage).toContain('useVideoProgressScrubber');
    expect(videoPage).toContain('onProgressMouseDown={startScrub}');
    expect(videoPage).toContain('onProgressMouseMove={updateHover}');
    expect(videoPage).not.toContain('const handleProgressMouseDown');
    expect(videoPage).not.toContain('const handleProgressTouchStart');
  });

  it('keeps video element media events outside the page JSX', () => {
    const videoPage = readRepoFile('src/components/video/VideoPage.tsx');
    const eventsHook = readRepoFile('src/components/video/useVideoElementEvents.ts');

    expect(eventsHook).toContain('export function useVideoElementEvents');
    expect(eventsHook).toContain('handleLoadedMetadata');
    expect(eventsHook).toContain('handleVolumeSync');
    expect(eventsHook).toContain('getVideoErrorLabel');
    expect(videoPage).toContain('useVideoElementEvents');
    expect(videoPage).toContain('onLoadedMetadata={videoElementEvents.handleLoadedMetadata}');
    expect(videoPage).toContain('onVolumeChange={videoElementEvents.handleVolumeSync}');
    expect(videoPage).not.toContain('code === 1 ?');
  });

  it('keeps sprite previews visible and browser-readable', () => {
    const spritePreview = readRepoFile('src/components/video/SpritePreview.tsx');
    const spriteMetaHook = readRepoFile('src/components/video/useSpriteMeta.ts');
    const backendMain = readRepoFile('backend/app/main.py');
    const backendSprite = readRepoFile('backend/app/services/sprite.py');

    // 用正则而不是全字面量：expose_headers 后来追加了 X-Request-ID，
    // 写死的 ["X-Sprite-Meta"] 已经不是子串了。
    expect(backendMain).toMatch(/expose_headers=\[[^\]]*"X-Sprite-Meta"[^\]]*\]/);
    expect(backendSprite).toContain('settings.sprite_frame_width');
    expect(backendSprite).toContain('FRAME_WIDTH = max(160');
    expect(backendSprite).toContain('"jpeg_quality": JPEG_QUALITY');
    expect(backendSprite).toContain('return generate_sprite(video_path, video_id)');
    expect(spritePreview).toContain('生成预览中');
    expect(spritePreview).toContain('暂无雪碧图');
    expect(spritePreview).toContain('getFixedSpriteFrameStyle');
    expect(spriteMetaHook).toContain('backgroundImage');
    expect(spriteMetaHook).toContain('backgroundPosition');
    expect(spriteMetaHook).toContain('X-Sprite-Meta');
    expect(spritePreview).not.toContain('objectPosition');
  });

  it('keeps video card sprite previews hover-gated', () => {
    const videoListSections = readRepoFile('src/components/video/VideoListSections.tsx');

    expect(videoListSections).toContain('VideoCardThumbnail');
    expect(videoListSections).toContain('useSpriteMeta(previewEnabled ? video.id : null');
    expect(videoListSections).toContain('onMouseEnter={startHoverPreview}');
    expect(videoListSections).toContain('onMouseLeave={stopHoverPreview}');
    expect(videoListSections).toContain('setInterval');
    expect(videoListSections).toContain('enableSpritePreview={!isMobile}');
  });

  it('keeps desktop main padding at the tuned compact value', () => {
    const css = readRepoFile('src/index.css');
    const desktopMainBlock = css.match(/@media \(min-width: 768px\)\s*\{\s*\.app-main\s*\{[\s\S]*?\}\s*\}/)?.[0] ?? '';

    expect(desktopMainBlock).toContain('padding: 0.875rem');
  });

  it('keeps the ambient volume fill and thumb on a single ratio variable', () => {
    const pomodoroTimer = readRepoFile('src/components/pomodoro/PomodoroTimer.tsx');

    expect(pomodoroTimer).toContain('--ambient-volume-ratio');
    expect(pomodoroTimer).toContain('width: \'calc((100% - 12px) * var(--ambient-volume-ratio))\'');
    expect(pomodoroTimer).toContain('left: \'calc(6px + (100% - 12px) * var(--ambient-volume-ratio))\'');
    expect(pomodoroTimer).not.toContain('ambientVolume / 100})`');
  });

  it('keeps pomodoro runtime local-only and immediately persisted', () => {
    const pomodoroStore = readRepoFile('src/stores/pomodoroStore.ts');
    const idbStorage = readRepoFile('src/lib/idbStorage.ts');

    expect(pomodoroStore).toContain('storage: createJSONStorage(() => localOnlyStorage)');
    expect(pomodoroStore).toContain('timer: state.timer');
    expect(pomodoroStore).toContain('_lastTickTimestamp: state._lastTickTimestamp');
    expect(pomodoroStore).toContain('migratePomodoroPersistedState');
    expect(idbStorage).toContain('IMMEDIATE_LOCAL_STORAGE_NAMES');
    expect(idbStorage).toContain('p2m-pomodoro-storage');
    expect(idbStorage).toContain('await doLocalWrite(scopedName, value)');
  });

  it('keeps admin router as a thin HTTP layer', () => {
    const adminRouter = readRepoFile('backend/app/routers/admin.py');

    expect(adminRouter).toContain('from app.services import admin_ai_queue');
    expect(adminRouter).toContain('from app.services.admin_health import backend_health as collect_backend_health');
    expect(adminRouter).toContain('from app.services.admin_library import');
    expect(adminRouter).not.toContain('from app.models import AiJob');
    expect(adminRouter).not.toContain('requests.get');
    expect(adminRouter).not.toContain('threading.Thread');
    expect(adminRouter).not.toContain('db.query(AiJob)');
  });

  it('keeps dark themes on distinct layered surface colors', () => {
    const darkThemeIds = ['night', 'claude-ink', 'primer-dark', 'antigravity-dark', 'blue-night'];

    for (const id of darkThemeIds) {
      const theme = THEME_PRESETS.find((preset) => preset.id === id);
      expect(theme, `${id} exists`).toBeTruthy();
      const vars = theme!.vars;
      const surfaceColors = new Set([
        vars['--bg-body'].toLowerCase(),
        vars['--bg-base'].toLowerCase(),
        vars['--bg-card'].toLowerCase(),
        vars['--bg-elevated'].toLowerCase(),
      ]);

      expect(surfaceColors.size, `${id} should have body/base/card/elevated layers`).toBe(4);
      expect(vars['--text-primary'], `${id} should avoid pure white primary text`).not.toBe('#ffffff');
      expect(vars['--accent-bg'].toLowerCase(), `${id} accent bg should differ from card`).not.toBe(vars['--bg-card'].toLowerCase());
    }
  });
});
