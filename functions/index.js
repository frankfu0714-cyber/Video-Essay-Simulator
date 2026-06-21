import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getStorage } from "firebase-admin/storage";
import { initializeApp } from "firebase-admin/app";

initializeApp();

export const onVideoDocDelete = onDocumentDeleted(
  "users/{uid}/videos/{videoId}",
  async (event) => {
    const data = event.data?.data();
    if (!data?.storagePath) {
      console.log(`No storagePath on deleted video ${event.params.videoId}; nothing to clean up.`);
      return;
    }
    try {
      await getStorage().bucket().file(data.storagePath).delete();
      console.log(`Deleted storage blob ${data.storagePath}`);
    } catch (err) {
      if (err?.code === 404) {
        console.log(`Storage blob ${data.storagePath} already gone.`);
        return;
      }
      console.warn(`Failed to delete storage blob ${data.storagePath}:`, err);
    }
  }
);
