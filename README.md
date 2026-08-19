# HVS Full-Stack Website

Run:
1. Install Node.js 18+.
2. `npm install`
3. Set `ADMIN_KEY` to a strong secret.
4. `npm start`
5. Open `http://localhost:3000`
6. Admin: `http://localhost:3000/admin.html`

Features:
- Customer home-visit bookings stored in SQLite
- GPS location capture + Google Maps link
- Direct customer star ratings/reviews
- Reviews held for HVS admin approval
- Admin booking status management
- Supplied HVS card and Jitendra Yadav photos
- Mobile-first SEO page

For production, use persistent storage. If deploying to serverless hosting, migrate SQLite to a managed PostgreSQL database.
