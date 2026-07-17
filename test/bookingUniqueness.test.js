import assert from "node:assert/strict";
import {
  after,
  beforeEach,
  describe,
  test,
} from "node:test";
import { pool } from "../src/db/client.js";
import {
  closeDb,
  resetTestDatabase,
  seedTestData,
} from "./helpers.js";

const ACTIVE_BOOKING_INDEX =
  "idx_one_active_booking_per_availability";

async function insertBooking(
  data,
  {
    availabilityIndex = 0,
    status = "pending",
    useOtherOwner = false,
  } = {},
) {
  const owner = useOtherOwner
    ? data.otherOwner
    : data.owner;

  const pet = useOtherOwner
    ? data.otherOwnerPet
    : data.ownerPet;

  const availability =
    data.availability[
      availabilityIndex
    ];

  const { rows } = await pool.query(
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
      availability.id,
      availability.date,
      availability.start_time,
      availability.end_time,
      $6,
      25.00
    FROM availability
    WHERE availability.id = $5
    RETURNING
      id,
      owner_id AS "ownerId",
      availability_id
        AS "availabilityId",
      status;
    `,
    [
      owner.id,
      data.sitter.id,
      pet.id,
      data.sitterService.id,
      availability.id,
      status,
    ],
  );

  return rows[0];
}

async function assertActiveBookingConflict(
  operation,
) {
  await assert.rejects(
    operation,
    (error) => {
      assert.equal(error.code, "23505");

      assert.equal(
        error.constraint,
        ACTIVE_BOOKING_INDEX,
      );

      return true;
    },
  );
}

describe(
  "active booking uniqueness",
  () => {
    beforeEach(async () => {
      await resetTestDatabase();
    });

    after(async () => {
      await closeDb();
    });

    test(
      "pending booking prevents another active booking for the same availability",
      async () => {
        const data = await seedTestData();

        const firstBooking =
          await insertBooking(data);

        assert.equal(
          firstBooking.status,
          "pending",
        );

        await assertActiveBookingConflict(
          insertBooking(data, {
            useOtherOwner: true,
          }),
        );

        const { rows } = await pool.query(
          `
          SELECT
            COUNT(*)::integer AS count
          FROM bookings
          WHERE availability_id = $1
            AND status IN (
              'pending',
              'accepted',
              'completed'
            );
          `,
          [
            data.availability[0].id,
          ],
        );

        assert.equal(rows[0].count, 1);
      },
    );

    test(
      "accepted and completed bookings continue reserving availability",
      async () => {
        const data = await seedTestData();

        await insertBooking(data, {
          availabilityIndex: 0,
          status: "accepted",
        });

        await assertActiveBookingConflict(
          insertBooking(data, {
            availabilityIndex: 0,
            status: "pending",
            useOtherOwner: true,
          }),
        );

        await insertBooking(data, {
          availabilityIndex: 1,
          status: "completed",
        });

        await assertActiveBookingConflict(
          insertBooking(data, {
            availabilityIndex: 1,
            status: "pending",
            useOtherOwner: true,
          }),
        );
      },
    );

    test(
      "declined and cancelled bookings release availability",
      async () => {
        const data = await seedTestData();

        const declinedBooking =
          await insertBooking(data, {
            availabilityIndex: 0,
          });

        await pool.query(
          `
          UPDATE bookings
          SET status = 'declined'
          WHERE id = $1;
          `,
          [declinedBooking.id],
        );

        const afterDecline =
          await insertBooking(data, {
            availabilityIndex: 0,
            useOtherOwner: true,
          });

        assert.equal(
          afterDecline.status,
          "pending",
        );

        const cancelledBooking =
          await insertBooking(data, {
            availabilityIndex: 1,
          });

        await pool.query(
          `
          UPDATE bookings
          SET status = 'cancelled'
          WHERE id = $1;
          `,
          [cancelledBooking.id],
        );

        const afterCancellation =
          await insertBooking(data, {
            availabilityIndex: 1,
            useOtherOwner: true,
          });

        assert.equal(
          afterCancellation.status,
          "pending",
        );
      },
    );
  },
);