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

const DEMO_AVAILABILITY = [
  {
    sitterEmail: "sarah@example.com",
    slots: [
      { dayOffset: 1, startTime: "08:30", endTime: "09:00" },
      { dayOffset: 3, startTime: "13:00", endTime: "14:00" },
      { dayOffset: 5, startTime: "17:30", endTime: "18:00" },
    ],
  },
  {
    sitterEmail: "jordan@example.com",
    slots: [
      { dayOffset: 1, startTime: "11:00", endTime: "12:00" },
      { dayOffset: 2, startTime: "15:00", endTime: "16:00" },
      { dayOffset: 4, startTime: "09:00", endTime: "10:00" },
    ],
  },
  {
    sitterEmail: "luis@example.com",
    slots: [
      { dayOffset: 1, startTime: "06:30", endTime: "07:00" },
      { dayOffset: 3, startTime: "17:00", endTime: "18:00" },
      { dayOffset: 6, startTime: "07:30", endTime: "08:00" },
    ],
  },
  {
    sitterEmail: "emily@example.com",
    slots: [
      { dayOffset: 1, startTime: "09:00", endTime: "10:00" },
      { dayOffset: 3, startTime: "14:00", endTime: "15:00" },
      { dayOffset: 5, startTime: "18:00", endTime: "19:00" },
    ],
  },
  {
    sitterEmail: "marcus@example.com",
    slots: [
      { dayOffset: 1, startTime: "07:30", endTime: "08:30" },
      { dayOffset: 3, startTime: "12:00", endTime: "13:00" },
      { dayOffset: 5, startTime: "16:00", endTime: "17:00" },
    ],
  },
  {
    sitterEmail: "aisha@example.com",
    slots: [
      { dayOffset: 1, startTime: "10:00", endTime: "11:00" },
      { dayOffset: 3, startTime: "13:00", endTime: "14:00" },
      { dayOffset: 5, startTime: "15:30", endTime: "16:30" },
    ],
  },
  {
    sitterEmail: "daniel@example.com",
    slots: [
      { dayOffset: 1, startTime: "06:00", endTime: "07:00" },
      { dayOffset: 3, startTime: "17:30", endTime: "18:30" },
      { dayOffset: 5, startTime: "07:00", endTime: "08:00" },
    ],
  },
  {
    sitterEmail: "grace@example.com",
    slots: [
      { dayOffset: 1, startTime: "09:30", endTime: "10:30" },
      { dayOffset: 3, startTime: "18:00", endTime: "19:00" },
      { dayOffset: 5, startTime: "11:00", endTime: "12:00" },
    ],
  },
  {
    sitterEmail: "olivia@example.com",
    slots: [
      { dayOffset: 1, startTime: "10:30", endTime: "11:30" },
      { dayOffset: 3, startTime: "14:30", endTime: "15:30" },
      { dayOffset: 5, startTime: "16:30", endTime: "17:30" },
    ],
  },
  {
    sitterEmail: "ben@example.com",
    slots: [
      { dayOffset: 1, startTime: "08:00", endTime: "09:00" },
      { dayOffset: 3, startTime: "12:30", endTime: "13:30" },
      { dayOffset: 5, startTime: "15:00", endTime: "16:00" },
    ],
  },
  {
    sitterEmail: "nadia@example.com",
    slots: [
      { dayOffset: 1, startTime: "11:00", endTime: "12:00" },
      { dayOffset: 3, startTime: "15:00", endTime: "16:00" },
      { dayOffset: 5, startTime: "18:30", endTime: "19:30" },
    ],
  },
  {
    sitterEmail: "tyler@example.com",
    slots: [
      { dayOffset: 1, startTime: "07:00", endTime: "08:00" },
      { dayOffset: 3, startTime: "16:00", endTime: "17:00" },
      { dayOffset: 5, startTime: "19:00", endTime: "20:00" },
    ],
  },
];

const DEMO_CONVERSATIONS = [
  {
    ownerEmail: "maya@example.com",
    sitterEmail: "sarah@example.com",
    petName: "Luna",
    bookingStatus: "accepted",
    messages: [
      {
        senderRole: "owner",
        body: "Hi Sarah! Luna's food and treats will be packed by the front door.",
        minutesAgo: 95,
        isRead: true,
      },
      {
        senderRole: "sitter",
        body: "Perfect, thank you! I also made a note about her chicken allergy.",
        minutesAgo: 80,
        isRead: true,
      },
      {
        senderRole: "owner",
        body: "That is great. She usually settles in after a short walk.",
        minutesAgo: 55,
        isRead: true,
      },
      {
        senderRole: "sitter",
        body: "Sounds good! I am looking forward to spending time with Luna.",
        minutesAgo: 20,
        isRead: false,
      },
    ],
  },
  {
    ownerEmail: "maya@example.com",
    sitterEmail: "jordan@example.com",
    petName: "Luna",
    bookingStatus: "cancelled",
    messages: [
      {
        senderRole: "owner",
        body: "Hi Jordan, my plans changed and I need to cancel Luna's stay.",
        minutesAgo: 310,
        isRead: true,
      },
      {
        senderRole: "sitter",
        body: "No problem at all. Thanks for letting me know early.",
        minutesAgo: 285,
        isRead: true,
      },
    ],
  },
  {
    ownerEmail: "maya@example.com",
    sitterEmail: "sarah@example.com",
    petName: "Rocky",
    bookingStatus: "completed",
    messages: [
      {
        senderRole: "owner",
        body: "Rocky is ready for his walk. His treats are in the blue jar.",
        minutesAgo: 1520,
        isRead: true,
      },
      {
        senderRole: "sitter",
        body: "We had a great walk! Rocky did well and is relaxing at home.",
        minutesAgo: 1450,
        isRead: true,
      },
      {
        senderRole: "owner",
        body: "Thank you for the update and for taking such good care of him!",
        minutesAgo: 1425,
        isRead: true,
      },
    ],
  },
  {
    ownerEmail: "james@example.com",
    sitterEmail: "jordan@example.com",
    petName: "Mochi",
    bookingStatus: "pending",
    messages: [
      {
        senderRole: "owner",
        body: "Hi Jordan, Mochi may hide at first. Is that okay for the overnight stay?",
        minutesAgo: 125,
        isRead: true,
      },
      {
        senderRole: "sitter",
        body: "Absolutely. I will give Mochi plenty of quiet space and let him approach me.",
        minutesAgo: 70,
        isRead: false,
      },
    ],
  },
  {
    ownerEmail: "priya@example.com",
    sitterEmail: "luis@example.com",
    petName: "Biscuit",
    bookingStatus: "completed",
    messages: [
      {
        senderRole: "owner",
        body: "Biscuit had his arthritis medication at 5 PM and is ready for his walk.",
        minutesAgo: 4400,
        isRead: true,
      },
      {
        senderRole: "sitter",
        body: "Thanks! We kept an easy pace and Biscuit was happy the whole time.",
        minutesAgo: 4330,
        isRead: true,
      },
      {
        senderRole: "owner",
        body: "Wonderful, thank you Luis!",
        minutesAgo: 4300,
        isRead: true,
      },
    ],
  },
];

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

async function seedRollingDemoAvailability(client) {
  let insertedAvailabilityCount = 0;

  for (const sitterSchedule of DEMO_AVAILABILITY) {
    for (const slot of sitterSchedule.slots) {
      const result = await client.query(
        `
        INSERT INTO availability (
          sitter_id,
          date,
          start_time,
          end_time,
          is_booked
        )
        SELECT
          users.id,
          CURRENT_DATE + $2::integer,
          $3,
          $4,
          false
        FROM users
        WHERE users.email = $1
          AND users.role = 'sitter'
          AND users.is_active = true
        ON CONFLICT DO NOTHING
        RETURNING id;
        `,
        [
          sitterSchedule.sitterEmail,
          slot.dayOffset,
          slot.startTime,
          slot.endTime,
        ],
      );

      insertedAvailabilityCount += result.rowCount;
    }
  }

  return insertedAvailabilityCount;
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

async function seedDemoMessages(client) {
  let insertedMessageCount = 0;

  for (const conversation of DEMO_CONVERSATIONS) {
    const { rows: bookingRows } = await client.query(
      `
      SELECT
        bookings.id AS "bookingId",
        bookings.owner_id AS "ownerId",
        bookings.sitter_id AS "sitterId"
      FROM bookings
      JOIN users owner_user
        ON owner_user.id = bookings.owner_id
      JOIN users sitter_user
        ON sitter_user.id = bookings.sitter_id
      JOIN pets
        ON pets.id = bookings.pet_id
      WHERE owner_user.email = $1
        AND sitter_user.email = $2
        AND pets.name = $3
        AND bookings.status = $4
      ORDER BY bookings.id DESC
      LIMIT 1;
      `,
      [
        conversation.ownerEmail,
        conversation.sitterEmail,
        conversation.petName,
        conversation.bookingStatus,
      ],
    );

    const booking = bookingRows[0];

    if (!booking) {
      continue;
    }

    for (const message of conversation.messages) {
      const senderId =
        message.senderRole === "owner"
          ? booking.ownerId
          : booking.sitterId;
      const recipientId =
        message.senderRole === "owner"
          ? booking.sitterId
          : booking.ownerId;

      const result = await client.query(
        `
        INSERT INTO messages (
          booking_id,
          sender_id,
          recipient_id,
          body,
          read_at,
          created_at
        )
        SELECT
          $1,
          $2,
          $3,
          $4,
          CASE
            WHEN $6::boolean THEN NOW()
            ELSE NULL
          END,
          NOW() - ($5::integer * INTERVAL '1 minute')
        WHERE NOT EXISTS (
          SELECT 1
          FROM messages
          WHERE booking_id = $1
            AND sender_id = $2
            AND recipient_id = $3
            AND body = $4
        );
        `,
        [
          booking.bookingId,
          senderId,
          recipientId,
          message.body,
          message.minutesAgo,
          message.isRead,
        ],
      );

      insertedMessageCount += result.rowCount;
    }
  }

  const starterMessageResult = await client.query(
    `
    INSERT INTO messages (
      booking_id,
      sender_id,
      recipient_id,
      body,
      created_at
    )
    SELECT
      bookings.id,
      bookings.sitter_id,
      bookings.owner_id,
      CONCAT(
        'Hi ',
        SPLIT_PART(owner_user.name, ' ', 1),
        '! I am looking forward to caring for ',
        pets.name,
        '. You can send any care details or questions here.'
      ),
      NOW() - INTERVAL '5 minutes'
    FROM bookings
    JOIN users owner_user
      ON owner_user.id = bookings.owner_id
    JOIN users sitter_user
      ON sitter_user.id = bookings.sitter_id
    JOIN pets
      ON pets.id = bookings.pet_id
    WHERE owner_user.email = ANY($1::text[])
      AND sitter_user.email = ANY($1::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM messages
        WHERE messages.booking_id = bookings.id
      );
    `,
    [DEMO_EMAILS],
  );

  insertedMessageCount += starterMessageResult.rowCount;

  return insertedMessageCount;
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
      const insertedAvailabilityCount =
        await seedRollingDemoAvailability(client);
      const insertedMessageCount =
        await seedDemoMessages(client);

      await client.query("COMMIT");
      transactionStarted = false;

      if (insertedMessageCount > 0) {
        console.log(
          `Added ${insertedMessageCount} demo messages to existing bookings.`,
        );
      }

      if (insertedAvailabilityCount > 0) {
        console.log(
          `Added ${insertedAvailabilityCount} fresh demo availability slots.`,
        );
      }

      if (
        insertedMessageCount === 0
        && insertedAvailabilityCount === 0
      ) {
        console.log("Demo data is already seeded. No changes were made.");
      }

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

    const insertedAvailabilityCount =
      await seedRollingDemoAvailability(client);
    const insertedMessageCount =
      await seedDemoMessages(client);

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
    console.log(
      `Fresh demo availability slots added: ${insertedAvailabilityCount}`,
    );
    console.log(`Demo messages added: ${insertedMessageCount}`);
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
