import type { DayPlan } from './types'
import { dayKey } from './time'

export interface CurrentPlan {
  plan: DayPlan
  day: string
  /** true when this is an earlier day's plan standing in for today */
  carried: boolean
}

/**
 * Today's plan, or if you didn't make one, the last real plan before today: not planning
 * means you're carrying on with what you were already doing. "Skip today" counts as a
 * choice for today and carries nothing.
 */
export function currentPlan(plans: Record<string, DayPlan>, now = Date.now()): CurrentPlan | undefined {
  const today = dayKey(now)
  if (plans[today]) return { plan: plans[today], day: today, carried: false }
  const day = Object.keys(plans)
    .filter((k) => k < today && !plans[k].skipped && plans[k].itemIds.length)
    .sort()
    .at(-1)
  return day ? { plan: plans[day], day, carried: true } : undefined
}
