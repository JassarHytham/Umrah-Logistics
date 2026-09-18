import React, { useMemo, useState } from 'react';
import {
  BarChart3, AlertCircle, TrendingUp, Clock, Calendar, CalendarRange,
  MapPin, Car, ShieldAlert, ArrowUpRight, Users, Layers, Route,
  Building2, ListChecks, ArrowRightLeft, Percent,
  CheckCircle2, AlertTriangle, Info
} from 'lucide-react';
import { LogisticsRow, TripStatus } from '../types';
import { STATUS_CONFIG } from './TableEditor';
import { getLocalDateString } from '../utils/date';
import {
  countUniqueGroups, isDateOnOrAfter, isDateBefore,
  normalizeCityName, buildNormalizedDistribution, buildTopRoutes,
} from '../utils/operationsStats';

interface AnalyticsProps {
  rows: LogisticsRow[];
  onNavigateToTable: (filters?: Record<string, string[]>) => void;
}

// Statuses that mean "someone still needs to act on this" once the trip date has already passed.
// 'Hosting' is deliberately excluded — it can legitimately span multiple days.
const OVERDUE_STATUSES: TripStatus[] = ['Planned', 'Confirmed', 'Driver Assigned', 'In Progress'];

const STATUS_BAR_COLOR: Record<TripStatus, string> = {
  'Planned': 'bg-gray-400',
  'Confirmed': 'bg-blue-500',
  'Driver Assigned': 'bg-indigo-500',
  'In Progress': 'bg-yellow-500',
  'Completed': 'bg-green-500',
  'Delayed': 'bg-orange-500',
  'Cancelled': 'bg-red-500',
  'Uncompleted': 'bg-purple-500',
  'Hosting': 'bg-teal-500',
};

const STATUS_ORDER: TripStatus[] = [
  'Planned', 'Confirmed', 'Driver Assigned', 'In Progress',
  'Completed', 'Delayed', 'Uncompleted', 'Cancelled', 'Hosting',
];

/** Reusable "label + count + percentage bar" list, used by every breakdown section below. */
const DistributionCard: React.FC<{
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconColor: string;
  items: { key: string; label: string; count: number; barColor: string; onClick?: () => void }[];
  total: number;
  emptyText: string;
  limit?: number;
}> = ({ title, icon: Icon, iconColor, items, total, emptyText, limit = 5 }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
      <Icon className={iconColor} size={18} />
      {title}
    </h3>
    <div className="space-y-4">
      {items.length > 0 ? items.slice(0, limit).map(item => {
        const percentage = total > 0 ? (item.count / total) * 100 : 0;
        const inner = (
          <>
            <div className="flex justify-between text-xs mb-1.5 font-bold">
              <span className="text-gray-700 group-hover:text-gray-900 truncate">{item.label}</span>
              <span className="text-gold-600 bg-gold-50 px-2 rounded-full shrink-0">{item.count}</span>
            </div>
            <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100">
              <div className={`h-full ${item.barColor} rounded-full transition-all duration-1000`} style={{ width: `${percentage}%` }}></div>
            </div>
          </>
        );
        return item.onClick ? (
          <button key={item.key} onClick={item.onClick} className="block w-full text-right group">
            {inner}
          </button>
        ) : (
          <div key={item.key}>{inner}</div>
        );
      }) : <p className="text-xs text-gray-400 text-center py-4">{emptyText}</p>}
    </div>
  </div>
);

export const OperationsIntelligence: React.FC<AnalyticsProps> = ({ rows, onNavigateToTable }) => {
  // Use consistent local-time date string
  const todayStr = getLocalDateString();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = getLocalDateString(tomorrowDate);
  const [chartMode, setChartMode] = useState<'days' | 'weeks'>('days');

  // 1. Data Aggregation
  const stats = useMemo(() => {
    const todayRows = rows.filter(r => r.date === todayStr);
    const tomorrowRows = rows.filter(r => r.date === tomorrowStr);
    const delayed = rows.filter(r => r.status === 'Delayed');
    const unassigned = rows.filter(r => r.status === 'Planned');
    const uniqueGroups = countUniqueGroups(rows);

    // Next 7 days including today
    const weekDates = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return getLocalDateString(d);
    });
    const weekDateSet = new Set(weekDates);
    const thisWeekRows = rows.filter(r => weekDateSet.has(String(r.date || '')));

    // High load detection (next 14 days) — uses real chronological comparison, not string sort
    const dailyCounts: Record<string, number> = {};
    rows.forEach(r => {
      if (r.date) {
        const d = String(r.date).trim();
        dailyCounts[d] = (dailyCounts[d] || 0) + 1;
      }
    });

    const highLoadDays = Object.entries(dailyCounts)
      .filter(([date, count]) => (count as number) >= 5 && isDateOnOrAfter(date, todayStr))
      .map(([date]) => date);

    return {
      today: todayRows.length,
      tomorrow: tomorrowRows.length,
      thisWeek: thisWeekRows.length,
      weekDates,
      delayed: delayed.length,
      unassigned: unassigned.length,
      groups: uniqueGroups,
      avgPerGroup: uniqueGroups > 0 ? rows.length / uniqueGroups : 0,
      highLoadCount: highLoadDays.length,
      highLoadDays,
      dailyCounts,
    };
  }, [rows, todayStr, tomorrowStr]);

  // 2. Full status breakdown (all TripStatus values present in the data)
  const statusBreakdown = useMemo(() => {
    const counts: Partial<Record<TripStatus, number>> = {};
    rows.forEach(r => {
      const s = r.status as TripStatus;
      if (s) counts[s] = (counts[s] || 0) + 1;
    });
    return STATUS_ORDER
      .filter(s => (counts[s] || 0) > 0)
      .map(s => ({ status: s, count: counts[s] || 0 }));
  }, [rows]);

  // 3. Movement type breakdown (Column1: وصول / مغادرة / بين المدن)
  const movementBreakdown = useMemo(() => buildNormalizedDistribution(rows, 'Column1'), [rows]);

  // 4. City, vehicle & agency breakdowns — city names normalized so spelling variants don't fragment the chart
  const distributions = useMemo(() => ({
    cities: buildNormalizedDistribution(rows, 'to', normalizeCityName),
    vehicles: buildNormalizedDistribution(rows, 'carType'),
    agencies: buildNormalizedDistribution(rows, 'agency'),
  }), [rows]);

  // 5. Top routes (from → to), also normalized
  const topRoutes = useMemo(() => buildTopRoutes(rows, 5), [rows]);

  // 6. Completion snapshot for trips whose date has already passed
  const completion = useMemo(() => {
    const pastRows = rows.filter(r => isDateBefore(String(r.date || ''), todayStr));
    const completed = pastRows.filter(r => r.status === 'Completed');
    const cancelled = pastRows.filter(r => r.status === 'Cancelled');
    const delayedPast = pastRows.filter(r => r.status === 'Delayed');
    const stillOpen = pastRows.filter(r => OVERDUE_STATUSES.includes(r.status as TripStatus));
    const datesOf = (subset: LogisticsRow[]) => Array.from(new Set(subset.map(r => String(r.date || '')).filter(Boolean)));

    return {
      totalPast: pastRows.length,
      completed: completed.length,
      cancelled: cancelled.length,
      delayedPast: delayedPast.length,
      stillOpen: stillOpen.length,
      rate: pastRows.length > 0 ? Math.round((completed.length / pastRows.length) * 100) : null,
      filters: {
        completed: { date: datesOf(completed), status: ['Completed'] },
        cancelled: { date: datesOf(cancelled), status: ['Cancelled'] },
        delayedPast: { date: datesOf(delayedPast), status: ['Delayed'] },
        stillOpen: { date: datesOf(stillOpen), status: OVERDUE_STATUSES as string[] },
      },
    };
  }, [rows, todayStr]);

  // 7. Risk Alerts
  const alerts = useMemo(() => {
    const list: { id: string, type: 'error' | 'warning' | 'info', msg: string, filter: Record<string, string[]> }[] = [];

    const todayUnconfirmed = rows.filter(r => r.date === todayStr && r.status === 'Planned');
    if (todayUnconfirmed.length > 0) {
      list.push({
        id: 'unconfirmed',
        type: 'error',
        msg: `يوجد ${todayUnconfirmed.length} رحلات اليوم بانتظار التأكيد.`,
        filter: { date: [todayStr], status: ['Planned'] }
      });
    }

    if (completion.stillOpen > 0) {
      list.push({
        id: 'overdue',
        type: 'warning',
        msg: `يوجد ${completion.stillOpen} رحلة من تواريخ سابقة لم يتم تحديث حالتها بعد.`,
        filter: completion.filters.stillOpen,
      });
    }

    const missingFields = rows.filter(r => !r.time || !r.flight || !r.carType);
    if (missingFields.length > 0) {
      list.push({
        id: 'missing',
        type: 'warning',
        msg: `يوجد ${missingFields.length} رحلات تفتقد لبيانات أساسية (وقت، رحلة، سيارة).`,
        filter: {}
      });
    }

    const highLoadDay = Object.entries(stats.dailyCounts).find(([d, c]) => (c as number) >= 8 && isDateOnOrAfter(d, todayStr));
    if (highLoadDay) {
      list.push({
        id: 'spike',
        type: 'info',
        msg: `ضغط عمليات مرتفع (${highLoadDay[1]} رحلة) متوقع يوم ${highLoadDay[0]}.`,
        filter: { date: [highLoadDay[0]] }
      });
    }

    return list.slice(0, 6);
  }, [rows, todayStr, stats, completion]);

  // 8. Load Chart Data — next 10 days, or next 4 weeks aggregated
  const chartDays = useMemo(() => {
    return Array.from({ length: 10 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = getLocalDateString(d);
      return { key: dateStr, label: dateStr === todayStr ? 'اليوم' : dateStr.split('/').slice(0, 2).join('/'), count: stats.dailyCounts[dateStr] || 0, highlight: dateStr === todayStr, filter: { date: [dateStr] } };
    });
  }, [stats, todayStr]);

  const chartWeeks = useMemo(() => {
    const weeks = Array.from({ length: 4 }).map((_, w) => ({ key: String(w), label: w === 0 ? 'هذا الأسبوع' : `+${w} أسبوع`, count: 0, dates: [] as string[] }));
    for (let i = 0; i < 28; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = getLocalDateString(d);
      const weekIdx = Math.floor(i / 7);
      weeks[weekIdx].count += stats.dailyCounts[dateStr] || 0;
      weeks[weekIdx].dates.push(dateStr);
    }
    return weeks.map(w => ({ key: w.key, label: w.label, count: w.count, highlight: w.key === '0', filter: { date: w.dates } }));
  }, [stats]);

  const chartItems = chartMode === 'days' ? chartDays : chartWeeks;
  const chartMax = Math.max(...chartItems.map(c => c.count), 5);

  return (
    <div className="space-y-8 animate-fade-in pb-12" dir="rtl">

      {/* SECTION 1: Executive Snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
        {[
          { label: 'رحلات اليوم', val: stats.today, icon: Clock, color: 'from-gold-600 to-gold-400', onClick: () => onNavigateToTable({ date: [todayStr] }) },
          { label: 'رحلات الغد', val: stats.tomorrow, icon: Calendar, color: 'from-indigo-600 to-indigo-400', onClick: () => onNavigateToTable({ date: [tomorrowStr] }) },
          { label: 'رحلات هذا الأسبوع', val: stats.thisWeek, icon: CalendarRange, color: 'from-cyan-600 to-cyan-400', onClick: () => onNavigateToTable({ date: stats.weekDates }) },
          { label: 'عدد المجموعات', val: stats.groups, icon: Users, color: 'from-violet-600 to-violet-400' },
          { label: 'متوسط الرحلات/مجموعة', val: stats.avgPerGroup.toFixed(1), icon: Layers, color: 'from-sky-600 to-sky-400' },
          { label: 'تأخيرات نشطة', val: stats.delayed, icon: AlertCircle, color: 'from-red-600 to-red-400', urgent: stats.delayed > 0, onClick: () => onNavigateToTable({ status: ['Delayed'] }) },
          { label: 'بانتظار التأكيد', val: stats.unassigned, icon: ShieldAlert, color: 'from-amber-600 to-amber-400', onClick: () => onNavigateToTable({ status: ['Planned'] }) },
          { label: 'أيام ضغط عالٍ', val: stats.highLoadCount, icon: TrendingUp, color: 'from-emerald-600 to-emerald-400', onClick: stats.highLoadDays.length > 0 ? () => onNavigateToTable({ date: stats.highLoadDays }) : undefined },
        ].map((c, i) => {
          const Wrapper = c.onClick ? 'button' : 'div';
          return (
            <Wrapper key={i} onClick={c.onClick} className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 relative overflow-hidden group transition-all hover:shadow-md text-right w-full ${c.onClick ? 'cursor-pointer' : ''}`}>
              <div className={`absolute top-0 right-0 w-1 h-full bg-gradient-to-b ${c.color}`}></div>
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-gray-500 text-[10px] font-bold mb-1">{c.label}</p>
                  <p className="text-3xl font-black text-gray-800 tracking-tight">{c.val}</p>
                </div>
                <div className={`p-2 rounded-xl bg-gray-50 text-gray-400 group-hover:scale-110 transition-transform ${c.urgent ? 'animate-pulse text-red-500 bg-red-50' : ''}`}>
                  <c.icon size={24} />
                </div>
              </div>
            </Wrapper>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* SECTION 2: Daily/Weekly Load Chart */}
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <BarChart3 className="text-gold-500" size={20} />
              تحليل ضغط العمليات
            </h3>
            <div className="flex bg-gray-50 p-1 rounded-lg text-xs font-bold">
              <button onClick={() => setChartMode('days')} className={`px-3 py-1.5 rounded-md transition-all ${chartMode === 'days' ? 'bg-white shadow-sm text-gold-700' : 'text-gray-400'}`}>10 أيام</button>
              <button onClick={() => setChartMode('weeks')} className={`px-3 py-1.5 rounded-md transition-all ${chartMode === 'weeks' ? 'bg-white shadow-sm text-gold-700' : 'text-gray-400'}`}>4 أسابيع</button>
            </div>
          </div>

          <div className="flex items-end justify-between h-48 gap-2 px-2 flex-1">
            {chartItems.map((d) => {
              const height = (d.count / chartMax) * 100;

              let barColor = 'bg-gold-400';
              if (d.count >= 5) barColor = 'bg-amber-400';
              if (d.count >= 8) barColor = 'bg-red-400';

              return (
                <button key={d.key} onClick={() => onNavigateToTable(d.filter)} className="flex-1 flex flex-col items-center group relative h-full">
                   {/* Bar Container acting as Track */}
                   <div className="w-full flex-1 bg-gray-50/50 rounded-t-lg flex flex-col justify-end overflow-hidden mb-2 relative">
                      <div
                        className={`w-full rounded-t-sm transition-all duration-700 ${barColor} ${d.highlight ? 'ring-2 ring-gold-600 ring-offset-1' : 'opacity-80 group-hover:opacity-100'}`}
                        style={{ height: d.count > 0 ? `${height}%` : '2px' }}
                      >
                        {/* Tooltip */}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none shadow-lg">
                          {d.count} رحلة
                        </div>
                      </div>
                   </div>
                  <div className={`text-[10px] font-bold ${chartMode === 'days' ? 'transform -rotate-45 origin-top-right whitespace-nowrap' : ''} mt-1 ${d.highlight ? 'text-gold-700' : 'text-gray-400'}`}>
                    {d.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* SECTION 3: Status Breakdown */}
        <div className="lg:col-span-4 space-y-4">
          <DistributionCard
            title="توزيع الرحلات حسب الحالة"
            icon={ListChecks}
            iconColor="text-gold-500"
            total={rows.length}
            emptyText="لا توجد بيانات حالات"
            limit={9}
            items={statusBreakdown.map(({ status, count }) => ({
              key: status,
              label: STATUS_CONFIG[status]?.label ?? status,
              count,
              barColor: STATUS_BAR_COLOR[status] ?? 'bg-gray-400',
              onClick: () => onNavigateToTable({ status: [status] }),
            }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* SECTION 4: Movement Type */}
        <DistributionCard
          title="نوع الحركة"
          icon={ArrowRightLeft}
          iconColor="text-cyan-500"
          total={rows.length}
          emptyText="لا توجد بيانات حركة"
          items={movementBreakdown.map(g => ({
            key: g.label,
            label: g.label,
            count: g.count,
            barColor: 'bg-cyan-500',
            onClick: () => onNavigateToTable({ Column1: g.rawValues }),
          }))}
        />

        {/* SECTION 5: Destinations */}
        <DistributionCard
          title="توزيع الرحلات حسب الوجهة"
          icon={MapPin}
          iconColor="text-emerald-500"
          total={rows.length}
          emptyText="لا توجد بيانات وجهات"
          items={distributions.cities.map(g => ({
            key: g.label,
            label: g.label,
            count: g.count,
            barColor: 'bg-emerald-500',
            onClick: () => onNavigateToTable({ to: g.rawValues }),
          }))}
        />

        {/* SECTION 6: Vehicles */}
        <DistributionCard
          title="تحليل أنواع المركبات"
          icon={Car}
          iconColor="text-indigo-500"
          total={rows.length}
          emptyText="لا توجد بيانات مركبات"
          items={distributions.vehicles.map(g => ({
            key: g.label,
            label: g.label,
            count: g.count,
            barColor: 'bg-indigo-500',
            onClick: () => onNavigateToTable({ carType: g.rawValues }),
          }))}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* SECTION 7: Top Routes */}
        <DistributionCard
          title="أكثر المسارات تكراراً"
          icon={Route}
          iconColor="text-gold-500"
          total={rows.length}
          emptyText="لا توجد بيانات مسارات"
          items={topRoutes.map(r => ({
            key: `${r.from}->${r.to}`,
            label: `${r.from} ← ${r.to}`,
            count: r.count,
            barColor: 'bg-gold-500',
            onClick: () => onNavigateToTable({ from: r.fromRaw, to: r.toRaw }),
          }))}
        />

        {/* SECTION 8: Agencies */}
        <DistributionCard
          title="توزيع الرحلات حسب الوكيل"
          icon={Building2}
          iconColor="text-fuchsia-500"
          total={rows.length}
          emptyText="لا توجد بيانات وكلاء بعد"
          items={distributions.agencies.map(g => ({
            key: g.label,
            label: g.label,
            count: g.count,
            barColor: 'bg-fuchsia-500',
            onClick: () => onNavigateToTable({ agency: g.rawValues }),
          }))}
        />

        {/* SECTION 9: Completion Snapshot */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
            <Percent className="text-green-500" size={18} />
            نسبة إنجاز الرحلات السابقة
          </h3>
          {completion.totalPast === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">لا توجد رحلات سابقة بعد</p>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-4xl font-black text-gray-800">{completion.rate}%</p>
                <p className="text-[10px] text-gray-400 font-bold">من أصل {completion.totalPast} رحلة سابقة</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <button onClick={() => onNavigateToTable(completion.filters.completed)} className="bg-green-50 rounded-lg py-2 hover:bg-green-100 transition-colors">
                  <p className="text-lg font-black text-green-700">{completion.completed}</p>
                  <p className="text-[9px] font-bold text-green-600">مكتمل</p>
                </button>
                <button onClick={() => onNavigateToTable(completion.filters.stillOpen)} className="bg-amber-50 rounded-lg py-2 hover:bg-amber-100 transition-colors">
                  <p className="text-lg font-black text-amber-700">{completion.stillOpen}</p>
                  <p className="text-[9px] font-bold text-amber-600">بدون تحديث</p>
                </button>
                <button onClick={() => onNavigateToTable(completion.filters.cancelled)} className="bg-red-50 rounded-lg py-2 hover:bg-red-100 transition-colors">
                  <p className="text-lg font-black text-red-700">{completion.cancelled}</p>
                  <p className="text-[9px] font-bold text-red-600">ملغي</p>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 10: Risk & Anomaly Alerts */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
          <ShieldAlert className="text-red-500" size={20} />
          تنبيهات المخاطر التشغيلية
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {alerts.length > 0 ? alerts.map(alert => (
            <button
              key={alert.id}
              onClick={() => onNavigateToTable(alert.filter)}
              className={`flex items-start gap-4 p-4 rounded-xl border transition-all text-right group hover:shadow-md ${
                alert.type === 'error' ? 'bg-red-50 border-red-100 hover:bg-red-100' :
                alert.type === 'warning' ? 'bg-amber-50 border-amber-100 hover:bg-amber-100' :
                'bg-gold-50 border-gold-100 hover:bg-gold-100'
              }`}
            >
              <div className={`mt-0.5 ${
                alert.type === 'error' ? 'text-red-600' :
                alert.type === 'warning' ? 'text-amber-600' :
                'text-gold-600'
              }`}>
                {alert.type === 'error' ? <AlertCircle size={20} /> :
                 alert.type === 'warning' ? <AlertTriangle size={20} /> : <Info size={20} />}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-800 mb-1">{alert.msg}</p>
                <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400 group-hover:text-gray-600">
                  <span>انقر للتصفية في الجدول</span>
                  <ArrowUpRight size={10} />
                </div>
              </div>
            </button>
          )) : (
            <div className="col-span-full py-8 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
               <CheckCircle2 size={40} className="text-emerald-500 mb-3 opacity-20" />
               <p className="font-bold">جميع العمليات مستقرة حالياً</p>
            </div>
          )}
        </div>
      </div>

      {/* FOOTER INSIGHT */}
      <div className="flex flex-wrap justify-center gap-3">
         <div className="bg-slate-800 text-white px-6 py-2.5 rounded-full text-xs font-bold flex items-center gap-3 shadow-xl">
            <TrendingUp size={14} className="text-emerald-400" />
            <span>الوجهة الأكثر طلباً: <span className="text-emerald-300">{distributions.cities[0]?.label || '---'}</span></span>
            <div className="w-px h-3 bg-white/20"></div>
            <span>الأسطول الأكثر طلباً: <span className="text-gold-300">{distributions.vehicles[0]?.label || '---'}</span></span>
            {topRoutes[0] && (
              <>
                <div className="w-px h-3 bg-white/20"></div>
                <span>الأكثر تكراراً: <span className="text-amber-300">{topRoutes[0].from} ← {topRoutes[0].to}</span></span>
              </>
            )}
         </div>
      </div>

    </div>
  );
};
