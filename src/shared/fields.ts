/**
 * "Time Estimate" is a field the org added to its process, so its reference name isn't known
 * up front (Custom.TimeEstimate, or whatever the process admin picked). Find it by display name.
 */
export const isTimeEstimate = (name: string): boolean => /^time\s*estimate\b/i.test(name.trim())
