// ===================================================================
// RELATÓRIOS DETALHADOS — por módulo, com filtros cruzando tabelas
// vinculadas (ex: despesas por licitação, por folha, por credor)
// ===================================================================

/**
 * Monta um filtro de múltipla seleção com busca — mostra um campo de
 * texto pra filtrar a lista, checkboxes pra marcar mais de uma opção, e
 * uma informação extra ao lado do nome (ex: CNPJ do credor, número da
 * licitação) pra não deixar dúvida de qual registro é qual quando tem
 * nomes parecidos.
 */
function montarFiltroMultiSelect(idBase, rotulo, opcoes) {
  return `
    <div class="filtro-multi-select">
      <label>${rotulo}</label>
      <input type="text" id="${idBase}-busca" placeholder="Digite pra buscar e marcar..." autocomplete="off">
      <div class="lista-checkboxes lista-filtro-multi" id="${idBase}-lista" style="max-height:180px">
        ${opcoes.map((o) => `
          <label class="item-checkbox">
            <input type="checkbox" value="${o.id}" data-texto-busca="${normalizarTexto(o.nome + " " + (o.extra || ""))}">
            ${o.nome}${o.extra ? ` <span class="texto-secundario">— ${o.extra}</span>` : ""}
          </label>
        `).join("")}
      </div>
      <p class="texto-secundario contagem-filtro-multi" id="${idBase}-contagem">Todos (nenhum marcado = sem filtro).</p>
    </div>
  `;
}

/** Liga a busca e a contagem de um filtro multi-select já inserido no DOM */
function ligarFiltroMultiSelect(idBase) {
  const campoBusca = document.getElementById(`${idBase}-busca`);
  const lista = document.getElementById(`${idBase}-lista`);
  const contagem = document.getElementById(`${idBase}-contagem`);
  campoBusca?.addEventListener("input", () => {
    const termo = normalizarTexto(campoBusca.value);
    lista.querySelectorAll(".item-checkbox").forEach((label) => {
      const dadosBusca = label.querySelector("input").dataset.textoBusca;
      label.classList.toggle("oculto", termo && !dadosBusca.includes(termo));
    });
  });
  lista?.addEventListener("change", () => {
    const total = lista.querySelectorAll("input:checked").length;
    contagem.textContent = total > 0 ? `${total} marcado(s).` : "Todos (nenhum marcado = sem filtro).";
  });
}

/** Lê os IDs marcados de um filtro multi-select (vazio = sem filtro, retorna null) */
function lerFiltroMultiSelect(idBase) {
  const marcados = [...document.querySelectorAll(`#${idBase}-lista input:checked`)].map((c) => c.value);
  return marcados.length > 0 ? marcados : null;
}

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
          ${montarFiltroMultiSelect("rd-f-modalidade", "Modalidade", modalidades)}
          <div><label>Ano</label><select id="rd-f-ano">${gerarOpcoesAno()}</select></div>
        </div>
        <button class="botao-primario" id="rd-btn-gerar" style="margin-top:10px">Gerar</button>
      `;
      ligarFiltroMultiSelect("rd-f-modalidade");
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioLicitacoes({
        modalidadeIds: lerFiltroMultiSelect("rd-f-modalidade"),
        ano: document.getElementById("rd-f-ano").value,
      }));
    }

    if (modulo === "despesas") {
      const [licitacoesSnap, folhas, credores, unidades] = await Promise.all([
        colecaoEntidade("licitacoes").orderBy("numeroNormalizado").limit(500).get(),
        carregarOpcoesSelect("folhas"),
        carregarOpcoesSelect("credores"),
        carregarOpcoesSelect("unidadesOrcamentarias"),
      ]);
      const opcoesLicitacoes = licitacoesSnap.docs.map((d) => ({ id: d.id, nome: `${d.data().numero}/${d.data().ano}`, extra: (d.data().modalidadeNome || "") }));
      const opcoesFolhas = folhas.map((f) => ({ ...f, extra: "" }));
      const opcoesCredores = credores.map((c) => ({ id: c.id, nome: c.nome, extra: c.documento || "" }));
      const opcoesUnidades = unidades.map((u) => ({ ...u, extra: u.codigo || "" }));

      areaFiltros.innerHTML = `
        <div class="linha-formulario">
          ${montarFiltroMultiSelect("rd-f-licitacao", "Licitação vinculada", opcoesLicitacoes)}
          ${montarFiltroMultiSelect("rd-f-folha", "Folha vinculada", opcoesFolhas)}
        </div>
        <div class="linha-formulario">
          ${montarFiltroMultiSelect("rd-f-credor", "Credor", opcoesCredores)}
          ${montarFiltroMultiSelect("rd-f-unidade", "Unidade Orçamentária", opcoesUnidades)}
        </div>
        <label>Ano</label><select id="rd-f-ano">${gerarOpcoesAno()}</select>
        <button class="botao-primario" id="rd-btn-gerar" style="margin-top:10px">Gerar</button>
      `;
      ["rd-f-licitacao", "rd-f-folha", "rd-f-credor", "rd-f-unidade"].forEach(ligarFiltroMultiSelect);
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioDespesas({
        licitacaoIds: lerFiltroMultiSelect("rd-f-licitacao"),
        folhaIds: lerFiltroMultiSelect("rd-f-folha"),
        credorIds: lerFiltroMultiSelect("rd-f-credor"),
        unidadeOrcamentariaIds: lerFiltroMultiSelect("rd-f-unidade"),
        ano: document.getElementById("rd-f-ano").value,
      }));
    }

    if (modulo === "legislacao" || modulo === "documentosDiversos") {
      const tipos = await carregarOpcoesSelect("tiposDocumento");
      areaFiltros.innerHTML = `
        <div class="linha-formulario">
          ${montarFiltroMultiSelect("rd-f-tipo", "Tipo", tipos)}
          <div><label>Ano</label><select id="rd-f-ano">${gerarOpcoesAno()}</select></div>
        </div>
        <button class="botao-primario" id="rd-btn-gerar" style="margin-top:10px">Gerar</button>
      `;
      ligarFiltroMultiSelect("rd-f-tipo");
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioTipoNumeroObjeto(modulo, {
        tipoIds: lerFiltroMultiSelect("rd-f-tipo"),
        ano: document.getElementById("rd-f-ano").value,
      }));
    }

    if (modulo === "rh") {
      const [servidores, tiposPessoal, tiposAto] = await Promise.all([
        carregarOpcoesSelect("servidores"),
        carregarOpcoesSelect("tiposDocumentoPessoal"),
        carregarOpcoesSelect("tiposAtoAdministrativo"),
      ]);
      const opcoesServidores = servidores.map((s) => ({ ...s, extra: s.matricula || "" }));
      areaFiltros.innerHTML = `
        <div class="linha-formulario">
          ${montarFiltroMultiSelect("rd-f-servidor", "Servidor", opcoesServidores)}
          <div><label>Exercício</label><select id="rd-f-ano">${gerarOpcoesAno()}</select></div>
        </div>
        <div class="linha-formulario">
          ${montarFiltroMultiSelect("rd-f-tipo-pessoal", "Tipo (Processos de Pessoal)", tiposPessoal)}
          ${montarFiltroMultiSelect("rd-f-tipo-ato", "Tipo (Atos Administrativos)", tiposAto)}
        </div>
        <button class="botao-primario" id="rd-btn-gerar" style="margin-top:10px">Gerar</button>
      `;
      ["rd-f-servidor", "rd-f-tipo-pessoal", "rd-f-tipo-ato"].forEach(ligarFiltroMultiSelect);
      document.getElementById("rd-btn-gerar").addEventListener("click", () => gerarRelatorioRH({
        servidorIds: lerFiltroMultiSelect("rd-f-servidor"),
        ano: document.getElementById("rd-f-ano").value,
        tipoPessoalIds: lerFiltroMultiSelect("rd-f-tipo-pessoal"),
        tipoAtoIds: lerFiltroMultiSelect("rd-f-tipo-ato"),
      }));
    }
  }
}

/** Monta a tabela de resultado + botão de exportar Excel — reaproveitado pelos 5 relatórios */
function exibirTabelaRelatorio(titulo, colunas, linhas, montarLinhaExportacao) {
  const areaResultado = document.getElementById("rd-area-resultado");
  areaResultado.innerHTML = `
    <h3 style="margin-top:20px">${titulo} (${linhas.length} registro(s))</h3>
    <div class="acoes-cabecalho">
      <button class="botao-secundario" id="rd-btn-exportar-excel" ${linhas.length === 0 ? "disabled" : ""}>📥 Exportar Excel</button>
      <button class="botao-secundario" id="rd-btn-exportar-pdf" ${linhas.length === 0 ? "disabled" : ""}>📄 Exportar PDF</button>
    </div>
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
  document.getElementById("rd-btn-exportar-pdf")?.addEventListener("click", () => {
    exportarRelatorioDetalhadoPdf(titulo, colunas, linhas);
  });
}

/** Gera o PDF de um Relatório Detalhado, com o mesmo cabeçalho (logo + dados da unidade gestora) usado no Relatório Anual */
function exportarRelatorioDetalhadoPdf(titulo, colunas, linhas) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = desenharCabecalhoPdf(doc, titulo);

  doc.setFontSize(8);
  const larguraUtil = 182;
  const xInicial = 14;

  // Colunas com texto tipicamente longo (Objeto, Descrição, nomes...)
  // ganham mais espaço; colunas curtas (Número, Ano, Valor, Anexos...)
  // ficam mais estreitas — em vez de dividir tudo igual, o que
  // espremia o texto longo pra fora da coluna.
  const PALAVRAS_COLUNA_LARGA = ["objeto", "descri", "credor", "servidor", "folha", "licita", "empenho"];
  const pesos = colunas.map((c) => {
    const nomeMinusculo = c.toLowerCase();
    return PALAVRAS_COLUNA_LARGA.some((p) => nomeMinusculo.includes(p)) ? 2.2 : 1;
  });
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  const larguras = pesos.map((p) => (p / somaPesos) * larguraUtil);
  const posicoesX = [];
  let acumulado = xInicial;
  larguras.forEach((l) => { posicoesX.push(acumulado); acumulado += l; });

  function desenharCabecalhoTabela() {
    doc.setFillColor(238, 244, 251);
    doc.rect(xInicial, y - 5, larguraUtil, 7, "F");
    doc.setFontSize(8);
    doc.setTextColor(15, 41, 71);
    colunas.forEach((col, i) => doc.text(String(col), posicoesX[i] + 2, y));
    y += 7;
    doc.setTextColor(60, 60, 60);
  }

  desenharCabecalhoTabela();
  linhas.forEach((linha) => {
    // Quebra cada célula dentro da largura real da sua coluna, em vez
    // de só cortar o texto em 40 caracteres — assim nada fica escondido.
    const celulasQuebradas = linha.map((valor, i) => {
      const texto = String(valor).replace(/<[^>]*>/g, "");
      return doc.splitTextToSize(texto, larguras[i] - 4);
    });
    const linhasNestaCelula = Math.max(...celulasQuebradas.map((c) => c.length), 1);
    const alturaLinha = linhasNestaCelula * 4.2 + 2;

    if (y + alturaLinha > 285) {
      doc.addPage();
      y = 20;
      desenharCabecalhoTabela();
    }

    celulasQuebradas.forEach((textoQuebrado, i) => {
      doc.text(textoQuebrado, posicoesX[i] + 2, y);
    });
    y += alturaLinha;
  });

  desenharRodapePdf(doc);
  doc.save(`${titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`);
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
  if (filtros.modalidadeIds) registros = registros.filter((r) => filtros.modalidadeIds.includes(r.modalidadeId));

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
  if (filtros.licitacaoIds) registros = registros.filter((r) => filtros.licitacaoIds.includes(r.licitacaoId));
  if (filtros.folhaIds) registros = registros.filter((r) => filtros.folhaIds.includes(r.folhaId));
  if (filtros.credorIds) registros = registros.filter((r) => filtros.credorIds.includes(r.credorId));
  if (filtros.unidadeOrcamentariaIds) registros = registros.filter((r) => filtros.unidadeOrcamentariaIds.includes(r.unidadeOrcamentariaId));

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
  if (filtros.tipoIds) registros = registros.filter((r) => filtros.tipoIds.includes(r.tipoId));

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

  if (filtros.servidorIds) pessoal = pessoal.filter((p) => filtros.servidorIds.includes(p.servidorId));
  if (filtros.tipoPessoalIds) pessoal = pessoal.filter((p) => filtros.tipoPessoalIds.includes(p.tipoId));
  if (filtros.servidorIds) atos = atos.filter((a) => (a.servidoresIds || []).some((id) => filtros.servidorIds.includes(id)));
  if (filtros.tipoAtoIds) atos = atos.filter((a) => filtros.tipoAtoIds.includes(a.tipoId));

  const linhasPessoal = pessoal.map((p) => ["Pessoal", p.tipoNome || "-", p.servidorNome || "-", p.exercicio || "-", (p.observacoes || "").slice(0, 60)]);
  const linhasAtos = atos.map((a) => ["Ato Administrativo", `${a.tipoNome || "-"} nº ${a.numero || ""}`, (a.servidoresNomes || []).join(", ") || "-", a.exercicio || "-", (a.descricao || "").slice(0, 60)]);

  exibirTabelaRelatorio(
    "RH — Pessoal + Atos Administrativos",
    ["Origem", "Tipo", "Servidor(es)", "Exercício", "Descrição"],
    [...linhasPessoal, ...linhasAtos]
  );
}
