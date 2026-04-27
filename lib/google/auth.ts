import { google, type Auth } from "googleapis";
import { env } from "@/lib/env";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

let cachedAuth: Auth.JWT | null = null;

export function getGoogleAuth(): Auth.JWT {
  if (cachedAuth) return cachedAuth;
  cachedAuth = new google.auth.JWT({
    email: env.googleServiceAccountEmail(),
    key: env.googleServiceAccountPrivateKey(),
    scopes: SCOPES,
  });
  return cachedAuth;
}

export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth() });
}

export function getDriveClient() {
  return google.drive({ version: "v3", auth: getGoogleAuth() });
}
