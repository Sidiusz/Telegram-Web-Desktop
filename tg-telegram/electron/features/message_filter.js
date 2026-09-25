(function () {
    if (window.__twdMessageFilterRuntimeStarted) return;
    window.__twdMessageFilterRuntimeStarted = true;

    var SHORT=['bit.ly','gg.gg','clck.ru','cutt.ly','kutt.it','rebrand.ly','tinyurl.com','t.co','is.gd','rb.gy','goo.su','vk.cc','tiny.cc','shorturl.at','lnkd.in'];
    var REF=['ali.pub','alii.pub','lite.al','lite.bz','aliclick.link','aliclick.shop','dea.ls','alitems.co','s.click.aliexpress.com','ad.admitad.com','fas.st','epn.bz','redirect.appmetrica.yandex.com','go.redirectingat.com'];
    var STANDARD=['на правах рекламы','партнерский материал','партнёрский материал','рекламный пост','рекламная интеграция','рекламная публикация','промокод','по промокоду','розыгрыш','разыгрываем','разыграем','выиграй','спонсорский материал','sponsored','advertisement','self-promotion'];
    var cfg=Object.assign({enabled:false,standard:true,hashtags:true,shortLinks:true,refLinks:true,includePrivate:false,markOnly:false,ignoreSymbols:false,shortDisabled:[],refDisabled:[],custom:[]},window.__twdMessageFilterConfig||{});

    var style=document.createElement('style');style.id='twd-feature-message-filter';
    style.textContent='._twd-filter-hidden_{display:none!important;}._twd-filter-marked_ .message-content{outline:2px dashed #ff9800!important;outline-offset:2px!important;box-shadow:0 0 0 1px rgba(255,152,0,.16)!important;}';
    if(document.head)document.head.appendChild(style);else document.addEventListener('DOMContentLoaded',function(){document.head.appendChild(style);},{once:true});

    var chatTypeById=Object.create(null),chatTypeLoad=null,chatTypeLoadedAt=0;
    function categoryFromType(type){if(type==='chatTypePrivate')return'private';if(type==='chatTypeChannel')return'channel';if(type==='chatTypeBasicGroup'||type==='chatTypeSuperGroup')return'group';return'';}
    function currentPeer(){var av=document.querySelector('#MiddleColumn .MiddleHeader .Avatar[data-peer-id]');return av?String(av.getAttribute('data-peer-id')||''):'';}
    function loadChatTypes(force){var now=Date.now();if(chatTypeLoad)return chatTypeLoad;if(!force&&chatTypeLoadedAt)return Promise.resolve();if(force&&chatTypeLoadedAt&&now-chatTypeLoadedAt<5000)return Promise.resolve();
        chatTypeLoad=new Promise(function(resolve){try{if(!window.indexedDB){resolve();return;}var req=indexedDB.open('tt-data');req.onerror=function(){resolve();};req.onsuccess=function(){var db=req.result,tx;try{tx=db.transaction('store','readonly');}catch(_){try{db.close();}catch(__){}resolve();return;}var cur=tx.objectStore('store').openCursor();cur.onsuccess=function(){var c=cur.result;if(!c)return;if(/^tt-global-state(?:_\d+)?$/.test(String(c.key||''))){var byId=c.value&&c.value.chats&&c.value.chats.byId;if(byId)Object.keys(byId).forEach(function(id){var type=byId[id]&&byId[id].type;if(type)chatTypeById[String(id)]=type;});}c.continue();};tx.oncomplete=tx.onerror=tx.onabort=function(){try{db.close();}catch(_){}resolve();};};}catch(_){resolve();}}).then(function(){chatTypeLoadedAt=Date.now();chatTypeLoad=null;});return chatTypeLoad;}
    function resolveCategory(pid){pid=String(pid||'');if(!pid)return Promise.resolve('');var known=categoryFromType(chatTypeById[pid]);if(known)return Promise.resolve(known);if(pid.charAt(0)!=='-')return Promise.resolve('private');return loadChatTypes(true).then(function(){return categoryFromType(chatTypeById[pid])||'group';});}
    function lower(text){text=String(text||'');try{text=text.normalize('NFKC');}catch(_){}return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').toLowerCase();}
    function compact(text){return lower(text).replace(/[\p{P}\p{S}\s_]+/gu,'');}
    function phraseMatch(text,phrase){var a=lower(text),b=lower(phrase);if(a.indexOf(b)>=0)return true;return cfg.ignoreSymbols===true&&compact(a).indexOf(compact(b))>=0;}
    function domainMatch(host,domain){host=String(host||'').toLowerCase().replace(/^www\./,'');domain=String(domain||'').toLowerCase();return host===domain||host.endsWith('.'+domain);}
    function activeDomains(all,disabled){var off=(disabled||[]).map(function(x){return String(x).toLowerCase();});return all.filter(function(x){return off.indexOf(x)<0;});}
    function messageUrls(msg){var out=[];msg.querySelectorAll('a[href]').forEach(function(a){try{out.push(new URL(a.href,location.href));}catch(_){}});var raw=String(msg.innerText||'').match(/https?:\/\/[^\s<>()]+/gi)||[];raw.forEach(function(x){try{out.push(new URL(x));}catch(_){}});return out;}
    function hasDomain(msg,domains){var urls=messageUrls(msg);if(urls.some(function(u){return domains.some(function(d){return domainMatch(u.hostname,d);});}))return true;var text=lower(msg.innerText||'');return domains.some(function(d){return text.indexOf(d)>=0;});}
    function matches(msg){var text=String(msg.innerText||'');if(!text.trim())return false;if(cfg.standard!==false){if(STANDARD.some(function(p){return phraseMatch(text,p);}))return true;if(/(^|\W)реклам(?:а|ы|е|у|ой|ный|ная|ное|ные)(?=\W|$)/iu.test(lower(text)))return true;}if(cfg.hashtags!==false&&/(^|\s)#(?:реклама|ad|ads|advertisement|advertising|sponsored|promo)\b/iu.test(lower(text)))return true;if(cfg.shortLinks!==false&&hasDomain(msg,activeDomains(SHORT,cfg.shortDisabled)))return true;if(cfg.refLinks!==false&&hasDomain(msg,activeDomains(REF,cfg.refDisabled)))return true;if((cfg.custom||[]).some(function(p){return phraseMatch(text,p);}))return true;return false;}
    function clearMessage(msg){msg.classList.remove('_twd-filter-hidden_','_twd-filter-marked_');msg.removeAttribute('data-twd-filtered');}
    function paintMessage(msg,hit){clearMessage(msg);if(!hit)return;msg.setAttribute('data-twd-filtered','1');msg.classList.add(cfg.markOnly===true?'_twd-filter-marked_':'_twd-filter-hidden_');}
    function clearAll(){document.querySelectorAll('#MiddleColumn .Message._twd-filter-hidden_,#MiddleColumn .Message._twd-filter-marked_').forEach(clearMessage);}
    var scanToken=0,timer=null,fullScanPending=true,dirtyMessages=new Set();
    function queueNode(node){
        var el=node&&node.nodeType===1?node:(node&&node.parentElement);if(!el)return;
        var msg=el.matches&&el.matches('#MiddleColumn .Message')?el:(el.closest&&el.closest('#MiddleColumn .Message'));
        if(msg)dirtyMessages.add(msg);
        if(el.querySelectorAll)el.querySelectorAll('.Message').forEach(function(x){if(x.closest('#MiddleColumn'))dirtyMessages.add(x);});
    }
    function schedule(full){
        if(full){fullScanPending=true;dirtyMessages.clear();}
        if(window.__twdVisualActive===false){fullScanPending=true;dirtyMessages.clear();if(timer){clearTimeout(timer);timer=null;}return;}
        if(timer)return;
        timer=setTimeout(function(){timer=null;scan();},80);
    }
    function scan(){
        var token=++scanToken,full=fullScanPending;fullScanPending=false;
        var targets=full?Array.from(document.querySelectorAll('#MiddleColumn .Message')):Array.from(dirtyMessages);
        dirtyMessages.clear();
        if(cfg.enabled!==true){clearAll();return Promise.resolve();}
        var pid=currentPeer();
        return resolveCategory(pid).then(function(cat){
            if(token!==scanToken){schedule(true);return;}
            var allowed=cat==='channel'||(cat==='private'&&cfg.includePrivate===true);
            if(!allowed){clearAll();return;}
            targets.forEach(function(msg){
                if(!msg||!msg.isConnected||!msg.closest('#MiddleColumn'))return;
                if(cat==='private'&&msg.classList.contains('own')){clearMessage(msg);return;}
                paintMessage(msg,matches(msg));
            });
        }).catch(function(){clearAll();});
    }
    function configure(next){cfg=Object.assign({},cfg,next||{});window.__twdMessageFilterConfig=Object.assign({},cfg);schedule(true);}
    window.addEventListener('__twd_message_filter_config',function(e){configure(e.detail||{});});
    window.addEventListener('__twd_window_state',function(e){if(e.detail&&e.detail.active)schedule(true);});
    window.__twdMessageFilterApi={configure:configure,scan:function(){fullScanPending=true;return scan();},testText:function(text){var fake=document.createElement('div');fake.innerText=String(text||'');return matches(fake);},shortDomains:SHORT.slice(),refDomains:REF.slice()};
    var observer=new MutationObserver(function(mutations){
        if(cfg.enabled!==true)return;
        if(window.__twdVisualActive===false){fullScanPending=true;dirtyMessages.clear();return;}
        mutations.forEach(function(m){
            queueNode(m.target);
            m.addedNodes.forEach(queueNode);
        });
        if(dirtyMessages.size)schedule(false);
    });
    function onNav(){schedule(true);}
    function installNavHooks(){
        ['pushState','replaceState'].forEach(function(k){var orig=history[k];if(typeof orig!=='function'||orig.__twdFilterWrapped)return;function wrapped(){var result=orig.apply(this,arguments);onNav();return result;}wrapped.__twdFilterWrapped=true;history[k]=wrapped;});
        window.addEventListener('popstate',onNav);window.addEventListener('hashchange',onNav);
    }
    function start(){var root=document.querySelector('#MiddleColumn');if(!root){setTimeout(start,250);return;}observer.observe(root,{childList:true,subtree:true,characterData:true});installNavHooks();loadChatTypes(false).then(function(){schedule(true);});}
    start();
})();
