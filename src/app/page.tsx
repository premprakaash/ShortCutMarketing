import Link from "next/link";
import { count, money } from "@/lib/format";
import { platformInfo } from "@/lib/platforms";
import { listCampaigns, listConnections } from "@/lib/service";
import { getUserId } from "@/lib/user";
import CampaignActions from "./campaign-actions";
import { PlatformBadge } from "./platform-badge";

export const dynamic = "force-dynamic";

const OBJECTIVE_LABEL: Record<string, string> = {
  traffic: "Website visits",
  awareness: "Reach",
  video_views: "Video views",
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ platform?: string }> }) {
  const { platform } = await searchParams;
  const userId = await getUserId();
  const [all, conns] = await Promise.all([listCampaigns(userId), listConnections(userId)]);
  const campaigns = platform ? all.filter((c) => c.platform === platform) : all;
  const platformsUsed = [...new Set(all.map((c) => c.platform))];

  const currencies = new Set(campaigns.map((c) => c.currency));
  const oneCurrency = currencies.size <= 1 ? (campaigns[0]?.currency ?? "INR") : null;
  const sum = (list: typeof campaigns, k: "spend" | "impressions" | "clicks" | "videoViews") =>
    list.reduce((t, c) => t + (c.insights?.[k] ?? 0), 0);
  const impressions = sum(campaigns, "impressions");
  const clicks = sum(campaigns, "clicks");

  const byPlatform = platformsUsed.map((p) => {
    const list = all.filter((c) => c.platform === p);
    return {
      id: p,
      count: list.length,
      active: list.filter((c) => c.status === "ACTIVE").length,
      spend: sum(list, "spend"),
      clicks: sum(list, "clicks"),
      impressions: sum(list, "impressions"),
      currency: new Set(list.map((c) => c.currency)).size === 1 ? list[0].currency : null,
    };
  });
  const maxImpr = Math.max(1, ...byPlatform.map((p) => p.impressions));
  const groupSizes = new Map<string, number>();
  for (const c of all) if (c.groupId) groupSizes.set(c.groupId, (groupSizes.get(c.groupId) ?? 0) + 1);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">All platforms · one view</div>
          <h1>Dashboard</h1>
          <p className="sub">Spend, reach and results from every connected ad platform.</p>
        </div>
        <div className="row">
          <Link href="/studio" className="btn">
            AI Studio
          </Link>
          <Link href="/create" className="btn primary">
            + Create campaign
          </Link>
        </div>
      </div>

      {conns.length === 0 && (
        <div className="card highlight" style={{ marginBottom: 18 }}>
          <div className="row spread">
            <div>
              <h2 style={{ marginBottom: 4 }}>Get started in 3 steps</h2>
              <p className="muted" style={{ margin: 0 }}>
                1. Connect your ad accounts · 2. Generate a video with AI · 3. Launch on every platform with one budget form.
              </p>
            </div>
            <Link href="/connections" className="btn primary">
              Connect ad accounts →
            </Link>
          </div>
        </div>
      )}

      <div className="stats">
        <div className="stat accent">
          <div className="k">Total spend</div>
          <div className="v">{oneCurrency ? money(sum(campaigns, "spend"), oneCurrency) : "Mixed"}</div>
        </div>
        <div className="stat">
          <div className="k">Impressions</div>
          <div className="v">{count(impressions)}</div>
        </div>
        <div className="stat">
          <div className="k">Clicks</div>
          <div className="v">{count(clicks)}</div>
        </div>
        <div className="stat">
          <div className="k">CTR</div>
          <div className="v">{impressions ? ((clicks / impressions) * 100).toFixed(2) : "0.00"}%</div>
        </div>
        <div className="stat">
          <div className="k">Video views</div>
          <div className="v">{count(sum(campaigns, "videoViews"))}</div>
        </div>
      </div>

      {byPlatform.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>By platform</h2>
          <div className="bars">
            {byPlatform.map((p) => (
              <div className="bar-row" key={p.id}>
                <PlatformBadge id={p.id} />
                <div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(p.impressions / maxImpr) * 100}%`, background: platformInfo(p.id).color }}
                    />
                  </div>
                  <div className="faint" style={{ marginTop: 4 }}>
                    {count(p.impressions)} impressions · {count(p.clicks)} clicks · {p.active}/{p.count} running
                  </div>
                </div>
                <div className="num" style={{ textAlign: "right", fontWeight: 700 }}>
                  {p.currency ? money(p.spend, p.currency) : "Mixed"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Campaigns</h2>
          {platformsUsed.length > 1 && (
            <div className="chips">
              <Link href="/" className={`chip${!platform ? " on" : ""}`}>
                All
              </Link>
              {platformsUsed.map((p) => (
                <Link key={p} href={`/?platform=${p}`} className={`chip${platform === p ? " on" : ""}`}>
                  {platformInfo(p).short}
                </Link>
              ))}
            </div>
          )}
        </div>
        {campaigns.length === 0 ? (
          <div className="empty">
            <div className="big">🎬</div>
            No campaigns yet. <Link href="/create">Create your first one</Link> — AI can write the ad and make the video.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th className="num">Budget / day</th>
                  <th className="num">Spend</th>
                  <th className="num">Impr.</th>
                  <th className="num">Clicks</th>
                  <th className="num">CTR</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="faint">
                        {OBJECTIVE_LABEL[c.objective] ?? c.objective}
                        {c.groupId && (groupSizes.get(c.groupId) ?? 0) > 1 && ` · launched on ${groupSizes.get(c.groupId)} platforms`}
                      </div>
                      {c.insightsError && <div className="faint" style={{ color: "var(--warn)" }}>Stats unavailable: {c.insightsError}</div>}
                    </td>
                    <td>
                      <PlatformBadge id={c.platform} />
                    </td>
                    <td>
                      <span className={`badge ${c.status}`}>{c.status === "ACTIVE" ? "Running" : "Paused"}</span>
                    </td>
                    <td className="num">{money(c.dailyBudget, c.currency)}</td>
                    <td className="num">{c.insights ? money(c.insights.spend, c.currency) : "—"}</td>
                    <td className="num">{c.insights ? count(c.insights.impressions) : "—"}</td>
                    <td className="num">{c.insights ? count(c.insights.clicks) : "—"}</td>
                    <td className="num">{c.insights ? `${c.insights.ctr.toFixed(2)}%` : "—"}</td>
                    <td className="num">
                      <CampaignActions id={c.id} status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
