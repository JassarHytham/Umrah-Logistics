import React, { useState, useEffect, useRef } from 'react';
import {
  Download, Edit3, FileText, AlertCircle, Save, Plane, Bus, Users, ChevronDown,
  ClipboardList, Upload, Trash2, History, RotateCcw, XCircle,
  Eraser, Calendar, Clock, Check, FileJson, Database, AlertTriangle,
  LayoutDashboard, Settings as SettingsIcon, Share2,
  CheckSquare, Square, Type, Minus, PlusCircle, RotateCw, Bell, BellRing, Smartphone, Bot, Send, ShieldCheck, SlidersHorizontal,
  Info,
  ExternalLink,
  Zap,
  CheckCircle2,
  Loader2,
  MapPin,
  Menu,
  X
} from 'lucide-react';
import { LogisticsRow, InputState, NotificationState, TripStatus, TelegramConfig, AlertSettings, PreviewSettings, DisplaySettings, DEFAULT_COLUMN_ORDER, ShareInvitation, ShareAccessGrant, ShareRole } from './types';
import { parseItineraryText, parseDateTime } from './utils/parser';
import { TableEditor } from './components/TableEditor';
import { OperationsIntelligence } from './components/OperationsIntelligence';
import { Auth } from './components/Auth';
import { Settings } from './components/Settings';
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
  'In Progress': 'قيد التنفيذ', 'Completed': 'مكتمل', 'Delayed': 'متأخر', 'Cancelled': 'ملغي', 'Uncompleted': 'لم يكتمل',
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'operational' | 'analytics' | 'settings'>('operational');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [allRows, setAllRows] = useState<LogisticsRow[]>([]);
  const [deletedRows, setDeletedRows] = useState<LogisticsRow[]>([]);
  const [shareInvitations, setShareInvitations] = useState<ShareInvitation[]>([]);
  const [shareAccessGrants, setShareAccessGrants] = useState<ShareAccessGrant[]>([]);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>({ token: '', chatId: '', enabled: false });

  const [inputs, setInputs] = useState<InputState>({ groupNo: '', groupName: '', count: '', text: '' });
  const [previewRows, setPreviewRows] = useState<LogisticsRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showInvitations, setShowInvitations] = useState(false);
  const [inputSectionOpen, setInputSectionOpen] = useState(false);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [filteredRows, setFilteredRows] = useState<LogisticsRow[]>([]);
  const [fontSize, setFontSize] = useState<number>(100);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>({
    arrivalMinutes: 120,
    departureMinutes: 60,
    messageFields: { flight: true, carType: true, count: false, tafweej: false },
  });
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings>({
    requiredFields: ['groupName', 'groupNo', 'flight', 'date', 'time', 'from', 'to'],
    defaultStatus: 'Planned',
  });
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    density: 'compact',
    tableFontSize: 100,
    borderStyle: 'thin',
    noteHighlightEnabled: true,
    noteHighlightColor: 'amber',
    wrapCells: true,
    columnOrder: DEFAULT_COLUMN_ORDER,
    hiddenColumns: [],
  });
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const [isTestingTg, setIsTestingTg] = useState(false);

  const [notifiedIds, setNotifiedIds] = useState<string[]>([]);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const [notifiedCount, setNotifiedCount] = useState(0);
  const [shareTarget, setShareTarget] = useState<{ row: LogisticsRow; scope: 'row' | 'group' } | null>(null);
  const [shareReceiverUsername, setShareReceiverUsername] = useState('');
  const [shareRole, setShareRole] = useState<ShareRole>('editor');
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    notifiedIdsRef.current = new Set(notifiedIds);
    setNotifiedCount(notifiedIds.length);
  }, [notifiedIds]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  // Initial Load
  useEffect(() => {
    const token = localStorage.getItem('umrah_auth_token');
    if (token && typeof token === 'string' && token.split('.').length === 3) {
      // We assume the token is valid for now, or the first API call will fail and trigger logout
      const savedUser = localStorage.getItem('umrah_user');
      setUser(savedUser ? { ...JSON.parse(savedUser), token } : { token });
      loadUserData();
    } else {
      if (token) localStorage.removeItem('umrah_auth_token');
      setLoading(false);
    }
  }, []);

  const loadUserData = async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      const [rows, deleted, settings, invitations, accessGrants] = await Promise.all([
        api.data.fetchRows(),
        api.data.fetchDeletedRows(),
        api.settings.fetch(),
        api.shares.fetchInvitations(),
        api.shares.fetchAccess()
      ]);
      setAllRows(rows);
      setDeletedRows(deleted || []);
      setShareInvitations(invitations || []);
      setShareAccessGrants(accessGrants || []);
      setNotifiedIds(settings.notifiedIds || []);
      setTgConfig(settings.tgConfig || { token: '', chatId: '', enabled: false });
      setFontSize(settings.fontSize || 100);
      setAlertSettings(settings.alertSettings || {
        arrivalMinutes: 120,
        departureMinutes: 60,
        messageFields: { flight: true, carType: true, count: false, tafweej: false },
      });
      setPreviewSettings(settings.previewSettings || {
        requiredFields: ['groupName', 'groupNo', 'flight', 'date', 'time', 'from', 'to'],
        defaultStatus: 'Planned',
      });
      setDisplaySettings(settings.displaySettings ? { density: 'compact', tableFontSize: 100, borderStyle: 'thin', noteHighlightEnabled: true, noteHighlightColor: 'amber', wrapCells: true, columnOrder: DEFAULT_COLUMN_ORDER, hiddenColumns: [], ...settings.displaySettings } : { density: 'compact', tableFontSize: 100, borderStyle: 'thin', noteHighlightEnabled: true, noteHighlightColor: 'amber', wrapCells: true, columnOrder: DEFAULT_COLUMN_ORDER, hiddenColumns: [] });

      // Legacy Migration: If backend is empty but local storage has data, offer to import
      if (rows.length === 0) {
        const localRows = loadFromStorage('umrah_logistics_rows', []);
        if (localRows.length > 0) {
          if (window.confirm("تم العثور على بيانات قديمة في هذا المتصفح. هل تريد استيرادها إلى حسابك الجديد؟")) {
            setAllRows(localRows);
            setDeletedRows(loadFromStorage('umrah_logistics_deleted', []));
            setTgConfig(loadFromStorage('umrah_tg_config', { token: '', chatId: '', enabled: false }));
            setNotifiedIds(loadFromStorage('umrah_notified_trip_ids', []));
            // Clear local storage to prevent repeated prompts
            ['umrah_logistics_rows', 'umrah_logistics_deleted', 'umrah_logistics_templates', 'umrah_tg_config', 'umrah_notified_trip_ids'].forEach(k => localStorage.removeItem(k));
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
    setIsSyncing(true);
    try {
      await Promise.all([
        api.data.syncRows(allRows),
        api.settings.save({ tgConfig, deletedRows, notifiedIds, fontSize, alertSettings, previewSettings, displaySettings })
      ]);
    } catch (err) {
      console.error("Sync failed", err);
      showNotification("فشل مزامنة البيانات مع الخادم", "error");
    } finally {
      setTimeout(() => setIsSyncing(false), 1000);
    }
  };

  // Sync on changes (debounced or simple)
  useEffect(() => {
    if (user && !loading) {
      const timer = setTimeout(syncAllData, 2000);
      return () => clearTimeout(timer);
    }
  }, [allRows, deletedRows, tgConfig, fontSize, notifiedIds, alertSettings, previewSettings, displaySettings, user, loading]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const tgConfigRef = useRef(tgConfig);
  const allRowsRef = useRef(allRows);
  const alertSettingsRef = useRef(alertSettings);
  useEffect(() => { tgConfigRef.current = tgConfig; }, [tgConfig]);
  useEffect(() => { allRowsRef.current = allRows; }, [allRows]);
  useEffect(() => { alertSettingsRef.current = alertSettings; }, [alertSettings]);

  useEffect(() => {
    if (!user) return;

    const token = localStorage.getItem('umrah_auth_token');
    if (!token) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let refreshTimer: number | null = null;
    let manuallyClosed = false;

    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadUserData(false);
      }, 250);
    };

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/live?token=${encodeURIComponent(token)}`);

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'rows_changed' || message.type === 'invitations_changed') {
            scheduleRefresh();
          }
        } catch (err) {
          console.error("Live update parse failed", err);
        }
      };

      socket.onclose = () => {
        if (manuallyClosed) return;
        reconnectTimer = window.setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      manuallyClosed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (refreshTimer) window.clearTimeout(refreshTimer);
      socket?.close();
    };
  }, [user]);

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

        const isArrival = row.Column1?.includes('وصول');
        const isDeparture = row.Column1?.includes('مغادرة');
        const windowMinutes = isArrival
          ? alertSettingsRef.current.arrivalMinutes
          : isDeparture
          ? alertSettingsRef.current.departureMinutes
          : Math.max(alertSettingsRef.current.arrivalMinutes, alertSettingsRef.current.departureMinutes);

        if (diffMinutes > 0 && diffMinutes <= windowMinutes) {
          if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
            try {
              new Notification(`🔔 رحلة قادمة: ${row.flight || row.Column1}`, {
                body: `المجموعة: ${row.groupName} | الوجهة: ${row.to} | الوقت: ${row.time}`,
                icon: 'https://cdn-icons-png.flaticon.com/512/3002/3002655.png',
                tag: row.id
              });
            } catch (e) { console.error("Native Notif Error", e); }
          }

          notifiedIdsRef.current.add(row.id);
          hasUpdates = true;
        }
      });

      if (hasUpdates) {
        setNotifiedIds(Array.from(notifiedIdsRef.current));
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

  const updateRowField = async (id: string, field: keyof LogisticsRow, value: string) => {
    const currentRow = allRows.find(r => r.id === id);
    if (currentRow?._sharing?.role === 'viewer') {
      showNotification("لا تملك صلاحية تعديل هذه الرحلة", "error");
      return;
    }
    setAllRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    try {
      const result = await api.data.updateRow(id, { [field]: value }, currentRow?._version);
      if (result?.row) {
        setAllRows(prev => prev.map(r => r.id === id ? result.row : r));
      }
    } catch (err: any) {
      console.error("Row update failed", err);
      showNotification(err?.status === 409 ? "تم تعديل الرحلة من مستخدم آخر، جرى تحديث البيانات" : "فشل تحديث الرحلة", "error");
      loadUserData();
    }
  };

  const softDeleteRow = async (id: string) => {
    const rowToDelete = allRows.find(r => r.id === id);
    if (!rowToDelete) return;
    if (rowToDelete._sharing?.role === 'viewer') {
      showNotification("لا تملك صلاحية حذف هذه الرحلة", "error");
      return;
    }
    try {
      await api.data.deleteRow(id);
      await loadUserData();
      showNotification("تم نقل الرحلة لسلة المحذوفات", "success");
    } catch (err) {
      console.error("Delete failed", err);
      showNotification("فشل حذف الرحلة", "error");
    }
  };

  const deleteAllRows = async () => {
    if (allRows.length === 0) return;
    if (window.confirm("هل أنت متأكد من حذف جميع السجلات؟ سيتم نقلها لسلة المحذوفات.")) {
      try {
        await Promise.all(allRows.map(row => api.data.deleteRow(row.id)));
        await loadUserData();
        showNotification("تم نقل جميع السجلات لسلة المحذوفات", "success");
      } catch (err) {
        console.error("Delete all failed", err);
        showNotification("فشل حذف جميع السجلات", "error");
      }
    }
  };

  const restoreAllRows = async () => {
    if (deletedRows.length === 0) return;
    try {
      await Promise.all(deletedRows.map(row => api.data.restoreRow(row.id)));
      await loadUserData();
      showNotification("تم استعادة جميع السجلات", "success");
    } catch (err) {
      console.error("Restore all failed", err);
      showNotification("فشل استعادة جميع السجلات", "error");
    }
  };

  const permanentlyDeleteRow = async (id: string) => {
    try {
      await api.data.permanentlyDeleteRow(id);
      await loadUserData(false);
      showNotification("تم حذف الرحلة نهائياً", "success");
    } catch (err) {
      console.error("Permanent delete failed", err);
      showNotification("فشل حذف الرحلة نهائياً", "error");
    }
  };

  const permanentlyDeleteAllRows = async () => {
    if (deletedRows.length === 0) return;
    if (!window.confirm("هل أنت متأكد من الحذف النهائي لجميع العناصر؟ لا يمكن التراجع عن هذا الإجراء.")) return;
    try {
      await api.data.clearDeletedRows();
      await loadUserData(false);
      showNotification("تم حذف سلة المحذوفات نهائياً", "success");
    } catch (err) {
      console.error("Permanent delete all failed", err);
      showNotification("فشل حذف سلة المحذوفات", "error");
    }
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
      status: previewSettings.defaultStatus
    }, ...allRows]);
  };

  const duplicateRow = (row: LogisticsRow) => {
    setAllRows([{ ...row, id: uid() }, ...allRows]);
    showNotification("تم تكرار الرحلة بنجاح", "success");
  };

  const openShareDialog = (row: LogisticsRow) => {
    setShareTarget({ row, scope: 'row' });
    setShareReceiverUsername('');
    setShareRole('editor');
  };

  const submitShareInvitation = async () => {
    if (!shareTarget || !shareReceiverUsername.trim() || isSharing) return;
    setIsSharing(true);
    try {
      await api.shares.createInvitation({
        receiverUsername: shareReceiverUsername.trim(),
        scopeType: shareTarget.scope,
        rowId: shareTarget.scope === 'row' ? shareTarget.row.id : undefined,
        groupNo: shareTarget.scope === 'group' ? shareTarget.row.groupNo : undefined,
        role: shareRole,
      });
      setShareTarget(null);
      setShareReceiverUsername('');
      showNotification("تم إرسال دعوة المشاركة", "success");
    } catch (err) {
      console.error("Share failed", err);
      showNotification(err instanceof Error ? err.message : "فشل إرسال دعوة المشاركة", "error");
    } finally {
      setIsSharing(false);
    }
  };

  const acceptShareInvitation = async (id: number) => {
    try {
      await api.shares.acceptInvitation(id);
      await loadUserData();
      showNotification("تم قبول دعوة المشاركة", "success");
    } catch (err) {
      console.error("Accept invitation failed", err);
      showNotification("فشل قبول الدعوة", "error");
    }
  };

  const declineShareInvitation = async (id: number) => {
    try {
      await api.shares.declineInvitation(id);
      await loadUserData();
      showNotification("تم رفض دعوة المشاركة", "success");
    } catch (err) {
      console.error("Decline invitation failed", err);
      showNotification("فشل رفض الدعوة", "error");
    }
  };

  const updateShareAccessRole = async (grant: ShareAccessGrant, role: ShareRole) => {
    try {
      await api.shares.updateAccessRole({
        scopeType: grant.scopeType,
        rowId: grant.rowId,
        groupNo: grant.groupNo,
        userId: grant.userId,
        role,
      });
      await loadUserData(false);
      showNotification("تم تحديث صلاحية المشاركة", "success");
    } catch (err) {
      console.error("Update access failed", err);
      showNotification("فشل تحديث صلاحية المشاركة", "error");
    }
  };

  const revokeShareAccess = async (grant: ShareAccessGrant) => {
    if (!window.confirm("هل تريد إلغاء هذه المشاركة؟")) return;
    try {
      await api.shares.revokeAccess({
        scopeType: grant.scopeType,
        rowId: grant.rowId,
        groupNo: grant.groupNo,
        userId: grant.userId,
      });
      await loadUserData(false);
      showNotification("تم إلغاء المشاركة", "success");
    } catch (err) {
      console.error("Revoke access failed", err);
      showNotification("فشل إلغاء المشاركة", "error");
    }
  };

  const restoreDeletedRow = async (id: string) => {
    try {
      await api.data.restoreRow(id);
      await loadUserData();
      showNotification("تم استعادة الرحلة", "success");
    } catch (err) {
      console.error("Restore failed", err);
      showNotification("فشل استعادة الرحلة", "error");
    }
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
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="bg-white/10 p-2 sm:p-2.5 rounded-xl"><Plane size={24} className="sm:w-7 sm:h-7" /></div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold">UM For Logistics</h1>
                <p className="text-blue-200 text-[10px] sm:text-xs">إدارة لوجستية متكاملة</p>
              </div>
            </div>
            {/* Hamburger Button */}
            <button
              className="xl:hidden p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle navigation menu"
              style={{ minHeight: '44px', minWidth: '44px' }}
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Desktop Navigation */}
            <div className="hidden xl:flex items-center gap-4">
              {isSyncing && (
                <div className="flex items-center gap-2 text-blue-200 text-xs animate-pulse">
                  <RotateCw size={12} className="animate-spin" />
                  <span>جاري المزامنة...</span>
                </div>
              )}
              <div className="flex items-center gap-3 bg-white/10 px-4 py-2 rounded-xl border border-white/5">
                <Users size={16} className="text-blue-200" />
                <span className="text-sm font-bold">{user?.username || 'مستخدم'}</span>
                <button
                  onClick={() => api.auth.logout()}
                  className="mr-2 text-xs bg-red-500/20 hover:bg-red-500/40 text-red-200 px-3 py-2 rounded-lg transition-all"
                  style={{ minHeight: '44px' }}
                >
                  خروج
                </button>
              </div>
              <div className="flex bg-white/10 p-1 rounded-xl">
                <button onClick={() => setView('operational')} style={{ minHeight: '44px' }} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'operational' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><SettingsIcon size={16} className="inline ml-1" />العمليات</button>
                <button onClick={() => setView('analytics')} style={{ minHeight: '44px' }} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'analytics' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><LayoutDashboard size={16} className="inline ml-1" />الذكاء</button>
                <button onClick={() => setView('settings')} style={{ minHeight: '44px' }} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${view === 'settings' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><SlidersHorizontal size={16} className="inline ml-1" />الإعدادات</button>
              </div>
            </div>
          </div>

          {/* Mobile Navigation Drawer */}
          {isMobileMenuOpen && (
            <div className="xl:hidden mt-4 flex flex-col gap-3 animate-fade-in pb-2">
              <div className="flex flex-col sm:flex-row gap-2 bg-white/5 p-2 rounded-xl">
                <button onClick={() => { setView('operational'); setIsMobileMenuOpen(false); }} style={{ minHeight: '44px' }} className={`w-full px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${view === 'operational' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><SettingsIcon size={18} /> العمليات</button>
                <button onClick={() => { setView('analytics'); setIsMobileMenuOpen(false); }} style={{ minHeight: '44px' }} className={`w-full px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${view === 'analytics' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><LayoutDashboard size={18} /> الذكاء</button>
                <button onClick={() => { setView('settings'); setIsMobileMenuOpen(false); }} style={{ minHeight: '44px' }} className={`w-full px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${view === 'settings' ? 'bg-white text-blue-900' : 'hover:bg-white/10'}`}><SlidersHorizontal size={18} /> الإعدادات</button>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-white/5 px-4 py-3 rounded-xl">
                <div className="flex items-center gap-3 mb-2 sm:mb-0 text-sm">
                  <Users size={16} className="text-blue-200 shrink-0" />
                  <span className="font-bold truncate">{user?.username || 'مستخدم'}</span>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full">
                  <button
                    onClick={() => api.auth.logout()}
                    className="flex-1 min-w-[100px] flex items-center justify-center gap-2 text-sm bg-red-500/20 hover:bg-red-500/40 text-red-200 px-3 py-2.5 rounded-lg transition-all"
                    style={{ minHeight: '44px' }}
                  >
                    خروج
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 mt-8 space-y-8">
        {view === 'settings' ? (
          <Settings
            tgConfig={tgConfig}
            onTgConfigChange={setTgConfig}
            onTestTelegram={handleTestTelegram}
            isTestingTg={isTestingTg}
            alertSettings={alertSettings}
            onAlertSettingsChange={setAlertSettings}
            previewSettings={previewSettings}
            onPreviewSettingsChange={setPreviewSettings}
            displaySettings={displaySettings}
            onDisplaySettingsChange={setDisplaySettings}
            fontSize={fontSize}
            onFontSizeChange={changeFontSize}
            notifPermission={notifPermission}
            onRequestNotifPermission={requestNotificationPermission}
            notifiedCount={notifiedCount}
            allRowsCount={allRows.length}
            shareAccessGrants={shareAccessGrants}
            onUpdateShareAccessRole={updateShareAccessRole}
            onRevokeShareAccess={revokeShareAccess}
          />
        ) : view === 'analytics' ? (
          <OperationsIntelligence rows={allRows} onNavigateToTable={() => setView('operational')} />
        ) : (
          <>
            <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
              <button
                onClick={() => setInputSectionOpen(o => !o)}
                className="w-full p-4 sm:p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-700 p-2 rounded-lg"><Edit3 size={20} /></span>
                  إدخال بيانات الرحلة
                </h2>
                <ChevronDown size={20} className={`text-gray-400 transition-transform duration-200 ${inputSectionOpen ? 'rotate-180' : ''}`} />
              </button>
              {inputSectionOpen && <div className="px-4 pb-4 sm:px-8 sm:pb-8">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8">
                <div className="md:col-span-4 space-y-4">
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-3">
                    <input type="text" placeholder="رقم المجموعة" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[44px]" value={inputs.groupNo} onChange={(e) => setInputs({ ...inputs, groupNo: e.target.value })} />
                    <input type="text" placeholder="اسم المجموعة" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[44px]" value={inputs.groupName} onChange={(e) => setInputs({ ...inputs, groupName: e.target.value })} />
                    <input type="number" placeholder="العدد" className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[44px]" value={inputs.count} onChange={(e) => setInputs({ ...inputs, count: e.target.value })} />
                  </div>
                  <button onClick={handleExtract} className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100 min-h-[44px]">
                    <FileText size={20} /> تحليل واستخراج
                  </button>
                </div>
                <div className="md:col-span-8">
                  <textarea placeholder="الصق نص الرحلة هنا..." className="w-full h-[200px] sm:h-[250px] p-4 border rounded-xl font-mono text-sm bg-gray-50 focus:bg-white transition-colors" value={inputs.text} onChange={(e) => setInputs({ ...inputs, text: e.target.value })}></textarea>
                </div>
              </div>
              </div>}
            </section>

            {showPreview && (
              <section className="bg-white rounded-2xl shadow-xl border-2 border-blue-500 overflow-hidden animate-slide-up">
                <div className="bg-blue-500 p-4 flex justify-between items-center text-white">
                  <h3 className="font-bold flex items-center gap-2"><Clock size={18} /> معاينة النتائج قبل الاعتماد</h3>
                  <div className="flex gap-2">
                    <button onClick={() => setShowPreview(false)} className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-lg text-sm">إلغاء</button>
                    <button onClick={() => { setAllRows([...previewRows, ...allRows]); setShowPreview(false); setInputs({ ...inputs, text: '' }); showNotification("تم اعتماد الرحلات", "success"); }} className="bg-white text-blue-600 px-6 py-1.5 rounded-lg font-bold">حفظ واعتماد</button>
                  </div>
                </div>
                <div className="p-4"><TableEditor rows={previewRows} onChange={(id, f, v) => setPreviewRows(prev => prev.map(r => r.id === id ? { ...r, [f]: v } : r))} isPreview={true} requiredFields={previewSettings.requiredFields} /></div>
              </section>
            )}

            <section className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 sm:p-6 overflow-visible w-full">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
                  <h3 className="font-bold text-gray-800 text-lg">سجل العمليات اللوجستية</h3>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={downloadExcel} title="تصدير إكسل" className="p-3 sm:p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg border border-emerald-100 transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"><Download size={18} /></button>
                    <button onClick={() => fileInputRef.current?.click()} title="استيراد إكسل / JSON" className="p-3 sm:p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-100 transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"><Upload size={18} /></button>
                    <button onClick={() => setShowRecycleBin(true)} title="المحذوفات" className="p-3 sm:p-2 text-gray-400 hover:bg-gray-50 rounded-lg border border-gray-100 transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"><History size={18} /></button>
                    <button onClick={() => setShowInvitations(true)} title="دعوات المشاركة" className="relative p-3 sm:p-2 text-teal-600 hover:bg-teal-50 rounded-lg border border-teal-100 transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]">
                      <Share2 size={18} />
                      {shareInvitations.length > 0 && (
                        <span className="absolute -top-2 -left-2 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
                          {shareInvitations.length}
                        </span>
                      )}
                    </button>
                    <button onClick={deleteAllRows} title="حذف الكل" className="p-3 sm:p-2 text-red-500 hover:bg-red-50 rounded-lg border border-red-100 transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"><Eraser size={18} /></button>
                  </div>
                </div>
                <div className="flex gap-3 w-full sm:w-auto mt-2 sm:mt-0">
                  <button onClick={() => setIsEditing(!isEditing)} className={`w-full sm:w-auto min-h-[44px] px-5 py-2.5 sm:py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center justify-center ${isEditing ? 'bg-green-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
                    {isEditing ? 'إنهاء التعديل وحفظ' : 'بدء تعديل الجدول'}
                  </button>
                </div>
              </div>
              <div className="mt-2">
                <TableEditor
                  rows={allRows}
                  onChange={updateRowField}
                  onDelete={softDeleteRow}
                  isPreview={false}
                  readOnly={!isEditing}
                  density={displaySettings.density}
                  requiredFields={previewSettings.requiredFields}
                  tableFontSize={displaySettings.tableFontSize}
                  borderStyle={displaySettings.borderStyle}
                  noteHighlightEnabled={displaySettings.noteHighlightEnabled}
                  noteHighlightColor={displaySettings.noteHighlightColor}
                  wrapCells={displaySettings.wrapCells}
                  columnOrder={displaySettings.columnOrder}
                  hiddenColumns={displaySettings.hiddenColumns}
                  enableFiltering={true}
                  onAddNewRow={addNewEmptyRow}
                  onDuplicateRow={duplicateRow}
                  onShareTrip={openShareDialog}
                  onFilteredRowsChange={setFilteredRows}
                />
              </div>
            </section>
          </>
        )}
      </main>

      {showInvitations && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in text-right">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-teal-50/60">
              <h3 className="text-lg font-bold flex items-center gap-2 text-teal-800">
                <Share2 size={20} /> دعوات المشاركة
              </h3>
              <button onClick={() => setShowInvitations(false)} className="p-2 hover:bg-white rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
                <XCircle size={22} />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              {shareInvitations.length > 0 ? shareInvitations.map(invite => (
                <div key={invite.id} className="border border-gray-100 rounded-xl p-4 bg-white shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-gray-800">دعوة من {invite.senderUsername}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {invite.scopeType === 'group' ? `مشاركة المجموعة ${invite.groupNo}` : 'مشاركة رحلة محددة'}
                      </p>
                    </div>
                    <span className="rounded-full bg-teal-50 px-2 py-1 text-[10px] font-bold text-teal-700 border border-teal-100">
                      {invite.scopeType === 'group' ? 'مجموعة' : 'رحلة'}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => acceptShareInvitation(invite.id)} className="flex-1 min-h-[44px] bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700 transition-colors">
                      قبول
                    </button>
                    <button onClick={() => declineShareInvitation(invite.id)} className="flex-1 min-h-[44px] bg-gray-100 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors">
                      رفض
                    </button>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12 text-gray-400 italic">لا توجد دعوات مشاركة حالياً</div>
              )}
            </div>
          </div>
        </div>
      )}

      {shareTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in text-right">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-teal-50/60">
              <h3 className="text-lg font-bold flex items-center gap-2 text-teal-800">
                <Share2 size={20} />
                مشاركة
              </h3>
              <button onClick={() => setShareTarget(null)} className="p-2 hover:bg-white rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
                <XCircle size={22} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 space-y-1">
                <p><b>المجموعة:</b> {shareTarget.row.groupName || '-'} ({shareTarget.row.groupNo || '-'})</p>
                <p><b>النطاق:</b> {shareTarget.scope === 'group' ? 'كل رحلات هذا الرقم الحالية والمستقبلية' : 'هذه الرحلة فقط'}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">ماذا تريد مشاركة؟</label>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => setShareTarget({ ...shareTarget, scope: 'row' })}
                    className={`min-h-[44px] rounded-lg text-xs font-bold transition-all ${
                      shareTarget.scope === 'row'
                        ? 'bg-white text-teal-700 shadow-sm border border-teal-100'
                        : 'text-gray-500 hover:bg-white/60'
                    }`}
                  >
                    هذه الرحلة فقط
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareTarget({ ...shareTarget, scope: 'group' })}
                    className={`min-h-[44px] rounded-lg text-xs font-bold transition-all ${
                      shareTarget.scope === 'group'
                        ? 'bg-white text-teal-700 shadow-sm border border-teal-100'
                        : 'text-gray-500 hover:bg-white/60'
                    }`}
                  >
                    كل المجموعة
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">اسم حساب المستلم</label>
                <input
                  type="text"
                  value={shareReceiverUsername}
                  onChange={(e) => setShareReceiverUsername(e.target.value)}
                  placeholder="username"
                  className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 outline-none text-left"
                  dir="ltr"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">صلاحية المستلم</label>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => setShareRole('editor')}
                    className={`min-h-[44px] rounded-lg text-xs font-bold transition-all ${
                      shareRole === 'editor'
                        ? 'bg-white text-teal-700 shadow-sm border border-teal-100'
                        : 'text-gray-500 hover:bg-white/60'
                    }`}
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareRole('viewer')}
                    className={`min-h-[44px] rounded-lg text-xs font-bold transition-all ${
                      shareRole === 'viewer'
                        ? 'bg-white text-teal-700 shadow-sm border border-teal-100'
                        : 'text-gray-500 hover:bg-white/60'
                    }`}
                  >
                    مشاهدة فقط
                  </button>
                </div>
              </div>
              <button
                onClick={submitShareInvitation}
                disabled={!shareReceiverUsername.trim() || isSharing}
                className="w-full min-h-[44px] bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {isSharing ? 'جاري الإرسال...' : 'إرسال دعوة المشاركة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecycleBin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in text-right">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-4 bg-red-50/50">
              <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto justify-between sm:justify-start">
                <h3 className="text-lg sm:text-xl font-bold flex items-center gap-2 text-red-700"><Trash2 /> سلة المحذوفات</h3>
                {deletedRows.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={restoreAllRows}
                      className="text-xs bg-green-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-green-700 transition-all flex items-center gap-1 shadow-sm min-h-[44px]"
                    >
                      <RotateCcw size={16} /> استعادة الكل
                    </button>
                    <button
                      onClick={permanentlyDeleteAllRows}
                      className="text-xs bg-red-600 text-white px-3 py-2 rounded-lg font-bold hover:bg-red-700 transition-all flex items-center gap-1 shadow-sm min-h-[44px]"
                    >
                      <Trash2 size={16} /> حذف الكل
                    </button>
                  </div>
                )}
              </div>
              <button onClick={() => setShowRecycleBin(false)} className="p-2 sm:p-2 hover:bg-white rounded-full transition-colors self-end sm:self-auto min-h-[44px] min-w-[44px] flex items-center justify-center -mt-12 sm:mt-0"><XCircle size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {deletedRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gray-50 text-gray-500 font-bold"><tr className="border-b"> <th className="p-3">المجموعة</th> <th className="p-3">الحركة</th> <th className="p-3">الإجراء</th> </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {deletedRows.map(row => (
                        <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4">
                            <div className="font-bold">{row.groupName} ({row.groupNo})</div>
                            {row._sharing && (
                              <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold">
                                {row._sharing.shared && <span className="rounded-full bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5">مشتركة</span>}
                                {row._sharing.ownerUsername && <span className="text-gray-400">المالك: {row._sharing.ownerUsername}</span>}
                                {row._sharing.deletedByUsername && <span className="text-red-400">حذفها: {row._sharing.deletedByUsername}</span>}
                              </div>
                            )}
                          </td>
                          <td className="p-4">{row.Column1} - {row.to}</td>
                          <td className="p-4 flex gap-2">
                            <button onClick={() => restoreDeletedRow(row.id)} className="text-green-600 hover:bg-green-50 px-3 py-1 rounded-lg border border-green-100 flex items-center gap-1 text-xs"><RotateCcw size={14} /> استعادة</button>
                            <button onClick={() => permanentlyDeleteRow(row.id)} className="text-red-600 hover:bg-red-50 px-3 py-1 rounded-lg border border-red-100 flex items-center gap-1 text-xs"><Trash2 size={14} /> حذف نهائي</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-center py-20 text-gray-400 italic">لا يوجد سجلات محذوفة حالياً</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
