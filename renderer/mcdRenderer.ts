/**
 * renderer/mcdRenderer.ts
 * 
 * Convertit un McdModel en diagramme Mermaid flowchart (graph).
 * 
 * Layout optimisé par couches (style WinDesign) :
 *   - Couche 1 (hubs) : entités très connectées (degré ≥ 5)
 *   - Couche 2 (masters) : entités moyennement connectées (degré 3-4)
 *   - Couche 3 (satellites) : entités peu connectées (degré 1-2)
 *   - Liens invisibles ~~~ entre couches pour l'ancrage vertical
 *   - Chaînes horizontales ~~~ dans chaque couche pour compacité
 *   - Courbe linear + rankSpacing 120 pour un rendu orthogonal propre
 *   - linkStyle 1px pour des liens fins style WinDesign
 */

import { McdModel } from '../models/types';

/**
 * Génère le code Mermaid flowchart à partir d'un McdModel.
 * 
 * Layout par couches avec hiérarchie basée sur le degré de connectivité :
 *   - Rectangles pour les entités (avec attributs listés)
 *   - Diamants { } pour les relations (avec attributs portés)
 *   - Labels de cardinalité sur chaque lien entité↔relation
 *   - Subgraphs invisibles pour organiser les couches
 */
export function renderMcdToMermaid(model: McdModel): string {
    // ── Calculer le degré de chaque entité ──
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

    // ── Classer les entités par couche ──
    const hubs: string[] = [];     // degré ≥ 5
    const masters: string[] = [];  // degré 3-4
    const satellites: string[] = []; // degré 1-2
    for (const e of model.entities) {
        const d = degree.get(e.name) || 0;
        if (d >= 5) hubs.push(e.name);
        else if (d >= 3) masters.push(e.name);
        else satellites.push(e.name);
    }

    const lines: string[] = [
        "%%{init: {'theme':'base','flowchart':{'curve':'linear','nodeSpacing':60,'rankSpacing':120,'padding':15,'useMaxWidth':false,'ranker':'longest-path'},'themeVariables':{'primaryColor':'#e3f2fd','edgeLabelBackground':'#ffffff','tertiaryColor':'#fff9c4','lineColor':'#555555','textColor':'#333333'}}}%%",
        'graph TD',
        '',
        '    %% Styles',
        '    classDef entity fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#212121,rx:4,ry:4',
        '    classDef relation fill:#fff9c4,stroke:#f9a825,stroke-width:2px,color:#212121',
        '    classDef inheritance fill:#fce4ec,stroke:#c62828,stroke-width:2px,color:#212121',
        '    classDef assocEntity fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#212121',
        '    classDef invisible fill:none,stroke:none,color:transparent,font-size:0',
        '',
    ];

    // ── Déclaration de toutes les entités ──
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

    // ── Couches d'organisation (subgraphs invisibles) ──
    // On place les entités dans des couches pour forcer la hiérarchie verticale
    if (hubs.length > 0 || masters.length > 0) {
        lines.push('');
        lines.push('    %% Organisation par couches');

        if (hubs.length > 0) {
            lines.push('    subgraph layer_hub [" "]');
            lines.push('        direction LR');
            for (const h of hubs) lines.push(`        ${safeId(h)}`);
            lines.push('    end');
            lines.push('    style layer_hub fill:none,stroke:none');
        }

        if (masters.length > 0) {
            lines.push('    subgraph layer_master [" "]');
            lines.push('        direction LR');
            for (const m of masters) lines.push(`        ${safeId(m)}`);
            lines.push('    end');
            lines.push('    style layer_master fill:none,stroke:none');
        }

        if (satellites.length > 0) {
            lines.push('    subgraph layer_satellite [" "]');
            lines.push('        direction LR');
            for (const s of satellites) lines.push(`        ${safeId(s)}`);
            lines.push('    end');
            lines.push('    style layer_satellite fill:none,stroke:none');
        }

        // Chaîne d'ancrage vertical entre couches via liens invisibles
        if (hubs.length > 0 && masters.length > 0) {
            lines.push(`    ${safeId(hubs[0])} ~~~ ${safeId(masters[0])}`);
        }
        if (masters.length > 0 && satellites.length > 0) {
            lines.push(`    ${safeId(masters[0])} ~~~ ${safeId(satellites[0])}`);
        }
        if (hubs.length > 0 && masters.length === 0 && satellites.length > 0) {
            lines.push(`    ${safeId(hubs[0])} ~~~ ${safeId(satellites[0])}`);
        }
    }

    // ── Link styles fins (style WinDesign) ──
    // Compter le nombre total de liens pour appliquer le style mince
    let linkCount = 0;
    for (const rel of model.relations) {
        linkCount += rel.participants.length;
    }
    for (const inh of model.inheritances) {
        linkCount += 1 + inh.childEntities.length;
    }
    for (const assoc of model.associativeEntities) {
        if (model.relations.find(r => r.name === assoc.relationName)) linkCount++;
    }
    // Ancrage invisible aussi
    if (hubs.length > 0 && masters.length > 0) linkCount++;
    if (masters.length > 0 && satellites.length > 0) linkCount++;
    if (hubs.length > 0 && masters.length === 0 && satellites.length > 0) linkCount++;

    if (linkCount > 0) {
        const indices = Array.from({ length: linkCount }, (_, i) => i).join(',');
        lines.push(`    linkStyle ${indices} stroke-width:1px`);
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
