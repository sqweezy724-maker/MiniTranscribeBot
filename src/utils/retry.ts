/**
 * Executes an async function and retries once on failure.
 * Throws the last error if all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 1,
  label: string = "operation"
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        console.warn(`[retry] ${label} failed on attempt ${attempt + 1}, retrying...`);
      }
    }
  }
  throw lastError;
}
