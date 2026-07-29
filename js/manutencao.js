// ===================================================================
// MANUTENÇÃO — reindexação em massa (só administrador)
// ===================================================================
// Sempre que um campo de busca novo é adicionado ao sistema (ex:
// numeroEmpenhoNormalizado), registros cadastrados antes dessa mudança
// não têm esse campo gravado, e ficam "invisíveis" pra busca até serem
// salvos de novo. Abrir um por um não é viável com muitos registros —
// essa tela varre a coleção inteira e corrige em lote.

async function renderizarManutencao(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Manutenção</h2>
    </div>
    <p class="texto-secundario">
      Ferramentas para corrigir registros cadastrados antes de alguma
      atualização do sistema, sem precisar abrir um por um.
    </p>

    <div class="cartao-manutencao">
      <h3>Reindexar campos de busca — Processos de Despesa</h3>
      <p class="texto-secundario">
        Preenche os campos internos usados na busca (número do empenho,
        ordem de pagamento, credor, objeto) em processos de despesa que
        foram cadastrados antes desses campos existirem. Não altera
        nenhum dado visível do registro, só os campos de apoio à busca.
      </p>
      <button class="botao-primario" id="btn-reindexar-despesas">Reindexar Processos de Despesa</button>
      <div id="resultado-despesas" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>Preencher Ano — Legislação e Documentos Diversos</h3>
      <p class="texto-secundario">
        Esses dois módulos ganharam o campo "Ano" depois de já existirem
        registros cadastrados. Esta ferramenta tenta descobrir o ano
        automaticamente a partir do número (quando estiver no formato
        "123/2026", por exemplo). Registros em que não for possível
        identificar o ano automaticamente ficam listados para você
        preencher manualmente.
      </p>
      <button class="botao-primario" id="btn-reindexar-legislacao">Preencher Ano — Legislação</button>
      <div id="resultado-legislacao" class="resultado-manutencao"></div>
      <button class="botao-primario" id="btn-reindexar-documentos" style="margin-top:10px">Preencher Ano — Documentos Diversos</button>
      <div id="resultado-documentos" class="resultado-manutencao"></div>
    </div>
  `;

  document.getElementById("btn-reindexar-despesas").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os processos de despesa da unidade gestora atual. Pode levar alguns segundos dependendo da quantidade. Continuar?")) return;
    await executarComFeedback(evento.target, async () => {
      const resultado = await reindexarDespesas();
      document.getElementById("resultado-despesas").innerHTML = `
        <p>✅ ${resultado.totalRevisados} registro(s) revisado(s), ${resultado.totalAtualizados} atualizado(s).</p>
      `;
      mostrarToast("Reindexação de despesas concluída.", "sucesso");
    }, "Reindexando...");
  });

  document.getElementById("btn-reindexar-legislacao").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os registros de Legislação da unidade gestora atual. Continuar?")) return;
    await executarComFeedback(evento.target, async () => {
      const resultado = await preencherAnoAutomatico("legislacao");
      exibirResultadoAno("resultado-legislacao", resultado);
      mostrarToast("Preenchimento de ano (Legislação) concluído.", "sucesso");
    }, "Processando...");
  });

  document.getElementById("btn-reindexar-documentos").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os registros de Documentos Diversos da unidade gestora atual. Continuar?")) return;
    await executarComFeedback(evento.target, async () => {
      const resultado = await preencherAnoAutomatico("documentosDiversos");
      exibirResultadoAno("resultado-documentos", resultado);
      mostrarToast("Preenchimento de ano (Documentos Diversos) concluído.", "sucesso");
    }, "Processando...");
  });
}

function exibirResultadoAno(idElemento, resultado) {
  const el = document.getElementById(idElemento);
  el.innerHTML = `
    <p>✅ ${resultado.totalRevisados} registro(s) revisado(s), ${resultado.totalAtualizados} preenchido(s) automaticamente.</p>
    ${
      resultado.naoIdentificados.length > 0
        ? `<p>⚠️ ${resultado.naoIdentificados.length} registro(s) sem ano identificável — precisam ser preenchidos manualmente:</p>
           <div class="lista-erros-importacao">${resultado.naoIdentificados.map((n) => `<div>${n}</div>`).join("")}</div>`
        : ""
    }
  `;
}

/**
 * Varre todos os processos de despesa e recalcula os campos normalizados
 * de busca a partir dos dados que já existem no registro (não pede nada
 * novo ao usuário, só corrige o que já deveria ter sido salvo).
 */
async function reindexarDespesas() {
  const snapshot = await colecaoEntidade("processosDespesa").get();
  const documentosParaAtualizar = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const atualizacao = {};

    const numeroEmpenhoNormalizadoEsperado = normalizarTexto(dados.numeroEmpenho || "");
    if (dados.numeroEmpenhoNormalizado !== numeroEmpenhoNormalizadoEsperado) {
      atualizacao.numeroEmpenhoNormalizado = numeroEmpenhoNormalizadoEsperado;
    }

    const ordemPagamentoNormalizadoEsperado = normalizarTexto(dados.ordemPagamento || "");
    if (dados.ordemPagamentoNormalizado !== ordemPagamentoNormalizadoEsperado) {
      atualizacao.ordemPagamentoNormalizado = ordemPagamentoNormalizadoEsperado;
    }

    const credorNomeNormalizadoEsperado = normalizarTexto(dados.credorNome || "");
    if (dados.credorNomeNormalizado !== credorNomeNormalizadoEsperado) {
      atualizacao.credorNomeNormalizado = credorNomeNormalizadoEsperado;
    }

    const objetoNormalizadoEsperado = normalizarTexto(dados.objeto || "");
    if (dados.objetoNormalizado !== objetoNormalizadoEsperado) {
      atualizacao.objetoNormalizado = objetoNormalizadoEsperado;
    }

    // Aproveita e corrige a competenciaKey também, se a data existir mas a chave não bater
    if (dados.dataPagamento) {
      const competenciaEsperada = dados.dataPagamento.slice(0, 7);
      if (dados.competenciaKey !== competenciaEsperada) {
        atualizacao.competenciaKey = competenciaEsperada;
      }
    }

    if (Object.keys(atualizacao).length > 0) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao });
    }
  });

  await aplicarAtualizacoesEmLotes("processosDespesa", documentosParaAtualizar);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
  };
}

/**
 * Varre Legislação ou Documentos Diversos procurando registros sem o
 * campo "ano", e tenta descobrir o ano a partir do número (formato
 * comum "123/2026"). Quando não consegue, lista o registro pra
 * preenchimento manual.
 */
async function preencherAnoAutomatico(nomeColecao) {
  const snapshot = await colecaoEntidade(nomeColecao).get();
  const documentosParaAtualizar = [];
  const naoIdentificados = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    if (dados.ano) return; // já tem ano, não mexe

    const correspondencia = (dados.numero || "").match(/(\d{4})/);
    const anoEncontrado = correspondencia ? parseInt(correspondencia[1], 10) : null;
    const anoValido = anoEncontrado && anoEncontrado >= 1990 && anoEncontrado <= new Date().getFullYear() + 1;

    if (anoValido) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao: { ano: anoEncontrado } });
    } else {
      naoIdentificados.push(`${dados.numero || "(sem número)"} — ${(dados.objeto || "").slice(0, 60)}`);
    }
  });

  await aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
    naoIdentificados,
  };
}

/** Aplica uma lista de atualizações parciais em lotes (nunca documento por documento em sequência) */
async function aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar) {
  const TAMANHO_LOTE = 400;
  for (let inicio = 0; inicio < documentosParaAtualizar.length; inicio += TAMANHO_LOTE) {
    const lote = db.batch();
    const fatia = documentosParaAtualizar.slice(inicio, inicio + TAMANHO_LOTE);
    fatia.forEach(({ id, atualizacao }) => {
      lote.update(colecaoEntidade(nomeColecao).doc(id), atualizacao);
    });
    await lote.commit();
  }
}
