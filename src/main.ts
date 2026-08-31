/// <reference types="@workadventure/iframe-api-typings" />

import { bootstrapExtra } from "@workadventure/scripting-api-extra";

type StatusType = "ONLINE" | "BUSY" | "DO_NOT_DISTURB" | "BACK_IN_A_MOMENT";

interface StatusConfigItem {
    status: StatusType;
    label: string;
    color?: { r: number; g: number; b: number };
}

WA.onInit().then(async () => {
    console.info('Status tiles script ready');
    
    // Consolidated status configuration
    const statusConfig: Record<string, StatusConfigItem> = {
        online: { 
            status: "ONLINE",
            label: "Online",
        },
        busy: { 
            status: "BUSY",
            label: "Busy",
            color: { r: 255, g: 165, b: 0 }
        },
        "do-not-disturb": { 
            status: "DO_NOT_DISTURB",
            label: "Do Not Disturb",
            color: { r: 255, g: 0, b: 0 }
        },
        "back-in-a-moment": { 
            status: "BACK_IN_A_MOMENT",
            label: "Back in a Moment",
            color: { r: 255, g: 255, b: 0 }
        },
    };
    
    let currentStatus: string | null = null;
    
    // Apply status change with visual feedback
    const applyStatus = async (status: StatusType, _source: "tile" | "manual" = "tile") => {
        if (typeof (WA.player as any).setStatus === "function") {
            (WA.player as any).setStatus(status);
        }
        
        // Apply/remove outline color
        const config = Object.values(statusConfig).find(c => c.status === status);
        if (config?.color) {
            await WA.player.setOutlineColor(config.color.r, config.color.g, config.color.b);
        } else {
            await WA.player.removeOutlineColor();
        }
    };
    
    // Get tile properties at player position
    const tiledMap = await WA.room.getTiledMap();
    const tileSize = tiledMap.tilewidth || 32;
    const mapWidth = tiledMap.width || 0;
    
    const tileProperties = new Map<number, Record<string, any>>();
    tiledMap.tilesets?.forEach((tileset: any) => {
        if (tileset.tiles && Array.isArray(tileset.tiles)) {
            tileset.tiles.forEach((tile: any) => {
                const tileId = tileset.firstgid + tile.id;
                if (tile.properties) {
                    const props = Object.fromEntries(
                        tile.properties.map((p: any) => [p.name, p.value])
                    );
                    tileProperties.set(tileId, props);
                }
            });
        }
    });
    
    const getTileLayers = (layers: any[]): any[] => 
        layers.flatMap(layer => 
            layer.type === "tilelayer" ? [layer] :
            layer.type === "group" ? getTileLayers(layer.layers) : []
        );
    
    const tileLayers = getTileLayers(tiledMap.layers);
    
    const getTilePropertiesAt = (x: number, y: number) => {
        const tileX = Math.floor(x / tileSize);
        const tileY = Math.floor(y / tileSize);
        
        for (let i = tileLayers.length - 1; i >= 0; i--) {
            const tileId = tileLayers[i].data[tileY * mapWidth + tileX];
            if (tileId > 0) {
                const props = tileProperties.get(tileId);
                if (props?.status) return props;
            }
        }
        return null;
    };
    
    // Handle player movement to detect status tiles
    WA.player.onPlayerMove((event) => {
        const statusValue = getTilePropertiesAt(event.x, event.y)?.status;
        
        if (statusValue !== currentStatus) {
            currentStatus = statusValue;
            const config = statusValue ? statusConfig[statusValue] : statusConfig.online;
            if (config) applyStatus(config.status);
        }
    });

    // Add status control buttons
    const buttons = [
        { id: 'status-busy', config: statusConfig.busy },
        { id: 'status-dnd', config: statusConfig["do-not-disturb"] },
        { id: 'status-away', config: statusConfig["back-in-a-moment"] },
        { id: 'status-online', config: statusConfig.online },
    ];
    
    buttons.forEach(({ id, config }) => {
        WA.ui.actionBar.addButton({
            id,
            label: config.label,
            callback: () => applyStatus(config.status, "manual"),
        });
    });

    bootstrapExtra().catch(e => console.error(e));

}).catch(e => console.error(e));

export {};