Tela cheia corrigida e legendas personalizáveis no Umbra.

- O vídeo ocupa toda a tela, preservando sua proporção, com cabeçalho e controles sobrepostos.
- Controles e cursor desaparecem após 2,5 segundos sem interação, inclusive com o vídeo pausado ou o mouse sobre os controles. Sair com o mouse do player oculta o overlay imediatamente; mover o mouse revela os controles.
- Barra de rolagem removida durante a reprodução expandida.
- F11 e dois cliques alternam tela cheia; Esc sai. Minimizar retorna à janela da biblioteca.
- Legendas de texto sobem enquanto os controles estão visíveis.
- Novo painel **Ajustar legenda** com tamanho, cor, fundo, contorno e altura. Preferências salvas no computador para as próximas sessões; ajustes se aplicam às legendas de texto.
- Ao buscar ou encerrar um vídeo, requisições atrasadas da sessão anterior são canceladas sem gerar um erro falso de arquivo ausente.

### Windows x64

- **Umbra-0.1.1-x64-nsis.exe**: instalador com atalho e escolha de pasta.
- **Umbra-0.1.1-x64-portable.exe**: executável sem instalação.
- Electron, FFmpeg, ffprobe e motor torrent incluídos. Não precisa de Node.js, Python, mpv ou de um SSD específico.

Testes Linux e do aplicativo Windows empacotado verificam o tamanho real do vídeo, ausência de rolagem, controles automáticos, atalhos, reprodução, áudio, legendas e retomada. A versão continua sem assinatura de código. `SHA256SUMS.txt` contém os hashes dos executáveis.
