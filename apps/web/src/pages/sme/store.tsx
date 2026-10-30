/**
 * The SME's data for one financial year, shared by every SME screen.
 * A change shows at once and is saved per module 0.6 s after the last keystroke; each save returns
 * fresh results from the server, which is the only place figures are calculated.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { smeApi, type SmeData, type SmeModule } from '../../lib/sme';
import { useApp } from '../../App';

type Saving = 'idle' | 'saving' | 'saved' | 'error';
interface Store {
  d: SmeData | null;
  fy: string;
  setFy: (fy: string) => void;
  /** a value by path, e.g. "emissions.diesel" or "footprint.products.0.share" */
  get: (path: string) => any;
  /** set a value by path and save its module */
  set: (path: string, value: any) => void;
  /** replace a whole module (list editors) and save it */
  setModule: (mod: SmeModule, value: any) => void;
  saveCompany: (b: Parameters<typeof smeApi.company>[0]) => Promise<void>;
  reload: () => Promise<void>;
  saving: Saving;
  error: string | null;
}
const Ctx = createContext<Store>(null as unknown as Store);
export const useSme = () => useContext(Ctx);

const getPath = (o: any, path: string) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o: any, path: string, v: any) {
  const ks = path.split('.'), out = structuredClone(o ?? {});
  let x = out;
  for (let i = 0; i < ks.length - 1; i++) { if (x[ks[i]!] == null) x[ks[i]!] = /^\d+$/.test(ks[i + 1]!) ? [] : {}; x = x[ks[i]!]; }
  x[ks[ks.length - 1]!] = v;
  return out;
}

export function SmeProvider({ children }: { children: ReactNode }) {
  const { toast } = useApp();
  const [fy, setFyState] = useState<string>(() => { try { return localStorage.getItem('eko_sme_fy') ?? ''; } catch { return ''; } });
  const [d, setD] = useState<SmeData | null>(null);
  const [saving, setSaving] = useState<Saving>('idle');
  const [error, setError] = useState<string | null>(null);
  const dRef = useRef<SmeData | null>(null); dRef.current = d;
  const timers = useRef<Record<string, number>>({});

  const load = useCallback(async (want?: string) => {
    try {
      let x = await smeApi.data(want || undefined);
      // first visit: open the newest year that has data rather than an empty current year
      if (!want && x.years.length > 1 && Object.keys(x.meta).length === 0) {
        const withData = x.years.find((y) => y !== x.fy);
        if (withData) { const y = await smeApi.data(withData); if (Object.keys(y.meta).length) x = y; }
      }
      setD(x); setError(null);
      if (x.fy !== fy) { setFyState(x.fy); try { localStorage.setItem('eko_sme_fy', x.fy); } catch { /* not kept */ } }
    } catch (e) {
      setError((e as Error).message);
      // subscription ended: everything but Plan & billing is closed until renewed
      if ((e as { code?: string }).code === 'RENEW' && !window.location.pathname.startsWith('/sme/billing')) window.location.assign('/sme/billing');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(fy || undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setFy = (y: string) => { setFyState(y); try { localStorage.setItem('eko_sme_fy', y); } catch { /* not kept */ } setD(null); load(y); };

  const save = useCallback(async (mod: SmeModule) => {
    const cur = dRef.current;
    if (!cur) return;
    try {
      const r = await smeApi.save(mod, cur.fy, cur.data[mod] ?? {}, cur.meta[mod]?.version);
      setD((p) => p && ({ ...p, results: r.results, meta: { ...p.meta, [mod]: { ...(p.meta[mod] ?? { updatedName: null, updatedAt: '' }), version: r.version } } }));
      setSaving('saved');
    } catch (e) {
      setSaving('error'); toast((e as Error).message);
      if ((e as { status?: number }).status === 409) load(cur.fy);
    }
  }, [toast, load]);

  const queue = (mod: SmeModule) => {
    window.clearTimeout(timers.current[mod]);
    setSaving('saving');
    timers.current[mod] = window.setTimeout(() => save(mod), 600);
  };
  const set = (path: string, value: any) => {
    const mod = path.split('.')[0] as SmeModule;
    setD((p) => p && ({ ...p, data: setPath(p.data, path, value) }));
    queue(mod);
  };
  const setModule = (mod: SmeModule, value: any) => { setD((p) => p && ({ ...p, data: { ...p.data, [mod]: value } })); queue(mod); };
  const saveCompany = async (b: Parameters<typeof smeApi.company>[0]) => {
    await smeApi.company(b);
    await load(dRef.current?.fy);
  };
  const store: Store = { d, fy: d?.fy ?? fy, setFy, get: (p) => getPath(d?.data, p), set, setModule, saveCompany, reload: () => load(dRef.current?.fy), saving, error };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
