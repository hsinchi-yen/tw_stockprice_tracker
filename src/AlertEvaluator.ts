export type AlertStatus =
  | 'normal'
  | 'nearing-buy'   | 'nearing-sell'
  | 'breached-buy'  | 'breached-sell'
  | 'volume-spike';

/**
 * Priority (high → low):
 *   breached-buy / breached-sell  — price crossed a user target
 *   volume-spike                  — S1: unusual turnover rate
 *   nearing-buy  / nearing-sell   — price approaching a user target
 *   normal
 *
 * volumeThreshold: minimum volumeRatio (%) to trigger a spike alert (default 0.5)
 */
export function evaluateAlertStatus(
  price:              number,
  buyTarget:          number | null,
  sellTarget:         number | null,
  nearingBandFraction: number,
  volumeRatio:        number | null = null,
  volumeThreshold:    number        = 0.5,
): AlertStatus {
  // 1. Breach alerts — highest priority
  if (buyTarget  !== null && price <= buyTarget)  return 'breached-buy';
  if (sellTarget !== null && price >= sellTarget) return 'breached-sell';

  // 2. Volume spike (S1)
  if (volumeRatio != null && volumeRatio >= volumeThreshold) return 'volume-spike';

  // 3. Nearing user targets
  if (buyTarget  !== null && price <= buyTarget  * (1 + nearingBandFraction)) return 'nearing-buy';
  if (sellTarget !== null && price >= sellTarget * (1 - nearingBandFraction)) return 'nearing-sell';

  return 'normal';
}
