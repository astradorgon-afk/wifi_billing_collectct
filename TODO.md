# TODO — WiFi Billing Collection System

Build checklist. Architecture decisions live in `ARCHITECTURE.md`.

## 0. Scaffold
- [x] `create-next-app` (TypeScript, Tailwind, App Router, src dir, `@/*` alias)
- [x] Architecture plan (`ARCHITECTURE.md`) + this checklist

## 1. Dependencies & assets
- [ ] `sql.js` (+ `@types/sql.js`) installed
- [ ] Vendor `sql-wasm.wasm` into `public/sqljs/` and wire `locateFile`
- [ ] PWA icons generated (`scripts/generate-icons.mjs` → `public/icons/*`)

## 2. Database layer
- [ ] Schema + migration runner (`lib/db/schema.ts`)
- [ ] Engine init / IndexedDB persistence / debounced autosave (`lib/db/database.ts`)
- [ ] Typed repositories for customers, plans, installations, invoices, payments
- [ ] Invoice balance & arrears queries

## 3. Features
- [ ] DataProvider (ready state, refresh, online/offline status)
- [ ] App shell: sidebar + mobile bottom nav + header
- [ ] UI primitives: Card, Button, Input, Select, Modal, Badge, Table, EmptyState
- [ ] Customers: list, search, create/edit modal, activate/deactivate
- [ ] Installations: schedule → in progress → completed (creates installation invoice)
- [ ] Billing: list + filters, generate monthly invoices (idempotent), void
- [ ] Payments: record (partial allowed), receipt view, invoice status roll-up
- [ ] Dashboard: MRR, collected this month, outstanding, active installs, recent payments
- [ ] Settings: JSON backup/restore, CSV export, seed demo data, wipe DB

## 4. PWA / offline
- [ ] `manifest.webmanifest` (name, icons, standalone, theme color)
- [ ] `sw.js`: precache shell, runtime caches, navigation network-first + `/offline` fallback
- [ ] SW registration + update prompt in layout
- [ ] `/offline` fallback page

## 5. Verification
- [ ] `tsc --noEmit` clean
- [ ] `next build` (static export) passes
- [ ] Smoke test the full workflow (see ARCHITECTURE.md §8)
