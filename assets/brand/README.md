# Umbra — identidade visual

## Ideia

Um cinema só seu. A escuridão como espaço para as histórias, com a abertura de um projetor como assinatura. Seis lâminas formam um círculo em torno de uma abertura hexagonal transparente. O símbolo não usa letras nem monograma e funciona em uma só cor e em tamanhos pequenos.

- `umbra-logo.svg`: assinatura horizontal, com símbolo e nome. O nome usa a mesma pilha de fontes da interface.
- `umbra-symbol.svg`: desenho vetorial final, transparente, aplicado na interface. Os contornos foram redesenhados para eliminar ruído da geração e garantir leitura em 24 px.
- `umbra-symbol-dark.svg`: versão escura do símbolo para fundos claros.
- `../icon.svg`, `../icon.png` e `../icon.ico`: versão com base escura e uma lâmina verde, para a janela, o aplicativo e o instalador Windows. O ICO inclui tamanhos de 16 a 256 px.
- `umbra-logo-generated.png`: exploração original gerada pela ferramenta integrada de imagens, preservada sem edição e com transparência.
- `identity-preview.html`: prancha local da identidade, com símbolo, assinatura, cores e tipografia.

## Sistema visual

| Uso | Cor |
| --- | --- |
| Fundo / sala escura | `#090B09` |
| Superfície | `#111310` |
| Texto / película | `#EEEADE` |
| Ação / feixe de luz | `#D7F86A` |
| Divisórias | `#2A2F25` |
| Texto secundário | `#A1A59A` |

Inter/Noto Sans para navegação e controles; Liberation Serif para títulos editoriais; Adwaita Mono/Liberation Mono para pequenos rótulos. Fontes locais com fallbacks de sistema, sem chamadas externas. O verde é uma sinalização, não a cor de todos os títulos. Imagens de filmes mantêm suas cores originais.

Fotogramas, cortes diagonais, pequenos números de arquivo e margens generosas repetem a ideia da marca. Bordas discretas e cantos de 3–5 px substituem a aparência de cartões arredondados. A interface respeita redução de movimento, mantém foco visível e não usa a cor como única indicação de estado.

## Geração

Modo: ferramenta integrada `image_gen`, sem CLI ou chave API.

Prompt final usado:

> Use case: logo-brand. Asset type: final replacement logo symbol for Umbra cinema desktop app. Design a compact geometric CINEMA PROJECTOR IRIS emblem: six broad interlocking aperture blades arranged radially into a circular or hexagonal silhouette, forming a clean open hexagon in the center. This must be unmistakably a camera/projector aperture rather than ANY LETTER or monogram. Crisp flat vector style, independent cinema identity, optically balanced and legible at 24px, single solid warm ivory #EEEADE fill. Center one compact symbol occupying 75 percent of a square canvas. Genuinely transparent background and internal gaps. No words, no letters, no U or C shapes, no text, no play button, no mockup, no presentation board, no gradients, no shadows, no textures, no distressed edges. Only the six-blade aperture symbol.
