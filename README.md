# Video Essay Simulator

Live: https://frankfu0714-cyber.github.io/Video-Essay-Simulator/

## Structure

- `index.html` — the entire app (static, deployed to GitHub Pages). Uses Firebase Auth, Firestore, and Storage.
- `.firebaserc` — pins the Firebase project ID (`video-essay-simulator`) for any future CLI work. Not required at runtime.

## Saved-video expiration (client-side sweep)

Videos are saved with `expiresAt = createdAt + 14 days`. Cleanup runs entirely in the client (`cleanupExpiredVideos` in `index.html`):

- The Firestore listener splits each snapshot into `liveDocs` and `expiredDocs` by comparing `expiresAt` to `Date.now()`.
- Expired docs are filtered out of the render and deleted from Firebase Storage (`deleteObject`) and Firestore (`deleteDoc`).
- A `pendingExpiredDeletes` set deduplicates in-flight deletes across rapid snapshot refires.
- Storage 404s are tolerated — if the blob is already gone, the Firestore doc is still removed so it doesn't get stuck.
- Other transient failures unblock themselves so the next snapshot retries.

### Limitation

Expired videos are cleaned up the next time the owner signs in and opens the page. If a user abandons their account, their expired blobs will remain in Firebase Storage indefinitely. Trade-off accepted to stay on the free Spark plan — the alternative (Firestore TTL + a Cloud Function to sweep Storage) requires upgrading to Blaze.

## Deploying

GitHub Pages auto-publishes on push to `main` — no build step. Just push.
