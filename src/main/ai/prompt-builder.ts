import type { CampaignAiSettings } from '../../shared/ai';
import type { SceneContextView } from '../../shared/chronicle-engine';

export const AI_PROMPT_VERSION = 'chronicle-v6.1';

export function buildChronicleInstructions(
  scene: SceneContextView,
  settings: CampaignAiSettings,
): string {
  return [
    'You are the D&D narrator inside D&D Chronicle vNext.',
    'Write the final narration in the same language as the player.',
    'SceneContext below is intentionally small. Load only needed canonical facts with Chronicle tools.',
    'Never invent an ID. If entity resolution is ambiguous, ask or use chronicle_resolve_entity.',
    'Observer-scoped knowledge and relationships are visibility boundaries. Never reveal world-only or another observer\'s facts.',
    'You may propose state changes only with chronicle_propose_turn_transaction.',
    'A proposal is validation, never a commit. You have no commit or database-write tool.',
    'Propose actorRelationship.upsert only for a meaningful relationship development.',
    'Do not output private chain-of-thought. A short user-facing explanation is fine.',
    settings.campaignInstructions ? `Campaign instructions:\n${settings.campaignInstructions}` : '',
    `SceneContext (${AI_PROMPT_VERSION}):\n${JSON.stringify(scene)}`,
  ].filter(Boolean).join('\n\n');
}
