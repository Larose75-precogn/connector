// ================================================================
// 📚 Connector Account — module "mon compte" (organisation / user / abonnement)
// Bibliothèque Générale PreCogn
// ================================================================
// Parle à subscriptions_api (identité + abonnement), pas à ledger_api (compta).

const ACCOUNT_URL = "http://213.32.16.118:8082";

// Revenu au même pattern que les autres Connectors (LEDGER_URL, SUBSCRIPTIONS_URL...) après
// que la version "Script Properties" (2026-07-18) ait ajouté une étape manuelle bloquante
// (aller régler la propriété à la main dans l'éditeur Apps Script) sans que Stéphane l'ait
// demandée — même leçon que le garde-fou d'abonnement retiré plus tôt : pas de friction non
// demandée. Ce système est encore interne (pas de dépôt public), le compromis sécurité est
// jugé acceptable pour l'instant, comme partout ailleurs dans Bibliotheque.
// Clé de service : Script Property STRUCTORY_SERVICE_KEY (à définir avant tout clasp push — voir RUNBOOK rotation).
const ACCOUNT_SERVICE_KEY = PropertiesService.getScriptProperties().getProperty('STRUCTORY_SERVICE_KEY') || '';

function _accountServiceKey() {
  return ACCOUNT_SERVICE_KEY;
}

function _callAccount(endpoint, payload, method) {
  method = method || "POST";
  let url = ACCOUNT_URL + endpoint;

  const options = {
    method: method,
    muteHttpExceptions: true,
    contentType: "application/json",
    headers: { "X-Service-Key": _accountServiceKey() }
  };

  if (method === "GET") {
    const qs = _buildQueryString(payload);
    if (qs) url += "?" + qs;
  } else if (payload !== null && payload !== undefined) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code !== 200) {
    throw new Error("HTTP " + code + " : " + text);
  }
  return JSON.parse(text);
}

/** Trouve ou crée un User par email (identité native Structory). */
function accountUpsertUser(email, locale) {
  return _callAccount("/api/account/upsert", { email: email, locale: locale || null }, "POST");
}

// ── Connexion réelle par lien magique (2026-08-08) ──
// Un webapp Apps Script déployé executeAs=USER_DEPLOYING ne peut ni poser de cookie ni lire
// Session.getActiveUser() pour un visiteur anonyme — la session vit donc en localStorage côté
// navigateur, revalidée à chaque page via authGetSession. L'email lui-même est envoyé par
// MailApp depuis Apps Script (jamais par subscriptions_api, qui n'a pas de SMTP configuré) —
// authRequestLogin renvoie le jeton brut à l'appelant pour ça, ne l'email jamais lui-même.

/** 1er temps : émet un jeton de connexion à usage unique pour cet email (crée le User si besoin). */
function authRequestLogin(email) {
  return _callAccount("/api/auth/request-login", { email: email }, "POST");
}

/** 2e temps : échange le jeton (cliqué dans l'email) contre une vraie session longue durée. */
function authConsumeLoginToken(token) {
  return _callAccount("/api/auth/consume-login-token", { token: token }, "POST");
}

/** Revalide une session existante (localStorage) — appelé à chaque chargement de page. */
function authGetSession(sessionToken) {
  return _callAccount("/api/auth/session", { token: sessionToken }, "GET");
}

/** Ce uid a-t-il un rôle sur CETTE org précise ? — condition avant de rendre des données réelles. */
function authCheckMembership(orgId, uid) {
  return _callAccount("/api/auth/membership", { orgId: orgId, uid: uid }, "GET");
}

/** Enregistre un orgId (déjà utilisé ailleurs, ex. ledger_api) dans le registre de compte. */
function accountRegisterOrg(orgId, name, ownerUid) {
  return _callAccount("/api/org/register", { orgId: orgId, name: name, ownerUid: ownerUid }, "POST");
}

/** Profil complet pour l'écran "mon compte" : org + membres + statut d'abonnement. */
function accountGetOrgProfile(orgId) {
  return _callAccount("/api/org/profile", { orgId: orgId }, "GET");
}

/**
 * Résout le nom d'affichage d'une org en remontant la chaîne parent_org_id si l'org elle-même
 * n'a pas de nom exploitable — jamais une "marque" figée en dur dans un outil (retour de
 * Stéphane 2026-07-22 : "s'il n'y a pas de communicator dans l'orga tu remontes les parents").
 * Plafond de sauts pour ne jamais boucler indéfiniment sur une chaîne mal formée.
 *
 * @param {string} orgId
 * @returns {string} Le nom le plus spécifique trouvé en remontant la vraie hiérarchie
 *   (smcspl -> Suivre Mes Comptes -> Structory -> PreCogn), ou "PreCogn" (racine réelle de la
 *   hiérarchie, `parent_org_id` NULL) si la chaîne entière n'aboutit à rien (org totalement
 *   inconnue) — jamais "Structory" en dur, corrigé 2026-07-22 sur retour de Stéphane.
 */
function accountResolveBrandName(orgId) {
  var currentId = orgId;
  var hops = 0;
  while (currentId && hops < 5) {
    var profile;
    try {
      profile = accountGetOrgProfile(currentId);
    } catch (e) {
      break;
    }
    if (!profile || !profile.success || !profile.org) break;
    if (profile.org.name) return profile.org.name;
    currentId = profile.org.parent_org_id;
    hops++;
  }
  return "PreCogn";
}

/** fields: {name?, logoUrl?, info?} */
function accountUpdateOrgProfile(orgId, fields) {
  const payload = Object.assign({ orgId: orgId }, fields);
  return _callAccount("/api/org/profile", payload, "POST");
}

/** fields: {photoUrl?, info?} */
function accountUpdateUserProfile(uid, fields) {
  const payload = Object.assign({ uid: uid }, fields);
  return _callAccount("/api/user/profile", payload, "POST");
}

/**
 * Crée une session de paiement Stripe (mode test) pour devenir partenaire. Retourne l'URL à
 * ouvrir. payerUid absent (ou null) : bascule sur la branche "inscription gratuite" (Price à
 * 0€, sans carte — Stéphane 2026-07-19) au lieu d'exiger un User déjà existant ; email
 * optionnel dans ce cas (sinon Stripe le demande lui-même sur sa page).
 */
function accountSubscriptionCheckout(payerUid, country, locale, email) {
  return _callAccount("/api/subscription/checkout", {
    payerUid: payerUid || null, country: country || null, locale: locale || null, email: email || null
  }, "POST");
}

/**
 * Crée une session Stripe Checkout pour le statut "Partenaire" (1€/mois, Stéphane 2026-08-06) —
 * personnel/support prioritaire, distinct de l'abonnement d'organisation par sièges ci-dessus
 * (accountSubscriptionCheckout). Requiert un payerUid déjà connu : contrairement au checkout
 * de sièges, il n'y a pas de branche "inscription gratuite" ici (ce palier n'est jamais gratuit).
 */
function accountPartnerCheckout(payerUid, locale, email) {
  return _callAccount("/api/subscription/checkout", {
    payerUid: payerUid || null, tier: "PARTNER", locale: locale || null, email: email || null
  }, "POST");
}

/** À appeler par l'onglet d'origine pendant/après le popup Stripe pour savoir si l'inscription
 * gratuite a été complétée. Crée le User à ce moment-là (idempotent avec le webhook). */
function accountResolveCheckoutSession(sessionId) {
  return _callAccount("/api/subscription/checkout/resolve", { sessionId: sessionId }, "GET");
}

/** Organisations dont ce uid est déjà membre (n'importe quel rôle) — écran "choix d'organisation". */
function accountOrgsForUid(uid) {
  return _callAccount("/api/account/orgs", { uid: uid }, "GET");
}

/** Demande à rejoindre une org existante ; requestedRole: 'editor' (défaut) ou 'viewer'. Le
 * comportement dépend de la politique fixée par l'organisation elle-même (join_policy) :
 * adhésion immédiate, demande en attente, ou refus. Jamais silencieux côté appelant. */
function accountJoinRequest(uid, orgId, requestedRole) {
  return _callAccount("/api/org/join-request", { uid: uid, orgId: orgId, requestedRole: requestedRole || null }, "POST");
}

/** Le propriétaire d'une org approuve/refuse une demande. decision: 'granted' ou 'denied'. */
function accountJoinDecide(requestId, decision) {
  return _callAccount("/api/org/join-decide", { requestId: requestId, decision: decision }, "POST");
}

/** Demandes d'adhésion en attente pour une org — vue du propriétaire. */
function accountListJoinRequests(orgId) {
  return _callAccount("/api/org/join-requests", { orgId: orgId }, "GET");
}
/** Ajoute directement un membre à une org (par uid déjà connu). Synchronise Stripe. role: 'member' (défaut) ou 'editor'. */
function accountOrgMemberAdd(orgId, uid, role) {
  return _callAccount("/api/org/member/add", { orgId: orgId, uid: uid, role: role || "member" }, "POST");
}

/** Retire un membre d'une org. Synchronise Stripe. */
function accountOrgMemberRemove(orgId, uid) {
  return _callAccount("/api/org/member/remove", { orgId: orgId, uid: uid }, "POST");
}

/**
 * HTML du widget "mon compte" (avatar + panneau organisation/user/abonnement), prêt à
 * insérer dans la page de n'importe quel outil via <?!= Bibliotheque.getAccountPanelHtml(orgId) ?>.
 *
 * L'outil consommateur doit exposer ces fonctions top-level (wrappers vers Bibliotheque,
 * requis par google.script.run qui ne peut pas appeler une fonction de library directement) :
 * accountUpsertUser, accountRegisterOrg, accountGetOrgProfile, accountUpdateOrgProfile,
 * accountUpdateUserProfile, accountSubscriptionCheckout, accountResolveCheckoutSession,
 * accountOrgsForUid, accountJoinRequest, accountJoinDecide, accountListJoinRequests — voir
 * Code.js de Communicator pour un exemple des wrappers à copier dans un nouvel outil.
 */
function getAccountPanelHtml(orgId) {
  const template = HtmlService.createTemplateFromFile('AccountPanel.html');
  template.orgId = orgId;
  return template.evaluate().getContent();
}
