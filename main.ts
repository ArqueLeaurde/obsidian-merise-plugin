/**
 * main.ts
 * 
 * Point d'entrée du plugin Obsidian Merise.
 * 
 * Fonctionnalités :
 *   - Enregistrement des processeurs de blocs : merise-mcd, merise-mld, merise-mpd
 *   - Commandes palette : Convert MCD→MLD, Convert MLD→MPD, Export SQL
 *   - Rendu Mermaid natif via l'API Obsidian
 *   - Panneau de paramètres
 */

import {
    Plugin,
    MarkdownPostProcessorContext,
    Notice,
    MarkdownView,
} from 'obsidian';

import { MerisePluginSettings, DEFAULT_SETTINGS, McdModel, MldModel, MpdModel } from './models/types';
import { parseMcd } from './parser/mcdParser';
import { parseMld } from './parser/mldParser';
import { parseMpd } from './parser/mpdParser';
import { renderMcdToMermaid } from './renderer/mcdRenderer';
import { renderMldToMermaid } from './renderer/mldRenderer';
import { renderMpdToMermaid } from './renderer/mpdRenderer';
import { convertMcdToMld } from './converter/mcdToMld';
import { convertMldToMpd } from './converter/mldToMpd';
import { generateSql } from './sql/sqlGenerator';
import { validateMcd, validateMld, validateMpd, ValidationMessage } from './validation/validator';
import { MeriseSettingTab } from './settings';

export default class MerisePlugin extends Plugin {
    settings: MerisePluginSettings = DEFAULT_SETTINGS;

    async onload(): Promise<void> {
        await this.loadSettings();

        // ── Processeurs de blocs de code ──

        // merise-mcd
        this.registerMarkdownCodeBlockProcessor('merise-mcd', (source, el, ctx) => {
            this.processMcdBlock(source, el, ctx);
        });

        // merise-mld
        this.registerMarkdownCodeBlockProcessor('merise-mld', (source, el, ctx) => {
            this.processMldBlock(source, el, ctx);
        });

        // merise-mpd
        this.registerMarkdownCodeBlockProcessor('merise-mpd', (source, el, ctx) => {
            this.processMpdBlock(source, el, ctx);
        });

        // ── Commandes ──

        // Convertir MCD → MLD
        this.addCommand({
            id: 'merise-convert-mcd-to-mld',
            name: 'Merise : Convertir MCD → MLD',
            callback: () => this.commandConvertMcdToMld(),
        });

        // Convertir MLD → MPD
        this.addCommand({
            id: 'merise-convert-mld-to-mpd',
            name: 'Merise : Convertir MLD → MPD',
            callback: () => this.commandConvertMldToMpd(),
        });

        // Convertir MCD → MLD → MPD (tout en un)
        this.addCommand({
            id: 'merise-convert-mcd-to-mpd',
            name: 'Merise : Convertir MCD → MLD → MPD (complet)',
            callback: () => this.commandConvertMcdToMpd(),
        });

        // Exporter SQL
        this.addCommand({
            id: 'merise-export-sql',
            name: 'Merise : Exporter SQL depuis MPD',
            callback: () => this.commandExportSql(),
        });

        // ── Settings ──
        this.addSettingTab(new MeriseSettingTab(this.app, this));

        new Notice('Plugin Merise chargé ✓');
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ================================================================
    // Processeurs de blocs
    // ================================================================

    /**
     * Traite un bloc merise-mcd : parse, valide, rend en Mermaid.
     */
    private processMcdBlock(
        source: string,
        el: HTMLElement,
        _ctx: MarkdownPostProcessorContext
    ): void {
        const { model, errors, warnings } = parseMcd(source);

        // Afficher erreurs
        if (errors.length > 0) {
            this.renderMessages(el, errors, 'error');
            return;
        }

        // Validation
        const validationMsgs = validateMcd(model);
        this.renderMessages(el, warnings, 'warning');
        this.renderValidationMessages(el, validationMsgs);

        // Génération Mermaid
        const mermaidCode = renderMcdToMermaid(model);
        this.renderMermaid(el, mermaidCode, 'MCD');
    }

    /**
     * Traite un bloc merise-mld.
     */
    private processMldBlock(
        source: string,
        el: HTMLElement,
        _ctx: MarkdownPostProcessorContext
    ): void {
        const { model, errors } = parseMld(source);

        if (errors.length > 0) {
            this.renderMessages(el, errors, 'error');
            return;
        }

        const validationMsgs = validateMld(model);
        this.renderValidationMessages(el, validationMsgs);

        const mermaidCode = renderMldToMermaid(model);
        this.renderMermaid(el, mermaidCode, 'MLD');
    }

    /**
     * Traite un bloc merise-mpd.
     */
    private processMpdBlock(
        source: string,
        el: HTMLElement,
        _ctx: MarkdownPostProcessorContext
    ): void {
        const { model, errors } = parseMpd(source);

        if (errors.length > 0) {
            this.renderMessages(el, errors, 'error');
            return;
        }

        const validationMsgs = validateMpd(model);
        this.renderValidationMessages(el, validationMsgs);

        const mermaidCode = renderMpdToMermaid(model);
        this.renderMermaid(el, mermaidCode, 'MPD');
    }

    // ================================================================
    // Rendu Mermaid
    // ================================================================

    /**
     * Rend un diagramme Mermaid dans l'élément donné.
     * Ajoute : toolbar (Copier / Export PNG / Reset zoom), conteneur pan&zoom.
     */
    private renderMermaid(el: HTMLElement, mermaidCode: string, label: string): void {
        const container = el.createDiv({ cls: 'merise-diagram-container' });

        // ── Label ──
        container.createEl('div', {
            cls: 'merise-diagram-label',
            text: `📊 ${label}`,
        });

        // ── Toolbar ──
        const toolbar = container.createDiv({ cls: 'merise-toolbar' });

        const copyBtn = toolbar.createEl('button', { text: '📋 Copier Mermaid' });
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(mermaidCode);
            new Notice('Code Mermaid copié !');
        });

        const exportBtn = toolbar.createEl('button', { text: '📥 Exporter PNG' });
        const resetBtn = toolbar.createEl('button', { text: '🔄 Reset zoom' });

        // ── Conteneur interactif pan/zoom ──
        const graphContainer = container.createDiv({ cls: 'merise-graph-container' });
        const graphInner = graphContainer.createDiv({ cls: 'merise-graph-inner' });

        // Indicateur de zoom
        const zoomIndicator = graphContainer.createDiv({ cls: 'merise-zoom-indicator' });
        zoomIndicator.textContent = '100%';

        // ── Rendu Mermaid ──
        this.renderMermaidDiagram(graphInner, mermaidCode).then(() => {
            // Attacher pan/zoom une fois le SVG rendu
            this.attachPanZoom(graphContainer, graphInner, zoomIndicator, resetBtn);

            // Attacher export PNG
            exportBtn.addEventListener('click', () => {
                this.exportPng(graphInner, label);
            });
        });
    }

    /**
     * Tente de rendre un diagramme Mermaid en SVG via l'API globale.
     */
    private async renderMermaidDiagram(container: HTMLElement, code: string): Promise<void> {
        try {
            const mermaid = (window as any).mermaid;
            if (mermaid) {
                const id = 'merise-' + Math.random().toString(36).substring(2, 9);
                const { svg } = await mermaid.render(id, code);
                container.innerHTML = svg;
            } else {
                this.renderFallbackCode(container, code);
            }
        } catch (err) {
            const errorDiv = container.createDiv({ cls: 'merise-render-error' });
            errorDiv.textContent = `⚠️ Erreur de rendu Mermaid : ${err}`;
            this.renderFallbackCode(container, code);
        }
    }

    /** Affiche le code Mermaid brut en fallback */
    private renderFallbackCode(container: HTMLElement, code: string): void {
        const pre = container.createEl('pre', { cls: 'merise-fallback-code' });
        pre.createEl('code').textContent = code;
    }

    // ================================================================
    // Pan & Zoom
    // ================================================================

    /**
     * Attache les listeners de pan (drag) et zoom (wheel) au conteneur.
     * Manipule la transformation CSS du graphInner.
     */
    private attachPanZoom(
        wrapper: HTMLElement,
        inner: HTMLElement,
        indicator: HTMLElement,
        resetBtn: HTMLElement,
    ): void {
        let scale = 1;
        let panX = 0;
        let panY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        const MIN_SCALE = 0.1;
        const MAX_SCALE = 5;
        const ZOOM_SENSITIVITY = 0.001;

        const applyTransform = (): void => {
            inner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
            indicator.textContent = `${Math.round(scale * 100)}%`;
        };

        // ── Zoom via molette ──
        wrapper.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const delta = -e.deltaY * ZOOM_SENSITIVITY;
            const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 + delta)));

            // Zoomer vers le pointeur
            const rect = wrapper.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // Ajuster le pan pour que le point sous la souris reste fixe
            const scaleRatio = newScale / scale;
            panX = mx - scaleRatio * (mx - panX);
            panY = my - scaleRatio * (my - panY);
            scale = newScale;

            applyTransform();
        }, { passive: false });

        // ── Pan via drag souris ──
        wrapper.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button !== 0) return; // gauche uniquement
            isDragging = true;
            startX = e.clientX - panX;
            startY = e.clientY - panY;
            inner.classList.remove('merise-animate-reset');
        });

        // On écoute sur document pour gérer les mouvements hors du conteneur
        const onMouseMove = (e: MouseEvent): void => {
            if (!isDragging) return;
            panX = e.clientX - startX;
            panY = e.clientY - startY;
            applyTransform();
        };

        const onMouseUp = (): void => {
            isDragging = false;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // ── Touch support (mobile) ──
        wrapper.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) {
                isDragging = true;
                startX = e.touches[0].clientX - panX;
                startY = e.touches[0].clientY - panY;
                inner.classList.remove('merise-animate-reset');
            }
        }, { passive: true });

        wrapper.addEventListener('touchmove', (e: TouchEvent) => {
            if (!isDragging || e.touches.length !== 1) return;
            e.preventDefault();
            panX = e.touches[0].clientX - startX;
            panY = e.touches[0].clientY - startY;
            applyTransform();
        }, { passive: false });

        wrapper.addEventListener('touchend', () => {
            isDragging = false;
        });

        // ── Reset ──
        resetBtn.addEventListener('click', () => {
            scale = 1;
            panX = 0;
            panY = 0;
            inner.classList.add('merise-animate-reset');
            applyTransform();
            setTimeout(() => inner.classList.remove('merise-animate-reset'), 350);
        });

        // Initial fit : centrer si le SVG est plus grand que le conteneur
        requestAnimationFrame(() => {
            const svg = inner.querySelector('svg');
            if (!svg) return;
            const svgRect = svg.getBoundingClientRect();
            const wrapperRect = wrapper.getBoundingClientRect();
            if (svgRect.width > wrapperRect.width || svgRect.height > wrapperRect.height) {
                const fitScale = Math.min(
                    wrapperRect.width / svgRect.width,
                    wrapperRect.height / svgRect.height,
                ) * 0.95; // 95% pour laisser une marge
                scale = fitScale;
                panX = (wrapperRect.width - svgRect.width * scale) / 2;
                panY = (wrapperRect.height - svgRect.height * scale) / 2;
                applyTransform();
            }
        });
    }

    // ================================================================
    // Export PNG
    // ================================================================

    /**
     * Exporte le SVG contenu dans graphInner en image PNG et déclenche
     * le téléchargement. Exporte la taille RÉELLE du SVG (pas la zone
     * visible à l'écran).
     */
    private exportPng(graphInner: HTMLElement, label: string): void {
        const svgEl = graphInner.querySelector('svg');
        if (!svgEl) {
            new Notice('Aucun diagramme à exporter.');
            return;
        }

        try {
            // Cloner le SVG pour ajouter un fond blanc et fixer les dimensions
            const clone = svgEl.cloneNode(true) as SVGSVGElement;

            // Récupérer les dimensions réelles
            const bbox = svgEl.getBBox();
            const padding = 20;
            const width = Math.ceil(bbox.width + bbox.x + padding * 2);
            const height = Math.ceil(bbox.height + bbox.y + padding * 2);

            clone.setAttribute('width', String(width));
            clone.setAttribute('height', String(height));
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

            // Ajouter un fond blanc
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('width', '100%');
            bg.setAttribute('height', '100%');
            bg.setAttribute('fill', '#ffffff');
            clone.insertBefore(bg, clone.firstChild);

            // Sérialiser → blob → canvas → PNG
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(clone);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const dpr = window.devicePixelRatio || 1;
                canvas.width = width * dpr;
                canvas.height = height * dpr;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    new Notice('Impossible de créer le canvas.');
                    URL.revokeObjectURL(url);
                    return;
                }
                ctx.scale(dpr, dpr);
                ctx.drawImage(img, 0, 0, width, height);

                // Déclencher le téléchargement
                const dataUrl = canvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = `merise-${label.toLowerCase()}-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                URL.revokeObjectURL(url);
                new Notice(`📥 ${label} exporté en PNG !`);
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                new Notice('Erreur lors de l\'export PNG.');
            };

            img.src = url;
        } catch (err) {
            new Notice(`Erreur export PNG : ${err}`);
        }
    }

    // ================================================================
    // Affichage des messages
    // ================================================================

    private renderMessages(el: HTMLElement, messages: string[], type: 'error' | 'warning'): void {
        if (messages.length === 0) return;

        const container = el.createDiv({ cls: `merise-messages merise-${type}` });
        const icon = type === 'error' ? '❌' : '⚠️';

        for (const msg of messages) {
            const line = container.createEl('div');
            line.textContent = `${icon} ${msg}`;
        }
    }

    private renderValidationMessages(el: HTMLElement, messages: ValidationMessage[]): void {
        const errors = messages.filter(m => m.level === 'error').map(m => m.message);
        const warnings = messages.filter(m => m.level === 'warning').map(m => m.message);

        this.renderMessages(el, errors, 'error');
        this.renderMessages(el, warnings, 'warning');
    }

    // ================================================================
    // Commandes palette
    // ================================================================

    /**
     * Convertit le bloc merise-mcd du fichier actif en bloc merise-mld.
     */
    private async commandConvertMcdToMld(): Promise<void> {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('Aucun fichier Markdown actif.');
            return;
        }

        const editor = view.editor;
        const content = editor.getValue();

        // Extraire le bloc merise-mcd
        const mcdBlock = this.extractCodeBlock(content, 'merise-mcd');
        if (!mcdBlock) {
            new Notice('Aucun bloc merise-mcd trouvé dans le fichier.');
            return;
        }

        // Parser et convertir
        const { model, errors } = parseMcd(mcdBlock);
        if (errors.length > 0) {
            new Notice(`Erreurs dans le MCD :\n${errors.join('\n')}`);
            return;
        }

        const mldModel = convertMcdToMld(model, this.settings.inheritanceStrategy);
        const mldText = this.generateMldText(mldModel);

        // Insérer le bloc merise-mld après le bloc merise-mcd
        const newContent = this.insertAfterBlock(content, 'merise-mcd', 'merise-mld', mldText);
        editor.setValue(newContent);

        new Notice('✅ Conversion MCD → MLD effectuée !');
    }

    /**
     * Convertit le bloc merise-mld du fichier actif en bloc merise-mpd.
     */
    private async commandConvertMldToMpd(): Promise<void> {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('Aucun fichier Markdown actif.');
            return;
        }

        const editor = view.editor;
        const content = editor.getValue();

        const mldBlock = this.extractCodeBlock(content, 'merise-mld');
        if (!mldBlock) {
            new Notice('Aucun bloc merise-mld trouvé dans le fichier.');
            return;
        }

        const { model, errors } = parseMld(mldBlock);
        if (errors.length > 0) {
            new Notice(`Erreurs dans le MLD :\n${errors.join('\n')}`);
            return;
        }

        const mpdModel = convertMldToMpd(model, this.settings.sqlDialect, this.settings.defaultVarcharLength);
        const mpdText = this.generateMpdText(mpdModel);

        const newContent = this.insertAfterBlock(content, 'merise-mld', 'merise-mpd', mpdText);
        editor.setValue(newContent);

        new Notice('✅ Conversion MLD → MPD effectuée !');
    }

    /**
     * Conversion complète MCD → MLD → MPD.
     */
    private async commandConvertMcdToMpd(): Promise<void> {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('Aucun fichier Markdown actif.');
            return;
        }

        const editor = view.editor;
        let content = editor.getValue();

        const mcdBlock = this.extractCodeBlock(content, 'merise-mcd');
        if (!mcdBlock) {
            new Notice('Aucun bloc merise-mcd trouvé dans le fichier.');
            return;
        }

        // MCD → MLD
        const { model: mcdModel, errors: mcdErrors } = parseMcd(mcdBlock);
        if (mcdErrors.length > 0) {
            new Notice(`Erreurs dans le MCD :\n${mcdErrors.join('\n')}`);
            return;
        }

        const mldModel = convertMcdToMld(mcdModel, this.settings.inheritanceStrategy);
        const mldText = this.generateMldText(mldModel);
        content = this.insertAfterBlock(content, 'merise-mcd', 'merise-mld', mldText);

        // MLD → MPD
        const mpdModel = convertMldToMpd(mldModel, this.settings.sqlDialect, this.settings.defaultVarcharLength);
        const mpdText = this.generateMpdText(mpdModel);
        content = this.insertAfterBlock(content, 'merise-mld', 'merise-mpd', mpdText);

        editor.setValue(content);

        new Notice('✅ Conversion complète MCD → MLD → MPD effectuée !');
    }

    /**
     * Exporte le SQL depuis le bloc merise-mpd.
     */
    private async commandExportSql(): Promise<void> {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('Aucun fichier Markdown actif.');
            return;
        }

        const editor = view.editor;
        const content = editor.getValue();

        const mpdBlock = this.extractCodeBlock(content, 'merise-mpd');
        if (!mpdBlock) {
            new Notice('Aucun bloc merise-mpd trouvé dans le fichier.');
            return;
        }

        const { model, errors } = parseMpd(mpdBlock);
        if (errors.length > 0) {
            new Notice(`Erreurs dans le MPD :\n${errors.join('\n')}`);
            return;
        }

        const sql = generateSql(model, this.settings.sqlDialect);

        // Copier dans le presse-papier
        await navigator.clipboard.writeText(sql);

        // Aussi insérer un bloc SQL dans le fichier
        const sqlBlock = `\n\n\`\`\`sql\n${sql}\n\`\`\`\n`;
        const newContent = this.insertAfterBlock(content, 'merise-mpd', 'sql', sql);
        editor.setValue(newContent);

        new Notice('✅ SQL exporté et copié dans le presse-papier !');
    }

    // ================================================================
    // Utilitaires de manipulation de texte
    // ================================================================

    /**
     * Extrait le contenu d'un bloc de code Markdown avec le langage donné.
     */
    private extractCodeBlock(content: string, language: string): string | null {
        const regex = new RegExp('```' + language + '\\s*\\n([\\s\\S]*?)\\n```', 'i');
        const match = content.match(regex);
        return match ? match[1] : null;
    }

    /**
     * Insère un nouveau bloc de code après un bloc existant.
     * Si un bloc du même type existe déjà, il est remplacé.
     */
    private insertAfterBlock(content: string, afterLang: string, newLang: string, newContent: string): string {
        // Si un bloc du newLang existe déjà, le remplacer
        const existingRegex = new RegExp('```' + newLang + '\\s*\\n[\\s\\S]*?\\n```', 'i');
        if (existingRegex.test(content)) {
            return content.replace(existingRegex, '```' + newLang + '\n' + newContent + '\n```');
        }

        // Sinon, insérer après le bloc afterLang
        const afterRegex = new RegExp('(```' + afterLang + '\\s*\\n[\\s\\S]*?\\n```)', 'i');
        const match = content.match(afterRegex);
        if (match) {
            const insertPoint = match.index! + match[0].length;
            const before = content.substring(0, insertPoint);
            const after = content.substring(insertPoint);
            return before + '\n\n```' + newLang + '\n' + newContent + '\n```' + after;
        }

        // Fallback : ajouter à la fin
        return content + '\n\n```' + newLang + '\n' + newContent + '\n```\n';
    }

    /**
     * Génère la représentation textuelle d'un MldModel (syntaxe merise-mld).
     */
    private generateMldText(model: MldModel): string {
        const lines: string[] = [];
        for (const table of model.tables) {
            lines.push(`TABLE ${table.name} {`);
            for (const col of table.columns) {
                let def = `    ${col.name}`;
                const flags: string[] = [];
                if (col.isPrimaryKey) flags.push('[PK]');
                if (col.foreignKey) {
                    flags.push(`[FK -> ${col.foreignKey.referencedTable}.${col.foreignKey.referencedColumn}]`);
                }
                if (flags.length > 0) def += ' ' + flags.join(' ');
                lines.push(def);
            }
            lines.push('}');
            lines.push('');
        }
        return lines.join('\n').trim();
    }

    /**
     * Génère la représentation textuelle d'un MpdModel (syntaxe merise-mpd).
     */
    private generateMpdText(model: MpdModel): string {
        const lines: string[] = [];
        for (const table of model.tables) {
            lines.push(`TABLE ${table.name} {`);
            for (const col of table.columns) {
                let def = `    ${col.name} ${col.sqlType}`;
                const flags: string[] = [];
                if (col.isPrimaryKey) flags.push('[PK]');
                for (const c of col.constraints) {
                    if (c.type === 'NOT NULL') flags.push('[NOT NULL]');
                    if (c.type === 'UNIQUE') flags.push('[UNIQUE]');
                    if (c.type === 'CHECK' && c.expression) flags.push(`[CHECK(${c.expression})]`);
                }
                if (col.foreignKey) {
                    let fkStr = `[FK -> ${col.foreignKey.referencedTable}.${col.foreignKey.referencedColumn}`;
                    if (col.foreignKey.onDelete) fkStr += ` ON DELETE ${col.foreignKey.onDelete}`;
                    if (col.foreignKey.onUpdate) fkStr += ` ON UPDATE ${col.foreignKey.onUpdate}`;
                    fkStr += ']';
                    flags.push(fkStr);
                }
                if (flags.length > 0) def += ' ' + flags.join(' ');
                lines.push(def);
            }
            lines.push('}');
            lines.push('');
        }
        return lines.join('\n').trim();
    }
}
