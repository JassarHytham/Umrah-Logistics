
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

export const getCarType = (count: string): string => {
  const num = parseInt(count, 10);
  if (isNaN(num)) return "";
  if (num >= 1 && num <= 4) return CAR_TYPES.SEDAN;
  if (num >= 5 && num <= 6) return CAR_TYPES.GMC;
  return CAR_TYPES.BUS;
};

export const formatDate = (dateStr: string | null | undefined): string => {
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

export const normalizeCity = (text: string | null | undefined): string => {
  if (!text) return "";
  const t = text.trim();
  for (const [key, value] of Object.entries(AIRPORT_MAP)) {
    if (t.includes(key)) return value;
  }
  return t;
};

const formatAirportLabel = (rawName: string): string => {
  const name = rawName.trim();
  const city = normalizeCity(name);
  if (city && city !== name) return `${name} (${city})`;
  return name;
};

const normalizeFlattenedCapture = (raw: string): string => {
  return String(raw || "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/(السفر الجوي)(النقل البحري)(النقل البري)/g, "$1\n$2\n$3")
    .replace(/(اسم الفندق\/ المستضيف\s+تاريخ الدخول\s+تاريخ المغادرة\s+مدة الاقامة\s+سعة الغرفة\s+السعر)\s+/g, "$1\n")
    .replace(/(الخدمة\s+نوع الخدمة\s+تاريخ الزيارة\s+الوقت\s+المرشد\s+السعر)\s+/g, "$1\n")
    .replace(/([^\s\n\d])(\d{1,2}\/\d{1,2}\/\d{4})/g, "$1\n$2")
    .replace(/([^\s\n\d])(\d{4}-\d{1,2}-\d{1,2})/g, "$1\n$2")
    .replace(/(\d{1,2}\/\d{1,2}\/\d{4})(?=\d{1,2}\/\d{1,2}\/\d{4})/g, "$1\n")
    .replace(/(\d{4}-\d{1,2}-\d{1,2})(?=\d{1,2}:\d{2})/g, "$1\n")
    .replace(/(ر\.س)(?=الخدمات\s+ال[إا]ثرائية|اضف|إضافة|اضافة|الوجهة|رحلة المغادرة)/g, "$1\n")
    .replace(/(معلومات الرحلة|رحلة الوصول|تاريخ الوصول|وسيلة السفر|packages\.journey|قادم من|مغادر من|ذاهب إلى|رقم الرحلة|المطار|الخطوط الجوية|الصالة|وقت الوصول|وقت المغادرة|نوع الرحلة|استعراض الرحلات|الوجهة\s*\([^)]+\)|الخدمات\s+ال[إا]ثرائية|اضف خدمات إضافية|إضافة خدمات إضافية|اضافة خدمات إضافية|اضافة محطه للرحلة|رحلة المغادرة|تاريخ المغادرة|ملخص معلومات الرحلة|مسار الرحلة)/g, "\n$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  text = normalizeFlattenedCapture(text);
  const rows: LogisticsRow[] = [];
  const carType = getCarType(groupInfo.count);
  const rowGroupInfo = { ...groupInfo, agency: groupInfo.agency || "" };
  
  // Extract Destination Blocks
  const destBlocks: { city: string; startDate: string; hotel: string; index: number; services: { name: string; date: string; time: string }[] }[] = [];
  const extractEnrichmentServices = (blockText: string): { name: string; date: string; time: string }[] => {
    const services: { name: string; date: string; time: string }[] = [];
    const enrichmentLabel = /الخدمات\s+ال[إا]ثرائية/;
    const enrichmentType = /(وجهات|خدمات)\s+ال[إا]ثرائية/;
    const cleanServiceName = (raw: string): string => raw
      .replace(new RegExp(`\\s*${enrichmentType.source}\\s*$`), "")
      .trim();
    const enrichmentStart = blockText.search(enrichmentLabel);
    if (enrichmentStart === -1) return services;

    const enrichmentText = blockText
      .slice(enrichmentStart)
      .split(/اضف خدمات إضافية|إضافة خدمات إضافية|اضافة خدمات إضافية|اضافة محطه للرحلة|رحلة المغادرة/)[0] || "";
    const lines = enrichmentText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const datePattern = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}/;
    const timePattern = /\d{1,2}:\d{2}(?::\d{2})?/;
    const headerPattern = new RegExp(`^(${enrichmentLabel.source}|الخدمة|نوع الخدمة|تاريخ الزيارة|الوقت|المرشد|السعر)$`);
    const typePattern = new RegExp(`^${enrichmentType.source}$`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (headerPattern.test(line)) continue;

      const dateMatch = line.match(datePattern);
      const timeMatch = line.match(timePattern);
      if (dateMatch && timeMatch) {
        const cells = line.split(/\t+|\s{2,}/).map(cell => cell.trim()).filter(Boolean);
        const serviceName = cleanServiceName(cells.length > 1 ? cells[0] : line.slice(0, dateMatch.index).trim());
        if (serviceName) {
          services.push({ name: serviceName, date: formatDate(dateMatch[0]), time: timeMatch[0] });
        }
        continue;
      }

      if (datePattern.test(line) && lines[i + 1] && timePattern.test(lines[i + 1])) {
        const serviceName = [...lines.slice(0, i)].reverse().find(candidate =>
          candidate &&
          !headerPattern.test(candidate) &&
          !typePattern.test(candidate) &&
          !datePattern.test(candidate) &&
          !timePattern.test(candidate)
        );
        if (serviceName) {
          services.push({ name: cleanServiceName(serviceName), date: formatDate(line.match(datePattern)![0]), time: lines[i + 1].match(timePattern)![0] });
        }
      }
    }

    return services;
  };
  const destRegex = /الوجهة\s*\(([^)]+)\)/g;
  let match;
  while ((match = destRegex.exec(text)) !== null) {
      const city = match[1].trim();
      const searchStart = match.index;
      const nextDestination = text.indexOf("الوجهة", searchStart + 1);
      const departureStart = text.indexOf("رحلة المغادرة", searchStart);
      const searchEnd = [nextDestination, departureStart].filter(index => index !== -1).sort((a, b) => a - b)[0];
      const blockText = text.substring(searchStart, searchEnd === undefined ? text.length : searchEnd);
      const dateMatch = blockText.match(/(\d{1,2}\/\d{1,2}\/\d{4})|(\d{4}-\d{1,2}-\d{1,2})/);
      const startDate = dateMatch ? formatDate(dateMatch[0]) : "";
      // The hotel name is the first real data cell after the "اسم الفندق"
      // header. Tolerate two capture layouts:
      //   • clipboard / row-per-line: "<hotel>  <date>  <date> ..." on the next line
      //   • DOM walk / cell-per-line: each column header then the hotel on its own line
      const afterHeader = blockText.split(/اسم الفندق[^\r\n]*\r?\n/)[1] || "";
      const HOTEL_COL_HEADERS = /^(?:(?:تاريخ\s+الدخول|تاريخ\s+المغادرة|مدة\s+ال[إا]?قامة|سعة\s+الغرفة|السعر)(?:\s+|$))+$/;
      const HOTEL_DATE_CELL = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2}/;
      let hotel = "";
      for (const rawLine of afterHeader.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/الخدمة|الخدمات/.test(line)) break;        // reached the enrichment table → no hotel row
        if (HOTEL_COL_HEADERS.test(line)) continue;     // skip leftover column headers (cell-per-line)
        const dStart = line.search(HOTEL_DATE_CELL);
        if (dStart === 0) continue;                     // a pure date cell → not the hotel name
        const candidate = (dStart > 0 ? line.slice(0, dStart) : line)
          .replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+$/, "")
          .trim();
        if (candidate) { hotel = candidate; break; }
      }
      destBlocks.push({ city, startDate, hotel, index: match.index, services: extractEnrichmentServices(blockText) });
  }

  const isLandTransport = (block: string): boolean =>
    /المنفذ/.test(block) || /(?:نوع الناقل|شركة النقل)/.test(block);

  const hasLandTransportSummary = (label: "الوصول" | "المغادرة"): boolean =>
    new RegExp(`تاريخ\\s+${label}\\s*\\([^)]*النقل\\s+البري[^)]*\\)`).test(text);

  const findBorderCrossing = (block: string): string => {
    const lines = block.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (/المنفذ/.test(lines[i])) {
        for (let j = i + 1; j < lines.length && j < i + 4; j++) {
          const t = lines[j].trim().replace(/\s*\*\s*$/, "").trim();
          if (!t) continue;
          if (/^(وقت|نوع|شركة|ناقل|قادم|ذاهب|Air|Sea|Land|السفر|رحلة)/.test(t)) break;
          if (t.endsWith("*")) continue;
          return t;
        }
        break;
      }
    }
    return "";
  };

  const findFlight = (block: string) => {
    // Priority 1: Labeled flight number - more flexible regex to include hyphens and various formats
    const labeledMatch = block.match(/رقم الرحلة\s*[\r\n:]*\s*([A-Z]{1,3}[- ]?\d{1,5})/i);
    if (labeledMatch) return labeledMatch[1].trim().toUpperCase();
    
    // Priority 2: Standard airline codes or any 2-3 letters followed by numbers
    // Including common codes and a general pattern for others
    const patternMatch = block.match(/\b([A-Z]{2,3}[- ]?\d{2,5})\b/i);
    if (patternMatch) return patternMatch[0].trim().toUpperCase();
    
    return "-";
  };

  const findLabelValue = (block: string, label: string, stopLabels: string[]): string => {
    const stopPattern = stopLabels.map(stop => stop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const match = block.match(new RegExp(`${label}\\s*[\\r\\n:]*\\s*([\\s\\S]*?)(?=\\s*(?:${stopPattern})|$)`));
    return match ? match[1].replace(/\s+/g, " ").trim() : "";
  };

  const findLabeledTime = (block: string, label: string): string => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const standard = block.match(new RegExp(`${escapedLabel}\\s*[\\r\\n:]*\\s*(\\d{1,2}:\\d{2})(?::\\d{2})?`));
    if (standard) return standard[1];
    const splitColon = block.match(new RegExp(`${escapedLabel}\\s*[\\r\\n:]*\\s*(\\d{1,2})\\s*\\n\\s*(\\d{2})`));
    if (splitColon) return `${splitColon[1].padStart(2, "0")}:${splitColon[2]}`;
    return "";
  };

  // Parse Arrival
  let arrivalData: Partial<LogisticsRow> | null = null;
  const arrivalIndex = text.indexOf("رحلة الوصول");
  if (arrivalIndex !== -1) {
      const block = text.substring(arrivalIndex, text.indexOf("رحلة المغادرة", arrivalIndex) === -1 ? text.length : text.indexOf("رحلة المغادرة", arrivalIndex));
      const dateMatch = block.match(/تاريخ الوصول\s*[\r\n]*\s*([\d-/]{8,10})/) || block.match(/(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\/\d{1,2}\/\d{4})/);
      const arrivalTime = findLabeledTime(block, "وقت الوصول");
      const airport = findLabelValue(block, "المطار", ["الخطوط الجوية", "الصالة", "وقت الوصول", "نوع الرحلة", "استعراض الرحلات", "الوجهة"]);

      const firstDest = destBlocks[0];
      const arrivalTo = firstDest?.hotel
          ? `${firstDest.hotel} (${firstDest.city})`
          : (firstDest?.city || "مكة المكرمة");
      const landArrival = isLandTransport(block) || hasLandTransportSummary("الوصول");
      const borderArrival = landArrival ? findBorderCrossing(block) : "";
      arrivalData = {
          Column1: "وصول",
          date: dateMatch ? formatDate(dateMatch[0]) : (firstDest?.startDate || ""),
          time: arrivalTime,
          flight: landArrival ? "النقل البري" : findFlight(block),
          from: landArrival
              ? borderArrival
              : (airport ? formatAirportLabel(airport) : "جدة"),
          to: arrivalTo
      };
  }

  // Parse Departure
  let departureData: Partial<LogisticsRow> | null = null;
  const departureIndex = text.indexOf("رحلة المغادرة");
  if (departureIndex !== -1) {
      const block = text.substring(departureIndex);
      const beforeDeparture = text.substring(Math.max(0, departureIndex - 80), departureIndex);
      const dateMatch =
          block.match(/تاريخ المغادرة\s*[\r\n]*\s*((?:\d{4}-\d{1,2}-\d{1,2})|(?:\d{1,2}\/\d{1,2}\/\d{4}))/) ||
          beforeDeparture.match(/\((\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2})\)\s*$/) ||
          text.match(/تاريخ المغادرة\s*\([^)]*\)\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
      const departureTime = findLabeledTime(block, "وقت المغادرة");
      const airport = findLabelValue(block, "المطار", ["الخطوط الجوية", "الصالة", "وقت المغادرة", "نوع الرحلة", "استعراض الرحلات", "عودة", "التالي", "ملخص معلومات الرحلة"]);

      const lastDest = destBlocks[destBlocks.length - 1];
      const departureFrom = lastDest?.hotel
          ? `${lastDest.hotel} (${lastDest.city})`
          : (lastDest?.city || "مكة المكرمة");
      const landDeparture = isLandTransport(block) || hasLandTransportSummary("المغادرة");
      const borderDeparture = landDeparture ? findBorderCrossing(block) : "";
      departureData = {
          Column1: "مغادرة",
          date: dateMatch ? formatDate(dateMatch[1] || dateMatch[0]) : "",
          time: departureTime,
          flight: landDeparture ? "النقل البري" : findFlight(block),
          to: landDeparture
              ? borderDeparture
              : (airport ? formatAirportLabel(airport) : "جدة"),
          from: departureFrom
      };
  }

  if (arrivalData) {
      rows.push({
          ...rowGroupInfo,
          ...(arrivalData as any),
          id: uid(),
          carType,
          tafweej: `${arrivalData.Column1} — ${arrivalData.from} → ${arrivalData.to}`,
          status: 'Planned'
      } as LogisticsRow);
  }

  const pushEnrichmentRows = (destination: typeof destBlocks[number]) => {
      const fromLabel = destination.hotel ? `${destination.hotel} (${destination.city})` : destination.city;
      for (const service of destination.services) {
          rows.push({
              id: uid(),
              ...rowGroupInfo,
              Column1: "الخدمات الإثرائية",
              date: service.date,
              time: service.time,
              flight: "-",
              from: fromLabel,
              to: service.name,
              carType,
              tafweej: `الخدمات الإثرائية — ${fromLabel} → ${service.name}`,
              status: 'Planned'
          });
      }
  };

  for (let i = 0; i < destBlocks.length; i++) {
      pushEnrichmentRows(destBlocks[i]);
      if (i >= destBlocks.length - 1) continue;
      const from = destBlocks[i];
      const to = destBlocks[i+1];
      if (from.city !== to.city) {
          const fromLabel = from.hotel ? `${from.hotel} (${from.city})` : from.city;
          const toLabel = to.hotel ? `${to.hotel} (${to.city})` : to.city;
          rows.push({
              id: uid(),
              ...rowGroupInfo,
              Column1: "بين المدن",
              date: to.startDate,
              time: "10:00",
              flight: "-",
              from: fromLabel,
              to: toLabel,
              carType,
              tafweej: `بين المدن — ${fromLabel} → ${toLabel}`,
              status: 'Planned'
          });
      }
  }

  if (departureData) {
      rows.push({
          ...rowGroupInfo,
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
          ...rowGroupInfo,
          Column1: "غير محدد",
          date: "", time: "", flight: "", from: "?", to: "?",
          carType, tafweej: "لا", status: 'Planned'
      });
  }

  return rows;
};
