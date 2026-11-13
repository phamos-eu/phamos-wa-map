/// <reference types="@workadventure/iframe-api-typings" />

import { CLOSE_REQUEST_VARIABLE, CourtSide, FREE_THROW_AREAS, GAME_PAGE } from "./shared";

type CoWebsiteHandle = Awaited<ReturnType<typeof WA.nav.openCoWebSite>>;

/**
 * Opens the Free-Throw Streak co-website while the player stands on a
 * free-throw area and closes it when they step off (or press Close in-game).
 * Must be called after WA.onInit() resolved.
 */
export function initFreeThrowZones(): void {
    let site: CoWebsiteHandle | undefined;
    let wanted: CourtSide | null = null;
    // Serialise open/close calls so quick enter/leave sequences can't leak an iframe.
    let queue: Promise<void> = Promise.resolve();

    const sync = () => {
        queue = queue
            .then(async () => {
                if (wanted && !site) {
                    const url = new URL(GAME_PAGE, WA.room.mapURL);
                    url.searchParams.set("side", wanted);
                    site = await WA.nav.openCoWebSite(url.toString(), true, "autoplay", 45, undefined, true);
                } else if (!wanted && site) {
                    const closing = site;
                    site = undefined;
                    // The player may already have closed it with the co-website's own X.
                    await closing.close().catch(() => undefined);
                }
            })
            .catch((e) => console.error("[free-throw]", e));
    };

    for (const [area, side] of Object.entries(FREE_THROW_AREAS) as [string, CourtSide][]) {
        WA.room.area.onEnter(area).subscribe(() => {
            wanted = side;
            sync();
        });
        WA.room.area.onLeave(area).subscribe(() => {
            if (wanted === side) wanted = null;
            sync();
        });
    }

    // The game page (same API, other iframe) bumps this variable when its Close button is pressed.
    WA.player.state.onVariableChange(CLOSE_REQUEST_VARIABLE).subscribe(() => {
        wanted = null;
        sync();
    });

    console.info("[free-throw] zones ready");
}
