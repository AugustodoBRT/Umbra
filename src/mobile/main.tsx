import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../renderer/App';
import { MobileBackend } from './backend';
import { AndroidUpdates } from './AndroidUpdates';
import '../renderer/styles.css';
import '../renderer/identity.css';
import './mobile.css';
document.documentElement.dataset.platform = 'android';
async function start() {
  try { window.cine = await new MobileBackend().initialize(); createRoot(document.getElementById('root')!).render(<React.StrictMode><App/><AndroidUpdates/></React.StrictMode>); }
  catch (error: any) { const root = document.getElementById('root')!; root.replaceChildren(); const title = document.createElement('h1'); title.textContent = 'Não foi possível abrir o Umbra.'; const description = document.createElement('p'); description.textContent = error.message; const retry = document.createElement('button'); retry.textContent = 'Tentar novamente'; retry.onclick = () => location.reload(); root.append(title,description,retry); }
}
void start();
