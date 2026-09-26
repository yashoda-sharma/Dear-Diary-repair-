/* ============================================================================
   Dear Diary  🎀
   A cozy pixel-art journaling + life-sim app.
   Java 17+ / JavaFX 17+   (closest Java equivalent of the browser spec)

   RUN:
     javac --module-path $JAVAFX/lib --add-modules javafx.controls DearDiaryApp.java
     java  --module-path $JAVAFX/lib --add-modules javafx.controls DearDiaryApp

   Everything is drawn procedurally as real pixel art on 32x32 sprite grids,
   so there are zero external image assets. Saves to ~/.deardiary/save.dat
   ============================================================================ */

import javafx.animation.*;
import javafx.application.Application;
import javafx.geometry.*;
import javafx.scene.*;
import javafx.scene.canvas.*;
import javafx.scene.control.*;
import javafx.scene.image.*;
import javafx.scene.input.*;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.text.*;
import javafx.stage.Stage;
import javafx.util.Duration;

import java.io.*;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

/* ==========================================================================
   1. PIXEL CANVAS — the low level pixel buffer every sprite is painted into
   ========================================================================== */

class PixelCanvas {
    final int w, h;
    final int[] px;

    PixelCanvas(int w, int h) { this.w = w; this.h = h; this.px = new int[w * h]; }

    void set(int x, int y, int argb) {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        if ((argb >>> 24) == 0) return;
        px[y * w + x] = argb;
    }

    void rect(int x0, int y0, int x1, int y1, int c) {
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++) set(x, y, c);
    }

    /** Symmetric filled ellipse inside a bounding box — pixel perfect, no AA. */
    void ellipse(int x0, int y0, int x1, int y1, int c) {
        double cx = (x0 + x1) / 2.0, cy = (y0 + y1) / 2.0;
        double rx = (x1 - x0) / 2.0 + 0.5, ry = (y1 - y0) / 2.0 + 0.5;
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++) {
                double dx = (x - cx) / rx, dy = (y - cy) / ry;
                if (dx * dx + dy * dy <= 1.0) set(x, y, c);
            }
    }

    static int shade(int argb, double f) {
        int a = (argb >>> 24) & 255, r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
        r = Math.min(255, (int) (r * f)); g = Math.min(255, (int) (g * f)); b = Math.min(255, (int) (b * f));
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    static int blend(int a, int b, double t) {
        int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        int br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        return 0xFF000000
                | ((int) (ar + (br - ar) * t) << 16)
                | ((int) (ag + (bg - ag) * t) << 8)
                | (int) (ab + (bb - ab) * t);
    }

    WritableImage toImage() {
        WritableImage img = new WritableImage(w, h);
        img.getPixelWriter().setPixels(0, 0, w, h, PixelFormat.getIntArgbInstance(), px, 0, w);
        return img;
    }
}

/* ==========================================================================
   2. CHARACTER SPEC — every visual property of an avatar / baby
   ========================================================================== */

class CharSpec implements Serializable {
    private static final long serialVersionUID = 1L;

    int skin = 0xFFF2CBA8;
    int hairColor = 0xFF3B2A2A;
    int hairStyle = 0;          // 0 long, 1 bun, 2 ponytail, 3 braids, 4 curly, 5 bob
    int eyeColor = 0xFF4A3B2A;
    int eyeShape = 0;
    boolean lashes = true, blush = true, freckles = false;
    int bodyType = 0;           // 0 slim, 1 curvy, 2 soft

    int topColor = 0xFFFFA6C9;
    int bottomColor = 0xFF7FA8E0;
    int shoeColor = 0xFFFFFFFF;
    boolean dress = false;
    int accessory = 0;          // 0 none 1 shades 2 hoops 3 chain 4 bag 5 hat 6 nails
    int accColor = 0xFFFFD166;

    String key() {
        return skin + "|" + hairColor + "|" + hairStyle + "|" + eyeColor + "|" + eyeShape + "|"
                + (lashes ? 1 : 0) + (blush ? 1 : 0) + (freckles ? 1 : 0) + "|" + bodyType + "|"
                + topColor + "|" + bottomColor + "|" + shoeColor + "|" + (dress ? 1 : 0) + "|"
                + accessory + "|" + accColor;
    }
}

/* ==========================================================================
   3. SPRITES — procedural pixel-art generator (avatar / baby / pets / npc)
   ========================================================================== */

class Sprites {
    static final int POSE_IDLE = 0, POSE_WALK_A = 1, POSE_WALK_B = 2, POSE_SIT = 3,
            POSE_HAPPY = 4, POSE_IDLE2 = 5;

    static final int SIZE = 32;
    static final Map<String, WritableImage> CACHE = new HashMap<>();

    /* ---------------- AVATAR ---------------- */

    static WritableImage avatar(CharSpec s, int pose) {
        String k = "A" + s.key() + "#" + pose;
        WritableImage img = CACHE.get(k);
        if (img == null) {
            PixelCanvas c = new PixelCanvas(SIZE, SIZE);
            drawAvatar(c, s, pose);
            img = c.toImage();
            CACHE.put(k, img);
        }
        return img;
    }

    static void drawAvatar(PixelCanvas c, CharSpec s, int pose) {
        final int skin = s.skin;
        final int skinD = PixelCanvas.shade(skin, 0.82);
        final int top = s.topColor, bot = s.bottomColor, shoe = s.shoeColor;

        boolean sit = pose == POSE_SIT;
        int dy = 0;
        if (pose == POSE_HAPPY) dy = -2;
        if (pose == POSE_IDLE2) dy = 1;

        int tl = 12, tr = 19;
        if (s.bodyType == 1) { tl = 11; tr = 20; }
        if (s.bodyType == 2) { tl = 12; tr = 19; }

        // ---- hair behind head ----
        hairBack(c, s, dy);

        // ---- legs + shoes ----
        if (sit) {
            c.rect(tl + 1, 21 + dy, tr - 1, 24 + dy, s.dress ? top : bot);
            c.rect(tr, 24 + dy, tr + 6, 26 + dy, skin);
            c.rect(tr + 6, 26 + dy, tr + 9, 28 + dy, shoe);
        } else {
            int lL = 12, lR = 17;
            if (pose == POSE_WALK_A) { lL = 11; lR = 18; }
            if (pose == POSE_WALK_B) { lL = 13; lR = 16; }
            int legCol = s.dress ? skin : bot;
            c.rect(lL, 23 + dy, lL + 2, 28 + dy, legCol);
            c.rect(lR, 23 + dy, lR + 2, 28 + dy, legCol);
            c.rect(lL - 1, 29 + dy, lL + 3, 30 + dy, shoe);
            c.rect(lR - 1, 29 + dy, lR + 3, 30 + dy, shoe);
        }

        // ---- torso ----
        c.rect(14, 12 + dy, 17, 13 + dy, skinD);          // neck
        c.rect(tl, 13 + dy, tr, 19 + dy, top);
        c.rect(tl + 1, 14 + dy, tr - 1, 15 + dy, PixelCanvas.shade(top, 1.12)); // highlight

        // ---- bottom / skirt ----
        if (s.dress) {
            c.rect(tl - 1, 19 + dy, tr + 1, 21 + dy, top);
            c.rect(tl - 2, 22 + dy, tr + 2, 22 + dy, PixelCanvas.shade(top, 0.86));
        } else {
            c.rect(tl, 20 + dy, tr, 22 + dy, bot);
            c.rect(tl, 20 + dy, tr, 20 + dy, PixelCanvas.shade(bot, 1.15));
        }

        // ---- arms ----
        int aL = tl - 2, aR = tr + 1;
        if (pose == POSE_WALK_A) aR = tr + 2;
        if (pose == POSE_WALK_B) aL = tl - 3;
        if (sit) { aL = tl - 1; aR = tr; }
        c.rect(aL, 14 + dy, aL + 1, 20 + dy, top);
        c.rect(aR, 14 + dy, aR + 1, 20 + dy, top);
        c.rect(aL, 21 + dy, aL + 1, 22 + dy, skin);
        c.rect(aR, 21 + dy, aR + 1, 22 + dy, skin);

        // ---- head ----
        c.ellipse(11, 3 + dy, 20, 12 + dy, skin);
        c.rect(10, 8 + dy, 10, 9 + dy, skinD);
        c.rect(21, 8 + dy, 21, 9 + dy, skinD);

        // ---- face ----
        int e1 = 13, e2 = 18;
        c.rect(e1, 8 + dy, e1 + 1, 9 + dy, s.eyeColor);
        c.rect(e2, 8 + dy, e2 + 1, 9 + dy, s.eyeColor);
        c.set(e1, 8 + dy, 0xFFFFFFFF);
        c.set(e2, 8 + dy, 0xFFFFFFFF);
        if (s.lashes) {
            c.rect(e1, 7 + dy, e1 + 1, 7 + dy, 0xFF2B2229);
            c.rect(e2, 7 + dy, e2 + 1, 7 + dy, 0xFF2B2229);
        }
        if (s.blush) {
            int b = PixelCanvas.blend(skin, 0xFFFF7FA8, 0.55);
            c.rect(11, 10 + dy, 12, 10 + dy, b);
            c.rect(19, 10 + dy, 20, 10 + dy, b);
        }
        if (s.freckles) {
            c.set(12, 9 + dy, skinD);
            c.set(19, 9 + dy, skinD);
        }
        c.rect(15, 11 + dy, 16, 11 + dy, PixelCanvas.blend(skin, 0xFFB0475F, 0.8));

        // ---- hair front ----
        hairFront(c, s, dy);

        // ---- accessory ----
        drawAccessory(c, s, dy);
    }

    static void hairBack(PixelCanvas c, CharSpec s, int dy) {
        int h = s.hairColor;
        switch (s.hairStyle) {
            case 0: c.rect(11, 5 + dy, 20, 17 + dy, h); break;
            case 1: c.rect(11, 5 + dy, 20, 11 + dy, h); break;
            case 2: c.rect(11, 5 + dy, 20, 13 + dy, h); c.rect(19, 10 + dy, 22, 20 + dy, h); break;
            case 3: c.rect(11, 5 + dy, 20, 13 + dy, h);
                    c.rect(10, 12 + dy, 12, 20 + dy, h);
                    c.rect(19, 12 + dy, 21, 20 + dy, h); break;
            case 4: c.rect(9, 4 + dy, 22, 17 + dy, h); break;
            case 5: c.rect(11, 5 + dy, 20, 14 + dy, h); break;
        }
    }

    static void hairFront(PixelCanvas c, CharSpec s, int dy) {
        int h = s.hairColor, hl = PixelCanvas.shade(h, 1.3);
        c.rect(11, 3 + dy, 20, 5 + dy, h);
        c.rect(10, 6 + dy, 11, 11 + dy, h);
        c.rect(20, 6 + dy, 21, 11 + dy, h);
        c.rect(12, 6 + dy, 19, 7 + dy, h);
        c.rect(13, 4 + dy, 17, 4 + dy, hl);
        switch (s.hairStyle) {
            case 1: c.ellipse(13, 0 + dy, 18, 4 + dy, h); break;
            case 2: c.rect(20, 8 + dy, 22, 17 + dy, h);
                    c.rect(20, 8 + dy, 22, 8 + dy, hl); break;
            case 3: c.rect(9, 10 + dy, 10, 19 + dy, h);
                    c.rect(21, 10 + dy, 22, 19 + dy, h); break;
            case 4: c.ellipse(9, 1 + dy, 22, 7 + dy, h);
                    c.rect(9, 6 + dy, 10, 12 + dy, h);
                    c.rect(21, 6 + dy, 22, 12 + dy, h); break;
            case 5: c.rect(10, 6 + dy, 21, 12 + dy, h);
                    c.rect(12, 6 + dy, 19, 8 + dy, h); break;
        }
    }

    static void drawAccessory(PixelCanvas c, CharSpec s, int dy) {
        int ac = s.accColor;
        switch (s.accessory) {
            case 1: c.rect(11, 8 + dy, 20, 9 + dy, 0xFF2B2230);
                    c.rect(15, 8 + dy, 16, 8 + dy, 0xFF6B5A70); break;
            case 2: c.rect(9, 10 + dy, 9, 12 + dy, ac);
                    c.rect(22, 10 + dy, 22, 12 + dy, ac); break;
            case 3: c.rect(14, 13 + dy, 17, 13 + dy, ac);
                    c.rect(15, 14 + dy, 16, 15 + dy, ac); break;
            case 4: c.rect(21, 17 + dy, 26, 22 + dy, ac);
                    c.rect(22, 15 + dy, 25, 16 + dy, PixelCanvas.shade(ac, 0.7)); break;
            case 5: c.rect(9, 2 + dy, 22, 3 + dy, ac);
                    c.rect(12, 0 + dy, 19, 2 + dy, ac); break;
            case 6: c.rect(10, 22 + dy, 11, 22 + dy, ac);
                    c.rect(20, 22 + dy, 21, 22 + dy, ac); break;
        }
    }

    /* ---------------- BABY ---------------- */

    static WritableImage baby(CharSpec s, int pose) {
        String k = "B" + s.key() + "#" + pose;
        WritableImage img = CACHE.get(k);
        if (img == null) {
            PixelCanvas c = new PixelCanvas(SIZE, SIZE);
            drawBaby(c, s, pose);
            img = c.toImage();
            CACHE.put(k, img);
        }
        return img;
    }

    static void drawBaby(PixelCanvas c, CharSpec s, int pose) {
        int skin = s.skin, skinD = PixelCanvas.shade(skin, 0.85);
        int hop = pose == POSE_HAPPY ? -2 : 0;
        int sw = pose == POSE_WALK_A ? 1 : (pose == POSE_WALK_B ? -1 : 0);

        c.ellipse(10, 5 + hop, 21, 17 + hop, skin);
        c.rect(11, 4 + hop, 20, 7 + hop, s.hairColor);
        c.rect(10, 6 + hop, 10, 13 + hop, s.hairColor);
        c.rect(21, 6 + hop, 21, 13 + hop, s.hairColor);
        c.rect(13, 4 + hop, 16, 4 + hop, PixelCanvas.shade(s.hairColor, 1.3));

        c.rect(12, 10 + hop, 13, 12 + hop, s.eyeColor);
        c.rect(18, 10 + hop, 19, 12 + hop, s.eyeColor);
        c.set(12, 10 + hop, 0xFFFFFFFF);
        c.set(18, 10 + hop, 0xFFFFFFFF);
        int bl = PixelCanvas.blend(skin, 0xFFFF7FA8, 0.5);
        c.rect(10, 13 + hop, 11, 13 + hop, bl);
        c.rect(20, 13 + hop, 20, 13 + hop, bl);
        c.rect(15, 14 + hop, 16, 14 + hop, PixelCanvas.blend(skin, 0xFFB0475F, 0.8));

        c.rect(12, 17 + hop, 19, 23 + hop, s.topColor);
        c.rect(10, 18 + hop, 11, 22 + hop, s.topColor);
        c.rect(20, 18 + hop, 21, 22 + hop, s.topColor);
        c.rect(12 + sw, 24 + hop, 14 + sw, 28 + hop, skinD);
        c.rect(17 - sw, 24 + hop, 19 - sw, 28 + hop, skinD);
        c.rect(11 + sw, 29 + hop, 15 + sw, 30 + hop, s.shoeColor);
        c.rect(16 - sw, 29 + hop, 20 - sw, 30 + hop, s.shoeColor);
    }

    /* ---------------- PETS ---------------- */

    static final String[] PET_TYPES = {"cat", "dog", "bunny", "panda", "fox", "hamster"};

    static WritableImage pet(String type, int pose) {
        String k = "P" + type + "#" + pose;
        WritableImage img = CACHE.get(k);
        if (img == null) {
            PixelCanvas c = new PixelCanvas(SIZE, SIZE);
            drawPet(c, type, pose);
            img = c.toImage();
            CACHE.put(k, img);
        }
        return img;
    }

    static void drawPet(PixelCanvas c, String type, int pose) {
        int body, dark, light;
        switch (type) {
            case "dog":     body = 0xFFD9A066; dark = 0xFFB07C42; light = 0xFFF3DCBB; break;
            case "bunny":   body = 0xFFF7F3F8; dark = 0xFFD8CCE0; light = 0xFFFFFFFF; break;
            case "panda":   body = 0xFFF8F8F8; dark = 0xFF3A3A44; light = 0xFFFFFFFF; break;
            case "fox":     body = 0xFFE8734A; dark = 0xFFB94E2B; light = 0xFFFFE0CC; break;
            case "hamster": body = 0xFFE8C48A; dark = 0xFFC79E63; light = 0xFFFFF1DA; break;
            default:        body = 0xFFFFC48A; dark = 0xFFE29A55; light = 0xFFFFE9CC; break;
        }
        int hop = pose == POSE_HAPPY ? -3 : 0;
        int sw = pose == POSE_WALK_A ? 1 : (pose == POSE_WALK_B ? -1 : 0);

        // tail
        c.rect(4, 14 + hop, 7, 16 + hop, body);
        c.set(4, 13 + hop, dark);

        // body
        c.ellipse(6, 15 + hop, 23, 25 + hop, body);
        c.ellipse(8, 19 + hop, 22, 26 + hop, light);

        // legs
        c.rect(9 + sw, 25 + hop, 11 + sw, 29 + hop, dark);
        c.rect(13, 25 + hop, 15, 29 + hop, dark);
        c.rect(18 - sw, 25 + hop, 20 - sw, 29 + hop, dark);

        // head
        c.ellipse(16, 8 + hop, 29, 20 + hop, body);

        // ears
        switch (type) {
            case "bunny":
                c.rect(18, 0 + hop, 20, 9 + hop, body);
                c.rect(23, 0 + hop, 25, 9 + hop, body);
                c.rect(19, 2 + hop, 19, 7 + hop, PixelCanvas.blend(body, 0xFFFF9BB3, .6));
                break;
            case "dog":
                c.ellipse(15, 10 + hop, 19, 19 + hop, dark);
                break;
            case "panda":
                c.ellipse(16, 4 + hop, 21, 9 + hop, dark);
                c.ellipse(24, 4 + hop, 29, 9 + hop, dark);
                break;
            case "fox":
                c.rect(17, 4 + hop, 19, 9 + hop, body);
                c.rect(25, 4 + hop, 27, 9 + hop, body);
                c.set(18, 4 + hop, light); c.set(26, 4 + hop, light);
                break;
            case "hamster":
                c.ellipse(16, 6 + hop, 20, 10 + hop, body);
                c.ellipse(25, 6 + hop, 29, 10 + hop, body);
                break;
            default: // cat
                c.rect(17, 4 + hop, 19, 9 + hop, body);
                c.rect(25, 4 + hop, 27, 9 + hop, body);
                c.set(18, 6 + hop, PixelCanvas.blend(body, 0xFFFF9BB3, .6));
                c.set(26, 6 + hop, PixelCanvas.blend(body, 0xFFFF9BB3, .6));
        }

        // muzzle + face
        c.ellipse(22, 14 + hop, 29, 19 + hop, light);
        c.rect(24, 12 + hop, 25, 13 + hop, 0xFF2B2229);
        c.set(24, 12 + hop, 0xFFFFFFFF);
        c.set(28, 15 + hop, 0xFF3A2A2A);

        if (pose == POSE_HAPPY) {
            c.rect(24, 2 + hop, 25, 3 + hop, 0xFFFF6F9B);
            c.rect(23, 3 + hop, 26, 3 + hop, 0xFFFF6F9B);
            c.rect(24, 4 + hop, 25, 4 + hop, 0xFFFF6F9B);
        }
    }
}

/* ==========================================================================
   4. CATALOG — every wardrobe item (id, slot, colour, unlock streak)
   ========================================================================== */

class Item implements Serializable {
    private static final long serialVersionUID = 1L;
    String id, name, cat, slot;
    int color, aux, unlock;

    Item(String id, String name, String cat, String slot, int color, int aux, int unlock) {
        this.id = id; this.name = name; this.cat = cat; this.slot = slot;
        this.color = color; this.aux = aux; this.unlock = unlock;
    }
}

class Catalog {
    static final String[] CATS = {
            "Streetwear", "Y2K", "Baddie/Glam", "Cozy/Comfy", "Sporty", "Pastel Princess", "Formal"
    };
    static final List<Item> ITEMS = new ArrayList<>();
    static final Map<String, Item> BY_ID = new HashMap<>();

    static void add(String id, String name, String cat, String slot, int color, int aux, int unlock) {
        Item i = new Item(id, name, cat, slot, color, aux, unlock);
        ITEMS.add(i); BY_ID.put(id, i);
    }

    static {
        // ---- Streetwear ----
        add("sw_hood",   "Oversized Hoodie", "Streetwear", "top",    0xFF7C8AA0, 0, 0);
        add("sw_cargo",  "Cargo Pants",      "Streetwear", "bottom", 0xFF6E7A66, 0, 0);
        add("sw_sneak",  "Chunky Sneakers",  "Streetwear", "shoes",  0xFFEFEFEF, 0, 0);
        add("sw_chain",  "Silver Chain",     "Streetwear", "acc",    0xFFD8DEE9, 3, 2);

        // ---- Y2K ----
        add("y2k_crop",  "Baby Crop Tee",    "Y2K", "top",    0xFFB7E4F5, 0, 0);
        add("y2k_low",   "Low-Rise Jeans",   "Y2K", "bottom", 0xFF6C8FD1, 0, 0);
        add("y2k_shades","Tiny Shades",      "Y2K", "acc",    0xFF3A3340, 1, 1);
        add("y2k_bag",   "Butterfly Bag",    "Y2K", "acc",    0xFFFF9EC4, 4, 3);

        // ---- Baddie / Glam ----
        add("bd_corset", "Corset Top",       "Baddie/Glam", "top",    0xFF3A3340, 0, 3);
        add("bd_leather","Leather Skirt",    "Baddie/Glam", "bottom", 0xFF2B2430, 0, 3);
        add("bd_heels",  "Stiletto Heels",   "Baddie/Glam", "shoes",  0xFFE23E6B, 0, 4);
        add("bd_hoops",  "Big Gold Hoops",   "Baddie/Glam", "acc",    0xFFFFC94A, 2, 2);
        add("bd_nails",  "Acrylic Nails",    "Baddie/Glam", "acc",    0xFFFF6FA5, 6, 1);

        // ---- Cozy / Comfy ----
        add("cz_sweater","Cloud Sweater",    "Cozy/Comfy", "top",    0xFFF6D8E7, 0, 0);
        add("cz_pants",  "Fleece Joggers",   "Cozy/Comfy", "bottom", 0xFFCBBFE0, 0, 0);
        add("cz_slippers","Fuzzy Slippers",  "Cozy/Comfy", "shoes",  0xFFFFC2D6, 0, 0);
        add("cz_hat",    "Knit Beanie",      "Cozy/Comfy", "acc",    0xFFA8E6CF, 5, 1);

        // ---- Sporty ----
        add("sp_jersey", "Team Jersey",      "Sporty", "top",    0xFF9BE0C0, 0, 0);
        add("sp_shorts", "Running Shorts",   "Sporty", "bottom", 0xFF5E6B7A, 0, 0);
        add("sp_trainer","Trainers",         "Sporty", "shoes",  0xFF4FA3E3, 0, 0);

        // ---- Pastel Princess ----
        add("pp_dress",  "Cupcake Dress",    "Pastel Princess", "dress", 0xFFFFC2E0, 0, 0);
        add("pp_tee",    "Bow Tee",          "Pastel Princess", "top",   0xFFFFD6EA, 0, 0);
        add("pp_skirt",  "Tulle Skirt",      "Pastel Princess", "bottom",0xFFE7C6FF, 0, 0);
        add("pp_ballet", "Ballet Flats",     "Pastel Princess", "shoes", 0xFFFFF0F6, 0, 0);
        add("pp_bag",    "Heart Purse",      "Pastel Princess", "acc",   0xFFFF8FB1, 4, 2);

        // ---- Formal ----
        add("fm_gown",   "Silk Gown",        "Formal", "dress",  0xFF6C4AB6, 0, 5);
        add("fm_blazer", "Tailored Blazer",  "Formal", "top",    0xFF2F3E57, 0, 4);
        add("fm_trouser","Wide Trousers",    "Formal", "bottom", 0xFF37475E, 0, 4);
        add("fm_heels",  "Satin Heels",      "Formal", "shoes",  0xFFEFD9FF, 0, 4);
    }

    static List<Item> byCat(String cat) {
        List<Item> out = new ArrayList<>();
        for (Item i : ITEMS) if (i.cat.equals(cat)) out.add(i);
        return out;
    }

    static final List<String> STARTER = Arrays.asList(
            "sw_hood", "sw_cargo", "sw_sneak", "y2k_crop", "y2k_low",
            "cz_sweater", "cz_pants", "cz_slippers", "sp_jersey", "sp_shorts",
            "sp_trainer", "pp_dress", "pp_tee", "pp_skirt", "pp_ballet"
    );
}

/* ==========================================================================
   5. GAME STATE + SAVE
   ========================================================================== */

class Stroke implements Serializable {
    private static final long serialVersionUID = 1L;
    int color, size;
    List<int[]> pts = new ArrayList<>();
}

class Entry implements Serializable {
    private static final long serialVersionUID = 1L;
    String day = "";
    String mood = "";
    String text = "";
    List<Stroke> doodle = new ArrayList<>();
    boolean complete = false;
}

class GameState implements Serializable {
    private static final long serialVersionUID = 1L;

    CharSpec avatar = new CharSpec();
    CharSpec baby = new CharSpec();
    String babyName = "";
    boolean babyAdopted = false;

    String petType = "";
    String petName = "";
    boolean petAdopted = false;

    Set<String> owned = new HashSet<>(Catalog.STARTER);
    String eqTop = "pp_tee", eqBottom = "pp_skirt", eqShoes = "pp_ballet", eqAcc = "none";
    String eqDress = "pp_dress";
    boolean wearingDress = true;

    Map<String, Entry> journal = new HashMap<>();
    int streak = 0;
    String lastJournalDay = "";
    boolean fedToday = false;
    boolean walkedToday = false;
    int totalEntries = 0;

    void syncOutfit() {
        if (wearingDress && Catalog.BY_ID.containsKey(eqDress)) {
            Item d = Catalog.BY_ID.get(eqDress);
            avatar.dress = true;
            avatar.topColor = d.color;
            avatar.shoeColor = itemColor(eqShoes);
        } else {
            avatar.dress = false;
            avatar.topColor = itemColor(eqTop);
            avatar.bottomColor = itemColor(eqBottom);
            avatar.shoeColor = itemColor(eqShoes);
        }
        Item a = Catalog.BY_ID.get(eqAcc);
        if (a == null || !owned.contains(eqAcc)) { avatar.accessory = 0; }
        else { avatar.accessory = a.aux; avatar.accColor = a.color; }
    }

    int itemColor(String id) {
        Item i = Catalog.BY_ID.get(id);
        return i == null ? 0xFFFFFFFF : i.color;
    }

    boolean isOwned(String id) { return owned.contains(id); }
}

class Save {
    static final File DIR = new File(System.getProperty("user.home"), ".deardiary");
    static final File FILE = new File(DIR, "save.dat");

    static GameState load() {
        try {
            if (FILE.exists()) {
                try (ObjectInputStream in = new ObjectInputStream(new FileInputStream(FILE))) {
                    GameState s = (GameState) in.readObject();
                    s.syncOutfit();
                    return s;
                }
            }
        } catch (Exception e) { System.err.println("Save load failed: " + e); }
        GameState s = new GameState();
        s.syncOutfit();
        return s;
    }

    static void save(GameState s) {
        try {
            DIR.mkdirs();
            try (ObjectOutputStream out = new ObjectOutputStream(new FileOutputStream(FILE))) {
                out.writeObject(s);
            }
        } catch (Exception e) { System.err.println("Save failed: " + e); }
    }
}

/* ==========================================================================
   6. APP SHELL + PAGE BASE
   ========================================================================== */

abstract class Page extends StackPane {
    Page() { setAlignment(Pos.CENTER); setPadding(new Insets(16)); }
    void onEnter() {}
    void onExit() {}
    void onKey(KeyEvent e) {}
}

public class DearDiaryApp extends Application {

    static GameState S;
    static StackPane root;
    static Stage stage;
    static Page current;
    static final Set<KeyCode> KEYS = new HashSet<>();

    static final String PINK = "#FF8FB1";
    static final String LAV  = "#C9A7FF";
    static final String MINT = "#7FD8B4";
    static final String GOLD = "#FFC94A";

    @Override
    public void start(Stage st) {
        stage = st;
        S = Save.load();

        root = new StackPane();
        root.setStyle("-fx-background-color: linear-gradient(to bottom, #FFF0F7 0%, #F4E9FF 45%, #E3F7EF 100%);");

        Scene scene = new Scene(root, 430, 800);
        scene.setOnKeyPressed(e -> { KEYS.add(e.getCode()); if (current != null) current.onKey(e); });
        scene.setOnKeyReleased(e -> KEYS.remove(e.getCode()));

        stage.setScene(scene);
        stage.setTitle("Dear Diary");
        stage.setMinWidth(360);
        stage.setMinHeight(620);
        go(new HomePage());
        stage.show();
    }

    @Override public void stop() { Save.save(S); }

    static void go(Page p) {
        Page old = current;
        current = p;
        if (old != null) {
            old.onExit();
            FadeTransition out = new FadeTransition(Duration.millis(200), old);
            out.setFromValue(1); out.setToValue(0);
            out.setOnFinished(e -> root.getChildren().remove(old));
            out.play();
        }
        p.setOpacity(0);
        root.getChildren().add(p);
        FadeTransition in = new FadeTransition(Duration.millis(320), p);
        in.setFromValue(0); in.setToValue(1);
        in.setInterpolator(Interpolator.EASE_OUT);
        in.play();
        p.onEnter();
    }

    /* ------------------------- shared cute widgets ------------------------- */

    static Button cute(String text, String bg) {
        Button b = new Button(text);
        b.setStyle("-fx-background-color: " + bg + "; -fx-text-fill: white;"
                + "-fx-font-size: 15px; -fx-font-weight: bold; -fx-background-radius: 22;"
                + "-fx-padding: 10 22 10 22; -fx-cursor: hand;"
                + "-fx-effect: dropshadow(gaussian, rgba(150,110,170,0.35), 10, 0, 0, 4);");
        b.setOnMouseEntered(e -> b.setScaleX(1.05));
        b.setOnMouseExited(e -> b.setScaleX(1.0));
        return b;
    }

    static VBox card() {
        VBox v = new VBox(12);
        v.setAlignment(Pos.CENTER);
        v.setStyle("-fx-background-color: rgba(255,255,255,0.86);"
                + "-fx-background-radius: 26; -fx-padding: 18;"
                + "-fx-effect: dropshadow(gaussian, rgba(180,150,200,0.35), 18, 0, 0, 6);");
        return v;
    }

    static Label title(String t, int size, String color) {
        Label l = new Label(t);
        l.setStyle("-fx-font-size: " + size + "px; -fx-font-weight: bold; -fx-text-fill: " + color + ";");
        return l;
    }

    static ScrollPane scroll(Node n) {
        ScrollPane sp = new ScrollPane(n);
        sp.setFitToWidth(true);
        sp.setStyle("-fx-background: transparent; -fx-background-color: transparent;");
        sp.setHbarPolicy(ScrollPane.ScrollBarPolicy.NEVER);
        return sp;
    }

    static String today() { return LocalDate.now().toString(); }

    static void updateStreak() {
        String t = today();
        if (S.lastJournalDay.equals(t)) return;
        LocalDate last = S.lastJournalDay.isEmpty() ? null : LocalDate.parse(S.lastJournalDay);
        if (last != null && ChronoUnit.DAYS.between(last, LocalDate.now()) == 1) S.streak++;
        else S.streak = 1;
        S.lastJournalDay = t;
    }
}

/* ==========================================================================
   7. HOME PAGE
   ========================================================================== */

class HomePage extends Page {

    ImageView avatarView = new ImageView();
    ImageView petView = new ImageView();
    ImageView babyView = new ImageView();
    Label statusLbl = new Label();
    Button walkBtn;
    int tick = 0;

    HomePage() {
        VBox col = new VBox(12);
        col.setAlignment(Pos.CENTER);

        col.getChildren().add(DearDiaryApp.title("Dear Diary", 32, "#B85C8A"));
        Label sub = new Label("a cozy little world that is all yours");
        sub.setStyle("-fx-font-size: 13px; -fx-text-fill: #9A7FB0;");
        col.getChildren().add(sub);

        // --- sprite stage ---
        StackPane stagePane = new StackPane();
        stagePane.setPrefSize(300, 170);
        stagePane.setStyle("-fx-background-color: linear-gradient(to bottom, #FFF6FB, #EDE2FF);"
                + "-fx-background-radius: 24; -fx-effect: innershadow(gaussian, rgba(180,150,200,.25), 12, 0, 0, 3);");

        avatarView.setFitWidth(128); avatarView.setFitHeight(128);
        petView.setFitWidth(76);     petView.setFitHeight(76);
        babyView.setFitWidth(76);    babyView.setFitHeight(76);
        avatarView.setImage(Sprites.avatar(DearDiaryApp.S.avatar, Sprites.POSE_IDLE));

        HBox row = new HBox(6);
        row.setAlignment(Pos.BOTTOM_CENTER);
        if (DearDiaryApp.S.babyAdopted) {
            babyView.setImage(Sprites.baby(DearDiaryApp.S.baby, Sprites.POSE_IDLE));
            row.getChildren().add(babyView);
        }
        row.getChildren().add(avatarView);
        if (DearDiaryApp.S.petAdopted) {
            petView.setImage(Sprites.pet(DearDiaryApp.S.petType, Sprites.POSE_IDLE));
            row.getChildren().add(petView);
        }
        stagePane.getChildren().add(row);
        col.getChildren().add(stagePane);

        statusLbl.setStyle("-fx-font-size: 13px; -fx-text-fill: #8A6EA8; -fx-text-alignment: center;");
        col.getChildren().add(statusLbl);

        // --- actions ---
        VBox buttons = new VBox(9);
        buttons.setAlignment(Pos.CENTER);

        Button j = DearDiaryApp.cute("Journal", DearDiaryApp.PINK);
        j.setMaxWidth(220);
        j.setOnAction(e -> DearDiaryApp.go(new JournalPage()));

        Button w = DearDiaryApp.cute("Wardrobe", DearDiaryApp.LAV);
        w.setMaxWidth(220);
        w.setOnAction(e -> DearDiaryApp.go(new WardrobePage()));

        Button a = DearDiaryApp.cute("Edit Avatar", "#8FBFE0");
        a.setMaxWidth(220);
        a.setOnAction(e -> DearDiaryApp.go(new AvatarPage()));

        Button p = DearDiaryApp.cute("Pet House", DearDiaryApp.MINT);
        p.setMaxWidth(220);
        p.setOnAction(e -> DearDiaryApp.go(new PetHousePage()));

        walkBtn = DearDiaryApp.cute("Take a Walk", "#F2A65A");
        walkBtn.setMaxWidth(220);
        walkBtn.setOnAction(e -> DearDiaryApp.go(new WalkPage()));

        Button care = DearDiaryApp.cute("Care Routine", "#E58BC4");
        care.setMaxWidth(220);
        care.setOnAction(e -> DearDiaryApp.go
