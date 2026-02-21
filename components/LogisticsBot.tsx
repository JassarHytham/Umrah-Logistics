
import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, MessageSquare, Loader2, Sparkles, Terminal } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { LogisticsRow, BotMessage } from '../types';

interface LogisticsBotProps {
  rows: LogisticsRow[];
}

export const LogisticsBot: React.FC<LogisticsBotProps> = ({ rows }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<BotMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'أهلاً بك! أنا مساعدك الذكي لنظام تفويج العمرة. كيف يمكنني مساعدتك في متابعة الرحلات اليوم؟',
      timestamp: new Date()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    // Debugging check: if process.env.API_KEY is missing, it will be an empty string ""
    if (!process.env.API_KEY) {
      console.error("Gemini API Key is missing. Ensure it's set during build time.");
      setMessages(prev => [...prev, {
        id: 'err-key',
        role: 'model',
        text: 'خطأ: لم يتم العثور على مفتاح API. يرجى التأكد من إعداد المتغيرات البيئية وإعادة بناء المشروع.',
        timestamp: new Date()
      }]);
      return;
    }

    const userMsg: BotMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const context = JSON.stringify(rows.map(r => ({
        group: r.groupNo,
        name: r.groupName,
        type: r.Column1,
        date: r.date,
        time: r.time,
        status: r.status,
        to: r.to
      })));

      const prompt = `You are an Umrah Logistics Assistant Bot. 
      You have access to the following logistics data: ${context}.
      Current Date/Time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })} (Riyadh Time).
      Respond in Arabic. Be concise and professional.
      Answer questions about schedules, upcoming trips, or summaries.
      If asked about "near trips" or "alerts", check the 2-hour window from now.
      User message: ${input}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      const aiMsg: BotMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: response.text || 'عذراً، لم أستطع معالجة الطلب حالياً.',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error("Bot Error:", error);
      setMessages(prev => [...prev, {
        id: 'err',
        role: 'model',
        text: 'حدث خطأ في الاتصال بالذكاء الاصطناعي. تأكد من صلاحية المفتاح والاتصال بالإنترنت.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-[100] flex flex-col items-start" dir="rtl">
      {isOpen && (
        <div className="mb-4 w-80 sm:w-96 h-[500px] bg-white rounded-2xl shadow-2xl border border-blue-100 flex flex-col overflow-hidden animate-slide-up">
          <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-4 flex justify-between items-center text-white">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 p-1.5 rounded-lg">
                <Sparkles size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold">مساعد العمليات الذكي</h3>
                <p className="text-[10px] text-blue-200">متصل بجدول البيانات</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/10 rounded-full">
              <X size={20} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-end">
                <div className="bg-white border border-gray-100 p-3 rounded-2xl rounded-tl-none">
                  <Loader2 size={16} className="animate-spin text-blue-600" />
                </div>
              </div>
            )}
          </div>

          <div className="p-3 bg-white border-t border-gray-100">
            <div className="relative">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="اسأل عن الرحلات القادمة..."
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button 
                onClick={handleSendMessage}
                disabled={!input.trim() || isLoading}
                className="absolute left-2 top-1.5 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="group relative flex items-center justify-center w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-700 text-white rounded-full shadow-xl hover:shadow-blue-200/50 hover:scale-110 transition-all active:scale-95"
      >
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full animate-pulse"></div>
        {isOpen ? <X size={28} /> : <Bot size={28} />}
        
        {!isOpen && (
          <div className="absolute right-16 bg-white px-3 py-1.5 rounded-lg shadow-lg border border-gray-100 text-blue-900 text-[10px] font-black whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            تحدث مع بوت العمليات
          </div>
        )}
      </button>
    </div>
  );
};
