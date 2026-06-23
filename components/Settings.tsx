import React, { useState } from 'react';
import {
  Send, Zap, Bell, BellRing, Smartphone, CheckCircle2, Info,
  Loader2, SlidersHorizontal, Eye, EyeOff, GripVertical, Type, Minus, PlusCircle,
  LayoutList, AlignJustify, Download, Puzzle, ChevronLeft,
  Monitor, Package, FolderOpen, StickyNote, Users, Trash2, ShieldCheck
} from 'lucide-react';
import { TelegramConfig, TripStatus, AlertSettings, PreviewSettings, DisplaySettings, NoteHighlightColor, COLUMN_LABELS, DEFAULT_COLUMN_ORDER, ShareAccessGrant, ShareRole } from '../types';

type SettingsPage = 'telegram' | 'display' | 'extension' | 'access';

interface SettingsProps {
  tgConfig: TelegramConfig;
  onTgConfigChange: (c: TelegramConfig) => void;
  onTestTelegram: () => void;
  isTestingTg: boolean;
  alertSettings: AlertSettings;
  onAlertSettingsChange: (s: AlertSettings) => void;
  previewSettings: PreviewSettings;
  onPreviewSettingsChange: (s: PreviewSettings) => void;
  displaySettings: DisplaySettings;
  onDisplaySettingsChange: (s: DisplaySettings) => void;
  fontSize: number;
  onFontSizeChange: (delta: number) => void;
  notifPermission: NotificationPermission;
  onRequestNotifPermission: () => void;
  notifiedCount: number;
  allRowsCount: number;
  shareAccessGrants: ShareAccessGrant[];
  onUpdateShareAccessRole: (grant: ShareAccessGrant, role: ShareRole) => void;
  onRevokeShareAccess: (grant: ShareAccessGrant) => void;
}

const PREVIEW_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'groupName', label: 'اسم المجموعة' },
  { key: 'groupNo',   label: 'رقم المجموعة' },
  { key: 'flight',    label: 'رقم الرحلة' },
  { key: 'date',      label: 'التاريخ' },
  { key: 'time',      label: 'الوقت' },
  { key: 'from',      label: 'من' },
  { key: 'to',        label: 'إلى' },
  { key: 'carType',   label: 'نوع السيارة' },
  { key: 'count',     label: 'العدد' },
];

const STATUS_OPTIONS: { value: TripStatus; label: string }[] = [
  { value: 'Planned',         label: 'مخطط' },
  { value: 'Confirmed',       label: 'مؤكد' },
  { value: 'Driver Assigned', label: 'تم تعيين السائق' },
  { value: 'In Progress',     label: 'قيد التنفيذ' },
  { value: 'Completed',       label: 'مكتمل' },
  { value: 'Delayed',         label: 'متأخر' },
  { value: 'Cancelled',       label: 'ملغي' },
  { value: 'Uncompleted',     label: 'لم يكتمل' },
];

const NOTE_ROW_COLORS: Record<string, string> = {
  amber: 'bg-amber-50', yellow: 'bg-yellow-50', blue: 'bg-blue-50',
  green: 'bg-green-50', pink: 'bg-pink-50', purple: 'bg-purple-50',
};
const NOTE_ICON_COLORS: Record<string, string> = {
  amber: 'text-amber-500', yellow: 'text-yellow-500', blue: 'text-blue-500',
  green: 'text-green-500', pink: 'text-pink-500', purple: 'text-purple-500',
};
const NOTE_SWATCH_BG: Record<string, string> = {
  amber: 'bg-amber-400', yellow: 'bg-yellow-400', blue: 'bg-blue-500',
  green: 'bg-green-500', pink: 'bg-pink-400', purple: 'bg-purple-500',
};
const SAMPLE_PREVIEW_ROWS = [
  { id: 'p1', groupName: 'مجموعة النور',    Column1: 'وصول',    flight: 'SV٢٣١', date: '٢٠/٦', time: '١٤:٣٠', status: 'Confirmed'  as const, notes: 'تأكيد رقم الرحلة قبل المغادرة' },
  { id: 'p2', groupName: 'مجموعة الفجر',    Column1: 'مغادرة',  flight: 'SV٤٠٥', date: '٢١/٦', time: '٠٩:٠٠', status: 'In Progress' as const, notes: '' },
  { id: 'p3', groupName: 'مجموعة الإخلاص', Column1: 'وصول',    flight: 'SV١٠٧', date: '٢٢/٦', time: '١٨:١٥', status: 'Planned'     as const, notes: '' },
];
const SAMPLE_STATUS_COLORS: Record<string, string> = {
  Confirmed: 'bg-blue-100 text-blue-700', 'In Progress': 'bg-yellow-100 text-yellow-800', Planned: 'bg-gray-100 text-gray-700',
};
const SAMPLE_STATUS_LABELS: Record<string, string> = {
  Confirmed: 'مؤكد', 'In Progress': 'قيد التنفيذ', Planned: 'مخطط',
};
const COLOR_OPTIONS: { key: NoteHighlightColor; label: string }[] = [
  { key: 'amber', label: 'ذهبي' }, { key: 'yellow', label: 'أصفر' },
  { key: 'blue', label: 'أزرق' }, { key: 'green', label: 'أخضر' },
  { key: 'pink', label: 'وردي' }, { key: 'purple', label: 'بنفسجي' },
];

const NAV_ITEMS: { id: SettingsPage; label: string; sublabel: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { id: 'display',   label: 'العرض والمعاينة',    sublabel: 'الخط والجدول والحقول',      Icon: Eye },
  { id: 'telegram',  label: 'تيليجرام والتنبيهات', sublabel: 'البوت والتوقيت والإشعارات', Icon: Send },
  { id: 'access',    label: 'المشاركة والصلاحيات', sublabel: 'المستخدمون والأدوار',       Icon: Users },
  { id: 'extension', label: 'إضافة المتصفح',     sublabel: 'تحميل وتثبيت الإضافة',     Icon: Puzzle },
];

export const Settings: React.FC<SettingsProps> = ({
  tgConfig, onTgConfigChange, onTestTelegram, isTestingTg,
  alertSettings, onAlertSettingsChange,
  previewSettings, onPreviewSettingsChange,
  displaySettings, onDisplaySettingsChange,
  fontSize, onFontSizeChange,
  notifPermission, onRequestNotifPermission,
  notifiedCount, allRowsCount,
  shareAccessGrants, onUpdateShareAccessRole, onRevokeShareAccess,
}) => {
  const [activePage, setActivePage] = useState<SettingsPage>('display');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const toggleRequiredField = (key: string) => {
    const current = previewSettings.requiredFields;
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    onPreviewSettingsChange({ ...previewSettings, requiredFields: next });
  };

  const toggleMessageField = (key: keyof AlertSettings['messageFields']) => {
    onAlertSettingsChange({
      ...alertSettings,
      messageFields: { ...alertSettings.messageFields, [key]: !alertSettings.messageFields[key] },
    });
  };

  const fmtMin = (m: number) =>
    m < 60 ? `${m} د` : m % 60 === 0 ? `${Math.floor(m / 60)} س` : `${Math.floor(m / 60)}س ${m % 60}د`;

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden animate-fade-in" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:min-h-[600px]">

        {/* ── Sidebar ── */}
        <div className="w-full sm:w-56 sm:shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-l border-gray-100 flex flex-row sm:flex-col py-0 sm:py-3">
          <p className="hidden sm:block text-[10px] font-black text-gray-400 uppercase tracking-widest px-4 py-3">الإعدادات</p>
          {NAV_ITEMS.map(({ id, label, sublabel, Icon }) => {
            const active = activePage === id;
            return (
              <button
                key={id}
                onClick={() => setActivePage(id)}
                className={`flex-1 sm:flex-none sm:w-full flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-3 px-2 sm:px-4 py-3 text-center sm:text-right transition-all border-b-2 sm:border-b-0 sm:border-l-2 ${
                  active
                    ? 'bg-blue-50 border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <Icon size={18} className={active ? 'text-blue-600' : 'text-gray-400'} />
                <div className="min-w-0">
                  <p className={`hidden sm:block text-sm font-bold truncate ${active ? 'text-blue-700' : 'text-gray-700'}`}>{label}</p>
                  <p className="hidden sm:block text-[10px] text-gray-400 truncate">{sublabel}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Content area ── */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">

          {/* ── Telegram page ── */}
          {activePage === 'telegram' && (
            <div className="space-y-6 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
                  <Send size={20} className="text-blue-600" /> ربط بوت تيليجرام
                </h2>
                <p className="text-sm text-gray-400">تنبيهات تلقائية ومساعد ذكي للرد على الاستفسارات</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">توكن البوت (Bot Token)</label>
                  <input
                    type="password"
                    value={tgConfig.token}
                    onChange={(e) => onTgConfigChange({ ...tgConfig, token: e.target.value })}
                    placeholder="7483XXXXXX:AAHyXXXXXX..."
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-left"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">معرف الدردشة (Chat ID)</label>
                  <input
                    type="text"
                    value={tgConfig.chatId}
                    onChange={(e) => onTgConfigChange({ ...tgConfig, chatId: e.target.value })}
                    placeholder="مثال: 123456789"
                    className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between bg-blue-50 p-4 rounded-2xl border border-blue-100">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${tgConfig.enabled ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-300'}`} />
                  <span className="text-sm font-bold text-blue-900">التنبيهات التلقائية</span>
                </div>
                <button
                  onClick={() => onTgConfigChange({ ...tgConfig, enabled: !tgConfig.enabled })}
                  className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${tgConfig.enabled ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  {tgConfig.enabled ? 'إيقاف' : 'تشغيل'}
                </button>
              </div>

              <button
                onClick={onTestTelegram}
                disabled={!tgConfig.token || !tgConfig.chatId || isTestingTg}
                className="w-full flex items-center justify-center gap-3 p-4 bg-white border-2 border-blue-600 text-blue-600 rounded-2xl font-black text-sm hover:bg-blue-50 transition-all active:scale-95 disabled:opacity-40 disabled:border-gray-200 disabled:text-gray-400"
              >
                {isTestingTg ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} className="fill-current" />}
                اختبار اتصال البوت
              </button>

              <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 text-xs text-gray-500 space-y-2">
                <p className="font-bold text-gray-700 flex items-center gap-2"><Info size={13} className="text-blue-500" /> كيف تحصل على Chat ID؟</p>
                <ol className="list-decimal mr-4 space-y-1.5">
                  <li>ابحث عن <b>@userinfobot</b> في تيليجرام</li>
                  <li>أرسل له أي رسالة — سيرد بالـ ID الخاص بك</li>
                  <li>انسخ الرقم وضعه في حقل "معرف الدردشة" أعلاه</li>
                </ol>
              </div>

              <div className="border-t border-gray-100 pt-6 space-y-5">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><Bell size={13} className="text-indigo-500" /> توقيت الإشعارات</p>

                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">قبل رحلة الوصول بـ</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range" min={10} max={1440} step={15}
                      value={alertSettings.arrivalMinutes}
                      onChange={(e) => onAlertSettingsChange({ ...alertSettings, arrivalMinutes: Number(e.target.value) })}
                      className="flex-1 accent-blue-600"
                    />
                    <span className="text-xl font-black text-blue-700 w-20 text-center">{fmtMin(alertSettings.arrivalMinutes)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">قبل رحلة المغادرة بـ</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range" min={10} max={1440} step={15}
                      value={alertSettings.departureMinutes}
                      onChange={(e) => onAlertSettingsChange({ ...alertSettings, departureMinutes: Number(e.target.value) })}
                      className="flex-1 accent-indigo-600"
                    />
                    <span className="text-xl font-black text-indigo-700 w-20 text-center">{fmtMin(alertSettings.departureMinutes)}</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-6 space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">حقول رسالة التيليجرام</p>
                <div className="grid grid-cols-2 gap-2">
                  {([ ['flight', 'رقم الرحلة'], ['carType', 'نوع السيارة'], ['count', 'العدد'], ['tafweej', 'التفويج'] ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-indigo-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={alertSettings.messageFields[key]}
                        onChange={() => toggleMessageField(key)}
                        className="rounded border-gray-300 text-indigo-600 w-4 h-4"
                      />
                      <span className="text-xs font-medium text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-6">
                <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <div className="flex items-center gap-3">
                    <Smartphone size={18} className="text-emerald-600" />
                    <span className="text-sm font-bold text-emerald-900">إشعارات المتصفح</span>
                  </div>
                  {notifPermission === 'granted' ? (
                    <span className="flex items-center gap-1.5 text-xs font-black text-emerald-700 bg-white px-3 py-1.5 rounded-full border border-emerald-200">
                      <CheckCircle2 size={14} /> مفعّل
                    </span>
                  ) : (
                    <button onClick={onRequestNotifPermission} className="text-xs font-bold bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 transition-all">
                      تفعيل
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                  <p className="text-3xl font-black text-blue-900">{allRowsCount}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">رحلة مسجلة</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                  <p className="text-3xl font-black text-emerald-600">{notifiedCount}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">إشعار أُرسل</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Display & Preview page ── */}
          {activePage === 'display' && (
            <div className="space-y-6 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
                  <Eye size={20} className="text-amber-500" /> العرض والمعاينة
                </h2>
                <p className="text-sm text-gray-400">حجم الخط والحدود وتمييز الملاحظات والحقول</p>
              </div>

              {/* Live preview table */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">معاينة مباشرة</p>
                <div
                  className="overflow-x-auto rounded-xl border border-gray-200 bg-white"
                  style={{ fontSize: `${displaySettings.tableFontSize ?? 100}%` }}
                  dir="rtl"
                >
                  <table className="w-full text-right border-collapse">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        {['المجموعة', 'النوع', 'الرحلة', 'الوقت', 'الحالة', ''].map(h => (
                          <th key={h} className={`px-3 py-2 text-xs font-bold ${(displaySettings.borderStyle ?? 'thin') === 'thick' ? 'border-b-2 border-gray-500' : (displaySettings.borderStyle ?? 'thin') === 'medium' ? 'border-b-2 border-gray-300' : 'border-b border-gray-200'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SAMPLE_PREVIEW_ROWS.map(row => {
                        const hasNote = Boolean(row.notes);
                        const highlightEnabled = displaySettings.noteHighlightEnabled ?? true;
                        const color = displaySettings.noteHighlightColor ?? 'amber';
                        const cellBorder = (displaySettings.borderStyle ?? 'thin') === 'thick' ? 'border-l-2 border-gray-400' : (displaySettings.borderStyle ?? 'thin') === 'medium' ? 'border-l border-gray-300' : 'border-l border-gray-100';
                        const pad = (displaySettings.density ?? 'compact') === 'comfortable' ? 'py-2 px-3' : 'py-1 px-3';
                        const rowBg = hasNote && highlightEnabled ? NOTE_ROW_COLORS[color] : '';
                        return (
                          <tr key={row.id} className={`${rowBg} transition-colors`}>
                            <td className={`${pad} ${cellBorder}`}><span className="font-medium">{row.groupName}</span></td>
                            <td className={`${pad} ${cellBorder} text-gray-500`}>{row.Column1}</td>
                            <td className={`${pad} ${cellBorder} font-mono text-xs`}>{row.flight}</td>
                            <td className={`${pad} ${cellBorder} text-gray-500 text-xs`}>{row.date} {row.time}</td>
                            <td className={`${pad} ${cellBorder}`}>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${SAMPLE_STATUS_COLORS[row.status]}`}>{SAMPLE_STATUS_LABELS[row.status]}</span>
                            </td>
                            <td className={`${pad} text-center`}>
                              <StickyNote size={12} className={hasNote ? NOTE_ICON_COLORS[color] : 'text-gray-200'} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-400 mt-2 text-center">الصف الأول يحتوي على ملاحظة — الباقيان بدون</p>
              </div>

              {/* Table font size */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">حجم خط الجدول</label>
                <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                  <button
                    onClick={() => onDisplaySettingsChange({ ...displaySettings, tableFontSize: Math.max(70, (displaySettings.tableFontSize ?? 100) - 5) })}
                    className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors font-black text-lg"
                  >−</button>
                  <div className="flex-1 text-center">
                    <span className="text-2xl font-black text-gray-800">{displaySettings.tableFontSize ?? 100}%</span>
                    <p className="text-[10px] text-gray-400 mt-0.5">مثالي: ١١٠٪ – ١٣٠٪ للوضوح</p>
                  </div>
                  <button
                    onClick={() => onDisplaySettingsChange({ ...displaySettings, tableFontSize: Math.min(160, (displaySettings.tableFontSize ?? 100) + 5) })}
                    className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors font-black text-lg"
                  >+</button>
                </div>
              </div>


              {/* Density */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">كثافة الجدول</label>
                <div className="grid grid-cols-2 gap-3">
                  {([['compact', 'مضغوط', LayoutList], ['comfortable', 'مريح', AlignJustify]] as const).map(([val, label, Icon]) => (
                    <button key={val}
                      onClick={() => onDisplaySettingsChange({ ...displaySettings, density: val })}
                      className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${displaySettings.density === val ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-300'}`}
                    >
                      <Icon size={22} className={displaySettings.density === val ? 'text-blue-600' : 'text-gray-400'} />
                      <span className={`text-xs font-bold ${displaySettings.density === val ? 'text-blue-700' : 'text-gray-400'}`}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Border style */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">سمك الحدود</label>
                <div className="grid grid-cols-3 gap-2">
                  {([['thin', 'رفيعة'], ['medium', 'متوسطة'], ['thick', 'سميكة']] as const).map(([val, label]) => {
                    const active = (displaySettings.borderStyle ?? 'thin') === val;
                    return (
                      <button key={val}
                        onClick={() => onDisplaySettingsChange({ ...displaySettings, borderStyle: val })}
                        className={`flex flex-col items-center gap-2.5 py-3 px-2 rounded-2xl border-2 transition-all ${active ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-300'}`}
                      >
                        <div className={`w-12 h-6 rounded ${active ? 'bg-blue-100' : 'bg-gray-100'} flex flex-col justify-around p-1 gap-0.5`}>
                          {[...Array(3)].map((_, i) => (
                            <div key={i} className={`w-full rounded-full ${active ? 'bg-blue-400' : 'bg-gray-300'} ${val === 'thick' ? 'h-[3px]' : val === 'medium' ? 'h-[2px]' : 'h-px'}`} />
                          ))}
                        </div>
                        <span className={`text-[11px] font-bold ${active ? 'text-blue-700' : 'text-gray-400'}`}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Note row highlight */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">تمييز صفوف الملاحظات</label>
                  <button
                    onClick={() => onDisplaySettingsChange({ ...displaySettings, noteHighlightEnabled: !(displaySettings.noteHighlightEnabled ?? true) })}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${(displaySettings.noteHighlightEnabled ?? true) ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'}`}
                  >
                    {(displaySettings.noteHighlightEnabled ?? true) ? 'مفعّل' : 'معطّل'}
                  </button>
                </div>
                {(displaySettings.noteHighlightEnabled ?? true) && (
                  <div className="flex gap-2 flex-wrap">
                    {COLOR_OPTIONS.map(({ key, label }) => {
                      const active = (displaySettings.noteHighlightColor ?? 'amber') === key;
                      return (
                        <button key={key}
                          onClick={() => onDisplaySettingsChange({ ...displaySettings, noteHighlightColor: key })}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 text-xs font-bold transition-all ${active ? 'border-gray-800 scale-110' : 'border-transparent hover:border-gray-300'}`}
                        >
                          <span className={`w-3 h-3 rounded-full ${NOTE_SWATCH_BG[key]}`} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Wrap cells toggle */}
              <div className="flex items-center justify-between py-4 border-t border-gray-100">
                <div>
                  <p className="text-sm font-bold text-gray-700">التفاف نص الخلايا</p>
                  <p className="text-xs text-gray-400 mt-0.5">عرض النص على أسطر متعددة داخل الخلية</p>
                </div>
                <button
                  onClick={() => onDisplaySettingsChange({ ...displaySettings, wrapCells: !(displaySettings.wrapCells ?? true) })}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${(displaySettings.wrapCells ?? true) ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}
                >
                  {(displaySettings.wrapCells ?? true) ? 'مفعّل' : 'معطّل'}
                </button>
              </div>

              {/* Column visibility & order */}
              <div className="border-t border-gray-100 pt-5">
                <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">أعمدة الجدول</label>
                <div className="rounded-2xl border border-gray-100 overflow-hidden">
                  {(displaySettings.columnOrder ?? DEFAULT_COLUMN_ORDER).map((key, i) => {
                    const isHidden = (displaySettings.hiddenColumns ?? []).includes(key);
                    const label = COLUMN_LABELS[key] ?? key;
                    return (
                      <div
                        key={key}
                        draggable
                        onDragStart={() => setDragIndex(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragIndex === null || dragIndex === i) { setDragIndex(null); return; }
                          const newOrder = [...(displaySettings.columnOrder ?? DEFAULT_COLUMN_ORDER)];
                          const [moved] = newOrder.splice(dragIndex, 1);
                          newOrder.splice(i, 0, moved);
                          onDisplaySettingsChange({ ...displaySettings, columnOrder: newOrder });
                          setDragIndex(null);
                        }}
                        onDragEnd={() => setDragIndex(null)}
                        className={`flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0 cursor-grab active:cursor-grabbing transition-colors ${dragIndex === i ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                      >
                        <GripVertical size={14} className="text-gray-300 flex-shrink-0" />
                        <span className={`flex-1 text-sm ${isHidden ? 'text-gray-300' : 'text-gray-700'}`}>{label}</span>
                        <button
                          onClick={() => {
                            const current = displaySettings.hiddenColumns ?? [];
                            const next = isHidden
                              ? current.filter(k => k !== key)
                              : [...current, key];
                            onDisplaySettingsChange({ ...displaySettings, hiddenColumns: next });
                          }}
                          className="p-1 rounded hover:bg-gray-100 transition-colors"
                        >
                          {isHidden
                            ? <EyeOff size={15} className="text-gray-300" />
                            : <Eye size={15} className="text-gray-500" />
                          }
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview fields + default status */}
              <div className="border-t border-gray-100 pt-5 space-y-5">
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">الحقول المطلوبة في المعاينة</p>
                  <p className="text-xs text-gray-400 mb-3">الحقول الفارغة ستُظلَّل بالأحمر عند مراجعة الرحلات قبل الإضافة</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PREVIEW_FIELD_OPTIONS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-amber-50 transition-colors">
                        <input type="checkbox" checked={previewSettings.requiredFields.includes(key)} onChange={() => toggleRequiredField(key)} className="rounded border-gray-300 text-amber-500 w-4 h-4" />
                        <span className="text-xs font-medium text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">الحالة الافتراضية للرحلات الجديدة</label>
                  <select value={previewSettings.defaultStatus} onChange={(e) => onPreviewSettingsChange({ ...previewSettings, defaultStatus: e.target.value as TripStatus })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-amber-400 outline-none">
                    {STATUS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </div>

            </div>
          )}

          {/* ── Access management page ── */}
          {activePage === 'access' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
                  <ShieldCheck size={20} className="text-teal-600" /> المشاركة والصلاحيات
                </h2>
                <p className="text-sm text-gray-400">إدارة الأشخاص الذين يملكون وصولاً للرحلات أو المجموعات التي شاركتها</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">إجمالي المشاركات</p>
                  <p className="mt-2 text-3xl font-black text-gray-800">{shareAccessGrants.length}</p>
                </div>
                <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4">
                  <p className="text-[10px] font-black text-teal-600 uppercase tracking-wider">صلاحية تعديل</p>
                  <p className="mt-2 text-3xl font-black text-teal-800">{shareAccessGrants.filter(g => g.role === 'editor').length}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">مشاهدة فقط</p>
                  <p className="mt-2 text-3xl font-black text-slate-800">{shareAccessGrants.filter(g => g.role === 'viewer').length}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-700">المستخدمون المشتركون</p>
                  <span className="text-[10px] font-bold text-gray-400">المالك يحتفظ بالصلاحية الكاملة دائماً</span>
                </div>

                {shareAccessGrants.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {shareAccessGrants.map((grant) => (
                      <div key={`${grant.scopeType}-${grant.rowId || grant.groupNo || grant.agency}-${grant.userId}`} className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black text-gray-800">{grant.username}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                              grant.scopeType === 'agency'
                                ? 'bg-blue-50 text-blue-700 border-blue-100'
                                : grant.scopeType === 'group'
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                : 'bg-teal-50 text-teal-700 border-teal-100'
                            }`}>
                              {grant.scopeType === 'agency' ? 'وكيل' : grant.scopeType === 'group' ? 'مجموعة' : 'رحلة'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 truncate">{grant.rowSummary || grant.agency || grant.groupNo || grant.rowId}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <select
                            value={grant.role}
                            onChange={(e) => onUpdateShareAccessRole(grant, e.target.value as ShareRole)}
                            className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                          >
                            <option value="editor">تعديل</option>
                            <option value="viewer">مشاهدة فقط</option>
                          </select>
                          <button
                            onClick={() => onRevokeShareAccess(grant)}
                            className="min-h-[44px] min-w-[44px] rounded-xl border border-red-100 text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
                            title="إلغاء المشاركة"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-16 px-6 text-center bg-white">
                    <Users size={36} className="mx-auto text-gray-200 mb-3" />
                    <p className="text-sm font-bold text-gray-500">لا توجد مشاركات نشطة</p>
                    <p className="text-xs text-gray-400 mt-1">عند مشاركة رحلة أو مجموعة ستظهر هنا لإدارة صلاحياتها.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Extension page ── */}
          {activePage === 'extension' && (
            <div className="space-y-6 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
                  <Puzzle size={20} className="text-violet-600" /> إضافة المتصفح
                </h2>
                <p className="text-sm text-gray-400">أداة Chrome لاستيراد بيانات الرحلات تلقائياً</p>
              </div>

              <a
                href="/api/download/extension"
                download="umrah-extension.zip"
                className="flex items-center justify-center gap-3 w-full p-4 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl font-bold text-sm transition-all active:scale-95 shadow-lg shadow-violet-200"
              >
                <Download size={20} />
                تحميل الإضافة (ZIP)
              </a>

              <div className="bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <p className="text-sm font-bold text-gray-700">خطوات التثبيت على Chrome</p>
                </div>
                <div className="p-5 space-y-4">
                  {[
                    { Icon: Download,   step: '١', title: 'حمّل الملف المضغوط', desc: 'انقر على زر التحميل أعلاه للحصول على ملف umrah-extension.zip' },
                    { Icon: Package,    step: '٢', title: 'فك ضغط الملف',       desc: 'استخرج محتويات الملف المضغوط في مجلد على جهازك' },
                    { Icon: Monitor,    step: '٣', title: 'افتح صفحة الإضافات', desc: <>اكتب <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs" dir="ltr">chrome://extensions</span> في شريط العنوان واضغط Enter</> },
                    { Icon: SlidersHorizontal, step: '٤', title: 'فعّل وضع المطور', desc: 'شغّل مفتاح "Developer mode" في الزاوية اليمنى العليا من الصفحة' },
                    { Icon: FolderOpen, step: '٥', title: 'حمّل الإضافة',        desc: 'انقر على "Load unpacked" واختر المجلد الذي فككت فيه الضغط' },
                    { Icon: CheckCircle2, step: '٦', title: 'جاهز!',             desc: 'ستظهر أيقونة الإضافة في شريط الأدوات — انقر عليها عند فتح صفحة الحجوزات' },
                  ].map(({ Icon, step, title, desc }) => (
                    <div key={step} className="flex gap-4">
                      <div className="shrink-0 w-8 h-8 bg-violet-100 text-violet-700 rounded-xl flex items-center justify-center font-black text-sm">
                        {step}
                      </div>
                      <div className="pt-0.5">
                        <p className="text-sm font-bold text-gray-700">{title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  الإضافة تعمل على متصفح Chrome فقط. بعد التثبيت لا تحتاج لإعادة التثبيت — ستُحدَّث يدوياً عند صدور نسخة جديدة.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
