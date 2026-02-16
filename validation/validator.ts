/**
 * validation/validator.ts
 * 
 * Validation des modèles Merise :
 *   - Cardinalités bien formées
 *   - Entités orphelines
 *   - Détection de cycles dans les FK
 *   - Vérification des références FK
 *   - PK manquantes
 */

import { McdModel, MldModel, MpdModel } from '../models/types';

export interface ValidationMessage {
    level: 'error' | 'warning' | 'info';
    message: string;
}

/**
 * Valide un modèle MCD.
 */
export function validateMcd(model: McdModel): ValidationMessage[] {
    const messages: ValidationMessage[] = [];

    // Vérifier que chaque entité a un PK
    for (const entity of model.entities) {
        const hasPK = entity.attributes.some(a => a.isPrimaryKey);
        if (!hasPK) {
            messages.push({
                level: 'error',
                message: `Entité "${entity.name}" : aucun identifiant [PK] défini.`,
            });
        }
    }

    // Vérifier les entités orphelines
    const usedEntities = new Set<string>();
    for (const rel of model.relations) {
        for (const p of rel.participants) {
            usedEntities.add(p.entityName);
        }
    }
    for (const inh of model.inheritances) {
        usedEntities.add(inh.parentEntity);
        inh.childEntities.forEach(c => usedEntities.add(c));
    }
    for (const entity of model.entities) {
        if (!usedEntities.has(entity.name)) {
            messages.push({
                level: 'warning',
                message: `Entité orpheline : "${entity.name}" n'apparaît dans aucune relation.`,
            });
        }
    }

    // Vérifier que les entités référencées dans les relations existent
    const entityNames = new Set(model.entities.map(e => e.name));
    for (const rel of model.relations) {
        for (const p of rel.participants) {
            if (!entityNames.has(p.entityName)) {
                messages.push({
                    level: 'error',
                    message: `Relation "${rel.name}" : entité "${p.entityName}" non définie.`,
                });
            }
        }
    }

    // Vérifier les héritages
    for (const inh of model.inheritances) {
        if (!entityNames.has(inh.parentEntity)) {
            messages.push({
                level: 'error',
                message: `Héritage "${inh.name}" : entité parent "${inh.parentEntity}" non définie.`,
            });
        }
        for (const child of inh.childEntities) {
            if (!entityNames.has(child)) {
                messages.push({
                    level: 'error',
                    message: `Héritage "${inh.name}" : entité enfant "${child}" non définie.`,
                });
            }
        }
    }

    // Relations avec moins de 2 participants
    for (const rel of model.relations) {
        if (rel.participants.length < 2) {
            messages.push({
                level: 'error',
                message: `Relation "${rel.name}" : doit avoir au moins 2 participants.`,
            });
        }
    }

    return messages;
}

/**
 * Valide un modèle MLD.
 */
export function validateMld(model: MldModel): ValidationMessage[] {
    const messages: ValidationMessage[] = [];
    const tableNames = new Set(model.tables.map(t => t.name));

    for (const table of model.tables) {
        // PK manquante
        const hasPK = table.columns.some(c => c.isPrimaryKey);
        if (!hasPK) {
            messages.push({
                level: 'warning',
                message: `Table "${table.name}" : aucune clé primaire définie.`,
            });
        }

        // FK vers table inexistante
        for (const col of table.columns) {
            if (col.foreignKey && !tableNames.has(col.foreignKey.referencedTable)) {
                messages.push({
                    level: 'error',
                    message: `Table "${table.name}", colonne "${col.name}" : FK vers table inexistante "${col.foreignKey.referencedTable}".`,
                });
            }
        }
    }

    // Détection de cycles dans les FK
    const cycles = detectCycles(model);
    for (const cycle of cycles) {
        messages.push({
            level: 'warning',
            message: `Cycle de références FK détecté : ${cycle.join(' → ')}.`,
        });
    }

    return messages;
}

/**
 * Valide un modèle MPD.
 */
export function validateMpd(model: MpdModel): ValidationMessage[] {
    const messages: ValidationMessage[] = [];
    const tableNames = new Set(model.tables.map(t => t.name));

    for (const table of model.tables) {
        for (const col of table.columns) {
            if (col.foreignKey && !tableNames.has(col.foreignKey.referencedTable)) {
                messages.push({
                    level: 'error',
                    message: `Table "${table.name}", colonne "${col.name}" : FK vers table inexistante "${col.foreignKey.referencedTable}".`,
                });
            }
        }
    }

    return messages;
}

/**
 * Détecte les cycles dans les FK d'un modèle MLD (DFS).
 */
function detectCycles(model: MldModel): string[][] {
    const adj = new Map<string, string[]>();

    for (const table of model.tables) {
        if (!adj.has(table.name)) adj.set(table.name, []);
        for (const col of table.columns) {
            if (col.foreignKey) {
                adj.get(table.name)!.push(col.foreignKey.referencedTable);
            }
        }
    }

    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): void {
        visited.add(node);
        inStack.add(node);
        path.push(node);

        const neighbors = adj.get(node) || [];
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                dfs(neighbor);
            } else if (inStack.has(neighbor)) {
                // Cycle trouvé
                const cycleStart = path.indexOf(neighbor);
                if (cycleStart >= 0) {
                    cycles.push([...path.slice(cycleStart), neighbor]);
                }
            }
        }

        path.pop();
        inStack.delete(node);
    }

    for (const table of model.tables) {
        if (!visited.has(table.name)) {
            dfs(table.name);
        }
    }

    return cycles;
}
