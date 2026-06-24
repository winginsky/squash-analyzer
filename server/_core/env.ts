export const ENV = {
  jwtSecret: process.env.JWT_SECRET ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // Owner / admin (email of the first admin user)
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  // Frontend URL for OAuth redirects
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:8081",
  // API public base URL
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:3000",
  // Base URL used specifically for Google OAuth redirect (must match Google Console)
  // Defaults to localhost for local dev; set to a real domain for production
  googleRedirectBase: process.env.GOOGLE_REDIRECT_BASE ?? process.env.API_BASE_URL ?? "http://localhost:3000",
  // LLM / AI
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  // Legacy Manus fields (kept for backward compatibility during transition)
  appId: process.env.VITE_APP_ID ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
};
