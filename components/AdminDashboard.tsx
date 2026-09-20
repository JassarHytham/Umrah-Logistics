import React, { useEffect, useState } from 'react';
import { Users, Building2, Activity, Server, Plus, KeyRound, Ban, CheckCircle2, Trash2, LogOut, Loader2, X, Menu, Search } from 'lucide-react';
import { api } from '../services/api';
import type { AdminUser, AdminCompany, AdminAuditEvent, AdminHealth } from '../types';

interface AdminDashboardProps {
  user: any;
}

type Tab = 'users' | 'companies' | 'activity' | 'health';

const EVENT_LABELS: Record<string, string> = {
  login_success: 'تسجيل دخول ناجح',
  login_failure: 'محاولة تسجيل دخول فاشلة',
  user_created: 'إنشاء مستخدم',
  user_password_reset: 'إعادة تعيين كلمة مرور',
  user_disabled: 'تعطيل مستخدم',
  user_enabled: 'تفعيل مستخدم',
  user_deleted: 'حذف مستخدم',
  company_created: 'إنشاء شركة',
  company_renamed: 'إعادة تسمية شركة',
  company_deleted: 'حذف شركة',
  row_updated: 'تعديل رحلة',
  row_deleted: 'حذف رحلة (سلة المحذوفات)',
  row_restored: 'استعادة رحلة',
  row_purged: 'حذف رحلة نهائياً',
  rows_purged_bulk: 'إفراغ سلة المحذوفات',
  bulk_operation: 'عملية جماعية على الرحلات',
  data_synced: 'مزامنة بيانات',
  share_invitation_created: 'إرسال دعوة مشاركة',
  share_invitation_accepted: 'قبول دعوة مشاركة',
  share_invitation_declined: 'رفض دعوة مشاركة',
  share_access_updated: 'تعديل صلاحية مشاركة',
  share_access_revoked: 'إلغاء صلاحية مشاركة',
  telegram_config_updated: 'تحديث إعدادات تيليجرام',
  account_updated: 'تعديل بيانات الحساب',
  ingest_processed: 'استيراد نص من الإضافة',
  ingest_failed: 'فشل استيراد نص من الإضافة',
  telegram_alert_sent: 'إرسال تنبيه تيليجرام',
  telegram_alert_failed: 'فشل إرسال تنبيه تيليجرام',
  unhandled_error: 'خطأ غير متوقع في الخادم',
  process_error: 'خطأ في عملية الخادم',
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'الدخول',
  user_mgmt: 'المستخدمون',
  company_mgmt: 'الشركات',
  data: 'البيانات',
  sharing: 'المشاركة',
  settings: 'الإعدادات',
  integration: 'التكاملات',
  system: 'النظام',
};

const LEVEL_LABELS: Record<string, string> = {
  info: 'معلومة',
  warning: 'تحذير',
  error: 'خطأ',
};

const LEVEL_STYLES: Record<string, string> = {
  info: 'border-gray-100',
  warning: 'border-amber-400 bg-amber-50/50',
  error: 'border-red-400 bg-red-50/50',
};

const LEVEL_TEXT_STYLES: Record<string, string> = {
  info: 'text-gray-900',
  warning: 'text-amber-700',
  error: 'text-red-700',
};

const NAV_ITEMS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'users', label: 'المستخدمون', icon: Users },
  { key: 'companies', label: 'الشركات', icon: Building2 },
  { key: 'activity', label: 'النشاط', icon: Activity },
  { key: 'health', label: 'صحة الخادم', icon: Server },
];

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; maxWidth?: string }> = ({ title, onClose, children, maxWidth = 'max-w-sm' }) => (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} p-6 space-y-4`}>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">{title}</h3>
        <button onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
      </div>
      {children}
    </div>
  </div>
);

const CreateUserModal: React.FC<{ companies: AdminCompany[]; onClose: () => void; onCreated: () => void }> = ({ companies, onClose, onCreated }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [companyId, setCompanyId] = useState<string>('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.createUser({ username, password, companyId: companyId ? Number(companyId) : null });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'فشل إنشاء المستخدم');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إضافة مستخدم" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">اسم المستخدم</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">كلمة المرور</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">الشركة (اختياري)</label>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500">
            <option value="">بدون شركة</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'إنشاء'}
        </button>
      </form>
    </ModalShell>
  );
};

const CreateCompanyModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.createCompany(name);
      onCreated();
    } catch (err: any) {
      setError(err.message || 'فشل إنشاء الشركة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إضافة شركة" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">اسم الشركة</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'إنشاء'}
        </button>
      </form>
    </ModalShell>
  );
};

const ResetPasswordModal: React.FC<{ userId: number; onClose: () => void; onDone: () => void }> = ({ userId, onClose, onDone }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.resetPassword(userId, password);
      onDone();
    } catch (err: any) {
      setError(err.message || 'فشل إعادة تعيين كلمة المرور');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إعادة تعيين كلمة المرور" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">كلمة المرور الجديدة</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'حفظ'}
        </button>
      </form>
    </ModalShell>
  );
};

const RenameCompanyModal: React.FC<{ company: AdminCompany; onClose: () => void; onDone: () => void }> = ({ company, onClose, onDone }) => {
  const [name, setName] = useState(company.name);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.admin.updateCompany(company.id, name);
      onDone();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث الشركة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="إعادة تسمية الشركة" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold">{error}</div>}
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">اسم الشركة</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold-500" />
        </div>
        <button type="submit" disabled={saving} className="w-full bg-gold-600 text-white p-3 rounded-xl font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="animate-spin" size={18} /> : 'حفظ'}
        </button>
      </form>
    </ModalShell>
  );
};

const CompanyUsersModal: React.FC<{
  company: AdminCompany;
  users: AdminUser[];
  onClose: () => void;
  onResetPassword: (id: number) => void;
  onToggleActive: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
}> = ({ company, users, onClose, onResetPassword, onToggleActive, onDelete }) => {
  const companyUsers = users.filter((u) => u.companyId === company.id);

  return (
    <ModalShell title={`مستخدمو ${company.name}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {companyUsers.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">لا يوجد مستخدمون في هذه الشركة</p>
        ) : companyUsers.map((u) => (
          <div key={u.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div>
              <p className="font-bold text-sm">{u.username}</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${u.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {u.isActive ? 'نشط' : 'معطل'}
              </span>
            </div>
            {u.role !== 'admin' && (
              <div className="flex items-center gap-1">
                <button onClick={() => onResetPassword(u.id)} title="إعادة تعيين كلمة المرور" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><KeyRound size={16} /></button>
                <button onClick={() => onToggleActive(u)} title={u.isActive ? 'تعطيل' : 'تفعيل'} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                  {u.isActive ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                </button>
                <button onClick={() => onDelete(u)} title="حذف" className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </ModalShell>
  );
};

const Sidebar: React.FC<{ tab: Tab; onSelect: (t: Tab) => void; mobileOpen: boolean; onCloseMobile: () => void }> = ({ tab, onSelect, mobileOpen, onCloseMobile }) => {
  const nav = (
    <nav className="space-y-1">
      {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => { onSelect(key); onCloseMobile(); }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${tab === key ? 'bg-gold-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Icon size={18} /> {label}
        </button>
      ))}
    </nav>
  );

  return (
    <>
      <aside className="hidden sm:block sm:w-56 shrink-0">
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 sticky top-24">
          {nav}
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={onCloseMobile} />
          <div className="absolute top-0 right-0 h-full w-64 bg-white shadow-2xl p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-bold">القائمة</h2>
              <button onClick={onCloseMobile} aria-label="إغلاق"><X size={18} /></button>
            </div>
            {nav}
          </div>
        </div>
      )}
    </>
  );
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = -1;
  do { val /= 1024; i++; } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(1)} ${units[i]}`;
};

const formatDuration = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}ي`);
  if (h) parts.push(`${h}س`);
  parts.push(`${m}د`);
  return parts.join(' ');
};

const HEALTH_TONE_CLASSES: Record<string, string> = {
  default: 'text-gray-900',
  good: 'text-green-700',
  warn: 'text-amber-600',
  bad: 'text-red-600',
};

const StatCard: React.FC<{ label: string; value: React.ReactNode; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }> = ({ label, value, sub, tone = 'default' }) => (
  <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
    <p className="text-xs text-gray-400 font-bold uppercase">{label}</p>
    <p className={`text-xl font-bold ${HEALTH_TONE_CLASSES[tone]}`}>{value}</p>
    {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
  </div>
);

const HealthPanel: React.FC = () => {
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.admin.health();
        setHealth(res);
        setError('');
      } catch (err: any) {
        setError(err.message || 'تعذر تحميل حالة الخادم');
      }
    };
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  if (!health) {
    return (
      <div className="flex items-center justify-center py-20">
        {error ? <p className="text-red-600 text-sm font-bold">{error}</p> : <Loader2 className="animate-spin text-gold-600" size={32} />}
      </div>
    );
  }

  const usedMemBytes = health.system.memory.totalBytes - health.system.memory.freeBytes;
  const memPercent = Math.round((usedMemBytes / health.system.memory.totalBytes) * 1000) / 10;

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-bold border border-red-100">{error}</div>}

      <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-gray-100"><h2 className="text-lg font-bold">التطبيق</h2></div>
        <div className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            label="قاعدة البيانات"
            value={health.app.dbConnected ? 'متصلة' : 'غير متصلة'}
            tone={health.app.dbConnected ? 'good' : 'bad'}
            sub={health.app.dbSizeBytes != null ? formatBytes(health.app.dbSizeBytes) : undefined}
          />
          <StatCard label="وقت تشغيل الخادم" value={formatDuration(health.app.uptimeSeconds)} sub={health.app.nodeVersion} />
          <StatCard label="ذاكرة العملية" value={formatBytes(health.app.memory.rssBytes)} />
          <StatCard label="اتصالات مباشرة" value={`${health.app.websocket.connectedUsers} مستخدم`} sub={`${health.app.websocket.totalSockets} اتصال`} />
          <StatCard
            label="أخطاء (آخر ساعة)"
            value={health.app.recentErrors.lastHour}
            tone={health.app.recentErrors.lastHour > 0 ? 'bad' : 'good'}
          />
          <StatCard
            label="أخطاء (24 ساعة)"
            value={health.app.recentErrors.last24h}
            tone={health.app.recentErrors.last24h > 0 ? 'warn' : 'good'}
          />
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-gray-100"><h2 className="text-lg font-bold">الخادم (VPS)</h2></div>
        <div className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="وقت تشغيل النظام" value={formatDuration(health.system.uptimeSeconds)} sub={health.system.platform} />
          <StatCard label="المعالج (متوسط الحمل)" value={health.system.loadAvg.map((n) => n.toFixed(2)).join(' / ')} sub={`${health.system.cpuCount} أنوية`} />
          <StatCard
            label="الذاكرة"
            value={`${memPercent}%`}
            tone={memPercent >= 90 ? 'bad' : memPercent >= 70 ? 'warn' : 'good'}
            sub={`${formatBytes(usedMemBytes)} / ${formatBytes(health.system.memory.totalBytes)}`}
          />
          {health.system.disk ? (
            <StatCard
              label="التخزين"
              value={`${health.system.disk.usedPercent}%`}
              tone={health.system.disk.usedPercent >= 90 ? 'bad' : health.system.disk.usedPercent >= 70 ? 'warn' : 'good'}
              sub={`${formatBytes(health.system.disk.usedBytes)} / ${formatBytes(health.system.disk.totalBytes)}`}
            />
          ) : (
            <StatCard label="التخزين" value="غير متاح" />
          )}
        </div>
      </section>
    </div>
  );
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user }) => {
  const [tab, setTab] = useState<Tab>('users');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<{ totalUsers: number; activeUsers: number; totalCompanies: number; totalRows: number } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [companySearch, setCompanySearch] = useState('');

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<number | null>(null);
  const [renameCompanyId, setRenameCompanyId] = useState<number | null>(null);
  const [viewCompanyId, setViewCompanyId] = useState<number | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewRes, usersRes, companiesRes, auditRes] = await Promise.all([
        api.admin.overview(),
        api.admin.listUsers(),
        api.admin.listCompanies(),
        api.admin.listAuditLog(),
      ]);
      setOverview(overviewRes);
      setUsers(usersRes.users);
      setCompanies(companiesRes.companies);
      setEvents(auditRes.events);
    } catch (err: any) {
      setError(err.message || 'تعذر تحميل بيانات لوحة التحكم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadAudit = async (category: string, level: string) => {
    try {
      const auditRes = await api.admin.listAuditLog({ category: category || undefined, level: level || undefined });
      setEvents(auditRes.events);
    } catch (err: any) {
      setError(err.message || 'تعذر تحميل سجل النشاط');
    }
  };

  const handleCategoryFilterChange = (value: string) => {
    setCategoryFilter(value);
    loadAudit(value, levelFilter);
  };

  const handleLevelFilterChange = (value: string) => {
    setLevelFilter(value);
    loadAudit(categoryFilter, value);
  };

  const handleChangeCompany = async (target: AdminUser, companyId: string) => {
    try {
      await api.admin.updateUser(target.id, { companyId: companyId ? Number(companyId) : null });
      loadAll();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث شركة المستخدم');
    }
  };

  const handleToggleActive = async (target: AdminUser) => {
    try {
      await api.admin.updateUser(target.id, { isActive: !target.isActive });
      loadAll();
    } catch (err: any) {
      setError(err.message || 'فشل تحديث حالة المستخدم');
    }
  };

  const handleDeleteUser = async (target: AdminUser) => {
    if (!window.confirm(`هل أنت متأكد من حذف المستخدم "${target.username}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      await api.admin.deleteUser(target.id);
      loadAll();
    } catch (err: any) {
      setError(err.message || 'فشل حذف المستخدم');
    }
  };

  const handleDeleteCompany = async (company: AdminCompany) => {
    if (!window.confirm(`هل أنت متأكد من حذف شركة "${company.name}"؟`)) return;
    try {
      await api.admin.deleteCompany(company.id);
      loadAll();
    } catch (err: any) {
      setError(err.message || 'فشل حذف الشركة');
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return u.username.toLowerCase().includes(q) || (u.companyName || '').toLowerCase().includes(q);
  });

  const filteredCompanies = companies.filter((c) => c.name.toLowerCase().includes(companySearch.trim().toLowerCase()));

  const viewCompany = viewCompanyId !== null ? companies.find((c) => c.id === viewCompanyId) || null : null;

  return (
    <div className="min-h-screen bg-white text-right" dir="rtl">
      <div className="bg-gradient-to-l from-gray-900 via-gray-800 to-gray-800 text-white shadow-lg sticky top-0 z-40 border-b border-gold-700/40">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 sm:gap-4">
            <button onClick={() => setSidebarOpen(true)} className="sm:hidden p-2 rounded-lg hover:bg-white/10" aria-label="القائمة">
              <Menu size={20} />
            </button>
            <div className="bg-white p-2 sm:p-2.5 rounded-xl shadow-sm"><img src="/assets/logo-icon.png" alt="UM Track" className="h-6 w-auto sm:h-7" /></div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold">UM Track</h1>
              <p className="text-gold-200 text-[10px] sm:text-xs">لوحة تحكم المسؤول</p>
            </div>
          </div>
          <button
            onClick={() => api.auth.logout()}
            className="flex items-center gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-xl transition-all"
            style={{ minHeight: '44px' }}
          >
            <LogOut size={16} /> خروج
          </button>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 flex gap-6 items-start">
        <Sidebar tab={tab} onSelect={setTab} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} />

        <main className="flex-1 min-w-0 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-bold border border-red-100 flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="إغلاق"><X size={16} /></button>
            </div>
          )}

          {overview && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-400 font-bold uppercase">المستخدمون</p>
                <p className="text-2xl font-bold text-gray-900">{overview.totalUsers}</p>
              </div>
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-400 font-bold uppercase">نشطون</p>
                <p className="text-2xl font-bold text-gray-900">{overview.activeUsers}</p>
              </div>
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-400 font-bold uppercase">الشركات</p>
                <p className="text-2xl font-bold text-gray-900">{overview.totalCompanies}</p>
              </div>
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-400 font-bold uppercase">رحلات مسجلة</p>
                <p className="text-2xl font-bold text-gray-900">{overview.totalRows}</p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gold-600" size={32} /></div>
          ) : tab === 'users' ? (
            <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-4 sm:p-6 flex flex-wrap justify-between items-center gap-3 border-b border-gray-100">
                <h2 className="text-lg font-bold">المستخدمون</h2>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="بحث بالاسم أو الشركة"
                      className="pr-9 pl-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500 w-48"
                    />
                  </div>
                  <button onClick={() => setShowCreateUser(true)} className="flex items-center gap-2 bg-gold-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gold-700 transition-all">
                    <Plus size={16} /> إضافة مستخدم
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 font-bold">
                    <tr className="border-b">
                      <th className="text-right p-3">اسم المستخدم</th>
                      <th className="text-right p-3">الشركة</th>
                      <th className="text-right p-3">الحالة</th>
                      <th className="text-right p-3">آخر دخول</th>
                      <th className="text-right p-3">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr><td colSpan={5} className="p-6 text-center text-gray-400 text-sm">لا توجد نتائج مطابقة</td></tr>
                    ) : filteredUsers.map((u) => (
                      <tr key={u.id} className="border-b hover:bg-gray-50">
                        <td className="p-3 font-bold">{u.username}{u.role === 'admin' && <span className="mr-2 text-[10px] bg-gold-100 text-gold-700 px-2 py-0.5 rounded-full">مسؤول</span>}</td>
                        <td className="p-3 text-gray-500">
                          {u.role === 'admin' ? (
                            u.companyName || '—'
                          ) : (
                            <select
                              value={u.companyId ?? ''}
                              onChange={(e) => handleChangeCompany(u, e.target.value)}
                              className="p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gold-500"
                            >
                              <option value="">بدون شركة</option>
                              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="p-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${u.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                            {u.isActive ? 'نشط' : 'معطل'}
                          </span>
                        </td>
                        <td className="p-3 text-gray-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ar-SA') : 'لم يسجل دخول بعد'}</td>
                        <td className="p-3">
                          {u.role !== 'admin' && (
                            <div className="flex items-center gap-2">
                              <button onClick={() => setResetPasswordUserId(u.id)} title="إعادة تعيين كلمة المرور" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><KeyRound size={16} /></button>
                              <button onClick={() => handleToggleActive(u)} title={u.isActive ? 'تعطيل' : 'تفعيل'} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                                {u.isActive ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                              </button>
                              <button onClick={() => handleDeleteUser(u)} title="حذف" className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : tab === 'companies' ? (
            <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-4 sm:p-6 flex flex-wrap justify-between items-center gap-3 border-b border-gray-100">
                <h2 className="text-lg font-bold">الشركات</h2>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      placeholder="بحث باسم الشركة"
                      className="pr-9 pl-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-500 w-48"
                    />
                  </div>
                  <button onClick={() => setShowCreateCompany(true)} className="flex items-center gap-2 bg-gold-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gold-700 transition-all">
                    <Plus size={16} /> إضافة شركة
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 font-bold">
                    <tr className="border-b">
                      <th className="text-right p-3">الاسم</th>
                      <th className="text-right p-3">عدد المستخدمين</th>
                      <th className="text-right p-3">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompanies.length === 0 ? (
                      <tr><td colSpan={3} className="p-6 text-center text-gray-400 text-sm">لا توجد نتائج مطابقة</td></tr>
                    ) : filteredCompanies.map((c) => (
                      <tr key={c.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setViewCompanyId(c.id)}>
                        <td className="p-3 font-bold">{c.name}</td>
                        <td className="p-3 text-gray-500">{c.userCount}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setViewCompanyId(c.id)} title="عرض المستخدمين" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><Users size={16} /></button>
                            <button onClick={() => setRenameCompanyId(c.id)} title="إعادة تسمية" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><Building2 size={16} /></button>
                            <button onClick={() => handleDeleteCompany(c)} title="حذف" className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : tab === 'activity' ? (
            <section className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-4 sm:p-6 border-b border-gray-100 flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-lg font-bold">آخر 200 حدث</h2>
                <div className="flex gap-2">
                  <select
                    value={categoryFilter}
                    onChange={(e) => handleCategoryFilterChange(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50"
                  >
                    <option value="">كل الأقسام</option>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select
                    value={levelFilter}
                    onChange={(e) => handleLevelFilterChange(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50"
                  >
                    <option value="">كل المستويات</option>
                    {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {events.length === 0 ? (
                  <p className="p-6 text-gray-400 text-sm">لا يوجد نشاط بعد</p>
                ) : events.map((e) => (
                  <div key={e.id} className={`p-4 flex justify-between items-center text-sm border-r-4 ${LEVEL_STYLES[e.level] || LEVEL_STYLES.info}`}>
                    <div>
                      <p className={`font-bold ${LEVEL_TEXT_STYLES[e.level] || LEVEL_TEXT_STYLES.info}`}>{EVENT_LABELS[e.eventType] || e.eventType}</p>
                      <p className="text-gray-400 text-xs">
                        {e.actorUsername ? `بواسطة ${e.actorUsername}` : ''}
                        {e.targetUsername ? ` — المستهدف: ${e.targetUsername}` : ''}
                      </p>
                    </div>
                    <span className="text-gray-400 text-xs">{new Date(e.createdAt).toLocaleString('ar-SA')}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <HealthPanel />
          )}
        </main>
      </div>

      {showCreateUser && (
        <CreateUserModal
          companies={companies}
          onClose={() => setShowCreateUser(false)}
          onCreated={() => { setShowCreateUser(false); loadAll(); }}
        />
      )}
      {showCreateCompany && (
        <CreateCompanyModal
          onClose={() => setShowCreateCompany(false)}
          onCreated={() => { setShowCreateCompany(false); loadAll(); }}
        />
      )}
      {resetPasswordUserId !== null && (
        <ResetPasswordModal
          userId={resetPasswordUserId}
          onClose={() => setResetPasswordUserId(null)}
          onDone={() => { setResetPasswordUserId(null); loadAll(); }}
        />
      )}
      {renameCompanyId !== null && (
        <RenameCompanyModal
          company={companies.find((c) => c.id === renameCompanyId)!}
          onClose={() => setRenameCompanyId(null)}
          onDone={() => { setRenameCompanyId(null); loadAll(); }}
        />
      )}
      {viewCompany && (
        <CompanyUsersModal
          company={viewCompany}
          users={users}
          onClose={() => setViewCompanyId(null)}
          onResetPassword={(id) => { setViewCompanyId(null); setResetPasswordUserId(id); }}
          onToggleActive={handleToggleActive}
          onDelete={handleDeleteUser}
        />
      )}
    </div>
  );
};
