import { PLATFORM_INFO } from "../platforms";
import { createGoogleConnector } from "./google";
import { createLinkedInConnector } from "./linkedin";
import { createMetaConnector } from "./meta";
import { createPinterestConnector } from "./pinterest";
import { createSnapchatConnector } from "./snapchat";
import { createTikTokConnector } from "./tiktok";
import { ConnectorError, PLATFORMS, type AdConnector, type Platform } from "./types";

export * from "./types";

const env = (k: string) => process.env[k] ?? "";

/** True when all the keys a platform needs are set. */
export function isConfigured(platform: string): boolean {
  const info = PLATFORM_INFO.find((p) => p.id === platform);
  return Boolean(info && info.status === "live" && info.env.every((k) => env(k)));
}

/** Returns the connector for a platform, configured from environment variables. */
export function getConnector(platform: string): AdConnector {
  if (!isPlatform(platform)) throw new ConnectorError(`Unknown platform: ${platform}`);
  if (!isConfigured(platform)) {
    const keys = PLATFORM_INFO.find((p) => p.id === platform)!.env.join(", ");
    throw new ConnectorError(`${platform} isn't set up yet. Add ${keys} to the server settings.`);
  }
  switch (platform) {
    case "meta":
      return createMetaConnector({
        appId: env("META_APP_ID"),
        appSecret: env("META_APP_SECRET"),
        apiVersion: env("META_API_VERSION") || "v25.0",
      });
    case "google":
      return createGoogleConnector({
        clientId: env("GOOGLE_CLIENT_ID"),
        clientSecret: env("GOOGLE_CLIENT_SECRET"),
        developerToken: env("GOOGLE_ADS_DEVELOPER_TOKEN"),
        apiVersion: env("GOOGLE_ADS_API_VERSION") || "v25",
        loginCustomerId: env("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || undefined,
      });
    case "tiktok":
      return createTikTokConnector({ appId: env("TIKTOK_APP_ID"), secret: env("TIKTOK_APP_SECRET") });
    case "linkedin":
      return createLinkedInConnector({
        clientId: env("LINKEDIN_CLIENT_ID"),
        clientSecret: env("LINKEDIN_CLIENT_SECRET"),
        apiVersion: env("LINKEDIN_API_VERSION") || "202606",
      });
    case "pinterest":
      return createPinterestConnector({ clientId: env("PINTEREST_CLIENT_ID"), clientSecret: env("PINTEREST_CLIENT_SECRET") });
    case "snapchat":
      return createSnapchatConnector({ clientId: env("SNAPCHAT_CLIENT_ID"), clientSecret: env("SNAPCHAT_CLIENT_SECRET") });
  }
}

export function isPlatform(p: string): p is Platform {
  return (PLATFORMS as readonly string[]).includes(p);
}
