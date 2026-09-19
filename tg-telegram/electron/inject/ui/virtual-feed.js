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
        return Array.from(map.values()).filter(function(item){return !!(item&&((item.text&&String(item.text).trim())||item.media));}).sort(function(a,b){
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
        try{return new Date(sec*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}catch(_){return '';}
    }
    function dateKey(sec){
        var d=new Date((Number(sec)||0)*1000);
        if(!Number.isFinite(d.getTime()))return '';
        return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    }
    function dateLabel(sec){
        if(!sec)return '';
        try{return new Date(sec*1000).toLocaleDateString([], {day:'numeric',month:'long'});}catch(_){return '';}
    }
    function appendixSvg(){
        var ns='http://www.w3.org/2000/svg';
        var svg=document.createElementNS(ns,'svg');svg.setAttribute('width','9');svg.setAttribute('height','20');svg.setAttribute('class','svg-appendix');
        var path=document.createElementNS(ns,'path');path.setAttribute('d','M3 17h6V0c-.193 2.84-.876 5.767-2.05 8.782-.904 2.325-2.446 4.485-4.625 6.48A1 1 0 003 17z');path.setAttribute('class','corner');
        svg.appendChild(path);return svg;
    }
    function makePost(item){
        var src=sourceById(item.chatId)||{id:item.chatId,title:item.chatId};
        var hasText=!!item.text,hasMedia=!!item.media;

        var post=document.createElement('div');
        post.id='_twd-feed-message-'+String(item.chatId).replace(/\D/g,'')+'-'+String(item.messageId);
        post.className='Message message-list-item first-in-group allow-selection last-in-group shown open _twd-feed-message_';
        if(item.viewsCount)post.classList.add('has-views');
        if(item.isEdited)post.classList.add('was-edited');
        post.dataset.chatId=item.chatId;post.dataset.messageId=item.messageId;

        var select=document.createElement('div');select.className='message-select-control no-selection';
        var wrapper=document.createElement('div');wrapper.className='message-content-wrapper can-select-text';
        var peerColor=0;
        try{peerColor=Number((BigInt(String(item.chatId).replace('-',''))%7n));}catch(_){}
        var classes=['message-content','peer-color-'+peerColor,'is-forwarded','has-action-button','has-shadow','has-solid-background','has-appendix','_twd-feed-native-bubble_'];
        if(hasMedia)classes.push('media','has-adaptive-width','with-wide-media');
        else classes.push('text','has-footer');
        if(hasMedia&&hasText)classes.push('text','has-footer');
        else if(hasMedia)classes.push('no-text','no-footer');
        var bubble=document.createElement('div');bubble.className=classes.join(' ');bubble.setAttribute('dir','auto');
        var inner=document.createElement('div');inner.className='content-inner forwarded-message';inner.setAttribute('dir','auto');

        var title=document.createElement('div');title.className='message-title _twd-feed-forward-title_';title.setAttribute('dir','ltr');
        var titleWrap=document.createElement('span');titleWrap.className='message-title-name-container interactive';titleWrap.setAttribute('dir','ltr');
        var forwardContainer=document.createElement('span');forwardContainer.className='forward-title-container';
        var forwardIcon=document.createElement('i');forwardIcon.className='icon icon-share-filled';forwardIcon.setAttribute('aria-hidden','true');
        var forward=document.createElement('span');forward.className='forward-title';forward.textContent=tr('Переслано от','Forwarded from');
        forwardContainer.append(forwardIcon,forward);
        var nameWrap=document.createElement('span');nameWrap.className='message-title-name';
        var fAvatar=document.createElement('div');fAvatar.className='Avatar forward-avatar size-micro peer-color-'+peerColor;fAvatar.style.setProperty('--_size','16px');
        var fInner=document.createElement('div');fInner.className='inner';
        try{
            var sourceAvatar=document.querySelector('#LeftColumn .Avatar[data-peer-id="'+CSS.escape(String(item.chatId))+'"] img');
            if(sourceAvatar&&sourceAvatar.src){
                var fImg=document.createElement('img');fImg.className='Avatar__media avatar-media opacity-transition slow shown open';fImg.src=sourceAvatar.src;fImg.alt=src.title||'';fImg.draggable=false;fInner.appendChild(fImg);
            }
        }catch(_){}
        fAvatar.appendChild(fInner);
        var sender=document.createElement('span');sender.className='sender-title';sender.textContent=src.title||('@'+src.username)||item.chatId;
        nameWrap.append(fAvatar,sender);
        titleWrap.append(forwardContainer,nameWrap);title.append(titleWrap);
        var spacer=document.createElement('div');spacer.className='title-spacer';title.appendChild(spacer);
        titleWrap.addEventListener('click',function(){openSource(item);});
        bubble.appendChild(title);

        if(hasMedia){
            if(item.media.thumbnail){
                var media=document.createElement('div');media.className='media-inner interactive _twd-feed-native-media_';
                var img=document.createElement('img');img.className='full-media opacity-transition slow shown open _twd-feed-native-thumb_';img.src=item.media.thumbnail;img.alt=mediaLabel(item.media.type);img.draggable=false;
                media.appendChild(img);
                if(item.media.type==='video'||item.media.type==='animation'){
                    var play=document.createElement('i');play.className='icon icon-large-play _twd-feed-play_';play.setAttribute('aria-hidden','true');media.appendChild(play);
                }
                if(item.media.duration){
                    var dur=document.createElement('div');dur.className='message-media-duration _twd-feed-duration_';
                    var secs=Math.round(item.media.duration),mins=Math.floor(secs/60);dur.textContent=mins+':'+String(secs%60).padStart(2,'0');media.appendChild(dur);
                }
                inner.appendChild(media);
            }else{
                var file=document.createElement('div');file.className='_twd-feed-media-placeholder_';
                var mi=document.createElement('i');mi.className='icon '+(item.media.type==='photo'?'icon-photo':item.media.type==='video'?'icon-video':'icon-document');mi.setAttribute('aria-hidden','true');
                var ml=document.createElement('span');ml.textContent=item.media.fileName||mediaLabel(item.media.type);
                file.append(mi,ml);inner.appendChild(file);
            }
        }

        function buildMeta(){
            var meta=document.createElement('span');meta.className='MessageMeta';meta.setAttribute('dir','ltr');meta.setAttribute('data-ignore-on-paste','true');
            if(item.viewsCount){
                var views=document.createElement('span');views.className='message-views';views.textContent=String(item.viewsCount);meta.appendChild(views);
                var vi=document.createElement('i');vi.className='icon icon-channelviews';vi.setAttribute('aria-hidden','true');meta.appendChild(vi);
            }
            if(item.forwardsCount){
                var fw=document.createElement('span');fw.className='_twd-feed-forwards_';fw.textContent='↗ '+String(item.forwardsCount);meta.appendChild(fw);
            }
            var time=document.createElement('span');time.className='message-time';
            time.textContent=(item.isEdited?tr('изменено ','edited '):'')+fmtTime(item.date);meta.appendChild(time);
            return meta;
        }

        if(hasText){
            var text=document.createElement('div');text.className='text-content clearfix with-meta _twd-feed-text_';text.setAttribute('dir','auto');
            text.append(document.createTextNode(item.text),buildMeta());inner.appendChild(text);
        }
        bubble.appendChild(inner);
        if(hasMedia&&!hasText)bubble.appendChild(buildMeta());

        var actionsWrap=document.createElement('div');actionsWrap.className='message-action-buttons-container';
        var stickyZone=document.createElement('div');stickyZone.className='message-action-buttons-sticky-zone';
        var sticky=document.createElement('div');sticky.className='message-action-buttons message-action-button-sticky';stickyZone.appendChild(sticky);
        var actions=document.createElement('div');actions.className='message-action-buttons';
        var open=document.createElement('button');open.type='button';open.className='Button message-action-button default translucent-white round';open.setAttribute('aria-label',tr('Открыть исходный канал','Open source channel'));open.title=tr('Открыть исходный канал','Open source channel');
        var oi=document.createElement('i');oi.className='icon icon-share-filled';oi.setAttribute('aria-hidden','true');open.appendChild(oi);open.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openSource(item);});
        actions.appendChild(open);actionsWrap.append(stickyZone,actions);bubble.appendChild(actionsWrap);
        bubble.appendChild(appendixSvg());

        wrapper.appendChild(bubble);

        if(item.reactions&&item.reactions.length){
            var reacts=document.createElement('div');reacts.className='Reactions is-outside _twd-feed-reactions_';reacts.setAttribute('dir','ltr');
            item.reactions.slice(0,8).forEach(function(r){
                var pill=document.createElement('button');pill.type='button';pill.className='_twd-feed-reaction_';pill.tabIndex=-1;
                var emoji=document.createElement('span');emoji.className='_twd-feed-reaction-emoji_';emoji.textContent=r.emoji||'•';
                var count=document.createElement('span');count.className='_twd-feed-reaction-count_';count.textContent=String(r.count||0);
                pill.append(emoji,count);reacts.appendChild(pill);
            });
            wrapper.appendChild(reacts);
        }

        post.append(select,wrapper);
        return post;
    }

    async function renderFeed(){
        if(!feedView||!feedBody)return;
        var seq=++renderSeq;
        var container=feedBody.querySelector('.messages-container');
        if(!container)return;
        container.innerHTML='';
        if(!feedSources.length){
            var empty=document.createElement('div');empty.className='_twd-feed-empty_';
            var h=document.createElement('h3');h.textContent=tr('Лента пока пустая','Your feed is empty');
            var p=document.createElement('p');p.textContent=tr('Нажмите ПКМ по каналу или группе в списке чатов и выберите «Добавить в ленту».','Right-click a channel or group in the chat list and choose “Add to feed”.');
            empty.append(h,p);container.appendChild(empty);updateFeedHeader();return;
        }
        var loading=document.createElement('div');loading.className='_twd-feed-empty_';loading.textContent=tr('Загрузка постов…','Loading posts…');container.appendChild(loading);
        var items=await collectFeedItems();
        if(seq!==renderSeq||!feedBody)return;
        container.innerHTML='';
        if(!items.length){
            var none=document.createElement('div');none.className='_twd-feed-empty_';none.textContent=tr('В кэше Telegram пока нет постов из выбранных источников. Новые публикации появятся здесь автоматически.','Telegram has no cached posts from these sources yet. New posts will appear here automatically.');container.appendChild(none);
        }else{
            var current='',dateGroup=null,first=true;
            items.forEach(function(item){
                var dk=dateKey(item.date);
                if(dk!==current){
                    current=dk;
                    dateGroup=document.createElement('div');
                    dateGroup.className='message-date-group'+(first?' first-message-date-group':'');
                    first=false;
                    var sticky=document.createElement('div');sticky.className='sticky-date interactive _twd-feed-sticky-date_';
                    var label=document.createElement('span');label.setAttribute('dir','auto');label.textContent=dateLabel(item.date);
                    sticky.appendChild(label);dateGroup.appendChild(sticky);container.appendChild(dateGroup);
                }
                dateGroup.appendChild(makePost(item));
            });
            requestAnimationFrame(function(){if(feedBody)feedBody.scrollTop=feedBody.scrollHeight;});
        }
        updateFeedRow(items);
        updateFeedHeader(items);
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
    function updateFeedHeader(items){
        if(!feedView)return;
        var status=feedView.querySelector('._twd-feed-native-status_');
        if(status){
            var n=feedSources.length,count=Array.isArray(items)?items.length:null;
            status.textContent=n
                ? (n+' '+tr('источника','sources')+(count!=null?' · '+count+' '+tr('постов','posts'):''))
                : tr('Источники не выбраны','No sources selected');
        }
    }

    function openFeed(){
        if(feedView&&feedView.isConnected)return;
        lastUnderlying=currentUnderlyingChat();
        var middle=document.getElementById('MiddleColumn');if(!middle)return;
        var donor=middle.querySelector(':scope > .messages-layout');

        middle.classList.add('_twd-feed-host_');
        document.body.classList.add('_twd-feed-open_');
        if(donor){donor.dataset.twdFeedHidden='1';donor.style.visibility='hidden';}

        feedView=document.createElement('div');
        feedView.id='_twd-feed-view_';
        feedView.className=(donor?donor.className:'messages-layout')+' _twd-feed-view_';
        feedView._underLayout=donor||null;

        var donorHeader=donor&&donor.querySelector(':scope > .MiddleHeader');
        var header=donorHeader?donorHeader.cloneNode(true):document.createElement('div');
        if(!donorHeader){
            header.className='MiddleHeader';
            header.innerHTML='<div class="Transition"><div class="Transition_slide Transition_slide-active"><div class="chat-info-wrapper"><div class="ChatInfo"><div class="Avatar size-medium no-photo peer-color-0" style="--_size:44px"><div class="inner"></div></div><div class="info"><div class="title"><h3 dir="auto" class="fullName"></h3></div><span class="status"></span></div></div></div></div></div><div class="header-tools"><div class="HeaderActions"></div></div>';
        }
        header.classList.add('_twd-feed-native-header_');
        header.querySelectorAll('[id],[data-peer-id]').forEach(function(x){x.removeAttribute('id');x.removeAttribute('data-peer-id');});
        var avatar=header.querySelector('.Avatar');
        if(avatar){
            avatar.className='Avatar size-medium no-photo peer-color-0 _twd-feed-header-avatar_';
            avatar.style.setProperty('--_size','44px');
            var ai=avatar.querySelector('.inner')||document.createElement('div');
            ai.className='inner';ai.innerHTML='<i class="icon icon-channel Avatar__icon" aria-hidden="true"></i>';avatar.replaceChildren(ai);
        }
        var hTitle=header.querySelector('.fullName');
        if(hTitle){hTitle.textContent=tr('Лента','Feed');hTitle.removeAttribute('role');}
        var hStatus=header.querySelector('.status');
        if(hStatus){hStatus.innerHTML='';var gs=document.createElement('span');gs.className='group-status _twd-feed-native-status_';hStatus.appendChild(gs);}
        var actions=header.querySelector('.HeaderActions');
        if(actions){
            actions.innerHTML='';
            var sources=document.createElement('button');sources.className='Button smaller translucent round _twd-feed-source-button_';sources.type='button';
            sources.setAttribute('aria-label',tr('Источники ленты','Feed sources'));sources.title=tr('Источники ленты','Feed sources');
            sources.innerHTML='<i class="icon icon-more" aria-hidden="true"></i>';
            sources.addEventListener('click',toggleSourcePanel);actions.appendChild(sources);
        }

        var donorOuter=donor&&[...donor.children].find(function(x){return x.classList&&x.classList.contains('Transition')&&x.querySelector('.MessageList');});
        var donorList=donorOuter&&donorOuter.querySelector('.MessageList');
        var outerTransition=donorOuter?donorOuter.cloneNode(false):document.createElement('div');
        outerTransition.classList.add('Transition','_twd-feed-list-transition_');
        var outerSlide=document.createElement('div');outerSlide.className='Transition_slide Transition_slide-active';
        feedBody=donorList?donorList.cloneNode(false):document.createElement('div');
        feedBody.classList.add('with-bottom-snap','Transition','MessageList','custom-scroll','no-avatars','with-default-bg','_twd-feed-body_');
        feedBody.classList.remove('scrolled');
        feedBody.setAttribute('data-list-key','_twd_virtual_feed_');
        feedBody.style.setProperty('--message-list-bottom-inset','0px');
        feedBody.style.setProperty('--message-list-bottom-fade','0px');
        var innerSlide=document.createElement('div');innerSlide.className='Transition_slide Transition_slide-active';
        var messages=document.createElement('div');messages.className='messages-container';messages.style.paddingBottom='16px';
        var backwards=document.createElement('div');backwards.className='backwards-trigger';messages.appendChild(backwards);
        innerSlide.appendChild(messages);feedBody.appendChild(innerSlide);outerSlide.appendChild(feedBody);outerTransition.appendChild(outerSlide);

        sourcePanel=document.createElement('aside');sourcePanel.className='_twd-feed-source-panel_';
        feedView.append(header,outerTransition,sourcePanel);middle.appendChild(feedView);
        if(feedRow)feedRow.classList.add('_twd-feed-selected_');
        updateFeedHeader();
        renderFeed();
    }
    function closeFeed(){
        document.body.classList.remove('_twd-feed-open_');
        var middle=document.getElementById('MiddleColumn');if(middle)middle.classList.remove('_twd-feed-host_');
        if(feedView&&feedView._underLayout){
            feedView._underLayout.style.visibility='';
            delete feedView._underLayout.dataset.twdFeedHidden;
        }
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
