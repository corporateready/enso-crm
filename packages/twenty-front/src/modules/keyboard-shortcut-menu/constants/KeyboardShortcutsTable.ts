import {
  type Shortcut,
  ShortcutType,
} from '@/keyboard-shortcut-menu/types/Shortcut';

export const KEYBOARD_SHORTCUTS_TABLE: Shortcut[] = [
  {
    label: 'Move right',
    type: ShortcutType.Table,
    firstHotKey: '→',
    areSimultaneous: true,
  },
  {
    label: 'Move left',
    type: ShortcutType.Table,
    firstHotKey: '←',
    areSimultaneous: true,
  },
  {
    label: 'Clear selection',
    type: ShortcutType.Table,
    firstHotKey: 'esc',
    areSimultaneous: true,
  },
  {
    label: 'Open hovered record in side panel',
    type: ShortcutType.Table,
    firstHotKey: 'Space',
    areSimultaneous: true,
  },
  {
    label: 'Open hovered record in full page',
    type: ShortcutType.Table,
    firstHotKey: '⌥',
    secondHotKey: 'Space',
    areSimultaneous: true,
  },
  {
    label: 'Open record in full page',
    type: ShortcutType.Table,
    firstHotKey: '⌥',
    secondHotKey: 'Click',
    areSimultaneous: true,
  },
  {
    label: 'Hide side panel',
    type: ShortcutType.Table,
    firstHotKey: 'Space',
    areSimultaneous: true,
  },
  {
    label: 'Open side panel record in full page',
    type: ShortcutType.Table,
    firstHotKey: '⌥',
    secondHotKey: 'Space',
    areSimultaneous: true,
  },
  {
    label: 'Go back from record page',
    type: ShortcutType.Table,
    firstHotKey: 'Space',
    areSimultaneous: true,
  },
];
