import { query } from "../db/client.js";
import {
  hasOwn,
  isPlainObject,
  isValidDate,
  parseNumber,
  parsePositiveInteger,
} from "../utils/validation.js";

const HEALTH_RESPONSE_FIELDS = `
  id AS "petId",
  vet_name AS "vetName",
  vet_phone AS "vetPhone",
  microchip_number AS "microchipNumber",
  weight_lbs AS "weightLbs",
  allergies,
  medications,
  spayed_neutered AS "spayedNeutered"
`;

const VACCINATION_RESPONSE_FIELDS = `
  id,
  pet_id AS "petId",
  vaccine_name AS "vaccineName",
  administered_date AS "administeredDate",
  expiration_date AS "expirationDate",
  notes,
  created_at AS "createdAt"
`;

function getUserId(req) {
  return req.user.id || req.user.userId;
}

function parseNullableString(value, field, maxLength) {
  if (value === undefined || value === null) {
    return { value: null, error: null };
  }

  if (typeof value !== "string") {
    return { value: null, error: `${field} must be a string or null` };
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    return {
      value: null,
      error: `${field} cannot exceed ${maxLength} characters`,
    };
  }

  return { value: normalizedValue || null, error: null };
}

function parseNullableWeight(value) {
  if (value === undefined || value === null) {
    return { value: null, error: null };
  }

  const numericValue = parseNumber(value, { min: 0.1, max: 999.9 });

  if (numericValue === null) {
    return {
      value: null,
      error: "weightLbs must be a positive number or null",
    };
  }

  return { value: numericValue, error: null };
}

function parseNullableBoolean(value, field) {
  if (value === undefined || value === null) {
    return { value: null, error: null };
  }

  if (typeof value !== "boolean") {
    return { value: null, error: `${field} must be a boolean or null` };
  }

  return { value, error: null };
}

function parseNullableDate(value, field) {
  if (value === undefined || value === null) {
    return { value: null, error: null };
  }

  if (!isValidDate(value)) {
    return { value: null, error: `${field} must be a valid YYYY-MM-DD date` };
  }

  return { value, error: null };
}

async function findOwnedPet(petId, ownerId) {
  const { rows } = await query(
    `
    SELECT id
    FROM pets
    WHERE id = $1
      AND owner_id = $2;
    `,
    [petId, ownerId],
  );

  return rows[0] || null;
}

export async function getPetHealth(req, res, next) {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({ error: "id must be a positive integer" });
    }

    const petResult = await query(
      `
      SELECT
        ${HEALTH_RESPONSE_FIELDS}
      FROM pets
      WHERE id = $1
        AND owner_id = $2;
      `,
      [petId, ownerId],
    );

    if (petResult.rows.length === 0) {
      return res.status(404).json({ error: "Pet not found" });
    }

    const vaccinationsResult = await query(
      `
      SELECT
        ${VACCINATION_RESPONSE_FIELDS}
      FROM pet_vaccinations
      WHERE pet_id = $1
      ORDER BY administered_date DESC, id DESC;
      `,
      [petId],
    );

    res.status(200).json({
      health: petResult.rows[0],
      vaccinations: vaccinationsResult.rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePetHealth(req, res, next) {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({ error: "id must be a positive integer" });
    }

    if (!isPlainObject(req.body)) {
      return res
        .status(400)
        .json({ error: "Request body must be a JSON object" });
    }

    const hasVetName = hasOwn(req.body, "vetName");
    const hasVetPhone = hasOwn(req.body, "vetPhone");
    const hasMicrochipNumber = hasOwn(req.body, "microchipNumber");
    const hasWeightLbs = hasOwn(req.body, "weightLbs");
    const hasAllergies = hasOwn(req.body, "allergies");
    const hasMedications = hasOwn(req.body, "medications");
    const hasSpayedNeutered = hasOwn(req.body, "spayedNeutered");

    if (
      !hasVetName &&
      !hasVetPhone &&
      !hasMicrochipNumber &&
      !hasWeightLbs &&
      !hasAllergies &&
      !hasMedications &&
      !hasSpayedNeutered
    ) {
      return res
        .status(400)
        .json({ error: "At least one health field is required" });
    }

    const parsedVetName = hasVetName
      ? parseNullableString(req.body.vetName, "vetName", 100)
      : { value: null, error: null };
    if (parsedVetName.error)
      return res.status(400).json({ error: parsedVetName.error });

    const parsedVetPhone = hasVetPhone
      ? parseNullableString(req.body.vetPhone, "vetPhone", 20)
      : { value: null, error: null };
    if (parsedVetPhone.error)
      return res.status(400).json({ error: parsedVetPhone.error });

    const parsedMicrochipNumber = hasMicrochipNumber
      ? parseNullableString(
          req.body.microchipNumber,
          "microchipNumber",
          50,
        )
      : { value: null, error: null };
    if (parsedMicrochipNumber.error)
      return res.status(400).json({ error: parsedMicrochipNumber.error });

    const parsedWeightLbs = hasWeightLbs
      ? parseNullableWeight(req.body.weightLbs)
      : { value: null, error: null };
    if (parsedWeightLbs.error)
      return res.status(400).json({ error: parsedWeightLbs.error });

    const parsedAllergies = hasAllergies
      ? parseNullableString(req.body.allergies, "allergies", 2000)
      : { value: null, error: null };
    if (parsedAllergies.error)
      return res.status(400).json({ error: parsedAllergies.error });

    const parsedMedications = hasMedications
      ? parseNullableString(req.body.medications, "medications", 2000)
      : { value: null, error: null };
    if (parsedMedications.error)
      return res.status(400).json({ error: parsedMedications.error });

    const parsedSpayedNeutered = hasSpayedNeutered
      ? parseNullableBoolean(req.body.spayedNeutered, "spayedNeutered")
      : { value: null, error: null };
    if (parsedSpayedNeutered.error)
      return res.status(400).json({ error: parsedSpayedNeutered.error });

    const result = await query(
      `
      UPDATE pets
      SET
        vet_name = CASE WHEN $1::boolean THEN $2::varchar ELSE vet_name END,
        vet_phone = CASE WHEN $3::boolean THEN $4::varchar ELSE vet_phone END,
        microchip_number = CASE
          WHEN $5::boolean THEN $6::varchar ELSE microchip_number
        END,
        weight_lbs = CASE
          WHEN $7::boolean THEN $8::numeric ELSE weight_lbs
        END,
        allergies = CASE WHEN $9::boolean THEN $10::text ELSE allergies END,
        medications = CASE
          WHEN $11::boolean THEN $12::text ELSE medications
        END,
        spayed_neutered = CASE
          WHEN $13::boolean THEN $14::boolean ELSE spayed_neutered
        END
      WHERE id = $15
        AND owner_id = $16
      RETURNING
        ${HEALTH_RESPONSE_FIELDS};
      `,
      [
        hasVetName,
        parsedVetName.value,
        hasVetPhone,
        parsedVetPhone.value,
        hasMicrochipNumber,
        parsedMicrochipNumber.value,
        hasWeightLbs,
        parsedWeightLbs.value,
        hasAllergies,
        parsedAllergies.value,
        hasMedications,
        parsedMedications.value,
        hasSpayedNeutered,
        parsedSpayedNeutered.value,
        petId,
        ownerId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pet not found" });
    }

    res.status(200).json({ health: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function addVaccination(req, res, next) {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);

    if (!petId) {
      return res.status(400).json({ error: "id must be a positive integer" });
    }

    if (!isPlainObject(req.body)) {
      return res
        .status(400)
        .json({ error: "Request body must be a JSON object" });
    }

    const { vaccineName, administeredDate, expirationDate, notes } =
      req.body;

    if (
      typeof vaccineName !== "string" ||
      vaccineName.trim().length === 0 ||
      vaccineName.trim().length > 100
    ) {
      return res.status(400).json({
        error:
          "vaccineName must be a non-empty string no longer than 100 characters",
      });
    }

    if (!isValidDate(administeredDate)) {
      return res
        .status(400)
        .json({ error: "administeredDate must be a valid YYYY-MM-DD date" });
    }

    const parsedExpirationDate = parseNullableDate(
      expirationDate,
      "expirationDate",
    );
    if (parsedExpirationDate.error)
      return res.status(400).json({ error: parsedExpirationDate.error });

    const parsedNotes = parseNullableString(notes, "notes", 1000);
    if (parsedNotes.error)
      return res.status(400).json({ error: parsedNotes.error });

    const pet = await findOwnedPet(petId, ownerId);

    if (!pet) {
      return res.status(404).json({ error: "Pet not found" });
    }

    const { rows } = await query(
      `
      INSERT INTO pet_vaccinations (
        pet_id,
        vaccine_name,
        administered_date,
        expiration_date,
        notes
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        ${VACCINATION_RESPONSE_FIELDS};
      `,
      [
        petId,
        vaccineName.trim(),
        administeredDate,
        parsedExpirationDate.value,
        parsedNotes.value,
      ],
    );

    res.status(201).json({ vaccination: rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateVaccination(req, res, next) {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);
    const vaccinationId = parsePositiveInteger(req.params.vaccinationId);

    if (!petId || !vaccinationId) {
      return res
        .status(400)
        .json({ error: "id and vaccinationId must be positive integers" });
    }

    if (!isPlainObject(req.body)) {
      return res
        .status(400)
        .json({ error: "Request body must be a JSON object" });
    }

    const pet = await findOwnedPet(petId, ownerId);

    if (!pet) {
      return res.status(404).json({ error: "Pet not found" });
    }

    const hasVaccineName = hasOwn(req.body, "vaccineName");
    const hasAdministeredDate = hasOwn(req.body, "administeredDate");
    const hasExpirationDate = hasOwn(req.body, "expirationDate");
    const hasNotes = hasOwn(req.body, "notes");

    if (
      !hasVaccineName &&
      !hasAdministeredDate &&
      !hasExpirationDate &&
      !hasNotes
    ) {
      return res
        .status(400)
        .json({ error: "At least one vaccination field is required" });
    }

    let parsedVaccineName = { value: null, error: null };
    if (hasVaccineName) {
      const { vaccineName } = req.body;
      if (
        typeof vaccineName !== "string" ||
        vaccineName.trim().length === 0 ||
        vaccineName.trim().length > 100
      ) {
        return res.status(400).json({
          error:
            "vaccineName must be a non-empty string no longer than 100 characters",
        });
      }
      parsedVaccineName = { value: vaccineName.trim(), error: null };
    }

    let parsedAdministeredDate = { value: null, error: null };
    if (hasAdministeredDate) {
      if (!isValidDate(req.body.administeredDate)) {
        return res.status(400).json({
          error: "administeredDate must be a valid YYYY-MM-DD date",
        });
      }
      parsedAdministeredDate = {
        value: req.body.administeredDate,
        error: null,
      };
    }

    const parsedExpirationDate = hasExpirationDate
      ? parseNullableDate(req.body.expirationDate, "expirationDate")
      : { value: null, error: null };
    if (parsedExpirationDate.error)
      return res.status(400).json({ error: parsedExpirationDate.error });

    const parsedNotes = hasNotes
      ? parseNullableString(req.body.notes, "notes", 1000)
      : { value: null, error: null };
    if (parsedNotes.error)
      return res.status(400).json({ error: parsedNotes.error });

    const { rows } = await query(
      `
      UPDATE pet_vaccinations
      SET
        vaccine_name = CASE
          WHEN $1::boolean THEN $2::varchar ELSE vaccine_name
        END,
        administered_date = CASE
          WHEN $3::boolean THEN $4::date ELSE administered_date
        END,
        expiration_date = CASE
          WHEN $5::boolean THEN $6::date ELSE expiration_date
        END,
        notes = CASE WHEN $7::boolean THEN $8::text ELSE notes END
      WHERE id = $9
        AND pet_id = $10
      RETURNING
        ${VACCINATION_RESPONSE_FIELDS};
      `,
      [
        hasVaccineName,
        parsedVaccineName.value,
        hasAdministeredDate,
        parsedAdministeredDate.value,
        hasExpirationDate,
        parsedExpirationDate.value,
        hasNotes,
        parsedNotes.value,
        vaccinationId,
        petId,
      ],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Vaccination record not found" });
    }

    res.status(200).json({ vaccination: rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function deleteVaccination(req, res, next) {
  try {
    const ownerId = getUserId(req);
    const petId = parsePositiveInteger(req.params.id);
    const vaccinationId = parsePositiveInteger(req.params.vaccinationId);

    if (!petId || !vaccinationId) {
      return res
        .status(400)
        .json({ error: "id and vaccinationId must be positive integers" });
    }

    const pet = await findOwnedPet(petId, ownerId);

    if (!pet) {
      return res.status(404).json({ error: "Pet not found" });
    }

    const { rows } = await query(
      `
      DELETE FROM pet_vaccinations
      WHERE id = $1
        AND pet_id = $2
      RETURNING id;
      `,
      [vaccinationId, petId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Vaccination record not found" });
    }

    res.status(200).json({ message: "Vaccination record deleted" });
  } catch (error) {
    next(error);
  }
}
