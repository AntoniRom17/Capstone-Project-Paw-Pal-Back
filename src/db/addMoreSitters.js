import bcrypt from "bcrypt";
import { pool } from "./client.js";

const DEMO_PASSWORD = "PawPal123!";

const NEW_SITTERS = [
  {
    name: "Emily Turner",
    email: "emily@example.com",
    bio: "Certified vet assistant who loves senior dogs and cats.",
    phone: "555-0204",
    city: "Chicago",
    state: "IL",
    zipCode: "60614",
    backgroundCheckStatus: "verified",
    services: [
      { service: "Pet Sitting", priceOverride: null },
      { service: "Dog Walking", priceOverride: 24 },
    ],
  },
  {
    name: "Marcus Bell",
    email: "marcus@example.com",
    bio: "Former shelter volunteer, great with anxious or reactive dogs.",
    phone: "555-0205",
    city: "Oak Park",
    state: "IL",
    zipCode: "60301",
    backgroundCheckStatus: "verified",
    services: [
      { service: "Dog Walking", priceOverride: null },
      { service: "Overnight Boarding", priceOverride: 58 },
    ],
  },
  {
    name: "Aisha Khan",
    email: "aisha@example.com",
    bio: "Works part-time from home, offers flexible daytime pet sitting.",
    phone: "555-0206",
    city: "Evanston",
    state: "IL",
    zipCode: "60202",
    backgroundCheckStatus: "pending",
    services: [{ service: "Pet Sitting", priceOverride: 26 }],
  },
  {
    name: "Daniel Osei",
    email: "daniel@example.com",
    bio: "Marathon runner offering long, high-energy dog walks.",
    phone: "555-0207",
    city: "Chicago",
    state: "IL",
    zipCode: "60607",
    backgroundCheckStatus: "not_submitted",
    services: [{ service: "Dog Walking", priceOverride: 20 }],
  },
  {
    name: "Grace Lin",
    email: "grace@example.com",
    bio: "Boards small dogs and cats overnight in a quiet, pet-proofed home.",
    phone: "555-0208",
    city: "Skokie",
    state: "IL",
    zipCode: "60076",
    backgroundCheckStatus: "verified",
    services: [
      { service: "Overnight Boarding", priceOverride: null },
      { service: "Pet Sitting", priceOverride: 27 },
    ],
  },
  {
    name: "Olivia Ramirez",
    email: "olivia@example.com",
    bio: "Cat-only sitter with a calm, quiet home. Experienced with shy and senior cats.",
    phone: "555-0209",
    city: "Chicago",
    state: "IL",
    zipCode: "60618",
    backgroundCheckStatus: "verified",
    services: [{ service: "Pet Sitting", priceOverride: 25 }],
  },
  {
    name: "Ben Whitfield",
    email: "ben@example.com",
    bio: "Avian specialist offering in-home visits for parrots, cockatiels, and other birds.",
    phone: "555-0210",
    city: "Evanston",
    state: "IL",
    zipCode: "60201",
    backgroundCheckStatus: "verified",
    services: [{ service: "Pet Sitting", priceOverride: 24 }],
  },
  {
    name: "Nadia Farouk",
    email: "nadia@example.com",
    bio: "Small-mammal lover caring for rabbits, guinea pigs, and hamsters in your home.",
    phone: "555-0211",
    city: "Oak Park",
    state: "IL",
    zipCode: "60301",
    backgroundCheckStatus: "pending",
    services: [{ service: "Pet Sitting", priceOverride: 22 }],
  },
  {
    name: "Tyler Brooks",
    email: "tyler@example.com",
    bio: "Reptile and aquarium keeper, comfortable with snakes, lizards, and fish tank upkeep.",
    phone: "555-0212",
    city: "Chicago",
    state: "IL",
    zipCode: "60622",
    backgroundCheckStatus: "not_submitted",
    services: [{ service: "Pet Sitting", priceOverride: 23 }],
  },
];

async function insertSitterService(client, sitterId, serviceId, priceOverride) {
  await client.query(
    `
    INSERT INTO sitter_services (sitter_id, service_id, price_override)
    VALUES ($1, $2, $3);
    `,
    [sitterId, serviceId, priceOverride],
  );
}

async function insertAvailability(client, sitterId, dayOffset, startTime, endTime) {
  await client.query(
    `
    INSERT INTO availability (sitter_id, date, start_time, end_time, is_booked)
    VALUES ($1, CURRENT_DATE + $2::integer, $3, $4, false);
    `,
    [sitterId, dayOffset, startTime, endTime],
  );
}

async function run() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const { rows: services } = await client.query(
      "SELECT id, name FROM services;",
    );
    const serviceIdByName = Object.fromEntries(
      services.map((service) => [service.name, service.id]),
    );

    for (const sitter of NEW_SITTERS) {
      const { rows } = await client.query(
        `
        INSERT INTO users (
          name, email, password_hash, role, bio, phone,
          city, state, zip_code, background_check_status
        )
        VALUES ($1, $2, $3, 'sitter', $4, $5, $6, $7, $8, $9)
        ON CONFLICT (email) DO NOTHING
        RETURNING id;
        `,
        [
          sitter.name,
          sitter.email,
          passwordHash,
          sitter.bio,
          sitter.phone,
          sitter.city,
          sitter.state,
          sitter.zipCode,
          sitter.backgroundCheckStatus,
        ],
      );

      if (rows.length === 0) {
        console.log(`Skipped (already exists): ${sitter.name}`);
        continue;
      }

      const sitterId = rows[0].id;

      for (const { service, priceOverride } of sitter.services) {
        await insertSitterService(
          client,
          sitterId,
          serviceIdByName[service],
          priceOverride,
        );
      }

      await insertAvailability(client, sitterId, 1, "09:00", "10:00");
      await insertAvailability(client, sitterId, 2, "13:00", "14:00");
      await insertAvailability(client, sitterId, 4, "16:00", "17:00");

      console.log(`Added sitter: ${sitter.name} (id ${sitterId})`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Failed to add sitters:", error);
  process.exit(1);
});
