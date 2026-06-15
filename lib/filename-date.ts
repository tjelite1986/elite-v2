// Best-effort extraction of a capture date from a filename. Covers the common
// camera / messaging-app patterns (IMG_YYYYMMDD, YYYYMMDD_HHMMSS, screenshots,
// WhatsApp/Signal, unix epochs). Returns null when nothing plausible is found.
export function parseFilenameDate(filename: string): Date | null {
  const name = filename.replace(/\.[^.]+$/, "");

  const valid = (y: number, mo: number, d: number) =>
    y >= 1995 &&
    y <= new Date().getFullYear() + 1 &&
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= 31;

  const make = (y: number, mo: number, d: number, h = 12, mi = 0, s = 0) =>
    valid(y, mo, d) ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : null;

  // YYYYMMDD with optional _HHMMSS (IMG_20240115_153012, 20240115153012, etc.)
  let m = name.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?:[_-]?(\d{2})(\d{2})(\d{2}))?(?!\d)/);
  if (m) {
    const d = make(
      +m[1],
      +m[2],
      +m[3],
      m[4] ? +m[4] : 12,
      m[5] ? +m[5] : 0,
      m[6] ? +m[6] : 0
    );
    if (d) return d;
  }

  // YYYY-MM-DD or YYYY_MM_DD with optional time
  m = name.match(
    /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?:[ _T-]?(\d{2})[-:.]?(\d{2})[-:.]?(\d{2}))?/
  );
  if (m) {
    const d = make(
      +m[1],
      +m[2],
      +m[3],
      m[4] ? +m[4] : 12,
      m[5] ? +m[5] : 0,
      m[6] ? +m[6] : 0
    );
    if (d) return d;
  }

  // 13-digit millisecond epoch
  m = name.match(/(?<!\d)(\d{13})(?!\d)/);
  if (m) {
    const d = new Date(+m[1]);
    if (d.getFullYear() >= 1995 && d.getFullYear() <= new Date().getFullYear() + 1)
      return d;
  }

  return null;
}
