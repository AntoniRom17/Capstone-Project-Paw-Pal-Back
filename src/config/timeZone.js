export const DEFAULT_APP_TIME_ZONE = "UTC";

function isSupportedTimeZone(value) {
  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: value,
      },
    ).format();

    return true;
  } catch {
    return false;
  }
}

export function resolveAppTimeZone(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_APP_TIME_ZONE;
  }

  if (typeof value !== "string") {
    throw new Error(
      "APP_TIME_ZONE must be a valid IANA time zone",
    );
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return DEFAULT_APP_TIME_ZONE;
  }

  if (
    !/^[A-Za-z0-9_+\-/]+$/.test(
      normalizedValue,
    ) ||
    !isSupportedTimeZone(normalizedValue)
  ) {
    throw new Error(
      "APP_TIME_ZONE must be a valid IANA time zone, such as America/Chicago or UTC",
    );
  }

  return normalizedValue;
}