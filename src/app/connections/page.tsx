import { listConnections } from "@/lib/service";
import { getUserId } from "@/lib/user";
import AccountPicker from "./account-picker";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error, connected } = await searchParams;
  const conns = await listConnections(await getUserId());

  return (
    <main>
      <h1>Ad accounts</h1>
      <p className="sub">Connect the platforms you want to advertise on. Your login is stored encrypted.</p>

      {error && <div className="alert error">{error}</div>}
      {connected && <div className="alert ok">Connected! Now choose which ad account and page to use.</div>}

      <div className="card">
        <div className="row">
          <a className="btn primary" href="/api/connect/meta">
            Connect Meta (Facebook &amp; Instagram)
          </a>
          <button className="btn" disabled title="Coming next — waiting for Google Ads developer token approval">
            Connect Google Ads (soon)
          </button>
        </div>
      </div>

      {conns.length === 0 ? (
        <div className="card empty">No ad accounts connected yet.</div>
      ) : (
        conns.map((c) => (
          <div className="card" key={c.id}>
            <div className="row spread">
              <div>
                <strong>{c.platform === "meta" ? "Meta" : c.platform}</strong>
                {c.displayName && <span className="muted"> · {c.displayName}</span>}
                <div className="muted">
                  {c.adAccountName ? (
                    <>
                      Ad account: {c.adAccountName} ({c.currency}) {c.pageName && <>· Page: {c.pageName}</>}
                    </>
                  ) : (
                    "No ad account selected yet"
                  )}
                </div>
                {c.tokenExpiresAt && (
                  <div className="muted">Login valid until {new Date(c.tokenExpiresAt).toLocaleDateString("en-IN")}</div>
                )}
              </div>
            </div>
            <AccountPicker
              connectionId={c.id}
              initialAccountId={c.adAccountId}
              initialPageId={c.pageId}
              openByDefault={!c.adAccountId || c.id === connected}
            />
          </div>
        ))
      )}
    </main>
  );
}
