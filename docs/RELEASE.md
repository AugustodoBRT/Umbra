O Umbra agora reproduz vídeos com mpv integrado na própria janela.

- O motor lê o arquivo original, com decodificação nativa e aceleração por GPU quando disponível. MKV, HEVC de 10 bits e áudio AC3 não exigem a antiga recodificação H.264/AAC, nem redução obrigatória para 1080p.
- Busca precisa, múltiplos áudios, velocidade, volume, retomada e progresso continuam nos controles do Umbra.
- Legendas ASS/SSA preservam estilos; SRT/VTT e legendas em imagem são renderizadas pelo motor. A sincronização de legenda agora pode ser ajustada e fica salva por arquivo.
- Tela cheia usa a mesma janela. Os controles têm área própria quando visíveis; quando somem, o vídeo ocupa a tela inteira. F11/Esc e controles nativos do vídeo são integrados à interface.
- mpv e a superfície nativa acompanham o instalador e a versão portable, com origem e SHA-256 fixados. O pacote fica maior por incluir esse motor, mas elimina o trabalho de recodificação durante a reprodução.
- Perfis, bibliotecas, avaliações, histórico e downloads existentes são preservados.

### Windows x64

- **Umbra-0.1.5-x64-nsis.exe**: instalador com atalho e escolha de pasta.
- **Umbra-0.1.5-x64-portable.exe**: executável sem instalação.
- Electron, mpv, FFmpeg, ffprobe e motor torrent incluídos. Não precisa instalar Node.js, Python, mpv ou Stremio.

A publicação exige aprovação dos testes Linux e do aplicativo Windows empacotado. Eles verificam a imagem na superfície nativa, MP4/MKV H.264, HEVC de 10 bits a 1920×1088, dois áudios AC3, legendas, pausa, busca exata, volume, velocidade, tela cheia, preferências, retomada, conclusão e liberação dos arquivos antes da exclusão. Catálogo online e downloads HTTP de filme/temporada em pasta vazia também são verificados; o worker torrent verifica Unicode e proteção contra sobrescrita.

4K, HDR em monitor físico, passthrough em receiver e todos os formatos possíveis ainda exigem testes com hardware e arquivos reais. Não há autoplay do próximo episódio. Linux usa X11/XWayland e mpv do sistema.

A versão continua sem assinatura de código. `SHA256SUMS.txt` contém os hashes dos executáveis; os pacotes originais mpv/FFmpeg acompanham os assets.
