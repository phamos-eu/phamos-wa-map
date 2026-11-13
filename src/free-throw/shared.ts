/**
 * Names shared between the map script (zones.ts), the mini-game page (game.ts)
 * and the map file (phamos-island.tmj → "minigames" object layer).
 */

/** Area objects in phamos-island.tmj that open the mini-game. */
export const FREE_THROW_AREAS = {
    free_throw_left: "left",
    free_throw_right: "right",
} as const;

export type CourtSide = (typeof FREE_THROW_AREAS)[keyof typeof FREE_THROW_AREAS];

/** Room variable (declared in the map, writable by everyone) holding the top streaks. */
export const LEADERBOARD_VARIABLE = "freeThrowLeaderboard";

/**
 * Room variable (declared in the map with `writableBy: "admin"`) holding the current season.
 * Resetting the scores = incrementing the season; entries from older seasons are ignored.
 * The WorkAdventure server rejects writes from players without the admin tag.
 */
export const SEASON_VARIABLE = "freeThrowSeason";

/** Player tag allowed to reset the scores. Must match `writableBy` of SEASON_VARIABLE in the map. */
export const ADMIN_TAG = "admin";

/** Persistent per-player variable holding the player's best streak ({ streak, season }). */
export const BEST_VARIABLE = "freeThrowBest";

/** Private, non-persistent player variable the game page bumps to ask the map script to close it. */
export const CLOSE_REQUEST_VARIABLE = "freeThrowCloseRequest";

/** Path of the game page, relative to the map file. */
export const GAME_PAGE = "games/free-throw.html";

export const LEADERBOARD_SIZE = 10;

export interface LeaderEntry {
    /** Hashed player id — one entry per player. */
    id: string;
    name: string;
    streak: number;
    season: number;
    at: number;
}

export interface Leaderboard {
    season: number;
    entries: LeaderEntry[];
}

function parseJson(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export function parseSeason(value: unknown): number {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseEntry(value: unknown): LeaderEntry | null {
    if (!value || typeof value !== "object") return null;
    const e = value as Partial<LeaderEntry>;
    if (typeof e.id !== "string" || !e.id) return null;
    if (typeof e.streak !== "number" || !Number.isFinite(e.streak) || e.streak <= 0) return null;
    // A malformed season must not masquerade as season 0 — drop the entry instead.
    if (typeof e.season !== "number" || !Number.isInteger(e.season) || e.season < 0) return null;
    return {
        id: e.id.slice(0, 64),
        name: typeof e.name === "string" && e.name.trim() ? e.name.trim().slice(0, 40) : "Unknown",
        streak: Math.floor(e.streak),
        season: e.season,
        at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0,
    };
}

/** Best first; ties go to whoever got there first. */
export function sortEntries(entries: LeaderEntry[]): LeaderEntry[] {
    return [...entries].sort((a, b) => b.streak - a.streak || a.at - b.at);
}

/**
 * Validates the stored leaderboard, keeps only entries of `season`,
 * one per player, best first, at most LEADERBOARD_SIZE.
 */
export function parseLeaderboard(value: unknown, season: number): LeaderEntry[] {
    const raw = parseJson(value) as Partial<Leaderboard> | null;
    const list = Array.isArray(raw?.entries) ? raw?.entries ?? [] : [];
    const byId = new Map<string, LeaderEntry>();
    for (const item of list) {
        const e = parseEntry(item);
        if (!e || e.season !== season) continue;
        const prev = byId.get(e.id);
        if (!prev || e.streak > prev.streak) byId.set(e.id, e);
    }
    return sortEntries([...byId.values()]).slice(0, LEADERBOARD_SIZE);
}

/** Best streak stored in a player variable — only counts if it belongs to the current season. */
export function parseBest(value: unknown, season: number): number {
    const v = parseJson(value);
    // Legacy format (plain number) predates seasons → season 0.
    if (typeof v === "number") return season === 0 ? parseSeason(v) : 0;
    if (!v || typeof v !== "object") return 0;
    const b = v as { streak?: unknown; season?: unknown };
    return parseSeason(b.season) === season ? parseSeason(b.streak) : 0;
}

/** Stable, non-reversible-at-a-glance id so raw player UUIDs (may be emails) never land in room state. */
export function hashId(input: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    }
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
