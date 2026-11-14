import { createGoogleConnector } from "./google";
import { createMetaConnector } from "./meta";
import { ConnectorError, PLATFORMS, type AdConnector, type Platform } from "./types";

export * from "./types";

/** Returns the connector for a platform, configured from environment variables. */
export function getConnector(platform: string): AdConnector {
  if (!isPlatform(platform)) throw new ConnectorError(`Unknown platform: ${platform}`);
  switch (platform) {
    case "meta": {
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;
      if (!appId || !appSecret) throw new ConnectorError("META_APP_ID and META_APP_SECRET must be set");
      return createMetaConnector({ appId, appSecret, apiVersion: process.env.META_API_VERSION || "v25.0" });
    }
    case "google": {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new ConnectorError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
      return createGoogleConnector({ clientId, clientSecret, developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN });
    }
  }
}

export function isPlatform(p: string): p is Platform {
  return (PLATFORMS as readonly string[]).includes(p);
}
