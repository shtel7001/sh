# K-Trade Flow

Private Vercel mirror dashboard for https://trade.aljal.kr/.

- Source pages are fetched live on the server and sanitized before rendering.
- Internal links stay inside the private dashboard.
- Underlying public sources shown by the source site include Korea Customs Service / Public Data Portal and MOTIE trade releases.
- Authentication uses RADAR_PASSWORD + SESSION_SECRET and a long-lived signed HTTP-only cookie.
