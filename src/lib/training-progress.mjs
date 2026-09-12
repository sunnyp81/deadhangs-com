const isoDate = (value) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

function localCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function calendarStart(today, days) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - days + 1);
  return isoDate(start);
}

function currentWeekStart(today) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return isoDate(start);
}

/**
 * Browser-free progress derived only from validated v1 log values.
 * @param {Array<{date: string, seconds: number, assistance: string}>} entries
 * @param {string} assistance
 * @param {number|null} targetSeconds
 * @param {Date} today
 * @param {30|90} windowDays
 */
export function progressFor(entries, assistance, targetSeconds = null, today = new Date(), windowDays = 90) {
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayIso = isoDate(todayDate);
  const dailyBest = new Map();
  for (const entry of entries) {
    if (entry?.assistance !== assistance || !Number.isFinite(entry?.seconds) || entry.seconds <= 0) continue;
    const date = localCalendarDate(entry.date);
    if (!date || entry.date > todayIso) continue;
    dailyBest.set(entry.date, Math.max(dailyBest.get(entry.date) || 0, entry.seconds));
  }
  const daily = [...dailyBest].map(([date, seconds]) => ({ date, seconds })).sort((left, right) => left.date.localeCompare(right.date));
  const selectedWindow = daily.filter((entry) => entry.date >= calendarStart(todayDate, windowDays));
  const latest = daily.at(-1) || null;
  const allTimeBest = daily.length ? Math.max(...daily.map((entry) => entry.seconds)) : null;
  const firstWindow = selectedWindow[0] || null;
  const latestWindow = selectedWindow.at(-1) || null;
  const comparableTarget = Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : null;
  return {
    allTimeBest,
    daily,
    latest,
    practiceDaysThisWeek: daily.filter((entry) => entry.date >= currentWeekStart(todayDate)).length,
    selectedWindow,
    targetSeconds: comparableTarget,
    visualTargetPercent: latest && comparableTarget ? Math.min(100, (latest.seconds / comparableTarget) * 100) : null,
    windowChange: firstWindow && latestWindow && firstWindow.date !== latestWindow.date ? latestWindow.seconds - firstWindow.seconds : null,
    windowDays,
    windowStart: calendarStart(todayDate, windowDays),
  };
}
