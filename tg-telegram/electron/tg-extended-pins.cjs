'use strict';

function transformedJsResponse(response, body) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, no-cache, must-revalidate');
    headers.set('pragma', 'no-cache');
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('content-security-policy');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function patchToggleAction(body) {
    const marker = '`toggleChatPinned`';
    const at = body.indexOf(marker);
    if (at < 0) return { body, patched: false };
    const scanStart = Math.max(0, at - 80);
    const next = body.indexOf('}),', at);
    if (next < 0) return { body, patched: false };
    const segment = body.slice(scanStart, next + 2);
    const head = /([A-Za-z_$][\w$]*)\(`toggleChatPinned`,\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)=>\{/.exec(segment);
    const rpc = /([A-Za-z_$][\w$]*)\(`toggleChatPinned`,\{chat:/.exec(segment);
    if (!head || !rpc) return { body, patched: false };
    const insertAt = scanStart + head.index + head[0].length;
    const hook = `if(globalThis.__twdExtendedPins&&globalThis.__twdExtendedPins.toggle(${head[2]},${head[3]},${head[4]},${rpc[1]}))return;`;
    if (body.slice(insertAt, insertAt + hook.length) === hook) return { body, patched: true };
    return { body: body.slice(0, insertAt) + hook + body.slice(insertAt), patched: true };
}

function patchPinnedIdsReducer(body) {
    const marker = 'case`updatePinnedChatIds`:';
    const at = body.indexOf(marker);
    if (at < 0) return { body, patched: false };
    const end = body.indexOf('case`updatePinnedSavedDialogIds`:', at);
    if (end < 0) return { body, patched: false };
    const segment = body.slice(at, end);
    const m = /let\{ids:([A-Za-z_$][\w$]*),folderId:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)=\2===1\?`archived`:`active`;return/.exec(segment);
    if (!m) return { body, patched: false };
    const state = /return [A-Za-z_$][\w$]*\?\{\.\.\.([A-Za-z_$][\w$]*),chats:/.exec(segment);
    if (!state) return { body, patched: false };
    const local = m.index + m[0].lastIndexOf('return');
    const insertAt = at + local;
    const hook = `${m[1]}=globalThis.__twdExtendedPins?globalThis.__twdExtendedPins.mergeList(${state[1]}.currentUserId,String(${m[2]}===1?1:0),${m[1]},true):${m[1]};`;
    return { body: body.slice(0, insertAt) + hook + body.slice(insertAt), patched: true };
}

function patchChatPinnedReducer(body) {
    const marker = 'case`updateChatPinned`:';
    const at = body.indexOf(marker);
    if (at < 0) return { body, patched: false };
    const end = body.indexOf('case`updateSavedDialogPinned`:', at);
    if (end < 0) return { body, patched: false };
    const segment = body.slice(at, end);
    const vars = /let\{\[([A-Za-z_$][\w$]*)\]:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*)\.chats\.orderedPinnedIds,([A-Za-z_$][\w$]*)=\2\|\|\[\]/.exec(segment);
    if (!vars) return { body, patched: false };
    const needle = `return{...${vars[3]},chats:`;
    const ret = segment.lastIndexOf(needle);
    if (ret < 0) return { body, patched: false };
    const insertAt = at + ret;
    const hook = `${vars[4]}=globalThis.__twdExtendedPins?globalThis.__twdExtendedPins.mergeList(${vars[3]}.currentUserId,String(${vars[1]}===\`archived\`?1:0),${vars[4]},false):${vars[4]};`;
    return { body: body.slice(0, insertAt) + hook + body.slice(insertAt), patched: true };
}

function patchChatFolderReducer(body) {
    const marker = 'case`updateChatFolder`:';
    const at = body.indexOf(marker);
    if (at < 0) return { body, patched: false };
    const end = body.indexOf('case`updateChatFoldersOrder`:', at);
    if (end < 0) return { body, patched: false };
    const segment = body.slice(at, end);
    const vars = /let\{id:([A-Za-z_$][\w$]*),folder:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*),\{byId:([A-Za-z_$][\w$]*),orderedIds:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*)\.chatFolders,([A-Za-z_$][\w$]*)=\2===void 0;/.exec(segment);
    if (!vars) return { body, patched: false };
    const insertAt = at + vars.index + vars[0].length;
    const hook = `${vars[2]}=globalThis.__twdExtendedPins?globalThis.__twdExtendedPins.mergeFolder(${vars[6]}.currentUserId,${vars[1]},${vars[2]}):${vars[2]};`;
    return { body: body.slice(0, insertAt) + hook + body.slice(insertAt), patched: true };
}

function patchTelegramExtendedPins(body) {
    let out = body;
    const action = patchToggleAction(out); out = action.body;
    const ids = patchPinnedIdsReducer(out); out = ids.body;
    const pin = patchChatPinnedReducer(out); out = pin.body;
    const folder = patchChatFolderReducer(out); out = folder.body;
    return {
        body: out,
        actionPatched: action.patched,
        reducerPatched: ids.patched || pin.patched || folder.patched,
        reducerParts: [ids.patched, pin.patched, folder.patched],
    };
}

async function injectTelegramExtendedPins(response, urlString) {
    let u;
    try { u = new URL(urlString); } catch (_) { return response; }
    if (u.hostname !== 'web.telegram.org' || !u.pathname.startsWith('/a/assets/') || !/\.js$/i.test(u.pathname)) return response;
    if (!/(?:\/calls-|\/main-)/i.test(u.pathname)) return response;
    const source = await response.text();
    const patched = patchTelegramExtendedPins(source);
    if (patched.body === source) return transformedJsResponse(response, source);
    if (patched.actionPatched) console.log('[TWD-PINS] Telegram pin action hook installed');
    if (patched.reducerPatched) console.log('[TWD-PINS] Telegram pin reducer hook installed');
    return transformedJsResponse(response, patched.body);
}

function extendedPinsPrelude(enabled) {
    const flag = enabled === true ? 'true' : 'false';
    return `(()=>{if(globalThis.__twdExtendedPins)return;const KEY='__twd_extended_pins_v1';
const clean=a=>Array.isArray(a)?[...new Set(a.map(String).filter(x=>/^-?\\d{1,24}$/.test(x)))].slice(0,15):[];
function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||'{}');return x&&typeof x==='object'?x:{}}catch(_){return{}}}
function save(x){try{localStorage.setItem(KEY,JSON.stringify(x))}catch(_){}}
function account(x,id){id=String(id||'');x.accounts||(x.accounts={});return x.accounts[id]||(x.accounts[id]={orders:{},server:{}})}
function stateKey(id){id=String(id||'');for(let i=1;i<=8;i++){try{const a=JSON.parse(localStorage.getItem('account'+i)||'{}');if(String(a.userId||'')===id)return i===1?'tt-global-state':'tt-global-state_'+i}catch(_){}}return'tt-global-state'}
function persist(id,key,order){return new Promise(resolve=>{try{const q=indexedDB.open('tt-data');q.onerror=()=>resolve();q.onsuccess=()=>{const db=q.result;let tx;try{tx=db.transaction('store','readwrite')}catch(_){db.close();resolve();return}const s=tx.objectStore('store'),g=s.get(stateKey(id));g.onsuccess=()=>{const v=g.result;if(!v)return;const a=clean(order);if(key==='0'||key==='1'){v.chats&&v.chats.orderedPinnedIds&&(v.chats.orderedPinnedIds[key==='1'?'archived':'active']=a.length?a:void 0)}else{const f=v.chatFolders&&v.chatFolders.byId&&v.chatFolders.byId[key];if(f)f.pinnedChatIds=a}try{s.put(v,stateKey(id))}catch(_){}};tx.oncomplete=tx.onerror=()=>{try{db.close()}catch(_){}resolve()}}}catch(_){resolve()}})}
const api={enabled:${flag},get(id,key,native){const x=load(),a=account(x,id),v=a.orders[String(key)];return Array.isArray(v)?clean(v):clean(native)},set(id,key,v){const x=load(),a=account(x,id),k=String(key),n=clean(v);a.orders[k]=n;save(x);persist(id,k,n);return n},server(id,key,v){const x=load(),a=account(x,id);a.server[String(key)]=clean(v);save(x)},mergeList(id,key,v,record){if(!Array.isArray(v))return v;const raw=clean(v);if(record)this.server(id,key,raw);if(!this.enabled)return raw;const x=load(),a=account(x,id),local=a.orders[String(key)];if(!Array.isArray(local))return raw;return clean([...local,...raw.filter(x=>!local.includes(String(x)))])},mergeFolder(id,key,f){if(!f)return f;const raw=clean(f.pinnedChatIds);this.server(id,key,raw);if(!this.enabled)return f;const x=load(),a=account(x,id),local=a.orders[String(key)];if(!Array.isArray(local))return f;const pins=clean([...local,...raw.filter(x=>!local.includes(String(x)))]),inc=clean([...pins,...(f.includedChatIds||[])]);return{...f,pinnedChatIds:pins,includedChatIds:inc}},cap(s){return s&&s.users&&s.users.byId&&s.users.byId[s.currentUserId]&&s.users.byId[s.currentUserId].isPremium===true?10:5},limit(s){return this.cap(s)+5},toggle(s,a,p,rpc){if(!this.enabled)return false;const id=String(p&&p.id||'');if(!id)return false;const fid=Number(p&&p.folderId||0),chat=s.chats&&s.chats.byId&&s.chats.byId[id],key=fid?String(fid):(chat&&chat.folderId===1?'1':'0'),native=fid?(s.chatFolders&&s.chatFolders.byId&&s.chatFolders.byId[fid]&&s.chatFolders.byId[fid].pinnedChatIds||[]):(s.chats&&s.chats.orderedPinnedIds&&s.chats.orderedPinnedIds[key==='1'?'archived':'active']||[]),cur=this.get(s.currentUserId,key,native),i=cur.indexOf(id);if(i<0&&cur.length>=this.limit(s)){try{globalThis.__twdExtendedPinsLimit&&globalThis.__twdExtendedPinsLimit(this.limit(s))}catch(_){}return true}const next=i>=0?cur.filter(x=>x!==id):[id,...cur];const x=load(),rec=account(x,s.currentUserId);if(!Array.isArray(rec.server[key]))rec.server[key]=clean(native).slice(0,this.cap(s));rec.orders[key]=clean(next);save(x);persist(s.currentUserId,key,next);if(fid){const f=s.chatFolders&&s.chatFolders.byId&&s.chatFolders.byId[fid];if(f){const inc=clean([...next,...(f.includedChatIds||[])]),local={...f,pinnedChatIds:clean(next),includedChatIds:inc};try{a.apiUpdate({'@type':'updateChatFolder',id:fid,folder:local})}catch(_){}const server=clean(next).slice(0,this.cap(s));rec.server[key]=server;save(x);try{Promise.resolve(rpc('editChatFolder',{id:fid,folderUpdate:{...f,pinnedChatIds:server,includedChatIds:inc}})).catch(()=>{})}catch(_){}}}else{try{a.apiUpdate({'@type':'updateChatPinned',id,isPinned:i<0})}catch(_){}const before=clean(rec.server[key]||[]),after=clean(next).slice(0,this.cap(s));rec.server[key]=after;save(x);if(typeof rpc==='function'){(async()=>{try{for(const q of before.filter(x=>!after.includes(x))){const c=s.chats.byId[q];if(c)await rpc('toggleChatPinned',{chat:c,shouldBePinned:false})}for(const q of after.filter(x=>!before.includes(x)).reverse()){const c=s.chats.byId[q];if(c)await rpc('toggleChatPinned',{chat:c,shouldBePinned:true})}}catch(_){}})()}}return true},restore(){const x=load(),jobs=[];for(const[id,v]of Object.entries(x.accounts||{})){for(const[k,o]of Object.entries(v.orders||{})){const raw=Array.isArray(v.server&&v.server[k])?v.server[k]:clean(o).slice(0,5);jobs.push(persist(id,k,raw))}}return Promise.all(jobs)},setEnabled(v){this.enabled=v===true;return this.enabled?Promise.resolve():this.restore()}};globalThis.__twdExtendedPins=api;})();`;
}

function injectExtendedPinsPrelude(html, enabled) {
    const tag = '<script>' + extendedPinsPrelude(enabled) + '</script>';
    if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, m => m + tag);
    return tag + html;
}

module.exports = {
    injectTelegramExtendedPins,
    injectExtendedPinsPrelude,
    patchTelegramExtendedPins,
    extendedPinsPrelude,
};
