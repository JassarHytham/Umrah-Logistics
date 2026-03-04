import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, Edit3, FileText, AlertCircle, Save, Plane, Bus, Users, 
  ClipboardList, Upload, Trash2, History, RotateCcw, XCircle, 
  Eraser, Calendar, Clock, Check, FileJson, Database, AlertTriangle, 
  LayoutDashboard, Settings, Plus, Copy, Share2, Bookmark, 
  CheckSquare, Square, Type, Minus, PlusCircle, RotateCw, Bell, BellRing, Smartphone, Bot, Send, ShieldCheck,
  Info,
  ExternalLink,
  Zap,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { LogisticsRow, InputState, NotificationState, TripStatus, LogisticsTemplate, TelegramConfig } from './types';
import { parseItineraryText, parseDateTime } from './utils/parser';
import { TableEditor } from './components/TableEditor';
import { OperationsIntelligence } from './components/OperationsIntelligence';
import { LogisticsBot } from './components/LogisticsBot';
import { Auth } from './components/Auth';
import { api } from './services/api';

const loadFromStorage = (key: string, defaultValue: any) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

/**
 * Escapes characters for Telegram HTML parse_mode
 */
const escapeHTML = (str: string) => {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m] || m));
};

export const getLocalDateString = (date: Date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${d}/${m}/${y}`;
};

const STATUS_LABELS: Record<TripStatus, string> = {
  'Planned': 'مخطط', 'Confirmed': 'مؤكد', 'Driver Assigned': 'تم تعيين السائق',
  'In Progress': 'قيد التنفيذ', 'Completed': 'مكتمل', 'Delayed': 'متأخر', 'Cancelled': 'ملغي',
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'operational' | 'analytics' | 'automation'>('operational');
  const [allRows, setAllRows] = useState<LogisticsRow[]>([]);
  const [deletedRows, setDeletedRows] = useState<LogisticsRow[]>([]);
  const [templates, setTemplates] = useState<LogisticsTemplate[]>([]);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>({ token: '', chatId: '', enabled: false });
  
  const [inputs, setInputs] = useState<InputState>({ groupNo: '', groupName: '', count: '', text: '' });
  const [previewRows, setPreviewRows] = useState<LogisticsRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [filteredRows, setFilteredRows] = useState<LogisticsRow[]>([]);
  const [fontSize, setFontSize] = useState<number>(() => Number(loadFromStorage('umrah_font_size', 100)));
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const [isTestingTg, setIsTestingTg] = useState(false);

  // Initial Load
  useEffect(() => {
    const token = localStorage.getItem('umrah_auth_token');
    if (token) {
      // We assume the token is valid for now, or the first API call will fail and trigger logout
      setUser({ token }); // Minimal user object
      loadUserData();
    } else {
      setLoading(false);
    }
  }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      const [rows, settings] = await Promise.all([
        api.data.fetchRows(),
        api.settings.fetch()
      ]);
      setAllRows(rows);
      setDeletedRows(settings.deletedRows || []);
      setTgConfig(settings.tgConfig || { token: '', chatId: '', enabled: false });
      setTemplates(settings.templates || []);
      setFontSize(settings.fontSize || 100);

      // Legacy Migration: If backend is empty but local storage has data, offer to import
      if (rows.length === 0) {
        const localRows = loadFromStorage('umrah_logistics_rows', []);
        if (localRows.length > 0) {
          if (window.confirm("تم العثور على بيانات قديمة في هذا المتصفح. هل تريد استيرادها إلى حسابك الجديد؟")) {
            setAllRows(localRows);
            setDeletedRows(loadFromStorage('umrah_logistics_deleted', []));
            setTemplates(loadFromStorage('umrah_logistics_templates', []));
            setTgConfig(loadFromStorage('umrah_tg_config', { token: '', chatId: '', enabled: false }));
            // Clear local storage to prevent repeated prompts
            ['umrah_logistics_rows', 'umrah_logistics_deleted', 'umrah_logistics_templates', 'umrah_tg_config'].forEach(k => localStorage.removeItem(k));
          }
        }
      }
    } catch (err) {
      console.error("Failed to load data", err);
    } finally {
      setLoading(false);
    }
  };

  const syncAllData = async () => {
    if (!user) return;
    try {
      await Promise.all([
        api.data.syncRows(allRows),
        api.settings.save({ tgConfig, templates, deletedRows, fontSize })
      ]);
    } catch (err) {
      console.error("Sync failed", err);
    }
  };

  // Sync on changes (debounced or simple)
  useEffect(() => {
    if (user && !loading) {
      const timer = setTimeout(syncAllData, 2000);
      return () => clearTimeout(timer);
    }
  }, [allRows, deletedRows, tgConfig, templates, fontSize, user]);

  const notifiedIdsRef = useRef<Set<string>>(new Set(loadFromStorage('umrah_notified_trip_ids', [])));
  const [notifiedCount, setNotifiedCount] = useState(notifiedIdsRef.current.size);
  
  const tgLastUpdateId = useRef<number>(0);
  const isPollingRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tgConfigRef = useRef(tgConfig);
  const allRowsRef = useRef(allRows);
  useEffect(() => { tgConfigRef.current = tgConfig; }, [tgConfig]);
  useEffect(() => { allRowsRef.current = allRows; }, [allRows]);

  const requestNotificationPermission = async () => {
    if (typeof Notification !== 'undefined') {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission === 'granted') {
        showNotification("تم تفعيل التنبيهات بنجاح", "success");
      }
    }
  };

  const showNotification = (msg: string, type: 'success' | 'error') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const sendTelegram = async (message: string, overrideChatId?: string) => {
    const { token, chatId } = tgConfigRef.current;
    const targetId = overrideChatId || chatId;
    if (!token || !targetId) return false;
    
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: targetId, 
          text: message, 
          parse_mode: 'HTML' 
        })
      });
      const data = await res.json();
      if (!data.ok) {
        console.error("Telegram API Error:", data.description);
      }
      return data.ok;
    } catch (e) {
      console.error("Telegram Send Error:", e);
      return false;
    }
  };

  const handleTestTelegram = async () => {
    if (isTestingTg) return;
    setIsTestingTg(true);
    const testMsg = `<b>⚡️ اختبار اتصال نظام التفويج</b>\nتم الربط بنجاح! ستصلك التنبيهات هنا تلقائياً.\n<i>الوقت: ${new Date().toLocaleTimeString()}</i>`;
    const success = await sendTelegram(testMsg);
    if (success) {
      showNotification("تم إرسال رسالة تجريبية بنجاح", "success");
    } else {
      showNotification("فشل الاتصال، تحقق من التوكن والمعرف", "error");
    }
    setIsTestingTg(false);
  };

  // --- Telegram Listener (Polling) ---
  useEffect(() => {
    if (!tgConfig.enabled) return;

    const pollTelegram = async () => {
      const { token, enabled } = tgConfigRef.current;
      if (!enabled || !token) return;
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${tgLastUpdateId.current + 1}&timeout=10`);
        const data = await response.json();
        
        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            tgLastUpdateId.current = update.update_id;

            if (update.message && update.message.text) {
              // Ignore other bots to prevent "Forbidden: bots can't send messages to bots" errors
              if (update.message.from.is_bot) continue;

              const userQuery = update.message.text;
              const senderChatId = update.message.chat.id;

              const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
              const context = JSON.stringify(allRowsRef.current.map(r => ({
                group: r.groupNo, name: r.groupName, type: r.Column1,
                date: r.date, time: r.time, status: r.status, to: r.to
              })));

              const prompt = `أنت مساعد عمليات لوجستية لشركة عمرة. البيانات الحالية: ${context}. 
              أجب على سؤال المستخدم بشكل مباشر، بسيط، وواضح جداً باللغة العربية.
              يجب أن يكون الرد عبارة عن رسالة واحدة فقط، مختصرة، وبدون تكرار.
              سؤال المستخدم: ${userQuery}`;

              const aiRes = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
              });

              const replyText = aiRes.text?.trim() || "عذراً لم أفهم الطلب.";
              // Always escape HTML for dynamic AI content
              await sendTelegram(escapeHTML(replyText), String(senderChatId));
            }
          }
        }
      } catch (e) {
        console.error("Telegram Polling Error:", e);
      } finally {
        isPollingRef.current = false;
      }
    };

    const interval = setInterval(pollTelegram, 5000);
    return () => clearInterval(interval);
  }, [tgConfig.enabled]);

  // --- Proximity Alerts (Browser + Telegram) ---
  useEffect(() => {
    const checkAlerts = () => {
      const now = new Date();
      let hasUpdates = false;

      allRowsRef.current.forEach(row => {
        if (!row.date || !row.time || notifiedIdsRef.current.has(row.id)) return;
        
        const tripDate = parseDateTime(row.date, row.time);
        if (!tripDate) return;

        const diffMinutes = (tripDate.getTime() - now.getTime()) / (1000 * 60);
        
        if (diffMinutes > 0 && diffMinutes <= 130) {
          if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
            try {
              new Notification(`🔔 رحلة قادمة: ${row.flight || row.Column1}`, {
                body: `المجموعة: ${row.groupName} | الوجهة: ${row.to} | الوقت: ${row.time}`,
                icon: 'https://cdn-icons-png.flaticon.com/512/3002/3002655.png',
                tag: row.id
              });
            } catch (e) { console.error("Native Notif Error", e); }
          }

          if (tgConfigRef.current.enabled) {
            const flightStr = row.flight && row.flight !== '-' ? `✈️ <b>الرحلة:</b> <code>${escapeHTML(row.flight)}</code>\n` : '';
            const msg = `<b>🔔 تنبيه: رحلة قادمة خلال ساعتين</b>\n\n📦 <b>المجموعة:</b> ${escapeHTML(row.groupName)}\n🔢 <b>رقم م:</b> ${escapeHTML(row.groupNo)}\n${flightStr}🕒 <b>الوقت:</b> ${escapeHTML(row.time)}\n📍 <b>من:</b> ${escapeHTML(row.from)}\n📍 <b>إلى:</b> ${escapeHTML(row.to)}\n🚗 <b>نوع السيارة:</b> ${escapeHTML(row.carType)}\n📊 <b>الحالة:</b> ${STATUS_LABELS[row.status as TripStatus] || row.status}`;
            sendTelegram(msg);
          }
          
          notifiedIdsRef.current.add(row.id);
          hasUpdates = true;
        }
      });

      if (hasUpdates) {
        const updatedList = Array.from(notifiedIdsRef.current);
        localStorage.setItem('umrah_notified_trip_ids', JSON.stringify(updatedList));
        setNotifiedCount(updatedList.length);
      }
    };

    checkAlerts();
    const interval = setInterval(checkAlerts, 30000);
    return () => clearInterval(interval);
  }, [tgConfig.enabled]);

  // --- Persistence ---
  // Removed local storage persistence in favor of backend sync

  const changeFontSize = (delta: number) => {
    setFontSize(prev => Math.min(Math.max(prev + delta, 50), 200));
  };

  const handleExtract = () => {
    if (!inputs.groupNo || !inputs.groupName || !inputs.count || !inputs.text.trim()) {
      showNotification("يرجى تعبئة البيانات الأساسية", "error");
      return;
    }
    const rows = parseItineraryText(inputs.text, { groupNo: inputs.groupNo, groupName: inputs.groupName, count: inputs.count });
    setPreviewRows(rows);
    setShowPreview(true);
  };

  const downloadExcel = () => {
    const rowsToExport = filteredRows.length > 0 ? filteredRows : allRows;
    
    if (!window.XLSX) {
      showNotification("جاري تحميل مكتبة التصدير... يرجى المحاولة مرة أخرى", "error");
      return;
    }
    
    if (rowsToExport.length === 0) {
      showNotification("لا توجد بيانات لتصديرها", "error");
      return;
    }

    try {
      const excelData = rowsToExport.map(row => ({
        "الحالة": STATUS_LABELS[row.status as TripStatus] || row.status,
        "الحركة": row.Column1,
        "التفويج": row.tafweej, 
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
      window.XLSX.writeFile(wb, `Umrah_Logistics_${getLocalDateString().replace(/\//g, '-')}.xlsx`);
      showNotification("تم تصدير الملف بنجاح", "success");
    } catch (error) {
      console.error("Export error:", error);
      showNotification("فشل تصدير الملف: " + (error instanceof Error ? error.message : String(error)), "error");
    }
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
          showNotification("تمت استعادة النسخة الاحتياطية", "success");
        } else {
          const dataArray = evt.target?.result;
          const wb = window.XLSX.read(dataArray, { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data: any[] = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
          
          const getVal = (obj: any, keys: string[]) => {
            const objKeys = Object.keys(obj);
            for (const searchKey of keys) {
              const normalizedSearch = searchKey.trim().toLowerCase();
              // Try exact match
              if (obj[searchKey] !== undefined && obj[searchKey] !== null && obj[searchKey] !== "") return obj[searchKey];
              // Try normalized match
              const foundKey = objKeys.find(k => k.trim().toLowerCase() === normalizedSearch);
              if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null && obj[foundKey] !== "") return obj[foundKey];
            }
            return "";
          };

          const imported = data.map(r => {
            let d = getVal(r, ['تاريخ', 'التاريخ', 'Date', 'تاريخ الحركة']);
            let dateStr = '';
            if (d instanceof Date) {
              // Add 12 hours to the date to avoid timezone-related off-by-one errors
              // This ensures that even if the date is shifted by a few hours due to timezone,
              // it remains on the same calendar day.
              const adjustedDate = new Date(d.getTime() + (12 * 60 * 60 * 1000));
              const y = adjustedDate.getUTCFullYear();
              const m = String(adjustedDate.getUTCMonth() + 1).padStart(2, '0');
              const day = String(adjustedDate.getUTCDate()).padStart(2, '0');
              dateStr = `${day}/${m}/${y}`;
            } else if (typeof d === 'string' && d.trim()) {
              // Basic normalization for date strings like MM/DD/YYYY to DD/MM/YYYY if needed
              const parts = d.split(/[-/]/);
              if (parts.length === 3) {
                const p0 = parseInt(parts[0]);
                const p1 = parseInt(parts[1]);
                const p2 = parts[2];
                // If it looks like MM/DD/YYYY (p0 <= 12, p1 > 12)
                if (p0 <= 12 && p1 > 12 && p2.length >= 2) {
                  dateStr = `${String(p1).padStart(2, '0')}/${String(p0).padStart(2, '0')}/${p2}`;
                } else {
                  dateStr = `${String(parts[0]).padStart(2, '0')}/${String(parts[1]).padStart(2, '0')}/${parts[2]}`;
                }
              } else {
                dateStr = d;
              }
            } else {
              dateStr = String(d || '');
            }
            
            const movement = String(getVal(r, ['Column1', 'الحركة', 'نوع الحركة', 'نوع_الحركة']) || '');
            const from = String(getVal(r, ['من', 'From', 'المنشأ']) || '');
            const to = String(getVal(r, ['إلى', 'إلي', 'To', 'الوجهة']) || '');
            const tafweejStatus = String(getVal(r, ['تفويج', 'التفويج', 'Tafweej']) || '');

            return { 
              id: uid(), 
              groupNo: String(getVal(r, ['رقم مجموعة', 'رقم المجموعة', 'Group No', 'رقم_المجموعة']) || ''), 
              groupName: String(getVal(r, ['اسم المجموعة', 'Group Name', 'اسم_المجموعة']) || ''), 
              count: String(getVal(r, ['العدد', 'عدد', 'Count', 'عدد المعتمرين']) || '0'), 
              Column1: movement, 
              date: dateStr, 
              time: String(getVal(r, ['وقت الرحلة', 'الوقت', 'Time', 'وقت_الرحلة']) || ''), 
              flight: String(getVal(r, ['رقم الرحلة', 'الرحلة', 'Flight No', 'رقم_الرحلة', 'Flight']) || ''), 
              from: from, 
              to: to, 
              carType: String(getVal(r, ['نوع السيارة', 'السيارة', 'Car Type', 'نوع_السيارة']) || ''), 
              tafweej: tafweejStatus ? `${movement} — ${from} → ${to} (${tafweejStatus})` : `${movement} — ${from} → ${to}`, 
              status: 'Planned' as TripStatus 
            };
          });
          setPreviewRows(imported);
          setShowPreview(true);
        }
      } catch (err) { showNotification("خطأ في قراءة الملف", "error"); }
    };
    if (file.name.toLowerCase().endsWith('.json')) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  };

  const softDeleteRow = (id: string) => {
    const rowToDelete = allRows.find(r => r.id === id);
    if (!rowToDelete) return;
    setDeletedRows(prev => [rowToDelete, ...prev]);
    setAllRows(prev => prev.filter(r => r.id !== id));
  };

  const deleteAllRows = () => {
    if (allRows.length === 0) return;
    if (window.confirm("هل أنت متأكد من حذف جميع السجلات؟ سيتم نقلها لسلة المحذوفات.")) {
      setDeletedRows(prev => [...allRows, ...prev]);
      setAllRows([]);
      showNotification("تم نقل جميع السجلات لسلة المحذوفات", "success");
    }
  };

  const restoreAllRows = () => {
    if (deletedRows.length === 0) return;
    setAllRows(prev => [...deletedRows, ...prev]);
    setDeletedRows([]);
    showNotification("تم استعادة جميع السجلات", "success");
  };

  const addNewEmptyRow = () => {
    setAllRows([{
      id: uid(),
      groupNo: '',
      groupName: '',
      count: '0',
      Column1: 'غير محدد',
      date: getLocalDateString(),
      time: '00:00',
      flight: '-',
      from: '',
      to: '',
      carType: '',
      tafweej: '',
      status: 'Planned'
    }, ...allRows]);
  };

  const duplicateRow = (row: LogisticsRow) => {
    setAllRows([{ ...row, id: uid() }, ...allRows]);
    showNotification("تم تكرار الرحلة بنجاح", "success");
  };

  const saveAsTemplate = (row: LogisticsRow) => {
    const name = prompt("أدخل اسماً لهذا القالب:", `${row.Column1} - ${row.to}`);
    if (name) {
      const { id, date, ...rest } = row;
      setTemplates([...templates, { id: uid(), name, data: rest }]);
      showNotification("تم حفظ القالب", "success");
    }
  };

  const shareRowDetails = (row: LogisticsRow) => {
    const details = `📋 تفاصيل الرحلة:\n📦 المجموعة: ${row.groupName}\n🕒 التاريخ: ${row.date} @ ${row.time}\n📍 من: ${row.from}\n📍 إلى: ${row.to}\n🚗 السيارة: ${row.carType}\n✈️ الرحلة: ${row.flight}`;
    navigator.clipboard.writeText(details);
    showNotification("تم نسخ التفاصيل للحافظة", "success");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto" />
          <p className="text-gray-500 font-bold">جاري تحميل بياناتك الآمنة...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Auth onLogin={(u: any) => { setUser(u); loadUserData(); }} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-right pb-20 relative transition-all duration-300" dir="rtl" style={{ fontSize: `${fontSize}%` }}>
      {notification && (
        <div className={`fixed top-6 left-6 z-[60] px-6 py-4 rounded-lg shadow-xl text-white flex items-center gap-3 animate-bounce-in ${notification.type === 'error' ? 'bg-red-500' : 'bg-green-600'}`}>
          <AlertCircle size={24} /> <span>{notification.msg}</span>
        </div>
      )}

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      <div className="bg-gradient-to-l from-slate-900 via-blue-900 to-indigo-900 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex flex-col xl:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-white/10 p-2.5 rounded-xl"><Plane size={28} /></div>
            <div>
              <h1 className="text-xl font-bold">نظام تفويج العمرة Pro</h1>
              <p className="text-blue-200 text-xs">إدارة لوجستية متكاملة</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-white/10 px-4 py-2 rounded-xl border border-white/5">
              <Users size={16} className="text-blue-200" />
              <span className="text-sm font-bold">{user?.username || 'مستخدم'}</span>
              <button 
                onClick={() => api.auth.logout()}
                className="mr-2 text-xs bg-red-500/20 hover:bg-red-500/40 text-red-200 px-2 py-1 rounded-lg transition-all"
              >
                خروج
              </button>
            </div>
            <div className="flex bg-white/10 p-1 rounded-xl">
              <button onClick={() => setView('operational')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'operational' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><Settings size={16} className="inline ml-1" />العمليات</button>
              <button onClick={() => setView('analytics')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'analytics' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><LayoutDashboard size={16} className="inline ml-1" />الذكاء</button>
              <button onClick={() => setView('automation')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'automation' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><Bell size={16} className="inline ml-1" />الأتمتة</button>
            </div>
            <div className="flex items-center gap-1 bg-white/10 p-1 rounded-xl border border-white/5">
                <button onClick={() => changeFontSize(-5)} className="p-1.5 hover:bg-white/10 rounded-lg"><Minus size={14} /></button>
                <span className="text-xs font-black px-1">{fontSize}%</span>
                <button onClick={() => changeFontSize(5)} className="p-1.5 hover:bg-white/10 rounded-lg"><PlusCircle size={14} /></button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 mt-8 space-y-8">
        {view === 'automation' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in text-right">
            <section className="bg-white rounded-3xl shadow-xl border border-blue-50 overflow-hidden text-right" dir="rtl">
              <div className="bg-blue-600 p-8 text-white relative">
                <div className="relative z-10">
                  <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
                    <Send size={28} /> ربط بوت تيليجرام
                  </h2>
                  <p className="text-blue-100 text-sm">تنبيهات تلقائية ومساعد ذكي للرد على الاستفسارات</p>
                </div>
                <Zap size={120} className="absolute -bottom-10 -left-10 text-white/10 rotate-12" />
              </div>

              <div className="p-8 space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">توكن البوت (Bot Token)</label>
                  <input 
                    type="password" 
                    value={tgConfig.token} 
                    onChange={(e) => setTgConfig({...tgConfig, token: e.target.value})}
                    placeholder="7483XXXXXX:AAHyXXXXXX..." 
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-left"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">معرف الدردشة (Chat ID)</label>
                  <input 
                    type="text" 
                    value={tgConfig.chatId} 
                    onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})}
                    placeholder="مثال: 123456789" 
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-left"
                    dir="ltr"
                  />
                </div>
                
                <div className="pt-4 border-t border-gray-100 flex flex-col gap-4">
                  <div className="flex items-center justify-between bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${tgConfig.enabled ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-300'}`}></div>
                      <span className="text-sm font-bold text-blue-900">وضع التنبيهات التلقائية</span>
                    </div>
                    <button 
                      onClick={() => setTgConfig({...tgConfig, enabled: !tgConfig.enabled})}
                      className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${tgConfig.enabled ? 'bg-red-500 text-white shadow-lg hover:bg-red-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                    >
                      {tgConfig.enabled ? 'إيقاف الخدمة' : 'تشغيل الخدمة'}
                    </button>
                  </div>

                  <button 
                    onClick={handleTestTelegram}
                    disabled={!tgConfig.token || !tgConfig.chatId || isTestingTg}
                    className="w-full flex items-center justify-center gap-3 p-4 bg-white border-2 border-blue-600 text-blue-600 rounded-2xl font-black text-sm hover:bg-blue-50 transition-all active:scale-95 disabled:opacity-50 disabled:border-gray-300 disabled:text-gray-400"
                  >
                    {isTestingTg ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <Zap size={20} className="fill-current" />
                    )}
                    اختبار اتصال البوت الآن (إرسال رسالة تجريبية)
                  </button>
                </div>

                <div className="bg-gray-50 p-6 rounded-2xl text-[11px] text-gray-500 leading-relaxed border border-gray-100">
                   <p className="font-bold text-gray-700 mb-2 flex items-center gap-2">
                     <Info size={14} className="text-blue-500" /> كيف تحصل على المعرف الصحيح؟
                   </p>
                   <ol className="list-decimal mr-4 space-y-2 text-xs">
                     <li>ابحث عن البوت <b>@userinfobot</b> في تيليجرام.</li>
                     <li>أرسل له أي رسالة، سيعطيك رقم (ID) خاص بك.</li>
                     <li>انسخ هذا الرقم وضعه في حقل "معرف الدردشة" أعلاه.</li>
                     <li><b>تنبيه:</b> إذا وضعت رقم البوت نفسه (الذي يبدأ به التوكن)، فسيظهر خطأ "Forbidden: bots can't send messages to bots".</li>
                   </ol>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-emerald-600 p-8 text-white text-right">
                <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
                  <BellRing size={28} /> نظام المراقبة
                </h2>
                <p className="text-emerald-100 text-sm">إشعارات المتصفح والنظام الاستباقي</p>
              </div>

              <div className="p-8 space-y-6 text-right">
                <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Smartphone size={24} className="text-emerald-600" />
                      <h4 className="text-base font-bold text-emerald-900">إشعارات سطح المكتب</h4>
                    </div>
                    {notifPermission === 'granted' ? (
                      <span className="flex items-center gap-1.5 text-xs font-black text-emerald-700 bg-white px-3 py-1.5 rounded-full border border-emerald-200">
                        <CheckCircle2 size={16} /> مفعّل
                      </span>
                    ) : (
                      <button 
                        onClick={requestNotificationPermission}
                        className="text-xs font-bold bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 transition-all shadow-md"
                      >
                        تفعيل الإشعارات
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-emerald-700/80 leading-relaxed">
                    سيقوم النظام بإظهار تنبيه منبثق قبل 120 دقيقة من موعد أي حركة مجدولة، حتى وإن كانت الصفحة مصغرة أو في الخلفية.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-blue-200 transition-all">
                    <p className="text-4xl font-black text-blue-900 mb-1">{allRows.length}</p>
                    <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest">رحلة مسجلة</p>
                  </div>
                  <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-emerald-200 transition-all">
                    <p className="text-4xl font-black text-emerald-600 mb-1">{notifiedCount}</p>
                    <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest">إشعار تم إرساله</p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-5 bg-blue-50 rounded-2xl border border-blue-100">
                  <div className="text-blue-500 shrink-0 mt-0.5"><Info size={24} /></div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-blue-900">كيف يعمل نظام التنبيه التلقائي؟</p>
                    <p className="text-[11px] text-blue-700/70 leading-relaxed">
                      الماسح الذكي يعمل كل 30 ثانية للبحث عن أي رحلة يقترب موعدها (أقل من ساعتين). عند الاكتشاف، يرسل إشعاراً فورياً للتيليجرام والمتصفح معاً لضمان عدم تفويت أي حركة.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : view === 'analytics' ? (
          <OperationsIntelligence rows={allRows} onNavigateToTable={() => setView('operational')} />
        ) : (
          <>
            <section className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 overflow-hidden">
                <div className="p-1 bg-gradient-to-r from-blue-500 to-indigo-500 -mt-8 -mx-8 mb-8"></div>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-700 p-2 rounded-lg"><Edit3 size={20} /></span>
                    إدخال بيانات الرحلة
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                    <div className="md:col-span-4 space-y-4">
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-3">
                            <input type="text" placeholder="رقم المجموعة" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500" value={inputs.groupNo} onChange={(e) => setInputs({...inputs, groupNo: e.target.value})} />
                            <input type="text" placeholder="اسم المجموعة" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500" value={inputs.groupName} onChange={(e) => setInputs({...inputs, groupName: e.target.value})} />
                            <input type="number" placeholder="العدد" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500" value={inputs.count} onChange={(e) => setInputs({...inputs, count: e.target.value})} />
                        </div>
                        <button onClick={handleExtract} className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100">
                            <FileText size={20} /> تحليل واستخراج
                        </button>
                    </div>
                    <div className="md:col-span-8">
                        <textarea placeholder="الصق نص الرحلة هنا..." className="w-full h-[250px] p-4 border rounded-xl font-mono text-sm bg-gray-50 focus:bg-white transition-colors" value={inputs.text} onChange={(e) => setInputs({...inputs, text: e.target.value})}></textarea>
                    </div>
                </div>
            </section>

            {showPreview && (
              <section className="bg-white rounded-2xl shadow-xl border-2 border-blue-500 overflow-hidden animate-slide-up">
                <div className="bg-blue-500 p-4 flex justify-between items-center text-white">
                  <h3 className="font-bold flex items-center gap-2"><Clock size={18} /> معاينة النتائج قبل الاعتماد</h3>
                  <div className="flex gap-2">
                    <button onClick={() => setShowPreview(false)} className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-lg text-sm">إلغاء</button>
                    <button onClick={() => { setAllRows([...previewRows, ...allRows]); setShowPreview(false); setInputs({...inputs, text: ''}); showNotification("تم اعتماد الرحلات", "success"); }} className="bg-white text-blue-600 px-6 py-1.5 rounded-lg font-bold">حفظ واعتماد</button>
                  </div>
                </div>
                <div className="p-4"><TableEditor rows={previewRows} onChange={(id, f, v) => setPreviewRows(prev => prev.map(r => r.id === id ? {...r, [f]: v} : r))} isPreview={true} /></div>
              </section>
            )}

            <section className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 overflow-visible">
                <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
                    <div className="flex items-center gap-4">
                        <h3 className="font-bold text-gray-800">سجل العمليات اللوجستية</h3>
                        <div className="flex gap-1">
                            <button onClick={downloadExcel} title="تصدير إكسل" className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg border border-emerald-100 transition-colors"><Download size={18} /></button>
                            <button onClick={() => fileInputRef.current?.click()} title="استيراد إكسل / JSON" className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100 transition-colors"><Upload size={18} /></button>
                            <button onClick={() => setShowRecycleBin(true)} title="المحذوفات" className="p-2 text-gray-400 hover:bg-gray-50 rounded-lg border border-gray-100 transition-colors"><History size={18} /></button>
                            <button onClick={deleteAllRows} title="حذف الكل" className="p-2 text-red-500 hover:bg-red-50 rounded-lg border border-red-100 transition-colors"><Eraser size={18} /></button>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={() => setIsEditing(!isEditing)} className={`px-5 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${isEditing ? 'bg-green-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
                            {isEditing ? 'إنهاء التعديل وحفظ' : 'بدء تعديل الجدول'}
                        </button>
                    </div>
                </div>
                <div className="mt-2">
                    <TableEditor 
                        rows={allRows} 
                        onChange={(id, f, v) => setAllRows(prev => prev.map(r => r.id === id ? {...r, [f]: v} : r))} 
                        onDelete={softDeleteRow} 
                        isPreview={false} 
                        readOnly={!isEditing} 
                        enableFiltering={true}
                        templates={templates}
                        onAddNewRow={addNewEmptyRow}
                        onDuplicateRow={duplicateRow}
                        onSaveAsTemplate={saveAsTemplate}
                        onApplyTemplate={(tid) => {
                            const t = templates.find(x => x.id === tid);
                            if (t) setAllRows([{ id: uid(), ...t.data, date: getLocalDateString(), status: 'Planned' } as any, ...allRows]);
                        }}
                        onShareRow={shareRowDetails}
                        onDeleteTemplate={(tid) => setTemplates(templates.filter(x => x.id !== tid))}
                        onFilteredRowsChange={setFilteredRows}
                    />
                </div>
            </section>
          </>
        )}
      </main>

      <LogisticsBot rows={allRows} />

      {showRecycleBin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in text-right">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-red-50/50">
              <div className="flex items-center gap-4">
                <h3 className="text-xl font-bold flex items-center gap-2 text-red-700"><Trash2 /> سلة المحذوفات</h3>
                {deletedRows.length > 0 && (
                  <button 
                    onClick={restoreAllRows}
                    className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-green-700 transition-all flex items-center gap-1 shadow-sm"
                  >
                    <RotateCcw size={14} /> استعادة الكل
                  </button>
                )}
              </div>
              <button onClick={() => setShowRecycleBin(false)} className="p-2 hover:bg-white rounded-full transition-colors"><XCircle size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {deletedRows.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 font-bold"><tr className="border-b"> <th className="p-3">المجموعة</th> <th className="p-3">الحركة</th> <th className="p-3">الإجراء</th> </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {deletedRows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="p-4 font-bold">{row.groupName} ({row.groupNo})</td>
                        <td className="p-4">{row.Column1} - {row.to}</td>
                        <td className="p-4 flex gap-2">
                          <button onClick={() => { setAllRows([row, ...allRows]); setDeletedRows(p => p.filter(x => x.id !== row.id)); }} className="text-green-600 hover:bg-green-50 px-3 py-1 rounded-lg border border-green-100 flex items-center gap-1 text-xs"><RotateCcw size={14} /> استعادة</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="text-center py-20 text-gray-400 italic">لا يوجد سجلات محذوفة حالياً</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
