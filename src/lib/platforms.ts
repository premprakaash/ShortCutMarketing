/**
 * Display info for every ad platform (safe to use in the browser — no secrets).
 * `status`: live = fully supported, soon = shown as "coming soon".
 */
export interface PlatformInfo {
  id: string;
  name: string;
  short: string;
  color: string;
  status: "live" | "soon";
  blurb: string;
  /** Environment variables needed to enable this platform. */
  env: string[];
  docs: string;
}

export const PLATFORM_INFO: PlatformInfo[] = [
  {
    id: "meta",
    name: "Meta (Facebook & Instagram)",
    short: "Meta",
    color: "#4C8BF5",
    status: "live",
    blurb: "Video ads on Facebook, Instagram, Reels and Messenger.",
    env: ["META_APP_ID", "META_APP_SECRET"],
    docs: "https://developers.facebook.com/docs/marketing-api",
  },
  {
    id: "google",
    name: "Google Ads (Search & YouTube)",
    short: "Google",
    color: "#34A853",
    status: "live",
    blurb: "Search ads with keywords, and YouTube video ads (Demand Gen).",
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
    docs: "https://developers.google.com/google-ads/api/docs/start",
  },
  {
    id: "tiktok",
    name: "TikTok Ads",
    short: "TikTok",
    color: "#FF2D55",
    status: "live",
    blurb: "In-feed video ads on TikTok and partner apps.",
    env: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"],
    docs: "https://business-api.tiktok.com/portal/docs",
  },
  {
    id: "linkedin",
    name: "LinkedIn Ads",
    short: "LinkedIn",
    color: "#0A66C2",
    status: "live",
    blurb: "Sponsored video posts for B2B audiences.",
    env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    docs: "https://learn.microsoft.com/linkedin/marketing/",
  },
  {
    id: "pinterest",
    name: "Pinterest Ads",
    short: "Pinterest",
    color: "#E60023",
    status: "live",
    blurb: "Promoted video Pins for shopping and ideas.",
    env: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"],
    docs: "https://developers.pinterest.com/docs/api/v5/",
  },
  {
    id: "snapchat",
    name: "Snapchat Ads",
    short: "Snapchat",
    color: "#FFFC00",
    status: "live",
    blurb: "Full-screen Snap video ads with a swipe-up link.",
    env: ["SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET"],
    docs: "https://developers.snap.com/api/marketing-api/Ads-API",
  },
  {
    id: "microsoft",
    name: "Microsoft Advertising (Bing)",
    short: "Microsoft",
    color: "#00A4EF",
    status: "soon",
    blurb: "Search ads on Bing, Yahoo and DuckDuckGo.",
    env: [],
    docs: "https://learn.microsoft.com/advertising/guides/",
  },
  {
    id: "reddit",
    name: "Reddit Ads",
    short: "Reddit",
    color: "#FF4500",
    status: "soon",
    blurb: "Video ads in Reddit communities.",
    env: [],
    docs: "https://ads-api.reddit.com/docs/",
  },
  {
    id: "x",
    name: "X (Twitter) Ads",
    short: "X",
    color: "#E7E9EA",
    status: "soon",
    blurb: "Promoted video posts on X.",
    env: [],
    docs: "https://docs.x.com/x-ads-api",
  },
  {
    id: "amazon",
    name: "Amazon Ads",
    short: "Amazon",
    color: "#FF9900",
    status: "soon",
    blurb: "Sponsored Products and Brands for sellers.",
    env: [],
    docs: "https://advertising.amazon.com/API/docs",
  },
];

export function platformInfo(id: string): PlatformInfo {
  return (
    PLATFORM_INFO.find((p) => p.id === id) ?? {
      id,
      name: id,
      short: id,
      color: "#888",
      status: "soon",
      blurb: "",
      env: [],
      docs: "",
    }
  );
}
