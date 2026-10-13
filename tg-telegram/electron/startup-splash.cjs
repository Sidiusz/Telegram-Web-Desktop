'use strict';
const fs = require('fs');
const path = require('path');

// Startup splash drawn into Telegram's own HTML, so it is on screen from the very first paint.
// It never blocks the page: pointer-events are off, it fades out as soon as Telegram shows the
// login form, the chat list or a passcode prompt, and it is removed after 15 s whatever happens.
const SPLASH_ID = 'twd-splash';
const MAX_SPLASH_MS = 15000;
const MAIN_SETTLE_MS = 4000;

// The app icon itself (electron/icons/icon.svg), so the splash and the icon never drift apart.
const LOGO_SVG = fs.readFileSync(path.join(__dirname, 'icons', 'icon.svg'), 'utf8')
    .replace(/<svg\b[^>]*>/, '<svg class="twd-splash-logo" viewBox="0 0 108 108" aria-hidden="true">')
    .trim();

function splashMarkup(theme) {
    const dark = theme !== 'light';
    const bg = dark ? '#212121' : '#ffffff';
    const text = dark ? '#aaaaaa' : '#707579';
    const track = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const style = `<style id="${SPLASH_ID}-style">
#${SPLASH_ID}{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:${bg};pointer-events:none;opacity:1;transition:opacity .35s ease;font-family:Roboto,-apple-system,"Segoe UI",sans-serif;}
#${SPLASH_ID}.twd-splash-out{opacity:0;}
#${SPLASH_ID} .twd-splash-logo{width:112px;height:112px;filter:drop-shadow(0 8px 26px rgba(56,140,232,.4));animation:twd-splash-in .5s cubic-bezier(.2,.9,.3,1.2) both;}
#${SPLASH_ID} .twd-icon-plane{animation:twd-splash-float 2.6s ease-in-out infinite;}
#${SPLASH_ID} .twd-splash-name{margin-top:22px;font-size:15px;letter-spacing:.2px;color:${text};animation:twd-splash-fade .6s .15s ease both;}
#${SPLASH_ID} .twd-splash-bar{position:relative;width:132px;height:3px;margin-top:16px;border-radius:2px;overflow:hidden;background:${track};animation:twd-splash-fade .6s .3s ease both;}
#${SPLASH_ID} .twd-splash-bar::after{content:"";position:absolute;top:0;bottom:0;width:40%;border-radius:2px;background:#3390ec;animation:twd-splash-run 1.25s cubic-bezier(.45,0,.55,1) infinite;}
@keyframes twd-splash-in{from{opacity:0;transform:scale(.86);}to{opacity:1;transform:none;}}
@keyframes twd-splash-fade{from{opacity:0;}to{opacity:1;}}
@keyframes twd-splash-float{0%,100%{transform:translate(0,0);}50%{transform:translate(1.5px,-2.5px);}}
@keyframes twd-splash-run{from{left:-40%;}to{left:100%;}}
@media (prefers-reduced-motion:reduce){#${SPLASH_ID} *,#${SPLASH_ID} .twd-splash-bar::after{animation:none!important;}}
</style>`;
    const body = `<div id="${SPLASH_ID}" aria-hidden="true">${LOGO_SVG}<div class="twd-splash-name">Telegram Web Desktop</div><div class="twd-splash-bar"></div></div>
<script>(function(){var s=document.getElementById('${SPLASH_ID}');if(!s)return;var t0=Date.now(),mainAt=0,done=false;
var AUTH='#auth-qr-form,#auth-phone-number-form,#auth-code-form,#auth-password-form,#auth-registration-form';
function ready(){if(Date.now()-t0>${MAX_SPLASH_MS})return true;if(document.querySelector(AUTH))return true;
if(document.querySelector('#LeftColumn .chat-list .ListItem'))return true;
var pw=document.querySelector('input[type=password]');if(pw&&pw.offsetParent)return true;
if(document.getElementById('Main')){if(!mainAt)mainAt=Date.now();else if(Date.now()-mainAt>${MAIN_SETTLE_MS})return true;}return false;}
function hide(){if(done)return;done=true;s.classList.add('twd-splash-out');setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);var st=document.getElementById('${SPLASH_ID}-style');if(st&&st.parentNode)st.parentNode.removeChild(st);},420);}
var iv=setInterval(function(){if(ready()){clearInterval(iv);hide();}},120);})();</script>`;
    return { style, body };
}

function injectStartupSplash(html, theme) {
    const source = String(html || '');
    if (source.includes(`id="${SPLASH_ID}"`)) return source;
    const { style, body } = splashMarkup(theme);
    return source
        .replace(/<\/head>/i, style + '</head>')
        .replace(/<body([^>]*)>/i, (m) => m + body);
}

module.exports = { injectStartupSplash, splashMarkup, MAX_SPLASH_MS };
