# Video Essay Simulator

Live: https://frankfu0714-cyber.github.io/Video-Essay-Simulator/

## Structure

- `index.html` — the entire app (static, deployed to GitHub Pages). Uses Firebase Auth, Firestore, and Storage.
- `storage.rules` — Firebase Storage security rules (per-user write, 30 MB cap, video MIME only).
- `firebase.json`, `.firebaserc` — Firebase CLI config (project ID: `video-essay-simulator`).

## Saved-video policy

Stays on the **free Spark plan** — no Cloud Functions, no scheduled jobs.

- **Per-video size cap:** 30 MB. Enforced client-side before upload, and server-side via `storage.rules`.
- **Per-user video cap:** 10 active videos. Enforced client-side via a live count maintained by the Firestore snapshot listener.
- **Expiration:** 7 days from upload. The `expiresAt` field is written on save and rendered as a color-coded "Expires in N days" badge (green > 3d, amber 1–3d, red same-day).
- **Cleanup:** when any signed-in user opens the page, the Firestore listener splits the snapshot into live and expired docs; expired docs are deleted from both Firestore and Storage. Tolerates `storage/object-not-found` so a missing blob doesn't strand the doc.
- **Limitation:** if a user abandons their account without returning, their expired Storage blobs remain in Firebase Storage indefinitely. Trade-off accepted to stay on Spark — the alternative (Firestore TTL + a Cloud Function) requires the Blaze plan.

## Deploying

- **App (`index.html`)** — GitHub Pages auto-publishes on push to `main`. No build step.
- **Storage rules (`storage.rules`)** — Storage Rules are free on Spark. Deploy after edits:
  ```sh
  firebase deploy --only storage
  ```
  Or paste the contents of `storage.rules` into the Firebase Console at https://console.firebase.google.com/project/video-essay-simulator/storage/rules.
