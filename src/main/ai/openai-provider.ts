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
  ToolUsageSummary,
} from '../../shared/ai';
import { normalizeAiReasoningEffort } from '../../shared/ai';
import { ChronicleEngineError } from '../engine/service';
import { strictToolDescriptor, validateOpenAiStrictToolSchema } from './tool-schemas';

export interface AiToolLimits {
  maxRounds: number;
  maxCalls: number;
  softLimitRatio: number;
}

export const DEFAULT_AI_TOOL_LIMITS: AiToolLimits = { maxRounds: 12, maxCalls: 40, softLimitRatio: 0.75 };

export interface OpenAiResponsesClient {
  responses: {
    create(body: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  };
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  private readonly client: OpenAiResponsesClient;
  private readonly limits: AiToolLimits;

  constructor(apiKeyOrClient: string | OpenAiResponsesClient, limits: Partial<AiToolLimits> = {}) {
    this.client = typeof apiKeyOrClient === 'string'
      ? new OpenAI({ apiKey: apiKeyOrClient }) as unknown as OpenAiResponsesClient
      : apiKeyOrClient;
    this.limits = {
      maxRounds: Math.max(1, Math.trunc(limits.maxRounds ?? DEFAULT_AI_TOOL_LIMITS.maxRounds)),
      maxCalls: Math.max(1, Math.trunc(limits.maxCalls ?? DEFAULT_AI_TOOL_LIMITS.maxCalls)),
      softLimitRatio: Math.min(0.95, Math.max(0.5, limits.softLimitRatio ?? DEFAULT_AI_TOOL_LIMITS.softLimitRatio)),
    };
  }

  async *runTurn(input: AiProviderTurnInput): AsyncIterable<AiProviderEvent> {
    let responseInput = [...input.input] as ResponseInput;
    let toolRounds = 0;
    let toolCalls = 0;
    let fullText = '';
    let responseId: string | null = null;
    const usage = emptyUsage();
    const toolUsage: ToolUsageSummary = {
      totalCalls: 0, totalRounds: 0, byTool: {}, cacheHits: 0,
      duplicateCallsAvoided: 0, maxReached: false,
    };
    let forceFinal = false;
    let softWarned = false;

    try {
      const toolBindings = new Map<string, ChronicleToolBinding>();
      const tools = input.tools.map(strictToolDescriptor).map((tool) => {
        validateOpenAiStrictToolSchema(tool.name, tool.inputSchema);
        const providerName = toOpenAiToolName(tool.name);
        const collision = toolBindings.get(providerName);
        if (collision) {
          throw new ChronicleEngineError(
            'OPENAI_TOOL_SCHEMA_INVALID',
            `Názvy nástrojů ${collision.name} a ${tool.name} mají stejný OpenAI alias ${providerName}.`,
            { toolName: tool.name, providerName },
          );
        }
        toolBindings.set(providerName, { name: tool.name, kind: tool.kind });
        return {
          type: 'function' as const,
          name: providerName,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: true,
        };
      });
      while (true) {
        assertNotAborted(input.signal);
        const request = {
          model: input.modelId,
          instructions: forceFinal
            ? `${input.instructions}\n\nTool budget is exhausted. Give the user a concise, useful final answer from the information already collected. Do not request or call more tools.`
            : input.instructions,
          input: responseInput,
          tools: forceFinal ? [] : tools,
          reasoning: { effort: normalizeAiReasoningEffort(input.modelId, input.reasoningEffort) },
          text: { verbosity: input.verbosity },
          max_output_tokens: input.maxOutputTokens,
          parallel_tool_calls: !forceFinal,
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
              'OPENAI_STREAM_ERROR',
              'OpenAI streamování odpovědi selhalo.',
              providerErrorDetails(event.response.error),
            );
          } else if (event.type === 'error') {
            throw new ChronicleEngineError(
              'OPENAI_STREAM_ERROR',
              'OpenAI streamování odpovědi selhalo.',
              providerErrorDetails(event),
            );
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
        toolUsage.totalRounds = toolRounds;
        toolUsage.totalCalls = toolCalls;
        const resolvedCalls = calls.map((call) => {
          const binding = toolBindings.get(call.name);
          if (!binding) throw new ChronicleEngineError('OPENAI_TOOL_ARGUMENTS', `OpenAI zavolalo neznámý nástroj ${call.name}.`);
          (toolUsage.byTool as Record<string, number>)[binding.name] = (toolUsage.byTool[binding.name] ?? 0) + 1;
          return { call, binding, args: parseArguments(call.arguments, binding.name) };
        });
        if (toolRounds > this.limits.maxRounds || toolCalls > this.limits.maxCalls) {
          toolUsage.maxReached = true;
          const outputs = resolvedCalls.map(({ call }) => ({
            type: 'function_call_output' as const,
            call_id: call.call_id,
            output: JSON.stringify({ ok: false, code: 'AI_TOOL_LIMIT', message: 'Bezpečný rozpočet nástrojů byl vyčerpán. Dokonči odpověď bez dalších nástrojů.' }),
          }));
          responseInput = [...responseInput, ...output, ...outputs] as unknown as ResponseInput;
          forceFinal = true;
          continue;
        }
        const atSoftLimit = toolRounds >= Math.ceil(this.limits.maxRounds * this.limits.softLimitRatio)
          || toolCalls >= Math.ceil(this.limits.maxCalls * this.limits.softLimitRatio);
        const addSoftWarning = atSoftLimit && !softWarned;
        if (addSoftWarning) softWarned = true;
        const outputs: ResponseInput = [];
        for (const { call, binding } of resolvedCalls) yield { type: 'tool-start', callId: call.call_id, name: binding.name };
        const invoke = ({ call, binding, args }: (typeof resolvedCalls)[number]) => input.executeTool({
          callId: call.call_id, name: binding.name, arguments: args,
        });
        const results = resolvedCalls.every(({ binding }) => binding.kind === 'read')
          ? await Promise.all(resolvedCalls.map(invoke))
          : await sequentialMap(resolvedCalls, invoke);
        for (let index = 0; index < resolvedCalls.length; index += 1) {
          const { call, binding } = resolvedCalls[index]!;
          const result = results[index]!;
          if (result.cached) {
            toolUsage.cacheHits += 1;
            toolUsage.duplicateCallsAvoided += 1;
          }
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: stringifyToolOutput(result.output),
          });
          yield {
            type: 'tool-finish',
            callId: call.call_id,
            name: binding.name,
            outputTruncated: result.truncated,
          };
        }
        responseInput = [
          ...responseInput, ...output, ...outputs,
          ...(addSoftWarning ? [{
            role: 'system' as const,
            content: 'You have used at least 75% of the safe tool budget. Consolidate remaining reads into batch tools and finish as soon as possible.',
          }] : []),
        ] as unknown as ResponseInput;
      }
      yield { type: 'usage', usage };
      yield { type: 'tool-usage', usage: toolUsage };
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
        store: false,
      }, { signal });
      return { ok: true, modelId, message: 'Připojení k OpenAI funguje.' };
    } catch (error) {
      throw mapOpenAiError(error);
    }
  }
}

interface ChronicleToolBinding {
  name: string;
  kind: 'read' | 'proposal';
}

async function sequentialMap<T, R>(items: readonly T[], operation: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const item of items) results.push(await operation(item));
  return results;
}

export function toOpenAiToolName(name: string): string {
  const providerName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!providerName || providerName.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(providerName)) {
    throw new ChronicleEngineError(
      'OPENAI_TOOL_SCHEMA_INVALID',
      `Název nástroje ${name} nelze převést na platný OpenAI function name.`,
      { toolName: name, providerName },
    );
  }
  return providerName;
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
    return new ChronicleEngineError('OPENAI_AUTH', 'OpenAI API klíč je neplatný nebo nemá potřebné oprávnění.', providerErrorDetails(error));
  }
  if (status === 400) return new ChronicleEngineError('OPENAI_INVALID_REQUEST', 'OpenAI odmítlo požadavek jako neplatný.', providerErrorDetails(error));
  if (status === 404) return new ChronicleEngineError('OPENAI_MODEL', 'Zvolený OpenAI model není dostupný.', providerErrorDetails(error));
  if (status === 429) return new ChronicleEngineError('OPENAI_RATE_LIMIT', 'OpenAI dočasně omezuje požadavky nebo byl vyčerpán dostupný kredit.', providerErrorDetails(error));
  if (status !== null && status >= 500) return new ChronicleEngineError('OPENAI_UNAVAILABLE', 'OpenAI je dočasně nedostupné.', providerErrorDetails(error));
  return new ChronicleEngineError('OPENAI_NETWORK', 'Spojení s OpenAI selhalo.', providerErrorDetails(error));
}

function providerErrorDetails(error: unknown): Readonly<Record<string, unknown>> {
  if (!error || typeof error !== 'object') return { providerMessage: sanitizeProviderMessage(String(error)) };
  const record = error as Record<string, unknown>;
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
  return compactDetails({
    httpStatus: finiteNumber(record.status),
    providerCode: safeDetail(record.code ?? nested.code),
    providerType: safeDetail(record.type ?? nested.type),
    providerMessage: sanitizeProviderMessage(record.message ?? nested.message),
  });
}

function sanitizeProviderMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/authorization\s*:\s*bearer\s+\S+/gi, 'Authorization: [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || undefined;
}

function safeDetail(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 120) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function compactDetails(details: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}
