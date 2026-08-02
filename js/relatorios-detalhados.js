// ===================================================================
// RELATÓRIOS DETALHADOS — por módulo, com filtros cruzando tabelas
// vinculadas (ex: despesas por licitação, por folha, por credor)
// ===================================================================

async function renderizarRelatoriosDetalhados(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Relatórios Detalhados</h2>
    </div>
    <div class="barra-busca">
      <select id="rd-modulo">
        <option value="licitacoes">Licitações</option>
        <option value="despesas">Processos de Despesa</option>
        <option value="legislacao">Legislação</option>
        <option value="documentosDiversos">Documentos Diversos</option>
        <option value="rh">RH (Pessoal + Atos Administrativos)</option>
      </select>
    </div>
    <div id="rd-area-filtros" class="cartao-manutencao"></div>
    <div id="rd-area-resultado"></div>
  `;

  document.getElementById("rd-modulo").addEventListener("change", montarFiltros);
  await montarFiltros();

  async function montarFiltros() {
    const modulo = document.getElementById("rd-modulo").value;
    const areaFiltros = document.getElementById("rd-area-filtros");
    document.getElementById("rd-area-resultado").innerHTML = "";
    areaFiltros.innerHTML = `<p class="texto-secundario">Carregando opções de filtro...</p>`;

    if (modulo === "licitacoes") {
      const modalidades = await carregarOpcoesSelect("modalidadesLicitacao");
      areaFiltros.innerHTML = `
        <div class="linha-formulario">
          <div><label>Modalidade</label><select id="rd-f-modalidade"><option value="">Todas</option>${montarOpcoesHtml(modalidades)}</select></div>
          <div><label>Ano</label><select id="rd-f-ano">${gerarOpcoesAno()}</select></div>
        </div>
        <button class="botao-primario" id="rd-btn-gerar">Gerar</button>
      `;
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioLicitacoes({
        modalidadeId: document.getElementById("rd-f-modalidade").value,
        ano: document.getElementById("rd-f-ano").value,
      }));
    }

    if (modulo === "despesas") {
      const [licitacoes, folhas, credores, unidades] = await Promise.all([
        colecaoEntidade("licitacoes").orderBy("numeroNormalizado").limit(500).get(),
        carregarOpcoesSelect("folhas"),
        carregarOpcoesSelect("credores"),
        carregarOpcoesSelect("unidadesOrcamentarias"),
      ]);
      const opcoesLicitacoes = licitacoes.docs.map((d) => ({ id: d.id, nome: `${d.data().numero}/${d.data().ano}` }));
      areaFiltros.innerHTML = `
        <div class="linha-formulario">
          <div><label>Licitação vinculada</label><select id="rd-f-licitacao"><option value="">Todas</option>${montarOpcoesHtml(opcoesLicitacoes)}</select></div>
          <div><label>Folha vinculada</label><select id="rd-f-folha"><option value="">Todas</option>${montarOpcoesHtml(folhas)}</select></div>
        </div>
        <div class="linha-formulario">
          <div><label>Credor</label><select id="rd-f-credor"><option value="">Todos</option>${montarOpcoesHtml(credores)}</select></div>
          <div><label>Unidade Orçamentária</label><select id="rd-f-unidade"><option value="">Todas</option>${montarOpcoesHtml(unidades)}</select></div>
        </div>
        <label>Ano</label><select id="rd-f-ano">${gerarOpcoesAno()}</select>
        <button class="botao-primario" id="rd-btn-gerar" style="margin-top:10px">Gerar</button>
      `;
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioDespesas({
        licitacaoId: document.getElementById("rd-f-licitacao").value,
        folhaId: document.getElementById("rd-f-folha").value,
        credorId: document.getElementById("rd-f-credor").value,
        unidadeOrcamentariaId: document.getElementById("rd-f-unidade").value,
        ano: document.getElementById("rd-f-ano").value,
      }));
    }

    if (modulo === "legislacao" || modulo === "documentosDiversos") {
      const tipos = await carregarOpcoesSelect("tiposDocumento");
      areaFiltros.innerHTML = `
        <div class="linha-formulario">
          <div><label>Tipo</label><select id="rd-f-tipo"><option value="">Todos</option>${montarOpcoesHtml(tipos)}</select></div>
          <div><label>Ano</label><select id="rd-f-ano">${gerarOpcoesAno()}</select></div>
        </div>
        <button class="botao-primario" id="rd-btn-gerar">Gerar</button>
      `;
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioTipoNumeroObjeto(modulo, {
        tipoId: document.getElementById("rd-f-tipo").value,
        ano: document.getElementById("rd-f-ano").value,
      }));
    }

    if (modulo === "rh") {
      const [servidores, tiposPessoal, tiposAto] = await Promise.all([
        carregarOpcoesSelect("servidores"),
        carregarOpcoesSelect("tiposDocumentoPessoal"),
        carregarOpcoesSelect("tiposAtoAdministrativo"),
      ]);
      areaFiltros.innerHTML = `
        <div class="linha-formulario">
          <div><label>Servidor</label><select id="rd-f-servidor"><option value="">Todos</option>${montarOpcoesHtml(servidores)}</select></div>
          <div><label>Exercício</label><select id="rd-f-ano">${gerarOpcoesAno()}</select></div>
        </div>
        <label>Tipo de documento (Processos de Pessoal)</label>
        <select id="rd-f-tipo-pessoal"><option value="">Todos</option>${montarOpcoesHtml(tiposPessoal)}</select>
        <label>Tipo de ato (Atos Administrativos)</label>
        <select id="rd-f-tipo-ato"><option value="">Todos</option>${montarOpcoesHtml(tiposAto)}</select>
        <button class="botao-primario" id="rd-btn-gerar" style="margin-top:10px">Gerar</button>
      `;
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioRH({
        servidorId: document.getElementById("rd-f-servidor").value,
        ano: document.getElementById("rd-f-ano").value,
        tipoPessoalId: document.getElementById("rd-f-tipo-pessoal").value,
        tipoAtoId: document.getElementById("rd-f-tipo-ato").value,
      }));
    }
  }
}

/** Monta a tabela de resultado + botão de exportar Excel — reaproveitado pelos 5 relatórios */
function exibirTabelaRelatorio(titulo, colunas, linhas, montarLinhaExportacao) {
  const areaResultado = document.getElementById("rd-area-resultado");
  areaResultado.innerHTML = `
    <h3 style="margin-top:20px">${titulo} (${linhas.length} registro(s))</h3>
    <button class="botao-secundario" id="rd-btn-exportar-excel" ${linhas.length === 0 ? "disabled" : ""}>📥 Exportar Excel</button>
    <table class="tabela-relatorio" style="margin-top:10px">
      <thead><tr>${colunas.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>
        ${linhas.length === 0 ? `<tr><td colspan="${colunas.length}" class="texto-secundario">Nenhum resultado encontrado.</td></tr>` : ""}
        ${linhas.map((linha) => `<tr>${linha.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
  document.getElementById("rd-btn-exportar-excel")?.addEventListener("click", () => {
    const planilha = XLSX.utils.aoa_to_sheet([colunas, ...linhas.map((l) => l.map((celula) => String(celula).replace(/<[^>]*>/g, "")))]);
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, "Relatório");
    XLSX.writeFile(livro, `${titulo.toLowerCase().replace(/\s+/g, "-")}.xlsx`);
  });
}

async function gerarRelatorioLicitacoes(filtros) {
  let registros;
  if (filtros.ano) {
    const snapshot = await colecaoEntidade("licitacoes").where("ano", "==", parseInt(filtros.ano, 10)).get();
    registros = snapshot.docs.map((d) => d.data());
  } else {
    const snapshot = await colecaoEntidade("licitacoes").get();
    registros = snapshot.docs.map((d) => d.data());
  }
  if (filtros.modalidadeId) registros = registros.filter((r) => r.modalidadeId === filtros.modalidadeId);

  exibirTabelaRelatorio(
    "Licitações",
    ["Número/Ano", "Modalidade", "Objeto", "Anexos"],
    registros.map((r) => [`${r.numero}/${r.ano}`, r.modalidadeNome || "-", (r.objeto || "").slice(0, 80), (r.anexos || []).length])
  );
}

async function gerarRelatorioDespesas(filtros) {
  let registros;
  if (filtros.ano) {
    const snapshot = await colecaoEntidade("processosDespesa")
      .orderBy("competenciaKey").startAt(`${filtros.ano}-01`).endAt(`${filtros.ano}-12`).get();
    registros = snapshot.docs.map((d) => d.data());
  } else {
    const snapshot = await colecaoEntidade("processosDespesa").get();
    registros = snapshot.docs.map((d) => d.data());
  }
  if (filtros.licitacaoId) registros = registros.filter((r) => r.licitacaoId === filtros.licitacaoId);
  if (filtros.folhaId) registros = registros.filter((r) => r.folhaId === filtros.folhaId);
  if (filtros.credorId) registros = registros.filter((r) => r.credorId === filtros.credorId);
  if (filtros.unidadeOrcamentariaId) registros = registros.filter((r) => r.unidadeOrcamentariaId === filtros.unidadeOrcamentariaId);

  const totalValor = registros.reduce((soma, r) => soma + (r.valor || 0), 0);
  exibirTabelaRelatorio(
    `Processos de Despesa — Total: ${formatarMoeda(totalValor)}`,
    ["Empenho", "Credor", "Valor", "Data Pagamento", "Licitação", "Folha"],
    registros.map((r) => [
      r.numeroEmpenho, r.credorNome || "-", formatarMoeda(r.valor || 0),
      formatarData(r.dataPagamento), r.licitacaoIdentificador || "-", r.folhaNome || "-",
    ])
  );
}

async function gerarRelatorioTipoNumeroObjeto(nomeColecao, filtros) {
  let registros;
  if (filtros.ano) {
    const snapshot = await colecaoEntidade(nomeColecao).where("ano", "==", parseInt(filtros.ano, 10)).get();
    registros = snapshot.docs.map((d) => d.data());
  } else {
    const snapshot = await colecaoEntidade(nomeColecao).get();
    registros = snapshot.docs.map((d) => d.data());
  }
  if (filtros.tipoId) registros = registros.filter((r) => r.tipoId === filtros.tipoId);

  exibirTabelaRelatorio(
    nomeColecao === "legislacao" ? "Legislação" : "Documentos Diversos",
    ["Tipo", "Número/Ano", "Objeto", "Anexos"],
    registros.map((r) => [r.tipoNome || "-", `${r.numero}${r.ano ? "/" + r.ano : ""}`, (r.objeto || "").slice(0, 80), (r.anexos || []).length])
  );
}

async function gerarRelatorioRH(filtros) {
  const anoNumero = filtros.ano ? parseInt(filtros.ano, 10) : null;

  let consultaPessoal = colecaoEntidade("processosPessoal");
  if (anoNumero) consultaPessoal = consultaPessoal.where("exercicio", "==", anoNumero);
  let consultaAtos = colecaoEntidade("atosAdministrativos");
  if (anoNumero) consultaAtos = consultaAtos.where("exercicio", "==", anoNumero);

  const [snapshotPessoal, snapshotAtos] = await Promise.all([consultaPessoal.get(), consultaAtos.get()]);
  let pessoal = snapshotPessoal.docs.map((d) => d.data());
  let atos = snapshotAtos.docs.map((d) => d.data());

  if (filtros.servidorId) pessoal = pessoal.filter((p) => p.servidorId === filtros.servidorId);
  if (filtros.tipoPessoalId) pessoal = pessoal.filter((p) => p.tipoId === filtros.tipoPessoalId);
  if (filtros.servidorId) atos = atos.filter((a) => (a.servidoresIds || []).includes(filtros.servidorId));
  if (filtros.tipoAtoId) atos = atos.filter((a) => a.tipoId === filtros.tipoAtoId);

  const linhasPessoal = pessoal.map((p) => ["Pessoal", p.tipoNome || "-", p.servidorNome || "-", p.exercicio || "-", (p.observacoes || "").slice(0, 60)]);
  const linhasAtos = atos.map((a) => ["Ato Administrativo", `${a.tipoNome || "-"} nº ${a.numero || ""}`, (a.servidoresNomes || []).join(", ") || "-", a.exercicio || "-", (a.descricao || "").slice(0, 60)]);

  exibirTabelaRelatorio(
    "RH — Pessoal + Atos Administrativos",
    ["Origem", "Tipo", "Servidor(es)", "Exercício", "Descrição"],
    [...linhasPessoal, ...linhasAtos]
  );
}
