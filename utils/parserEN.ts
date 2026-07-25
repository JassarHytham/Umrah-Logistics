
import { GroupInfo, LogisticsRow } from '../types';
import { formatDate, uid } from './parser';

export const AIRPORT_MAP_EN: Record<string, string> = {
  "King Abdul Aziz International Airport": "Jeddah",
  "King Abdulaziz International Airport": "Jeddah",
  "JED": "Jeddah",
  "Prince Mohammed Bin Abdulaziz Airport": "Madinah", // UNVERIFIED label text
  "MED": "Madinah",
  "Taif Airport": "Taif", // UNVERIFIED label text
  "Jeddah": "Jeddah",
  "Madinah": "Madinah",
  "Medina": "Madinah",
  "Makkah": "Makkah",
  "Mecca": "Makkah",
  "Cairo": "Cairo",
};

const CAR_TYPES_EN = {
  SEDAN: "Sedan",
  GMC: "GMC",
  BUS: "Bus"
};

export const getCarTypeEN = (count: string): string => {
  const num = parseInt(count, 10);
  if (isNaN(num)) return "";
  if (num >= 1 && num <= 4) return CAR_TYPES_EN.SEDAN;
  if (num >= 5 && num <= 6) return CAR_TYPES_EN.GMC;
  return CAR_TYPES_EN.BUS;
};

export const normalizeCityEN = (text: string | null | undefined): string => {
  if (!text) return "";
  const t = text.trim();
  for (const [key, value] of Object.entries(AIRPORT_MAP_EN)) {
    if (t.includes(key)) return value;
  }
  return t;
};

const formatAirportLabelEN = (rawName: string): string => {
  const name = rawName.trim();
  const city = normalizeCityEN(name);
  if (city && city !== name) return `${name} (${city})`;
  return name;
};

const normalizeFlattenedCaptureEN = (raw: string): string => {
  return String(raw || "").normalize("NFC")
    .replace(/ /g, " ")
    .replace(/[​‌‍⁠﻿]/g, "")
    .replace(/(Air Transport)(Sea Transport)(Land Transport)/g, "$1\n$2\n$3")
    .replace(/(Hotel \/ Host Name\s+Entrance Date\s+Exit Date\s+Duration Of Stay\s+Room Capacity\s+Price)\s+/g, "$1\n")
    .replace(/(Service\s+Service Type\s+Visit Date\s+Time\s+Guide\s+Price)\s+/g, "$1\n")
    .replace(/([^\s\n\d])(\d{1,2}\/\d{1,2}\/\d{4})/g, "$1\n$2")
    .replace(/([^\s\n\d])(\d{4}-\d{1,2}-\d{1,2})/g, "$1\n$2")
    .replace(/(\d{1,2}\/\d{1,2}\/\d{4})(?=\d{1,2}\/\d{1,2}\/\d{4})/g, "$1\n")
    .replace(/(\d{4}-\d{2}-\d{2})(?=\d{1,2}:\d{2})/g, "$1\n")
    .replace(/(\d{4}-\d{2}-\d{2})(\d{1,2})\s*\n\s*(\d{2}:\d{2})/g, "$1\n$2:$3")
    .replace(/(\d{4}-\d{2}-\d{2})(\d{1,2}:\d{2}(?::\d{2})?)/g, "$1\n$2")
    .replace(/(SAR)(?=Enrichment Services|Additional Services|Add trip station|Destination|Departure Journey)/g, "$1\n")
    .replace(/(Trip Information|Arrival Journey|Arrival Date|Type of Trip|packages\.journey|Coming From|Going to|Flight Number|Airport|Airlines|Terminal|Arrival Time|Departure Time|Browse Journeys|Destination\s*\([^)]+\)|Enrichment Services|Additional Services|Add trip station|Departure Journey|Departure Date|Trip Information Summary|Trip Route)/g, "\n$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const parseItineraryTextEN = (text: string, groupInfo: GroupInfo): LogisticsRow[] => {
  text = normalizeFlattenedCaptureEN(text);
  const rows: LogisticsRow[] = [];
  const carType = getCarTypeEN(groupInfo.count);
  const rowGroupInfo = { ...groupInfo, agency: groupInfo.agency || "" };

  // Extract Destination Blocks
  const destBlocks: { city: string; startDate: string; hotel: string; index: number; services: { name: string; date: string; time: string }[] }[] = [];
  const extractEnrichmentServices = (blockText: string): { name: string; date: string; time: string }[] => {
    const services: { name: string; date: string; time: string }[] = [];
    const enrichmentLabel = /Enrichment Services/;
    const enrichmentType = /(?:Historical Sites|Enrichment Destinations)/;
    const cleanServiceName = (raw: string): string => raw
      .replace(new RegExp(`\\s*(?:${enrichmentType.source})\\s*$`), "")
      .replace(/(?:^|\s)\d+\s*SAR\s*/g, "")
      .trim();
    const enrichmentStart = blockText.search(enrichmentLabel);
    if (enrichmentStart === -1) return services;

    const enrichmentText = blockText
      .slice(enrichmentStart)
      .split(/Additional Services|Add trip station|Departure Journey/)[0] || "";
    const lines = enrichmentText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const datePattern = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}/;
    const timePattern = /\d{1,2}:\d{2}(?::\d{2})?/;
    const headerPattern = new RegExp(`^(${enrichmentLabel.source}|Service|Service Type|Visit Date|Time|Guide|Price)$`);
    const typePattern = new RegExp(`^${enrichmentType.source}$`);
    const rowPattern = new RegExp(`([\\s\\S]*?)\\s*(?:${enrichmentType.source})\\s*(${datePattern.source})\\s*(${timePattern.source})`, "g");
    const rowText = lines.filter(line => !headerPattern.test(line)).join("\n");
    let rowMatch;
    while ((rowMatch = rowPattern.exec(rowText)) !== null) {
      const nameCandidates = rowMatch[1].split(/\r?\n/).map(candidate => candidate.trim()).filter(Boolean);
      const serviceName = cleanServiceName(nameCandidates[nameCandidates.length - 1] || rowMatch[1]);
      if (serviceName) {
        services.push({ name: serviceName, date: formatDate(rowMatch[2]), time: rowMatch[3] });
      }
    }
    if (services.length) return services;

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
  const destRegex = /Destination\s*\(([^)]+)\)/g;
  let match;
  while ((match = destRegex.exec(text)) !== null) {
      const city = match[1].trim();
      const searchStart = match.index;
      const nextDestination = text.indexOf("Destination", searchStart + 1);
      const departureStart = text.indexOf("Departure Journey", searchStart);
      const searchEnd = [nextDestination, departureStart].filter(index => index !== -1).sort((a, b) => a - b)[0];
      const blockText = text.substring(searchStart, searchEnd === undefined ? text.length : searchEnd);
      const dateMatch = blockText.match(/(\d{1,2}\/\d{1,2}\/\d{4})|(\d{4}-\d{1,2}-\d{1,2})/);
      const startDate = dateMatch ? formatDate(dateMatch[0]) : "";
      // The hotel name is the first real data cell after the hotel table
      // header. Tolerate flattened captures where header labels and the first
      // hotel/host name may be split across multiple lines.
      const hotelSectionStart = blockText.indexOf("Hotels");
      const hotelSection = (hotelSectionStart === -1 ? "" : blockText.slice(hotelSectionStart + "Hotels".length))
        .split(/Enrichment Services|Additional Services|Add trip station|Destination\s*\(|Departure Journey/)[0];
      const HOTEL_COL_HEADERS = /^(?:(?:Hotel\s*\/\s*Host\s+Name|Entrance\s+Date|Exit\s+Date|Duration\s+Of\s+Stay|Room\s+Capacity|Price)(?:\s+|$))+$/;
      const HOTEL_DATE_CELL = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2}/;
      const LEADING_HOTEL_HEADERS = /^(?:(?:Hotel\s*\/\s*Host\s+Name|Entrance\s+Date|Exit\s+Date|Duration\s+Of\s+Stay|Room\s+Capacity|Price)\s*)+/;
      const HOTEL_VALUE_CELL = /^\d+(?:\s+\d+)*(?:\s*SAR)?$/;
      let hotel = "";
      const hotelParts: string[] = [];
      for (const rawLine of hotelSection.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (HOTEL_COL_HEADERS.test(line)) continue;     // skip leftover column headers (cell-per-line)
        const cleanedLine = line.replace(LEADING_HOTEL_HEADERS, "").trim();
        if (!cleanedLine) continue;
        const dStart = cleanedLine.search(HOTEL_DATE_CELL);
        if (hotelParts.length && (dStart === 0 || HOTEL_VALUE_CELL.test(cleanedLine))) {
          hotel = hotelParts.join(" ");
          break;
        }
        if (dStart === 0) continue;                     // a pure date cell → not the hotel name
        const candidate = (dStart > 0 ? cleanedLine.slice(0, dStart) : cleanedLine)
          .replace(/[\s​-‏‪-‮⁦-⁩﻿]+$/, "")
          .trim();
        if (candidate) hotelParts.push(candidate);
        if (dStart > 0 && hotelParts.length) {
          hotel = hotelParts.join(" ");
          break;
        }
        if (hotelParts.length && HOTEL_DATE_CELL.test(line)) {
          hotel = hotelParts.join(" ");
          break;
        }
      }
      if (!hotel && hotelParts.length) hotel = hotelParts.join(" ");
      destBlocks.push({ city, startDate, hotel, index: match.index, services: extractEnrichmentServices(blockText) });
  }

  const isLandTransport = (block: string): boolean =>
    /Port/.test(block) || /(?:Carrier Type|Transport Company)/.test(block); // UNVERIFIED labels

  const hasLandTransportSummary = (label: "Arrival" | "Departure"): boolean =>
    new RegExp(`${label}\\s+Date\\s*\\([^)]*Land\\s+Transport[^)]*\\)`).test(text); // UNVERIFIED

  const findBorderCrossing = (block: string): string => {
    const inlineMatch = block.match(/Port\s*\*?\s*([\s\S]*?)(?=\s*(?:Arrival Time|Departure Time|Carrier Type|Transport Company|Save|$))/);
    if (inlineMatch) {
      const inline = inlineMatch[1].replace(/\s+/g, " ").trim();
      if (inline) return inline;
    }

    const lines = block.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (/Port/.test(lines[i])) {
        for (let j = i + 1; j < lines.length && j < i + 4; j++) {
          const t = lines[j].trim().replace(/\s*\*\s*$/, "").trim();
          if (!t) continue;
          if (/^(Time|Carrier|Transport|Coming|Going|Air|Sea|Land|Journey)/.test(t)) break;
          if (t.endsWith("*")) continue;
          return t;
        }
        break;
      }
    }
    return "";
  };

  const findFlight = (block: string) => {
    // Priority 1: Labeled flight number - airline codes can be 2-3 alphanumeric
    // characters (e.g. SV, EK, 3T, J4), not just letters, so digits are allowed too.
    const labeledMatch = block.match(/Flight Number\s*[\r\n:]*\s*([A-Z0-9]{2,3}[- ]?\d{2,5})/i);
    if (labeledMatch) return labeledMatch[1].trim().toUpperCase();

    // Priority 2: Standard airline codes or any 2-3 alphanumeric characters followed by numbers
    // Including common codes and a general pattern for others
    const patternMatch = block.match(/\b([A-Z0-9]{2,3}[- ]?\d{2,5})\b/i);
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
    const standard = block.match(new RegExp(`${escapedLabel}\\s*\\*?\\s*[\\r\\n:]*\\s*(\\d{1,2}:\\d{2})(?::\\d{2})?`));
    if (standard) return standard[1];
    const splitColon = block.match(new RegExp(`${escapedLabel}\\s*\\*?\\s*[\\r\\n:]*\\s*(\\d{1,2})\\s*\\n\\s*(\\d{2})`));
    if (splitColon) return `${splitColon[1].padStart(2, "0")}:${splitColon[2]}`;
    return "";
  };

  const DATE_VALUE = /(?:\d{4}[-/]\d{1,2}[-/]\d{1,2})|(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/;
  const findArrivalDate = (block: string, arrivalIndex: number): string => {
      const labeledDate = block.match(new RegExp(`Arrival\\s+Date\\s*[\\r\\n:]*\\s*(${DATE_VALUE.source})`));
      if (labeledDate) return labeledDate[1];

      const summaryDate = text.match(new RegExp(`Arrival\\s+Date\\s*\\([^)]*\\)\\s*(${DATE_VALUE.source})`));
      if (summaryDate) return summaryDate[1];

      const beforeArrival = text.substring(Math.max(0, arrivalIndex - 120), arrivalIndex);
      const introDate = beforeArrival.match(new RegExp(`\\(\\s*(${DATE_VALUE.source})\\s*\\)\\s*$`));
      if (introDate) return introDate[1];

      const beforeDestination = block.split(/Destination\s*\(/)[0] || block;
      const preDestinationDate = beforeDestination.match(DATE_VALUE);
      return preDestinationDate ? preDestinationDate[0] : "";
  };

  // Parse Arrival
  let arrivalData: Partial<LogisticsRow> | null = null;
  const arrivalIndex = text.indexOf("Arrival Journey");
  if (arrivalIndex !== -1) {
      const block = text.substring(arrivalIndex, text.indexOf("Departure Journey", arrivalIndex) === -1 ? text.length : text.indexOf("Departure Journey", arrivalIndex));
      const arrivalDate = findArrivalDate(block, arrivalIndex);
      const arrivalTime = findLabeledTime(block, "Arrival Time");
      const airport = findLabelValue(block, "Airport", ["Airlines", "Terminal", "Arrival Time", "Type of Trip", "Browse Journeys", "Destination"]);

      const firstDest = destBlocks[0];
      const arrivalTo = firstDest?.hotel
          ? `${firstDest.hotel} (${firstDest.city})`
          : (firstDest?.city || "Makkah");
      const landArrival = isLandTransport(block) || hasLandTransportSummary("Arrival");
      const borderArrival = landArrival ? findBorderCrossing(block) : "";
      arrivalData = {
          Column1: "Arrival",
          date: arrivalDate ? formatDate(arrivalDate) : (firstDest?.startDate || ""),
          time: arrivalTime,
          flight: landArrival ? "Land Transport" : findFlight(block),
          from: landArrival
              ? borderArrival
              : (airport ? formatAirportLabelEN(airport) : "Jeddah"),
          to: arrivalTo
      };
  }

  // Parse Departure
  let departureData: Partial<LogisticsRow> | null = null;
  const departureIndex = text.indexOf("Departure Journey");
  if (departureIndex !== -1) {
      const block = text.substring(departureIndex);
      const beforeDeparture = text.substring(Math.max(0, departureIndex - 80), departureIndex);
      const dateMatch =
          block.match(/Departure Date\s*[\r\n]*\s*((?:\d{4}-\d{1,2}-\d{1,2})|(?:\d{1,2}\/\d{1,2}\/\d{4}))/) ||
          beforeDeparture.match(/\((\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2})\)\s*$/) ||
          text.match(/Departure Date\s*\([^)]*\)\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
      const departureTime = findLabeledTime(block, "Departure Time");
      const airport = findLabelValue(block, "Airport", ["Airlines", "Terminal", "Departure Time", "Type of Trip", "Browse Journeys", "Back", "Next", "Trip Information Summary"]);

      const lastDest = destBlocks[destBlocks.length - 1];
      const departureFrom = lastDest?.hotel
          ? `${lastDest.hotel} (${lastDest.city})`
          : (lastDest?.city || "Makkah");
      const landDeparture = isLandTransport(block) || hasLandTransportSummary("Departure");
      const borderDeparture = landDeparture ? findBorderCrossing(block) : "";
      departureData = {
          Column1: "Departure",
          date: dateMatch ? formatDate(dateMatch[1] || dateMatch[0]) : "",
          time: departureTime,
          flight: landDeparture ? "Land Transport" : findFlight(block),
          to: landDeparture
              ? borderDeparture
              : (airport ? formatAirportLabelEN(airport) : "Jeddah"),
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
              Column1: "Enrichment Service",
              date: service.date,
              time: service.time,
              flight: "-",
              from: fromLabel,
              to: service.name,
              carType,
              tafweej: `Enrichment Service — ${fromLabel} → ${service.name}`,
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
              Column1: "Between Cities",
              date: to.startDate,
              time: "10:00",
              flight: "-",
              from: fromLabel,
              to: toLabel,
              carType,
              tafweej: `Between Cities — ${fromLabel} → ${toLabel}`,
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
          Column1: "Unspecified",
          date: "", time: "", flight: "", from: "?", to: "?",
          carType, tafweej: "N/A", status: 'Planned'
      });
  }

  return rows;
};
