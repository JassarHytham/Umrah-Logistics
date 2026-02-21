
export type TripStatus = 'Planned' | 'Confirmed' | 'Driver Assigned' | 'In Progress' | 'Completed' | 'Delayed' | 'Cancelled';

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

declare global {
  interface Window {
    XLSX: any;
  }
}
