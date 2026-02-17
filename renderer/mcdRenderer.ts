/**
 * renderer/mcdRenderer.ts
 *
 * Convertit un McdModel en diagramme Mermaid flowchart (graph TD).
 *
 * Approche "Hub-Centric Inline" inspirée des outils professionnels
 * (WinDesign, PowerAMC) : les entités les plus connectées (hubs) sont
 * émises en premier et se retrouvent au centre du graphe, les petites
 * entités (satellites) gravitent autour.
 *
 * Principes :
 *   1. Trier les entités par degré décroissant → les hubs partent en premier.
 *   2. Émettre les relations par ordre de « poids » (nombre de connexions
 *      cumulées des 2 entités) → les axes structurants sont posés d'abord.
 *   3. Chaînage inline obligatoire pour les relations binaires :
 *        A ---|card| R{Nom} ---|card| B
 *      Le losange est physiquement bloqué sur le fil.
 *   4. Zéro subgraph, zéro lien invisible : le moteur tight-tree
 *      rapproche les nœuds connectés et crée la 2D naturellement.
 *   5. `graph TD` + `curve: basis` pour un rendu lisible multi-lignes.
 */

import { McdModel, McdEntity } from '../models/types';

// ────────────────────────────────────────────────────────────
// Fonctions utilitaires
// ────────────────────────────────────────────────────────────

/** Nettoie le texte pour un label Mermaid HTML */
function sanitize(text: string): string {
    return text.replace(/"/g, "'").replace(/&/g, '&amp;');
}

/** ID de nœud safe pour Mermaid */
function safeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Label HTML d'une entité (nom gras + séparateur + attributs) */
function entityLabel(entity: McdEntity): string {
    const attrParts: string[] = [];
    for (const attr of entity.attributes) {
        if (attr.isPrimaryKey) {
            attrParts.push(`<u>${sanitize(attr.name)}</u>`);
        } else if (attr.isDerived) {
            attrParts.push(`<i>/${sanitize(attr.name)}/</i>`);
        } else {
            attrParts.push(sanitize(attr.name));
        }
    }
    let label = `<b>${sanitize(entity.name)}</b>`;
    if (attrParts.length > 0) {
        label += `<br/>────<br/>${attrParts.join('<br/>')}`;
    }
    return label;
}

// ────────────────────────────────────────────────────────────
// Point d'entrée
// ────────────────────────────────────────────────────────────

/**
 * Génère le code Mermaid flowchart à partir d'un McdModel.
 *
 * Algorithme "Hub-Centric" :
 *   1. Calculer le degré de chaque entité
 *   2. Trier les entités : hubs (degré élevé) en premier
 *   3. Trier les relations : les plus « lourdes » d'abord
 *   4. Émettre les entités triées, puis les liens chaînés inline
 *   5. graph TD + tight-tree → mise en page 2D automatique
 */
export function renderMcdToMermaid(model: McdModel): string {

    // ================================================================
    // 1. Calcul du degré de chaque entité
    // ================================================================
    const degree = new Map<string, number>();
    for (const e of model.entities) degree.set(e.name, 0);
    for (const r of model.relations) {
        for (const p of r.participants) {
            degree.set(p.entityName, (degree.get(p.entityName) || 0) + 1);
        }
    }
    for (const inh of model.inheritances) {
        degree.set(inh.parentEntity, (degree.get(inh.parentEntity) || 0) + 1);
        for (const c of inh.childEntities) {
            degree.set(c, (degree.get(c) || 0) + 1);
        }
    }

    // ================================================================
    // 2. Tri des entités : hubs (degré élevé) en premier
    //    Mermaid place les nœuds déclarés en premier plus au centre
    //    du graphe → les hubs se retrouvent au cœur, les satellites
    //    sont repoussés vers l'extérieur.
    // ================================================================
    const sortedEntities = [...model.entities].sort((a, b) => {
        return (degree.get(b.name) || 0) - (degree.get(a.name) || 0);
    });

    // ================================================================
    // 3. Tri des relations : les plus « lourdes » d'abord
    //    Poids = somme des degrés des entités participantes.
    //    Les axes structurants sont posés en premier.
    // ================================================================
    const sortedRelations = [...model.relations].sort((a, b) => {
        const weightA = a.participants.reduce((s, p) => s + (degree.get(p.entityName) || 0), 0);
        const weightB = b.participants.reduce((s, p) => s + (degree.get(p.entityName) || 0), 0);
        return weightB - weightA;
    });

    // ================================================================
    // 4. Construction du code Mermaid
    // ================================================================
    const lines: string[] = [];

    // ── Config : TD, basis curves, tight-tree ──
    lines.push("%%{init: {'theme':'base','flowchart':{'curve':'basis','ranker':'tight-tree','nodeSpacing':40,'rankSpacing':60,'padding':15,'useMaxWidth':false},'themeVariables':{'primaryColor':'#e3f2fd','primaryBorderColor':'#1565c0','lineColor':'#455a64','tertiaryColor':'#fff9c4','edgeLabelBackground':'#ffffff','textColor':'#333333'}}}%%");
    lines.push('graph TD');
    lines.push('');

    // ── Styles ──
    lines.push('    classDef entity fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#212121,rx:4,ry:4');
    lines.push('    classDef relation fill:#fff9c4,stroke:#f9a825,stroke-width:2px,color:#212121');
    lines.push('    classDef inheritance fill:#fce4ec,stroke:#c62828,stroke-width:2px,color:#212121');
    lines.push('    classDef assocEntity fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#212121');
    lines.push('');

    // ── Déclaration des entités (triées hubs-first) ──
    for (const entity of sortedEntities) {
        lines.push(`    ${safeId(entity.name)}["${entityLabel(entity)}"]:::entity`);
    }
    lines.push('');

    // ── Entités associatives ──
    if (model.associativeEntities.length > 0) {
        for (const assoc of model.associativeEntities) {
            const attrParts: string[] = assoc.attributes.map(a =>
                a.isPrimaryKey ? `<u>${sanitize(a.name)}</u>` : sanitize(a.name)
            );
            let label = `<b>${sanitize(assoc.name)}</b>`;
            if (attrParts.length > 0) {
                label += `<br/>────<br/>${attrParts.join('<br/>')}`;
            }
            lines.push(`    ${safeId(assoc.name)}["${label}"]:::assocEntity`);
        }
        lines.push('');
    }

    // ================================================================
    // 5. Relations — Chaînage Inline
    //    Binaire : A ---|card| R{Nom} ---|card| B
    //    Ternaire+ : nœud central + liens individuels
    //    Ordre : relations les plus lourdes d'abord → axes structurants
    //    posés en premier, Mermaid organise autour.
    // ================================================================
    for (const rel of sortedRelations) {
        const relId = `R_${safeId(rel.name)}`;

        // Label du losange
        const labelParts: string[] = [sanitize(rel.name)];
        for (const attr of rel.attributes) {
            labelParts.push(sanitize(attr.name));
        }
        const relLabel = labelParts.join('<br/>');

        if (rel.participants.length === 2) {
            // Relation binaire : chaînage inline obligatoire
            const [pA, pB] = rel.participants;
            // Mettre l'entité la plus connectée à gauche (source)
            const dA = degree.get(pA.entityName) || 0;
            const dB = degree.get(pB.entityName) || 0;
            const [src, tgt] = dA >= dB ? [pA, pB] : [pB, pA];
            lines.push(
                `    ${safeId(src.entityName)} ---|"${src.cardinality}"| ` +
                `${relId}{"${relLabel}"}:::relation ---|"${tgt.cardinality}"| ` +
                `${safeId(tgt.entityName)}`
            );

        } else if (rel.participants.length === 1) {
            // Relation réflexive
            const p = rel.participants[0];
            lines.push(
                `    ${safeId(p.entityName)} ---|"${p.cardinality}"| ` +
                `${relId}{"${relLabel}"}:::relation ---|"${p.cardinality}"| ` +
                `${safeId(p.entityName)}`
            );

        } else {
            // Relation ternaire+ : nœud central + liens
            lines.push(`    ${relId}{"${relLabel}"}:::relation`);
            // Trier participants : hub en premier
            const sorted = [...rel.participants].sort((a, b) =>
                (degree.get(b.entityName) || 0) - (degree.get(a.entityName) || 0)
            );
            for (const p of sorted) {
                lines.push(`    ${safeId(p.entityName)} ---|"${p.cardinality}"| ${relId}`);
            }
        }
    }
    lines.push('');

    // ── Héritage ──
    if (model.inheritances.length > 0) {
        for (const inh of model.inheritances) {
            const inhId = `inh_${safeId(inh.name)}`;
            lines.push(`    ${inhId}(["${sanitize(inh.name)} IS-A"]):::inheritance`);
            lines.push(`    ${safeId(inh.parentEntity)} --- ${inhId}`);
            for (const child of inh.childEntities) {
                lines.push(`    ${inhId} --- ${safeId(child)}`);
            }
        }
        lines.push('');
    }

    // ── Liens entités associatives → relations ──
    if (model.associativeEntities.length > 0) {
        for (const assoc of model.associativeEntities) {
            const rel = model.relations.find(r => r.name === assoc.relationName);
            if (rel) {
                lines.push(`    ${safeId(assoc.name)} -.-|"associée"| R_${safeId(rel.name)}`);
            }
        }
        lines.push('');
    }

    // ── Finition CSS ──
    lines.push('    linkStyle default stroke-width:1px,fill:none,stroke:#455a64');

    return lines.join('\n');
}
