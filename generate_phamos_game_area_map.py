#!/usr/bin/env python3
"""
Court-Only Generator for PHAMOS Game Area Map & Tileset.
Keeps ONLY the court area (32x16 tiles = 1024x512 px).
Removes all surrounding dark tiles, perimeter floor, plants, benches, and lounge objects.
"""

import json
import os
from PIL import Image, ImageDraw

TILE_SIZE = 32
MAP_W = 32  # 32 tiles wide = 1024 px
MAP_H = 16  # 16 tiles high = 512 px
MAP_PX_W = MAP_W * TILE_SIZE  # 1024 px
MAP_PX_H = MAP_H * TILE_SIZE  # 512 px

# Color palette matching sample/phamos_game_area.png
COLOR_WOOD_BASE   = (212, 148, 88, 255)     # Warm parquet wood
COLOR_WOOD_ALT    = (198, 134, 76, 255)     # Wood plank grain
COLOR_ORANGE_KEY  = (215, 95, 30, 255)      # Vibrant orange court key
COLOR_ORANGE_ALT  = (198, 85, 25, 255)      # Key plank accent
COLOR_CENTER_DARK = (24, 28, 38, 255)      # Dark center meeting circle
COLOR_CENTER_RIM  = (200, 140, 80, 255)     # Gold/wood rim on center circle
COLOR_LINE_BLACK  = (15, 15, 15, 255)      # Black court line markings

def draw_parquet(draw, width, height, bg_type='wood'):
    """Draw a warm parquet plank texture."""
    if bg_type == 'orange':
        base_col, alt_col = COLOR_ORANGE_KEY, COLOR_ORANGE_ALT
    elif bg_type == 'center_dark':
        base_col, alt_col = COLOR_CENTER_DARK, (18, 22, 30, 255)
    else:
        base_col, alt_col = COLOR_WOOD_BASE, COLOR_WOOD_ALT
        
    draw.rectangle([0, 0, width-1, height-1], fill=base_col)
    for y in range(0, height, 4):
        color = alt_col if (y // 4) % 2 == 1 else base_col
        draw.rectangle([0, y, width-1, y+3], fill=color)
        draw.line([(0, y), (width-1, y)], fill=(0, 0, 0, 20))

def generate_court_image():
    """Draw court-only high-resolution image (1024x512 px)."""
    full_img = Image.new("RGBA", (MAP_PX_W, MAP_PX_H))
    draw = ImageDraw.Draw(full_img)

    # 1. Main Parquet Court Floor (entire 1024x512 canvas)
    draw_parquet(draw, MAP_PX_W, MAP_PX_H, bg_type='wood')

    # 2. Orange Keys
    # Left key: X=0..7 (7 tiles wide = 224 px), Y=4..12 (8 tiles high = 256 px)
    key_l_x1, key_l_y1 = 0, 4 * 32
    key_l_x2, key_l_y2 = 7 * 32, 12 * 32
    key_l_img = Image.new("RGBA", (key_l_x2 - key_l_x1, key_l_y2 - key_l_y1))
    draw_parquet(ImageDraw.Draw(key_l_img), key_l_x2 - key_l_x1, key_l_y2 - key_l_y1, bg_type='orange')
    full_img.paste(key_l_img, (key_l_x1, key_l_y1))

    # Right key: X=25..32 (7 tiles wide = 224 px), Y=4..12 (8 tiles high = 256 px)
    key_r_x1, key_r_y1 = 25 * 32, 4 * 32
    key_r_x2, key_r_y2 = 32 * 32, 12 * 32
    key_r_img = Image.new("RGBA", (key_r_x2 - key_r_x1, key_r_y2 - key_r_y1))
    draw_parquet(ImageDraw.Draw(key_r_img), key_r_x2 - key_r_x1, key_r_y2 - key_r_y1, bg_type='orange')
    full_img.paste(key_r_img, (key_r_x1, key_r_y1))

    # 3. Center Circle (Dark Meeting Space)
    cx, cy = 16 * 32, 8 * 32
    r_outer = 96
    r_inner = 92
    
    draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=COLOR_CENTER_RIM)
    draw.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=COLOR_CENTER_DARK)

    # 4. Court Markings (Black lines)
    # Outer Court Boundary
    draw.rectangle([0, 0, MAP_PX_W - 1, MAP_PX_H - 1], outline=COLOR_LINE_BLACK, width=3)
    # Half-Court Line
    draw.line([(cx, 0), (cx, cy - r_outer)], fill=COLOR_LINE_BLACK, width=3)
    draw.line([(cx, cy + r_outer), (cx, MAP_PX_H - 1)], fill=COLOR_LINE_BLACK, width=3)

    # Left Key Markings
    draw.rectangle([key_l_x1, key_l_y1, key_l_x2, key_l_y2], outline=COLOR_LINE_BLACK, width=3)
    draw.arc([key_l_x2 - 112, key_l_y1, key_l_x2 + 112, key_l_y2], start=270, end=90, fill=COLOR_LINE_BLACK, width=3)

    # Right Key Markings
    draw.rectangle([key_r_x1, key_r_y1, key_r_x2, key_r_y2], outline=COLOR_LINE_BLACK, width=3)
    draw.arc([key_r_x1 - 112, key_r_y1, key_r_x1 + 112, key_r_y2], start=90, end=270, fill=COLOR_LINE_BLACK, width=3)

    # Left 3-Point Arc
    hoop_l_x, hoop_l_y = 20, 8 * 32
    r_3pt = 320
    draw.arc([hoop_l_x - r_3pt, hoop_l_y - r_3pt, hoop_l_x + r_3pt, hoop_l_y + r_3pt], start=305, end=55, fill=COLOR_LINE_BLACK, width=3)
    draw.line([(0, 45), (hoop_l_x + 190, 45)], fill=COLOR_LINE_BLACK, width=3)
    draw.line([(0, MAP_PX_H - 45), (hoop_l_x + 190, MAP_PX_H - 45)], fill=COLOR_LINE_BLACK, width=3)

    # Right 3-Point Arc
    hoop_r_x, hoop_r_y = MAP_PX_W - 20, 8 * 32
    draw.arc([hoop_r_x - r_3pt, hoop_r_y - r_3pt, hoop_r_x + r_3pt, hoop_r_y + r_3pt], start=125, end=235, fill=COLOR_LINE_BLACK, width=3)
    draw.line([(hoop_r_x - 190, 45), (MAP_PX_W, 45)], fill=COLOR_LINE_BLACK, width=3)
    draw.line([(hoop_r_x - 190, MAP_PX_H - 45), (MAP_PX_W, MAP_PX_H - 45)], fill=COLOR_LINE_BLACK, width=3)

    # 5. Basketball Hoops
    # Left Hoop
    d_l = ImageDraw.Draw(full_img)
    d_l.rectangle([0, hoop_l_y - 12, 10, hoop_l_y + 12], fill=(60, 65, 75, 255))
    d_l.rectangle([10, hoop_l_y - 32, 16, hoop_l_y + 32], fill=(230, 240, 250, 240), outline=(80, 90, 100, 255))
    d_l.ellipse([16, hoop_l_y - 16, 46, hoop_l_y + 16], outline=(230, 60, 20, 255), width=3)
    d_l.ellipse([22, hoop_l_y - 10, 40, hoop_l_y + 10], fill=(255, 255, 255, 190))

    # Right Hoop
    d_r = ImageDraw.Draw(full_img)
    d_r.rectangle([MAP_PX_W - 10, hoop_r_y - 12, MAP_PX_W, hoop_r_y + 12], fill=(60, 65, 75, 255))
    d_r.rectangle([MAP_PX_W - 16, hoop_r_y - 32, MAP_PX_W - 10, hoop_r_y + 32], fill=(230, 240, 250, 240), outline=(80, 90, 100, 255))
    d_r.ellipse([MAP_PX_W - 46, hoop_r_y - 16, MAP_PX_W - 16, hoop_r_y + 16], outline=(230, 60, 20, 255), width=3)
    d_r.ellipse([MAP_PX_W - 40, hoop_r_y - 10, MAP_PX_W - 22, hoop_r_y + 10], fill=(255, 255, 255, 190))

    os.makedirs("./tilesets", exist_ok=True)
    tileset_path = "./tilesets/phamos_game_area.png"
    full_img.save(tileset_path, "PNG")
    print(f"Saved court-only tileset image at {tileset_path} ({MAP_PX_W}x{MAP_PX_H} px)")
    return full_img

def generate_map_tmj():
    """Build TMJ mapping court-only layout grid to cell data."""
    FIRST_GID = 19
    total_tiles = MAP_W * MAP_H
    ground_layer_data = [FIRST_GID + i for i in range(total_tiles)]

    collides_data = [0] * (MAP_W * MAP_H)
    jitsi_data = [0] * (MAP_W * MAP_H)

    GID_COLLIDES_SPECIAL = 3   # tile id 2 -> collides = true
    GID_JITSI_SPECIAL    = 13  # tile id 12 -> jitsiRoom = "phamos-wa-center-meeting"

    for y in range(MAP_H):
        for x in range(MAP_W):
            idx = y * MAP_W + x
            # Outer boundary collisions
            if x == 0 or x == MAP_W - 1 or y == 0 or y == MAP_H - 1:
                collides_data[idx] = GID_COLLIDES_SPECIAL

            # Center circle Jitsi meeting zone (X=13..18, Y=5..10)
            if 13 <= x <= 18 and 5 <= y <= 10:
                jitsi_data[idx] = GID_JITSI_SPECIAL

    map_json = {
        "compressionlevel": -1,
        "height": MAP_H,
        "infinite": False,
        "layers": [
            {
                "data": ground_layer_data,
                "height": MAP_H,
                "id": 1,
                "name": "ground",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": MAP_W,
                "x": 0,
                "y": 0
            },
            {
                "data": jitsi_data,
                "height": MAP_H,
                "id": 2,
                "name": "jitsi-center-meeting",
                "opacity": 1,
                "type": "tilelayer",
                "visible": True,
                "width": MAP_W,
                "x": 0,
                "y": 0
            },
            {
                "data": collides_data,
                "height": MAP_H,
                "id": 3,
                "name": "collides",
                "opacity": 0.5,
                "type": "tilelayer",
                "visible": True,
                "width": MAP_W,
                "x": 0,
                "y": 0
            }
        ],
        "nextlayerid": 4,
        "nextobjectid": 1,
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "tiledversion": "1.11.2",
        "tileheight": TILE_SIZE,
        "tilesets": [
            {
                "columns": 6,
                "firstgid": 1,
                "image": "tilesets/WA_Special_Zones.png",
                "imageheight": 96,
                "imagewidth": 192,
                "margin": 0,
                "name": "WA_Special_Zones",
                "spacing": 0,
                "tilecount": 18,
                "tileheight": 32,
                "tiles": [
                    {
                        "id": 2,
                        "properties": [{"name": "collides", "type": "bool", "value": True}]
                    },
                    {
                        "id": 12,
                        "properties": [{"name": "jitsiRoom", "type": "string", "value": "phamos-wa-center-meeting"}]
                    }
                ],
                "tilewidth": 32
            },
            {
                "columns": MAP_W,
                "firstgid": 19,
                "image": "tilesets/phamos_game_area.png",
                "imageheight": MAP_PX_H,
                "imagewidth": MAP_PX_W,
                "margin": 0,
                "name": "phamos_game_area",
                "spacing": 0,
                "tilecount": total_tiles,
                "tileheight": 32,
                "tilewidth": 32
            }
        ],
        "tilewidth": TILE_SIZE,
        "type": "map",
        "version": "1.10",
        "width": MAP_W
    }

    tmj_path = "./phamos_game_area.tmj"
    with open(tmj_path, "w") as f:
        json.dump(map_json, f, indent=2)
    print(f"Map TMJ saved successfully at {tmj_path}")

if __name__ == "__main__":
    generate_court_image()
    generate_map_tmj()
