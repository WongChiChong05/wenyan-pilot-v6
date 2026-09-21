import { loadEnvConfig } from '@next/env';

// A minimal real-provider transport check. It intentionally sends no study text,
// participant input or stored data, and prints neither the API key nor full output.
async function main() {
  loadEnvConfig(process.cwd());
  const { getProvider, parseJsonObject } = await import('../src/lib/llm');
  const provider = getProvider();
  const result = await provider.complete(
    'You are a connectivity check. Return JSON only and do not add prose.',
    'Return exactly this JSON object: {"status":"ok"}'
  );
  const parsed = parseJsonObject<{ status?: unknown }>(result.text);
  console.log(JSON.stringify({
    provider: provider.name,
    transportOk: result.ok,
    latencyMs: result.latencyMs,
    error: result.error ?? null,
    jsonParsed: !!parsed,
    statusOk: parsed?.status === 'ok',
  }, null, 2));
  if (!result.ok || parsed?.status !== 'ok') process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'LLM check failed');
  process.exitCode = 1;
});
