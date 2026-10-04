Downloads corrigidos no Windows e nova identidade visual do Umbra.

- Corrigido o erro `ENOENT: no such file or directory, mkdir` ao baixar um filme ou temporada em uma pasta sem as subpastas Filmes/Series. Caminhos relativos usam o mesmo separador no Linux e no Windows, e as pastas são criadas uma a uma antes da transferência.
- Downloads que ficaram com erro podem ser retomados em **Downloads → Retomar** depois da atualização, com a biblioteca de destino conectada.
- Nova logo de abertura de projetor, sem letras, aplicada na interface, nos ícones da janela, no instalador e no executável portátil.
- README com captura real do Explorar e pôsteres de filmes do Cinemeta.
- Mantidos player integrado, tela cheia, áudio, retomada e personalização das legendas.

### Windows x64

- **Umbra-0.1.2-x64-nsis.exe**: instalador com atalho e escolha de pasta.
- **Umbra-0.1.2-x64-portable.exe**: executável sem instalação.
- Electron, FFmpeg, ffprobe e motor torrent incluídos. Não precisa de Node.js, Python, mpv ou de um SSD específico.

- O perfil e a biblioteca existentes são preservados na atualização.

A publicação exige aprovação dos testes Linux e do aplicativo Windows empacotado. Eles verificam reprodução MP4/MKV, áudio, legendas, controles e tela cheia, retomada, exclusão e downloads HTTP de filme e temporada em uma pasta vazia, com importação automática e persistência da fila. O worker torrent incluído verifica disponibilidade e publicação sem sobrescrever arquivos.

A versão continua sem assinatura de código. `SHA256SUMS.txt` contém os hashes dos executáveis.
