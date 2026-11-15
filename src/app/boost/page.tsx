import { redirect } from "next/navigation";

/** Old "Boost a video" link — now handled by the campaign wizard (keeps the same query params). */
export default async function BoostPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = new URLSearchParams(await searchParams);
  redirect(`/create${q.size ? `?${q}` : ""}`);
}
