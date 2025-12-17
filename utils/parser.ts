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

// Helper ID generator
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
  // Matches 19/12/2025, 2025-12-19, 12-19-2025
  const match = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  
  if (match) {
    if (match[1]) { // YYYY-MM-DD
      return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    } else if (match[4]) { // DD-MM-YYYY usually
      return `${match[6]}-${match[5].padStart(2,'0')}-${match[4].padStart(2,'0')}`;
    }
  }
  return dateStr;
};

const normalizeCity = (text: string | null | undefined): string => {
  if (!text) return "";
  for (const [key, value] of Object.entries(AIRPORT_MAP)) {
    if (text.includes(key)) return value;
  }
  return text.trim();
};

export const parseItineraryText = (text: string, groupInfo: GroupInfo): LogisticsRow[] => {
  const rows: LogisticsRow[] = [];
  const carType = getCarType(groupInfo.count);
  
  const dateRegex = /(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/;
  
  // Temporary storage
  let arrivalSegment: Partial<LogisticsRow> | null = null;
  let departureSegment: Partial<LogisticsRow> | null = null;

  const normalizedText = text;

  // 1. Detect Arrival Block
  const arrivalStartIndex = normalizedText.indexOf("رحلة الوصول");
  
  if (arrivalStartIndex !== -1) {
      const nextSectionIndex = normalizedText.indexOf("رحلة المغادرة", arrivalStartIndex);
      const arrivalContextLimit = nextSectionIndex !== -1 ? nextSectionIndex : normalizedText.length;
      const arrivalBlock = normalizedText.substring(arrivalStartIndex, arrivalContextLimit);

      let arrivalDate = "";
      const dateMatch = arrivalBlock.match(/تاريخ الوصول\s*[\r\n]*\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
      if (dateMatch) {
          arrivalDate = formatDate(dateMatch[1]);
      } else {
          const anyDate = arrivalBlock.match(dateRegex);
          if (anyDate) arrivalDate = formatDate(anyDate[0]);
      }

      let flight = "";
      const flightMatch = arrivalBlock.match(/رقم الرحلة\s*[\r\n]*\s*([A-Z0-9\-]+)/i);
      if (flightMatch) flight = flightMatch[1];

      let time = "";
      const timeMatch = arrivalBlock.match(/وقت الوصول\s*[\r\n]*\s*(\d{1,2}:\d{2})/);
      if (timeMatch) time = timeMatch[1];

      let from = "";
      const airportMatch = arrivalBlock.match(/المطار\s*[\r\n]*\s*([^\r\n]+)/);
      if (airportMatch) {
          from = normalizeCity(airportMatch[1].trim());
      } else {
          const comingFrom = arrivalBlock.match(/(?:قادم من|Coming from)\s*[\r\n]*\s*([^\r\n]+)/);
          if (comingFrom) {
              from = comingFrom[1].split(/[\n\r,]/)[0].trim();
          }
      }

      let to = "";
      const destinationMatch = arrivalBlock.match(/الوجهة\s*\(([^)]+)\)/);
      if (destinationMatch) {
          to = destinationMatch[1].trim();
      } else {
           if (from === "جدة") to = "مكة المكرمة";
           else if (from === "المدينة المنورة") to = "المدينة المنورة";
      }

      arrivalSegment = {
        Column1: "وصول",
        date: arrivalDate,
        time: time,
        flight: flight,
        from: from || "غير محدد",
        to: to || "غير محدد"
      };
  }

  // 2. Detect Departure Block
  const departureStartIndex = normalizedText.indexOf("رحلة المغادرة");
  if (departureStartIndex !== -1) {
    const departureBlock = normalizedText.substring(departureStartIndex);
    
    let departureDate = "";
    const dateMatch = departureBlock.match(/تاريخ المغادرة\s*[\r\n]*\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
    const headerDate = departureBlock.match(/\((\d{1,2}\/\d{1,2}\/\d{4})\)/);

    if (dateMatch) departureDate = formatDate(dateMatch[1]);
    else if (headerDate) departureDate = formatDate(headerDate[1]);
    else {
         const anyDate = departureBlock.match(dateRegex);
         if (anyDate) departureDate = formatDate(anyDate[0]);
    }

    let flight = "";
    const flightMatch = departureBlock.match(/رقم الرحلة\s*[\r\n]*\s*([A-Z0-9\-]+)/i);
    if (flightMatch) flight = flightMatch[1];

    let time = "";
    const timeMatch = departureBlock.match(/وقت المغادرة\s*[\r\n]*\s*(\d{1,2}:\d{2})/);
    if (timeMatch) time = timeMatch[1];

    let to = "";
    const airportMatch = departureBlock.match(/المطار\s*[\r\n]*\s*([^\r\n]+)/);
    if (airportMatch) {
        to = normalizeCity(airportMatch[1].trim());
    } else {
        if (departureBlock.includes("جدة") || departureBlock.includes("Jeddah")) to = "جدة";
        else if (departureBlock.includes("المدينة")) to = "المدينة المنورة";
    }

    let from = "";
    if (to === "جدة") from = "مكة المكرمة";
    else if (to === "المدينة المنورة") from = "المدينة المنورة";
    
    if (!from) from = "غير محدد";

    departureSegment = {
      Column1: "مغادرة",
      date: departureDate,
      time: time,
      flight: flight,
      from: from,
      to: to || "غير محدد"
    };
  }

  // 3. Construct Final Rows
  if (arrivalSegment) {
    rows.push({
      id: uid(),
      ...groupInfo,
      ...(arrivalSegment as LogisticsRow),
      carType,
      tafweej: "لا",
      status: 'Planned'
    });
  }

  // Inter-city Logic
  if (arrivalSegment && departureSegment) {
    if (arrivalSegment.to === "المدينة المنورة" && departureSegment.to === "جدة") {
      let interCityDate = "";
      // Try to find date associated with Makkah destination
      const makkahBlockMatch = normalizedText.match(/الوجهة\s*\(مكة المكرمة\)\s*\(([\d-]{10})/);
      if (makkahBlockMatch) {
          interCityDate = makkahBlockMatch[1]; 
      }

      rows.push({
        id: uid(),
        ...groupInfo,
        Column1: "بين المدن",
        date: interCityDate, 
        time: "",
        flight: "",
        from: "المدينة المنورة",
        to: "مكة المكرمة",
        carType,
        tafweej: "لا",
        status: 'Planned'
      });

      // Update departure segment to reflect it comes from Makkah
      departureSegment.from = "مكة المكرمة";
    }
  }

  if (departureSegment) {
    rows.push({
      id: uid(),
      ...groupInfo,
      ...(departureSegment as LogisticsRow),
      carType,
      tafweej: "لا",
      status: 'Planned'
    });
  }

  // Fallback
  if (rows.length === 0 && text.trim().length > 10) {
      rows.push({
          id: uid(),
          ...groupInfo,
          Column1: "غير محدد",
          date: "",
          time: "",
          flight: "",
          from: "?",
          to: "?",
          carType,
          tafweej: "لا",
          status: 'Planned'
      });
  }

  return rows;
};