// Local virtual "Feed" chat. Sources are Telegram broadcast channels only; the
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
    var channelCatalog=new Map();
    var mediaObserver=null;
    var mediaViewer=null;
    var ru=function(){return typeof curLang==='function'&&curLang()==='ru';};
    var tr=function(r,e){return ru()?r:e;};
    var keyOf=function(chatId,messageId){return String(chatId)+':'+String(messageId);};

    function sourceIds(){return feedSources.map(function(x){return String(x.id);});}
    function sourceById(id){id=String(id);return feedSources.find(function(x){return String(x.id)===id;})||null;}
    function publishConfig(){
        try{window.dispatchEvent(new CustomEvent('__twd_feed_config',{detail:{sources:sourceIds()}}));}catch(_){}
    }
    async function loadSources(){
        var settings={};
        try{settings=await INV('get_settings')||{};}catch(_){settings={};}
        var requested=Array.isArray(settings.feed_sources)?settings.feed_sources.map(function(x){
            return {id:String(x.id||''),title:String(x.title||''),username:String(x.username||'')};
        }).filter(function(x){return /^-\d+$/.test(x.id);}):[];
        var states=await readTelegramStates();
        rebuildChannelCatalog(states);
        feedSources=requested.filter(function(x){return channelCatalog.has(x.id);}).map(function(x){
            var meta=channelCatalog.get(x.id)||{};
            return {id:x.id,title:String(meta.title||x.title||''),username:String((meta.usernames&&meta.usernames.find(function(u){return u&&u.isActive!==false&&u.username;})||{}).username||x.username||'')};
        });
        if(feedSources.length!==requested.length){
            try{await INV('save_settings',{settings:Object.assign({},settings,{feed_sources:feedSources})});}catch(_){}
        }
        publishConfig();
        updateFeedRow();
        if(feedView)renderFeed();
    }
    async function saveSources(next){
        var clean=[],seen=new Set();
        (next||[]).forEach(function(x){
            var id=String(x&&x.id||'');
            if(!/^-\d+$/.test(id)||seen.has(id)||!channelCatalog.has(id))return;
            seen.add(id);
            var meta=channelCatalog.get(id)||{};
            var uname=(meta.usernames&&meta.usernames.find(function(u){return u&&u.isActive!==false&&u.username;})||{}).username;
            clean.push({id:id,title:String(meta.title||x.title||'').slice(0,160),username:String(uname||x.username||'').replace(/^@/,'').slice(0,64)});
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

    function formattedFromContent(content){
        if(!content||typeof content!=='object')return {text:'',entities:[]};
        var values=[
            content.text,content.caption,
            content.photo&&content.photo.caption,
            content.video&&content.video.caption,
            content.document&&content.document.caption,
            content.animation&&content.animation.caption
        ];
        for(var i=0;i<values.length;i++){
            var v=values[i];
            if(typeof v==='string'&&v)return {text:v,entities:[]};
            if(v&&v.text!=null&&String(v.text))return {
                text:String(v.text),
                entities:Array.isArray(v.entities)?v.entities.map(function(e){
                    return {
                        type:String(e&&e.type||''),
                        offset:Number(e&&e.offset)||0,
                        length:Number(e&&e.length)||0,
                        url:e&&e.url?String(e.url):'',
                        language:e&&e.language?String(e.language):''
                    };
                }).filter(function(e){return e.type&&e.length>0;}):[]
            };
        }
        return {text:'',entities:[]};
    }
    function mediaFromContent(content){
        if(!content||typeof content!=='object')return null;
        var keys=['photo','video','animation','document','audio','voice','sticker','poll','location','contact'];
        for(var i=0;i<keys.length;i++){
            var type=keys[i],m=content[type];if(!m)continue;
            var sizes=Array.isArray(m.sizes)?m.sizes.map(function(x){return{width:Number(x&&x.width)||0,height:Number(x&&x.height)||0,type:String(x&&x.type||'')};}):[];
            var previews=Array.isArray(m.previewPhotoSizes)?m.previewPhotoSizes.map(function(x){return{width:Number(x&&x.width)||0,height:Number(x&&x.height)||0,type:String(x&&x.type||'')};}):[];
            var dims=[{width:Number(m.width)||0,height:Number(m.height)||0}].concat(sizes,previews,{width:Number(m.thumbnail&&m.thumbnail.width)||0,height:Number(m.thumbnail&&m.thumbnail.height)||0});
            dims.sort(function(a,b){return (b.width*b.height)-(a.width*a.height);});
            var best=dims[0]||{width:0,height:0};
            return {
                type:type,
                id:m.id!=null?String(m.id):'',
                thumbnail:m.thumbnail&&m.thumbnail.dataUri?String(m.thumbnail.dataUri):'',
                fileName:m.fileName?String(m.fileName):'',
                duration:Number(m.duration)||0,
                mimeType:m.mimeType?String(m.mimeType):'',
                width:Number(best.width)||0,
                height:Number(best.height)||0,
                size:Number(m.size)||0,
                sizes:sizes,
                previewPhotoSizes:previews
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
        var formatted=formattedFromContent(message&&message.content);
        return {
            chatId:String(chatId),messageId:String(messageId),
            text:formatted.text,
            entities:formatted.entities,
            date:Number(message&&message.date)||0,
            media:mediaFromContent(message&&message.content),
            viewsCount:Number(message&&message.viewsCount)||0,
            forwardsCount:Number(message&&message.forwardsCount)||0,
            reactions:reactionsFromMessage(message),
            isEdited:!!(message&&message.isEdited===true)
        };
    }
    function normalizeLiveItem(item){
        if(!item)return null;
        return {
            chatId:String(item.chatId||''),messageId:String(item.messageId||''),
            text:String(item.text||''),entities:Array.isArray(item.entities)?item.entities:[],
            date:Number(item.date)||Math.floor(Date.now()/1000),
            media:item.media||null,viewsCount:Number(item.viewsCount)||0,forwardsCount:Number(item.forwardsCount)||0,
            reactions:Array.isArray(item.reactions)?item.reactions:[],isEdited:item.isEdited===true
        };
    }

    function rebuildChannelCatalog(states){
        channelCatalog.clear();
        (states||[]).forEach(function(state){
            var chats=state&&state.chats&&state.chats.byId||{};
            Object.keys(chats).forEach(function(id){
                var meta=chats[id];
                if(meta&&meta.type==='chatTypeChannel')channelCatalog.set(String(id),meta);
            });
        });
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
        rebuildChannelCatalog(states);
        states.forEach(function(state){
            feedSources.forEach(function(src){
                var meta=state&&state.chats&&state.chats.byId&&state.chats.byId[src.id];
                if(!meta||meta.type!=='chatTypeChannel')return;
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
    function formatChannelCount(value){
        value=Number(value)||0;
        if(value>=1000000){
            var m=Math.floor(value/100000)/10;
            return String(m).replace('.',ru()?',':'.')+'M';
        }
        if(value>=1000){
            var k=Math.floor(value/100)/10;
            return String(k).replace('.',ru()?',':'.')+'K';
        }
        return String(value);
    }
    function appendPlainText(target,value){
        String(value||'').split('\n').forEach(function(part,index){
            if(index)target.appendChild(document.createElement('br'));
            if(part)target.appendChild(document.createTextNode(part));
        });
    }
    function entityNode(entity,value){
        var type=String(entity&&entity.type||'');
        var node;
        if(type==='MessageEntityBold')node=document.createElement('strong');
        else if(type==='MessageEntityItalic')node=document.createElement('em');
        else if(type==='MessageEntityUnderline')node=document.createElement('u');
        else if(type==='MessageEntityStrike'||type==='MessageEntityStrikethrough')node=document.createElement('s');
        else if(type==='MessageEntityCode')node=document.createElement('code');
        else if(type==='MessageEntityPre'){
            node=document.createElement('pre');
            if(entity.language)node.dataset.language=entity.language;
        }else if(type==='MessageEntityTextUrl'||type==='MessageEntityUrl'){
            node=document.createElement('a');
            node.className='text-entity-link';
            node.href=type==='MessageEntityTextUrl'&&entity.url?entity.url:value;
            node.target='_blank';node.rel='noopener noreferrer';
        }else if(type==='MessageEntityBlockquote'){
            var wrap=document.createElement('span');wrap.className='_twd-feed-blockquote-wrap_';
            node=document.createElement('blockquote');node.className='_twd-feed-blockquote_';
            var inner=document.createElement('div');inner.className='_twd-feed-blockquote-inner_';appendPlainText(inner,value);
            node.appendChild(inner);wrap.appendChild(node);
            wrap.dataset.entityType=type;
            return wrap;
        }else{
            node=document.createElement('span');
        }
        node.dataset.entityType=type;
        appendPlainText(node,value);
        return node;
    }
    function renderFormattedText(target,text,entities){
        text=String(text||'');
        var list=(Array.isArray(entities)?entities:[]).map(function(e){
            return {type:String(e&&e.type||''),offset:Math.max(0,Number(e&&e.offset)||0),length:Math.max(0,Number(e&&e.length)||0),url:e&&e.url?String(e.url):'',language:e&&e.language?String(e.language):''};
        }).filter(function(e){return e.type&&e.length>0&&e.offset<text.length;}).sort(function(a,b){return a.offset-b.offset||b.length-a.length;});
        var cursor=0;
        list.forEach(function(e){
            if(e.offset<cursor)return;
            if(e.offset>cursor)appendPlainText(target,text.slice(cursor,e.offset));
            var end=Math.min(text.length,e.offset+e.length);
            target.appendChild(entityNode(e,text.slice(e.offset,end)));
            cursor=end;
        });
        if(cursor<text.length)appendPlainText(target,text.slice(cursor));
    }
    function emojiAssetPath(value){
        var cps=Array.from(String(value||'')).map(function(ch){return ch.codePointAt(0);}).filter(function(cp){return cp!==0xFE0F;});
        return cps.length?'./img-apple-64/'+cps.map(function(cp){return cp.toString(16);}).join('-')+'.png':'';
    }
    function buildNativeReactions(item){
        if(!item.reactions||!item.reactions.length)return null;
        var reacts=document.createElement('div');reacts.className='Reactions _twd-feed-reactions_';reacts.setAttribute('dir','ltr');
        item.reactions.slice(0,10).forEach(function(r){
            var pill=document.createElement('button');pill.type='button';pill.className='Button message-reaction tiny primary _twd-feed-reaction_';pill.tabIndex=-1;
            var emoji=document.createElement('span');emoji.className='_twd-feed-reaction-emoji_';
            var asset=emojiAssetPath(r.emoji);
            if(asset){
                var emojiImg=document.createElement('img');emojiImg.className='emoji emoji-small _twd-feed-reaction-image_';emojiImg.src=asset;emojiImg.alt=r.emoji||'';emojiImg.draggable=false;
                emoji.appendChild(emojiImg);
            }else emoji.textContent=r.emoji||'•';
            var count=document.createElement('span');count.className='_twd-feed-reaction-count_';count.textContent=formatChannelCount(r.count||0);
            pill.append(emoji,count);reacts.appendChild(pill);
        });
        return reacts;
    }
    function mediaPreviewHash(media){
        if(!media||!media.id)return '';
        if(media.type==='photo')return 'photo'+media.id+'?size=x';
        if(media.type==='video'||media.type==='animation'||media.type==='document')return 'document'+media.id+'?size=x';
        return '';
    }
    function mediaFullHash(media){
        if(!media||!media.id)return '';
        if(media.type==='photo')return 'photo'+media.id;
        if(media.type==='video'||media.type==='animation'||media.type==='document')return 'document'+media.id;
        return '';
    }
    async function loadMediaHash(hash,retry){
        if(!hash||!window.__twdFeedMediaApi||typeof window.__twdFeedMediaApi.load!=='function')throw new Error('media api unavailable');
        try{return await window.__twdFeedMediaApi.load(hash);}
        catch(e){
            if((retry||0)<3){
                await new Promise(function(r){setTimeout(r,350*(retry+1));});
                return loadMediaHash(hash,(retry||0)+1);
            }
            throw e;
        }
    }
    function loadFeedPreview(img){
        if(!img||!img.isConnected||img.dataset.twdMediaReady==='1'||img.dataset.twdMediaLoading==='1')return;
        var hash=img.dataset.twdMediaHash;if(!hash)return;
        img.dataset.twdMediaLoading='1';
        loadMediaHash(hash).then(function(url){
            if(img.isConnected&&url){img.src=url;img.dataset.twdMediaReady='1';img.classList.add('_twd-feed-media-ready_');}
        }).catch(function(){}).finally(function(){if(img&&img.dataset)delete img.dataset.twdMediaLoading;});
    }
    function hydrateMediaNearViewport(){
        if(!feedBody||!feedBody.isConnected)return;
        var root=feedBody.getBoundingClientRect(),pad=700;
        feedBody.querySelectorAll('._twd-feed-native-thumb_[data-twd-media-hash]').forEach(function(img){
            var r=img.getBoundingClientRect();
            if(r.bottom>=root.top-pad&&r.top<=root.bottom+pad)loadFeedPreview(img);
        });
    }
    function setupMediaObserver(){
        if(mediaObserver){try{mediaObserver.disconnect();}catch(_){}}
        mediaObserver=new IntersectionObserver(function(entries){
            entries.forEach(function(entry){
                if(!entry.isIntersecting)return;
                loadFeedPreview(entry.target);
            });
        },{root:feedBody,rootMargin:'700px 0px'});
        if(!feedBody._twdMediaScrollBound){
            feedBody._twdMediaScrollBound=true;
            var timer=0;
            feedBody.addEventListener('scroll',function(){
                clearTimeout(timer);timer=setTimeout(hydrateMediaNearViewport,60);
            },{passive:true});
        }
    }
    function closeMediaViewer(){
        if(!mediaViewer)return;
        try{mediaViewer.remove();}catch(_){}
        mediaViewer=null;
    }
    function openMediaViewer(item){
        var media=item&&item.media,hash=mediaFullHash(media);
        if(!hash||!media)return;
        try{
            var actions=window.__tgRuntime&&window.__tgRuntime.getActions&&window.__tgRuntime.getActions();
            if(actions&&typeof actions.openMediaViewer==='function'){
                actions.openMediaViewer({chatId:String(item.chatId),messageId:Number(item.messageId)});
                return;
            }
        }catch(_){}
        closeMediaViewer();
        var root=document.getElementById('portals')||document.body;
        mediaViewer=document.createElement('div');mediaViewer.className='_twd-feed-media-viewer_';
        var stage=document.createElement('div');stage.className='_twd-feed-media-stage_';
        var loading=document.createElement('div');loading.className='_twd-feed-media-loading_';loading.textContent=tr('Загрузка…','Loading…');
        var close=document.createElement('button');close.type='button';close.className='Button smaller translucent-white round _twd-feed-media-close_';close.setAttribute('aria-label',tr('Закрыть','Close'));close.innerHTML='<i class="icon icon-close" aria-hidden="true"></i>';
        close.addEventListener('click',function(e){e.stopPropagation();closeMediaViewer();});
        stage.appendChild(loading);mediaViewer.append(stage,close);root.appendChild(mediaViewer);
        mediaViewer.addEventListener('click',function(e){if(e.target===mediaViewer)closeMediaViewer();});
        var esc=function(e){if(e.key==='Escape'){window.removeEventListener('keydown',esc,true);closeMediaViewer();}};
        window.addEventListener('keydown',esc,true);
        loadMediaHash(hash).then(function(url){
            if(!mediaViewer||!mediaViewer.isConnected)return;
            stage.innerHTML='';
            if(media.type==='video'||media.type==='animation'){
                var video=document.createElement('video');video.className='_twd-feed-media-full_';video.src=url;video.controls=true;video.autoplay=false;video.preload='metadata';video.playsInline=true;stage.appendChild(video);
            }else{
                var full=document.createElement('img');full.className='_twd-feed-media-full_';full.src=url;full.alt='';full.draggable=false;stage.appendChild(full);
            }
        }).catch(function(){
            if(loading&&loading.isConnected)loading.textContent=tr('Не удалось загрузить медиа','Failed to load media');
        });
    }
    function makePost(item,eagerMedia){
        var hasText=!!item.text,hasMedia=!!item.media,hasReactions=!!(item.reactions&&item.reactions.length);

        var post=document.createElement('div');
        post.id='_twd-feed-message-'+String(item.chatId).replace(/\D/g,'')+'-'+String(item.messageId);
        post.className='Message message-list-item first-in-group allow-selection last-in-group shown open _twd-feed-message_';
        if(item.viewsCount)post.classList.add('has-views');
        if(item.isEdited)post.classList.add('was-edited');
        post.dataset.chatId=item.chatId;post.dataset.messageId=item.messageId;

        var select=document.createElement('div');select.className='message-select-control no-selection';
        var wrapper=document.createElement('div');wrapper.className='message-content-wrapper can-select-text';
        if(hasMedia){var mw=Number(item.media&&item.media.width)||752,mh=Number(item.media&&item.media.height)||0,ratio=mh>0?mw/mh:0;var mediaWidth=Math.max(320,Math.min(752,mw,ratio>0?432*ratio:752));wrapper.style.width=mediaWidth+'px';wrapper.style.maxWidth='calc(100% - 1px)';}
        var classes=['message-content','peer-color-0','has-action-button','has-shadow','has-solid-background','has-appendix','_twd-feed-native-bubble_'];
        if(hasMedia)classes.push('media','has-adaptive-width','with-wide-media');
        if(hasText)classes.push('text','has-footer');
        else if(hasMedia)classes.push('no-text','no-footer');
        if(hasReactions)classes.push('has-reactions');
        var bubble=document.createElement('div');bubble.className=classes.join(' ');bubble.setAttribute('dir','auto');if(hasMedia)bubble.style.width='100%';
        var inner=document.createElement('div');inner.className='content-inner';inner.setAttribute('dir','auto');

        if(hasMedia){
            if(item.media.thumbnail){
                var media=document.createElement('div');media.className='media-inner interactive _twd-feed-native-media_';
                if(item.media.width&&item.media.height){media.style.setProperty('--media-width',item.media.width+'px');media.style.setProperty('--media-aspect-ratio',String(item.media.width/item.media.height));}
                var img=document.createElement('img');img.className='full-media opacity-transition slow shown open _twd-feed-native-thumb_';img.src=item.media.thumbnail;img.alt=mediaLabel(item.media.type);img.draggable=false;
                var previewHash=mediaPreviewHash(item.media);if(previewHash)img.dataset.twdMediaHash=previewHash;
                media.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openMediaViewer(item);});
                media.appendChild(img);
                if(previewHash&&mediaObserver)mediaObserver.observe(img);
                if(previewHash&&eagerMedia)setTimeout(function(){loadFeedPreview(img);},0);
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

        function buildMeta(withReactionOffset){
            var meta=document.createElement('span');meta.className='MessageMeta'+(withReactionOffset?' reactions-offset':'');meta.setAttribute('dir','ltr');meta.setAttribute('data-ignore-on-paste','true');
            if(item.viewsCount){
                var views=document.createElement('span');views.className='message-views';views.textContent=formatChannelCount(item.viewsCount);views.title=tr('Просмотры: ','Views: ')+String(item.viewsCount);
                meta.appendChild(views);
                var vi=document.createElement('i');vi.className='icon icon-channelviews';vi.setAttribute('aria-hidden','true');meta.appendChild(vi);
            }
            var time=document.createElement('span');time.className='message-time';
            time.textContent=(item.isEdited?tr('изменено ','edited '):'')+fmtTime(item.date);meta.appendChild(time);
            return meta;
        }

        if(hasText){
            var text=document.createElement('div');text.className='text-content clearfix with-meta _twd-feed-text_';text.setAttribute('dir','auto');
            renderFormattedText(text,item.text,item.entities);
            var reactions=buildNativeReactions(item);
            if(reactions)text.appendChild(reactions);
            text.appendChild(buildMeta(!!reactions));
            inner.appendChild(text);
        }
        bubble.appendChild(inner);
        if(hasMedia&&!hasText){
            var mediaReactions=buildNativeReactions(item);
            if(mediaReactions)bubble.appendChild(mediaReactions);
            bubble.appendChild(buildMeta(!!mediaReactions));
        }

        var actionsWrap=document.createElement('div');actionsWrap.className='message-action-buttons-container';
        var stickyZone=document.createElement('div');stickyZone.className='message-action-buttons-sticky-zone';
        var sticky=document.createElement('div');sticky.className='message-action-buttons message-action-button-sticky';stickyZone.appendChild(sticky);
        var actions=document.createElement('div');actions.className='message-action-buttons';
        var open=document.createElement('button');open.type='button';open.className='Button message-action-button default translucent-white round';open.setAttribute('aria-label',tr('Открыть исходный канал','Open source channel'));open.title=tr('Открыть исходный канал','Open source channel');
        var oi=document.createElement('i');oi.className='icon icon-share-filled';oi.setAttribute('aria-hidden','true');open.appendChild(oi);open.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openSource(item);});
        actions.appendChild(open);actionsWrap.append(stickyZone,actions);bubble.appendChild(actionsWrap);
        bubble.appendChild(appendixSvg());

        wrapper.appendChild(bubble);
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
            var p=document.createElement('p');p.textContent=tr('Нажмите ПКМ по каналу в списке чатов и выберите «Добавить в ленту».','Right-click a channel in the chat list and choose “Add to feed”.');
            empty.append(h,p);container.appendChild(empty);updateFeedHeader();return;
        }
        var loading=document.createElement('div');loading.className='_twd-feed-empty_';loading.textContent=tr('Загрузка постов…','Loading posts…');container.appendChild(loading);
        var items=await collectFeedItems();
        if(seq!==renderSeq||!feedBody)return;
        container.innerHTML='';
        setupMediaObserver();
        if(!items.length){
            var none=document.createElement('div');none.className='_twd-feed-empty_';none.textContent=tr('В кэше Telegram пока нет постов из выбранных источников. Новые публикации появятся здесь автоматически.','Telegram has no cached posts from these sources yet. New posts will appear here automatically.');container.appendChild(none);
        }else{
            var current='',dateGroup=null,first=true;
            items.forEach(function(item,index){
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
                dateGroup.appendChild(makePost(item,index>=items.length-16));
            });
            setTimeout(function(){if(feedBody){feedBody.scrollTop=feedBody.scrollHeight;setTimeout(hydrateMediaNearViewport,80);}},0);
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

        if(lastUnderlying&&channelCatalog.has(String(lastUnderlying.id))&&!sourceById(lastUnderlying.id)){
            var add=document.createElement('button');add.className='_twd-feed-source-add_';add.type='button';
            add.textContent=tr('Добавить открытый канал: ','Add open channel: ')+(lastUnderlying.title||lastUnderlying.id);
            add.addEventListener('click',function(){saveSources(feedSources.concat([{id:lastUnderlying.id,title:lastUnderlying.title||lastUnderlying.id,username:''}]));});
            sourcePanel.appendChild(add);
        }
        if(!feedSources.length){
            var e=document.createElement('p');e.className='_twd-feed-source-note_';e.textContent=tr('Источников нет. Добавляйте каналы через ПКМ в списке чатов.','No sources yet. Add channels from the chat-list context menu.');sourcePanel.appendChild(e);
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
        var donor=middle.querySelector(':scope > .messages-layout:not(._twd-feed-view_)');

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
        if(mediaObserver){try{mediaObserver.disconnect();}catch(_){}mediaObserver=null;}
        closeMediaViewer();
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
                : (n? n+' '+tr('источн.','sources') : tr('Добавьте каналы','Add channels'));
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
        inner.classList.add('_twd-feed-list-inner_');
        if(feedRow&&feedRow.isConnected&&feedRow.parentElement===inner){updateFeedRow();return;}
        document.querySelectorAll('#_twd-feed-chat_').forEach(function(x){x.remove();});
        feedRow=buildFeedRow(sample);
        var archive=inner.querySelector('.chat-item-archive');
        var anchor=archive||inner.querySelector('.Chat:not(._twd-feed-chat_)')||null;
        inner.insertBefore(feedRow,anchor);
        updateFeedRow();
    }

    function chatContextFromTarget(target){
        var chat=target&&target.closest&&target.closest('#LeftColumn .Chat:not(._twd-feed-chat_)');
        if(!chat)return null;
        var av=chat.querySelector('.Avatar[data-peer-id]'),id=av&&av.getAttribute('data-peer-id');
        if(!id||!/^-\d+$/.test(String(id))||!channelCatalog.has(String(id)))return null;
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
    window.addEventListener('__twd_feed_media_ready',function(){if(feedView)setTimeout(hydrateMediaNearViewport,0);});
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
