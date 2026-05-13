# Construction Field Report System

A SaaS-style construction site management system for automating daily field reports.

## Features

- **Daily Report Input**: Mobile-first LINE LIFF form for field workers
- **Auto Sync**: Google Apps Script backend handles spreadsheet transfer + LINE notifications
- **Admin Dashboard**: Site / worker / expense management
- **Expense Tracking**: Vehicle, travel, hotel, garbage, and misc expenses with receipt upload
- **Multi-tenant Ready**: Account-based data isolation via Supabase

## Project Structure

```
/
├── apps/
│   ├── liff/          # LINE LIFF daily report form (Nuxt3 / Vercel)
│   └── admin/         # Admin dashboard (Vite + Vue3 / Vercel)
├── packages/
│   ├── types/         # Shared TypeScript types
│   └── utils/         # Shared utility functions
├── supabase/
│   └── migrations/    # DB migrations
└── apps/gas/          # Google Apps Script backend
```

## Tech Stack

| Role | Technology |
|------|------------|
| Frontend | Nuxt3 + Vue3 + TypeScript |
| Hosting | Vercel |
| Auth | LINE LIFF |
| Backend | Google Apps Script |
| Database | Supabase (PostgreSQL) |
| Notifications | LINE Messaging API |

## Setup

### LIFF App

```bash
cd apps/liff
cp .env.example .env.local
# Edit .env.local with your credentials

npm install
npm run dev
```

### Admin Dashboard

```bash
cd apps/admin
cp .env.example .env.local
# Edit .env.local with your credentials

npm install
npm run dev
```

### Required Environment Variables (LIFF)

| Variable | Description |
|----------|-------------|
| `NUXT_PUBLIC_LIFF_ID` | LINE Developers LIFF ID |
| `NUXT_PUBLIC_GAS_URL` | GAS Web App deploy URL |
| `NUXT_PUBLIC_APP_ENV` | `development` or `production` |
| `NUXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NUXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NUXT_PUBLIC_ACCOUNT_SLUG` | Account identifier slug |

### GAS (Google Apps Script)

Set the following in Script Properties (not in code):

| Property | Description |
|----------|-------------|
| `LINE_TOKEN` | LINE Channel Access Token |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `NOTIFY_GROUP_IDS` | JSON array of LINE Group IDs |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `ACCOUNT_SLUG` | Account identifier slug |

## Deploy

```bash
# Deploy LIFF to Vercel
cd apps/liff && npx vercel --prod

# Deploy Admin to Vercel
cd apps/admin && npx vercel --prod

# Push GAS
cd apps/gas && clasp push
# Then create a new version in the GAS editor
```

## Roadmap

- [x] Phase 1 — LINE LIFF form + GAS spreadsheet transfer + LINE notifications
- [x] Phase 1.5 — Supabase integration + admin dashboard
- [ ] Phase 2 — Monthly aggregation reports, expense PDF generation
- [ ] Phase 3 — Multi-tenant expansion
