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
  PET_PHOTO_MAX_BYTES,
} from "../src/utils/petPhotoStorage.js";

const IMAGE_FIXTURES = [
  {
    name: "JPEG",
    filename: "pet.jpg",
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
    filename: "pet.png",
    contentType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl6gAAAAASUVORK5CYII=",
      "base64",
    ),
  },
  {
    name: "WebP",
    filename: "pet.webp",
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

  if (contentType.includes("application/json")) {
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
  petId,
  user,
  fixture,
  fieldName = "photo",
) {
  return request(
    `/api/pets/${petId}/photo`,
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

async function getPhotoMetadata(petId) {
  const { rows } = await pool.query(
    `
    SELECT
      photo_filename
        AS "photoFilename",
      photo_content_type
        AS "photoContentType"
    FROM pets
    WHERE id = $1;
    `,
    [petId],
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

before(async () => {
  uploadDirectory = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pawpal-pet-photos-",
    ),
  );

  process.env.PET_PHOTO_UPLOAD_DIR =
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
  "pet photo file uploads",
  () => {
    test("owner can upload, replace, and retrieve supported image files", async () => {
      const data = await seedTestData();

      let previousFilename = null;

      for (const fixture of IMAGE_FIXTURES) {
        const uploadResponse =
          await uploadPhoto(
            data.ownerPet.id,
            data.owner,
            fixture,
          );

        assert.equal(
          uploadResponse.status,
          200,
          `${fixture.name} upload failed`,
        );

        assert.equal(
          uploadResponse.body.pet.hasPhoto,
          true,
        );

        const metadata =
          await getPhotoMetadata(
            data.ownerPet.id,
          );

        assert.ok(metadata.photoFilename);

        assert.match(
          metadata.photoFilename,
          /^[0-9a-f-]+\.(jpg|png|webp)$/i,
        );

        assert.notEqual(
          metadata.photoFilename,
          fixture.filename,
        );

        assert.equal(
          metadata.photoContentType,
          fixture.contentType,
        );

        assert.equal(
          await storedFileExists(
            metadata.photoFilename,
          ),
          true,
        );

        if (previousFilename) {
          assert.equal(
            await storedFileExists(
              previousFilename,
            ),
            false,
          );
        }

        const getResponse =
          await request(
            `/api/pets/${data.ownerPet.id}/photo`,
            {
              headers:
                authHeader(data.owner),
            },
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

        previousFilename =
          metadata.photoFilename;
      }

      assert.equal(
        (await getUploadFiles()).length,
        1,
      );
    });

    test("upload validation rejects missing, unsupported, spoofed, and oversized files", async () => {
      const data = await seedTestData();

      const missingForm = new FormData();

      const missingResponse =
        await request(
          `/api/pets/${data.ownerPet.id}/photo`,
          {
            method: "POST",
            headers:
              authHeader(data.owner),
            body: missingForm,
          },
        );

      assert.equal(
        missingResponse.status,
        400,
      );

      const wrongFieldResponse =
        await uploadPhoto(
          data.ownerPet.id,
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
          data.ownerPet.id,
          data.owner,
          {
            filename: "pet.txt",
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
          data.ownerPet.id,
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
          data.ownerPet.id,
          data.owner,
          {
            filename: "large.png",
            contentType: "image/png",
            buffer: Buffer.alloc(
              PET_PHOTO_MAX_BYTES + 1,
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
          data.ownerPet.id,
        );

      assert.equal(
        metadata.photoFilename,
        null,
      );

      assert.equal(
        metadata.photoContentType,
        null,
      );

      assert.deepEqual(
        await getUploadFiles(),
        [],
      );
    });

    test("photo routes enforce authentication, role, ownership, and valid IDs", async () => {
      const data = await seedTestData();
      const fixture = IMAGE_FIXTURES[1];

      const unauthenticatedResponse =
        await request(
          `/api/pets/${data.ownerPet.id}/photo`,
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
        unauthenticatedResponse.status,
        401,
      );

      const sitterResponse =
        await uploadPhoto(
          data.ownerPet.id,
          data.sitter,
          fixture,
        );

      assert.equal(
        sitterResponse.status,
        403,
      );

      const otherOwnerResponse =
        await uploadPhoto(
          data.ownerPet.id,
          data.otherOwner,
          fixture,
        );

      assert.equal(
        otherOwnerResponse.status,
        404,
      );

      const invalidIdResponse =
        await uploadPhoto(
          "not-a-number",
          data.owner,
          fixture,
        );

      assert.equal(
        invalidIdResponse.status,
        400,
      );

      assert.deepEqual(
        await getUploadFiles(),
        [],
      );
    });

    test("owner can delete a pet photo", async () => {
      const data = await seedTestData();

      const uploadResponse =
        await uploadPhoto(
          data.ownerPet.id,
          data.owner,
          IMAGE_FIXTURES[1],
        );

      assert.equal(
        uploadResponse.status,
        200,
      );

      const uploadedMetadata =
        await getPhotoMetadata(
          data.ownerPet.id,
        );

      assert.equal(
        await storedFileExists(
          uploadedMetadata.photoFilename,
        ),
        true,
      );

      const deleteResponse =
        await request(
          `/api/pets/${data.ownerPet.id}/photo`,
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
        deleteResponse.body.pet.hasPhoto,
        false,
      );

      const clearedMetadata =
        await getPhotoMetadata(
          data.ownerPet.id,
        );

      assert.equal(
        clearedMetadata.photoFilename,
        null,
      );

      assert.equal(
        clearedMetadata.photoContentType,
        null,
      );

      assert.equal(
        await storedFileExists(
          uploadedMetadata.photoFilename,
        ),
        false,
      );

      const getResponse =
        await request(
          `/api/pets/${data.ownerPet.id}/photo`,
          {
            headers:
              authHeader(data.owner),
          },
        );

      assert.equal(getResponse.status, 404);

      const secondDeleteResponse =
        await request(
          `/api/pets/${data.ownerPet.id}/photo`,
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

    test("pet deletion removes photos only after successful database deletion", async () => {
      const data = await seedTestData();

      const removableUpload =
        await uploadPhoto(
          data.otherOwnerPet.id,
          data.otherOwner,
          IMAGE_FIXTURES[0],
        );

      assert.equal(
        removableUpload.status,
        200,
      );

      const removableMetadata =
        await getPhotoMetadata(
          data.otherOwnerPet.id,
        );

      const successfulDelete =
        await request(
          `/api/pets/${data.otherOwnerPet.id}`,
          {
            method: "DELETE",
            headers:
              authHeader(data.otherOwner),
          },
        );

      assert.equal(
        successfulDelete.status,
        200,
      );

      assert.equal(
        await storedFileExists(
          removableMetadata.photoFilename,
        ),
        false,
      );

      await createBooking(data);

      const protectedUpload =
        await uploadPhoto(
          data.ownerPet.id,
          data.owner,
          IMAGE_FIXTURES[2],
        );

      assert.equal(
        protectedUpload.status,
        200,
      );

      const protectedMetadata =
        await getPhotoMetadata(
          data.ownerPet.id,
        );

      const conflictingDelete =
        await request(
          `/api/pets/${data.ownerPet.id}`,
          {
            method: "DELETE",
            headers:
              authHeader(data.owner),
          },
        );

      assert.equal(
        conflictingDelete.status,
        409,
      );

      assert.equal(
        await storedFileExists(
          protectedMetadata.photoFilename,
        ),
        true,
      );

      const getResponse =
        await request(
          `/api/pets/${data.ownerPet.id}/photo`,
          {
            headers:
              authHeader(data.owner),
          },
        );

      assert.equal(getResponse.status, 200);

      assert.deepEqual(
        getResponse.body,
        IMAGE_FIXTURES[2].buffer,
      );
    });
  },
);