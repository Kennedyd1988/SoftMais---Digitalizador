// ===================================================================
// INTEGRAÇÃO COM O GOOGLE DRIVE
// ===================================================================
// Todos os PDFs ficam armazenados numa única conta Google (institucional
// deste projeto), organizados em pastas por unidade gestora e por módulo.
// O app nunca guarda a senha/chave dessa conta — ele pede um "passe"
// temporário (access token) pra Cloud Function obterTokenDrive sempre
// que precisa subir, ver ou baixar um arquivo.

// Cache por unidade gestora — importante, porque cada uma pode ter sua
// própria conta do Drive (ver função obterAccessTokenDrive). Um cache
// único e global serviria o token errado se o usuário trocasse de
// unidade gestora no meio da sessão.
let cacheTokenDrivePorEntidade = {};

/** Devolve um access token válido, renovando com a Cloud Function se preciso */
async function obterAccessTokenDrive() {
  const entidadeId = estado.entidadeAtual;
  const cache = cacheTokenDrivePorEntidade[entidadeId] || { valor: null, expiraEm: 0 };
  const agora = Date.now();
  // Renova um pouco antes de expirar (margem de 60s) pra evitar corrida
  if (cache.valor && agora < cache.expiraEm - 60000) {
    return cache.valor;
  }

  const idToken = await estado.usuario.getIdToken();
  const resposta = await fetch(URL_FUNCAO_TOKEN_DRIVE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entidadeId }),
  });

  if (!resposta.ok) {
    throw new Error("Não foi possível conectar ao Google Drive no momento.");
  }

  const dados = await resposta.json();
  cacheTokenDrivePorEntidade[entidadeId] = {
    valor: dados.access_token,
    expiraEm: agora + dados.expires_in * 1000,
  };
  return dados.access_token;
}

// Cache separado pra conta compartilhada (padrão) — usado só na
// migração de anexos, quando é preciso buscar arquivos que ainda estão
// na conta antiga, mesmo já tendo trocado a unidade gestora pra sua
// própria conta.
let cacheTokenCompartilhado = { valor: null, expiraEm: 0 };

/** Devolve um access token da conta COMPARTILHADA (padrão), ignorando o Refresh Token próprio da unidade gestora atual */
async function obterAccessTokenDriveCompartilhado() {
  const agora = Date.now();
  if (cacheTokenCompartilhado.valor && agora < cacheTokenCompartilhado.expiraEm - 60000) {
    return cacheTokenCompartilhado.valor;
  }

  const idToken = await estado.usuario.getIdToken();
  const resposta = await fetch(URL_FUNCAO_TOKEN_DRIVE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}), // sem entidadeId → a função usa a conta compartilhada padrão
  });

  if (!resposta.ok) {
    throw new Error("Não foi possível conectar à conta compartilhada do Google Drive.");
  }

  const dados = await resposta.json();
  cacheTokenCompartilhado = { valor: dados.access_token, expiraEm: agora + dados.expires_in * 1000 };
  return dados.access_token;
}

/**
 * Garante que existe (ou cria) a pasta da unidade gestora + submódulo no
 * Drive, e devolve o ID dessa pasta. Os IDs ficam guardados no Firestore
 * pra não precisar procurar no Drive toda vez.
 */
// Evita criar a mesma pasta duas vezes quando várias correções rodam
// em paralelo (ex: 6 documentos ao mesmo tempo, todos precisando da
// pasta "processosPessoal" pela primeira vez) — a primeira chamada
// "reserva" a promessa aqui; as concorrentes esperam essa mesma
// promessa em vez de cada uma criar sua própria pasta.
const promessasCriacaoPastaModulo = {};

async function obterOuCriarPastaModulo(nomeModulo) {
  const chaveCache = `${estado.entidadeAtual}_${nomeModulo}`;

  // Já tem uma criação em andamento (de outra tarefa concorrente) —
  // espera o resultado dela em vez de começar outra.
  if (promessasCriacaoPastaModulo[chaveCache]) {
    return promessasCriacaoPastaModulo[chaveCache];
  }

  const promessa = (async () => {
    const refEntidade = db.collection("entidades").doc(estado.entidadeAtual);
    const doc = await refEntidade.get();
    const dados = doc.data();
    const pastasDrive = dados.pastasDrive || {};

    if (pastasDrive[nomeModulo]) {
      return pastasDrive[nomeModulo];
    }

    const token = await obterAccessTokenDrive();

    // Cria a pasta raiz da entidade, se ainda não existir
    let pastaRaizId = pastasDrive._raiz;
    if (!pastaRaizId) {
      pastaRaizId = await criarPastaDrive(token, `SOFT+ Indexação - ${dados.nome}`, null);
      pastasDrive._raiz = pastaRaizId;
    }

    const pastaModuloId = await criarPastaDrive(token, nomeModulo, pastaRaizId);
    pastasDrive[nomeModulo] = pastaModuloId;

    await refEntidade.update({ pastasDrive });
    return pastaModuloId;
  })();

  promessasCriacaoPastaModulo[chaveCache] = promessa;
  try {
    return await promessa;
  } finally {
    // Libera o cache depois de resolvida — próximas chamadas (já com a
    // pasta salva no Firestore) só vão precisar da leitura rápida acima.
    delete promessasCriacaoPastaModulo[chaveCache];
  }
}

async function criarPastaDrive(token, nome, pastaPaiId) {
  const metadados = {
    name: nome,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (pastaPaiId) metadados.parents = [pastaPaiId];

  const resposta = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadados),
  });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.error?.message || "Erro ao criar pasta no Drive");
  return dados.id;
}

/**
 * Envia um arquivo PDF pro Drive, dentro da pasta do módulo indicado.
 * Devolve { driveFileId, nomeArquivo, tamanhoBytes, paginas }
 */
async function enviarPdfParaDrive(arquivo, nomeModulo, aoProgredir, opcoes = {}) {
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
      // O arquivo está marcado como PDF, mas o conteúdo não é um PDF
      // de verdade (comum em anexos antigos migrados, onde às vezes é
      // na real uma foto/imagem) — não trava o envio por causa disso,
      // só segue sem a contagem de página.
      console.warn(`Não foi possível contar páginas de "${arquivo.name}" (conteúdo pode não ser um PDF válido):`, erro);
      paginas = null;
    }
  }

  aoProgredir?.("Conectando ao Google Drive...");
  const token = await obterAccessTokenDrive();
  const pastaId = await obterOuCriarPastaModulo(nomeModulo);

  const metadados = {
    name: arquivo.name,
    parents: [pastaId],
  };

  const tipoReal = arquivo.type || "application/pdf";
  const limite = "-------soft-plus-boundary-------";
  const corpo =
    `--${limite}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadados)}\r\n` +
    `--${limite}\r\n` +
    `Content-Type: ${tipoReal}\r\n\r\n`;

  const bytesArquivo = await arquivo.arrayBuffer();
  const rodape = `\r\n--${limite}--`;

  const corpoCompleto = new Blob([corpo, bytesArquivo, rodape]);

  aoProgredir?.("Enviando arquivo...", 0);
  const dados = await enviarComProgresso(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true",
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${limite}`,
    },
    corpoCompleto,
    (percentual) => aoProgredir?.("Enviando arquivo...", percentual)
  );

  return {
    driveFileId: dados.id,
    nomeArquivo: arquivo.name,
    tamanhoBytes: arquivo.size,
    paginas,
    dataUpload: new Date().toISOString(),
    usuarioUpload: estado.usuario.email,
  };
}

/**
 * Envia dados via XMLHttpRequest (em vez de fetch), porque só o XHR
 * expõe o evento de progresso do upload (fetch não avisa quantos bytes
 * já foram enviados, só quando termina por completo).
 */
function enviarComProgresso(url, cabecalhos, corpo, aoProgresso) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(cabecalhos).forEach(([nome, valor]) => xhr.setRequestHeader(nome, valor));

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) {
        aoProgresso(Math.round((evento.loaded / evento.total) * 100));
      }
    };

    xhr.onload = () => {
      let dados;
      try {
        dados = JSON.parse(xhr.responseText);
      } catch (erro) {
        dados = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        aoProgresso(100);
        resolve(dados);
      } else {
        reject(new Error(dados.error?.message || "Falha ao enviar o arquivo para o Drive."));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de rede ao enviar o arquivo. Verifique sua conexão."));

    xhr.send(corpo);
  });
}

/**
 * Baixa um arquivo via XMLHttpRequest acompanhando o progresso real em
 * bytes (mesmo motivo do upload: fetch não avisa progresso de download
 * enquanto está rolando, só quando termina).
 */
function baixarComProgresso(url, token, aoProgresso) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.responseType = "blob";

    xhr.onprogress = (evento) => {
      if (evento.lengthComputable) {
        aoProgresso?.(Math.round((evento.loaded / evento.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        aoProgresso?.(100);
        resolve(xhr.response);
      } else {
        reject(new Error("Não foi possível baixar o documento."));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de rede ao baixar o documento."));
    xhr.send();
  });
}

/** Abre o PDF numa aba nova, buscando os bytes com autenticação */
async function visualizarAnexo(driveFileId, aoProgredir) {
  const token = await obterAccessTokenDrive();
  const blob = await baixarComProgresso(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media&supportsAllDrives=true`,
    token,
    aoProgredir
  );
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

/** Baixa o PDF para o computador do usuário */
async function baixarAnexo(driveFileId, nomeArquivo, aoProgredir) {
  const token = await obterAccessTokenDrive();
  const blob = await baixarComProgresso(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media&supportsAllDrives=true`,
    token,
    aoProgredir
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(url);
}

/** Exclui o arquivo do Drive (usado quando um anexo é removido de um registro) */
async function excluirAnexoDrive(driveFileId) {
  const token = await obterAccessTokenDrive();
  await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Baixa vários anexos de uma vez, compactados num único .zip. Usado
 * tanto na exportação em lote (seleção de registros) quanto na
 * exportação de "todos os PDFs de uma licitação e suas despesas
 * vinculadas".
 * @param {Array} listaDeAnexos - [{ driveFileId, nomeArquivo }]
 * @param {string} nomeArquivoZip
 * @param {Function} [aoProgredir] - recebe (percentualGeral, concluidos, total)
 */
async function exportarAnexosComoZip(listaDeAnexos, nomeArquivoZip, aoProgredir) {
  if (listaDeAnexos.length === 0) {
    throw new Error("Não há nenhum PDF pra exportar.");
  }

  const token = await obterAccessTokenDrive();
  const zip = new JSZip();
  const nomesUsados = new Set();
  const total = listaDeAnexos.length;

  for (let i = 0; i < total; i++) {
    const anexo = listaDeAnexos[i];
    let blob;
    try {
      blob = await baixarComProgresso(
        `https://www.googleapis.com/drive/v3/files/${anexo.driveFileId}?alt=media&supportsAllDrives=true`,
        token,
        (percentualArquivo) => {
          // Progresso geral = arquivos já concluídos + fração do atual
          const percentualGeral = Math.round(((i + percentualArquivo / 100) / total) * 100);
          aoProgredir?.(percentualGeral, i + 1, total);
        }
      );
    } catch (erro) {
      console.warn(`Não foi possível baixar "${anexo.nomeArquivo}", pulando.`);
      aoProgredir?.(Math.round(((i + 1) / total) * 100), i + 1, total);
      continue;
    }

    // Evita sobrescrever se dois anexos tiverem o mesmo nome dentro do zip
    let nomeFinal = anexo.nomeArquivo;
    let contador = 2;
    while (nomesUsados.has(nomeFinal)) {
      nomeFinal = anexo.nomeArquivo.replace(/\.pdf$/i, ` (${contador}).pdf`);
      contador++;
    }
    nomesUsados.add(nomeFinal);

    zip.file(nomeFinal, blob);
    aoProgredir?.(Math.round(((i + 1) / total) * 100), i + 1, total);
  }

  const blobZip = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blobZip);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivoZip;
  link.click();
  URL.revokeObjectURL(url);
}

/** Conta as páginas do PDF localmente, usando PDF.js, antes do upload */
async function contarPaginasPdf(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  return pdf.numPages;
}
