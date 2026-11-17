import { createFetchHandler, createImageHandler, createSlimService } from './service.js';

export const name = 'dsh-upload-slim';
export const inject = ['connection', 'storageDomain'];
export const ACTION_ROUTE = '/api/upload-slim/action';
export const IMAGE_ROUTE = '/api/upload-slim/image';
export const SECTION = 'upload-slim:notice';
/** After tool docs (5000) and deliverable references (9000), before structured output (9900). */
export const SECTION_ORDER = 9500;

export function apply(ctx) {
  const service = createSlimService(ctx);
  ctx.effect(() => () => service.dispose());
  ctx.effect(() => ctx.connection.fetch.register({ path: ACTION_ROUTE, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(service) }));
  ctx.effect(() => ctx.connection.fetch.register({ path: IMAGE_ROUTE, methods: ['GET'], requestBody: 'buffered', fetch: createImageHandler(service) }));
  for (const dep of ['settings', 'attachments', 'sessionQuery']) {
    ctx.inject([dep], child => child.effect(() => service.bind(dep, child[dep])));
  }
  // Only the slimmed routes see the notice; other routes get an empty (absent) section.
  ctx.inject(['systemPrompt'], child => {
    child.systemPrompt.section({
      name: SECTION,
      order: SECTION_ORDER,
      interpolate: false,
      text: context => service.noticeFor(context?.modelSelection?.provider),
    });
    // DSH 0.2.1 does not pass `modelSelection` into the assembly context: the selected route only shows up as
    // `variables.provider` once the assembly waterfall has run. Fill the section from there when the context lacks it.
    child.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembled = await next();
      if (context?.modelSelection !== undefined || !Array.isArray(assembled?.sections)) return assembled;
      const text = service.noticeFor(assembled.variables?.provider);
      if (!text) return assembled;
      return { ...assembled, sections: assembled.sections.map(section => section?.name === SECTION ? { ...section, text } : section) };
    });
  });
}
