import { pool } from "./client.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const REQUEST_DELAY_MS = 1100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeZip(zipCode) {
  const url = `${NOMINATIM_URL}?postalcode=${encodeURIComponent(
    zipCode,
  )}&country=US&format=json&limit=1`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "PawPal-Capstone-Project (student project, no contact)",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed: ${response.status}`);
  }

  const results = await response.json();
  return results[0] || null;
}

async function run() {
  const client = await pool.connect();

  try {
    const { rows: sitters } = await client.query(
      `
      SELECT id, name, zip_code AS "zipCode"
      FROM users
      WHERE role = 'sitter'
        AND latitude IS NULL
        AND zip_code IS NOT NULL;
      `,
    );

    console.log(`Geocoding ${sitters.length} sitter(s)...`);

    for (const sitter of sitters) {
      try {
        const result = await geocodeZip(sitter.zipCode);

        if (!result) {
          console.log(
            `No geocoding result for ${sitter.name} (zip ${sitter.zipCode})`,
          );
          continue;
        }

        await client.query(
          `
          UPDATE users
          SET latitude = $1, longitude = $2
          WHERE id = $3;
          `,
          [result.lat, result.lon, sitter.id],
        );

        console.log(
          `Geocoded ${sitter.name}: ${result.lat}, ${result.lon}`,
        );
      } catch (error) {
        console.error(`Failed to geocode ${sitter.name}:`, error.message);
      }

      await sleep(REQUEST_DELAY_MS);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Geocoding failed:", error);
  process.exit(1);
});
