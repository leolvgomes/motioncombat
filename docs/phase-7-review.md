# Entrega para revisão — fase 7

Data: 25/11/2026. Versão: 0.7.0. Escopo: expansões que funcionam inteiramente no navegador. Nenhuma dependência nova.

O multiplayer online ficou de fora. Ele exige um servidor, e o briefing veta backend nesta versão. O ranking é local pelo mesmo motivo.

## Golpes e combos

| Golpe | Dano | Bloqueado | Duração | Como fazer |
| --- | --- | --- | --- | --- |
| Soco reto | 12 | 3 | 0,55 s | Estender o punho à frente (sem mudanças nesta fase) |
| Gancho | 15 | 4 | 0,68 s | Abrir o punho além do ombro e cruzar até o centro |
| Uppercut | 18 | 4 | 0,78 s | Descer o punho abaixo dos ombros e subir |

- Gancho e uppercut pedem cotovelo dobrado, movimento rápido e a outra mão parada e erguida. Erguer as duas mãos para a guarda ou fechar os dois braços não conta.
- A regra do soco reto não mudou. Com **Ganchos e uppercuts** desligado, o reconhecimento é o mesmo do commit anterior.
- Combos: Um-dois (+3), Ascensão (+4), Portão duplo (+4), Martelo triplo (+6), Tempestade de aço (+8) e Sincronia total (+10). Até 1,5 s entre acertos, sem bloqueio. Um combo pode evoluir para outro maior, mas não se repete por sobreposição.
- A IA usa os três golpes, sempre com aviso do mesmo tipo e lado. Golpes pesados têm aviso mais longo. Ela pode encadear até dois ataques, com pelo menos 0,5 s de aviso, e tende a se proteger após dois contatos seguidos.

## Personalização e cenários

- Garagem: nome de até 12 caracteres, seis blindagens, seis luzes, três cabeças e três ombreiras, com prévia 3D. Só aparência; a aparência padrão é idêntica à anterior.
- Cenários: Fundição (o original), Porto noturno e Cânion. Ringue, câmera e regras são os mesmos.

## Carreira e ranking

- Guarda até 200 partidas com webcam: estatísticas, sequências de vitórias, precisão, defesa, combos e dano.
- Pontuação: vitória 250 (empate 80), 60 por round vencido, dano causado, 5 por acerto, 8 por bloqueio, 14 por esquiva, 20 por combo e 5 por acerto da maior sequência, menos metade do dano recebido.
- O ranking mostra as 10 melhores. Apagar o histórico pede confirmação.

## Replays

- Gravam as rotações dos robôs a 24 Hz. Não guardam imagem da câmera nem pontos do corpo.
- Pausa, linha do tempo, velocidade de 0,25× a 2×, sons, faíscas e narração. Saltos não repetem eventos intermediários.
- Três replays salvos, com cerca de 340 mil caracteres para uma partida de 71 s. Demonstrações saem primeiro. Sem espaço no navegador, o replay vale só para a sessão, com aviso.
- Uma partida em andamento ou pausada nunca é interrompida por um replay.

## Correção

O texto alternativo do canvas da arena era montado mesmo com WebGL disponível e suspendia a cena a cada abertura. Um replay aberto pela Carreira começaria pausado. Agora ele não tem efeito colateral.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | **475 testes aprovados em 26 arquivos** (94 novos) |
| TypeScript estrito e `npm run build` | Aprovados |
| Combos e clips | Sequências, janela, continuidade das poses, alcance a distância de luta e esquiva dos três golpes nos dois lados |
| Gestos | Cada golpe uma única vez em intervalos de 33 a 60 ms; casos de falso positivo; soco reto sem ativação extra |
| Replay | Partida completa comparada com a simulação, eventos únicos e em ordem, formato salvo, dados corrompidos e armazenamento cheio |
| Carreira e perfil | Pontuação, ranking, resumo, validação de dados salvos e armazenamento bloqueado |
| Chrome, dados de teste | Demonstração completa, três cenários, garagem, carreira, replay pela arena e pela Carreira, laboratório e largura de 375 px sem rolagem horizontal |
| FPS no Chrome, qualidade Leve, sem câmera | Commit anterior: 73–124. Fase 7: Fundição 90–125, Porto 79–117, Cânion 101–122 |

Cinco testes antigos tiveram os dados ajustados ao novo campo de tipo de golpe; nenhuma verificação foi removida.

**Pendente de revisão real:** ganchos e uppercuts com webcam, balanceamento dos combos, som do combo (não ouvido) e leitor de tela. A medida de FPS não inclui a câmera ligada.

## Roteiro de revisão manual

1. Calibre e, no painel **Do movimento ao gesto**, faça dez socos retos, dez ganchos e dez uppercuts de cada lado. Anote trocas entre golpes.
2. Baixe e levante as mãos, ajuste a guarda, coce o rosto e incline o tronco. Nenhum golpe deveria sair. Se sair, desligue **Ganchos e uppercuts** e compare.
3. Na arena, tente **Um-dois** e depois **Martelo triplo**. Confira o aviso, o som e o bônus de dano.
4. Observe se o aviso da IA (soco, gancho, uppercut) dá tempo de defender.
5. Na **Garagem**, troque nome e aparência, recarregue a página e confira que ficaram salvos.
6. Lute uma partida em cada cenário. Verifique se o HUD continua legível e se o FPS se mantém com a câmera ligada.
7. Termine uma partida com webcam: confira os pontos, a **Carreira** e o replay, incluindo pausa, salto e velocidades.
8. Com uma partida pausada, abra **Carreira**: o botão **Assistir** deve ficar desabilitado.

## Limitações

- Os limiares de gancho e uppercut são iniciais e foram validados com dados sintéticos. A classificação usa só a imagem 2D; um soco muito cruzado ou um alcance rápido pode ser confundido.
- Não há golpe especial, fila de golpes, exportação de replay ou câmera livre no replay.
- Carreira e replays são apagados junto com os dados do site.
- A IA da demonstração continua usando a mesma semente, então a luta demonstrativa se repete.

O trabalho para ao final da fase 7, preparado para revisão antes do commit.

Commit sugerido: `feat: add advanced combos, robot customization, arenas, career and replays`.
