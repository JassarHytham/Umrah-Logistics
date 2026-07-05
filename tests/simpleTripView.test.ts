import { describe, expect, it } from 'vitest';
import type { LogisticsRow } from '../types';
import { buildSimpleTripSummaries } from '../utils/simpleTripView';

const row = (overrides: Partial<LogisticsRow>): LogisticsRow => ({
  id: overrides.id ?? Math.random().toString(36).slice(2),
  groupNo: overrides.groupNo ?? 'G-1',
  groupName: overrides.groupName ?? 'مجموعة 1',
  agency: overrides.agency ?? 'الوكيل 1',
  count: overrides.count ?? '4',
  Column1: overrides.Column1 ?? 'وصول',
  date: overrides.date ?? '03/07/2026',
  time: overrides.time ?? '10:00',
  flight: overrides.flight ?? '',
  from: overrides.from ?? 'مطار الملك عبد العزيز الدولي (جدة)',
  to: overrides.to ?? 'فندق دار التوحيد (مكة المكرمة)',
  carType: overrides.carType ?? '',
  tafweej: overrides.tafweej ?? '',
  status: overrides.status ?? 'Planned',
  notes: overrides.notes,
});

describe('buildSimpleTripSummaries', () => {
  it('collapses one group into one simple row and ignores enrichment for duration math', () => {
    const rows: LogisticsRow[] = [
      row({
        id: 'arrive-madina',
        groupNo: 'G-42',
        groupName: 'مجموعة الإسراء',
        agency: 'الهدى',
        Column1: 'وصول',
        date: '03/07/2026',
        time: '03:00',
        from: 'مطار الامير محمد (المدينة المنورة)',
        to: 'فندق المدينة هيلتون (المدينة المنورة)',
      }),
      row({
        id: 'service-madina',
        groupNo: 'G-42',
        Column1: 'الخدمات الإثرائية',
        date: '04/07/2026',
        time: '08:00',
        from: 'فندق المدينة هيلتون (المدينة المنورة)',
        to: 'معرض عمارة المسجد النبوي',
      }),
      row({
        id: 'intercity',
        groupNo: 'G-42',
        Column1: 'بين المدن',
        date: '06/07/2026',
        time: '09:00',
        from: 'فندق المدينة هيلتون (المدينة المنورة)',
        to: 'فندق دار التوحيد (مكة المكرمة)',
      }),
      row({
        id: 'depart',
        groupNo: 'G-42',
        Column1: 'مغادرة',
        date: '10/07/2026',
        time: '04:05',
        from: 'فندق دار التوحيد (مكة المكرمة)',
        to: 'مطار الملك عبد العزيز الدولي (جدة)',
      }),
    ];

    const summaries = buildSimpleTripSummaries(rows);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      groupNo: 'G-42',
      groupName: 'مجموعة الإسراء',
      agency: 'الهدى',
      entryDate: '03/07/2026',
      leavingDate: '10/07/2026',
      madinaHotel: 'فندق المدينة هيلتون (المدينة المنورة)',
      madinaDuration: '3',
      meccaHotel: 'فندق دار التوحيد (مكة المكرمة)',
      meccaDuration: '4',
    });
    expect(summaries[0].itinerary.map(item => item.id)).toEqual([
      'arrive-madina',
      'service-madina',
      'intercity',
      'depart',
    ]);
  });

  it('uses departure when there is no later intercity row out of Mecca', () => {
    const summaries = buildSimpleTripSummaries([
      row({
        id: 'arrive-mecca',
        groupNo: 'G-7',
        Column1: 'وصول',
        date: '01/08/2026',
        time: '12:00',
        from: 'مطار الملك عبد العزيز الدولي (جدة)',
        to: 'فندق زمزم بولمان (مكة المكرمة)',
      }),
      row({
        id: 'depart-mecca',
        groupNo: 'G-7',
        Column1: 'مغادرة',
        date: '05/08/2026',
        time: '19:00',
        from: 'فندق زمزم بولمان (مكة المكرمة)',
        to: 'مطار الملك عبد العزيز الدولي (جدة)',
      }),
    ]);

    expect(summaries[0].meccaHotel).toBe('فندق زمزم بولمان (مكة المكرمة)');
    expect(summaries[0].meccaDuration).toBe('4');
    expect(summaries[0].madinaHotel).toBe('-');
    expect(summaries[0].madinaDuration).toBe('-');
  });

  it('does not treat parenthesized airports or generic city text as a hotel stay', () => {
    const summaries = buildSimpleTripSummaries([
      row({
        id: 'arrive-mecca',
        groupNo: 'G-8',
        Column1: 'وصول',
        date: '01/09/2026',
        time: '09:30',
        from: 'مطار الملك عبد العزيز الدولي (جدة)',
        to: 'فندق زمزم بولمان (مكة المكرمة)',
      }),
      row({
        id: 'generic-city-text',
        groupNo: 'G-8',
        Column1: 'تنقل',
        date: '02/09/2026',
        time: '08:15',
        from: 'فندق زمزم بولمان (مكة المكرمة)',
        to: 'مركز مدينة المعرفة الاقتصادية (الرياض)',
      }),
      row({
        id: 'depart-mecca',
        groupNo: 'G-8',
        Column1: 'مغادرة',
        date: '03/09/2026',
        time: '18:00',
        from: 'فندق زمزم بولمان (مكة المكرمة)',
        to: 'مطار الملك عبد العزيز الدولي (جدة)',
      }),
    ]);

    expect(summaries[0].madinaHotel).toBe('-');
    expect(summaries[0].madinaDuration).toBe('-');
    expect(summaries[0].meccaHotel).toBe('فندق زمزم بولمان (مكة المكرمة)');
    expect(summaries[0].meccaDuration).toBe('2');
  });

  it('does not use a parenthesized airport as the hotel for Madina stays', () => {
    const summaries = buildSimpleTripSummaries([
      row({
        id: 'arrive-madina-airport',
        groupNo: 'G-9',
        Column1: 'وصول',
        date: '01/10/2026',
        time: '09:30',
        from: 'مطار الملك عبد العزيز الدولي (جدة)',
        to: 'مطار الامير محمد (المدينة المنورة)',
      }),
      row({
        id: 'depart-madina-airport',
        groupNo: 'G-9',
        Column1: 'مغادرة',
        date: '04/10/2026',
        time: '18:00',
        from: 'مطار الامير محمد (المدينة المنورة)',
        to: 'مطار الملك عبد العزيز الدولي (جدة)',
      }),
    ]);

    expect(summaries[0].madinaHotel).toBe('-');
    expect(summaries[0].madinaDuration).toBe('3');
  });

  it('finds the hotel later in the same-city chain after an airport arrival', () => {
    const summaries = buildSimpleTripSummaries([
      row({
        id: 'arrive-airport',
        groupNo: 'G-10',
        Column1: 'وصول',
        date: '01/11/2026',
        time: '09:30',
        from: 'مطار الملك عبد العزيز الدولي (جدة)',
        to: 'مطار الامير محمد (المدينة المنورة)',
      }),
      row({
        id: 'transfer-to-hotel',
        groupNo: 'G-10',
        Column1: 'نقل داخلي',
        date: '01/11/2026',
        time: '11:00',
        from: 'مطار الامير محمد (المدينة المنورة)',
        to: 'فندق المدينة هيلتون (المدينة المنورة)',
      }),
      row({
        id: 'depart-city',
        groupNo: 'G-10',
        Column1: 'مغادرة',
        date: '04/11/2026',
        time: '18:00',
        from: 'فندق المدينة هيلتون (المدينة المنورة)',
        to: 'مطار الملك عبد العزيز الدولي (جدة)',
      }),
    ]);

    expect(summaries[0].madinaHotel).toBe('فندق المدينة هيلتون (المدينة المنورة)');
    expect(summaries[0].madinaDuration).toBe('3');
  });
});
