# Motor de reprodução

Pesquisa realizada em 04/10/2026 antes de alterar o player, com escolha do usuário por mpv integrado.

| Opção | O que oferece | Decisão para o Umbra |
| --- | --- | --- |
| mpv | Decodificação nativa, GPU, faixas, ASS/libass, legendas em imagem e controle por API/IPC | Adotado dentro da janela, preservando a interface e o catálogo |
| libVLC | Motor nativo com ampla compatibilidade, bibliotecas e plugins próprios | Alternativa válida; também exige integrar a superfície nativa e distribuir o motor |
| Video.js / hls.js / Shaka | Controles e reprodução de mídia web/HLS/DASH sobre as APIs do navegador | Não substituem um motor nativo para arquivos locais com codecs/legendas diversos |
| mpv.js antigo | Plugin Pepper para Electron | Não adotado: depende de uma integração Pepper que deixou de ser suportada pelo Electron |

O Stremio não implementa codecs próprios. Seu shell Qt integra libmpv com OpenGL; o shell novo Windows combina WebView2 e mpv. A camada `ShellVideo` traduz volume, posição, faixas e atraso de legenda em comandos/propriedades do motor. No Umbra mantivemos Electron e React e usamos o mpv por JSON IPC, renderizando em uma superfície filha Win32/X11. Isso reaproveita o motor sem trocar armazenamento, metadados ou downloads pelo código do Stremio.

Referências primárias:

- [Shell Qt e integração libmpv do Stremio](https://github.com/Stremio/stremio-shell/blob/master/mpv.cpp).
- [Shell Windows WebView2/mpv do Stremio](https://github.com/Stremio/stremio-shell-ng).
- [Controles ShellVideo](https://github.com/Stremio/stremio-video/blob/master/src/ShellVideo/ShellVideo.js).
- [mpv: IPC, embedding, hardware decoding e opções](https://mpv.io/manual/stable/).
- [Exemplos e cuidados de embedding libmpv](https://github.com/mpv-player/mpv-examples/blob/master/libmpv/README.md).
- [libVLC](https://images.videolan.org/vlc/libvlc.html).
- [Video.js](https://github.com/videojs/video.js), [hls.js](https://github.com/video-dev/hls.js), [Shaka](https://github.com/shaka-project/shaka-player).
- [mpv.js/PPAPI](https://github.com/Kagami/mpv.js) e [remoção de Pepper no Electron](https://www.electronjs.org/docs/latest/tutorial/using-pepper-flash-plugin/).

## Desempenho e qualidade

A reprodução não inicia FFmpeg para converter o filme. O mpv lê e decodifica o original, preservando resolução e faixas; GPU é solicitada com `hwdec=auto`, com fallback para CPU quando necessário. A disponibilidade depende do codec e do hardware. Não se copia cada frame para JavaScript/canvas nem se gera uma cópia convertida no SSD. O cache de demux tem limites de 64 MiB à frente e 16 MiB anteriores, além da memória do decoder/GPU.

No Linux local, a prova de reprodução H.264 confirmou `nvdec`. O teste do motor usa HEVC de 10 bits a 1920×1088, dois áudios AC3 e ASS, verificando busca exata e persistência sem a antiga redução para 1080p. A suíte desktop verifica a superfície nativa, controles, tela cheia e liberação de arquivos antes da exclusão. Isso não representa um benchmark de filmes 4K longos nem valida HDR em um monitor físico ou passthrough num receiver.

Os controles web têm área própria enquanto visíveis para não serem encobertos pela superfície nativa. Quando somem em tela cheia, o vídeo ocupa o viewport inteiro. A superfície permanece mapeada durante mudanças de layout. Linux usa X11/XWayland e a saída `gpu` estável do mpv para compatibilidade com versões como a do Ubuntu 24.04; Windows usa `gpu-next` com fallback `gpu` e recebe o motor e a superfície junto com o instalador. O pacote Windows fica maior por incluir o motor, embora o trabalho de recodificação durante a reprodução seja eliminado.
