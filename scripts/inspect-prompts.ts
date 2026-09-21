import { loadEnvConfig } from '@next/env';

// Load before importing CONFIG. Never calls a provider or prints keys.
async function main() {
  loadEnvConfig(process.cwd());
  const { LEARNING_PASSAGE } = await import('../src/content/passages');
  const { CONFIG } = await import('../src/lib/config');
  const prompts = await import('../src/lib/prompts');
  const { classifyGranularity, matchTarget, neighborhoodOf } = await import('../src/lib/highlight');
  const selection = process.argv[2] ?? '帝甚不平';
  const start = process.argv[3] === undefined ? LEARNING_PASSAGE.text.indexOf(selection) : Number(process.argv[3]);
  if (!selection || !Number.isInteger(start) || start < 0 || LEARNING_PASSAGE.text.slice(start, start + selection.length) !== selection) {
    throw new Error('Selection/offset must match the learning passage');
  }
  const granularity = classifyGranularity(selection);
  const targetId = matchTarget(LEARNING_PASSAGE, selection, start);
  const target = LEARNING_PASSAGE.targets.find(t => t.id === targetId);
  const context = { passage: LEARNING_PASSAGE.text, selection, granularity,
    selectionStart: start, selectionEnd: start + selection.length,
    neighborhood: neighborhoodOf(LEARNING_PASSAGE.text, start, start + selection.length), withOptions: true };
  console.log(JSON.stringify({
    notice: 'Offline inspection only. No model request was sent. Server-only answer keys below must not be shared with participants.',
    llm: CONFIG.llm, selection, granularity, targetId,
    focusDisambiguation: target ? { generated: false, reason: 'target sentences keep the pre-written ladder' } : {
      generated: true,
      system: prompts.focusOptionsSystemPrompt(),
      user: prompts.focusOptionsPrompt({ selection, neighborhood: context.neighborhood }),
      note: 'The server accepts only 2-4 unique substrings and moves known proper nouns behind other candidates.',
    },
    socratic: target ? { generated: false, layer1: { text: target.layer1, ...target.layer1Choice },
      layer2: { text: target.layer2, ...target.layer2Choice }, layer3: target.choice, explanation: target.explanation } : {
      generated: true, system: prompts.socraticSystemPrompt(),
      layer1User: prompts.socraticTurnPrompt({ ...context, layer: 1 }),
      layer2User: prompts.socraticTurnPrompt({ ...context, layer: 2 }),
    },
    direct: target ? { generated: false, explanation: target.explanation } : {
      generated: true, system: prompts.directSystemPrompt(), user: prompts.directTurnPrompt(context) },
    reasonJudgeExample: prompts.reasonJudgePrompt({ sentence: target?.text ?? selection,
      options: target?.layer1Choice?.options ?? ['前面的文字', '後面的文字', '前後一起對照'], reason: '我比較了上下文的描述' }),
    reasonJudgeNote: 'This is a prompt example. The rule gate may accept/reject it without calling the model.',
  }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Inspection failed'); process.exitCode = 1; });
