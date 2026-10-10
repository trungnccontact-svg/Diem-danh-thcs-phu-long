// Pure schedule evaluation shared by the scheduler and its tests.
function dueSchedule(s, now = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(' ');
  const [date, time] = parts;
  const day = new Date(date + 'T12:00:00+07:00').getUTCDay();
  if (!s || !s.enabled || !s.content || !['daily', 'weekdays', 'once'].includes(s.repeat) || s.end <= s.start || time < s.start || time >= s.end || (s.repeat === 'once' && s.date !== date) || (s.repeat === 'weekdays' && (day === 0 || day === 6))) return null;
  return { key: `${date}_${s.updatedAt}`, ttl: Math.max(1, Math.floor((new Date(`${date}T${s.end}:00+07:00`).getTime() - now.getTime()) / 1000)) };
}
module.exports = { dueSchedule };
