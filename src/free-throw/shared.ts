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

/** Room variable (declared as a `variable` object in the map) holding the court record. */
export const RECORD_VARIABLE = "freeThrowRecord";

/** Persistent per-player variable holding the player's best streak. */
export const BEST_VARIABLE = "freeThrowBest";

/** Private, non-persistent player variable the game page bumps to ask the map script to close it. */
export const CLOSE_REQUEST_VARIABLE = "freeThrowCloseRequest";

/** Path of the game page, relative to the map file. */
export const GAME_PAGE = "games/free-throw.html";

export interface CourtRecord {
    name: string;
    streak: number;
    at?: number;
}

export function parseRecord(value: unknown): CourtRecord | null {
    let v = value;
    if (typeof v === "string") {
        try {
            v = JSON.parse(v);
        } catch {
            return null;
        }
    }
    if (!v || typeof v !== "object") return null;
    const r = v as Partial<CourtRecord>;
    if (typeof r.streak !== "number" || !Number.isFinite(r.streak) || r.streak <= 0) return null;
    return {
        name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : "Unknown",
        streak: Math.floor(r.streak),
        at: typeof r.at === "number" ? r.at : undefined,
    };
}
