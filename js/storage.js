// ===================================================================
// ANEXOS VIA FIREBASE STORAGE — armazenamento centralizado
// ===================================================================
// Etapa 1 da migração "Drive de cada cliente → Storage centralizado".
// Essas funções espelham as mesmas de drive.js (enviar, visualizar,
// baixar, excluir, exportar em zip), só que usando o Storage do
// próprio projeto em vez da conta do Google Drive de cada cliente.
//
// IMPORTANTE: nada aqui está ligado à interface do app ainda — é só a
// base pronta, pra testar em separado antes de trocar de verdade
// (Etapa 2). Nenhum botão do app chama essas funções por enquanto.
//
// Vantagem que já fica clara aqui: como não depende mais de token de
// OAuth nem de "achar/criar pasta" (a origem de vários bugs que já
// corrigimos), esse arquivo é bem mais simples que o drive.js.
// ===================================================================

/** Monta o caminho de pasta padrão de um anexo dentro do Storage */
function caminhoPastaStorage(nomeModulo) {
  return `entidades/${estado.entidadeAtual}/${nomeModulo}`;
}

/**
 * Envia um PDF pro Storage. Mesma assinatura de enviarPdfParaDrive
 * (drive.js), pra poder trocar uma pela outra sem reescrever quem
 * chama — só muda o "opcoes.permitirQualquerTipo" que continua igual.
 */
async function enviarPdfParaStorage(arquivo, nomeModulo, aoProgredir, opcoes = {}) {
  const ehPdf = arquivo.type === "application/pdf";
  if (!ehPdf && !opcoes.permitirQualquerTipo) {
    throw new Error("Só é permitido anexar arquivos em PDF.");
  }

  aoProgredir?.("Lendo o documento...");
  let paginas = null;
  if (ehPdf) {
    try {
      paginas = await contarPaginasPdf(arquivo);
    } catch (erro) {
      console.warn(`Não foi possível contar páginas de "${arquivo.name}" (conteúdo pode não ser um PDF válido):`, erro);
      paginas = null;
    }
  }

  // Prefixo aleatório no nome evita dois uploads diferentes com o
  // mesmo nome de arquivo colidirem um em cima do outro no Storage.
  const prefixoUnico = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const caminho = `${caminhoPastaStorage(nomeModulo)}/${prefixoUnico}-${arquivo.name}`;
  const referencia = storage.ref(caminho);

  aoProgredir?.("Enviando pro Storage...");
  await new Promise((resolve, reject) => {
    const tarefa = referencia.put(arquivo, { contentType: arquivo.type || "application/octet-stream" });
    tarefa.on(
      "state_changed",
      (snapshot) => {
        const percentual = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        aoProgredir?.("Enviando...", percentual);
      },
      (erro) => reject(erro),
      () => resolve()
    );
  });

  return {
    storagePath: caminho,
    nomeArquivo: arquivo.name,
    tamanhoBytes: arquivo.size,
    paginas,
    dataUpload: new Date().toISOString(),
    usuarioUpload: estado.usuario.email,
  };
}

/** Abre um PDF do Storage numa aba nova, pra visualizar */
async function visualizarAnexoStorage(storagePath) {
  const url = await storage.ref(storagePath).getDownloadURL();
  window.open(url, "_blank");
}

/** Baixa um PDF do Storage pro computador do usuário */
async function baixarAnexoStorage(storagePath, nomeArquivo) {
  const url = await storage.ref(storagePath).getDownloadURL();
  const resposta = await fetch(url);
  const blob = await resposta.blob();
  const urlObjeto = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = urlObjeto;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(urlObjeto);
}

/** Exclui um arquivo do Storage */
async function excluirAnexoStorage(storagePath) {
  await storage.ref(storagePath).delete();
}

/**
 * Baixa vários PDFs do Storage e junta num .zip só — mesma ideia de
 * exportarAnexosComoZip (drive.js), usando JSZip.
 */
async function exportarAnexosComoZipStorage(listaDeAnexos, nomeArquivoZip, aoProgredir) {
  if (listaDeAnexos.length === 0) {
    throw new Error("Não há nenhum PDF pra exportar.");
  }
  const zip = new JSZip();
  const nomesUsados = new Set();
  const total = listaDeAnexos.length;

  for (let i = 0; i < total; i++) {
    const anexo = listaDeAnexos[i];
    const url = await storage.ref(anexo.storagePath).getDownloadURL();
    const resposta = await fetch(url);
    const blob = await resposta.blob();

    let nomeNoZip = anexo.nomeArquivo;
    let contador = 2;
    while (nomesUsados.has(nomeNoZip)) {
      nomeNoZip = anexo.nomeArquivo.replace(/\.pdf$/i, ` (${contador}).pdf`);
      contador++;
    }
    nomesUsados.add(nomeNoZip);
    zip.file(nomeNoZip, blob);
    aoProgredir?.(Math.round(((i + 1) / total) * 100), i + 1, total);
  }

  const conteudoZip = await zip.generateAsync({ type: "blob" });
  const urlZip = URL.createObjectURL(conteudoZip);
  const link = document.createElement("a");
  link.href = urlZip;
  link.download = nomeArquivoZip;
  link.click();
  URL.revokeObjectURL(urlZip);
}
