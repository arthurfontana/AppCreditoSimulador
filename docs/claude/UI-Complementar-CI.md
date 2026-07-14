# UI Complementar e CI/CD

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> widget de negócio, no `BuildBadge`, nos workflows de CI ou no suporte a touch.

## Widget de Impacto de Negócio

- Componente flutuante arrastável (`businessWidget`)
- Exibe comparativo baseline AS IS vs. política simulada em formato de painel executivo
- Estado: `{visible: boolean, x, y, w, h}`
- Ativado via botão no painel lateral

## Indicador de Versão/Build (`BuildBadge`)

### Localização
Header do painel direito — ao lado do título "Painel".

### Constantes injetadas pelo Vite (`vite.config.js`)
| Constante | Fonte | Exemplo |
|---|---|---|
| `__BUILD_NUMBER__` | `git rev-list --count HEAD` | `"48"` |
| `__BUILD_TIME__` | `new Date().toISOString()` no momento do build | `"2026-05-11T12:07:37Z"` |
| `__BUILD_HASH__` | `git rev-parse --short HEAD` | `"5f5124f"` |
| `__BUILD_BRANCH__` | `git rev-parse --abbrev-ref HEAD` | `"main"` |
| `__BUILD_AUTHOR__` | `git log -1 --format="%an"` | `"arthurfontana"` |

- Em `dev` (`vite`), as constantes não são definidas — o componente usa `"dev"` e `new Date()` como fallback.
- O número incrementa automaticamente a cada novo commit + build, sem manutenção manual.

### Comportamento visual
- Badge cinza padrão: `#48 · 11/05 12:07`
- Badge verde quando build < 5 min (sinaliza deploy recente)
- Tooltip hover: número, data/hora completa, hash, branch, autor

## CI/CD

### `build-release.yml`
- Disparado em push para `main`
- Executa `npm ci` + `npm run build`
- Copia `dist/` → `release/` (preservando os artefatos de distribuição local que não vêm do
  build do Vite: `iniciar.bat`, `serve.py`, `sidecar.py` e toda a pasta `release/python/`)
- Passo de **wheels offline** do Motor Python documentado e **desativado** (contingência P1 —
  ativar só se outra máquina reportar falha real de instalação pelo índice)
- Commita com `[skip ci]` para evitar loop

### `test-sidecar.yml`
- Job **separado e opcional** (não bloqueia o build): `pytest tests_python/` sobre o
  `release/sidecar.py`. Dispara em `workflow_dispatch` e em push/PR que toquem os arquivos do
  sidecar, o motor de segmentos ou as fixtures douradas. Instala numpy (H7): o GATE
  cross-runtime da Descoberta profunda (DEC-HX-005) precisa rodar de verdade — os testes de
  tier continuam manipulando o estado do warm-up (independem dos pacotes reais).

### `sync-wiki.yml`
- Disparado em push para `main` quando `docs/wiki/**` muda
- Clona o repositório do GitHub Wiki
- Copia `docs/wiki/` para o Wiki e faz push

### Release local
A pasta `release/` contém o build compilado. O usuário pode abrir `release/index.html` diretamente no navegador ou usar `release/iniciar.bat` no Windows — sem servidor necessário.

## Suporte a Touch / Mobile

- Pan e zoom com gesto de pinch (dois dedos) via `touchstart`/`touchmove`
- Drag de shapes com um dedo em modo `hand`
- Seleção por rubber-band (retângulo) via touch em modo `select`
- Drag de variáveis do painel lateral via touch (`startPanelDrag`)
- Clique em células do Cineminha via touch
