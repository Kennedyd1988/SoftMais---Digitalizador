// ===================================================================
// GESTÃO DE USUÁRIOS
// ===================================================================
const ABAS_PERMISSIVEIS = [
  { chave: "credores", rotulo: "Credores/Fornecedores" },
  { chave: "licitacoes", rotulo: "Licitações" },
  { chave: "despesas", rotulo: "Processos de Despesa" },
  { chave: "legislacao", rotulo: "Legislação" },
  { chave: "documentosDiversos", rotulo: "Documentos Diversos" },
  { chave: "relatorios", rotulo: "Relatórios" },
];

async function renderizarUsuarios(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Usuários</h2>
      <button class="botao-primario" id="btn-novo">+ Novo Usuário</button>
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
  `;

  const entidadesSnapshot = await db.collection("entidades").orderBy("nome").get();
  const todasEntidades = entidadesSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  async function carregarLista() {
    const lista = document.getElementById("lista-registros");
    lista.innerHTML = "";
    const snapshot = await db.collection("usuarios").orderBy("nomeNormalizado").get();
    snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro cartao-clicavel";
    const rotulosPapel = { administrador: "Administrador", cadastrador: "Cadastrador", leitura: "Leitura" };
    cartao.innerHTML = `
      <div>
        <strong>${registro.nome}</strong> — ${registro.email}
        <div class="texto-secundario">${rotulosPapel[registro.papel] || registro.papel}</div>
      </div>
    `;
    cartao.addEventListener("click", () => abrirFormulario(registro));
    return cartao;
  }

  function abrirFormulario(registro = null) {
    const modal = criarModal(`${registro ? "Editar" : "Novo"} Usuário`, `
      <label>Nome *</label>
      <input type="text" id="campo-nome" value="${registro?.nome || ""}">
      <label>E-mail *</label>
      <input type="email" id="campo-email" value="${registro?.email || ""}" ${registro ? "disabled" : ""}>
      ${!registro ? `<label>Senha inicial *</label><input type="password" id="campo-senha">` : ""}
      <label>Papel *</label>
      <select id="campo-papel">
        <option value="administrador" ${registro?.papel === "administrador" ? "selected" : ""}>Administrador</option>
        <option value="cadastrador" ${registro?.papel === "cadastrador" ? "selected" : ""}>Cadastrador</option>
        <option value="leitura" ${registro?.papel === "leitura" ? "selected" : ""}>Leitura</option>
      </select>

      <label>Unidades gestoras liberadas</label>
      <div class="lista-checkboxes" id="lista-entidades">
        ${todasEntidades.map((e) => `
          <label class="item-checkbox">
            <input type="checkbox" value="${e.id}" ${(registro?.unidadesGestoras || []).includes(e.id) ? "checked" : ""}>
            ${e.nome}
          </label>
        `).join("")}
      </div>

      <label>Abas liberadas (ignorado se o papel for Administrador)</label>
      <div class="lista-checkboxes" id="lista-abas">
        ${ABAS_PERMISSIVEIS.map((a) => `
          <label class="item-checkbox">
            <input type="checkbox" value="${a.chave}" ${(registro?.abasPermitidas || []).includes(a.chave) ? "checked" : ""}>
            ${a.rotulo}
          </label>
        `).join("")}
      </div>
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      const campoEmail = document.getElementById("campo-email");
      limparCampoInvalido(campoNome);
      limparCampoInvalido(campoEmail);

      const nome = campoNome.value.trim();
      const email = campoEmail.value.trim();
      let valido = true;
      if (!nome) { marcarCampoInvalido(campoNome, "Informe o nome."); valido = false; }
      if (!email) { marcarCampoInvalido(campoEmail, "Informe o e-mail."); valido = false; }
      if (!valido) return;

      const papel = document.getElementById("campo-papel").value;
      const unidadesGestoras = [...document.querySelectorAll("#lista-entidades input:checked")].map((c) => c.value);
      const abasPermitidas = [...document.querySelectorAll("#lista-abas input:checked")].map((c) => c.value);

      // Nunca deixar o sistema ficar sem nenhum administrador
      if (registro && registro.papel === "administrador" && papel !== "administrador") {
        const totalAdmins = (await db.collection("usuarios").where("papel", "==", "administrador").get()).size;
        if (totalAdmins <= 1) {
          mostrarToast("Não é possível rebaixar o único administrador do sistema.", "erro");
          return;
        }
      }

      await executarComFeedback(botaoSalvar, async () => {
        if (registro) {
          await db.collection("usuarios").doc(registro.id).update({
            nome, nomeNormalizado: normalizarTexto(nome), papel, unidadesGestoras, abasPermitidas,
          });
        } else {
          const senha = document.getElementById("campo-senha").value;
          if (!senha || senha.length < 6) {
            mostrarToast("A senha inicial precisa ter ao menos 6 caracteres.", "erro");
            return;
          }
          // Usa a instância secundária do Firebase para não deslogar o
          // administrador que está criando a conta.
          const credencial = await authSecundario.createUserWithEmailAndPassword(email, senha);
          await db.collection("usuarios").doc(credencial.user.uid).set({
            nome, nomeNormalizado: normalizarTexto(nome), email, papel, unidadesGestoras, abasPermitidas,
          });
          await authSecundario.signOut();
        }
        fecharModal();
        mostrarToast("Usuário salvo com sucesso.", "sucesso");
        carregarLista();
      });
    });
  }

  document.getElementById("btn-novo").addEventListener("click", () => abrirFormulario());
  carregarLista();
}

// ===================================================================
// UNIDADES GESTORAS (multiempresa/multiente — mesmo padrão do app de igrejas)
// ===================================================================
async function renderizarUnidadesGestoras(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Unidades Gestoras</h2>
      <button class="botao-primario" id="btn-novo">+ Nova Unidade Gestora</button>
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
  `;

  async function carregarLista() {
    const lista = document.getElementById("lista-registros");
    lista.innerHTML = "";
    const snapshot = await db.collection("entidades").orderBy("nome").get();
    snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro cartao-clicavel";
    cartao.innerHTML = `<div><strong>${registro.nome}</strong><div class="texto-secundario">${registro.cnpj || ""}</div></div>`;
    cartao.addEventListener("click", () => abrirFormulario(registro));
    return cartao;
  }

  function abrirFormulario(registro = null) {
    criarModal(`${registro ? "Editar" : "Nova"} Unidade Gestora`, `
      <label>Nome *</label>
      <input type="text" id="campo-nome" value="${registro?.nome || ""}">
      <label>CNPJ</label>
      <input type="text" id="campo-cnpj" value="${registro?.cnpj || ""}">
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      limparCampoInvalido(campoNome);
      const nome = campoNome.value.trim();
      if (!nome) { marcarCampoInvalido(campoNome, "Informe o nome."); return; }

      await executarComFeedback(botaoSalvar, async () => {
        const dados = { nome, cnpj: document.getElementById("campo-cnpj").value.trim() };
        if (registro) {
          await db.collection("entidades").doc(registro.id).update(dados);
        } else {
          await db.collection("entidades").add(dados);
        }
        fecharModal();
        mostrarToast("Unidade gestora salva com sucesso.", "sucesso");
        carregarLista();
      });
    });
  }

  document.getElementById("btn-novo").addEventListener("click", () => abrirFormulario());
  carregarLista();
}
