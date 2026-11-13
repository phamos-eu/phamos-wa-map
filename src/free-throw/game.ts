/// <reference types="vite/client" />

import { createAudio, SoundName } from "./audio";
import { connectScores, ScoreStore } from "./scores";
import type { LeaderEntry } from "./shared";

// ---------------------------------------------------------------------------
// Scene geometry (logical canvas units; the canvas is scaled to fit)
// ---------------------------------------------------------------------------
const W = 480;
const H = 300;
const FLOOR = 268;
const BALL_R = 11;
const REST_Y = FLOOR - BALL_R;
const RIM = { cx: 371, y: 128, rx: 25, ry: 6 };
const NET = { top: RIM.y, height: 42, bottomHalf: 13 };
const BOARD = { x: 400, top: 52, bottom: 146 };
const SHOOTER_X = 82;
const START = { x: 100, y: 182 };

type Pt = { x: number; y: number };
type Phase = "intro" | "aim" | "flight" | "over";
type Outcome = "swish" | "rim-in" | "bank" | "rim-out" | "board-out" | "airball";

interface Segment {
    to: Pt;
    /** How far the bezier control point sits above the higher end point (0 = straight line). */
    lift: number;
    dur: number;
    /** Sound played when the segment starts (i.e. at the contact that begins it). */
    sound?: SoundName;
    /** Ball drops through the net during this segment — counts the make. */
    net?: boolean;
    /** Accelerate (gravity) instead of constant speed — used for straight drops. */
    fall?: boolean;
}

const OUTCOMES: Record<Outcome, { made: boolean; label: string; color: string }> = {
    swish: { made: true, label: "SWISH!", color: "#3ddc6b" },
    "rim-in": { made: true, label: "RIM IN!", color: "#ffd23f" },
    bank: { made: true, label: "BANK!", color: "#ffd23f" },
    "rim-out": { made: false, label: "CLANK!", color: "#ff4d5e" },
    "board-out": { made: false, label: "BRICK!", color: "#ff4d5e" },
    airball: { made: false, label: "AIRBALL!", color: "#ff4d5e" },
};

/** Keyframed ball path for every outcome. Each segment is a parabola-like quadratic bezier. */
function pathFor(outcome: Outcome): Segment[] {
    const throughNet: Segment[] = [
        { to: { x: RIM.cx, y: RIM.y + NET.height + 14 }, lift: 0, dur: 240, net: true, fall: true },
        { to: { x: RIM.cx - 2, y: REST_Y }, lift: 0, dur: 190, fall: true },
        { to: { x: RIM.cx - 26, y: REST_Y }, lift: 36, dur: 420, sound: "bounce" },
        { to: { x: RIM.cx - 40, y: REST_Y }, lift: 13, dur: 270, sound: "bounce" },
        { to: { x: RIM.cx - 47, y: REST_Y }, lift: 4, dur: 150, sound: "bounce" },
    ];
    const rollAway = (x: number): Segment[] => [
        { to: { x: x - 24, y: REST_Y }, lift: 30, dur: 400, sound: "bounce" },
        { to: { x: x - 36, y: REST_Y }, lift: 11, dur: 250, sound: "bounce" },
        { to: { x: x - 41, y: REST_Y }, lift: 3, dur: 140, sound: "bounce" },
    ];
    switch (outcome) {
        case "swish":
            return [{ to: { x: RIM.cx, y: RIM.y - 6 }, lift: 150, dur: 900, sound: "swish" }, ...throughNet];
        case "rim-in":
            return [
                { to: { x: RIM.cx - 22, y: RIM.y - 15 }, lift: 140, dur: 870 },
                { to: { x: RIM.cx + 10, y: RIM.y - 26 }, lift: 26, dur: 330, sound: "rim" },
                { to: { x: RIM.cx, y: RIM.y - 6 }, lift: 6, dur: 210, sound: "swish" },
                ...throughNet,
            ];
        case "bank":
            return [
                { to: { x: BOARD.x - BALL_R - 1, y: RIM.y - 32 }, lift: 160, dur: 920 },
                { to: { x: RIM.cx, y: RIM.y - 6 }, lift: 4, dur: 260, sound: "board" },
                ...throughNet.map((s, i) => (i === 0 ? { ...s, sound: "swish" as SoundName } : s)),
            ];
        case "rim-out":
            return [
                { to: { x: RIM.cx - 24, y: RIM.y - 14 }, lift: 132, dur: 860 },
                { to: { x: 296, y: REST_Y }, lift: 48, dur: 560, sound: "rim" },
                ...rollAway(296),
            ];
        case "board-out":
            return [
                { to: { x: BOARD.x - BALL_R - 1, y: RIM.y - 20 }, lift: 165, dur: 920 },
                { to: { x: RIM.cx + 20, y: RIM.y - 14 }, lift: 4, dur: 120, sound: "board" },
                { to: { x: 318, y: REST_Y }, lift: 70, dur: 640, sound: "rim" },
                ...rollAway(318),
            ];
        case "airball":
            return [{ to: { x: 312, y: REST_Y }, lift: 120, dur: 960 }, ...rollAway(312)];
    }
}

/** Meter tuning for a given streak: faster needle, narrower zones, capped for fairness. */
function difficulty(streak: number) {
    return {
        speed: Math.min(0.75 + streak * 0.07, 2.0), // track widths per second
        swishHalf: Math.max(0.075 - streak * 0.0035, 0.032),
        rimWidth: Math.max(0.06 - streak * 0.002, 0.035),
    };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} missing`);
    return el as T;
};
const canvas = $<HTMLCanvasElement>("court");
const ctxOrNull = canvas.getContext("2d");
if (!ctxOrNull) throw new Error("Canvas 2D not supported");
const ctx: CanvasRenderingContext2D = ctxOrNull;
const ui = {
    stage: $("stage"),
    meter: $("meter"),
    needle: $("needle"),
    zoneRim: $("zone-rim"),
    zoneSwish: $("zone-swish"),
    streak: $("streak"),
    best: $("best"),
    record: $("record"),
    chip: $("mode-chip"),
    mute: $<HTMLButtonElement>("mute"),
    close: $<HTMLButtonElement>("close"),
    intro: $("intro"),
    start: $<HTMLButtonElement>("start"),
    over: $("gameover"),
    again: $<HTMLButtonElement>("again"),
    finalStreak: $("final-streak"),
    badgeBest: $("badge-best"),
    badgeRecord: $("badge-record"),
    overDetail: $("over-detail"),
    hint: $("hint"),
    live: $("live"),
    lbList: $("lb-list"),
    lbEmpty: $("lb-empty"),
    lbAdmin: $("lb-admin"),
    lbReset: $<HTMLButtonElement>("lb-reset"),
    lbConfirm: $("lb-confirm"),
    lbCancel: $<HTMLButtonElement>("lb-cancel"),
    lbConfirmYes: $<HTMLButtonElement>("lb-confirm-yes"),
    lbStatus: $("lb-status"),
};

const params = new URLSearchParams(location.search);
const mirrored = params.get("side") === "left"; // left hoop on the map → hoop on the left of the screen
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const audio = createAudio();

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let scores: ScoreStore | null = null;
let phase: Phase = "intro";
let streak = 0;
let runNewBest = false;
let runNewRecord = false;
let overSince = 0;

let meterPos = 0;
let meterDir = 1;
let target = 0.5;
let tuning = difficulty(0);

let ball: Pt = { ...START };
let ballScale = 1;
let ballSpin = 0;
let spinRate = 0;
let path: Segment[] = [];
let segIndex = 0;
let segT = 0;
let segFrom: Pt = { ...START };
let outcome: Outcome | null = null;
let followThrough = 0;

let netEnergy = 0;
let netClock = 0;
let shake = 0;
interface Popup { text: string; color: string; x: number; y: number; age: number }
let popups: Popup[] = [];

// ---------------------------------------------------------------------------
// HUD helpers
// ---------------------------------------------------------------------------
function bump(el: HTMLElement) {
    el.classList.remove("bump");
    void el.offsetWidth; // restart animation
    el.classList.add("bump");
}

function renderRecord(record: LeaderEntry | null) {
    if (!record) {
        ui.record.textContent = "—";
        ui.record.title = "No record yet";
        return;
    }
    ui.record.textContent = "";
    ui.record.append(String(record.streak), " ");
    const who = document.createElement("small");
    who.textContent = record.name; // textContent: names come from other players
    ui.record.append(who);
    ui.record.title = `${record.name} — ${record.streak}`;
}

let shownBoard = "";

function renderBoard() {
    const entries = scores?.leaderboard() ?? [];
    // Skip DOM churn when nothing changed (renderHud runs after every make).
    const key = JSON.stringify(entries.map((e) => [e.id, e.streak, e.name]));
    if (key === shownBoard) return;
    const previous = new Map<string, number>(
        shownBoard ? (JSON.parse(shownBoard) as [string, number, string][]).map(([id, n]) => [id, n]) : [],
    );
    shownBoard = key;

    ui.lbList.replaceChildren(
        ...entries.map((e, i) => {
            const li = document.createElement("li");
            if (e.id === scores?.playerId) li.classList.add("me");
            if (previous.size && previous.get(e.id) !== e.streak) li.classList.add("fresh");
            const rank = document.createElement("span");
            rank.className = "rank";
            rank.textContent = String(i + 1);
            const name = document.createElement("span");
            name.className = "name";
            name.textContent = e.name; // textContent: names come from other players
            name.title = e.name;
            const pts = document.createElement("span");
            pts.className = "pts";
            pts.textContent = String(e.streak);
            li.append(rank, name, pts);
            return li;
        }),
    );
    ui.lbEmpty.hidden = entries.length > 0;
}

function renderHud() {
    ui.streak.textContent = String(streak);
    ui.best.textContent = String(scores?.best() ?? 0);
    renderRecord(scores?.record() ?? null);
    renderBoard();
}

function setBoardStatus(text: string, kind: "" | "ok" | "error" = "") {
    ui.lbStatus.textContent = text;
    ui.lbStatus.className = `lb-status ${kind}`.trim();
}

function showResetConfirm(open: boolean) {
    ui.lbConfirm.hidden = !open;
    ui.lbReset.hidden = open;
    (open ? ui.lbCancel : ui.lbReset).focus({ preventScroll: true });
}

async function resetScores() {
    if (!scores?.canReset) return;
    ui.lbConfirmYes.disabled = true;
    setBoardStatus("Resetting…");
    try {
        await scores.reset();
        runNewBest = false;
        runNewRecord = false;
        renderHud();
        setBoardStatus("Scores reset. New season started.", "ok");
    } catch (e) {
        console.warn("[free-throw] reset failed", e);
        setBoardStatus("Reset failed — your account needs the \"admin\" tag.", "error");
    } finally {
        ui.lbConfirmYes.disabled = false;
        showResetConfirm(false);
    }
}

function placeZones() {
    const outer = tuning.swishHalf + tuning.rimWidth;
    ui.zoneRim.style.left = `${(target - outer) * 100}%`;
    ui.zoneRim.style.width = `${outer * 200}%`;
    ui.zoneSwish.style.left = `${(target - tuning.swishHalf) * 100}%`;
    ui.zoneSwish.style.width = `${tuning.swishHalf * 200}%`;
}

function announce(text: string) {
    ui.live.textContent = text;
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
function newShot() {
    tuning = difficulty(streak);
    const outer = tuning.swishHalf + tuning.rimWidth;
    // Move the target around a bit so muscle memory alone isn't enough.
    const lo = Math.max(0.3, outer + 0.04);
    const hi = Math.min(0.7, 1 - outer - 0.04);
    target = streak === 0 ? 0.5 : lo + Math.random() * (hi - lo);
    meterPos = Math.random() < 0.5 ? 0.02 : 0.98;
    meterDir = meterPos < 0.5 ? 1 : -1;
    placeZones();
    ball = { ...START };
    ballScale = 0;
    ballSpin = 0;
    outcome = null;
    followThrough = 0;
    ui.needle.classList.remove("frozen");
    phase = "aim";
    ui.hint.innerHTML = 'Press <span class="kbd">Space</span> or tap to shoot';
}

function startRun() {
    audio.unlock();
    streak = 0;
    runNewBest = false;
    runNewRecord = false;
    ui.intro.hidden = true;
    ui.over.hidden = true;
    renderHud();
    newShot();
    ui.stage.focus({ preventScroll: true });
}

function grade(pos: number): Outcome {
    const d = pos - target;
    const a = Math.abs(d);
    if (a <= tuning.swishHalf) return "swish";
    if (a <= tuning.swishHalf + tuning.rimWidth) return d < 0 ? "rim-in" : "bank";
    if (a <= tuning.swishHalf + tuning.rimWidth + 0.14) return d < 0 ? "rim-out" : "board-out";
    return d < 0 ? "airball" : "board-out";
}

function shoot() {
    if (phase !== "aim" || ballScale < 1) return;
    outcome = grade(meterPos);
    path = pathFor(outcome);
    segIndex = 0;
    segT = 0;
    segFrom = { ...ball };
    spinRate = -(6 + Math.random() * 3);
    followThrough = 1;
    phase = "flight";
    ui.needle.classList.add("frozen");
    ui.hint.textContent = "";
    audio.play("shoot");
}

function onMake() {
    streak += 1;
    bump(ui.streak);
    const res = scores?.report(streak) ?? { newBest: false, newRecord: false };
    if (res.newBest) {
        runNewBest = true;
        bump(ui.best);
    }
    if (res.newRecord && !runNewRecord) {
        runNewRecord = true;
        popups.push({ text: "COURT RECORD!", color: "#3ee6ff", x: W / 2, y: 70, age: -0.35 });
        setTimeout(() => audio.play("record"), 350);
    }
    if (res.newRecord) bump(ui.record);
    renderHud();
    announce(`${OUTCOMES[outcome ?? "swish"].label} Streak ${streak}`);
}

function onPathEnd() {
    if (outcome && OUTCOMES[outcome].made) {
        newShot();
    } else {
        gameOver();
    }
}

function gameOver() {
    phase = "over";
    overSince = performance.now();
    audio.play("buzzer");
    ui.finalStreak.textContent = String(streak);
    ui.badgeBest.hidden = !runNewBest;
    ui.badgeRecord.hidden = !runNewRecord;
    const rec = scores?.record();
    ui.overDetail.textContent = `Your best: ${scores?.best() ?? 0}` + (rec ? ` · Court record: ${rec.streak} by ${rec.name}` : "");
    ui.over.hidden = false;
    ui.again.focus({ preventScroll: true });
    announce(`Game over. Streak ${streak}.`);
}

/** Space / click / tap — context-sensitive primary action. */
function primaryAction() {
    audio.unlock();
    if (phase === "intro") startRun();
    else if (phase === "aim") shoot();
    else if (phase === "over" && performance.now() - overSince > 450) startRun();
}

function closeGame() {
    if (scores?.requestClose()) return;
    // Standalone: nothing to close, go back to the title screen.
    phase = "intro";
    ui.over.hidden = true;
    ui.intro.hidden = false;
    ui.start.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function bezier(a: Pt, b: Pt, lift: number, t: number): Pt {
    const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift };
    const u = 1 - t;
    return {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
}

function update(dt: number) {
    netClock += dt;
    netEnergy *= Math.exp(-dt * 2.6);
    shake *= Math.exp(-dt * 12);
    followThrough = Math.max(0, followThrough - dt * 1.4);
    popups = popups.filter((p) => (p.age += dt) < 1.1);

    if (phase === "aim") {
        ballScale = Math.min(1, ballScale + dt * 5);
        meterPos += meterDir * tuning.speed * dt;
        if (meterPos >= 1) {
            meterPos = 2 - meterPos;
            meterDir = -1;
        } else if (meterPos <= 0) {
            meterPos = -meterPos;
            meterDir = 1;
        }
    }
    ui.needle.style.left = `${meterPos * 100}%`;

    if (phase === "flight" || (phase === "over" && segIndex < path.length)) {
        let remaining = dt * 1000;
        while (remaining > 0 && segIndex < path.length) {
            const seg = path[segIndex];
            const left = (1 - segT) * seg.dur;
            if (remaining < left) {
                segT += remaining / seg.dur;
                remaining = 0;
            } else {
                remaining -= left;
                segT = 1;
            }
            const t = seg.fall ? segT * segT : segT;
            ball = bezier(segFrom, seg.to, seg.lift, t);
            if (segT >= 1) {
                segFrom = { ...seg.to };
                segIndex += 1;
                segT = 0;
                if (segIndex === 1 && outcome) {
                    const info = OUTCOMES[outcome];
                    popups.push({ text: info.label, color: info.color, x: RIM.cx - 20, y: RIM.y - 46, age: 0 });
                }
                const next = path[segIndex];
                if (next) {
                    if (next.sound) audio.play(next.sound);
                    if (next.sound === "rim" || next.sound === "board") {
                        shake = reducedMotion ? 0 : 3;
                        spinRate = -spinRate * 0.6;
                    }
                    if (next.sound === "bounce") spinRate *= 0.7;
                    if (next.net) {
                        netEnergy = outcome === "swish" ? 1 : 0.7;
                        onMake();
                    }
                } else {
                    audio.play("bounce");
                    ballSpin = 0;
                    if (phase === "flight") setTimeout(onPathEnd, 260);
                }
            }
        }
        ballSpin += spinRate * dt;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
let scale = 1;
let bg: HTMLCanvasElement | null = null;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = canvas.clientWidth || W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssW * dpr * H) / W);
    scale = canvas.width / W;
    bg = renderBackground();
}

/** Seeded RNG so the crowd doesn't shimmer between resizes. */
function rng(seed: number) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

function renderBackground(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    if (mirrored) {
        g.translate(W, 0);
        g.scale(-1, 1);
    }

    // Arena wall
    const wall = g.createLinearGradient(0, 0, 0, 240);
    wall.addColorStop(0, "#0b1030");
    wall.addColorStop(1, "#1d2660");
    g.fillStyle = wall;
    g.fillRect(0, 0, W, 240);

    // Spotlights
    for (const [x, r, a] of [[90, 160, 0.16], [300, 200, 0.12], [430, 140, 0.1]] as const) {
        const s = g.createRadialGradient(x, 0, 0, x, 0, r);
        s.addColorStop(0, `rgba(160,190,255,${a})`);
        s.addColorStop(1, "rgba(160,190,255,0)");
        g.fillStyle = s;
        g.fillRect(0, 0, W, 240);
    }

    // Crowd: rows of heads
    const rand = rng(7);
    const tones = ["#2a3270", "#323b82", "#252c63", "#3a2f6e", "#2b4078"];
    for (let row = 0; row < 5; row++) {
        const y = 150 + row * 16;
        for (let x = -6 + (row % 2) * 9; x < W + 10; x += 17) {
            g.fillStyle = tones[Math.floor(rand() * tones.length)];
            g.beginPath();
            g.arc(x + rand() * 4, y + rand() * 3, 6.5, 0, Math.PI * 2);
            g.fill();
            g.fillRect(x - 7, y + 5, 15, 10);
        }
    }

    // Advertising board / sideline banner
    const band = g.createLinearGradient(0, 228, 0, 246);
    band.addColorStop(0, "#ff8a2a");
    band.addColorStop(1, "#c4560f");
    g.fillStyle = band;
    g.fillRect(0, 228, W, 16);
    g.save();
    if (mirrored) {
        g.translate(W, 0);
        g.scale(-1, 1);
    }
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.font = "900 italic 11px 'Trebuchet MS', system-ui, sans-serif";
    g.textBaseline = "middle";
    for (let x = 14; x < W; x += 160) g.fillText("PHAMOS ARENA  ★", x, 236.5);
    g.restore();

    // Floor (angled, with planks)
    const floor = g.createLinearGradient(0, 244, 0, H);
    floor.addColorStop(0, "#b8702f");
    floor.addColorStop(1, "#e0a058");
    g.fillStyle = floor;
    g.fillRect(0, 244, W, H - 244);
    g.strokeStyle = "rgba(90,45,10,0.18)";
    g.lineWidth = 1;
    for (let y = 250; y < H; y += 7 + (y - 244) * 0.08) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
    }
    // Painted key
    g.fillStyle = "rgba(200,60,30,0.35)";
    g.beginPath();
    g.moveTo(150, 250);
    g.lineTo(420, 250);
    g.lineTo(450, 292);
    g.lineTo(128, 292);
    g.closePath();
    g.fill();
    // Free-throw line
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(150, 250);
    g.lineTo(128, 292);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 249);
    g.lineTo(W, 249);
    g.stroke();

    // Stanchion + arm
    g.fillStyle = "#3b4566";
    g.fillRect(440, 92, 10, FLOOR - 92);
    g.fillStyle = "#2b3350";
    g.fillRect(432, FLOOR - 6, 30, 10);
    g.fillStyle = "#56607f";
    g.fillRect(410, 92, 34, 7);
    g.fillStyle = "#1d2440";
    g.fillRect(432, 150, 26, 46); // padding
    return c;
}

function drawBackboard() {
    // Angled backboard (seen at ~3/4)
    ctx.fillStyle = "rgba(225,240,255,0.88)";
    ctx.strokeStyle = "#1a1f33";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BOARD.x, BOARD.top + 6);
    ctx.lineTo(BOARD.x + 18, BOARD.top);
    ctx.lineTo(BOARD.x + 18, BOARD.bottom - 6);
    ctx.lineTo(BOARD.x, BOARD.bottom);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Shooter's square
    ctx.strokeStyle = "#e5512a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BOARD.x + 4, 98);
    ctx.lineTo(BOARD.x + 14, 95);
    ctx.lineTo(BOARD.x + 14, 124);
    ctx.lineTo(BOARD.x + 4, 127);
    ctx.closePath();
    ctx.stroke();
    // Bracket to rim
    ctx.fillStyle = "#9aa3b8";
    ctx.fillRect(RIM.cx + RIM.rx - 2, RIM.y - 2, BOARD.x - (RIM.cx + RIM.rx) + 4, 5);
}

function drawRimHalf(front: boolean) {
    ctx.strokeStyle = front ? "#ff5a1f" : "#b8380f";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.ellipse(RIM.cx, RIM.y, RIM.rx, RIM.ry, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    ctx.stroke();
}

function drawNet() {
    const strands = 9;
    const levels = 5;
    const stretch = 1 + netEnergy * 0.22;
    const inNet = ball.x > RIM.cx - RIM.rx && ball.x < RIM.cx + RIM.rx && ball.y > NET.top - 4 && ball.y < NET.top + NET.height * stretch + 10;

    const point = (i: number, k: number): Pt => {
        const v = k / levels; // 0 top → 1 bottom
        const y = NET.top + v * NET.height * stretch;
        let half = RIM.rx - (RIM.rx - NET.bottomHalf) * v;
        if (inNet) half += 9 * Math.exp(-((y - ball.y) ** 2) / 120);
        const u = i / (strands - 1); // 0 front-left → 1 back-right
        const sway = netEnergy * Math.sin(netClock * 22 + k * 0.9) * v * 4;
        return { x: RIM.cx + (u * 2 - 1) * half + sway, y: y + Math.sin(u * Math.PI) * RIM.ry * (1 - v) * 0.8 };
    };

    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < strands; i++) {
        for (let k = 0; k < levels; k++) {
            const a = point(i, k);
            if (i + 1 < strands) {
                const b = point(i + 1, k + 1);
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
            }
            if (i > 0) {
                const c = point(i - 1, k + 1);
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(c.x, c.y);
            }
        }
    }
    ctx.stroke();
    // Bottom hem
    ctx.beginPath();
    for (let i = 0; i < strands; i++) {
        const p = point(i, levels);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
}

function drawBall(p: Pt, s: number) {
    if (s <= 0) return;
    const r = BALL_R * s;
    ctx.save();
    ctx.translate(p.x, p.y);
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
    grad.addColorStop(0, "#ffb15e");
    grad.addColorStop(0.6, "#ee7a22");
    grad.addColorStop(1, "#a9480f");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(ballSpin);
    ctx.strokeStyle = "rgba(50,18,4,0.85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.moveTo(-r * 0.62, -r * 0.78);
    ctx.quadraticCurveTo(-r * 0.15, 0, -r * 0.62, r * 0.78);
    ctx.moveTo(r * 0.62, -r * 0.78);
    ctx.quadraticCurveTo(r * 0.15, 0, r * 0.62, r * 0.78);
    ctx.stroke();
    ctx.rotate(-ballSpin);
    ctx.strokeStyle = "#3a1605";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawShadow() {
    const h = Math.max(0, REST_Y - ball.y);
    const k = Math.max(0.25, 1 - h / 220);
    ctx.fillStyle = `rgba(40,15,0,${0.35 * k})`;
    ctx.beginPath();
    ctx.ellipse(ball.x, FLOOR + 1, BALL_R * 1.1 * k, 3.2 * k, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawShooter() {
    const x = SHOOTER_X;
    const holding = phase === "aim" || phase === "intro";
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x, FLOOR + 1, 18, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Legs
    ctx.strokeStyle = "#141a33";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x - 4, 236);
    ctx.lineTo(x - 7, FLOOR - 2);
    ctx.moveTo(x + 4, 236);
    ctx.lineTo(x + 6, FLOOR - 2);
    ctx.stroke();
    // Jersey
    ctx.fillStyle = "#1f8fbf";
    ctx.beginPath();
    ctx.roundRect?.(x - 11, 204, 22, 34, 6);
    if (!ctx.roundRect) ctx.rect(x - 11, 204, 22, 34);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 11px 'Trebuchet MS', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    if (mirrored) {
        ctx.translate(x, 0);
        ctx.scale(-1, 1);
        ctx.translate(-x, 0);
    }
    ctx.fillText("8", x, 221);
    ctx.restore();
    // Head
    ctx.fillStyle = "#8a5a3c";
    ctx.beginPath();
    ctx.arc(x, 194, 9, 0, Math.PI * 2);
    ctx.fill();
    // Arms: holding the ball overhead, or following through toward the hoop
    const hand = holding ? { x: START.x - 4, y: START.y + 8 } : { x: x + 22 + followThrough * 4, y: 176 - followThrough * 6 };
    const hand2 = holding ? { x: START.x + 6, y: START.y + 4 } : { x: hand.x + 2, y: hand.y + 3 };
    ctx.strokeStyle = "#8a5a3c";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 6, 208);
    ctx.quadraticCurveTo(x - 2, 194, hand.x, hand.y);
    ctx.moveTo(x + 6, 208);
    ctx.quadraticCurveTo(x + 12, 196, hand2.x, hand2.y);
    ctx.stroke();
}

function drawPopups() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of popups) {
        if (p.age < 0) continue;
        const a = Math.max(0, 1 - p.age / 1.1);
        const x = mirrored && p.x !== W / 2 ? W - p.x : p.x;
        const y = p.y - p.age * 26;
        const s = 1 + Math.max(0, 0.25 - p.age) * 1.6;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(x, y);
        ctx.scale(s, s);
        ctx.font = "900 italic 24px 'Arial Black', 'Trebuchet MS', system-ui, sans-serif";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(5,8,25,0.85)";
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
    }
}

function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bg) ctx.drawImage(bg, 0, 0);
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);
    ctx.save();
    if (mirrored) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
    }
    drawShadow();
    drawShooter();
    drawBackboard();
    drawRimHalf(false);
    // Ball behind the net/front rim while it's at or below rim height near the hoop
    const behind = ball.y > RIM.y - BALL_R && Math.abs(ball.x - RIM.cx) < RIM.rx + 4;
    if (!behind) {
        drawNet();
        drawRimHalf(true);
        drawBall(ball, ballScale);
    } else {
        drawBall(ball, ballScale);
        drawNet();
        drawRimHalf(true);
    }
    ctx.restore();
    drawPopups();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
window.addEventListener(
    "keydown",
    (e) => {
        if (e.code === "Space" || e.key === " ") {
            // Never let Space "click" a focused button (e.g. Mute) — it always shoots.
            e.preventDefault();
            if (!e.repeat) primaryAction();
        } else if (e.key === "m" || e.key === "M") {
            toggleMute();
        } else if (e.key === "Escape") {
            if (!ui.lbConfirm.hidden) showResetConfirm(false);
            else closeGame();
        }
    },
    { capture: true },
);
window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.key === " ") e.preventDefault();
}, { capture: true });

for (const el of [ui.stage, ui.meter]) {
    el.addEventListener("pointerdown", (e) => {
        if ((e.target as HTMLElement).closest("button, .overlay")) return;
        if (e.button !== 0) return;
        e.preventDefault();
        primaryAction();
    });
}
ui.start.addEventListener("click", () => {
    if (phase === "intro") startRun();
});
ui.again.addEventListener("click", () => {
    if (phase === "over") startRun();
});

function syncMuteButton() {
    ui.mute.setAttribute("aria-pressed", String(audio.muted));
    ui.mute.setAttribute("aria-label", audio.muted ? "Unmute sound" : "Mute sound");
    (ui.mute.querySelector(".snd-on") as SVGElement).style.display = audio.muted ? "none" : "";
    (ui.mute.querySelector(".snd-off") as SVGElement).style.display = audio.muted ? "" : "none";
}
function toggleMute() {
    audio.unlock();
    audio.muted = !audio.muted;
    syncMuteButton();
}
ui.mute.addEventListener("click", toggleMute);
ui.close.addEventListener("click", closeGame);
ui.lbReset.addEventListener("click", () => {
    setBoardStatus("");
    showResetConfirm(true);
});
ui.lbCancel.addEventListener("click", () => showResetConfirm(false));
ui.lbConfirmYes.addEventListener("click", () => void resetScores());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
ui.stage.tabIndex = -1;
syncMuteButton();
placeZones();
resize();
window.addEventListener("resize", resize);

let last = performance.now();
function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

connectScores().then((store) => {
    scores = store;
    ui.chip.textContent = store.mode === "workadventure" ? `Playing as ${store.playerName}` : "Standalone · saved in this browser";
    ui.chip.title = ui.chip.textContent;
    ui.lbAdmin.hidden = !store.canReset;
    let top = store.record();
    store.onChange((reason) => {
        const nextTop = store.record();
        if (nextTop?.id !== top?.id || nextTop?.streak !== top?.streak) bump(ui.record);
        top = nextTop;
        if (reason === "reset") {
            runNewBest = false;
            runNewRecord = false;
            if (!ui.lbStatus.classList.contains("ok")) setBoardStatus("An admin reset the scores.", "ok");
        }
        renderHud();
    });
    renderHud();
});

// Debug/testing hook (harmless in production): lets automated tests read state.
(window as unknown as { __freeThrow?: unknown }).__freeThrow = {
    get state() {
        return { phase, streak, meterPos, target, tuning, outcome };
    },
    setMeter(pos: number) {
        meterPos = pos;
    },
};
