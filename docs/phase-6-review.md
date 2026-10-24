# Entrega para revisão — fase 6

Data: 24/10/2026. Versão: 0.6.0. Escopo: polimento da arena, com efeitos de impacto, som, acessibilidade e otimização. Nenhuma dependência nova.

## Efeitos de impacto

- O `CombatEngine` passou a emitir eventos de apresentação: contagem, início de round, golpe, preparação do adversário, contato (resultado, posição do punho e vida restante do defensor), fim de round (com indicação de nocaute) e fim de partida.
- A fila de eventos tem no máximo 64 itens e é esvaziada por `MatchRuntime` após cada passo. Regras, IA, dano e tempo não leem os eventos. O teste de partida completa confirma que golpes, acertos, bloqueios, esquivas e rounds batem exatamente com as estatísticas finais.
- Faíscas surgem no ponto calculado do contato, em laranja para acerto e ciano para bloqueio, e seguem a direção do soco. Esquiva e golpe fora de alcance não geram faíscas.
- Um anel expansivo, voltado para a câmera, marca cada contato. No nocaute, faíscas e tremor ficam mais fortes.
- O tremor de câmera é proporcional ao quadrado do "trauma", decai linearmente e fica limitado a 9 cm. É mais forte quando o jogador é atingido na partida com webcam.
- A pausa congela faíscas, anéis e tremor junto com a partida. Voltar à preparação limpa os efeitos.

## Som

- O som é sintetizado no navegador com Web Audio: osciladores e ruído filtrado, passando por um compressor. Não há arquivos de áudio nem downloads.
- Há sons para contagem, início, deslocamento do soco, acerto, bloqueio, esquiva, nocaute, sino de round, vitória, derrota e empate. O robô adversário tem timbre um pouco mais grave.
- O bipe de preparação do adversário toca somente na partida com webcam, porque é um aviso para o jogador. Na demonstração ele seria ruído.
- O `AudioContext` só é criado em um gesto do usuário: iniciar, retomar, revanche ou ligar o som. O áudio é suspenso ao ocultar a página ou sair da arena.
- Até 8 sons podem tocar ao mesmo tempo; os excedentes são descartados. Sem suporte a Web Audio, ou com o navegador bloqueando, o jogo continua em silêncio.

## Acessibilidade

- Uma região `aria-live` educada narra o início de cada round, os contatos com a integridade restante, o fim de round (nocaute, tempo ou empate) e o resultado.
- A contagem segundo a segundo e o aviso visual de impacto deixaram de ser anunciados, para evitar duplicidade. A preparação do adversário continua com o status próprio do HUD.
- Atalhos: **P** pausa ou retoma e **M** liga ou desliga o som. Os botões declaram `aria-keyshortcuts`. Os atalhos são ignorados com modificadores, com tecla mantida pressionada ou com foco em campo, seletor ou controle deslizante.
- Integridade crítica (≤ 25) mostra o texto "CRÍTICO", além da cor, e o medidor informa o valor em texto acessível.
- Com movimento reduzido no sistema, o tremor fica desligado, as faíscas caem pela metade e o painel avisa isso.
- Os novos controles têm rótulos, estado `aria-pressed` ou `role="switch"`, foco visível e alvos de pelo menos 32 px. O layout foi ajustado para 375 px.

## Otimização

- As faíscas usam um único `InstancedMesh` com 64 instâncias pré-alocadas, desenhado em uma chamada. Os anéis são quatro malhas reaproveitadas. As simulações usam arrays tipados, sem alocação por frame.
- Os recursos de efeitos entram no mesmo descarte já existente da arena.
- `QualityAdvisor`: se a mediana de FPS da arena ficar abaixo de 42 por cerca de 3 s na qualidade Equilibrada, o painel sugere a qualidade Leve. A troca nunca é automática, e a sugestão pode ser dispensada.
- A inferência continua na thread principal. A migração para Worker não entrou nesta fase porque exige revisão no navegador real, que segue indisponível para o agente.

## Preferências

Som ligado/desligado, volume, faíscas e tremor ficam no `localStorage`, na chave `steel-sync:feedback:v1`. Valores inválidos voltam ao padrão. Se o armazenamento estiver bloqueado, as preferências valem só para a sessão. Elas não alteram regras nem tracking.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | **379 testes aprovados em 22 arquivos** (30 novos) |
| TypeScript estrito e `npm run build` | Aprovados |
| Eventos de combate | 4 testes: partida completa coerente com as estatísticas, preparação antes de cada soco da IA, lado espelhado, fila limitada e limpa no reset |
| Efeitos | 7 testes: determinismo, direção, gravidade/expiração, capacidade, remoção estável, anéis, tremor limitado e mapeamento acerto/bloqueio/nocaute |
| Áudio | 11 testes com duplo do Web Audio: nada antes do gesto, todos os sons com envelopes válidos, mudo/volume/suspensão, limite de vozes, ausência de API e descarte |
| Narração, qualidade e preferências | 6 testes |
| Ponte de eventos | 2 testes: ordem, entrega única, isolamento de ouvinte com falha e nenhuma emissão em início recusado |
| Regressões das fases 1–5 | 349 testes continuam aprovados |
| Serviço local | Página e módulos novos retornaram HTTP 200 |

Não houve inspeção visual, audição dos sons, leitura do console do navegador nem teste com leitor de tela. Aparência das faíscas, intensidade do tremor, timbre, volume e narração **precisam de revisão real**.

## Arquivos

Modificados:

```text
README.md
package.json
package-lock.json
src/app/App.tsx
src/app/styles/combat.css
src/types/combat.ts
src/engine/combat/combat-engine.ts
src/features/arena/ArenaCanvas.tsx
src/features/combat/CombatHud.tsx
src/features/combat/CombatPanel.tsx
src/features/combat/match-runtime.ts
src/features/combat/match-runtime.test.ts
```

Criados:

```text
docs/phase-6-review.md
src/engine/combat/combat-events.test.ts
src/engine/effects/impact-effects.ts
src/engine/effects/impact-effects.test.ts
src/features/audio/combat-audio.ts
src/features/audio/combat-audio.test.ts
src/features/combat/announcements.ts
src/features/combat/quality-advisor.ts
src/features/combat/feedback.test.ts
src/stores/settings-store.ts
```

## Roteiro de revisão manual

1. Abra a **Arena** e clique **Assistir demonstração**. Confira os bipes da contagem, o som de início e, a cada soco, deslocamento de ar, acerto (grave), bloqueio (metálico) ou esquiva.
2. Observe as faíscas: laranja no acerto, ciano no bloqueio, saindo do ponto de contato. Golpes fora de alcance não devem gerar faíscas. Confirme o anel e o tremor leve.
3. Pause com **P** durante uma rajada: faíscas e tremor devem congelar. Retome com **P**.
4. Pressione **M**, ajuste o volume e desligue faíscas/tremor. Recarregue a página e confira que as preferências permaneceram.
5. Acompanhe um nocaute: impacto mais forte, sino de round e, ao final, fanfarra (ou acorde de empate).
6. Na partida com webcam, confira o bipe duplo quando VULCAN prepara um soco e se ele ajuda a reagir a tempo. Avalie se o tremor ao ser atingido incomoda.
7. Ative movimento reduzido no sistema: o tremor deve sumir, as faíscas devem diminuir e o aviso deve aparecer no painel.
8. Com um leitor de tela (NVDA ou Narrador), confira os anúncios de round, contato, fim de round e resultado, sem repetições excessivas.
9. Em qualidade Equilibrada, se a máquina ficar abaixo de 42 FPS, confira a sugestão de qualidade Leve. Registre os FPS reais com e sem faíscas.
10. Oculte a página durante um som: o áudio deve parar. Saia para o Laboratório: a arena deve silenciar.

## Limitações

- Os efeitos são simples: sem pós-processamento, bloom, câmera lenta, trilha ou locução gravada. Os robôs não piscam no impacto; só o marcador do chão reage.
- Os sons foram validados estruturalmente, não por audição.
- A narração não substitui o controle corporal; ainda não há modo de controle alternativo.
- A inferência síncrona na thread principal continua sendo o principal custo potencial; a migração para Worker fica para uma fase futura.

O trabalho para ao final da fase 6, preparado para revisão antes do commit. A fase 7 exige nova autorização.

Commit sugerido: `feat: add impact effects, procedural audio and accessibility polish`.
