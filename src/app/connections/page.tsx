import { isConfigured } from "@/lib/connectors";
import { PLATFORM_INFO, platformInfo } from "@/lib/platforms";
import { listConnections } from "@/lib/service";
import { getUserId } from "@/lib/user";
import { PlatformLogo } from "../platform-badge";
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
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Connections</div>
          <h1>Ad accounts</h1>
          <p className="sub">Connect every platform once. Logins are stored encrypted and refreshed automatically.</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {connected && <div className="alert ok">Connected! Now choose which ad account to use below.</div>}

      <div className="grid-auto">
        {PLATFORM_INFO.map((p) => {
          const ready = isConfigured(p.id);
          const n = conns.filter((c) => c.platform === p.id).length;
          return (
            <div key={p.id} className={`tile${p.status === "soon" ? " disabled" : ""}${n ? " selected" : ""}`}>
              <div className="tile-head">
                <PlatformLogo id={p.id} />
                <strong style={{ flex: 1 }}>{p.short}</strong>
                {n > 0 && <span className="badge done">{n} connected</span>}
              </div>
              <p className="muted" style={{ margin: 0, minHeight: 36 }}>
                {p.blurb}
              </p>
              {p.status === "soon" ? (
                <span className="badge">Coming soon</span>
              ) : ready ? (
                <a className={`btn ${n ? "" : "primary"} small`} href={`/api/connect/${p.id}`}>
                  {n ? "Connect another" : `Connect ${p.short}`}
                </a>
              ) : (
                <div className="faint">
                  Not set up on the server yet. Add <span className="mono">{p.env.join(", ")}</span> ·{" "}
                  <a href={p.docs} target="_blank" rel="noreferrer">
                    docs
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="section">
        <h2>Your connected accounts</h2>
        {conns.length === 0 ? (
          <div className="card empty">No ad accounts connected yet. Pick a platform above.</div>
        ) : (
          conns.map((c) => (
            <div className="card" key={c.id}>
              <div className="row spread">
                <div className="row" style={{ gap: 12 }}>
                  <PlatformLogo id={c.platform} />
                  <div>
                    <strong>{platformInfo(c.platform).short}</strong>
                    {c.displayName && <span className="muted"> · {c.displayName}</span>}
                    <div className="muted">
                      {c.adAccountName ? (
                        <>
                          {c.adAccountName} ({c.currency}) {c.pageName && <>· {c.pageName}</>}
                        </>
                      ) : (
                        <span style={{ color: "var(--warn)" }}>Choose an ad account to finish setup</span>
                      )}
                    </div>
                  </div>
                </div>
                {c.adAccountId && <span className="badge done">Ready</span>}
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
      </div>
    </>
  );
}
