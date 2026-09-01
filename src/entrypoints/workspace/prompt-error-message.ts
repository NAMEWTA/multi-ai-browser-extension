import { PromptValidationError } from "../../core/prompts/contracts";

export function promptErrorMessage(error: unknown): string {
  if (!(error instanceof PromptValidationError)) {
    return error instanceof Error ? error.message : "提示词保存失败";
  }
  return {
    "invalid-template-id": "提示词 ID 无效。",
    "invalid-template-name": "名称不能为空或包含换行。",
    "template-name-too-long": "名称不能超过 80 个字符。",
    "duplicate-template-name": "提示词名称不能重复。",
    "invalid-template-content": "提示词内容不能为空。",
    "template-content-too-long": "提示词内容不能超过 20,000 个字符。",
    "template-limit-reached": "最多维护 100 条提示词。",
    "invalid-user-question": "本次问题不能为空。",
    "user-question-too-long": "本次问题不能超过 50,000 个字符。",
    "composed-prompt-too-long": "提示词与问题合计不能超过 100,000 个字符。",
  }[error.code];
}
