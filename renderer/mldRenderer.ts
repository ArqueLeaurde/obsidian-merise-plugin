/**
 * renderer/mldRenderer.ts
 * 
 * Convertit un MldModel en diagramme Mermaid erDiagram.
 * - Tables → blocs avec colonnes typées (PK, FK)
 * - FK → relations entre tables (chaque FK = un lien distinct)
 */

import { MldModel } from '../models/types';

/**
 * Génère le code Mermaid erDiagram à partir d'un MldModel.
 */
export function renderMldToMermaid(model: MldModel): string {
    const lines: string[] = [
        '%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#e3f2fd", "primaryBorderColor": "#1565c0", "lineColor": "#555555", "edgeLabelBackground": "#ffffff"}, "er": {"layoutDirection": "TB", "useMaxWidth": false, "entityPadding": 15, "fontSize": 13}}}%%',
        'erDiagram',
    ];

    // Tables et colonnes
    for (const table of model.tables) {
        lines.push(`    ${table.name} {`);
        for (const col of table.columns) {
            const annotations: string[] = [];
            if (col.isPrimaryKey) annotations.push('PK');
            if (col.foreignKey) annotations.push('FK');
            const annoStr = annotations.length > 0 ? ` "${annotations.join(', ')}"` : '';
            const typeStr = col.isPrimaryKey ? 'id' : (col.foreignKey ? 'ref' : 'string');
            lines.push(`        ${typeStr} ${col.name}${annoStr}`);
        }
        lines.push('    }');
    }

    // Relations issues des FK — chaque FK donne un lien distinct
    // Dédupliqué par colonne FK (pas par paire de tables) pour gérer les FK multiples
    const drawnRelations = new Set<string>();
    for (const table of model.tables) {
        for (const col of table.columns) {
            if (col.foreignKey) {
                const relKey = `${table.name}.${col.name}->${col.foreignKey.referencedTable}.${col.foreignKey.referencedColumn}`;
                if (!drawnRelations.has(relKey)) {
                    drawnRelations.add(relKey);
                    // Déterminer la notation : PK+FK dans table de jointure = }| (many-mandatory)
                    const notation = col.isPrimaryKey ? '}|' : '}o';
                    lines.push(
                        `    ${col.foreignKey.referencedTable} ||--${notation} ${table.name} : "${col.name}"`
                    );
                }
            }
        }
    }

    return lines.join('\n');
}

