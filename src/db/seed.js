import bcrypt from "bcrypt";
import { pool } from "./client.js";
import { recalculateSitterTrustMetrics } from "../utils/trustMetrics.js";

const DEMO_PASSWORD = "PawPal123!";

const DEMO_USERS = [
  {
    name: "Maya Rodriguez",
    email: "maya@example.com",
    role: "owner",
    bio: "Dog mom of two. Travels frequently for work.",
    phone: "555-0101",
    city: "Chicago",
    state: "IL",
    zipCode: "60601",
    backgroundCheckStatus: "not_submitted",
  },
  {
    name: "James Chen",
    email: "james@example.com",
    role: "owner",
    bio: "First-time cat owner.",
    phone: "555-0102",
    city: "Chicago",
    state: "IL",
    zipCode: "60610",
    backgroundCheckStatus: "not_submitted",
  },
  {
    name: "Priya Patel",
    email: "priya@example.com",
    role: "owner",
    bio: "Needs weekday walks for Biscuit.",
    phone: "555-0103",
    city: "Evanston",
    state: "IL",
    zipCode: "60201",
    backgroundCheckStatus: "not_submitted",
  },
  {
    name: "Sarah Mitchell",
    email: "sarah@example.com",
    role: "sitter",
    bio: "Vet tech student with five years of dog walking experience.",
    phone: "555-0201",
    city: "Chicago",
    state: "IL",
    zipCode: "60601",
    backgroundCheckStatus: "verified",
  },
  {
    name: "Jordan Kim",
    email: "jordan@example.com",
    role: "sitter",
    bio: "Works from home and provides attentive pet care.",
    phone: "555-0202",
    city: "Chicago",
    state: "IL",
    zipCode: "60610",
    backgroundCheckStatus: "verified",
  },
  {
    name: "Luis Ortega",
    email: "luis@example.com",
    role: "sitter",
    bio: "Runner specializing in high-energy dogs.",
    phone: "555-0203",
    city: "Evanston",
    state: "IL",
    zipCode: "60201",
    backgroundCheckStatus: "pending",
  },
];

const DEMO_EMAILS = DEMO_USERS.map((user) => user.email);

async function getExistingDemoAccountCount(client) {
  const { rows } = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM users
    WHERE email = ANY($1::text[]);
    `,
    [DEMO_EMAILS],
  );

  return rows[0].count;
}

async function insertUser(client, user, passwordHash) {
  const { rows } = await client.query(
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
      background_check_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, name, email, role;
    `,
    [
      user.name,
      user.email,
      passwordHash,
      user.role,
      user.bio,
      user.phone,
      user.city,
      user.state,
      user.zipCode,
      user.backgroundCheckStatus,
    ],
  );

  return rows[0];
}

async function upsertService(client, { name, description, basePrice }) {
  const { rows } = await client.query(
    `
    INSERT INTO services (
      name,
      description,
      base_price
    )
    VALUES ($1, $2, $3)
    ON CONFLICT (name)
    DO UPDATE SET
      description = EXCLUDED.description,
      base_price = EXCLUDED.base_price
    RETURNING id, name;
    `,
    [name, description, basePrice],
  );

  return rows[0];
}

async function insertPet(
  client,
  { ownerId, name, species, breed, age, careNotes },
) {
  const { rows } = await client.query(
    `
    INSERT INTO pets (
      owner_id,
      name,
      species,
      breed,
      age,
      care_notes
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, name;
    `,
    [ownerId, name, species, breed, age, careNotes],
  );

  return rows[0];
}

async function upsertSitterService(
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
    ON CONFLICT (sitter_id, service_id)
    DO UPDATE SET
      price_override = EXCLUDED.price_override
    RETURNING id;
    `,
    [sitterId, serviceId, priceOverride],
  );

  return rows[0].id;
}

async function insertAvailability(
  client,
  {
    sitterId,
    dayOffset,
    startTime,
    endTime,
    isBooked,
  },
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
    RETURNING id, date, start_time, end_time;
    `,
    [sitterId, dayOffset, startTime, endTime, isBooked],
  );

  return rows[0];
}

async function insertBooking(
  client,
  {
    ownerId,
    sitterId,
    petId,
    sitterServiceId,
    availability,
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
      $6,
      $7,
      $8,
      $9,
      COALESCE(
        sitter_services.price_override,
        services.base_price
      )
    FROM sitter_services
    JOIN services
      ON services.id = sitter_services.service_id
    WHERE sitter_services.id = $4
    RETURNING id;
    `,
    [
      ownerId,
      sitterId,
      petId,
      sitterServiceId,
      availability.id,
      availability.date,
      availability.start_time,
      availability.end_time,
      status,
    ],
  );

  if (!rows[0]) {
    throw new Error("Unable to create seeded booking");
  }

  return rows[0].id;
}

async function insertReview(
  client,
  { bookingId, reviewerId, rating, wasOnTime, comment },
) {
  await client.query(
    `
    INSERT INTO reviews (
      booking_id,
      reviewer_id,
      rating,
      was_on_time,
      comment
    )
    VALUES ($1, $2, $3, $4, $5);
    `,
    [bookingId, reviewerId, rating, wasOnTime, comment],
  );
}

async function seed() {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const existingDemoAccountCount =
      await getExistingDemoAccountCount(client);

    if (existingDemoAccountCount === DEMO_USERS.length) {
      await client.query("COMMIT");
      transactionStarted = false;

      console.log("Demo data is already seeded. No changes were made.");
      console.log(`Demo account password: ${DEMO_PASSWORD}`);
      return;
    }

    if (existingDemoAccountCount > 0) {
      throw new Error(
        "Only some demo accounts exist. Reset the development database before seeding.",
      );
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const users = new Map();

    for (const demoUser of DEMO_USERS) {
      const insertedUser = await insertUser(
        client,
        demoUser,
        passwordHash,
      );

      users.set(insertedUser.email, insertedUser);
    }

    const services = new Map();

    for (const serviceDefinition of [
      {
        name: "Dog Walking",
        description: "30-minute neighborhood walk",
        basePrice: 22,
      },
      {
        name: "Pet Sitting",
        description: "In-home feeding, play, and potty visit",
        basePrice: 28,
      },
      {
        name: "Overnight Boarding",
        description: "The pet stays at the sitter home",
        basePrice: 55,
      },
    ]) {
      const service = await upsertService(client, serviceDefinition);
      services.set(service.name, service);
    }

    const maya = users.get("maya@example.com");
    const james = users.get("james@example.com");
    const priya = users.get("priya@example.com");
    const sarah = users.get("sarah@example.com");
    const jordan = users.get("jordan@example.com");
    const luis = users.get("luis@example.com");

    const rocky = await insertPet(client, {
      ownerId: maya.id,
      name: "Rocky",
      species: "dog",
      breed: "Boxer",
      age: 4,
      careNotes: "Pulls on leash. Treats are in the blue jar.",
    });

    const luna = await insertPet(client, {
      ownerId: maya.id,
      name: "Luna",
      species: "dog",
      breed: "Corgi",
      age: 2,
      careNotes: "Friendly with everyone. Allergic to chicken.",
    });

    const mochi = await insertPet(client, {
      ownerId: james.id,
      name: "Mochi",
      species: "cat",
      breed: "Ragdoll",
      age: 1,
      careNotes: "Indoor only. Hides under the bed with strangers.",
    });

    const biscuit = await insertPet(client, {
      ownerId: priya.id,
      name: "Biscuit",
      species: "dog",
      breed: "Golden Retriever",
      age: 6,
      careNotes: "Arthritis medication is given at 5 PM.",
    });

    const walking = services.get("Dog Walking");
    const sitting = services.get("Pet Sitting");
    const boarding = services.get("Overnight Boarding");

    const sarahWalking = await upsertSitterService(
      client,
      sarah.id,
      walking.id,
      null,
    );

    const sarahSitting = await upsertSitterService(
      client,
      sarah.id,
      sitting.id,
      30,
    );

    const jordanSitting = await upsertSitterService(
      client,
      jordan.id,
      sitting.id,
      null,
    );

    const jordanBoarding = await upsertSitterService(
      client,
      jordan.id,
      boarding.id,
      60,
    );

    const luisWalking = await upsertSitterService(
      client,
      luis.id,
      walking.id,
      25,
    );

    const sarahCompletedSlot = await insertAvailability(client, {
      sitterId: sarah.id,
      dayOffset: -8,
      startTime: "08:00",
      endTime: "08:30",
      isBooked: true,
    });

    const jordanCompletedSlot = await insertAvailability(client, {
      sitterId: jordan.id,
      dayOffset: -6,
      startTime: "12:00",
      endTime: "13:00",
      isBooked: true,
    });

    const luisCompletedSlot = await insertAvailability(client, {
      sitterId: luis.id,
      dayOffset: -3,
      startTime: "17:00",
      endTime: "17:30",
      isBooked: true,
    });

    const acceptedSlot = await insertAvailability(client, {
      sitterId: sarah.id,
      dayOffset: 1,
      startTime: "09:00",
      endTime: "09:30",
      isBooked: true,
    });

    const pendingSlot = await insertAvailability(client, {
      sitterId: jordan.id,
      dayOffset: 3,
      startTime: "10:00",
      endTime: "11:00",
      isBooked: true,
    });

    const cancelledSlot = await insertAvailability(client, {
      sitterId: jordan.id,
      dayOffset: -10,
      startTime: "08:00",
      endTime: "20:00",
      isBooked: false,
    });

    await insertAvailability(client, {
      sitterId: sarah.id,
      dayOffset: 2,
      startTime: "09:00",
      endTime: "12:00",
      isBooked: false,
    });

    await insertAvailability(client, {
      sitterId: jordan.id,
      dayOffset: 1,
      startTime: "14:00",
      endTime: "18:00",
      isBooked: false,
    });

    await insertAvailability(client, {
      sitterId: luis.id,
      dayOffset: 1,
      startTime: "06:00",
      endTime: "08:00",
      isBooked: false,
    });

    await insertAvailability(client, {
      sitterId: luis.id,
      dayOffset: 2,
      startTime: "17:00",
      endTime: "19:00",
      isBooked: false,
    });

    const sarahCompletedBooking = await insertBooking(client, {
      ownerId: maya.id,
      sitterId: sarah.id,
      petId: rocky.id,
      sitterServiceId: sarahWalking,
      availability: sarahCompletedSlot,
      status: "completed",
    });

    const jordanCompletedBooking = await insertBooking(client, {
      ownerId: james.id,
      sitterId: jordan.id,
      petId: mochi.id,
      sitterServiceId: jordanSitting,
      availability: jordanCompletedSlot,
      status: "completed",
    });

    const luisCompletedBooking = await insertBooking(client, {
      ownerId: priya.id,
      sitterId: luis.id,
      petId: biscuit.id,
      sitterServiceId: luisWalking,
      availability: luisCompletedSlot,
      status: "completed",
    });

    await insertBooking(client, {
      ownerId: maya.id,
      sitterId: sarah.id,
      petId: luna.id,
      sitterServiceId: sarahSitting,
      availability: acceptedSlot,
      status: "accepted",
    });

    await insertBooking(client, {
      ownerId: james.id,
      sitterId: jordan.id,
      petId: mochi.id,
      sitterServiceId: jordanBoarding,
      availability: pendingSlot,
      status: "pending",
    });

    await insertBooking(client, {
      ownerId: maya.id,
      sitterId: jordan.id,
      petId: luna.id,
      sitterServiceId: jordanBoarding,
      availability: cancelledSlot,
      status: "cancelled",
    });

    await insertReview(client, {
      bookingId: sarahCompletedBooking,
      reviewerId: maya.id,
      rating: 5,
      wasOnTime: true,
      comment: "Sarah was wonderful with Rocky and sent helpful updates.",
    });

    await insertReview(client, {
      bookingId: jordanCompletedBooking,
      reviewerId: james.id,
      rating: 5,
      wasOnTime: true,
      comment: "Jordan made Mochi comfortable and communicated clearly.",
    });

    await insertReview(client, {
      bookingId: luisCompletedBooking,
      reviewerId: priya.id,
      rating: 4,
      wasOnTime: true,
      comment: "Biscuit came home happy and ready for a nap.",
    });

    for (const sitter of [sarah, jordan, luis]) {
      await recalculateSitterTrustMetrics(client, sitter.id);
    }

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("Database seeded successfully.");
    console.log(`Demo account password: ${DEMO_PASSWORD}`);
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

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