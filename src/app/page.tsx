import Link from "next/link";
import { count, money } from "@/lib/format";
import { listCampaigns } from "@/lib/service";
import { getUserId } from "@/lib/user";
import CampaignActions from "./campaign-actions";

export const dynamic = "force-dynamic";

const OBJECTIVE_LABEL: Record<string, string> = {
  traffic: "Website visits",
  awareness: "Reach",
  video_views: "Video views",
};

export default async function Dashboard() {
  const campaigns = await listCampaigns(await getUserId());
  const currencies = new Set(campaigns.map((c) => c.currency));
  const oneCurrency = currencies.size <= 1 ? (campaigns[0]?.currency ?? "INR") : null;
  const sum = (k: "spend" | "impressions" | "clicks" | "videoViews") =>
    campaigns.reduce((t, c) => t + (c.insights?.[k] ?? 0), 0);

  return (
    <main>
      <div className="row spread">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">All your ads across platforms, in one place.</p>
        </div>
        <Link href="/boost" className="btn primary">
          + Boost a video
        </Link>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Total spend</div>
          <div className="v">{oneCurrency ? money(sum("spend"), oneCurrency) : "Mixed"}</div>
        </div>
        <div className="stat">
          <div className="k">Impressions</div>
          <div className="v">{count(sum("impressions"))}</div>
        </div>
        <div className="stat">
          <div className="k">Clicks</div>
          <div className="v">{count(sum("clicks"))}</div>
        </div>
        <div className="stat">
          <div className="k">Video views</div>
          <div className="v">{count(sum("videoViews"))}</div>
        </div>
      </div>

      <div className="card">
        {campaigns.length === 0 ? (
          <div className="empty">
            No campaigns yet. <Link href="/connections">Connect an ad account</Link>, then{" "}
            <Link href="/boost">boost your first video</Link>.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th className="num">Daily budget</th>
                  <th className="num">Spend</th>
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
                      <div className="muted">{OBJECTIVE_LABEL[c.objective] ?? c.objective}</div>
                      {c.insightsError && <div className="muted">Stats unavailable: {c.insightsError}</div>}
                    </td>
                    <td>{c.platform === "meta" ? "Meta" : c.platform}</td>
                    <td>
                      <span className={`badge ${c.status}`}>{c.status}</span>
                    </td>
                    <td className="num">{money(c.dailyBudget, c.currency)}</td>
                    <td className="num">{c.insights ? money(c.insights.spend, c.currency) : "—"}</td>
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
    </main>
  );
}
