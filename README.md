# Video Essay Simulator

Live: https://frankfu0714-cyber.github.io/Video-Essay-Simulator/

## Structure

- `index.html` — the entire app (static, deployed to GitHub Pages). Uses Firebase Auth, Firestore, and Storage.
- `functions/` — Cloud Function for AI feedback. Holds the Gemini key and enforces the daily limit.
- `firestore.rules` — Firestore security rules. Deploy with `firebase deploy --only firestore:rules`.
- `storage.rules` — Firebase Storage security rules (per-user write, 30 MB cap, video MIME only).
- `firebase.json`, `.firebaserc` — Firebase CLI config (project ID: `video-essay-simulator`).

## Saved-video policy

Uses no scheduled jobs, so cleanup happens when a user returns.

- **Per-video size cap:** 30 MB. Enforced client-side before upload, and server-side via `storage.rules`.
- **Per-user video cap:** 10 active videos. Enforced client-side via a live count maintained by the Firestore snapshot listener.
- **Expiration:** 30 days from upload. The `expiresAt` field is written on save and rendered as a color-coded "Expires in N days" badge (green > 3d, amber 1–3d, red same-day).
- **Video access:** Storage reads are limited to the account that owns each video. Firebase project administrators can manage files in the Firebase console.
- **Cleanup:** when a video's owner opens the page, the Firestore listener splits their saved videos into live and expired docs; expired docs are deleted from both Firestore and Storage. Tolerates `storage/object-not-found` so a missing blob doesn't strand the doc.
- **Limitation:** if a user abandons their account without returning, their expired Storage blobs remain in Firebase Storage indefinitely. A scheduled cleanup function could close this gap.

## AI feedback

- **Access:** Google sign-in only, checked on the server. Password accounts are rejected so free reviews can't be farmed with throwaway addresses.
- **Limits:** 5 reviews per user per UTC day, and 200 across all users as a spending cap (`functions/feedback.js`). Failed reviews are refunded.
- **Quota data:** `aiQuota/{uid}` and `aiQuotaGlobal/{day}` in Firestore. Clients can't touch them because the rules deny all unlisted paths.
- **Privacy:** the recording is uploaded to Gemini for the review and deleted from Gemini afterwards. Use a billing-enabled Gemini key, because free-tier content can be used to improve Google's products.
- **Saved reviews:** users can save up to 50 reviews in `users/{uid}/aiFeedback`, readable only by that user (`firestore.rules`). Each includes the transcript. They stay until the user deletes them.
- **Usage count:** the home page shows `aiReviews` from `stats/public`, added by the function after each successful review. It stays hidden until it reaches 10.
- **Model:** `gemini-3.8-flash` (`functions/gemini.js`).

## Deploying

- **AI feedback function** — deploy this before pushing `index.html`:
  ```sh
  cd functions && npm ci && cd ..
  firebase functions:secrets:set GEMINI_API_KEY   # first time, or when rotating the key
  firebase deploy --only functions
  ```
  Tests: `cd functions && npm test`.

- **App (`index.html`)** — GitHub Pages auto-publishes on push to `main`. No build step.
- **Storage rules (`storage.rules`)** — Storage Rules are free on Spark. Deploy after edits:
  ```sh
  firebase deploy --only storage
  ```
  Or paste the contents of `storage.rules` into the Firebase Console at https://console.firebase.google.com/project/video-essay-simulator/storage/rules.
