import { loadEnvConfig } from '@next/env';

// Load before importing CONFIG. Never calls a provider or prints keys.
async function main() {
  loadEnvConfig(process.cwd());
  const { LEARNING_PASSAGE } = await import('../src/content/passages');
  const { CONFIG } = await import('../src/lib/config');
  const prompts = await import('../src/lib/prompts');
  const { classifyGranularity, matchTarget, neighborhoodOf } = await import('../src/lib/highlight');
  const selection = process.argv[2] ?? '帝甚不平';
  // Optional 4th argument: the reader's typed perspective. Omitted = default (meaning).
  const typed = prompts.cleanPerspective(process.argv[4] ?? '');
  const perspective = typed
    ? { text: typed, source: 'typed' as const }
    : { text: prompts.DEFAULT_PERSPECTIVE, source: 'default' as const };
  const start = process.argv[3] === undefined ? LEARNING_PASSAGE.text.indexOf(selection) : Number(process.argv[3]);
  if (!selection || !Number.isInteger(start) || start < 0 || LEARNING_PASSAGE.text.slice(start, start + selection.length) !== selection) {
    throw new Error('Selection/offset must match the learning passage');
  }
  const granularity = classifyGranularity(selection);
  const targetId = matchTarget(LEARNING_PASSAGE, selection, start);
  const target = LEARNING_PASSAGE.targets.find(t => t.id === targetId);
  const context = { passage: LEARNING_PASSAGE.text, selection, granularity,
    selectionStart: start, selectionEnd: start + selection.length,
    neighborhood: neighborhoodOf(LEARNING_PASSAGE.text, start, start + selection.length) };
  console.log(JSON.stringify({
    notice: 'Offline inspection only. No model request was sent. Target explanations are researcher-only.',
    llm: CONFIG.llm, selection, granularity, targetId,
    focusDisambiguation: target ? { required: false } : {
      requiredForLongFreeSelection: true,
      prompt: '你主要想問這段文字裡的哪一個字或詞？請自行輸入反白範圍內的字詞。',
      note: 'Both AI arms. The reader types a substring of the original highlight. No suggestions are generated.',
    },
    perspectiveStep: target ? { required: false } : {
      requiredForFreeHighlight: true, arms: ['socratic', 'direct'],
      prompt: prompts.perspectivePrompt(selection), used: perspective,
      note: 'Free text only, no options. Empty entry = default perspective (meaning).',
    },
    socratic: target ? { generated: false, layer1: target.layer1,
      layer2: target.layer2, layer3: prompts.openFinalQuestion(target.text), explanation: target.explanation } : {
      generated: true, system: prompts.socraticOpenSystemPrompt(),
      layer1User: prompts.socraticTurnPrompt({ ...context, layer: 1, perspective }),
      layer2User: prompts.socraticTurnPrompt({ ...context, layer: 2, perspective,
        lastReaderTurn: '答案：（讀者第一層答案）；理由：（讀者第一層理由）' }),
      layer3: prompts.openFinalQuestion(selection, perspective),
    },
    direct: target ? { generated: false, explanation: target.explanation } : {
      generated: true, system: prompts.directSystemPrompt(), user: prompts.directTurnPrompt({ ...context, perspective }) },
    reasonJudgeExample: prompts.reasonJudgePrompt({ sentence: target?.text ?? selection,
      options: [], reason: '我比較了上下文的描述' }),
    reasonJudgeNote: 'This is a prompt example. The rule gate may accept/reject it without calling the model.',
  }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Inspection failed'); process.exitCode = 1; });
