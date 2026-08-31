import type {
  AiProvider,
  AiProviderConnectionResult,
  AiProviderEvent,
  AiProviderTurnInput,
} from '../../shared/ai';

export type FakeAiTurn = readonly AiProviderEvent[]
  | ((input: AiProviderTurnInput) => AsyncIterable<AiProviderEvent> | Promise<readonly AiProviderEvent[]>);

export class FakeAiProvider implements AiProvider {
  readonly id = 'fake' as const;
  private cursor = 0;

  constructor(private readonly turns: readonly FakeAiTurn[] = []) {}

  async *runTurn(input: AiProviderTurnInput): AsyncIterable<AiProviderEvent> {
    if (input.signal?.aborted) throw input.signal.reason ?? new DOMException('Aborted', 'AbortError');
    const turn = this.turns[this.cursor++];
    if (!turn) {
      const text = 'Testovací odpověď Chronicle.';
      yield { type: 'text-delta', delta: text };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4, reasoningTokens: 0, cachedInputTokens: 0 } };
      yield { type: 'completed', responseId: 'fake_response', text };
      return;
    }
    if (typeof turn !== 'function') {
      for (const event of turn) yield event;
      return;
    }
    const produced = await turn(input);
    if (Symbol.asyncIterator in Object(produced)) {
      for await (const event of produced as AsyncIterable<AiProviderEvent>) yield event;
      return;
    }
    for (const event of produced as readonly AiProviderEvent[]) yield event;
  }

  async testConnection(modelId: string): Promise<AiProviderConnectionResult> {
    return { ok: true, modelId, message: 'Testovací poskytovatel je připraven.' };
  }
}
