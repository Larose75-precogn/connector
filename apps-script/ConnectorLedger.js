// ================================================================
// 📚 Connector Ledger
// Bibliothèque Générale PreCogn
// ================================================================

const LEDGER_URL = "http://213.32.16.118:8080";

/**
 * Fonction privée
 */
function _callLedger(endpoint, payload, method, _retryCount) {
  _retryCount = _retryCount || 0;

  method = method || "POST";

  let url = LEDGER_URL + endpoint;

  const options = {
    method: method,
    muteHttpExceptions: true,
    contentType: "application/json",
    headers: { "X-Service-Key": ACCOUNT_SERVICE_KEY }
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

  // Retry générique pour TOUT appel ledger_api touchant le journal (2026-08-10, retour de
  // Stéphane : "le journal doit être dans le storage de l'orga, pas sur le VPS") — le journal
  // vit maintenant dans le Drive de l'org (own_storage_journal.py), jamais créé par le compte
  // de service (storageQuotaExceeded), seulement par Apps Script (identité réelle). Un seul
  // endroit gère ça, pas dupliqué dans chaque fonction ledgerXxx — même principe que
  // identitySetOrgSecret pour les secrets, généralisé ici à tous les appels ledger.
  if (code === 409 && _retryCount < 2) {
    let data;
    try { data = JSON.parse(text); } catch (e) { data = {}; }
    if (data.errorCode === 'needs_bootstrap' && data.folderId && payload && payload.orgId) {
      identityEnsureJournalPlaceholder(payload.orgId, data.folderId);
      Utilities.sleep(900);
      return _callLedger(endpoint, payload, method, _retryCount + 1);
    }
  }

  if (code !== 200) {
    throw new Error("HTTP " + code + " : " + text);
  }

  return JSON.parse(text);

}

/**
 * ============================================================
 * API PUBLIQUE
 * ============================================================
 *
 * Bibliotheque.ledgerConvert(csvData, options)
 * Bibliotheque.ledgerStatus()
 *
 */
function ledgerConvert(csvData, options) {
  return _callLedger("/api/ledger/convert", { data: csvData, options: options || {} }, "POST");
}

function ledgerStatus() {
  return _callLedger("/api/ledger/status", null, "GET");
}

/**
 * Ajoute une écriture classée au journal d'une organisation.
 * Crée le journal de l'organisation s'il n'existe pas encore (bootstrap BYOS).
 *
 * @param {string} orgId
 * @param {{libelle:string, montant:number, sens:("depense"|"recette"), date?:string}} flow
 * @returns {Object} { success, entry, compte, compteNom, confidence, balanceCheck }
 */
function ledgerAddEntry(orgId, flow) {
  return _callLedger("/api/ledger/entry", Object.assign({ orgId: orgId, userEmail: Session.getActiveUser().getEmail() }, flow), "POST");
}

/**
 * Importe des écritures en partie double EXPLICITE (comptes déjà déterminés par l'appelant,
 * aucune classification/devinette côté serveur) — contrairement à ledgerAddEntry, qui laisse
 * le cœur comptable choisir la contrepartie. Chaque entrée doit avoir >= 2 jambes dont la
 * somme des montants est nulle (vérifié par ledger-cli lui-même, pas juste déclaré).
 *
 * @param {string} orgId
 * @param {Array<{date:string, libelle:string, legs:Array<{compte:string, amount:number, label?:string}>}>} entries
 * @returns {Object} { success, nImported, balanceCheck, balanceError, error? }
 */
function ledgerImportEntries(orgId, entries) {
  return _callLedger("/api/ledger/import", { orgId: orgId, entries: entries, userEmail: Session.getActiveUser().getEmail() }, "POST");
}

/**
 * Exécute une commande ledger-cli en lecture seule pour une organisation.
 *
 * @param {string} orgId
 * @param {string} command "balance" | "register" | "equity" | "print" | "accounts"
 * @param {string[]} [filters]
 * @returns {Object} { success, output, error }
 */
function ledgerQuery(orgId, command, filters, endDate, beginDate) {
  var body = { orgId: orgId, command: command, filters: filters || [] };
  if (endDate) body.endDate = endDate;
  if (beginDate) body.beginDate = beginDate;
  return _callLedger("/api/ledger/query", body, "POST");
}

/**
 * Indique si une organisation a déjà un journal comptable.
 *
 * @param {string} orgId
 * @returns {boolean}
 */
function ledgerExists(orgId) {
  return !!_callLedger("/api/ledger/exists", { orgId: orgId }, "GET").exists;
}

/**
 * Export FEC (Fichier des Écritures Comptables, format DGFiP) — action Flow, pas une simple
 * vue : produit un vrai livrable légal, distinct des commandes de lecture ledgerQuery().
 *
 * @param {string} orgId
 * @param {string} [exercice] Année (ex "2026") — année courante par défaut côté serveur.
 * @returns {Object} { success, fec, exercice, error? }
 */
function ledgerExportFec(orgId, exercice) {
  var body = { orgId: orgId };
  if (exercice) body.exercice = exercice;
  return _callLedger("/api/ledger/fec", body, "POST");
}

/**
 * Constate le solde d'un compte patrimoine à une date donnée (Suivre Mes Comptes) — pas une
 * écriture classée : ledger_api compare au solde déjà enregistré et ne poste que l'écart.
 * Résout elle-même le compte patrimoine ledger-cli à partir de établissement+nature (source
 * unique de cette résolution, côté ledger_api — ne jamais la recopier ici).
 *
 * @param {string} orgId
 * @param {{etablissement:string, nature:string, solde:number, devise?:string, date?:string}} point
 * @returns {Object} { success, compte, ecart, soldeActuel, soldeNouveau, entry, balanceOk }
 */
function ledgerBalancePoint(orgId, point) {
  return _callLedger("/api/ledger/balance-point", Object.assign({ orgId: orgId }, point), "POST");
}

/**
 * Contexte niveau module Structory + niveau organisation (cascade), résolu
 * côté serveur (BYOS : ledger_api lit ses propres briques locales,
 * pas d'accès Drive depuis Apps Script).
 *
 * @param {string} orgId
 * @returns {string} Contexte concaténé (module Structory + règles de l'organisation, si branchées)
 */
function ledgerGetContext(orgId) {
  return _callLedger("/api/context/structory", { orgId: orgId }, "GET").context;
}

/**
 * Module produit branché pour cette org (ex. "suivre_mes_comptes") — nécessaire pour la
 * résolution de connector (analyzor::resolve_connectors). À NE PAS confondre avec
 * parent_org_id (hiérarchie d'organisation, subscriptions_api) : deux notions différentes.
 *
 * @param {string} orgId
 * @returns {string|null}
 */
function ledgerGetModule(orgId) {
  try {
    return _callLedger("/api/org/" + encodeURIComponent(orgId) + "/module", null, "GET").module;
  } catch (e) {
    return null;
  }
}

