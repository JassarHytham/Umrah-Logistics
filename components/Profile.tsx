import React, { useRef, useState } from 'react';
import { User, Camera, Trash2, Building2, KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { UserAccount } from '../types';
import { api } from '../services/api';

interface ProfileProps {
  user: UserAccount | null;
  onUserUpdate: (user: UserAccount) => void;
}

const MAX_AVATAR_DIMENSION = 256;

// Downscale/compress the picked image client-side so we never ship a multi-MB
// phone photo to the server — a small JPEG data URI is plenty for an avatar.
const readAndCompressImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('تعذرت قراءة الملف'));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error('الملف ليس صورة صالحة'));
    img.onload = () => {
      const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('تعذرت معالجة الصورة'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
});

const FieldError: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-bold border border-red-100">{message}</div>
);

const FieldSuccess: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-green-50 text-green-700 p-3 rounded-xl text-xs font-bold border border-green-100 flex items-center gap-2">
    <CheckCircle2 size={14} /> {message}
  </div>
);

export const Profile: React.FC<ProfileProps> = ({ user, onUserUpdate }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  const [companyName, setCompanyName] = useState(user?.companyName || '');
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyError, setCompanyError] = useState('');
  const [companySuccess, setCompanySuccess] = useState(false);

  const [username, setUsername] = useState(user?.username || '');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  if (!user) return null;

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setAvatarError('الرجاء اختيار ملف صورة');
      return;
    }
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const dataUrl = await readAndCompressImage(file);
      const updated = await api.account.update({ avatar: dataUrl });
      onUserUpdate(updated);
    } catch (err: any) {
      setAvatarError(err.message || 'تعذر رفع الصورة');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const updated = await api.account.update({ avatar: null });
      onUserUpdate(updated);
    } catch (err: any) {
      setAvatarError(err.message || 'تعذرت إزالة الصورة');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleCompanySave = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompanyError('');
    setCompanySuccess(false);
    setCompanyBusy(true);
    try {
      const updated = await api.account.update({ companyName: companyName.trim() });
      onUserUpdate(updated);
      setCompanySuccess(true);
    } catch (err: any) {
      setCompanyError(err.message || 'تعذر حفظ اسم الشركة');
    } finally {
      setCompanyBusy(false);
    }
  };

  const handleUsernameSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess(false);
    if (!usernamePassword) {
      setUsernameError('أدخل كلمة المرور الحالية لتأكيد التغيير');
      return;
    }
    setUsernameBusy(true);
    try {
      const updated = await api.account.update({ username: username.trim(), currentPassword: usernamePassword });
      onUserUpdate(updated);
      setUsernameSuccess(true);
      setUsernamePassword('');
    } catch (err: any) {
      setUsernameError(err.message || 'تعذر تغيير اسم المستخدم');
    } finally {
      setUsernameBusy(false);
    }
  };

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);
    if (newPassword.length < 10) {
      setPasswordError('كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('كلمتا المرور غير متطابقتين');
      return;
    }
    setPasswordBusy(true);
    try {
      const updated = await api.account.update({ newPassword, currentPassword });
      onUserUpdate(updated);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.message || 'تعذر تغيير كلمة المرور');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden animate-fade-in" dir="rtl">
      <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-8">

        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-1">
            <User size={20} className="text-gold-600" /> الملف الشخصي
          </h2>
          <p className="text-sm text-gray-400">معلومات حسابك وصورتك واسم الشركة</p>
        </div>

        {/* ── Avatar ── */}
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="w-20 h-20 rounded-2xl bg-gold-100 border border-gold-200 overflow-hidden flex items-center justify-center">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <User size={32} className="text-gold-400" />
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
              className="absolute -bottom-2 -left-2 w-8 h-8 rounded-xl bg-gold-600 text-white flex items-center justify-center shadow-lg hover:bg-gold-700 transition-all disabled:opacity-50"
              aria-label="تغيير الصورة"
            >
              {avatarBusy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarPick} className="hidden" />
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-bold text-gray-700">الصورة الشخصية</p>
            <p className="text-xs text-gray-400">PNG أو JPEG أو WEBP، بحد أقصى ~1 ميجابايت</p>
            {user.avatar && (
              <button
                type="button"
                onClick={handleAvatarRemove}
                disabled={avatarBusy}
                className="text-xs font-bold text-red-500 hover:text-red-700 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 size={13} /> إزالة الصورة
              </button>
            )}
            {avatarError && <FieldError message={avatarError} />}
          </div>
        </div>

        {/* ── Company name ── */}
        <form onSubmit={handleCompanySave} className="border-t border-gray-100 pt-6 space-y-3">
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 size={13} className="text-gold-500" /> اسم الشركة
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => { setCompanyName(e.target.value); setCompanySuccess(false); }}
            maxLength={200}
            placeholder="اسم شركتك أو وكالتك"
            className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
          />
          {companyError && <FieldError message={companyError} />}
          {companySuccess && <FieldSuccess message="تم حفظ اسم الشركة" />}
          <button
            type="submit"
            disabled={companyBusy}
            className="bg-gold-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {companyBusy && <Loader2 size={14} className="animate-spin" />} حفظ
          </button>
        </form>

        {/* ── Username ── */}
        <form onSubmit={handleUsernameSave} className="border-t border-gray-100 pt-6 space-y-3">
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider flex items-center gap-1.5">
            <User size={13} className="text-gold-500" /> اسم المستخدم
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setUsernameSuccess(false); }}
            placeholder="اسم المستخدم"
            className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
            dir="ltr"
          />
          <input
            type="password"
            value={usernamePassword}
            onChange={(e) => setUsernamePassword(e.target.value)}
            placeholder="كلمة المرور الحالية لتأكيد التغيير"
            className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
          />
          {usernameError && <FieldError message={usernameError} />}
          {usernameSuccess && <FieldSuccess message="تم تغيير اسم المستخدم" />}
          <button
            type="submit"
            disabled={usernameBusy || username.trim() === user.username}
            className="bg-gold-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {usernameBusy && <Loader2 size={14} className="animate-spin" />} حفظ
          </button>
        </form>

        {/* ── Password ── */}
        <form onSubmit={handlePasswordSave} className="border-t border-gray-100 pt-6 space-y-3">
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider flex items-center gap-1.5">
            <KeyRound size={13} className="text-gold-500" /> تغيير كلمة المرور
          </label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="كلمة المرور الحالية"
            className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setPasswordSuccess(false); }}
            placeholder="كلمة المرور الجديدة (10 أحرف على الأقل)"
            className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="تأكيد كلمة المرور الجديدة"
            className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-gold-500 focus:bg-white transition-all outline-none"
          />
          {passwordError && <FieldError message={passwordError} />}
          {passwordSuccess && <FieldSuccess message="تم تغيير كلمة المرور" />}
          <button
            type="submit"
            disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
            className="bg-gold-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-gold-700 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {passwordBusy && <Loader2 size={14} className="animate-spin" />} حفظ
          </button>
        </form>
      </div>
    </div>
  );
};
