const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { v4: uuid } = require('uuid');
const { load, save } = require('./db');
const { parseCronograma } = require('./cronogramaParser');

const app = express();
const PORT = process.env.PORT || 4000;
const upload = multer({ dest: path.join(__dirname, 'uploads') });
const RENDER_DIR = path.join(__dirname, 'uploads', 'render');
fs.mkdirSync(RENDER_DIR, { recursive: true });

// Garante uma versão PNG rasterizada de uma revisão (PDF vira imagem; imagem já é usada como está)
// — a Central de Projetos precisa de raster para desenhar as caixas de sugestão por cima.
function renderizarParaPng(revisao) {
  return new Promise((resolve, reject) => {
    if (revisao.tipoArquivo !== 'pdf') {
      resolve(path.join(__dirname, 'uploads', path.basename(revisao.arquivoUrl)));
      return;
    }
    const pdfPath = path.join(__dirname, 'uploads', path.basename(revisao.arquivoUrl));
    const outPrefix = path.join(RENDER_DIR, revisao.id);
    const outPath = outPrefix + '.png';
    if (fs.existsSync(outPath)) { resolve(outPath); return; }
    execFile('pdftoppm', ['-r', '150', '-png', '-singlefile', pdfPath, outPrefix], (err) => {
      if (err) { reject(err); return; }
      resolve(outPath);
    });
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function getObra(db, obraId) {
  return db.obras.find((o) => o.id === obraId);
}

// ---------- OBRAS ----------
app.get('/api/obras', (req, res) => {
  const db = load();
  res.json(db.obras);
});

app.post('/api/obras', (req, res) => {
  const db = load();
  const obra = { id: 'obra-' + uuid().slice(0, 8), nome: req.body.nome || 'Nova obra', tipo: req.body.tipo || '', criadaEm: new Date().toISOString() };
  db.obras.push(obra);
  save(db);
  res.json(obra);
});

// ---------- CRONOGRAMA ----------
app.get('/api/obras/:obraId/cronograma', (req, res) => {
  const db = load();
  const c = db.cronogramas[req.params.obraId];
  if (!c || c.revisoes.length === 0) return res.json({ revisoes: [], atual: null });
  res.json({ revisoes: c.revisoes.map((r) => ({ id: r.id, criadaEm: r.criadaEm, origem: r.origem, nTarefas: r.tarefas.length })), atual: c.revisoes[c.revisoes.length - 1] });
});

app.post('/api/obras/:obraId/cronograma/importar', upload.single('arquivo'), (req, res) => {
  try {
    const db = load();
    const { obraId } = req.params;
    if (!getObra(db, obraId)) return res.status(404).json({ erro: 'Obra não encontrada' });
    const buffer = fs.readFileSync(req.file.path);
    const { origem, tarefas } = parseCronograma(buffer, req.file.originalname);
    if (tarefas.length === 0) return res.status(400).json({ erro: 'Nenhuma tarefa foi reconhecida no arquivo. Confira o formato/colunas.' });

    if (!db.cronogramas[obraId]) db.cronogramas[obraId] = { revisoes: [] };
    const revisao = {
      id: 'rev-' + uuid().slice(0, 8),
      criadaEm: new Date().toISOString(),
      origem: `Importação (${origem}) — ${req.file.originalname}`,
      tarefas: tarefas.map((t) => ({ ...t, baselineInicio: t.inicio, baselineTermino: t.termino }))
    };
    db.cronogramas[obraId].revisoes.push(revisao);
    save(db);
    fs.unlink(req.file.path, () => {});
    res.json({ ok: true, revisao });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// Replanejamento: edita datas de uma tarefa na revisão atual, guardando snapshot da revisão anterior.
app.put('/api/obras/:obraId/cronograma/tarefas/:tarefaId', (req, res) => {
  const db = load();
  const { obraId, tarefaId } = req.params;
  const c = db.cronogramas[obraId];
  if (!c || c.revisoes.length === 0) return res.status(404).json({ erro: 'Sem cronograma importado para esta obra' });

  const atual = c.revisoes[c.revisoes.length - 1];
  const novaRevisao = JSON.parse(JSON.stringify(atual));
  novaRevisao.id = 'rev-' + uuid().slice(0, 8);
  novaRevisao.criadaEm = new Date().toISOString();
  novaRevisao.origem = req.body.motivo ? `Replanejamento — ${req.body.motivo}` : 'Replanejamento manual';

  const tarefa = novaRevisao.tarefas.find((t) => t.id === tarefaId);
  if (!tarefa) return res.status(404).json({ erro: 'Tarefa não encontrada' });
  if (req.body.inicio) tarefa.inicio = req.body.inicio;
  if (req.body.termino) tarefa.termino = req.body.termino;
  tarefa.mudancaDeProjeto = !!req.body.mudancaDeProjeto;

  c.revisoes.push(novaRevisao);
  save(db);

  // Gatilho: mudança de projeto cria automaticamente um alerta de compatibilização/revalidação
  if (req.body.mudancaDeProjeto) {
    if (!db.incompatibilidades[obraId]) db.incompatibilidades[obraId] = [];
    db.incompatibilidades[obraId].push({
      id: 'inc-' + uuid().slice(0, 8),
      titulo: `Revisar compatibilização — mudança em "${tarefa.tarefa}"`,
      disciplinas: [],
      descricao: `Gerado automaticamente: a tarefa "${tarefa.tarefa}" foi alterada e precisa de revisão de compatibilização e de pedidos de compra vinculados.`,
      severidade: 'a definir',
      tipo: 'documentos',
      status: 'aberto',
      criadaEm: new Date().toISOString(),
      origemAutomatica: true
    });
    save(db);
  }

  res.json({ ok: true, revisao: novaRevisao });
});

// ---------- COMPATIBILIZAÇÃO ----------
app.get('/api/obras/:obraId/checklist-padrao', (req, res) => {
  res.json(load().checklistPadrao);
});

app.get('/api/obras/:obraId/disciplinas', (req, res) => {
  const db = load();
  res.json(db.disciplinas[req.params.obraId] || []);
});

// Cria uma disciplina nova, já com sua primeira revisão (R00) se um arquivo foi enviado.
app.post('/api/obras/:obraId/disciplinas', upload.single('arquivo'), (req, res) => {
  const db = load();
  const { obraId } = req.params;
  if (!db.disciplinas[obraId]) db.disciplinas[obraId] = [];
  const item = {
    id: 'disc-' + uuid().slice(0, 8),
    nome: req.body.nome || 'Disciplina',
    revisoes: req.file ? [{
      id: 'rev-' + uuid().slice(0, 8),
      codigo: 'R00',
      arquivoNome: req.file.originalname,
      arquivoUrl: `/uploads/${req.file.filename}`,
      tipoArquivo: req.file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'imagem',
      criadaEm: new Date().toISOString(),
      notasDeMudanca: req.body.notasDeMudanca || 'Versão inicial'
    }] : []
  };
  db.disciplinas[obraId].push(item);
  save(db);
  res.json(item);
});

// Central de projetos (P0): sobe uma NOVA revisão de uma disciplina já existente.
// Nunca sobrescreve a anterior — o código (R00, R01, R02...) avança sozinho.
app.post('/api/obras/:obraId/disciplinas/:discId/revisoes', upload.single('arquivo'), (req, res) => {
  const db = load();
  const { obraId, discId } = req.params;
  const disciplina = (db.disciplinas[obraId] || []).find((d) => d.id === discId);
  if (!disciplina) return res.status(404).json({ erro: 'Disciplina não encontrada' });
  if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo para a nova revisão' });

  const proximoNumero = disciplina.revisoes.length; // R00 é a primeira, próxima é o tamanho atual
  const revisao = {
    id: 'rev-' + uuid().slice(0, 8),
    codigo: 'R' + String(proximoNumero).padStart(2, '0'),
    arquivoNome: req.file.originalname,
    arquivoUrl: `/uploads/${req.file.filename}`,
    tipoArquivo: req.file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'imagem',
    criadaEm: new Date().toISOString(),
    notasDeMudanca: req.body.notasDeMudanca || ''
  };
  disciplina.revisoes.push(revisao);
  save(db);
  res.json({ ok: true, disciplina, revisao });
});

// ---------- ELEMENTOS MARCADOS (comparação de revisões — "o que mudou") ----------
app.get('/api/obras/:obraId/elementos', (req, res) => {
  const db = load();
  let itens = db.elementos[req.params.obraId] || [];
  if (req.query.disciplinaId) itens = itens.filter((e) => e.disciplinaId === req.query.disciplinaId);
  res.json(itens);
});

app.post('/api/obras/:obraId/elementos', (req, res) => {
  const db = load();
  const { obraId } = req.params;
  if (!db.elementos[obraId]) db.elementos[obraId] = [];
  const item = {
    id: 'el-' + uuid().slice(0, 8),
    disciplinaId: req.body.disciplinaId,
    revisaoId: req.body.revisaoId,
    pagina: Number(req.body.pagina) || 1,
    xPct: req.body.xPct != null ? Number(req.body.xPct) : null,
    yPct: req.body.yPct != null ? Number(req.body.yPct) : null,
    wPct: req.body.wPct != null ? Number(req.body.wPct) : null,
    hPct: req.body.hPct != null ? Number(req.body.hPct) : null,
    // origem: 'manual' (clique do engenheiro) ou 'auto' (sugestão do detector, História 2.3) —
    // em ambos os casos só existe aqui porque o engenheiro confirmou (regra: IA nunca grava sem confirmação humana).
    origem: req.body.origem === 'auto' ? 'auto' : 'manual',
    confianca: req.body.confianca != null ? Number(req.body.confianca) : null,
    descricao: req.body.descricao || '',
    criadoEm: new Date().toISOString()
  };
  db.elementos[obraId].push(item);
  save(db);
  res.json(item);
});

// Central de projetos (P0 revisado — História 2.1/2.3): detecção automática de mudanças
// entre duas revisões da mesma disciplina. Devolve só CANDIDATOS — nada aqui vira
// Incompatibilidade sem o engenheiro confirmar (POST /elementos, como no fluxo manual).
app.post('/api/obras/:obraId/disciplinas/:discId/detectar-mudancas', async (req, res) => {
  const db = load();
  const { obraId, discId } = req.params;
  const disciplina = (db.disciplinas[obraId] || []).find((d) => d.id === discId);
  if (!disciplina) return res.status(404).json({ erro: 'Disciplina não encontrada' });

  const revisaoA = disciplina.revisoes.find((r) => r.id === req.body.revisaoAId);
  const revisaoB = disciplina.revisoes.find((r) => r.id === req.body.revisaoBId);
  if (!revisaoA || !revisaoB) return res.status(400).json({ erro: 'Selecione as duas revisões' });

  try {
    const [imgA, imgB] = await Promise.all([renderizarParaPng(revisaoA), renderizarParaPng(revisaoB)]);
    execFile('python3', [path.join(__dirname, 'diffEngine.py'), imgA, imgB], { maxBuffer: 1024 * 1024 * 64 }, (err, stdout) => {
      if (err) {
        res.status(500).json({ erro: 'Falha ao detectar mudanças: ' + err.message });
        return;
      }
      let saida;
      try { saida = JSON.parse(stdout); } catch (e) {
        res.status(500).json({ erro: 'Resposta inválida do motor de detecção' });
        return;
      }
      if (saida.erro) { res.status(500).json(saida); return; }
      res.json({
        imagemAUrl: '/uploads/' + path.relative(path.join(__dirname, 'uploads'), imgA).split(path.sep).join('/'),
        imagemBUrl: '/uploads/' + path.relative(path.join(__dirname, 'uploads'), imgB).split(path.sep).join('/'),
        revisaoAId: revisaoA.id,
        revisaoBId: revisaoB.id,
        ...saida
      });
    });
  } catch (e) {
    res.status(500).json({ erro: 'Falha ao preparar as imagens: ' + e.message });
  }
});

app.get('/api/obras/:obraId/incompatibilidades', (req, res) => {
  const db = load();
  res.json(db.incompatibilidades[req.params.obraId] || []);
});

app.post('/api/obras/:obraId/incompatibilidades', (req, res) => {
  const db = load();
  const { obraId } = req.params;
  if (!db.incompatibilidades[obraId]) db.incompatibilidades[obraId] = [];
  const item = {
    id: 'inc-' + uuid().slice(0, 8),
    titulo: req.body.titulo,
    disciplinas: req.body.disciplinas || [],
    descricao: req.body.descricao || '',
    severidade: req.body.severidade || 'média',
    responsavel: req.body.responsavel || '',
    prazo: req.body.prazo || '',
    tipo: req.body.tipo || 'documentos', // 'documentos' ou 'fisica' (sequenciamento de ofícios)
    // origem: 'manual' | 'auto' — Épico 3 (Detecção assistida): 'auto' quando nasceu de uma
    // sugestão de sobreposição confirmada pelo engenheiro (regra: IA nunca grava sem confirmação humana).
    origem: req.body.origem === 'auto' ? 'auto' : 'manual',
    confianca: req.body.confianca != null ? Number(req.body.confianca) : null,
    status: 'aberto',
    criadaEm: new Date().toISOString()
  };
  db.incompatibilidades[obraId].push(item);
  save(db);
  res.json(item);
});

app.put('/api/obras/:obraId/incompatibilidades/:id', (req, res) => {
  const db = load();
  const lista = db.incompatibilidades[req.params.obraId] || [];
  const item = lista.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ erro: 'Não encontrada' });
  Object.assign(item, req.body, { atualizadaEm: new Date().toISOString() });
  save(db);
  res.json(item);
});

// Central de projetos (P0 revisado — História 2.2): overlay de DUAS DISCIPLINAS DIFERENTES
// (não duas revisões da mesma) + sugestão de sobreposição (História 3.1). Igual ao diff entre
// revisões, nada aqui vira Incompatibilidade sem confirmação humana (POST /incompatibilidades).
app.post('/api/obras/:obraId/overlay-multidisciplinar', async (req, res) => {
  const db = load();
  const { obraId } = req.params;
  const { disciplinaAId, revisaoAId, disciplinaBId, revisaoBId } = req.body;
  const discA = (db.disciplinas[obraId] || []).find((d) => d.id === disciplinaAId);
  const discB = (db.disciplinas[obraId] || []).find((d) => d.id === disciplinaBId);
  if (!discA || !discB) return res.status(404).json({ erro: 'Disciplina não encontrada' });
  const revA = discA.revisoes.find((r) => r.id === revisaoAId);
  const revB = discB.revisoes.find((r) => r.id === revisaoBId);
  if (!revA || !revB) return res.status(400).json({ erro: 'Selecione uma revisão para cada disciplina' });

  try {
    const [imgA, imgB] = await Promise.all([renderizarParaPng(revA), renderizarParaPng(revB)]);
    execFile('python3', [path.join(__dirname, 'overlapEngine.py'), imgA, imgB], { maxBuffer: 1024 * 1024 * 64 }, (err, stdout) => {
      if (err) { res.status(500).json({ erro: 'Falha ao calcular overlay: ' + err.message }); return; }
      let saida;
      try { saida = JSON.parse(stdout); } catch (e) {
        res.status(500).json({ erro: 'Resposta inválida do motor de overlay' });
        return;
      }
      if (saida.erro) { res.status(500).json(saida); return; }
      res.json({
        imagemAUrl: '/uploads/' + path.relative(path.join(__dirname, 'uploads'), imgA).split(path.sep).join('/'),
        imagemBUrl: '/uploads/' + path.relative(path.join(__dirname, 'uploads'), imgB).split(path.sep).join('/'),
        disciplinaANome: discA.nome, disciplinaBNome: discB.nome,
        revisaoACodigo: revA.codigo, revisaoBCodigo: revB.codigo,
        ...saida
      });
    });
  } catch (e) {
    res.status(500).json({ erro: 'Falha ao preparar as imagens: ' + e.message });
  }
});

// ---------- COORDINATION REPORT (Épico 4) ----------
function montarRelatorioCoordenacao(db, obraId) {
  const obra = getObra(db, obraId);
  const disciplinas = db.disciplinas[obraId] || [];
  const incs = db.incompatibilidades[obraId] || [];
  const elementos = db.elementos[obraId] || [];

  const porSeveridade = {};
  const porTipo = {};
  const porOrigem = { auto: 0, manual: 0 };
  for (const i of incs) {
    porSeveridade[i.severidade] = (porSeveridade[i.severidade] || 0) + 1;
    porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;
    porOrigem[i.origem === 'auto' ? 'auto' : 'manual']++;
  }
  const elementosPorOrigem = { auto: 0, manual: 0 };
  for (const e of elementos) elementosPorOrigem[e.origem === 'auto' ? 'auto' : 'manual']++;

  return {
    obra: obra ? obra.nome : obraId,
    geradoEm: new Date().toISOString(),
    disciplinas: disciplinas.map((d) => ({ nome: d.nome, nRevisoes: d.revisoes.length, ultimaRevisao: d.revisoes.length ? d.revisoes[d.revisoes.length - 1].codigo : '—' })),
    incompatibilidades: { total: incs.length, porSeveridade, porTipo, porOrigem, abertas: incs.filter((i) => i.status !== 'fechado').length, fechadas: incs.filter((i) => i.status === 'fechado').length },
    elementosMarcados: { total: elementos.length, porOrigem: elementosPorOrigem },
    listaIncompatibilidades: incs.map((i) => ({ titulo: i.titulo, tipo: i.tipo, severidade: i.severidade, status: i.status, origem: i.origem }))
  };
}

app.get('/api/obras/:obraId/relatorio-coordenacao', (req, res) => {
  const db = load();
  res.json(montarRelatorioCoordenacao(db, req.params.obraId));
});

app.get('/api/obras/:obraId/relatorio-coordenacao/pdf', (req, res) => {
  const db = load();
  const rel = montarRelatorioCoordenacao(db, req.params.obraId);
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="coordination-report-${req.params.obraId}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).text('VAELITH — Coordination Report', { align: 'left' });
  doc.fontSize(11).fillColor('#555').text(`Obra: ${rel.obra}`);
  doc.text(`Gerado em: ${new Date(rel.geradoEm).toLocaleString('pt-BR')}`);
  doc.moveDown();

  doc.fillColor('#000').fontSize(14).text('Disciplinas analisadas');
  doc.fontSize(10);
  if (rel.disciplinas.length === 0) doc.text('Nenhuma disciplina cadastrada.');
  rel.disciplinas.forEach((d) => doc.text(`• ${d.nome} — ${d.nRevisoes} revisão(ões), última: ${d.ultimaRevisao}`));
  doc.moveDown();

  doc.fontSize(14).text('Incompatibilidades');
  doc.fontSize(10).text(`Total: ${rel.incompatibilidades.total}  |  Abertas: ${rel.incompatibilidades.abertas}  |  Fechadas: ${rel.incompatibilidades.fechadas}`);
  doc.text(`Detectadas automaticamente (confirmadas): ${rel.incompatibilidades.porOrigem.auto}  |  Registradas manualmente: ${rel.incompatibilidades.porOrigem.manual}`);
  doc.moveDown(0.5);
  doc.text('Por severidade: ' + Object.entries(rel.incompatibilidades.porSeveridade).map(([k, v]) => `${k}: ${v}`).join('  ·  ') || '—');
  doc.text('Por tipo: ' + Object.entries(rel.incompatibilidades.porTipo).map(([k, v]) => `${k}: ${v}`).join('  ·  ') || '—');
  doc.moveDown();

  doc.fontSize(14).text('Lista');
  doc.fontSize(10);
  if (rel.listaIncompatibilidades.length === 0) doc.text('Nenhuma incompatibilidade registrada ainda.');
  rel.listaIncompatibilidades.forEach((i, idx) => {
    doc.text(`${idx + 1}. [${i.severidade}] ${i.titulo} — ${i.tipo} — status: ${i.status}${i.origem === 'auto' ? ' (origem: detecção automática)' : ''}`);
  });
  doc.moveDown();

  doc.fontSize(14).text('Elementos marcados (comparação de revisões)');
  doc.fontSize(10).text(`Total: ${rel.elementosMarcados.total}  |  Automáticos confirmados: ${rel.elementosMarcados.porOrigem.auto}  |  Manuais: ${rel.elementosMarcados.porOrigem.manual}`);

  doc.end();
});

// ---------- DASHBOARD ----------
app.get('/api/obras/:obraId/dashboard', (req, res) => {
  const db = load();
  const { obraId } = req.params;
  const cron = db.cronogramas[obraId];
  const incs = db.incompatibilidades[obraId] || [];

  let desvioTotalDias = 0;
  let tarefasComDesvio = 0;
  if (cron && cron.revisoes.length > 0) {
    const atual = cron.revisoes[cron.revisoes.length - 1];
    for (const t of atual.tarefas) {
      if (t.baselineTermino && t.termino && t.baselineTermino !== t.termino) {
        const d1 = new Date(t.baselineTermino);
        const d2 = new Date(t.termino);
        const diff = Math.round((d2 - d1) / 86400000);
        desvioTotalDias += diff;
        if (diff !== 0) tarefasComDesvio++;
      }
    }
  }

  const porStatus = {};
  const porSeveridade = {};
  const porTipo = {};
  for (const i of incs) {
    porStatus[i.status] = (porStatus[i.status] || 0) + 1;
    porSeveridade[i.severidade] = (porSeveridade[i.severidade] || 0) + 1;
    porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;
  }

  res.json({
    desvioTotalDias,
    tarefasComDesvio,
    totalRevisoes: cron ? cron.revisoes.length : 0,
    incompatibilidades: { total: incs.length, porStatus, porSeveridade, porTipo },
    abertas: incs.filter((i) => i.status !== 'fechado').length,
    fechadas: incs.filter((i) => i.status === 'fechado').length
  });
});

// ---------- MÃO DE OBRA (Fase 2 do PRD — TCPO/PMBOK, dimensionamento bottom-up) ----------

// Biblioteca de produtividade (global, editável)
app.get('/api/biblioteca-produtividade', (req, res) => {
  res.json(load().bibliotecaProdutividade);
});

app.post('/api/biblioteca-produtividade', (req, res) => {
  const db = load();
  const item = {
    id: 'ip-' + uuid().slice(0, 8),
    especialidade: (req.body.especialidade || '').toLowerCase().trim(),
    servico: req.body.servico || '',
    unidade: req.body.unidade || '',
    indiceHhPorUnidade: Number(req.body.indiceHhPorUnidade) || 0,
    fonte: req.body.fonte || 'Personalizado'
  };
  db.bibliotecaProdutividade.push(item);
  save(db);
  res.json(item);
});

// Orçamento (BOQ) — cada item de escopo vira horas-homem via o índice de produtividade
app.get('/api/obras/:obraId/orcamento', (req, res) => {
  const db = load();
  res.json(db.orcamentos[req.params.obraId] || []);
});

app.post('/api/obras/:obraId/orcamento', (req, res) => {
  const db = load();
  const { obraId } = req.params;
  const especialidade = (req.body.especialidade || '').toLowerCase().trim();
  const unidade = req.body.unidade || '';
  const quantidade = Number(req.body.quantidade) || 0;

  let indice = Number(req.body.indiceHhPorUnidade);
  let fonteIndice = 'Informado manualmente';
  if (!indice) {
    const ref = db.bibliotecaProdutividade.find(
      (p) => p.especialidade === especialidade && p.unidade.toLowerCase() === unidade.toLowerCase()
    );
    if (ref) { indice = ref.indiceHhPorUnidade; fonteIndice = ref.fonte; }
  }
  if (!indice) return res.status(400).json({ erro: `Nenhum índice de produtividade encontrado para "${especialidade}" em ${unidade}. Informe um índice manual ou cadastre na biblioteca.` });

  const item = {
    id: 'orc-' + uuid().slice(0, 8),
    especialidade,
    servico: req.body.servico || '',
    unidade,
    quantidade,
    indiceUsado: indice,
    fonteIndice,
    horasHomem: Math.round(quantidade * indice * 100) / 100
  };
  if (!db.orcamentos[obraId]) db.orcamentos[obraId] = [];
  db.orcamentos[obraId].push(item);
  save(db);
  res.json(item);
});

// Efetivo diário mobilizado (registro simples, alimenta o comparativo necessário x mobilizado)
app.get('/api/obras/:obraId/efetivo-diario', (req, res) => {
  const db = load();
  res.json(db.efetivoDiario[req.params.obraId] || []);
});

app.post('/api/obras/:obraId/efetivo-diario', (req, res) => {
  const db = load();
  const { obraId } = req.params;
  const item = {
    id: 'ef-' + uuid().slice(0, 8),
    especialidade: (req.body.especialidade || '').toLowerCase().trim(),
    data: req.body.data,
    quantidade: Number(req.body.quantidade) || 0
  };
  if (!db.efetivoDiario[obraId]) db.efetivoDiario[obraId] = [];
  db.efetivoDiario[obraId].push(item);
  save(db);
  res.json(item);
});

// Janela real de execução de uma especialidade = min(início) a max(término) das tarefas
// do cronograma atual cujo campo "recurso" cita essa especialidade — é essa janela,
// não a duração total da obra, que entra no denominador do efetivo médio (seção 4.8 do artigo).
function janelaDaEspecialidade(db, obraId, especialidade) {
  const cron = db.cronogramas[obraId];
  if (!cron || cron.revisoes.length === 0) return null;
  const atual = cron.revisoes[cron.revisoes.length - 1];
  const tarefas = atual.tarefas.filter(
    (t) => t.recurso && t.recurso.toLowerCase().includes(especialidade) && t.inicio && t.termino
  );
  if (tarefas.length === 0) return null;
  const inicio = tarefas.reduce((min, t) => (t.inicio < min ? t.inicio : min), tarefas[0].inicio);
  const termino = tarefas.reduce((max, t) => (t.termino > max ? t.termino : max), tarefas[0].termino);
  const dias = Math.max(1, Math.round((new Date(termino) - new Date(inicio)) / 86400000) + 1);
  return { inicio, termino, dias };
}

// Análise bottom-up: para cada especialidade com orçamento lançado, calcula o efetivo médio
// necessário (horas-homem ÷ janela real ÷ 8h/dia) e compara ao efetivo mobilizado registrado.
app.get('/api/obras/:obraId/mao-de-obra/analise', (req, res) => {
  const db = load();
  const { obraId } = req.params;
  const orcamento = db.orcamentos[obraId] || [];
  const efetivo = db.efetivoDiario[obraId] || [];

  const porEspecialidade = {};
  for (const item of orcamento) {
    if (!porEspecialidade[item.especialidade]) porEspecialidade[item.especialidade] = { horasHomem: 0 };
    porEspecialidade[item.especialidade].horasHomem += item.horasHomem;
  }

  const resultado = Object.keys(porEspecialidade).map((esp) => {
    const janela = janelaDaEspecialidade(db, obraId, esp);
    const horasHomem = porEspecialidade[esp].horasHomem;
    const efetivoNecessario = janela ? Math.round((horasHomem / (janela.dias * 8)) * 100) / 100 : null;

    const registros = efetivo.filter((e) => e.especialidade === esp);
    const efetivoMobilizadoMedio = registros.length
      ? Math.round((registros.reduce((s, r) => s + r.quantidade, 0) / registros.length) * 100) / 100
      : null;

    return {
      especialidade: esp,
      horasHomem: Math.round(horasHomem * 100) / 100,
      janela,
      efetivoNecessario,
      efetivoMobilizadoMedio,
      gap: efetivoNecessario != null && efetivoMobilizadoMedio != null
        ? Math.round((efetivoNecessario - efetivoMobilizadoMedio) * 100) / 100
        : null
    };
  });

  res.json(resultado);
});

// Visão de programa: soma a demanda de efetivo necessário de todas as obras simultâneas,
// por especialidade — a recomendação central do artigo (dimensionar pelo programa, não pela obra isolada).
app.get('/api/programa/mao-de-obra', (req, res) => {
  const db = load();
  const totalPorEspecialidade = {};
  for (const obra of db.obras) {
    const orcamento = db.orcamentos[obra.id] || [];
    const porEsp = {};
    for (const item of orcamento) porEsp[item.especialidade] = (porEsp[item.especialidade] || 0) + item.horasHomem;
    for (const esp of Object.keys(porEsp)) {
      const janela = janelaDaEspecialidade(db, obra.id, esp);
      const necessario = janela ? porEsp[esp] / (janela.dias * 8) : 0;
      if (!totalPorEspecialidade[esp]) totalPorEspecialidade[esp] = { total: 0, porObra: {} };
      totalPorEspecialidade[esp].total += necessario;
      totalPorEspecialidade[esp].porObra[obra.nome] = Math.round(necessario * 100) / 100;
    }
  }
  for (const esp of Object.keys(totalPorEspecialidade)) {
    totalPorEspecialidade[esp].total = Math.round(totalPorEspecialidade[esp].total * 100) / 100;
  }
  res.json(totalPorEspecialidade);
});

app.listen(PORT, () => {
  console.log(`Vaelith Platform (MVP) rodando em http://localhost:${PORT}`);
});
