// ── Длинные сообщения ─────────────────────────────────────────────────────
// Telegram rejects text over the message limit (MESSAGE_TOO_LONG). Like Telegram Desktop,
// send it as several messages instead: cut at a paragraph, line, sentence or word boundary,
// carry the formatting entities into every part, and send the parts strictly in order.
var _twdLongMessages=(function(){
    var DEFAULT_LIMIT=4096;
    // Anything but plain text keeps Telegram's own handling (media captions, polls, stickers…).
    var NOT_PLAIN=['attachment','attachments','poll','sticker','gif','contact','richMessage','dice','todo','story','storyId','isReaction','location'];

    function messageLimit(g){
        try{
            var lim=g&&g.appConfig&&g.appConfig.limits&&g.appConfig.limits.messageLength;
            var me=g&&g.users&&g.users.byId&&g.users.byId[g.currentUserId];
            var v=Array.isArray(lim)?Number(lim[me&&me.isPremium?1:0]):0;
            if(v>=1024)return v;
        }catch(_){}
        return DEFAULT_LIMIT;
    }
    function isSpace(ch){return /\s/.test(ch||'');}
    function lastBreak(win,minAt){
        var at=win.lastIndexOf('\n\n');if(at>=minAt)return at;
        at=win.lastIndexOf('\n');if(at>=minAt)return at;
        var re=/[.!?…]["'»”)\]]*\s/g,m,best=-1;
        while((m=re.exec(win)))best=m.index+m[0].length-1;
        if(best>=minAt)return best;
        at=win.lastIndexOf(' ');if(at>=minAt)return at;
        return -1;
    }
    function clampEntities(entities,start,end){
        var out=[];
        (entities||[]).forEach(function(e){
            if(!e||typeof e.offset!=='number'||typeof e.length!=='number')return;
            var s=Math.max(e.offset,start),t=Math.min(e.offset+e.length,end);
            if(t<=s)return;
            var copy={};for(var k in e)copy[k]=e[k];
            copy.offset=s-start;copy.length=t-s;out.push(copy);
        });
        return out;
    }
    // Offsets are UTF-16 code units, the same unit as JS string indexes.
    function split(text,entities,limit){
        var n=text.length,start=0,ranges=[];
        while(n-start>limit){
            var cut=lastBreak(text.slice(start,start+limit),Math.floor(limit/2));
            cut=cut<0?start+limit:start+cut;
            if(/[\uD800-\uDBFF]/.test(text.charAt(cut-1)))cut--;  // never split a surrogate pair
            ranges.push([start,cut]);
            start=cut;while(start<n&&isSpace(text.charAt(start)))start++;
        }
        ranges.push([start,n]);
        return ranges.map(function(r){
            var s=r[0],e=r[1];while(e>s&&isSpace(text.charAt(e-1)))e--;
            return {text:text.slice(s,e),entities:clampEntities(entities,s,e)};
        }).filter(function(p){return p.text.length>0;});
    }
    function pendingCount(chatId){
        try{
            var g=window.__twdTelegramRuntime.getGlobal(),c=g&&g.messages&&g.messages.byChatId&&g.messages.byChatId[chatId];
            var byId=c&&c.byId,n=0;if(!byId)return 0;
            for(var id in byId){var m=byId[id];if(m&&m.sendingState==='messageSendingStatePending')n++;}
            return n;
        }catch(_){return 0;}
    }
    function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
    // Each part waits until Telegram has sent the previous one, so they arrive in order.
    async function waitSent(chatId,baseline){
        var t0=Date.now();
        await wait(150);
        while(Date.now()-t0<10000&&pendingCount(chatId)>baseline)await wait(120);
    }
    function wrap(send){
        var wrapped=function(payload){
            try{
                var p=payload||{},list=p.messageList,text=p.text;
                var plain=list&&typeof text==='string'&&!NOT_PLAIN.some(function(k){return p[k]!=null&&p[k]!==false;});
                var limit=plain?messageLimit(window.__twdTelegramRuntime.getGlobal()):0;
                if(plain&&text.length>limit){
                    var parts=split(text,p.entities,limit);
                    if(parts.length>1){
                        var chatId=list.chatId,self=this,extra=Array.prototype.slice.call(arguments,1);
                        (async function(){
                            for(var i=0;i<parts.length;i++){
                                var baseline=pendingCount(chatId);
                                var next={};for(var k in p)next[k]=p[k];
                                next.text=parts[i].text;next.entities=parts[i].entities;
                                send.apply(self,[next].concat(extra));
                                if(i<parts.length-1)await waitSent(chatId,baseline);
                            }
                        })();
                        return;
                    }
                }
            }catch(_){}
            return send.apply(this,arguments);
        };
        wrapped.__twdLongMessages=true;
        return wrapped;
    }
    function install(){
        try{
            var rt=window.__twdTelegramRuntime;if(!rt||typeof rt.getActions!=='function')return false;
            var actions=rt.getActions();if(!actions||typeof actions.sendMessage!=='function')return false;
            if(!actions.sendMessage.__twdLongMessages)actions.sendMessage=wrap(actions.sendMessage);
            return true;
        }catch(_){return false;}
    }
    return {install:install,split:split,messageLimit:messageLimit};
})();
// Web A publishes its runtime when its notification chunk loads; keep the hook in place.
setInterval(function(){_twdLongMessages.install();},2000);
_twdLongMessages.install();
