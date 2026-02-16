/**
 * parser/mpdParser.ts
 * 
 * Parser pour les blocs `merise-mpd`.
 * Syntaxe supportée :
 *   TABLE NomTable {
 *       col_name TYPE [PK] [NOT NULL] [UNIQUE] [CHECK(expression)]
 *       col_name TYPE [FK -> Table.col ON DELETE CASCADE ON UPDATE SET NULL]
 *   }
 */

import {
    MpdModel,
    MpdTable,
    MpdColumn,
    MpdConstraint,
    MpdForeignKey,
    ReferentialAction,
} from '../models/types';

export interface MpdParseResult {
    model: MpdModel;
    errors: string[];
}

/**
 * Parse un bloc de texte merise-mpd et retourne le modèle MPD.
 */
export function parseMpd(source: string): MpdParseResult {
    const errors: string[] = [];
    const model: MpdModel = { tables: [] };

    const lines = source.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();

        const tableMatch = line.match(/^TABLE\s+(\w+)\s*\{?\s*$/i);
        if (tableMatch) {
            const table: MpdTable = {
                name: tableMatch[1],
                columns: [],
            };

            i++;
            while (i < lines.length) {
                const colLine = lines[i].trim();
                if (colLine === '}' || colLine.startsWith('}')) {
                    i++;
                    break;
                }
                if (colLine === '') { i++; continue; }

                const col = parseMpdColumn(colLine, errors, table.name);
                if (col) {
                    table.columns.push(col);
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
 * Parse une colonne MPD complète.
 * Exemple : id_client INT [PK] [NOT NULL]
 *           id_cmd INT [FK -> COMMANDE.id_commande ON DELETE CASCADE]
 */
function parseMpdColumn(line: string, errors: string[], tableName: string): MpdColumn | null {
    const cleaned = line.replace(/,\s*$/, '').trim();

    // Match : nom  TYPE  [reste des flags]
    const baseMatch = cleaned.match(/^(\w+)\s+(\w+(?:\(\d+(?:,\d+)?\))?)\s*(.*)?$/);
    if (!baseMatch) {
        errors.push(`Colonne MPD invalide dans "${tableName}" : "${cleaned}".`);
        return null;
    }

    const name = baseMatch[1];
    const sqlType = baseMatch[2];
    const flagString = baseMatch[3] || '';

    const isPrimaryKey = /\[PK\]/i.test(flagString);
    const constraints: MpdConstraint[] = [];

    // NOT NULL
    if (/\[NOT\s*NULL\]/i.test(flagString)) {
        constraints.push({ type: 'NOT NULL' });
    }

    // UNIQUE
    if (/\[UNIQUE\]/i.test(flagString)) {
        constraints.push({ type: 'UNIQUE' });
    }

    // CHECK(expression)
    const checkMatch = flagString.match(/\[CHECK\(([^)]+)\)\]/i);
    if (checkMatch) {
        constraints.push({ type: 'CHECK', expression: checkMatch[1] });
    }

    // FK : [FK -> Table.col ON DELETE action ON UPDATE action]
    let foreignKey: MpdForeignKey | undefined;
    const fkMatch = flagString.match(
        /\[FK\s*->\s*(\w+)\.(\w+)(?:\s+ON\s+DELETE\s+(\w+(?:\s+\w+)?))?(?:\s+ON\s+UPDATE\s+(\w+(?:\s+\w+)?))?\]/i
    );
    if (fkMatch) {
        foreignKey = {
            columnName: name,
            referencedTable: fkMatch[1],
            referencedColumn: fkMatch[2],
            onDelete: parseReferentialAction(fkMatch[3]),
            onUpdate: parseReferentialAction(fkMatch[4]),
        };
    }

    return {
        name,
        sqlType,
        isPrimaryKey,
        foreignKey,
        constraints,
    };
}

function parseReferentialAction(value?: string): ReferentialAction | undefined {
    if (!value) return undefined;
    const upper = value.toUpperCase().trim();
    const valid: ReferentialAction[] = ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'];
    return valid.find(v => v === upper);
}
