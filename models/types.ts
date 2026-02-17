/**
 * models/types.ts
 * 
 * Définitions de tous les types TypeScript pour le plugin Merise.
 * Couvre les trois niveaux de modélisation : MCD, MLD, MPD.
 */

// ============================================================
// Enums
// ============================================================

/** Cardinalités Merise standard */
export type Cardinality = '0,1' | '1,1' | '0,n' | '1,n';

/** Stratégie de conversion de l'héritage MCD → MLD */
export type InheritanceStrategy = 'table_per_class' | 'single_table' | 'table_per_subclass';

/** Dialecte SQL pour la génération */
export type SqlDialect = 'mariadb' | 'mysql' | 'postgresql';

/** Types SQL courants */
export type SqlType =
    | 'INT'
    | 'BIGINT'
    | 'SMALLINT'
    | 'SERIAL'
    | 'VARCHAR'
    | 'CHAR'
    | 'TEXT'
    | 'DATE'
    | 'DATETIME'
    | 'TIMESTAMP'
    | 'DECIMAL'
    | 'FLOAT'
    | 'DOUBLE'
    | 'BOOLEAN'
    | 'BLOB';

// ============================================================
// MCD — Modèle Conceptuel de Données
// ============================================================

/** Attribut d'une entité ou d'une relation MCD */
export interface McdAttribute {
    /** Nom de l'attribut */
    name: string;
    /** Est-ce une clé primaire (ou une partie de la clé composée) ? */
    isPrimaryKey: boolean;
    /** Est-ce un attribut dérivé (calculé) ? */
    isDerived: boolean;
}

/** Entité MCD */
export interface McdEntity {
    /** Nom de l'entité (ex: CLIENT, COMMANDE) */
    name: string;
    /** Liste des attributs */
    attributes: McdAttribute[];
}

/** Participant à une relation MCD (entité + cardinalité) */
export interface McdRelationParticipant {
    /** Nom de l'entité participante */
    entityName: string;
    /** Cardinalité Merise (min,max) */
    cardinality: Cardinality;
}

/** Relation (association) MCD */
export interface McdRelation {
    /** Nom de la relation (ex: passe, contient) */
    name: string;
    /** Entités participantes avec leurs cardinalités */
    participants: McdRelationParticipant[];
    /** Attributs portés par la relation */
    attributes: McdAttribute[];
}

/** Héritage (généralisation / spécialisation) */
export interface McdInheritance {
    /** Nom de la relation d'héritage */
    name: string;
    /** Entité parent */
    parentEntity: string;
    /** Entités enfants */
    childEntities: string[];
    /** Stratégie de conversion (optionnel, sinon on utilise le setting global) */
    strategy?: InheritanceStrategy;
}

/** Entité associative (promue depuis une relation) */
export interface McdAssociativeEntity {
    /** Nom de l'entité associative */
    name: string;
    /** Nom de la relation sur laquelle elle est basée */
    relationName: string;
    /** Attributs propres à l'entité associative */
    attributes: McdAttribute[];
}

/** Modèle Conceptuel de Données complet */
export interface McdModel {
    entities: McdEntity[];
    relations: McdRelation[];
    inheritances: McdInheritance[];
    associativeEntities: McdAssociativeEntity[];
}

// ============================================================
// MLD — Modèle Logique de Données
// ============================================================

/** Clé étrangère MLD */
export interface MldForeignKey {
    /** Nom de la colonne source */
    columnName: string;
    /** Table référencée */
    referencedTable: string;
    /** Colonne référencée */
    referencedColumn: string;
}

/** Colonne MLD */
export interface MldColumn {
    /** Nom de la colonne */
    name: string;
    /** Clé primaire ? */
    isPrimaryKey: boolean;
    /** Clé étrangère ? (référence complète) */
    foreignKey?: MldForeignKey;
}

/** Table MLD */
export interface MldTable {
    /** Nom de la table */
    name: string;
    /** Colonnes */
    columns: MldColumn[];
}

/** Modèle Logique de Données complet */
export interface MldModel {
    tables: MldTable[];
}

// ============================================================
// MPD — Modèle Physique de Données
// ============================================================

/** Action référentielle pour les FK */
export type ReferentialAction = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

/** Contrainte MPD */
export interface MpdConstraint {
    type: 'NOT NULL' | 'UNIQUE' | 'CHECK';
    /** Expression pour CHECK, nom de colonne pour UNIQUE */
    expression?: string;
}

/** Clé étrangère MPD avec actions référentielles */
export interface MpdForeignKey {
    /** Nom de la colonne source */
    columnName: string;
    /** Table référencée */
    referencedTable: string;
    /** Colonne référencée */
    referencedColumn: string;
    /** Action sur suppression */
    onDelete?: ReferentialAction;
    /** Action sur mise à jour */
    onUpdate?: ReferentialAction;
}

/** Colonne MPD */
export interface MpdColumn {
    /** Nom de la colonne */
    name: string;
    /** Type SQL */
    sqlType: string;
    /** Clé primaire ? */
    isPrimaryKey: boolean;
    /** Clé étrangère ? */
    foreignKey?: MpdForeignKey;
    /** Contraintes sur cette colonne */
    constraints: MpdConstraint[];
}

/** Table MPD */
export interface MpdTable {
    /** Nom de la table */
    name: string;
    /** Colonnes */
    columns: MpdColumn[];
}

/** Modèle Physique de Données complet */
export interface MpdModel {
    tables: MpdTable[];
}

// ============================================================
// Plugin Settings
// ============================================================

/** Paramètres du plugin Merise pour Obsidian */
export interface MerisePluginSettings {
    /** Stratégie d'héritage par défaut pour la conversion MCD → MLD */
    inheritanceStrategy: InheritanceStrategy;
    /** Dialecte SQL pour la génération MPD et l'export SQL */
    sqlDialect: SqlDialect;
    /** Longueur VARCHAR par défaut */
    defaultVarcharLength: number;
}

/** Valeurs par défaut des paramètres */
export const DEFAULT_SETTINGS: MerisePluginSettings = {
    inheritanceStrategy: 'table_per_class',
    sqlDialect: 'mariadb',
    defaultVarcharLength: 255,
};
