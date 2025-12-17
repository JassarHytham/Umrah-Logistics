
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

export interface AviationStackFlight {
  flight_date: string;
  flight_status: string;
  airline: {
    name: string;
    iata: string;
    icao: string;
  };
  flight: {
    number: string;
    iata: string;
    icao: string;
    codeshared?: any;
  };
  departure: {
    airport: string;
    timezone: string;
    iata: string;
    icao: string;
    terminal: string | null;
    gate: string | null;
    delay: number | null;
    scheduled: string;
    estimated: string;
    actual: string | null;
    estimated_runway: string | null;
    actual_runway: string | null;
  };
  arrival: {
    airport: string;
    timezone: string;
    iata: string;
    icao: string;
    terminal: string | null;
    gate: string | null;
    baggage: string | null;
    delay: number | null;
    scheduled: string;
    estimated: string;
    actual: string | null;
    estimated_runway: string | null;
    actual_runway: string | null;
  };
}

// Global declaration for SheetJS loaded via CDN
declare global {
  interface Window {
    XLSX: any;
  }
}
