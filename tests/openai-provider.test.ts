import { describe, expect, it, vi } from 'vitest';
import { OpenAiProvider, type OpenAiResponsesClient } from '../src/main/ai/openai-provider';
import { proposalToolDescriptor } from '../src/main/ai/tool-schemas';

describe('OpenAI Responses adapter', () => {
  it('streams text, replays output items, executes strict tools, and disables provider storage', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client: OpenAiResponsesClient = {
      responses: {
        create: vi.fn(async (body: unknown) => {
          requests.push(body as Record<string, unknown>);
          return requests.length === 1 ? firstStream() : secondStream();
        }),
      },
    };
    const executeTool = vi.fn(async () => ({ output: { valid: true }, truncated: false }));
    const events = [];
    for await (const event of new OpenAiProvider(client).runTurn({
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      maxOutputTokens: 2048,
      instructions: 'test',
      input: [{ role: 'user', content: 'Sesílám Hex.' }],
      tools: [proposalToolDescriptor()],
      executeTool,
    })) events.push(event);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ model: 'gpt-5.6-sol', store: false, stream: true });
    expect((requests[0].tools as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: 'function', strict: true, name: 'chronicle.propose_turn_transaction',
    });
    expect(requests[1].input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call', call_id: 'call_1' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call_1' }),
    ]));
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call_1' }));
    expect(events).toEqual(expect.arrayContaining([
      { type: 'text-delta', delta: 'Hex zasáhl cíl.' },
      expect.objectContaining({ type: 'usage', usage: expect.objectContaining({ inputTokens: 17, outputTokens: 8 }) }),
      { type: 'completed', responseId: 'resp_2', text: 'Hex zasáhl cíl.' },
    ]));
  });

  it('maps authentication failures to a stable local error', async () => {
    const provider = new OpenAiProvider({
      responses: { create: vi.fn(async () => { throw Object.assign(new Error('bad key'), { status: 401 }); }) },
    });
    await expect(provider.testConnection('gpt-5.6-sol')).rejects.toMatchObject({ code: 'OPENAI_AUTH' });
  });
});

async function* firstStream() {
  const call = {
    type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'chronicle.propose_turn_transaction',
    arguments: '{"event":{"eventType":"spell.cast","summary":"Hex."},"changes":[]}', status: 'completed',
  };
  yield { type: 'response.output_item.done', item: call, output_index: 0, sequence_number: 1 };
  yield { type: 'response.completed', sequence_number: 2, response: response('resp_1', [call], 10, 3) };
}

async function* secondStream() {
  yield { type: 'response.output_text.delta', delta: 'Hex zasáhl cíl.', item_id: 'msg_1', output_index: 0, content_index: 0, logprobs: [], sequence_number: 1 };
  yield { type: 'response.completed', sequence_number: 2, response: response('resp_2', [], 7, 5) };
}

function response(id: string, output: unknown[], inputTokens: number, outputTokens: number) {
  return {
    id,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 1 },
    },
  };
}
