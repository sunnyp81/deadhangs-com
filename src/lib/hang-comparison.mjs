/** @param {number} current @param {number} target @param {number|null} [previous] */
export function compareHang(current, target, previous = null) {
  if (!Number.isFinite(current) || current < 0 || current > 3600) throw new Error('Enter a hold between 0 and 3,600 seconds.');
  if (!Number.isFinite(target) || target <= 0 || target > 3600) throw new Error('Enter a target between 1 and 3,600 seconds.');
  if (previous !== null && (!Number.isFinite(previous) || previous <= 0 || previous > 3600)) throw new Error('Your previous hold must be greater than zero and no more than 3,600 seconds.');
  return {
    percent: Math.round(current / target * 100),
    remaining: Math.max(0, Math.round((target - current) * 10) / 10),
    difference: previous === null ? null : Math.round((current - previous) * 10) / 10,
    change: previous === null ? null : Math.round((current - previous) / previous * 100),
  };
}
