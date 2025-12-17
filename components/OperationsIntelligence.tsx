import React, { useMemo } from 'react';
import { 
  BarChart3, AlertCircle, TrendingUp, Clock, Calendar, 
  MapPin, Car, ShieldAlert, ArrowUpRight, 
  CheckCircle2, AlertTriangle, Info
} from 'lucide-react';
import { LogisticsRow } from '../types';
import { getLocalDateString } from '../App';

interface AnalyticsProps {
  rows: LogisticsRow[];
  onNavigateToTable: (filters?: Record<string, string[]>) => void;
}

export const OperationsIntelligence: React.FC<AnalyticsProps> = ({ rows, onNavigateToTable }) => {
  // Use consistent local-time date string
  const todayStr = getLocalDateString();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = getLocalDateString(tomorrowDate);

  // 1. Data Aggregation
  const stats = useMemo(() => {
    const todayRows = rows.filter(r => r.date === todayStr);
    const tomorrowRows = rows.filter(r => r.date === tomorrowStr);
    const delayed = rows.filter(r => r.status === 'Delayed');
    const unassigned = rows.filter(r => r.status === 'Planned');
    
    // High load detection (next 14 days)
    const dailyCounts: Record<string, number> = {};
    rows.forEach(r => {
      if (r.date) {
        const d = String(r.date).trim();
        dailyCounts[d] = (dailyCounts[d] || 0) + 1;
      }
    });
    
    const highLoadDays = Object.entries(dailyCounts)
      .filter(([date, count]) => (count as number) >= 5 && date >= todayStr)
      .map(([date]) => date);

    return {
      today: todayRows.length,
      tomorrow: tomorrowRows.length,
      delayed: delayed.length,
      unassigned: unassigned.length,
      highLoadCount: highLoadDays.length,
      dailyCounts
    };
  }, [rows, todayStr, tomorrowStr]);

  // 2. City & Vehicle Breakdown
  const distributions = useMemo(() => {
    const cities: Record<string, number> = {};
    const vehicles: Record<string, number> = {};
    
    rows.forEach(r => {
      if (r.to) {
        const city = String(r.to).trim();
        cities[city] = (cities[city] || 0) + 1;
      }
      if (r.carType) {
        const car = String(r.carType).trim();
        vehicles[car] = (vehicles[car] || 0) + 1;
      }
    });

    return { 
      cities: Object.entries(cities).sort((a,b) => b[1] - a[1]),
      vehicles: Object.entries(vehicles).sort((a,b) => b[1] - a[1])
    };
  }, [rows]);

  // 3. Risk Alerts
  const alerts = useMemo(() => {
    const list: { id: string, type: 'error' | 'warning' | 'info', msg: string, filter: any }[] = [];
    
    const todayUnconfirmed = rows.filter(r => r.date === todayStr && r.status === 'Planned');
    if (todayUnconfirmed.length > 0) {
      list.push({ 
        id: 'unconfirmed', 
        type: 'error', 
        msg: `يوجد ${todayUnconfirmed.length} رحلات اليوم بانتظار التأكيد.`, 
        filter: { date: [todayStr], status: ['Planned'] } 
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

    const highLoadDay = Object.entries(stats.dailyCounts).find(([d, c]) => (c as number) >= 8 && d >= todayStr);
    if (highLoadDay) {
        list.push({
            id: 'spike',
            type: 'info',
            msg: `ضغط عمليات مرتفع (${highLoadDay[1]} رحلة) متوقع يوم ${highLoadDay[0]}.`,
            filter: { date: [highLoadDay[0]] }
        });
    }

    return list.slice(0, 6);
  }, [rows, todayStr, stats]);

  // 4. Load Chart Data (Next 10 days)
  const chartDays = useMemo(() => {
    return Array.from({ length: 10 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = getLocalDateString(d);
      return {
        date: dateStr,
        count: stats.dailyCounts[dateStr] || 0
      };
    });
  }, [stats]);

  return (
    <div className="space-y-8 animate-fade-in pb-12" dir="rtl">
      
      {/* SECTION 1: Executive Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'رحلات اليوم', val: stats.today, icon: Clock, color: 'from-blue-600 to-blue-400' },
          { label: 'رحلات الغد', val: stats.tomorrow, icon: Calendar, color: 'from-indigo-600 to-indigo-400' },
          { label: 'تأخيرات نشطة', val: stats.delayed, icon: AlertCircle, color: 'from-red-600 to-red-400', urgent: stats.delayed > 0 },
          { label: 'بانتظار التأكيد', val: stats.unassigned, icon: ShieldAlert, color: 'from-amber-600 to-amber-400' },
          { label: 'أيام ضغط عالٍ', val: stats.highLoadCount, icon: TrendingUp, color: 'from-emerald-600 to-emerald-400' },
        ].map((c, i) => (
          <div key={i} className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 relative overflow-hidden group transition-all hover:shadow-md`}>
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
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* SECTION 2: Daily Load Chart */}
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <BarChart3 className="text-blue-500" size={20} />
              تحليل ضغط العمليات (10 أيام قادمة)
            </h3>
          </div>
          
          <div className="flex items-end justify-between h-48 gap-2 px-2 flex-1">
            {chartDays.map((d, i) => {
              const max = Math.max(...chartDays.map(x => x.count), 5);
              const height = (d.count / max) * 100;
              const isToday = d.date === todayStr;
              
              let barColor = 'bg-blue-400';
              if (d.count >= 5) barColor = 'bg-amber-400';
              if (d.count >= 8) barColor = 'bg-red-400';

              return (
                <div key={i} className="flex-1 flex flex-col items-center group relative h-full">
                   {/* Bar Container acting as Track */}
                   <div className="w-full flex-1 bg-gray-50/50 rounded-t-lg flex flex-col justify-end overflow-hidden mb-2 relative">
                      <div 
                        className={`w-full rounded-t-sm transition-all duration-700 ${barColor} ${isToday ? 'ring-2 ring-blue-600 ring-offset-1' : 'opacity-80 group-hover:opacity-100'}`}
                        style={{ height: d.count > 0 ? `${height}%` : '2px' }}
                      >
                        {/* Tooltip */}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none shadow-lg">
                          {d.count} رحلة
                        </div>
                      </div>
                   </div>
                  <div className={`text-[10px] font-bold transform -rotate-45 origin-top-right whitespace-nowrap mt-1 ${isToday ? 'text-blue-700' : 'text-gray-400'}`}>
                    {i === 0 ? 'اليوم' : d.date.split('-').slice(1).reverse().join('/')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION 3: Distribution Breakdown */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
              <MapPin className="text-emerald-500" size={18} />
              توزيع الرحلات حسب الوجهة
            </h3>
            <div className="space-y-4">
              {distributions.cities.length > 0 ? distributions.cities.slice(0, 4).map(([name, count]) => {
                const percentage = (count / (rows.length || 1)) * 100;
                return (
                  <div key={name}>
                    <div className="flex justify-between text-xs mb-1.5 font-bold">
                      <span className="text-gray-700">{name}</span>
                      <span className="text-blue-600 bg-blue-50 px-2 rounded-full">{count}</span>
                    </div>
                    <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100">
                      <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                );
              }) : <p className="text-xs text-gray-400 text-center py-4">لا توجد بيانات وجهات</p>}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
              <Car className="text-indigo-500" size={18} />
              تحليل أنواع المركبات
            </h3>
            <div className="space-y-4">
              {distributions.vehicles.length > 0 ? distributions.vehicles.map(([name, count]) => {
                const percentage = (count / (rows.length || 1)) * 100;
                return (
                  <div key={name}>
                    <div className="flex justify-between text-xs mb-1.5 font-bold">
                      <span className="text-gray-700">{name || 'غير محدد'}</span>
                      <span className="text-blue-600 bg-blue-50 px-2 rounded-full">{count}</span>
                    </div>
                    <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100">
                      <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                );
              }) : <p className="text-xs text-gray-400 text-center py-4">لا توجد بيانات مركبات</p>}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 4: Risk & Anomaly Alerts */}
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
                'bg-blue-50 border-blue-100 hover:bg-blue-100'
              }`}
            >
              <div className={`mt-0.5 ${
                alert.type === 'error' ? 'text-red-600' :
                alert.type === 'warning' ? 'text-amber-600' :
                'text-blue-600'
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
      <div className="flex justify-center">
         <div className="bg-slate-800 text-white px-6 py-2.5 rounded-full text-xs font-bold flex items-center gap-3 shadow-xl">
            <TrendingUp size={14} className="text-emerald-400" />
            <span>الوجهة الأكثر طلباً: <span className="text-emerald-300">{distributions.cities[0]?.[0] || '---'}</span></span>
            <div className="w-px h-3 bg-white/20"></div>
            <span>الأسطول الأكثر طلباً: <span className="text-blue-300">{distributions.vehicles[0]?.[0] || '---'}</span></span>
         </div>
      </div>

    </div>
  );
};