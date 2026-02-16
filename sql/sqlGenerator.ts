/**
 * sql/sqlGenerator.ts
 * 
 * Génération de SQL DDL à partir d'un MpdModel.
 * Supporte MySQL et PostgreSQL.
 * Gère : CREATE TABLE, PK (simples + composées), FK avec actions référentielles,
 *        NOT NULL, UNIQUE, CHECK, index.
 */

import { MpdModel, MpdTable, MpdColumn, SqlDialect } from '../models/types';

/**
 * Génère le script SQL DDL complet à partir d'un MpdModel.
 */
export function generateSql(model: MpdModel, dialect: SqlDialect = 'mysql'): string {
    const statements: string[] = [];

    // Header
    statements.push(`-- ============================================`);
    statements.push(`-- Script SQL généré par le plugin Merise`);
    statements.push(`-- Dialecte : ${dialect.toUpperCase()}`);
    statements.push(`-- ============================================`);
    statements.push('');

    // Ordre de création : tables sans FK d'abord, puis celles avec FK
    const sorted = topologicalSort(model.tables);

    for (const table of sorted) {
        statements.push(generateCreateTable(table, dialect));
        statements.push('');
    }

    return statements.join('\n');
}

/**
 * Génère le CREATE TABLE pour une table.
 */
function generateCreateTable(table: MpdTable, dialect: SqlDialect): string {
    const q = dialect === 'postgresql' ? '"' : '`';
    const lines: string[] = [];

    lines.push(`CREATE TABLE ${q}${table.name}${q} (`);

    const colDefs: string[] = [];
    const pkColumns: string[] = [];
    const fkDefs: string[] = [];

    for (const col of table.columns) {
        let def = `    ${q}${col.name}${q} ${formatSqlType(col.sqlType, dialect)}`;

        // Contraintes inline
        for (const constraint of col.constraints) {
            switch (constraint.type) {
                case 'NOT NULL':
                    def += ' NOT NULL';
                    break;
                case 'UNIQUE':
                    def += ' UNIQUE';
                    break;
                case 'CHECK':
                    if (constraint.expression) {
                        def += ` CHECK (${constraint.expression})`;
                    }
                    break;
            }
        }

        // AUTO_INCREMENT / SERIAL est déjà dans le type pour PG
        if (col.isPrimaryKey && dialect === 'mysql' && col.sqlType === 'INT' &&
            (col.name.toLowerCase().startsWith('id') || col.name.toLowerCase().endsWith('id')) &&
            !col.foreignKey) {
            def += ' AUTO_INCREMENT';
        }

        colDefs.push(def);

        if (col.isPrimaryKey) {
            pkColumns.push(`${q}${col.name}${q}`);
        }

        // FK
        if (col.foreignKey) {
            const fk = col.foreignKey;
            let fkDef = `    FOREIGN KEY (${q}${fk.columnName}${q}) REFERENCES ${q}${fk.referencedTable}${q}(${q}${fk.referencedColumn}${q})`;
            if (fk.onDelete) fkDef += ` ON DELETE ${fk.onDelete}`;
            if (fk.onUpdate) fkDef += ` ON UPDATE ${fk.onUpdate}`;
            fkDefs.push(fkDef);
        }
    }

    // Assemblage
    const allParts = [...colDefs];

    // PRIMARY KEY
    if (pkColumns.length > 0) {
        allParts.push(`    PRIMARY KEY (${pkColumns.join(', ')})`);
    }

    // FOREIGN KEYs
    allParts.push(...fkDefs);

    lines.push(allParts.join(',\n'));
    lines.push(');');

    return lines.join('\n');
}

/**
 * Formate un type SQL selon le dialecte.
 */
function formatSqlType(sqlType: string, dialect: SqlDialect): string {
    if (dialect === 'postgresql') {
        // Remplacements PostgreSQL
        if (sqlType === 'DATETIME') return 'TIMESTAMP';
        if (sqlType === 'DOUBLE') return 'DOUBLE PRECISION';
    }
    if (dialect === 'mysql') {
        if (sqlType === 'SERIAL') return 'INT';
        if (sqlType === 'BOOLEAN') return 'TINYINT(1)';
    }
    return sqlType;
}

/**
 * Tri topologique des tables : les tables référencées (par FK) sont placées avant
 * les tables qui les référencent, pour éviter les erreurs de FK lors de la création.
 */
function topologicalSort(tables: MpdTable[]): MpdTable[] {
    const tableMap = new Map<string, MpdTable>();
    const deps = new Map<string, Set<string>>();

    for (const t of tables) {
        tableMap.set(t.name, t);
        deps.set(t.name, new Set());
    }

    // Construire le graphe de dépendances
    for (const t of tables) {
        for (const col of t.columns) {
            if (col.foreignKey) {
                const ref = col.foreignKey.referencedTable;
                if (ref !== t.name && tableMap.has(ref)) {
                    deps.get(t.name)!.add(ref);
                }
            }
        }
    }

    // Tri topologique (Kahn's algorithm)
    const sorted: MpdTable[] = [];
    const visited = new Set<string>();
    const remaining = new Set(tableMap.keys());

    while (remaining.size > 0) {
        // Trouver les tables sans dépendances non résolues
        const ready: string[] = [];
        for (const name of remaining) {
            const d = deps.get(name)!;
            const unresolved = [...d].filter(x => !visited.has(x));
            if (unresolved.length === 0) {
                ready.push(name);
            }
        }

        if (ready.length === 0) {
            // Cycle détecté — ajouter les restantes dans l'ordre
            for (const name of remaining) {
                sorted.push(tableMap.get(name)!);
            }
            break;
        }

        for (const name of ready) {
            sorted.push(tableMap.get(name)!);
            visited.add(name);
            remaining.delete(name);
        }
    }

    return sorted;
}
