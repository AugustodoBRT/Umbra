export interface DebridFile { name: string; size: number; url: string }
export type DebridResult = { state: 'ready'; files: DebridFile[] } | { state: 'pending'; progress: number; status: string };
export interface DebridUser { username: string; premium: boolean }
type Fetch = typeof fetch;
const base = 'https://api.real-debrid.com/rest/1.0';
const audio = /\.(mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav)$/i;
const failures = new Set(['magnet_error','error','virus','dead']);
const natural = new Intl.Collator('en',{ numeric: true,sensitivity: 'base' });
const sleep = (ms: number,signal?: AbortSignal) => new Promise<void>((resolve,reject) => { const timer = setTimeout(resolve,ms); signal?.addEventListener('abort',() => { clearTimeout(timer); reject(new Error('A consulta foi interrompida.')); },{ once: true }); });

/** Resolves torrents through the user's own Real-Debrid account; nothing is stored outside that account. */
export class RealDebrid {
  constructor(private token: string,private request: Fetch = fetch,private signal?: AbortSignal) {}
  private async call(path: string,body?: Record<string,string>,method = body ? 'POST' : 'GET'): Promise<any> {
    const response = await this.request(`${base}${path}`,{ method,signal: this.signal ? AbortSignal.any([this.signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),headers: { authorization: `Bearer ${this.token}`,...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },body: body ? new URLSearchParams(body).toString() : undefined });
    if (response.status === 204) return null;
    const text = await response.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* Error pages are not JSON. */ }
    if (response.ok) return data;
    const code = String(data?.error ?? '');
    if (response.status === 401 || code === 'bad_token') throw new Error('Chave do Real-Debrid inválida ou expirada.');
    if (response.status === 403 && /permission|premium|account/i.test(code)) throw new Error('Sua conta do Real-Debrid não tem acesso premium ativo.');
    if (response.status === 429) throw new Error('Limite de consultas do Real-Debrid atingido; tente novamente em instantes.');
    throw new Error(`O Real-Debrid recusou a consulta${code ? ` (${code})` : ''}.`);
  }
  async user(): Promise<DebridUser> { const data = await this.call('/user'); return { username: String(data?.username ?? ''),premium: data?.type === 'premium' }; }
  private async find(hash: string) {
    const list = await this.call('/torrents?limit=100'); if (!Array.isArray(list)) return undefined;
    return list.find((torrent: any) => typeof torrent?.hash === 'string' && torrent.hash.toLowerCase() === hash && !failures.has(torrent.status))?.id as string | undefined;
  }
  async resolve(infoHash: string,trackers: string[],waitMs = 20000): Promise<DebridResult> {
    const hash = infoHash.toLowerCase();
    // Canonical form: URLSearchParams would write urn%3Abtih%3A, which not every service decodes.
    const magnet = `magnet:?xt=urn:btih:${hash}${trackers.slice(0,20).map(tracker => `&tr=${encodeURIComponent(tracker)}`).join('')}`;
    // Reusing an existing entry keeps the account tidy and returns cached results at once.
    const id = await this.find(hash) ?? (await this.call('/torrents/addMagnet',{ magnet }))?.id as string | undefined;
    if (!id) throw new Error('O Real-Debrid não aceitou este torrent.');
    const deadline = Date.now()+waitMs; let selected = false;
    while (true) {
      const info = await this.call(`/torrents/info/${encodeURIComponent(id)}`); const status = String(info?.status ?? '');
      if (failures.has(status)) throw new Error('O Real-Debrid não conseguiu preparar este torrent.');
      if (status === 'waiting_files_selection' && !selected) {
        const files: { id: number; path: string }[] = Array.isArray(info.files) ? info.files : []; const wanted = files.filter(file => audio.test(file.path)).map(file => file.id);
        await this.call(`/torrents/selectFiles/${encodeURIComponent(id)}`,{ files: wanted.length ? wanted.join(',') : 'all' }); selected = true; continue;
      }
      if (status === 'downloaded') {
        const chosen: { path: string; bytes: number; selected: number }[] = (Array.isArray(info.files) ? info.files : []).filter((file: any) => file.selected === 1); const links: string[] = Array.isArray(info.links) ? info.links : [];
        // Real-Debrid lists one link per selected file, in file order.
        const files: DebridFile[] = []; for (const [index,link] of links.slice(0,100).entries()) {
          const data = await this.call('/unrestrict/link',{ link }); if (typeof data?.download !== 'string') continue;
          files.push({ name: String(data.filename ?? chosen[index]?.path ?? `Parte ${index+1}`),size: Number(data.filesize) || chosen[index]?.bytes || 0,url: data.download });
        }
        files.sort((a,b) => natural.compare(a.name,b.name));
        if (!files.length) throw new Error('O Real-Debrid não devolveu arquivos para este torrent.');
        return { state: 'ready',files };
      }
      if (Date.now() >= deadline) return { state: 'pending',progress: Number(info?.progress) || 0,status };
      await sleep(1500,this.signal);
    }
  }
}
