import { validateContent } from '../src/lib/contentValidation';

const { errors, warnings, passages, items } = validateContent();
console.log(`passages: ${passages}, items: ${items}`);
for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const error of errors) console.log(`ERROR ${error}`);
console.log(errors.length === 0 ? 'CONTENT OK' : `CONTENT NOT READY: ${errors.length} error(s)`);
process.exitCode = errors.length === 0 ? 0 : 1;
