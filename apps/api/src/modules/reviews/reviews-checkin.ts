import {
  CHECKIN_FUTURE_TOLERANCE_SEC,
  CHECKIN_MAX_AGE_DAYS,
  CHECKIN_RADIUS_M,
} from '@app/contracts';

/**
 * B4.6 check-in validation — PURE, DB-free, side-effect-free so it is
 * unit-testable without Docker (the service feeds it the business location
 * it read from PostGIS and the caller's claimed point/time).
 *
 * A check-in proves WHERE and WHEN: the claimed point must sit within
 * CHECKIN_RADIUS_M of the business (great-circle/haversine — good enough at
 * city scale; PostGIS ST_Distance would agree to centimeters) and the
 * claimed time must fall inside the visit window:
 *   now - CHECKIN_MAX_AGE_DAYS ≤ at ≤ now + CHECKIN_FUTURE_TOLERANCE_SEC
 * (the small future tolerance absorbs device clock skew only — a check-in
 * "tomorrow" is nonsense data, not a loophole).
 *
 * Rejections carry the measured values in `details` so a legitimate user
 * sees WHY ("۳۲۰ متر فاصله، سقف ۲۵۰") — the radius/limits are public
 * product rules, not filter secrets (unlike the B4.5 spam internals).
 */

/** WGS84 point in degrees. */
export interface CheckinPoint {
  lat: number;
  lng: number;
}

/** The caller's claimed check-in (validated shape from the contracts). */
export interface CheckinInput extends CheckinPoint {
  /** Claimed visit time; `undefined` means "now" (stamped by the caller). */
  at?: string;
}

/** The business context the check-in validates against. */
export interface CheckinBusinessContext {
  /** Business location (ST_Y/ST_X of the PostGIS point); null when unknown. */
  lat?: number | null;
  lng?: number | null;
}

export const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two WGS84 points, in meters (haversine). */
export function haversineMeters(a: CheckinPoint, b: CheckinPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type CheckinResult =
  | { ok: true; at: Date; distanceM: number }
  | { ok: false; reason: 'no_business_location' }
  | { ok: false; reason: 'too_far'; distanceM: number; radiusM: number }
  | { ok: false; reason: 'in_future'; maxFutureSec: number }
  | { ok: false; reason: 'too_old'; maxAgeDays: number };

/**
 * Validate one claimed check-in against the business location and the visit
 * window. Order: location availability → time window → distance (the time
 * checks are cheap and fail with the most actionable message).
 */
export function validateCheckin(
  input: CheckinInput,
  business: CheckinBusinessContext,
  now: Date,
): CheckinResult {
  if (typeof business.lat !== 'number' || typeof business.lng !== 'number') {
    return { ok: false, reason: 'no_business_location' };
  }
  const at = input.at ? new Date(input.at) : now;
  const maxFutureMs = CHECKIN_FUTURE_TOLERANCE_SEC * 1000;
  if (at.getTime() > now.getTime() + maxFutureMs) {
    return { ok: false, reason: 'in_future', maxFutureSec: CHECKIN_FUTURE_TOLERANCE_SEC };
  }
  const maxAgeMs = CHECKIN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (at.getTime() < now.getTime() - maxAgeMs) {
    return { ok: false, reason: 'too_old', maxAgeDays: CHECKIN_MAX_AGE_DAYS };
  }
  const distanceM = haversineMeters(
    { lat: input.lat, lng: input.lng },
    { lat: business.lat, lng: business.lng },
  );
  if (distanceM > CHECKIN_RADIUS_M) {
    return { ok: false, reason: 'too_far', distanceM, radiusM: CHECKIN_RADIUS_M };
  }
  return { ok: true, at, distanceM };
}
