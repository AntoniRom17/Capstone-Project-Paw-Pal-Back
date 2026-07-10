import { query } from "../db/client.js";

const getUserId = (req) => {
  return req.user.id || req.user.userId;
};

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
      [ownerId]
    );

    res.json({
      pets: result.rows
    });
  } catch (error) {
    next(error);
  }
};

export const createPet = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);
    const { name, species, breed, age, careNotes, photoUrl } = req.body;

    if (!name || !species) {
      return res.status(400).json({
        error: "name and species are required"
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
      [ownerId, name, species, breed || null, age || null, careNotes || null, photoUrl || null]
    );

    res.status(201).json({
      pet: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

export const getPetById = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);
    const { id } = req.params;

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
      [id, ownerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found"
      });
    }

    res.json({
      pet: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

export const updatePet = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);
    const { id } = req.params;
    const { name, species, breed, age, careNotes, photoUrl } = req.body;

    const result = await query(
      `
      UPDATE pets
      SET
        name = COALESCE($1, name),
        species = COALESCE($2, species),
        breed = COALESCE($3, breed),
        age = COALESCE($4, age),
        care_notes = COALESCE($5, care_notes),
        photo_url = COALESCE($6, photo_url)
      WHERE id = $7 AND owner_id = $8
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
      [name, species, breed, age, careNotes, photoUrl, id, ownerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found"
      });
    }

    res.json({
      pet: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

export const deletePet = async (req, res, next) => {
  try {
    const ownerId = getUserId(req);
    const { id } = req.params;

    const result = await query(
      `
      DELETE FROM pets
      WHERE id = $1 AND owner_id = $2
      RETURNING id;
      `,
      [id, ownerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pet not found"
      });
    }

    res.json({
      message: "Pet deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};