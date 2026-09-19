// Local virtual "Feed" chat. Sources are real Telegram channels/groups, but the
// feed row and posts exist only in this client. Nothing is sent or forwarded.
(function(){
    if(window.__twdVirtualFeedStarted)return;
    window.__twdVirtualFeedStarted=true;

    var feedSources=[];
    var liveItems=new Map();
    var deletedKeys=new Set();
    var feedView=null;
    var feedBody=null;
    var feedRow=null;
    var sourcePanel=null;
    var lastChatContext=null;
    var lastUnderlying=null;
    var renderSeq=0;
    var ru=function(){return typeof curLang==='function'&&curLang()==='ru';};
    var tr=function(r,e){return ru()?r:e;};
    var keyOf=function(chatId,messageId){return String(chatId)+':'+String(messageId);};

    function sourceIds(){return feedSources.map(function(x){return String(x.id);});}
    function sourceById(id){id=String(id);return feedSources.find(function(x){return String(x.id)===id;})||null;}
    function publishConfig(){
        try{window.dispatchEvent(new CustomEvent('__twd_feed_config',{detail:{sources:sourceIds()}}));}catch(_){}
    }
    async function loadSources(){
        try{
            var s=await INV('get_settings')||{};
            feedSources=Array.isArray(s.feed_sources)?s.feed_sources.map(function(x){
                return {id:String(x.id||''),title:String(x.title||''),username:String(x.username||'')};
            }).filter(function(x){return /^-\d+$/.test(x.id);}):[];
        }catch(_){feedSources=[];}
        publishConfig();
        updateFeedRow();
        if(feedView)renderFeed();
    }
    async function saveSources(next){
        var clean=[],seen=new Set();
        (next||[]).forEach(function(x){
            var id=String(x&&x.id||'');
            if(!/^-\d+$/.test(id)||seen.has(id))return;
            seen.add(id);
            clean.push({id:id,title:String(x.title||'').slice(0,160),username:String(x.username||'').replace(/^@/,'').slice(0,64)});
        });
        feedSources=clean;
        try{
            var s=await INV('get_settings')||{};
            await INV('save_settings',{settings:Object.assign({},s,{feed_sources:clean})});
        }catch(_){}
        publishConfig();
        updateFeedRow();
        renderSourcePanel();
        if(feedView)renderFeed();
    }

    function textFromContent(content){
        if(!content||typeof content!=='object')return '';
        var values=[
            content.text,content.caption,
            content.photo&&content.photo.caption,
            content.video&&content.video.caption,
            content.document&&content.document.caption,
            content.animation&&content.animation.caption
        ];
        for(var i=0;i<values.length;i++){
            var v=values[i];
            if(typeof v==='string'&&v)return v;
            if(v&&v.text!=null&&String(v.text))return String(v.text);
        }
        return '';
    }
    function mediaFromContent(content){
        if(!content||typeof content!=='object')return null;
        var keys=['photo','video','animation','document','audio','voice','sticker','poll','location','contact'];
        for(var i=0;i<keys.length;i++){
            var type=keys[i],m=content[type];if(!m)continue;
            return {
                type:type,
                thumbnail:m.thumbnail&&m.thumbnail.dataUri?String(m.thumbnail.dataUri):'',
                fileName:m.fileName?String(m.fileName):'',
                duration:Number(m.duration)||0
            };
        }
        return null;
    }
    function reactionsFromMessage(message){
        var out=[];
        try{
            ((message&&message.reactions&&message.reactions.results)||[]).forEach(function(r){
                if(!r||!r.reaction)return;
                out.push({count:Number(r.count)||0,emoji:r.reaction.emoticon?String(r.reaction.emoticon):''});
            });
        }catch(_){}
        return out;
    }
    function packMessage(message,chatId,messageId){
        return {
            chatId:String(chatId),messageId:String(messageId),
            text:textFromContent(message&&message.content),
            date:Number(message&&message.date)||0,
            media:mediaFromContent(message&&message.content),
            viewsCount:Number(message&&message.viewsCount)||0,
            forwardsCount:Number(message&&message.forwardsCount)||0,
            reactions:reactionsFromMessage(message),
            isEdited:!!(message&&(message.isEdited||message.editDate))
        };
    }
    function normalizeLiveItem(item){
        if(!item)return null;
        return {
            chatId:String(item.chatId||''),messageId:String(item.messageId||''),
            text:String(item.text||''),date:Number(item.date)||Math.floor(Date.now()/1000),
            media:item.media||null,viewsCount:Number(item.viewsCount)||0,forwardsCount:Number(item.forwardsCount)||0,
            reactions:Array.isArray(item.reactions)?item.reactions:[],isEdited:!!item.isEdited
        };
    }

    function readTelegramStates(){
        return new Promise(function(resolve){
            var states=[];
            try{
                var req=indexedDB.open('tt-data');
                req.onerror=function(){resolve(states);};
                req.onsuccess=function(){
                    var db=req.result,tx;
                    try{tx=db.transaction('store','readonly');}catch(_){try{db.close();}catch(__){}resolve(states);return;}
                    var cur=tx.objectStore('store').openCursor();
                    cur.onsuccess=function(){
                        var c=cur.result;
                        if(!c){try{db.close();}catch(_){}resolve(states);return;}
                        if(/^tt-global-state(?:_\d+)?$/.test(String(c.key||''))&&c.value)states.push(c.value);
                        c.continue();
                    };
                    cur.onerror=function(){try{db.close();}catch(_){}resolve(states);};
                };
            }catch(_){resolve(states);}
        });
    }
    async function collectFeedItems(){
        var sources=new Set(sourceIds()),map=new Map(),states=await readTelegramStates();
        states.forEach(function(state){
            feedSources.forEach(function(src){
                var meta=state&&state.chats&&state.chats.byId&&state.chats.byId[src.id];
                if(meta){
                    if(!src.title&&meta.title)src.title=String(meta.title);
                    if(!src.username&&Array.isArray(meta.usernames)){
                        var u=meta.usernames.find(function(x){return x&&x.isActive!==false&&x.username;});
                        if(u)src.username=String(u.username);
                    }
                }
                var bucket=state&&state.messages&&state.messages.byChatId&&state.messages.byChatId[src.id];
                var byId=bucket&&bucket.byId;
                if(!byId)return;
                var vals=Object.values(byId).filter(Boolean).sort(function(a,b){return (Number(a.date)||0)-(Number(b.date)||0);});
                vals.slice(-100).forEach(function(m){
                    var mid=String(m.id||'');if(!mid)return;
                    var k=keyOf(src.id,mid);if(deletedKeys.has(k))return;
                    map.set(k,packMessage(m,src.id,mid));
                });
            });
        });
        liveItems.forEach(function(item,k){
            if(sources.has(String(item.chatId))&&!deletedKeys.has(k))map.set(k,item);
        });
        return Array.from(map.values()).sort(function(a,b){
            var d=(Number(a.date)||0)-(Number(b.date)||0);
            if(d)return d;
            return Number(a.messageId)-Number(b.messageId);
        }).slice(-500);
    }

    function currentUnderlyingChat(){
        try{
            var av=document.querySelector('#MiddleColumn .MiddleHeader .Avatar[data-peer-id]');
            var id=av&&av.getAttribute('data-peer-id');
            if(!id)return null;
            var title=document.querySelector('#MiddleColumn .MiddleHeader h3, #MiddleColumn .MiddleHeader .title, #MiddleColumn .MiddleHeader .fullName');
            return {id:String(id),title:String(title&&(title.innerText||title.textContent)||'')};
        }catch(_){return null;}
    }
    function openSource(item){
        closeFeed();
        if(!item)return;
        setTimeout(function(){location.hash='#'+String(item.chatId);},0);
    }
    function mediaLabel(type){
        var m={
            photo:tr('Фотография','Photo'),video:tr('Видео','Video'),animation:'GIF',
            document:tr('Файл','File'),audio:tr('Аудио','Audio'),voice:tr('Голосовое сообщение','Voice message'),
            sticker:tr('Стикер','Sticker'),poll:tr('Опрос','Poll'),location:tr('Геопозиция','Location'),contact:tr('Контакт','Contact')
        };
        return m[type]||type||'';
    }
    function fmtTime(sec){
        if(!sec)return '';
        try{return new Date(sec*1000).toLocaleString([], {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(_){return '';}
    }
    function makePost(item){
        var src=sourceById(item.chatId)||{id:item.chatId,title:item.chatId};
        var post=document.createElement('article');post.className='_twd-feed-post_';
        post.dataset.chatId=item.chatId;post.dataset.messageId=item.messageId;

        var forwarded=document.createElement('button');forwarded.className='_twd-feed-forward_';forwarded.type='button';
        var fi=document.createElement('i');fi.className='icon icon-forward';fi.setAttribute('aria-hidden','true');
        var fn=document.createElement('span');fn.textContent=src.title||('@'+src.username)||item.chatId;
        forwarded.append(fi,fn);forwarded.addEventListener('click',function(){openSource(item);});
        post.appendChild(forwarded);

        if(item.media){
            if(item.media.thumbnail){
                var img=document.createElement('img');img.className='_twd-feed-thumb_';img.src=item.media.thumbnail;img.alt=mediaLabel(item.media.type);post.appendChild(img);
            }else{
                var media=document.createElement('div');media.className='_twd-feed-media-placeholder_';
                var mi=document.createElement('i');mi.className='icon '+(item.media.type==='photo'?'icon-photo':item.media.type==='video'?'icon-video':'icon-document');mi.setAttribute('aria-hidden','true');
                var ml=document.createElement('span');ml.textContent=item.media.fileName||mediaLabel(item.media.type);
                media.append(mi,ml);post.appendChild(media);
            }
        }
        if(item.text){
            var text=document.createElement('div');text.className='_twd-feed-text_';text.textContent=item.text;post.appendChild(text);
        }else if(!item.media){
            var empty=document.createElement('div');empty.className='_twd-feed-text_ _twd-feed-muted_';empty.textContent=tr('[пост без текста]','[post without text]');post.appendChild(empty);
        }

        if(item.reactions&&item.reactions.length){
            var reacts=document.createElement('div');reacts.className='_twd-feed-reactions_';
            item.reactions.slice(0,8).forEach(function(r){
                var pill=document.createElement('span');pill.className='_twd-feed-reaction_';pill.textContent=(r.emoji||'•')+' '+String(r.count||0);reacts.appendChild(pill);
            });
            post.appendChild(reacts);
        }

        var meta=document.createElement('div');meta.className='_twd-feed-meta_';
        var bits=[];
        if(item.viewsCount)bits.push('◉ '+item.viewsCount);
        if(item.forwardsCount)bits.push('↗ '+item.forwardsCount);
        if(item.isEdited)bits.push(tr('ред.','edited'));
        bits.push(fmtTime(item.date));
        meta.textContent=bits.filter(Boolean).join(' · ');
        post.appendChild(meta);
        return post;
    }

    async function renderFeed(){
        if(!feedView||!feedBody)return;
        var seq=++renderSeq;
        feedBody.innerHTML='';
        if(!feedSources.length){
            var empty=document.createElement('div');empty.className='_twd-feed-empty_';
            var h=document.createElement('h3');h.textContent=tr('Лента пока пустая','Your feed is empty');
            var p=document.createElement('p');p.textContent=tr('Нажмите ПКМ по каналу или группе в списке чатов и выберите «Добавить в ленту».','Right-click a channel or group in the chat list and choose “Add to feed”.');
            empty.append(h,p);feedBody.appendChild(empty);return;
        }
        var loading=document.createElement('div');loading.className='_twd-feed-empty_';loading.textContent=tr('Загрузка постов…','Loading posts…');feedBody.appendChild(loading);
        var items=await collectFeedItems();
        if(seq!==renderSeq||!feedBody)return;
        feedBody.innerHTML='';
        if(!items.length){
            var none=document.createElement('div');none.className='_twd-feed-empty_';none.textContent=tr('В кэше Telegram пока нет постов из выбранных источников. Новые публикации появятся здесь автоматически.','Telegram has no cached posts from these sources yet. New posts will appear here automatically.');feedBody.appendChild(none);
        }else{
            var group=document.createElement('div');group.className='_twd-feed-posts_';
            items.forEach(function(item){group.appendChild(makePost(item));});
            feedBody.appendChild(group);
            requestAnimationFrame(function(){if(feedBody)feedBody.scrollTop=feedBody.scrollHeight;});
        }
        updateFeedRow(items);
    }

    function renderSourcePanel(){
        if(!sourcePanel)return;
        sourcePanel.innerHTML='';
        var head=document.createElement('div');head.className='_twd-feed-source-head_';
        var title=document.createElement('strong');title.textContent=tr('Источники ленты','Feed sources');
        var close=document.createElement('button');close.className='Button smaller round';close.type='button';close.innerHTML='<i class="icon icon-close"></i>';close.addEventListener('click',toggleSourcePanel);
        head.append(title,close);sourcePanel.appendChild(head);

        if(lastUnderlying&&/^-\d+$/.test(lastUnderlying.id)&&!sourceById(lastUnderlying.id)){
            var add=document.createElement('button');add.className='_twd-feed-source-add_';add.type='button';
            add.textContent=tr('Добавить открытый чат: ','Add open chat: ')+(lastUnderlying.title||lastUnderlying.id);
            add.addEventListener('click',function(){saveSources(feedSources.concat([{id:lastUnderlying.id,title:lastUnderlying.title||lastUnderlying.id,username:''}]));});
            sourcePanel.appendChild(add);
        }
        if(!feedSources.length){
            var e=document.createElement('p');e.className='_twd-feed-source-note_';e.textContent=tr('Источников нет. Добавляйте каналы и группы через ПКМ в списке чатов.','No sources yet. Add channels and groups from the chat-list context menu.');sourcePanel.appendChild(e);
        }else{
            feedSources.forEach(function(src){
                var row=document.createElement('div');row.className='_twd-feed-source-row_';
                var name=document.createElement('span');name.textContent=src.title||('@'+src.username)||src.id;
                var del=document.createElement('button');del.type='button';del.className='Button smaller round';del.title=tr('Убрать','Remove');del.innerHTML='<i class="icon icon-delete"></i>';
                del.addEventListener('click',function(){saveSources(feedSources.filter(function(x){return x.id!==src.id;}));});
                row.append(name,del);sourcePanel.appendChild(row);
            });
        }
        var note=document.createElement('p');note.className='_twd-feed-source-note_';note.textContent=tr('Это локальная лента. Ничего не пересылается и не отправляется в Telegram.','This feed is local. Nothing is forwarded or sent to Telegram.');sourcePanel.appendChild(note);
    }
    function toggleSourcePanel(){
        if(!sourcePanel)return;
        sourcePanel.classList.toggle('open');
        if(sourcePanel.classList.contains('open'))renderSourcePanel();
    }

    function openFeed(){
        if(feedView&&feedView.isConnected)return;
        lastUnderlying=currentUnderlyingChat();
        var middle=document.getElementById('MiddleColumn');if(!middle)return;
        middle.classList.add('_twd-feed-host_');
        document.body.classList.add('_twd-feed-open_');
        feedView=document.createElement('div');feedView.id='_twd-feed-view_';feedView.className='_twd-feed-view_';

        var header=document.createElement('header');header.className='_twd-feed-header_';
        var avatar=document.createElement('div');avatar.className='_twd-feed-header-avatar_';avatar.innerHTML='<i class="icon icon-channel"></i>';
        var info=document.createElement('div');info.className='_twd-feed-header-info_';
        var title=document.createElement('h3');title.textContent=tr('Лента','Feed');
        var sub=document.createElement('div');sub.className='_twd-feed-header-sub_';sub.textContent=tr('Локальная лента публикаций','Local post feed');
        info.append(title,sub);
        var sources=document.createElement('button');sources.className='Button smaller round _twd-feed-source-button_';sources.type='button';sources.title=tr('Источники','Sources');sources.innerHTML='<i class="icon icon-settings"></i>';sources.addEventListener('click',toggleSourcePanel);
        header.append(avatar,info,sources);

        feedBody=document.createElement('div');feedBody.className='_twd-feed-body_ custom-scroll';
        sourcePanel=document.createElement('aside');sourcePanel.className='_twd-feed-source-panel_';
        feedView.append(header,feedBody,sourcePanel);middle.appendChild(feedView);
        if(feedRow)feedRow.classList.add('_twd-feed-selected_');
        renderFeed();
    }
    function closeFeed(){
        document.body.classList.remove('_twd-feed-open_');
        var middle=document.getElementById('MiddleColumn');if(middle)middle.classList.remove('_twd-feed-host_');
        if(feedView&&feedView.parentNode)feedView.remove();
        feedView=null;feedBody=null;sourcePanel=null;
        if(feedRow)feedRow.classList.remove('_twd-feed-selected_');
    }

    function updateFeedRow(items){
        if(!feedRow||!feedRow.isConnected)return;
        var sub=feedRow.querySelector('._twd-feed-row-sub_');
        if(sub){
            var n=feedSources.length;
            var count=Array.isArray(items)?items.length:null;
            sub.textContent=count!=null
                ? (n+' '+tr('источн.','sources')+' · '+count+' '+tr('постов','posts'))
                : (n? n+' '+tr('источн.','sources') : tr('Добавьте каналы и группы','Add channels and groups'));
        }
    }
    function buildFeedRow(sample){
        var row=sample.cloneNode(true);row.id='_twd-feed-chat_';
        row.className='ListItem Chat chat-item-clickable has-ripple _twd-feed-chat_';
        row.removeAttribute('data-file-hover-open');row.removeAttribute('style');
        var a=row.querySelector('.ListItem-button');
        if(a){a.removeAttribute('href');a.setAttribute('role','button');a.tabIndex=0;}
        var avatar=row.querySelector('.Avatar');
        if(avatar){
            avatar.removeAttribute('id');avatar.removeAttribute('data-peer-id');
            avatar.className='Avatar size-large no-photo _twd-feed-avatar_';
            avatar.style.setProperty('--_size','54px');
            var inn=avatar.querySelector('.inner')||document.createElement('div');inn.className='inner';inn.innerHTML='<i class="icon icon-channel Avatar__icon" aria-hidden="true"></i>';avatar.replaceChildren(inn);
        }
        var title=row.querySelector('.fullName')||row.querySelector('h3');if(title)title.textContent=tr('Лента','Feed');
        var meta=row.querySelector('.LastMessageMeta');if(meta)meta.innerHTML='<i class="icon icon-pinned-chat" aria-hidden="true"></i>';
        var subtitle=row.querySelector('.subtitle');
        if(subtitle){
            subtitle.innerHTML='';
            var p=document.createElement('p');p.className='last-message _twd-feed-row-sub_';subtitle.appendChild(p);
        }
        row.querySelectorAll('.avatar-badge-wrapper,.StarIcon,.VerifiedIcon').forEach(function(x){x.remove();});
        row.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openFeed();});
        row.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openFeed();}});
        return row;
    }
    function ensureFeedRow(){
        var lists=[...document.querySelectorAll('#LeftColumn .chat-list')];
        var list=lists.find(function(x){return x.classList.contains('Transition_slide-active');})||lists.find(function(x){return x.offsetParent!==null;})||lists[0];
        if(!list)return;
        var sample=list.querySelector('.Chat:not(._twd-feed-chat_)');
        if(!sample)return;
        var inner=sample.parentElement;if(!inner||inner===list)return;
        if(feedRow&&feedRow.isConnected&&feedRow.parentElement===list){updateFeedRow();return;}
        document.querySelectorAll('#_twd-feed-chat_').forEach(function(x){x.remove();});
        feedRow=buildFeedRow(sample);
        list.insertBefore(feedRow,inner);
        updateFeedRow();
    }

    function chatContextFromTarget(target){
        var chat=target&&target.closest&&target.closest('#LeftColumn .Chat:not(._twd-feed-chat_)');
        if(!chat)return null;
        var av=chat.querySelector('.Avatar[data-peer-id]'),id=av&&av.getAttribute('data-peer-id');
        if(!id||!/^-\d+$/.test(String(id)))return null;
        var t=chat.querySelector('.fullName, h3');
        return {id:String(id),title:String(t&&(t.innerText||t.textContent)||id),ts:Date.now()};
    }
    function visibleMenu(){
        var all=[...document.querySelectorAll('.bubble.menu-container')].filter(function(x){
            var r=x.getBoundingClientRect(),s=getComputedStyle(x);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';
        });
        return all[all.length-1]||null;
    }
    function injectFeedMenu(){
        if(!lastChatContext||Date.now()-lastChatContext.ts>2500)return;
        var menu=visibleMenu();if(!menu||menu.querySelector('._twd-feed-source-menu_'))return;
        var exists=!!sourceById(lastChatContext.id);
        var item=document.createElement('div');item.className='MenuItem compact _twd-feed-source-menu_';item.setAttribute('role','menuitem');item.tabIndex=0;
        var icon=document.createElement('i');icon.className='icon '+(exists?'icon-delete':'icon-channel');icon.setAttribute('aria-hidden','true');
        item.append(icon,document.createTextNode(exists?tr('Убрать из ленты','Remove from feed'):tr('Добавить в ленту','Add to feed')));
        item.addEventListener('click',function(e){
            e.preventDefault();e.stopPropagation();
            var bubbles=document.querySelectorAll('.bubble.menu-container');bubbles.forEach(function(x){try{x.remove();}catch(_){}});
            if(exists)saveSources(feedSources.filter(function(x){return x.id!==lastChatContext.id;}));
            else saveSources(feedSources.concat([{id:lastChatContext.id,title:lastChatContext.title,username:''}]));
        });
        var holder=menu.querySelector('.Menu')||menu;holder.appendChild(item);
        try{_twdFitMenuViewport(menu);}catch(_){}
    }
    document.addEventListener('contextmenu',function(e){
        var ctx=chatContextFromTarget(e.target);if(!ctx)return;
        lastChatContext=ctx;
        setTimeout(injectFeedMenu,0);setTimeout(injectFeedMenu,70);setTimeout(injectFeedMenu,150);
    },true);
    document.addEventListener('click',function(e){
        var chat=e.target&&e.target.closest&&e.target.closest('#LeftColumn .Chat:not(._twd-feed-chat_)');
        if(chat&&feedView)closeFeed();
    },true);

    function applyFeedEvent(detail){
        if(!detail)return;
        if((detail.kind==='new'||detail.kind==='edit')&&detail.item){
            var item=normalizeLiveItem(detail.item);
            if(item&&sourceById(item.chatId)){
                var k=keyOf(item.chatId,item.messageId);deletedKeys.delete(k);liveItems.set(k,item);
                if(feedView)renderFeed();else updateFeedRow();
            }
        }else if(detail.kind==='delete'){
            var k=keyOf(detail.chatId,detail.messageId);deletedKeys.add(k);liveItems.delete(k);if(feedView)renderFeed();
        }
    }
    window.addEventListener('__twd_feed_update',function(e){
        applyFeedEvent(e.detail);
        var q=window.__twdFeedUpdateQueue;if(Array.isArray(q)&&q.length)q.shift();
    });
    function drainQueue(){
        var q=window.__twdFeedUpdateQueue;if(!Array.isArray(q)||!q.length)return;
        q.splice(0,q.length).forEach(applyFeedEvent);
    }

    ensureFeedRow();
    var obs=new MutationObserver(function(){clearTimeout(obs._t);obs._t=setTimeout(ensureFeedRow,50);});
    function startObs(){if(document.body)obs.observe(document.body,{childList:true,subtree:true});else setTimeout(startObs,50);}
    startObs();
    setInterval(ensureFeedRow,1200);
    loadSources().then(drainQueue);
    window.__twdFeedApi={open:openFeed,close:closeFeed,reload:renderFeed,getSources:function(){return feedSources.slice();}};
})();
