import { pool } from "./client.js";
import { recalculateSitterTrustMetrics } from "../utils/trustMetrics.js";

const NATALIE_EMAIL = "ntobarromero@gmail.com";

async function insertAvailability(client, sitterId, date, startTime, endTime, isBooked) {
  const { rows } = await client.query(
    `
    INSERT INTO availability (sitter_id, date, start_time, end_time, is_booked)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id;
    `,
    [sitterId, date, startTime, endTime, isBooked],
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
    date,
    startTime,
    endTime,
    status,
    price,
    cancelledByRole = null,
  },
) {
  const { rows } = await client.query(
    `
    INSERT INTO bookings (
      owner_id, sitter_id, pet_id, sitter_service_id, availability_id,
      date, start_time, end_time, status, total_price, cancelled_by_role
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id;
    `,
    [
      ownerId,
      sitterId,
      petId,
      sitterServiceId,
      availabilityId,
      date,
      startTime,
      endTime,
      status,
      price,
      cancelledByRole,
    ],
  );

  return rows[0].id;
}

async function insertReview(client, { bookingId, reviewerId, rating, wasOnTime, comment }) {
  await client.query(
    `
    INSERT INTO reviews (booking_id, reviewer_id, rating, was_on_time, comment)
    VALUES ($1, $2, $3, $4, $5);
    `,
    [bookingId, reviewerId, rating, wasOnTime, comment],
  );
}

async function run() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: natalieRows } = await client.query(
      `
      UPDATE users
      SET role = 'owner'
      WHERE email = $1
      RETURNING id, name;
      `,
      [NATALIE_EMAIL],
    );

    if (natalieRows.length === 0) {
      throw new Error(`No user found with email ${NATALIE_EMAIL}`);
    }

    const natalieId = natalieRows[0].id;
    console.log(`Converted ${natalieRows[0].name} (id ${natalieId}) to owner`);

    const { rows: petRows } = await client.query(
      `
      INSERT INTO pets (owner_id, name, species, breed, age, care_notes)
      VALUES ($1, 'Buddy', 'dog', 'Golden Retriever', 3, 'Placeholder profile — rename/update me and add a photo!')
      RETURNING id;
      `,
      [natalieId],
    );

    const buddyId = petRows[0].id;
    console.log(`Created placeholder pet "Buddy" (id ${buddyId}) for demo account`);

    const sitterServicesTouched = new Set();

    // --- Natalie's bookings ---

    const sarahSlot1 = await insertAvailability(client, 4, "2026-06-20", "09:00", "10:00", true);
    const b1 = await insertBooking(client, {
      ownerId: natalieId,
      sitterId: 4,
      petId: buddyId,
      sitterServiceId: 1,
      availabilityId: sarahSlot1,
      date: "2026-06-20",
      startTime: "09:00",
      endTime: "10:00",
      status: "completed",
      price: 22,
    });
    sitterServicesTouched.add(4);

    const jordanSlot1 = await insertAvailability(client, 5, "2026-07-02", "13:00", "14:00", true);
    const b2 = await insertBooking(client, {
      ownerId: natalieId,
      sitterId: 5,
      petId: buddyId,
      sitterServiceId: 4,
      availabilityId: jordanSlot1,
      date: "2026-07-02",
      startTime: "13:00",
      endTime: "14:00",
      status: "completed",
      price: 60,
    });
    sitterServicesTouched.add(5);

    const emilySlot1 = await insertAvailability(client, 7, "2026-07-24", "10:00", "11:00", true);
    await insertBooking(client, {
      ownerId: natalieId,
      sitterId: 7,
      petId: buddyId,
      sitterServiceId: 7,
      availabilityId: emilySlot1,
      date: "2026-07-24",
      startTime: "10:00",
      endTime: "11:00",
      status: "accepted",
      price: 24,
    });

    const marcusSlot1 = await insertAvailability(client, 8, "2026-07-29", "15:00", "16:00", true);
    await insertBooking(client, {
      ownerId: natalieId,
      sitterId: 8,
      petId: buddyId,
      sitterServiceId: 9,
      availabilityId: marcusSlot1,
      date: "2026-07-29",
      startTime: "15:00",
      endTime: "16:00",
      status: "pending",
      price: 58,
    });

    // Cancelled-by-sitter booking, with a matching backup slot open on
    // another Dog Walking sitter (Daniel Osei) so the SOS backup flow
    // is demoable end-to-end from Natalie's calendar.
    const luisSlot1 = await insertAvailability(client, 6, "2026-07-23", "10:00", "11:00", false);
    await insertBooking(client, {
      ownerId: natalieId,
      sitterId: 6,
      petId: buddyId,
      sitterServiceId: 5,
      availabilityId: luisSlot1,
      date: "2026-07-23",
      startTime: "10:00",
      endTime: "11:00",
      status: "cancelled",
      price: 25,
      cancelledByRole: "sitter",
    });

    await insertAvailability(client, 10, "2026-07-23", "10:00", "11:00", false);

    // --- Spread more completed (reviewable) bookings across other owners/sitters ---

    const historicalBookings = [
      { ownerId: 1, petId: 1, sitterId: 11, sitterServiceId: 13, date: "2026-06-10", startTime: "09:00", endTime: "10:00", price: 27 },
      { ownerId: 1, petId: 2, sitterId: 9, sitterServiceId: 10, date: "2026-06-25", startTime: "11:00", endTime: "12:00", price: 26 },
      { ownerId: 2, petId: 3, sitterId: 22, sitterServiceId: 17, date: "2026-06-18", startTime: "14:00", endTime: "15:00", price: 23 },
      { ownerId: 2, petId: 3, sitterId: 20, sitterServiceId: 15, date: "2026-07-03", startTime: "16:00", endTime: "17:00", price: 24 },
      { ownerId: 3, petId: 4, sitterId: 10, sitterServiceId: 11, date: "2026-06-28", startTime: "08:00", endTime: "09:00", price: 20 },
      { ownerId: 3, petId: 4, sitterId: 21, sitterServiceId: 16, date: "2026-07-08", startTime: "10:00", endTime: "11:00", price: 22 },
      { ownerId: 1, petId: 1, sitterId: 19, sitterServiceId: 14, date: "2026-06-05", startTime: "09:00", endTime: "10:00", price: 25 },
      { ownerId: 1, petId: 2, sitterId: 8, sitterServiceId: 8, date: "2026-06-12", startTime: "13:00", endTime: "14:00", price: 22 },
    ];

    const reviewComments = [
      { rating: 5, wasOnTime: true, comment: "Wonderful with my pet, will book again!" },
      { rating: 5, wasOnTime: true, comment: "Sent photo updates the whole time. Highly recommend." },
      { rating: 4, wasOnTime: true, comment: "Great care, arrived a little later than planned." },
      { rating: 5, wasOnTime: true, comment: "So attentive and clearly loves animals." },
      { rating: 4, wasOnTime: false, comment: "Good service overall, running about 15 min behind." },
      { rating: 5, wasOnTime: true, comment: "Followed all our care instructions perfectly." },
      { rating: 3, wasOnTime: false, comment: "Fine, but communication could be better." },
      { rating: 5, wasOnTime: true, comment: "Our dog was so happy and tired afterward!" },
    ];

    const completedBookingIds = [b1, b2];
    const completedBookingOwners = [natalieId, natalieId];
    const completedBookingSitters = [4, 5];

    for (const historical of historicalBookings) {
      const slotId = await insertAvailability(
        client,
        historical.sitterId,
        historical.date,
        historical.startTime,
        historical.endTime,
        true,
      );

      const bookingId = await insertBooking(client, {
        ownerId: historical.ownerId,
        sitterId: historical.sitterId,
        petId: historical.petId,
        sitterServiceId: historical.sitterServiceId,
        availabilityId: slotId,
        date: historical.date,
        startTime: historical.startTime,
        endTime: historical.endTime,
        status: "completed",
        price: historical.price,
      });

      completedBookingIds.push(bookingId);
      completedBookingOwners.push(historical.ownerId);
      completedBookingSitters.push(historical.sitterId);
      sitterServicesTouched.add(historical.sitterId);
    }

    for (let i = 0; i < completedBookingIds.length; i += 1) {
      const review = reviewComments[i % reviewComments.length];

      await insertReview(client, {
        bookingId: completedBookingIds[i],
        reviewerId: completedBookingOwners[i],
        rating: review.rating,
        wasOnTime: review.wasOnTime,
        comment: review.comment,
      });
    }

    console.log(`Added ${completedBookingIds.length} reviews`);

    for (const sitterId of sitterServicesTouched) {
      await recalculateSitterTrustMetrics(client, sitterId);
    }

    console.log(`Recalculated trust metrics for ${sitterServicesTouched.size} sitters`);

    await client.query("COMMIT");
    console.log("Demo data setup complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Demo data setup failed:", error);
  process.exit(1);
});
