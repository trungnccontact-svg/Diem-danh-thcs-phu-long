import { attendanceTimeStatus } from './attendance-time';

describe('Khung giờ điểm danh theo giờ Việt Nam', () => {
  const cases = [
    ['morning', '06:59:59', false],
    ['morning', '07:00:00', true],
    ['morning', '10:39:59', true],
    ['morning', '10:40:00', false],
    ['morning', '10:40:59', false],
    ['afternoon', '13:09:59', false],
    ['afternoon', '13:10:00', true],
    ['afternoon', '16:59:59', true],
    ['afternoon', '17:00:00', false],
    ['afternoon', '17:00:59', false]
  ] as const;

  for (const [session, time, allowed] of cases) {
    it(`${session}: ${time} is ${allowed ? 'open' : 'locked'}`, () => {
      const now = new Date(`2026-10-11T${time}+07:00`);
      expect(attendanceTimeStatus(session, now).allowed).toBe(allowed);
    });
  }

  it('uses Vietnam time regardless of the device timezone', () => {
    expect(attendanceTimeStatus('morning', new Date('2026-10-11T00:00:00Z')).allowed).toBeTrue();
    expect(attendanceTimeStatus('afternoon', new Date('2026-10-11T10:00:00Z')).allowed).toBeFalse();
  });

  it('keeps test accounts available outside the attendance window', () => {
    const now = new Date('2026-10-11T23:00:00+07:00');
    expect(attendanceTimeStatus('morning', now, true).allowed).toBeTrue();
    expect(attendanceTimeStatus('afternoon', now, true).allowed).toBeTrue();
  });
});
