// ================================================================
// 📚 Connector Executor
// Bibliothèque Générale PreCogn
// ================================================================
// Executor = service partagé Structory, orchestration seule (jamais de logique métier ni de
// stockage propre) — voir ARCHITECTURE.md Suivre Mes Comptes §4. Tout outil consommateur
// (Communicator, futurs autres) doit passer PAR l'Executor pour poser un point de solde,
// jamais appeler ledger_api directement : c'est l'Executor qui reste le gateway unique,
// paramétré par organisation, pour tous les orgs (2026-07-21, retour de Stéphane).

const EXECUTOR_URL = "http://213.32.16.118:8084";

function _callExecutor(endpoint, payload, method) {

  method = method || "POST";

  let url = EXECUTOR_URL + endpoint;

  const options = {
    method: method,
    muteHttpExceptions: true,
    contentType: "application/json"
  };

  if (method === "GET") {

    const qs = _buildQueryString(payload);

    if (qs) {
      url += "?" + qs;
    }

  } else {

    if (payload !== null && payload !== undefined) {
      options.payload = JSON.stringify(payload);
    }

  }

  const response = UrlFetchApp.fetch(url, options);

  const code = response.getResponseCode();
  const text = response.getContentText();

  // Toujours essayer de parser du JSON, même sur un code d'erreur HTTP (400/404/502...) — nos
  // endpoints renvoient {success:false, error:"message clair"} avec un vrai code HTTP, jamais
  // juste un code sans corps exploitable. Lever une exception ici jetterait ce message clair et
  // le remplacerait par "HTTP 502 : {...}" brut affiché tel quel côté client (bug réel trouvé
  // 2026-07-29, retour de Stéphane après un message pourtant nettoyé côté serveur : "tu m'as
  // dit avoir tout paramétré... #fakenews" — la fuite venait de CETTE couche de transport, pas
  // du message lui-même). Seule une réponse qui n'est PAS du JSON valide (vraie panne réseau,
  // proxy, 500 non géré côté Executor) lève encore une exception ici.
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("HTTP " + code + " : " + text);
  }

}

/**
 * Constate le solde d'un compte patrimoine, via l'Executor (jamais ledger_api en direct).
 *
 * @param {string} orgId
 * @param {{etablissement:string, nature:string, solde:number, devise?:string, date?:string}} point
 * @returns {Object} { success, compte, ecart, soldeActuel, soldeNouveau, entry, balanceOk }
 */
function executorBalancePoint(orgId, point) {
  return _callExecutor("/api/executor/balance-point", Object.assign({ orgId: orgId }, point), "POST");
}

/**
 * Vue agrégée patrimoine (Navigator, 2026-07-26) : comptes + solde + mode de synchro (api/manual)
 * en un seul appel, pour la page "application bancaire" (cartes banques, liste comptes).
 *
 * @param {string} orgId
 * @param {string} [module]
 * @returns {Object} { success, comptes: [{nom, etablissement, nature, titulaire, devise, solde, lastDate, syncMode}] }
 */
function executorPatrimoineView(orgId, module) {
  const payload = module ? { orgId: orgId, module: module } : { orgId: orgId };
  return _callExecutor("/api/executor/patrimoine-view", payload, "GET");
}

/**
 * Dates où un solde a réellement été constaté pour cette org (brique "Time", 2026-08-03) —
 * pour naviguer dans l'historique réel du patrimoine, jamais des dates arbitraires.
 * @param {string} orgId
 * @returns {Object} { success, dates: string[] } (YYYY/MM/DD, plus récent en premier)
 */
function executorTimePoints(orgId) {
  return _callExecutor("/api/executor/time-points", { orgId: orgId }, "GET");
}

/**
 * Patrimoine consolidé à une date passée + comparaison avec aujourd'hui (brique "Time").
 * @param {string} orgId
 * @param {string} module
 * @param {string} date YYYY/MM/DD ou YYYY-MM-DD — doit venir de executorTimePoints
 * @returns {Object} { success, date, comptes, totalEurNow, totalEurAtDate, deltaEur }
 */
function executorPatrimoineAt(orgId, module, date) {
  const payload = module ? { orgId: orgId, module: module, date: date } : { orgId: orgId, date: date };
  return _callExecutor("/api/executor/patrimoine-at", payload, "GET");
}

/**
 * Relance une synchronisation pour un seul compte (bouton "lancer une synchronisation" du
 * panneau latéral) — mêmes critères qu'une brique Compte (etablissement+nature+titulaire).
 *
 * @param {string} orgId
 * @param {{etablissement:string, nature:string, titulaire?:string, module?:string}} compte
 * @returns {Object} { success, compte, compteLedger, points } ou { success:false, error }
 */
function executorSyncOne(orgId, compte) {
  return _callExecutor("/api/executor/sync-one", Object.assign({ orgId: orgId }, compte), "POST");
}

/**
 * Démarre une liaison de compte Enable Banking (2026-07-27) — renvoie l'URL vers laquelle
 * rediriger l'utilisateur pour choisir sa banque/consentir. Mode sandbox (par défaut, pas
 * d'identifiants de production configurés pour l'org) : Mock ASPSP toujours forcé côté
 * Executor, `aspspName` ignoré. Mode production (2026-07-28, identifiants propres à l'org via
 * le panneau "Connecteurs") : `aspspName` requis, impossible de deviner quelle vraie banque
 * connecter.
 *
 * @param {string} orgId
 * @param {string} email
 * @param {string} [aspspName] Nom de la banque réelle (mode production uniquement)
 * @returns {Object} { success, url, mode } ou { success:false, error }
 */
function executorEnableBankingStartAuth(orgId, email, aspspName) {
  const payload = { orgId: orgId, email: email };
  if (aspspName) payload.aspspName = aspspName;
  return _callExecutor("/api/executor/enablebanking/start-auth", payload, "POST");
}

/**
 * Comptes renvoyés par Enable Banking pour une liaison en cours, après redirection vers
 * Navigator (voir executorEnableBankingStartAuth) — `state` vient du paramètre `ebPending` de
 * l'URL.
 *
 * @param {string} state
 * @returns {Object} { success, email, accounts } ou { success:false, error }
 */
function executorEnableBankingPending(state) {
  return _callExecutor("/api/executor/enablebanking/pending", { state: state }, "GET");
}

/**
 * Démarre une liaison de compte Powens (webview) — utilise le token permanent déjà associé à
 * cette org (voir connector_powens.py), jamais un nouvel utilisateur Powens.
 *
 * @param {string} orgId
 * @returns {Object} { success, url } ou { success:false, error }
 */
function executorPowensStartAuth(orgId) {
  return _callExecutor("/api/executor/powens/start-auth", { orgId: orgId }, "POST");
}

/**
 * Tous les comptes Powens déjà accessibles pour cette org, toutes connexions confondues
 * (2026-08-06) — à appeler AVANT de lancer une nouvelle webview de connexion bancaire, pour
 * éviter de redemander les identifiants d'une banque déjà connectée (retour de Stéphane :
 * "il demande de rerentrer les identifiants bcp alors qu'il les a déjà depuis la première
 * recherche"). Chaque compte porte `alreadyLinked` (déjà attaché à une brique Compte de cette
 * org) — ne jamais proposer/auto-attacher un compte déjà `alreadyLinked`.
 *
 * @param {string} orgId
 * @param {string} bankName optionnel — filtre sur le nom de banque déjà résolu
 * @returns {Object} { success, accounts } ou { success:false, error }
 */
function executorPowensAccountsAll(orgId, bankName) {
  const payload = bankName ? { orgId: orgId, bankName: bankName } : { orgId: orgId };
  return _callExecutor("/api/executor/powens/accounts", payload, "GET");
}

/**
 * Bootstrap self-service Powens (2026-07-29, retour de Stéphane : "tous les connectors
 * doivent être paramétrables" depuis le panneau d'organisation) : crée un utilisateur Powens
 * permanent isolé pour CETTE org (une seule fois), à partir des identifiants de SON app Powens
 * (domain + client_id + client_secret, jamais réutilisé après cet appel — chaque org a sa
 * propre app, décision définitive 2026-08-02). Le résultat (`authToken`) doit être persisté par
 * l'appelant via `identitySetOrgSecret('powens_credentials',
 * JSON.stringify({domain, auth_token: authToken, client_id: clientId}))` — ce relais ne stocke
 * rien lui-même.
 *
 * @param {string} orgId
 * @param {string} domain ex. "smc-sandbox" (sans le suffixe .biapi.pro)
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Object} { success, authToken } ou { success:false, error }
 */
function executorPowensBootstrap(orgId, domain, clientId, clientSecret) {
  return _callExecutor("/api/executor/powens/bootstrap", { orgId: orgId, domain: domain, clientId: clientId, clientSecret: clientSecret }, "POST");
}

/**
 * Après la connexion bancaire dans la webview Powens (redirigée vers https://structory.ai/
 * ?connection_id=..., seule redirect_uri autorisée par l'app "smc" — pas de callback serveur
 * automatique possible, voir Executor::powens_link_connection), l'utilisateur colle ce lien
 * (ou juste le connection_id) ici pour récupérer la liste de ses comptes Powens.
 *
 * @param {string} orgId
 * @param {string} connectionIdOrUrl
 * @returns {Object} { success, accounts } ou { success:false, error }
 */
function executorPowensLinkConnection(orgId, connectionIdOrUrl) {
  return _callExecutor("/api/executor/powens/link-connection", { orgId: orgId, connectionIdOrUrl: connectionIdOrUrl }, "POST");
}

/**
 * Planning d'envoi du rapport quotidien configuré pour une org (2026-07-29, retour de
 * Stéphane : "laisser au user le choix de paramétrer la fréquence... et l'heure d'envoi").
 *
 * @param {string} orgId
 * @returns {Object} { success, schedule: {frequency, hour, minute, weekday?, dayOfMonth?} }
 */
function executorGetReportSchedule(orgId) {
  return _callExecutor("/api/executor/report-schedule", { orgId: orgId }, "GET");
}

/**
 * Enregistre le planning d'envoi du rapport quotidien d'une org.
 *
 * @param {string} orgId
 * @param {Object} schedule {frequency: 'daily'|'weekly'|'monthly', hour, minute, weekday?, dayOfMonth?}
 * @returns {Object} { success, schedule } ou { success:false, error }
 */
function executorSetReportSchedule(orgId, schedule) {
  return _callExecutor("/api/executor/report-schedule", Object.assign({ orgId: orgId }, schedule), "POST");
}

/**
 * Recherche de banque par nom, tous connectors confondus (2026-07-28, retour de Stéphane :
 * "une personne ne connaît pas et se fout de enablebanking, powens ou autre c'est du chinois").
 * Chaque résultat porte son propre `connector` ('powens'|'enablebanking') + les champs
 * nécessaires pour lancer directement la bonne liaison, sans jamais exposer ce choix technique
 * à l'utilisateur final.
 *
 * @param {string} orgId
 * @param {string} query
 * @returns {Object} { success, banks: [{name, connector, country?, aspspName?, aspspCountry?}] }
 */
function executorBanksSearch(orgId, query) {
  return _callExecutor("/api/executor/banks/search", { orgId: orgId, q: query }, "GET");
}

/**
 * Variante non dédupliquée de executorBanksSearch (2026-07-31) — utilisée uniquement par la
 * reprise d'erreur du Flow visible ("essayer l'autre connecteur") pour retrouver l'entrée
 * EnableBanking/Powens ALTERNATIVE pour un nom de banque exact, alors que la recherche normale
 * masque volontairement ce doublon.
 *
 * @param {string} orgId
 * @param {string} exactName
 * @returns {Object} { success, banks }
 */
function executorBanksSearchAll(orgId, exactName) {
  return _callExecutor("/api/executor/banks/search", { orgId: orgId, q: exactName, includeAll: "1" }, "GET");
}

/**
 * Modèle canonique Connector + Flow (2026-08-01, décision de Stéphane : "le modèle canonique
 * de Structory" — une API externe/un JSON brut ne doit jamais traverser directement une vue).
 * Renvoie des objets de domaine (voir executor/core/connector.py, executor/core/flow.py),
 * jamais un dict ad hoc reconstruit indépendamment par chaque vue (PrecognFlow ici, une future
 * vue conversationnelle/vocale plus tard consommeraient exactement le même `flow.steps`).
 *
 * @param {string} orgId
 * @param {string} etablissement
 * @param {string} nature
 * @param {string} [module]
 * @returns {Object} { success, connector: {...}, flow: { steps: [{id,icon,label,status}, ...] } }
 */
function executorConnectorFlow(orgId, etablissement, nature, module) {
  return _callExecutor("/api/executor/connector-flow", { orgId: orgId, etablissement: etablissement, nature: nature, module: module }, "GET");
}

/**
 * Rapport patrimonial en HTML autonome, prêt à imprimer / exporter en PDF (2026-07-27, section
 * Outputs du Navigator) — réutilise le même calcul et le même rendu que l'email quotidien,
 * jamais un rapport différent selon le canal de sortie.
 *
 * @param {string} orgId
 * @param {string} [module]
 * @returns {Object} { success, html } ou { success:false, error }
 */
function executorReportHtml(orgId, module) {
  const payload = module ? { orgId: orgId, module: module } : { orgId: orgId };
  return _callExecutor("/api/executor/report-html", payload, "GET");
}

/**
 * Déclenche l'envoi immédiat du rapport quotidien par email (bouton "Renvoyer l'email
 * maintenant", en plus de l'envoi automatique de 7h — voir smc-daily-report.timer).
 *
 * @param {string} orgId
 * @param {string} [module]
 * @returns {Object} { success, to, sendError } ou { success:false, error }
 */
function executorSendReportNow(orgId, module) {
  const payload = module ? { orgId: orgId, module: module } : { orgId: orgId };
  return _callExecutor("/api/executor/daily-report", payload, "POST");
}
