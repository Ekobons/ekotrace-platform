/**
 * The facility and year a person is working on, kept while they stay logged in (Add data, Entries & results), so
 * moving between pages does not jump back to the first facility or this year. Cleared at log-in and log-out.
 * Browser storage only — a per-person convenience; nothing breaks when it is unavailable.
 */
const KEY = 'eko.work';
type Work = { tenant?: string; facility?: string; year?: number };
const read = (): Work => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Work; } catch { return {}; } };
const write = (w: Work) => { try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* storage unavailable */ } };

/** The remembered facility and year for this company (a remembered value of another company is ignored). */
export function workContext(tenant: string | null | undefined): { facility?: string; year?: number } {
  const w = read();
  return tenant && w.tenant === tenant ? { facility: w.facility, year: w.year } : {};
}
export function rememberWork(tenant: string | null | undefined, patch: { facility?: string; year?: number }) {
  if (!tenant) return;
  const w = read();
  write({ ...(w.tenant === tenant ? w : {}), tenant, ...patch });
}
export function forgetWork() { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }
