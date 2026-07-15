/**
 * One-off seed: 10 attendance rows for a single employee.
 *  - Item 1  = today, checked IN only (no check-out yet).
 *  - Items 2-10 = the previous 9 working-days, fully checked in AND out.
 *
 * Run:  node prisma/seed-attendance.js
 */
require('dotenv').config();
const { PrismaClient, AttendanceStatus } = require('@prisma/client');

const prisma = new PrismaClient();

const EMPLOYEE_ID = 'bff13eb4-8e4f-42bf-9bb9-bd68a9201133';
const TZ_OFFSET = '+07:00'; // Asia/Vientiane (matches datetime.util.ts)

/** "YYYY-MM-DD" for `now` minus `daysAgo`, in the Vientiane calendar. */
function workDateStr(daysAgo) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // noon UTC avoids tz date rollover
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Vientiane' });
}

/** Date at UTC midnight for a "@db.Date" column. */
function toDateOnly(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** UTC instant for a local "HH:mm" time on the given Vientiane work date. */
function instant(dateStr, time) {
  return new Date(`${dateStr}T${time}:00${TZ_OFFSET}`);
}

function diffHours(start, end) {
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

// Varied but realistic check-in / check-out local times for the past days.
// (in = when they arrived, out = when they left). One "late" arrival mixed in.
const PAST = [
  { in: '08:52', out: '17:34' },
  { in: '08:47', out: '17:31' },
  { in: '09:23', out: '17:45' }, // late arrival
  { in: '08:58', out: '17:33' },
  { in: '08:40', out: '17:30' },
  { in: '09:05', out: '17:40' },
  { in: '08:49', out: '17:32' },
  { in: '08:55', out: '18:02' },
  { in: '08:44', out: '17:29' },
];

async function main() {
  const employee = await prisma.employee.findUnique({
    where: { id: EMPLOYEE_ID },
    include: { workSchedule: true },
  });
  if (!employee) {
    throw new Error(`Employee ${EMPLOYEE_ID} not found — aborting.`);
  }

  const wifi = await prisma.wifiNetwork.findFirst({ where: { isActive: true } });
  const wifiId = wifi ? wifi.id : null;

  const schedule = employee.workSchedule; // start "09:00:00", lateAfterMinutes 15
  const lateGraceMs = (schedule?.lateAfterMinutes ?? 0) * 60_000;

  const rows = [];

  // --- Item 1: TODAY, checked in only ---
  const today = workDateStr(0);
  const todayIn = instant(today, '08:56');
  rows.push({
    employeeId: EMPLOYEE_ID,
    workDate: toDateOnly(today),
    checkInTime: todayIn,
    checkInWifiId: wifiId,
    checkInLocation: 'ຫ້ອງການ LTS',
    status: statusFor(todayIn, today, schedule, lateGraceMs),
  });

  // --- Items 2..10: previous 9 days, full day ---
  for (let i = 0; i < PAST.length; i++) {
    const dayStr = workDateStr(i + 1);
    const cin = instant(dayStr, PAST[i].in);
    const cout = instant(dayStr, PAST[i].out);
    rows.push({
      employeeId: EMPLOYEE_ID,
      workDate: toDateOnly(dayStr),
      checkInTime: cin,
      checkOutTime: cout,
      checkInWifiId: wifiId,
      checkOutWifiId: wifiId,
      checkInLocation: 'ຫ້ອງການ LTS',
      checkOutLocation: 'ຫ້ອງການ LTS',
      workHours: diffHours(cin, cout),
      status: statusFor(cin, dayStr, schedule, lateGraceMs),
    });
  }

  let created = 0;
  for (const data of rows) {
    // Upsert so re-running is safe (unique on employeeId + workDate).
    await prisma.attendance.upsert({
      where: {
        employeeId_workDate: {
          employeeId: data.employeeId,
          workDate: data.workDate,
        },
      },
      create: data,
      update: data,
    });
    created++;
  }

  console.log(`Seeded ${created} attendance rows for ${employee.firstName} ${employee.lastName}.`);
  console.log(`  first row (today ${today}): check-in only, no check-out.`);
}

function statusFor(checkIn, dayStr, schedule, graceMs) {
  if (!schedule) return AttendanceStatus.on_time;
  const threshold = new Date(`${dayStr}T${schedule.startTime}${TZ_OFFSET}`);
  return checkIn.getTime() > threshold.getTime() + graceMs
    ? AttendanceStatus.late
    : AttendanceStatus.on_time;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
