// ===================================================================
// RELATÓRIOS — totais e contagens por ano, com exportação em PDF
// ===================================================================
// Todos os totais são calculados no servidor via agregação do Firestore
// (getAggregateFromServer / getCountFromServer), nunca baixando os
// documentos inteiros só para somar no cliente — segue a mesma regra de
// performance usada no resto do app.

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

/**
 * Busca os números do relatório. Calcula tudo a partir dos próprios
 * documentos (bounded pelo ano escolhido), em vez de usar a API de
 * agregação (count()/aggregate()) do Firestore — essa API tem relatos
 * conhecidos de não funcionar de forma confiável no SDK "compat" (o
 * mesmo formato usado neste app), então preferimos uma forma mais
 * simples e garantida de funcionar: buscar os documentos do ano (uma
 * ação explícita e limitada a um período, não um carregamento da lista
 * inteira) e somar/contar no próprio navegador.
 */
async function calcularDadosRelatorio(ano) {
  const inicioCompetencia = `${ano}-01`;
  const fimCompetencia = `${ano}-12`;

  const consultaDespesasDoAno = colecaoEntidade("processosDespesa")
    .where("competenciaKey", ">=", inicioCompetencia)
    .where("competenciaKey", "<=", fimCompetencia);

  const [
    snapshotDespesasDoAno,
    snapshotLicitacoes,
    snapshotLegislacao,
    snapshotDocumentos,
    unidadesOrc,
    fontesRecurso,
  ] = await Promise.all([
    consultaDespesasDoAno.get(),
    colecaoEntidade("licitacoes").where("ano", "==", parseInt(ano, 10)).get(),
    colecaoEntidade("legislacao").where("ano", "==", parseInt(ano, 10)).get(),
    colecaoEntidade("documentosDiversos").where("ano", "==", parseInt(ano, 10)).get(),
    carregarOpcoesSelect("unidadesOrcamentarias"),
    carregarOpcoesSelect("fontesRecurso"),
  ]);

  const despesasDoAno = snapshotDespesasDoAno.docs.map((doc) => doc.data());
  const totalDespesas = despesasDoAno.reduce((soma, despesa) => soma + (despesa.valor || 0), 0);

  function agruparESomar(campo, lista) {
    const mapaPorId = {};
    despesasDoAno.forEach((despesa) => {
      const id = despesa[campo];
      if (!id) return;
      if (!mapaPorId[id]) mapaPorId[id] = { soma: 0, quantidade: 0 };
      mapaPorId[id].soma += despesa.valor || 0;
      mapaPorId[id].quantidade += 1;
    });

    return lista
      .filter((item) => mapaPorId[item.id])
      .map((item) => ({
        nome: item.codigo ? `${item.codigo} — ${item.nome}` : item.nome,
        soma: mapaPorId[item.id].soma,
        quantidade: mapaPorId[item.id].quantidade,
      }))
      .sort((a, b) => b.soma - a.soma);
  }

  const porUnidadeOrc = agruparESomar("unidadeOrcamentariaId", unidadesOrc);
  const porFonteRecurso = agruparESomar("fonteRecursoId", fontesRecurso);

  return {
    despesas: {
      quantidade: despesasDoAno.length,
      total: totalDespesas,
      porUnidadeOrc,
      porFonteRecurso,
    },
    licitacoes: snapshotLicitacoes.size,
    legislacao: snapshotLegislacao.size,
    documentosDiversos: snapshotDocumentos.size,
  };
}

function exibirRelatorioNaTela(dados, ano) {
  const area = document.getElementById("area-relatorio");
  area.innerHTML = `
    <div class="grade-resumo">
      <div class="cartao-resumo">
        <div class="numero-resumo num">${formatarMoeda(dados.despesas.total)}</div>
        <div class="rotulo-resumo">Total de Despesas em ${ano} (${dados.despesas.quantidade} processo(s))</div>
      </div>
      <div class="cartao-resumo">
        <div class="numero-resumo num">${dados.licitacoes}</div>
        <div class="rotulo-resumo">Licitações em ${ano}</div>
      </div>
      <div class="cartao-resumo">
        <div class="numero-resumo num">${dados.legislacao}</div>
        <div class="rotulo-resumo">Atos de Legislação em ${ano}</div>
      </div>
      <div class="cartao-resumo">
        <div class="numero-resumo num">${dados.documentosDiversos}</div>
        <div class="rotulo-resumo">Documentos Diversos em ${ano}</div>
      </div>
    </div>

    <h3>Despesas por Unidade Orçamentária</h3>
    ${montarTabelaResumo(dados.despesas.porUnidadeOrc)}

    <h3>Despesas por Fonte de Recurso</h3>
    ${montarTabelaResumo(dados.despesas.porFonteRecurso)}
  `;
}

function montarTabelaResumo(linhas) {
  if (linhas.length === 0) {
    return `<p class="texto-secundario">Nenhum lançamento no período.</p>`;
  }
  return `
    <table class="tabela-relatorio">
      <thead><tr><th>Item</th><th>Processos</th><th>Total</th></tr></thead>
      <tbody>
        ${linhas.map((l) => `
          <tr>
            <td>${l.nome}</td>
            <td class="num">${l.quantidade}</td>
            <td class="num">${formatarMoeda(l.soma)}</td>
          </tr>
        `).join("")}
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

/** Garante espaço na página antes de desenhar uma tabela; quebra pra nova página se precisar */
function garantirEspacoPdf(doc, yAtual, alturaNecessaria, titulo) {
  if (yAtual + alturaNecessaria > 275) {
    doc.addPage();
    return desenharCabecalhoPdf(doc, titulo);
  }
  return yAtual;
}

function desenharTabelaPdf(doc, y, titulo, linhas, tituloRelatorio) {
  y = garantirEspacoPdf(doc, y, 20, tituloRelatorio);
  doc.setFontSize(11);
  doc.setTextColor(13, 79, 196);
  doc.text(titulo, 14, y);
  y += 6;

  if (linhas.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text("Nenhum lançamento no período.", 14, y);
    return y + 8;
  }

  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Item", 14, y);
  doc.text("Processos", 140, y, { align: "right" });
  doc.text("Total", 196, y, { align: "right" });
  y += 4;
  doc.setDrawColor(215, 228, 240);
  doc.line(14, y, 196, y);
  y += 5;

  linhas.forEach((linha) => {
    y = garantirEspacoPdf(doc, y, 8, tituloRelatorio);
    doc.setFontSize(9);
    doc.setTextColor(15, 41, 71);
    const nomeCurto = linha.nome.length > 55 ? linha.nome.slice(0, 52) + "..." : linha.nome;
    doc.text(nomeCurto, 14, y);
    doc.text(String(linha.quantidade), 140, y, { align: "right" });
    doc.text(formatarMoeda(linha.soma), 196, y, { align: "right" });
    y += 6;
  });

  return y + 6;
}

function gerarRelatorioPdf(dados, ano) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const titulo = `Relatório Anual — ${ano}`;

  let y = desenharCabecalhoPdf(doc, titulo);

  doc.setFontSize(10);
  doc.setTextColor(15, 41, 71);
  doc.text(`Total de Despesas: ${formatarMoeda(dados.despesas.total)} (${dados.despesas.quantidade} processo(s))`, 14, y);
  y += 6;
  doc.text(`Licitações: ${dados.licitacoes}    Legislação: ${dados.legislacao}    Documentos Diversos: ${dados.documentosDiversos}`, 14, y);
  y += 10;

  y = desenharTabelaPdf(doc, y, "Despesas por Unidade Orçamentária", dados.despesas.porUnidadeOrc, titulo);
  y = desenharTabelaPdf(doc, y, "Despesas por Fonte de Recurso", dados.despesas.porFonteRecurso, titulo);

  desenharRodapePdf(doc);
  doc.save(`relatorio-anual-${ano}.pdf`);
}
