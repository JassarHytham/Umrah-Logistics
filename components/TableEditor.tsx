import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Trash2, Filter, Search, X, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { LogisticsRow } from '../types';

interface TableEditorProps {
  rows: LogisticsRow[];
  onChange: (index: number, field: keyof LogisticsRow, value: string) => void;
  onDelete?: (index: number) => void;
  isPreview: boolean;
  enableFiltering?: boolean;
}

export const TableEditor: React.FC<TableEditorProps> = ({ 
  rows, 
  onChange, 
  onDelete, 
  isPreview, 
  enableFiltering = false 
}) => {
    // State for active filters: { [columnKey]: ["value1", "value2"] }
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    // State for which filter dropdown is open
    const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null);
    // Search term inside the filter dropdown
    const [filterSearch, setFilterSearch] = useState("");
    
    // Calendar State
    const [calViewDate, setCalViewDate] = useState(new Date());

    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setActiveFilterCol(null);
                setFilterSearch("");
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Helper to determine if a field needs a textarea (long content)
    const isLongField = (key: string) => ['groupName', 'from', 'to'].includes(key);

    const headers: { key: keyof LogisticsRow; label: string }[] = [
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
    ];

    // 1. Prepare rows with original indices
    const rowsWithIndex = useMemo(() => {
        return rows.map((r, i) => ({ ...r, _originalIndex: i }));
    }, [rows]);

    // 2. Data Aggregation for Calendar Counts
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

    // 3. Get unique values for standard columns
    const getUniqueValues = (key: string) => {
        const values = new Set(rows.map(r => String(r[key] || "")).filter(Boolean));
        return Array.from(values).sort();
    };

    // 4. Filter the rows based on active filters
    const filteredRows = useMemo(() => {
        if (!enableFiltering) return rowsWithIndex;

        return rowsWithIndex.filter(row => {
            return Object.entries(filters).every(([key, selectedValues]) => {
                if (!selectedValues || selectedValues.length === 0) return true;
                const cellValue = String(row[key] || "");
                return selectedValues.includes(cellValue);
            });
        });
    }, [rowsWithIndex, filters, enableFiltering]);

    // Handlers
    const toggleFilter = (columnKey: string, value: string) => {
        setFilters(prev => {
            const current = prev[columnKey] || [];
            const isSelected = current.includes(value);
            
            if (isSelected) {
                const updated = current.filter(v => v !== value);
                return updated.length === 0 
                    ? { ...prev, [columnKey]: [] }
                    : { ...prev, [columnKey]: updated };
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

    // --- Calendar Logic Helper ---
    const getCalendarDays = (year: number, month: number) => {
        const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday
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
            <div className="w-72 p-2">
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
                                className={`
                                    flex flex-col items-center justify-center p-1 rounded-md text-xs h-10 border transition-all
                                    ${isSelected 
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                                        : 'bg-white border-gray-100 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                                    }
                                `}
                            >
                                <span className="font-bold">{dateObj.getDate()}</span>
                                {count > 0 && (
                                    <span className={`
                                        -mb-2 scale-75 px-1.5 rounded-full font-bold text-[9px]
                                        ${isSelected ? 'bg-white text-blue-600' : 'bg-red-100 text-red-600'}
                                    `}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };


    return (
        <div className="relative pb-10">
            {/* Main Table Container */}
            <table className="w-full text-sm text-right bg-white table-fixed border-collapse">
                <thead className="bg-gray-100 text-gray-700 font-medium">
                    <tr>
                        {headers.map((h, i) => {
                            const isColumnFiltered = filters[h.key as string] && filters[h.key as string].length > 0;
                            const isActive = activeFilterCol === h.key;
                            
                            // Define width classes
                            let widthClass = "";
                            if (h.key === "tafweej") widthClass = "w-[6%]"; 
                            else if (h.key === "groupName") widthClass = "w-[15%]";
                            else if (h.key === "count") widthClass = "w-[4%]";
                            else if (h.key === "groupNo") widthClass = "w-[6%]";
                            else if (h.key === "from" || h.key === "to") widthClass = "w-[12%]";
                            else if (h.key === "Column1") widthClass = "w-[10%]";
                            else if (h.key === "date") widthClass = "w-[10%]";
                            else widthClass = "w-[8%]"; // carType, time, flight

                            // Determine dropdown alignment:
                            // In RTL, left-most columns (end of array visually) need 'left-0' to expand Right.
                            const isEndColumn = ['date', 'time', 'flight', 'count'].includes(h.key as string);
                            const dropdownAlignment = isEndColumn ? 'left-0' : 'right-0';

                            return (
                                <th key={h.key} className={`px-2 py-3 border-b border-gray-200 relative align-top ${widthClass}`}>
                                    <div className="flex items-start justify-between gap-1">
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <span>{h.label}</span>
                                            {h.key === 'date' && <Calendar size={12} className="text-gray-400" />}
                                        </div>
                                        {enableFiltering && (
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveFilterCol(isActive ? null : h.key as string);
                                                    setFilterSearch("");
                                                    if (!isActive && h.key === 'date') {
                                                        const firstSel = filters['date']?.[0];
                                                        if (firstSel) setCalViewDate(new Date(firstSel));
                                                        else setCalViewDate(new Date());
                                                    }
                                                }}
                                                className={`p-0.5 rounded hover:bg-gray-200 transition-colors ${isColumnFiltered ? 'text-blue-600 bg-blue-50' : 'text-gray-400'}`}
                                            >
                                                <Filter size={12} fill={isColumnFiltered ? "currentColor" : "none"} />
                                            </button>
                                        )}
                                    </div>

                                    {/* Dropdown Container */}
                                    {isActive && enableFiltering && (
                                        <div 
                                            ref={dropdownRef}
                                            className={`absolute top-full ${dropdownAlignment} mt-1 bg-white rounded-lg shadow-xl border border-gray-200 z-50 text-right`}
                                            style={{ minWidth: h.key === 'date' ? 'auto' : '14rem', maxWidth: '90vw' }}
                                        >
                                            {h.key === 'date' ? (
                                                renderCalendar('date')
                                            ) : (
                                                <>
                                                    <div className="p-2 border-b border-gray-100">
                                                        <div className="relative">
                                                            <Search size={14} className="absolute top-2 right-2 text-gray-400" />
                                                            <input 
                                                                type="text" 
                                                                placeholder="بحث..." 
                                                                value={filterSearch}
                                                                onChange={(e) => setFilterSearch(e.target.value)}
                                                                className="w-full pl-2 pr-8 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                                                                autoFocus
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="max-h-48 overflow-y-auto p-1">
                                                        {getUniqueValues(h.key as string)
                                                            .filter(val => val.toLowerCase().includes(filterSearch.toLowerCase()))
                                                            .map(val => {
                                                                const isSelected = filters[h.key as string]?.includes(val);
                                                                return (
                                                                    <label key={val} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            checked={isSelected || false}
                                                                            onChange={() => toggleFilter(h.key as string, val)}
                                                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                                                        />
                                                                        <span className="text-xs text-gray-700 truncate">{val || '(فارغ)'}</span>
                                                                    </label>
                                                                )
                                                            })
                                                        }
                                                        {getUniqueValues(h.key as string).length === 0 && (
                                                             <div className="p-2 text-xs text-gray-400 text-center">لا توجد بيانات</div>
                                                        )}
                                                    </div>
                                                </>
                                            )}

                                            <div className="p-2 border-t border-gray-100 bg-gray-50 flex justify-between">
                                                <button 
                                                    onClick={() => clearColumnFilter(h.key as string)}
                                                    className="text-xs text-red-500 hover:text-red-700 font-medium"
                                                    disabled={!isColumnFiltered}
                                                >
                                                    مسح الفلتر
                                                </button>
                                                <button 
                                                    onClick={() => setActiveFilterCol(null)}
                                                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                                >
                                                    إغلاق
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </th>
                            )
                        })}
                        {!isPreview && <th className="px-2 py-3 border-b border-gray-200 w-8 align-top"></th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {filteredRows.length > 0 ? (
                        filteredRows.map((row) => (
                            <tr key={row._originalIndex} className="hover:bg-blue-50/50 transition-colors group align-top">
                                {headers.map(h => (
                                    <td key={h.key} className="p-1 border-l border-gray-100 last:border-l-0 align-top">
                                        {/* Use Textarea for long fields to allow wrapping, Input for short fields */}
                                        {isLongField(h.key as string) ? (
                                             <textarea 
                                                value={row[h.key] || ''} 
                                                onChange={(e) => onChange(row._originalIndex, h.key, e.target.value)}
                                                rows={2} // Minimum height to suggest wrapping
                                                className={`w-full bg-transparent px-2 py-1.5 rounded text-gray-800 placeholder-gray-300 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all resize-y text-xs min-h-[3rem] ${
                                                    !row[h.key] && isPreview ? 'bg-red-50 ring-1 ring-red-200' : ''
                                                }`}
                                                placeholder="-"
                                             />
                                        ) : (
                                            <input 
                                                type="text" 
                                                value={row[h.key] || ''} 
                                                onChange={(e) => onChange(row._originalIndex, h.key, e.target.value)}
                                                className={`w-full bg-transparent px-2 py-1.5 rounded text-gray-800 placeholder-gray-300 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all text-xs ${
                                                    !row[h.key] && isPreview ? 'bg-red-50 ring-1 ring-red-200' : ''
                                                }`}
                                                placeholder="-"
                                            />
                                        )}
                                    </td>
                                ))}
                                {!isPreview && onDelete && (
                                    <td className="p-2 text-center align-middle">
                                        <button 
                                            onClick={() => onDelete(row._originalIndex)} 
                                            className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-full transition-colors"
                                            title="حذف الصف"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={headers.length + (isPreview ? 0 : 1)} className="p-8 text-center text-gray-400">
                                لا توجد نتائج تطابق الفلاتر الحالية
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            
            {/* Active Filters Summary */}
            {enableFiltering && Object.keys(filters).length > 0 && (
                 <div className="absolute bottom-2 right-4 flex gap-2 z-10">
                    {Object.entries(filters).map(([key, vals]) => (
                        vals.length > 0 && (
                            <span key={key} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center gap-1 border border-blue-200 shadow-sm">
                                {headers.find(h => h.key === key)?.label}: {key === 'date' ? `${vals.length} أيام` : vals.length}
                                <button onClick={() => clearColumnFilter(key)} className="hover:text-blue-900"><X size={12} /></button>
                            </span>
                        )
                    ))}
                    <button 
                        onClick={() => setFilters({})} 
                        className="text-xs text-gray-500 hover:text-gray-700 underline px-2 py-1"
                    >
                        مسح الكل
                    </button>
                 </div>
            )}
        </div>
    );
};