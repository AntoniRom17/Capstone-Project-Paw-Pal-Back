import { pool } from "./client.js";

async function seed() {
  console.log("🌱 Seeding database...");

  // --- USERS (password_hash is a placeholder until auth is built in ticket #6) ---
  const { rows: users } = await pool.query(`
    INSERT INTO users (name, email, password_hash, role, bio, phone) VALUES
    ('Maya Rodriguez', 'maya@example.com', 'placeholder_hash', 'owner', 'Dog mom of two. Travel a lot for work.', '555-0101'),
    ('James Chen', 'james@example.com', 'placeholder_hash', 'owner', 'First-time cat owner, very protective of Mochi.', '555-0102'),
    ('Priya Patel', 'priya@example.com', 'placeholder_hash', 'owner', 'Busy nurse, needs weekday walks for Biscuit.', '555-0103'),
    ('Sarah Mitchell', 'sarah@example.com', 'placeholder_hash', 'sitter', 'Vet tech student. 5 years of dog walking experience.', '555-0201'),
    ('Jordan Kim', 'jordan@example.com', 'placeholder_hash', 'sitter', 'Work from home — your pets keep me company!', '555-0202'),
    ('Luis Ortega', 'luis@example.com', 'placeholder_hash', 'sitter', 'Marathon runner. High-energy dogs are my specialty.', '555-0203')
    RETURNING id, name, role;
  `);
  const [maya, james, priya, sarah, jordan, luis] = users;

  // --- PETS ---
  const { rows: pets } = await pool.query(`
    INSERT INTO pets (owner_id, name, species, breed, age, care_notes) VALUES
    (${maya.id}, 'Rocky', 'dog', 'Boxer', 4, 'Pulls on leash. Treats in the blue jar.'),
    (${maya.id}, 'Luna', 'dog', 'Corgi', 2, 'Friendly with everyone. Allergic to chicken.'),
    (${james.id}, 'Mochi', 'cat', 'Ragdoll', 1, 'Indoor only! Hides under the bed with strangers.'),
    (${priya.id}, 'Biscuit', 'dog', 'Golden Retriever', 6, 'Sweet but slow on stairs — arthritis meds at 5pm.')
    RETURNING id, name;
  `);
  const [rocky, luna, mochi, biscuit] = pets;

  // --- SERVICES (shared catalog) ---
  const { rows: services } = await pool.query(`
    INSERT INTO services (name, description, base_price) VALUES
    ('Dog Walking', '30-minute neighborhood walk', 22.00),
    ('Pet Sitting', 'In-home visit: feeding, play, litter/potty', 28.00),
    ('Overnight Boarding', 'Your pet stays at the sitter''s home', 55.00)
    RETURNING id, name;
  `);
  const [walking, sitting, boarding] = services;

  // --- SITTER_SERVICES (who offers what) ---
  await pool.query(`
    INSERT INTO sitter_services (sitter_id, service_id, price_override) VALUES
    (${sarah.id}, ${walking.id}, NULL),
    (${sarah.id}, ${sitting.id}, 30.00),
    (${jordan.id}, ${sitting.id}, NULL),
    (${jordan.id}, ${boarding.id}, 60.00),
    (${luis.id}, ${walking.id}, 25.00);
  `);

  // --- AVAILABILITY (next few days) ---
  await pool.query(`
    INSERT INTO availability (sitter_id, date, start_time, end_time, is_booked) VALUES
    (${sarah.id}, CURRENT_DATE + 1, '09:00', '12:00', false),
    (${sarah.id}, CURRENT_DATE + 2, '09:00', '12:00', false),
    (${jordan.id}, CURRENT_DATE + 1, '14:00', '18:00', false),
    (${jordan.id}, CURRENT_DATE + 3, '10:00', '16:00', false),
    (${luis.id}, CURRENT_DATE + 1, '06:00', '08:00', false),
    (${luis.id}, CURRENT_DATE + 2, '17:00', '19:00', true);
  `);

  // --- BOOKINGS (one of each status for demo) ---
  const { rows: bookings } = await pool.query(`
    INSERT INTO bookings (owner_id, sitter_id, pet_id, service_id, date, start_time, end_time, status, total_price) VALUES
    (${priya.id}, ${luis.id}, ${biscuit.id}, ${walking.id}, CURRENT_DATE - 3, '17:00', '17:30', 'completed', 25.00),
    (${maya.id}, ${sarah.id}, ${rocky.id}, ${walking.id}, CURRENT_DATE + 1, '09:00', '09:30', 'accepted', 22.00),
    (${james.id}, ${jordan.id}, ${mochi.id}, ${sitting.id}, CURRENT_DATE + 3, '10:00', '11:00', 'pending', 28.00),
    (${maya.id}, ${jordan.id}, ${luna.id}, ${boarding.id}, CURRENT_DATE - 10, '08:00', '20:00', 'cancelled', 60.00)
    RETURNING id, status;
  `);
  const completedBooking = bookings.find((b) => b.status === "completed");

  // --- REVIEWS (only on the completed booking) ---
  await pool.query(`
    INSERT INTO reviews (booking_id, reviewer_id, rating, comment) VALUES
    (${completedBooking.id}, ${priya.id}, 5, 'Luis was amazing with Biscuit — sent photos and was right on time!');
  `);

  console.log(
    "✅ Seeded: 6 users, 4 pets, 3 services, 5 sitter_services, 6 availability slots, 4 bookings, 1 review",
  );
  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
