export class ComfyError extends Error {
  readonly retryable = false;
  constructor(message: string, public readonly code = 'COMFY_INVALID', public readonly status = 400) {
    super(message);
    this.name = 'ComfyError';
  }
}
