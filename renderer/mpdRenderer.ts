/**
 * renderer/mpdRenderer.ts
 * 
 * Convertit un MpdModel en diagramme Mermaid erDiagram.
 * - Tables avec types SQL visibles (affiché comme type Mermaid)
 * - Contraintes annotées (PK, FK, NN, UQ, CHK)
 * - FK → relations entre tables
 */

import { MpdModel } from '../models/types';

/**
 * Génère le code Mermaid erDiagram à partir d'un MpdModel.
 */
export function renderMpdToMermaid(model: MpdModel): string {
    const lines: string[] = [
        '%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#f3e5f5", "primaryBorderColor": "#7b1fa2", "primaryTextColor": "#4a148c", "lineColor": "#6a1b9a", "edgeLabelBackground": "#ffffff"}, "er": {"layoutDirection": "TB", "useMaxWidth": false, "entityPadding": 15, "fontSize": 13}}}%%',
        'erDiagram',
    ];

    for (const table of model.tables) {
        lines.push(`    ${table.name} {`);
        for (const col of table.columns) {
            const annotations: string[] = [];
            if (col.isPrimaryKey) annotations.push('PK');
            if (col.foreignKey) annotations.push('FK');
            for (const c of col.constraints) {
                if (c.type === 'NOT NULL' && !col.isPrimaryKey) annotations.push('NN');
                if (c.type === 'UNIQUE') annotations.push('UQ');
                if (c.type === 'CHECK') annotations.push('CHK');
            }
            const annoStr = annotations.length > 0 ? ` "${annotations.join(', ')}"` : '';
            // Sanitiser le type SQL pour Mermaid erDiagram:
            //   - DECIMAL(10,2) → DECIMAL_10-2  (parenthèses ET virgules interdites)
            //   - VARCHAR(255)  → VARCHAR_255
            const safeType = col.sqlType
                .replace(/\(/g, '_')
                .replace(/\)/g, '')
                .replace(/,/g, '-');
            lines.push(`        ${safeType} ${col.name}${annoStr}`);
        }
        lines.push('    }');
    }

    // Relations FK — chaque FK produit un lien distinct
    const drawnRelations = new Set<string>();
    for (const table of model.tables) {
        for (const col of table.columns) {
            if (col.foreignKey) {
                const fk = col.foreignKey;
                const relKey = `${table.name}.${col.name}->${fk.referencedTable}.${fk.referencedColumn}`;
                if (!drawnRelations.has(relKey)) {
                    drawnRelations.add(relKey);
                    const notation = col.isPrimaryKey ? '}|' : '}o';
                    lines.push(
                        `    ${fk.referencedTable} ||--${notation} ${table.name} : "${col.name}"`
                    );
                }
            }
        }
    }

    return lines.join('\n');
}
