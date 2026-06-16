# PitStop — Roadmap feedback client (Jack, Elite Racing)

Date du brief : 2026-05-27
On traite **une tâche à la fois**. Statut : ⬜ à faire · 🔄 en cours · ✅ fait

---

## 1. ✅ GST flexible (détection + override)
**Problème** : sur certaines factures la GST est calculée sur `COGS + shipping`, sur d'autres sur `COGS seul`. L'app appliquait une logique contradictoire (calcul live = goods+freight, mais `load()` "corrigeait" vers goods-only) → mismatch → sync bloqué.
**Fait (2026-05-27)** :
- Nouveau champ `gstBase: "goods" | "goods_plus_freight"` sur la PO (persisté)
- **Détection auto** au load : reverse-check du `taxTotal` de la facture contre les deux bases, choisit la plus proche
- Supprimé la "correction" qui réécrivait les totaux du fournisseur — on garde les chiffres tels quels
- Calcul GST live dépend de `gstBase` ; ligne "GST (10% on goods only/goods + freight)" avec bouton **"switch ⇄"**
- **Hint intelligent** : si basculer la base résout le mismatch, un bouton apparaît dans la bannière de blocage : "This invoice charges GST on goods only — switch & fix"

## 2. ✅ Refonte product matching (dropdown inline + matching intelligent)
**Problème** : la 2e section de réconciliation est confuse pour le client.
**Fait (2026-05-27)** :
- `lib/productMatch.ts` — matcher multi-critères : SKU exact, barcode, cross sku↔barcode, tokens de nom (numéros de modèle ×3), taille/couleur via optionValues vs variantTitle. Score 0–100 + raisons lisibles.
- Sur **chaque ligne** post-parse : suggestions inline (top 3) avec badge de confiance (vert/ambre/gris) + score, cliquables → match confirmé. Lien "Search…" ouvre le picker complet.
- Le match confirmé alimente `confirmedMappings` → envoyé comme `overrides` au preview/sync (déjà respecté côté serveur) → closed-loop d'apprentissage (saveNameMapping) déclenché.
- Variantes : le ProductPicker regroupe par produit et liste les variantes (taille/couleur) séparément.

## 3. ✅ Sauvegarde des PO + édition ultérieure
**Problème** : les PO n'apparaissent pas dans le dashboard + impossible d'éditer une PO synchronisée.
**Cause racine #1** : `where + orderBy` sur le GET dashboard exigeait un index composite Firestore inexistant → l'API crashait → liste vide. **Corrigé** (commit 88a66ff) : tri côté serveur.
**Cause racine #2** : sur une PO déjà synchronisée, `load()` remplit `syncResult`, ce qui cachait toute la rangée de boutons (dont Save) → impossible d'éditer plus tard.
**Fait (2026-05-27)** :
- Bouton **"Save changes"** persistant dans le header — toujours visible, sauve sans quitter la page, pour n'importe quel statut (draft/awaiting/ordered/approved)
- `handleSave` ne rétrograde plus une PO approved/ordered
- Vérifié : le parse sauve bien la PO (status draft, merchantId, createdAt) — `parse-invoice/route.ts:262`
- Le backend `[id]` a déjà GET/PUT/DELETE complets (DELETE inclut le reversal stock Shopify)
- "View →" du dashboard rouvre la PO éditable

## 4. ✅ Catalogue complet partout (plus de restriction collections)
**Problème** : audit / stocktake / ailleurs ne montrent que les produits d'une collection/catégorie.
**Cause racine** : filtre `status:active` au niveau du sync Shopify → draft/archived exclus.
**Fait (2026-05-27)** :
- `lib/shopify.ts` CATALOG_QUERY → `status:active OR status:draft OR status:archived`
- `fetchAllActiveVariants` renommé `fetchAllVariants`
- Webhook produits : n'efface plus les draft/archived, les met à jour (seul `products/delete` efface)
- Backfill collections : même filtre élargi
- ⚠️ **ACTION REQUISE** : Jack doit cliquer "Sync" dans /catalog pour re-importer tout le catalogue
- 🔧 Note technique : le webhook n'écrit pas `merchantId` (OK en single-tenant Elite Racing, à corriger pour le SaaS public)

## 5. ✅ Ajout manuel d'items via search bar
**Fait (2026-05-27)** : bouton **"Search & add product"** sur la page review → ouvre le `ProductPicker` → ajoute une ligne pré-remplie (nom, SKU, barcode, prix) ET pré-matchée au variant Shopify. Bouton "Blank row" conservé pour saisie 100% libre.

## 6. ✅ Création de PO 100% manuelle (sans parse)
**Fait (2026-05-27)** : `app/purchase-orders/new/manual` existait déjà — ajout du `ProductPicker` ("Search & add product") pour piocher dans le catalogue au lieu de tout taper. Réutilise le même composant partagé.

**Composant partagé créé** : `components/ProductPicker.tsx` — modal de recherche instantanée (titre/SKU/barcode/collection), regroupe les variantes par produit, affiche stock + prix.

## 7. ✅ Coût moyen pondéré (moving average cost) ⭐ IMPORTANT
**Fait (2026-05-27)** :
- **Sync** : au lieu d'écraser le coût Shopify, calcule la moyenne pondérée
  `newAvg = (qtéExistante × coûtExistant + qtéEntrante × coûtEntrant) / (qtéExistante + qtéEntrante)`.
  Le `levelMap` (qty + coût AVANT sync) était déjà fetché → réutilisé.
- **Réversibilité** : chaque ligne synchronisée stocke `previousUnitCost`, `appliedUnitCost`, `newAvgCost`.
- **Delete** : retire exactement la contribution de cette PO —
  `reversedCost = (qtéActuelle × coûtActuel − qtéPO × coûtPO) / (qtéActuelle − qtéPO)`,
  fallback sur `previousUnitCost` si stock résiduel = 0. Quantité reversée comme avant.
- **UI** : la preview affiche "→ avg $X" sous le landed cost quand la moyenne diffère (avec le coût Shopify précédent en tooltip).
- Rétro-compatible : les vieilles PO sans `appliedUnitCost` font le reversal quantité seul (comportement actuel).

## 8. ✅ Stock take : sauvegarde + fix scanner
**Fait (2026-05-27)** :
- **Save multi-jours** : les comptes sont déjà persistés en IndexedDB (Dexie) → survivent à la fermeture/réouverture sur le même appareil, même des jours après. Ajout d'un badge **"✓ Auto-saved"** dans la barre du haut (avec tooltip "safe to close, resume later") pour donner confiance.
- **Fix scanner — vraie cause trouvée** : le rewrite getUserMedia avait perdu la sélection de caméra. Sur desktop, `getUserMedia` prenait la caméra par défaut = "S23 Ultra (Windows Virtual Camera)" (flux mort) → écran noir. Fix : on demande la permission, PUIS on ré-acquiert la meilleure **vraie** caméra (skip virtual/obs/droidcam/phone-as-webcam ; préfère arrière sur mobile via labels back/rear/environment).
- **Fallback saisie manuelle** : champ "type / paste a barcode" dans l'écran d'erreur → Jack peut continuer à compter même si la caméra refuse.

## 9. ✅ Alerte re-scan (déjà compté)
**Fait (2026-05-27)** : un re-scan d'un item déjà compté **n'incrémente plus automatiquement**. La barre de résultat affiche "⚠ Already counted (qty X) — duplicate?" avec deux boutons : **Skip** / **Add anyway +1**. L'utilisateur décide.

---

## 10. ✅ Persistance + auto-sync + onboarding nouveaux marchands
**Fait (2026-06-01)** :
- **Persistance** : le catalogue vit déjà dans Firestore — présent à chaque ouverture, aucun re-sync nécessaire (le sync ne sert qu'à rafraîchir).
- **Sync paginé** : 250 produits/appel, le client boucle → plus de timeout 60s (13k+ produits OK).
- **Auto-sync** : webhook produits corrigé → route par `x-shopify-shop-domain` vers le bon `merchantId` (fallback elite-racing via env). "Enable Auto-Sync" pousse maintenant les changements Shopify en continu, isolés par marchand.
- **Onboarding "mix"** : endpoint `/api/shopify/collections`, modal "Choose collections" sur /catalog (cases à cocher + compteurs), filtre `collections` sur le sync paginé. Défaut = tout importer ; option = sélectionner des collections.

## 11. ✅ Coût moyen pondéré PAR VARIANTE (révision tâche 7)
**Demande client (clarifiée)** : KASK White/S ne se moyenne qu'avec le coût existant du MÊME KASK White/S — jamais avec les autres variantes.
**Règles** : stock>0 → moyenne pondérée par quantité de la variante ; stock 0 mais coût enregistré → moyenne simple (ancien+nouveau)/2 ; aucun coût existant → prix facture.
**Fait (2026-06-01)** :
- Calcul **par variante** (par `inventoryItemId`), réutilise `levelMap` (coût + qté live de chaque variante matchée) — zéro requête sœur.
- Le coût est écrit sur la variante elle-même uniquement.
- `costSnapshot` (inventoryItemId → coût avant) → suppression PO restaure exactement.
- La preview affiche "→ avg $X" par ligne.

## Dépendances / ordre suggéré
- **5 + 6 + 2** partagent un composant : **smart product picker** (search + variantes + matching). À construire une fois.
- **7** (costing) se branche sur l'ajout de produit (5, 6) et la suppression de PO (3).
- **8 scanner** = problème isolé, peut être fait en parallèle.
- **4** (catalogue complet) débloque 2/5/6 (le picker doit voir tout le catalogue).
