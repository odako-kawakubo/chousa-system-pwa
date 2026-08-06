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

for (const scope of microsoftConfig.scopes) provider.addScope(scope);
provider.setCustomParameters({
  tenant: microsoftConfig.tenantId,
  prompt: "select_account"
});

export async function loginWithMicrosoft() {
  const result = await signInWithPopup(auth, provider);
  const credential = OAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    sessionStorage.setItem("graphAccessToken", credential.accessToken);
  }
  return result.user;
}

export async function logoutMicrosoft() {
  sessionStorage.removeItem("graphAccessToken");
  await signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getGraphAccessToken() {
  return sessionStorage.getItem("graphAccessToken") || "";
}
