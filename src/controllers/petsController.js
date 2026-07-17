import {
  pool,
  query,
} from "../db/client.js";
import {
  hasOwn,
  isPlainObject,
  isStringWithinLength,
  parseNumber,
  parsePositiveInteger,
} from "../utils/validation.js";
import {
  deletePetPhoto,
  PetPhotoStorageError,
  readPetPhoto,
  savePetPhoto,
} from "../utils/petPhotoStorage.js";

const PET_UPDATE_FIELDS = [
  "name",
  "species",
  "breed",
  "age",
  "careNotes",
];

const PET_RESPONSE_FIELDS = `
  id,
  owner_id AS "ownerId",
  name,
  species,
  breed,
  age,
  care_notes AS "careNotes",
  (
    photo_filename IS NOT NULL
  ) AS "hasPhoto"
`;

function getUserId(req) {
  return req.user.id || req.user.userId;
}

function isForeignKeyConflict(error) {
  return error.code === "23503";
}

function hasLegacyPhotoUrl(body) {
  return hasOwn(body, "photoUrl");
}

function sendLegacyPhotoUrlError(res) {
  return res.status(400).json({
    error:
      "photoUrl is not supported; upload a file using /api/pets/:id/photo",
  });
}

function parseRequiredPetString(
  value,
  field,
  maxLength,
) {
  if (
    !isStringWithinLength(value, {
      min: 1,
      max: maxLength,
    })
  ) {
    return {
      value: null,
      error:
        `${field} must be a non-empty string no longer ` +
        `than ${maxLength} characters`,
    };
  }

  return {
    value: value.trim(),
    error: null,
  };
}

function parseNullablePetString(
  value,
  field,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return {
      value: null,
      error: null,
    };
  }

  if (typeof value !== "string") {
    return {
      value: null,
      error:
        `${field} must be a string or null`,
    };
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    return {
      value: null,
      error:
        `${field} cannot exceed ` +
        `${maxLength} characters`,
    };
  }

  return {
    value: normalizedValue || null,
    error: null,
  };
}

function parseNullableAge(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return {
      value: null,
      error: null,
    };
  }

  const numericAge = parseNumber(value, {
    min: 0,
    integer: true,
    allowString: false,
  });

  if (numericAge === null) {
    return {
      value: null,
      error:
        "age must be a non-negative integer or null",
    };
  }

  return {
    value: numericAge,
    error: null,
  };
}

function hasPetUpdate(body) {
  return PET_UPDATE_FIELDS.some(
    (field) => hasOwn(body, field),
  );
}

async function deleteStoredPhotoSafely(
  filename,
  reason,
) {
  if (!filename) {
    return;
  }

  try {
    await deletePetPhoto(filename);
  } catch (error) {
    console.error(
      "Pet photo cleanup failed",
      {
        reason,
        message: error.message,
      },
    );
  }
}

async function rollbackSafely(client) {
  try {
    await client.query("ROLLBACK");
    return null;
  } catch (error) {
    return error;
  }
}

function sendStorageError(
  error,
  res,
) {
  return res.status(error.status).json({
    error: error.message,
  });
}

export async function getPets(
  req,
  res,
  next,
) {
  try {
    const ownerId = getUserId(req);

    const result = await query(
      `
      SELECT
        ${PET_RESPONSE_FIELDS}
      FROM pets
      WHERE owner_id = $1
      ORDER BY id DESC;
      `,
      [ownerId],
    );

    res.status(200).json({
      pets: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function createPet(
  req,
  res,
  next,
) {
  try {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error:
          "Request body must be a JSON object",
      });
    }

    if (hasLegacyPhotoUrl(req.body)) {
      return sendLegacyPhotoUrlError(res);
    }

    const ownerId = getUserId(req);

    const {
      name,
      species,
      breed,
      age,
      careNotes,
    } = req.body;

    if (
      name === undefined ||
      species === undefined
    ) {
      return res.status(400).json({
        error:
          "name and species are required",
      });
    }

    const parsedName =
      parseRequiredPetString(
        name,
        "name",
        50,
      );

    if (parsedName.error) {
      return res.status(400).json({
        error: parsedName.error,
      });
    }

    const parsedSpecies =
      parseRequiredPetString(
        species,
        "species",
        30,
      );

    if (parsedSpecies.error) {
      return res.status(400).json({
        error: parsedSpecies.error,
      });
    }

    const parsedBreed =
      parseNullablePetString(
        breed,
        "breed",
        50,
      );

    if (parsedBreed.error) {
      return res.status(400).json({
        error: parsedBreed.error,
      });
    }

    const parsedAge =
      parseNullableAge(age);

    if (parsedAge.error) {
      return res.status(400).json({
        error: parsedAge.error,
      });
    }

    const parsedCareNotes =
      parseNullablePetString(
        careNotes,
        "careNotes",
        5000,
      );

    if (parsedCareNotes.error) {
      return res.status(400).json({
        error: parsedCareNotes.error,
      });
    }

    const result = await query(
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
      RETURNING
        ${PET_RESPONSE_FIELDS};
      `,
      [
        ownerId,
        parsedName.value,
        parsedSpecies.value,
        parsedBreed.value,
        parsedAge.value,
        parsedCareNotes.value,
      ],
    );

    res.status(201).json({
      pet: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function getPetById(
  req,
  res,
  next,
) {
  try {
    const ownerId = getUserId(req);

    const petId =
      parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({
        error:
          "id must be a positive integer",
      });
    }

    const result = await query(
      `
      SELECT
        ${PET_RESPONSE_FIELDS}
      FROM pets
      WHERE id = $1
        AND owner_id = $2;
      `,
      [petId, ownerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found",
      });
    }

    res.status(200).json({
      pet: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePet(
  req,
  res,
  next,
) {
  try {
    const ownerId = getUserId(req);

    const petId =
      parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({
        error:
          "id must be a positive integer",
      });
    }

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error:
          "Request body must be a JSON object",
      });
    }

    if (hasLegacyPhotoUrl(req.body)) {
      return sendLegacyPhotoUrlError(res);
    }

    if (!hasPetUpdate(req.body)) {
      return res.status(400).json({
        error:
          "At least one pet field is required",
      });
    }

    const hasName =
      hasOwn(req.body, "name");

    const hasSpecies =
      hasOwn(req.body, "species");

    const hasBreed =
      hasOwn(req.body, "breed");

    const hasAge =
      hasOwn(req.body, "age");

    const hasCareNotes =
      hasOwn(req.body, "careNotes");

    let parsedName = {
      value: null,
      error: null,
    };

    if (hasName) {
      parsedName = parseRequiredPetString(
        req.body.name,
        "name",
        50,
      );

      if (parsedName.error) {
        return res.status(400).json({
          error: parsedName.error,
        });
      }
    }

    let parsedSpecies = {
      value: null,
      error: null,
    };

    if (hasSpecies) {
      parsedSpecies =
        parseRequiredPetString(
          req.body.species,
          "species",
          30,
        );

      if (parsedSpecies.error) {
        return res.status(400).json({
          error: parsedSpecies.error,
        });
      }
    }

    let parsedBreed = {
      value: null,
      error: null,
    };

    if (hasBreed) {
      parsedBreed =
        parseNullablePetString(
          req.body.breed,
          "breed",
          50,
        );

      if (parsedBreed.error) {
        return res.status(400).json({
          error: parsedBreed.error,
        });
      }
    }

    let parsedAge = {
      value: null,
      error: null,
    };

    if (hasAge) {
      parsedAge =
        parseNullableAge(req.body.age);

      if (parsedAge.error) {
        return res.status(400).json({
          error: parsedAge.error,
        });
      }
    }

    let parsedCareNotes = {
      value: null,
      error: null,
    };

    if (hasCareNotes) {
      parsedCareNotes =
        parseNullablePetString(
          req.body.careNotes,
          "careNotes",
          5000,
        );

      if (parsedCareNotes.error) {
        return res.status(400).json({
          error: parsedCareNotes.error,
        });
      }
    }

    const result = await query(
      `
      UPDATE pets
      SET
        name = CASE
          WHEN $1::boolean
            THEN $2::varchar
          ELSE name
        END,
        species = CASE
          WHEN $3::boolean
            THEN $4::varchar
          ELSE species
        END,
        breed = CASE
          WHEN $5::boolean
            THEN $6::varchar
          ELSE breed
        END,
        age = CASE
          WHEN $7::boolean
            THEN $8::integer
          ELSE age
        END,
        care_notes = CASE
          WHEN $9::boolean
            THEN $10::text
          ELSE care_notes
        END
      WHERE id = $11
        AND owner_id = $12
      RETURNING
        ${PET_RESPONSE_FIELDS};
      `,
      [
        hasName,
        parsedName.value,
        hasSpecies,
        parsedSpecies.value,
        hasBreed,
        parsedBreed.value,
        hasAge,
        parsedAge.value,
        hasCareNotes,
        parsedCareNotes.value,
        petId,
        ownerId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found",
      });
    }

    res.status(200).json({
      pet: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadPetPhotoFile(
  req,
  res,
  next,
) {
  const petId =
    parsePositiveInteger(req.params.id);

  if (!petId) {
    return res.status(400).json({
      error:
        "id must be a positive integer",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      error:
        "A pet photo file is required",
    });
  }

  const ownerId = getUserId(req);
  const client = await pool.connect();

  let transactionStarted = false;
  let storedPhoto = null;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const existingResult =
      await client.query(
        `
        SELECT
          id,
          photo_filename
            AS "photoFilename"
        FROM pets
        WHERE id = $1
          AND owner_id = $2
        FOR UPDATE;
        `,
        [petId, ownerId],
      );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Pet not found",
      });
    }

    storedPhoto = await savePetPhoto(
      req.file.buffer,
    );

    const result = await client.query(
      `
      UPDATE pets
      SET
        photo_filename = $1,
        photo_content_type = $2
      WHERE id = $3
        AND owner_id = $4
      RETURNING
        ${PET_RESPONSE_FIELDS};
      `,
      [
        storedPhoto.filename,
        storedPhoto.contentType,
        petId,
        ownerId,
      ],
    );

    await client.query("COMMIT");
    transactionStarted = false;

    await deleteStoredPhotoSafely(
      existingResult.rows[0].photoFilename,
      "photo replacement",
    );

    res.status(200).json({
      pet: result.rows[0],
    });
  } catch (error) {
    const rollbackError =
      transactionStarted
        ? await rollbackSafely(client)
        : null;

    if (storedPhoto) {
      await deleteStoredPhotoSafely(
        storedPhoto.filename,
        "failed photo upload",
      );
    }

    if (rollbackError) {
      next(rollbackError);
      return;
    }

    if (
      error instanceof
      PetPhotoStorageError
    ) {
      sendStorageError(error, res);
      return;
    }

    next(error);
  } finally {
    client.release();
  }
}

export async function getPetPhotoFile(
  req,
  res,
  next,
) {
  try {
    const ownerId = getUserId(req);

    const petId =
      parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({
        error:
          "id must be a positive integer",
      });
    }

    const result = await query(
      `
      SELECT
        photo_filename
          AS "photoFilename",
        photo_content_type
          AS "photoContentType"
      FROM pets
      WHERE id = $1
        AND owner_id = $2;
      `,
      [petId, ownerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found",
      });
    }

    const pet = result.rows[0];

    if (!pet.photoFilename) {
      return res.status(404).json({
        error: "Pet photo not found",
      });
    }

    const photoBuffer =
      await readPetPhoto(
        pet.photoFilename,
      );

    if (!photoBuffer) {
      return res.status(404).json({
        error: "Pet photo not found",
      });
    }

    res.set({
      "Cache-Control":
        "private, no-store",
      "Content-Length":
        String(photoBuffer.length),
      "Content-Type":
        pet.photoContentType,
      "X-Content-Type-Options":
        "nosniff",
    });

    res.status(200).send(photoBuffer);
  } catch (error) {
    next(error);
  }
}

export async function deletePetPhotoFile(
  req,
  res,
  next,
) {
  const petId =
    parsePositiveInteger(req.params.id);

  if (!petId) {
    return res.status(400).json({
      error:
        "id must be a positive integer",
    });
  }

  const ownerId = getUserId(req);
  const client = await pool.connect();

  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const existingResult =
      await client.query(
        `
        SELECT
          id,
          photo_filename
            AS "photoFilename"
        FROM pets
        WHERE id = $1
          AND owner_id = $2
        FOR UPDATE;
        `,
        [petId, ownerId],
      );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Pet not found",
      });
    }

    const existing =
      existingResult.rows[0];

    if (!existing.photoFilename) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Pet photo not found",
      });
    }

    const result = await client.query(
      `
      UPDATE pets
      SET
        photo_filename = NULL,
        photo_content_type = NULL
      WHERE id = $1
        AND owner_id = $2
      RETURNING
        ${PET_RESPONSE_FIELDS};
      `,
      [petId, ownerId],
    );

    await client.query("COMMIT");
    transactionStarted = false;

    await deleteStoredPhotoSafely(
      existing.photoFilename,
      "photo deletion",
    );

    res.status(200).json({
      pet: result.rows[0],
    });
  } catch (error) {
    const rollbackError =
      transactionStarted
        ? await rollbackSafely(client)
        : null;

    if (rollbackError) {
      next(rollbackError);
      return;
    }

    next(error);
  } finally {
    client.release();
  }
}

export async function deletePet(
  req,
  res,
  next,
) {
  try {
    const ownerId = getUserId(req);

    const petId =
      parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({
        error:
          "id must be a positive integer",
      });
    }

    const result = await query(
      `
      DELETE FROM pets
      WHERE id = $1
        AND owner_id = $2
      RETURNING
        id,
        photo_filename
          AS "photoFilename";
      `,
      [petId, ownerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found",
      });
    }

    await deleteStoredPhotoSafely(
      result.rows[0].photoFilename,
      "pet deletion",
    );

    res.status(200).json({
      message:
        "Pet deleted successfully",
    });
  } catch (error) {
    if (isForeignKeyConflict(error)) {
      return res.status(409).json({
        error:
          "Pet is attached to a booking and cannot be deleted",
      });
    }

    next(error);
  }
}