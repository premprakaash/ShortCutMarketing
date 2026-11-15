import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Campaign, Connection } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import {
  CampaignSpecSchema,
  ConnectorError,
  getConnector,
  type AccountContext,
  type CampaignSpec,
  type Insights,
  type MultiLaunch,
  type TokenResult,
} from "./connectors";

const { connections, campaigns } = schema;

/** Connection as shown to the UI — never includes tokens. */
export type PublicConnection = Omit<Connection, "accessTokenEnc" | "refreshTokenEnc">;

function toPublic(c: Connection): PublicConnection {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accessTokenEnc, refreshTokenEnc, ...rest } = c;
  return rest;
}

export async function listConnections(userId: string): Promise<PublicConnection[]> {
  const db = await getDb();
  const rows: Connection[] = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, userId))
    .orderBy(desc(connections.createdAt));
  return rows.map(toPublic);
}

async function getConnectionRow(userId: string, id: string): Promise<Connection> {
  const db = await getDb();
  const [row]: Connection[] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.userId, userId)));
  if (!row) throw new ConnectorError("Connection not found");
  return row;
}

export async function saveConnection(userId: string, platform: string, token: TokenResult): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db.insert(connections).values({
    id,
    userId,
    platform,
    displayName: token.displayName,
    accessTokenEnc: encrypt(token.accessToken),
    refreshTokenEnc: token.refreshToken ? encrypt(token.refreshToken) : null,
    tokenExpiresAt: token.expiresAt,
  });
  return id;
}

export async function deleteConnection(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.delete(connections).where(and(eq(connections.id, id), eq(connections.userId, userId)));
}

/**
 * A usable access token for a connection. Platforms with short-lived tokens
 * (Google, Snapchat, Pinterest, LinkedIn) are refreshed automatically.
 */
async function freshToken(conn: Connection): Promise<string> {
  const connector = getConnector(conn.platform);
  const expiresSoon = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now() + 5 * 60_000;
  if (!expiresSoon) return decrypt(conn.accessTokenEnc);

  if (!conn.refreshTokenEnc || !connector.refresh) {
    throw new ConnectorError("This login has expired. Please reconnect the account on the Ad accounts page.");
  }
  const t = await connector.refresh(decrypt(conn.refreshTokenEnc));
  const db = await getDb();
  await db
    .update(connections)
    .set({
      accessTokenEnc: encrypt(t.accessToken),
      refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : conn.refreshTokenEnc,
      tokenExpiresAt: t.expiresAt,
    })
    .where(eq(connections.id, conn.id));
  return t.accessToken;
}

/** Ad accounts, plus pages/identities/boards for the chosen account. */
export async function connectionOptions(userId: string, id: string, adAccountId?: string) {
  const conn = await getConnectionRow(userId, id);
  const connector = getConnector(conn.platform);
  const token = await freshToken(conn);
  const adAccounts = await connector.listAdAccounts(token);
  const account = adAccountId ?? conn.adAccountId ?? adAccounts[0]?.id;
  const pages = connector.pageLabel ? await connector.listPages(token, account) : [];
  return { adAccounts, pages, pageLabel: connector.pageLabel };
}

/** Save which ad account / page to use. Verifies the user really has access to them. */
export async function selectAccount(userId: string, id: string, adAccountId: string, pageId: string | null) {
  const conn = await getConnectionRow(userId, id);
  const { adAccounts, pages, pageLabel } = await connectionOptions(userId, id, adAccountId);
  const account = adAccounts.find((a) => a.id === adAccountId);
  if (!account) throw new ConnectorError("That ad account isn't available on this login");
  const page = pageId ? pages.find((p) => p.id === pageId) : null;
  if (pageId && !page) throw new ConnectorError(`That ${pageLabel?.toLowerCase() ?? "page"} isn't available on this login`);

  const db = await getDb();
  await db
    .update(connections)
    .set({
      adAccountId: account.id,
      adAccountName: account.name,
      currency: account.currency,
      pageId: page?.id ?? null,
      pageName: page?.name ?? null,
    })
    .where(eq(connections.id, conn.id));
}

async function contextFor(conn: Connection): Promise<AccountContext> {
  if (!conn.adAccountId || !conn.currency) {
    throw new ConnectorError("Choose an ad account for this connection first");
  }
  return {
    accessToken: await freshToken(conn),
    adAccountId: conn.adAccountId,
    currency: conn.currency,
    pageId: conn.pageId,
  };
}

export async function launchCampaign(
  userId: string,
  connectionId: string,
  spec: CampaignSpec,
  groupId: string | null = null,
): Promise<Campaign> {
  const conn = await getConnectionRow(userId, connectionId);
  const connector = getConnector(conn.platform);
  const ctx = await contextFor(conn);
  const result = await connector.launchCampaign(ctx, spec);

  const db = await getDb();
  const [row]: Campaign[] = await db
    .insert(campaigns)
    .values({
      id: randomUUID(),
      userId,
      groupId,
      connectionId,
      platform: conn.platform,
      name: spec.name,
      objective: spec.objective,
      dailyBudget: Math.round(spec.dailyBudget),
      currency: ctx.currency,
      status: result.status,
      platformIds: result.platformIds,
      spec,
    })
    .returning();
  return row;
}

export interface LaunchOutcome {
  connectionId: string;
  platform: string;
  accountName: string | null;
  ok: boolean;
  campaign?: Campaign;
  error?: string;
}

/** Launch the same ad on several platforms at once, each with its own daily budget. */
export async function launchMany(userId: string, input: MultiLaunch): Promise<{ groupId: string; results: LaunchOutcome[] }> {
  const groupId = randomUUID();
  const { targets, ...shared } = input;
  const results = await Promise.all(
    targets.map(async (t): Promise<LaunchOutcome> => {
      let platform = "unknown";
      let accountName: string | null = null;
      try {
        const conn = await getConnectionRow(userId, t.connectionId);
        platform = conn.platform;
        accountName = conn.adAccountName;
        const spec = CampaignSpecSchema.parse({ ...shared, dailyBudget: t.dailyBudget });
        const campaign = await launchCampaign(userId, t.connectionId, spec, groupId);
        return { connectionId: t.connectionId, platform, accountName, ok: true, campaign };
      } catch (err) {
        return {
          connectionId: t.connectionId,
          platform,
          accountName,
          ok: false,
          error: err instanceof Error ? err.message : "Could not create the ad",
        };
      }
    }),
  );
  return { groupId, results };
}

export interface CampaignWithStats extends Campaign {
  insights: Insights | null;
  insightsError: string | null;
}

export async function listCampaigns(userId: string, withInsights = true): Promise<CampaignWithStats[]> {
  const db = await getDb();
  const rows: Campaign[] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
  if (!withInsights) return rows.map((r) => ({ ...r, insights: null, insightsError: null }));

  const ctxs = new Map<string, Promise<AccountContext>>();
  return Promise.all(
    rows.map(async (r) => {
      try {
        if (!ctxs.has(r.connectionId)) {
          ctxs.set(r.connectionId, getConnectionRow(userId, r.connectionId).then(contextFor));
        }
        const insights = await getConnector(r.platform).getInsights(await ctxs.get(r.connectionId)!, r.platformIds);
        return { ...r, insights, insightsError: null };
      } catch (err) {
        return { ...r, insights: null, insightsError: err instanceof Error ? err.message : "Could not load stats" };
      }
    }),
  );
}

export async function setCampaignStatus(userId: string, campaignId: string, status: "ACTIVE" | "PAUSED") {
  const db = await getDb();
  const [row]: Campaign[] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  if (!row) throw new ConnectorError("Campaign not found");
  const conn = await getConnectionRow(userId, row.connectionId);
  await getConnector(row.platform).setStatus(await contextFor(conn), row.platformIds, status);
  await db.update(campaigns).set({ status }).where(eq(campaigns.id, row.id));
}
