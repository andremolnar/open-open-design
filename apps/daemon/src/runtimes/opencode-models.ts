/** OpenCode references retain the provider namespace and literal spaces in model names. */
export function sanitizeOpenCodeModelReference(value: string): string | null {
  if (value.length > 200 || /[\x00-\x1f\x7f-\x9f]/u.test(value)) return null;
  const reference = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9~][A-Za-z0-9 ._/:@~-]*$/u.test(reference)
    ? reference : null;
}

export const INVALID_OPENCODE_MODEL_MESSAGE = 'Invalid OpenCode model reference. Use provider/model; spaces inside the model name are allowed. Control characters, unsupported punctuation and IDs longer than 200 characters are not allowed.';
