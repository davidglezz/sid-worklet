export interface Song {
  relativeUrl: string;
  path: string;
  name: string;
  durations: string[];
}

/**
 * Parses a line from the song list file.
 * Format: `<relativeUrl>\t<duration1>\t<duration2>...`
 * @returns Parsed Song or null if the line is empty / invalid.
 */
export function parseSongLine(line: string): Song | null {
  const [relativeUrl, ...durations] = line.trim().split('\t').filter(Boolean);
  if (!relativeUrl) return null;

  const pathSep = relativeUrl.lastIndexOf('/');
  const fullName = pathSep >= 0 ? relativeUrl.slice(pathSep + 1) : relativeUrl;
  const dotSep = fullName.lastIndexOf('.');

  return {
    relativeUrl,
    path: pathSep >= 0 ? relativeUrl.slice(0, pathSep) : '',
    name: dotSep >= 0 ? fullName.slice(0, dotSep) : fullName,
    durations,
  };
}

/**
 * Parses a duration string in `MM:SS` format into total seconds.
 * Returns 0 for missing, empty, or malformed input.
 */
export function parseDuration(value: string | undefined): number {
  if (!value) return 0;
  const [min, sec] = value.trim().split(':');
  const minutes = Number(min);
  const seconds = Number(sec);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
  return Math.max(0, minutes * 60 + seconds);
}

/**
 * Formats a duration in seconds as `MM:SS`.
 * Negative values are clamped to `00:00`.
 */
export function formatTime(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
