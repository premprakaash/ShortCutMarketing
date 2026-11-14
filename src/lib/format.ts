export function money(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function count(n: number): string {
  return new Intl.NumberFormat("en-IN").format(Math.round(n));
}
