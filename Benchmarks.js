export default class Benchmark {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        this.samples = [];
        this.duration = 10000; // 10 secondes de mesure
        this.running = false;

        this.ui = this.createUI();
    }

    createUI() {
        const div = document.createElement('div');
        div.style.cssText = `
            position: fixed; bottom: 16px; right: 16px;
            background: rgba(0,0,0,0.8); color: white;
            font-family: monospace; font-size: 12px;
            padding: 12px; border-radius: 8px;
            z-index: 999; min-width: 220px;
        `;
        div.innerHTML = `<button id="bench-start" style="
            width: 100%; padding: 6px; background: #4466ff;
            border: none; color: white; border-radius: 4px;
            cursor: pointer; margin-bottom: 8px;
        ">▶ Lancer le benchmark</button>
        <div id="bench-results"></div>`;
        document.body.appendChild(div);

        document.getElementById('bench-start').onclick = () => this.start();
        return div;
    }

    getDeviceInfo() {
        const gl = this.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'Inconnu',
            vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'Inconnu',
            userAgent: navigator.userAgent,
            screen: `${window.screen.width}x${window.screen.height}`,
            pixelRatio: window.devicePixelRatio,
            cores: navigator.hardwareConcurrency ?? '?',
            memory: navigator.deviceMemory ? `${navigator.deviceMemory} Go` : 'Inconnu',
            platform: navigator.platform,
        };
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.samples = [];

        const btn = document.getElementById('bench-start');
        const results = document.getElementById('bench-results');
        btn.disabled = true;
        btn.textContent = '⏳ Mesure en cours...';
        results.innerHTML = '';

        let last = performance.now();

        const measure = () => {
            if (!this.running) return;

            const now = performance.now();
            const delta = now - last;
            last = now;
            this.samples.push(1000 / delta); // FPS instantané

            const elapsed = this.samples.length > 0
                ? now - (now - this.samples.length * delta)
                : 0;

            const remaining = Math.max(0, Math.ceil((this.duration - elapsed) / 1000));
            btn.textContent = `⏳ ${remaining}s restantes...`;

            if (elapsed >= this.duration) {
                this.stop();
            } else {
                requestAnimationFrame(measure);
            }
        };

        // Laisser la scène se stabiliser avant de mesurer
        setTimeout(() => requestAnimationFrame(measure), 500);
        setTimeout(() => this.stop(), this.duration + 500);
    }

    stop() {
        this.running = false;

        const fps = this.samples;
        const avg = fps.reduce((a, b) => a + b, 0) / fps.length;
        const min = Math.min(...fps);
        const max = Math.max(...fps);
        const p1  = fps.slice().sort((a, b) => a - b)[Math.floor(fps.length * 0.01)]; // 1% low

        const info = this.getDeviceInfo();
        const score = Math.round(avg * 10); // Score simple

        const grade = avg >= 55 ? '🟢 Excellent'
            : avg >= 30 ? '🟡 Correct'
                : avg >= 15 ? '🟠 Limite'
                    : '🔴 Insuffisant';

        const results = document.getElementById('bench-results');
        results.innerHTML = `
            <div style="border-top: 1px solid #333; padding-top: 8px; margin-bottom: 6px;">
                <b>Score : ${score} — ${grade}</b>
            </div>
            <table style="width:100%; border-collapse: collapse;">
                ${this.row('FPS moyen', avg.toFixed(1))}
                ${this.row('FPS min', min.toFixed(1))}
                ${this.row('FPS max', max.toFixed(1))}
                ${this.row('1% low', p1?.toFixed(1) ?? '?')}
                ${this.row('GPU', info.gpu.substring(0, 30))}
                ${this.row('Mémoire', info.memory)}
                ${this.row('Cœurs CPU', info.cores)}
                ${this.row('Écran', info.screen)}
                ${this.row('Pixel ratio', info.pixelRatio)}
            </table>
            <button id="bench-copy" style="
                width: 100%; margin-top: 8px; padding: 5px;
                background: #333; border: none; color: white;
                border-radius: 4px; cursor: pointer;
            ">📋 Copier le rapport</button>
        `;

        document.getElementById('bench-start').disabled = false;
        document.getElementById('bench-start').textContent = '▶ Relancer';

        // Rapport texte pour partager
        const report = `
=== BENCHMARK THREE.JS ===
Score    : ${score}
Grade    : ${grade}
FPS moy  : ${avg.toFixed(1)}
FPS min  : ${min.toFixed(1)}
FPS max  : ${max.toFixed(1)}
1% low   : ${p1?.toFixed(1)}
GPU      : ${info.gpu}
Mémoire  : ${info.memory}
Cœurs    : ${info.cores}
Écran    : ${info.screen} @${info.pixelRatio}x
Platform : ${info.platform}
UA       : ${info.userAgent}
==========================`;

        document.getElementById('bench-copy').onclick = () => {
            navigator.clipboard.writeText(report);
        };

        console.log(report);
    }

    row(label, value) {
        return `<tr>
            <td style="opacity:0.6; padding: 2px 6px 2px 0">${label}</td>
            <td style="text-align:right">${value}</td>
        </tr>`;
    }
}

