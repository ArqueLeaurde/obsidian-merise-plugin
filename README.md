# 🏗️ Merise Plugin pour Obsidian

Plugin Obsidian complet pour la modélisation **Merise** (MCD, MLD, MPD) avec rendu **Mermaid**, conversion automatique entre niveaux et export **SQL**.

## ✨ Fonctionnalités

- 📊 **MCD** — Modèle Conceptuel de Données avec diagramme flowchart Mermaid (losanges pour les relations, rectangles pour les entités)
- 📋 **MLD** — Modèle Logique de Données avec diagramme erDiagram (PK, FK visibles)
- 🗄️ **MPD** — Modèle Physique de Données avec types SQL et contraintes
- 🔄 **Conversion automatique** MCD → MLD → MPD
- 📤 **Export SQL** (MySQL, PostgreSQL)
- ✅ **Validation** : entités orphelines, cycles FK, cardinalités
- 🧬 **Héritage** : 3 stratégies (table par classe, table unique, table par sous-classe)
- 🔗 **Associations** : binaires, ternaires, entités associatives
- 🔀 **Relations multiples** entre mêmes entités (ex: livraison/facturation)
- 📐 **Propagation stricte des types FK** depuis les PK référencées
- 🎨 **Rendu soigné** : lignes droites (linear), couleurs différenciées, cardinalités sur chaque lien

## 📦 Installation

### Depuis les sources

```bash
cd merise-plugin
npm install
npm run build
```

Copier le dossier `merise-plugin` (contenant `main.js`, `manifest.json`) dans :
```
<votre-vault>/.obsidian/plugins/merise-plugin/
```

Activer le plugin dans **Paramètres → Plugins communautaires**.

## 📝 Syntaxe

### MCD (Modèle Conceptuel de Données)

La syntaxe MCD supporte le format **multi-ligne** ET **single-ligne** :

#### Format multi-ligne

````markdown
```merise-mcd
ENTITY CLIENT {
    id_client [PK]
    nom
    email
}

ENTITY COMMANDE {
    id_commande [PK]
    date_commande
    montant_total
}

ENTITY PRODUIT {
    id_produit [PK]
    nom_produit
    prix_unitaire
}

RELATION passe {
    CLIENT (0,n)
    COMMANDE (1,1)
}

RELATION contient {
    COMMANDE (1,n)
    PRODUIT (0,n)
    quantite
}
```
````

#### Format compact (single-ligne)

````markdown
```merise-mcd
ENTITY CLIENT { id_client [PK], nom, email }
ENTITY COMMANDE { id_commande [PK], date_commande }
ENTITY ADRESSE { id_adresse [PK], rue, ville }
ENTITY ARTICLE { ref_article [PK], designation, prix }

RELATION livraison { COMMANDE (1,1), ADRESSE (0,n) }
RELATION facturation { COMMANDE (1,1), ADRESSE (0,n) }
RELATION contient { COMMANDE (1,n), ARTICLE (0,n), quantite }
```
````

#### Attributs spéciaux
- `[PK]` — Clé primaire (identifiant)
- `[DERIVED]` — Attribut dérivé (calculé, non stocké)

#### Cardinalités
| Merise | Signification |
|--------|--------------|
| `(0,1)` | Zéro ou un |
| `(1,1)` | Exactement un |
| `(0,n)` | Zéro ou plusieurs |
| `(1,n)` | Un ou plusieurs |

#### Héritage

````markdown
```merise-mcd
ENTITY PERSONNE {
    id_personne [PK]
    nom
    prenom
}

ENTITY ETUDIANT {
    id_etudiant [PK]
    numero_etudiant
}

ENTITY PROFESSEUR {
    id_professeur [PK]
    specialite
}

INHERITANCE est_un {
    PARENT PERSONNE
    CHILDREN ETUDIANT, PROFESSEUR
    STRATEGY table_per_class
}
```
````

#### Entité associative

````markdown
```merise-mcd
ASSOCIATIVE Inscription ON contient {
    date_inscription
    note
}
```
````

### MLD (Modèle Logique de Données)

````markdown
```merise-mld
TABLE CLIENT {
    id_client [PK]
    nom
    email
}

TABLE COMMANDE {
    id_commande [PK]
    date_commande
    montant_total
    id_client [FK -> CLIENT.id_client]
}
```
````

### MPD (Modèle Physique de Données)

````markdown
```merise-mpd
TABLE CLIENT {
    id_client INT [PK] [NOT NULL]
    nom VARCHAR(100) [NOT NULL]
    email VARCHAR(255) [UNIQUE]
}

TABLE COMMANDE {
    id_commande INT [PK] [NOT NULL]
    date_commande DATE [NOT NULL]
    montant_total DECIMAL(10,2)
    id_client INT [FK -> CLIENT.id_client ON DELETE CASCADE ON UPDATE CASCADE] [NOT NULL]
}
```
````

## 🔄 Commandes

Ouvrir la **palette de commandes** (`Ctrl+P` / `Cmd+P`) :

| Commande | Description |
|----------|------------|
| `Merise : Convertir MCD → MLD` | Convertit le bloc MCD en MLD |
| `Merise : Convertir MLD → MPD` | Convertit le bloc MLD en MPD |
| `Merise : Convertir MCD → MLD → MPD (complet)` | Conversion complète en une étape |
| `Merise : Exporter SQL depuis MPD` | Génère le SQL et le copie |

## ⚙️ Paramètres

- **Stratégie d'héritage** : `table_per_class`, `single_table`, `table_per_subclass`
- **Dialecte SQL** : MySQL, PostgreSQL
- **Longueur VARCHAR** : valeur par défaut (255)

## 🔍 Exemple complet : Relations multiples & Types FK

### Entrée (MCD)

````markdown
```merise-mcd
ENTITY COMMANDE { id_commande [PK] }
ENTITY ADRESSE { id_adresse [PK] }
ENTITY ARTICLE { ref_article [PK] }

RELATION livraison { COMMANDE (1,1), ADRESSE (0,n) }
RELATION facturation { COMMANDE (1,1), ADRESSE (0,n) }
RELATION contient { COMMANDE (1,n), ARTICLE (0,n), quantite }
```
````

### Résultat MLD (généré automatiquement)

````markdown
```merise-mld
TABLE COMMANDE {
    id_commande [PK]
    id_adresse_livraison [FK -> ADRESSE.id_adresse]
    id_adresse_facturation [FK -> ADRESSE.id_adresse]
}

TABLE ADRESSE {
    id_adresse [PK]
}

TABLE ARTICLE {
    ref_article [PK]
}

TABLE contient {
    id_commande [PK] [FK -> COMMANDE.id_commande]
    ref_article [PK] [FK -> ARTICLE.ref_article]
    quantite
}
```
````

### Résultat MPD (types propagés depuis les PK)

````markdown
```merise-mpd
TABLE COMMANDE {
    id_commande INT [PK] [NOT NULL]
    id_adresse_livraison INT [FK -> ADRESSE.id_adresse] [NOT NULL]
    id_adresse_facturation INT [FK -> ADRESSE.id_adresse] [NOT NULL]
}

TABLE contient {
    id_commande INT [PK] [FK -> COMMANDE.id_commande] [NOT NULL]
    ref_article VARCHAR(20) [PK] [FK -> ARTICLE.ref_article] [NOT NULL]
    quantite INT
}
```
````

> **Points clés :**
> - `id_adresse_livraison` et `id_adresse_facturation` sont distincts (relations multiples)
> - `ref_article` est `VARCHAR(20)` dans la table `contient` (propagé depuis `ARTICLE.ref_article`)
> - `id_commande` est `INT` partout (propagé depuis `COMMANDE.id_commande`)
> - Pas de noms redondants comme `commande_id_commande`

## 📁 Architecture

```
merise-plugin/
├── manifest.json          # Manifeste Obsidian
├── package.json           # Dépendances NPM
├── tsconfig.json          # Config TypeScript
├── esbuild.config.mjs     # Bundler
├── main.ts                # Point d'entrée plugin
├── settings.ts            # Panneau de paramètres
├── models/
│   └── types.ts           # Tous les types/interfaces
├── parser/
│   ├── mcdParser.ts       # Parser MCD
│   ├── mldParser.ts       # Parser MLD
│   └── mpdParser.ts       # Parser MPD
├── renderer/
│   ├── mcdRenderer.ts     # MCD → Mermaid
│   ├── mldRenderer.ts     # MLD → Mermaid
│   └── mpdRenderer.ts     # MPD → Mermaid
├── converter/
│   ├── mcdToMld.ts        # Conversion MCD → MLD
│   └── mldToMpd.ts        # Conversion MLD → MPD
├── sql/
│   └── sqlGenerator.ts    # Génération SQL DDL
└── validation/
    └── validator.ts       # Validation des modèles
```

## 🔧 Développement

```bash
npm install       # Installer les dépendances
npm run dev       # Build en mode développement (sourcemaps)
npm run build     # Build en mode production (minifié)
```

### Tests

```bash
npx esbuild test_pipeline.ts --bundle --platform=node --outfile=test_pipeline.js --external:obsidian && node test_pipeline.js
```

Le script `test_pipeline.ts` vérifie le pipeline complet : parsing → conversion → rendu → SQL.

## 🎨 Rendu Mermaid

| Niveau | Type Mermaid | Description |
|--------|-------------|-------------|
| **MCD** | `graph TD` (flowchart) | Entités en rectangles bleus, relations en losanges jaunes, cardinalités sur chaque lien |
| **MLD** | `erDiagram` | Tables avec colonnes PK/FK, liens FK distincts par colonne |
| **MPD** | `erDiagram` | Tables avec types SQL visibles, contraintes annotées |

- **Courbes** : `linear` (lignes droites) pour éviter les chevauchements
- **Couleurs** : entités (bleu), relations (jaune), héritage (rouge), entités associatives (vert)

## 📄 Licence

MIT
