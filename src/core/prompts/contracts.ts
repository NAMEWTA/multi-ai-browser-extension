export const PROMPT_LIBRARY_VERSION = 1 as const;
export const MAX_PROMPT_TEMPLATES = 100;
export const MAX_PROMPT_TEMPLATE_NAME_LENGTH = 80;
export const MAX_PROMPT_TEMPLATE_CONTENT_LENGTH = 20_000;
export const MAX_USER_QUESTION_LENGTH = 50_000;
export const MAX_COMPOSED_PROMPT_LENGTH = 100_000;

export interface PromptTemplate {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PromptTemplateInput {
  readonly name: string;
  readonly content: string;
}

export interface PromptTemplateSnapshot {
  readonly id: string;
  readonly name: string;
  readonly content: string;
}

export interface PromptLibrarySnapshot {
  readonly version: typeof PROMPT_LIBRARY_VERSION;
  readonly templates: readonly PromptTemplate[];
  readonly selectedTemplateIds: readonly string[];
}

export type PromptValidationErrorCode =
  | "invalid-template-id"
  | "invalid-template-name"
  | "template-name-too-long"
  | "duplicate-template-name"
  | "invalid-template-content"
  | "template-content-too-long"
  | "template-limit-reached"
  | "invalid-user-question"
  | "user-question-too-long"
  | "composed-prompt-too-long";

export class PromptValidationError extends Error {
  constructor(
    readonly code: PromptValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PromptValidationError";
  }
}

export function normalizePromptTemplateInput(input: PromptTemplateInput): PromptTemplateInput {
  const name = normalizeLineEndings(input.name).trim();
  const content = normalizeLineEndings(input.content).trim();

  if (!name || name.includes("\n")) {
    throw new PromptValidationError(
      "invalid-template-name",
      "Prompt template name must be a non-empty single line.",
    );
  }
  if (countCharacters(name) > MAX_PROMPT_TEMPLATE_NAME_LENGTH) {
    throw new PromptValidationError(
      "template-name-too-long",
      `Prompt template name cannot exceed ${MAX_PROMPT_TEMPLATE_NAME_LENGTH} characters.`,
    );
  }
  if (!content) {
    throw new PromptValidationError(
      "invalid-template-content",
      "Prompt template content cannot be empty.",
    );
  }
  if (countCharacters(content) > MAX_PROMPT_TEMPLATE_CONTENT_LENGTH) {
    throw new PromptValidationError(
      "template-content-too-long",
      `Prompt template content cannot exceed ${MAX_PROMPT_TEMPLATE_CONTENT_LENGTH} characters.`,
    );
  }

  return { name, content };
}

export function normalizeUserQuestion(question: string): string {
  const normalized = normalizeLineEndings(question).trim();
  if (!normalized) {
    throw new PromptValidationError("invalid-user-question", "User question cannot be empty.");
  }
  if (countCharacters(normalized) > MAX_USER_QUESTION_LENGTH) {
    throw new PromptValidationError(
      "user-question-too-long",
      `User question cannot exceed ${MAX_USER_QUESTION_LENGTH} characters.`,
    );
  }
  return normalized;
}

export function canonicalPromptTemplateName(name: string): string {
  return normalizeLineEndings(name).trim().toLowerCase();
}

export function assertPromptTemplateId(id: string): string {
  const normalized = id.trim();
  if (!normalized) {
    throw new PromptValidationError("invalid-template-id", "Prompt template ID cannot be empty.");
  }
  return normalized;
}

export function assertPromptLibraryCapacity(templateCount: number): void {
  if (templateCount >= MAX_PROMPT_TEMPLATES) {
    throw new PromptValidationError(
      "template-limit-reached",
      `Prompt library cannot contain more than ${MAX_PROMPT_TEMPLATES} templates.`,
    );
  }
}

export function assertUniquePromptTemplateName(
  templates: readonly Pick<PromptTemplate, "id" | "name">[],
  name: string,
  excludedTemplateId?: string,
): void {
  const canonicalName = canonicalPromptTemplateName(name);
  const duplicate = templates.some(
    (template) =>
      template.id !== excludedTemplateId &&
      canonicalPromptTemplateName(template.name) === canonicalName,
  );
  if (duplicate) {
    throw new PromptValidationError(
      "duplicate-template-name",
      `A prompt template named "${name}" already exists.`,
    );
  }
}

export function countCharacters(value: string): number {
  return Array.from(value).length;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
