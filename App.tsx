
import React, { useState, useEffect, useRef } from 'react';
import { Download, Edit3, FileText, AlertCircle, Save, Plane, Bus, Users, ClipboardList, Upload, Trash2, History, RotateCcw, XCircle, Eraser, Calendar, Clock, Check, FileJson, Database, AlertTriangle, LayoutDashboard, Settings, Plus, Copy, Share2, Bookmark } from 'lucide-react';
import { LogisticsRow, InputState, NotificationState, TripStatus, LogisticsTemplate } from './types';
import { parseItineraryText } from './utils/parser';
import { TableEditor } from './components/TableEditor';
import { OperationsIntelligence } from './components/OperationsIntelligence';

// Helper for safe local storage access
const loadFromStorage = (key: string, defaultValue: any) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch (e) {
    console.error(`Failed to load ${key}`, e);
    return defaultValue;
  }
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

// Utility for consistent local date string YYYY-MM-DD
export const getLocalDateString = (date: Date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

interface ConfirmModalState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'warning';
}

const STATUS_LABELS: Record<TripStatus, string> = {
  'Planned': 'مخطط',
  'Confirmed': 'مؤكد',
  'Driver Assigned': 'تم تعيين السائق',
  'In Progress': 'قيد التنفيذ',
  'Completed': 'مكتمل',
  'Delayed': 'متأخر',
  'Cancelled': 'ملغي',
};

export default function App() {
  const [view, setView] = useState<'operational' | 'analytics'>('operational');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]> | undefined>(undefined);

  const [allRows, setAllRows] = useState<LogisticsRow[]>(() => {
    const loaded = loadFromStorage('umrah_logistics_rows', []);
    return loaded.map((r: any) => ({ 
      ...r, 
      id: r.id || uid(),
      status: r.status || 'Planned'
    }));
  });
  
  const [deletedRows, setDeletedRows] = useState<LogisticsRow[]>(() => {
    const loaded = loadFromStorage('umrah_logistics_deleted', []);
    return loaded.map((r: any) => ({ 
      ...r, 
      id: r.id || uid(),
      status: r.status || 'Planned'
    }));
  });

  const [templates, setTemplates] = useState<LogisticsTemplate[]>(() => 
    loadFromStorage('umrah_logistics_templates', [])
  );

  const [inputs, setInputs] = useState<InputState>({
    groupNo: '',
    groupName: '',
    count: '',
    text: ''
  });
  
  const [previewRows, setPreviewRows] = useState<LogisticsRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [isExcelReady, setIsExcelReady] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.XLSX) {
      setIsExcelReady(true);
    } else {
      const interval = setInterval(() => {
        if (window.XLSX) {
          setIsExcelReady(true);
          clearInterval(interval);
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, []);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'umrah_logistics_rows' && e.newValue) {
        setAllRows(JSON.parse(e.newValue));
      }
      if (e.key === 'umrah_logistics_deleted' && e.newValue) {
        setDeletedRows(JSON.parse(e.newValue));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('umrah_logistics_rows', JSON.stringify(allRows));
    } catch (e) {
      console.error("Failed to save rows", e);
      showNotification("فشل الحفظ التلقائي - المساحة ممتلئة", "error");
    }
  }, [allRows]);

  useEffect(() => {
    try {
      localStorage.setItem('umrah_logistics_deleted', JSON.stringify(deletedRows));
    } catch (e) {
      console.error("Failed to save deleted rows", e);
    }
  }, [deletedRows]);

  useEffect(() => {
    localStorage.setItem('umrah_logistics_templates', JSON.stringify(templates));
  }, [templates]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setInputs(prev => ({ ...prev, [name]: value }));
  };

  const showNotification = (msg: string, type: 'success' | 'error') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const handleExtract = () => {
    if (!inputs.groupNo || !inputs.groupName || !inputs.count) {
      showNotification("يرجى تعبئة جميع الحقول الأساسية (رقم المجموعة، الاسم، العدد)", "error");
      return;
    }
    if (!inputs.text.trim()) {
      showNotification("يرجى لصق نص الرحلة", "error");
      return;
    }
    try {
      const rows = parseItineraryText(inputs.text, {
        groupNo: inputs.groupNo,
        groupName: inputs.groupName,
        count: inputs.count
      });
      setPreviewRows(rows);
      setShowPreview(true);
      showNotification("تم استخراج البيانات بنجاح", "success");
    } catch (e) {
      showNotification("حدث خطأ أثناء تحليل النص", "error");
    }
  };

  const handlePreviewChange = (id: string, field: keyof LogisticsRow, value: string) => {
    setPreviewRows(prev => prev.map(row => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        if (['Column1', 'from', 'to'].includes(field as string)) {
             updated.tafweej = `${updated.Column1} — ${updated.from} → ${updated.to}`;
        }
        return updated;
    }));
  };

  const addToMainList = () => {
    setAllRows(prev => [...prev, ...previewRows]);
    setPreviewRows([]);
    setShowPreview(false);
    setInputs(prev => ({ ...prev, text: '' })); 
    showNotification("تمت إضافة الصفوف إلى القائمة الرئيسية", "success");
  };

  const updateMainRow = (id: string, field: keyof LogisticsRow, value: string) => {
     setAllRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const softDeleteRow = (id: string) => {
    const rowToDelete = allRows.find(r => r.id === id);
    if (!rowToDelete) return;
    setDeletedRows(prev => [rowToDelete, ...prev]);
    setAllRows(prev => prev.filter(r => r.id !== id));
    showNotification("تم نقل الصف إلى سلة المحذوفات", "success");
  };

  const handleDeleteAll = () => {
    if (allRows.length === 0) return;
    setConfirmModal({
        isOpen: true,
        title: "حذف الكل",
        message: "هل أنت متأكد من حذف جميع البيانات؟ سيتم نقلها إلى سلة المحذوفات.",
        type: 'danger',
        onConfirm: () => {
            setDeletedRows(prev => [...allRows, ...prev]);
            setAllRows([]);
            showNotification("تم نقل جميع البيانات", "success");
            setConfirmModal(null);
        }
    });
  };

  const restoreRow = (id: string) => {
    const rowToRestore = deletedRows.find(r => r.id === id);
    if (!rowToRestore) return;
    setAllRows(prev => [rowToRestore, ...prev]); 
    setDeletedRows(prev => prev.filter(r => r.id !== id));
    showNotification("تم استعادة الصف بنجاح", "success");
  };

  const permanentDeleteRow = (id: string) => {
    setConfirmModal({
        isOpen: true,
        title: "حذف نهائي",
        message: "هل أنت متأكد من الحذف النهائي؟ لا يمكن التراجع.",
        type: 'danger',
        onConfirm: () => {
            setDeletedRows(prev => prev.filter(r => r.id !== id));
            setConfirmModal(null);
        }
    });
  };

  const emptyRecycleBin = () => {
      if (deletedRows.length === 0) return;
      setConfirmModal({
          isOpen: true,
          title: "إفراغ السلة",
          message: "هل أنت متأكد من إفراغ سلة المحذوفات بالكامل؟",
          type: 'danger',
          onConfirm: () => {
            setDeletedRows([]);
            showNotification("تم إفراغ سلة المحذوفات", "success");
            setConfirmModal(null);
          }
      });
  };

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify({ version: 1, allRows, deletedRows }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_${getLocalDateString()}.json`;
    a.click();
    showNotification("تم حفظ النسخة الاحتياطية", "success");
  };

  const downloadExcel = () => {
    if (allRows.length === 0 || !window.XLSX) return;
    const excelData = allRows.map(row => ({
      "الحالة": STATUS_LABELS[row.status as TripStatus] || row.status,
      "الحركة": row.Column1,
      "تفويج": row.tafweej, 
      "نوع السيارة": row.carType,
      "إلى": row.to,
      "من": row.from,
      "وقت الرحلة": row.time,
      "رقم الرحلة": row.flight,
      "العدد": parseInt(row.count) || 0,
      "اسم المجموعة": row.groupName,
      "رقم مجموعة": row.groupNo,
      "تاريخ": row.date
    }));
    const ws = window.XLSX.utils.json_to_sheet(excelData);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Logistics");
    window.XLSX.writeFile(wb, `Umrah_Logistics_${getLocalDateString()}.xlsx`);
  };

  const triggerFileUpload = () => {
    if (fileInputRef.current) {
        fileInputRef.current.click();
    }
  };

  const getVal = (row: any, keys: string[]) => {
    const rowKeys = Object.keys(row);
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
      const found = rowKeys.find(k => k.trim().toLowerCase() === key.trim().toLowerCase());
      if (found) return row[found];
    }
    return "";
  };

  const parseExcelTime = (val: any) => {
    if (!val) return "";
    let str = String(val).trim();
    // Handle Arabic AM/PM (ص/م) like "07:30:00 ص"
    const isPM = str.includes('م') || str.toLowerCase().includes('pm');
    const isAM = str.includes('ص') || str.toLowerCase().includes('am');
    
    if (isAM || isPM) {
        const timeParts = str.match(/(\d{1,2}):(\d{2})/);
        if (timeParts) {
            let hours = parseInt(timeParts[1], 10);
            const minutes = timeParts[2];
            if (isPM && hours < 12) hours += 12;
            if (isAM && hours === 12) hours = 0;
            return `${String(hours).padStart(2, '0')}:${minutes}`;
        }
    }
    if (val instanceof Date) {
        return val.toTimeString().slice(0, 5);
    }
    const standardMatch = str.match(/^\d{1,2}:\d{2}/);
    if (standardMatch) {
        return standardMatch[0].padStart(5, '0');
    }
    return str;
  };

  const parseExcelDate = (val: any) => {
    if (!val) return "";
    if (val instanceof Date) {
      return getLocalDateString(val);
    }
    if (typeof val === 'number') {
        const d = new Date(Math.round((val - 25569) * 86400 * 1000));
        return getLocalDateString(d);
    }
    const str = String(val).trim();
    const match = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (match) {
        if (match[1]) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
        return `${match[6]}-${match[5].padStart(2,'0')}-${match[4].padStart(2,'0')}`;
    }
    return str;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            if (file.name.toLowerCase().endsWith('.json')) {
                const data = JSON.parse(evt.target?.result as string);
                if (data.allRows) setAllRows(data.allRows.map((r: any) => ({ ...r, id: r.id || uid() })));
                if (data.deletedRows) setDeletedRows(data.deletedRows.map((r: any) => ({ ...r, id: r.id || uid() })));
                showNotification("تمت استعادة النسخة الاحتياطية", "success");
            } else {
                const bstr = evt.target?.result;
                const wb = window.XLSX.read(bstr, { type: 'binary', cellDates: true });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const data: any[] = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
                
                if (data.length === 0) {
                    showNotification("الملف فارغ", "error");
                    return;
                }

                const imported = data.map(r => ({
                    id: uid(),
                    groupNo: String(getVal(r, ['رقم مجموعة', 'رقم م', 'Group No', 'ID']) || ''),
                    groupName: String(getVal(r, ['اسم المجموعة', 'Name', 'Group Name']) || ''),
                    count: String(getVal(r, ['العدد', 'عدد', 'Count']) || '0'),
                    Column1: String(getVal(r, ['الحركة', 'نوع الحركة', 'Movement', 'Column1', 'الحركة من']) || ''),
                    date: parseExcelDate(getVal(r, ['تاريخ', 'التاريخ', 'Date'])),
                    time: parseExcelTime(getVal(r, ['وقت الرحلة', 'وقت', 'وقت الوصول', 'Time'])),
                    flight: String(getVal(r, ['رقم الرحلة', 'رحلة', 'Flight', 'Flight No', 'Flight']) || ''),
                    from: String(getVal(r, ['من', 'From', 'Starting Point', 'التحرك من']) || ''),
                    to: String(getVal(r, ['إلى', 'الى', 'To', 'Destination', 'التحرك الى']) || ''),
                    carType: String(getVal(r, ['نوع السيارة', 'السيارة', 'Car Type']) || ''),
                    tafweej: String(getVal(r, ['تفويج', 'التفويج', 'tafweej']) || ''),
                    status: 'Planned' as TripStatus
                }));
                
                // Flexible filter: only skip rows that are completely devoid of group or trip info
                const validRows = imported.filter(r => r.groupNo || r.groupName || r.from || r.to || r.flight || r.date);

                setPreviewRows(validRows);
                setShowPreview(true);
                showNotification(`تم استيراد ${validRows.length} صف`, "success");
            }
        } catch (err) {
            console.error(err);
            showNotification("خطأ في قراءة الملف", "error");
        }
    };
    if (file.name.toLowerCase().endsWith('.json')) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  };

  const handleNavigateWithFilters = (filters?: Record<string, string[]>) => {
      setActiveFilters(filters);
      setView('operational');
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // QUICK ACTIONS HANDLERS
  const handleAddNewRow = () => {
    const newRow: LogisticsRow = {
      id: uid(),
      groupNo: inputs.groupNo || '',
      groupName: inputs.groupName || '',
      count: inputs.count || '',
      Column1: 'مهمة جديدة',
      date: getLocalDateString(),
      time: '12:00',
      flight: '',
      from: '',
      to: '',
      carType: '',
      tafweej: 'لا',
      status: 'Planned'
    };
    setAllRows(prev => [newRow, ...prev]);
    showNotification("تم إضافة صف جديد", "success");
  };

  const handleDuplicateRow = (row: LogisticsRow) => {
    const duplicated: LogisticsRow = {
      ...row,
      id: uid(),
      status: 'Planned'
    };
    setAllRows(prev => [duplicated, ...prev]);
    showNotification("تم تكرار الرحلة بنجاح", "success");
  };

  const handleSaveAsTemplate = (row: LogisticsRow) => {
    const name = prompt("أدخل اسماً لهذا القالب (مثلاً: وصول جدة - مكة):", `${row.Column1} - ${row.to}`);
    if (!name) return;
    
    const newTemplate: LogisticsTemplate = {
      id: uid(),
      name,
      data: {
        Column1: row.Column1,
        from: row.from,
        to: row.to,
        carType: row.carType,
        tafweej: row.tafweej,
        time: row.time
      }
    };
    setTemplates(prev => [...prev, newTemplate]);
    showNotification("تم حفظ القالب", "success");
  };

  const handleApplyTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    
    const newRow: LogisticsRow = {
      id: uid(),
      groupNo: inputs.groupNo || '',
      groupName: inputs.groupName || '',
      count: inputs.count || '',
      date: getLocalDateString(),
      status: 'Planned',
      Column1: '', from: '', to: '', carType: '', tafweej: '', flight: '', time: '',
      ...template.data
    };
    setAllRows(prev => [newRow, ...prev]);
    showNotification(`تم تطبيق قالب: ${template.name}`, "success");
  };

  const handleCopyRowDetails = (row: LogisticsRow) => {
    const text = `*تفاصيل الرحلة:*
*المجموعة:* ${row.groupNo || '-'} - ${row.groupName || '-'}
*الحركة:* ${row.Column1 || '-'}
*التاريخ:* ${row.date || '-'}
*الوقت:* ${row.time || '-'}
*الرحلة:* ${row.flight || '-'}
*من:* ${row.from || '-'}
*إلى:* ${row.to || '-'}
*السيارة:* ${row.carType || '-'}
*الحالة:* ${STATUS_LABELS[row.status] || '-'}`;

    navigator.clipboard.writeText(text);
    showNotification("تم نسخ التفاصيل إلى الحافظة", "success");
  };

  return (
    <div className="min-h-screen bg-gray-50 text-right pb-20 relative" dir="rtl">
      {notification && (
        <div className={`fixed top-6 left-6 z-[60] px-6 py-4 rounded-lg shadow-xl text-white transform transition-all flex items-center gap-3 animate-bounce-in ${notification.type === 'error' ? 'bg-red-500' : 'bg-green-600'}`}>
          {notification.type === 'error' ? <AlertCircle size={24} /> : <Save size={24} />}
          <span className="font-medium">{notification.msg}</span>
        </div>
      )}

      {confirmModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-sm p-6">
                  <div className="flex flex-col items-center text-center">
                      <div className={`p-4 rounded-full mb-4 ${confirmModal.type === 'danger' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                          <AlertTriangle size={32} />
                      </div>
                      <h3 className="text-xl font-bold text-gray-800 mb-2">{confirmModal.title}</h3>
                      <p className="text-gray-500 mb-6">{confirmModal.message}</p>
                      <div className="flex gap-3 w-full">
                          <button onClick={() => setConfirmModal(null)} className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-bold">إلغاء</button>
                          <button onClick={confirmModal.onConfirm} className={`flex-1 px-4 py-2 text-white rounded-lg font-bold ${confirmModal.type === 'danger' ? 'bg-red-600' : 'bg-amber-500'}`}>نعم، متأكد</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls, .csv, .json" />

      <div className="bg-gradient-to-l from-slate-900 via-blue-900 to-indigo-900 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm">
                <Plane size={28} className="text-blue-100" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">نظام تفويج العمرة Pro</h1>
                <p className="text-blue-200 text-xs font-medium">لوحة تحكم الخدمات اللوجستية الذكية</p>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-white/10 p-1 rounded-xl backdrop-blur-md">
                <button 
                    onClick={() => setView('operational')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'operational' ? 'bg-white text-blue-900 shadow-sm' : 'text-blue-100 hover:bg-white/5'}`}
                >
                    <Settings size={16} />
                    لوحة العمليات
                </button>
                <button 
                    onClick={() => { setView('analytics'); setActiveFilters(undefined); }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'analytics' ? 'bg-white text-blue-900 shadow-sm' : 'text-blue-100 hover:bg-white/5'}`}
                >
                    <LayoutDashboard size={16} />
                    ذكاء العمليات
                </button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 mt-8 space-y-8">
        {view === 'analytics' ? (
            <OperationsIntelligence rows={allRows} onNavigateToTable={handleNavigateWithFilters} />
        ) : (
            <>
                <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                <div className="p-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
                <div className="p-8">
                    <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-700 p-2 rounded-lg"><Edit3 size={20} /></span>
                    إدخال بيانات الرحلة
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                        <div className="md:col-span-4 space-y-5">
                            <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">رقم المجموعة</label>
                                    <input type="text" name="groupNo" value={inputs.groupNo} onChange={handleInputChange} className="w-full border-gray-300 rounded-lg p-2.5 border transition-all" placeholder="1024" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم المجموعة</label>
                                    <input type="text" name="groupName" value={inputs.groupName} onChange={handleInputChange} className="w-full border-gray-300 rounded-lg p-2.5 border transition-all" placeholder="مجموعة الرحاب" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">العدد</label>
                                    <input type="number" name="count" value={inputs.count} onChange={handleInputChange} className="w-full border-gray-300 rounded-lg p-2.5 border transition-all" placeholder="4" />
                                </div>
                            </div>
                            </div>
                            <button onClick={handleExtract} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3.5 rounded-xl font-bold shadow-lg transition-all transform hover:-translate-y-0.5">
                                <FileText size={20} />
                                تحليل واستخراج
                            </button>
                        </div>
                        <div className="md:col-span-8 flex flex-col">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">نص البرنامج</label>
                            <textarea name="text" value={inputs.text} onChange={handleInputChange} className="w-full h-full min-h-[300px] border-gray-300 rounded-xl p-4 border font-mono text-sm resize-none bg-gray-50 transition-colors" placeholder="الصق نص الرحلة هنا..."></textarea>
                        </div>
                    </div>
                </div>
                </section>

                {showPreview && (
                    <section className="bg-white rounded-2xl shadow-xl border border-blue-200 overflow-hidden ring-4 ring-blue-50">
                        <div className="bg-blue-50/50 p-6 border-b border-blue-100 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-blue-900 flex items-center gap-2">معاينة النتائج</h2>
                            <div className="flex gap-3">
                                <button onClick={() => setShowPreview(false)} className="px-4 py-2 text-gray-600 font-medium">إلغاء</button>
                                <button onClick={addToMainList} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold">اعتماد</button>
                            </div>
                        </div>
                        <div className="p-6">
                            <TableEditor rows={previewRows} onChange={handlePreviewChange} isPreview={true} enableFiltering={false} />
                        </div>
                    </section>
                )}

                <section className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-visible mb-20">
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">سجل البيانات</h2>
                            <div className="flex gap-2">
                                <button onClick={downloadExcel} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg border border-emerald-100" title="تصدير إكسل"><Download size={18} /></button>
                                <button onClick={triggerFileUpload} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100" title="استيراد بيانات"><Upload size={18} /></button>
                                <button onClick={downloadBackup} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-100" title="نسخ احتياطي"><Database size={18} /></button>
                                <button onClick={() => setShowRecycleBin(true)} className="p-2 text-gray-400 hover:bg-gray-50 rounded-lg border border-gray-100" title="المحذوفات"><History size={18} /></button>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                        <button onClick={handleDeleteAll} className="px-4 py-1.5 rounded-lg text-sm font-bold bg-red-50 text-red-600">حذف الكل</button>
                        <button onClick={() => setIsEditing(!isEditing)} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${isEditing ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
                            {isEditing ? 'حفظ التعديلات' : 'تعديل البيانات'}
                        </button>
                        </div>
                    </div>
                    <div className="p-6 overflow-x-auto">
                        <TableEditor 
                            rows={allRows} 
                            onChange={updateMainRow} 
                            onDelete={softDeleteRow} 
                            isPreview={false} 
                            enableFiltering={true} 
                            readOnly={!isEditing}
                            externalFilters={activeFilters}
                            templates={templates}
                            onAddNewRow={handleAddNewRow}
                            onDuplicateRow={handleDuplicateRow}
                            onSaveAsTemplate={handleSaveAsTemplate}
                            onApplyTemplate={handleApplyTemplate}
                            onShareRow={handleCopyRowDetails}
                            onDeleteTemplate={(id) => setTemplates(prev => prev.filter(t => t.id !== id))}
                        />
                    </div>
                </section>
            </>
        )}
      </main>

      {showRecycleBin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in text-right">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="text-xl font-bold flex items-center gap-2"><Trash2 className="text-red-500" /> سلة المحذوفات</h3>
              <div className="flex gap-4">
                <button onClick={emptyRecycleBin} className="text-red-600 text-sm font-bold">إفراغ السلة</button>
                <button onClick={() => setShowRecycleBin(false)}><XCircle size={24} /></button>
              </div>
            </div>
            <div className="overflow-y-auto p-6">
              {deletedRows.length > 0 ? (
                <table className="w-full text-sm">
                  <thead><tr><th className="p-3">المجموعة</th><th className="p-3">الحركة</th><th className="p-3">التاريخ</th><th className="p-3 text-center">إجراءات</th></tr></thead>
                  <tbody>{deletedRows.map(row => (
                    <tr key={row.id} className="border-b">
                      <td className="p-3 font-bold">{row.groupNo} - {row.groupName}</td>
                      <td className="p-3">{row.Column1}</td>
                      <td className="p-3">{row.date}</td>
                      <td className="p-3 flex justify-center gap-2">
                        <button onClick={() => restoreRow(row.id)} className="p-2 bg-green-50 text-green-600 rounded-full"><RotateCcw size={16} /></button>
                        <button onClick={() => permanentDeleteRow(row.id)} className="p-2 bg-red-50 text-red-600 rounded-full"><XCircle size={16} /></button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <div className="text-center py-20 text-gray-400">سلة المحذوفات فارغة</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
