export interface RulesetVersionDescriptor {
  id: string;
  label: string;
  catalogPackId: string;
  catalogPackVersion: string;
  sourceLabel: string;
  speciesLabel: string;
}

export interface RulesetDescriptor {
  id: string;
  label: string;
  versions: readonly RulesetVersionDescriptor[];
}

const builtInRulesets: readonly RulesetDescriptor[] = [
  {
    id: 'dnd5e',
    label: 'D&D 5E',
    versions: [
      {
        id: '2014',
        label: '2014',
        catalogPackId: 'dnd5e-srd-5.1',
        catalogPackVersion: '1.0.0',
        sourceLabel: 'D&D 5E SRD 5.1 (CC BY 4.0)',
        speciesLabel: 'Rasa',
      },
      {
        id: '2024',
        label: '2024',
        catalogPackId: 'dnd5e-srd-5.2.1',
        catalogPackVersion: '1.0.0',
        sourceLabel: 'D&D 5E SRD 5.2.1 (CC BY 4.0)',
        speciesLabel: 'Druh',
      },
    ],
  },
] as const;

export class RulesetRegistry {
  private readonly rulesets = new Map<string, RulesetDescriptor>();

  constructor(descriptors: readonly RulesetDescriptor[] = builtInRulesets) {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register(descriptor: RulesetDescriptor): void {
    if (!descriptor.id.trim() || !descriptor.label.trim() || descriptor.versions.length === 0) {
      throw new Error('Ruleset descriptor musí mít ID, název a alespoň jednu verzi.');
    }
    if (this.rulesets.has(descriptor.id)) throw new Error(`Ruleset ${descriptor.id} už je registrovaný.`);
    this.rulesets.set(descriptor.id, structuredClone(descriptor));
  }

  list(): RulesetDescriptor[] {
    return [...this.rulesets.values()].map((descriptor) => structuredClone(descriptor));
  }

  require(rulesetId: string, rulesetVersion: string): RulesetVersionDescriptor {
    const descriptor = this.rulesets.get(rulesetId);
    const version = descriptor?.versions.find((item) => item.id === rulesetVersion);
    if (!descriptor || !version) {
      throw new Error(`Ruleset ${rulesetId}@${rulesetVersion} není registrovaný.`);
    }
    return structuredClone(version);
  }
}

export function listBuiltInRulesets(): RulesetDescriptor[] {
  return new RulesetRegistry().list();
}
