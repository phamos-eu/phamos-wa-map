/// <reference types="vite/client" />
/// <reference types="@workadventure/iframe-api-typings" />

import { BEST_VARIABLE, CLOSE_REQUEST_VARIABLE, CourtRecord, parseRecord, RECORD_VARIABLE } from "./shared";

/**
 * Best-streak / court-record storage. Inside WorkAdventure it uses room and
 * player variables; opened directly in a browser it falls back to localStorage.
 */
export interface ScoreStore {
    readonly mode: "workadventure" | "standalone";
    readonly playerName: string;
    best(): number;
    record(): CourtRecord | null;
    /** Called after every make with the running streak; persists any new best/record. */
    report(streak: number): { newBest: boolean; newRecord: boolean };
    onRecordChange(cb: (record: CourtRecord | null) => void): void;
    /** Close the mini-game (co-website) — returns false when there's nothing to close. */
    requestClose(): boolean;
}

type WAApi = typeof WA;

const LS_BEST = "freeThrow.best";
const LS_RECORD = "freeThrow.record";
const LS_NAME = "freeThrow.name";

/** Origins allowed to provide iframe_api.js (the WorkAdventure "play" front). */
function isTrustedPlayOrigin(origin: string): boolean {
    let host: string;
    try {
        host = new URL(origin).hostname;
    } catch {
        return false;
    }
    if (host === "workadventu.re" || host.endsWith(".workadventu.re")) return true;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) return true;
    const extra = (import.meta.env.VITE_WA_PLAY_ORIGINS as string | undefined) ?? "";
    return extra
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .some((o) => o === origin);
}

/** Load the WorkAdventure iframe API from the embedding play origin, if any. */
async function loadWorkAdventure(timeoutMs: number): Promise<WAApi | null> {
    const existing = (window as unknown as { WA?: WAApi }).WA;
    if (existing) return existing;
    if (window.parent === window || !document.referrer) return null;

    let origin: string;
    try {
        origin = new URL(document.referrer).origin;
    } catch {
        return null;
    }
    if (!isTrustedPlayOrigin(origin)) {
        console.info(`[free-throw] ${origin} is not a trusted WorkAdventure origin; running standalone`);
        return null;
    }

    const loaded = new Promise<boolean>((resolve) => {
        const s = document.createElement("script");
        s.src = `${origin}/iframe_api.js`;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs));

    if (!(await Promise.race([loaded, timeout]))) return null;
    const wa = (window as unknown as { WA?: WAApi }).WA;
    if (!wa) return null;
    const ready = await Promise.race([wa.onInit().then(() => true, () => false), timeout]);
    return ready ? wa : null;
}

function readNumber(v: unknown): number {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function lsGet(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function lsSet(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* storage blocked — keep in memory only */
    }
}

function createWAStore(wa: WAApi): ScoreStore {
    const playerName = wa.player.name || "Player";
    let best = readNumber(wa.player.state.loadVariable(BEST_VARIABLE));
    let record = parseRecord(wa.state.loadVariable(RECORD_VARIABLE));
    const listeners: ((r: CourtRecord | null) => void)[] = [];

    wa.state.onVariableChange(RECORD_VARIABLE).subscribe((value) => {
        record = parseRecord(value);
        listeners.forEach((cb) => cb(record));
    });

    return {
        mode: "workadventure",
        playerName,
        best: () => best,
        record: () => record,
        report(streak) {
            const out = { newBest: false, newRecord: false };
            if (streak > best) {
                best = streak;
                out.newBest = true;
                wa.player.state
                    .saveVariable(BEST_VARIABLE, best, { public: false, persist: true, scope: "room" })
                    .catch((e) => console.warn("[free-throw] could not save best", e));
            }
            // Re-read right before writing to narrow the race with other players.
            const current = parseRecord(wa.state.loadVariable(RECORD_VARIABLE)) ?? record;
            if (!current || streak > current.streak) {
                record = { name: playerName, streak, at: Date.now() };
                out.newRecord = true;
                wa.state
                    .saveVariable(RECORD_VARIABLE, record)
                    .catch((e) => console.warn("[free-throw] could not save court record", e));
            }
            return out;
        },
        onRecordChange: (cb) => listeners.push(cb),
        requestClose() {
            // The map script owns the co-website handle; ask it to close.
            wa.player.state
                .saveVariable(CLOSE_REQUEST_VARIABLE, Date.now(), { public: false, persist: false })
                .catch(() => undefined);
            // If the map script didn't react (iframe still alive), close co-websites directly.
            setTimeout(() => {
                void wa.nav.closeCoWebSite().catch(() => undefined);
            }, 700);
            return true;
        },
    };
}

function createLocalStore(): ScoreStore {
    const params = new URLSearchParams(location.search);
    const playerName = (params.get("name") || lsGet(LS_NAME) || "You").slice(0, 40);
    let best = readNumber(lsGet(LS_BEST));
    let record = parseRecord(lsGet(LS_RECORD));
    const listeners: ((r: CourtRecord | null) => void)[] = [];

    // Keep several standalone tabs in sync.
    window.addEventListener("storage", (e) => {
        if (e.key === LS_RECORD) {
            record = parseRecord(e.newValue);
            listeners.forEach((cb) => cb(record));
        } else if (e.key === LS_BEST) {
            best = Math.max(best, readNumber(e.newValue));
        }
    });

    return {
        mode: "standalone",
        playerName,
        best: () => best,
        record: () => record,
        report(streak) {
            const out = { newBest: false, newRecord: false };
            if (streak > best) {
                best = streak;
                out.newBest = true;
                lsSet(LS_BEST, String(best));
            }
            if (!record || streak > record.streak) {
                record = { name: playerName, streak, at: Date.now() };
                out.newRecord = true;
                lsSet(LS_RECORD, JSON.stringify(record));
            }
            return out;
        },
        onRecordChange: (cb) => listeners.push(cb),
        requestClose: () => false,
    };
}

export async function connectScores(): Promise<ScoreStore> {
    try {
        const wa = await loadWorkAdventure(4000);
        if (wa) return createWAStore(wa);
    } catch (e) {
        console.warn("[free-throw] WorkAdventure API unavailable, running standalone", e);
    }
    return createLocalStore();
}
