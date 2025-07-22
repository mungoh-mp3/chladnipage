const MODERATE_RANDOM_VIBRATION_INTENSITY = 3;
const AGGRESSIVE_RANDOM_VIBRATION_INTENSITY = MODERATE_RANDOM_VIBRATION_INTENSITY * 1.5;
const MIN_NODE_THRESHOLD = 1e-2;
const GRADIENT_RENEWAL_PERIOD_IN_MS = 2200;

const L1 = 0.04;
const L2 = 0.02;
const L3 = 0.018;

class ChladniParams {
    constructor (m, n, l) {
        this.m = m;
        this.n = n;
        this.l = l;
    }
}

const CHLADNI_PARAMS = [
    new ChladniParams(1, 2, L1),
    new ChladniParams(1, 3, L3),
    new ChladniParams(1, 4, L2),
    new ChladniParams(1, 5, L2),
    new ChladniParams(2, 3, L2),
    new ChladniParams(2, 5, L2),
    new ChladniParams(3, 4, L2),
    new ChladniParams(3, 5, L2),
    new ChladniParams(3, 7, L2),
];

class GradientWorker {

    constructor () {
        this.vibrationValues = null;
        this.gradients = null;
        this.width = null;
        this.height = null;
        this.gradientParametersIndex = 0;
        this.bakingTimer = null;
        this.isResonantRound = true;

        // Track frequency param, default to L1
        this.currentFrequency = L1;

        self.addEventListener("message", this.receiveUpdateFromMainThread.bind(this));
    }

    receiveUpdateFromMainThread(message) {
        // Update width and height if provided
        if (message.data.width !== undefined) this.width = message.data.width;
        if (message.data.height !== undefined) this.height = message.data.height;

        // Update frequency if provided
        if (message.data.frequency !== undefined) {
            this.currentFrequency = message.data.frequency;
            console.info(`Frequency updated to ${this.currentFrequency}`);
        }

        if (this.bakingTimer) {
            clearInterval(this.bakingTimer);
        }

        this.isResonantRound = true;
        this.bakeNextGradients();
        this.bakingTimer = setInterval(this.bakeNextGradients.bind(this), GRADIENT_RENEWAL_PERIOD_IN_MS);
    }

    /**
     * @param {ChladniParams} chladniParams
     */
    computeVibrationValues(chladniParams) {
        const M = chladniParams.m;
        const N = chladniParams.n;
        const L = chladniParams.l;
        const R = 0;  // Math.random() * TAU;  // turn this on to introduce some asymmetry
        const TX = Math.random() * this.height;
        const TY = Math.random() * this.height;

        this.vibrationValues = new Float32Array(this.width * this.height);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const scaledX = x * L + TX;
                const scaledY = y * L + TY;
                const MX = M * scaledX + R;
                const NX = N * scaledX + R;
                const MY = M * scaledY + R;
                const NY = N * scaledY + R;

                let value = Math.cos(NX) * Math.cos(MY) - Math.cos(MX) * Math.cos(NY);

                value /= 2;

                value *= Math.sign(value);

                const index = y * this.width + x;
                this.vibrationValues[index] = value;
            }
        }
    }

    computeGradients() {
        this.gradients = new Float32Array(this.width * this.height * 2);
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                const myIndex = y * this.width + x;
                const gradientIndex = myIndex << 1;
                const myVibration = this.vibrationValues[myIndex];

                if (myVibration < MIN_NODE_THRESHOLD) {
                    this.gradients[gradientIndex] = 0;
                    this.gradients[gradientIndex + 1] = 0;
                    continue;
                }

                let candidateGradients = [];
                candidateGradients.push([0, 0]);

                let minVibrationSoFar = Number.POSITIVE_INFINITY;
                for (let ny = -1; ny <= 1; ny++) {
                    for (let nx = -1; nx <= 1; nx++) {
                        if (nx === 0 && ny === 0) continue;

                        const ni = (y + ny) * this.width + (x + nx);
                        const nv = this.vibrationValues[ni];

                        if (nv <= minVibrationSoFar) {
                            if (nv < minVibrationSoFar) {
                                minVibrationSoFar = nv;
                                candidateGradients = [];
                            }
                            candidateGradients.push([nx, ny]);
                        }
                    }
                }

                const chosenGradient = candidateGradients.length === 1
                    ? candidateGradients[0]
                    : candidateGradients[Math.floor(Math.random() * candidateGradients.length)];

                this.gradients[gradientIndex] = chosenGradient[0];
                this.gradients[gradientIndex + 1] = chosenGradient[1];
            }
        }
    }

    recalculateGradients(chladniParams) {
        let start = performance.now();
        this.computeVibrationValues(chladniParams);
        let elapsedVibration = performance.now() - start;

        let elapsedGradients = performance.now();
        this.computeGradients();
        let end = performance.now();
        elapsedGradients = end - elapsedGradients;
        const elapsedTotal = end - start;

        console.info(`Baking took ${elapsedTotal.toFixed(0)}ms (${elapsedVibration.toFixed(0)}ms vibration + ${elapsedGradients.toFixed(0)}ms gradients)`);
    }

    bakeNextGradients() {
        if (this.isResonantRound) {
            console.info("Baking gradients...");

            // Use current frequency in the current ChladniParams before baking
            const chladniParams = CHLADNI_PARAMS[this.gradientParametersIndex];
            chladniParams.l = this.currentFrequency;

            this.recalculateGradients(chladniParams);

            this.gradientParametersIndex = (this.gradientParametersIndex + 1) % CHLADNI_PARAMS.length;

            self.postMessage({
                vibrationIntensity: MODERATE_RANDOM_VIBRATION_INTENSITY,
                vibrationValues: this.vibrationValues.buffer,
                gradients: this.gradients.buffer,
            }, [this.vibrationValues.buffer, this.gradients.buffer]);
        } else {
            self.postMessage({
                vibrationIntensity: AGGRESSIVE_RANDOM_VIBRATION_INTENSITY,
                vibrationValues: null,
                gradients: null,
            });
        }

        this.isResonantRound = !this.isResonantRound;
    }
}

new GradientWorker();
