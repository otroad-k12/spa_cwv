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

- LCP, INP, and CLS use Google's `web-vitals` v6.2.3 with `reportSoftNavs: true`. A metric can change during a visit; updates with the same metric ID overwrite its earlier value so the report counts one current result, not each revision.
- Chromium 151+ can report supported soft navigations when an interaction changes the URL and paints content. Other browsers generally report Core Web Vitals for the initial document load only. The report splits `hard` and `soft` navigation data.
- `APP_ROUTE_RENDER` is a custom route transition timing from action through two animation frames, **not** a Core Web Vital. It remains a separate metric.
- Every journey view is recorded before waiting for vitals. The report shows captured, pending, not recorded, unsupported, or library failed for each CWV. Capture rate uses completed eligible views as the denominator and excludes open views and unsupported SPA transitions. A supported browser can still decline to classify a particular transition as a soft navigation, and INP can be absent without a qualifying interaction.
- The report groups capture by browser family and device and lists individual views with server date/time, browser version, device, route, tester ID, session ID, and each CWV value or status. Filters cover browser, device, and 7/30 days; CSV exports the view-level record, including missing values. p75 uses captured samples. Thresholds: LCP ≤2,500 ms; INP ≤200 ms; CLS ≤0.1. A small demo sample is illustrative, not representative field evidence.
- A random tester ID persists in one browser via local storage. A random session ID persists in one tab via session storage, and a visit ID is created for each document load. These pseudonymous IDs are not person identities across browsers/devices. Collected fields also include browser family/version, mobile/tablet/desktop, soft-navigation support, library load status, client date/time and server date/time, route, and metric values. Raw user-agent strings, selections, names, contact details, and URL query parameters are not sent. The report token is retained only in the report viewer's browser tab.

The collector accepts small same-origin events without participant authentication. For a larger public rollout, add rate/bot controls, retention, pagination or server-side aggregation, and approved access controls. The web-vitals module is loaded from a pinned CDN URL; self-host it for production reliability.

## Local checks

Run `npm test` for the API smoke test. To run the full app locally, set `DATABASE_URL` to a Postgres connection string and `ADMIN_TOKEN` to a test secret, then run `npm install` and `npm start`. The UI can be visually inspected by opening `public/index.html`, but that standalone file does not persist remote measurements.

References: [Web Vitals measurement](https://web.dev/articles/vitals-measurement-getting-started), [SPA FAQ](https://web.dev/articles/vitals-spa-faq), [web-vitals](https://github.com/GoogleChrome/web-vitals), [Render Blueprints](https://render.com/docs/infrastructure-as-code), and [Render free tier](https://render.com/docs/free).
