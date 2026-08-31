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
    expect(requests[0]).toMatchObject({
      model: 'gpt-5.6-sol',
      instructions: 'test',
      input: [{ role: 'user', content: 'Sesílám Hex.' }],
      reasoning: { effort: 'medium' },
      text: { verbosity: 'medium' },
      max_output_tokens: 2048,
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
    expect((requests[0].tools as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: 'function', strict: true, name: 'chronicle_propose_turn_transaction',
    });
    expect(JSON.stringify(requests[0].tools)).not.toContain('"oneOf"');
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

  it('maps an OpenAI HTTP 400 to invalid request instead of a network failure', async () => {
    const provider = new OpenAiProvider({
      responses: {
        create: vi.fn(async () => {
          throw Object.assign(new Error('Invalid schema for function chronicle.test.'), {
            status: 400,
            code: 'invalid_function_parameters',
            type: 'invalid_request_error',
          });
        }),
      },
    });
    await expect(provider.testConnection('gpt-5.6-sol')).rejects.toMatchObject({
      code: 'OPENAI_INVALID_REQUEST',
      message: 'OpenAI odmítlo požadavek jako neplatný.',
      details: {
        httpStatus: 400,
        providerCode: 'invalid_function_parameters',
        providerType: 'invalid_request_error',
      },
    });
  });

  it('fails locally before a network request when a strict tool schema is unsupported', async () => {
    const create = vi.fn();
    const provider = new OpenAiProvider({ responses: { create } });
    const consume = async () => {
      for await (const _event of provider.runTurn({
        modelId: 'gpt-5.6-sol',
        reasoningEffort: 'low',
        verbosity: 'low',
        maxOutputTokens: 256,
        instructions: 'test',
        input: [{ role: 'user', content: 'Test.' }],
        tools: [{
          ...proposalToolDescriptor(),
          name: 'chronicle.invalid',
          inputSchema: {
            type: 'object', additionalProperties: false, required: ['value'],
            properties: { value: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
          },
        }],
        executeTool: vi.fn(),
      })) {
        // Drain the provider stream.
      }
    };

    await expect(consume()).rejects.toMatchObject({ code: 'OPENAI_TOOL_SCHEMA_INVALID' });
    expect(create).not.toHaveBeenCalled();
  });

  it('tests a connection without sending a model-specific reasoning value', async () => {
    const create = vi.fn(async () => ({ id: 'resp_test' }));
    const provider = new OpenAiProvider({ responses: { create } });

    await expect(provider.testConnection('gpt-5.6-sol')).resolves.toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ reasoning: expect.anything() }), {
      signal: undefined,
    });
  });

  it('normalizes a legacy minimal setting to low for GPT-5.6 requests', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const provider = new OpenAiProvider({
      responses: {
        create: vi.fn(async (body: unknown) => {
          requests.push(body as Record<string, unknown>);
          return completedStream();
        }),
      },
    });

    for await (const _event of provider.runTurn({
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'minimal',
      verbosity: 'medium',
      maxOutputTokens: 256,
      instructions: 'test',
      input: [{ role: 'user', content: 'Test.' }],
      tools: [],
      executeTool: vi.fn(),
    })) {
      // Drain the provider stream.
    }

    expect(requests[0]).toMatchObject({ reasoning: { effort: 'low' } });
  });
});

async function* firstStream() {
  const call = {
    type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'chronicle_propose_turn_transaction',
    arguments: '{"event":{"eventType":"spell.cast","summary":"Hex."},"changes":[]}', status: 'completed',
  };
  yield { type: 'response.output_item.done', item: call, output_index: 0, sequence_number: 1 };
  yield { type: 'response.completed', sequence_number: 2, response: response('resp_1', [call], 10, 3) };
}

async function* secondStream() {
  yield { type: 'response.output_text.delta', delta: 'Hex zasáhl cíl.', item_id: 'msg_1', output_index: 0, content_index: 0, logprobs: [], sequence_number: 1 };
  yield { type: 'response.completed', sequence_number: 2, response: response('resp_2', [], 7, 5) };
}

async function* completedStream() {
  yield { type: 'response.completed', sequence_number: 1, response: response('resp_compat', [], 1, 1) };
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
