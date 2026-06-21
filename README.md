# Video Essay Simulator

Live: https://frankfu0714-cyber.github.io/Video-Essay-Simulator/

## Structure

- `index.html` — the entire app (static, deployed to GitHub Pages). Uses Firebase Auth, Firestore, and Storage.
- `functions/` — Firebase Cloud Functions (Node 20). Runs the orphan-storage cleanup on Firestore doc deletion.
- `firebase.json`, `.firebaserc` — Firebase project config (project ID: `video-essay-simulator`).

## Saved-video expiration (three layers)

Videos are saved with `expiresAt = createdAt + 14 days`. Expired videos are removed by three independent layers, so failure of any one does not leak storage:

1. **Client-side sweep** (`cleanupExpiredVideos` in `index.html`). When a signed-in user opens the page, expired docs are filtered out of the render and deleted from Firestore + Storage. Covers active users; does nothing for accounts that never come back.
2. **Firestore TTL policy** on the `expiresAt` field — see setup below. Deletes the Firestore doc within ~24h of expiration, regardless of whether the user opens the page.
3. **`onVideoDocDelete` Cloud Function** (`functions/index.js`). Triggered by any Firestore doc deletion (manual button, client sweep, or TTL); deletes the matching Storage blob. This is what closes the loop on the TTL path — Firestore TTL deletes the doc but not the Storage file.

## Deploying the Cloud Function

Cloud Functions require the **Blaze (pay-as-you-go) plan** — the free Spark plan cannot deploy functions. Upgrade at https://console.firebase.google.com/project/video-essay-simulator/usage/details if needed. For this workload (one trigger per video deletion), expected cost is a few cents per month.

```sh
cd /Users/frank/Video-Essay-Simulator/functions
npm install
cd ..
firebase deploy --only functions
```

Logs: `firebase functions:log` (or `cd functions && npm run logs`).

## Setting up the Firestore TTL policy

TTL is a server-side feature configured in the Firebase Console (not in code).

1. Open https://console.firebase.google.com/project/video-essay-simulator/firestore/ttl
2. Click **Create policy**.
3. **Collection group**: `videos` (the path is `users/{uid}/videos`, a subcollection — Firestore TTL operates on the collection-group ID, which is `videos`).
4. **Timestamp field**: `expiresAt`.
5. Save. Initial policy build can take up to 24h; after that, docs are deleted within ~24h of their `expiresAt`.

Once the TTL policy is active and the Cloud Function is deployed, expired videos are cleaned up end-to-end with no client involvement.
