/// <reference types="@workadventure/iframe-api-typings" />

import { bootstrapExtra } from "@workadventure/scripting-api-extra";

WA.onInit().then(async () => {
    console.info('Scripting API ready');
    
    // Map status property values to status
    const statusMap: Record<string, "ONLINE" | "BUSY" | "DO_NOT_DISTURB" | "BACK_IN_A_MOMENT"> = {
        busy: "BUSY",
        "do-not-disturb": "DO_NOT_DISTURB",
        "back-in-a-moment": "BACK_IN_A_MOMENT",
    };
    
    // Get the map data to find tiles with status properties
    const tiledMap = await WA.room.getTiledMap();
    const tileWidth = tiledMap.tilewidth || 32;
    const tileHeight = tiledMap.tileheight || 32;
    
    // Build a map of tile IDs to their properties
    const tileProperties = new Map<number, Record<string, any>>();
    
    if (tiledMap.tilesets) {
        for (const tileset of tiledMap.tilesets) {
            const firstgid = tileset.firstgid;
            if (tileset.tiles) {
                for (const tile of tileset.tiles) {
                    const tileId = firstgid + tile.id;
                    if (tile.properties) {
                        const props: Record<string, any> = {};
                        for (const prop of tile.properties) {
                            props[prop.name] = prop.value;
                        }
                        tileProperties.set(tileId, props);
                    }
                }
            }
        }
    }
    
    // Get all tile layers (flatten groups)
    const getTileLayers = (layers: any[]): any[] => {
        const tileLayers: any[] = [];
        for (const layer of layers) {
            if (layer.type === "tilelayer" && layer.data) {
                tileLayers.push(layer);
            } else if (layer.type === "group" && layer.layers) {
                tileLayers.push(...getTileLayers(layer.layers));
            }
        }
        return tileLayers;
    };
    
    const tileLayers = getTileLayers(tiledMap.layers);
    
    // Function to get tile properties at a position
    const getTilePropertiesAt = (x: number, y: number): Record<string, any> | null => {
        const tileX = Math.floor(x / tileWidth);
        const tileY = Math.floor(y / tileHeight);
        
        // Check all layers from top to bottom
        for (let i = tileLayers.length - 1; i >= 0; i--) {
            const layer = tileLayers[i];
            const index = tileY * tiledMap.width + tileX;
            const tileId = layer.data[index];
            
            if (tileId && tileId > 0) {
                const props = tileProperties.get(tileId);
                if (props && props.status) {
                    return props;
                }
            }
        }
        return null;
    };
    
    // Track current status
    let currentStatus: string | null = null;

    // Handle player movement to detect status tile changes
    WA.player.onPlayerMove((event) => {
        const tileProps = getTilePropertiesAt(event.x, event.y);
        const statusValue = tileProps?.status;
        
        if (statusValue !== currentStatus) {
            currentStatus = statusValue;
            
            if (statusValue && statusMap[statusValue]) {
                // Player stepped on a status tile
                const status = statusMap[statusValue];
                WA.player.setStatus(status as any);
                
                const statusLabel = statusValue.split('-').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ');
                
                WA.chat.sendChatMessage(`Status → ${statusLabel}`, {
                    scope: "local",
                    author: "System",
                });
            } else if (!statusValue) {
                // Player stepped off status tiles
                WA.player.setStatus("ONLINE" as any);
                WA.chat.sendChatMessage(`Status → Online`, {
                    scope: "local",
                    author: "System",
                });
            }
        }
    });

    bootstrapExtra().catch(e => console.error(e));

}).catch(e => console.error(e));

export {};