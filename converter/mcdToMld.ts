/**
 * converter/mcdToMld.ts
 * 
 * Conversion MCD → MLD.
 * Règles appliquées :
 *   1. Chaque entité MCD → une table MLD
 *   2. Identifiants [PK] → colonnes PK
 *   3. Relation avec (1,1) d'un côté → FK du côté (1,1)
 *   4. Relation (0,n)↔(0,n) ou (1,n)↔(0,n) etc. → table associative
 *   5. Relations ternaires+ → table associative avec N FK
 *   6. Héritage → selon stratégie (table_per_class, single_table, table_per_subclass)
 *   7. Entités associatives → table associative enrichie
 * 
 * Gestion spéciale :
 *   - Relations multiples entre 2 mêmes entités (ex: livraison/facturation)
 *     → FK nommées avec le rôle de la relation
 *   - Noms de FK propres : id_entity (pas entity_id_entity)
 */

import {
    McdModel,
    McdEntity,
    McdRelation,
    MldModel,
    MldTable,
    MldColumn,
    InheritanceStrategy,
    Cardinality,
} from '../models/types';

/**
 * Convertit un McdModel en MldModel.
 * @param mcd Le modèle conceptuel source
 * @param inheritanceStrategy Stratégie d'héritage par défaut (sauf si override dans le MCD)
 */
export function convertMcdToMld(
    mcd: McdModel,
    inheritanceStrategy: InheritanceStrategy = 'table_per_class'
): MldModel {
    const mld: MldModel = { tables: [] };
    const entityMap = new Map<string, McdEntity>();

    // Index des entités
    for (const entity of mcd.entities) {
        entityMap.set(entity.name, entity);
    }

    // Pré-calcul : détecter les relations multiples entre mêmes paires d'entités.
    // Cela dicte le nommage des FK (avec ou sans suffixe de rôle).
    const pairCount = buildPairCount(mcd.relations);

    // 1. Entités → Tables
    for (const entity of mcd.entities) {
        const table: MldTable = {
            name: entity.name,
            columns: entity.attributes
                .filter(a => !a.isDerived)
                .map(attr => ({
                    name: attr.name,
                    isPrimaryKey: attr.isPrimaryKey,
                })),
        };
        mld.tables.push(table);
    }

    // 2. Relations
    for (const rel of mcd.relations) {
        if (rel.participants.length === 2) {
            handleBinaryRelation(rel, mld, entityMap, pairCount);
        } else {
            handleNaryRelation(rel, mld, entityMap);
        }
    }

    // 3. Héritage
    for (const inh of mcd.inheritances) {
        const strategy = inh.strategy || inheritanceStrategy;
        handleInheritance(inh.parentEntity, inh.childEntities, strategy, mld, entityMap);
    }

    // 4. Entités associatives
    for (const assoc of mcd.associativeEntities) {
        const rel = mcd.relations.find(r => r.name === assoc.relationName);
        if (!rel) continue;

        let assocTable = mld.tables.find(t => t.name === rel.name || t.name === assoc.name);
        if (!assocTable) {
            assocTable = {
                name: assoc.name,
                columns: [],
            };
            for (const p of rel.participants) {
                const pk = getPrimaryKey(entityMap.get(p.entityName));
                if (pk) {
                    assocTable.columns.push({
                        name: pk,
                        isPrimaryKey: true,
                        foreignKey: {
                            columnName: pk,
                            referencedTable: p.entityName,
                            referencedColumn: pk,
                        },
                    });
                }
            }
            mld.tables.push(assocTable);
        }

        for (const attr of assoc.attributes) {
            if (!assocTable.columns.find(c => c.name === attr.name)) {
                assocTable.columns.push({
                    name: attr.name,
                    isPrimaryKey: attr.isPrimaryKey,
                });
            }
        }
    }

    return mld;
}

// ============================================================
// Détection des associations multiples
// ============================================================

/**
 * Construit un compteur de paires (entityA-entityB) pour les relations binaires.
 * Si une paire apparaît > 1 fois, les FK doivent être suffixées par le nom de rôle.
 */
function buildPairCount(relations: McdRelation[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const rel of relations) {
        if (rel.participants.length === 2) {
            const pair = makePairKey(rel.participants[0].entityName, rel.participants[1].entityName);
            counts.set(pair, (counts.get(pair) || 0) + 1);
        }
    }
    return counts;
}

/** Clé canonique pour une paire d'entités (ordre alphabétique) */
function makePairKey(a: string, b: string): string {
    return [a, b].sort().join('|');
}

/** Vérifie si une relation binaire fait partie d'un groupe de relations multiples */
function isMultipleRelation(rel: McdRelation, pairCount: Map<string, number>): boolean {
    if (rel.participants.length !== 2) return false;
    const pair = makePairKey(rel.participants[0].entityName, rel.participants[1].entityName);
    return (pairCount.get(pair) || 0) > 1;
}

// ============================================================
// Gestion des relations binaires
// ============================================================

function handleBinaryRelation(
    rel: McdRelation,
    mld: MldModel,
    entityMap: Map<string, McdEntity>,
    pairCount: Map<string, number>
): void {
    const p1 = rel.participants[0];
    const p2 = rel.participants[1];

    const isMany = (c: Cardinality) => c === '0,n' || c === '1,n';
    const isOne = (c: Cardinality) => c === '0,1' || c === '1,1';

    // Déterminer si on doit suffixer les FK (relations multiples entre mêmes entités)
    const needsRoleSuffix = isMultipleRelation(rel, pairCount);

    if (isOne(p1.cardinality) && isMany(p2.cardinality)) {
        // p1 est côté "un" → FK dans p1 vers p2
        addForeignKey(mld, p1.entityName, p2.entityName, entityMap, needsRoleSuffix ? rel.name : undefined);
        addRelationAttributes(mld, p1.entityName, rel);
    } else if (isMany(p1.cardinality) && isOne(p2.cardinality)) {
        // p2 est côté "un" → FK dans p2 vers p1
        addForeignKey(mld, p2.entityName, p1.entityName, entityMap, needsRoleSuffix ? rel.name : undefined);
        addRelationAttributes(mld, p2.entityName, rel);
    } else if (isOne(p1.cardinality) && isOne(p2.cardinality)) {
        if (p1.cardinality === '1,1') {
            addForeignKey(mld, p1.entityName, p2.entityName, entityMap, needsRoleSuffix ? rel.name : undefined);
            addRelationAttributes(mld, p1.entityName, rel);
        } else {
            addForeignKey(mld, p2.entityName, p1.entityName, entityMap, needsRoleSuffix ? rel.name : undefined);
            addRelationAttributes(mld, p2.entityName, rel);
        }
    } else {
        // n↔n → table associative
        createAssociativeTable(rel, mld, entityMap);
    }
}

// ============================================================
// Gestion des relations n-aires
// ============================================================

function handleNaryRelation(
    rel: McdRelation,
    mld: MldModel,
    entityMap: Map<string, McdEntity>
): void {
    createAssociativeTable(rel, mld, entityMap);
}

/**
 * Crée une table associative pour une relation n:n ou ternaire.
 * Nommage propre des FK : on utilise la PK de l'entité référencée directement,
 * sans préfixer par le nom de l'entité (sauf conflit).
 */
function createAssociativeTable(
    rel: McdRelation,
    mld: MldModel,
    entityMap: Map<string, McdEntity>
): void {
    const table: MldTable = {
        name: rel.name,
        columns: [],
    };

    // Détecter les conflits de noms de PK entre participants
    const pkNames = new Map<string, string[]>(); // pkName → [entityNames...]
    for (const p of rel.participants) {
        const pk = getPrimaryKey(entityMap.get(p.entityName));
        if (pk) {
            if (!pkNames.has(pk)) pkNames.set(pk, []);
            pkNames.get(pk)!.push(p.entityName);
        }
    }

    for (const p of rel.participants) {
        const pk = getPrimaryKey(entityMap.get(p.entityName));
        if (pk) {
            // Si plusieurs participants ont la même PK, préfixer pour désambiguïser
            const hasConflict = (pkNames.get(pk)?.length || 0) > 1;
            const fkColName = hasConflict
                ? `${pk}_${p.entityName.toLowerCase()}`
                : pk;

            table.columns.push({
                name: fkColName,
                isPrimaryKey: true,
                foreignKey: {
                    columnName: fkColName,
                    referencedTable: p.entityName,
                    referencedColumn: pk,
                },
            });
        }
    }

    // Attributs portés par la relation
    for (const attr of rel.attributes) {
        table.columns.push({
            name: attr.name,
            isPrimaryKey: false,
        });
    }

    mld.tables.push(table);
}

// ============================================================
// Héritage
// ============================================================

function handleInheritance(
    parentName: string,
    childNames: string[],
    strategy: InheritanceStrategy,
    mld: MldModel,
    entityMap: Map<string, McdEntity>
): void {
    const parentPk = getPrimaryKey(entityMap.get(parentName));
    if (!parentPk) return;

    switch (strategy) {
        case 'table_per_class': {
            for (const childName of childNames) {
                const childTable = mld.tables.find(t => t.name === childName);
                if (childTable) {
                    if (!childTable.columns.find(c => c.foreignKey?.referencedTable === parentName)) {
                        childTable.columns.unshift({
                            name: parentPk,
                            isPrimaryKey: true,
                            foreignKey: {
                                columnName: parentPk,
                                referencedTable: parentName,
                                referencedColumn: parentPk,
                            },
                        });
                        const existing = childTable.columns.filter(c => c.name === parentPk);
                        if (existing.length > 1) {
                            const idx = childTable.columns.findIndex(
                                c => c.name === parentPk && !c.foreignKey
                            );
                            if (idx >= 0) childTable.columns.splice(idx, 1);
                        }
                    }
                }
            }
            break;
        }

        case 'single_table': {
            const parentTable = mld.tables.find(t => t.name === parentName);
            if (!parentTable) break;

            if (!parentTable.columns.find(c => c.name === 'type_discriminator')) {
                parentTable.columns.push({
                    name: 'type_discriminator',
                    isPrimaryKey: false,
                });
            }

            for (const childName of childNames) {
                const childEntity = entityMap.get(childName);
                if (childEntity) {
                    for (const attr of childEntity.attributes) {
                        if (!attr.isPrimaryKey && !parentTable.columns.find(c => c.name === attr.name)) {
                            parentTable.columns.push({
                                name: attr.name,
                                isPrimaryKey: false,
                            });
                        }
                    }
                }
                const idx = mld.tables.findIndex(t => t.name === childName);
                if (idx >= 0) mld.tables.splice(idx, 1);
            }
            break;
        }

        case 'table_per_subclass': {
            const parentEntity = entityMap.get(parentName);
            if (!parentEntity) break;

            for (const childName of childNames) {
                const childTable = mld.tables.find(t => t.name === childName);
                if (childTable) {
                    for (const attr of parentEntity.attributes) {
                        if (!childTable.columns.find(c => c.name === attr.name)) {
                            childTable.columns.unshift({
                                name: attr.name,
                                isPrimaryKey: attr.isPrimaryKey,
                            });
                        }
                    }
                }
            }

            const idx = mld.tables.findIndex(t => t.name === parentName);
            if (idx >= 0) mld.tables.splice(idx, 1);
            break;
        }
    }
}

// ============================================================
// Utilitaires
// ============================================================

/** Retourne le nom de la première colonne PK d'une entité */
function getPrimaryKey(entity?: McdEntity): string | null {
    if (!entity) return null;
    const pk = entity.attributes.find(a => a.isPrimaryKey);
    return pk ? pk.name : null;
}

/**
 * Ajoute une FK dans la table source vers la table cible.
 * @param roleName Si fourni, suffixe le nom de la FK pour distinguer les relations multiples.
 *                 Ex: id_adresse_livraison au lieu de id_adresse.
 */
function addForeignKey(
    mld: MldModel,
    sourceTableName: string,
    targetTableName: string,
    entityMap: Map<string, McdEntity>,
    roleName?: string,
): void {
    const sourceTable = mld.tables.find(t => t.name === sourceTableName);
    const targetEntity = entityMap.get(targetTableName);
    if (!sourceTable || !targetEntity) return;

    const targetPk = getPrimaryKey(targetEntity);
    if (!targetPk) return;

    // Nommage de la colonne FK :
    //  - Sans rôle : id_adresse (= la PK cible directement)
    //  - Avec rôle : id_adresse_livraison (PK cible + suffixe rôle)
    const fkColName = roleName
        ? `${targetPk}_${roleName}`
        : targetPk;

    // Vérifier qu'on ne crée pas un doublon exact
    if (sourceTable.columns.find(c => c.name === fkColName)) return;

    sourceTable.columns.push({
        name: fkColName,
        isPrimaryKey: false,
        foreignKey: {
            columnName: fkColName,
            referencedTable: targetTableName,
            referencedColumn: targetPk,
        },
    });
}

/** Ajoute les attributs d'une relation à une table */
function addRelationAttributes(mld: MldModel, tableName: string, rel: McdRelation): void {
    const table = mld.tables.find(t => t.name === tableName);
    if (!table) return;

    for (const attr of rel.attributes) {
        if (!table.columns.find(c => c.name === attr.name)) {
            table.columns.push({
                name: attr.name,
                isPrimaryKey: false,
            });
        }
    }
}
