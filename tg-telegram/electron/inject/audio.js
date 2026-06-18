(function(){
    function keepAudioAlive() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.00001;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            setInterval(() => {
                if (ctx.state === 'suspended') ctx.resume();
            }, 1000);
        } catch(e) {}
    }
    if (document.readyState === 'complete') keepAudioAlive();
    else window.addEventListener('load', keepAudioAlive);
})();