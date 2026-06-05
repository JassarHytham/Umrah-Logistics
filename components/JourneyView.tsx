import React, { useState, useMemo } from 'react';
import { Search, Calendar, Filter, Plane, Bus, MapPin, Edit, Printer, ChevronDown, ChevronUp, PackageOpen, FileText } from 'lucide-react';
import { LogisticsRow, TripStatus } from '../types';
import { parseDateTime } from '../utils/parser';

interface JourneyViewProps {
  rows: LogisticsRow[];
}

export const JourneyView: React.FC<JourneyViewProps> = ({ rows }) => {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Group and sort
  const groupedData = useMemo(() => {
    // Filter rows
    let filteredRows = rows;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredRows = filteredRows.filter(r => 
        r.groupName?.toLowerCase().includes(lowerSearch) || 
        r.groupNo?.toLowerCase().includes(lowerSearch)
      );
    }
    if (dateFilter) {
      filteredRows = filteredRows.filter(r => r.date === dateFilter);
    }
    if (statusFilter) {
      filteredRows = filteredRows.filter(r => r.status === statusFilter);
    }
    if (typeFilter) {
      filteredRows = filteredRows.filter(r => r.Column1 === typeFilter);
    }

    const map = new Map<string, {
      groupName: string;
      groupNo: string;
      count: string;
      rows: LogisticsRow[];
      overallStatus: TripStatus;
    }>();

    filteredRows.forEach(row => {
      const key = `${row.groupName}|${row.groupNo}`;
      if (!map.has(key)) {
        map.set(key, {
          groupName: row.groupName,
          groupNo: row.groupNo,
          count: row.count,
          rows: [],
          overallStatus: row.status
        });
      }
      map.get(key)!.rows.push(row);
    });

    const groups = Array.from(map.values());

    for (const group of groups) {
      // Sort rows by date and time
      group.rows.sort((a, b) => {
        const timeA = parseDateTime(a.date, a.time)?.getTime() || 0;
        const timeB = parseDateTime(b.date, b.time)?.getTime() || 0;
        return timeA - timeB;
      });

      // Compute overall status: 'Planned' by default, or the first active one
      const activeRow = group.rows.find(r => r.status !== 'Completed');
      group.overallStatus = activeRow ? activeRow.status : 'Completed';
    }

    return groups;
  }, [rows, search, dateFilter, statusFilter, typeFilter]);

  // Unique dates and types for filters
  const uniqueDates = useMemo(() => Array.from(new Set(rows.map(r => r.date).filter(Boolean))).sort(), [rows]);
  const uniqueTypes = useMemo(() => Array.from(new Set(rows.map(r => r.Column1).filter(Boolean))).sort(), [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-gray-500 bg-white rounded-3xl shadow-xl border border-gray-100 min-h-[60vh] animate-fade-in">
        <PackageOpen size={80} className="mb-6 text-blue-200" strokeWidth={1.5} />
        <h2 className="text-2xl font-bold mb-2 text-gray-800">No logistics records found</h2>
        <p className="text-sm">Please add trips in the operational view first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in" dir="rtl">
      {/* Header Area */}
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="bg-indigo-600 p-8 text-white">
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
            <PackageOpen size={28} /> Logistics Journey View
          </h2>
          <p className="text-indigo-100 text-sm">عرض رحلة المجموعات اللوجستية</p>
        </div>

        {/* Filters */}
        <div className="p-4 sm:p-6 bg-white border-b border-gray-100 flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center">
          <div className="flex-1 w-full sm:min-w-[200px] relative">
            <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search by group name or reference..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[44px]"
            />
          </div>
          
          <div className="w-full sm:w-auto relative min-w-[150px]">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-indigo-500 transition-all min-h-[44px]">
              <option value="">All Dates</option>
              {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="w-full sm:w-auto relative min-w-[150px]">
            <Filter size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-indigo-500 transition-all min-h-[44px]">
              <option value="">All Statuses</option>
              <option value="Planned">Planned (مخطط)</option>
              <option value="Assigned">Assigned (تم تعيين السائق)</option>
              <option value="In Progress">In Progress (قيد التنفيذ)</option>
              <option value="Completed">Completed (مكتمل)</option>
              <option value="Delayed">Delayed (متأخر)</option>
            </select>
          </div>

          <div className="w-full sm:w-auto relative min-w-[150px]">
            <Filter size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-indigo-500 transition-all min-h-[44px]">
              <option value="">All Movement Types</option>
              {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Grid */}
      {groupedData.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {groupedData.map((group, idx) => (
            <GroupCard key={idx} group={group} />
          ))}
        </div>
      ) : (
        <div className="text-center p-12 text-gray-500 bg-white rounded-3xl border border-gray-100 shadow-sm">
          لا توجد نتائج مطابقة للبحث (No results match your filters)
        </div>
      )}
    </div>
  );
};

const GroupCard = ({ group }: { group: any }) => {
  const [expanded, setExpanded] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Planned': return 'bg-gray-100 text-gray-600 border-gray-200';
      case 'Driver Assigned':
      case 'Assigned': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'In Progress': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Completed': return 'bg-green-50 text-green-700 border-green-200';
      case 'Delayed': return 'bg-red-50 text-red-700 border-red-200';
      default: return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  const getMovementStyle = (type: string) => {
    if (type.includes('وصول') || type.toLowerCase().includes('arrival')) 
      return { icon: <Plane size={14} className="rotate-90"/>, color: 'bg-blue-50 text-blue-600 border-blue-100', dot: 'bg-blue-500', name: 'Arrival' };
    if (type.includes('مغادرة') || type.toLowerCase().includes('departure')) 
      return { icon: <Plane size={14} />, color: 'bg-red-50 text-red-600 border-red-100', dot: 'bg-red-500', name: 'Departure' };
    if (type.includes('بين المدن') || type.toLowerCase().includes('intercity')) 
      return { icon: <Bus size={14} />, color: 'bg-orange-50 text-orange-600 border-orange-100', dot: 'bg-orange-500', name: 'Intercity Transfer' };
    
    return { icon: <Bus size={14} />, color: 'bg-green-50 text-green-600 border-green-100', dot: 'bg-green-500', name: 'Internal Transport' };
  };

  return (
    <div className="bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-gray-100 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] transition-all duration-300 flex flex-col overflow-hidden group">
      {/* Header */}
      <div className="p-5 border-b border-gray-50 relative cursor-pointer hover:bg-gray-50/50 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-gray-900 text-lg leading-tight mb-1">{group.groupName || 'Unknown Group'}</h3>
            <p className="text-xs text-gray-500 font-mono flex items-center gap-1">
              Ref: <span className="text-gray-700 font-semibold">{group.groupNo}</span>
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${getStatusColor(group.overallStatus)}`}>
            {group.overallStatus}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-50">
          <div className="flex items-center gap-2 text-gray-600">
            <span className="bg-indigo-50 text-indigo-600 p-1.5 rounded-lg"><Bus size={14} /></span>
            <span className="font-medium text-xs">{group.count} Passengers</span>
          </div>
          <button className="text-gray-400 group-hover:text-indigo-600 transition-colors p-1.5 bg-gray-50 rounded-full group-hover:bg-indigo-50">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Timeline */}
      {expanded && (
        <div className="p-6 bg-[#fafafa] flex-1 relative border-b border-gray-100">
          <div className="absolute top-8 bottom-8 right-[35px] w-[2px] bg-gray-200 rounded-full"></div>
          <div className="space-y-6">
            {group.rows.map((row: LogisticsRow, i: number) => {
              const style = getMovementStyle(row.Column1);
              return (
                <div key={row.id} className="relative pr-10 z-10">
                  {/* Timeline Dot */}
                  <div className={`absolute right-[7px] top-4 w-[14px] h-[14px] rounded-full border-[3px] border-[#fafafa] shadow-sm ${style.dot}`}></div>
                  
                  <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:border-indigo-200 hover:shadow-md transition-all">
                    <div className="flex justify-between items-center mb-3">
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border ${style.color}`}>
                        {style.icon}
                        {row.Column1}
                      </span>
                      <span className="text-xs text-gray-500 font-semibold font-mono bg-gray-50 px-2 py-1 rounded-md" dir="ltr">
                        {row.date} - {row.time}
                      </span>
                    </div>
                    
                    <div className="space-y-3 mt-4">
                      <div className="flex items-start gap-2.5">
                        <div className="w-5 h-5 rounded-full bg-gray-50 flex items-center justify-center shrink-0 mt-0.5 border border-gray-100">
                          <MapPin size={10} className="text-gray-400" />
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">From</p>
                          <p className="text-gray-800 text-xs font-semibold">{row.from || '---'}</p>
                        </div>
                      </div>
                      
                      <div className="pl-2 ml-1 border-l-2 border-dashed border-gray-100 h-2"></div>
                      
                      <div className="flex items-start gap-2.5">
                        <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5 border border-indigo-100">
                          <MapPin size={10} className="text-indigo-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">To</p>
                          <p className="text-gray-800 text-xs font-semibold">{row.to || '---'}</p>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-50">
                        <span className="text-[11px] text-gray-600 font-medium flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                          Vehicle: {row.carType || 'N/A'}
                        </span>
                        {row.flight && row.flight !== '-' && (
                          <span className="text-[11px] text-gray-600 font-medium font-mono flex items-center gap-1.5" dir="ltr">
                            ✈ Flight: {row.flight}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Actions */}
      {expanded && (
        <div className="p-3 bg-white flex flex-wrap justify-end gap-2">
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors min-h-[44px]">
            <FileText size={14} /> Details
          </button>
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors min-h-[44px]">
            <Edit size={14} /> Edit
          </button>
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors min-h-[44px]">
            <Printer size={14} /> Print
          </button>
        </div>
      )}
    </div>
  );
};
