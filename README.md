# HR_App — Backend (NestJS)

Employee check-in / check-out system. Modular NestJS + **Prisma** + PostgreSQL 14.

## Requirements
- Node.js 18+ and **pnpm**
- PostgreSQL 14, database `HR_App` already created (port 5434 in dev)

## Setup
```bash
cd backend
pnpm install                 # also runs `prisma generate`
cp .env.example .env         # then set DATABASE_URL
pnpm prisma:push             # creates auth + public schemas and all tables
pnpm run start:dev
```
`DATABASE_URL` uses a URL-encoded password (e.g. `kong@789` → `kong%40789`).

On first run the app seeds a default admin: **admin / admin123** (change in `.env`).

## Prisma commands
```bash
pnpm prisma:push       # sync schema to DB (dev, no migration files)
pnpm prisma:migrate    # create + run a migration (recommended for prod)
pnpm prisma:studio     # visual DB browser
pnpm prisma:generate   # regenerate the typed client
```

API base URL: `http://localhost:3000/api`
Swagger docs: `http://localhost:3000/api/docs`

## Architecture
```
prisma/
└── schema.prisma           Data model: auth + public multiSchema, all UUID ids
src/
├── config/                 App config (port, jwt, seed)
├── prisma/                 PrismaService + global PrismaModule
├── shared/                 Cross-cutting code reused by every module
│   ├── decorators/         @Public, @Roles, @CurrentUser
│   ├── guards/             JwtAuthGuard (global), RolesGuard (global)
│   ├── filters/            HttpExceptionFilter (+ i18n message translation)
│   ├── interceptors/       TransformInterceptor ({ success, data })
│   ├── dto/                PaginationDto
│   └── utils/              Vientiane-timezone helpers
│   (enums come from @prisma/client: Role, AttendanceStatus, EmployeeStatus)
├── i18n/                   lo/ and en/ message catalogs
└── modules/
    ├── auth/               Login + JWT           (schema: auth)
    ├── users/              Login accounts        (schema: auth)
    ├── employees/          Employee records      (schema: public)
    ├── departments/        Departments           (schema: public)
    ├── working/            ★ CHECK-IN/OUT FEATURE (schema: public)
    │   ├── attendance/     check-in / check-out / history / reports
    │   ├── wifi/           allowed office WiFi + server-side verification
    │   └── schedule/       work shifts (late detection)
    ├── training-course/    FUTURE feature scaffold (next to working)
    ├── recruitment/        FUTURE feature scaffold (ເປີດສະໝັກຮັບພະນັກງານ)
    └── seed/               default admin on first boot
```

### How to add a new feature
Create a folder next to `working/` under `src/modules/`, with its own
`*.module.ts`, `*.controller.ts`, `*.service.ts`, `entities/`, `dto/`, then
register the module in `app.module.ts`. See `training-course/` as a template.

## Database schemas
- `auth` — `users`
- `public` — `employees`, `departments`, `attendances`, `wifi_networks`, `work_schedules`

## WiFi verification (check-in/out gate)
The device sends the WiFi `ssid` + `bssid` it is connected to. The **server**
compares them against active rows in `wifi_networks`. Both must match; `bssid`
(router MAC) is the hard-to-spoof anchor. Never trust a client-side verdict.

## Key endpoints
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | public | Login, returns JWT |
| GET  | `/api/auth/me` | any | Current user |
| POST | `/api/working/attendance/check-in` | employee | Check in (WiFi-gated) |
| POST | `/api/working/attendance/check-out` | employee | Check out (WiFi-gated) |
| GET  | `/api/working/attendance/today` | employee | Today's record |
| GET  | `/api/working/attendance/history` | employee | Own history |
| GET  | `/api/working/attendance` | admin/manager | All records / reports |
| CRUD | `/api/working/wifi` | admin | Manage office WiFi |
| CRUD | `/api/working/schedules` | admin | Manage shifts |
| CRUD | `/api/employees` | admin/manager | Manage employees |
| CRUD | `/api/departments` | admin | Manage departments |
| CRUD | `/api/users` | admin | Manage login accounts |

## Localization
Send `?lang=lo` / `?lang=en`, or header `x-lang: lo`, or `Accept-Language`.
Default is Lao (`DEFAULT_LANG` in `.env`).

## Production notes
- Use migrations instead of `db push`: `pnpm prisma:migrate` (creates SQL under `prisma/migrations/`).
- Set a strong `JWT_SECRET`.
