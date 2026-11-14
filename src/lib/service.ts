import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Campaign, Connection } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import {
  ConnectorError,
  getConnector,
  type AccountContext,
  type CampaignSpec,
  type Insights,
  type TokenResult,
} from "./connectors";

const { connections, campaigns } = schema;

/** Connection as shown to the UI — never includes the token. */
export type PublicConnection = Omit<Connection, "accessTokenEnc">;

function toPublic(c: Connection): PublicConnection {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accessTokenEnc, ...rest } = c;
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
    tokenExpiresAt: token.expiresAt,
  });
  return id;
}

export async function deleteConnection(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.delete(connections).where(and(eq(connections.id, id), eq(connections.userId, userId)));
}

/** Ad accounts and pages the user can pick from for a connection. */
export async function connectionOptions(userId: string, id: string) {
  const conn = await getConnectionRow(userId, id);
  const connector = getConnector(conn.platform);
  const token = decrypt(conn.accessTokenEnc);
  const [adAccounts, pages] = await Promise.all([connector.listAdAccounts(token), connector.listPages(token)]);
  return { adAccounts, pages };
}

/** Save which ad account / page to use. Verifies the user really has access to them. */
export async function selectAccount(userId: string, id: string, adAccountId: string, pageId: string | null) {
  const conn = await getConnectionRow(userId, id);
  const { adAccounts, pages } = await connectionOptions(userId, id);
  const account = adAccounts.find((a) => a.id === adAccountId);
  if (!account) throw new ConnectorError("That ad account isn't available on this login");
  const page = pageId ? pages.find((p) => p.id === pageId) : null;
  if (pageId && !page) throw new ConnectorError("That page isn't available on this login");

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

function contextFor(conn: Connection): AccountContext {
  if (!conn.adAccountId || !conn.currency) {
    throw new ConnectorError("Choose an ad account for this connection first");
  }
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now()) {
    throw new ConnectorError("This login has expired. Please reconnect the account.");
  }
  return {
    accessToken: decrypt(conn.accessTokenEnc),
    adAccountId: conn.adAccountId,
    currency: conn.currency,
    pageId: conn.pageId,
  };
}

export async function launchCampaign(userId: string, connectionId: string, spec: CampaignSpec): Promise<Campaign> {
  const conn = await getConnectionRow(userId, connectionId);
  const connector = getConnector(conn.platform);
  const ctx = contextFor(conn);
  const result = await connector.launchCampaign(ctx, spec);

  const db = await getDb();
  const [row]: Campaign[] = await db
    .insert(campaigns)
    .values({
      id: randomUUID(),
      userId,
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

  const conns = new Map<string, Connection>();
  return Promise.all(
    rows.map(async (r) => {
      try {
        let conn = conns.get(r.connectionId);
        if (!conn) {
          conn = await getConnectionRow(userId, r.connectionId);
          conns.set(r.connectionId, conn);
        }
        const insights = await getConnector(r.platform).getInsights(contextFor(conn), r.platformIds);
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
  await getConnector(row.platform).setStatus(contextFor(conn), row.platformIds, status);
  await db.update(campaigns).set({ status }).where(eq(campaigns.id, row.id));
}
