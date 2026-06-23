
export type TripStatus = 'Planned' | 'Confirmed' | 'Driver Assigned' | 'In Progress' | 'Completed' | 'Delayed' | 'Cancelled' | 'Uncompleted';

export type NoteHighlightColor = 'amber' | 'yellow' | 'blue' | 'green' | 'pink' | 'purple';

export interface SharedMetadata {
  shared: boolean;
  ownerUsername?: string;
  scope?: 'row' | 'group';
  role?: ShareRole;
  deletedByUsername?: string;
  deletedAt?: string;
}

export type ShareRole = 'viewer' | 'editor';

export interface ShareAccessGrant {
  scopeType: 'row' | 'group';
  rowId?: string;
  groupNo?: string;
  userId: number;
  username: string;
  role: ShareRole;
  rowSummary?: string;
  createdAt: string;
}

export interface LogisticsRow {
  id: string;
  groupNo: string;
  groupName: string;
  agency: string;
  count: string;
  Column1: string; // Movement type (Arrival, Departure, etc.)
  date: string;
  time: string;
  flight: string;
  from: string;
  to: string;
  carType: string;
  tafweej: string; // Description
  status: TripStatus;
  notes?: string;
  _sharing?: SharedMetadata;
  [key: string]: string | number | SharedMetadata | undefined; // Index signature for dynamic access
  _originalIndex?: number;
  _version?: number;
}

export interface TelegramConfig {
  token: string;
  chatId: string;
  enabled: boolean;
  botName?: string;
}

export interface LogisticsTemplate {
  id: string;
  name: string;
  data: Partial<LogisticsRow>;
}

export interface GroupInfo {
  groupNo: string;
  groupName: string;
  agency?: string;
  count: string;
}

export interface InputState extends GroupInfo {
  text: string;
}

export interface NotificationState {
  msg: string;
  type: 'success' | 'error';
}

export interface ShareInvitation {
  id: number;
  senderUsername: string;
  scopeType: 'row' | 'group';
  rowId?: string;
  groupNo?: string;
  rowSummary?: string;
  role?: ShareRole;
  createdAt: string;
}

export interface BotMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface AlertSettings {
  arrivalMinutes: number;       // default 120
  departureMinutes: number;     // default 60
  messageFields: {
    flight: boolean;
    carType: boolean;
    count: boolean;
    tafweej: boolean;
  };
}

export interface PreviewSettings {
  requiredFields: string[];     // field keys that highlight red in preview
  defaultStatus: TripStatus;   // status assigned to new empty rows
}

export const DEFAULT_COLUMN_ORDER: string[] = [
  'status', 'groupNo', 'groupName', 'agency', 'Column1', 'tafweej',
  'carType', 'from', 'to', 'time', 'flight', 'date', 'count',
  'notes', 'actions',
];

export const COLUMN_LABELS: Record<string, string> = {
  status:    'الحالة',
  groupNo:   'رقم م',
  groupName: 'اسم المجموعة',
  agency:    'الوكيل',
  Column1:   'الحركة',
  tafweej:   'التفويج',
  carType:   'السيارة',
  from:      'من',
  to:        'إلى',
  time:      'وقت',
  flight:    'رحلة',
  date:      'تاريخ',
  count:     'عدد',
  notes:     'الملاحظات',
  actions:   'إجراءات',
};

export interface DisplaySettings {
  density: 'compact' | 'comfortable';
  tableFontSize: number;                     // default 100 (percent)
  borderStyle: 'thin' | 'medium' | 'thick'; // default 'thin'
  noteHighlightEnabled: boolean;             // default true
  noteHighlightColor: NoteHighlightColor;   // default 'amber'
  wrapCells: boolean;                        // default true
  columnOrder: string[];                    // ordered array of column keys
  hiddenColumns: string[];                  // keys of columns to hide
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  density: 'compact',
  tableFontSize: 100,
  borderStyle: 'thin',
  noteHighlightEnabled: true,
  noteHighlightColor: 'amber',
  wrapCells: true,
  columnOrder: DEFAULT_COLUMN_ORDER,
  hiddenColumns: [],
};

export const normalizeDisplaySettings = (settings?: Partial<DisplaySettings> | null): DisplaySettings => {
  const savedOrder = settings?.columnOrder ?? DEFAULT_COLUMN_ORDER;
  const mergedOrder = [...savedOrder];

  for (const key of DEFAULT_COLUMN_ORDER) {
    if (!mergedOrder.includes(key)) {
      const afterGroupName = key === 'agency' ? mergedOrder.indexOf('groupName') : -1;
      if (afterGroupName >= 0) {
        mergedOrder.splice(afterGroupName + 1, 0, key);
      } else {
        mergedOrder.push(key);
      }
    }
  }

  return {
    ...DEFAULT_DISPLAY_SETTINGS,
    ...settings,
    columnOrder: mergedOrder,
    hiddenColumns: settings?.hiddenColumns ?? DEFAULT_DISPLAY_SETTINGS.hiddenColumns,
  };
};

declare global {
  interface Window {
    XLSX: any;
  }
}
