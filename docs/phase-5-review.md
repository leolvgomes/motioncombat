# Entrega para revisão — fase 5

Data: 23/10/2026. Versão: 0.5.0. Escopo: arena e combate local contra IA. Nenhuma dependência nova, branch, commit ou push.

## Partida e integração

- Arena industrial original com ATLAS-01 e VULCAN-07, dois rigs articulados e materiais distintos. Qualidade Leve como padrão, Equilibrada opcional.
- Abas Arena/Laboratório. Somente uma cena 3D é montada; câmera e calibração permanecem montadas ao trocar de visão. Sair da arena pausa uma partida existente, sem encerrá-la.
- Controle corporal usa somente socos reconhecidos após calibração e fonte atual válida. Não há botão/tecla para enviar golpes.
- IA com estados de espera, aproximação, guarda, preparação do soco, ataque, recuo e reação a dano. A preparação é visível antes do ataque; o planejador não lê os pulsos do jogador.
- Dano calculado por contato durante a janela ativa do clip, a partir das mesmas transformações desenhadas. Um golpe resolve no máximo um contato. Guarda reduz o dano; esquiva desloca corpo e volumes; dano causa atordoamento breve.
- Vida de 100 pontos, soco de 12, bloqueio reduzido para 3. O dano efetivamente descontado é limitado à vida restante.
- Contagem inicial de 3 s, até três rounds de 45 s e intervalo de 3 s. Duas vitórias encerram cedo; nocaute ou tempo definem o round. Vida restaura no round seguinte; estatísticas acumulam. Empates de round e partida são possíveis.
- HUD com vida, tempo, rounds vencidos, fonte de controle, aviso de preparação da IA e feedback do contato. Resultado com estatísticas de ataques, acertos sem bloqueio, bloqueios/esquivas bem-sucedidos e dano efetivamente causado (incluindo dano reduzido pela guarda).
- Vitória/derrota entram gradualmente em 350 ms, partindo da pose atual. Após o resultado, somente a finalização visual avança; regras, placar, vida e relógio permanecem congelados.
- Demonstração IA × IA usa o mesmo motor, contato e regras. A fonte é identificada como programada e não fabrica métricas ou landmarks da webcam. Iniciar a demonstração troca a fonte e interrompe a câmera.
- Pausa persistente por comando, perda da fonte, recalibração, espelhamento, página oculta, falha da cena ou saída da visão. Retomar exige ação explícita e, no modo corporal, fonte válida. Gestos na contagem/pausa ou durante outro ataque não ficam enfileirados.

## Arquitetura

`CombatEngine` recebe `CombatInput` e não conhece React, componentes, webcam ou Zustand. O tempo avança em passos fixos de 1/60 s, com acumulação limitada. IA, clips, contato e rounds seguem o mesmo relógio. Os frames de cada lutador são reutilizados.

`CombatHitGeometry` faz cinemática direta das articulações do rig: ombros, segmentos de 0,47/0,43 m e posição do punho. A varredura do punho contra volumes de corpo/cabeça reduz atravessamentos entre amostras. O avanço de ataque é aplicado à posição visual e à geometria no mesmo passo.

`MatchRuntime` é a ponte para poses e gestos reais. Verifica sessão, fonte, calibração, validade e idade da pose antes de permitir uma partida corporal. Publica cópias dos snapshots em cadência reduzida e em mudanças semânticas. Transformações não são mantidas em estado React.

`ArenaCanvas` apenas avança o runtime e aplica os `FighterFrame` aos rigs. A UI envia comandos de partida; não decide contato ou dano. Ajustes experimentais do laboratório não alteram os clips balanceados do combate.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | **349 testes aprovados em 18 arquivos** |
| TypeScript estrito e build de produção (`npm run build`) | Aprovados |
| Regras e atores de combate | 27 testes: contato real, miss, guarda, esquiva, dano limitado à vida, pausa, replay, rounds, empate e finalização |
| IA e geometria | 18 testes: preparação, seeds, reação, segmentos, volumes e FK comparado com hierarquia Three.js real |
| Câmera da arena | 12 testes: proporções estreitas/largas, poses extremas, limites e alinhamento dos lutadores ao HUD |
| Ponte de captura/partida | 13 testes: calibração real dos módulos, fonte atual, eventos antigos, pausa, demonstração, aviso da IA e cópias de snapshots |
| Regressões das fases 1–4 | 279 testes permanecem aprovados |
| Demonstração determinística completa | Testada até o resultado, com ataques e dano reais de ambas as IAs, placar e estatísticas coerentes |
| Independência da taxa de exibição | Mesmo resultado simulado a 15, 30, 60 e 144 FPS; contato preservado no teste do motor a 4 FPS |
| Serviço local | Página e módulos de arena, painel e motor retornaram HTTP 200 |
| Revisão estática independente | Geometria alinhada ao rig, câmera alinhada ao HUD e lifecycle revisados |
| `git diff --check` | Aprovado |

As taxas acima são entradas controladas de testes, não benchmarks reais da webcam/GPU. O teste a 4 FPS exercita diretamente o motor com passos acumulados; o renderizador limita o intervalo de um frame a 100 ms para evitar saltos após travamentos. Respostas HTTP confirmam serviço/transformação de módulos, não renderização ou ausência de erros no console do navegador.

Não houve inspeção visual automática, leitura do console do navegador ou medição de FPS com webcam nesta entrega. A permissão salva/política da ferramenta de navegador bloqueou a origem local anteriormente. A validação visual e a resposta corporal continuam pendentes de revisão real; não foram substituídas por dados artificiais.

## Arquivos

Modificados:

```text
README.md
package.json
package-lock.json
src/app/App.tsx
src/app/styles.css
src/features/motion-tracking/combat-motion-runtime.ts
src/features/robot/RobotModel.tsx
src/features/robot/robot-resources.ts
```

Criados:

```text
docs/phase-5-review.md
src/app/styles/combat.css
src/types/combat.ts
src/stores/match-store.ts
src/engine/combat/config.ts
src/engine/combat/ai.ts
src/engine/combat/ai.test.ts
src/engine/combat/collision.ts
src/engine/combat/collision.test.ts
src/engine/combat/fighter.ts
src/engine/combat/combat-engine.ts
src/engine/combat/combat-engine.test.ts
src/features/arena/ArenaCanvas.tsx
src/features/arena/arena-camera.ts
src/features/arena/arena-camera.test.ts
src/features/combat/CombatHud.tsx
src/features/combat/CombatPanel.tsx
src/features/combat/match-runtime.ts
src/features/combat/match-runtime.test.ts
```

## Executar

Recarregue o servidor existente em `http://127.0.0.1:5173/`. Para iniciar localmente:

```sh
npm ci
npm run setup:tracking
npm run dev
```

A preparação de tracking continua igual à fase 1. Não é necessário reinstalar dependências ou baixar outro modelo para esta fase em um ambiente já configurado.

```sh
npm run typecheck
npm test
npm run build
```

## Roteiro de revisão manual

1. Abra **Arena**, sem iniciar a webcam. Selecione **Assistir demonstração**. Confira a identificação IA × IA, a contagem e os dois robôs com materiais distintos.
2. Observe aproximação, preparação, socos, recuo e guarda. Vida deve mudar somente em contato válido; golpes fora de alcance não devem causar dano. O marcador visual e a mensagem indicam o resultado do ataque.
3. Pause durante um ataque e aguarde: pose, relógio e vida devem permanecer parados. Retome. Abra Laboratório e volte: a partida deve continuar pausada até **Retomar**.
4. Observe um round até nocaute/tempo e o intervalo. No round seguinte, a vida deve restaurar e o placar permanecer. Ao final, confira vitória/derrota/empate e estatísticas; execute outra demonstração e volte ao início.
5. Inicie a câmera e calibre postura neutra/guarda. **Iniciar combate** permanece indisponível antes de haver fonte calibrada e atual. Sem fonte válida, a arena deve continuar acessível para demonstração.
6. Inicie uma partida corporal. Faça socos retos, voltando à guarda entre golpes. Mova o braço oposto durante o ataque e confirme acompanhamento. Segurar um punho estendido não deve repetir ataques.
7. Mantenha guarda durante uma preparação do adversário e compare o dano reduzido. Incline lateralmente para esquivar. O resultado depende do momento e da geometria, não apenas do nome do gesto.
8. Saia do quadro, recalibre, desligue a câmera ou troque o espelho. A partida deve pausar imediatamente e exigir recuperação e **Retomar**. Golpes antigos não podem disparar ao voltar.
9. Oculte a página. A câmera deve parar; ao voltar, reinicie e calibre antes de retomar uma partida corporal. A demonstração também permanece pausada.
10. Confira janela estreita, teclado, foco, fallback de WebGL, qualidade Leve/Equilibrada e console. Registre FPS reais da arena e inferências para orientar a otimização da fase 6.

## Limitações

- Profundidade monocular, oclusão e heurísticas de gesto continuam sujeitos a falhas. Um falso positivo válido para o reconhecedor pode iniciar um ataque; a animação não recupera informação ausente da câmera.
- Volumes de corpo/cabeça e punhos aproximam a silhueta. Não há física entre peças, IK para alcançar um alvo ou movimentação livre pela arena.
- Somente socos retos, guarda e esquiva. Sem hook, uppercut, especial, combos, multiplayer, persistência ou rankings.
- IA e balanceamento são iniciais. A aproximação é automática; a partida não requer gestos de caminhada. Testes determinísticos não medem dificuldade percebida ou latência real.
- Tracking permanece síncrono na thread principal. Não há Worker novo nem promessa de 60 FPS. Reduza para 480p/qualidade Leve se necessário.
- Impactos avançados, partículas, som e polimento cinematográfico ficam para a fase 6.

O trabalho para ao final da fase 5, preparado para revisão antes do commit. A fase 6 exige nova autorização.

Commit sugerido: `feat: add motion-controlled arena combat and rounds`.
