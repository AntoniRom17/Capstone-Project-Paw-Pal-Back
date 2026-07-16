export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

export function hasOwn(value, key) {
  return (
    isPlainObject(value) &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

export function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim();
}

export function isStringWithinLength(
  value,
  {
    min = 0,
    max = Number.POSITIVE_INFINITY,
    trim = true,
  } = {},
) {
  if (typeof value !== "string") {
    return false;
  }

  const checkedValue = trim ? value.trim() : value;

  return (
    checkedValue.length >= min &&
    checkedValue.length <= max
  );
}

export function parsePositiveInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0
      ? value
      : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!/^[1-9]\d*$/.test(normalizedValue)) {
    return null;
  }

  const numericValue = Number(normalizedValue);

  return Number.isSafeInteger(numericValue)
    ? numericValue
    : null;
}

export function parseNumber(
  value,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
    allowString = true,
  } = {},
) {
  if (
    typeof value !== "number" &&
    !(allowString && typeof value === "string")
  ) {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (integer && !Number.isInteger(numericValue)) {
    return null;
  }

  if (numericValue < min || numericValue > max) {
    return null;
  }

  return numericValue;
}

export function isValidEmail(value) {
  if (
    !isStringWithinLength(value, {
      min: 3,
      max: 255,
    })
  ) {
    return false;
  }

  const normalizedValue = value.trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    normalizedValue,
  );
}

export function isValidState(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z]{2}$/.test(value.trim())
  );
}

export function isValidZipCode(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false;
  }

  return /^\d{5}(?:-\d{4})?$/.test(
    String(value).trim(),
  );
}

export function isValidHttpUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048
  ) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

export function isValidDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function isValidTime(value) {
  return (
    typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  );
}