import * as Utils from "./utils.js";
import {Debouncer} from "./utils.js";

const NUM_PARTICLES = 30000;
const DEFAULT_RANDOM_VIBRATION_INTENSITY = 2;
const MAX_GRADIENT_INTENSITY = .4;
const DEBUG_VIBRATION_LEVELS = false;
const CANVAS_SCALE = 1.5;

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

        this.currentFrequency = 0.04;  // default frequency param L1 from your worker

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

        setInterval(this.checkForFallenParticles.bind(this), 10000);

        window.addEventListener("keypress", this.keypress.bind(this));

        // --- FREQUENCY SLIDER UI ---
        this.createFrequencySlider();
    }

    initStatus() {
        this.fpsElem = document.getElementById("fps");
        setInterval(() => {
            this.fpsElem.innerText = this.fpsCount.toString(); this.fpsCount = 0;
        }, 1000);
    }

    keypress(event) {
        switch (event.key) {
            case "d": this.debugVibration = !this.debugVibration; break;
            case " ": this.isRunning = !this.isRunning; break;
        }
    }

    resize() {
        this.width = Math.ceil(window.innerWidth / CANVAS_SCALE);
        this.height = Math.ceil(window.innerHeight / CANVAS_SCALE);
        this.canvas.setAttribute("width", this.width);
        this.canvas.setAttribute("height", this.height);

        this.worker.postMessage({
            width: this.width,
            height: this.height,
            frequency: this.currentFrequency  // send current frequency on resize too
        });

        this.imageData = this.context.getImageData(0, 0, this.width, this.height);
        this.buffer = new Uint32Array(this.imageData.data.buffer);
        console.info(`New buffer created (${this.width}x${this.height})`);

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

    checkForFallenParticles() {
        const SLACK = 100;  // allow particles to really leave the screen before replacing them

        for (let i = 0; i < this.particles.length; i += 2) {
            let x = this.particles[i];
            let y = this.particles[i + 1];

            const didFall = x < -SLACK || x >= this.width + SLACK || y < -SLACK || y >= this.height + SLACK;

            if (didFall) {
                this.particles[i] = Math.random() * this.width;
                this.particles[i + 1] = Math.random() * this.height;
            }
        }
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

    createFrequencySlider() {
        const sliderContainer = document.createElement('div');
        Object.assign(sliderContainer.style, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'white',
            fontFamily: 'monospace',
            fontSize: '16px',
            zIndex: 1000,
            backgroundColor: 'rgba(0,0,0,0.4)',
            padding: '8px 12px',
            borderRadius: '6px',
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        });

        const freqLabel = document.createElement('span');
        freqLabel.textContent = `Frequency: ${this.currentFrequency.toFixed(4)}`;

        const freqSlider = document.createElement('input');
        freqSlider.type = 'range';
        freqSlider.min = 0.005;
        freqSlider.max = 0.05;
        freqSlider.step = 0.0005;
        freqSlider.value = this.currentFrequency;
        freqSlider.style.cursor = 'pointer';

        freqSlider.addEventListener('input', () => {
            this.currentFrequency = parseFloat(freqSlider.value);
            freqLabel.textContent = `Frequency: ${this.currentFrequency.toFixed(4)}`;

            // Send new frequency to worker with current dimensions
            this.worker.postMessage({
                width: this.width,
                height: this.height,
                frequency: this.currentFrequency
            });
        });

        sliderContainer.appendChild(freqLabel);
        sliderContainer.appendChild(freqSlider);
        document.body.appendChild(sliderContainer);
    }
}

new ChladniApp();
