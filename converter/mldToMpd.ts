/**
 * converter/mldToMpd.ts
 * 
 * Conversion MLD → MPD.
 * 
 * Propagation stricte des types :
 *   - Les FK héritent du type SQL de la PK qu'elles référencent.
 *   - On ne devine PAS le type d'une FK par son nom : on le cherche dans
 *     la table référencée.
 * 
 * Ajoute :
 *   - Types SQL aux colonnes (inférence par nom OU propagation depuis PK ref)
 *   - Contraintes NOT NULL pour les PK et FK
 *   - FK avec actions référentielles
 *   - Contraintes UNIQUE, CHECK automatiques
 */

import {
    MldModel,
    MldTable,
    MpdModel,
    MpdTable,
    MpdColumn,
    MpdConstraint,
    SqlDialect,
} from '../models/types';

/**
 * Convertit un MldModel en MpdModel avec propagation stricte des types FK.
 * @param mld Le modèle logique source
 * @param dialect Dialecte SQL cible
 * @param defaultVarcharLength Longueur VARCHAR par défaut
 */
export function convertMldToMpd(
    mld: MldModel,
    dialect: SqlDialect = 'mysql',
    defaultVarcharLength: number = 255
): MpdModel {
    const mpd: MpdModel = { tables: [] };

    // ── Phase 1 : Construire toutes les tables avec leurs types ──
    // D'abord on résout les types des colonnes non-FK (PK et colonnes normales).
    // On mémorise le type de chaque PK pour les propager aux FK ensuite.

    /** Map tableName.columnName → type SQL résolu */
    const resolvedTypes = new Map<string, string>();

    // Premier passage : résoudre les types des colonnes NON-FK
    for (const mldTable of mld.tables) {
        for (const mldCol of mldTable.columns) {
            if (!mldCol.foreignKey) {
                const sqlType = inferSqlType(mldCol.name, mldCol.isPrimaryKey, dialect, defaultVarcharLength);
                resolvedTypes.set(`${mldTable.name}.${mldCol.name}`, sqlType);
            }
        }
    }

    // Deuxième passage : résoudre les FK en propageant le type de la PK référencée
    for (const mldTable of mld.tables) {
        for (const mldCol of mldTable.columns) {
            if (mldCol.foreignKey) {
                const refKey = `${mldCol.foreignKey.referencedTable}.${mldCol.foreignKey.referencedColumn}`;
                let refType = resolvedTypes.get(refKey);

                if (refType) {
                    // Cas spécial : si la PK référencée est SERIAL (PostgreSQL auto-increment),
                    // la FK doit être INT (pas SERIAL, car seule la PK a auto-increment)
                    if (refType === 'SERIAL') {
                        refType = 'INT';
                    }
                } else {
                    // Fallback : inférer par nom (ne devrait pas arriver en pratique)
                    refType = inferSqlType(mldCol.foreignKey.referencedColumn, false, dialect, defaultVarcharLength);
                }

                resolvedTypes.set(`${mldTable.name}.${mldCol.name}`, refType);
            }
        }
    }

    // ── Phase 2 : Construire le modèle MPD final ──
    for (const mldTable of mld.tables) {
        const mpdTable: MpdTable = {
            name: mldTable.name,
            columns: [],
        };

        for (const mldCol of mldTable.columns) {
            const sqlType = resolvedTypes.get(`${mldTable.name}.${mldCol.name}`)
                || inferSqlType(mldCol.name, mldCol.isPrimaryKey, dialect, defaultVarcharLength);

            const constraints: MpdConstraint[] = [];

            // PK implique NOT NULL
            if (mldCol.isPrimaryKey) {
                constraints.push({ type: 'NOT NULL' });
            }

            // Colonnes email → UNIQUE
            if (mldCol.name.toLowerCase().includes('email')) {
                constraints.push({ type: 'UNIQUE' });
            }

            const mpdCol: MpdColumn = {
                name: mldCol.name,
                sqlType,
                isPrimaryKey: mldCol.isPrimaryKey,
                constraints,
            };

            // FK
            if (mldCol.foreignKey) {
                mpdCol.foreignKey = {
                    columnName: mldCol.foreignKey.columnName,
                    referencedTable: mldCol.foreignKey.referencedTable,
                    referencedColumn: mldCol.foreignKey.referencedColumn,
                    onDelete: 'CASCADE',
                    onUpdate: 'CASCADE',
                };
                // FK implique NOT NULL
                if (!constraints.find(c => c.type === 'NOT NULL')) {
                    constraints.push({ type: 'NOT NULL' });
                }
            }

            mpdTable.columns.push(mpdCol);
        }

        mpd.tables.push(mpdTable);
    }

    return mpd;
}

// ============================================================
// Inférence de type SQL par nom de colonne
// ============================================================

/**
 * Déduit le type SQL d'une colonne à partir de son nom.
 * Utilisé UNIQUEMENT pour les colonnes non-FK (PK et attributs normaux).
 * Les FK héritent du type de la PK référencée via la phase de propagation.
 */
function inferSqlType(
    colName: string,
    isPrimaryKey: boolean,
    dialect: SqlDialect,
    defaultVarcharLength: number
): string {
    const name = colName.toLowerCase();

    // PK avec "id" → type auto-increment
    if (isPrimaryKey && (name.startsWith('id') || name.endsWith('id'))) {
        return dialect === 'postgresql' ? 'SERIAL' : 'INT';
    }

    // Identifiants non-PK (ex: id_xxx dans une table d'héritage)
    if (name.startsWith('id_') || name.endsWith('_id') || name === 'id') {
        return 'INT';
    }

    // Références (ref_*)
    if (name.startsWith('ref_') || name.endsWith('_ref') || name === 'ref') {
        return `VARCHAR(20)`;
    }

    // Dates
    if (name.includes('datetime') || name.includes('timestamp')) {
        return dialect === 'postgresql' ? 'TIMESTAMP' : 'DATETIME';
    }
    if (name.startsWith('date_') || name.endsWith('_date') || name === 'date') {
        return 'DATE';
    }

    // Monétaire
    if (name.startsWith('prix') || name.startsWith('montant') || name.startsWith('total') ||
        name.startsWith('price') || name.startsWith('amount')) {
        return 'DECIMAL(10,2)';
    }

    // Quantités
    if (name.startsWith('quantite') || name.startsWith('nombre') || name.startsWith('nb_') ||
        name.startsWith('quantity') || name.startsWith('count') || name.startsWith('num_')) {
        return 'INT';
    }

    // Booléens
    if (name.endsWith('_bool') || name.startsWith('est_') || name.startsWith('is_') ||
        name.startsWith('has_') || name.startsWith('a_')) {
        return 'BOOLEAN';
    }

    // Texte long
    if (name === 'description' || name === 'contenu' || name === 'content' || name === 'commentaire') {
        return 'TEXT';
    }

    // Discriminator (héritage)
    if (name === 'type_discriminator' || name === 'type') {
        return `VARCHAR(50)`;
    }

    // Défaut : VARCHAR
    return `VARCHAR(${defaultVarcharLength})`;
}
