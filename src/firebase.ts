import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { environment } from "./environments/environment";

// Initialize Firebase using environment configuration
export const app = initializeApp(environment.firebase);

// Initialize Analytics conditionally (only in supported environments/browser)
export const analytics = typeof window !== 'undefined'
  ? isSupported().then(supported => supported ? getAnalytics(app) : null).catch(() => null)
  : Promise.resolve(null);
