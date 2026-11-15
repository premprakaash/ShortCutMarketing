"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Options = {
  adAccounts: { id: string; name: string; currency: string; active: boolean }[];
  pages: { id: string; name: string }[];
  pageLabel: string | null;
};

export default function AccountPicker({
  connectionId,
  initialAccountId,
  initialPageId,
  openByDefault,
}: {
  connectionId: string;
  initialAccountId: string | null;
  initialPageId: string | null;
  openByDefault: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(openByDefault);
  const [opts, setOpts] = useState<Options | null>(null);
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [pageId, setPageId] = useState(initialPageId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (forAccount?: string) => {
      setLoading(true);
      setError(null);
      try {
        const q = forAccount ? `?adAccountId=${encodeURIComponent(forAccount)}` : "";
        const r = await fetch(`/api/connections/${connectionId}${q}`);
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load accounts");
        setOpts(body);
        setAccountId((cur) => cur || body.adAccounts[0]?.id || "");
        setPageId((cur) => (body.pages.some((p: { id: string }) => p.id === cur) ? cur : body.pages[0]?.id || ""));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [connectionId],
  );

  useEffect(() => {
    if (open && !opts) load(accountId || undefined);
  }, [open, opts, load, accountId]);

  function changeAccount(id: string) {
    setAccountId(id);
    if (opts?.pageLabel) load(id); // pages/identities depend on the ad account on some platforms
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/connections/${connectionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adAccountId: accountId, pageId: pageId || null }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Could not save");
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Disconnect this account? Campaigns already running on the platform keep running.")) return;
    await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
    router.refresh();
  }

  if (!open) {
    return (
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn small" onClick={() => setOpen(true)}>
          Change account
        </button>
        <button className="btn small ghost danger" onClick={remove}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {error && <div className="alert error">{error}</div>}
      {!opts && !error && <div className="muted">Loading your ad accounts…</div>}
      {opts && (
        <>
          <div className="grid2">
            <div>
              <label>Ad account</label>
              <select value={accountId} onChange={(e) => changeAccount(e.target.value)}>
                {opts.adAccounts.length === 0 && <option value="">No ad accounts found</option>}
                {opts.adAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency}){a.active ? "" : " — inactive"}
                  </option>
                ))}
              </select>
            </div>
            {opts.pageLabel && (
              <div>
                <label>
                  {opts.pageLabel} <span className="hint">(ads run as this)</span>
                </label>
                <select value={pageId} onChange={(e) => setPageId(e.target.value)} disabled={loading}>
                  {opts.pages.length === 0 && <option value="">None found</option>}
                  {opts.pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary small" onClick={save} disabled={saving || loading || !accountId}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn small ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
