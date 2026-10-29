import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { device } from './native';
import { availableUpdate, updateFeed, type AndroidUpdate } from './updates';
export function AndroidUpdates() {
  const [update,setUpdate] = useState<AndroidUpdate|null>(null),[version,setVersion] = useState(''),[busy,setBusy] = useState(false),[error,setError] = useState(''),[progress,setProgress] = useState('');
  const check = async (manual = false) => {
    try { if (manual) { setBusy(true); setError(''); } const app = await device.appInfo(); setVersion(app.versionName);
      const response = await device.http({ url: updateFeed,headers: { 'Cache-Control': 'no-cache' },limit: 100000 });
      if (response.status === 404) { if (manual) setError('Nenhuma atualização publicada por enquanto.'); return; }
      if (response.status !== 200) throw new Error('Não foi possível verificar atualizações.');
      const next = availableUpdate(JSON.parse(response.body),app.versionCode); setUpdate(next); if (manual && !next) setError('Você já tem a versão mais recente.');
    } catch (error: any) { if (manual) setError(error.message); } finally { if (manual) setBusy(false); }
  };
  useEffect(() => {
    void check(); const resume = () => { if (document.visibilityState === 'visible') void check(); }; document.addEventListener('visibilitychange',resume);
    const interval = setInterval(() => void check(),6*60*60*1000);
    const event = device.addListener('deviceEvent',event => { if (event.type === 'updateProgress') setProgress(event.total > 0 ? `${Math.round(event.downloaded/event.total*100)}%` : `${Math.round(event.downloaded/1e6)} MB`); });
    return () => { document.removeEventListener('visibilitychange',resume); clearInterval(interval); void event.then(listener => listener.remove()); };
  },[]);
  const install = async () => { if (!update) return; setBusy(true); setError(''); setProgress('Preparando…'); try { await device.installUpdate({ url: update.url,sha256: update.sha256,versionCode: update.versionCode }); setProgress('Confirme a instalação no Android.'); } catch (error: any) { setError(error.message); } finally { setBusy(false); } };
  return <section className={`android-updates ${update ? 'has-update' : ''}`} aria-label="Atualizações do Umbra">
    {update ? <><div><strong>Nova versão: {update.versionName}</strong><span>{busy ? `Baixando atualização · ${progress}` : 'Atualize sem perder seus dados.'}</span></div><button className="button primary" disabled={busy} onClick={() => void install()}><Download size={17}/>{busy ? progress || 'Baixando…' : 'Baixar e atualizar'}</button></> : <button className="text-button" disabled={busy} onClick={() => void check(true)}><RefreshCw size={14}/>Umbra {version} · Verificar atualização</button>}
    {!!error && <p role="status">{error}<button className="icon-button" aria-label="Fechar aviso de atualização" onClick={() => setError('')}><X size={14}/></button></p>}
  </section>;
}
