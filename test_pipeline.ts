/**
 * test_pipeline.ts
 * 
 * Script de vérification du pipeline MCD → MLD → MPD → SQL.
 * 
 * Exécution :
 *   npx esbuild test_pipeline.ts --bundle --platform=node --outfile=test_pipeline.js --external:obsidian && node test_pipeline.js
 */

import { parseMcd } from './parser/mcdParser';
import { convertMcdToMld } from './converter/mcdToMld';
import { convertMldToMpd } from './converter/mldToMpd';
import { renderMcdToMermaid } from './renderer/mcdRenderer';
import { renderMldToMermaid } from './renderer/mldRenderer';
import { renderMpdToMermaid } from './renderer/mpdRenderer';
import { generateSql } from './sql/sqlGenerator';
import { validateMcd, validateMld, validateMpd } from './validation/validator';

// ============================================================
// Test Case : cas complexe avec relations multiples, table de jointure, types hétérogènes
// ============================================================

const testMcd = `
ENTITY CLIENT {
    id_client [PK]
    nom
    email
}

ENTITY COMMANDE {
    id_commande [PK]
    date_commande
}

ENTITY ADRESSE {
    id_adresse [PK]
    rue
    ville
}

ENTITY ARTICLE {
    ref_article [PK]
    designation
    prix_unitaire
}

RELATION passe {
    CLIENT (0,n)
    COMMANDE (1,1)
}

RELATION livraison { COMMANDE (1,1), ADRESSE (0,n) }
RELATION facturation { COMMANDE (1,1), ADRESSE (0,n) }
RELATION contient { COMMANDE (1,n), ARTICLE (0,n), quantite }
`;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string): void {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passed++;
    } else {
        console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

// ============================================================
// STEP 1 : Parsing MCD
// ============================================================

console.log('=== STEP 1: Parsing MCD ===\n');
const { model: mcd, errors, warnings } = parseMcd(testMcd);

if (errors.length > 0) console.log('  Parse errors:', errors);
if (warnings.length > 0) console.log('  Warnings:', warnings);

assert('Aucune erreur de parsing', errors.length === 0, errors.join('; '));
assert('4 entités parsées', mcd.entities.length === 4, `found ${mcd.entities.length}`);
assert('4 relations parsées', mcd.relations.length === 4, `found ${mcd.relations.length}`);

const relPasse = mcd.relations.find(r => r.name === 'passe');
assert('Relation "passe" a 2 participants', relPasse?.participants.length === 2);
assert('passe: CLIENT(0,n)', relPasse?.participants.some(p => p.entityName === 'CLIENT' && p.cardinality === '0,n') ?? false);
assert('passe: COMMANDE(1,1)', relPasse?.participants.some(p => p.entityName === 'COMMANDE' && p.cardinality === '1,1') ?? false);

const relLivraison = mcd.relations.find(r => r.name === 'livraison');
assert('Relation "livraison" parsée (inline)', relLivraison?.participants.length === 2);

const relContient = mcd.relations.find(r => r.name === 'contient');
assert('Relation "contient" a 2 participants', relContient?.participants.length === 2);
assert('Relation "contient" a 1 attribut (quantite)', relContient?.attributes.length === 1 && relContient.attributes[0].name === 'quantite');

// Validation MCD
const mcdValidation = validateMcd(mcd);
const mcdErrors = mcdValidation.filter(m => m.level === 'error');
assert('Validation MCD: aucune erreur', mcdErrors.length === 0, mcdErrors.map(m => m.message).join('; '));

// ============================================================
// STEP 2 : MCD → MLD
// ============================================================

console.log('\n=== STEP 2: MCD → MLD ===\n');
const mld = convertMcdToMld(mcd);

for (const table of mld.tables) {
    const cols = table.columns.map(c => {
        const flags: string[] = [];
        if (c.isPrimaryKey) flags.push('PK');
        if (c.foreignKey) flags.push(`FK→${c.foreignKey.referencedTable}.${c.foreignKey.referencedColumn}`);
        return `${c.name}${flags.length ? ' [' + flags.join(', ') + ']' : ''}`;
    });
    console.log(`  TABLE ${table.name} : ${cols.join(', ')}`);
}

// Vérifications MLD
const mldCommande = mld.tables.find(t => t.name === 'COMMANDE')!;
assert('COMMANDE existe dans le MLD', !!mldCommande);

assert('COMMANDE a FK id_adresse_livraison',
    mldCommande.columns.some(c => c.name === 'id_adresse_livraison' && c.foreignKey?.referencedTable === 'ADRESSE'),
    `colonnes: ${mldCommande.columns.map(c => c.name).join(', ')}`
);

assert('COMMANDE a FK id_adresse_facturation',
    mldCommande.columns.some(c => c.name === 'id_adresse_facturation' && c.foreignKey?.referencedTable === 'ADRESSE'),
    `colonnes: ${mldCommande.columns.map(c => c.name).join(', ')}`
);

const fkPasse = mldCommande.columns.find(c => c.foreignKey?.referencedTable === 'CLIENT');
assert('COMMANDE a FK vers CLIENT (relation passe)',
    !!fkPasse,
    `colonnes FK: ${mldCommande.columns.filter(c => c.foreignKey).map(c => c.name + '→' + c.foreignKey!.referencedTable).join(', ')}`
);

// Table de jointure "contient"
const mldContient = mld.tables.find(t => t.name === 'contient')!;
assert('Table de jointure "contient" existe', !!mldContient);
assert('contient a id_commande (pas commande_id_commande)',
    mldContient.columns.some(c => c.name === 'id_commande'),
    `colonnes: ${mldContient.columns.map(c => c.name).join(', ')}`
);
assert('contient a ref_article (pas article_ref_article)',
    mldContient.columns.some(c => c.name === 'ref_article'),
    `colonnes: ${mldContient.columns.map(c => c.name).join(', ')}`
);
assert('contient a attribut quantite',
    mldContient.columns.some(c => c.name === 'quantite' && !c.isPrimaryKey && !c.foreignKey),
    `colonnes: ${mldContient.columns.map(c => c.name).join(', ')}`
);

// Validation MLD
const mldValidation = validateMld(mld);
const mldErrors = mldValidation.filter(m => m.level === 'error');
assert('Validation MLD: aucune erreur', mldErrors.length === 0, mldErrors.map(m => m.message).join('; '));

// ============================================================
// STEP 3 : MLD → MPD
// ============================================================

console.log('\n=== STEP 3: MLD → MPD ===\n');
const mpd = convertMldToMpd(mld, 'mysql', 255);

for (const table of mpd.tables) {
    const cols = table.columns.map(c => {
        const flags: string[] = [];
        if (c.isPrimaryKey) flags.push('PK');
        if (c.foreignKey) flags.push(`FK→${c.foreignKey.referencedTable}`);
        return `${c.name} ${c.sqlType}${flags.length ? ' [' + flags.join(', ') + ']' : ''}`;
    });
    console.log(`  TABLE ${table.name} : ${cols.join(', ')}`);
}

// Vérifications MPD — propagation des types
const mpdCommande = mpd.tables.find(t => t.name === 'COMMANDE')!;
const fkLivraison = mpdCommande.columns.find(c => c.name === 'id_adresse_livraison')!;
assert('FK id_adresse_livraison est INT (pas VARCHAR)', fkLivraison?.sqlType === 'INT', `found: ${fkLivraison?.sqlType}`);

const fkFacturation = mpdCommande.columns.find(c => c.name === 'id_adresse_facturation')!;
assert('FK id_adresse_facturation est INT (pas VARCHAR)', fkFacturation?.sqlType === 'INT', `found: ${fkFacturation?.sqlType}`);

const mpdContient = mpd.tables.find(t => t.name === 'contient')!;
const fkIdCmd = mpdContient.columns.find(c => c.name === 'id_commande')!;
assert('contient.id_commande est INT', fkIdCmd?.sqlType === 'INT', `found: ${fkIdCmd?.sqlType}`);

const fkRefArt = mpdContient.columns.find(c => c.name === 'ref_article')!;
assert('contient.ref_article est VARCHAR(20)', fkRefArt?.sqlType === 'VARCHAR(20)', `found: ${fkRefArt?.sqlType}`);

const colQuantite = mpdContient.columns.find(c => c.name === 'quantite')!;
assert('contient.quantite est INT', colQuantite?.sqlType === 'INT', `found: ${colQuantite?.sqlType}`);

// Validation MPD
const mpdValidation = validateMpd(mpd);
const mpdErrors = mpdValidation.filter(m => m.level === 'error');
assert('Validation MPD: aucune erreur', mpdErrors.length === 0, mpdErrors.map(m => m.message).join('; '));

// ============================================================
// STEP 4 : SQL Generation
// ============================================================

console.log('\n=== STEP 4: SQL Generation ===\n');
const sql = generateSql(mpd, 'mariadb');
console.log(sql);

assert('SQL contient CREATE TABLE CLIENT', sql.includes('CREATE TABLE'));
assert('SQL contient PRIMARY KEY', sql.includes('PRIMARY KEY'));
assert('SQL contient FOREIGN KEY', sql.includes('FOREIGN KEY'));
assert('SQL contient ON DELETE CASCADE', sql.includes('ON DELETE CASCADE'));
assert('SQL contient ENGINE=InnoDB', sql.includes('ENGINE=InnoDB'));
assert('SQL contient utf8mb4', sql.includes('utf8mb4'));
assert('SQL contient CONSTRAINT nomm\u00e9e', sql.includes('CONSTRAINT'));
assert('SQL contient MariaDB dans header', sql.includes('MariaDB'));

// ============================================================
// STEP 5 : Rendu Mermaid
// ============================================================

console.log('\n=== STEP 5: MCD Mermaid ===\n');
const mcdMermaid = renderMcdToMermaid(mcd);
console.log(mcdMermaid);

assert('MCD Mermaid contient graph TD', mcdMermaid.includes('graph TD'));
assert('MCD Mermaid contient losange relation', mcdMermaid.includes('{'));
assert('MCD Mermaid contient cardinalité 0,n', mcdMermaid.includes('0,n'));
assert('MCD Mermaid contient cardinalité 1,1', mcdMermaid.includes('1,1'));

console.log('\n=== STEP 5b: MLD Mermaid ===\n');
const mldMermaid = renderMldToMermaid(mld);
console.log(mldMermaid);
assert('MLD Mermaid contient erDiagram', mldMermaid.includes('erDiagram'));

console.log('\n=== STEP 5c: MPD Mermaid ===\n');
const mpdMermaid = renderMpdToMermaid(mpd);
console.log(mpdMermaid);
assert('MPD Mermaid contient erDiagram', mpdMermaid.includes('erDiagram'));
assert('MPD Mermaid contient INT', mpdMermaid.includes('INT'));

// ============================================================
// RÉSULTATS
// ============================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`RÉSULTATS : ${passed} passés, ${failed} échoués`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
else console.log('\n🎉 Tous les tests sont passés !\n');
