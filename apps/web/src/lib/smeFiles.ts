/** EKOTRACE SME proof documents (apps/api/src/modules/smeFiles.routes.ts). */
import { call, download } from './api';

export interface SmeFile { id: string; module: string; item_key: string; name: string; mime: string; size: number; uploaded_name: string | null; created_at: string }
const qs = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]).toString();

export const smeFiles = {
  list: (fy: string, module?: string, key?: string) => call<{ files: SmeFile[] }>('GET', `/api/sme/files?${qs({ fy, module, key })}`),
  upload: (fy: string, module: string, key: string, file: File) =>
    call<SmeFile>('POST', `/api/sme/files?${qs({ fy, module, key })}`, undefined, file, { 'x-filename': encodeURIComponent(file.name) }),
  open: (f: SmeFile) => download(`/api/sme/files/${f.id}`, f.name),
  remove: (id: string) => call<{ ok: true }>('DELETE', `/api/sme/files/${id}`),
};
export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
