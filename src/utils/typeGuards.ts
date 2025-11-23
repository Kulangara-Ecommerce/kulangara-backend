/**
 * Type guard utilities for safe type checking
 */

/**
 * Type guard to check if a value is a string
 */
export const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

/**
 * Type guard to check if a value is a non-empty string
 */
export const isNonEmptyString = (value: unknown): value is string => {
  return isString(value) && value.length > 0;
};

/**
 * Type guard to check if a value is a valid number
 */
export const isNumber = (value: unknown): value is number => {
  return typeof value === 'number' && !isNaN(value);
};

/**
 * Type guard to check if a value is a valid date string or Date object
 */
export const isValidDate = (value: unknown): value is string | Date => {
  if (value instanceof Date) {
    return !isNaN(value.getTime());
  }
  if (isString(value)) {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }
  return false;
};

/**
 * Safely get string from headers
 */
export const getHeaderString = (
  headers: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = headers[key];
  return isString(value) ? value : undefined;
};

/**
 * Safely get string from headers with fallback
 */
export const getHeaderStringOr = (
  headers: Record<string, unknown>,
  key: string,
  fallback: string
): string => {
  return getHeaderString(headers, key) || fallback;
};
