import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Extracts audio duration in seconds using ffprobe.
 * Returns an integer (ceil).
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) {
      throw new Error("ffprobe returned non-numeric duration");
    }
    return Math.ceil(duration);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to extract audio duration: ${msg}`);
  }
}
