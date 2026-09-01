import {
  MAX_COMPOSED_PROMPT_LENGTH,
  PromptValidationError,
  assertPromptTemplateId,
  countCharacters,
  normalizePromptTemplateInput,
  normalizeUserQuestion,
  type PromptTemplate,
  type PromptTemplateSnapshot,
} from "./contracts";

export interface ComposePromptInput {
  readonly templates: readonly PromptTemplateSnapshot[];
  readonly question: string;
}

export function snapshotSelectedPromptTemplates(
  templates: readonly PromptTemplate[],
  selectedTemplateIds: readonly string[],
): PromptTemplateSnapshot[] {
  const selectedIds = new Set(selectedTemplateIds);
  return templates
    .filter((template) => selectedIds.has(template.id))
    .map(({ id, name, content }) => ({ id, name, content }));
}

export function composePrompt({ templates, question }: ComposePromptInput): string {
  const templateSections = templates.map((template) => {
    assertPromptTemplateId(template.id);
    const normalized = normalizePromptTemplateInput(template);
    return `${normalized.name}\n${normalized.content}`;
  });
  const normalizedQuestion = normalizeUserQuestion(question);
  const composed = templateSections.length
    ? [...templateSections, `用户\n${normalizedQuestion}`].join("\n\n")
    : normalizedQuestion;

  if (countCharacters(composed) > MAX_COMPOSED_PROMPT_LENGTH) {
    throw new PromptValidationError(
      "composed-prompt-too-long",
      `Composed prompt cannot exceed ${MAX_COMPOSED_PROMPT_LENGTH} characters.`,
    );
  }

  return composed;
}
