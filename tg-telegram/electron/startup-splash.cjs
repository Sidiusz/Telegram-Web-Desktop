'use strict';
const fs = require('fs');
const path = require('path');

// Startup splash drawn into Telegram's own HTML, so it is on screen from the very first paint.
// It never blocks the page: pointer-events are off, it fades out as soon as Telegram shows the
// login form, the chat list or a passcode prompt, and it is removed after 15 s whatever happens.
const SPLASH_ID = 'twd-splash';
const MAX_SPLASH_MS = 15000;
const MAIN_SETTLE_MS = 4000;

// The splash shows the app icon (electron/icons/icon.svg) at its natural size with the
// satellite from the original artwork orbiting it; the app icon itself has no orbit.
// The far half of the orbit passes behind the planet, the near half in front of it but under the plane.
const ORBIT = { cx: 54.4, cy: 53.3, rx: 47.3, ry: 11.5, tilt: -19.2, sat: 2.6, period: '3.6s' };
function orbitLayer(near) {
    const { cx, cy, rx, ry, tilt, sat, period } = ORBIT;
    const arc = near ? `M${rx} 0A${rx} ${ry} 0 0 1 ${-rx} 0` : `M${-rx} 0A${rx} ${ry} 0 0 1 ${rx} 0`;
    const loop = `M${rx} 0A${rx} ${ry} 0 1 1 ${-rx} 0A${rx} ${ry} 0 1 1 ${rx} 0Z`;
    return `<g transform="translate(${cx} ${cy}) rotate(${tilt})"${near ? ' clip-path="url(#twd-splash-near)"' : ''}>` +
        `<path d="${arc}" fill="none" stroke="#7cbefc" stroke-width="1.05"/>` +
        `<circle r="${sat}" fill="#8cc8fd"><animateMotion dur="${period}" repeatCount="indefinite" path="${loop}"/></circle></g>`;
}
function splashLogo(iconSvg) {
    const plane = iconSvg.indexOf('<g class="twd-icon-plane">');
    const scaled = /<g transform="translate\(54 54\) scale\([\d.]+\) translate\([-\d. ]+\)">/.exec(iconSvg);
    const open = /<svg\b[^>]*>/;
    if (plane < 0 || !scaled) return iconSvg.replace(open, '<svg class="twd-splash-logo" viewBox="0 0 108 108" aria-hidden="true">').trim();
    const body = iconSvg.slice(0, scaled.index) + '<g>' + orbitLayer(false) +
        iconSvg.slice(scaled.index + scaled[0].length, plane) + orbitLayer(true) + iconSvg.slice(plane);
    return body
        .replace('<defs>', '<defs><clipPath id="twd-splash-near"><rect x="-60" y="0" width="120" height="30"/></clipPath>')
        .replace(open, '<svg class="twd-splash-logo" viewBox="4 3 100 100" aria-hidden="true">')
        .trim();
}
const LOGO_SVG = splashLogo(fs.readFileSync(path.join(__dirname, 'icons', 'icon.svg'), 'utf8'));

function splashMarkup(theme) {
    const dark = theme !== 'light';
    const bg = dark ? '#212121' : '#ffffff';
    const text = dark ? '#aaaaaa' : '#707579';
    const track = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const style = `<style id="${SPLASH_ID}-style">
#${SPLASH_ID}{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:${bg};pointer-events:none;opacity:1;transition:opacity .35s ease;font-family:Roboto,-apple-system,"Segoe UI",sans-serif;}
#${SPLASH_ID}.twd-splash-out{opacity:0;}
#${SPLASH_ID} .twd-splash-logo{width:156px;height:156px;filter:drop-shadow(0 8px 24px rgba(56,140,232,.32));animation:twd-splash-in .5s cubic-bezier(.2,.9,.3,1.2) both;}
#${SPLASH_ID} .twd-icon-plane{animation:twd-splash-float 2.6s ease-in-out infinite;}
#${SPLASH_ID} .twd-splash-name{margin-top:6px;font-size:15px;letter-spacing:.2px;color:${text};animation:twd-splash-fade .6s .15s ease both;}
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

module.exports = { injectStartupSplash, splashMarkup, splashLogo, MAX_SPLASH_MS };
