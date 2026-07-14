#!/usr/bin/env node
// Guard mecânico (Sessão C5): CLAUDE.md é carregado inteiro em toda sessão do
// Claude Code — falha o build se ele voltar a crescer sem controle. Contrato
// completo (poda/spillover antes de estourar): docs/claude/Manutencao-CLAUDE-md.md

const fs = require('fs');
const path = require('path');

const MAX_LINES = 450;
const filePath = path.join(__dirname, '..', 'CLAUDE.md');

const content = fs.readFileSync(filePath, 'utf8');
const lineCount = content.split('\n').length;

if (lineCount > MAX_LINES) {
  console.error(
    `CLAUDE.md tem ${lineCount} linhas (limite: ${MAX_LINES}).\n` +
      'Antes de adicionar mais conteúdo: pode uma seção que virou "detalhe" ' +
      'para docs/claude/ ou docs/wiki/ e deixe só o ponteiro. Contrato completo: ' +
      'docs/claude/Manutencao-CLAUDE-md.md'
  );
  process.exit(1);
}

console.log(`CLAUDE.md: ${lineCount}/${MAX_LINES} linhas.`);
