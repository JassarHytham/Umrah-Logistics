
import React, { useState } from 'react';
import { LogIn, UserPlus, ShieldCheck, Loader2 } from 'lucide-react';
import { api } from '../services/api';

interface AuthProps {
  onLogin: (user: any) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = isLogin 
        ? await api.auth.login({ username, password })
        : await api.auth.register({ username, password });
      onLogin(user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 font-['Tajawal']" dir="rtl">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100">
        <div className="bg-blue-600 p-8 text-white text-center">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-bold">نظام التفويج اللوجستي</h1>
          <p className="text-blue-100 text-sm mt-2">سجل دخولك للوصول إلى بياناتك من أي مكان</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-bold border border-red-100 animate-shake">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">اسم المستخدم</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
                placeholder="أدخل اسم المستخدم"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">كلمة المرور</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-100 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : isLogin ? (
              <>
                <LogIn size={20} />
                تسجيل الدخول
              </>
            ) : (
              <>
                <UserPlus size={20} />
                إنشاء حساب جديد
              </>
            )}
          </button>

          <div className="text-center">
            <button 
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-blue-600 font-bold hover:underline"
            >
              {isLogin ? 'ليس لديك حساب؟ سجل الآن' : 'لديك حساب بالفعل؟ سجل دخولك'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
