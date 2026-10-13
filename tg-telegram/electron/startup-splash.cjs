'use strict';

// Startup splash drawn into Telegram's own HTML, so it is on screen from the very first paint.
// It never blocks the page: pointer-events are off, it fades out as soon as Telegram shows the
// login form, the chat list or a passcode prompt, and it is removed after 15 s whatever happens.
const SPLASH_ID = 'twd-splash';
const MAX_SPLASH_MS = 15000;
const MAIN_SETTLE_MS = 4000;

// Drawn after the app icon: the orbit's far half passes behind the globe, the near half in front
// of it but under the plane, and the moving dot follows the same rule.
const ORBIT = 'M6 55A48 9.5 0 0 1 102 55A48 9.5 0 0 1 6 55Z';
const LOGO_SVG = `<svg class="twd-splash-logo" viewBox="0 0 108 108" aria-hidden="true">
<defs><linearGradient id="twd-splash-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8cec"/><stop offset="1" stop-color="#1f7ade"/></linearGradient>
<clipPath id="twd-splash-globe"><circle cx="54" cy="55.5" r="34"/></clipPath>
<clipPath id="twd-splash-near"><rect x="-20" y="55" width="148" height="60"/></clipPath></defs>
<rect width="108" height="108" rx="28" fill="url(#twd-splash-bg)"/>
<g transform="rotate(-20 54 55)"><path d="M6 55A48 9.5 0 0 1 102 55" fill="none" stroke="#8cc6ff" stroke-width="1.6"/>
<circle r="3.4" fill="#9fd0ff"><animateMotion dur="3.2s" repeatCount="indefinite" path="${ORBIT}"/></circle></g>
<circle cx="54" cy="55.5" r="34" fill="#72b4f6"/>
<g clip-path="url(#twd-splash-globe)" fill="#8ec6fa"><path d="M30 25c9-3 17 1 19 6s-5 8-9 8 1 6-6 9-14 3-15-6 3-15 11-17Z"/><path d="M72 66c8-3 16 1 17 7s-6 13-14 14-12-6-11-11 3-8 8-10Z"/><path d="M63 26c5-1 10 2 9 6s-6 3-9 1-4-6 0-7Z"/></g>
<g transform="rotate(-20 54 55)" clip-path="url(#twd-splash-near)"><path d="M102 55A48 9.5 0 0 1 6 55" fill="none" stroke="#a9d6ff" stroke-width="1.6"/>
<circle r="3.4" fill="#cfe7ff"><animateMotion dur="3.2s" repeatCount="indefinite" path="${ORBIT}"/></circle></g>
<g class="twd-splash-plane" stroke-linejoin="round" stroke-width="1.6">
<path d="M27.5 57.6 77.6 38.6 38.6 62.6Z" fill="#fff" stroke="#fff"/>
<path d="M38.6 62.6 77.6 38.6 46.8 67 43 77.4Z" fill="#d6e7fa" stroke="#d6e7fa"/>
<path d="M43 77.4 46.8 67 52.4 71.2Z" fill="#b4d1f1" stroke="#b4d1f1"/>
<path d="M77.6 38.6 68.4 79.2 46.8 67Z" fill="#fff" stroke="#fff"/>
</g>
</svg>`;

function splashMarkup(theme) {
    const dark = theme !== 'light';
    const bg = dark ? '#212121' : '#ffffff';
    const text = dark ? '#aaaaaa' : '#707579';
    const track = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const style = `<style id="${SPLASH_ID}-style">
#${SPLASH_ID}{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:${bg};pointer-events:none;opacity:1;transition:opacity .35s ease;font-family:Roboto,-apple-system,"Segoe UI",sans-serif;}
#${SPLASH_ID}.twd-splash-out{opacity:0;}
#${SPLASH_ID} .twd-splash-logo{width:112px;height:112px;filter:drop-shadow(0 10px 28px rgba(36,129,229,.35));animation:twd-splash-in .5s cubic-bezier(.2,.9,.3,1.2) both;}
#${SPLASH_ID} .twd-splash-plane{animation:twd-splash-float 2.6s ease-in-out infinite;}
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
