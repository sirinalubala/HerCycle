# HerCycle

HerCycle keeps its existing HTML/CSS/JavaScript frontend and serves it from a
Node.js + Express backend. The backend uses local MySQL for accounts, private
health records, reminders, anonymous questions, and awareness challenge
progress. No third-party database or cloud authentication service is used.

## Requirements

- Node.js 18 or newer
- MySQL Server 8 or compatible

## Configure MySQL

1. Start the local MySQL Server.
2. Open a terminal in `HerCycle\backend`.
3. Initialize the database and all seven tables:

   ```bat
   mysql -u root -p < database.sql
   ```

   Enter your own MySQL root password when prompted. If your local root
   account has no password, omit `-p`.
4. Copy `backend\.env.example` to `backend\.env` and set your local MySQL host,
   port, username, password, and database name. `DB_NAME` should remain
   `hercycle`. Set `JWT_SECRET` to a long random secret; for example, generate
   one with:

   ```bat
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Do not commit `backend\.env`.

## Install and start

In a terminal opened at `HerCycle\backend`:

```bat
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Express serves the existing
frontend and API on the same origin; a separate frontend server is not needed.
For development with automatic Node.js restarts, use `npm run dev`.

To confirm MySQL connectivity, open [http://localhost:3000/api/health](http://localhost:3000/api/health).
The endpoint reports a database connection error if MySQL is not configured or
running; the backend does not claim a connection until its `SELECT 1` succeeds.

## Features

- Signup/login with bcrypt password hashes and signed JWT sessions; logout
  clears the browser session.
- Per-user authorization for period, symptom, mood, reminder, and question
  records, plus challenge progress. The server scopes reads and writes to the
  authenticated account.
- Period create/edit/delete, cycle estimates, symptom and mood journals,
  reminders, monthly reports, anonymous account-private questions, and
  server-backed awareness challenges.
- Existing awareness content, Myth vs Fact, What Would You Do, quiz, emergency
  information, and Boy Dashboard remain in the frontend.

Health estimates are for informational tracking only and are not medical
advice. Anonymous questions do not include the account name in the question
listing, but are stored against the submitting account to support private
review and deletion.
