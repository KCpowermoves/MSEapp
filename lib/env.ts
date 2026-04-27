function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. See README.md for setup.`
    );
  }
  return value;
}

export const env = {
  googleServiceAccountEmail: () => required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  googleServiceAccountPrivateKey: () =>
    required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  googleSheetId: () => required("GOOGLE_SHEET_ID"),
  googleDriveRootFolderId: () => required("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
  ironSessionPassword: () => required("IRON_SESSION_PASSWORD"),
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
};
