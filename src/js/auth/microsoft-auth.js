import {
  getAuth,
  OAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { firebaseApp } from "../../config/firebase-config.js";
import { microsoftConfig } from "../../config/microsoft-config.js";

const auth = getAuth(firebaseApp);
const provider = new OAuthProvider("microsoft.com");

// Firebase AuthenticationはFirestore利用者認証だけを担当する。
provider.setCustomParameters({
  tenant: microsoftConfig.tenantId,
  prompt: "select_account"
});

export async function loginWithMicrosoft() {
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function logoutMicrosoft() {
  await signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}
