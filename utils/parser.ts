
import { GroupInfo, LogisticsRow } from '../types';

const AIRPORT_MAP: Record<string, string> = {
  "مطار الملك عبد العزيز": "جدة",
  "مطار الملك عبدالعزيز": "جدة",
  "King Abdulaziz": "جدة",
  "JED": "جدة",
  "مطار الأمير محمد": "المدينة المنورة",
  "مطار الامير محمد": "المدينة المنورة",
  "Prince Mohammed": "المدينة المنورة",
  "MED": "المدينة المنورة",
  "مطار الطائف": "الطائف",
  "Jeddah": "جدة",
  "Madinah": "المدينة المنورة",
  "Medina": "المدينة المنورة",
  "Makkah": "مكة المكرمة",
  "Mecca": "مكة المكرمة",
  "Cairo": "القاهرة"
};

const CAR_TYPES = {
  SEDAN: "سيدان",
  GMC: "جمس",
  BUS: "باص"
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

const getCarType = (count: string): string => {
  const num = parseInt(count, 10);
  if (isNaN(num)) return "";
  if (num >= 1 && num <= 4) return CAR_TYPES.SEDAN;
  if (num >= 5 && num <= 6) return CAR_TYPES.GMC;
  return CAR_TYPES.BUS;
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "";
  const match = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[-/](\d{1,2})[-/](\d{4})|(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  
  if (match) {
    if (match[1]) { // YYYY-MM-DD
      return `${match[3].padStart(2,'0')}/${match[2].padStart(2,'0')}/${match[1]}`;
    } else if (match[4]) { // DD-MM-YYYY or MM-DD-YYYY
      const n1 = parseInt(match[4]);
      const n2 = parseInt(match[5]);
      if (n1 > 12) return `${match[4].padStart(2,'0')}/${match[5].padStart(2,'0')}/${match[6]}`;
      if (n2 > 12) return `${match[5].padStart(2,'0')}/${match[4].padStart(2,'0')}/${match[6]}`;
      return `${match[4].padStart(2,'0')}/${match[5].padStart(2,'0')}/${match[6]}`;
    }
  }
  return dateStr;
};

const normalizeCity = (text: string | null | undefined): string => {
  if (!text) return "";
  const t = text.trim();
  for (const [key, value] of Object.entries(AIRPORT_MAP)) {
    if (t.includes(key)) return value;
  }
  return t;
};

export const parseDateTime = (dateStr: string, timeStr: string) => {
  if (!dateStr) return null;
  const cleanDate = dateStr.trim();
  const cleanTime = (timeStr || "00:00").trim();
  
  try {
    let d: number, m: number, y: number;
    let parts: string[] = [];
    
    if (cleanDate.includes('/')) parts = cleanDate.split('/');
    else if (cleanDate.includes('-')) parts = cleanDate.split('-');
    else return null;

    if (parts.length !== 3) return null;

    const p0 = parseInt(parts[0]);
    const p1 = parseInt(parts[1]);
    const p2 = parseInt(parts[2]);

    if (p0 > 1000) { // YYYY/MM/DD or YYYY-MM-DD
      y = p0; m = p1; d = p2;
    } else if (p2 > 1000) { // DD/MM/YYYY or MM/DD/YYYY
      y = p2;
      // We assume DD/MM/YYYY as per app standard, but if p0 > 12 it must be DD
      d = p0; m = p1;
    } else {
      return null;
    }
    
    let h = 0, min = 0;
    if (cleanTime.includes(':')) {
      const tParts = cleanTime.split(':').map(Number);
      h = tParts[0] || 0;
      min = tParts[1] || 0;
    }
    
    if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(h) || isNaN(min)) return null;
    return new Date(y, m - 1, d, h, min);
  } catch { return null; }
};

export const parseItineraryText = (text: string, groupInfo: GroupInfo): LogisticsRow[] => {
  const rows: LogisticsRow[] = [];
  const carType = getCarType(groupInfo.count);
  
  // Extract Destination Blocks
  const destBlocks: { city: string; startDate: string; index: number }[] = [];
  const destRegex = /الوجهة\s*\(([^)]+)\)/g;
  let match;
  while ((match = destRegex.exec(text)) !== null) {
      const city = match[1].trim();
      const searchStart = match.index;
      const searchEnd = text.indexOf("الوجهة", searchStart + 1);
      const blockText = text.substring(searchStart, searchEnd === -1 ? text.length : searchEnd);
      const dateMatch = blockText.match(/(\d{1,2}\/\d{1,2}\/\d{4})|(\d{4}-\d{1,2}-\d{1,2})/);
      const startDate = dateMatch ? formatDate(dateMatch[0]) : "";
      destBlocks.push({ city, startDate, index: match.index });
  }

  const findFlight = (block: string) => {
    // Priority 1: Labeled flight number
    const labeledMatch = block.match(/رقم الرحلة\s*[\r\n:]*\s*([A-Z0-9]{2,}\s?\d{3,})/i);
    if (labeledMatch) return labeledMatch[1].trim();
    // Priority 2: Standard airline codes (SV, TK, MS, EK, etc.) followed by numbers
    const patternMatch = block.match(/\b(SV|TK|MS|EK|QR|AI|KU|WY|RJ|ME|PA|EY|FZ|XY|G9)\s?\d{3,}\b/i);
    return patternMatch ? patternMatch[0].trim() : "-";
  };

  // Parse Arrival
  let arrivalData: Partial<LogisticsRow> | null = null;
  const arrivalIndex = text.indexOf("رحلة الوصول");
  if (arrivalIndex !== -1) {
      const block = text.substring(arrivalIndex, text.indexOf("رحلة المغادرة", arrivalIndex) === -1 ? text.length : text.indexOf("رحلة المغادرة", arrivalIndex));
      const dateMatch = block.match(/تاريخ الوصول\s*[\r\n]*\s*([\d-/]{8,10})/) || block.match(/(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\/\d{1,2}\/\d{4})/);
      const timeMatch = block.match(/وقت الوصول\s*[\r\n]*\s*(\d{1,2}:\d{2})/);
      const airportMatch = block.match(/المطار\s*[\r\n]*\s*([^\r\n]+)/);

      arrivalData = {
          Column1: "وصول",
          date: dateMatch ? formatDate(dateMatch[0]) : (destBlocks[0]?.startDate || ""),
          time: timeMatch ? timeMatch[1] : "",
          flight: findFlight(block),
          from: airportMatch ? normalizeCity(airportMatch[1]) : "جدة",
          to: destBlocks[0]?.city || "مكة المكرمة"
      };
  }

  // Parse Departure
  let departureData: Partial<LogisticsRow> | null = null;
  const departureIndex = text.indexOf("رحلة المغادرة");
  if (departureIndex !== -1) {
      const block = text.substring(departureIndex);
      const dateMatch = block.match(/تاريخ المغادرة\s*[\r\n]*\s*([\d-/]{8,10})/) || block.match(/(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\/\d{1,2}\/\d{4})/);
      const timeMatch = block.match(/وقت المغادرة\s*[\r\n]*\s*(\d{1,2}:\d{2})/);
      const airportMatch = block.match(/المطار\s*[\r\n]*\s*([^\r\n]+)/);

      departureData = {
          Column1: "مغادرة",
          date: dateMatch ? formatDate(dateMatch[0]) : "",
          time: timeMatch ? timeMatch[1] : "",
          flight: findFlight(block),
          to: airportMatch ? normalizeCity(airportMatch[1]) : "جدة",
          from: destBlocks[destBlocks.length - 1]?.city || "مكة المكرمة"
      };
  }

  if (arrivalData) {
      rows.push({
          ...groupInfo,
          ...(arrivalData as any),
          id: uid(),
          carType,
          tafweej: `${arrivalData.Column1} — ${arrivalData.from} → ${arrivalData.to}`,
          status: 'Planned'
      } as LogisticsRow);
  }

  for (let i = 0; i < destBlocks.length - 1; i++) {
      const fromCity = destBlocks[i].city;
      const toCity = destBlocks[i+1].city;
      if (fromCity !== toCity) {
          rows.push({
              id: uid(),
              ...groupInfo,
              Column1: "بين المدن",
              date: destBlocks[i+1].startDate,
              time: "10:00",
              flight: "-",
              from: fromCity,
              to: toCity,
              carType,
              tafweej: `بين المدن — ${fromCity} → ${toCity}`,
              status: 'Planned'
          });
      }
  }

  if (departureData) {
      rows.push({
          ...groupInfo,
          ...(departureData as any),
          id: uid(),
          carType,
          tafweej: `${departureData.Column1} — ${departureData.from} → ${departureData.to}`,
          status: 'Planned'
      } as LogisticsRow);
  }

  if (rows.length === 0 && text.trim().length > 10) {
      rows.push({
          id: uid(),
          ...groupInfo,
          Column1: "غير محدد",
          date: "", time: "", flight: "", from: "?", to: "?",
          carType, tafweej: "لا", status: 'Planned'
      });
  }

  return rows;
};
