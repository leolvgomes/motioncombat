# Entrega para revisão — fase 8

Data: 25/11/2026. Versão: 0.8.0. Escopo: desempenho e precisão. Nenhuma dependência nova.

A parte de código está pronta. **O ajuste dos limiares com movimentos reais ainda não foi feito**, porque depende da sua aferição com webcam.

## O que foi medido

Chrome nesta máquina, build de produção, arena aberta e qualidade Leve. A câmera foi substituída por um vídeo de 1280 × 720 com uma pessoa desenhada; os números com sua webcam podem ser diferentes.

| Modo | Cena 3D | Rastreamento | Atraso da pose | Pior engasgo |
| --- | --- | --- | --- | --- |
| Segundo plano (Worker) | 23 FPS (20–24) | 15 Hz (8–20) | 70 ms (51–111) | 29 ms |
| Na página | 20 FPS (15–25) | 18 Hz (14–21) | 47 ms (35–58) | 58 ms |

- O Chrome está usando a **Intel UHD**, não a placa dedicada.
- Sem cena nem outra carga, a inferência leva cerca de 46 ms em GPU no Worker, 40 ms em GPU na página e 110 ms em CPU.
- Com a câmera ligada e a cena parada, o rastreamento no Worker sobe para 23 Hz: cena e inferência disputam a mesma GPU.
- Reduzir resolução, remover os robôs ou desligar o antialias trouxe pouco ganho. Dosar os quadros foi o que mais ajudou.

## Desempenho

- Inferência em Worker com quadros de até 640 px, um por vez, com tempo limite. Se o Worker não iniciar, a página assume.
- **Execução do rastreamento**: Automática (Worker só fora de GPU integrada ou por software), Na página ou Segundo plano.
- O modelo roda sobre uma figura desenhada durante o carregamento. Antes, a primeira detecção no Worker chegou a 6,5 s.
- A cena tem limite de quadros: um monitor de 144 Hz passou de cerca de 140 para 70 FPS, e 60 Hz não muda.
- No Worker, a cena cede quadros em degraus quando o atraso passa de 58 ms e os recupera abaixo de 38 ms, sem oscilar.
- O esqueleto só é redesenhado quando há uma pose nova.
- O diagnóstico ganhou atraso da pose, pior engasgo, GPU em uso e **Medir por 15 s**.

## Precisão

- Filtro adaptativo: no soco sintético a 20 Hz, o reconhecimento veio 50 ms antes (450 contra 500 ms após o aviso). Uma detecção isolada fora do lugar tem exatamente o filtro anterior.
- A calibração aceita até 250 ms entre amostras, antes 150 ms. O intervalo máximo medido foi 148 ms, então uma máquina lenta reiniciava a contagem sem explicação.
- Aferição guiada: 3 ou 5 repetições de cada golpe, esquivas e movimentos comuns, com avisos grandes e sonoros. Mostra acertos, perdidos, confusões, golpes extras e indevidos.
- A gravação guarda nove pontos do corpo e seis pontos 3D dos braços por quadro, sem imagem, na memória. Só sai da página pelo botão de baixar. São cerca de 500 KB para 106 s a 20 Hz.
- `npm run evaluate:trials -- arquivo.json` compara, sobre os mesmos movimentos: ao vivo, atual, filtro fixo, proporção corrigida, só socos retos e metade dos quadros.

## Achado que depende dos seus dados

As medidas do corpo usam x e y normalizados sem corrigir a proporção do vídeo. Em 16:9, tudo na vertical fica esticado em 1,78×. Os limiares que você aprovou foram ajustados nessa métrica, então corrigi-la agora poderia piorar o que funciona. A variante **Proporção corrigida** mede o efeito antes de decidir.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | **532 testes aprovados em 30 arquivos** (57 novos) |
| TypeScript estrito e `npm run build` | Aprovados |
| Worker | Início, falha, travamento, tempo limite, quadro atrasado, encerramento e um quadro por vez |
| Sessão | Câmera de 30 FPS, pose após encerrar, falha do Worker e pior engasgo |
| Chrome, produção e desenvolvimento | Worker e página detectando a figura; seleção automática correta; aferição completa com golpes simulados; relatório |
| Avaliação offline | Executada sobre uma gravação sintética e um arquivo inválido |

**Não verificado:** webcam real, GPU dedicada, aviso sonoro da aferição (não ouvido) e o download do arquivo pelo navegador.

## Roteiro de revisão manual

1. **Troque a GPU do navegador, se puder:** Configurações do Windows → Sistema → Tela → Elementos gráficos → seu navegador → Alto desempenho. Reinicie o navegador e confira **GPU em uso** em **Desempenho**.
2. Com a câmera ligada, use **Medir por 15 s** na arena e no laboratório. Repita em **Na página** e **Segundo plano**.
3. Calibre e faça a **Aferição guiada · Completa**. Anote movimentos que pareceram certos, mas foram recusados.
4. Baixe os dados e coloque o arquivo em `.qa/` na raiz do projeto (a pasta já é ignorada pelo Git).
5. Lute uma partida e compare a resposta do soco com a versão anterior.
6. Desligue a câmera durante uma aferição e durante uma medição: ambas devem parar com explicação.

## Limitações

- Os limiares de ganchos e uppercuts continuam os iniciais.
- O modo automático decide pela identificação da GPU; se o navegador a esconder, usa o Worker.
- O tempo de reconhecimento da aferição inclui a reação da pessoa.

Commit sugerido: `feat: add background tracking, frame pacing and guided gesture trials`.
