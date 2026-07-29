// ===================================================================
// CONFIGURAÇÃO DO FIREBASE
// ===================================================================
// Preencha com os dados do seu projeto: Firebase Console → Configurações
// do projeto (ícone de engrenagem) → geral → role até "Seus apps" →
// se não tiver um app da Web criado ainda, clique no ícone "</>" pra
// criar um, e copie o objeto firebaseConfig que aparecer.
const firebaseConfig = {
  apiKey: "AIzaSyCX-tC7Via8VFr45wC-nrSdVh38C9q5nTk",
  authDomain: "softmais-digitalizador.firebaseapp.com",
  projectId: "softmais-digitalizador",
  storageBucket: "softmais-digitalizador.firebasestorage.app",
  messagingSenderId: "563458745236",
  appId: "1:563458745236:web:932057eedb0bb56c02a581",
};

// URL da Cloud Function que renova o acesso ao Google Drive.
// Essa é a que já criamos: obter-token-drive
const URL_FUNCAO_TOKEN_DRIVE =
  "https://obter-token-drive-563458745236.southamerica-east1.run.app";

// Inicializa o Firebase (SDK compat, mesmo padrão dos outros apps SOFT+)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Segunda instância do Firebase — usada só para criar contas de novos
// usuários sem deslogar o administrador que está criando (o Firebase Auth
// desloga automaticamente quem criou a conta se usarmos a instância
// principal; com uma instância separada isso não acontece).
const appSecundario = firebase.initializeApp(firebaseConfig, "secundario");
const authSecundario = appSecundario.auth();
