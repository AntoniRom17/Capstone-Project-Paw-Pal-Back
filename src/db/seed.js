import bcrypt from "bcrypt";
import { pool } from "./client.js";

const DEMO_PASSWORD = "PawPal123!";

async function insertSitterService(
  client,
  sitterId,
  serviceId,
  priceOverride,
) {
  const { rows } = await client.query(
    `
    INSERT INTO sitter_services (
      sitter_id,
      service_id,
      price_override
    )
    VALUES ($1, $2, $3)
    RETURNING id;
    `,
    [sitterId, serviceId, priceOverride],
  );

  return rows[0].id;
}

async function insertAvailability(
  client,
  sitterId,
  dayOffset,
  startTime,
  endTime,
  isBooked,
) {
  const { rows } = await client.query(
    `
    INSERT INTO availability (
      sitter_id,
      date,
      start_time,
      end_time,
      is_booked
    )
    VALUES (
      $1,
      CURRENT_DATE + $2::integer,
      $3,
      $4,
      $5
    )
    RETURNING id;
    `,
    [sitterId, dayOffset, startTime, endTime, isBooked],
  );

  return rows[0].id;
}

async function insertBooking(
  client,
  {
    ownerId,
    sitterId,
    petId,
    sitterServiceId,
    availabilityId,
    status,
  },
) {
  const { rows } = await client.query(
    `
    INSERT INTO bookings (
      owner_id,
      sitter_id,
      pet_id,
      sitter_service_id,
      availability_id,
      date,
      start_time,
      end_time,
      status,
      total_price
    )
    SELECT
      $1,
      $2,
      $3,
      $4,
      $5,
      availability.date,
      availability.start_time,
      availability.end_time,
      $6,
      COALESCE(
        sitter_services.price_override,
        services.base_price
      )
    FROM availability
    JOIN sitter_services
      ON sitter_services.id = $4
    JOIN services
      ON services.id = sitter_services.service_id
    WHERE availability.id = $5
    RETURNING id, status;
    `,
    [
      ownerId,
      sitterId,
      petId,
      sitterServiceId,
      availabilityId,
      status,
    ],
  );

  if (!rows[0]) {
    throw new Error("Unable to create seeded booking");
  }

  return rows[0];
}

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const { rows: users } = await client.query(
      `
      INSERT INTO users (
        name,
        email,
        password_hash,
        role,
        bio,
        phone,
        city,
        state,
        zip_code,
        trust_score,
        background_check_status,
        on_time_percentage
      )
      VALUES
        (
          'Maya Rodriguez',
          'maya@example.com',
          $1,
          'owner',
          'Dog mom of two. Travels frequently for work.',
          '555-0101',
          'Chicago',
          'IL',
          '60601',
          NULL,
          'not_submitted',
          NULL
        ),
        (
          'James Chen',
          'james@example.com',
          $1,
          'owner',
          'First-time cat owner.',
          '555-0102',
          'Chicago',
          'IL',
          '60610',
          NULL,
          'not_submitted',
          NULL
        ),
        (
          'Priya Patel',
          'priya@example.com',
          $1,
          'owner',
          'Needs weekday walks for Biscuit.',
          '555-0103',
          'Evanston',
          'IL',
          '60201',
          NULL,
          'not_submitted',
          NULL
        ),
        (
          'Sarah Mitchell',
          'sarah@example.com',
          $1,
          'sitter',
          'Vet tech student with five years of dog walking experience.',
          '555-0201',
          'Chicago',
          'IL',
          '60601',
          94,
          'verified',
          98
        ),
        (
          'Jordan Kim',
          'jordan@example.com',
          $1,
          'sitter',
          'Works from home and provides attentive pet care.',
          '555-0202',
          'Chicago',
          'IL',
          '60610',
          91,
          'verified',
          96
        ),
        (
          'Luis Ortega',
          'luis@example.com',
          $1,
          'sitter',
          'Runner specializing in high-energy dogs.',
          '555-0203',
          'Evanston',
          'IL',
          '60201',
          89,
          'pending',
          95
        )
      RETURNING id, name, role;
      `,
      [passwordHash],
    );

    const maya = users.find((user) => user.name === "Maya Rodriguez");
    const james = users.find((user) => user.name === "James Chen");
    const priya = users.find((user) => user.name === "Priya Patel");
    const sarah = users.find((user) => user.name === "Sarah Mitchell");
    const jordan = users.find((user) => user.name === "Jordan Kim");
    const luis = users.find((user) => user.name === "Luis Ortega");

    const { rows: pets } = await client.query(
      `
      INSERT INTO pets (
        owner_id,
        name,
        species,
        breed,
        age,
        care_notes
      )
      VALUES
        (
          $1,
          'Rocky',
          'dog',
          'Boxer',
          4,
          'Pulls on leash. Treats are in the blue jar.'
        ),
        (
          $1,
          'Luna',
          'dog',
          'Corgi',
          2,
          'Friendly with everyone. Allergic to chicken.'
        ),
        (
          $2,
          'Mochi',
          'cat',
          'Ragdoll',
          1,
          'Indoor only. Hides under the bed with strangers.'
        ),
        (
          $3,
          'Biscuit',
          'dog',
          'Golden Retriever',
          6,
          'Arthritis medication is given at 5 PM.'
        )
      RETURNING id, name;
      `,
      [maya.id, james.id, priya.id],
    );

    const rocky = pets.find((pet) => pet.name === "Rocky");
    const luna = pets.find((pet) => pet.name === "Luna");
    const mochi = pets.find((pet) => pet.name === "Mochi");
    const biscuit = pets.find((pet) => pet.name === "Biscuit");

    const { rows: services } = await client.query(`
      INSERT INTO services (
        name,
        description,
        base_price
      )
      VALUES
        (
          'Dog Walking',
          '30-minute neighborhood walk',
          22.00
        ),
        (
          'Pet Sitting',
          'In-home feeding, play, and potty visit',
          28.00
        ),
        (
          'Overnight Boarding',
          'The pet stays at the sitter home',
          55.00
        )
      RETURNING id, name;
    `);

    const walking = services.find(
      (service) => service.name === "Dog Walking",
    );
    const sitting = services.find(
      (service) => service.name === "Pet Sitting",
    );
    const boarding = services.find(
      (service) => service.name === "Overnight Boarding",
    );

    const sarahWalking = await insertSitterService(
      client,
      sarah.id,
      walking.id,
      null,
    );
    await insertSitterService(client, sarah.id, sitting.id, 30);
    const jordanSitting = await insertSitterService(
      client,
      jordan.id,
      sitting.id,
      null,
    );
    const jordanBoarding = await insertSitterService(
      client,
      jordan.id,
      boarding.id,
      60,
    );
    const luisWalking = await insertSitterService(
      client,
      luis.id,
      walking.id,
      25,
    );

    const completedSlot = await insertAvailability(
      client,
      luis.id,
      -3,
      "17:00",
      "17:30",
      true,
    );
    const acceptedSlot = await insertAvailability(
      client,
      sarah.id,
      1,
      "09:00",
      "09:30",
      true,
    );
    const pendingSlot = await insertAvailability(
      client,
      jordan.id,
      3,
      "10:00",
      "11:00",
      false,
    );
    const cancelledSlot = await insertAvailability(
      client,
      jordan.id,
      -10,
      "08:00",
      "20:00",
      false,
    );

    await insertAvailability(
      client,
      sarah.id,
      2,
      "09:00",
      "12:00",
      false,
    );
    await insertAvailability(
      client,
      jordan.id,
      1,
      "14:00",
      "18:00",
      false,
    );
    await insertAvailability(
      client,
      luis.id,
      1,
      "06:00",
      "08:00",
      false,
    );
    await insertAvailability(
      client,
      luis.id,
      2,
      "17:00",
      "19:00",
      false,
    );

    const completedBooking = await insertBooking(client, {
      ownerId: priya.id,
      sitterId: luis.id,
      petId: biscuit.id,
      sitterServiceId: luisWalking,
      availabilityId: completedSlot,
      status: "completed",
    });

    await insertBooking(client, {
      ownerId: maya.id,
      sitterId: sarah.id,
      petId: rocky.id,
      sitterServiceId: sarahWalking,
      availabilityId: acceptedSlot,
      status: "accepted",
    });

    await insertBooking(client, {
      ownerId: james.id,
      sitterId: jordan.id,
      petId: mochi.id,
      sitterServiceId: jordanSitting,
      availabilityId: pendingSlot,
      status: "pending",
    });

    await insertBooking(client, {
      ownerId: maya.id,
      sitterId: jordan.id,
      petId: luna.id,
      sitterServiceId: jordanBoarding,
      availabilityId: cancelledSlot,
      status: "cancelled",
    });

    await client.query(
      `
      INSERT INTO reviews (
        booking_id,
        reviewer_id,
        rating,
        comment
      )
      VALUES ($1, $2, 5, $3);
      `,
      [
        completedBooking.id,
        priya.id,
        "Luis was reliable, sent photos, and arrived on time.",
      ],
    );

    await client.query("COMMIT");

    console.log("Database seeded successfully.");
    console.log(`Demo account password: ${DEMO_PASSWORD}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });