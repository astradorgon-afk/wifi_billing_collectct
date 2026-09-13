# WiFi Installation Billing & Collection System

Offline-first web application (PWA) for managing WiFi installation customers, billing, and
payment collection. Runs fully in the browser — local SQLite database, no backend, no
internet required.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Running the System

Requirements: Node.js (tested on v26).

```bash
npm install    # install dependencies (first time only)
npm run dev    # start the development server
```

Then open **http://localhost:3000** in your browser.

The dev server listens on port 3000 (Next.js 16, Turbopack). The system needs no database
setup — data is stored locally in your browser via sql.js/IndexedDB.

Other scripts: `npm run build` (static export), `npm run start`, `npm run lint`,
`npm run icons` (regenerate PWA icons).

## Accounts

Sign in with a username and PIN. Default demo accounts are created on first run
(changeable in `src/lib/db/users.ts`):

| Username   | PIN  | Role       | Access                                        |
|------------|------|------------|-----------------------------------------------|
| `owner`    | 1234 | Owner      | Full access (all pages, settings, backups)    |
| `collector`| 0000 | Collector  | Dashboard, customers, and recording payments  |

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# wifi_billing_collectct
