# Entrega para revisão — fase 9

Data: 26/11/2026. Versão: 0.9.0. Escopo: impacto visual. Nenhuma dependência nova: o bloom usa os módulos de pós-processamento que já vêm com o Three.

## O que entrou

- **Desgaste visível:** as placas escurecem e perdem o brilho conforme a vida cai. Abaixo de 50% sai fumaça da cabeça; abaixo de 30% o ombro solta faíscas e, no crítico, as luzes falham.
- **Reação por golpe:** o soco reto joga a cabeça para trás, o cruzado a gira para o lado oposto ao punho e o uppercut levanta o queixo.
- **Nocaute:** o robô cai de costas, para longe do adversário. No golpe final a cena fica a 25% da velocidade por cerca de 1 s, a câmera se aproxima do robô caído e depois volta. O aviso de fim de round espera 1,5 s para não cobrir a queda.
- **Sobrecarga (golpe especial):** cada robô tem um medidor abaixo da vida. Ele enche com o dano causado (mais no acerto limpo do que no bloqueio) e com o dano recebido, e passa de um round para o outro. Com o medidor cheio, **soque com as duas mãos ao mesmo tempo** (até 0,22 s entre elas): o golpe vira Sobrecarga, com 28 de dano limpo ou 10 bloqueado, punhos brilhando, clarão no impacto, som próprio e aviso na tela. A IA usa a dela no ataque seguinte.
- **Brilho cinematográfico (bloom):** opção desligada por padrão, só na qualidade Equilibrada.
- **Novas opções** em Som e efeitos: Câmera lenta no nocaute (ligada) e Brilho cinematográfico (desligado).
- Replays mostram o desgaste, a queda e o brilho do especial. Replays antigos continuam abrindo.

Nada disso altera o resultado de uma luta além da Sobrecarga: a câmera lenta só começa depois que o round está decidido.

## Correções no caminho

- Quando os dois punhos completavam o soco no mesmo quadro, o reconhecimento emitia só um. Agora o segundo sai no quadro seguinte, o que o soco duplo exige.
- O teste de fidelidade do replay passou a ignorar o quadro logo após a troca de round. O replay grava a 24 quadros por segundo, então pode mostrar até 1/24 s do round anterior; isso já acontecia, e os rounds mais curtos expuseram.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | **552 testes aprovados** (16 novos nesta fase) |
| TypeScript estrito e `npm run build` | Aprovados |
| Chrome, build de produção, demonstração IA × IA | Medidores, aviso de Sobrecarga (um especial de cada lado em 25 s), fumaça, desgaste, queda, aproximação da câmera e bloom vistos na tela, sem erros no console |
| FPS sem câmera, qualidade Equilibrada | 65 sem bloom, 57 com bloom |

**Não verificado:** o soco duplo com webcam real, os sons novos (não ouvidos) e o custo do bloom com a câmera ligada.

## Atenção: movimento reduzido no seu Windows

Nesta máquina, o Windows está com **efeitos de animação desligados**. O jogo respeita isso: tremor de câmera e câmera lenta ficam desligados, a queda é instantânea e as faíscas diminuem. Para ver a fase 9 completa, ative em Configurações → Acessibilidade → Efeitos visuais → **Efeitos de animação**, ou peça um ajuste no jogo para ignorar essa preferência.

## Roteiro de revisão manual

1. Assista a uma demonstração e observe fumaça, faíscas, luzes falhando e o aviso SOBRECARGA.
2. Lute com a webcam até encher o medidor ("Sobrecarga pronta" aparece embaixo do placar) e soque com as duas mãos juntas.
3. Nocauteie e confira a queda, a câmera lenta e a aproximação.
4. Ligue o Brilho cinematográfico e compare o FPS da arena com a câmera ligada.
5. Abra o replay da luta e confira desgaste, queda e especial.

## Limitações

- O soco duplo depende de os dois socos serem reconhecidos. Se um falhar, sai um soco comum, e o medidor continua cheio.
- Com o especial, os rounds da demonstração acabam mais cedo (cerca de 25 s); o equilíbrio pode precisar de ajuste depois das suas lutas.
- O cabeçalho dos painéis continua mostrando a fase em que cada um foi criado.

Commit sugerido: `feat: add battle damage, knockout cinematics and overdrive special`.
