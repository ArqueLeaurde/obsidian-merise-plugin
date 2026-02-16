/**
 * renderer/mcdRenderer.ts
 * 
 * Convertit un McdModel en diagramme Mermaid flowchart (graph).
 * 
 * Rendu Merise fidèle :
 *   - Entités → rectangles avec attributs (PK soulignés)
 *   - Relations → losanges (diamants) avec attributs portés
 *   - Cardinalités → labels sur chaque lien
 *   - Héritage → nœud IS-A arrondi
 *   - Entités associatives → rectangles verts liés aux relations
 *   - Courbes linéaires pour éviter les chevauchements
 */

import { McdModel } from '../models/types';

/**
 * Génère le code Mermaid flowchart à partir d'un McdModel.
 * 
 * Utilise graph TD (Top-Down) avec :
 *   - Rectangles pour les entités (avec attributs listés)
 *   - Diamants { } pour les relations (avec attributs portés)
 *   - Labels de cardinalité sur chaque lien entité↔relation
 */
export function renderMcdToMermaid(model: McdModel): string {
    const lines: string[] = [
        "%%{init: {'theme':'base','flowchart':{'curve':'stepAfter','nodeSpacing':60,'rankSpacing':80,'padding':15,'useMaxWidth':false},'themeVariables':{'primaryColor':'#e3f2fd','edgeLabelBackground':'#ffffff','tertiaryColor':'#fff9c4','lineColor':'#555555','textColor':'#333333'}}}%%",
        'graph TD',
        '',
        '    %% Styles',
        '    classDef entity fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#212121,rx:4,ry:4',
        '    classDef relation fill:#fff9c4,stroke:#f9a825,stroke-width:2px,color:#212121',
        '    classDef inheritance fill:#fce4ec,stroke:#c62828,stroke-width:2px,color:#212121',
        '    classDef assocEntity fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#212121',
        '',
    ];

    // ── Entités ──
    lines.push('    %% Entités');
    for (const entity of model.entities) {
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
        lines.push(`    ${safeId(entity.name)}["${label}"]:::entity`);
    }

    // ── Entités associatives ──
    if (model.associativeEntities.length > 0) {
        lines.push('');
        lines.push('    %% Entités associatives');
        for (const assoc of model.associativeEntities) {
            const attrParts: string[] = assoc.attributes.map(a =>
                a.isPrimaryKey
                    ? `<u>${sanitize(a.name)}</u>`
                    : sanitize(a.name)
            );
            let label = `<b>${sanitize(assoc.name)}</b>`;
            if (attrParts.length > 0) {
                label += `<br/>────<br/>${attrParts.join('<br/>')}`;
            }
            lines.push(`    ${safeId(assoc.name)}["${label}"]:::assocEntity`);
        }
    }

    // ── Relations ──
    lines.push('');
    lines.push('    %% Relations');
    for (const rel of model.relations) {
        const relId = `rel_${safeId(rel.name)}`;

        // Construire le label du losange
        const parts: string[] = [sanitize(rel.name)];
        for (const attr of rel.attributes) {
            parts.push(sanitize(attr.name));
        }
        const relLabel = parts.join('<br/>');

        lines.push(`    ${relId}{"${relLabel}"}:::relation`);

        // Liens entité ↔ relation avec cardinalités
        for (const p of rel.participants) {
            lines.push(`    ${safeId(p.entityName)} ---|${p.cardinality}| ${relId}`);
        }
    }

    // ── Héritage ──
    if (model.inheritances.length > 0) {
        lines.push('');
        lines.push('    %% Héritage');
        for (const inh of model.inheritances) {
            const inhId = `inh_${safeId(inh.name)}`;
            lines.push(`    ${inhId}(["${sanitize(inh.name)} IS-A"]):::inheritance`);
            lines.push(`    ${safeId(inh.parentEntity)} --- ${inhId}`);
            for (const child of inh.childEntities) {
                lines.push(`    ${inhId} --- ${safeId(child)}`);
            }
        }
    }

    // ── Liens entités associatives → relations ──
    if (model.associativeEntities.length > 0) {
        lines.push('');
        lines.push('    %% Liens associatifs');
        for (const assoc of model.associativeEntities) {
            const rel = model.relations.find(r => r.name === assoc.relationName);
            if (rel) {
                lines.push(`    ${safeId(assoc.name)} -.-|associée| rel_${safeId(rel.name)}`);
            }
        }
    }

    return lines.join('\n');
}

/** Nettoie le texte utilisateur pour qu'il soit safe dans un label Mermaid HTML ["..."] */
function sanitize(text: string): string {
    return text.replace(/"/g, "'").replace(/&/g, '&amp;');
}

/** Génère un identifiant de nœud safe pour Mermaid */
function safeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
