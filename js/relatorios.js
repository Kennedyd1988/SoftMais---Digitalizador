// ===================================================================
// RELATÓRIOS — registros, arquivos anexados e páginas, por tipo e ano
// ===================================================================
// Os números são calculados a partir dos documentos do ano escolhido
// (busca explícita e limitada a um período, não um carregamento da
// lista inteira), somando no navegador em vez de depender da API de
// agregação do Firestore — que tem relatos conhecidos de não funcionar
// de forma confiável no SDK "compat" usado neste app.

async function renderizarRelatorios(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Relatórios</h2>
    </div>
    <div class="barra-busca">
      <select id="filtro-ano-relatorio" class="filtro-ano">
        ${gerarOpcoesAnoObrigatorio()}
      </select>
      <button class="botao-primario" id="btn-gerar-relatorio">Gerar Relatório</button>
      <button class="botao-secundario oculto" id="btn-exportar-pdf">📄 Exportar PDF</button>
    </div>
    <div id="area-relatorio"></div>
  `;

  document.getElementById("btn-gerar-relatorio").addEventListener("click", async () => {
    const ano = document.getElementById("filtro-ano-relatorio").value;
    const botao = document.getElementById("btn-gerar-relatorio");
    await executarComFeedback(botao, async () => {
      try {
        const dados = await calcularDadosRelatorio(ano);
        exibirRelatorioNaTela(dados, ano);
        document.getElementById("btn-exportar-pdf").classList.remove("oculto");
        document.getElementById("btn-exportar-pdf").onclick = () => gerarRelatorioPdf(dados, ano);
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, "Calculando...");
  });

  // Já carrega o ano atual automaticamente ao abrir a aba
  document.getElementById("btn-gerar-relatorio").click();
}

/** Gera as opções de ano sem a opção "Todos" (relatório sempre é de um ano específico) */
function gerarOpcoesAnoObrigatorio() {
  const anoAtual = new Date().getFullYear();
  let html = "";
  for (let ano = anoAtual + 1; ano >= anoAtual - 15; ano--) {
    html += `<option value="${ano}" ${ano === anoAtual ? "selected" : ""}>${ano}</option>`;
  }
  return html;
}

const ROTULOS_MODULOS = {
  despesas: "Processos de Despesa",
  licitacoes: "Licitações",
  legislacao: "Legislação",
  documentosDiversos: "Documentos Diversos",
};

/** Soma quantidade de registros, de arquivos anexados e de páginas de uma lista de documentos */
function resumirModulo(listaDeDocumentos) {
  let quantidadeArquivos = 0;
  let quantidadePaginas = 0;

  listaDeDocumentos.forEach((dados) => {
    const anexos = dados.anexos || [];
    quantidadeArquivos += anexos.length;
    quantidadePaginas += anexos.reduce((soma, anexo) => soma + (anexo.paginas || 0), 0);
  });

  return {
    quantidadeRegistros: listaDeDocumentos.length,
    quantidadeArquivos,
    quantidadePaginas,
  };
}

async function calcularDadosRelatorio(ano) {
  const inicioCompetencia = `${ano}-01`;
  const fimCompetencia = `${ano}-12`;
  const anoNumero = parseInt(ano, 10);

  const [snapshotDespesas, snapshotLicitacoes, snapshotLegislacao, snapshotDocumentos] = await Promise.all([
    colecaoEntidade("processosDespesa")
      .where("competenciaKey", ">=", inicioCompetencia)
      .where("competenciaKey", "<=", fimCompetencia)
      .get(),
    colecaoEntidade("licitacoes").where("ano", "==", anoNumero).get(),
    colecaoEntidade("legislacao").where("ano", "==", anoNumero).get(),
    colecaoEntidade("documentosDiversos").where("ano", "==", anoNumero).get(),
  ]);

  return {
    despesas: resumirModulo(snapshotDespesas.docs.map((doc) => doc.data())),
    licitacoes: resumirModulo(snapshotLicitacoes.docs.map((doc) => doc.data())),
    legislacao: resumirModulo(snapshotLegislacao.docs.map((doc) => doc.data())),
    documentosDiversos: resumirModulo(snapshotDocumentos.docs.map((doc) => doc.data())),
  };
}

function exibirRelatorioNaTela(dados, ano) {
  const area = document.getElementById("area-relatorio");
  const chaves = ["despesas", "licitacoes", "legislacao", "documentosDiversos"];

  const totalRegistros = chaves.reduce((soma, chave) => soma + dados[chave].quantidadeRegistros, 0);
  const totalArquivos = chaves.reduce((soma, chave) => soma + dados[chave].quantidadeArquivos, 0);
  const totalPaginas = chaves.reduce((soma, chave) => soma + dados[chave].quantidadePaginas, 0);

  area.innerHTML = `
    <h3>Resumo de ${ano}</h3>
    <table class="tabela-relatorio">
      <thead>
        <tr><th>Tipo</th><th>Registros</th><th>Arquivos Anexados</th><th>Páginas</th></tr>
      </thead>
      <tbody>
        ${chaves.map((chave) => `
          <tr>
            <td>${ROTULOS_MODULOS[chave]}</td>
            <td class="num">${dados[chave].quantidadeRegistros}</td>
            <td class="num">${dados[chave].quantidadeArquivos}</td>
            <td class="num">${dados[chave].quantidadePaginas}</td>
          </tr>
        `).join("")}
        <tr class="linha-total-relatorio">
          <td>Total</td>
          <td class="num">${totalRegistros}</td>
          <td class="num">${totalArquivos}</td>
          <td class="num">${totalPaginas}</td>
        </tr>
      </tbody>
    </table>
  `;
}

// -------------------------------------------------------------
// GERAÇÃO DO PDF
// -------------------------------------------------------------

/** Desenha o cabeçalho padrão (logo + título) no topo da página atual do PDF */
function desenharCabecalhoPdf(doc, titulo) {
  doc.setFontSize(16);
  doc.setTextColor(13, 79, 196); // azul da marca
  doc.text("SOFT+", 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text("Indexação de Documentos", 32, 18);

  doc.setFontSize(13);
  doc.setTextColor(15, 41, 71);
  doc.text(titulo, 14, 30);

  doc.setDrawColor(215, 228, 240);
  doc.line(14, 34, 196, 34);
  return 42; // posição Y onde o conteúdo pode começar
}

/** Desenha o rodapé padrão (data de geração + numeração de página) */
function desenharRodapePdf(doc) {
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let pagina = 1; pagina <= totalPaginas; pagina++) {
    doc.setPage(pagina);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")} — ${estado.entidadeAtualNome}`,
      14,
      289
    );
    doc.text(`Página ${pagina} de ${totalPaginas}`, 180, 289);
  }
}

function gerarRelatorioPdf(dados, ano) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const titulo = `Relatório Anual — ${ano}`;
  const chaves = ["despesas", "licitacoes", "legislacao", "documentosDiversos"];

  let y = desenharCabecalhoPdf(doc, titulo);

  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Tipo", 14, y);
  doc.text("Registros", 120, y, { align: "right" });
  doc.text("Arquivos", 155, y, { align: "right" });
  doc.text("Páginas", 196, y, { align: "right" });
  y += 4;
  doc.setDrawColor(215, 228, 240);
  doc.line(14, y, 196, y);
  y += 6;

  let totalRegistros = 0, totalArquivos = 0, totalPaginas = 0;

  chaves.forEach((chave) => {
    const item = dados[chave];
    totalRegistros += item.quantidadeRegistros;
    totalArquivos += item.quantidadeArquivos;
    totalPaginas += item.quantidadePaginas;

    doc.setFontSize(10);
    doc.setTextColor(15, 41, 71);
    doc.text(ROTULOS_MODULOS[chave], 14, y);
    doc.text(String(item.quantidadeRegistros), 120, y, { align: "right" });
    doc.text(String(item.quantidadeArquivos), 155, y, { align: "right" });
    doc.text(String(item.quantidadePaginas), 196, y, { align: "right" });
    y += 7;
  });

  doc.setDrawColor(215, 228, 240);
  doc.line(14, y, 196, y);
  y += 6;

  doc.setFontSize(10);
  doc.setTextColor(13, 79, 196);
  doc.text("Total", 14, y);
  doc.text(String(totalRegistros), 120, y, { align: "right" });
  doc.text(String(totalArquivos), 155, y, { align: "right" });
  doc.text(String(totalPaginas), 196, y, { align: "right" });

  desenharRodapePdf(doc);
  doc.save(`relatorio-anual-${ano}.pdf`);
}
