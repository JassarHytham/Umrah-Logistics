import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { WorkspaceRole } from '../types';

type Member={userId:number;username:string;role:WorkspaceRole;isActive:number};
const labels:Record<WorkspaceRole,string>={owner:'مالك',manager:'مدير',editor:'محرر',viewer:'مشاهد'};

export function WorkspaceMembers({role}:{role:WorkspaceRole}) {
  const [members,setMembers]=useState<Member[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<number|null>(null);
  const [message,setMessage]=useState('');
  const load=async()=>{setMembers(await api.workspace.members());};
  useEffect(()=>{let active=true;api.workspace.members().then(data=>{if(active)setMembers(data);}).catch(()=>{if(active)setMessage('تعذر تحميل أعضاء الشركة');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const update=async(member:Member,payload:{role?:'manager'|'editor'|'viewer';isActive?:boolean})=>{
    setBusy(member.userId);setMessage('');
    try{await api.workspace.updateMember(member.userId,payload);await load();setMessage('تم تحديث عضوية الشركة');}
    catch(error){setMessage(error instanceof Error?error.message:'تعذر تحديث العضوية');}
    finally{setBusy(null);}
  };
  return <section className="space-y-3 mb-8" dir="rtl">
    <h3 className="text-lg font-bold text-gray-800">أعضاء الشركة</h3>
    <p className="text-sm text-gray-500">تبقى رحلات الشركة محفوظة عند تعطيل عضوية موظف.</p>
    <p role="status" className="text-sm text-gray-600">{loading?'جاري التحميل…':message}</p>
    <div className="overflow-x-auto"><table className="w-full text-right text-sm">
      <thead><tr className="border-b"><th className="p-3">الحساب</th><th className="p-3">الصلاحية</th><th className="p-3">الحالة</th></tr></thead>
      <tbody>{members.map(member=>{
        const locked=member.role==='owner'||(role==='manager'&&member.role==='manager')||busy!==null;
        return <tr key={member.userId} className="border-b border-gray-100">
          <td className="p-3" dir="ltr">{member.username}</td>
          <td className="p-3">{member.role==='owner'?labels.owner:<select aria-label={`صلاحية ${member.username}`} value={member.role} disabled={locked} className="border rounded-lg p-2 disabled:opacity-50" onChange={event=>update(member,{role:event.target.value as 'manager'|'editor'|'viewer'})}>
            {role==='owner'&&<option value="manager">مدير</option>}<option value="editor">محرر</option><option value="viewer">مشاهد</option>
          </select>}</td>
          <td className="p-3"><button type="button" disabled={locked} className="border rounded-lg px-3 py-2 disabled:opacity-50" onClick={()=>update(member,{isActive:!member.isActive})}>{member.isActive?'تعطيل العضوية':'تفعيل العضوية'}</button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}
