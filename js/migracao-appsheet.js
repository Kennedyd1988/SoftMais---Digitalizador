// ===================================================================
// IMPORTAÇÃO DA MIGRAÇÃO DO APPSHEET
// ===================================================================
// Lê o pacote .json já preparado (planilha do AppSheet processada e
// organizada), cria os cadastros de apoio que ainda não existirem,
// busca cada anexo pelo nome dentro das pastas certas do Google Drive
// (usando o Drive já vinculado a esta unidade gestora) e grava os
// registros no Firestore — sem duplicar nada se rodado mais de uma vez
// (usa o campo "origemAppSheetId" pra saber o que já foi migrado).

// IDs das pastas do Drive de origem, uma por prefixo de pasta encontrado
// na planilha do AppSheet.
const PASTAS_DRIVE_APPSHEET = {
  "img_pessoal_Images": "1kSRsUcGt1iuLv7r3KAKvQyu3JgOgpxhs",
  "img_pessoal_Files_": "1ZrHNFh0VQ7K10P6fKgwUxt6qFH3ILGkE",
  "img_despesa_Files_": "19jVus-IYjulkSKCkRhsyRk919Z_d2r-p",
  "img_licit_Images": "1B1idnsNRa94EEn9AoGbccgB-4kqqhyGp",
  "img_licit_Files_": "1ImGJrCtcIwrDbfqeM7d8_Mx7pc4hnCPB",
};

/** Detecta o tipo real do arquivo pela extensão do nome — a maioria é PDF, mas alguns anexos antigos são fotos (JPG/PNG) */
function detectarTipoPorExtensao(nomeArquivo) {
  const extensao = (nomeArquivo.split(".").pop() || "").toLowerCase();
  const mapa = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
  return mapa[extensao] || "application/pdf";
}

/** Busca um arquivo pelo nome dentro de uma pasta específica do Drive (sem baixar o conteúdo) */
async function buscarArquivoNoDrivePorNome(nomeArquivo, pastaId, token) {
  const nomeEscapado = nomeArquivo.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
  const consulta = `name='${nomeEscapado}' and '${pastaId}' in parents and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(consulta)}&fields=files(id,name,size)&pageSize=3&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;
  try {
    const resposta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resposta.ok) return null;
    const dados = await resposta.json();
    if (dados.files && dados.files[0]) return dados.files[0];
  } catch (erro) {
    console.warn("Erro ao buscar arquivo no Drive:", nomeArquivo, erro);
  }

  // Não achou pelo nome exato — tenta de novo só pelo código único no
  // começo do nome (ex: "74f29716" em "74f29716.IMAGENS.231715...pdf").
  // Esse código nunca tem erro de digitação/espaço a mais, então serve
  // como reserva pra nomes bagunçados que vieram da planilha antiga.
  const codigoUnico = nomeArquivo.split(".")[0];
  if (!codigoUnico || codigoUnico.length < 6) return null;
  try {
    const consultaPrefixo = `name contains '${codigoUnico}' and '${pastaId}' in parents and trashed=false`;
    const urlPrefixo = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(consultaPrefixo)}&fields=files(id,name,size)&pageSize=3&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;
    const respostaPrefixo = await fetch(urlPrefixo, { headers: { Authorization: `Bearer ${token}` } });
    if (!respostaPrefixo.ok) return null;
    const dadosPrefixo = await respostaPrefixo.json();
    return dadosPrefixo.files && dadosPrefixo.files[0] ? dadosPrefixo.files[0] : null;
  } catch (erro) {
    console.warn("Erro ao buscar arquivo no Drive por prefixo:", codigoUnico, erro);
    return null;
  }
}

/**
 * Corrige os anexos migrados do AppSheet que ainda apontam pro arquivo
 * ORIGINAL (fora do controle do app) — baixa cada um (precisa de um
 * token com `drive.readonly`, já que são arquivos que o app não criou)
 * e reenvia pra dentro da estrutura própria do app (usando o fluxo
 * normal de upload, que também aproveita e conta as páginas — corrige
 * o "null pág." de quebra). Depois disso, o arquivo passa a ser "do
 * app" de vez, e continua acessível mesmo só com `drive.file`.
 */
/** Busca um arquivo pelo nome em QUALQUER uma das pastas conhecidas do AppSheet (usado quando não se sabe mais de qual pasta ele veio) */
async function buscarArquivoEmQualquerPastaAppSheet(nomeArquivo, token) {
  for (const pastaId of Object.values(PASTAS_DRIVE_APPSHEET)) {
    const encontrado = await buscarArquivoNoDrivePorNome(nomeArquivo, pastaId, token);
    if (encontrado) return encontrado;
  }
  return null;
}

/** Confere no Drive se um arquivo ainda existe de verdade (não foi excluído/movido pra lixeira) */
async function arquivoAindaExisteNoDrive(driveFileId, token) {
  try {
    const resposta = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=id,trashed&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resposta.ok) return false;
    const dados = await resposta.json();
    return !dados.trashed;
  } catch (erro) {
    return false;
  }
}

/** Processa uma lista com um limite de tarefas simultâneas — usado pra corrigir vários documentos ao mesmo tempo, sem sobrecarregar a API do Google */
async function processarComConcorrencia(itens, quantidadeSimultanea, funcaoPorItem) {
  let indiceProximo = 0;
  async function trabalhador() {
    while (indiceProximo < itens.length) {
      const indiceAtual = indiceProximo++;
      await funcaoPorItem(itens[indiceAtual], indiceAtual);
    }
  }
  const trabalhadores = Array.from({ length: Math.min(quantidadeSimultanea, itens.length) }, () => trabalhador());
  await Promise.all(trabalhadores);
}

/**
 * Levanta a lista COMPLETA e em ordem estável de documentos migrados
 * com anexo — usada tanto pra saber o total (pra você decidir como
 * dividir a faixa entre abas) quanto pra realmente processar.
 */
async function listarDocumentosMigradosComAnexo() {
  const colecoesComAnexo = ["licitacoes", "processosDespesa", "processosPessoal", "atosAdministrativos"];
  const lista = [];
  for (const colecao of colecoesComAnexo) {
    const snapshot = await colecaoEntidade(colecao).where("origemAppSheetId", ">", "").orderBy("origemAppSheetId").get({ source: "server" });
    snapshot.docs.forEach((doc) => {
      const dados = doc.data();
      if ((dados.anexos || []).length > 0) {
        lista.push({ colecao, ref: doc.ref, dados });
      }
    });
  }
  return lista;
}

/**
 * Corrige os anexos migrados. `faixa` é opcional — { inicio, fim }
 * (1-indexado, inclusive) pra rodar só uma fatia dos documentos, o que
 * permite abrir várias abas em paralelo, cada uma numa faixa diferente,
 * sem risco de duas abas mexerem no mesmo registro ao mesmo tempo.
 */
async function corrigirAnexosMigrados(aoProgredir, faixa = null) {
  const todosDocumentos = await listarDocumentosMigradosComAnexo();
  const inicio = faixa?.inicio ? Math.max(1, faixa.inicio) - 1 : 0;
  const fim = faixa?.fim ? Math.min(faixa.fim, todosDocumentos.length) : todosDocumentos.length;
  const documentos = todosDocumentos.slice(inicio, fim);

  const totalAnexos = documentos.reduce((soma, d) => soma + d.dados.anexos.length, 0);
  if (totalAnexos === 0) {
    return { totalAnexos: 0, corrigidos: 0, jaEstavamCorretos: 0, falhas: [], totalDocumentosNaColecao: todosDocumentos.length };
  }

  let corrigidos = 0;
  let jaEstavamCorretos = 0;
  const falhas = [];

  async function corrigirUmDocumento(documento) {
    const { colecao } = documento;
    // Trabalha numa cópia local do array — vai sendo atualizada e
    // gravada no Firestore a cada anexo processado (não só no final do
    // registro inteiro), pra que uma queda de conexão no meio não faça
    // perder o que já tinha dado certo nem reenviar de novo à toa.
    let anexosAtuais = [...documento.dados.anexos];

    async function salvarProgressoDoRegistro() {
      await documento.ref.update({ anexos: anexosAtuais });
    }

    for (let i = 0; i < documento.dados.anexos.length; i++) {
      const anexo = documento.dados.anexos[i];

      // Já foi corrigido numa rodada anterior — mas confirma que o
      // arquivo ainda existe de verdade antes de confiar cegamente
      // na marcação (por exemplo, se alguém excluiu a pasta nova por
      // engano no Drive, a marcação ficaria "mentindo").
      if (anexo.corrigidoAppSheet) {
        const tokenVerificacao = await obterAccessTokenDrive();
        const aindaExiste = await arquivoAindaExisteNoDrive(anexo.driveFileId, tokenVerificacao);
        if (aindaExiste) {
          jaEstavamCorretos++;
          aoProgredir?.(corrigidos + jaEstavamCorretos + falhas.length, totalAnexos);
          continue;
        }
        // Arquivo sumiu — precisa corrigir de novo, cai pro fluxo normal abaixo
      }

      try {
        const tokenLeitura = await obterAccessTokenDrive();
        let blob = null;

        // Tenta primeiro pelo ID que já estava salvo (mais rápido,
        // não precisa buscar) — só pula essa tentativa se já sabemos
        // que a cópia "corrigida" sumiu.
        if (!anexo.corrigidoAppSheet) {
          try {
            const resposta = await fetch(`https://www.googleapis.com/drive/v3/files/${anexo.driveFileId}?alt=media&supportsAllDrives=true`, {
              headers: { Authorization: `Bearer ${tokenLeitura}` },
            });
            if (resposta.ok) blob = await resposta.blob();
          } catch (erroDownloadDireto) {
            // segue pro fallback abaixo
          }
        }

        // Se não conseguiu pelo ID salvo (ID inválido, arquivo sumiu,
        // ou já sabíamos que a cópia corrigida tinha sido excluída),
        // busca o arquivo de novo pelo NOME em qualquer pasta do
        // AppSheet, antes de desistir.
        if (!blob) {
          const encontrado = await buscarArquivoEmQualquerPastaAppSheet(anexo.nomeArquivo, tokenLeitura);
          if (!encontrado) throw new Error("Não foi encontrado nem pelo ID salvo, nem buscando pelo nome nas pastas do AppSheet.");
          const resposta = await fetch(`https://www.googleapis.com/drive/v3/files/${encontrado.id}?alt=media&supportsAllDrives=true`, {
            headers: { Authorization: `Bearer ${tokenLeitura}` },
          });
          if (!resposta.ok) throw new Error("Achou o arquivo pelo nome, mas não conseguiu baixar o conteúdo.");
          blob = await resposta.blob();
        }

        const arquivo = new File([blob], anexo.nomeArquivo, { type: detectarTipoPorExtensao(anexo.nomeArquivo) });
        const novoAnexo = await enviarPdfParaDrive(arquivo, colecao, () => {}, { permitirQualquerTipo: true });
        novoAnexo.volume = anexo.volume;
        novoAnexo.dataUpload = anexo.dataUpload || new Date().toISOString();
        novoAnexo.usuarioUpload = anexo.usuarioUpload || estado.usuario.email;
        novoAnexo.corrigidoAppSheet = true; // marca que esse já foi corrigido, pra não refazer numa próxima rodada

        // Assim que ESSE anexo termina (upload já concluído de verdade,
        // arquivo já existe no Drive), grava no Firestore na hora —
        // não espera os outros anexos do mesmo registro.
        anexosAtuais[i] = novoAnexo;
        await salvarProgressoDoRegistro();
        corrigidos++;
      } catch (erro) {
        console.warn(`Falha ao corrigir anexo "${anexo.nomeArquivo}":`, erro);
        // mantém o anexo antigo em anexosAtuais[i] (não perde a referência)
        falhas.push(`${anexo.nomeArquivo} (${ROTULOS_COLECAO_HISTORICO[colecao] || colecao}) — ${erro.message}`);
      }
      aoProgredir?.(corrigidos + jaEstavamCorretos + falhas.length, totalAnexos);
    }
  }

  // Processa vários documentos ao mesmo tempo (mesma aba, mesma
  // execução) — bem mais rápido que um por um, sem os riscos de abrir
  // várias abas descoordenadas.
  const QUANTIDADE_SIMULTANEA = 6;
  await processarComConcorrencia(documentos, QUANTIDADE_SIMULTANEA, corrigirUmDocumento);

  return { totalAnexos, corrigidos, jaEstavamCorretos, falhas, totalDocumentosNaColecao: todosDocumentos.length };
}

/**
 * Confere se a migração está completa: pra cada item do pacote
 * original, verifica se o registro existe, se todos os anexos
 * esperados estão presentes, e se o arquivo do Drive de cada um
 * realmente existe (não só se tem um ID salvo). Não altera nada — só
 * gera um relatório.
 */
/**
 * Encontra pastas de módulo duplicadas (criadas por engano quando
 * várias correções rodavam ao mesmo tempo, antes da trava contra isso)
 * dentro da pasta raiz da unidade gestora, move os arquivos delas pra
 * dentro da pasta OFICIAL (a que está de fato registrada no Firestore)
 * e exclui as pastas que sobrarem vazias. Só move — nunca baixa nem
 * reenvia o conteúdo do PDF, por isso é rápido mesmo com muitos arquivos.
 */
async function reorganizarPastasDuplicadas(aoProgredir) {
  const refEntidade = db.collection("entidades").doc(estado.entidadeAtual);
  const doc = await refEntidade.get();
  const pastasDrive = doc.data().pastasDrive || {};
  const raizId = pastasDrive._raiz;

  if (!raizId) {
    return { pastasDuplicadasEncontradas: 0, arquivosMovidos: 0, pastasExcluidas: 0, falhas: [] };
  }

  const token = await obterAccessTokenDrive();

  // Lista todas as subpastas dentro da pasta raiz da unidade gestora
  const respostaSubpastas = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${raizId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const dadosSubpastas = await respostaSubpastas.json();
  const subpastas = dadosSubpastas.files || [];

  // Agrupa por nome — qualquer grupo com mais de uma pasta é duplicata
  const porNome = {};
  subpastas.forEach((p) => { (porNome[p.name] = porNome[p.name] || []).push(p); });

  const relatorio = { pastasDuplicadasEncontradas: 0, arquivosMovidos: 0, pastasExcluidas: 0, falhas: [] };
  const gruposDuplicados = Object.entries(porNome).filter(([nome, lista]) => lista.length > 1);
  const totalPastasDuplicadas = gruposDuplicados.reduce((soma, [, lista]) => soma + lista.length - 1, 0);
  let pastasProcessadas = 0;

  for (const [nomeModulo, lista] of gruposDuplicados) {
    const idOficial = pastasDrive[nomeModulo];
    // Se por algum motivo o ID oficial não bate com nenhuma pasta encontrada,
    // usa a primeira da lista como "oficial" pra não travar a reorganização.
    const pastaOficial = lista.find((p) => p.id === idOficial) || lista[0];
    const duplicadas = lista.filter((p) => p.id !== pastaOficial.id);

    for (const duplicada of duplicadas) {
      relatorio.pastasDuplicadasEncontradas++;
      try {
        // Lista os arquivos dentro dessa pasta duplicada
        const respostaArquivos = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${duplicada.id}' in parents and trashed=false`)}&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const dadosArquivos = await respostaArquivos.json();
        const arquivos = dadosArquivos.files || [];

        for (const arquivo of arquivos) {
          const respostaMove = await fetch(
            `https://www.googleapis.com/drive/v3/files/${arquivo.id}?addParents=${pastaOficial.id}&removeParents=${duplicada.id}&supportsAllDrives=true`,
            { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }
          );
          if (respostaMove.ok) {
            relatorio.arquivosMovidos++;
          } else {
            relatorio.falhas.push(`Não consegui mover "${arquivo.name}" (pasta ${nomeModulo})`);
          }
        }

        // Pasta duplicada já deve estar vazia agora — exclui
        const respostaExcluir = await fetch(
          `https://www.googleapis.com/drive/v3/files/${duplicada.id}?supportsAllDrives=true`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
        );
        if (respostaExcluir.ok) relatorio.pastasExcluidas++;
      } catch (erro) {
        relatorio.falhas.push(`Erro ao reorganizar pasta "${nomeModulo}" (${duplicada.id}): ${erro.message}`);
      }
      pastasProcessadas++;
      aoProgredir?.(pastasProcessadas, totalPastasDuplicadas);
    }
  }

  return relatorio;
}

async function rodarVarreduraFinal(pacote, aoProgredir) {
  const colecoesComAnexo = [
    { chave: "licitacoes", itens: pacote.licitacoes },
    { chave: "processosDespesa", itens: pacote.processosDespesa },
    { chave: "processosPessoal", itens: pacote.processosPessoal },
    { chave: "atosAdministrativos", itens: pacote.atosAdministrativos },
  ];

  const relatorio = {
    registrosFaltando: [],
    anexosFaltando: [],
    anexosComArquivoQuebrado: [],
    anexosAindaNaoCorrigidos: [],
    totalRegistrosConferidos: 0,
    totalAnexosConferidos: 0,
  };

  const token = await obterAccessTokenDrive();
  let processados = 0;
  const totalItens = colecoesComAnexo.reduce((soma, c) => soma + (c.itens || []).length, 0);

  for (const { chave, itens } of colecoesComAnexo) {
    const snapshot = await colecaoEntidade(chave).where("origemAppSheetId", ">", "").get({ source: "server" });
    const existentesPorOrigem = new Map();
    snapshot.docs.forEach((doc) => existentesPorOrigem.set(doc.data().origemAppSheetId, doc.data()));

    await processarComConcorrencia(itens || [], 8, async (item) => {
      processados++;
      aoProgredir?.(processados, totalItens);
      relatorio.totalRegistrosConferidos++;

      const existente = existentesPorOrigem.get(item.origemAppSheetId);
      if (!existente) {
        relatorio.registrosFaltando.push(`${chave} (origem ${item.origemAppSheetId})`);
        return;
      }

      const nomesPresentes = new Set((existente.anexos || []).map((a) => a.nomeArquivo));
      for (const anexoEsperado of item.anexos || []) {
        relatorio.totalAnexosConferidos++;
        if (!nomesPresentes.has(anexoEsperado.nomeArquivo)) {
          relatorio.anexosFaltando.push(`${chave} (origem ${item.origemAppSheetId}): ${anexoEsperado.nomeArquivo}`);
        }
      }

      // Confere cada anexo já presente: se o arquivo existe de verdade,
      // E se já é uma cópia "do app" (corrigidoAppSheet) — um arquivo
      // que só existe porque ainda aponta pro original do AppSheet vai
      // quebrar assim que o Refresh Token voltar pro definitivo, mesmo
      // que agora, com o token de leitura ampla, pareça "existir normal".
      for (const anexoPresente of existente.anexos || []) {
        const existe = await arquivoAindaExisteNoDrive(anexoPresente.driveFileId, token);
        if (!existe) {
          relatorio.anexosComArquivoQuebrado.push(`${chave} (origem ${item.origemAppSheetId}): ${anexoPresente.nomeArquivo}`);
        } else if (!anexoPresente.corrigidoAppSheet) {
          relatorio.anexosAindaNaoCorrigidos.push(`${chave} (origem ${item.origemAppSheetId}): ${anexoPresente.nomeArquivo}`);
        }
      }
    });
  }

  return relatorio;
}

/**
 * Roda a migração completa. `pacote` é o .json já processado.
 * `aoProgredir(etapa, feitos, total)` é chamado periodicamente pra
 * atualizar a barra de progresso.
 */
async function executarMigracaoAppSheet(pacote, aoProgredir) {
  const relatorio = {
    cadastros: {},
    registros: {},
    anexosEncontrados: 0,
    anexosNaoEncontrados: [],
  };
  const mapaId = {}; // tempId -> { id, nome } do registro real já criado (ou reaproveitado)

  // ---------- ETAPA 1: cadastros de apoio ----------
  async function resolverCadastro(nomeColecao, itens, montarExtras) {
    const snapshot = await colecaoEntidade(nomeColecao).get({ source: "server" });
    const existentesPorNome = new Map();
    snapshot.docs.forEach((doc) => existentesPorNome.set(doc.data().nomeNormalizado, { id: doc.id, nome: doc.data().nome }));

    let criados = 0;
    for (const item of itens || []) {
      const nomeNorm = normalizarTexto(item.nome);
      if (existentesPorNome.has(nomeNorm)) {
        mapaId[item.tempId] = existentesPorNome.get(nomeNorm);
        continue;
      }
      const dados = { nome: item.nome, nomeNormalizado: nomeNorm, ...(montarExtras ? montarExtras(item) : {}) };
      const ref = await colecaoEntidade(nomeColecao).add(dados);
      mapaId[item.tempId] = { id: ref.id, nome: item.nome };
      existentesPorNome.set(nomeNorm, { id: ref.id, nome: item.nome });
      criados++;
    }
    relatorio.cadastros[nomeColecao] = { criados, total: (itens || []).length };
  }

  await resolverCadastro("modalidadesLicitacao", pacote.modalidadesLicitacao);
  await resolverCadastro("unidadesOrcamentarias", pacote.unidadesOrcamentarias, () => ({ codigo: "" }));
  await resolverCadastro("fontesRecurso", pacote.fontesRecurso, (i) => ({ codigo: i.codigo || "" }));
  await resolverCadastro("tiposDocumentoPessoal", pacote.tiposDocumentoPessoal);
  await resolverCadastro("tiposAtoAdministrativo", pacote.tiposAtoAdministrativo);
  await resolverCadastro("servidores", pacote.servidores, (i) => ({ matricula: i.matricula || "" }));
  await resolverCadastro("credores", pacote.credores, (i) => ({ tipo: i.tipo || "PJ", documento: i.documento || "" }));
  aoProgredir?.("Criando cadastros de apoio", 1, 1);

  // ---------- Cache de busca de anexos no Drive (evita buscar o mesmo arquivo duas vezes) ----------
  const token = await obterAccessTokenDrive();
  const cacheArquivos = new Map();

  async function resolverAnexo(anexoBruto) {
    const chave = `${anexoBruto.pastaOrigem}|${anexoBruto.nomeArquivo}`;
    if (cacheArquivos.has(chave)) return cacheArquivos.get(chave);
    const pastaId = PASTAS_DRIVE_APPSHEET[anexoBruto.pastaOrigem];
    const encontrado = pastaId ? await buscarArquivoNoDrivePorNome(anexoBruto.nomeArquivo, pastaId, token) : null;
    cacheArquivos.set(chave, encontrado);
    return encontrado;
  }

  // ---------- ETAPA 2: registros principais (com busca de anexo por item) ----------
  async function migrarColecao(nomeColecao, itens, montarDados) {
    const snapshot = await colecaoEntidade(nomeColecao).get({ source: "server" });
    const existentesPorOrigem = new Map();
    snapshot.docs.forEach((doc) => {
      const dados = doc.data();
      if (dados.origemAppSheetId) {
        existentesPorOrigem.set(dados.origemAppSheetId, { ref: doc.ref, anexos: dados.anexos || [] });
      }
    });

    let criados = 0, atualizados = 0, pulados = 0, processados = 0;
    const TAMANHO_LOTE = 300;
    let lote = db.batch();
    let contadorLote = 0;

    for (const item of itens || []) {
      processados++;
      const existente = existentesPorOrigem.get(item.origemAppSheetId);

      // Compara pelo NOME do arquivo — só busca no Drive os anexos da
      // fonte que ainda não estão no registro já existente (permite
      // completar anexos que faltaram numa tentativa anterior, sem
      // duplicar os que já foram migrados com sucesso).
      const nomesJaPresentes = new Set((existente?.anexos || []).map((a) => a.nomeArquivo));
      const anexosBrutosFaltando = (item.anexos || []).filter((a) => !nomesJaPresentes.has(a.nomeArquivo));

      if (existente && anexosBrutosFaltando.length === 0) {
        pulados++; // já tem todos os anexos que a fonte lista
        aoProgredir?.(nomeColecao, processados, itens.length);
        continue;
      }

      const anexosNovosResolvidos = [];
      for (const anexoBruto of anexosBrutosFaltando) {
        const encontrado = await resolverAnexo(anexoBruto);
        if (encontrado) {
          anexosNovosResolvidos.push({
            driveFileId: encontrado.id,
            nomeArquivo: anexoBruto.nomeArquivo,
            volume: anexoBruto.volume || 1,
            tamanhoBytes: parseInt(encontrado.size || "0", 10),
            paginas: null, // não contado na migração, pra não deixar o processo lento demais
            dataUpload: new Date().toISOString(),
            usuarioUpload: estado.usuario.email,
          });
          relatorio.anexosEncontrados++;
        } else {
          relatorio.anexosNaoEncontrados.push(`${nomeColecao} (${item.origemAppSheetId}): ${anexoBruto.nomeArquivo}`);
        }
      }

      if (existente) {
        if (anexosNovosResolvidos.length > 0) {
          const anexosFinais = [...existente.anexos, ...anexosNovosResolvidos];
          lote.update(existente.ref, { anexos: anexosFinais, quantidadeAnexos: anexosFinais.length });
          atualizados++;
          contadorLote++;
        } else {
          pulados++; // continuou sem achar os que faltavam, nada a atualizar
        }
      } else {
        const dados = montarDados(item, anexosNovosResolvidos);
        const ref = colecaoEntidade(nomeColecao).doc();
        lote.set(ref, dados);
        criados++;
        contadorLote++;
      }

      if (contadorLote >= TAMANHO_LOTE) {
        await lote.commit();
        lote = db.batch();
        contadorLote = 0;
      }
      aoProgredir?.(nomeColecao, processados, itens.length);
    }
    if (contadorLote > 0) await lote.commit();
    relatorio.registros[nomeColecao] = { criados, atualizados, pulados, total: (itens || []).length };
  }

  await migrarColecao("licitacoes", pacote.licitacoes, (item, anexos) => ({
    origemAppSheetId: item.origemAppSheetId,
    numero: item.numero,
    numeroNormalizado: normalizarTexto(item.numero),
    ano: item.ano,
    modalidadeId: mapaId[item.modalidadeTempId]?.id || null,
    modalidadeNome: mapaId[item.modalidadeTempId]?.nome || "",
    modalidadeNomeNormalizado: normalizarTexto(mapaId[item.modalidadeTempId]?.nome || ""),
    objeto: item.objeto,
    objetoNormalizado: normalizarTexto(item.objeto),
    anexos,
    quantidadeAnexos: anexos.length,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  }));

  await migrarColecao("processosPessoal", pacote.processosPessoal, (item, anexos) => ({
    origemAppSheetId: item.origemAppSheetId,
    tipoId: mapaId[item.tipoTempId]?.id || null,
    tipoNome: mapaId[item.tipoTempId]?.nome || "",
    tipoNomeNormalizado: normalizarTexto(mapaId[item.tipoTempId]?.nome || ""),
    servidorId: mapaId[item.servidorTempId]?.id || null,
    servidorNome: mapaId[item.servidorTempId]?.nome || null,
    servidorNomeNormalizado: mapaId[item.servidorTempId]?.nome ? normalizarTexto(mapaId[item.servidorTempId].nome) : null,
    competencia: null,
    exercicio: item.exercicio,
    observacoes: item.observacoes || "",
    observacoesNormalizado: normalizarTexto(item.observacoes || ""),
    anexos,
    quantidadeAnexos: anexos.length,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  }));

  await migrarColecao("atosAdministrativos", pacote.atosAdministrativos, (item, anexos) => ({
    origemAppSheetId: item.origemAppSheetId,
    tipoId: mapaId[item.tipoTempId]?.id || null,
    tipoNome: mapaId[item.tipoTempId]?.nome || "",
    tipoNomeNormalizado: normalizarTexto(mapaId[item.tipoTempId]?.nome || ""),
    numero: item.numero,
    numeroNormalizado: normalizarTexto(item.numero),
    exercicio: item.exercicio,
    competencia: null,
    dataEmissao: null,
    descricao: item.descricao || "",
    descricaoNormalizado: normalizarTexto(item.descricao || ""),
    servidoresIds: (item.servidoresTempIds || []).map((tid) => mapaId[tid]?.id).filter(Boolean),
    servidoresNomes: (item.servidoresTempIds || []).map((tid) => mapaId[tid]?.nome).filter(Boolean),
    anexos,
    quantidadeAnexos: anexos.length,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  }));

  await migrarColecao("processosDespesa", pacote.processosDespesa, (item, anexos) => ({
    origemAppSheetId: item.origemAppSheetId,
    numeroEmpenho: item.numeroEmpenho,
    numeroEmpenhoNormalizado: normalizarTexto(item.numeroEmpenho),
    ordemPagamento: item.ordemPagamento || "",
    ordemPagamentoNormalizado: normalizarTexto(item.ordemPagamento || ""),
    elementoDespesa: item.elementoDespesa || "",
    credorId: mapaId[item.credorTempId]?.id || null,
    credorNome: mapaId[item.credorTempId]?.nome || "",
    credorNomeNormalizado: normalizarTexto(mapaId[item.credorTempId]?.nome || ""),
    unidadeOrcamentariaId: mapaId[item.unidadeOrcamentariaTempId]?.id || null,
    fonteRecursoId: mapaId[item.fonteRecursoTempId]?.id || null,
    licitacaoId: null,
    licitacaoIdentificador: null,
    semLicitacaoVinculada: true,
    objeto: item.objeto,
    objetoNormalizado: normalizarTexto(item.objeto),
    dataPagamento: item.dataPagamento,
    competenciaKey: (item.dataPagamento || "").slice(0, 7),
    valor: item.valor || 0,
    anexos,
    quantidadeAnexos: anexos.length,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  }));

  return relatorio;
}
