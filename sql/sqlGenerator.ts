/**
 * sql/sqlGenerator.ts
 * 
 * Génération de SQL DDL à partir d'un MpdModel.
 * Supporte MariaDB (défaut, 100% compatible MySQL 8.0+), MySQL et PostgreSQL.
 * 
 * MariaDB/MySQL :
 *   - Backticks ` pour tous les identifiants (protection mots réservés)
 *   - ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
 *   - AUTO_INCREMENT sur les PK entières non-FK
 *   - BOOLEAN → TINYINT(1)
 *   - CONSTRAINT nommées pour les FK (best practice)
 *   - ON DELETE CASCADE ON UPDATE CASCADE par défaut
 * 
 * PostgreSQL :
 *   - Double quotes pour les identifiants
 *   - SERIAL pour les PK auto-incrémentées
 *   - Types natifs (TIMESTAMP, BOOLEAN, DOUBLE PRECISION)
 */

import { MpdModel, MpdTable, MpdColumn, SqlDialect } from '../models/types';

/**
 * Génère le script SQL DDL complet à partir d'un MpdModel.
 */
export function generateSql(model: MpdModel, dialect: SqlDialect = 'mariadb'): string {
    const statements: string[] = [];

    // Header
    const dialectLabel = dialect === 'mariadb' ? 'MariaDB' : dialect.toUpperCase();
    statements.push(`-- ============================================`);
    statements.push(`-- Script SQL généré par le plugin Merise`);
    statements.push(`-- Dialecte : ${dialectLabel}`);
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
 * Vérifie si le dialecte est de la famille MySQL/MariaDB.
 */
function isMysqlFamily(dialect: SqlDialect): boolean {
    return dialect === 'mariadb' || dialect === 'mysql';
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

        // AUTO_INCREMENT pour MariaDB/MySQL sur les PK entières non-FK
        if (col.isPrimaryKey && isMysqlFamily(dialect) && col.sqlType === 'INT' &&
            (col.name.toLowerCase().startsWith('id') || col.name.toLowerCase().endsWith('id')) &&
            !col.foreignKey) {
            def += ' AUTO_INCREMENT';
        }

        colDefs.push(def);

        if (col.isPrimaryKey) {
            pkColumns.push(`${q}${col.name}${q}`);
        }

        // FK avec CONSTRAINT nommée (best practice MariaDB/MySQL)
        if (col.foreignKey) {
            const fk = col.foreignKey;
            const onDelete = fk.onDelete || 'CASCADE';
            const onUpdate = fk.onUpdate || 'CASCADE';

            if (isMysqlFamily(dialect)) {
                // CONSTRAINT nommée : fk_<table>_<colonne> (unique même si plusieurs FK vers la même table)
                const constraintName = `fk_${table.name.toLowerCase()}_${fk.columnName.toLowerCase()}`;
                let fkDef = `    CONSTRAINT ${q}${constraintName}${q} FOREIGN KEY (${q}${fk.columnName}${q}) REFERENCES ${q}${fk.referencedTable}${q} (${q}${fk.referencedColumn}${q})`;
                fkDef += ` ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
                fkDefs.push(fkDef);
            } else {
                // PostgreSQL : FOREIGN KEY classique
                let fkDef = `    FOREIGN KEY (${q}${fk.columnName}${q}) REFERENCES ${q}${fk.referencedTable}${q}(${q}${fk.referencedColumn}${q})`;
                fkDef += ` ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
                fkDefs.push(fkDef);
            }
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

    // Fermeture avec ENGINE et CHARSET pour MariaDB/MySQL
    if (isMysqlFamily(dialect)) {
        lines.push(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
    } else {
        lines.push(');');
    }

    return lines.join('\n');
}

/**
 * Formate un type SQL selon le dialecte.
 */
function formatSqlType(sqlType: string, dialect: SqlDialect): string {
    if (dialect === 'postgresql') {
        if (sqlType === 'DATETIME') return 'TIMESTAMP';
        if (sqlType === 'DOUBLE') return 'DOUBLE PRECISION';
    }
    if (isMysqlFamily(dialect)) {
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
