import React, { useState, useEffect, useRef } from 'react';
import { Download, Edit3, FileText, AlertCircle, Save, Plane, Bus, Users, ClipboardList, Upload, Trash2, History, RotateCcw, XCircle, Eraser, Calendar, Clock } from 'lucide-react';
import { LogisticsRow, InputState, NotificationState } from './types';
import { parseItineraryText } from './utils/parser';
import { TableEditor } from './components/TableEditor';

export default function App() {
  const [inputs, setInputs] = useState<InputState>({
    groupNo: '',
    groupName: '',
    count: '',
    text: ''
  });
  
  const [previewRows, setPreviewRows] = useState<LogisticsRow[]>([]);
  const [allRows, setAllRows] = useState<LogisticsRow[]>([]);
  const [deletedRows, setDeletedRows] = useState<LogisticsRow[]>([]); // Recycle Bin State
  const [showPreview, setShowPreview] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [isExcelReady, setIsExcelReady] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if SheetJS is loaded
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

  // Load Main Data
  useEffect(() => {
    const saved = localStorage.getItem('umrah_logistics_rows');
    if (saved) {
      try {
        setAllRows(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load saved data");
      }
    }
    // Load Deleted Data
    const savedDeleted = localStorage.getItem('umrah_logistics_deleted');
    if (savedDeleted) {
        try {
            setDeletedRows(JSON.parse(savedDeleted));
        } catch (e) {
            console.error("Failed to load deleted data");
        }
    }
  }, []);

  // Save Data
  useEffect(() => {
    localStorage.setItem('umrah_logistics_rows', JSON.stringify(allRows));
  }, [allRows]);

  useEffect(() => {
    localStorage.setItem('umrah_logistics_deleted', JSON.stringify(deletedRows));
  }, [deletedRows]);

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
      showNotification("تم استخراج البيانات بنجاح، يرجى المراجعة قبل الإضافة", "success");
    } catch (e) {
      showNotification("حدث خطأ أثناء تحليل النص", "error");
    }
  };

  const handlePreviewChange = (index: number, field: keyof LogisticsRow, value: string) => {
    const updated = [...previewRows];
    // @ts-ignore - dynamic assignment
    updated[index][field] = value;
    
    if (['Column1', 'from', 'to'].includes(field as string)) {
        const row = updated[index];
        row.tafweej = `${row.Column1} — ${row.from} → ${row.to}`;
    }
    
    setPreviewRows(updated);
  };

  const addToMainList = () => {
    setAllRows(prev => [...prev, ...previewRows]);
    setPreviewRows([]);
    setShowPreview(false);
    setInputs(prev => ({ ...prev, text: '' })); 
    showNotification("تمت إضافة الصفوف إلى القائمة الرئيسية", "success");
  };

  const updateMainRow = (index: number, field: keyof LogisticsRow, value: string) => {
     const updated = [...allRows];
     // @ts-ignore - dynamic assignment
     updated[index][field] = value;
     setAllRows(updated);
  };

  // --- Delete & Recycle Bin Logic ---

  const softDeleteRow = (index: number) => {
    const rowToDelete = allRows[index];
    setDeletedRows(prev => [rowToDelete, ...prev]);
    setAllRows(prev => prev.filter((_, i) => i !== index));
    showNotification("تم نقل الصف إلى سلة المحذوفات", "success");
  };

  const restoreRow = (index: number) => {
    const rowToRestore = deletedRows[index];
    setAllRows(prev => [rowToRestore, ...prev]); 
    setDeletedRows(prev => prev.filter((_, i) => i !== index));
    showNotification("تم استعادة الصف بنجاح", "success");
  };

  const permanentDeleteRow = (index: number) => {
    if (window.confirm("هل أنت متأكد من الحذف النهائي؟ لا يمكن التراجع عن هذا الإجراء.")) {
        setDeletedRows(prev => prev.filter((_, i) => i !== index));
    }
  };

  const emptyRecycleBin = () => {
      if (deletedRows.length === 0) return;
      if (window.confirm("هل أنت متأكد من إفراغ سلة المحذوفات بالكامل؟")) {
          setDeletedRows([]);
          showNotification("تم إفراغ سلة المحذوفات", "success");
      }
  };

  // --- Excel Export & Import Logic ---

  const downloadExcel = () => {
    if (allRows.length === 0) {
        showNotification("لا توجد بيانات للتصدير", "error");
        return;
    }
    
    if (!window.XLSX) {
        showNotification("مكتبة الإكسل لم يتم تحميلها بعد، انتظر قليلاً...", "error");
        return;
    }

    const XLSX = window.XLSX;

    const excelData = allRows.map(row => ({
      "Column1": row.Column1,
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

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Logistics");
    
    const wscols = [
        {wch: 10}, {wch: 10}, {wch: 10}, {wch: 15}, {wch: 15}, {wch: 10}, {wch: 10}, {wch: 5}, {wch: 20}, {wch: 10}, {wch: 15}
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Logistics_Plan_${new Date().toISOString().slice(0,10)}.xlsx`);
    showNotification("تم تنزيل ملف الإكسل", "success");
  };

  const triggerFileUpload = () => {
    if (fileInputRef.current) {
        fileInputRef.current.click();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.XLSX) {
        showNotification("مكتبة الإكسل غير جاهزة", "error");
        return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const bstr = evt.target?.result;
            const wb = window.XLSX.read(bstr, { type: 'binary', cellDates: true });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            
            const data: any[] = window.XLSX.utils.sheet_to_json(ws, { defval: "" });

            if (data.length === 0) {
                showNotification("الملف فارغ", "error");
                return;
            }

            const getVal = (row: any, keys: string[]) => {
                const rowKeys = Object.keys(row);
                for (const key of keys) {
                    if (row[key] !== undefined) return row[key];
                    const cleanKey = rowKeys.find(k => k.trim() === key.trim());
                    if (cleanKey) return row[cleanKey];
                }
                return "";
            };

            const formatExcelDate = (val: any) => {
                if (!val) return "";
                if (val instanceof Date) {
                    const offset = val.getTimezoneOffset() * 60000;
                    const localDate = new Date(val.getTime() - offset);
                    return localDate.toISOString().split('T')[0];
                }
                const str = String(val).trim();
                const d = new Date(str);
                if (!isNaN(d.getTime())) {
                     return d.toISOString().split('T')[0];
                }
                return str;
            };

            const formatExcelTime = (val: any) => {
                if (!val) return "";
                if (val instanceof Date) {
                    const h = val.getHours().toString().padStart(2, '0');
                    const m = val.getMinutes().toString().padStart(2, '0');
                    return `${h}:${m}`;
                }
                const str = String(val);
                if (str.includes("1899") || str.includes("Standard Time")) {
                    const d = new Date(str);
                    if (!isNaN(d.getTime())) {
                        const h = d.getHours().toString().padStart(2, '0');
                        const m = d.getMinutes().toString().padStart(2, '0');
                        return `${h}:${m}`;
                    }
                }
                return str;
            };

            const mappedRows: LogisticsRow[] = data.map((row) => {
                return {
                    Column1: getVal(row, ["Column1", "الحركة", "Movement"]),
                    tafweej: getVal(row, ["تفويج", "التفويج", "tafweej"]) || "لا",
                    carType: getVal(row, ["نوع السيارة", "Car Type", "سيارة"]),
                    from: getVal(row, ["من", "From", "Start"]),
                    to: getVal(row, ["إلى", "To", "Destination", "الى"]),
                    time: formatExcelTime(getVal(row, ["وقت الرحلة", "Time", "وقت"])),
                    flight: getVal(row, ["رقم الرحلة", "Flight No", "Flight", "رقم رحلة"]),
                    count: String(getVal(row, ["العدد", "Count", "count"]) || "0"),
                    groupName: getVal(row, ["اسم المجموعة", "Group Name", "Name"]),
                    groupNo: String(getVal(row, ["رقم مجموعة", "رقم المجموعة", "Group No", "Group ID"])),
                    date: formatExcelDate(getVal(row, ["تاريخ", "التاريخ", "Date"]))
                };
            });

            const validRows = mappedRows.filter(r => r.groupNo || r.groupName || r.from);

            if (validRows.length === 0) {
                 showNotification("لم يتم العثور على بيانات صالحة في الملف", "error");
                 return;
            }

            setPreviewRows(validRows);
            setShowPreview(true);
            showNotification(`تم استيراد ${validRows.length} صف. يرجى المراجعة والاعتماد.`, "success");

        } catch (error) {
            console.error(error);
            showNotification("حدث خطأ أثناء قراءة الملف، تأكد من الصيغة", "error");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };
    reader.readAsBinaryString(file);
  };

  // --- Today / Tomorrow Calculation ---
  const todayDate = new Date();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);

  const formatDateKey = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
  };

  const todayStr = formatDateKey(todayDate);
  const tomorrowStr = formatDateKey(tomorrowDate);

  const todayCount = allRows.filter(r => r.date?.trim() === todayStr).length;
  const tomorrowCount = allRows.filter(r => r.date?.trim() === tomorrowStr).length;

  return (
    <div className="min-h-screen bg-gray-50 text-right pb-20 relative" dir="rtl">
      
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-6 left-6 z-[60] px-6 py-4 rounded-lg shadow-xl text-white transform transition-all duration-300 flex items-center gap-3 animate-bounce-in ${notification.type === 'error' ? 'bg-red-500' : 'bg-green-600'}`}>
          {notification.type === 'error' ? <AlertCircle size={24} /> : <Save size={24} />}
          <span className="font-medium">{notification.msg}</span>
        </div>
      )}

      {/* Hidden Inputs */}
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls, .csv" />

      {/* Recycle Bin Modal */}
      {showRecycleBin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
              <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <Trash2 className="text-red-500" />
                سلة المحذوفات
                <span className="text-sm font-normal text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{deletedRows.length}</span>
              </h3>
              <div className="flex gap-2">
                <button onClick={emptyRecycleBin} disabled={deletedRows.length === 0} className="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1">
                  <Eraser size={16} />
                  إفراغ السلة
                </button>
                <button onClick={() => setShowRecycleBin(false)} className="text-gray-500 hover:bg-gray-200 p-2 rounded-full transition-colors">
                  <XCircle size={24} />
                </button>
              </div>
            </div>
            
            <div className="overflow-y-auto flex-1 p-6">
              {deletedRows.length > 0 ? (
                <table className="w-full text-sm text-right">
                  <thead className="bg-gray-50 text-gray-700 sticky top-0">
                    <tr>
                      <th className="p-3 rounded-r-lg">المجموعة</th>
                      <th className="p-3">الحركة</th>
                      <th className="p-3">من / إلى</th>
                      <th className="p-3">التاريخ</th>
                      <th className="p-3 rounded-l-lg text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {deletedRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-3">
                          <div className="font-bold">{row.groupNo}</div>
                          <div className="text-xs text-gray-500">{row.groupName}</div>
                        </td>
                        <td className="p-3">{row.Column1}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1 text-xs">
                             <span className="text-gray-500">من:</span> {row.from}
                          </div>
                          <div className="flex items-center gap-1 text-xs mt-1">
                             <span className="text-gray-500">إلى:</span> {row.to}
                          </div>
                        </td>
                        <td className="p-3 text-gray-600">{row.date}</td>
                        <td className="p-3 flex justify-center gap-2">
                          <button onClick={() => restoreRow(idx)} className="p-2 text-green-600 bg-green-50 hover:bg-green-100 rounded-full transition-colors">
                            <RotateCcw size={16} />
                          </button>
                          <button onClick={() => permanentDeleteRow(idx)} className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-full transition-colors">
                            <XCircle size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <Trash2 size={48} className="mb-4 opacity-20" />
                  <p>سلة المحذوفات فارغة</p>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl text-center">
               <button onClick={() => setShowRecycleBin(false)} className="bg-gray-800 text-white px-6 py-2 rounded-lg hover:bg-gray-900 transition-colors">إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {/* Hero Header */}
      <div className="bg-gradient-to-l from-blue-900 via-blue-800 to-blue-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            
            {/* Title Section */}
            <div className="flex items-center gap-4">
              <div className="bg-white/10 p-3 rounded-2xl backdrop-blur-sm">
                <Plane size={36} className="text-blue-100" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">نظام تفويج العمرة</h1>
                <p className="text-blue-200 mt-1 text-lg">تحويل نصوص البرامج إلى جداول بيانات لوجستية ذكية</p>
              </div>
            </div>

            {/* Stats & Actions Section */}
            <div className="flex flex-col items-center md:items-end gap-4 w-full md:w-auto">
               
               {/* Urgent Stats Cards */}
               <div className="flex gap-4 w-full md:w-auto">
                  <div className="bg-white/10 border border-white/20 rounded-xl p-3 flex-1 md:flex-initial min-w-[150px] flex items-center gap-3 backdrop-blur-md transition-transform hover:scale-105">
                       <div className="bg-amber-500 p-2.5 rounded-lg text-white shadow-lg animate-pulse">
                          <Clock size={22} />
                       </div>
                       <div>
                          <div className="text-amber-200 text-xs font-bold mb-0.5 tracking-wide">رحلات اليوم</div>
                          <div className="text-2xl font-black text-white leading-none">{todayCount}</div>
                       </div>
                  </div>

                  <div className="bg-white/10 border border-white/20 rounded-xl p-3 flex-1 md:flex-initial min-w-[150px] flex items-center gap-3 backdrop-blur-md transition-transform hover:scale-105">
                       <div className="bg-blue-400 p-2.5 rounded-lg text-white shadow-lg">
                          <Calendar size={22} />
                       </div>
                       <div>
                          <div className="text-blue-200 text-xs font-bold mb-0.5 tracking-wide">رحلات الغد</div>
                          <div className="text-2xl font-black text-white leading-none">{tomorrowCount}</div>
                       </div>
                  </div>
               </div>

               {/* Action Buttons */}
               <div className="flex flex-wrap gap-3 justify-center md:justify-end w-full">
                  <button 
                      onClick={() => setShowRecycleBin(true)}
                      className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-lg font-medium border border-white/20 transition-all relative"
                  >
                      <History size={20} />
                      المحذوفات
                      {deletedRows.length > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-blue-800">
                          {deletedRows.length}
                        </span>
                      )}
                  </button>

                  <div className="bg-blue-900/50 px-4 py-2 rounded-lg border border-blue-500/30 flex items-center gap-2">
                      <ClipboardList size={18} className="text-blue-300" />
                      <span className="text-sm font-medium">{allRows.length} صفوف</span>
                  </div>
                  
                  <button 
                      onClick={triggerFileUpload}
                      disabled={!isExcelReady}
                      className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-indigo-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
                  >
                      <Upload size={20} />
                      استيراد
                  </button>

                  <button 
                      onClick={downloadExcel}
                      disabled={allRows.length === 0 || !isExcelReady}
                      className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
                  >
                      <Download size={20} />
                      تصدير
                  </button>
               </div>
            </div>

          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 -mt-8 space-y-8">
        
        {/* Input Card */}
        <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="p-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
          <div className="p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <span className="bg-blue-100 text-blue-700 p-2 rounded-lg"><Edit3 size={20} /></span>
              إدخال بيانات الرحلة
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                {/* Left Side Inputs */}
                <div className="md:col-span-4 space-y-5">
                    <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
                      <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">رقم المجموعة</label>
                            <input 
                                type="text" name="groupNo" value={inputs.groupNo} onChange={handleInputChange}
                                className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 p-2.5 border transition-all"
                                placeholder="مثال: 1024"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم المجموعة</label>
                            <input 
                                type="text" name="groupName" value={inputs.groupName} onChange={handleInputChange}
                                className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 p-2.5 border transition-all"
                                placeholder="مثال: مجموعة الرحاب"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex justify-between">
                              العدد
                              <span className="text-xs text-gray-400 font-normal">يحدد نوع السيارة تلقائياً</span>
                            </label>
                            <div className="relative">
                              <input 
                                  type="number" name="count" value={inputs.count} onChange={handleInputChange}
                                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 p-2.5 pl-10 border transition-all"
                                  placeholder="مثال: 4"
                              />
                              <Users className="absolute left-3 top-3 text-gray-400" size={18} />
                            </div>
                        </div>
                      </div>
                    </div>

                    <button 
                        onClick={handleExtract}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3.5 rounded-xl font-bold text-lg shadow-lg shadow-blue-600/20 transition-all transform hover:-translate-y-0.5 active:scale-95"
                    >
                        <FileText size={20} />
                        تحليل واستخراج
                    </button>
                </div>

                {/* Right Side Text Area */}
                <div className="md:col-span-8 flex flex-col">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">نص البرنامج (انسخ والصق هنا)</label>
                    <div className="relative flex-1">
                      <textarea 
                          name="text" 
                          value={inputs.text} 
                          onChange={handleInputChange}
                          className="w-full h-full min-h-[320px] border-gray-300 rounded-xl shadow-inner focus:ring-2 focus:ring-blue-500 focus:border-blue-500 p-4 border font-mono text-sm leading-relaxed resize-none bg-gray-50 focus:bg-white transition-colors"
                          placeholder={`الصق نص الرحلة هنا... 
مثال:
رحلة الوصول:
التاريخ: 2025-10-15
المطار: جدة
...`}
                      ></textarea>
                      <div className="absolute top-4 left-4 pointer-events-none opacity-20">
                        <FileText size={100} />
                      </div>
                    </div>
                </div>
            </div>
          </div>
        </section>

        {/* Preview Section */}
        {showPreview && (
             <section className="bg-white rounded-2xl shadow-xl border border-blue-200 overflow-hidden ring-4 ring-blue-50 animate-fade-in-up">
                <div className="bg-blue-50/50 p-6 border-b border-blue-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                          <span className="bg-white text-blue-600 p-1.5 rounded-md shadow-sm border border-blue-100"><Edit3 size={20} /></span>
                          معاينة النتائج المستخرجة
                      </h2>
                      <p className="text-blue-600 text-sm mt-1 mr-10">يمكنك تعديل البيانات في الجدول أدناه قبل الحفظ النهائي</p>
                    </div>
                    <div className="flex gap-3">
                        <button 
                          onClick={() => setShowPreview(false)} 
                          className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                        >
                          إلغاء
                        </button>
                        <button 
                          onClick={addToMainList} 
                          className="bg-blue-600 text-white px-6 py-2 rounded-lg shadow-md hover:bg-blue-700 hover:shadow-lg transition-all flex items-center gap-2 font-bold"
                        >
                            <Save size={18} />
                            اعتماد وإضافة للقائمة
                        </button>
                    </div>
                </div>
                <div className="p-6">
                    <TableEditor rows={previewRows} onChange={handlePreviewChange} isPreview={true} enableFiltering={false} />
                    <div className="mt-4 flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-100 text-sm">
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <p>تلميح: الحقول الملونة باللون الأحمر تشير إلى بيانات فارغة قد تحتاج إلى إدخال يدوي. تأكد من صحة التواريخ وأسماء المدن.</p>
                    </div>
                </div>
             </section>
        )}

        {/* Main List Section */}
        <section className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-visible mb-20">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Bus className="text-gray-400" size={20} />
                  سجل البيانات
                </h2>
                <div className="bg-gray-100 px-3 py-1 rounded-full text-xs font-bold text-gray-500">
                  Total: {allRows.length}
                </div>
            </div>
            
            <div className="p-6">
              {allRows.length > 0 ? (
                  <TableEditor rows={allRows} onChange={updateMainRow} onDelete={softDeleteRow} isPreview={false} enableFiltering={true} />
              ) : (
                  <div className="text-center py-20 flex flex-col items-center justify-center text-gray-400 bg-gray-50/50 rounded-xl border-2 border-dashed border-gray-200">
                      <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                        <ClipboardList size={40} className="text-gray-300" />
                      </div>
                      <p className="font-medium text-lg">القائمة فارغة حالياً</p>
                      <p className="text-sm mt-1">ابدأ بإدخال بيانات مجموعة جديدة وتحليلها</p>
                  </div>
              )}
            </div>
        </section>

      </main>
    </div>
  );
}