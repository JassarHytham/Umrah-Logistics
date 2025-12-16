export interface LogisticsRow {
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
  [key: string]: string | number; // Index signature for dynamic access
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

// Global declaration for SheetJS loaded via CDN
declare global {
  interface Window {
    XLSX: any;
  }
}