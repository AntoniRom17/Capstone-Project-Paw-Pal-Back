import { query } from "../db/client.js";
import {
  hasOwn,
  isPlainObject,
  isStringWithinLength,
  isValidHttpUrl,
  parseNumber,
  parsePositiveInteger,
} from "../utils/validation.js";

const PET_UPDATE_FIELDS = [
  "name",
  "species",
  "breed",
  "age",
  "careNotes",
  "photoUrl",
];

const getUserId = (req) => {
  return req.user.id || req.user.userId;
};

function isForeignKeyConflict(error) {
  return error.code === "23503";
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
  if (value === undefined || value === null) {
    return {
      value: null,
      error: null,
    };
  }

  if (typeof value !== "string") {
    return {
      value: null,
      error: `${field} must be a string or null`,
    };
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    return {
      value: null,
      error: `${field} cannot exceed ${maxLength} characters`,
    };
  }

  return {
    value: normalizedValue || null,
    error: null,
  };
}

function parseNullableAge(value) {
  if (value === undefined || value === null) {
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
      error: "age must be a non-negative integer or null",
    };
  }

  return {
    value: numericAge,
    error: null,
  };
}

function parseNullablePhotoUrl(value) {
  if (value === undefined || value === null) {
    return {
      value: null,
      error: null,
    };
  }

  if (typeof value !== "string") {
    return {
      value: null,
      error: "photoUrl must be a string or null",
    };
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return {
      value: null,
      error: null,
    };
  }

  if (!isValidHttpUrl(normalizedValue)) {
    return {
      value: null,
      error:
        "photoUrl must be a valid HTTP or HTTPS URL",
    };
  }

  return {
    value: normalizedValue,
    error: null,
  };
}

function hasPetUpdate(body) {
  return PET_UPDATE_FIELDS.some((field) =>
    hasOwn(body, field),
  );
}

export const getPets = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);

    const result = await query(
      `
      SELECT
        id,
        owner_id AS "ownerId",
        name,
        species,
        breed,
        age,
        care_notes AS "careNotes",
        photo_url AS "photoUrl"
      FROM pets
      WHERE owner_id = $1
      ORDER BY id DESC;
      `,
      [ownerId],
    );

    res.json({
      pets: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

export const createPet = async (req, res, next) => {
  try {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error: "Request body must be a JSON object",
      });
    }

    const ownerId = getUserId(req);
    const {
      name,
      species,
      breed,
      age,
      careNotes,
      photoUrl,
    } = req.body;

    if (name === undefined || species === undefined) {
      return res.status(400).json({
        error: "name and species are required",
      });
    }

    const parsedName = parseRequiredPetString(
      name,
      "name",
      50,
    );

    if (parsedName.error) {
      return res.status(400).json({
        error: parsedName.error,
      });
    }

    const parsedSpecies = parseRequiredPetString(
      species,
      "species",
      30,
    );

    if (parsedSpecies.error) {
      return res.status(400).json({
        error: parsedSpecies.error,
      });
    }

    const parsedBreed = parseNullablePetString(
      breed,
      "breed",
      50,
    );

    if (parsedBreed.error) {
      return res.status(400).json({
        error: parsedBreed.error,
      });
    }

    const parsedAge = parseNullableAge(age);

    if (parsedAge.error) {
      return res.status(400).json({
        error: parsedAge.error,
      });
    }

    const parsedCareNotes = parseNullablePetString(
      careNotes,
      "careNotes",
      5000,
    );

    if (parsedCareNotes.error) {
      return res.status(400).json({
        error: parsedCareNotes.error,
      });
    }

    const parsedPhotoUrl = parseNullablePhotoUrl(photoUrl);

    if (parsedPhotoUrl.error) {
      return res.status(400).json({
        error: parsedPhotoUrl.error,
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
        care_notes,
        photo_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        owner_id AS "ownerId",
        name,
        species,
        breed,
        age,
        care_notes AS "careNotes",
        photo_url AS "photoUrl";
      `,
      [
        ownerId,
        parsedName.value,
        parsedSpecies.value,
        parsedBreed.value,
        parsedAge.value,
        parsedCareNotes.value,
        parsedPhotoUrl.value,
      ],
    );

    res.status(201).json({
      pet: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const getPetById = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    const result = await query(
      `
      SELECT
        id,
        owner_id AS "ownerId",
        name,
        species,
        breed,
        age,
        care_notes AS "careNotes",
        photo_url AS "photoUrl"
      FROM pets
      WHERE id = $1 AND owner_id = $2;
      `,
      [petId, ownerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found",
      });
    }

    res.json({
      pet: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const updatePet = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    if (!isPlainObject(req.body)) {
      return res.status(400).json({
        error: "Request body must be a JSON object",
      });
    }

    if (!hasPetUpdate(req.body)) {
      return res.status(400).json({
        error: "At least one pet field is required",
      });
    }

    const hasName = hasOwn(req.body, "name");
    const hasSpecies = hasOwn(req.body, "species");
    const hasBreed = hasOwn(req.body, "breed");
    const hasAge = hasOwn(req.body, "age");
    const hasCareNotes = hasOwn(req.body, "careNotes");
    const hasPhotoUrl = hasOwn(req.body, "photoUrl");

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
      parsedSpecies = parseRequiredPetString(
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
      parsedBreed = parseNullablePetString(
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
      parsedAge = parseNullableAge(req.body.age);

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
      parsedCareNotes = parseNullablePetString(
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

    let parsedPhotoUrl = {
      value: null,
      error: null,
    };

    if (hasPhotoUrl) {
      parsedPhotoUrl = parseNullablePhotoUrl(
        req.body.photoUrl,
      );

      if (parsedPhotoUrl.error) {
        return res.status(400).json({
          error: parsedPhotoUrl.error,
        });
      }
    }

    const result = await query(
      `
      UPDATE pets
      SET
        name = CASE
          WHEN $1::boolean THEN $2::varchar
          ELSE name
        END,
        species = CASE
          WHEN $3::boolean THEN $4::varchar
          ELSE species
        END,
        breed = CASE
          WHEN $5::boolean THEN $6::varchar
          ELSE breed
        END,
        age = CASE
          WHEN $7::boolean THEN $8::integer
          ELSE age
        END,
        care_notes = CASE
          WHEN $9::boolean THEN $10::text
          ELSE care_notes
        END,
        photo_url = CASE
          WHEN $11::boolean THEN $12::text
          ELSE photo_url
        END
      WHERE id = $13 AND owner_id = $14
      RETURNING
        id,
        owner_id AS "ownerId",
        name,
        species,
        breed,
        age,
        care_notes AS "careNotes",
        photo_url AS "photoUrl";
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
        hasPhotoUrl,
        parsedPhotoUrl.value,
        petId,
        ownerId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found",
      });
    }

    res.json({
      pet: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const deletePet = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({
        error: "id must be a positive integer",
      });
    }

    const result = await query(
      `
      DELETE FROM pets
      WHERE id = $1 AND owner_id = $2
      RETURNING id;
      `,
      [petId, ownerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found",
      });
    }

    res.json({
      message: "Pet deleted successfully",
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
};