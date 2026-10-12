// Checks the Gemini tool loop against a stub client (no network, no key needed).
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.GEMINI_API_KEY = 'test-key';
process.env.ASSISTANT_PROVIDER = 'gemini';
const assistant = await import('../src/assistant.js');
const { store } = await import('../src/store.js');

const room = [...store.rooms.values()].find((r) => r.exam_usable === 'yes').room_id;

function stubGemini(replies) {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(req) {
        calls.push(JSON.parse(JSON.stringify(req)));
        const parts = replies.shift();
        const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
        return { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
          functionCalls: functionCalls.length ? functionCalls : undefined };
      },
    },
  };
}

test('question -> lookup tool -> answer, with screen context passed to the model', async () => {
  assistant.resetConversation();
  const stub = stubGemini([
    [{ functionCall: { id: 'c1', name: 'get_room', args: { room_id: room } }, thoughtSignature: 'sig-1' }],
    [{ text: `${room} is used in several sessions.` }],
  ]);
  assistant._setGeminiClientForTests(stub);
  const conv = await assistant.sendMessage('How busy is this room?', 'Tester', { page: 'Seating plan', room_id: room, date: '2026-11-16', session: 'FN' });

  assert.equal(conv.provider, 'gemini');
  assert.equal(stub.calls.length, 2);
  assert.match(stub.calls[0].contents[0].parts[0].text, new RegExp(`looking at room ${room}`));
  assert.ok(stub.calls[0].config.tools[0].functionDeclarations.some((f) => f.name === 'propose_changes'));
  // second request carries the model turn unchanged (thought signature kept) + the function response
  const second = stub.calls[1].contents;
  assert.equal(second[1].parts[0].thoughtSignature, 'sig-1');
  assert.equal(second[2].parts[0].functionResponse.name, 'get_room');
  assert.equal(second[2].parts[0].functionResponse.response.output.room_id, room);
  const kinds = conv.items.map((i) => i.kind);
  assert.deepEqual(kinds, ['user', 'activity', 'assistant']);
});

test('a change request becomes a proposal, never an applied change', async () => {
  assistant.resetConversation();
  const stub = stubGemini([
    [{ functionCall: { id: 'c2', name: 'propose_changes', args: { summary: 'Room broken',
      actions: [{ type: 'set_room_availability', room_id: room, usable: false, faculty_id: null, subject_code: null, date: null, session: null }] } } }],
    [{ text: 'I have proposed marking the room unavailable. Press Apply to re-plan.' }],
  ]);
  assistant._setGeminiClientForTests(stub);
  const conv = await assistant.sendMessage(`Room ${room} is broken`, 'Tester');
  const proposal = conv.items.find((i) => i.kind === 'proposal');
  assert.ok(proposal);
  assert.equal(proposal.status, 'pending');
  assert.deepEqual(proposal.actions, [{ type: 'set_room_availability', room_id: room, usable: false }]);
  assert.equal(store.rooms.get(room).exam_usable, 'yes', 'nothing changes until Apply');
  assistant.resetConversation();
});

test('a free-tier rate limit is reported plainly, then the built-in parser answers', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { ApiError } = await import('@google/genai');
  assistant._setGeminiClientForTests({ models: { async generateContent() {
    throw new ApiError({ message: 'Resource exhausted', status: 429 });
  } } });
  const conv = await assistant.sendMessage('hello', 'Tester');
  assert.ok(conv.items.some((i) => i.kind === 'activity' && /free-tier limit/.test(i.text) && /built-in parser/.test(i.text)));
  assert.equal(conv.items.at(-1).kind, 'assistant');
  assistant.resetConversation();
});

test('Claude is asked first; when it fails, Gemini answers the same message', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-claude-key';
  delete process.env.ASSISTANT_PROVIDER;
  assert.deepEqual(assistant.providerOrder(), ['claude', 'gemini']);
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  let claudeCalls = 0;
  assistant._setClaudeClientForTests({ beta: { messages: { async create() {
    claudeCalls += 1;
    throw new Anthropic.APIConnectionError({ message: 'Connection error.' });
  } } } });
  const stub = stubGemini([[{ text: 'Gemini here: the plan has 0 clashes.' }]]);
  assistant._setGeminiClientForTests(stub);

  const conv = await assistant.sendMessage('Are there any clashes?', 'Tester');
  assert.equal(claudeCalls, 1);
  assert.equal(stub.calls.length, 1);
  assert.ok(conv.items.some((i) => i.kind === 'activity' && /asking Gemini instead/.test(i.text)));
  assert.equal(conv.items.at(-1).text, 'Gemini here: the plan has 0 clashes.');
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ASSISTANT_PROVIDER = 'gemini';
  assistant.resetConversation();
});
