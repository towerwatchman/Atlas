#!/usr/bin/env node
/*
 * GOG API probe — run this to capture the REAL shape of a GOG product response
 * so we can fix image URL building against ground truth instead of guessing.
 *
 * Usage:
 *   node scripts/gog-api-probe.js 1207658930
 *   node scripts/gog-api-probe.js 1207658930 > gog-sample.json
 *
 * Pick any GOG product id you have installed (the number in the
 * goggame-<id>.info filename, or from the store URL gog.com/game/<slug>—use the
 * numeric id the importer shows). Paste the "IMAGE FIELDS" section back to me.
 */

const id = process.argv[2] || "1207658930"; // default: The Witcher: Enhanced Edition

async function main() {
  const v1url = `https://api.gog.com/products/${id}?expand=description,screenshots,videos,downloads&locale=en-US`;
  const v2url = `https://api.gog.com/v2/games/${id}?locale=en-US`;

  console.log("=== V1:", v1url);
  const v1 = await (await fetch(v1url)).json();

  console.log("\n--- IMAGE FIELDS (v1 data.images) ---");
  console.log(JSON.stringify(v1.images || null, null, 2));

  console.log("\n--- SCREENSHOTS (first 2 raw) ---");
  console.log(JSON.stringify((v1.screenshots || []).slice(0, 2), null, 2));

  console.log("\n--- VIDEOS (first 2 raw) ---");
  console.log(JSON.stringify((v1.videos || []).slice(0, 2), null, 2));

  console.log("\n--- TOP-LEVEL KEYS ---");
  console.log(Object.keys(v1).join(", "));

  console.log("\n--- title / release_date / game_type ---");
  console.log(JSON.stringify({
    title: v1.title,
    release_date: v1.release_date,
    game_type: v1.game_type,
    content_system_compatibility: v1.content_system_compatibility,
  }, null, 2));

  try {
    console.log("\n=== V2:", v2url);
    const v2 = await (await fetch(v2url)).json();
    const emb = v2._embedded || {};
    console.log("\n--- V2 _embedded keys ---");
    console.log(Object.keys(emb).join(", "));
    console.log("\n--- V2 _links.* image-ish keys ---");
    console.log(Object.keys(v2._links || {}).filter((k) => /image|logo|background|boxart|icon/i.test(k)).join(", ") || "(none)");
    console.log("\n--- V2 product images sample ---");
    console.log(JSON.stringify({
      logo: v2._links?.logo || null,
      boxArtImage: v2._links?.boxArtImage || null,
      background: v2._links?.background || null,
      galaxyBackgroundImage: v2._links?.galaxyBackgroundImage || null,
      icon: v2._links?.icon || null,
    }, null, 2));
  } catch (e) {
    console.log("v2 fetch failed:", e.message);
  }
}

main().catch((e) => {
  console.error("Probe failed:", e);
  process.exit(1);
});
