import React, { useId, useState } from 'react';

export function CompanyTripSharingToggle({companyName,enabled,managerSeesAllTrips=true,onChange}:{companyName:string;enabled:boolean;managerSeesAllTrips?:boolean;onChange:(enabled:boolean)=>Promise<void>}) {
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const descriptionId=useId();
  const change=async()=>{
    if(saving)return;
    setSaving(true);setError('');
    try{await onChange(!enabled);}
    catch(err){setError(err instanceof Error?err.message:'تعذر تحديث مشاركة رحلات الشركة');}
    finally{setSaving(false);}
  };
  return <div className="min-w-[220px] max-w-sm" onClick={event=>event.stopPropagation()} aria-busy={saving}>
    <label className={`flex items-center gap-2 min-h-[44px] font-bold ${saving?'cursor-wait':'cursor-pointer'}`}>
      <input type="checkbox" role="switch" checked={enabled} aria-checked={enabled} disabled={saving}
        aria-label={`مشاركة جميع الرحلات داخل شركة ${companyName}`} aria-describedby={descriptionId}
        onChange={()=>void change()} className="h-5 w-5 accent-gold-600 focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2" />
      <span>{saving?'جارٍ الحفظ…':enabled?'مفعّلة':'متوقفة'}</span>
    </label>
    <p id={descriptionId} className="text-xs text-gray-600 leading-5">
      {enabled?(managerSeesAllTrips?'جميع الحسابات تشاهد رحلات الشركة.':'كل الحسابات عدا المدير تشاهد رحلات الشركة.'):'كل حساب يشاهد رحلاته والمشاركات المحددة فقط.'}
      {' '}{managerSeesAllTrips?'المدير والمالك يريان جميع الرحلات.':'المالك يرى جميع الرحلات؛ رؤية المدير تتبع الإعداد الخاص به.'}
    </p>
    {error&&<p role="alert" className="text-xs text-red-700 mt-1">{error}</p>}
  </div>;
}

export function ManagerTripVisibilityToggle({companyName,enabled,onChange}:{companyName:string;enabled:boolean;onChange:(enabled:boolean)=>Promise<void>}) {
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const descriptionId=useId();
  const change=async()=>{
    if(saving)return;
    setSaving(true);setError('');
    try{await onChange(!enabled);}
    catch(err){setError(err instanceof Error?err.message:'تعذر تحديث رؤية المدير للرحلات');}
    finally{setSaving(false);}
  };
  return <div className="min-w-[220px] max-w-sm" onClick={event=>event.stopPropagation()} aria-busy={saving}>
    <label className={`flex items-center gap-2 min-h-[44px] font-bold ${saving?'cursor-wait':'cursor-pointer'}`}>
      <input type="checkbox" role="switch" checked={enabled} aria-checked={enabled} disabled={saving}
        aria-label={`السماح لمديري شركة ${companyName} برؤية جميع الرحلات`} aria-describedby={descriptionId}
        onChange={()=>void change()} className="h-5 w-5 accent-gold-600 focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2" />
      <span>{saving?'جارٍ الحفظ…':enabled?'مفعّلة':'متوقفة'}</span>
    </label>
    <p id={descriptionId} className="text-xs text-gray-600 leading-5">{enabled?'المدير يرى جميع رحلات الشركة.':'المدير يرى رحلاته والمشاركات المحددة فقط، حتى عند تفعيل مشاركة جميع الرحلات.'}</p>
    {error&&<p role="alert" className="text-xs text-red-700 mt-1">{error}</p>}
  </div>;
}
