/**
 * parser/mldParser.ts
 * 
 * Parser pour les blocs `merise-mld`.
 * Syntaxe supportée :
 *   TABLE NomTable {
 *       colonne [PK]
 *       colonne [FK -> Table.colonne]
 *       colonne
 *   }
 */

import { MldModel, MldTable, MldColumn, MldForeignKey } from '../models/types';

export interface MldParseResult {
    model: MldModel;
    errors: string[];
}

/**
 * Parse un bloc de texte merise-mld et retourne le modèle MLD.
 */
export function parseMld(source: string): MldParseResult {
    const errors: string[] = [];
    const model: MldModel = { tables: [] };

    const lines = source.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();

        // Cherche : TABLE NomTable {
        const tableMatch = line.match(/^TABLE\s+(\w+)\s*\{?\s*$/i);
        if (tableMatch) {
            const table: MldTable = {
                name: tableMatch[1],
                columns: [],
            };

            i++;
            // Lecture des colonnes jusqu'à '}'
            while (i < lines.length) {
                const colLine = lines[i].trim();
                if (colLine === '}' || colLine === '') {
                    if (colLine === '}') { i++; break; }
                    i++;
                    continue;
                }

                const col = parseMldColumn(colLine);
                if (col) {
                    table.columns.push(col);
                } else {
                    // Vérifier si c'est la fermeture
                    if (colLine.includes('}')) { i++; break; }
                    errors.push(`Colonne MLD invalide : "${colLine}" dans la table "${table.name}".`);
                }
                i++;
            }

            model.tables.push(table);
            continue;
        }

        i++;
    }

    return { model, errors };
}

/**
 * Parse une ligne de colonne MLD.
 * Formats supportés :
 *   col_name [PK]
 *   col_name [FK -> Table.col]
 *   col_name [PK] [FK -> Table.col]
 *   col_name
 */
function parseMldColumn(line: string): MldColumn | null {
    // Nettoyage de la virgule de fin
    const cleaned = line.replace(/,\s*$/, '').trim();

    // Extraction du nom et des flags
    const nameMatch = cleaned.match(/^(\w+)\s*(.*)?$/);
    if (!nameMatch) return null;

    const name = nameMatch[1];
    const flags = nameMatch[2] || '';

    const isPrimaryKey = /\[PK\]/i.test(flags);

    // Extraction de la FK : [FK -> Table.col]
    let foreignKey: MldForeignKey | undefined;
    const fkMatch = flags.match(/\[FK\s*->\s*(\w+)\.(\w+)\]/i);
    if (fkMatch) {
        foreignKey = {
            columnName: name,
            referencedTable: fkMatch[1],
            referencedColumn: fkMatch[2],
        };
    }

    return {
        name,
        isPrimaryKey,
        foreignKey,
    };
}
