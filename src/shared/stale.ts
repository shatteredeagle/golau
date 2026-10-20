import { daysSince } from './time'
import type { WorkItem } from './types'

/** Items you're actively on that haven't been touched in a while. */
export function staleItems(items: WorkItem[], staleDays: number, now = Date.now()): WorkItem[] {
  return items.filter(
    (i) => (i.category === 'InProgress' || i.category === 'Resolved') && daysSince(i.changedDate, now) >= staleDays
  )
}
