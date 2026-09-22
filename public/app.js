let OBRA_ID = null;

async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ erro: 'Erro desconhecido' }));
    throw new Error(err.erro || 'Erro na requisição');
  }
  return res.json();
}

// ---------- Navegação por abas ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  ['projetos', 'cronograma', 'compat', 'maodeobra', 'dashboard'].forEach((t) => {
    document.getElementById('view-' + t).style.display = t === btn.dataset.tab ? '' : 'none';
  });
  if (btn.dataset.tab === 'projetos') carregarDisciplinasProjeto();
  if (btn.dataset.tab === 'compat') { carregarDisciplinas(); carregarIncompatibilidades(); carregarChecklistPadrao(); }
  if (btn.dataset.tab === 'maodeobra') { carregarBiblioteca(); carregarOrcamento(); carregarAnaliseMaoDeObra(); carregarVisaoPrograma(); }
  if (btn.dataset.tab === 'dashboard') carregarDashboard();
});

// ---------- Obras ----------
async function carregarObras() {
  const obras = await api('/obras');
  const sel = document.getElementById('obraSelect');
  sel.innerHTML = obras.map((o) => `<option value="${o.id}">${o.nome}</option>`).join('');
  OBRA_ID = obras[0] ? obras[0].id : null;
  sel.value = OBRA_ID;
  sel.addEventListener('change', () => { OBRA_ID = sel.value; recarregarTudo(); });
}

function recarregarTudo() {
  carregarCronograma();
  carregarDisciplinasProjeto();
  carregarDisciplinas();
  carregarIncompatibilidades();
  carregarDashboard();
}

// ---------- Cronograma ----------
async function importarCronograma() {
  const input = document.getElementById('fileCronograma');
  const msg = document.getElementById('importMsg');
  if (!input.files[0]) { msg.textContent = 'Selecione um arquivo primeiro.'; return; }
  const fd = new FormData();
  fd.append('arquivo', input.files[0]);
  msg.textContent = 'Importando...';
  try {
    const r = await api(`/obras/${OBRA_ID}/cronograma/importar`, { method: 'POST', body: fd });
    msg.textContent = `Importado: ${r.revisao.tarefas.length} tarefas (${r.revisao.origem}).`;
    carregarCronograma();
  } catch (e) {
    msg.textContent = 'Erro: ' + e.message;
  }
}

function diasEntre(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

async function carregarCronograma() {
  const data = await api(`/obras/${OBRA_ID}/cronograma`);
  const ganttEl = document.getElementById('gantt');
  const tabelaEl = document.getElementById('tabelaTarefas');
  const revEl = document.getElementById('revisoes');

  if (!data.atual) {
    ganttEl.innerHTML = '<div class="empty-state">Nenhum cronograma importado ainda para esta obra.</div>';
    tabelaEl.innerHTML = '<div class="empty-state">—</div>';
    revEl.innerHTML = '<div class="empty-state">—</div>';
    return;
  }

  const tarefas = data.atual.tarefas.filter((t) => t.inicio && t.termino);
  const datas = tarefas.flatMap((t) => [new Date(t.baselineInicio || t.inicio), new Date(t.termino)]);
  const min = new Date(Math.min(...datas));
  const max = new Date(Math.max(...datas));
  const totalDias = Math.max(1, diasEntre(min, max));

  ganttEl.innerHTML = tarefas.map((t) => {
    const offset = Math.max(0, diasEntre(min, t.inicio)) / totalDias * 100;
    const largura = Math.max(1.5, diasEntre(t.inicio, t.termino) / totalDias * 100);
    const desviada = t.baselineTermino && t.termino !== t.baselineTermino;
    return `<div class="gantt-row">
      <div class="gantt-label" title="${t.tarefa}">${t.tarefa}</div>
      <div class="gantt-track">
        <div class="gantt-bar ${desviada ? 'desviada' : ''}" style="left:${offset}%;width:${largura}%"></div>
      </div>
    </div>`;
  }).join('');

  tabelaEl.innerHTML = `<table>
    <thead><tr><th>Tarefa</th><th>Recurso</th><th>Início</th><th>Término</th><th>Mudança de projeto?</th><th></th></tr></thead>
    <tbody>${data.atual.tarefas.map((t) => `
      <tr>
        <td>${t.tarefa}</td>
        <td>${t.recurso || '—'}</td>
        <td><input type="date" value="${t.inicio || ''}" id="inicio-${t.id}" style="width:140px"/></td>
        <td><input type="date" value="${t.termino || ''}" id="termino-${t.id}" style="width:140px"/></td>
        <td><input type="checkbox" id="mudanca-${t.id}" /></td>
        <td><button class="ghost" onclick="replanejar('${t.id}')">Replanejar</button></td>
      </tr>`).join('')}
    </tbody></table>`;

  revEl.innerHTML = `<table>
    <thead><tr><th>Data</th><th>Origem</th><th>Nº de tarefas</th></tr></thead>
    <tbody>${data.revisoes.slice().reverse().map((r) => `
      <tr><td>${new Date(r.criadaEm).toLocaleString('pt-BR')}</td><td>${r.origem}</td><td>${r.nTarefas}</td></tr>`).join('')}
    </tbody></table>`;
}

async function replanejar(tarefaId) {
  const inicio = document.getElementById('inicio-' + tarefaId).value;
  const termino = document.getElementById('termino-' + tarefaId).value;
  const mudancaDeProjeto = document.getElementById('mudanca-' + tarefaId).checked;
  const motivo = mudancaDeProjeto ? prompt('Descreva a mudança de projeto que motivou o replanejamento:') : null;
  await api(`/obras/${OBRA_ID}/cronograma/tarefas/${tarefaId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inicio, termino, mudancaDeProjeto, motivo })
  });
  carregarCronograma();
  if (mudancaDeProjeto) alert('Cronograma replanejado. Um alerta de compatibilização/revalidação foi criado automaticamente — veja a aba Compatibilização.');
}

// ---------- Compatibilização ----------
async function carregarChecklistPadrao() {
  const el = document.getElementById('checklistPadrao');
  const itens = await api(`/obras/${OBRA_ID}/checklist-padrao`);
  el.innerHTML = itens.map((item, i) => `
    <div class="form-row" style="align-items:center">
      <div style="flex:1;font-size:13px">${item}</div>
      <button class="ghost" onclick="abrirIncompatibilidadeDoChecklist('${item.replace(/'/g, "\\'")}')">Marcar conflito</button>
    </div>`).join('');
}

function abrirIncompatibilidadeDoChecklist(texto) {
  document.getElementById('incTitulo').value = texto;
  document.getElementById('incDescricao').value = `Identificado a partir do checklist guiado: ${texto}`;
  document.getElementById('incTitulo').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Lista resumida usada na aba Compatibilização — só aponta para a aba Projetos.
async function carregarDisciplinas() {
  const el = document.getElementById('listaDisciplinas');
  if (!el) return;
  const itens = await api(`/obras/${OBRA_ID}/disciplinas`);
  if (itens.length === 0) { el.innerHTML = '<div class="empty-state">Nenhuma disciplina cadastrada ainda. Cadastre na aba Projetos.</div>'; return; }
  el.innerHTML = itens.map((d) => {
    const ultima = d.revisoes && d.revisoes.length ? d.revisoes[d.revisoes.length - 1] : null;
    return `
    <div class="form-row" style="align-items:center;border-bottom:1px solid var(--border);padding-bottom:8px">
      <div style="flex:1">
        <div style="font-weight:600">${d.nome}</div>
        <div class="subtitle" style="margin:0">${ultima ? `última revisão: ${ultima.codigo} — ${ultima.arquivoNome}` : 'sem revisão ainda'}</div>
      </div>
      ${ultima ? `<a class="pill" href="${ultima.arquivoUrl}" target="_blank">ver arquivo</a>` : ''}
    </div>`;
  }).join('');
}

// ---------- Central de projetos (P0): disciplinas com revisões versionadas ----------
let DISCIPLINAS_PROJETO = [];

async function criarDisciplinaProjeto() {
  const nome = document.getElementById('projDiscNome').value.trim();
  const input = document.getElementById('projDiscArquivo');
  if (!nome) { alert('Informe o nome da disciplina.'); return; }
  const fd = new FormData();
  fd.append('nome', nome);
  if (input.files[0]) fd.append('arquivo', input.files[0]);
  await api(`/obras/${OBRA_ID}/disciplinas`, { method: 'POST', body: fd });
  document.getElementById('projDiscNome').value = '';
  input.value = '';
  carregarDisciplinasProjeto();
  carregarDisciplinas();
}

async function adicionarRevisao(discId) {
  const input = document.getElementById(`revArquivo-${discId}`);
  const notas = document.getElementById(`revNotas-${discId}`);
  if (!input.files[0]) { alert('Selecione o arquivo da nova revisão.'); return; }
  const fd = new FormData();
  fd.append('arquivo', input.files[0]);
  fd.append('notasDeMudanca', notas.value.trim());
  await api(`/obras/${OBRA_ID}/disciplinas/${discId}/revisoes`, { method: 'POST', body: fd });
  carregarDisciplinasProjeto();
  carregarDisciplinas();
}

async function carregarDisciplinasProjeto() {
  const el = document.getElementById('listaDisciplinasProjeto');
  if (!el) return;
  DISCIPLINAS_PROJETO = await api(`/obras/${OBRA_ID}/disciplinas`);

  if (DISCIPLINAS_PROJETO.length === 0) {
    el.innerHTML = '<div class="empty-state">Nenhuma disciplina cadastrada ainda.</div>';
  } else {
    el.innerHTML = DISCIPLINAS_PROJETO.map((d) => `
      <div class="panel" style="background:transparent;border:1px solid var(--border);margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">${d.nome}</h3>
          <span class="pill">${d.revisoes.length} revisão(ões)</span>
        </div>
        <table style="margin-top:10px">
          <thead><tr><th>Revisão</th><th>Arquivo</th><th>Data</th><th>Nota da mudança</th><th></th></tr></thead>
          <tbody>${d.revisoes.slice().reverse().map((r) => `
            <tr>
              <td><span class="badge">${r.codigo}</span></td>
              <td>${r.arquivoNome}</td>
              <td>${new Date(r.criadaEm).toLocaleString('pt-BR')}</td>
              <td>${r.notasDeMudanca || '—'}</td>
              <td><a class="pill" href="${r.arquivoUrl}" target="_blank">ver</a></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <details style="margin-top:10px">
          <summary style="cursor:pointer;color:var(--text-muted);font-size:13px">Enviar nova revisão (não sobrescreve as anteriores)</summary>
          <div class="form-row" style="margin-top:8px">
            <div style="flex:1"><input type="file" id="revArquivo-${d.id}" accept=".pdf,.png,.jpg,.jpeg" /></div>
            <div style="flex:1"><input id="revNotas-${d.id}" placeholder="O que mudou nesta revisão? (opcional)" /></div>
            <button class="ghost" onclick="adicionarRevisao('${d.id}')">Enviar</button>
          </div>
        </details>
      </div>`).join('');
  }

  // Popula o seletor de disciplina do painel de comparação.
  const selDisc = document.getElementById('compDisciplina');
  const atual = selDisc.value;
  selDisc.innerHTML = DISCIPLINAS_PROJETO.map((d) => `<option value="${d.id}">${d.nome}</option>`).join('');
  if (atual && DISCIPLINAS_PROJETO.some((d) => d.id === atual)) selDisc.value = atual;
  atualizarSeletoresComparacao();

  // Popula os seletores A/B do overlay multidisciplinar.
  ['ovDisciplinaA', 'ovDisciplinaB'].forEach((id, i) => {
    const sel = document.getElementById(id);
    const valorAtual = sel.value;
    sel.innerHTML = DISCIPLINAS_PROJETO.map((d) => `<option value="${d.id}">${d.nome}</option>`).join('');
    if (valorAtual && DISCIPLINAS_PROJETO.some((d) => d.id === valorAtual)) sel.value = valorAtual;
    else if (DISCIPLINAS_PROJETO[i]) sel.value = DISCIPLINAS_PROJETO[i].id;
  });
  atualizarSeletorRevisaoOverlay('A');
  atualizarSeletorRevisaoOverlay('B');
}

function atualizarSeletoresComparacao() {
  const discId = document.getElementById('compDisciplina').value;
  const disciplina = DISCIPLINAS_PROJETO.find((d) => d.id === discId);
  const selA = document.getElementById('compRevA');
  const selB = document.getElementById('compRevB');
  if (!disciplina || disciplina.revisoes.length === 0) {
    selA.innerHTML = '';
    selB.innerHTML = '';
    return;
  }
  const opts = disciplina.revisoes.map((r) => `<option value="${r.id}">${r.codigo} — ${r.arquivoNome}</option>`).join('');
  selA.innerHTML = opts;
  selB.innerHTML = opts;
  // Por padrão: A = penúltima revisão, B = última — a comparação mais útil.
  const revs = disciplina.revisoes;
  selA.value = revs.length > 1 ? revs[revs.length - 2].id : revs[0].id;
  selB.value = revs[revs.length - 1].id;
}

let ELEMENTO_MARCACAO_CTX = null; // { disciplinaId, revisaoId } — em qual lado do comparador o próximo clique marca

function compararRevisoes() {
  const discId = document.getElementById('compDisciplina').value;
  const disciplina = DISCIPLINAS_PROJETO.find((d) => d.id === discId);
  const revA = disciplina && disciplina.revisoes.find((r) => r.id === document.getElementById('compRevA').value);
  const revB = disciplina && disciplina.revisoes.find((r) => r.id === document.getElementById('compRevB').value);
  const area = document.getElementById('areaComparacao');
  if (!disciplina || !revA || !revB) { area.innerHTML = '<div class="empty-state">Selecione disciplina e duas revisões.</div>'; return; }

  const ladoHtml = (rev, lado) => {
    if (rev.tipoArquivo === 'imagem') {
      return `
        <div style="flex:1">
          <div class="subtitle" style="margin-bottom:6px"><span class="badge">${rev.codigo}</span> ${rev.arquivoNome}</div>
          <div style="position:relative;border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <img src="${rev.arquivoUrl}" style="display:block;width:100%;cursor:crosshair" id="imgComp-${lado}"
              onclick="clicouNaImagem(event, '${disciplina.id}', '${rev.id}')" />
          </div>
        </div>`;
    }
    return `
      <div style="flex:1">
        <div class="subtitle" style="margin-bottom:6px"><span class="badge">${rev.codigo}</span> ${rev.arquivoNome}</div>
        <iframe src="${rev.arquivoUrl}" style="width:100%;height:480px;border:1px solid var(--border);border-radius:8px"></iframe>
      </div>`;
  };

  const temPdf = revA.tipoArquivo === 'pdf' || revB.tipoArquivo === 'pdf';

  area.innerHTML = `
    <div class="form-row" style="align-items:flex-start;gap:16px">
      ${ladoHtml(revA, 'a')}
      ${ladoHtml(revB, 'b')}
    </div>
    ${temPdf ? `
    <div class="panel" style="margin-top:16px">
      <h3 style="margin-top:0">Marcar alteração (PDF — clique não pode ser capturado dentro do visualizador)</h3>
      <div class="form-row">
        <div style="flex:1"><label>Revisão em que a mudança aparece</label>
          <select id="pdfMarcRevisao">
            <option value="${revB.id}">${revB.codigo} — ${revB.arquivoNome}</option>
            <option value="${revA.id}">${revA.codigo} — ${revA.arquivoNome}</option>
          </select>
        </div>
        <div style="flex:1"><label>Página</label><input id="pdfMarcPagina" type="number" min="1" value="1" /></div>
      </div>
      <label>O que mudou</label>
      <input id="pdfMarcDescricao" placeholder="Ex.: Parede deslocada 40cm" />
      <div style="margin-top:10px"><button class="primary" onclick="marcarElementoPdf('${disciplina.id}')">Marcar</button></div>
    </div>` : ''}
  `;

  carregarElementos(disciplina.id);
}

async function clicouNaImagem(ev, disciplinaId, revisaoId) {
  const img = ev.currentTarget;
  const rect = img.getBoundingClientRect();
  const xPct = ((ev.clientX - rect.left) / rect.width) * 100;
  const yPct = ((ev.clientY - rect.top) / rect.height) * 100;
  const descricao = prompt('O que mudou neste ponto?');
  if (descricao === null) return;
  await api(`/obras/${OBRA_ID}/elementos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disciplinaId, revisaoId, pagina: 1, xPct, yPct, descricao })
  });
  carregarElementos(disciplinaId);
}

async function marcarElementoPdf(disciplinaId) {
  const revisaoId = document.getElementById('pdfMarcRevisao').value;
  const pagina = document.getElementById('pdfMarcPagina').value;
  const descricao = document.getElementById('pdfMarcDescricao').value.trim();
  if (!descricao) { alert('Descreva o que mudou.'); return; }
  await api(`/obras/${OBRA_ID}/elementos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disciplinaId, revisaoId, pagina, descricao })
  });
  document.getElementById('pdfMarcDescricao').value = '';
  carregarElementos(disciplinaId);
}

// ---------- Detecção automática de mudanças (História 2.1/2.3) ----------
let SUGESTOES_ATUAIS = []; // guarda o contexto de cada sugestão em tela (disciplinaId, revisaoId, região)

async function detectarMudancasAutomaticas() {
  const discId = document.getElementById('compDisciplina').value;
  const revisaoAId = document.getElementById('compRevA').value;
  const revisaoBId = document.getElementById('compRevB').value;
  const area = document.getElementById('areaDeteccaoAutomatica');
  if (!discId || !revisaoAId || !revisaoBId) { area.innerHTML = '<div class="empty-state">Selecione disciplina e duas revisões antes.</div>'; return; }
  if (revisaoAId === revisaoBId) { area.innerHTML = '<div class="empty-state">Escolha duas revisões diferentes para comparar.</div>'; return; }

  area.innerHTML = '<div class="empty-state">Analisando as duas revisões — pode levar alguns segundos…</div>';
  let resultado;
  try {
    resultado = await api(`/obras/${OBRA_ID}/disciplinas/${discId}/detectar-mudancas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisaoAId, revisaoBId })
    });
  } catch (e) {
    area.innerHTML = `<div class="empty-state">Não foi possível detectar automaticamente: ${e.message}</div>`;
    return;
  }

  SUGESTOES_ATUAIS = resultado.regioes.map((r, i) => ({ ...r, idx: i, disciplinaId: discId, revisaoId: resultado.revisaoBId, status: 'sugerida' }));

  if (SUGESTOES_ATUAIS.length === 0) {
    area.innerHTML = `<div class="panel" style="background:transparent"><h3 style="margin-top:0">Detecção automática</h3><div class="empty-state">Nenhuma diferença visual relevante encontrada entre as duas revisões.</div></div>`;
    return;
  }

  area.innerHTML = `
    <div class="panel" style="background:transparent">
      <h3 style="margin-top:0">Detecção automática — ${SUGESTOES_ATUAIS.length} região(ões) candidata(s)</h3>
      <div class="subtitle" style="margin-top:-6px">Comparado contra a revisão anterior selecionada. Cada caixa é uma sugestão — nada vira registro até você confirmar. Confiança maior = diferença visual mais forte entre as revisões, não uma decisão automática.</div>
      <div class="deteccao-imagem-wrap" id="deteccaoImgWrap">
        <img src="${resultado.imagemBUrl}" id="deteccaoImg" onload="desenharSugestoes()" />
      </div>
    </div>`;
  // Se a imagem já estiver em cache do navegador, onload pode não disparar de novo — desenha direto também.
  desenharSugestoes();
}

function desenharSugestoes() {
  const wrap = document.getElementById('deteccaoImgWrap');
  if (!wrap) return;
  wrap.querySelectorAll('.sugestao-box').forEach((el) => el.remove());
  SUGESTOES_ATUAIS.filter((s) => s.status === 'sugerida').forEach((s) => {
    const box = document.createElement('div');
    box.className = 'sugestao-box';
    box.style.left = s.xPct + '%';
    box.style.top = s.yPct + '%';
    box.style.width = s.wPct + '%';
    box.style.height = s.hPct + '%';
    box.innerHTML = `
      <div class="sugestao-acoes">
        <button class="btn-confirmar" onclick="confirmarSugestao(${s.idx})" title="Confiança ${s.confianca}%">✓ ${s.confianca}%</button>
        <button class="btn-rejeitar" onclick="rejeitarSugestao(${s.idx})">✗</button>
      </div>`;
    wrap.appendChild(box);
  });
}

async function confirmarSugestao(idx) {
  const s = SUGESTOES_ATUAIS.find((x) => x.idx === idx);
  if (!s) return;
  const descricao = prompt('O que mudou nesta região?', '') || 'Alteração confirmada a partir de sugestão automática';
  await api(`/obras/${OBRA_ID}/elementos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      disciplinaId: s.disciplinaId, revisaoId: s.revisaoId, pagina: 1,
      xPct: s.xPct + s.wPct / 2, yPct: s.yPct + s.hPct / 2, wPct: s.wPct, hPct: s.hPct,
      origem: 'auto', confianca: s.confianca, descricao
    })
  });
  s.status = 'confirmada';
  desenharSugestoes();
  carregarElementos(s.disciplinaId);
}

function rejeitarSugestao(idx) {
  // Rejeitar não grava nada — regra de produto: nenhuma sugestão vira dado sem confirmação humana.
  SUGESTOES_ATUAIS = SUGESTOES_ATUAIS.filter((x) => x.idx !== idx);
  desenharSugestoes();
}

async function carregarElementos(disciplinaId) {
  const el = document.getElementById('listaElementos');
  const itens = await api(`/obras/${OBRA_ID}/elementos?disciplinaId=${disciplinaId}`);
  if (itens.length === 0) { el.innerHTML = '<div class="empty-state">Compare duas revisões e marque uma alteração para ver aqui.</div>'; return; }
  const disciplina = DISCIPLINAS_PROJETO.find((d) => d.id === disciplinaId);
  const codigoDaRevisao = (id) => (disciplina && disciplina.revisoes.find((r) => r.id === id) || {}).codigo || '—';
  el.innerHTML = `<table>
    <thead><tr><th>Revisão</th><th>Origem</th><th>Página</th><th>Posição</th><th>O que mudou</th><th>Quando</th></tr></thead>
    <tbody>${itens.slice().reverse().map((e) => `
      <tr>
        <td><span class="badge">${codigoDaRevisao(e.revisaoId)}</span></td>
        <td>${e.origem === 'auto' ? `<span class="pill">auto${e.confianca != null ? ' · ' + e.confianca + '%' : ''}</span>` : '<span class="pill">manual</span>'}</td>
        <td>${e.pagina}</td>
        <td>${e.xPct != null ? `${e.xPct.toFixed(1)}%, ${e.yPct.toFixed(1)}%` : '—'}</td>
        <td>${e.descricao || '—'}</td>
        <td>${new Date(e.criadoEm).toLocaleString('pt-BR')}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

// ---------- Overlay multidisciplinar (História 2.2/3.1) ----------
function atualizarSeletorRevisaoOverlay(lado) {
  const discId = document.getElementById(`ovDisciplina${lado}`).value;
  const disciplina = DISCIPLINAS_PROJETO.find((d) => d.id === discId);
  const selRev = document.getElementById(`ovRevisao${lado}`);
  if (!disciplina || disciplina.revisoes.length === 0) { selRev.innerHTML = ''; return; }
  selRev.innerHTML = disciplina.revisoes.map((r) => `<option value="${r.id}">${r.codigo} — ${r.arquivoNome}</option>`).join('');
  selRev.value = disciplina.revisoes[disciplina.revisoes.length - 1].id;
}

async function verOverlay() {
  const discAId = document.getElementById('ovDisciplinaA').value;
  const discBId = document.getElementById('ovDisciplinaB').value;
  const revAId = document.getElementById('ovRevisaoA').value;
  const revBId = document.getElementById('ovRevisaoB').value;
  const area = document.getElementById('areaOverlay');
  if (!discAId || !discBId || !revAId || !revBId) { area.innerHTML = '<div class="empty-state">Selecione disciplina e revisão dos dois lados.</div>'; return; }
  if (discAId === discBId) { area.innerHTML = '<div class="empty-state">Escolha duas disciplinas diferentes — para comparar revisões da mesma disciplina, use o painel "Comparar revisões" acima.</div>'; return; }

  const discA = DISCIPLINAS_PROJETO.find((d) => d.id === discAId);
  const discB = DISCIPLINAS_PROJETO.find((d) => d.id === discBId);
  const revA = discA.revisoes.find((r) => r.id === revAId);
  const revB = discB.revisoes.find((r) => r.id === revBId);
  if (revA.tipoArquivo === 'pdf' || revB.tipoArquivo === 'pdf') {
    area.innerHTML = '<div class="empty-state">Renderizando PDF para visualização — isso pode levar alguns segundos…</div>';
  }

  // Reaproveita o motor de renderização do servidor (mesma rota da detecção automática já
  // converte PDF em PNG) — chamamos "detectar-mudancas" só para obter as imagens renderizadas
  // quando pelo menos uma é PDF; se as duas já são imagem, usamos os arquivos originais direto.
  let urlA = revA.arquivoUrl, urlB = revB.arquivoUrl;
  if (revA.tipoArquivo === 'pdf' || revB.tipoArquivo === 'pdf') {
    try {
      const r = await api(`/obras/${OBRA_ID}/overlay-multidisciplinar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disciplinaAId: discAId, revisaoAId: revAId, disciplinaBId: discBId, revisaoBId: revBId })
      });
      urlA = r.imagemAUrl; urlB = r.imagemBUrl;
    } catch (e) {
      area.innerHTML = `<div class="empty-state">Não foi possível renderizar: ${e.message}</div>`;
      return;
    }
  }

  area.innerHTML = `
    <div class="subtitle" style="margin-top:0">Overlay: <strong>${discA.nome}</strong> (${revA.codigo}) sobre <strong>${discB.nome}</strong> (${revB.codigo})</div>
    <div style="position:relative;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <img src="${urlA}" id="ovImgA" style="display:block;width:100%" />
      <img src="${urlB}" id="ovImgB" style="display:block;width:100%;position:absolute;top:0;left:0;opacity:0.55" />
    </div>`;
  ajustarOpacidadeOverlay();
}

function ajustarOpacidadeOverlay() {
  const imgA = document.getElementById('ovImgA');
  const imgB = document.getElementById('ovImgB');
  if (!imgA || !imgB) return;
  const opacidade = document.getElementById('ovOpacidade').value / 100;
  imgA.style.display = document.getElementById('ovMostrarA').checked ? 'block' : 'none';
  imgB.style.display = document.getElementById('ovMostrarB').checked ? 'block' : 'none';
  imgB.style.opacity = opacidade;
}

let SOBREPOSICOES_ATUAIS = [];

async function detectarSobreposicoes() {
  const discAId = document.getElementById('ovDisciplinaA').value;
  const discBId = document.getElementById('ovDisciplinaB').value;
  const revAId = document.getElementById('ovRevisaoA').value;
  const revBId = document.getElementById('ovRevisaoB').value;
  const area = document.getElementById('areaOverlay');
  if (discAId === discBId) { area.innerHTML = '<div class="empty-state">Escolha duas disciplinas diferentes.</div>'; return; }

  area.innerHTML = '<div class="empty-state">Calculando sobreposições — pode levar alguns segundos…</div>';
  const discA = DISCIPLINAS_PROJETO.find((d) => d.id === discAId);
  const discB = DISCIPLINAS_PROJETO.find((d) => d.id === discBId);
  let r;
  try {
    r = await api(`/obras/${OBRA_ID}/overlay-multidisciplinar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disciplinaAId: discAId, revisaoAId: revAId, disciplinaBId: discBId, revisaoBId: revBId })
    });
  } catch (e) {
    area.innerHTML = `<div class="empty-state">Não foi possível calcular: ${e.message}</div>`;
    return;
  }

  SOBREPOSICOES_ATUAIS = r.regioes.map((reg, i) => ({ ...reg, idx: i, disciplinaANome: r.disciplinaANome, disciplinaBNome: r.disciplinaBNome, status: 'sugerida' }));

  if (SOBREPOSICOES_ATUAIS.length === 0) {
    area.innerHTML = `<div class="empty-state">Nenhuma região com traço das duas disciplinas ao mesmo tempo — sem candidato a interferência entre ${discA.nome} e ${discB.nome} nestas revisões.</div>`;
    return;
  }

  area.innerHTML = `
    <div class="subtitle" style="margin-top:0"><strong>${SOBREPOSICOES_ATUAIS.length}</strong> região(ões) onde ${discA.nome} e ${discB.nome} têm traço na mesma área — candidatos a interferência física. Confirme para registrar como Incompatibilidade, ou rejeite (nada é gravado).</div>
    <div class="deteccao-imagem-wrap" id="overlapImgWrap">
      <img src="${r.imagemBUrl}" id="overlapImg" onload="desenharSobreposicoes()" />
    </div>`;
  desenharSobreposicoes();
}

function desenharSobreposicoes() {
  const wrap = document.getElementById('overlapImgWrap');
  if (!wrap) return;
  wrap.querySelectorAll('.sugestao-box').forEach((el) => el.remove());
  SOBREPOSICOES_ATUAIS.filter((s) => s.status === 'sugerida').forEach((s) => {
    const box = document.createElement('div');
    box.className = 'sugestao-box';
    box.style.left = s.xPct + '%';
    box.style.top = s.yPct + '%';
    box.style.width = s.wPct + '%';
    box.style.height = s.hPct + '%';
    box.innerHTML = `
      <div class="sugestao-acoes">
        <button class="btn-confirmar" onclick="confirmarSobreposicao(${s.idx})" title="Confiança ${s.confianca}%">✓ ${s.confianca}%</button>
        <button class="btn-rejeitar" onclick="rejeitarSobreposicao(${s.idx})">✗</button>
      </div>`;
    wrap.appendChild(box);
  });
}

async function confirmarSobreposicao(idx) {
  const s = SOBREPOSICOES_ATUAIS.find((x) => x.idx === idx);
  if (!s) return;
  const descricao = prompt(
    `Descreva a interferência entre ${s.disciplinaANome} e ${s.disciplinaBNome} nesta região:`,
    `Sobreposição entre ${s.disciplinaANome} e ${s.disciplinaBNome} detectada automaticamente — revisar no local.`
  );
  if (descricao === null) return;
  await api(`/obras/${OBRA_ID}/incompatibilidades`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titulo: `${s.disciplinaANome} × ${s.disciplinaBNome} — possível interferência`,
      descricao,
      tipo: 'documentos',
      severidade: s.confianca >= 50 ? 'alta' : 'média',
      disciplinas: [s.disciplinaANome, s.disciplinaBNome],
      origem: 'auto',
      confianca: s.confianca
    })
  });
  s.status = 'confirmada';
  desenharSobreposicoes();
  alert('Incompatibilidade registrada — veja na aba Compatibilização.');
}

function rejeitarSobreposicao(idx) {
  SOBREPOSICOES_ATUAIS = SOBREPOSICOES_ATUAIS.filter((x) => x.idx !== idx);
  desenharSobreposicoes();
}

// ---------- Coordination Report (Épico 4) ----------
async function gerarRelatorioCoordenacao() {
  const area = document.getElementById('areaRelatorio');
  area.innerHTML = '<div class="empty-state">Gerando relatório…</div>';
  const rel = await api(`/obras/${OBRA_ID}/relatorio-coordenacao`);

  const linkPdf = document.getElementById('linkRelatorioPdf');
  linkPdf.href = `/api/obras/${OBRA_ID}/relatorio-coordenacao/pdf`;
  linkPdf.style.display = 'inline-block';

  const fmtPares = (obj) => Object.entries(obj).map(([k, v]) => `${k}: <strong>${v}</strong>`).join(' &nbsp;·&nbsp; ') || '—';

  area.innerHTML = `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="kpi"><div class="value">${rel.disciplinas.length}</div><div class="label">Disciplinas analisadas</div></div>
      <div class="kpi ${rel.incompatibilidades.abertas > 0 ? 'warn' : 'good'}"><div class="value">${rel.incompatibilidades.total}</div><div class="label">Incompatibilidades (${rel.incompatibilidades.abertas} abertas)</div></div>
      <div class="kpi good"><div class="value">${rel.incompatibilidades.porOrigem.auto}</div><div class="label">Confirmadas a partir de detecção automática</div></div>
    </div>
    <table>
      <thead><tr><th>Disciplina</th><th>Revisões</th><th>Última</th></tr></thead>
      <tbody>${rel.disciplinas.map((d) => `<tr><td>${d.nome}</td><td>${d.nRevisoes}</td><td><span class="badge">${d.ultimaRevisao}</span></td></tr>`).join('') || '<tr><td colspan="3">Nenhuma disciplina cadastrada.</td></tr>'}</tbody>
    </table>
    <div class="subtitle" style="margin-top:14px">Por severidade: ${fmtPares(rel.incompatibilidades.porSeveridade)}</div>
    <div class="subtitle" style="margin-top:-14px">Por tipo: ${fmtPares(rel.incompatibilidades.porTipo)}</div>
    <div class="subtitle" style="margin-top:-14px">Gerado em ${new Date(rel.geradoEm).toLocaleString('pt-BR')}</div>`;
}

async function criarIncompatibilidade() {
  const body = {
    titulo: document.getElementById('incTitulo').value.trim(),
    descricao: document.getElementById('incDescricao').value.trim(),
    tipo: document.getElementById('incTipo').value,
    severidade: document.getElementById('incSeveridade').value,
    responsavel: document.getElementById('incResponsavel').value.trim(),
    prazo: document.getElementById('incPrazo').value
  };
  if (!body.titulo) { alert('Dê um título para a incompatibilidade.'); return; }
  await api(`/obras/${OBRA_ID}/incompatibilidades`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  ['incTitulo', 'incDescricao', 'incResponsavel', 'incPrazo'].forEach((id) => document.getElementById(id).value = '');
  carregarIncompatibilidades();
}

const STATUS_FLUXO = ['aberto', 'em-analise', 'revisao', 'aprovado', 'fechado'];
const STATUS_LABEL = { 'aberto': 'Aberto', 'em-analise': 'Em análise', 'revisao': 'Revisão de projeto', 'aprovado': 'Aprovado', 'fechado': 'Fechado' };

async function carregarIncompatibilidades() {
  const el = document.getElementById('listaIncompatibilidades');
  const itens = await api(`/obras/${OBRA_ID}/incompatibilidades`);
  if (itens.length === 0) { el.innerHTML = '<div class="empty-state">Nenhuma incompatibilidade registrada ainda.</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Título</th><th>Tipo</th><th>Severidade</th><th>Responsável</th><th>Status</th><th></th></tr></thead>
    <tbody>${itens.slice().reverse().map((i) => `
      <tr>
        <td>${i.titulo}${i.origemAutomatica ? ' <span class="pill">auto</span>' : ''}</td>
        <td>${i.tipo === 'fisica' ? 'Física (sequenciamento)' : 'Documentos de projeto'}</td>
        <td>${i.severidade}</td>
        <td>${i.responsavel || '—'}</td>
        <td><span class="badge ${i.status}">${STATUS_LABEL[i.status] || i.status}</span></td>
        <td>${i.status !== 'fechado' ? `<button class="ghost" onclick="avancarStatus('${i.id}','${i.status}')">Avançar</button>` : ''}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function avancarStatus(id, statusAtual) {
  const idx = STATUS_FLUXO.indexOf(statusAtual);
  const proximo = STATUS_FLUXO[Math.min(idx + 1, STATUS_FLUXO.length - 1)];
  await api(`/obras/${OBRA_ID}/incompatibilidades/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: proximo })
  });
  carregarIncompatibilidades();
  carregarDashboard();
}

// ---------- Mão de obra ----------
async function carregarBiblioteca() {
  const el = document.getElementById('listaBiblioteca');
  const itens = await api('/biblioteca-produtividade');
  el.innerHTML = `<table>
    <thead><tr><th>Especialidade</th><th>Serviço</th><th>Unidade</th><th>Hh/unid.</th><th>Fonte</th></tr></thead>
    <tbody>${itens.map((i) => `<tr><td>${i.especialidade}</td><td>${i.servico}</td><td>${i.unidade}</td><td>${i.indiceHhPorUnidade}</td><td>${i.fonte}</td></tr>`).join('')}</tbody>
  </table>`;
}

async function adicionarIndice() {
  const body = {
    especialidade: document.getElementById('bibEspecialidade').value.trim(),
    servico: document.getElementById('bibServico').value.trim(),
    unidade: document.getElementById('bibUnidade').value.trim(),
    indiceHhPorUnidade: document.getElementById('bibIndice').value
  };
  if (!body.especialidade || !body.unidade || !body.indiceHhPorUnidade) { alert('Preencha especialidade, unidade e índice.'); return; }
  await api('/biblioteca-produtividade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  ['bibEspecialidade', 'bibServico', 'bibUnidade', 'bibIndice'].forEach((id) => document.getElementById(id).value = '');
  carregarBiblioteca();
}

async function lancarOrcamento() {
  const msg = document.getElementById('orcMsg');
  const body = {
    especialidade: document.getElementById('orcEspecialidade').value.trim(),
    servico: document.getElementById('orcServico').value.trim(),
    unidade: document.getElementById('orcUnidade').value.trim(),
    quantidade: document.getElementById('orcQuantidade').value,
    indiceHhPorUnidade: document.getElementById('orcIndiceManual').value
  };
  if (!body.especialidade || !body.unidade || !body.quantidade) { msg.textContent = 'Preencha especialidade, unidade e quantidade.'; return; }
  try {
    await api(`/obras/${OBRA_ID}/orcamento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    msg.textContent = '';
    ['orcEspecialidade', 'orcServico', 'orcUnidade', 'orcQuantidade', 'orcIndiceManual'].forEach((id) => document.getElementById(id).value = '');
    carregarOrcamento();
    carregarAnaliseMaoDeObra();
  } catch (e) {
    msg.textContent = 'Erro: ' + e.message;
  }
}

async function carregarOrcamento() {
  const el = document.getElementById('listaOrcamento');
  const itens = await api(`/obras/${OBRA_ID}/orcamento`);
  if (itens.length === 0) { el.innerHTML = '<div class="empty-state">Nenhum item lançado ainda.</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Especialidade</th><th>Serviço</th><th>Qtd.</th><th>Unidade</th><th>Índice</th><th>Horas-homem</th><th>Fonte</th></tr></thead>
    <tbody>${itens.map((i) => `<tr><td>${i.especialidade}</td><td>${i.servico}</td><td>${i.quantidade}</td><td>${i.unidade}</td><td>${i.indiceUsado}</td><td>${i.horasHomem}</td><td>${i.fonteIndice}</td></tr>`).join('')}</tbody>
  </table>`;
}

async function registrarEfetivo() {
  const body = {
    especialidade: document.getElementById('efEspecialidade').value.trim(),
    data: document.getElementById('efData').value,
    quantidade: document.getElementById('efQuantidade').value
  };
  if (!body.especialidade || !body.data || !body.quantidade) { alert('Preencha especialidade, data e quantidade.'); return; }
  await api(`/obras/${OBRA_ID}/efetivo-diario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  ['efEspecialidade', 'efData', 'efQuantidade'].forEach((id) => document.getElementById(id).value = '');
  carregarAnaliseMaoDeObra();
}

async function carregarAnaliseMaoDeObra() {
  const el = document.getElementById('analiseMaoDeObra');
  const dados = await api(`/obras/${OBRA_ID}/mao-de-obra/analise`);
  if (dados.length === 0) { el.innerHTML = '<div class="empty-state">Lance itens de orçamento para ver o cálculo.</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Especialidade</th><th>Horas-homem</th><th>Janela real</th><th>Efetivo necessário</th><th>Efetivo mobilizado (média)</th><th>Gap</th></tr></thead>
    <tbody>${dados.map((d) => `
      <tr>
        <td>${d.especialidade}</td>
        <td>${d.horasHomem}</td>
        <td>${d.janela ? `${d.janela.inicio} → ${d.janela.termino} (${d.janela.dias}d)` : '<span class="pill">sem tarefa vinculada no cronograma</span>'}</td>
        <td>${d.efetivoNecessario != null ? d.efetivoNecessario + '/dia' : '—'}</td>
        <td>${d.efetivoMobilizadoMedio != null ? d.efetivoMobilizadoMedio + '/dia' : '<span class="pill">sem registro</span>'}</td>
        <td>${d.gap != null ? `<span class="badge ${d.gap > 0 ? 'aberto' : 'fechado'}">${d.gap > 0 ? '−' + d.gap : '+' + Math.abs(d.gap)}</span>` : '—'}</td>
      </tr>`).join('')}
    </tbody></table>
  <div class="subtitle" style="margin-top:10px">Gap negativo (vermelho) = efetivo mobilizado abaixo do necessário, o padrão identificado no seu estudo de caso. Para o cálculo funcionar, o campo "recurso" das tarefas do cronograma precisa citar a especialidade (ex.: "pedreiro").</div>`;
}

async function carregarVisaoPrograma() {
  const el = document.getElementById('visaoPrograma');
  const dados = await api('/programa/mao-de-obra');
  const especialidades = Object.keys(dados);
  if (especialidades.length === 0) { el.innerHTML = '<div class="empty-state">Sem dados suficientes ainda.</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Especialidade</th><th>Demanda total do programa (pessoas/dia)</th><th>Por obra</th></tr></thead>
    <tbody>${especialidades.map((esp) => `
      <tr>
        <td>${esp}</td>
        <td><strong>${dados[esp].total}</strong></td>
        <td>${Object.entries(dados[esp].porObra).map(([obra, v]) => `${obra}: ${v}`).join(' · ')}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

// ---------- Dashboard ----------
function barra(label, valor, max, cor) {
  const pct = max > 0 ? (valor / max * 100) : 0;
  return `<div class="gantt-row">
    <div class="gantt-label">${label}</div>
    <div class="gantt-track"><div class="gantt-bar" style="width:${Math.max(pct,2)}%;background:${cor}"></div></div>
    <div style="width:24px;text-align:right;font-weight:700">${valor}</div>
  </div>`;
}

async function carregarDashboard() {
  if (!OBRA_ID) return;
  const d = await api(`/obras/${OBRA_ID}/dashboard`);
  const kpis = document.getElementById('kpis');
  kpis.innerHTML = `
    <div class="kpi ${d.desvioTotalDias > 0 ? 'bad' : 'good'}">
      <div class="value">${d.desvioTotalDias > 0 ? '+' : ''}${d.desvioTotalDias}</div>
      <div class="label">Dias de desvio acumulado</div>
    </div>
    <div class="kpi ${d.abertas > 0 ? 'warn' : 'good'}">
      <div class="value">${d.abertas}</div>
      <div class="label">Incompatibilidades abertas</div>
    </div>
    <div class="kpi good">
      <div class="value">${d.fechadas}</div>
      <div class="label">Incompatibilidades resolvidas</div>
    </div>`;

  const maxStatus = Math.max(1, ...Object.values(d.incompatibilidades.porStatus));
  document.getElementById('chartStatus').innerHTML = Object.keys(STATUS_LABEL).map((s) =>
    barra(STATUS_LABEL[s], d.incompatibilidades.porStatus[s] || 0, maxStatus, '#3b5bfd')
  ).join('') || '<div class="empty-state">Sem dados ainda.</div>';

  const tipos = d.incompatibilidades.porTipo;
  const maxTipo = Math.max(1, ...Object.values(tipos));
  document.getElementById('chartTipo').innerHTML = Object.keys(tipos).length ? Object.keys(tipos).map((t) =>
    barra(t === 'fisica' ? 'Física (sequenciamento)' : 'Documentos de projeto', tipos[t], maxTipo, '#6f8bff')
  ).join('') : '<div class="empty-state">Sem dados ainda.</div>';
}

// ---------- Boot ----------
(async function boot() {
  await carregarObras();
  recarregarTudo();
})();
