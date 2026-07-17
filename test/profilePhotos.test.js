import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  after,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import {
  authHeader,
  closeDb,
  resetTestDatabase,
  seedTestData,
  startTestServer,
} from "./helpers.js";
import { pool } from "../src/db/client.js";
import {
  PROFILE_PHOTO_MAX_BYTES,
} from "../src/utils/profilePhotoStorage.js";

const IMAGE_FIXTURES = [
  {
    name: "JPEG",
    filename: "profile.jpg",
    contentType: "image/jpeg",
    buffer: Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0xff,
      0xd9,
    ]),
  },
  {
    name: "PNG",
    filename: "profile.png",
    contentType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl6gAAAAASUVORK5CYII=",
      "base64",
    ),
  },
  {
    name: "WebP",
    filename: "profile.webp",
    contentType: "image/webp",
    buffer: Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([
        0x04,
        0x00,
        0x00,
        0x00,
      ]),
      Buffer.from("WEBPVP8 ", "ascii"),
    ]),
  },
];

let server;
let uploadDirectory;

async function request(
  requestPath,
  options = {},
) {
  const response = await fetch(
    `${server.baseUrl}${requestPath}`,
    options,
  );

  const contentType =
    response.headers.get(
      "content-type",
    ) || "";

  let body = null;

  if (
    contentType.includes(
      "application/json",
    )
  ) {
    body = await response.json();
  } else {
    const responseBuffer =
      await response.arrayBuffer();

    if (responseBuffer.byteLength > 0) {
      body = Buffer.from(responseBuffer);
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

function createPhotoForm(
  buffer,
  filename,
  contentType,
  fieldName = "photo",
) {
  const form = new FormData();

  form.append(
    fieldName,
    new Blob(
      [buffer],
      {
        type: contentType,
      },
    ),
    filename,
  );

  return form;
}

async function uploadPhoto(
  user,
  fixture,
  fieldName = "photo",
) {
  return request(
    "/api/users/me/photo",
    {
      method: "POST",
      headers: authHeader(user),
      body: createPhotoForm(
        fixture.buffer,
        fixture.filename,
        fixture.contentType,
        fieldName,
      ),
    },
  );
}

async function getPhotoMetadata(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      profile_photo_filename
        AS "profilePhotoFilename",
      profile_photo_content_type
        AS "profilePhotoContentType",
      is_active AS "isActive",
      deactivated_at AS "deactivatedAt"
    FROM users
    WHERE id = $1;
    `,
    [userId],
  );

  return rows[0] || null;
}

async function getUploadFiles() {
  return fs.readdir(uploadDirectory);
}

async function storedFileExists(filename) {
  if (!filename) {
    return false;
  }

  try {
    await fs.access(
      path.join(
        uploadDirectory,
        filename,
      ),
    );

    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function clearUploadDirectory() {
  await fs.rm(
    uploadDirectory,
    {
      recursive: true,
      force: true,
    },
  );

  await fs.mkdir(
    uploadDirectory,
    {
      recursive: true,
    },
  );
}

async function createBooking(data) {
  const response = await request(
    "/api/bookings",
    {
      method: "POST",
      headers: {
        ...authHeader(data.owner),
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        sitterId: data.sitter.id,
        petId: data.ownerPet.id,
        sitterServiceId:
          data.sitterService.id,
        availabilityId:
          data.availability[0].id,
      }),
    },
  );

  assert.equal(response.status, 201);

  return response.body.booking;
}

async function deactivateUser(user) {
  return request(
    "/api/users/me",
    {
      method: "DELETE",
      headers: {
        ...authHeader(user),
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        password: "PawPal123!",
      }),
    },
  );
}

before(async () => {
  uploadDirectory = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pawpal-profile-photos-",
    ),
  );

  process.env.PROFILE_PHOTO_UPLOAD_DIR =
    uploadDirectory;

  server = await startTestServer();
});

beforeEach(async () => {
  await resetTestDatabase();
  await clearUploadDirectory();
});

after(async () => {
  await server.close();

  await fs.rm(
    uploadDirectory,
    {
      recursive: true,
      force: true,
    },
  );

  await closeDb();
});

describe(
  "profile photo file uploads",
  () => {
    test("owners and sitters can upload, replace, and publicly retrieve profile photos", async () => {
      const data = await seedTestData();

      let previousOwnerFilename = null;

      for (
        const fixture
        of IMAGE_FIXTURES.slice(0, 2)
      ) {
        const uploadResponse =
          await uploadPhoto(
            data.owner,
            fixture,
          );

        assert.equal(
          uploadResponse.status,
          200,
          `${fixture.name} upload failed`,
        );

        assert.equal(
          uploadResponse.body.user
            .hasProfilePhoto,
          true,
        );

        const metadata =
          await getPhotoMetadata(
            data.owner.id,
          );

        assert.ok(
          metadata.profilePhotoFilename,
        );

        assert.match(
          metadata.profilePhotoFilename,
          /^[0-9a-f-]+\.(jpg|png|webp)$/i,
        );

        assert.notEqual(
          metadata.profilePhotoFilename,
          fixture.filename,
        );

        assert.equal(
          metadata.profilePhotoContentType,
          fixture.contentType,
        );

        assert.equal(
          await storedFileExists(
            metadata.profilePhotoFilename,
          ),
          true,
        );

        if (previousOwnerFilename) {
          assert.equal(
            await storedFileExists(
              previousOwnerFilename,
            ),
            false,
          );
        }

        const getResponse =
          await request(
            `/api/users/${data.owner.id}/photo`,
          );

        assert.equal(
          getResponse.status,
          200,
        );

        assert.equal(
          getResponse.headers.get(
            "content-type",
          ),
          fixture.contentType,
        );

        assert.equal(
          getResponse.headers.get(
            "x-content-type-options",
          ),
          "nosniff",
        );

        assert.deepEqual(
          getResponse.body,
          fixture.buffer,
        );

        previousOwnerFilename =
          metadata.profilePhotoFilename;
      }

      const sitterUploadResponse =
        await uploadPhoto(
          data.sitter,
          IMAGE_FIXTURES[2],
        );

      assert.equal(
        sitterUploadResponse.status,
        200,
      );

      assert.equal(
        sitterUploadResponse.body.user
          .hasProfilePhoto,
        true,
      );

      const sitterPhotoResponse =
        await request(
          `/api/users/${data.sitter.id}/photo`,
        );

      assert.equal(
        sitterPhotoResponse.status,
        200,
      );

      assert.deepEqual(
        sitterPhotoResponse.body,
        IMAGE_FIXTURES[2].buffer,
      );

      const currentUserResponse =
        await request(
          "/api/users/me",
          {
            headers:
              authHeader(data.owner),
          },
        );

      assert.equal(
        currentUserResponse.status,
        200,
      );

      assert.equal(
        currentUserResponse.body.user
          .hasProfilePhoto,
        true,
      );

      const loginResponse =
        await request(
          "/api/auth/login",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              email: data.owner.email,
              password: "PawPal123!",
            }),
          },
        );

      assert.equal(
        loginResponse.status,
        200,
      );

      assert.equal(
        loginResponse.body.user
          .hasProfilePhoto,
        true,
      );

      const sitterListResponse =
        await request("/api/sitters");

      assert.equal(
        sitterListResponse.status,
        200,
      );

      const listedSitter =
        sitterListResponse.body.sitters.find(
          (sitter) =>
            sitter.id === data.sitter.id,
        );

      assert.ok(listedSitter);

      assert.equal(
        listedSitter.hasProfilePhoto,
        true,
      );

      const sitterDetailResponse =
        await request(
          `/api/sitters/${data.sitter.id}`,
        );

      assert.equal(
        sitterDetailResponse.status,
        200,
      );

      assert.equal(
        sitterDetailResponse.body.sitter
          .hasProfilePhoto,
        true,
      );

      const registerResponse =
        await request(
          "/api/auth/register",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              name: "New Profile User",
              email:
                "profile.user@example.com",
              password: "PawPal123!",
              role: "owner",
              city: "Chicago",
              state: "IL",
              zipCode: "60601",
            }),
          },
        );

      assert.equal(
        registerResponse.status,
        201,
      );

      assert.equal(
        registerResponse.body.user
          .hasProfilePhoto,
        false,
      );

      assert.equal(
        (await getUploadFiles()).length,
        2,
      );
    });

    test("upload validation rejects missing, unsupported, spoofed, and oversized files", async () => {
      const data = await seedTestData();

      const missingResponse =
        await request(
          "/api/users/me/photo",
          {
            method: "POST",
            headers:
              authHeader(data.owner),
            body: new FormData(),
          },
        );

      assert.equal(
        missingResponse.status,
        400,
      );

      const wrongFieldResponse =
        await uploadPhoto(
          data.owner,
          IMAGE_FIXTURES[1],
          "image",
        );

      assert.equal(
        wrongFieldResponse.status,
        400,
      );

      const unsupportedResponse =
        await uploadPhoto(
          data.owner,
          {
            filename: "profile.txt",
            contentType: "text/plain",
            buffer: Buffer.from(
              "not an image",
              "utf8",
            ),
          },
        );

      assert.equal(
        unsupportedResponse.status,
        415,
      );

      const spoofedResponse =
        await uploadPhoto(
          data.owner,
          {
            filename: "fake.png",
            contentType: "image/png",
            buffer: Buffer.from(
              "not actually a PNG",
              "utf8",
            ),
          },
        );

      assert.equal(
        spoofedResponse.status,
        415,
      );

      const oversizedResponse =
        await uploadPhoto(
          data.owner,
          {
            filename: "large.png",
            contentType: "image/png",
            buffer: Buffer.alloc(
              PROFILE_PHOTO_MAX_BYTES + 1,
              0,
            ),
          },
        );

      assert.equal(
        oversizedResponse.status,
        413,
      );

      const metadata =
        await getPhotoMetadata(
          data.owner.id,
        );

      assert.equal(
        metadata.profilePhotoFilename,
        null,
      );

      assert.equal(
        metadata.profilePhotoContentType,
        null,
      );

      assert.deepEqual(
        await getUploadFiles(),
        [],
      );
    });

    test("profile photo routes enforce authentication and valid IDs", async () => {
      const data = await seedTestData();
      const fixture = IMAGE_FIXTURES[1];

      const unauthenticatedUpload =
        await request(
          "/api/users/me/photo",
          {
            method: "POST",
            body: createPhotoForm(
              fixture.buffer,
              fixture.filename,
              fixture.contentType,
            ),
          },
        );

      assert.equal(
        unauthenticatedUpload.status,
        401,
      );

      const unauthenticatedDelete =
        await request(
          "/api/users/me/photo",
          {
            method: "DELETE",
          },
        );

      assert.equal(
        unauthenticatedDelete.status,
        401,
      );

      const invalidIdResponse =
        await request(
          "/api/users/not-a-number/photo",
        );

      assert.equal(
        invalidIdResponse.status,
        400,
      );

      const missingUserResponse =
        await request(
          "/api/users/999999/photo",
        );

      assert.equal(
        missingUserResponse.status,
        404,
      );

      const missingPhotoResponse =
        await request(
          `/api/users/${data.owner.id}/photo`,
        );

      assert.equal(
        missingPhotoResponse.status,
        404,
      );

      assert.deepEqual(
        await getUploadFiles(),
        [],
      );
    });

    test("authenticated users can delete their profile photos", async () => {
      const data = await seedTestData();

      const uploadResponse =
        await uploadPhoto(
          data.owner,
          IMAGE_FIXTURES[1],
        );

      assert.equal(
        uploadResponse.status,
        200,
      );

      const uploadedMetadata =
        await getPhotoMetadata(
          data.owner.id,
        );

      assert.equal(
        await storedFileExists(
          uploadedMetadata
            .profilePhotoFilename,
        ),
        true,
      );

      const deleteResponse =
        await request(
          "/api/users/me/photo",
          {
            method: "DELETE",
            headers:
              authHeader(data.owner),
          },
        );

      assert.equal(
        deleteResponse.status,
        200,
      );

      assert.equal(
        deleteResponse.body.user
          .hasProfilePhoto,
        false,
      );

      const clearedMetadata =
        await getPhotoMetadata(
          data.owner.id,
        );

      assert.equal(
        clearedMetadata
          .profilePhotoFilename,
        null,
      );

      assert.equal(
        clearedMetadata
          .profilePhotoContentType,
        null,
      );

      assert.equal(
        await storedFileExists(
          uploadedMetadata
            .profilePhotoFilename,
        ),
        false,
      );

      const getResponse =
        await request(
          `/api/users/${data.owner.id}/photo`,
        );

      assert.equal(
        getResponse.status,
        404,
      );

      const secondDeleteResponse =
        await request(
          "/api/users/me/photo",
          {
            method: "DELETE",
            headers:
              authHeader(data.owner),
          },
        );

      assert.equal(
        secondDeleteResponse.status,
        404,
      );
    });

    test("account deactivation removes photos only after successful deactivation", async () => {
      const data = await seedTestData();

      const successfulUpload =
        await uploadPhoto(
          data.otherOwner,
          IMAGE_FIXTURES[0],
        );

      assert.equal(
        successfulUpload.status,
        200,
      );

      const successfulMetadata =
        await getPhotoMetadata(
          data.otherOwner.id,
        );

      const successfulDeactivation =
        await deactivateUser(
          data.otherOwner,
        );

      assert.equal(
        successfulDeactivation.status,
        200,
      );

      const deactivatedMetadata =
        await getPhotoMetadata(
          data.otherOwner.id,
        );

      assert.equal(
        deactivatedMetadata.isActive,
        false,
      );

      assert.ok(
        deactivatedMetadata.deactivatedAt,
      );

      assert.equal(
        deactivatedMetadata
          .profilePhotoFilename,
        null,
      );

      assert.equal(
        deactivatedMetadata
          .profilePhotoContentType,
        null,
      );

      assert.equal(
        await storedFileExists(
          successfulMetadata
            .profilePhotoFilename,
        ),
        false,
      );

      const deactivatedPhotoResponse =
        await request(
          `/api/users/${data.otherOwner.id}/photo`,
        );

      assert.equal(
        deactivatedPhotoResponse.status,
        404,
      );

      await createBooking(data);

      const protectedUpload =
        await uploadPhoto(
          data.owner,
          IMAGE_FIXTURES[2],
        );

      assert.equal(
        protectedUpload.status,
        200,
      );

      const protectedMetadata =
        await getPhotoMetadata(
          data.owner.id,
        );

      const conflictingDeactivation =
        await deactivateUser(data.owner);

      assert.equal(
        conflictingDeactivation.status,
        409,
      );

      const activeMetadata =
        await getPhotoMetadata(
          data.owner.id,
        );

      assert.equal(
        activeMetadata.isActive,
        true,
      );

      assert.equal(
        activeMetadata.profilePhotoFilename,
        protectedMetadata
          .profilePhotoFilename,
      );

      assert.equal(
        await storedFileExists(
          protectedMetadata
            .profilePhotoFilename,
        ),
        true,
      );

      const protectedPhotoResponse =
        await request(
          `/api/users/${data.owner.id}/photo`,
        );

      assert.equal(
        protectedPhotoResponse.status,
        200,
      );

      assert.deepEqual(
        protectedPhotoResponse.body,
        IMAGE_FIXTURES[2].buffer,
      );
    });
  },
);