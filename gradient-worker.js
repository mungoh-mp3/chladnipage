const MODERATE_RANDOM_VIBRATION_INTENSITY = 3;
const MIN_NODE_THRESHOLD = 1e-2;

class ChladniParams {
    constructor (m, n, l) {
        this.m = m;
        this.n = n;
        this.l = l;
    }
}

class GradientWorker {

    constructor () {
        this.vibrationValues = null;
        this.gradients = null;
        this.width = 0;
        this.height = 0;

        this.currentParams = new ChladniParams(1, 2, 0.04);

        self.addEventListener("message", this.receiveUpdateFromMainThread.bind(this));
    }

    receiveUpdateFromMainThread(message) {
        this.width = message.data.width;
        this.height = message.data.height;

        if (message.data.chladniParams) {
            this.currentParams = new ChladniParams(
                message.data.chladniParams.m,
                message.data.chladniParams.n,
                message.data.chladniParams.l
            );
        }

        this.recalculateGradients(this.currentParams);

        self.postMessage({
            vibrationIntensity: MODERATE_RANDOM_VIBRATION_INTENSITY,
            vibrationValues: this.vibrationValues.buffer,
            gradients: this.gradients.buffer,
        }, [this.vibrationValues.buffer, this.gradients.buffer]);
    }

    computeVibrationValues(chladniParams) {
        const M = chladniParams.m;
        const N = chladniParams.n;
        const L = chladniParams.l;
        const R = 0;
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
        this.computeVibrationValues(chladniParams);
        this.computeGradients();
    }
}

new GradientWorker();
