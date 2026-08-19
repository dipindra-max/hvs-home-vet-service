# HVS PostgreSQL Persistence Upgrade

This upgrade replaces the old local SQLite storage with PostgreSQL.

## Why

The existing HVS server uses `better-sqlite3` and writes to `data.sqlite`. Your repository itself says production should migrate SQLite to a managed PostgreSQL database. Render services use an ephemeral filesystem, so local SQLite data can disappear after a deploy/restart. A managed Render Postgres database is a persistent shared datastore.

## What changes

- Bookings are stored in PostgreSQL.
- Reviews are stored in PostgreSQL.
- There is NO automatic cleanup/expiration.
- Changing booking status never deletes a booking.
- Hiding a review never deletes it.
- Only an explicit admin DELETE action removes a record.
- `created_at` and `updated_at` are retained.
- Admin APIs keep the same endpoint names, so the existing public site and admin dashboard remain compatible.
- `/health` checks the database connection.
- SQL indexes are created for common admin/public queries.

## Render setup

1. Create a Render Postgres database in the same region as the HVS web service.
2. In the HVS web service Environment settings, add:
   - `DATABASE_URL` = your Render Postgres internal connection string
   - `ADMIN_KEY` = your existing strong admin key
   - `NODE_ENV` = `production`
3. Replace the root `server.js` with the supplied version.
4. Replace `package.json` with the supplied version.
5. Keep your existing `public/` files, including `index.html`, `admin.html`, and `assets/`.
6. Commit and push to GitHub.
7. Render redeploys the service.
8. Open `/health`. It should report `{"ok":true,"database":"connected"}`.
9. Open `/admin.html` and confirm existing admin functions work.
10. Submit a test booking and a test review. Restart/redeploy the service and confirm they remain.

Use the internal database connection string when the database and web service are in the same Render region.

## Important about old SQLite data

Do not delete your old `data.sqlite` until you know whether it contains records you need.

The repository currently does not expose `data.sqlite` as a tracked file. If you have a copy of the old SQLite database on your device/server, the optional migration script can import it.

To migrate a local copy:

1. Put `data.sqlite` in the project root.
2. Set `DATABASE_URL` to the new PostgreSQL database.
3. Install the one-time migration dependency:
   `npm install better-sqlite3`
4. Run:
   `npm run migrate:sqlite`
5. Check the admin dashboard.
6. Keep a backup of the SQLite file until you verify everything.

Do NOT run the migration script on every Render deploy.

## Data retention

This code has no scheduled job, timeout, or automatic deletion for bookings/reviews. PostgreSQL retains them until an administrator explicitly deletes them or the database itself is deleted.

For important business records, also keep database backups/restore options enabled according to your Render plan.

## Admin behavior

- Booking status: `new`, `confirmed`, `completed`, `cancelled`
- Status changes do not remove records.
- Reviews can be approved/hidden.
- Hiding a review keeps it in PostgreSQL.
- Deleting is a separate explicit admin action.

## Security

Never put `DATABASE_URL` or `ADMIN_KEY` into GitHub. Store them as Render environment variables.
