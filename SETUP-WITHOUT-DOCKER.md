# Run BeautyExpress without Docker (Windows, Mac or Linux)

This uses a **free online Supabase project** as the database instead of running one on your computer. You need only **Node.js** and a web browser.

## 1. Install Node.js
Download the **LTS** version from https://nodejs.org and install it. Open a **new** PowerShell window and check:
```powershell
node -v
```

## 2. Create a free Supabase project
1. Sign up at https://supabase.com (a GitHub or email account works).
2. Click **New project**. Name: `beautyexpress-dev`. Region: **Canada (Central)**. Create a database password and save it in a safe place.
3. Wait about 2 minutes while the project starts.

## 3. Create the database from the VS Code terminal
1. In Supabase click **Connect** (top of the page) and open **Session pooler**. Copy the URI. It looks like
   `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`
2. In the VS Code terminal:
   ```powershell
   npm install
   copy .env.database.example .env.database
   code .env.database
   ```
3. Paste the URI after `DATABASE_URL=`, replace `[YOUR-PASSWORD]` (including the brackets) with your database password, and save (Ctrl + S).
4. Create the database and check it:
   ```powershell
   npm run db:setup
   npm run db:check
   ```

*Alternative without the terminal:* paste `supabase\setup-hosted.sql` into **SQL Editor › New query › Run**.

## 4. Load the demo data (optional, development only)
```powershell
npm run db:seed
```
This creates fictional stylists, bookings and demo accounts (password `Password123!`). Never run it on the project you use for real customers. If demo sign-in fails later, run `npm run db:fix-demo`.

## 5. Allow sign-in links to come back to your computer
**Authentication** › **URL Configuration**:
- **Site URL:** `http://localhost:5173`
- **Redirect URLs:** add `http://localhost:5173/**`

## 6. Connect the website to your project
1. **Project Settings** › **API** (or **Data API** / **API Keys**). Copy the **Project URL** and the **anon public** key.
2. In the VS Code terminal, make the settings file:
   ```powershell
   copy .env.example .env
   code .env
   ```
3. Change these two lines and save:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=paste-the-anon-public-key
   ```
   Never paste the **service_role** / secret key here.

## 7. Start the website
```powershell
npm run dev
```
Ctrl + click the `http://localhost:5173` link in the terminal.
Open **http://localhost:5173**. Sign in with `client1@example.com`, `stylist1@example.com` or `admin@example.com` and password `Password123!`.

Next time you only need `npm run dev`. The database stays online.

## Good to know
- **New sign-ups need email confirmation** on a hosted project. The email comes from Supabase and may land in spam. The free email service sends only a few emails per hour; to skip confirmation while testing, turn off **Authentication › Sign In / Providers › Email › Confirm email**.
- **Photo uploads, messages and live updates** work on the hosted project; nothing extra to set up.
- **Card payments** stay off until you deploy the Edge Functions and set up Stripe (see DEPLOYMENT.md §9–11). Deploying functions does not need Docker: `npx supabase login`, `npx supabase link --project-ref YOUR_REF`, then `npx supabase functions deploy NAME --use-api`.
- **Starting over:** the easiest way is to delete the project in Supabase (Project Settings › General › Delete project) and create a new one, then repeat steps 3–6.

## Troubleshooting
| Problem | Fix |
|---|---|
| Page says "Almost there" | `.env` missing or values wrong. Fix it, press Ctrl + C, run `npm run dev` again. |
| SQL Editor error `type "app_role" already exists` | The setup was already run. Use a new project, or skip step 3. |
| "Invalid login credentials" with demo accounts | Run `npm run db:check`; if no demo accounts, `npm run db:seed`. |
| "Database error querying schema" | Run `npm run db:fix-demo`. |
| `db:` command says wrong password or cannot connect | Re-copy the **Session pooler** string into `.env.database` and check the password. |
| `npm` not recognized | Close PowerShell and open a new one after installing Node.js. |
| Sign-in works but pages show permission errors | You pasted the wrong key. Use the **anon public** key. |
