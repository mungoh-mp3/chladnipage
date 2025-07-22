import * as Utils from "./utils.js";
import {Debouncer} from "./utils.js";

const NUM_PARTICLES = 30000;
const DEFAULT_RANDOM_VIBRATION_INTENSITY = 2;
const MAX_GRADIENT_INTENSITY = 0.4;
const DEBUG_VIBRATION_LEVELS = false;
const CANVAS_SCALE = 1.5;

// Predefined Chladni Params must match worker's CHLADNI_PARAMS order
const CHLADNI_PARAMS = [
    {m: 1, n: 2, l: 0.04},
    {m: 1, n: 3, l: 0.018},
    {m: 1, n: 4, l: 0.02},
    {m: 1, n: 5, l: 0.02},
    {m: 2, n: 3, l: 0.02},
    {m: 2, n: 5, l: 0.02},
    {m: 3, n: 4, l: 0.02},
    {m: 3, n: 5, l: 0.02},
    {m: 3, n: 7, l: 0.02},
];

class ChladniApp {
    constructor () {
        this.canvas = document.createElement("canvas");
        this.canvas.classList.add("pixelated");
        this.context = this.canvas.getContext("2d");
        document.body.appendChild(this.canvas);

        /** @type {ImageData} */
        this.imageData = null;

        /** @type {Uint32Array} */
        this.buffer = null;
        /** @type {Float32Array} */
        this.vibrationValues = null;
        /** @type {Float32Array} */
        this.gradients = null;

        this.vibrationIntensity = DEFAULT_RANDOM_VIBRATION_INTENSITY;
        this.halfVibrationIntensity = this.vibrationIntensity / 2;

        this.debugVibration = DEBUG_VIBRATION_LEVELS;
        this.isRunning = true;

        this.width = window.innerWidth / CANVAS_SCALE;
        this.height = window.innerHeight / CANVAS_SCALE;

        const debounceTimer = new Debouncer();

        this.particles = new Float32Array(NUM_PARTICLES * 2);

        this.nonResonantColor = Utils.cssColorToColor(Utils.readCssVarAsHexNumber("non-resonant-color"));
        this.colorIndex = 0;
        this.colors = [];
        let cssColorIndex = 1;
        let cssColor;
        while (cssColor = Utils.readCssVarAsHexNumber("particle-color-" + cssColorIndex)) {
            this.colors.push(Utils.cssColorToColor(cssColor));
            cssColorIndex++;
        }
        this.selectedColor = this.colors[this.colorIndex];

        this.backgroundColor = Utils.cssColorToColor(Utils.readCssVarAsHexNumber("background-color"));

        this.fpsCount = 0;
        this.initStatus();

        this.worker = new Worker("gradient-worker.js");
        this.worker.addEventListener("message", this.onMessageFromWorker.bind(this));

        window.addEventListener("resize", () => debounceTimer.set(this.resize.bind(this), 350));
        this.resize();

        this.updateFn = this.update.bind(this);
        this.update(performance.now());

        // Remove periodic scrambling of particles: no more interval for checkForFallenParticles
        // setInterval(this.checkForFallenParticles.bind(this), 10000);

        window.addEventListener("keypress", this.keypress.bind(this));

        // Create frequency slider
        this.freqSlider = document.createElement("input");
        this.freqSlider.type = "range";
        this.freqSlider.min = 0;
        this.freqSlider.max = CHLADNI_PARAMS.length - 1; // max index
        this.freqSlider.step = 1;
        this.freqSlider.value = 0;
        this.freqSlider.style.position = "fixed";
        this.freqSlider.style.bottom = "20px";
        this.freqSlider.style.left = "50%";
        this.freqSlider.style.transform = "translateX(-50%)";
        this.freqSlider.style.width = "300px";
        this.freqSlider.style.zIndex = "1000";
        document.body.appendChild(this.freqSlider);

        // Send initial params to worker
        this.sendParamsToWorker(0);

        // Update worker on slider input
        this.freqSlider.addEventListener("input", (e) => {
            const index = parseInt(e.target.value);
            this.sendParamsToWorker(index);
        });
    }

    initStatus() {
        this.fpsElem = document.getElementById("fps");
        setInterval(() => {
            this.fpsElem.innerText = this.fpsCount.toString();
            this.fpsCount = 0;
        }, 1000);
    }

    keypress(event) {
        switch (event.key) {
            case "d":
                this.debugVibration = !this.debugVibration;
                break;
            case " ":
                this.isRunning = !this.isRunning;
                break;
        }
    }

    resize() {
        this.width = Math.ceil(window.innerWidth / CANVAS_SCALE);
        this.height = Math.ceil(window.innerHeight / CANVAS_SCALE);
        this.canvas.setAttribute("width", this.width);
        this.canvas.setAttribute("height", this.height);

        // Re-send current frequency params to worker on resize to recalc
        const currentIndex = parseInt(this.freqSlider.value);
        this.sendParamsToWorker(currentIndex);

        this.imageData = this.context.getImageData(0, 0, this.width, this.height);
        this.buffer = new Uint32Array(this.imageData.data.buffer);

        for (let i = 0; i < this.particles.length; i += 2) {
            this.particles[i] = Math.random() * this.width;
            this.particles[i + 1] = Math.random() * this.height;
        }
    }

    onMessageFromWorker(message) {
        this.vibrationIntensity = message.data.vibrationIntensity;
        this.halfVibrationIntensity = this.vibrationIntensity / 2;
        this.vibrationValues = message.data.vibrationValues ? new Float32Array(message.data.vibrationValues) : null;
        this.gradients = message.data.gradients ? new Float32Array(message.data.gradients) : null;
        if (this.gradients) {
            this.colorIndex = (this.colorIndex + 1) % this.colors.length;
            this.selectedColor = this.colors[this.colorIndex];
        }
    }

    // No more particle scrambling — so this can be removed or left unused
    checkForFallenParticles() {
        // Intentionally empty or remove method
    }

    obtainGradientAt(x, y) {
        x = Math.round(x);
        y = Math.round(y);
        const index = (y * this.width + x) * 2;
        return [
            this.gradients[index],
            this.gradients[index + 1]
        ];
    }

    update() {
        if (!this.isRunning) {
            this.fpsCount++;
            requestAnimationFrame(this.updateFn);
            return;
        }

        if (this.debugVibration && this.vibrationValues) {
            const MAX_LUMINOSITY = 64;
            for (let i = 0; i < this.vibrationValues.length; i++) {
                const intensity = this.vibrationValues[i] * MAX_LUMINOSITY;
                this.buffer[i] = Utils.rgbToVal(intensity, intensity, intensity);
            }
        } else {
            this.buffer.fill(this.backgroundColor);
        }

        const color = this.gradients ? this.selectedColor : this.nonResonantColor;

        for (let i = 0; i < this.particles.length; i += 2) {
            let x = this.particles[i];
            let y = this.particles[i + 1];

            if (this.gradients) {
                const [gradX, gradY] = this.obtainGradientAt(x, y);

                x += MAX_GRADIENT_INTENSITY * gradX;
                y += MAX_GRADIENT_INTENSITY * gradY;
            }

            x += Math.random() * this.vibrationIntensity - this.halfVibrationIntensity;
            y += Math.random() * this.vibrationIntensity - this.halfVibrationIntensity;

            this.particles[i] = x;
            this.particles[i + 1] = y;

            this.buffer[Math.round(y) * this.width + Math.round(x)] = color;
        }

        this.context.putImageData(this.imageData, 0, 0);

        this.fpsCount++;
        requestAnimationFrame(this.updateFn);
    }

    sendParamsToWorker(index) {
        const params = CHLADNI_PARAMS[index];
        this.worker.postMessage({
            width: this.width,
            height: this.height,
            chladniParams: { m: params.m, n: params.n, l: params.l }
        });
    }
}

new ChladniApp();
