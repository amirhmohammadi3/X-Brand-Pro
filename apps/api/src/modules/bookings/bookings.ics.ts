/**
 * ICS feed builder (B6.4). One VCALENDAR with a VEVENT per booking, times
 * emitted as UTC (`…Z`) — the caller converts each row's business-local
 * wall clock (its own city timezone) before calling, so this builder is
 * pure and timezone-dumb. STATUS maps the lifecycle: pending → TENTATIVE,
 * confirmed → CONFIRMED, cancelled/rejected → CANCELLED.
 */

/** The one booking shape the builder needs (times pre-converted to UTC). */
export interface IcsBooking {
  id: string;
  /** `YYYYMMDDTHHMMSSZ` (UTC) start/end instants. */
  startUtc: string;
  endUtc: string;
  status: string;
  partySize: number;
  code: string;
  note: string | null;
  serviceName: string;
  businessName: string;
}

/** `Date` → `YYYYMMDDTHHMMSSZ`. */
export function icsStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/** Fold a content line to 75 octets (RFC 5545 §3.1 — continuation lines). */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const chunks: string[] = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    chunks.push(` ${rest.slice(0, 72)}`);
    rest = rest.slice(72);
  }
  if (rest.length > 0) chunks.push(` ${rest}`);
  return chunks.join('\r\n');
}

/** Escape TEXT values (commas, semicolons, backslashes, newlines). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsStatus(status: string): 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED' {
  if (status === 'pending') return 'TENTATIVE';
  if (status === 'cancelled' || status === 'rejected') return 'CANCELLED';
  return 'CONFIRMED';
}

/** One VEVENT per booking (B6.4). */
export function icsEvent(booking: IcsBooking): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${booking.id}@xbrand`,
    `DTSTAMP:${booking.startUtc}`,
    `DTSTART:${booking.startUtc}`,
    `DTEND:${booking.endUtc}`,
    `SUMMARY:${escapeText(`${booking.serviceName} — ${booking.businessName} (${booking.code})`)}`,
    `STATUS:${icsStatus(booking.status)}`,
    `DESCRIPTION:${escapeText(
      `رزرو ${booking.code} — ${booking.serviceName} در ${booking.businessName} | تعداد: ${booking.partySize} | وضعیت: ${booking.status}${booking.note ? ` | یادداشت: ${booking.note}` : ''}`,
    )}`,
    `LOCATION:${escapeText(booking.businessName)}`,
    'END:VEVENT',
  ];
  return lines.map(fold);
}

/**
 * The full calendar: header, events, footer. `calName` labels the feed in
 * calendar apps (X-WR-CALNAME).
 */
export function buildIcsCalendar(
  bookings: IcsBooking[],
  calName: string,
  stamp: Date = new Date(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//X-Brand//Booking Feed//FA',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calName)}`,
    `DTSTAMP:${icsStamp(stamp)}`,
    ...bookings.flatMap((booking) => icsEvent(booking)),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
