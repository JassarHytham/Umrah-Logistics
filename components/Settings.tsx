import React, { useState } from 'react';
import {
  Send, Zap, Bell, BellRing, Smartphone, CheckCircle2, Info,
  Loader2, SlidersHorizontal, Eye, Type, Minus, PlusCircle,
  LayoutList, AlignJustify, Download, Puzzle, ChevronLeft,
  Monitor, Package, FolderOpen
} from 'lucide-react';
import { TelegramConfig, TripStatus, AlertSettings, PreviewSettings, DisplaySettings } from '../types';

type SettingsPage = 'telegram' | 'alerts' | 'display' | 'extension';

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

const NAV_ITEMS: { id: SettingsPage; label: string; sublabel: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { id: 'telegram',  label: 'تيليجرام',       sublabel: 'ربط البوت والتنبيهات',   Icon: Send },
  { id: 'alerts',    label: 'التنبيهات',       sublabel: 'التوقيت وحقول الرسالة',  Icon: Bell },
  { id: 'display',   label: 'العرض والمعاينة', sublabel: 'الخط والجدول والحقول',   Icon: Eye },
  { id: 'extension', label: 'إضافة المتصفح',  sublabel: 'تحميل وتثبيت الإضافة',  Icon: Puzzle },
];

export const Settings: React.FC<SettingsProps> = ({
  tgConfig, onTgConfigChange, onTestTelegram, isTestingTg,
  alertSettings, onAlertSettingsChange,
  previewSettings, onPreviewSettingsChange,
  displaySettings, onDisplaySettingsChange,
  fontSize, onFontSizeChange,
  notifPermission, onRequestNotifPermission,
  notifiedCount, allRowsCount,
}) => {
  const [activePage, setActivePage] = useState<SettingsPage>('telegram');

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

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden animate-fade-in" dir="rtl">
      <div className="flex min-h-[600px]">

        {/* ── Sidebar ── */}
        <div className="w-56 shrink-0 bg-gray-50 border-l border-gray-100 flex flex-col py-3">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-4 py-3">الإعدادات</p>
          {NAV_ITEMS.map(({ id, label, sublabel, Icon }) => {
            const active = activePage === id;
            return (
              <button
                key={id}
                onClick={() => setActivePage(id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-all border-l-2 ${
                  active
                    ? 'bg-blue-50 border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <Icon size={18} className={active ? 'text-blue-600' : 'text-gray-400'} />
                <div className="min-w-0">
                  <p className={`text-sm font-bold truncate ${active ? 'text-blue-700' : 'text-gray-700'}`}>{label}</p>
                  <p className="text-[10px] text-gray-400 truncate">{sublabel}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Content area ── */}
        <div className="flex-1 overflow-y-auto p-8">

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

          {/* ── Alerts page ── */}
          {activePage === 'alerts' && (
            <div className="space-y-6 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
                  <Bell size={20} className="text-indigo-600" /> إعدادات التنبيهات
                </h2>
                <p className="text-sm text-gray-400">توقيت الإشعارات وحقول رسالة التيليجرام</p>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">قبل رحلة الوصول بـ</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range" min={10} max={300} step={5}
                      value={alertSettings.arrivalMinutes}
                      onChange={(e) => onAlertSettingsChange({ ...alertSettings, arrivalMinutes: Number(e.target.value) })}
                      className="flex-1 accent-blue-600"
                    />
                    <span className="text-xl font-black text-blue-700 w-16 text-center">{alertSettings.arrivalMinutes}<span className="text-xs font-bold"> د</span></span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">قبل رحلة المغادرة بـ</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range" min={10} max={300} step={5}
                      value={alertSettings.departureMinutes}
                      onChange={(e) => onAlertSettingsChange({ ...alertSettings, departureMinutes: Number(e.target.value) })}
                      className="flex-1 accent-indigo-600"
                    />
                    <span className="text-xl font-black text-indigo-700 w-16 text-center">{alertSettings.departureMinutes}<span className="text-xs font-bold"> د</span></span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">حقول رسالة التيليجرام</p>
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

              <div className="pt-2 border-t border-gray-100">
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
            </div>
          )}

          {/* ── Display & Preview page ── */}
          {activePage === 'display' && (
            <div className="space-y-8 max-w-xl">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
                  <Eye size={20} className="text-amber-500" /> العرض والمعاينة
                </h2>
                <p className="text-sm text-gray-400">حجم الخط وكثافة الجدول والحقول المطلوبة</p>
              </div>

              {/* Font size */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">حجم الخط</label>
                <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                  <button onClick={() => onFontSizeChange(-5)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <Minus size={16} />
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-2xl font-black text-gray-800">{fontSize}%</span>
                  </div>
                  <button onClick={() => onFontSizeChange(5)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <PlusCircle size={16} />
                  </button>
                </div>
              </div>

              {/* Density */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">كثافة الجدول</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => onDisplaySettingsChange({ ...displaySettings, density: 'compact' })}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${displaySettings.density === 'compact' ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-300'}`}
                  >
                    <LayoutList size={22} className={displaySettings.density === 'compact' ? 'text-blue-600' : 'text-gray-400'} />
                    <span className={`text-xs font-bold ${displaySettings.density === 'compact' ? 'text-blue-700' : 'text-gray-400'}`}>مضغوط</span>
                  </button>
                  <button
                    onClick={() => onDisplaySettingsChange({ ...displaySettings, density: 'comfortable' })}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${displaySettings.density === 'comfortable' ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-300'}`}
                  >
                    <AlignJustify size={22} className={displaySettings.density === 'comfortable' ? 'text-blue-600' : 'text-gray-400'} />
                    <span className={`text-xs font-bold ${displaySettings.density === 'comfortable' ? 'text-blue-700' : 'text-gray-400'}`}>مريح</span>
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-6 space-y-5">
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">الحقول المطلوبة في المعاينة</p>
                  <p className="text-xs text-gray-400 mb-3">الحقول الفارغة ستُظلَّل بالأحمر عند مراجعة الرحلات قبل الإضافة</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PREVIEW_FIELD_OPTIONS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-amber-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={previewSettings.requiredFields.includes(key)}
                          onChange={() => toggleRequiredField(key)}
                          className="rounded border-gray-300 text-amber-500 w-4 h-4"
                        />
                        <span className="text-xs font-medium text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">الحالة الافتراضية للرحلات الجديدة</label>
                  <select
                    value={previewSettings.defaultStatus}
                    onChange={(e) => onPreviewSettingsChange({ ...previewSettings, defaultStatus: e.target.value as TripStatus })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-amber-400 outline-none"
                  >
                    {STATUS_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
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
