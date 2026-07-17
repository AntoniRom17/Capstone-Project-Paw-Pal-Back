# PawPal Backend

Backend API for PawPal, a pet sitting and dog walking marketplace capstone project.

This backend handles authentication, users, sitters, pets, pet and profile photo uploads, services, availability, bookings, reviews, trust scores, background checks, and messaging.

## Tech Stack

- Node.js
- Express
- PostgreSQL
- JWT authentication
- bcrypt
- pg
- Multer
- file-type
- dotenv
- Node test runner

## Folder Structure

```text
Capstone-Project-Paw-Pal-Back/
├── src/
│   ├── controllers/
│   ├── db/
│   │   └── migrations/
│   ├── middleware/
│   ├── routes/
│   ├── utils/
│   └── index.js
├── test/
├── uploads/
├── .env.example
├── package.json
└── package-lock.json
```

The `uploads` directory contains runtime-uploaded files and is excluded from Git.

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
TEST_DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/pawpal_test
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=21d
BACKGROUND_CHECK_WEBHOOK_SECRET=replace_with_a_separate_random_secret
CLIENT_URL=http://localhost:5173
PET_PHOTO_UPLOAD_DIR=uploads/pets
PET_PHOTO_MAX_BYTES=5242880
PROFILE_PHOTO_UPLOAD_DIR=uploads/profiles
PROFILE_PHOTO_MAX_BYTES=5242880
```

`DATABASE_URL` and `TEST_DATABASE_URL` must point to separate PostgreSQL databases.

The test database name must include `test`. The test suite refuses to run when both database URLs point to the same database.

## Scripts

Start the development server:

```bash
npm run dev
```

Start the production server:

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

Apply non-destructive database migrations:

```bash
npm run db:migrate
```

Seed the database:

```bash
npm run db:seed
```

### Reset the Development Database

`npm run db:reset` is destructive. It drops and recreates the PawPal database tables using `src/db/schema.sql`.

The reset command refuses to run unless:

- `NODE_ENV` is exactly `development`.
- `DATABASE_URL` contains a database name.
- The database is not `postgres`, `template0`, or `template1`.
- `CONFIRM_DATABASE_RESET` exactly matches the database name from `DATABASE_URL`.

For a development database named `pawpal`, run the following in PowerShell:

```powershell
$env:CONFIRM_DATABASE_RESET = "pawpal"
npm run db:reset
Remove-Item Env:\CONFIRM_DATABASE_RESET
```

On macOS or Linux:

```bash
CONFIRM_DATABASE_RESET=pawpal npm run db:reset
```

Do not store `CONFIRM_DATABASE_RESET` permanently in `.env`. It is intentionally a one-time confirmation for each destructive reset.

Use migrations instead of `db:reset` when updating an existing or deployed database:

```bash
npm run db:migrate
```

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

### Authentication

```http
POST /api/auth/register
POST /api/auth/login
```

Authentication responses include `hasProfilePhoto`. Stored filenames and filesystem paths are never returned.

### Account Management

```http
GET /api/users/me
PATCH /api/users/me
PATCH /api/users/me/password
DELETE /api/users/me
```

### Profile Photos

```http
POST /api/users/me/photo
GET /api/users/:id/photo
DELETE /api/users/me/photo
```

Owners and sitters can upload a profile-picture file selected from a phone, tablet, or computer.

Users do not submit profile-picture URLs. The selected file is sent to the backend using `multipart/form-data`.

#### Upload a Profile Photo

Send the file using the multipart field name `photo`:

```bash
curl -X POST http://localhost:3000/api/users/me/photo \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "photo=@path/to/profile-photo.jpg"
```

The upload endpoint requires authentication. Both owners and sitters may use it.

Supported file types:

```text
JPEG
PNG
WebP
```

The default maximum profile-photo size is 5 MB. Configure it with `PROFILE_PHOTO_MAX_BYTES`.

The backend verifies the actual file signature instead of trusting only the submitted filename or content type.

Uploading another profile photo replaces the existing file.

User, authentication, and sitter responses include:

```json
{
  "hasProfilePhoto": true
}
```

The boolean tells the frontend whether it should request the image. It does not expose the stored filename.

#### Retrieve a Profile Photo

```http
GET /api/users/:id/photo
```

Profile-photo retrieval is public for active users so images can be shown in sitter searches and profile pages.

The response contains the image bytes and verified content type.

Invalid IDs return `400`. Missing users, inactive users, and users without profile photos return `404`.

#### Delete a Profile Photo

```http
DELETE /api/users/me/photo
```

The delete endpoint requires authentication.

Deleting a profile photo removes the stored file and clears its database metadata.

Successfully deactivating an account also removes its profile photo. A failed deactivation leaves the file and metadata unchanged.

### Services

```http
GET /api/services
```

### Sitters

```http
GET /api/sitters
GET /api/sitters/:id
GET /api/sitters/:id/availability
POST /api/sitters/me/services
PATCH /api/sitters/me/services/:id
DELETE /api/sitters/me/services/:id
POST /api/sitters/me/background-check
```

Sitter list and detail responses include `hasProfilePhoto`.

Sitter reviews include `reviewerHasProfilePhoto` for the reviewing owner.

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
POST /api/pets/:id/photo
GET /api/pets/:id/photo
DELETE /api/pets/:id/photo
```

Pet routes are authenticated and owner-only. Owners can only access their own pets.

Pet records return `hasPhoto` to indicate whether a photo is available. Stored filenames and filesystem paths are not exposed.

The legacy `photoUrl` property is not accepted. Pet photos must be uploaded as files using the photo endpoint.

#### Upload a Pet Photo

Send a `multipart/form-data` request using the field name `photo`:

```bash
curl -X POST http://localhost:3000/api/pets/1/photo \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "photo=@path/to/pet-photo.jpg"
```

Supported file types:

```text
JPEG
PNG
WebP
```

The default maximum file size is 5 MB. Configure it with `PET_PHOTO_MAX_BYTES`.

The server verifies the file contents instead of trusting only the filename extension or submitted content type.

Uploading another photo for the same pet replaces the existing photo.

#### Retrieve a Pet Photo

```http
GET /api/pets/:id/photo
```

The response contains the image file with its stored content type. Authentication is required.

#### Delete a Pet Photo

```http
DELETE /api/pets/:id/photo
```

Deleting a photo removes the file and clears its database metadata.

Deleting a pet also removes its photo after the pet is successfully deleted from the database.

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
- Overlapping availability is rejected.
- Booked availability cannot be edited or deleted.
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
- Expired availability cannot be booked.
- Sitters can accept, decline, or complete bookings.
- Owners can cancel eligible bookings.
- Accepted bookings cannot be completed before their scheduled end time.
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
- Duplicate reviews return `409 Conflict`.
- Completed reviews update sitter trust metrics.

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

The current development schema is located at:

```text
src/db/schema.sql
```

Numbered production migrations are located at:

```text
src/db/migrations/
```

Apply pending migrations with:

```bash
npm run db:migrate
```

Main tables include:

```text
users
pets
services
sitter_services
availability
bookings
reviews
messages
schema_migrations
```

Uploaded image files are stored on the filesystem.

PostgreSQL stores only generated filenames and verified content types. API responses expose only `hasPhoto` or `hasProfilePhoto` booleans.

## Tests

Backend tests are located in:

```text
test/backend.test.js
test/bookingCompletion.test.js
test/migrations.test.js
test/petPhotos.test.js
test/profilePhotos.test.js
test/resetSafety.test.js
test/trustScore.test.js
```

Run the complete test suite with:

```bash
npm test
```

The test suite covers:

- Authentication and account management
- Request validation
- Pet permissions and deletion conflicts
- Pet photo upload, replacement, retrieval, and deletion
- Pet photo authentication and file validation
- Profile photo uploads for owners and sitters
- Profile photo replacement, retrieval, and deletion
- Profile photo authentication and file validation
- Profile photo cleanup during account deactivation
- Profile photo state in authentication and sitter responses
- Availability validation and overlap protection
- Booking creation and status transitions
- Booking completion timing
- Sitter service management
- Review validation
- Trust Score behavior
- Background-check workflows
- Message authentication and permissions
- Database migration safety and rollback behavior
- Destructive database reset protection

The current suite contains 82 tests.

## Uploaded Photo Storage

Default upload directories:

```text
uploads/pets
uploads/profiles
```

The directories are created automatically when the first valid file is uploaded.

Uploaded files use generated UUID filenames. Original client filenames are not used for storage.

Production deployments must use persistent storage for both directories. Files stored only inside an ephemeral deployment filesystem may be lost when the application restarts or redeploys.

Generated upload filenames must never be accepted directly from API clients.

## Notes

- Environment variables are loaded with `dotenv`.
- Passwords are hashed with `bcrypt`.
- Authentication uses JWT tokens.
- SQL queries use the `pg` PostgreSQL client.
- Pet and profile photos use generated UUID filenames.
- Uploaded files are validated by their detected file signature.
- Detailed server errors are logged internally.
- Production error responses do not expose database details.
- The backend server entry point is `src/index.js`.