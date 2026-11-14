"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Options = {
  adAccounts: { id: string; name: string; currency: string; active: boolean }[];
  pages: { id: string; name: string }[];
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || opts) return;
    fetch(`/api/connections/${connectionId}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load accounts");
        setOpts(body);
        if (!accountId && body.adAccounts[0]) setAccountId(body.adAccounts[0].id);
        if (!pageId && body.pages[0]) setPageId(body.pages[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, [open, opts, connectionId, accountId, pageId]);

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
    if (!confirm("Disconnect this account? Campaigns already running on the platform are not affected.")) return;
    await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
    router.refresh();
  }

  if (!open) {
    return (
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn small" onClick={() => setOpen(true)}>
          Change account
        </button>
        <button className="btn small" onClick={remove}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      {error && <div className="alert error">{error}</div>}
      {!opts && !error && <div className="muted">Loading your ad accounts…</div>}
      {opts && (
        <>
          <div className="grid2">
            <div>
              <label>Ad account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {opts.adAccounts.length === 0 && <option value="">No ad accounts found</option>}
                {opts.adAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency}){a.active ? "" : " — inactive"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>
                Facebook Page <span className="hint">(ads run from this page)</span>
              </label>
              <select value={pageId} onChange={(e) => setPageId(e.target.value)}>
                {opts.pages.length === 0 && <option value="">No pages found</option>}
                {opts.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary small" onClick={save} disabled={saving || !accountId}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn small" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
