// ================================================================
// 📚 Connector Analyzor
// Bibliothèque Générale PreCogn
// ================================================================

const ANALYZOR_URL = "http://analyzor.precogn.org:8000";
/**
 * Fonction privée
 */
function _callAnalyzor(endpoint, payload, method) {

  method = method || "POST";

  let url = ANALYZOR_URL + endpoint;

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

  // Même correctif que ConnectorExecutor.js::_callExecutor (2026-07-29) : toujours essayer de
  // parser du JSON même sur un code d'erreur HTTP, jamais jeter un {success:false, error:"..."}
  // propre pour le remplacer par "HTTP xxx : {...}" brut. Seule une réponse non-JSON lève une
  // exception ici.
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("HTTP " + code + " : " + text);
  }

}

/**
 * ============================================================
 * API PUBLIQUE
 * ============================================================
 *
 * Bibliotheque.analyzor(...)
 *
 */
function analyzor(endpoint, data, method) {

  return _callAnalyzor(endpoint, data, method);

}

/**
 * Enregistre un secret chiffré pour une org (org_secrets.py côté Analyzor). Contrairement à
 * analyzor()/_callAnalyzor ci-dessus, ne lève JAMAIS d'exception sur 400/404 : ces codes
 * portent un body JSON structuré (errorCode: 'needs_bootstrap'/'unknown_org') que l'appelant
 * doit pouvoir inspecter, pas juste "une erreur réseau" — voir identitySetOrgSecret dans
 * ConnectorIdentity.js, qui gère le protocole de bootstrap en 2 temps à partir de ce retour.
 *
 * @param {string} orgId
 * @param {string} name
 * @param {string} value Valeur en clair (chiffrée côté Python, jamais ici)
 * @returns {{success:boolean, errorCode?:string, missingFiles?:string[], folderId?:string}}
 */
function analyzorSetSecret(orgId, name, value) {
  const response = UrlFetchApp.fetch(ANALYZOR_URL + "/api/org/" + orgId + "/secrets", {
    method: "POST",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({ name: name, value: value })
  });
  return JSON.parse(response.getContentText());
}

/**
 * Noms des secrets déjà configurés pour une org (jamais les valeurs) — pour un écran d'admin
 * du type "Enable Banking : configuré ✓".
 * @param {string} orgId
 * @returns {{success:boolean, secretNames?:string[]}}
 */
function analyzorListSecrets(orgId) {
  return analyzor("/api/org/" + orgId + "/secrets", null, "GET");
}

/**
 * Résout le connector (Rule brick) déjà actif pour un compte, pour affichage de ses
 * caractéristiques dans le panneau détail (retour de Stéphane, 2026-07-29 : "je devrais trouver
 * le connector en cliquant sur le compte et voir ses caractéristiques" — jusqu'ici le connector
 * n'était visible qu'en repassant par la recherche de banque, jamais depuis le compte déjà
 * automatisé lui-même).
 * @returns {{success:boolean, connectors:Array<{interface, brickId, title, level}>}}
 */
function analyzorResolveConnector(etablissement, nature, orgId, module) {
  return analyzor("/api/connectors/resolve", { etablissement: etablissement, nature: nature, orgId: orgId, module: module }, "GET");
}

/**
 * Vocabulaire de reconnaissance des consultations (garde-fou déterministe
 * côté Communicator) — lu depuis les briques Rule de niveau Structory, côté
 * analyzor (le service qui possède les briques documentaires), pas codé en
 * dur côté Apps Script. La compléter ne redéploie jamais Communicator.
 *
 * @returns {string[]} Liste de mots-clés (déjà en minuscules)
 */
function analyzorGetQueryKeywords() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'analyzor_query_keywords';
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const keywords = _callAnalyzor("/api/context/query-keywords", null, "GET").keywords || [];
  cache.put(cacheKey, JSON.stringify(keywords), 6 * 60 * 60);
  return keywords;
}

/**
 * Vraies Rule bricks du module comptable de l'organisation (ledger_api/modules/{module}/bricks/)
 * — jamais exposées en HTTP avant le 2026-08-08, seulement lues côté serveur pour le chat.
 * Sert à afficher les vraies règles en permanence côté Navigator, plutôt que les Rules de démo
 * codées en dur (getTestPatrimoine). Le vecteur _embedding est déjà retiré côté serveur.
 *
 * @param {string} orgId
 * @returns {{success:boolean, module?:string, rules?:Object[]}}
 */
function analyzorGetRules(orgId) {
  try {
    return _callAnalyzor("/api/analyzor/rules?orgId=" + encodeURIComponent(orgId), null, "GET");
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Comptes patrimoine d'une organisation (Suivre Mes Comptes, ARCHITECTURE.md §1.1) — liste
 * vide pour toute org qui n'en a pas (compta-copro, etc.) : sert de garde-fou déterministe à
 * Communicator pour savoir s'il doit proposer la saisie de solde (jamais codé en dur par org).
 *
 * @param {string} orgId
 * @returns {Object[]} [{id, title, contenu: {etablissement, titulaire, nom, nature, devise_origine}}, ...]
 */
function analyzorListComptes(orgId) {
  try {
    const result = _callAnalyzor("/api/org/" + orgId + "/comptes", null, "GET");
    return result.comptes || [];
  } catch (e) {
    return [];
  }
}

/**
 * Interprète un message utilisateur dans le contexte brique d'une organisation PreCogn.
 * Chaîne côté Analyzor : bricks → LLMPrecogn → Ollama (fallback) → exécution query si besoin.
 * Si documentText est fourni (texte pré-extrait par Docling), il est injecté dans le contexte.
 *
 * @param {string} orgId
 * @param {string} message      Message brut de l'utilisateur
 * @param {string} lastMessage  Message précédent (contexte immédiat), optionnel
 * @param {string} documentText Texte extrait via Docling, optionnel
 * @returns {{intent:string, response?:string, libelle?:string, montant?:number, sens?:string,
 *            compteNom?:string, solde?:number, command?:string, filters?:string[]}}
 */
function analyzorUnderstand(orgId, message, lastMessage, documentText) {
  var payload = { orgId: orgId, message: message };
  if (lastMessage)   payload.lastMessage   = lastMessage;
  if (documentText)  payload.documentText  = documentText;
  return _callAnalyzor('/api/analyzor/understand', payload, 'POST');
}

/**
 * Met à la corbeille un compte patrimoine (jamais de suppression définitive côté Drive) —
 * voir bricks.delete_compte côté Analyzor.
 *
 * @param {string} orgId
 * @param {string} compteUid
 * @returns {Object} {success, deleted?, errorCode?}
 */
function analyzorDeleteCompte(orgId, compteUid) {
  return _callAnalyzor("/api/org/" + orgId + "/comptes/" + compteUid, null, "DELETE");
}