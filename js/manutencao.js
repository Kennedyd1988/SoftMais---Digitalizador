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
      <h3>🔧 Corrigir Anexos Migrados do AppSheet</h3>
      <p class="texto-secundario">
        Os anexos trazidos pela migração do AppSheet apontam pro arquivo
        <strong>original</strong>, que o app não criou — por isso, depois
        de trocar o Refresh Token de volta pra um com permissão normal
        (drive.file), eles param de abrir ("Não foi possível baixar o
        documento"). Esta ferramenta baixa cada anexo migrado e reenvia
        pra dentro da estrutura própria do app — a partir daí, o arquivo
        passa a ser "do app" de vez, e continua funcionando mesmo com o
        Refresh Token normal.
        <strong>Precisa rodar com um Refresh Token que ainda tenha
        drive.readonly</strong> (o mesmo usado na migração) — se você já
        trocou pro definitivo, configure o de leitura ampla de novo por
        enquanto (Unidades Gestoras), roda esta correção, e só depois
        volte pro definitivo.
      </p>
      <p class="texto-secundario" id="rc-total-documentos">Já processa vários arquivos ao mesmo tempo (mais rápido). Se quiser dividir o trabalho entre várias abas do navegador pra ir ainda mais rápido, preencha uma faixa diferente em cada aba (ex: aba 1 = 1 até 500, aba 2 = 501 até 1000...) — clique em "Ver quantos registros tem" pra saber o total.</p>
      <div class="linha-formulario">
        <div><label>Registro nº (início)</label><input type="number" id="rc-faixa-inicio" placeholder="Deixe em branco = 1" min="1"></div>
        <div><label>até o registro nº (fim)</label><input type="number" id="rc-faixa-fim" placeholder="Deixe em branco = até o final" min="1"></div>
      </div>
      <button class="botao-secundario" id="btn-ver-total-documentos" style="margin-top:8px">Ver quantos registros tem</button>
      <button class="botao-primario" id="btn-corrigir-anexos-migrados">Corrigir Anexos</button>
      <div id="resultado-correcao-anexos" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>🔍 Varredura Final — Conferir Migração Completa</h3>
      <p class="texto-secundario">
        Faz upload do mesmo <code>pacote_completo.json</code> usado na
        migração e confere, anexo por anexo, se está tudo certo: se o
        registro existe, se o anexo está lá, e se o arquivo do Drive
        realmente abre (não é só olhar se tem um ID salvo). Não altera
        nada — só gera um relatório do que ainda falta, se sobrar algo.
      </p>
      <input type="file" id="input-arquivo-varredura" accept=".json" style="margin-bottom:10px">
      <br>
      <button class="botao-primario" id="btn-rodar-varredura">Rodar Varredura</button>
      <div id="resultado-varredura" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>🧹 Reorganizar Pastas Duplicadas</h3>
      <p class="texto-secundario">
        Se a correção em paralelo criou pastas repetidas no Drive (ex:
        várias pastas "processosPessoal"), esta ferramenta acha as
        duplicatas, move os arquivos delas pra pasta oficial (a que
        está registrada), e exclui as que sobrarem vazias. Só move —
        nunca baixa nem reenvia o conteúdo do PDF, então é rápido mesmo
        com muitos arquivos.
      </p>
      <button class="botao-primario" id="btn-reorganizar-pastas">Reorganizar Pastas</button>
      <div id="resultado-reorganizar-pastas" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>🚀 Importar Migração AppSheet</h3>
      <p class="texto-secundario">
        Faz upload do pacote <code>.json</code> já preparado (planilha do
        AppSheet processada) e importa tudo: cadastros de apoio, os
        registros de Licitações/Pessoal/Atos Administrativos/Despesas, e
        busca cada anexo pelo nome nas pastas do Drive já vinculado a esta
        unidade gestora. Pode rodar mais de uma vez com segurança — o que
        já foi migrado antes é reconhecido e pulado, não duplica.
      </p>
      <input type="file" id="input-arquivo-migracao" accept=".json" style="margin-bottom:10px">
      <br>
      <button class="botao-primario" id="btn-rodar-migracao">Iniciar Migração</button>
      <div id="resultado-migracao" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>Reindexar campos de busca — Processos de Despesa</h3>
      <p class="texto-secundario">
        Preenche os campos internos usados na busca (número do empenho,
        ordem de pagamento, credor, objeto) e a contagem de anexos (usada
        no filtro "Sem anexo") em processos de despesa cadastrados antes
        desses recursos existirem. Não altera nenhum dado visível do
        registro, só os campos de apoio à busca/filtro.
      </p>
      <button class="botao-primario" id="btn-reindexar-despesas">Reindexar Processos de Despesa</button>
      <div id="resultado-despesas" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>Preencher contagem de anexos — Licitações</h3>
      <p class="texto-secundario">
        Preenche os campos internos usados na busca (número e modalidade)
        e a contagem de anexos (usada nos filtros "Sem anexo"/"Com anexo")
        em licitações cadastradas antes desses recursos existirem.
      </p>
      <button class="botao-primario" id="btn-reindexar-licitacoes">Reindexar Licitações</button>
      <div id="resultado-licitacoes" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>Preencher Ano e contagem de anexos — Legislação e Documentos Diversos</h3>
      <p class="texto-secundario">
        Esses dois módulos ganharam o campo "Ano" depois de já existirem
        registros cadastrados. Esta ferramenta tenta descobrir o ano
        automaticamente a partir do número (quando estiver no formato
        "123/2026", por exemplo), e já aproveita pra preencher a contagem
        de anexos também. Registros em que não for possível identificar o
        ano automaticamente ficam listados para você preencher manualmente.
      </p>
      <button class="botao-primario" id="btn-reindexar-legislacao">Reindexar Legislação</button>
      <div id="resultado-legislacao" class="resultado-manutencao"></div>
      <button class="botao-primario" id="btn-reindexar-documentos" style="margin-top:10px">Reindexar Documentos Diversos</button>
      <div id="resultado-documentos" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>🔄 Migrar Anexos pro Drive Próprio desta Unidade Gestora</h3>
      <p class="texto-secundario">
        Se esta unidade gestora já tinha PDFs anexados usando a conta
        compartilhada, e agora tem um Refresh Token próprio configurado
        (em Unidades Gestoras), os anexos <strong>antigos</strong> continuam
        fisicamente na conta compartilhada — só os anexos novos vão
        direto pra conta própria. Esta ferramenta baixa cada anexo antigo
        da conta compartilhada e reenvia pra conta própria, atualizando
        a referência no cadastro. Pode demorar bastante dependendo da
        quantidade de PDFs. Os arquivos antigos <strong>não são apagados
        automaticamente</strong> da conta compartilhada — depois de
        confirmar que a migração funcionou, você pode excluí-los
        manualmente lá se quiser liberar espaço.
      </p>
      <button class="botao-primario" id="btn-migrar-drive">Migrar Anexos</button>
      <div id="resultado-migracao-drive" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>⚙️ Atualização em Massa</h3>
      <p class="texto-secundario">
        Atualiza o mesmo campo em vários registros de uma coleção de uma
        vez só. Sempre confira a contagem/seleção antes de aplicar — não
        tem como desfazer automaticamente depois.
      </p>

      <label>Coleção</label>
      <select id="massa-colecao">
        <option value="credores">Credores/Fornecedores</option>
        <option value="licitacoes">Licitações</option>
        <option value="processosDespesa">Processos de Despesa</option>
        <option value="legislacao">Legislação</option>
        <option value="documentosDiversos">Documentos Diversos</option>
        <option value="modalidadesLicitacao">Modalidades de Licitação</option>
        <option value="unidadesOrcamentarias">Unidades Orçamentárias</option>
        <option value="fontesRecurso">Fontes de Recurso</option>
        <option value="tiposDocumento">Tipos de Documento</option>
      </select>

      <label>Campo a atualizar *</label>
      <select id="massa-campo-atualizar"></select>

      <div id="massa-area-novo-valor">
        <label>Novo valor *</label>
        <input type="text" id="massa-novo-valor" placeholder="Ex: 2026, true, Nome novo...">
        <p class="texto-secundario" style="margin-top:4px" id="massa-ajuda-valor">Números e "true"/"false" são convertidos automaticamente; qualquer outro texto é gravado como texto mesmo.</p>
      </div>

      <label style="margin-top:18px">Quais registros atualizar?</label>
      <div class="lista-checkboxes" style="flex-direction:row; gap:18px; padding:10px">
        <label class="item-checkbox"><input type="radio" name="massa-modo" value="filtro" checked> Filtrar por critério</label>
        <label class="item-checkbox"><input type="radio" name="massa-modo" value="lista"> Selecionar da lista</label>
      </div>

      <div id="massa-bloco-filtro">
        <div class="linha-formulario">
          <div><input type="text" id="massa-filtro-campo" placeholder="Campo do filtro (ex: ano)"></div>
          <div><input type="text" id="massa-filtro-valor" placeholder="Valor (ex: 2025)"></div>
        </div>
        <p class="texto-secundario" style="margin-top:4px">Deixe os dois em branco pra afetar todos os registros da coleção.</p>
        <button type="button" class="botao-secundario" id="btn-contar-massa" style="margin-top:8px">🔎 Contar registros afetados</button>
      </div>

      <div id="massa-bloco-lista" class="oculto">
        <input type="text" id="massa-busca-registros" placeholder="Digite pra buscar os registros...">
        <div id="massa-lista-resultados" class="lista-checkboxes" style="max-height:240px; margin-top:8px"></div>
        <p class="texto-secundario" id="massa-contagem-selecionados" style="margin-top:6px">0 registro(s) selecionado(s).</p>
      </div>

      <button type="button" class="botao-primario" id="btn-aplicar-massa" disabled style="margin-top:16px">✅ Aplicar atualização</button>
      <div id="resultado-massa" class="resultado-manutencao"></div>
    </div>
  `;

  configurarAtualizacaoEmMassa();

  document.getElementById("btn-ver-total-documentos").addEventListener("click", async (evento) => {
    await executarComFeedback(evento.target, async () => {
      const lista = await listarDocumentosMigradosComAnexo();
      document.getElementById("rc-total-documentos").textContent =
        `${lista.length} registro(s) migrado(s) com anexo, no total. Divida esse número entre as abas que for abrir (ex: 4 abas de ~${Math.ceil(lista.length / 4)} cada).`;
    }, "Contando...");
  });

  document.getElementById("btn-corrigir-anexos-migrados").addEventListener("click", async (evento) => {
    const inicio = parseInt(document.getElementById("rc-faixa-inicio").value, 10) || null;
    const fim = parseInt(document.getElementById("rc-faixa-fim").value, 10) || null;
    const faixa = (inicio || fim) ? { inicio, fim } : null;
    const avisoFaixa = faixa ? ` (só a faixa ${inicio || 1} até ${fim || "o final"})` : "";

    if (!confirm(`Isso vai baixar cada anexo migrado do AppSheet${avisoFaixa} e reenviar pra dentro da estrutura do app — precisa de um Refresh Token com drive.readonly ativo nesta unidade gestora. Pode demorar bastante. Continuar?`)) return;

    const resultadoEl = document.getElementById("resultado-correcao-anexos");
    const barra = criarBarraProgressoInline(resultadoEl, "Corrigindo anexos");

    await executarComFeedback(evento.target, async () => {
      try {
        const resultado = await corrigirAnexosMigrados((feitos, total) => barra.atualizar(feitos, total, "Corrigindo anexos"), faixa);
        barra.remover();
        if (resultado.totalAnexos === 0) {
          resultadoEl.innerHTML = `<p>Nenhum anexo migrado encontrado pra corrigir${avisoFaixa}.</p>`;
          return;
        }
        resultadoEl.innerHTML = `
          <p>✅ ${resultado.corrigidos} corrigido(s) agora${resultado.jaEstavamCorretos > 0 ? ` + ${resultado.jaEstavamCorretos} já estavam corretos de antes` : ""} — de ${resultado.totalAnexos} anexo(s)${avisoFaixa ? " nessa faixa" : " migrado(s) ao todo"}.</p>
          <p class="texto-secundario">Total geral de registros migrados com anexo: ${resultado.totalDocumentosNaColecao}.</p>
          ${
            resultado.falhas.length > 0
              ? `<p>⚠️ ${resultado.falhas.length} anexo(s) não puderam ser corrigidos agora (provavelmente o token não tem mais drive.readonly):</p>
                 <div class="lista-erros-importacao">${resultado.falhas.map((f) => `<div>${f}</div>`).join("")}</div>`
              : ""
          }
        `;
        mostrarToast("Correção de anexos concluída.", "sucesso");
      } catch (erro) {
        barra.remover();
        resultadoEl.innerHTML = `<p style="color:var(--vermelho-erro)">❌ ${erro.message}</p>`;
      }
    }, "Corrigindo...");
  });

  document.getElementById("btn-rodar-migracao").addEventListener("click", async (evento) => {
    const arquivoInput = document.getElementById("input-arquivo-migracao");
    const resultadoEl = document.getElementById("resultado-migracao");
    if (!arquivoInput.files[0]) {
      mostrarToast("Selecione o arquivo .json antes de iniciar.", "erro");
      return;
    }

    let pacote;
    try {
      const texto = await arquivoInput.files[0].text();
      pacote = JSON.parse(texto);
    } catch (erro) {
      mostrarToast("Não foi possível ler esse arquivo — confira se é o .json certo.", "erro");
      return;
    }

    const totalRegistros = ["licitacoes", "processosPessoal", "atosAdministrativos", "processosDespesa"]
      .reduce((soma, k) => soma + (pacote[k]?.length || 0), 0);

    if (!confirm(`Isso vai importar até ${totalRegistros} registro(s) (e buscar os anexos deles no Drive) pra unidade gestora atual (${estado.entidadeAtualNome}). Pode demorar bastante — não feche a aba no meio. Confirma que é a unidade gestora certa e quer continuar?`)) return;

    const barra = criarBarraProgressoInline(resultadoEl, "Migrando");

    await executarComFeedback(evento.target, async () => {
      try {
        const relatorio = await executarMigracaoAppSheet(pacote, (etapa, feitos, total) => {
          barra.atualizar(feitos, total, etapa);
        });
        barra.remover();

        const linhasCadastros = Object.entries(relatorio.cadastros)
          .map(([col, r]) => `<div>${col}: ${r.criados} criado(s) de ${r.total}</div>`).join("");
        const linhasRegistros = Object.entries(relatorio.registros)
          .map(([col, r]) => `<div>${col}: ${r.criados} criado(s), ${r.atualizados || 0} atualizado(s) com anexo novo, ${r.pulados} já estava(m) completo(s) — de ${r.total}</div>`).join("");

        resultadoEl.innerHTML = `
          <p>✅ Migração concluída.</p>
          <p><strong>Cadastros de apoio</strong></p>
          ${linhasCadastros}
          <p style="margin-top:8px"><strong>Registros</strong></p>
          ${linhasRegistros}
          <p style="margin-top:8px">📎 Anexos encontrados no Drive e vinculados: ${relatorio.anexosEncontrados}</p>
          ${
            relatorio.anexosNaoEncontrados.length > 0
              ? `<p>⚠️ ${relatorio.anexosNaoEncontrados.length} anexo(s) NÃO encontrado(s) no Drive (registro criado sem esse anexo específico):</p>
                 <div class="lista-erros-importacao">${relatorio.anexosNaoEncontrados.map((a) => `<div>${a}</div>`).join("")}</div>`
              : ""
          }
        `;
        mostrarToast("Migração concluída — confira o resultado abaixo.", "sucesso");
      } catch (erro) {
        barra.remover();
        console.error(erro);
        resultadoEl.innerHTML = `<p style="color:var(--vermelho-erro)">❌ Erro durante a migração: ${erro.message}</p><p class="texto-secundario">Pode rodar de novo com segurança — o que já foi criado não duplica.</p>`;
      }
    }, "Migrando...");
  });

  document.getElementById("btn-rodar-varredura").addEventListener("click", async (evento) => {
    const arquivoInput = document.getElementById("input-arquivo-varredura");
    const resultadoEl = document.getElementById("resultado-varredura");
    if (!arquivoInput.files[0]) {
      mostrarToast("Selecione o arquivo .json antes de rodar a varredura.", "erro");
      return;
    }

    let pacote;
    try {
      const texto = await arquivoInput.files[0].text();
      pacote = JSON.parse(texto);
    } catch (erro) {
      mostrarToast("Não foi possível ler esse arquivo — confira se é o .json certo.", "erro");
      return;
    }

    const barra = criarBarraProgressoInline(resultadoEl, "Conferindo");

    await executarComFeedback(evento.target, async () => {
      try {
        const relatorio = await rodarVarreduraFinal(pacote, (feitos, total) => barra.atualizar(feitos, total, "Conferindo"));
        barra.remover();

        const tudoCerto = relatorio.registrosFaltando.length === 0
          && relatorio.anexosFaltando.length === 0
          && relatorio.anexosComArquivoQuebrado.length === 0
          && relatorio.anexosAindaNaoCorrigidos.length === 0;

        resultadoEl.innerHTML = `
          <p>${tudoCerto ? "✅ Tudo certo!" : "⚠️ Encontrei pendências"} — ${relatorio.totalRegistrosConferidos} registro(s) e ${relatorio.totalAnexosConferidos} anexo(s) conferidos.</p>
          ${
            relatorio.registrosFaltando.length > 0
              ? `<p><strong>${relatorio.registrosFaltando.length} registro(s) que ainda não existem no app:</strong></p>
                 <div class="lista-erros-importacao">${relatorio.registrosFaltando.map((r) => `<div>${r}</div>`).join("")}</div>`
              : ""
          }
          ${
            relatorio.anexosFaltando.length > 0
              ? `<p><strong>${relatorio.anexosFaltando.length} anexo(s) que a fonte lista mas não estão no registro:</strong></p>
                 <div class="lista-erros-importacao">${relatorio.anexosFaltando.map((r) => `<div>${r}</div>`).join("")}</div>`
              : ""
          }
          ${
            relatorio.anexosComArquivoQuebrado.length > 0
              ? `<p><strong>${relatorio.anexosComArquivoQuebrado.length} anexo(s) presentes, mas o arquivo do Drive não abre:</strong></p>
                 <div class="lista-erros-importacao">${relatorio.anexosComArquivoQuebrado.map((r) => `<div>${r}</div>`).join("")}</div>`
              : ""
          }
          ${
            relatorio.anexosAindaNaoCorrigidos.length > 0
              ? `<p><strong>⚠️ ${relatorio.anexosAindaNaoCorrigidos.length} anexo(s) ainda apontam pro arquivo ORIGINAL do AppSheet</strong> — funcionam agora (porque o token de leitura ampla ainda está ativo), mas vão QUEBRAR assim que você voltar pro Refresh Token definitivo. Rode "Corrigir Anexos" antes de trocar o token:</p>
                 <div class="lista-erros-importacao">${relatorio.anexosAindaNaoCorrigidos.map((r) => `<div>${r}</div>`).join("")}</div>`
              : ""
          }
        `;
        mostrarToast(tudoCerto ? "Varredura concluída — tudo certo!" : "Varredura concluída — veja as pendências.", tudoCerto ? "sucesso" : "erro");
      } catch (erro) {
        barra.remover();
        console.error(erro);
        resultadoEl.innerHTML = `<p style="color:var(--vermelho-erro)">❌ Erro durante a varredura: ${erro.message}</p>`;
      }
    }, "Conferindo...");
  });

  document.getElementById("btn-reorganizar-pastas").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai procurar pastas de módulo duplicadas no Drive, mover os arquivos delas pra pasta oficial e excluir as que sobrarem vazias. Não mexe no Firestore, só organiza o Drive. Continuar?")) return;

    const resultadoEl = document.getElementById("resultado-reorganizar-pastas");
    const barra = criarBarraProgressoInline(resultadoEl, "Reorganizando");

    await executarComFeedback(evento.target, async () => {
      try {
        const resultado = await reorganizarPastasDuplicadas((feitos, total) => barra.atualizar(feitos, total, "Reorganizando"));
        barra.remover();
        if (resultado.pastasDuplicadasEncontradas === 0) {
          resultadoEl.innerHTML = `<p>✅ Nenhuma pasta duplicada encontrada — já está tudo organizado.</p>`;
          return;
        }
        resultadoEl.innerHTML = `
          <p>✅ ${resultado.pastasDuplicadasEncontradas} pasta(s) duplicada(s) encontrada(s).</p>
          <p>${resultado.arquivosMovidos} arquivo(s) movido(s) pra pasta oficial.</p>
          <p>${resultado.pastasExcluidas} pasta(s) vazia(s) excluída(s).</p>
          ${
            resultado.falhas.length > 0
              ? `<p>⚠️ ${resultado.falhas.length} problema(s):</p>
                 <div class="lista-erros-importacao">${resultado.falhas.map((f) => `<div>${f}</div>`).join("")}</div>`
              : ""
          }
        `;
        mostrarToast("Reorganização concluída.", "sucesso");
      } catch (erro) {
        barra.remover();
        console.error(erro);
        resultadoEl.innerHTML = `<p style="color:var(--vermelho-erro)">❌ ${erro.message}</p>`;
      }
    }, "Reorganizando...");
  });

  document.getElementById("btn-migrar-drive").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai baixar cada anexo antigo da conta compartilhada e reenviar pra conta própria desta unidade gestora. Pode demorar bastante e não pode ser interrompido no meio sem risco de ficar incompleto. Continuar?")) return;

    const resultadoEl = document.getElementById("resultado-migracao-drive");
    const barra = criarBarraProgressoInline(resultadoEl, "Migrando anexos");

    await executarComFeedback(evento.target, async () => {
      try {
        const resultado = await migrarAnexosParaDriveProprio((feitos, total) => barra.atualizar(feitos, total, "Migrando anexos"));
        barra.remover();
        if (resultado.totalAnexos === 0) {
          resultadoEl.innerHTML = `<p>Nenhum anexo encontrado pra migrar.</p>`;
          return;
        }
        resultadoEl.innerHTML = `
          <p>✅ ${resultado.migrados} de ${resultado.totalAnexos} anexo(s) migrado(s) com sucesso.</p>
          ${
            resultado.falhas.length > 0
              ? `<p>⚠️ ${resultado.falhas.length} anexo(s) não puderam ser migrados (mantidos apontando pra conta antiga, sem perda de acesso):</p>
                 <div class="lista-erros-importacao">${resultado.falhas.map((f) => `<div>${f}</div>`).join("")}</div>`
              : ""
          }
        `;
        mostrarToast("Migração de anexos concluída.", "sucesso");
      } catch (erro) {
        barra.remover();
        resultadoEl.innerHTML = `<p style="color:var(--vermelho-erro)">❌ ${erro.message}</p>`;
      }
    }, "Migrando...");
  });

  document.getElementById("btn-reindexar-despesas").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os processos de despesa da unidade gestora atual. Pode levar alguns segundos dependendo da quantidade. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-despesas");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await reindexarDespesas((feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      resultadoEl.innerHTML = `
        <p>✅ ${resultado.totalRevisados} registro(s) revisado(s), ${resultado.totalAtualizados} atualizado(s).</p>
      `;
      mostrarToast("Reindexação de despesas concluída.", "sucesso");
    }, "Reindexando...");
  });

  document.getElementById("btn-reindexar-licitacoes").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todas as licitações da unidade gestora atual. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-licitacoes");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await reindexarLicitacoes((feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      resultadoEl.innerHTML = `
        <p>✅ ${resultado.totalRevisados} registro(s) revisado(s), ${resultado.totalAtualizados} atualizado(s).</p>
      `;
      mostrarToast("Reindexação de licitações concluída.", "sucesso");
    }, "Reindexando...");
  });

  document.getElementById("btn-reindexar-legislacao").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os registros de Legislação da unidade gestora atual. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-legislacao");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await preencherAnoAutomatico("legislacao", (feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      exibirResultadoAno("resultado-legislacao", resultado);
      mostrarToast("Preenchimento de ano (Legislação) concluído.", "sucesso");
    }, "Processando...");
  });

  document.getElementById("btn-reindexar-documentos").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os registros de Documentos Diversos da unidade gestora atual. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-documentos");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await preencherAnoAutomatico("documentosDiversos", (feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      exibirResultadoAno("resultado-documentos", resultado);
      mostrarToast("Preenchimento de ano (Documentos Diversos) concluído.", "sucesso");
    }, "Processando...");
  });

  // ---------- Atualização em Massa ----------
  let docsAfetadosMassa = null;

  document.getElementById("btn-contar-massa").addEventListener("click", async (evento) => {
    const colecao = document.getElementById("massa-colecao").value;
    const filtroCampo = document.getElementById("massa-filtro-campo").value.trim();
    const filtroValorTexto = document.getElementById("massa-filtro-valor").value.trim();
    const resultadoEl = document.getElementById("resultado-massa");
    const botaoAplicar = document.getElementById("btn-aplicar-massa");

    await executarComFeedback(evento.target, async () => {
      try {
        let consulta = colecaoEntidade(colecao);
        if (filtroCampo && filtroValorTexto) {
          consulta = consulta.where(filtroCampo, "==", converterValorMassa(filtroValorTexto));
        }
        const snapshot = await consulta.get();
        docsAfetadosMassa = snapshot.docs;
        resultadoEl.innerHTML = `<p>🔎 <strong>${snapshot.size}</strong> registro(s) seriam afetados com esse filtro.</p>`;
        botaoAplicar.disabled = snapshot.size === 0;
      } catch (erro) {
        docsAfetadosMassa = null;
        botaoAplicar.disabled = true;
        tratarErroConsultaFirestore(erro);
      }
    }, "Contando...");
  });

  document.getElementById("btn-aplicar-massa").addEventListener("click", async (evento) => {
    const colecao = document.getElementById("massa-colecao").value;
    const campoAtualizar = document.getElementById("massa-campo-atualizar").value.trim();
    const novoValorTexto = document.getElementById("massa-novo-valor").value;
    const resultadoEl = document.getElementById("resultado-massa");

    if (!campoAtualizar) {
      mostrarToast("Informe qual campo você quer atualizar.", "erro");
      return;
    }
    if (!docsAfetadosMassa) {
      mostrarToast('Clique em "Contar registros afetados" antes de aplicar.', "erro");
      return;
    }

    const novoValor = converterValorMassa(novoValorTexto);
    if (!confirm(`Isso vai gravar o campo "${campoAtualizar}" = "${novoValorTexto}" em ${docsAfetadosMassa.length} registro(s) da coleção. Não tem como desfazer automaticamente depois. Continuar?`)) return;

    await executarComFeedback(evento.target, async () => {
      const barra = criarBarraProgressoInline(resultadoEl, "Atualizando");
      try {
        const TAMANHO_LOTE = 400;
        let feitos = 0;
        for (let inicio = 0; inicio < docsAfetadosMassa.length; inicio += TAMANHO_LOTE) {
          const lote = db.batch();
          const fatia = docsAfetadosMassa.slice(inicio, inicio + TAMANHO_LOTE);
          fatia.forEach((doc) => {
            lote.update(colecaoEntidade(colecao).doc(doc.id), { [campoAtualizar]: novoValor });
          });
          await lote.commit();
          feitos += fatia.length;
          barra.atualizar(feitos, docsAfetadosMassa.length, "Atualizando");
        }
        barra.remover();
        resultadoEl.innerHTML = `<p>✅ ${feitos} registro(s) atualizado(s) com sucesso.</p>`;
        mostrarToast("Atualização em massa concluída.", "sucesso");
        docsAfetadosMassa = null;
        document.getElementById("btn-aplicar-massa").disabled = true;
      } catch (erro) {
        barra.remover();
        tratarErroConsultaFirestore(erro);
      }
    }, "Aplicando...");
  });
}

// ===================================================================
// ATUALIZAÇÃO EM MASSA — metadados de campos por coleção
// ===================================================================
// Lista de campos conhecidos de cada coleção, pra popular o dropdown
// "Campo a atualizar" (em vez de digitar o nome livre, sujeito a erro
// de digitação). Quando um campo tem "relacionado", ele referencia um
// documento de outra coleção — nesse caso, em vez de digitar o ID, a
// ferramenta mostra um dropdown com os registros daquela coleção pra
// escolher pelo nome, e grava o ID por trás dos panos.
const CAMPOS_POR_COLECAO = {
  credores: [
    { campo: "tipo", rotulo: "Tipo (PF/PJ)" },
    { campo: "nome", rotulo: "Nome/Razão Social" },
    { campo: "documento", rotulo: "CPF/CNPJ" },
    { campo: "telefone", rotulo: "Telefone" },
    { campo: "email", rotulo: "E-mail" },
  ],
  licitacoes: [
    { campo: "numero", rotulo: "Número" },
    { campo: "ano", rotulo: "Ano" },
    { campo: "modalidadeId", rotulo: "Modalidade", relacionado: "modalidadesLicitacao" },
    { campo: "objeto", rotulo: "Objeto" },
  ],
  processosDespesa: [
    { campo: "numeroEmpenho", rotulo: "Número do Empenho" },
    { campo: "ordemPagamento", rotulo: "Ordem de Pagamento" },
    { campo: "elementoDespesa", rotulo: "Elemento de Despesa" },
    { campo: "credorId", rotulo: "Credor/Fornecedor", relacionado: "credores" },
    { campo: "unidadeOrcamentariaId", rotulo: "Unidade Orçamentária", relacionado: "unidadesOrcamentarias" },
    { campo: "fonteRecursoId", rotulo: "Fonte de Recurso", relacionado: "fontesRecurso" },
    { campo: "licitacaoId", rotulo: "Licitação de origem", relacionado: "licitacoes" },
    { campo: "objeto", rotulo: "Objeto" },
    { campo: "dataPagamento", rotulo: "Data de Pagamento (AAAA-MM-DD)" },
    { campo: "valor", rotulo: "Valor" },
  ],
  legislacao: [
    { campo: "tipoId", rotulo: "Tipo", relacionado: "tiposDocumento" },
    { campo: "numero", rotulo: "Número" },
    { campo: "ano", rotulo: "Ano" },
    { campo: "objeto", rotulo: "Objeto" },
  ],
  documentosDiversos: [
    { campo: "tipoId", rotulo: "Tipo", relacionado: "tiposDocumento" },
    { campo: "numero", rotulo: "Número" },
    { campo: "ano", rotulo: "Ano" },
    { campo: "objeto", rotulo: "Objeto" },
  ],
  modalidadesLicitacao: [{ campo: "nome", rotulo: "Nome" }],
  unidadesOrcamentarias: [{ campo: "nome", rotulo: "Nome" }, { campo: "codigo", rotulo: "Código" }],
  fontesRecurso: [{ campo: "nome", rotulo: "Nome" }, { campo: "codigo", rotulo: "Código" }],
  tiposDocumento: [{ campo: "nome", rotulo: "Nome" }],
};

/** Campos usados pra buscar/pesquisar registros de cada coleção (busca por prefixo, um ou mais campos por coleção) */
const CAMPOS_BUSCA_POR_COLECAO = {
  credores: ["nomeNormalizado"],
  modalidadesLicitacao: ["nomeNormalizado"],
  unidadesOrcamentarias: ["nomeNormalizado"],
  fontesRecurso: ["nomeNormalizado"],
  tiposDocumento: ["nomeNormalizado"],
  licitacoes: ["numeroNormalizado", "modalidadeNomeNormalizado", "objetoNormalizado"],
  processosDespesa: ["numeroEmpenhoNormalizado", "ordemPagamentoNormalizado", "credorNomeNormalizado", "objetoNormalizado"],
  legislacao: ["objetoNormalizado"],
  documentosDiversos: ["objetoNormalizado"],
};

/** Busca registros de uma coleção em vários campos ao mesmo tempo, juntando os resultados sem duplicar */
async function buscarRegistrosMultiCampoMassa(colecao, termo) {
  const termoNormalizado = normalizarTexto(termo);
  if (!termoNormalizado) return [];
  const campos = CAMPOS_BUSCA_POR_COLECAO[colecao] || ["nomeNormalizado"];
  const consultas = campos.map((campo) =>
    colecaoEntidade(colecao)
      .orderBy(campo)
      .startAt(termoNormalizado)
      .endAt(termoNormalizado + "\uf8ff")
      .limit(20)
      .get()
  );
  const resultadosPorConsulta = await Promise.all(consultas);
  const encontrados = new Map();
  resultadosPorConsulta.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => {
      if (!encontrados.has(doc.id)) encontrados.set(doc.id, { id: doc.id, ...doc.data() });
    });
  });
  return [...encontrados.values()];
}

/**
 * Quando um campo relacionado é alterado, alguns dados denormalizados
 * (nomes copiados por conveniência de exibição) precisam ser
 * atualizados junto, senão ficam "desencontrados" do vínculo real.
 * Cada função recebe os dados do registro relacionado escolhido e
 * devolve os campos extras a gravar.
 */
const DENORMALIZACOES_MASSA = {
  "processosDespesa.credorId": (d) => ({ credorNome: d.nome, credorNomeNormalizado: d.nomeNormalizado }),
  "processosDespesa.licitacaoId": (d) => ({ licitacaoIdentificador: `${d.numero}/${d.ano}` }),
  "licitacoes.modalidadeId": (d) => ({ modalidadeNome: d.nome, modalidadeNomeNormalizado: d.nomeNormalizado }),
};

/** Monta um rótulo legível pra um registro qualquer, tentando os campos mais prováveis */
function rotularRegistroMassa(dados) {
  if (dados.numeroEmpenho) return `Empenho ${dados.numeroEmpenho} — ${dados.credorNome || ""}`;
  if (dados.numero && dados.ano) {
    const modalidade = dados.modalidadeNome ? ` — ${dados.modalidadeNome}` : "";
    const objeto = dados.objeto ? ` — ${dados.objeto.slice(0, 50)}` : "";
    return `${dados.numero}/${dados.ano}${modalidade}${objeto}`;
  }
  if (dados.nome) return dados.codigo ? `${dados.codigo} — ${dados.nome}` : dados.nome;
  if (dados.objeto) return dados.objeto.slice(0, 70);
  return "(sem identificação)";
}

/**
 * Migra os anexos de todos os registros da unidade gestora atual, da
 * conta compartilhada do Drive pra conta própria já configurada nela.
 * Baixa cada PDF com o token da conta compartilhada e reenvia com o
 * token da conta própria (que passa a ser a conta ativa da unidade
 * gestora assim que ela tem um Refresh Token próprio configurado).
 */
async function migrarAnexosParaDriveProprio(aoProgredir) {
  // Confirma que a unidade gestora realmente tem uma conta própria
  // configurada — senão a "migração" reenviaria pra mesma conta de
  // origem, sem sentido nenhum.
  const docConfig = await db.collection("entidades").doc(estado.entidadeAtual).collection("config").doc("drive").get();
  if (!docConfig.exists || !docConfig.data().refreshToken) {
    throw new Error("Esta unidade gestora ainda não tem um Refresh Token próprio configurado. Configure primeiro em Unidades Gestoras.");
  }

  const colecoesComAnexo = ["licitacoes", "processosDespesa", "legislacao", "documentosDiversos"];
  const documentosPorColecao = {};
  let totalAnexos = 0;

  for (const colecao of colecoesComAnexo) {
    const snapshot = await colecaoEntidade(colecao).get();
    documentosPorColecao[colecao] = snapshot.docs
      .map((doc) => ({ ref: doc.ref, dados: doc.data() }))
      .filter((d) => (d.dados.anexos || []).length > 0);
    totalAnexos += documentosPorColecao[colecao].reduce((soma, d) => soma + d.dados.anexos.length, 0);
  }

  if (totalAnexos === 0) {
    return { totalAnexos: 0, migrados: 0, falhas: [] };
  }

  const tokenContaAntiga = await obterAccessTokenDriveCompartilhado();
  let migrados = 0;
  const falhas = [];

  for (const colecao of colecoesComAnexo) {
    for (const documento of documentosPorColecao[colecao]) {
      const novosAnexos = [];
      let mudouAlgumAnexo = false;

      for (const anexo of documento.dados.anexos) {
        try {
          const resposta = await fetch(`https://www.googleapis.com/drive/v3/files/${anexo.driveFileId}?alt=media&supportsAllDrives=true`, {
            headers: { Authorization: `Bearer ${tokenContaAntiga}` },
          });
          if (!resposta.ok) throw new Error("Não foi possível baixar da conta antiga.");
          const blob = await resposta.blob();
          const arquivo = new File([blob], anexo.nomeArquivo, { type: detectarTipoPorExtensao(anexo.nomeArquivo) });

          // Reenvia usando o token da unidade gestora atual — que já é
          // a conta própria, já que ela tem Refresh Token configurado.
          const novoAnexo = await enviarPdfParaDrive(arquivo, colecao, () => {}, { permitirQualquerTipo: true });
          novoAnexo.volume = anexo.volume;
          novoAnexo.dataUpload = anexo.dataUpload || new Date().toISOString();
          novoAnexo.usuarioUpload = anexo.usuarioUpload || estado.usuario.email;
          novosAnexos.push(novoAnexo);
          mudouAlgumAnexo = true;
          migrados++;
        } catch (erro) {
          console.warn(`Falha ao migrar anexo "${anexo.nomeArquivo}":`, erro);
          novosAnexos.push(anexo); // mantém apontando pra conta antiga, não perde a referência
          falhas.push(`${anexo.nomeArquivo} (${ROTULOS_COLECAO_HISTORICO[colecao] || colecao})`);
        }
        aoProgredir?.(migrados + falhas.length, totalAnexos);
      }

      if (mudouAlgumAnexo) {
        await documento.ref.update({ anexos: novosAnexos });
      }
    }
  }

  return { totalAnexos, migrados, falhas };
}

function converterValorMassa(texto) {
  if (texto === "true") return true;
  if (texto === "false") return false;
  if (texto.trim() !== "" && !isNaN(texto) && !isNaN(parseFloat(texto))) return parseFloat(texto);
  return texto;
}

function configurarAtualizacaoEmMassa() {
  const seletorColecao = document.getElementById("massa-colecao");
  const seletorCampo = document.getElementById("massa-campo-atualizar");
  const areaNovoValor = document.getElementById("massa-area-novo-valor");
  const botaoAplicar = document.getElementById("btn-aplicar-massa");
  const resultadoEl = document.getElementById("resultado-massa");

  let docsAfetadosMassa = null; // modo "filtro"
  const selecionadosMassa = new Map(); // modo "lista": id -> dados

  function popularCamposDaColecao() {
    const colecao = seletorColecao.value;
    const campos = CAMPOS_POR_COLECAO[colecao] || [];
    seletorCampo.innerHTML = campos.map((c) => `<option value="${c.campo}" data-relacionado="${c.relacionado || ""}">${c.rotulo}</option>`).join("");
    atualizarAreaNovoValor();
    resetarSelecoes();
  }

  async function atualizarAreaNovoValor() {
    const opcaoSelecionada = seletorCampo.selectedOptions[0];
    const relacionado = opcaoSelecionada?.dataset.relacionado;

    if (relacionado) {
      areaNovoValor.innerHTML = `
        <label>Novo valor *</label>
        <input type="text" id="massa-novo-valor-busca" placeholder="Digite pra buscar..." autocomplete="off">
        <input type="hidden" id="massa-novo-valor-id">
        <div id="massa-novo-valor-resultados" class="lista-autocomplete oculto"></div>
        <p class="texto-secundario" style="margin-top:4px">Escolha o registro correto de "${relacionado}" — o vínculo (ID) é gravado automaticamente, e nomes copiados por conveniência (se houver) são sincronizados junto.</p>
      `;
      configurarAutocomplete({
        inputBusca: document.getElementById("massa-novo-valor-busca"),
        inputId: document.getElementById("massa-novo-valor-id"),
        resultadosEl: document.getElementById("massa-novo-valor-resultados"),
        buscar: (termo) => buscarRegistrosMultiCampoMassa(relacionado, termo),
        rotulo: (item) => rotularRegistroMassa(item),
      });
    } else {
      areaNovoValor.innerHTML = `
        <label>Novo valor *</label>
        <input type="text" id="massa-novo-valor" placeholder="Ex: 2026, true, Nome novo...">
        <p class="texto-secundario" style="margin-top:4px">Números e "true"/"false" são convertidos automaticamente; qualquer outro texto é gravado como texto mesmo.</p>
      `;
    }
  }

  function resetarSelecoes() {
    docsAfetadosMassa = null;
    selecionadosMassa.clear();
    botaoAplicar.disabled = true;
    resultadoEl.innerHTML = "";
    document.getElementById("massa-lista-resultados").innerHTML = "";
    document.getElementById("massa-contagem-selecionados").textContent = "0 registro(s) selecionado(s).";
  }

  seletorColecao.addEventListener("change", popularCamposDaColecao);
  seletorCampo.addEventListener("change", () => { atualizarAreaNovoValor(); resetarSelecoes(); });
  popularCamposDaColecao();

  // ---------- Alternar entre "Filtrar por critério" e "Selecionar da lista" ----------
  document.querySelectorAll('input[name="massa-modo"]').forEach((radio) => {
    radio.addEventListener("change", (evento) => {
      document.getElementById("massa-bloco-filtro").classList.toggle("oculto", evento.target.value !== "filtro");
      document.getElementById("massa-bloco-lista").classList.toggle("oculto", evento.target.value !== "lista");
      resetarSelecoes();
    });
  });

  // ---------- Modo "Filtrar por critério" ----------
  document.getElementById("btn-contar-massa").addEventListener("click", async (evento) => {
    const colecao = seletorColecao.value;
    const filtroCampo = document.getElementById("massa-filtro-campo").value.trim();
    const filtroValorTexto = document.getElementById("massa-filtro-valor").value.trim();

    await executarComFeedback(evento.target, async () => {
      try {
        let consulta = colecaoEntidade(colecao);
        if (filtroCampo && filtroValorTexto) {
          consulta = consulta.where(filtroCampo, "==", converterValorMassa(filtroValorTexto));
        }
        const snapshot = await consulta.get();
        docsAfetadosMassa = snapshot.docs;
        resultadoEl.innerHTML = `<p>🔎 <strong>${snapshot.size}</strong> registro(s) seriam afetados com esse filtro.</p>`;
        botaoAplicar.disabled = snapshot.size === 0;
      } catch (erro) {
        docsAfetadosMassa = null;
        botaoAplicar.disabled = true;
        tratarErroConsultaFirestore(erro);
      }
    }, "Contando...");
  });

  // ---------- Modo "Selecionar da lista" ----------
  let temporizadorBuscaMassa;
  document.getElementById("massa-busca-registros").addEventListener("input", (evento) => {
    clearTimeout(temporizadorBuscaMassa);
    temporizadorBuscaMassa = setTimeout(async () => {
      const colecao = seletorColecao.value;
      const termo = evento.target.value.trim();
      const listaEl = document.getElementById("massa-lista-resultados");
      if (!termo) { listaEl.innerHTML = ""; return; }

      try {
        const registros = await buscarRegistrosMultiCampoMassa(colecao, termo);
        listaEl.innerHTML = registros.map((dados) => {
          const marcado = selecionadosMassa.has(dados.id);
          return `
            <label class="item-checkbox">
              <input type="checkbox" data-id="${dados.id}" ${marcado ? "checked" : ""}>
              ${rotularRegistroMassa(dados)}
            </label>
          `;
        }).join("") || `<p class="texto-secundario">Nenhum resultado.</p>`;

        listaEl.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
          checkbox.addEventListener("change", async (ev) => {
            const id = ev.target.dataset.id;
            if (ev.target.checked) {
              const doc = await colecaoEntidade(colecao).doc(id).get();
              selecionadosMassa.set(id, doc.data());
            } else {
              selecionadosMassa.delete(id);
            }
            document.getElementById("massa-contagem-selecionados").textContent = `${selecionadosMassa.size} registro(s) selecionado(s).`;
            botaoAplicar.disabled = selecionadosMassa.size === 0;
          });
        });
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, 300);
  });

  // ---------- Aplicar ----------
  botaoAplicar.addEventListener("click", async (evento) => {
    const colecao = seletorColecao.value;
    const campoAtualizar = seletorCampo.value;
    const modo = document.querySelector('input[name="massa-modo"]:checked').value;

    const opcaoCampo = seletorCampo.selectedOptions[0];
    const relacionado = opcaoCampo?.dataset.relacionado;
    let novoValor;
    let extrasDenormalizados = {};

    if (relacionado) {
      const campoIdOculto = document.getElementById("massa-novo-valor-id");
      if (!campoIdOculto?.value) { mostrarToast("Busque e selecione o novo valor na lista de sugestões.", "erro"); return; }
      novoValor = campoIdOculto.value;
      const docRelacionado = await colecaoEntidade(relacionado).doc(novoValor).get();
      const funcaoDenormalizacao = DENORMALIZACOES_MASSA[`${colecao}.${campoAtualizar}`];
      if (funcaoDenormalizacao && docRelacionado.exists) {
        extrasDenormalizados = funcaoDenormalizacao(docRelacionado.data());
      }
    } else {
      const inputTexto = document.getElementById("massa-novo-valor");
      novoValor = converterValorMassa(inputTexto.value);
    }

    const idsAlvo = modo === "filtro"
      ? (docsAfetadosMassa || []).map((d) => d.id)
      : [...selecionadosMassa.keys()];

    if (idsAlvo.length === 0) {
      mostrarToast(modo === "filtro" ? 'Clique em "Contar registros afetados" antes.' : "Selecione ao menos um registro na lista.", "erro");
      return;
    }

    if (!confirm(`Isso vai atualizar o campo "${campoAtualizar}" em ${idsAlvo.length} registro(s). Não tem como desfazer automaticamente depois. Continuar?`)) return;

    await executarComFeedback(evento.target, async () => {
      const barra = criarBarraProgressoInline(resultadoEl, "Atualizando");
      try {
        const TAMANHO_LOTE = 400;
        let feitos = 0;
        for (let inicio = 0; inicio < idsAlvo.length; inicio += TAMANHO_LOTE) {
          const lote = db.batch();
          const fatia = idsAlvo.slice(inicio, inicio + TAMANHO_LOTE);
          fatia.forEach((id) => {
            lote.update(colecaoEntidade(colecao).doc(id), { [campoAtualizar]: novoValor, ...extrasDenormalizados });
          });
          await lote.commit();
          feitos += fatia.length;
          barra.atualizar(feitos, idsAlvo.length, "Atualizando");
        }
        barra.remover();
        resultadoEl.innerHTML = `<p>✅ ${feitos} registro(s) atualizado(s) com sucesso.</p>`;
        mostrarToast("Atualização em massa concluída.", "sucesso");
        docsAfetadosMassa = null;
        selecionadosMassa.clear();
        botaoAplicar.disabled = true;
      } catch (erro) {
        barra.remover();
        tratarErroConsultaFirestore(erro);
      }
    }, "Aplicando...");
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
async function reindexarDespesas(aoProgredir) {
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

    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      atualizacao.quantidadeAnexos = quantidadeAnexosEsperada;
    }

    if (Object.keys(atualizacao).length > 0) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao });
    }
  });

  await aplicarAtualizacoesEmLotes("processosDespesa", documentosParaAtualizar, aoProgredir);

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
async function preencherAnoAutomatico(nomeColecao, aoProgredir) {
  const snapshot = await colecaoEntidade(nomeColecao).get();
  const documentosParaAtualizar = [];
  const naoIdentificados = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const atualizacao = {};

    if (!dados.ano) {
      const correspondencia = (dados.numero || "").match(/(\d{4})/);
      const anoEncontrado = correspondencia ? parseInt(correspondencia[1], 10) : null;
      const anoValido = anoEncontrado && anoEncontrado >= 1990 && anoEncontrado <= new Date().getFullYear() + 1;

      if (anoValido) {
        atualizacao.ano = anoEncontrado;
      } else {
        naoIdentificados.push(`${dados.numero || "(sem número)"} — ${(dados.objeto || "").slice(0, 60)}`);
      }
    }

    const numeroNormalizadoEsperado = normalizarTexto(dados.numero || "");
    if (dados.numeroNormalizado !== numeroNormalizadoEsperado) {
      atualizacao.numeroNormalizado = numeroNormalizadoEsperado;
    }

    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      atualizacao.quantidadeAnexos = quantidadeAnexosEsperada;
    }

    if (Object.keys(atualizacao).length > 0) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao });
    }
  });

  await aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar, aoProgredir);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
    naoIdentificados,
  };
}

/** Preenche só a contagem de anexos (usada pelo filtro "Sem anexo") — usado por Licitações */
/** Preenche número/modalidade normalizados e contagem de anexos em Licitações (usado pela busca nova) */
async function reindexarLicitacoes(aoProgredir) {
  const [snapshot, modalidades] = await Promise.all([
    colecaoEntidade("licitacoes").get(),
    carregarOpcoesSelect("modalidadesLicitacao"),
  ]);
  const mapaModalidades = Object.fromEntries(modalidades.map((m) => [m.id, m.nome]));
  const documentosParaAtualizar = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const atualizacao = {};

    const numeroNormalizadoEsperado = normalizarTexto(dados.numero || "");
    if (dados.numeroNormalizado !== numeroNormalizadoEsperado) {
      atualizacao.numeroNormalizado = numeroNormalizadoEsperado;
    }

    const modalidadeNomeEsperado = mapaModalidades[dados.modalidadeId] || "";
    if (dados.modalidadeNome !== modalidadeNomeEsperado) {
      atualizacao.modalidadeNome = modalidadeNomeEsperado;
      atualizacao.modalidadeNomeNormalizado = normalizarTexto(modalidadeNomeEsperado);
    }

    const objetoNormalizadoEsperado = normalizarTexto(dados.objeto || "");
    if (dados.objetoNormalizado !== objetoNormalizadoEsperado) {
      atualizacao.objetoNormalizado = objetoNormalizadoEsperado;
    }

    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      atualizacao.quantidadeAnexos = quantidadeAnexosEsperada;
    }

    if (Object.keys(atualizacao).length > 0) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao });
    }
  });

  await aplicarAtualizacoesEmLotes("licitacoes", documentosParaAtualizar, aoProgredir);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
  };
}

/** Preenche só a contagem de anexos (usada pelo filtro "Sem anexo") — utilitário genérico */
async function reindexarQuantidadeAnexos(nomeColecao, aoProgredir) {
  const snapshot = await colecaoEntidade(nomeColecao).get();
  const documentosParaAtualizar = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao: { quantidadeAnexos: quantidadeAnexosEsperada } });
    }
  });

  await aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar, aoProgredir);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
  };
}

/** Aplica uma lista de atualizações parciais em lotes (nunca documento por documento em sequência) */
async function aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar, aoProgredir) {
  const TAMANHO_LOTE = 400;
  let feitos = 0;
  const total = documentosParaAtualizar.length;
  aoProgredir?.(0, total);
  for (let inicio = 0; inicio < documentosParaAtualizar.length; inicio += TAMANHO_LOTE) {
    const lote = db.batch();
    const fatia = documentosParaAtualizar.slice(inicio, inicio + TAMANHO_LOTE);
    fatia.forEach(({ id, atualizacao }) => {
      lote.update(colecaoEntidade(nomeColecao).doc(id), atualizacao);
    });
    await lote.commit();
    feitos += fatia.length;
    aoProgredir?.(feitos, total);
  }
}
