import React from 'react';
import {
  Send, Zap, Bell, BellRing, Smartphone, CheckCircle2, Info,
  Loader2, SlidersHorizontal, Eye, Type, Minus, PlusCircle,
  LayoutList, AlignJustify
} from 'lucide-react';
import { TelegramConfig, TripStatus, AlertSettings, PreviewSettings, DisplaySettings } from '../types';

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
  notifPermission: NotificationPermission | 'default';
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

export const Settings: React.FC<SettingsProps> = ({
  tgConfig, onTgConfigChange, onTestTelegram, isTestingTg,
  alertSettings, onAlertSettingsChange,
  previewSettings, onPreviewSettingsChange,
  displaySettings, onDisplaySettingsChange,
  fontSize, onFontSizeChange,
  notifPermission, onRequestNotifPermission,
  notifiedCount, allRowsCount,
}) => {
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in text-right" dir="rtl">

      {/* ── Section 1: Telegram Bot ── */}
      <section className="bg-white rounded-3xl shadow-xl border border-blue-50 overflow-hidden">
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
              onChange={(e) => onTgConfigChange({ ...tgConfig, token: e.target.value })}
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
              onChange={(e) => onTgConfigChange({ ...tgConfig, chatId: e.target.value })}
              placeholder="مثال: 123456789"
              className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-left"
              dir="ltr"
            />
          </div>

          <div className="pt-4 border-t border-gray-100 flex flex-col gap-4">
            <div className="flex items-center justify-between bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${tgConfig.enabled ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-300'}`} />
                <span className="text-sm font-bold text-blue-900">وضع التنبيهات التلقائية</span>
              </div>
              <button
                onClick={() => onTgConfigChange({ ...tgConfig, enabled: !tgConfig.enabled })}
                className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${tgConfig.enabled ? 'bg-red-500 text-white shadow-lg hover:bg-red-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {tgConfig.enabled ? 'إيقاف الخدمة' : 'تشغيل الخدمة'}
              </button>
            </div>
            <button
              onClick={onTestTelegram}
              disabled={!tgConfig.token || !tgConfig.chatId || isTestingTg}
              className="w-full flex items-center justify-center gap-3 p-4 bg-white border-2 border-blue-600 text-blue-600 rounded-2xl font-black text-sm hover:bg-blue-50 transition-all active:scale-95 disabled:opacity-50 disabled:border-gray-300 disabled:text-gray-400"
            >
              {isTestingTg ? <Loader2 size={20} className="animate-spin" /> : <Zap size={20} className="fill-current" />}
              اختبار اتصال البوت الآن
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
            </ol>
          </div>
        </div>
      </section>

      {/* ── Section 2: Alert Timing & Message Fields ── */}
      <section className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="bg-indigo-600 p-8 text-white relative">
          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
              <Bell size={28} /> إعدادات التنبيهات
            </h2>
            <p className="text-indigo-100 text-sm">توقيت الإشعارات وحقول رسالة التيليجرام</p>
          </div>
          <BellRing size={120} className="absolute -bottom-10 -left-10 text-white/10 rotate-12" />
        </div>

        <div className="p-8 space-y-6">
          {/* Arrival timing */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">قبل رحلة الوصول بـ</label>
            <div className="flex items-center gap-4">
              <input
                type="range" min={10} max={300} step={5}
                value={alertSettings.arrivalMinutes}
                onChange={(e) => onAlertSettingsChange({ ...alertSettings, arrivalMinutes: Number(e.target.value) })}
                className="flex-1 accent-blue-600"
              />
              <span className="text-lg font-black text-blue-700 w-20 text-left">{alertSettings.arrivalMinutes} د</span>
            </div>
          </div>

          {/* Departure timing */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">قبل رحلة المغادرة بـ</label>
            <div className="flex items-center gap-4">
              <input
                type="range" min={10} max={300} step={5}
                value={alertSettings.departureMinutes}
                onChange={(e) => onAlertSettingsChange({ ...alertSettings, departureMinutes: Number(e.target.value) })}
                className="flex-1 accent-indigo-600"
              />
              <span className="text-lg font-black text-indigo-700 w-20 text-left">{alertSettings.departureMinutes} د</span>
            </div>
          </div>

          {/* Message field toggles */}
          <div className="pt-4 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">حقول رسالة التيليجرام</p>
            <div className="grid grid-cols-2 gap-2">
              {([ ['flight', 'رقم الرحلة'], ['carType', 'نوع السيارة'], ['count', 'العدد'], ['tafweej', 'التفويج'] ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={alertSettings.messageFields[key]}
                    onChange={() => toggleMessageField(key)}
                    className="rounded border-gray-300 text-blue-600 w-4 h-4"
                  />
                  <span className="text-xs font-medium text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Browser notifications */}
          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
              <div className="flex items-center gap-3">
                <Smartphone size={20} className="text-emerald-600" />
                <span className="text-sm font-bold text-emerald-900">إشعارات المتصفح</span>
              </div>
              {notifPermission === 'granted' ? (
                <span className="flex items-center gap-1.5 text-xs font-black text-emerald-700 bg-white px-3 py-1.5 rounded-full border border-emerald-200">
                  <CheckCircle2 size={16} /> مفعّل
                </span>
              ) : (
                <button
                  onClick={onRequestNotifPermission}
                  className="text-xs font-bold bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 transition-all"
                >
                  تفعيل
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <p className="text-3xl font-black text-blue-900">{allRowsCount}</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">رحلة مسجلة</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <p className="text-3xl font-black text-emerald-600">{notifiedCount}</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">إشعار أُرسل</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Preview Settings ── */}
      <section className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="bg-amber-500 p-8 text-white relative">
          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
              <Eye size={28} /> إعدادات المعاينة
            </h2>
            <p className="text-amber-100 text-sm">الحقول المطلوبة والحالة الافتراضية للرحلات الجديدة</p>
          </div>
          <SlidersHorizontal size={120} className="absolute -bottom-10 -left-10 text-white/10 rotate-12" />
        </div>

        <div className="p-8 space-y-6">
          <div>
            <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">الحقول المطلوبة (تُظلَّل بالأحمر إذا كانت فارغة)</p>
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

          <div className="pt-4 border-t border-gray-100">
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
      </section>

      {/* ── Section 4: Display Settings ── */}
      <section className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="bg-slate-700 p-8 text-white relative">
          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
              <Type size={28} /> إعدادات العرض
            </h2>
            <p className="text-slate-300 text-sm">حجم الخط وكثافة الجدول</p>
          </div>
          <AlignJustify size={120} className="absolute -bottom-10 -left-10 text-white/10 rotate-12" />
        </div>

        <div className="p-8 space-y-6">
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
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${displaySettings.density === 'compact' ? 'border-slate-700 bg-slate-50' : 'border-gray-100 hover:border-gray-300'}`}
              >
                <LayoutList size={24} className={displaySettings.density === 'compact' ? 'text-slate-700' : 'text-gray-400'} />
                <span className={`text-xs font-bold ${displaySettings.density === 'compact' ? 'text-slate-700' : 'text-gray-400'}`}>مضغوط</span>
              </button>
              <button
                onClick={() => onDisplaySettingsChange({ ...displaySettings, density: 'comfortable' })}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${displaySettings.density === 'comfortable' ? 'border-slate-700 bg-slate-50' : 'border-gray-100 hover:border-gray-300'}`}
              >
                <AlignJustify size={24} className={displaySettings.density === 'comfortable' ? 'text-slate-700' : 'text-gray-400'} />
                <span className={`text-xs font-bold ${displaySettings.density === 'comfortable' ? 'text-slate-700' : 'text-gray-400'}`}>مريح</span>
              </button>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};
