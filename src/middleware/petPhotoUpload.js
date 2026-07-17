import multer from "multer";
import {
  ALLOWED_PET_PHOTO_MIME_TYPES,
  PET_PHOTO_FIELD_NAME,
  PET_PHOTO_MAX_BYTES,
} from "../utils/petPhotoStorage.js";

function createUploadError(
  message,
  status,
) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PET_PHOTO_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter: (
    req,
    file,
    callback,
  ) => {
    const normalizedMimeType =
      file.mimetype
        ?.trim()
        .toLowerCase();

    if (
      !ALLOWED_PET_PHOTO_MIME_TYPES.has(
        normalizedMimeType,
      )
    ) {
      callback(
        createUploadError(
          "Pet photo must be a JPEG, PNG, or WebP file",
          415,
        ),
      );

      return;
    }

    callback(null, true);
  },
});

function sendMulterError(
  error,
  res,
) {
  if (error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({
      error:
        "Pet photo exceeds the configured size limit",
    });

    return;
  }

  if (
    error.code === "LIMIT_UNEXPECTED_FILE"
  ) {
    res.status(400).json({
      error:
        `Upload one file using the ` +
        `'${PET_PHOTO_FIELD_NAME}' field`,
    });

    return;
  }

  res.status(400).json({
    error: "Invalid pet photo upload",
  });
}

export function uploadPetPhoto(
  req,
  res,
  next,
) {
  upload.single(PET_PHOTO_FIELD_NAME)(
    req,
    res,
    (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        sendMulterError(error, res);
        return;
      }

      if (
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 599
      ) {
        res.status(error.status).json({
          error: error.message,
        });

        return;
      }

      next(error);
    },
  );
}