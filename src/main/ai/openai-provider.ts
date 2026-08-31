import OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParamsStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseOutputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import type {
  AiProvider,
  AiProviderConnectionResult,
  AiProviderEvent,
  AiProviderTurnInput,
  AiUsage,
} from '../../shared/ai';
import { ChronicleEngineError } from '../engine/service';
import { strictToolDescriptor } from './tool-schemas';

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CALLS = 24;

export interface OpenAiResponsesClient {
  responses: {
    create(body: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  };
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  private readonly client: OpenAiResponsesClient;

  constructor(apiKeyOrClient: string | OpenAiResponsesClient) {
    this.client = typeof apiKeyOrClient === 'string'
      ? new OpenAI({ apiKey: apiKeyOrClient }) as unknown as OpenAiResponsesClient
      : apiKeyOrClient;
  }

  async *runTurn(input: AiProviderTurnInput): AsyncIterable<AiProviderEvent> {
    let responseInput = [...input.input] as ResponseInput;
    let toolRounds = 0;
    let toolCalls = 0;
    let fullText = '';
    let responseId: string | null = null;
    const usage = emptyUsage();

    try {
      while (true) {
        assertNotAborted(input.signal);
        const request = {
          model: input.modelId,
          instructions: input.instructions,
          input: responseInput,
          tools: input.tools.map(strictToolDescriptor).map((tool) => ({
            type: 'function' as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: true,
          })),
          reasoning: { effort: input.reasoningEffort },
          text: { verbosity: input.verbosity },
          max_output_tokens: input.maxOutputTokens,
          parallel_tool_calls: false,
          store: false,
          stream: true,
        } satisfies ResponseCreateParamsStreaming;
        const stream = await this.client.responses.create(request, { signal: input.signal }) as AsyncIterable<ResponseStreamEvent>;
        let completed: Response | null = null;
        const streamedOutput: ResponseOutputItem[] = [];
        for await (const event of stream) {
          assertNotAborted(input.signal);
          if (event.type === 'response.output_text.delta') {
            fullText += event.delta;
            yield { type: 'text-delta', delta: event.delta };
          } else if (event.type === 'response.output_item.done') {
            streamedOutput.push(event.item);
          } else if (event.type === 'response.completed') {
            completed = event.response;
          } else if (event.type === 'response.failed') {
            throw new ChronicleEngineError(
              'OPENAI_RESPONSE_FAILED',
              event.response.error?.message ?? 'OpenAI odpověď selhala.',
            );
          } else if (event.type === 'error') {
            throw new ChronicleEngineError('OPENAI_STREAM_ERROR', event.message);
          }
        }
        if (!completed) throw new ChronicleEngineError('OPENAI_STREAM_INCOMPLETE', 'OpenAI stream skončil bez dokončené odpovědi.');
        responseId = completed.id;
        addUsage(usage, completed.usage);
        const output = completed.output.length > 0 ? completed.output : streamedOutput;
        const calls = output.filter(isFunctionCall);
        if (calls.length === 0) break;
        toolRounds += 1;
        toolCalls += calls.length;
        if (toolRounds > MAX_TOOL_ROUNDS || toolCalls > MAX_TOOL_CALLS) {
          throw new ChronicleEngineError(
            'AI_TOOL_LIMIT',
            `AI překročila bezpečný limit ${MAX_TOOL_ROUNDS} kol nebo ${MAX_TOOL_CALLS} volání nástrojů.`,
          );
        }
        const outputs: ResponseInput = [];
        for (const call of calls) {
          yield { type: 'tool-start', callId: call.call_id, name: call.name };
          const args = parseArguments(call.arguments, call.name);
          const result = await input.executeTool({ callId: call.call_id, name: call.name, arguments: args });
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: stringifyToolOutput(result.output),
          });
          yield {
            type: 'tool-finish',
            callId: call.call_id,
            name: call.name,
            outputTruncated: result.truncated,
          };
        }
        responseInput = [...responseInput, ...output, ...outputs] as unknown as ResponseInput;
      }
      yield { type: 'usage', usage };
      yield { type: 'completed', responseId, text: fullText };
    } catch (error) {
      throw mapOpenAiError(error);
    }
  }

  async testConnection(modelId: string, signal?: AbortSignal): Promise<AiProviderConnectionResult> {
    try {
      assertNotAborted(signal);
      await this.client.responses.create({
        model: modelId,
        input: 'Reply with OK.',
        max_output_tokens: 64,
        reasoning: { effort: 'minimal' },
        store: false,
      }, { signal });
      return { ok: true, modelId, message: 'Připojení k OpenAI funguje.' };
    } catch (error) {
      throw mapOpenAiError(error);
    }
  }
}

function isFunctionCall(item: ResponseOutputItem): item is ResponseFunctionToolCall {
  return item.type === 'function_call';
}

function parseArguments(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ChronicleEngineError('OPENAI_TOOL_ARGUMENTS', `Nástroj ${name} obdržel neplatný JSON.`);
  }
}

function stringifyToolOutput(value: unknown): string {
  const output = JSON.stringify(value);
  return output.length <= 40_000 ? output : `${output.slice(0, 39_900)}…`;
}

function emptyUsage(): AiUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
}

function addUsage(target: AiUsage, usage: Response['usage']): void {
  if (!usage) return;
  target.inputTokens += usage.input_tokens;
  target.outputTokens += usage.output_tokens;
  target.reasoningTokens += usage.output_tokens_details?.reasoning_tokens ?? 0;
  target.cachedInputTokens += usage.input_tokens_details?.cached_tokens ?? 0;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function mapOpenAiError(error: unknown): Error {
  if (error instanceof ChronicleEngineError) return error;
  if (error instanceof Error && error.name === 'AbortError') return error;
  const status = typeof error === 'object' && error && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : null;
  if (status === 401 || status === 403) {
    return new ChronicleEngineError('OPENAI_AUTH', 'OpenAI API klíč je neplatný nebo nemá potřebné oprávnění.');
  }
  if (status === 404) return new ChronicleEngineError('OPENAI_MODEL', 'Zvolený OpenAI model není dostupný.');
  if (status === 429) return new ChronicleEngineError('OPENAI_RATE_LIMIT', 'OpenAI dočasně omezuje požadavky nebo byl vyčerpán dostupný kredit.');
  if (status !== null && status >= 500) return new ChronicleEngineError('OPENAI_UNAVAILABLE', 'OpenAI je dočasně nedostupné.');
  const message = error instanceof Error ? error.message : String(error);
  return new ChronicleEngineError('OPENAI_NETWORK', `Spojení s OpenAI selhalo: ${message}`);
}
