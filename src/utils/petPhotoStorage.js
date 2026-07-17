import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const MIME_TYPE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const SAFE_FILENAME_PATTERN =
  /^[0-9a-f-]+\.(?:jpg|png|webp)$/i;

function getConfiguredMaxBytes() {
  const configuredValue =
    process.env.PET_PHOTO_MAX_BYTES;

  if (
    configuredValue === undefined ||
    configuredValue.trim() === ""
  ) {
    return DEFAULT_MAX_BYTES;
  }

  const numericValue = Number(configuredValue);

  if (
    !Number.isSafeInteger(numericValue) ||
    numericValue <= 0
  ) {
    throw new Error(
      "PET_PHOTO_MAX_BYTES must be a positive integer",
    );
  }

  return numericValue;
}

export const PET_PHOTO_FIELD_NAME = "photo";

export const PET_PHOTO_MAX_BYTES =
  getConfiguredMaxBytes();

export const ALLOWED_PET_PHOTO_MIME_TYPES =
  new Set(MIME_TYPE_EXTENSIONS.keys());

export class PetPhotoStorageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PetPhotoStorageError";
    this.status = status;
  }
}

export function getPetPhotoUploadDirectory() {
  const configuredDirectory =
    process.env.PET_PHOTO_UPLOAD_DIR?.trim() ||
    "uploads/pets";

  return path.resolve(
    process.cwd(),
    configuredDirectory,
  );
}

function resolveStoredPhotoPath(filename) {
  if (
    typeof filename !== "string" ||
    !SAFE_FILENAME_PATTERN.test(filename) ||
    path.basename(filename) !== filename
  ) {
    throw new PetPhotoStorageError(
      "Stored pet photo filename is invalid",
      500,
    );
  }

  return path.join(
    getPetPhotoUploadDirectory(),
    filename,
  );
}

async function detectPetPhotoType(buffer) {
  let detectedType;

  try {
    detectedType =
      await fileTypeFromBuffer(buffer);
  } catch {
    detectedType = null;
  }

  const extension = MIME_TYPE_EXTENSIONS.get(
    detectedType?.mime,
  );

  if (!extension) {
    throw new PetPhotoStorageError(
      "Pet photo must be a JPEG, PNG, or WebP file",
      415,
    );
  }

  return {
    contentType: detectedType.mime,
    extension,
  };
}

export async function savePetPhoto(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new PetPhotoStorageError(
      "A pet photo file is required",
      400,
    );
  }

  if (buffer.length > PET_PHOTO_MAX_BYTES) {
    throw new PetPhotoStorageError(
      "Pet photo exceeds the configured size limit",
      413,
    );
  }

  const {
    contentType,
    extension,
  } = await detectPetPhotoType(buffer);

  const filename =
    `${randomUUID()}.${extension}`;

  const uploadDirectory =
    getPetPhotoUploadDirectory();

  await fs.mkdir(uploadDirectory, {
    recursive: true,
  });

  const filePath =
    resolveStoredPhotoPath(filename);

  await fs.writeFile(filePath, buffer, {
    flag: "wx",
    mode: 0o600,
  });

  return {
    filename,
    contentType,
  };
}

export async function readPetPhoto(filename) {
  if (!filename) {
    return null;
  }

  const filePath =
    resolveStoredPhotoPath(filename);

  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function deletePetPhoto(filename) {
  if (!filename) {
    return false;
  }

  const filePath =
    resolveStoredPhotoPath(filename);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}