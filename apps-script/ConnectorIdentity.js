// ================================================================
// 📚 Connector Identity — création/adhésion d'organisation en libre-service, BYOS
// Bibliothèque Générale PreCogn
// ================================================================
// Écrit dans l'OwnStorage de la personne qui crée son organisation — aujourd'hui son propre
// Google Drive via DriveApp (natif Apps Script, s'exécute avec l'identité de qui a appelé ce
// script, pas celle du compte de service ni de Stéphane), potentiellement un autre support plus
// tard. Le compte de service Analyzor lit ensuite ces briques une fois le dossier partagé avec
// lui — il ne les crée jamais lui-même (bloqué par quota de stockage, voir analyzor/bricks.py).
//
// Appelée depuis un script déployé en executeAs=USER_ACCESSING (le projet "org-onboarding",
// pas Communicator ni le déploiement webhook de bibliotheque, qui restent USER_DEPLOYING) — les
// appels DriveApp ci-dessous s'exécutent donc avec l'identité Google de qui a ouvert la page,
// pas la nôtre.

var ANALYZOR_SERVICE_ACCOUNT_EMAIL = "analyzor-ownstorage@focused-brand-454315-s8.iam.gserviceaccount.com";

function _identitySlugify(name) {
  var base = (name || "").toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return base.substring(0, 60) || "org";
}

function _identityNewUid(prefix) {
  return prefix + "_" + Utilities.getUuid().replace(/-/g, "").substring(0, 20);
}

function _identityNowStamp() {
  return Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss");
}

function _identityNewBrick(type, title, contenu, owner) {
  var uid = _identityNewUid(type.toLowerCase().substring(0, 3));
  var ts = _identityNowStamp();
  return {
    id: type.toUpperCase() + "-" + uid,
    uid: uid,
    type: type,
    title: title,
    creator: "org-onboarding",
    created: ts,
    modified: ts,
    owner: owner,
    language: "fr",
    version: "1",
    status: "Active",
    tags: [],
    rights: "internal", // pas de gestion de droits fine aujourd'hui, limite connue
    source: "CreateOrg webapp",
    relations: [],
    contenu: contenu
  };
}

function _identityWriteBrickFile(folder, brick) {
  var filename = brick.type.toLowerCase() + "_" + brick.uid + ".json";
  return folder.createFile(filename, JSON.stringify(brick, null, 2), MimeType.PLAIN_TEXT).setName(filename);
}

/** Extrait un id de dossier Drive depuis un lien collé par l'utilisateur (plusieurs formats
 * possibles), ou accepte un id brut tel quel. Retourne null si rien d'exploitable. */
function _identityExtractFolderId(folderLink) {
  var s = (folderLink || "").trim();
  if (!s) return null;
  var m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s; // id brut collé directement
  return null;
}

/**
 * Crée une organisation dans l'OwnStorage de la personne qui l'a demandée — à l'endroit qu'ELLE
 * choisit (Stéphane 2026-07-21 : "tata doit être là où le user le dit", jamais un endroit décidé
 * par nous). `folderLink` : lien (ou id) vers un dossier Drive déjà existant, où l'organisation
 * sera créée. Si absent : **mode démo**, rien n'est écrit sur Drive, la réponse est marquée
 * `demo: true` pour que l'appelant l'affiche clairement et ne laisse jamais croire à une
 * sauvegarde qui n'a pas eu lieu.
 */
function identityCreateOrg(orgName, userName, folderLink, module) {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return { success: false, errorCode: "no_google_identity" };
  }
  orgName = (orgName || "").trim();
  if (!orgName) {
    return { success: false, errorCode: "name_required" };
  }
  var orgId = _identitySlugify(orgName);

  var existing;
  try {
    existing = analyzor("/api/org/" + encodeURIComponent(orgId), null, "GET");
  } catch (e) {
    existing = null; // Analyzor injoignable : on tente quand même, DriveApp lèvera si le
                      // visiteur a déjà un dossier de ce nom (résolu par lui, pas par nous)
  }
  if (existing && existing.success) {
    return { success: false, errorCode: "org_id_taken", orgId: orgId };
  }

  var orgBrick = _identityNewBrick("Organisation", orgName, { name: orgName, parentOrgId: (module || null), joinPolicy: "restricted" }, "org:" + orgId);
  var userBrick = _identityNewBrick("User", userName || email, { email: email, name: userName || null, role: "owner" }, "org:" + orgId);

  var parentFolderId = _identityExtractFolderId(folderLink);
  if (!parentFolderId) {
    // Mode démo explicite : aucune écriture réelle. L'appelant DOIT afficher clairement que
    // rien n'est sauvegardé (Stéphane 2026-07-21).
    return { success: true, demo: true, orgId: orgId, org: orgBrick, user: userBrick };
  }

  var parentFolder;
  try {
    parentFolder = DriveApp.getFolderById(parentFolderId);
  } catch (e) {
    return { success: false, errorCode: "folder_not_accessible" };
  }

  var folder = parentFolder.createFolder(orgId);
  _identityWriteBrickFile(folder, orgBrick);
  _identityWriteBrickFile(folder, userBrick);

  // Journal de l'org cree dans SON OwnStorage des la creation (identite reelle,
  // seul moyen de creer un fichier Drive : le compte de service ne peut pas). BYOS.
  try { identityEnsureJournalPlaceholder(orgId, folder.getId()); } catch (e) {}

  try {
    folder.addViewer(ANALYZOR_SERVICE_ACCOUNT_EMAIL);
  } catch (e) {
    // Le dossier existe et les briques sont écrites même si le partage échoue — Analyzor ne
    // pourra juste pas le lire tant que ce n'est pas corrigé manuellement. Ne bloque pas
    // l'utilisateur pour un problème qui ne le concerne pas.
  }

  try {
    // Enregistre l'adresse BYOS dans Docling (2026-07-22, voir ConnectorDocling.js) — évite
    // qu'Analyzor doive plus tard retrouver ce dossier par recherche plein-texte Drive-wide
    // (repli coûteux, gardé seulement pour les organisations créées avant ce registre).
    doclingRegisterOrgAddress(orgId, orgBrick.uid, folder.getId(), "gdrive");
  } catch (e) {
    // Non-bloquant : le repli plein-texte d'Analyzor retrouvera quand même cette org si besoin.
  }

  return { success: true, demo: false, orgId: orgId, folderId: folder.getId(), org: orgBrick, user: userBrick };
}

/**
 * Rejoint une organisation existante — écrit sa propre brique User dans le dossier de cette
 * org. Même principe que `identityCreateOrg` (Stéphane 2026-07-21) : c'est l'utilisateur qui
 * indique où est le dossier (lien collé, reçu du propriétaire de l'org qui l'a partagé au
 * préalable), jamais une devinette de notre part. `folderLink` : lien (ou id) du dossier Drive
 * de l'org à rejoindre. `DriveApp.getFolderById` lève si aucun accès, ce qui est le
 * comportement voulu — jamais d'ajout à une org qu'on ne peut pas voir.
 */
function identityJoinOrg(orgId, userName, folderLink) {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return { success: false, errorCode: "no_google_identity" };
  }
  orgId = (orgId || "").trim();
  if (!orgId) {
    return { success: false, errorCode: "org_id_required" };
  }

  var parentFolderId = _identityExtractFolderId(folderLink);
  if (!parentFolderId) {
    return { success: false, errorCode: "folder_link_required" };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(parentFolderId);
  } catch (e) {
    return { success: false, errorCode: "folder_not_accessible" };
  }

  // Vérifie que le dossier pointé contient bien la brique Organisation attendue — évite de
  // rejoindre silencieusement le mauvais dossier si l'utilisateur colle le mauvais lien.
  var orgMatches = false;
  var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf("organisation_") !== 0) continue;
    try {
      var brick = JSON.parse(f.getBlob().getDataAsString());
      if (brick.owner === "org:" + orgId) {
        orgMatches = true;
      }
    } catch (e) {
      // brique illisible, ignorée
    }
    break;
  }
  if (!orgMatches) {
    return { success: false, errorCode: "org_mismatch" };
  }

  var userBrick = _identityNewBrick("User", userName || email, { email: email, name: userName || null, role: "editor" }, "org:" + orgId);
  _identityWriteBrickFile(folder, userBrick);

  try {
    folder.addViewer(ANALYZOR_SERVICE_ACCOUNT_EMAIL);
  } catch (e) {
    // déjà partagé (cas normal) ou non-critique — ne bloque pas l'adhésion
  }

  return { success: true, orgId: orgId, folderId: folder.getId(), user: userBrick };
}

/**
 * Supprime une organisation — symétrique de `identityCreateOrg` (Stéphane 2026-07-21 :
 * "l'outboarding", pas un bricolage à usage unique). Le visiteur colle le lien du dossier de
 * SON organisation (celui créé par `identityCreateOrg`, jamais un dossier deviné), doit être
 * identifié `owner` dans sa propre brique User de cette org, et doit passer `confirm: true`
 * explicite — jamais de suppression sur un simple appel accidentel. Met le dossier de l'org à
 * la corbeille (`setTrashed`, récupérable depuis la corbeille Drive, pas un `Drive.Files.remove`
 * définitif) : ce dossier ne contient que ce que `identityCreateOrg`/`identityJoinOrg` y ont
 * écrit (une sous-arborescence dédiée, jamais le dossier parent choisi par l'utilisateur).
 */
function identityDeleteOrg(orgId, folderLink, confirm) {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return { success: false, errorCode: "no_google_identity" };
  }
  orgId = (orgId || "").trim();
  if (!orgId) {
    return { success: false, errorCode: "org_id_required" };
  }
  if (confirm !== true) {
    return { success: false, errorCode: "confirmation_required" };
  }

  var parentFolderId = _identityExtractFolderId(folderLink);
  if (!parentFolderId) {
    return { success: false, errorCode: "folder_link_required" };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(parentFolderId);
  } catch (e) {
    return { success: false, errorCode: "folder_not_accessible" };
  }

  var orgMatches = false;
  var isOwner = false;
  var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    try {
      var brick = JSON.parse(f.getBlob().getDataAsString());
      if (name.indexOf("organisation_") === 0 && brick.owner === "org:" + orgId) {
        orgMatches = true;
      } else if (name.indexOf("user_") === 0 && brick.owner === "org:" + orgId
        && brick.contenu && brick.contenu.email === email && brick.contenu.role === "owner") {
        isOwner = true;
      }
    } catch (e) {
      // brique illisible, ignorée
    }
  }
  if (!orgMatches) {
    return { success: false, errorCode: "org_mismatch" };
  }
  if (!isOwner) {
    return { success: false, errorCode: "not_owner" };
  }

  folder.setTrashed(true);
  return { success: true, orgId: orgId, folderId: folder.getId() };
}

/** Organisations déjà connues pour l'email du visiteur actuel — lecture via l'index Analyzor. */
function identityLookupMyOrgs() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return { success: false, errorCode: "no_google_identity" };
  }
  return analyzor("/api/account/lookup-by-email", { email: email }, "GET");
}

/**
 * Profil d'une organisation pour l'affichage (nom, logo) et pour retrouver son `folderId` — la
 * seule lecture, jamais l'écriture (voir identityUpdateOrgProfile/identityUploadOrgLogo pour ça,
 * qui exigent l'identité réelle du visiteur, contrairement à cette fonction). Essaie d'abord les
 * briques BYOS (Analyzor), puis se rabat sur l'ancien système (`ConnectorAccount.js`,
 * `subscriptions_api`) pour les organisations pas encore migrées (ex. "Suivre Mes Comptes",
 * 2026-07-22) — ne casse rien de ce qui tourne déjà en prod pendant la migration.
 * `viewerEmail` optionnel : permet de calculer `isOwner` même quand appelée depuis un contexte
 * qui n'a pas l'identité Google réelle du visiteur (ex. Navigator, en USER_DEPLOYING) — à
 * fournir par l'appelant s'il la connaît par un autre moyen (ex. un uid déjà résolu ailleurs) ;
 * si absent, la fonction essaie `Session.getActiveUser()`, SAUF si `noSessionFallback` est vrai.
 * **`noSessionFallback` obligatoire à `true` pour tout appelant en `executeAs: USER_DEPLOYING`**
 * (ex. Navigator) — bug réel trouvé le 2026-08-02 : sous ce mode d'exécution,
 * `Session.getActiveUser()` renvoie TOUJOURS l'identité du déployeur (Stéphane), jamais celle
 * du visiteur réel, même anonyme — "Connecté en tant que le-deployeur" s'affichait donc
 * à n'importe quel visiteur de n'importe quelle org, pas seulement Stéphane. Les appelants en
 * `executeAs: USER_ACCESSING` (ex. org-onboarding) gardent le comportement d'origine, où
 * `Session.getActiveUser()` reflète bien le vrai visiteur.
 */
function identityGetOrgProfile(orgId, viewerEmail, noSessionFallback) {
  orgId = (orgId || "").trim();
  if (!orgId) {
    return { success: false, errorCode: "org_id_required" };
  }
  var email = viewerEmail || (noSessionFallback ? null : (Session.getActiveUser().getEmail() || null));

  var cache    = CacheService.getScriptCache();
  var cacheKey = "idorgprofile_v1_" + orgId;
  var cached   = cache.get(cacheKey);
  if (cached) {
    try {
      var r = JSON.parse(cached);
      r.isOwner = false;
      (r.members || []).forEach(function(m) { if (email && m.email === email && m.role === "owner") r.isOwner = true; });
      return r;
    } catch(e) {}
  }

  try {
    var res = analyzor("/api/org/" + encodeURIComponent(orgId), null, "GET");
    if (res && res.success) {
      var isOwner = false;
      (res.members || []).forEach(function (m) {
        var c = m.contenu || {};
        if (email && c.email === email && c.role === "owner") isOwner = true;
      });
      var c = res.org.contenu || {};
      var result = {
        success: true,
        source: "bricks",
        orgId: orgId,
        name: c.name || res.org.title,
        logoUrl: c.logoUrl || null,
        parentOrgId: c.parentOrgId || null,
        childOrgIds: c.childOrgIds || [],
        clientOrgIds: c.clientOrgIds || [],
        folderId: res.folderId,
        isOwner: isOwner,
        viewerEmail: email,
        members: (res.members || []).map(function(m) {
          var mc = m.contenu || {};
          return { uid: m.uid, email: mc.email || null, name: mc.name || null, role: mc.role || null };
        })
      };
      try { cache.put(cacheKey, JSON.stringify(result), 120); } catch(e2) {}
      return result;
    }
  } catch (e) {
    // Analyzor injoignable ou org inconnue côté briques : on tente le repli ci-dessous.
  }

  try {
    var legacy = accountGetOrgProfile(orgId);
    if (legacy && legacy.success && legacy.org) {
      var legacyOwner = false;
      (legacy.org.members || []).forEach(function (m) {
        if (email && m.email === email && m.role === "owner") legacyOwner = true;
      });
      return {
        success: true,
        source: "legacy",
        orgId: orgId,
        name: legacy.org.name,
        logoUrl: legacy.org.logo_url || null,
        folderId: null,
        isOwner: legacyOwner,
        viewerEmail: email,
      };
    }
  } catch (e) {
    // ni briques ni legacy : org réellement inconnue
  }

  return { success: false, errorCode: "unknown_org" };
}

/**
 * Met à jour le profil d'une organisation BYOS (nom, logo, relations avec d'autres
 * organisations) — `folderId` déjà résolu (par `identityGetOrgProfile`, jamais un lien à
 * re-coller), overwrite direct du fichier brique existant via DriveApp (droits d'édition
 * garantis : c'est le dossier Drive du visiteur qui appelle). Seul le owner peut modifier le
 * profil de son organisation. `fields`: {name?, logoUrl?, parentOrgId?, childOrgIds?
 * (array), clientOrgIds? (array)} — relations métier (Stéphane 2026-07-22 : "toujours sur le
 * principe communicator/navigator/connector/analyzor", pas un registre technique séparé —
 * contrairement à l'adresse BYOS elle-même, voir ConnectorDocling.js, qui ne peut pas vivre ici
 * pour une raison structurelle : il faudrait déjà connaître ce dossier pour le trouver).
 */
function identityUpdateOrgProfile(orgId, folderId, fields) {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return { success: false, errorCode: "no_google_identity" };
  }
  orgId = (orgId || "").trim();
  if (!orgId || !folderId) {
    return { success: false, errorCode: "org_id_and_folder_required" };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: "folder_not_accessible" };
  }

  var orgFile = null, orgBrick = null, isOwner = false;
  var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    try {
      var brick = JSON.parse(f.getBlob().getDataAsString());
      if (name.indexOf("organisation_") === 0 && brick.owner === "org:" + orgId) {
        orgFile = f;
        orgBrick = brick;
      } else if (name.indexOf("user_") === 0 && brick.owner === "org:" + orgId
        && brick.contenu && brick.contenu.email === email && brick.contenu.role === "owner") {
        isOwner = true;
      }
    } catch (e) {
      // brique illisible, ignorée
    }
  }
  if (!orgBrick) {
    return { success: false, errorCode: "org_mismatch" };
  }
  if (!isOwner) {
    return { success: false, errorCode: "not_owner" };
  }

  orgBrick.contenu = orgBrick.contenu || {};
  if (fields && typeof fields.name === "string" && fields.name.trim()) {
    orgBrick.contenu.name = fields.name.trim();
    orgBrick.title = orgBrick.contenu.name;
  }
  if (fields && typeof fields.logoUrl === "string") {
    orgBrick.contenu.logoUrl = fields.logoUrl.trim() || null;
  }
  if (fields && typeof fields.iban === "string") {
    orgBrick.contenu.iban = fields.iban.replace(/\s+/g, '').toUpperCase() || null;
  }
  // `parentOrgId` n'est JAMAIS modifiable ici (retour de Stéphane, 2026-07-29 : "organisation
  // parente ne doit pas pouvoir être modifiée") — fixée une seule fois à la création/réparation
  // de l'org (identityCreateOrg/identityRepairOrg), jamais par ce point d'entrée générique.
  if (fields && Array.isArray(fields.childOrgIds)) {
    orgBrick.contenu.childOrgIds = fields.childOrgIds.filter(function (s) { return s && s.trim(); }).map(function (s) { return s.trim(); });
  }
  if (fields && Array.isArray(fields.clientOrgIds)) {
    orgBrick.contenu.clientOrgIds = fields.clientOrgIds.filter(function (s) { return s && s.trim(); }).map(function (s) { return s.trim(); });
  }
  orgBrick.modified = _identityNowStamp();
  orgFile.setContent(JSON.stringify(orgBrick, null, 2));

  return { success: true, orgId: orgId, org: orgBrick };
}

/**
 * Upload d'une image comme logo de l'organisation (alternative à coller une URL — Stéphane
 * 2026-07-22 : "les deux au choix du user, avec la possibilité d'en changer"). Écrit l'image
 * dans le dossier de l'org, la partage en lecture par lien, puis délègue l'écriture de la
 * brique à `identityUpdateOrgProfile` (mêmes garde-fous owner). `base64Data` : contenu image
 * encodé en base64 (sans le préfixe data:...;base64, découpé côté navigateur).
 */
function identityUploadOrgLogo(orgId, folderId, base64Data, mimeType) {
  if (!folderId || !base64Data) {
    return { success: false, errorCode: "missing_params" };
  }
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: "folder_not_accessible" };
  }

  var file;
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType || "image/png", "logo_" + orgId);
    file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // Erreur réelle trouvée 2026-07-27 : "Exception: Accès refusé : DriveApp" remontait brute
    // au client sans message exploitable — arrive si le dossier de l'org n'appartient pas à
    // qui déploie Navigator (ex. org cliente/filiale gérée par quelqu'un d'autre).
    return { success: false, errorCode: "drive_upload_failed", debug: e.message };
  }
  var url = "https://drive.google.com/uc?export=view&id=" + file.getId();

  return identityUpdateOrgProfile(orgId, folderId, { logoUrl: url });
}

var IDENTITY_SECRETS_SUBFOLDER = '_secrets';

/** Sous-dossier `_secrets/` du dossier de l'org, créé au besoin — séparé et plus restreint
 * que les bricks normales (même principe que org_secrets.py côté Python, mais écrit ici via
 * DriveApp pour contourner le même blocage de quota du compte de service). Sécurité actuelle :
 * isolation par sous-dossier + ACL Drive, PAS de chiffrement du contenu (limite connue —
 * org_secrets.py a un vrai chiffrement Fernet mais ne peut pas créer de nouveau fichier ;
 * cette fonction pourrait plus tard chiffrer avant d'écrire si Stéphane le demande). */
function _identityGetOrCreateSecretsFolder(folder) {
  var it = folder.getFoldersByName(IDENTITY_SECRETS_SUBFOLDER);
  if (it.hasNext()) return it.next();
  return folder.createFolder(IDENTITY_SECRETS_SUBFOLDER);
}

/**
 * Stocke (ou remplace) un secret nommé pour une org — ex. config SMTP pour l'envoi du
 * rapport quotidien (2026-07-22 : "il faut une solution pour paramétrer son serveur [email]
 * depuis Suivre Mes Comptes", saisi via Communicator, jamais codé en dur pour un user précis).
 *
 * @param {string} orgId
 * @param {string} folderId Dossier Drive de l'org
 * @param {string} name Nom du secret (ex. "email_smtp")
 * @param {Object} contenu Valeurs à stocker (ex. {host, port, user, password})
 * @returns {{success:boolean, errorCode?:string}}
 */
function identitySetSecret(orgId, folderId, name, contenu) {
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible' };
  }

  var secretsFolder = _identityGetOrCreateSecretsFolder(folder);
  var filename = 'secret_' + name + '.json';

  var brick = _identityNewBrick('Secret', name, contenu, 'org:' + orgId);

  var existing = secretsFolder.getFilesByName(filename);
  if (existing.hasNext()) {
    existing.next().setContent(JSON.stringify(brick, null, 2));
  } else {
    secretsFolder.createFile(filename, JSON.stringify(brick, null, 2), MimeType.PLAIN_TEXT);
  }

  return { success: true };
}

function identityEnsureJournalPlaceholder(orgId, folderId) {
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible' };
  }
  var existing = folder.getFilesByName('journal.ledger');
  if (!existing.hasNext()) {
    folder.createFile('journal.ledger', '', MimeType.PLAIN_TEXT);
  }
  return { success: true };
}

/**
 * JournaldeBanque (2026-08-14) — crée le placeholder VIDE d'un relevé bancaire sanctuarisé
 * (`_releves/<name>`, ex. "powens_bcp_stephane_courant.jsonl"), même contournement
 * storageQuotaExceeded que `identityEnsureJournalPlaceholder`/`identityEnsureSecretPlaceholder`.
 * Une seule création par (org, connector, compte) — jamais une par synchro : voir
 * `~/analyzor/own_storage_releves.py` pour le protocole append-only complet (chaque appel
 * suivant complète ce même fichier via update_file, jamais bloqué, jamais réécrit en place).
 * `folderId` ici est le dossier `_releves/` LUI-MÊME (retourné par
 * `POST /api/ownstorage/releve/append` en `errorCode: 'needs_bootstrap'` + `folderId`), pas le
 * dossier racine de l'org — ce sous-dossier est créé automatiquement côté Python
 * (create_folder n'est jamais bloqué, seule la création de fichier l'est).
 *
 * @param {string} orgId
 * @param {string} relevesFolderId Dossier `_releves/` (PAS le dossier racine de l'org)
 * @param {string} name Nom de fichier (ex. "powens_bcp_stephane_courant.jsonl")
 * @returns {{success:boolean, errorCode?:string}}
 */
function identityEnsureRelevePlaceholder(orgId, relevesFolderId, name) {
  var folder;
  try {
    folder = DriveApp.getFolderById(relevesFolderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible' };
  }
  var existing = folder.getFilesByName(name);
  if (!existing.hasNext()) {
    folder.createFile(name, '', MimeType.PLAIN_TEXT);
  }
  return { success: true };
}

/**
 * Crée un fichier PLACEHOLDER VIDE au format attendu par org_secrets.py (Python) —
 * `_secrets/<name>.enc`, contenu vide — pour contourner le blocage de création du compte de
 * service (2026-07-27, voir docstring d'org_secrets.py::set_secret : "l'appelant doit créer
 * les placeholders vides via DriveApp puis rappeler set_secret"). N'écrit JAMAIS le vrai
 * secret ici (pas de chiffrement côté Apps Script) — seulement le fichier vide, pour
 * qu'update_file() (jamais bloqué) prenne ensuite le relais côté Python.
 *
 * @param {string} orgId
 * @param {string} folderId Dossier Drive de l'org
 * @param {string} name Nom du secret (ex. "enablebanking_sandbox_credentials")
 * @returns {{success:boolean, errorCode?:string}}
 */
function identityEnsureSecretPlaceholder(orgId, folderId, name) {
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible' };
  }
  var secretsFolder = _identityGetOrCreateSecretsFolder(folder);
  // _key.bin (la clé Fernet elle-même) n'a pas le suffixe .enc — seul cas particulier, tous
  // les autres secrets sont nommés <name>.enc (voir org_secrets.py::_KEY_FILENAME).
  var filename = (name === '_key') ? '_key.bin' : name + '.enc';
  var existing = secretsFolder.getFilesByName(filename);
  if (!existing.hasNext()) {
    secretsFolder.createFile(filename, '', MimeType.PLAIN_TEXT);
  }
  return { success: true };
}

/**
 * Enregistre un secret chiffré pour une org, en gérant automatiquement le protocole de
 * bootstrap en 2 temps si c'est le tout premier secret de cette org (voir
 * identityEnsureSecretPlaceholder ci-dessus et org_secrets.py::set_secret) — l'appelant n'a
 * jamais besoin de connaître ce détail, un seul appel suffit dans tous les cas.
 *
 * @param {string} orgId
 * @param {string} folderId Dossier Drive de l'org (nécessaire pour créer les placeholders au
 *   premier appel — voir identityGetOrgFolderId)
 * @param {string} name Nom du secret (ex. "enablebanking_sandbox_credentials")
 * @param {string} value Valeur en clair
 * @returns {{success:boolean, errorCode?:string}}
 */
function identitySetOrgSecret(orgId, folderId, name, value) {
  var result = analyzorSetSecret(orgId, name, value);
  // Bug réel trouvé le 2026-08-02 (smcdemo, secret powens_credentials) : le placeholder créé
  // via DriveApp n'était parfois pas encore visible à l'appel Drive API suivant côté Python
  // (list_files, Analyzor) dans la MÊME requête — cohérence éventuelle de Drive déjà source de
  // plusieurs bugs ailleurs dans ce projet. Jusqu'à 2 tentatives avec une courte pause, plutôt
  // qu'une seule reprise immédiate.
  var attempts = 0;
  while (!result.success && result.errorCode === 'needs_bootstrap' && attempts < 2) {
    (result.missingFiles || []).forEach(function (f) {
      var placeholderName = (f === '_key.bin') ? '_key' : f.replace(/\.enc$/, '');
      identityEnsureSecretPlaceholder(orgId, result.folderId || folderId, placeholderName);
    });
    Utilities.sleep(900);
    result = analyzorSetSecret(orgId, name, value);
    attempts++;
  }
  return result;
}

// Suggestions affichées côté UI (autocomplete), jamais une liste fermée : une organisation
// doit pouvoir choisir n'importe quel type de compte et n'importe quelle devise, y compris des
// cryptomonnaies ou des devises non listées ici (retour de Stéphane, 2026-07-26 : "ça peut être
// tout ce que souhaite l'organisation") — nature/devise_origine ne sont donc plus validées
// contre une liste fermée, seulement requises non vides (voir champs_manquants ci-dessous).
var IDENTITY_COMPTE_NATURES_SUGGESTIONS = ['courant', 'épargne', 'titres', 'assurance_vie', 'retraite', 'crypto'];
var IDENTITY_COMPTE_CHAMPS_REQUIS = ['etablissement', 'titulaire', 'nom', 'nature', 'devise_origine'];

/**
 * Crée une brique Compte (Suivre Mes Comptes ARCHITECTURE.md §1.1) directement dans le dossier
 * Drive de l'org via DriveApp — même contournement que `identityCreateOrg` pour le blocage de
 * quota du compte de service (`analyzor/bricks.py::create_compte` existe déjà mais ne peut
 * jamais écrire de fichier réel). Ajoute un champ `connector` optionnel, absent du schéma
 * Python d'origine — retour de Stéphane 2026-07-22 : permet de préciser à la main quel
 * connector utiliser pour ce compte, sans dépendre uniquement de la résolution automatique
 * établissement+nature côté Executor/Analyzor.
 *
 * @param {string} orgId
 * @param {string} folderId Dossier Drive de l'org (résolu au préalable, ex. via identityGetOrgProfile)
 * @param {{etablissement, titulaire, nom, nature, devise_origine, connector?}} contenu
 * @returns {{success:boolean, compte?:Object, errorCode?:string}}
 */
/**
 * Résout uniquement le dossier Drive d'une org (léger, via Analyzor) — contrairement à
 * identityGetOrgProfile, ne nécessite pas qu'une brique Organisation existe (cas de
 * smcspl/smcdemo, créées avant l'existence de cette brique). Nécessaire en amont
 * d'identityCreateCompte, qui a besoin du folderId pour écrire directement via DriveApp.
 *
 * @param {string} orgId
 * @returns {{success:boolean, folderId?:string, errorCode?:string}}
 */
function identityGetOrgFolderId(orgId) {
  try {
    return analyzor("/api/org/" + encodeURIComponent(orgId) + "/folder", null, "GET");
  } catch (e) {
    return { success: false, errorCode: "analyzor_unreachable", debug: e.message };
  }
}

function identityCreateCompte(orgId, folderId, contenu) {
  if (!folderId) {
    return { success: false, errorCode: 'folder_id_required' };
  }
  contenu = contenu || {};

  var manquants = IDENTITY_COMPTE_CHAMPS_REQUIS.filter(function (c) { return !contenu[c]; });
  if (manquants.length) {
    return { success: false, errorCode: 'champs_manquants', champs: manquants };
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible', debug: e.message, debugFolderId: folderId };
  }

  // numero suivant (retour de Stéphane, 2026-07-27 : supprimer/recréer un compte faisait
  // perdre la numérotation stable — identityCreateCompte n'assignait jamais ce champ,
  // contrairement au flux de migration Sheet V0 d'origine). Non-bloquant si Analyzor est
  // injoignable : un compte sans numero reste utilisable, juste sans badge #N.
  var numero = null;
  try {
    var existants = analyzor('/api/org/' + encodeURIComponent(orgId) + '/comptes', null, 'GET').comptes || [];
    var max = 0;
    existants.forEach(function (c) {
      var n = c.contenu && c.contenu.numero;
      if (typeof n === 'number' && n > max) max = n;
    });
    numero = max + 1;
  } catch (e) {
    // Non-bloquant.
  }

  var compteContenu = {
    etablissement: contenu.etablissement,
    titulaire: contenu.titulaire,
    nom: contenu.nom,
    nature: contenu.nature,
    devise_origine: contenu.devise_origine,
  };
  if (numero) {
    compteContenu.numero = numero;
  }
  if (contenu.connector) {
    compteContenu.connector = contenu.connector;
  }
  if (contenu.iban) {
    compteContenu.iban = contenu.iban;
  }
  if (contenu.enablebanking_account_uid) {
    compteContenu.enablebanking_account_uid = contenu.enablebanking_account_uid;
  }
  if (contenu.powens_account_id) {
    compteContenu.powens_account_id = contenu.powens_account_id;
  }

  var brick = _identityNewBrick('Compte', compteContenu.nom, compteContenu, 'org:' + orgId);
  _identityWriteBrickFile(folder, brick);

  try {
    // Analyzor garde list_bricks en cache jusqu'à 6h — sans ça, ce compte resterait invisible
    // (créé directement via DriveApp, jamais par bricks.py::create_compte) jusqu'à expiration.
    analyzor('/api/org/' + encodeURIComponent(orgId) + '/comptes/invalidate-cache', {}, 'POST');
  } catch (e) {
    // Non-bloquant : le compte est déjà écrit sur Drive, juste visible avec un délai si ce
    // deuxième appel échoue.
  }

  _identityEnsureRuleForCompte(orgId, compteContenu);

  return { success: true, compte: brick };
}

/** Déduit l'interface connector d'une brique Compte à partir de l'identifiant de liaison
 * qu'elle porte (jamais un champ `connector` saisi à la main). */
function _identityInterfaceForCompteContenu(contenu) {
  if (contenu.enablebanking_account_uid) return 'connector_enablebanking';
  if (contenu.powens_account_id) return 'connector_powens';
  return null;
}

/** Root cause du bug "Le Conservateur marche pas" (Stéphane, 2026-07-29) : lier un compte via
 * Powens/Enable Banking ne crée JAMAIS la brique Rule connector dont dépend la résolution
 * (`analyzor/config_resolver.py::resolve_connectors`) — jusqu'ici seulement créée à la main par
 * Stéphane (BCP, Crédit Mutuel), jamais par le flux self-service. Sans elle, la synchronisation
 * échoue silencieusement pour TOUTE nouvelle banque liée en self-service. Appelé automatiquement
 * par identityCreateCompte/identityUpdateCompte dès qu'un identifiant de connector est présent —
 * jamais bloquant (le compte existe déjà, un échec ici ne doit jamais empêcher sa création).
 */
function _identityEnsureRuleForCompte(orgId, compteContenu) {
  try {
    var interface_ = _identityInterfaceForCompteContenu(compteContenu);
    if (!interface_ || !compteContenu.etablissement || !compteContenu.nature) return;
    identityEnsureConnectorRule(orgId, interface_, compteContenu.etablissement, compteContenu.nature);
  } catch (e) {
    // Non-bloquant : voir commentaire ci-dessus.
  }
}

/** Crée (si besoin, idempotent) la brique Rule connector qui permettra à l'Executor de
 * résoudre établissement+nature -> interface (voir `_identityEnsureRuleForCompte`). Créée au
 * niveau MODULE (partagée par toute organisation utilisant ce module, jamais par org précise —
 * le connector d'une banque ne dépend pas de qui la consulte), via DriveApp comme toute autre
 * brique de ce fichier (le compte de service Analyzor ne peut créer aucun nouveau fichier Drive,
 * storageQuotaExceeded).
 *
 * @param {string} orgId Utilisé uniquement pour vérifier qu'une Rule n'existe pas déjà (org ou
 *   module) avant d'en créer une nouvelle — jamais pour choisir où l'écrire.
 * @param {string} interfaceName ex. 'connector_powens', 'connector_enablebanking'
 * @param {string} etablissement
 * @param {string} nature
 * @returns {{success:boolean, created?:boolean, errorCode?:string}}
 */
function identityEnsureConnectorRule(orgId, interfaceName, etablissement, nature) {
  if (!interfaceName || !etablissement || !nature) {
    return { success: false, errorCode: 'champs_manquants' };
  }

  var module = ledgerGetModule(orgId);
  if (!module) {
    return { success: false, errorCode: 'module_introuvable' };
  }

  var existing = analyzor('/api/connectors/resolve', { etablissement: etablissement, nature: nature, orgId: orgId, module: module }, 'GET');
  if (existing && existing.connectors && existing.connectors.length > 0) {
    return { success: true, created: false };
  }

  var folderResp = analyzor('/api/module/' + encodeURIComponent(module) + '/folder', null, 'GET');
  if (!folderResp || !folderResp.success || !folderResp.folderId) {
    return { success: false, errorCode: 'module_folder_introuvable' };
  }

  var moduleFolder;
  try {
    moduleFolder = DriveApp.getFolderById(folderResp.folderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible', debug: e.message };
  }

  var friendlyNames = { connector_powens: 'Powens', connector_enablebanking: 'Enable Banking' };
  var friendly = friendlyNames[interfaceName] || interfaceName;
  var title = 'Connector — ' + friendly + ' (' + etablissement + '/' + nature + ')';

  var brick = _identityNewBrick('Rule', title, {
    interface: interfaceName,
    etablissement: etablissement,
    nature_couverte: [nature],
  }, 'module:' + module);
  _identityWriteBrickFile(moduleFolder, brick);

  try {
    analyzor('/api/connectors/invalidate-cache', { module: module }, 'POST');
  } catch (e) {
    // Non-bloquant : la Rule est déjà écrite, juste visible avec un délai (jusqu'à 6h) si ce
    // deuxième appel échoue.
  }

  return { success: true, created: true, brick: brick };
}

/**
 * Met à la corbeille une brique Compte directement via DriveApp — nécessaire car sur Google
 * Drive, seul le PROPRIÉTAIRE d'un fichier peut le supprimer/mettre à la corbeille, même un
 * éditeur (writer) ne le peut pas (`canTrash`/`canDelete` faux malgré `canEdit` vrai, vérifié
 * en conditions réelles 2026-07-26 : `analyzor/bricks.py::delete_compte` échoue à 100% en
 * `insufficientFilePermissions` sur tout fichier compte réel, tous possédés par un vrai
 * utilisateur, jamais par le compte de service). Même contournement que identityCreateCompte.
 *
 * @param {string} orgId
 * @param {string} folderId Dossier Drive de l'org
 * @param {string} compteUid
 * @returns {{success:boolean, deleted?:string, errorCode?:string}}
 */
function identityDeleteCompte(orgId, folderId, compteUid) {
  if (!folderId) {
    return { success: false, errorCode: 'folder_id_required' };
  }
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible', debug: e.message };
  }

  var filename = 'compte_' + compteUid + '.json';
  var files = folder.getFilesByName(filename);
  if (!files.hasNext()) {
    return { success: false, errorCode: 'compte_introuvable' };
  }
  files.next().setTrashed(true);

  try {
    analyzor('/api/org/' + encodeURIComponent(orgId) + '/comptes/invalidate-cache', {}, 'POST');
  } catch (e) {
    // Non-bloquant : le compte est déjà à la corbeille, juste visible avec un délai si ce
    // deuxième appel échoue.
  }

  return { success: true, deleted: compteUid };
}

/**
 * Modifie les champs d'une brique Compte existante (établissement, titulaire, nom, nature,
 * devise_origine, iban...) directement via DriveApp — même raison que identityDeleteCompte :
 * seul le propriétaire du fichier peut le modifier de façon fiable en toutes circonstances
 * (en pratique `canModifyContent` est généralement vrai aussi pour un éditeur, mais on reste
 * cohérent avec create/delete pour éviter une 3e voie d'accès Drive). Ne remplace QUE les
 * champs fournis dans `contenu` — un champ absent ou undefined garde sa valeur actuelle,
 * jamais écrasé silencieusement (retour de Stéphane, 2026-07-26 : "je devrais pouvoir renommer
 * le nom du compte et tous ces champs").
 *
 * @param {string} orgId
 * @param {string} folderId Dossier Drive de l'org
 * @param {string} compteUid
 * @param {{etablissement?, titulaire?, nom?, nature?, devise_origine?, iban?, connector?}} contenu
 * @returns {{success:boolean, compte?:Object, errorCode?:string}}
 */
function identityUpdateCompte(orgId, folderId, compteUid, contenu) {
  if (!folderId) {
    return { success: false, errorCode: 'folder_id_required' };
  }
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    return { success: false, errorCode: 'folder_not_accessible', debug: e.message };
  }

  var filename = 'compte_' + compteUid + '.json';
  var files = folder.getFilesByName(filename);
  if (!files.hasNext()) {
    return { success: false, errorCode: 'compte_introuvable' };
  }
  var file = files.next();

  var brick;
  try {
    brick = JSON.parse(file.getBlob().getDataAsString());
  } catch (e) {
    return { success: false, errorCode: 'brique_illisible', debug: e.message };
  }

  contenu = contenu || {};
  ['etablissement', 'titulaire', 'nom', 'nature', 'devise_origine', 'iban', 'connector', 'enablebanking_account_uid', 'powens_account_id'].forEach(function (champ) {
    if (contenu[champ] !== undefined && contenu[champ] !== null && contenu[champ] !== '') {
      brick.contenu[champ] = contenu[champ];
    }
  });
  if (contenu.nom !== undefined && contenu.nom !== null && contenu.nom !== '') {
    brick.title = contenu.nom;
  }
  brick.modified = _identityNowStamp();

  file.setContent(JSON.stringify(brick, null, 2));

  try {
    analyzor('/api/org/' + encodeURIComponent(orgId) + '/comptes/invalidate-cache', {}, 'POST');
  } catch (e) {
    // Non-bloquant.
  }

  _identityEnsureRuleForCompte(orgId, brick.contenu);

  return { success: true, compte: brick };
}

/** Inclusion HTML du panneau "mon organisation" (rond + panneau, équivalent BYOS
 * d'AccountPanel.html — voir ConnectorAccount.js) — même pattern d'inclusion par template.
 * verifiedRole/verifiedEmail (2026-08-11) : identité déjà prouvée par Navigator::authGate
 * (session + appartenance réelle, subscriptions_api) — évite au panneau de refaire sa propre
 * détection "isOwner" moins fiable (Drive/Session.getActiveUser(), toujours faux en pratique
 * sous executeAs=USER_DEPLOYING) qui affichait un point bleu neutre à la place du ✓ vert même
 * juste après une connexion réussie. null pour un visiteur non authentifié (smcdemo public). */
function getOrgPanelHtml(orgId, verifiedRole, verifiedEmail) {
  var template = HtmlService.createTemplateFromFile("OrgPanel.html");
  template.orgId = orgId;
  template.verifiedRole = verifiedRole || null;
  template.verifiedEmail = verifiedEmail || null;
  return template.evaluate().getContent();
}

/** Inclusion HTML du composant partagé "Flow visible" (PrecognFlow, voir FlowWidget.html) —
 * pas de variable de template (statique), inclus tel quel par tout consommateur Apps Script.
 * Retour de Stéphane, 2026-07-31 : rendre visibles les traitements en cours (connexion
 * bancaire) sous forme de briques qui s'allument, plutôt qu'une barre de progression opaque. */
function getFlowWidgetHtml() {
  return HtmlService.createHtmlOutputFromFile("FlowWidget.html").getContent();
}

// ================================================================
// identityRepairOrg — migration générique vers BYOS
// Écrit les briques Organisation + User dans un dossier Drive existant
// (connu via Docling) ou dans un nouveau dossier sous ORGS_ROOT_FOLDER_ID.
// S'exécute avec l'identité Google de l'appelant (USER_ACCESSING) via
// DriveApp — le compte de service Analyzor n'a pas de quota personnel.
// ================================================================
var ORGS_ROOT_FOLDER_ID = '1HKVOGreRhSF2VNynJBb_uQX9y_ar-DGR';

function identityRepairOrg(orgId, orgName, parentOrgId, ownerEmail, ownerName, existingFolderId) {
  orgId    = (orgId    || '').trim();
  orgName  = (orgName  || '').trim();
  if (!orgId || !orgName) {
    return { success: false, errorCode: 'params_required' };
  }

  // 1. Déjà en BYOS ? (brique Organisation présente)
  try {
    var check = analyzor('/api/org/' + encodeURIComponent(orgId), null, 'GET');
    if (check && check.success) {
      return { success: false, errorCode: 'already_byos', orgId: orgId };
    }
  } catch (e) { /* analyzor injoignable : on tente quand même */ }

  // 2. Résoudre le dossier Drive
  var folder, folderId = existingFolderId || null;

  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); }
    catch (e) { return { success: false, errorCode: 'folder_not_accessible', folderId: folderId, error: e.message }; }
  } else {
    // Créer sous ORGS_ROOT_FOLDER_ID, ou retrouver si déjà présent
    try {
      var root = DriveApp.getFolderById(ORGS_ROOT_FOLDER_ID);
      var sub = root.getFoldersByName(orgId);
      folder   = sub.hasNext() ? sub.next() : root.createFolder(orgId);
      folderId = folder.getId();
    } catch (e) {
      return { success: false, errorCode: 'root_folder_not_accessible', error: e.message };
    }
  }

  // 3. Vérifier qu'il n'y a pas déjà une brique Organisation
  var files = folder.getFiles();
  while (files.hasNext()) {
    if (files.next().getName().startsWith('organisation_')) {
      return { success: false, errorCode: 'already_has_org_brick', orgId: orgId };
    }
  }

  // 4. Créer la brique Organisation
  var now = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss");
  var orgUid = 'org_' + Utilities.getUuid().replace(/-/g, '').substring(0, 20);
  var orgBrick = {
    id: 'ORGANISATION-' + orgUid, uid: orgUid,
    type: 'Organisation', title: orgName,
    creator: 'migration-byos', created: now, modified: now,
    owner: 'org:' + orgId, language: 'fr', version: '1',
    status: 'Active', tags: [], rights: 'internal', source: 'migration-byos', relations: [],
    contenu: { name: orgName, parentOrgId: parentOrgId || null, joinPolicy: 'restricted' }
  };
  folder.createFile('organisation_' + orgUid + '.json', JSON.stringify(orgBrick, null, 2), MimeType.PLAIN_TEXT);

  // 5. Créer la brique User (propriétaire)
  var userUid = null;
  if (ownerEmail) {
    userUid = 'use_' + Utilities.getUuid().replace(/-/g, '').substring(0, 20);
    var userBrick = {
      id: 'USER-' + userUid, uid: userUid,
      type: 'User', title: ownerName || ownerEmail,
      creator: 'migration-byos', created: now, modified: now,
      owner: 'org:' + orgId, language: 'fr', version: '1',
      status: 'Active', tags: [], rights: 'internal', source: 'migration-byos', relations: [],
      contenu: { email: ownerEmail, name: ownerName || null, role: 'owner' }
    };
    folder.createFile('user_' + userUid + '.json', JSON.stringify(userBrick, null, 2), MimeType.PLAIN_TEXT);
  }

  // 6. Partager avec le compte de service Analyzor (lecture seule)
  try { folder.addViewer(ANALYZOR_SERVICE_ACCOUNT_EMAIL); } catch (e) { /* non-bloquant */ }

  // 7. Enregistrer l'adresse dans Docling
  try { doclingRegisterOrgAddress(orgId, orgUid, folderId, 'gdrive'); } catch (e) { /* non-bloquant */ }

  return { success: true, orgId: orgId, folderId: folderId, orgUid: orgUid, userUid: userUid };
}
