Primeira versão pública do Umbra: biblioteca local, catálogo online, identidade escura, histórico de assistidos e player dentro do aplicativo.

### Windows x64

- **Umbra-0.1.0-x64-nsis.exe**: instalador com atalho e escolha de pasta, por usuário.
- **Umbra-0.1.0-x64-portable.exe**: executável sem instalação. O perfil continua sendo salvo neste computador; a biblioteca pode ficar em qualquer pasta.
- Electron, FFmpeg, ffprobe e motor torrent estão incluídos. Não precisa de Node.js, Python, mpv ou do SSD do desenvolvedor.
- Baixe o `.exe`, abra o Umbra e selecione sua pasta de vídeos pelo aplicativo.

O player oferece áudio, legendas, volume, velocidade, busca, tela cheia e retomada. MP4 H.264 compatível é reproduzido diretamente. Outros formatos são convertidos durante a sessão, sem modificar o vídeo original, com saída limitada a 1080p. Conversão depende da capacidade do computador; HDR e passthrough de áudio multicanal ainda não foram validados.

Build e testes do aplicativo empacotado executados no Windows pelo GitHub Actions, com mídia sintética. Versão inicial ainda sem assinatura de código: o Windows pode mostrar a identificação de editor desconhecido.

`SHA256SUMS.txt` contém os hashes dos executáveis. `ffmpeg-9.0.2-win64-original.zip` preserva a distribuição original, documentação e licenças do FFmpeg incluído. O código do aplicativo e as receitas de empacotamento estão neste repositório.
