/**
 * Ground sprites (work package WP5): one 26 x 28 sprite per terrain, filling
 * exactly the pixel hexagon (geometry.ts `isInsideHex`), with the faint grid
 * hint on the lower and right edges.
 *
 * To draw, from docs/art/style-d-reference.svg:
 *  - ground.ocean     (group "o"): base PALETTE.oceanBase with wave dashes;
 *  - ground.coast     (group "c"): base PALETTE.coastBase with wave dashes;
 *  - ground.grassland (group "g"): base PALETTE.grassBase with tufts;
 *  - ground.plains    (group "p"): base PALETTE.plainsBase with stalks;
 *  - ground.desert    (group "d"): base PALETTE.desertBase with dunes and a cactus.
 * A few variants per terrain, picked by tile index, keep large areas from
 * looking stamped (optional).
 */

export {};
