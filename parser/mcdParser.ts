/**
 * parser/mcdParser.ts
 * 
 * Parser pour les blocs `merise-mcd`.
 * 
 * Syntaxe supportée (multi-ligne OU single-ligne) :
 *   ENTITY NomEntite { attribut1 [PK], attribut2, attribut3 [DERIVED] }
 *   RELATION nomRelation { Entite1 (min,max), Entite2 (min,max), attribut }
 *   INHERITANCE nom { PARENT Entite  CHILDREN Ent1, Ent2  [STRATEGY strat] }
 *   ASSOCIATIVE nom ON relation { attribut1, attribut2 }
 * 
 * Les éléments d'un bloc peuvent être :
 *   - Un par ligne (séparé par des retours à la ligne)
 *   - Comma-separated sur la même ligne (ex: COMMANDE (1,1), ADRESSE (0,n))
 *   - Mélange des deux
 */

import {
    McdModel,
    McdEntity,
    McdAttribute,
    McdRelation,
    McdRelationParticipant,
    McdInheritance,
    McdAssociativeEntity,
    Cardinality,
    InheritanceStrategy,
} from '../models/types';

/** Résultat de parsing avec erreurs éventuelles */
export interface ParseResult {
    model: McdModel;
    errors: string[];
    warnings: string[];
}

/**
 * Parse un bloc de texte merise-mcd et retourne le modèle MCD.
 */
export function parseMcd(source: string): ParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const model: McdModel = {
        entities: [],
        relations: [],
        inheritances: [],
        associativeEntities: [],
    };

    // Extraction de tous les blocs de premier niveau
    const blocks = extractBlocks(source);

    for (const block of blocks) {
        const keyword = block.keyword.toUpperCase();

        switch (keyword) {
            case 'ENTITY':
                parseEntityBlock(block, model, errors);
                break;
            case 'RELATION':
                parseRelationBlock(block, model, errors);
                break;
            case 'INHERITANCE':
                parseInheritanceBlock(block, model, errors);
                break;
            case 'ASSOCIATIVE':
                parseAssociativeBlock(block, model, errors);
                break;
            default:
                errors.push(`Mot-clé inconnu : "${block.keyword}"`);
        }
    }

    // Validation : entités orphelines
    const usedEntities = new Set<string>();
    for (const rel of model.relations) {
        for (const p of rel.participants) {
            usedEntities.add(p.entityName);
        }
    }
    for (const inh of model.inheritances) {
        usedEntities.add(inh.parentEntity);
        for (const child of inh.childEntities) {
            usedEntities.add(child);
        }
    }
    for (const entity of model.entities) {
        if (!usedEntities.has(entity.name)) {
            warnings.push(`Entité orpheline détectée : "${entity.name}" n'apparaît dans aucune relation.`);
        }
    }

    return { model, errors, warnings };
}

// ============================================================
// Extraction des blocs
// ============================================================

interface RawBlock {
    keyword: string;
    name: string;
    extra: string; // tout ce qui est entre le nom et le '{'
    body: string;  // contenu entre { ... }
}

/**
 * Extrait les blocs de premier niveau du type :
 *   KEYWORD name [extra] { body }
 */
function extractBlocks(source: string): RawBlock[] {
    const blocks: RawBlock[] = [];
    const lines = source.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line || line.startsWith('//') || line.startsWith('#')) {
            i++;
            continue;
        }

        // Cherche une ligne d'ouverture de bloc : KEYWORD name [extra] {
        const headerMatch = line.match(
            /^(\w+)\s+(\w+)\s*(.*?)\s*\{?\s*$/
        );
        if (!headerMatch) {
            i++;
            continue;
        }

        const keyword = headerMatch[1];
        const name = headerMatch[2];
        let extra = headerMatch[3] || '';

        // Si l'ouverture '{' est sur la même ligne...
        let body = '';
        if (line.includes('{')) {
            // Tout après le '{' sur cette ligne
            const afterBrace = line.substring(line.indexOf('{') + 1).trim();
            if (afterBrace.endsWith('}')) {
                // Bloc sur une seule ligne
                body = afterBrace.slice(0, -1).trim();
                blocks.push({ keyword, name, extra, body });
                i++;
                continue;
            }
            body = afterBrace ? afterBrace + '\n' : '';
            i++;
            // Collecte jusqu'à l'accolade fermante
            let depth = 1;
            while (i < lines.length && depth > 0) {
                const l = lines[i];
                for (const ch of l) {
                    if (ch === '{') depth++;
                    if (ch === '}') depth--;
                    if (depth === 0) break;
                }
                if (depth > 0) {
                    body += l + '\n';
                } else {
                    // Ajouter ce qui est avant le '}' fermant
                    const closingIdx = l.indexOf('}');
                    body += l.substring(0, closingIdx) + '\n';
                }
                i++;
            }
        } else {
            // Le '{' est sur la ligne suivante
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('{')) {
                i++;
            }
            if (i < lines.length) {
                i++; // Skip la ligne avec '{'
                let depth = 1;
                while (i < lines.length && depth > 0) {
                    const l = lines[i];
                    for (const ch of l) {
                        if (ch === '{') depth++;
                        if (ch === '}') depth--;
                        if (depth === 0) break;
                    }
                    if (depth > 0) {
                        body += l + '\n';
                    } else {
                        const closingIdx = l.indexOf('}');
                        body += l.substring(0, closingIdx) + '\n';
                    }
                    i++;
                }
            }
        }

        blocks.push({ keyword, name, extra: extra.replace('{', '').trim(), body: body.trim() });
    }

    return blocks;
}

// ============================================================
// Splitter intelligent : sépare les éléments par virgule
// en ignorant les virgules à l'intérieur des parenthèses.
// ============================================================

/**
 * Sépare une chaîne par les virgules qui ne sont PAS à l'intérieur de parenthèses.
 * Exemples :
 *   "COMMANDE (1,1), ADRESSE (0,n)" → ["COMMANDE (1,1)", "ADRESSE (0,n)"]
 *   "COMMANDE (1,n), ARTICLE (0,n), quantite" → ["COMMANDE (1,n)", "ARTICLE (0,n)", "quantite"]
 *   "id_commande [PK]" → ["id_commande [PK]"]
 */
function splitOutsideParens(text: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const ch of text) {
        if (ch === '(' || ch === '[') {
            depth++;
            current += ch;
        } else if (ch === ')' || ch === ']') {
            depth--;
            current += ch;
        } else if (ch === ',' && depth === 0) {
            const trimmed = current.trim();
            if (trimmed) parts.push(trimmed);
            current = '';
        } else {
            current += ch;
        }
    }

    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);

    return parts;
}

/**
 * Normalise le body d'un bloc en une liste d'éléments individuels.
 * Gère à la fois les éléments sur des lignes séparées ET comma-separated sur la même ligne.
 */
function normalizeBodyItems(body: string): string[] {
    const items: string[] = [];
    const lines = body.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Séparer par virgules en dehors des parenthèses
        const parts = splitOutsideParens(trimmed);
        for (const part of parts) {
            // Nettoyer les virgules traînantes éventuelles
            const cleaned = part.replace(/,\s*$/, '').trim();
            if (cleaned) items.push(cleaned);
        }
    }

    return items;
}

// ============================================================
// Parsing d'une entité
// ============================================================

function parseEntityBlock(block: RawBlock, model: McdModel, errors: string[]): void {
    const entity: McdEntity = {
        name: block.name,
        attributes: [],
    };

    const items = normalizeBodyItems(block.body);
    for (const item of items) {
        const attr = parseAttribute(item);
        if (attr) {
            entity.attributes.push(attr);
        }
    }

    if (entity.attributes.filter(a => a.isPrimaryKey).length === 0) {
        errors.push(`Entité "${entity.name}" n'a pas d'identifiant [PK].`);
    }

    model.entities.push(entity);
}

/**
 * Parse un attribut : "nom_attribut [PK]" ou "nom_attribut [DERIVED]" ou "nom_attribut"
 */
function parseAttribute(text: string): McdAttribute | null {
    const match = text.match(/^(\w+)\s*(\[.*\])?\s*$/);
    if (!match) return null;

    const name = match[1];
    const flags = match[2] || '';

    return {
        name,
        isPrimaryKey: flags.includes('PK'),
        isDerived: flags.includes('DERIVED'),
    };
}

// ============================================================
// Parsing d'une relation
// ============================================================

function parseRelationBlock(block: RawBlock, model: McdModel, errors: string[]): void {
    const relation: McdRelation = {
        name: block.name,
        participants: [],
        attributes: [],
    };

    const items = normalizeBodyItems(block.body);
    for (const item of items) {
        // Tente de parser comme participant : ENTITY (min,max)
        const participantMatch = item.match(/^(\w+)\s*\(\s*([\d],[n\d])\s*\)$/);
        if (participantMatch) {
            const entityName = participantMatch[1];
            const cardinality = participantMatch[2] as Cardinality;

            if (!isValidCardinality(cardinality)) {
                errors.push(
                    `Cardinalité invalide "${cardinality}" pour l'entité "${entityName}" dans la relation "${block.name}".`
                );
                continue;
            }

            relation.participants.push({ entityName, cardinality });
            continue;
        }

        // Sinon c'est un attribut de la relation
        const attr = parseAttribute(item);
        if (attr) {
            relation.attributes.push(attr);
        }
    }

    if (relation.participants.length < 2) {
        errors.push(
            `La relation "${block.name}" doit avoir au moins 2 participants (trouvé: ${relation.participants.length}).`
        );
    }

    model.relations.push(relation);
}

/** Vérifie qu'une cardinalité est valide */
function isValidCardinality(c: string): c is Cardinality {
    return ['0,1', '1,1', '0,n', '1,n'].includes(c);
}

// ============================================================
// Parsing d'un héritage
// ============================================================

function parseInheritanceBlock(block: RawBlock, model: McdModel, errors: string[]): void {
    const inheritance: McdInheritance = {
        name: block.name,
        parentEntity: '',
        childEntities: [],
    };

    const lines = block.body.split('\n');
    for (const line of lines) {
        const trimmed = line.trim().replace(/,\s*$/, '');
        if (!trimmed) continue;

        // PARENT EntityName
        const parentMatch = trimmed.match(/^PARENT\s+(\w+)$/i);
        if (parentMatch) {
            inheritance.parentEntity = parentMatch[1];
            continue;
        }

        // CHILDREN Entity1, Entity2, ...
        const childrenMatch = trimmed.match(/^CHILDREN\s+(.+)$/i);
        if (childrenMatch) {
            inheritance.childEntities = childrenMatch[1]
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            continue;
        }

        // STRATEGY strategy_name
        const strategyMatch = trimmed.match(/^STRATEGY\s+(\w+)$/i);
        if (strategyMatch) {
            const strat = strategyMatch[1] as InheritanceStrategy;
            if (['table_per_class', 'single_table', 'table_per_subclass'].includes(strat)) {
                inheritance.strategy = strat;
            } else {
                errors.push(`Stratégie d'héritage inconnue : "${strat}".`);
            }
            continue;
        }
    }

    if (!inheritance.parentEntity) {
        errors.push(`Héritage "${block.name}" : PARENT non défini.`);
    }
    if (inheritance.childEntities.length === 0) {
        errors.push(`Héritage "${block.name}" : aucun CHILDREN défini.`);
    }

    model.inheritances.push(inheritance);
}

// ============================================================
// Parsing d'une entité associative
// ============================================================

function parseAssociativeBlock(block: RawBlock, model: McdModel, errors: string[]): void {
    // ASSOCIATIVE nom ON relation { ... }
    const onMatch = block.extra.match(/^ON\s+(\w+)$/i);
    if (!onMatch) {
        errors.push(`Entité associative "${block.name}" : mot-clé ON manquant (syntaxe: ASSOCIATIVE nom ON relation { ... }).`);
        return;
    }

    const assocEntity: McdAssociativeEntity = {
        name: block.name,
        relationName: onMatch[1],
        attributes: [],
    };

    const items = normalizeBodyItems(block.body);
    for (const item of items) {
        const attr = parseAttribute(item);
        if (attr) {
            assocEntity.attributes.push(attr);
        }
    }

    model.associativeEntities.push(assocEntity);
}
