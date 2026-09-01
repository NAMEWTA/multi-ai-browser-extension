import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  ChevronDown,
  Eye,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { composePrompt } from "../../core/prompts/compose-prompt";
import { promptErrorMessage } from "./prompt-error-message";
import { usePromptLibraryStore } from "./prompt-library-store";
import "./prompt-selector.css";

export function PromptSelector({ question }: { question: string }) {
  const templates = usePromptLibraryStore((state) => state.templates);
  const selectedTemplateIds = usePromptLibraryStore((state) => state.selectedTemplateIds);
  const storageError = usePromptLibraryStore((state) => state.storageError);
  const setTemplateSelected = usePromptLibraryStore((state) => state.setTemplateSelected);
  const setAllTemplatesSelected = usePromptLibraryStore((state) => state.setAllTemplatesSelected);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const selected = useMemo(
    () => templates.filter((template) => selectedTemplateIds.includes(template.id)),
    [selectedTemplateIds, templates],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return templates;
    return templates.filter(
      (template) =>
        template.name.toLocaleLowerCase().includes(normalized) ||
        template.content.toLocaleLowerCase().includes(normalized),
    );
  }, [query, templates]);

  return (
    <>
      <div className="prompt-selector" ref={rootRef}>
        <button
          className="prompt-summary"
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="选择发送时使用的提示词"
          onClick={() => setOpen((current) => !current)}
        >
          <BookMarked size={15} />
          <strong>提示词 {selected.length}</strong>
          <ChevronDown size={13} />
        </button>

        {open && (
          <section className="prompt-popover" role="dialog" aria-label="选择提示词">
            <header>
              <div>
                <strong>本次提示词</strong>
                <span>按维护顺序拼接后发送</span>
              </div>
              {templates.length > 0 && (
                <div className="prompt-bulk-actions">
                  <button type="button" onClick={() => setAllTemplatesSelected(true)}>
                    全选
                  </button>
                  <button type="button" onClick={() => setAllTemplatesSelected(false)}>
                    清空
                  </button>
                </div>
              )}
            </header>
            {templates.length > 4 && (
              <label className="prompt-search">
                <Search size={14} />
                <input
                  type="search"
                  value={query}
                  placeholder="搜索提示词"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            )}
            <div className="prompt-options">
              {filtered.map((template) => (
                <label className="prompt-option" key={template.id}>
                  <input
                    type="checkbox"
                    checked={selectedTemplateIds.includes(template.id)}
                    onChange={(event) => setTemplateSelected(template.id, event.target.checked)}
                  />
                  <span>
                    <strong>{template.name}</strong>
                    <small>{singleLine(template.content)}</small>
                  </span>
                </label>
              ))}
              {!filtered.length && (
                <p>{templates.length ? "没有匹配的提示词" : "还没有维护提示词"}</p>
              )}
            </div>
            <footer>
              {templates.length > 0 && (
                <button
                  type="button"
                  disabled={!selected.length}
                  onClick={() => {
                    setOpen(false);
                    setPreviewOpen(true);
                  }}
                >
                  <Eye size={14} />
                  预览
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setManagerOpen(true);
                }}
              >
                <Settings2 size={14} />
                管理提示词
              </button>
            </footer>
            {storageError && <p className="prompt-storage-error">本地保存失败：{storageError}</p>}
          </section>
        )}
      </div>

      {managerOpen &&
        createPortal(<PromptLibraryDialog onClose={() => setManagerOpen(false)} />, document.body)}
      {previewOpen &&
        createPortal(
          <PromptPreviewDialog question={question} onClose={() => setPreviewOpen(false)} />,
          document.body,
        )}
    </>
  );
}

function PromptLibraryDialog({ onClose }: { onClose(): void }) {
  const templates = usePromptLibraryStore((state) => state.templates);
  const addTemplate = usePromptLibraryStore((state) => state.addTemplate);
  const updateTemplate = usePromptLibraryStore((state) => state.updateTemplate);
  const removeTemplate = usePromptLibraryStore((state) => state.removeTemplate);
  const moveTemplate = usePromptLibraryStore((state) => state.moveTemplate);
  const [editingId, setEditingId] = useState<string | "new">(templates[0]?.id ?? "new");
  const selected = templates.find((template) => template.id === editingId);
  const [name, setName] = useState(selected?.name ?? "");
  const [content, setContent] = useState(selected?.content ?? "");
  const [error, setError] = useState<string>();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function beginEditing(templateId: string | "new") {
    const template = templates.find((item) => item.id === templateId);
    setEditingId(templateId);
    setName(template?.name ?? "");
    setContent(template?.content ?? "");
    setError(undefined);
  }

  function save() {
    try {
      if (editingId === "new") {
        const created = addTemplate({ name, content });
        setEditingId(created.id);
        setName(created.name);
        setContent(created.content);
      } else {
        updateTemplate(editingId, { name, content });
      }
      setError(undefined);
    } catch (cause) {
      setError(promptErrorMessage(cause));
    }
  }

  function remove() {
    if (editingId === "new") return;
    const template = templates.find((item) => item.id === editingId);
    if (!template || !window.confirm(`删除提示词“${template.name}”？`)) return;
    const index = templates.findIndex((item) => item.id === editingId);
    const next = templates[index + 1] ?? templates[index - 1];
    removeTemplate(editingId);
    setEditingId(next?.id ?? "new");
    setName(next?.name ?? "");
    setContent(next?.content ?? "");
    setError(undefined);
  }

  return (
    <div className="prompt-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="prompt-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="管理提示词"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>提示词库</strong>
            <span>{templates.length} 条，仅保存在本机</span>
          </div>
          <button type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="prompt-library-layout">
          <aside className="prompt-library-list">
            <button
              className={editingId === "new" ? "active" : ""}
              type="button"
              onClick={() => beginEditing("new")}
            >
              <Plus size={14} />
              新建提示词
            </button>
            <div>
              {templates.map((template, index) => (
                <button
                  className={editingId === template.id ? "active" : ""}
                  type="button"
                  key={template.id}
                  onClick={() => beginEditing(template.id)}
                >
                  <span>{template.name}</span>
                  <small>{index + 1}</small>
                </button>
              ))}
            </div>
          </aside>
          <form
            className="prompt-library-editor"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label>
              <span>名称</span>
              <input
                value={name}
                maxLength={80}
                placeholder="例如：代码审查"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="prompt-content-field">
              <span>内容</span>
              <textarea
                value={content}
                maxLength={20_000}
                placeholder="输入每次发送前需要附加的指令"
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            {error && <p className="prompt-form-error">{error}</p>}
            <footer>
              <div>
                <button
                  type="button"
                  title="上移"
                  aria-label="上移"
                  disabled={editingId === "new" || templates[0]?.id === editingId}
                  onClick={() => editingId !== "new" && moveTemplate(editingId, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  title="下移"
                  aria-label="下移"
                  disabled={editingId === "new" || templates.at(-1)?.id === editingId}
                  onClick={() => editingId !== "new" && moveTemplate(editingId, 1)}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  className="prompt-delete-button"
                  type="button"
                  title="删除"
                  aria-label="删除"
                  disabled={editingId === "new"}
                  onClick={remove}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <button className="prompt-save-button" type="submit">
                <Save size={15} />
                保存
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}

function PromptPreviewDialog({ question, onClose }: { question: string; onClose(): void }) {
  const templates = usePromptLibraryStore((state) => state.templates);
  const selectedTemplateIds = usePromptLibraryStore((state) => state.selectedTemplateIds);
  const snapshots = useMemo(
    () => templates.filter((template) => selectedTemplateIds.includes(template.id)),
    [selectedTemplateIds, templates],
  );
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  let preview = "";
  let error: string | undefined;
  try {
    preview = composePrompt({ templates: snapshots, question });
  } catch (cause) {
    error = question.trim() ? promptErrorMessage(cause) : "输入本次问题后即可预览完整发送内容。";
  }

  return (
    <div className="prompt-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="prompt-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="预览实际发送内容"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>实际发送内容</strong>
            <span>{preview ? `${Array.from(preview).length} 个字符` : "尚不可预览"}</span>
          </div>
          <button type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        {preview ? <pre>{preview}</pre> : <p>{error}</p>}
      </section>
    </div>
  );
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
