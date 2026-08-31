import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiProvider, toOpenAiToolName } from '../src/main/ai/openai-provider';
import {
  proposalToolDescriptor,
  strictToolDescriptor,
  validateOpenAiStrictToolSchema,
} from '../src/main/ai/tool-schemas';
import { ChronicleDatabase } from '../src/main/database';
import { ChronicleEngineError } from '../src/main/engine/service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('OpenAI strict tool schemas', () => {
  it('validates every provider-facing Chronicle descriptor without unsupported oneOf', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-openai-schemas-'));
    temporaryDirectories.push(directory);
    const database = await ChronicleDatabase.open(directory);
    const descriptors = [...database.engine.listToolDescriptors(), proposalToolDescriptor()]
      .map(strictToolDescriptor);

    for (const descriptor of descriptors) {
      expect(() => validateOpenAiStrictToolSchema(descriptor.name, descriptor.inputSchema)).not.toThrow();
      expect(JSON.stringify(descriptor.inputSchema)).not.toContain('"oneOf"');
    }
    expect(descriptors).toHaveLength(13);

    const requests: Array<Record<string, unknown>> = [];
    const provider = new OpenAiProvider({
      responses: {
        create: vi.fn(async (body: unknown) => {
          requests.push(body as Record<string, unknown>);
          return runtimeCompletedStream();
        }),
      },
    });
    for await (const _event of provider.runTurn({
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      verbosity: 'low',
      maxOutputTokens: 4096,
      instructions: 'Chronicle runtime test',
      input: [{ role: 'user', content: 'Reply with exactly OK. Do not call tools.' }],
      tools: descriptors,
      executeTool: vi.fn(),
    })) {
      // Drain the mocked streaming response.
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: 'gpt-5.6-sol',
      instructions: 'Chronicle runtime test',
      reasoning: { effort: 'medium' },
      text: { verbosity: 'low' },
      max_output_tokens: 4096,
      store: false,
      stream: true,
    });
    expect(requests[0].tools).toEqual(expect.arrayContaining(descriptors.map((descriptor) => (
      expect.objectContaining({ name: toOpenAiToolName(descriptor.name), strict: true })
    ))));
    const providerNames = descriptors.map((descriptor) => toOpenAiToolName(descriptor.name));
    expect(new Set(providerNames).size).toBe(providerNames.length);
    expect(providerNames.every((name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name))).toBe(true);
    database.close();
  });

  it('keeps every TurnChange and Item placement as an explicit strict tagged union', () => {
    const schema = proposalToolDescriptor().inputSchema as Schema;
    const changes = schema.properties.changes.items.anyOf;
    expect(changes.map((variant) => variant.properties.type.const)).toEqual([
      'hp.delta',
      'temporaryHp.set',
      'resource.delta',
      'spellSlot.delta',
      'character.move',
      'item.transfer',
      'effect.add',
      'effect.end',
      'concentration.end',
      'inspiration.set',
      'deathSave.record',
      'relation.add',
      'relation.end',
      'actorRelationship.upsert',
      'knowledge.add',
      'knowledge.end',
    ]);
    for (const variant of changes) {
      expect(variant.additionalProperties).toBe(false);
      expect(variant.required).toEqual(Object.keys(variant.properties));
    }

    const transfer = changes.find((variant) => variant.properties.type.const === 'item.transfer')!;
    const placements = transfer.properties.placement.anyOf;
    expect(placements.map((variant) => variant.properties.kind.const)).toEqual([
      'location', 'character', 'creature', 'container', 'unknown',
    ]);
    for (const placement of placements) {
      expect(placement.additionalProperties).toBe(false);
      expect(placement.required).toEqual(Object.keys(placement.properties));
    }
  });

  it('reports the tool name and exact path before an unsupported schema reaches OpenAI', () => {
    try {
      validateOpenAiStrictToolSchema('chronicle.invalid', {
        type: 'object',
        additionalProperties: false,
        properties: { value: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
        required: ['value'],
      });
      throw new Error('Expected schema validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ChronicleEngineError);
      expect(error).toMatchObject({
        code: 'OPENAI_TOOL_SCHEMA_INVALID',
        details: { toolName: 'chronicle.invalid', path: '$.properties.value.oneOf' },
      });
    }
  });
});

interface Schema {
  properties: {
    changes: {
      items: {
        anyOf: Array<{
          additionalProperties: boolean;
          required: string[];
          properties: Record<string, { const?: string; anyOf?: SchemaVariant[] }>;
        }>;
      };
    };
  };
}

interface SchemaVariant {
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, { const?: string }>;
}

async function* runtimeCompletedStream() {
  yield {
    type: 'response.completed',
    sequence_number: 1,
    response: { id: 'runtime_response', output: [], usage: null },
  };
}
