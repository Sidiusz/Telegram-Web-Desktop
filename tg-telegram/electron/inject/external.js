(function(){
    const ALLOWED=["telegram.org","web.telegram.org","t.me","telegram.me","core.telegram.org","api.telegram.org","td.telegram.org"];
    for(let i=0;i<12;i++) ALLOWED.push('cdn'+i+'.telegram.org');
    ALLOWED.push("translations.telegram.org");
    function allowed(h){h=h.replace(/^www\./,"");return ALLOWED.some(a=>h===a||h.endsWith("."+a));}
    document.addEventListener("click",e=>{
        let a=e.target.closest("a");
        if(a&&a.href){try{let u=new URL(a.href);if(!allowed(u.host)){e.preventDefault();e.stopImmediatePropagation();window.tgBridge.invoke("open_url",{url:a.href});}}catch(e){}}
    },{capture:false});
    const o=window.open;
    window.open=function(u){
        if(typeof u==="string"){try{let url=new URL(u);if(!allowed(url.host)){window.tgBridge.invoke("open_url",{url:u});return null;}}catch(e){}}
        return o.apply(this,arguments);
    };
})();