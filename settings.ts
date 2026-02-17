/**
 * settings.ts
 * 
 * Panneau de configuration du plugin Merise dans Obsidian.
 * Paramètres :
 *   - Stratégie d'héritage (table_per_class, single_table, table_per_subclass)
 *   - Dialecte SQL (MySQL, PostgreSQL)
 *   - Longueur VARCHAR par défaut
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import { MerisePluginSettings, InheritanceStrategy, SqlDialect } from './models/types';
import type MerisePlugin from './main';

export class MeriseSettingTab extends PluginSettingTab {
    plugin: MerisePlugin;

    constructor(app: App, plugin: MerisePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Merise Modeling — Paramètres' });

        // ── Stratégie d'héritage ──
        new Setting(containerEl)
            .setName('Stratégie d\'héritage')
            .setDesc('Stratégie utilisée lors de la conversion MCD → MLD pour les héritages.')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('table_per_class', 'Table par classe (défaut)')
                    .addOption('single_table', 'Table unique')
                    .addOption('table_per_subclass', 'Table par sous-classe')
                    .setValue(this.plugin.settings.inheritanceStrategy)
                    .onChange(async (value) => {
                        this.plugin.settings.inheritanceStrategy = value as InheritanceStrategy;
                        await this.plugin.saveSettings();
                    });
            });

        // ── Dialecte SQL ──
        new Setting(containerEl)
            .setName('Dialecte SQL')
            .setDesc('Dialecte SQL utilisé pour la génération du MPD et l\'export SQL.')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('mariadb', 'MariaDB (défaut)')
                    .addOption('mysql', 'MySQL')
                    .addOption('postgresql', 'PostgreSQL')
                    .setValue(this.plugin.settings.sqlDialect)
                    .onChange(async (value) => {
                        this.plugin.settings.sqlDialect = value as SqlDialect;
                        await this.plugin.saveSettings();
                    });
            });

        // ── Longueur VARCHAR ──
        new Setting(containerEl)
            .setName('Longueur VARCHAR par défaut')
            .setDesc('Longueur par défaut pour les colonnes VARCHAR lors de la conversion MLD → MPD.')
            .addText(text => {
                text
                    .setPlaceholder('255')
                    .setValue(String(this.plugin.settings.defaultVarcharLength))
                    .onChange(async (value) => {
                        const parsed = parseInt(value, 10);
                        if (!isNaN(parsed) && parsed > 0) {
                            this.plugin.settings.defaultVarcharLength = parsed;
                            await this.plugin.saveSettings();
                        }
                    });
            });
    }
}
