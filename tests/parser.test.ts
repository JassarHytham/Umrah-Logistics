import { describe, it, expect } from 'vitest';
import {
  getCarType,
  formatDate,
  normalizeCity,
  parseDateTime,
  parseItineraryText,
} from '../utils/parser';

// ─────────────────────────────────────────────
// getCarType
// ─────────────────────────────────────────────
describe('getCarType', () => {
  it('returns سيدان for 1 passenger', () => {
    expect(getCarType('1')).toBe('سيدان');
  });

  it('returns سيدان for 4 passengers (boundary)', () => {
    expect(getCarType('4')).toBe('سيدان');
  });

  it('returns جمس for 5 passengers (lower boundary)', () => {
    expect(getCarType('5')).toBe('جمس');
  });

  it('returns جمس for 6 passengers (upper boundary)', () => {
    expect(getCarType('6')).toBe('جمس');
  });

  it('returns باص for 7 passengers (lower boundary)', () => {
    expect(getCarType('7')).toBe('باص');
  });

  it('returns باص for large group (50 passengers)', () => {
    expect(getCarType('50')).toBe('باص');
  });

  it('returns empty string for non-numeric input', () => {
    expect(getCarType('abc')).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(getCarType('')).toBe('');
  });

  it('returns باص for 0 passengers (edge case — 0 falls through to bus)', () => {
    // count=0 is not NaN, not in [1,4], not in [5,6] → returns باص
    // This is a known edge case: 0 passengers still returns باص
    expect(getCarType('0')).toBe('باص');
  });
});

// ─────────────────────────────────────────────
// formatDate
// ─────────────────────────────────────────────
describe('formatDate', () => {
  it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
    expect(formatDate('2024-01-15')).toBe('15/01/2024');
  });

  it('converts YYYY/MM/DD to DD/MM/YYYY', () => {
    expect(formatDate('2024/01/15')).toBe('15/01/2024');
  });

  it('preserves DD/MM/YYYY when day > 12', () => {
    expect(formatDate('15/01/2024')).toBe('15/01/2024');
  });

  it('flips MM/DD/YYYY to DD/MM/YYYY when month > 12 position', () => {
    // 01/15/2024 → month candidate 01 <= 12, day candidate 15 > 12 → flip
    expect(formatDate('01/15/2024')).toBe('15/01/2024');
  });

  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDate('')).toBe('');
  });

  it('returns original string when no date pattern matches', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('pads single-digit day and month', () => {
    expect(formatDate('2024-1-5')).toBe('05/01/2024');
  });
});

// ─────────────────────────────────────────────
// normalizeCity
// ─────────────────────────────────────────────
describe('normalizeCity', () => {
  it('maps "مطار الملك عبد العزيز" to "جدة"', () => {
    expect(normalizeCity('مطار الملك عبد العزيز الدولي')).toBe('جدة');
  });

  it('maps "JED" to "جدة"', () => {
    expect(normalizeCity('JED')).toBe('جدة');
  });

  it('maps "Jeddah" to "جدة"', () => {
    expect(normalizeCity('Jeddah')).toBe('جدة');
  });

  it('maps "MED" to "المدينة المنورة"', () => {
    expect(normalizeCity('MED')).toBe('المدينة المنورة');
  });

  it('maps "مطار الأمير محمد" to "المدينة المنورة"', () => {
    expect(normalizeCity('مطار الأمير محمد بن عبد العزيز')).toBe('المدينة المنورة');
  });

  it('maps "Medina" to "المدينة المنورة"', () => {
    expect(normalizeCity('Medina')).toBe('المدينة المنورة');
  });

  it('maps "Makkah" to "مكة المكرمة"', () => {
    expect(normalizeCity('Makkah')).toBe('مكة المكرمة');
  });

  it('maps "Mecca" to "مكة المكرمة"', () => {
    expect(normalizeCity('Mecca')).toBe('مكة المكرمة');
  });

  it('returns city name as-is when not in map', () => {
    expect(normalizeCity('الرياض')).toBe('الرياض');
  });

  it('returns empty string for null', () => {
    expect(normalizeCity(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeCity(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeCity('')).toBe('');
  });
});

// ─────────────────────────────────────────────
// parseDateTime
// ─────────────────────────────────────────────
describe('parseDateTime', () => {
  it('parses DD/MM/YYYY + HH:MM correctly', () => {
    const result = parseDateTime('15/01/2024', '14:30');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(0); // January = 0
    expect(result!.getDate()).toBe(15);
    expect(result!.getHours()).toBe(14);
    expect(result!.getMinutes()).toBe(30);
  });

  it('parses YYYY-MM-DD + HH:MM correctly', () => {
    const result = parseDateTime('2024-03-20', '09:00');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(2); // March = 2
    expect(result!.getDate()).toBe(20);
    expect(result!.getHours()).toBe(9);
  });

  it('defaults to 00:00 when time is empty string', () => {
    const result = parseDateTime('15/01/2024', '');
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
  });

  it('returns null for empty date string', () => {
    expect(parseDateTime('', '10:00')).toBeNull();
  });

  it('returns null for date with no recognized separator', () => {
    expect(parseDateTime('15012024', '10:00')).toBeNull();
  });

  it('returns null for date with wrong part count', () => {
    expect(parseDateTime('15/01', '10:00')).toBeNull();
  });

  it('returns null when year is ambiguous (2-digit year)', () => {
    // Parts: 15/01/24 → p0=15, p1=1, p2=24 → p2 not > 1000, p0 not > 1000 → null
    expect(parseDateTime('15/01/24', '10:00')).toBeNull();
  });

  it('parses YYYY/MM/DD format correctly', () => {
    const result = parseDateTime('2024/06/10', '08:00');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(5); // June = 5
    expect(result!.getDate()).toBe(10);
  });
});

// ─────────────────────────────────────────────
// parseItineraryText
// ─────────────────────────────────────────────
describe('parseItineraryText', () => {
  const groupInfo = { groupNo: 'G001', groupName: 'مجموعة الأولى', count: '4' };

  const sampleItinerary = `
رحلة الوصول
تاريخ الوصول
15/01/2024
وقت الوصول
14:30
رقم الرحلة
SV123
المطار
مطار الملك عبد العزيز

الوجهة (مكة المكرمة)
15/01/2024

الوجهة (المدينة المنورة)
20/01/2024

رحلة المغادرة
تاريخ المغادرة
25/01/2024
وقت المغادرة
10:00
رقم الرحلة
SV456
المطار
مطار الأمير محمد
`;

  it('returns an array of rows', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('creates an arrival row with Column1 = وصول', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival).toBeDefined();
  });

  it('creates a departure row with Column1 = مغادرة', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const departure = rows.find(r => r.Column1 === 'مغادرة');
    expect(departure).toBeDefined();
  });

  it('creates an inter-city row when destinations differ', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    expect(intercity).toBeDefined();
  });

  it('arrival row has correct airport mapped to city', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.from).toBe('جدة');
  });

  it('departure row has airport mapped to city', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const departure = rows.find(r => r.Column1 === 'مغادرة');
    expect(departure?.to).toBe('المدينة المنورة');
  });

  it('all rows carry group info', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.groupNo).toBe(groupInfo.groupNo);
      expect(row.groupName).toBe(groupInfo.groupName);
      expect(row.count).toBe(groupInfo.count);
    }
  });

  it('all rows carry agency when provided in group info', () => {
    const rows = parseItineraryText(sampleItinerary, { ...groupInfo, agency: 'اميرة ترافيل' });
    for (const row of rows) {
      expect(row.agency).toBe('اميرة ترافيل');
    }
  });

  it('defaults agency to empty string when group info omits it', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.agency).toBe('');
    }
  });

  it('assigns carType سيدان for count=4', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.carType).toBe('سيدان');
    }
  });

  it('assigns status Planned to all parsed rows', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    for (const row of rows) {
      expect(row.status).toBe('Planned');
    }
  });

  it('each row has a unique id', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const ids = rows.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(rows.length);
  });

  it('returns a fallback row for unrecognized text (no Arabic sections)', () => {
    const rows = parseItineraryText('Some random text here that is long enough', groupInfo);
    expect(rows.length).toBe(1);
    expect(rows[0].Column1).toBe('غير محدد');
  });

  it('returns empty array for very short text', () => {
    const rows = parseItineraryText('Hi', groupInfo);
    expect(rows.length).toBe(0);
  });

  it('extracts flight number correctly', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.flight).toBe('SV123');
  });

  it('rendered text capture: ignores unselected land transport option labels when flight numbers exist', () => {
    const renderedText = `
رحلة الوصول
تاريخ الوصول
2026-07-03
وسيلة السفر
Air transport
السفر الجوي
Sea transport
النقل البحري
Land transport
النقل البري
رقم الرحلة
EK-0807
المطار
مطار الامير محمد
وقت الوصول
03:00

الوجهة (المدينة المنورة)
(2026-07-03 - 2026-07-06)
الفنادق
اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر
فندق المدينة هيلتون 2026-07-03 2026-07-06 3 4 1410 ر.س

الوجهة (مكة المكرمة)
(2026-07-06 - 2026-07-10)
الفنادق
اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر
فندق دار التوحيد انتركونتننتال الفندقية 2026-07-06 2026-07-10 4 4 1410 ر.س

رحلة المغادرة
تاريخ المغادرة
2026-07-11
وسيلة السفر
Air transport
السفر الجوي
Sea transport
النقل البحري
Land transport
النقل البري
رقم الرحلة
EK-0802
المطار
مطار الملك عبد العزيز الدولي
وقت المغادرة
04:05
`;
    const rows = parseItineraryText(renderedText, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    const departure = rows.find(r => r.Column1 === 'مغادرة');

    expect(arrival?.flight).toBe('EK-0807');
    expect(arrival?.to).toBe('فندق المدينة هيلتون (المدينة المنورة)');
    expect(intercity?.from).toBe('فندق المدينة هيلتون (المدينة المنورة)');
    expect(intercity?.to).toBe('فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة)');
    expect(departure?.flight).toBe('EK-0802');
    expect(departure?.from).toBe('فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة)');
  });

  it('auto payload capture: parses flattened labels, hotels, flights, times, and enrichment services', () => {
    const autoPayloadText = `معلومات الرحلة ملاحظة: يجب ان يكون البرنامج يوم واحد على الاقل او اكثر (03/07/2026) رحلة الوصول طريقة السفر اختر تاريخ الوصول الذي ستصل فيه إلى المملكة العربية السعودية مع طريقة السفر. هذا التاريخ سيحدد بداية رحلتك. تاريخ الوصول وسيلة السفر السفر الجويالنقل البحريالنقل البري packages.journey قادم من الامارات العربية المتحدة, دبي ذاهب إلى المملكة العربية السعودية, المدينة المنورة رقم الرحلة EK-0807 المطار مطار الامير محمد الخطوط الجوية الخطوط الاماراتية الصالة T1 وقت الوصول 03
00 نوع الرحلة رحلات مجدوله استعراض الرحلات الوجهة (المدينة المنورة) (2026-07-03 - 2026-07-06) الفنادق اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر فندق المدينة هيلتون07/03/202607/06/20263 4 1410 ر.سالخدمات الإثرائية الخدمة نوع الخدمة تاريخ الزيارة الوقت المرشد السعر معرض عمارة المسجد النبويوجهات الإثرائية2026-07-0408:00:0015 ر.س اضف خدمات إضافية الوجهة (مكة المكرمة) (2026-07-06 - 2026-07-10) الفنادق اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر فندق دار التوحيد انتركونتننتال الفندقية07/06/202607/10/20264 4 1410 ر.سالخدمات الإثرائية الخدمة نوع الخدمة تاريخ الزيارة الوقت المرشد السعر متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)وجهات الإثرائية2026-07-0708:00:0015 ر.س اضف خدمات إضافية اضافة محطه للرحلة (11/07/2026) رحلة المغادرة طريقة السفر تاريخ المغادرة سيتم تحديده تلقائيًا بناءً على أخر وجهة. تاريخ المغادرة وسيلة السفر السفر الجويالنقل البحريالنقل البري packages.journey مغادر من المملكة العربية السعودية, جدة ذاهب إلى الامارات العربية المتحدة, دبي رقم الرحلة EK-0802 المطار مطار الملك عبد العزيز الدولي الخطوط الجوية الخطوط الاماراتية الصالة الصالة 1 وقت المغادرة 04
05 نوع الرحلة رحلات مجدوله استعراض الرحلات عودة التالي ملخص معلومات الرحلة مسار الرحلة تاريخ الوصول (السفر الجوي) 3-7-2026 محطات الرحلة المدينة المنورة مكة المكرمة تاريخ المغادرة (السفر الجوي) 11-7-2026`;

    const rows = parseItineraryText(autoPayloadText, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    const firstService = rows.find(r => r.Column1 === 'الخدمات الإثرائية' && r.to.includes('معرض عمارة'));
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    const secondService = rows.find(r => r.Column1 === 'الخدمات الإثرائية' && r.to.includes('متحف السيرة'));
    const departure = rows.find(r => r.Column1 === 'مغادرة');

    expect(rows.filter(r => r.Column1 !== 'غير محدد').length).toBe(5);
    expect(arrival?.flight).toBe('EK-0807');
    expect(arrival?.time).toBe('03:00');
    expect(arrival?.from).toBe('مطار الامير محمد (المدينة المنورة)');
    expect(arrival?.to).toBe('فندق المدينة هيلتون (المدينة المنورة)');
    expect(firstService?.from).toBe('فندق المدينة هيلتون (المدينة المنورة)');
    expect(firstService?.to).toBe('معرض عمارة المسجد النبوي');
    expect(intercity?.from).toBe('فندق المدينة هيلتون (المدينة المنورة)');
    expect(intercity?.to).toBe('فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة)');
    expect(secondService?.from).toBe('فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة)');
    expect(secondService?.to).toBe('متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)');
    expect(departure?.flight).toBe('EK-0802');
    expect(departure?.date).toBe('11/07/2026');
    expect(departure?.time).toBe('04:05');
    expect(departure?.from).toBe('فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة)');
  });

  it('auto payload capture: parses multiple glued enrichment rows with split first time', () => {
    const autoPayloadText = `معلومات الرحلة ملاحظة: يجب ان يكون البرنامج يوم واحد على الاقل او اكثر (20/07/2026) رحلة الوصول طريقة السفر اختر تاريخ الوصول الذي ستصل فيه إلى المملكة العربية السعودية مع طريقة السفر. هذا التاريخ سيحدد بداية رحلتك. تاريخ الوصول وسيلة السفر السفر الجويالنقل البحريالنقل البري packages.journey قادم من كينيا, نيروبي ذاهب إلى المملكة العربية السعودية, جدة رقم الرحلة SV-0434 المطار مطار الملك عبد العزيز الدولي الخطوط الجوية السعوديه الصالة الصالة 1 وقت الوصول 10
40 نوع الرحلة رحلات مجدوله استعراض الرحلات الوجهة (مكة المكرمة) (2026-07-20 - 2026-07-30) الفنادق اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر فندق دار الزهور الفندقية07/20/202607/30/202610 1 3770 ر.سالخدمات الإثرائية الخدمة نوع الخدمة تاريخ الزيارة الوقت المرشد السعر جبل النور وغار حراءمواقع التاريخية2026-07-2105
46:00400 ر.سمتحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)وجهات الإثرائية2026-07-2306:47:00400 ر.سالخدمات الإضافية التفاصيل السعر مزارات مكة200 ر.س اضافة محطه للرحلة (31/07/2026) رحلة المغادرة طريقة السفر تاريخ المغادرة سيتم تحديده تلقائيًا بناءً على أخر وجهة. تاريخ المغادرة وسيلة السفر السفر الجويالنقل البحريالنقل البري packages.journey مغادر من المملكة العربية السعودية, جدة ذاهب إلى كينيا, نيروبي رقم الرحلة SV-0435 المطار مطار الملك عبد العزيز الدولي الخطوط الجوية السعوديه الصالة الصالة 1 وقت المغادرة 01
30 نوع الرحلة رحلات مجدوله استعراض الرحلات عودة التالي ملخص معلومات الرحلة مسار الرحلة تاريخ الوصول (السفر الجوي) 20-7-2026 محطات الرحلة مكة المكرمة تاريخ المغادرة (السفر الجوي) 31-7-2026`;

    const rows = parseItineraryText(autoPayloadText, groupInfo);
    const services = rows.filter(r => r.Column1 === 'الخدمات الإثرائية');

    expect(services).toHaveLength(2);
    expect(services[0].to).toBe('جبل النور وغار حراء');
    expect(services[0].date).toBe('21/07/2026');
    expect(services[0].time).toBe('05:46:00');
    expect(services[1].to).toBe('متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)');
    expect(services[1].date).toBe('23/07/2026');
    expect(services[1].time).toBe('06:47:00');
  });

  it('auto payload capture: parses glued land transport border and time fields', () => {
    const autoPayloadText = `معلومات الرحلة ملاحظة: يجب ان يكون البرنامج يوم واحد على الاقل او اكثر (08/07/2026) رحلة الوصول طريقة السفر اختر تاريخ الوصول الذي ستصل فيه إلى المملكة العربية السعودية مع طريقة السفر. هذا التاريخ سيحدد بداية رحلتك. تاريخ الوصول وسيلة السفر السفر الجويالنقل البحريالنقل البريقادم من (الدولة) *اليمن قادم من (المدينة) *عدنذاهب الى (الدولة) *المملكة العربية السعوديةذاهب الى (المدينة) *مكة المكرمةالمنفذ *منفذ الوديعةوقت الوصول *8
00 ص - 10:00 صنوع الناقل * ناقل داخلي ناقل خارجي شركة النقل * حفظ الوجهة (مكة المكرمة) (2026-07-08 - 2026-07-11) الفنادق اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر شركة فجر النسك لتشغيل الفنادق07/08/202607/11/20263 1 1140 ر.سالخدمات الإثرائية الخدمة نوع الخدمة تاريخ الزيارة الوقت المرشد السعر جبل النور وغار حراءمواقع التاريخية2026-07-0910
29:00عبدالله عبيد30 ر.سمعرض كسوة الكعبةوجهات الإثرائية2026-07-1005:28:00عبدالله عبيد30 ر.سالخدمات الإضافية التفاصيل السعر مزارات20 ر.س اضافة محطه للرحلة (12/07/2026) رحلة المغادرة طريقة السفر تاريخ المغادرة سيتم تحديده تلقائيًا بناءً على أخر وجهة. تاريخ المغادرة وسيلة السفر السفر الجويالنقل البحريالنقل البريذاهب الى (الدولة) *اليمن ذاهب الى (المدينة) *عدنقادم من (الدولة) *المملكة العربية السعوديةقادم من (المدينة) *جدةالمنفذ *منفذ الوديعةوقت المغادرة *6
00 ص - 8:00 صنوع الناقل * ناقل داخلي ناقل خارجي شركة النقل * حفظ عودة التالي ملخص معلومات الرحلة مسار الرحلة تاريخ الوصول (النقل البري) 8-7-2026 محطات الرحلة مكة المكرمة تاريخ المغادرة (النقل البري) 12-7-2026`;

    const rows = parseItineraryText(autoPayloadText, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    const departure = rows.find(r => r.Column1 === 'مغادرة');

    expect(arrival?.flight).toBe('النقل البري');
    expect(arrival?.from).toBe('منفذ الوديعة');
    expect(arrival?.to).toBe('شركة فجر النسك لتشغيل الفنادق (مكة المكرمة)');
    expect(arrival?.time).toBe('08:00');
    expect(departure?.flight).toBe('النقل البري');
    expect(departure?.from).toBe('شركة فجر النسك لتشغيل الفنادق (مكة المكرمة)');
    expect(departure?.to).toBe('منفذ الوديعة');
    expect(departure?.time).toBe('06:00');
  });

  it('auto payload capture: extracts host names from partial hotel headers in later destinations', () => {
    const autoPayloadText = `معلومات الرحلة ملاحظة: يجب ان يكون البرنامج يوم واحد على الاقل او اكثر
  (14/07/2026) رحلة الوصول طريقة السفر اختر تاريخ الوصول الذي ستصل فيه إلى المملكة العربية السعودية مع طريقة السفر. هذا التاريخ سيحدد بداية رحلتك. تاريخ الوصول وسيلة السفر
  السفر الجويالنقل البحريالنقل البري packages.journey قادم من الامارات العربية المتحدة, ابوظبي ذاهب إلى المملكة العربية السعودية, الرياض رقم الرحلة EY-0551 المطار مطار
  الملك خالد الدولي الخطوط الجوية طيران الاتحاد الصالة الصالة الداخلية وقت الوصول 02
  45 نوع الرحلة رحلات مجدوله استعراض الرحلات الوجهة (مكة المكرمة) (2026-07-14 - 2026-07-17) الفنادق اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة
  السعر فندق اسطورة اعمار الفندقية07/14/202607/17/20263 1 1145 ر.سالخدمات الإثرائية الخدمة نوع الخدمة تاريخ الزيارة الوقت المرشد السعر جبل النور وغار حراءمواقع
  التاريخية2026-07-1506
  01:00هيثم20 ر.س اضف خدمات إضافية الوجهة (جدة) (2026-07-17 - 2026-08-27) الفنادق اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة محسن محمد حسن
  اليزيدي07/17/202608/27/202641 اضف خدمات إثرائية اضف خدمات إضافية اضافة محطه للرحلة (28/08/2026) رحلة المغادرة طريقة السفر تاريخ المغادرة سيتم تحديده تلقائيًا بناءً على أخر
  وجهة. تاريخ المغادرة وسيلة السفر السفر الجويالنقل البحريالنقل البري packages.journey مغادر من المملكة العربية السعودية, جدة ذاهب إلى الامارات العربية المتحدة, ابوظبي رقم
  الرحلة EY-0604 المطار مطار الملك عبد العزيز الدولي الخطوط الجوية طيران الاتحاد الصالة الصالة 1 وقت المغادرة 05
  30 نوع الرحلة رحلات مجدوله استعراض الرحلات عودة التالي ملخص معلومات الرحلة مسار الرحلة تاريخ الوصول (السفر الجوي) 14-7-2026 محطات الرحلة مكة المكرمة جدة تاريخ المغادرة
  (السفر الجوي) 28-8-2026`;

    const rows = parseItineraryText(autoPayloadText, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    const departure = rows.find(r => r.Column1 === 'مغادرة');

    expect(intercity?.to).toBe('محسن محمد حسن اليزيدي (جدة)');
    expect(departure?.from).toBe('محسن محمد حسن اليزيدي (جدة)');
  });

  it('inter-city row uses default time 10:00', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    expect(intercity?.time).toBe('10:00');
  });

  it('inter-city flight is set to "-"', () => {
    const rows = parseItineraryText(sampleItinerary, groupInfo);
    const intercity = rows.find(r => r.Column1 === 'بين المدن');
    expect(intercity?.flight).toBe('-');
  });

  it('parses correctly with bus-sized group (count=15)', () => {
    const bigGroup = { ...groupInfo, count: '15' };
    const rows = parseItineraryText(sampleItinerary, bigGroup);
    for (const row of rows) {
      expect(row.carType).toBe('باص');
    }
  });

  it('does not create inter-city row when destinations are the same', () => {
    const sameDestItinerary = `
رحلة الوصول
تاريخ الوصول
15/01/2024
وقت الوصول
14:30
رقم الرحلة
SV123
المطار
مطار الملك عبد العزيز

الوجهة (مكة المكرمة)
15/01/2024

الوجهة (مكة المكرمة)
20/01/2024

رحلة المغادرة
تاريخ المغادرة
25/01/2024
وقت المغادرة
10:00
رقم الرحلة
SV456
المطار
مطار الملك عبد العزيز
`;
    const rows = parseItineraryText(sameDestItinerary, groupInfo);
    const intercity = rows.filter(r => r.Column1 === 'بين المدن');
    expect(intercity.length).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Hotel name extraction — layout tolerance
// The browser extension's DOM-walk capture serializes each table cell on its
// own line (cell-per-line), unlike the clipboard copy (row-per-line). The hotel
// name must be extracted correctly from BOTH layouts, never a column header.
// ─────────────────────────────────────────────
describe('parseItineraryText — hotel name extraction layouts', () => {
  const groupInfo = { groupNo: 'G009', groupName: 'مجموعة', count: '4' };

  it('cell-per-line capture: extracts the hotel name, not the تاريخ الدخول header', () => {
    const cellPerLine = `
رحلة الوصول
تاريخ الوصول
08/07/2026
المطار
مطار الملك عبد العزيز

الوجهة (مكة المكرمة)
08/07/2026
الفنادق
اسم الفندق/ المستضيف
تاريخ الدخول
تاريخ المغادرة
مدة الاقامة
سعة الغرفة
السعر
شركة فجر النسك لتشغيل الفنادق
07/08/2026
07/13/2026
5
1
1880 ر.س

رحلة المغادرة
تاريخ المغادرة
13/07/2026
المطار
مطار الأمير محمد
`;
    const rows = parseItineraryText(cellPerLine, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.to).toBe('شركة فجر النسك لتشغيل الفنادق (مكة المكرمة)');
  });

  it('row-per-line capture: still extracts the hotel name before the date', () => {
    const rowPerLine = `
رحلة الوصول
تاريخ الوصول
08/07/2026
المطار
مطار الملك عبد العزيز

الوجهة (مكة المكرمة)
08/07/2026
الفنادق
اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر
شركة فجر النسك لتشغيل الفنادق 07/08/2026 07/13/2026 5 1 1880 ر.س

رحلة المغادرة
تاريخ المغادرة
13/07/2026
المطار
مطار الأمير محمد
`;
    const rows = parseItineraryText(rowPerLine, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.to).toBe('شركة فجر النسك لتشغيل الفنادق (مكة المكرمة)');
  });

  it('rendered text capture: extracts hotel name before ISO dates', () => {
    const renderedText = `
رحلة الوصول
تاريخ الوصول
2026-07-03
المطار
مطار الامير محمد

الوجهة (المدينة المنورة)
(2026-07-03 - 2026-07-06)
الفنادق
اسم الفندق/ المستضيف تاريخ الدخول تاريخ المغادرة مدة الاقامة سعة الغرفة السعر
فندق المدينة هيلتون 2026-07-03 2026-07-06 3 4 1410 ر.س

رحلة المغادرة
تاريخ المغادرة
2026-07-11
المطار
مطار الملك عبد العزيز الدولي
`;
    const rows = parseItineraryText(renderedText, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.to).toBe('فندق المدينة هيلتون (المدينة المنورة)');
  });
});

describe('parseItineraryText — enrichment services', () => {
  const groupInfo = { groupNo: 'G010', groupName: 'مجموعة سياحية', agency: 'وكيل النسك', count: '4' };

  it('creates a tourism row from enrichment service table data', () => {
    const text = `
رحلة الوصول
تاريخ الوصول
2026-07-03
وقت الوصول
03:00
رقم الرحلة
EK-0807
المطار
مطار الامير محمد

الوجهة (مكة المكرمة)
(2026-07-06 - 2026-07-10)
الفنادق
اسم الفندق/ المستضيف	تاريخ الدخول	تاريخ المغادرة	مدة الاقامة	سعة الغرفة	السعر
فندق دار التوحيد انتركونتننتال الفندقية	07/06/2026	07/10/2026	4	4	1410 ر.س

الخدمات الإثرائية
الخدمة	نوع الخدمة	تاريخ الزيارة	الوقت	المرشد	السعر
متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)	وجهات الإثرائية	2026-07-07	08:00:00		15 ر.س
اضف خدمات إضافية

رحلة المغادرة
تاريخ المغادرة
2026-07-11
وقت المغادرة
04:05
رقم الرحلة
EK-0802
المطار
مطار الملك عبد العزيز الدولي
`;

    const rows = parseItineraryText(text, groupInfo);
    const tourism = rows.find(r => r.Column1 === 'الخدمات الإثرائية');

    expect(tourism).toMatchObject({
      groupNo: 'G010',
      groupName: 'مجموعة سياحية',
      agency: 'وكيل النسك',
      count: '4',
      Column1: 'الخدمات الإثرائية',
      date: '07/07/2026',
      time: '08:00:00',
      flight: '-',
      from: 'فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة)',
      to: 'متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)',
      carType: 'سيدان',
      tafweej: 'الخدمات الإثرائية — فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة) → متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)',
      status: 'Planned',
    });
  });

  it('creates a tourism row from auto-captured normalized enrichment text', () => {
    const text = `
رحلة الوصول
تاريخ الوصول
2026-07-03
وقت الوصول
03:00
رقم الرحلة
EK-0807
المطار
مطار الامير محمد

الوجهة (مكة المكرمة)
(2026-07-06 - 2026-07-10)
الفنادق
اسم الفندق/ المستضيف
فندق دار التوحيد انتركونتننتال الفندقية
07/06/2026
07/10/2026

الخدمات الاثرائية
الخدمة نوع الخدمة تاريخ الزيارة الوقت المرشد السعر
متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة) وجهات الاثرائية 2026-07-07 08:00:00 15 ر.س

رحلة المغادرة
تاريخ المغادرة
2026-07-11
وقت المغادرة
04:05
رقم الرحلة
EK-0802
المطار
مطار الملك عبد العزيز الدولي
`;

    const rows = parseItineraryText(text, groupInfo);
    const tourism = rows.find(r => r.Column1 === 'الخدمات الإثرائية');

    expect(tourism).toMatchObject({
      date: '07/07/2026',
      time: '08:00:00',
      from: 'فندق دار التوحيد انتركونتننتال الفندقية (مكة المكرمة)',
      to: 'متحف السيرة النبوية والحضارية الإسلامية (برج متحف الساعة)',
    });
  });
});

describe('parseItineraryText — land transport', () => {
  const groupInfo = { groupNo: 'G002', groupName: 'مجموعة برية', count: '4' };

  const landText = `
رحلة الوصول
طريقة السفر
وسيلة السفر
Land transport
النقل البري
قادم من (الدولة) *
قادم من (المدينة) *
ذاهب الى (الدولة) *
ذاهب الى (المدينة) *
المنفذ *
منفذ الوديعة
وقت الوصول *
10:30
نوع الناقل *
شركة النقل *
الوجهة (مكة المكرمة)
(2026-06-25 - 2026-06-28)
الفنادق
اسم الفندق/ المستضيف    تاريخ الدخول    تاريخ المغادرة    مدة الاقامة
شركة فجر النسك لتشغيل الفنادق    06/25/2026    06/28/2026    3

رحلة المغادرة
طريقة السفر
وسيلة السفر
Land transport
النقل البري
المنفذ *
منفذ الوديعة
وقت المغادرة *
14:00
تاريخ المغادرة
2026-09-22
`;

  it('sets flight to النقل البري for arrival', () => {
    const rows = parseItineraryText(landText, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.flight).toBe('النقل البري');
  });

  it('sets from to منفذ الوديعة for arrival', () => {
    const rows = parseItineraryText(landText, groupInfo);
    const arrival = rows.find(r => r.Column1 === 'وصول');
    expect(arrival?.from).toBe('منفذ الوديعة');
  });

  it('sets flight to النقل البري for departure', () => {
    const rows = parseItineraryText(landText, groupInfo);
    const departure = rows.find(r => r.Column1 === 'مغادرة');
    expect(departure?.flight).toBe('النقل البري');
  });

  it('sets to to منفذ الوديعة for departure', () => {
    const rows = parseItineraryText(landText, groupInfo);
    const departure = rows.find(r => r.Column1 === 'مغادرة');
    expect(departure?.to).toBe('منفذ الوديعة');
  });
});
