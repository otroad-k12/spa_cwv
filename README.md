# SPA RUM proof of concept · Render edition

A five-view, single-document journey with remote real-user monitoring and a token-protected report. The public page, collector, and reporting API run in one Render web service; Render Postgres stores the metric records.

## Deploy from your own GitHub repository

1. Create a new repository and upload **the contents of this folder** to its root (`render.yaml`, `package.json`, `public/`, `src/`, and `test/`). Do not upload the ZIP as one file.
2. In Render, choose **New → Blueprint**, connect that repository, and apply `render.yaml`. It creates a Node web service and a Postgres database.
3. When prompted for `ADMIN_TOKEN`, enter a long, random secret you will keep private. It grants access to `/report`. Never put it in the repository or share it with demo participants.
4. After deployment, share the service's `https://...onrender.com/` URL. Visit `/report` yourself, enter the token, and choose 7 or 30 days. Export CSV if needed.
5. Walk through the journey from a real browser, including several interactions. Some metrics report only after navigation or tab hide; reload the report after a few moments.

If you set up a Render web service manually instead of using the Blueprint, set the build command to `npm install`, start command to `npm start`, and environment variables `DATABASE_URL` (the database's internal connection string) and `ADMIN_TOKEN`. The app creates its table and index at startup and listens on Render's `PORT`.

**Free database limit:** Render's free Postgres database expires 30 days after creation and has no backups. Upgrade the database or export the events before expiry if you need to retain the demo data. Check Render's plan selection before applying the Blueprint.

## Measurement and privacy

- LCP, INP, and CLS use Google's `web-vitals` v6.2.3 with `reportSoftNavs: true`. Metric updates overwrite earlier values for the same session and metric ID.
- Chromium 151+ can report supported soft navigations when an interaction changes the URL and paints content. Other browsers generally report Core Web Vitals for the initial document load only. The report splits `hard` and `soft` navigation data.
- `APP_ROUTE_RENDER` is a custom route transition timing from action through two animation frames, **not** a Core Web Vital. It remains a separate metric.
- The report displays p75 and sample counts by route and navigation class. Thresholds: LCP ≤2,500 ms; INP ≤200 ms; CLS ≤0.1. A small demo sample is illustrative, not representative field evidence.
- Collected fields are a random session UUID, metric ID/name/value, route label, navigation class, and coarse mobile/desktop class. Selections, names, contact details, and URL query parameters are not sent. The report token is entered by the viewer and retained only in that browser tab's session storage.

The collector accepts small same-origin events without participant authentication. For a larger public rollout, add rate/bot controls, retention, pagination or server-side aggregation, and approved access controls. The web-vitals module is loaded from a pinned CDN URL; self-host it for production reliability.

## Local checks

Run `npm test` for the API smoke test. To run the full app locally, set `DATABASE_URL` to a Postgres connection string and `ADMIN_TOKEN` to a test secret, then run `npm install` and `npm start`. The UI can be visually inspected by opening `public/index.html`, but that standalone file does not persist remote measurements.

References: [Web Vitals measurement](https://web.dev/articles/vitals-measurement-getting-started), [SPA FAQ](https://web.dev/articles/vitals-spa-faq), [web-vitals](https://github.com/GoogleChrome/web-vitals), [Render Blueprints](https://render.com/docs/infrastructure-as-code), and [Render free tier](https://render.com/docs/free).
