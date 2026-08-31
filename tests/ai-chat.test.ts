import { describe, expect, it } from 'vitest';
import { AiChatController } from '../src/renderer/ai-chat';
import type { AiTurnClientEvent } from '../src/shared/ai';
import type { ConversationMessage, RuntimeWorkspaceCampaign } from '../src/shared/chronicle-engine';

describe('AI chat failure state', () => {
  it('keeps the provider error and canonical user message visible after a failed-event reload', async () => {
    const campaign = workspaceCampaign();
    const messages: ConversationMessage[] = [{
      id: 'message_failed_user',
      campaignId: campaign.id,
      conversationId: campaign.runtime.activeConversationId!,
      sequence: 1,
      role: 'user',
      content: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      relatedEventId: null,
      metadata: null,
    }];
    const root = new FakeRoot();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        chronicle: {
          onAiTurnEvent: () => () => undefined,
          getConversationMessages: async () => messages,
          getPendingAiProposals: async () => [],
          getAiSecretStatus: async () => ({ configured: true }),
          getRuntimeWorkspace: async () => ({ campaigns: [campaign] }),
        },
      },
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => { callback(0); return 1; },
    });

    try {
      const controller = new AiChatController(root as unknown as HTMLElement, {
        openSettings: () => undefined,
        createCharacter: () => undefined,
        createConversation: () => undefined,
      });
      await controller.load(campaign);
      const internal = controller as unknown as {
        activeTurnContent: string | null;
        draftAssistant: string;
        runId: string | null;
        onTurnEvent(event: AiTurnClientEvent): Promise<void>;
      };
      internal.activeTurnContent = 'Test';
      await internal.onTurnEvent({
        type: 'started', runId: 'ai_failed', conversationId: campaign.runtime.activeConversationId!,
        userMessageId: 'message_failed_user',
      });
      internal.draftAssistant = 'Rozpracovaná odpověď';
      await internal.onTurnEvent({
        type: 'failed', runId: 'ai_failed', userMessageId: 'message_failed_user',
        code: 'OPENAI_INVALID_REQUEST', message: 'OpenAI odmítlo požadavek jako neplatný.',
      });

      expect(internal.runId).toBeNull();
      expect(internal.draftAssistant).toBe('');
      expect(root.innerHTML).toContain('OpenAI odmítlo požadavek jako neplatný.');
      expect(root.innerHTML).toContain('Test');
      expect(root.innerHTML).toContain('Zkusit znovu');
      expect(root.innerHTML).not.toContain('Rozpracovaná odpověď');
      expect(root.innerHTML.match(/<textarea[^>]+>/)?.[0]).not.toContain('disabled');
      expect(messages.some((message) => message.role === 'assistant')).toBe(false);
    } finally {
      restoreProperty('window', originalWindow);
      restoreProperty('requestAnimationFrame', originalAnimationFrame);
    }
  });
});

class FakeRoot {
  innerHTML = '';
  addEventListener(): void {}
  querySelector(): null { return null; }
}

function restoreProperty(name: 'window' | 'requestAnimationFrame', descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

function workspaceCampaign(): RuntimeWorkspaceCampaign {
  return {
    id: 'campaign_ravenford',
    name: 'Ravenford',
    rulesetId: 'dnd5e',
    rulesetVersion: '2024',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    runtime: {
      campaignId: 'campaign_ravenford',
      activePlayerCharacterId: 'char_arqos',
      activeConversationId: 'conversation_start',
      activeSceneLocationId: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    characters: [{ id: 'char_arqos', kind: 'Character', label: 'Arqos', subtitle: 'Warlock' }],
    conversations: [{
      id: 'conversation_start', campaignId: 'campaign_ravenford', title: 'Začátek',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    activePlayerCharacter: { id: 'char_arqos', kind: 'Character', label: 'Arqos', subtitle: 'Warlock' },
    conversationCount: 1,
  };
}
