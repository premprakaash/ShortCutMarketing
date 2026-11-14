import { ConnectorError, type AdConnector } from "./types";

/**
 * Google Ads (Search + YouTube) connector — phase 2.
 *
 * OAuth is wired up so the "Connect" flow can be tested now. Campaign calls
 * are switched on once the Google Ads developer token has Basic access.
 * Docs: https://developers.google.com/google-ads/api/docs/start
 */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  developerToken?: string;
}

const notYet = () => {
  throw new ConnectorError(
    "Google Ads launching is coming in the next release (waiting for developer token approval).",
  );
};

export function createGoogleConnector(config: GoogleConfig): AdConnector {
  return {
    platform: "google",
    label: "Google Ads (Search & YouTube)",
    getAuthUrl(state, redirectUri) {
      const p = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/adwords",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },
    exchangeCode: notYet,
    listAdAccounts: notYet,
    listPages: async () => [],
    launchCampaign: notYet,
    setStatus: notYet,
    getInsights: notYet,
  };
}
