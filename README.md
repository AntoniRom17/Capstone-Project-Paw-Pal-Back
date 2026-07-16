# PawPal Backend

Backend API for PawPal, a pet sitting and dog walking marketplace capstone project.

This backend handles authentication, users, sitters, pets, services, availability, bookings, reviews, and messaging.

## Tech Stack

- Node.js
- Express
- PostgreSQL
- JWT authentication
- bcrypt
- pg
- dotenv
- Node test runner

## Folder Structure

```text
server/
├── src/
│   ├── controllers/
│   ├── db/
│   ├── middleware/
│   ├── routes/
│   └── index.js
├── test/
├── package.json
└── package-lock.json
```

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file in the backend folder:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/pawpal
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=21d
CLIENT_URL=http://localhost:5173
```

## Scripts

Start the development server:

```bash
npm run dev
```

Start the server:

```bash
npm start
```

Run backend tests:

```bash
npm test
```

Test the database connection:

```bash
npm run db:test
```

Reset the database schema:

```bash
npm run db:reset
```

Seed the database:

```bash
npm run db:seed
```

Warning: `npm run db:reset` drops and recreates the PawPal database tables.

## API Base URL

```text
http://localhost:3000/api
```

## Authentication

Protected routes require a JWT token:

```text
Authorization: Bearer <token>
```

User roles:

```text
owner
sitter
```

## Error Format

API errors follow this format:

```json
{
  "error": "Error message"
}
```

## Routes

### Health

```http
GET /api/health
```

### Auth

```http
POST /api/auth/register
POST /api/auth/login
```

### Services

```http
GET /api/services
```

### Sitters

```http
GET /api/sitters
GET /api/sitters/:id
POST /api/sitters/me/services
```

Sitter search supports:

```text
service
city
state
zipCode
maxPrice
minRating
```

### Pets

```http
GET /api/pets
POST /api/pets
GET /api/pets/:id
PUT /api/pets/:id
DELETE /api/pets/:id
```

Pet routes are owner-only.

Owners can only access their own pets.

### Availability

```http
GET /api/sitters/:id/availability
POST /api/availability
PUT /api/availability/:id
DELETE /api/availability/:id
```

Availability rules:

- Public users can view sitter availability.
- Only sitters can create, update, or delete availability.
- Sitters can only manage their own availability.
- Past availability creation is rejected.
- Public availability only returns future, unbooked slots.

### Bookings

```http
POST /api/bookings
GET /api/bookings
PATCH /api/bookings/:id/status
```

Booking statuses:

```text
pending
accepted
declined
cancelled
completed
```

Booking rules:

- Owners can create booking requests.
- Owners can only book using their own pets.
- Sitters can accept, decline, or complete bookings.
- Owners can cancel eligible bookings.
- Availability is marked booked when a booking is created.
- Declined bookings release availability.

### Reviews

```http
POST /api/reviews
```

Review rules:

- Reviews are owner-only.
- Owners can only review completed bookings.
- Each booking can only be reviewed once.
- Ratings must be integers from 1 to 5.
- Duplicate reviews return `409`.

### Messages

```http
GET /api/messages
GET /api/messages/:bookingId
POST /api/messages
```

Messaging rules:

- Users must be authenticated.
- Only booking participants can access messages.
- Message bodies cannot be empty.
- Message bodies cannot exceed 2000 characters.
- Messages are returned chronologically.
- Reading messages marks them as read.

## Database

The database schema is located at:

```text
src/db/schema.sql
```

Main tables:

```text
users
pets
services
sitter_services
availability
bookings
reviews
messages
```

## Tests

Backend tests are located at:

```text
test/backend.test.js
```

Run tests with:

```bash
npm test
```

The backend test suite covers:

- Health endpoint
- Pet permissions
- Availability validation
- Booking creation
- Booking status updates
- Review creation
- Duplicate review prevention
- Message authentication
- Message permissions
- Message sending
- Message reading
- Message validation
- Message ordering

## Notes

- Environment variables are loaded with `dotenv`.
- Passwords are hashed with `bcrypt`.
- Authentication uses JWT tokens.
- SQL queries use the `pg` PostgreSQL client.
- The backend server entry point is `src/index.js`.
