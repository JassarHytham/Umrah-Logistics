
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Trash2, Filter, Search, X, ChevronLeft, ChevronRight, Calendar, Plane, Info, Plus, Copy, Share2, Bookmark, LayoutTemplate, MoreHorizontal } from 'lucide-react';
import { LogisticsRow, TripStatus, LogisticsTemplate } from '../types';

interface TableEditorProps {
  rows: LogisticsRow[];
  onChange: (id: string, field: keyof LogisticsRow, value: string) => void;
  onDelete?: (id: string) => void;
  isPreview: boolean;
  enableFiltering?: boolean;
  readOnly?: boolean;
  externalFilters?: Record<string, string[]>;
  templates?: LogisticsTemplate[];
  onAddNewRow?: () => void;
  onDuplicateRow?: (row: LogisticsRow) => void;
  onSaveAsTemplate?: (row: LogisticsRow) => void;
  onApplyTemplate?: (templateId: string) => void;
  onShareRow?: (row: LogisticsRow) => void;
  onDeleteTemplate?: (templateId: string) => void;
}

const STATUS_CONFIG: Record<TripStatus, { label: string; color: string }> = {
  'Planned': { label: 'مخطط', color: 'bg-gray-100 text-gray-700 border-gray-200' },
  'Confirmed': { label: 'مؤكد', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  'Driver Assigned': { label: 'تم تعيين السائق', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  'In Progress': { label: 'قيد التنفيذ', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  'Completed': { label: 'مكتمل', color: 'bg-green-100 text-green-700 border-green-200' },
  'Delayed': { label: 'متأخر', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  'Cancelled': { label: 'ملغي', color: 'bg-red-100 text-red-700 border-red-200' },
};

export const TableEditor: React.FC<TableEditorProps> = ({ 
  rows, 
  onChange, 
  onDelete, 
  isPreview, 
  enableFiltering = false,
  readOnly = false,
  externalFilters,
  templates = [],
  onAddNewRow,
  onDuplicateRow,
  onSaveAsTemplate,
  onApplyTemplate,
  onShareRow,
  onDeleteTemplate
}) => {
    // State for active filters
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null);
    const [filterSearch, setFilterSearch] = useState("");
    const [calViewDate, setCalViewDate] = useState(new Date());
    const [showTemplatesDropdown, setShowTemplatesDropdown] = useState(false);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const templateDropdownRef = useRef<HTMLDivElement>(null);

    // Sync external filters when they change
    useEffect(() => {
        if (externalFilters) {
            setFilters(externalFilters);
        }
    }, [externalFilters]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setActiveFilterCol(null);
                setFilterSearch("");
            }
            if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
                setShowTemplatesDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const isLongField = (key: string) => ['groupName', 'from', 'to'].includes(key);

    const headers: { key: keyof LogisticsRow | 'actions'; label: string }[] = [
        { key: "status", label: "الحالة" },
        { key: "groupNo", label: "رقم م" },
        { key: "groupName", label: "اسم المجموعة" },
        { key: "Column1", label: "الحركة" },
        { key: "tafweej", label: "التفويج" },
        { key: "carType", label: "السيارة" },
        { key: "from", label: "من" },
        { key: "to", label: "إلى" },
        { key: "time", label: "وقت" },
        { key: "flight", label: "رحلة" },
        { key: "date", label: "تاريخ" },
        { key: "count", label: "عدد" },
        ...(isPreview || readOnly ? [] : [{ key: "actions" as const, label: "إجراءات" }])
    ];

    const dateCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        rows.forEach(row => {
            if (row.date) {
                const d = row.date.trim();
                counts[d] = (counts[d] || 0) + 1;
            }
        });
        return counts;
    }, [rows]);

    const getUniqueValues = (key: string): string[] => {
        const values = new Set<string>(rows.map(r => String(r[key] || "")).filter((v): v is string => Boolean(v)));
        return Array.from(values).sort();
    };

    const filteredRows = useMemo(() => {
        if (!enableFiltering) return rows;
        return rows.filter(row => {
            return (Object.entries(filters) as [string, string[]][]).every(([key, selectedValues]) => {
                if (!selectedValues || selectedValues.length === 0) return true;
                const cellValue = String(row[key] || "");
                return selectedValues.includes(cellValue);
            });
        });
    }, [rows, filters, enableFiltering]);

    const toggleFilter = (columnKey: string, value: string) => {
        setFilters(prev => {
            const current = prev[columnKey] || [];
            const isSelected = current.includes(value);
            if (isSelected) {
                const updated = current.filter(v => v !== value);
                return { ...prev, [columnKey]: updated };
            } else {
                return { ...prev, [columnKey]: [...current, value] };
            }
        });
    };

    const clearColumnFilter = (columnKey: string) => {
        setFilters(prev => {
            const newState = { ...prev };
            delete newState[columnKey];
            return newState;
        });
    };

    const getCalendarDays = (year: number, month: number) => {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const days = [];
        for (let i = 0; i < firstDay; i++) days.push(null);
        for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
        return days;
    };

    const handleMonthChange = (offset: number) => {
        const newDate = new Date(calViewDate);
        newDate.setMonth(newDate.getMonth() + offset);
        setCalViewDate(newDate);
    };

    const renderCalendar = (columnKey: string) => {
        const year = calViewDate.getFullYear();
        const month = calViewDate.getMonth();
        const days = getCalendarDays(year, month);
        const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
        const dayNames = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

        return (
            <div className="w-72 p-2 text-right">
                <div className="flex justify-between items-center mb-2 px-1">
                    <button onClick={() => handleMonthChange(-1)} className="p-1 hover:bg-gray-100 rounded text-gray-600"><ChevronRight size={16} /></button>
                    <span className="font-bold text-gray-700 text-sm">{monthNames[month]} {year}</span>
                    <button onClick={() => handleMonthChange(1)} className="p-1 hover:bg-gray-100 rounded text-gray-600"><ChevronLeft size={16} /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center mb-1">
                    {dayNames.map(d => <span key={d} className="text-[10px] text-gray-500 font-medium">{d}</span>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {days.map((dateObj, idx) => {
                        if (!dateObj) return <div key={`empty-${idx}`} />;
                        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
                        const count = dateCounts[dateStr] || 0;
                        const isSelected = filters[columnKey]?.includes(dateStr);
                        return (
                            <button
                                key={dateStr}
                                onClick={() => toggleFilter(columnKey, dateStr)}
                                className={`flex flex-col items-center justify-center p-1 rounded-md text-xs h-10 border transition-all ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white border-gray-100 text-gray-700 hover:border-blue-300 hover:bg-blue-50'}`}
                            >
                                <span className="font-bold">{dateObj.getDate()}</span>
                                {count > 0 && <span className={`-mb-2 scale-75 px-1.5 rounded-full font-bold text-[9px] ${isSelected ? 'bg-white text-blue-600' : 'bg-red-100 text-red-600'}`}>{count}</span>}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderCellContent = (row: LogisticsRow, h: { key: keyof LogisticsRow | 'actions' }) => {
        if (h.key === 'actions') {
            return (
                <div className="flex items-center justify-center gap-1">
                    <button 
                        onClick={() => onDuplicateRow?.(row)} 
                        title="تكرار الرحلة"
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                        <Copy size={14} />
                    </button>
                    <button 
                        onClick={() => onSaveAsTemplate?.(row)} 
                        title="حفظ كقالب"
                        className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                        <Bookmark size={14} />
                    </button>
                    <button 
                        onClick={() => onShareRow?.(row)} 
                        title="نسخ التفاصيل"
                        className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                    >
                        <Share2 size={14} />
                    </button>
                    {onDelete && (
                        <button 
                            onClick={() => onDelete(row.id)} 
                            title="حذف"
                            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            );
        }
        if (h.key === 'status') {
            const status = (row.status || 'Planned') as TripStatus;
            const config = STATUS_CONFIG[status];
            if (readOnly) return <div className={`px-2 py-1 rounded-full text-[10px] font-bold border text-center ${config.color}`}>{config.label}</div>;
            return (
                <select 
                    value={status} 
                    onChange={(e) => onChange(row.id, 'status', e.target.value)}
                    className={`w-full appearance-none px-2 py-1 rounded-full text-[10px] font-bold border focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 transition-all cursor-pointer text-center ${config.color}`}
                >
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key} className="bg-white text-gray-800 text-xs font-normal">{cfg.label}</option>
                    ))}
                </select>
            );
        }
        if (isLongField(h.key as string)) {
            return (
                <textarea 
                   value={row[h.key] || ''} 
                   onChange={(e) => onChange(row.id, h.key, e.target.value)}
                   readOnly={readOnly}
                   rows={2} 
                   className={`w-full bg-transparent px-2 py-1.5 rounded text-gray-800 placeholder-gray-300 transition-all resize-y text-xs min-h-[3rem] ${readOnly ? 'focus:outline-none cursor-default resize-none' : 'focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none'} ${!row[h.key] && isPreview ? 'bg-red-50 ring-1 ring-red-200' : ''}`}
                   placeholder={readOnly ? "" : "-"}
                />
            );
        }
        return (
            <input 
                type="text" 
                value={String(row[h.key] || '')} 
                onChange={(e) => onChange(row.id, h.key as keyof LogisticsRow, e.target.value)}
                readOnly={readOnly}
                className={`w-full bg-transparent px-2 py-1.5 rounded text-gray-800 placeholder-gray-300 transition-all text-xs ${readOnly ? 'focus:outline-none cursor-default' : 'focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none'} ${!row[h.key] && isPreview ? 'bg-red-50 ring-1 ring-red-200' : ''}`}
                placeholder={readOnly ? "" : "-"}
            />
        );
    };

    return (
        <div className="relative pb-10">
            {/* Toolbar above the table */}
            {!isPreview && !readOnly && (
                <div className="flex justify-between items-center mb-4 gap-3 px-1">
                    <div className="flex items-center gap-2">
                         <button 
                            onClick={onAddNewRow}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-all"
                        >
                            <Plus size={16} />
                            إضافة رحلة جديدة
                        </button>

                        <div className="relative" ref={templateDropdownRef}>
                            <button 
                                onClick={() => setShowTemplatesDropdown(!showTemplatesDropdown)}
                                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 transition-all"
                            >
                                <LayoutTemplate size={16} />
                                تطبيق قالب
                            </button>
                            {showTemplatesDropdown && (
                                <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in text-right">
                                    <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                                        <span className="text-xs font-bold text-gray-600">القوالب المحفوظة</span>
                                        <Bookmark size={12} className="text-gray-400" />
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {templates.length > 0 ? templates.map(t => (
                                            <div key={t.id} className="group flex items-center justify-between p-2 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0">
                                                <button 
                                                    onClick={() => { onApplyTemplate?.(t.id); setShowTemplatesDropdown(false); }}
                                                    className="flex-1 text-right text-xs font-medium text-gray-700 px-2 py-1"
                                                >
                                                    {t.name}
                                                </button>
                                                <button 
                                                    onClick={() => onDeleteTemplate?.(t.id)}
                                                    className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        )) : (
                                            <div className="p-4 text-center text-gray-400 text-xs italic">لا توجد قوالب محفوظة</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm text-right bg-white min-w-[1200px] border-collapse">
                    <thead className="bg-gray-100 text-gray-700 font-medium">
                        <tr>
                            {headers.map((h) => {
                                const isColumnFiltered = filters[h.key as string] && filters[h.key as string].length > 0;
                                const isActive = activeFilterCol === h.key;
                                let widthClass = "";
                                if (h.key === "status") widthClass = "w-[120px]";
                                else if (h.key === "tafweej") widthClass = "w-[80px]"; 
                                else if (h.key === "groupName") widthClass = "w-[180px]";
                                else if (h.key === "count") widthClass = "w-[60px]";
                                else if (h.key === "groupNo") widthClass = "w-[80px]";
                                else if (h.key === "from" || h.key === "to") widthClass = "w-[140px]";
                                else if (h.key === "Column1") widthClass = "w-[110px]";
                                else if (h.key === "date") widthClass = "w-[120px]";
                                else if (h.key === "time") widthClass = "w-[90px]";
                                else if (h.key === "actions") widthClass = "w-[130px]";
                                else widthClass = "w-[100px]";
                                
                                const isEndColumn = ['date', 'time', 'flight', 'count', 'actions'].includes(h.key as string);
                                const dropdownAlignment = isEndColumn ? 'left-0' : 'right-0';
                                
                                return (
                                    <th key={h.key} className={`px-2 py-3 border-b border-gray-200 relative align-top ${widthClass}`} style={{ width: widthClass }}>
                                        <div className="flex items-start justify-between gap-1">
                                            <div className="flex items-center gap-1 flex-wrap">
                                                <span>{h.label}</span>
                                                {h.key === 'date' && <Calendar size={12} className="text-gray-400" />}
                                                {h.key === 'flight' && <Plane size={12} className="text-gray-400" />}
                                                {h.key === 'status' && <Info size={12} className="text-gray-400" />}
                                            </div>
                                            {enableFiltering && h.key !== 'actions' && (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActiveFilterCol(isActive ? null : h.key as string);
                                                        setFilterSearch("");
                                                    }}
                                                    className={`p-0.5 rounded hover:bg-gray-200 transition-colors ${isColumnFiltered ? 'text-blue-600 bg-blue-50' : 'text-gray-400'}`}
                                                >
                                                    <Filter size={12} fill={isColumnFiltered ? "currentColor" : "none"} />
                                                </button>
                                            )}
                                        </div>
                                        {isActive && enableFiltering && (
                                            <div 
                                                ref={dropdownRef}
                                                className={`absolute top-full ${dropdownAlignment} mt-1 bg-white rounded-lg shadow-xl border border-gray-200 z-50 text-right`}
                                                style={{ minWidth: h.key === 'date' ? 'auto' : '14rem', maxWidth: '90vw' }}
                                            >
                                                {h.key === 'date' ? renderCalendar('date') : (
                                                    <>
                                                        <div className="p-2 border-b border-gray-100">
                                                            <div className="relative">
                                                                <Search size={14} className="absolute top-2 right-2 text-gray-400" />
                                                                <input 
                                                                    type="text" placeholder="بحث..." 
                                                                    value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)}
                                                                    className="w-full pl-2 pr-8 py-1 text-xs border border-gray-200 rounded outline-none" autoFocus
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto p-1 text-right">
                                                            {getUniqueValues(h.key as string).filter(val => val.toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                                                <label key={val} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                                                    <input 
                                                                        type="checkbox" checked={filters[h.key as string]?.includes(val) || false}
                                                                        onChange={() => toggleFilter(h.key as string, val)}
                                                                        className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5"
                                                                    />
                                                                    <span className="text-xs text-gray-700 truncate">{h.key === 'status' ? STATUS_CONFIG[val as TripStatus]?.label : (val || '(فارغ)')}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                                <div className="p-2 border-t border-gray-100 bg-gray-50 flex justify-between">
                                                    <button onClick={() => clearColumnFilter(h.key as string)} className="text-xs text-red-500 font-medium" disabled={!isColumnFiltered}>مسح</button>
                                                    <button onClick={() => setActiveFilterCol(null)} className="text-xs text-blue-600 font-medium">إغلاق</button>
                                                </div>
                                            </div>
                                        )}
                                    </th>
                                )
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredRows.map((row) => (
                            <tr key={row.id} className={`transition-colors align-top ${readOnly ? 'hover:bg-gray-50' : 'hover:bg-blue-50/50'}`}>
                                {headers.map(h => <td key={h.key} className="p-1 border-l border-gray-100 last:border-l-0">{renderCellContent(row, h)}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {enableFiltering && Object.keys(filters).length > 0 && (
                 <div className="absolute bottom-2 right-4 flex gap-2 z-10">
                    {Object.entries(filters).map(([key, vals]) => (vals as string[]).length > 0 && (
                        <span key={key} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                            {headers.find(h => h.key === key)?.label}: {(vals as string[]).length}
                            <button onClick={() => clearColumnFilter(key)}><X size={12} /></button>
                        </span>
                    ))}
                    <button onClick={() => setFilters({})} className="text-xs text-gray-500 underline">مسح الكل</button>
                 </div>
            )}
        </div>
    );
}
