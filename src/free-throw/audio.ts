/**
 * Tiny Web Audio synth for the mini-game — every sound is generated, no files.
 */
export type SoundName = "bounce" | "swish" | "rim" | "board" | "buzzer" | "shoot" | "record";

const MUTE_KEY = "freeThrow.muted";

export interface GameAudio {
    play(name: SoundName): void;
    /** Must be called from a user gesture so browsers allow audio. */
    unlock(): void;
    muted: boolean;
}

export function createAudio(): GameAudio {
    let ctx: AudioContext | null = null;
    let master: GainNode | null = null;
    let noise: AudioBuffer | null = null;
    let muted = false;
    try {
        muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
        /* storage blocked */
    }

    const ensure = (): AudioContext | null => {
        if (ctx) return ctx;
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return ctx;
    };

    const env = (c: AudioContext, peak: number, attack: number, decay: number, at = c.currentTime): GainNode => {
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
        g.connect(master as GainNode);
        return g;
    };

    const tone = (c: AudioContext, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, at = c.currentTime) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f1, at + attack + decay);
        o.connect(env(c, peak, attack, decay, at));
        o.start(at);
        o.stop(at + attack + decay + 0.05);
    };

    const hiss = (c: AudioContext, filter: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, at = c.currentTime) => {
        const s = c.createBufferSource();
        s.buffer = noise;
        const f = c.createBiquadFilter();
        f.type = filter;
        f.frequency.value = freq;
        f.Q.value = q;
        s.connect(f).connect(env(c, peak, attack, decay, at));
        s.start(at, Math.random() * 0.5);
        s.stop(at + attack + decay + 0.05);
    };

    const sounds: Record<SoundName, (c: AudioContext) => void> = {
        bounce: (c) => {
            tone(c, "sine", 150, 55, 0.9, 0.004, 0.16);
            hiss(c, "lowpass", 400, 1, 0.25, 0.002, 0.05);
        },
        swish: (c) => {
            hiss(c, "bandpass", 3800, 0.8, 0.45, 0.06, 0.28);
            hiss(c, "highpass", 6000, 0.5, 0.15, 0.03, 0.2, c.currentTime + 0.05);
        },
        rim: (c) => {
            for (const [f, p] of [[520, 0.35], [1185, 0.22], [1740, 0.14], [2630, 0.08]] as const) {
                tone(c, "triangle", f, f * 0.98, p, 0.002, 0.45);
            }
            hiss(c, "highpass", 2500, 1, 0.2, 0.001, 0.04);
        },
        board: (c) => {
            tone(c, "sine", 210, 120, 0.6, 0.003, 0.12);
            hiss(c, "bandpass", 900, 1.2, 0.4, 0.002, 0.08);
        },
        shoot: (c) => {
            hiss(c, "bandpass", 1200, 0.7, 0.12, 0.05, 0.18);
        },
        buzzer: (c) => {
            const lp = c.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value = 1400;
            const g = c.createGain();
            const t = c.currentTime;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
            g.gain.setValueAtTime(0.28, t + 0.75);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
            lp.connect(g).connect(master as GainNode);
            for (const f of [174, 177.5, 348]) {
                const o = c.createOscillator();
                o.type = "sawtooth";
                o.frequency.value = f;
                o.connect(lp);
                o.start(t);
                o.stop(t + 0.95);
            }
        },
        record: (c) => {
            [523, 659, 784, 1047].forEach((f, i) => tone(c, "square", f, f, 0.12, 0.01, 0.16, c.currentTime + i * 0.09));
        },
    };

    return {
        unlock() {
            const c = ensure();
            if (c && c.state === "suspended") void c.resume();
        },
        play(name) {
            if (muted) return;
            const c = ensure();
            if (!c || c.state !== "running") return;
            try {
                sounds[name](c);
            } catch (e) {
                console.warn("[free-throw] audio", e);
            }
        },
        get muted() {
            return muted;
        },
        set muted(v: boolean) {
            muted = v;
            try {
                localStorage.setItem(MUTE_KEY, v ? "1" : "0");
            } catch {
                /* storage blocked */
            }
        },
    };
}
