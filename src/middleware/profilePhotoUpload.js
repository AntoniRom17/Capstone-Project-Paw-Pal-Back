import multer from "multer";
import {
  ALLOWED_PROFILE_PHOTO_MIME_TYPES,
  PROFILE_PHOTO_FIELD_NAME,
  PROFILE_PHOTO_MAX_BYTES,
} from "../utils/profilePhotoStorage.js";

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
    fileSize: PROFILE_PHOTO_MAX_BYTES,
    files: 1,
    fields: 0,
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
      !ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(
        normalizedMimeType,
      )
    ) {
      callback(
        createUploadError(
          "Profile photo must be a JPEG, PNG, or WebP file",
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
        "Profile photo exceeds the configured size limit",
    });

    return;
  }

  if (
    error.code === "LIMIT_UNEXPECTED_FILE"
  ) {
    res.status(400).json({
      error:
        `Upload one file using the ` +
        `'${PROFILE_PHOTO_FIELD_NAME}' field`,
    });

    return;
  }

  res.status(400).json({
    error: "Invalid profile photo upload",
  });
}

export function uploadProfilePhoto(
  req,
  res,
  next,
) {
  upload.single(PROFILE_PHOTO_FIELD_NAME)(
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