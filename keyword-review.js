(function(root){
  'use strict';
  function stable(value){
    if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
    if(value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value ?? null);
  }
  function empty(){return {version:1,sessions:{},changes:[]};}
  // Store a compact content fingerprint rather than duplicating whole rubrics per student.
  function fingerprint(value){
    const text=stable(value);let a=2166136261,b=2246822519;
    for(let i=0;i<text.length;i++){
      a=Math.imul(a^text.charCodeAt(i),16777619);
      b=Math.imul(b^text.charCodeAt(i),3266489917);
    }
    return `${text.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
  }
  function restore(raw){
    const result=empty();
    if(!raw || raw.version!==1) return result;
    Object.entries(raw.sessions || {}).forEach(([key,s])=>{
      if(!s || !Array.isArray(s.targets) || !s.questionId) return;
      result.sessions[key]={...s,targets:s.targets.filter(t=>t && typeof t.key==='string' && Number(t.page)>0),marks:s.marks && typeof s.marks==='object' ? s.marks : {}};
    });
    result.changes=Array.isArray(raw.changes)?raw.changes.filter(c=>c && typeof c.id==='string'):[];
    return result;
  }
  function key(meta){return JSON.stringify([meta.questionId,meta.itemId,meta.type,meta.keyword,meta.kind || 'keyword']);}
  function ensure(data, meta, targets){
    const id=key(meta);
    const session=data.sessions[id] ||= {...meta,targets:[],marks:{},completedAt:null,createdAt:Date.now()};
    const seen=new Set(session.targets.map(t=>t.key));
    targets.forEach(t=>{if(!seen.has(t.key)){session.targets.push({...t});seen.add(t.key);session.completedAt=null;}});
    return session;
  }
  function stats(session, signature){
    if(!session) return {total:0,reviewed:0,completed:false};
    const reviewed=session.targets.filter(t=>{
      const current=signature(t);
      return current!==null && session.marks[t.key]?.signature===current;
    }).length;
    const currentFingerprint=fingerprint(session.targets.map(t=>[t.key,signature(t)]));
    return {total:session.targets.length,reviewed,completed:!!session.completedAt && reviewed===session.targets.length && session.completionSignature===currentFingerprint,fingerprint:currentFingerprint};
  }
  function mark(session,target,signature){
    if(signature===null) return false;
    if(session.marks[target.key]?.signature===signature) delete session.marks[target.key];
    else session.marks[target.key]={signature,at:Date.now()};
    session.completedAt=null;
    return true;
  }
  function complete(session,signature){
    const progress=stats(session,signature);
    if(!progress.total || progress.reviewed!==progress.total) return false;
    session.completedAt=Date.now();session.completionSignature=progress.fingerprint;
    return true;
  }
  function differences(before,after,context,makeId){
    if(!before || !context) return [];
    const changes=[];
    const keys=new Set([...Object.keys(before),...Object.keys(after)]);
    keys.forEach(key=>{
      const a=before[key],b=after[key];
      const from=a?.score || 0,to=b?.score || 0;
      if(from===to) return;
      const info=b || a;
      const removed=(a?.choices || []).filter(x=>!(b?.choices || []).includes(x));
      const added=(b?.choices || []).filter(x=>!(a?.choices || []).includes(x));
      changes.push({id:makeId(),at:Date.now(),...info,before:from,after:to,totalBefore:a?.total || 0,totalAfter:b?.total || 0,context,detail:[removed.length?'해제: '+removed.join(', '):'',added.length?'선택: '+added.join(', '):''].filter(Boolean).join(' / ') || '배점 또는 채점 상태 변경',note:''});
    });
    return changes;
  }
  function merge(left,right){
    const next=restore(left),incoming=restore(right);
    const ids=new Set(next.changes.map(c=>c.id));
    incoming.changes.forEach(c=>{if(!ids.has(c.id)){next.changes.push(c);ids.add(c.id);}});
    Object.entries(incoming.sessions).forEach(([key,s])=>{
      if(!next.sessions[key]){next.sessions[key]=s;return;}
      const current=next.sessions[key],seen=new Set(current.targets.map(t=>t.key));
      s.targets.forEach(t=>{if(!seen.has(t.key)){current.targets.push(t);seen.add(t.key);}});
      Object.entries(s.marks).forEach(([id,mark])=>{if((mark.at || 0)>(current.marks[id]?.at || 0)) current.marks[id]=mark;});
      // Merged grades must be checked before declaring the whole keyword finished.
      current.completedAt=null;
    });
    return next;
  }
  const api={stable,fingerprint,empty,restore,key,ensure,stats,mark,complete,differences,merge};
  root.KeywordReview=api;
  if(typeof module!=='undefined') module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
