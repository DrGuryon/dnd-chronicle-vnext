import { randomUUID } from 'node:crypto';

export type DomainIdPrefix =
  | 'alias'
  | 'campaign'
  | 'char'
  | 'creature'
  | 'event'
  | 'item'
  | 'knowledge'
  | 'loc'
  | 'relation'
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

