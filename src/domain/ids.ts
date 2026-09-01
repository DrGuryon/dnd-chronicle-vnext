import { randomUUID } from 'node:crypto';

export type DomainIdPrefix =
  | 'action'
  | 'ai'
  | 'alias'
  | 'campaign'
  | 'char'
  | 'choice'
  | 'class'
  | 'change'
  | 'conversation'
  | 'message'
  | 'creature'
  | 'def'
  | 'effect'
  | 'event'
  | 'feature'
  | 'hitdie'
  | 'item'
  | 'knowledge'
  | 'loc'
  | 'movement'
  | 'pool'
  | 'proficiency'
  | 'proposal'
  | 'relation'
  | 'relationship'
  | 'resource'
  | 'sense'
  | 'defense'
  | 'spell'
  | 'spellsource'
  | 'state';

export function createDomainId(prefix: DomainIdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function requireDomainId(id: string, prefix: DomainIdPrefix): string {
  if (!id.startsWith(`${prefix}_`) || id.length <= prefix.length + 1) {
    throw new Error(`ID ${id} musí mít stabilní prefix ${prefix}_.`);
  }
  return id;
}
