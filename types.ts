
export type TripStatus = 'Planned' | 'Confirmed' | 'Driver Assigned' | 'In Progress' | 'Completed' | 'Delayed' | 'Cancelled' | 'Uncompleted';

export type NoteHighlightColor = 'amber' | 'yellow' | 'blue' | 'green' | 'pink' | 'purple';

export interface LogisticsRow {
  id: string;
  groupNo: string;
  groupName: string;
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
  [key: string]: string | number | undefined; // Index signature for dynamic access
  _originalIndex?: number;
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
  count: string;
}

export interface InputState extends GroupInfo {
  text: string;
}

export interface NotificationState {
  msg: string;
  type: 'success' | 'error';
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

export interface DisplaySettings {
  density: 'compact' | 'comfortable';
  tableFontSize: number;                     // default 100 (percent)
  borderStyle: 'thin' | 'medium' | 'thick'; // default 'thin'
  noteHighlightEnabled: boolean;             // default true
  noteHighlightColor: NoteHighlightColor;   // default 'amber'
  wrapCells: boolean;                        // default true
}

declare global {
  interface Window {
    XLSX: any;
  }
}
