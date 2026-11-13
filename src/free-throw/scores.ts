/// <reference types="vite/client" />
/// <reference types="@workadventure/iframe-api-typings" />

import {
    ADMIN_TAG,
    BEST_VARIABLE,
    CLOSE_REQUEST_VARIABLE,
    hashId,
    LeaderEntry,
    LEADERBOARD_SIZE,
    LEADERBOARD_VARIABLE,
    parseBest,
    parseLeaderboard,
    parseSeason,
    SEASON_VARIABLE,
    sortEntries,
} from "./shared";

/**
 * Best streak, top-10 leaderboard and admin reset. Inside WorkAdventure it uses
 * room and player variables; opened directly in a browser it falls back to localStorage.
 */
export interface ScoreStore {
    readonly mode: "workadventure" | "standalone";
    readonly playerName: string;
    /** Hashed id of the current player — matches LeaderEntry.id. */
    readonly playerId: string;
    /** Whether to offer the reset button. The server still enforces `writableBy: "admin"`. */
    readonly canReset: boolean;
    best(): number;
    leaderboard(): LeaderEntry[];
    record(): LeaderEntry | null;
    /** Called after every make with the running streak; persists any new best / leaderboard spot. */
    report(streak: number): { newBest: boolean; newRecord: boolean };
    /** Fires when the leaderboard changes (other players) or the scores were reset. */
    onChange(cb: (reason: "leaderboard" | "reset") => void): void;
    /** Admin only: wipe the leaderboard and everyone's best by starting a new season. */
    reset(): Promise<void>;
    /** Close the mini-game (co-website) — returns false when there's nothing to close. */
    requestClose(): boolean;
}

/** Minimal key/value layer the score logic runs on. */
interface Backend {
    mode: ScoreStore["mode"];
    playerName: string;
    playerKey: string;
    isAdmin: boolean;
    getRoom(key: string): unknown;
    setRoom(key: string, value: unknown): Promise<void>;
    onRoom(key: string, cb: (value: unknown) => void): void;
    getPlayer(key: string): unknown;
    setPlayer(key: string, value: unknown): Promise<void>;
    requestClose(): boolean;
}

type WAApi = typeof WA;

// ---------------------------------------------------------------------------
// Shared score logic
// ---------------------------------------------------------------------------
function createStore(b: Backend): ScoreStore {
    const playerId = hashId(b.playerKey);
    let season = parseSeason(b.getRoom(SEASON_VARIABLE));
    let entries = parseLeaderboard(b.getRoom(LEADERBOARD_VARIABLE), season);
    let best = parseBest(b.getPlayer(BEST_VARIABLE), season);
    const listeners: ((reason: "leaderboard" | "reset") => void)[] = [];
    const emit = (reason: "leaderboard" | "reset") => listeners.forEach((cb) => cb(reason));
    const warn = (what: string) => (e: unknown) => console.warn(`[free-throw] could not save ${what}`, e);

    b.onRoom(LEADERBOARD_VARIABLE, (value) => {
        entries = parseLeaderboard(value, season);
        emit("leaderboard");
    });
    b.onRoom(SEASON_VARIABLE, (value) => {
        const next = parseSeason(value);
        if (next === season) return;
        season = next;
        entries = parseLeaderboard(b.getRoom(LEADERBOARD_VARIABLE), season);
        best = parseBest(b.getPlayer(BEST_VARIABLE), season);
        emit("reset");
    });

    return {
        mode: b.mode,
        playerName: b.playerName,
        playerId,
        canReset: b.isAdmin,
        best: () => best,
        leaderboard: () => entries,
        record: () => entries[0] ?? null,
        report(streak) {
            const out = { newBest: false, newRecord: false };
            if (streak > best) {
                best = streak;
                out.newBest = true;
                b.setPlayer(BEST_VARIABLE, { streak, season }).catch(warn("best"));
            }

            // Re-read right before writing to narrow the race with other players.
            const current = parseLeaderboard(b.getRoom(LEADERBOARD_VARIABLE), season);
            const mine = current.find((e) => e.id === playerId);
            const last = current[current.length - 1];
            const qualifies = mine
                ? streak > mine.streak
                : current.length < LEADERBOARD_SIZE || !last || streak > last.streak;
            if (qualifies) {
                out.newRecord = streak > (current[0]?.streak ?? 0);
                const entry: LeaderEntry = { id: playerId, name: b.playerName, streak, season, at: Date.now() };
                entries = sortEntries([...current.filter((e) => e.id !== playerId), entry]).slice(0, LEADERBOARD_SIZE);
                b.setRoom(LEADERBOARD_VARIABLE, { season, entries }).catch(warn("leaderboard"));
                emit("leaderboard");
            }
            return out;
        },
        onChange: (cb) => listeners.push(cb),
        async reset() {
            if (!b.isAdmin) throw new Error("Only admins can reset the scores");
            const next = season + 1;
            // The server rejects this write unless the player has the admin tag.
            await b.setRoom(SEASON_VARIABLE, next);
            await b.setRoom(LEADERBOARD_VARIABLE, { season: next, entries: [] });
            season = next;
            entries = [];
            best = 0;
            emit("reset");
        },
        requestClose: () => b.requestClose(),
    };
}

// ---------------------------------------------------------------------------
// WorkAdventure backend
// ---------------------------------------------------------------------------

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

function waBackend(wa: WAApi): Backend {
    const tags = Array.isArray(wa.player.tags) ? wa.player.tags : [];
    return {
        mode: "workadventure",
        playerName: wa.player.name || "Player",
        playerKey: wa.player.uuid || `pid:${wa.player.playerId}`,
        isAdmin: tags.includes(ADMIN_TAG),
        getRoom: (key) => wa.state.loadVariable(key),
        setRoom: (key, value) => wa.state.saveVariable(key, value),
        onRoom: (key, cb) => {
            wa.state.onVariableChange(key).subscribe(cb);
        },
        getPlayer: (key) => wa.player.state.loadVariable(key),
        setPlayer: (key, value) => wa.player.state.saveVariable(key, value, { public: false, persist: true, scope: "room" }),
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

// ---------------------------------------------------------------------------
// Standalone (localStorage) backend
// ---------------------------------------------------------------------------
const LS_ROOM = "freeThrow.room.";
const LS_PLAYER = "freeThrow.player.";

function lsGet(key: string): unknown {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? undefined : JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function lsSet(key: string, value: unknown): Promise<void> {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage blocked — keep in memory only */
    }
    return Promise.resolve();
}

function localBackend(): Backend {
    const params = new URLSearchParams(location.search);
    const playerName = (params.get("name") || "You").slice(0, 40);
    return {
        mode: "standalone",
        playerName,
        playerKey: `local:${playerName}`,
        // Standalone data lives only in this browser, so its owner may reset it.
        isAdmin: true,
        getRoom: (key) => lsGet(LS_ROOM + key),
        setRoom: (key, value) => lsSet(LS_ROOM + key, value),
        onRoom: (key, cb) => {
            // Keep several standalone tabs in sync.
            window.addEventListener("storage", (e) => {
                if (e.key === LS_ROOM + key) cb(lsGet(LS_ROOM + key));
            });
        },
        // Per-name, so ?name=Alice and ?name=Bob behave like two players.
        getPlayer: (key) => lsGet(`${LS_PLAYER}${playerName}.${key}`),
        setPlayer: (key, value) => lsSet(`${LS_PLAYER}${playerName}.${key}`, value),
        requestClose: () => false,
    };
}

export async function connectScores(): Promise<ScoreStore> {
    try {
        const wa = await loadWorkAdventure(4000);
        if (wa) return createStore(waBackend(wa));
    } catch (e) {
        console.warn("[free-throw] WorkAdventure API unavailable, running standalone", e);
    }
    return createStore(localBackend());
}
